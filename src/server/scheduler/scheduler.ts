import { Cron } from 'croner'
import type { RunInput, RunResult } from '../agent/run'
import { errorFields, log } from '../log'
import type { Bot, EventCursor, Routine, RoutineReceipt, RoutineState, Store } from '../store'

// Routines as timers. Next-run times are persisted in bot.json so a restart shows what was
// missed: a run less than 12 hours late is started once at boot, an older one is skipped and
// logged; a run that had started before the restart is not late, because its occurrence was
// consumed when it started. A routine with an `event` instead of a `schedule` is armed too: it
// has no timer and waits for an event source to call fireEvent(). The mail watcher is the only
// source in this build; anything else that can call fireEvent() needs no change here.

export const MISSED_RUN_MAX_MS = 12 * 60 * 60_000

export type SchedulerDeps = {
  store: Store
  /** Starts a run and resolves when it has finished (undefined when it could not run). */
  enqueueRun(botId: string, input: RunInput): Promise<RunResult | undefined>
  now(): Date
  timezone: string
  /** Called after bot.json changed, so the page can show the new status line. */
  onBotUpdated?(bot: Bot): void
}

const STOP_GRACE_MS = 10_000
/** How many failed runs in a row one routine gets before its event is acknowledged anyway. */
export const MAX_FAILED_RUNS = 3

/** The routine's stored state. Only the record's own keys count: a routine may carry the name of a member every object inherits. */
function storedState(bot: Bot, routineName: string): RoutineState | undefined {
  return Object.hasOwn(bot.routines, routineName) ? bot.routines[routineName] : undefined
}

export class Scheduler {
  private readonly jobs = new Map<string, Map<string, Cron>>()
  /** botId → event name → the routines listening to it. Rebuilt by reload, like the timers. */
  private readonly eventRoutines = new Map<string, Map<string, string[]>>()
  /** `${botId}/${routine}` → the fired run while it is in flight, bookkeeping included: a reload must not fire it again, and `stop()` waits for it. */
  private readonly inFlight = new Map<string, Promise<boolean>>()
  /** Acknowledged runs awaiting disk persistence must not execute again while the process lives. */
  private readonly pendingReceipts = new Map<string, RoutineReceipt>()
  /** `${botId}/${routine}` → failed runs in a row. A run that ends any other way clears it. */
  private readonly failures = new Map<string, number>()
  /** botId → the end of that bot's chain of reloads. */
  private readonly reloads = new Map<string, Promise<void>>()
  private stopped = false

  constructor(private readonly deps: SchedulerDeps) {}

  /**
   * Re-arms every enabled routine of the bot from disk; call at boot and after every routine save.
   * The timers and listeners armed before stay in place while the disk is read, and are replaced
   * in one step with no await in it. An event that arrives during the reads still finds its
   * listener; with none it would be acknowledged, and its source would mark it as delivered. The
   * reloads of one bot run one after another, so the one that read the newest files arms last.
   * After `stop()` a reload arms nothing.
   */
  reload(botId: string): Promise<void> {
    const previous = this.reloads.get(botId) ?? Promise.resolve()
    const next = previous.then(() => this.reloadNow(botId), () => this.reloadNow(botId))
    this.reloads.set(botId, next)
    return next.finally(() => {
      if (this.reloads.get(botId) === next) this.reloads.delete(botId)
    })
  }

  private async reloadNow(botId: string): Promise<void> {
    const { store } = this.deps
    const bot = await store.readBot(botId)
    const routines = await store.listRoutines(botId)
    if (this.stopped) return
    this.stopBot(botId)
    const states: Record<string, RoutineState> = {}
    const armed = new Map<string, Cron>()
    const byEvent = new Map<string, string[]>()
    for (const routine of routines) {
      const previous: RoutineState = storedState(bot, routine.name) ?? { nextRunAt: null, lastRunAt: null, lastResult: null }
      if (!routine.enabled) {
        states[routine.name] = { ...previous, nextRunAt: null }
        continue
      }
      if (routine.schedule === null) {
        // An event routine has no next-run time: it waits for fireEvent(), not for a clock.
        if (routine.event !== null) byEvent.set(routine.event, [...(byEvent.get(routine.event) ?? []), routine.name])
        else log.warn('routine has neither a schedule nor an event and was not armed', { botId, routine: routine.name })
        states[routine.name] = { ...previous, nextRunAt: null }
        continue
      }
      const missed = this.missedRun(previous.nextRunAt)
      let job: Cron
      try {
        // The callback returns the run's promise: croner's `protect` then skips a trigger while a
        // previous run of this job is still in flight, and `catch` sees a rejection.
        job = new Cron(
          routine.schedule,
          {
            timezone: this.deps.timezone,
            protect: true,
            unref: true,
            catch: (e: unknown) => log.error('routine job threw', { botId, routine: routine.name, ...errorFields(e) }),
          },
          async () => { await this.fire(botId, routine.name) },
        )
      } catch (e) {
        log.error('routine has an invalid schedule and was not armed', { botId, routine: routine.name, ...errorFields(e) })
        states[routine.name] = { ...previous, nextRunAt: null }
        continue
      }
      armed.set(routine.name, job)
      states[routine.name] = { ...previous, nextRunAt: job.nextRun()?.toISOString() ?? null }
      if (missed === 'start' && this.inFlight.has(`${botId}/${routine.name}`)) {
        log.info('missed run not started: the routine is running right now', { botId, routine: routine.name })
      } else if (missed === 'start') {
        log.warn('missed run started', { botId, routine: routine.name, plannedAt: previous.nextRunAt })
        this.fire(botId, routine.name).catch((e: unknown) => log.error('missed run failed', { botId, routine: routine.name, ...errorFields(e) }))
      } else if (missed === 'skip') {
        log.warn('missed run skipped', { botId, routine: routine.name, plannedAt: previous.nextRunAt })
      }
    }
    this.jobs.set(botId, armed)
    this.eventRoutines.set(botId, byEvent)
    // A missed run started above may record its result before this write: only the next-run time is
    // this method's to set, and the rest of each state is the file's.
    const updated = await store.updateBot(botId, (current) => ({
      routines: Object.fromEntries(Object.entries(states).map(([name, state]) => [name, { ...(storedState(current, name) ?? state), nextRunAt: state.nextRunAt }])),
    }))
    this.deps.onBotUpdated?.(updated)
    log.info('routines armed', { botId, armed: [...armed.keys()], onEvent: [...byEvent.keys()] })
  }

  private missedRun(plannedAt: string | null): 'start' | 'skip' | null {
    if (plannedAt === null) return null
    const planned = new Date(plannedAt).getTime()
    if (Number.isNaN(planned)) return null
    const late = this.deps.now().getTime() - planned
    if (late <= 0) return null
    return late < MISSED_RUN_MAX_MS ? 'start' : 'skip'
  }

  /** Never rejects. False leaves event delivery pending; timers ignore the acknowledgement. */
  private fire(botId: string, routineName: string, delivery?: RoutineReceipt): Promise<boolean> {
    const key = `${botId}/${routineName}`
    const existing = this.inFlight.get(key)
    if (existing) {
      log.info('routine trigger joined: the previous run is still in flight', { botId, routine: routineName })
      return existing
    }
    const run = this.deliverRoutine(botId, routineName, delivery)
      .catch((e: unknown) => {
        log.error('routine run failed', { botId, routine: routineName, ...errorFields(e) })
        return this.failedAgain(botId, routineName, this.jobs.get(botId)?.get(routineName))
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, run)
    return run
  }

  private async deliverRoutine(botId: string, routineName: string, delivery?: RoutineReceipt): Promise<boolean> {
    const { store } = this.deps
    const key = `${botId}/${routineName}`
    const pending = this.pendingReceipts.get(key)
    if (pending) {
      await store.writeRoutineReceipt(botId, routineName, pending)
      this.pendingReceipts.delete(key)
    }
    if (delivery) {
      const receipt = await store.readRoutineReceipt(botId, routineName)
      if (receipt?.event === delivery.event && receipt.cursor.generation === delivery.cursor.generation &&
          receipt.cursor.position >= delivery.cursor.position) return true
    }
    const acknowledged = await this.runRoutine(botId, routineName)
    // Persist each listener separately: another listener's failure must not repeat a completed
    // run or override the human's Stop after this process restarts.
    if (acknowledged && delivery) {
      this.pendingReceipts.set(key, delivery)
      await store.writeRoutineReceipt(botId, routineName, delivery)
      this.pendingReceipts.delete(key)
    }
    return acknowledged
  }

  private async runRoutine(botId: string, routineName: string): Promise<boolean> {
    const { store } = this.deps
    let routine: Routine | null
    try {
      routine = await store.readRoutine(botId, routineName, true)
    } catch (e) {
      log.error('routine could not be read when it fired', { botId, routine: routineName, ...errorFields(e) })
      return false
    }
    if (!routine || !routine.enabled) return true
    const job = this.jobs.get(botId)?.get(routineName)
    let skill = null
    try {
      skill = await store.readSkill(botId, routine.skill)
    } catch (e) {
      log.warn('the routine skill could not be read', { botId, routine: routineName, skill: routine.skill, ...errorFields(e) })
    }
    if (!skill) {
      // A routine is its skill's schedule: without the skill it would be a paid run with one line.
      log.warn('routine not run: its skill is missing', { botId, routine: routineName, skill: routine.skill })
      await this.record(botId, routineName, job, { lastResult: `skill ${routine.skill} is missing; the routine did not run` })
      return this.failedAgain(botId, routineName, job)
    }
    // A timer occurrence is consumed at start, so restart does not classify it as missed.
    // Event delivery has its own receipt, saved only after an acknowledged result.
    await this.record(botId, routineName, job, {})
    log.info('routine fired', { botId, routine: routineName })
    const result = await this.deps.enqueueRun(botId, { goal: routine.body, activeSkill: skill, source: 'routine', routineName })
    const lastResult = (result?.summary ?? 'could not run').split('\n')[0]?.slice(0, 200) ?? ''
    await this.record(botId, routineName, job, { lastRunAt: this.deps.now().toISOString(), lastResult })
    if (!result) return this.failedAgain(botId, routineName, job)
    switch (result.outcome) {
      case 'failed':
      case 'unknown':
        // A failure that the same goal would meet again is not handed back for another try.
        if (result.final) {
          this.failures.delete(`${botId}/${routineName}`)
          return true
        }
        return this.failedAgain(botId, routineName, job)
      // Human decisions and intervention states end automatic delivery. Retrying them would
      // override Stop or repeatedly take a held screen or spend against the same limit.
      case 'done':
      case 'cancelled':
      case 'denied':
      case 'blocked':
      case 'stuck':
      case 'budget':
        this.failures.delete(`${botId}/${routineName}`)
        return true
    }
  }

  /**
   * Counts the failed runs of one routine in a row. False hands the event back for another try;
   * at MAX_FAILED_RUNS the event is acknowledged, so one mail cannot start paid runs without end.
   * The count lives in memory: after a restart an event that comes back gets its tries again.
   */
  private async failedAgain(botId: string, routineName: string, job: Cron | undefined): Promise<boolean> {
    const key = `${botId}/${routineName}`
    const failed = (this.failures.get(key) ?? 0) + 1
    if (failed < MAX_FAILED_RUNS) {
      this.failures.set(key, failed)
      return false
    }
    this.failures.delete(key)
    log.error('routine failed too many times in a row; its event is not tried again', { botId, routine: routineName, failed })
    await this.record(botId, routineName, job, { lastResult: `failed ${failed} times in a row; an event that started it is not tried again` })
    return true
  }

  /** Writes the routine's state, and the status line when there is a result. Never rejects: a failed write is logged. */
  private async record(botId: string, routineName: string, job: Cron | undefined, patch: Partial<RoutineState>): Promise<void> {
    const { store } = this.deps
    try {
      const statusLine = patch.lastResult === undefined ? {} : { statusLine: `routine: ${routineName} — ${patch.lastResult}` }
      // Two routines of one bot can record at the same moment (a schedule and an event): each adds
      // its own state to the routines the file holds when its turn comes.
      const updated = await store.updateBot(botId, (bot) => {
        const previous = storedState(bot, routineName) ?? { nextRunAt: null, lastRunAt: null, lastResult: null }
        const state: RoutineState = { ...previous, ...patch, nextRunAt: job?.nextRun()?.toISOString() ?? previous.nextRunAt }
        return { routines: { ...bot.routines, [routineName]: state }, ...statusLine }
      })
      this.deps.onBotUpdated?.(updated)
    } catch (e) {
      log.error('could not record the routine state', { botId, routine: routineName, ...errorFields(e) })
    }
  }

  /**
   * An event source (the mail watcher) reports that something happened. Every enabled routine
   * listening to that event, on any bot, runs once. Never rejects, for the same reason `fire`
   * does not: an event source must not be able to take the process down. Resolves when the runs
   * it started have finished. True acknowledges delivery; false asks the source to retry.
   */
  async fireEvent(event: string, cursor?: EventCursor): Promise<boolean> {
    const started: Promise<boolean>[] = []
    for (const [botId, byEvent] of this.eventRoutines) {
      for (const name of byEvent.get(event) ?? []) started.push(this.fire(botId, name, cursor ? { event, cursor } : undefined))
    }
    if (started.length === 0) {
      log.info('event fired with no routine listening', { event })
      return true
    }
    log.info('event fired', { event, routines: started.length })
    return (await Promise.all(started)).every((acknowledged) => acknowledged)
  }

  private stopBot(botId: string): void {
    for (const job of this.jobs.get(botId)?.values() ?? []) job.stop()
    this.jobs.delete(botId)
    this.eventRoutines.delete(botId)
  }

  /**
   * Stops every job and waits for the runs in flight to finish, their result recorded. A run can
   * sit on a human for a long time (an approval, a question), so the wait is bounded: after
   * `graceMs` the stop goes ahead and says so in the log.
   */
  async stop(graceMs = STOP_GRACE_MS): Promise<void> {
    this.stopped = true
    for (const botId of [...this.jobs.keys()]) this.stopBot(botId)
    const inFlight = [...this.inFlight.values()]
    if (inFlight.length === 0) return
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), graceMs)
    })
    const settled = Promise.allSettled(inFlight)
    const winner = await Promise.race([settled.then(() => 'settled' as const), timeout])
    clearTimeout(timer)
    if (winner === 'timeout') {
      log.warn('stop went ahead with runs still in flight', { count: inFlight.length, graceMs })
      return
    }
    // `fire` turns every rejection into a log line, so a rejected entry means that promise broke.
    for (const r of await settled) if (r.status === 'rejected') log.error('a run did not settle cleanly during stop', errorFields(r.reason))
  }
}
