import { randomUUID } from 'node:crypto'
import type { BotEvents } from '../bot-events'
import { errorFields, log } from '../log'
import { NOTICE_UNCONFIRMED_TEXT, type HumanNeed, type NoticeOutcome, type NotifierPort } from '../mail/notifier'
import type { SandboxSession } from '../sandbox/e2b'
import type { SandboxManager } from '../sandbox/manager'
import { splitChatText } from '../store'
import type { ActionKind, BotState, Card, ChatInput, ChatMessage, RunEventBody, Store } from '../store'
import { budgetText, spentToday } from './budget'
import type { Approvals } from './gate'
import type { ModelPort } from './model'
import type { RunQueue } from './queue'
import { runLoop, type RunInput, type RunResult } from './run'
import { TakeoverController, UNANSWERED_REASON, unsafeReason } from './takeover'
import { NO_CONNECTORS, type ConnectorsPort, type RunContext, type ToolDef } from './run-context'
import { deniedSummary, STOPPED_TEXT } from './run-text'
import { STOPPED_ANSWER } from './tools'

// Starts runs: creates the run record, brings the bot's computer up, builds the RunContext that
// wires the loop to the store and the SSE stream, and closes the run honestly whatever happens.

export const USER_ANSWER_TIMEOUT_MS = 30 * 60_000
export const APPROVAL_TIMEOUT_MS = 30 * 60_000
/**
 * The sandbox pauses itself after its own timeout (20 minutes) unless someone talks to the E2B
 * API, and driving the screen through noVNC does not count. So a long run — and above all a
 * takeover, where the loop is waiting on a person and makes no calls at all — would pause the
 * computer under the human's hands. This refreshes the timeout for as long as the run is open.
 */
export const KEEPALIVE_MS = 5 * 60_000

/**
 * While the page shows the bot's screen in takeover mode, it asks every two seconds whether hand
 * back is allowed. A question within this window counts as a person on the screen, and the
 * blocked hold does not end under their hands.
 */
export const HOLD_PRESENCE_MS = 60_000
/** How many chat messages back the runner looks for a takeover card that is still open. A held bot posts little, so the card is near the end. */
const OPEN_CARD_LOOKBACK = 50

export function holdEndedText(minutes: number): string {
  return `I waited ${minutes} minutes for you and then let my computer go to sleep. Send me the next goal to wake it.`
}

/** The chat line for a goal that did not start because the screen a human was on is not safe to show the model yet. */
export function notStartedText(reason: string, routineName?: string): string {
  const what = routineName === undefined ? 'I did not start' : `I did not start the routine "${routineName}"`
  const next = reason === UNANSWERED_REASON ? 'Try again in a minute.' : 'Finish that step on my screen and press Hand back, then send me the goal again.'
  return `${what}: ${reason}. ${next}`
}

export type RunnerDeps = {
  store: Store
  events: BotEvents
  approvals: Approvals
  queue: RunQueue
  sandboxes: SandboxManager
  model: ModelPort
  modelId: string
  tools: ToolDef[]
  /** The bots' connectors; absent, no bot has any. */
  connectors?: ConnectorsPort
  /** The operator's spend limit for one day across all bots, in USD (`DAILY_BUDGET_USD`). */
  dailyBudgetUsd: number
  /** The budget's day ends at midnight here: the routines' clock (`TZ`). */
  timezone: string
  /** Re-arms a bot's routines after save_routine; the scheduler supplies it. */
  reloadRoutines?: (botId: string) => Promise<void>
  /** Injected in tests; defaults to an unref'd setInterval so it never holds the process open. */
  setKeepAlive?: (fn: () => void, ms: number) => unknown
  clearKeepAlive?: (handle: unknown) => void
  /** Injected in tests; defaults to the wall clock. */
  now?: () => Date
  /** How long a run that ended blocked holds its computer awake while nobody is on its screen (`BLOCKED_HOLD_MINUTES`). */
  blockedHoldMs: number
  /** Injected in tests; defaults to an unref'd setTimeout. */
  setHoldTimer?: (fn: () => void, ms: number) => unknown
  clearHoldTimer?: (handle: unknown) => void
  /** Calls the human by mail when a bot needs their action on the screen; absent, nobody is mailed (NOTIFY_EMAIL). */
  notifier?: NotifierPort
}

type Waiter = { resolve: (text: string) => void; timer: NodeJS.Timeout }

export class Runner {
  private readonly userWaiters = new Map<string, Waiter>()
  private readonly activeRuns = new Map<string, string>()
  private readonly takeovers = new Map<string, TakeoverController>()
  /** Keep-alive handles of runs that ended blocked: the computer stays awake for the human. */
  private readonly blockedKeepAlives = new Map<string, unknown>()
  private readonly manualRequests = new Set<string>()
  /** One per active run; aborted when the user presses Stop, so a pending model call ends at once. */
  private readonly stopSignals = new Map<string, AbortController>()
  /** The hold timer of each bot whose run ended blocked. */
  private readonly blockedHolds = new Map<string, unknown>()
  /** When the page last asked whether hand back is allowed, per bot, in epoch milliseconds. */
  private readonly lastSeenOnScreen = new Map<string, number>()
  /** Idle bots whose screen a human took from the page: the session they stream from, and the keep-alive and the presence timer that hold it awake. */
  private readonly idleTakeovers = new Map<string, { session: SandboxSession; keepAlive: unknown; presence: unknown }>()
  /** Bots whose human was already told, during the current hold of their screen, that a goal was refused: one notice per hold. Reset where a hold starts, never where one ends: the refusal is decided after an awaited screen check, and a hold can end while that check is out. */
  private readonly refusedNotified = new Set<string>()

  constructor(private readonly deps: RunnerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /**
   * Accepts a goal: the run record exists, with a `queued` event, before this resolves, so a
   * restart closes a goal that never started instead of losing it. `done` resolves when the run
   * has ended; runs on one bot never overlap.
   */
  async accept(botId: string, input: RunInput): Promise<{ runId: string; done: Promise<RunResult | undefined> }> {
    const runId = randomUUID()
    await this.deps.store.startRun(botId, runId)
    const queued = { t: new Date().toISOString(), runId, botId, type: 'queued' as const, goal: input.goal, source: input.source, ...(input.routineName === undefined ? {} : { routineName: input.routineName }) }
    await this.deps.store.appendRunEvent(queued)
    this.deps.events.emitRun(queued)
    const done = this.deps.queue.enqueue(botId, () => this.run(botId, runId, input))
    return { runId, done }
  }

  /** Queues a run on the bot and resolves with its result when it has ended. */
  async enqueue(botId: string, input: RunInput): Promise<RunResult | undefined> {
    return (await this.accept(botId, input)).done
  }

  /** True when the bot's run is waiting on ask_user and the text answered it. */
  answerUser(botId: string, text: string): boolean {
    const waiter = this.userWaiters.get(botId)
    if (!waiter) return false
    this.userWaiters.delete(botId)
    clearTimeout(waiter.timer)
    waiter.resolve(text)
    return true
  }

  isWaitingForUser(botId: string): boolean {
    return this.userWaiters.has(botId)
  }

  activeRunId(botId: string): string | null {
    return this.activeRuns.get(botId) ?? null
  }

  /** The user pressed Take over during a run: the loop hands over before its next model call. */
  requestTakeover(botId: string): boolean {
    if (!this.activeRuns.has(botId)) return false
    this.manualRequests.add(botId)
    return true
  }

  /** Whether a run is active or waiting its turn on this bot. */
  isBusy(botId: string): boolean {
    return this.activeRuns.has(botId) || this.deps.queue.size(botId) > 0
  }

  /**
   * The user pressed Stop. The active run ends before its next model call or action; a wait it is
   * in ends now: an open question is answered with a stop, a pending approval is denied, a takeover
   * is ended. A goal queued behind the run keeps its turn. False when no run is active.
   */
  cancel(botId: string): boolean {
    const runId = this.activeRuns.get(botId)
    if (runId === undefined) return false
    const stopSignal = this.stopSignals.get(botId)
    // run() creates the controller next to the activeRuns entry, with no await between them.
    if (stopSignal === undefined) log.error('active run has no stop signal; a pending model call cannot be stopped', { botId, runId })
    stopSignal?.abort()
    this.answerUser(botId, STOPPED_ANSWER)
    for (const id of this.deps.approvals.pendingFor(runId)) this.deps.approvals.resolve(id, 'denied')
    this.takeovers.get(botId)?.cancel()
    log.info('stop requested by the user', { botId, runId })
    return true
  }

  /**
   * The user took the screen of an idle bot from the page: the interactive stream, with no run and
   * no card. No run holds the computer up then, and the idle pause would fire while they use it. So
   * the computer is held awake until they press Hand back, or until the page has not asked whether
   * hand back is allowed for a minute (a closed tab); a goal that arrives meanwhile passes the
   * hand-back check before it takes the screen. The computer is held through the manager's own
   * bring-up, like a run's: a pause already in flight settles first, and a computer that paused a
   * moment ago is resumed, so the session this resolves with is the one to stream from. Null when
   * there is nothing to hold: a run or a blocked hold has the computer already, or it is not running.
   */
  async beginIdleTakeover(botId: string): Promise<SandboxSession | null> {
    if (this.activeRuns.has(botId) || this.blockedKeepAlives.has(botId)) return null
    this.lastSeenOnScreen.set(botId, this.now().getTime())
    const already = this.idleTakeovers.get(botId)
    if (already) return already.session
    // A computer that is asleep is not woken for a takeover: the next goal does that (README).
    if (!this.deps.sandboxes.get(botId)) return null
    let session: SandboxSession
    try {
      session = await this.deps.sandboxes.ensureRunning(botId, 'takeover')
    } catch (e) {
      this.deps.sandboxes.release(botId, 'takeover')
      log.warn('could not bring the computer up for the takeover', { botId, ...errorFields(e) })
      return null
    }
    // While the computer came up, a second request may have finished first, or a run may have
    // started; the run has the screen check to make and holds the computer itself.
    const meanwhile = this.idleTakeovers.get(botId)
    if (meanwhile) return meanwhile.session
    if (this.activeRuns.has(botId)) {
      this.deps.sandboxes.release(botId, 'takeover')
      return null
    }
    const setKeepAlive = this.deps.setKeepAlive ?? ((fn, ms) => setInterval(fn, ms).unref())
    const keepAlive = setKeepAlive(() => {
      session.keepAlive().catch((e: unknown) => log.warn('could not hold the computer awake for the takeover', { botId, ...errorFields(e) }))
    }, KEEPALIVE_MS)
    this.refusedNotified.delete(botId)
    this.idleTakeovers.set(botId, { session, keepAlive, presence: this.armIdlePresence(botId) })
    log.info('takeover of an idle bot started; the computer is held awake', { botId })
    return session
  }

  /** Ends the idle takeover once the page has stopped asking about hand back for a minute; re-armed while it asks. */
  private armIdlePresence(botId: string): unknown {
    const setHold = this.deps.setHoldTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref())
    return setHold(() => {
      try {
        const held = this.idleTakeovers.get(botId)
        if (!held) return
        const seen = this.lastSeenOnScreen.get(botId)
        if (seen !== undefined && this.now().getTime() - seen < HOLD_PRESENCE_MS) {
          held.presence = this.armIdlePresence(botId)
          return
        }
        this.endIdleTakeover(botId)
        log.info('takeover of an idle bot ended: nobody on the screen; the computer is released', { botId })
      } catch (e) {
        // A timer callback has no caller to reject to: the failure is logged where it happened.
        log.error('could not end the takeover of an idle bot', { botId, ...errorFields(e) })
      }
    }, HOLD_PRESENCE_MS)
  }

  /** Drops the keep-alive and the presence timer and lets the computer go to its normal pause. */
  private endIdleTakeover(botId: string): void {
    const held = this.idleTakeovers.get(botId)
    if (!held) return
    this.idleTakeovers.delete(botId)
    this.clearKeepAlive(held.keepAlive)
    ;(this.deps.clearHoldTimer ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout)))(held.presence)
    this.deps.sandboxes.release(botId, 'takeover')
  }

  /** Whether the human may hand back now. Without a run only the page's safety matters. */
  async handbackState(botId: string, force = false): Promise<{ allowed: boolean; reason: string }> {
    this.lastSeenOnScreen.set(botId, this.now().getTime())
    const controller = this.takeovers.get(botId)
    if (controller) return controller.state(force)
    // Only a tab in takeover mode asks this, so the question is a human on the screen. When their
    // idle takeover ended because the tab was hidden for a while, it starts again here: otherwise
    // the computer would pause under their hands, and a goal would start with no screen check.
    if (!this.activeRuns.has(botId) && !this.blockedKeepAlives.has(botId) && !this.idleTakeovers.has(botId)) await this.beginIdleTakeover(botId)
    const { allowed, reason } = await this.safeWithoutRun(botId)
    return { allowed, reason }
  }

  /** Hands the screen back: resumes the run, or — after a run ended blocked — sets the bot idle. */
  async handback(botId: string, force = false): Promise<{ ok: true } | { ok: false; reason: string }> {
    const controller = this.takeovers.get(botId)
    if (controller) return controller.handback(force)
    const state = await this.safeWithoutRun(botId, true)
    if (!state.allowed) return { ok: false, reason: state.reason }
    // The hand-back itself puts unreadable regions on record; the page's two-second state poll does not.
    if (state.unreadable > 0) log.warn('hand-back allowed with unreadable regions on the page', { botId, unreadable: state.unreadable })
    if (this.idleTakeovers.has(botId)) {
      this.endIdleTakeover(botId)
      log.info('takeover of an idle bot ended by hand back; the computer is released', { botId })
      return { ok: true }
    }
    const bot = await this.deps.store.readBot(botId)
    // A queued run is about to set its own state; only a bot that ended blocked goes back to idle here.
    if (bot.state === 'blocked' && this.deps.queue.size(botId) === 0) {
      const updated = await this.deps.store.updateBot(botId, { state: 'idle', statusLine: 'handed back' })
      this.deps.events.emitBot(updated)
      await this.endOpenTakeoverCard(botId)
      this.dropBlockedKeepAlive(botId)
      // A goal that arrived while the card was being ended has the computer now; its run releases it.
      if (this.deps.queue.size(botId) > 0) return { ok: true }
      this.deps.sandboxes.release(botId)
    }
    return { ok: true }
  }

  private clearKeepAlive(handle: unknown): void {
    ;(this.deps.clearKeepAlive ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout)))(handle)
  }

  private dropBlockedKeepAlive(botId: string): void {
    this.clearBlockedHold(botId)
    const held = this.blockedKeepAlives.get(botId)
    if (held === undefined) return
    this.clearKeepAlive(held)
    this.blockedKeepAlives.delete(botId)
  }

  private armBlockedHold(botId: string): void {
    const setHold = this.deps.setHoldTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref())
    const handle = setHold(() => {
      this.blockedHolds.delete(botId)
      const seen = this.lastSeenOnScreen.get(botId)
      if (seen !== undefined && this.now().getTime() - seen < HOLD_PRESENCE_MS) {
        log.info('blocked hold extended: someone is on the bot screen', { botId })
        this.armBlockedHold(botId)
        return
      }
      // Queued behind the bot's runs: a goal that arrives in the meantime either goes first (and
      // takes the computer and the card itself) or waits until the release is done. Nothing can
      // pause a computer a run has just taken.
      void this.deps.queue.enqueue(botId, () => this.endBlockedHold(botId))
    }, this.deps.blockedHoldMs)
    this.blockedHolds.set(botId, handle)
  }

  private clearBlockedHold(botId: string): void {
    const handle = this.blockedHolds.get(botId)
    if (handle === undefined) return
    ;(this.deps.clearHoldTimer ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout)))(handle)
    this.blockedHolds.delete(botId)
  }

  /**
   * The hold ran out with nobody on the screen: the held keep-alive is dropped, the takeover card
   * says the computer went to sleep, the bot goes idle and the computer is released to the normal
   * pause. Runs as a job on the bot's queue; a run that went first has dropped the keep-alive
   * already, and then there is nothing to do. Never rejects: the queue would only log it.
   */
  private async endBlockedHold(botId: string): Promise<void> {
    try {
      if (!this.blockedKeepAlives.has(botId)) return
      this.dropBlockedKeepAlive(botId)
      await this.endOpenTakeoverCard(botId, holdEndedText(Math.round(this.deps.blockedHoldMs / 60_000)))
      const bot = await this.deps.store.readBot(botId)
      if (bot.state === 'blocked') {
        const updated = await this.deps.store.updateBot(botId, { state: 'idle', statusLine: 'my computer went to sleep' })
        this.deps.events.emitBot(updated)
      }
      this.deps.sandboxes.release(botId)
      log.info('blocked hold ended; the computer is released', { botId })
    } catch (e) {
      log.error('could not end the blocked hold', { botId, ...errorFields(e) })
    }
  }

  /**
   * No run to resume: the page must still be safe, and a companion that does not answer is not safe.
   * Returns the decision only; `unreadable` says how many regions of the page the companion could not
   * read, for the caller to record.
   */
  private async safeWithoutRun(botId: string, repair = false): Promise<{ allowed: boolean; reason: string; unreadable: number }> {
    const session = this.deps.sandboxes.get(botId)
    if (!session) return { allowed: true, reason: '', unreadable: 0 }
    try {
      const now = await session.sandbox.companion.pageState()
      const unsafe = unsafeReason(now)
      if (unsafe !== null) return { allowed: false, reason: unsafe, unreadable: now.unreadable ?? 0 }
      return { allowed: true, reason: '', unreadable: now.unreadable ?? 0 }
    } catch (e) {
      log.warn('page state unavailable for hand-back without a run', { botId, ...errorFields(e) })
      // A held computer that the provider paused on its own clock (the laptop slept past the
      // timeout) never answers again by itself. A hand-back or a goal brings it up once, under the
      // hold that already exists, and asks again; the page's two-second poll does not.
      const holder = this.blockedKeepAlives.has(botId) ? 'run' : this.idleTakeovers.has(botId) ? 'takeover' : null
      if (repair && holder !== null) {
        try {
          await this.deps.sandboxes.ensureRunning(botId, holder)
          return await this.safeWithoutRun(botId)
        } catch (again) {
          log.warn('the held computer could not be brought up again', { botId, ...errorFields(again) })
        }
      }
      return { allowed: false, reason: UNANSWERED_REASON, unreadable: 0 }
    }
  }

  /** Ends the bot's open takeover card; `reason` replaces its text when the user needs to know why it ended. */
  private async endOpenTakeoverCard(botId: string, reason?: string): Promise<void> {
    const chat = await this.deps.store.readChat(botId, { limit: OPEN_CARD_LOOKBACK })
    const open = [...chat].reverse().find((m) => m.card?.card === 'takeover' && m.card.status === 'active')
    if (!open?.card || open.card.card !== 'takeover') return
    const updated = await this.deps.store.updateChatCard(botId, open.id, { ...open.card, status: 'ended', ...(reason === undefined ? {} : { reason }) })
    if (updated) this.deps.events.emitChat(updated)
  }

  /**
   * Calls the human by mail. notify() is invoked here and now, in the
   * caller's own synchronous block, so a notice exists exactly when the need does; nothing waits
   * for its outcome. This is called from inside a wait's registration, so it never throws, and the
   * chain ends in a catch because a rejection nobody awaits would end the process. An outcome that
   * is not confirmed leaves one neutral card: it says nothing about waiting, because a blocked or
   * refused run has ended and a wait can end before the outcome is known.
   */
  private callHuman(who: { botId: string; runId: string; botName: string }, need: HumanNeed, actionKind?: ActionKind): void {
    const { botId, runId, botName } = who
    const notifier = this.deps.notifier
    if (!notifier) return
    const { store, events } = this.deps
    let sending: Promise<NoticeOutcome>
    try {
      sending = notifier.notify({ botName, need, ...(actionKind === undefined ? {} : { actionKind }) })
    } catch (e) {
      // The error's name only: a notifier's error text can quote an address or a server's answer.
      log.warn('the notifier threw; the notice counts as unconfirmed', { botId, runId, need, errorName: errorFields(e).errorName })
      sending = Promise.resolve('unconfirmed')
    }
    void sending
      .then(async (outcome) => {
        log.info('notice to the human', { botId, runId, need, outcome })
        if (outcome === 'confirmed') return
        events.emitChat(await store.appendChat(botId, { role: 'card', card: { card: 'status', text: NOTICE_UNCONFIRMED_TEXT } }))
      })
      .catch((e: unknown) => log.warn('the notice to the human failed', { botId, runId, need, errorName: errorFields(e).errorName }))
  }

  private async run(botId: string, runId: string, input: RunInput): Promise<RunResult | undefined> {
    const { store, events, approvals, sandboxes } = this.deps
    this.activeRuns.set(botId, runId)
    const stopSignal = new AbortController()
    this.stopSignals.set(botId, stopSignal)
    let keepAlive: unknown = null

    const emit = async (body: RunEventBody): Promise<void> => {
      const event = { t: new Date().toISOString(), runId, botId, ...body }
      await store.appendRunEvent(event)
      events.emitRun(event)
    }
    // Text longer than one chat message is posted as several, so a long answer is never lost.
    const postOne = async (chatInput: ChatInput): Promise<ChatMessage> => {
      const message = await store.appendChat(botId, chatInput)
      events.emitChat(message)
      return message
    }
    const postChat = async (chatInput: ChatInput): Promise<ChatMessage> => {
      if (chatInput.role === 'card') return postOne(chatInput)
      const parts = splitChatText(chatInput.text)
      for (const text of parts.slice(0, -1)) await postOne({ role: chatInput.role, text })
      return postOne({ role: chatInput.role, text: parts.at(-1) ?? '' })
    }
    const updateChat = async (messageId: string, card: Card): Promise<void> => {
      const updated = await store.updateChatCard(botId, messageId, card)
      if (updated) events.emitChat(updated)
    }
    const setBotState = async (state: BotState, statusLine?: string): Promise<void> => {
      const bot = await store.updateBot(botId, statusLine === undefined ? { state } : { state, statusLine })
      events.emitBot(bot)
      await emit({ type: 'status', text: bot.statusLine, botState: state })
    }
    const stopped = async (): Promise<RunResult> => {
      // A failed setup operation must not turn the user's Stop into an automatic retry.
      // Reporting may also fail, but the returned outcome still preserves that decision.
      const summary = 'stopped by the user'
      await postChat({ role: 'bot', text: STOPPED_TEXT }).catch(() => undefined)
      await setBotState('idle', 'stopped by you').catch(() => undefined)
      await emit({ type: 'end', outcome: 'cancelled', summary }).catch(() => undefined)
      return { outcome: 'cancelled', summary }
    }

    // A run that ends stuck or over budget asks the human to act on its screen, so its computer
    // stays up until they hand back (which releases it); the idle pause would otherwise fire under
    // their hands two minutes after the end.
    let endedBlocked = false
    try {
      // The hooks below run inside synchronous registrations, so the name is in hand before them.
      const human = { botId, runId, botName: (await store.readBot(botId)).name }
      // Checked before the computer is touched and before any model call: a refused run costs nothing.
      // It also comes before a held screen is taken: a bot that ended blocked keeps its hold, its
      // open card and its state, because a human may be working there.
      const spentUsd = await spentToday(store, this.now(), this.deps.timezone)
      if (spentUsd >= this.deps.dailyBudgetUsd) {
        const text = budgetText(this.deps.dailyBudgetUsd, spentUsd)
        log.warn('daily budget used up; the run did not start (DAILY_BUDGET_USD in .env.local sets the limit)', { botId, runId, spentUsd, budgetUsd: this.deps.dailyBudgetUsd })
        await postChat({ role: 'card', card: { card: 'status', text: text.card } })
        endedBlocked = this.blockedKeepAlives.has(botId)
        if (!endedBlocked) await setBotState('idle', 'daily budget used up')
        await emit({ type: 'end', outcome: 'budget', summary: text.summary })
        return { outcome: 'budget', summary: text.summary }
      }
      // A new goal on a bot that ended blocked is the other way out of that state: the held keep-alive
      // and the open takeover card belong to the run that is over. But a human was invited to that
      // screen, so the goal takes it only after the check the hand-back makes: a run never opens on a
      // page that still shows a secret, and a computer that does not answer is not safe. A refused
      // goal leaves the bot blocked, the card open and the hold running.
      // The same check guards an idle bot whose screen a human took from the page; that takeover
      // ends when the goal takes the computer, below.
      const humanOnScreen = this.blockedKeepAlives.has(botId) ? 'blocked' : this.idleTakeovers.has(botId) ? 'idle' : null
      if (humanOnScreen !== null) {
        const screen = await this.safeWithoutRun(botId, true)
        if (!screen.allowed) {
          // Nothing is released: the blocked hold, or the idle takeover, stays as it was.
          // Looked at again here, after the awaited screen check: the hold can have ended while the
          // check was out, and "its screen is still held for you" must be true when it is sent. A
          // refusal that comes too late sends nothing and sets no mark.
          const stillHeld = humanOnScreen === 'blocked' ? this.blockedKeepAlives.has(botId) : this.idleTakeovers.has(botId)
          if (stillHeld && !this.refusedNotified.has(botId)) {
            this.refusedNotified.add(botId)
            this.callHuman(human, 'refused')
          }
          endedBlocked = true
          const summary = `not started: ${screen.reason}`
          log.warn('run refused: the screen a human is on is not safe yet', { botId, runId, source: input.source, heldFor: humanOnScreen, reason: screen.reason })
          await postChat({ role: 'bot', text: notStartedText(screen.reason, input.routineName) })
          await emit({ type: 'end', outcome: 'blocked', summary })
          return { outcome: 'blocked', summary }
        }
        if (screen.unreadable > 0) log.warn('goal took a screen with unreadable regions on the page', { botId, runId, unreadable: screen.unreadable })
        if (humanOnScreen === 'blocked') {
          this.dropBlockedKeepAlive(botId)
          await this.endOpenTakeoverCard(botId)
        }
      }
      if (this.idleTakeovers.has(botId)) {
        this.endIdleTakeover(botId)
        log.info('takeover of an idle bot ended: a goal took the computer', { botId, runId })
      }
      await setBotState('working', input.source === 'routine' ? `routine: ${input.routineName ?? ''}` : 'working')
      let session
      try {
        session = await sandboxes.ensureRunning(botId)
      } catch (e) {
        if (stopSignal.signal.aborted) return await stopped()
        const name = errorFields(e).errorName
        const helper = e instanceof Error && e.message === 'companion unreachable'
        log.error('could not start the bot computer', { botId, runId, ...errorFields(e) })
        await postChat({
          role: 'bot',
          text: helper ? "I could not start my computer: my computer's helper does not answer. Try again in a minute." : `I could not start my computer (${name}). Try again in a minute.`,
        })
        await setBotState('idle', 'could not start my computer')
        const summary = `could not start my computer: ${helper ? "my computer's helper does not answer" : name}`
        if (stopSignal.signal.aborted) return await stopped()
        await emit({ type: 'end', outcome: 'failed', summary })
        if (stopSignal.signal.aborted) return await stopped()
        return { outcome: 'failed', summary }
      }

      // Hold the computer awake for the whole run, takeovers included.
      const setKeepAlive = this.deps.setKeepAlive ?? ((fn, ms) => setInterval(fn, ms).unref())
      keepAlive = setKeepAlive(() => {
        session.keepAlive().catch((e: unknown) => log.warn('could not hold the computer awake', { botId, runId, ...errorFields(e) }))
      }, KEEPALIVE_MS)

      const rules = await store.readRules(botId)
      const takeover = new TakeoverController({ botId, runId, sandbox: session.sandbox, signal: stopSignal.signal, emit, postChat, updateChat, setBotState, onWaiting: (trigger) => { if (trigger === 'requested' || trigger === 'secret-field') this.callHuman(human, 'takeover') } })
      this.takeovers.set(botId, takeover)
      const ctx: RunContext = {
        botId,
        runId,
        store,
        sandbox: session.sandbox,
        model: this.deps.model,
        modelId: this.deps.modelId,
        tools: this.deps.tools,
        connectors: this.deps.connectors ?? NO_CONNECTORS,
        approvals,
        rules,
        progress: { step: 0 },
        now: () => this.now().getTime(),
        timezone: this.deps.timezone,
        emit,
        postChat,
        updateChat,
        setBotState,
        // A stopped run enters no wait. cancel() wakes the waits that exist when it runs; a wait
        // created after it (the tool's screenshot or the question's chat line came first) checks
        // the signal before it registers, with no await in between.
        waitForUser: () => {
          if (stopSignal.signal.aborted) return Promise.resolve(STOPPED_ANSWER)
          return new Promise<string>((resolve) => {
            const timer = setTimeout(() => {
              this.userWaiters.delete(botId)
              resolve('(no answer within 30 minutes; decide yourself or stop)')
            }, USER_ANSWER_TIMEOUT_MS)
            this.userWaiters.set(botId, { resolve, timer })
            this.callHuman(human, 'question')
          })
        },
        waitForApproval: (approvalId) => {
          if (stopSignal.signal.aborted) {
            approvals.resolve(approvalId, 'denied')
            return approvals.waitFor(approvalId)
          }
          const timer = setTimeout(() => approvals.resolve(approvalId, 'denied'), APPROVAL_TIMEOUT_MS)
          // Only a wait that really starts calls the human: a decision that came in while the card
          // was being written makes waitFor resolve at once.
          const proposed = approvals.get(approvalId)
          if (proposed?.status === 'pending') this.callHuman(human, 'approval', proposed.kind)
          return approvals.waitFor(approvalId).finally(() => clearTimeout(timer))
        },
        takeover: (trigger, reason) => {
          log.info('takeover started', { botId, runId, trigger })
          this.manualRequests.delete(botId)
          return takeover.begin(trigger, reason)
        },
        takeoverRequested: () => this.manualRequests.has(botId),
        cancelRequested: () => stopSignal.signal.aborted,
        cancelSignal: stopSignal.signal,
        reloadRoutines: async () => {
          await this.deps.reloadRoutines?.(botId)
        },
      }

      const result = await runLoop(ctx, input)
      endedBlocked = result.outcome === 'stuck' || result.outcome === 'budget'
      if (endedBlocked) this.callHuman(human, 'blocked')
      if (!endedBlocked) {
        // The loop has closed the run with its result. A state write that fails here must not turn
        // that result into `failed`: an event source would start a finished job a second time.
        try {
          const current = await store.readBot(botId)
          if (current.state !== 'idle') await setBotState('idle', result.summary)
        } catch (e) {
          log.error('the run ended, but the bot state could not be set to idle', { botId, runId, ...errorFields(e) })
        }
      }
      if (stopSignal.signal.aborted && (result.outcome === 'failed' || result.outcome === 'unknown')) return await stopped()
      return result
    } catch (e) {
      // runLoop has its own catch-all; this covers the plumbing around it.
      if (stopSignal.signal.aborted) return await stopped()
      log.error('run plumbing failed', { botId, runId, ...errorFields(e) })
      // The loop's own rule, for a failure that escaped it: a run in which the user denied an
      // action does not end as failed, so the event that started it is not tried again.
      const afterDeny = approvals.deniedFor(runId)
      const outcome = afterDeny ? 'denied' : 'failed'
      const summary = afterDeny ? deniedSummary(errorFields(e).errorName) : errorFields(e).errorName
      await emit({ type: 'end', outcome, summary }).catch(() => undefined)
      await setBotState('idle', 'stopped').catch(() => undefined)
      if (stopSignal.signal.aborted) return await stopped()
      return { outcome, summary }
    } finally {
      if (keepAlive !== null) {
        // A blocked run keeps refreshing the computer's timeout until the human hands back, a new run
        // starts, or the hold ends with nobody on the screen; otherwise E2B pauses it on its own clock
        // under the takeover card.
        if (endedBlocked) {
          this.refusedNotified.delete(botId)
          this.blockedKeepAlives.set(botId, keepAlive)
          this.armBlockedHold(botId)
        } else this.clearKeepAlive(keepAlive)
      }
      this.activeRuns.delete(botId)
      this.takeovers.delete(botId)
      this.manualRequests.delete(botId)
      this.stopSignals.delete(botId)
      const waiter = this.userWaiters.get(botId)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.userWaiters.delete(botId)
      }
      if (!endedBlocked) sandboxes.release(botId)
    }
  }
}
