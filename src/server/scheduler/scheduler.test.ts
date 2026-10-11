import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunInput, RunResult } from '../agent/run'
import { createStore, type Store } from '../store'
import { MAX_FAILED_RUNS, Scheduler } from './scheduler'

// 11 September 2026 is a Friday. Times below are Europe/Prague (CEST, UTC+2).
const FRIDAY_0600 = new Date('2026-09-11T04:00:00.000Z')
const FRIDAY_0700_ISO = '2026-09-11T05:00:00.000Z'
const MONDAY_0700_ISO = '2026-09-14T05:00:00.000Z'

let dataDir: string
let store: Store
let botId: string
let runs: RunInput[]
let clock: Date
/** When set, enqueueRun stays pending until the test resolves it (a run in flight). */
let holdRun: { resolve: () => void } | null = null
let summary = ''
/** What the next runs return; null stands for the plain `done` result. */
let outcome: RunResult | 'throws' | null = null

function scheduler(now: Date): Scheduler {
  clock = now
  vi.setSystemTime(now)
  return new Scheduler({
    store,
    enqueueRun: async (_botId, input) => {
      runs.push(input)
      if (holdRun) await new Promise<void>((resolve) => (holdRun = { resolve }))
      if (outcome === 'throws') throw new Error('the run could not start')
      return outcome ?? { outcome: 'done', summary }
    },
    now: () => clock,
    timezone: 'Europe/Prague',
  })
}

beforeEach(async () => {
  summary = 'checked 1 source, 1 new\nmore detail'
  vi.useFakeTimers()
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-scheduler-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Worker', persona: 'Works.' })).id
  await store.writeSkill(botId, { name: 'search-board', description: 'Search', body: 'Open the board.\n' })
  runs = []
  outcome = null
  holdRun = null
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(dataDir, { recursive: true, force: true })
})

const morning = { name: 'morning', skill: 'search-board', schedule: '0 7 * * 1-5', event: null, enabled: true, body: 'Search the board.\n' }

describe('Scheduler', () => {
  it('arms a weekday routine and persists the next run in bot.json', async () => {
    await store.writeRoutine(botId, morning)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    expect((await store.readBot(botId)).routines.morning).toEqual({ nextRunAt: FRIDAY_0700_ISO, lastRunAt: null, lastResult: null })
    expect(runs).toEqual([])
    await s.stop()
  })

  it('starts a run missed by less than 12 hours once, even across a second reload', async () => {
    await store.writeRoutine(botId, morning)
    const first = scheduler(FRIDAY_0600)
    await first.reload(botId)
    await first.stop()
    // the process restarts at 07:30, half an hour after the planned run
    const second = scheduler(new Date('2026-09-11T05:30:00.000Z'))
    await second.reload(botId)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    expect(runs).toEqual([{ goal: 'Search the board.\n', activeSkill: expect.objectContaining({ name: 'search-board' }), source: 'routine', routineName: 'morning' }])
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.nextRunAt).toBe(MONDAY_0700_ISO))
    await second.reload(botId)
    await vi.advanceTimersByTimeAsync(50)
    expect(runs).toHaveLength(1)
    await second.stop()
  })

  it('skips a run missed by more than 12 hours and moves the next run to the next weekday', async () => {
    await store.writeRoutine(botId, morning)
    const first = scheduler(FRIDAY_0600)
    await first.reload(botId)
    await first.stop()
    const second = scheduler(new Date('2026-09-12T18:00:00.000Z')) // Saturday 20:00, 37 h late
    await second.reload(botId)
    await vi.advanceTimersByTimeAsync(50)
    expect(runs).toEqual([])
    expect((await store.readBot(botId)).routines.morning?.nextRunAt).toBe(MONDAY_0700_ISO)
    await second.stop()
  })

  it('gives no next-run time and no timer to a disabled routine or an event routine', async () => {
    await store.writeRoutine(botId, { ...morning, enabled: false })
    await store.writeRoutine(botId, { name: 'on-mail', skill: 'search-board', schedule: null, event: 'mail', enabled: true, body: 'Read it.\n' })
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    const bot = await store.readBot(botId)
    expect(bot.routines.morning?.nextRunAt).toBeNull()
    expect(bot.routines['on-mail']?.nextRunAt).toBeNull()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(runs).toEqual([])
    await s.stop()
  })

  const onMail = { name: 'on-mail', skill: 'search-board', schedule: null, event: 'mail-arrived', enabled: true, body: 'Read the new mail.\n' }

  it('fireEvent runs the routine listening to that event', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    expect(await s.fireEvent('mail-arrived')).toBe(true)
    expect(runs).toEqual([{ goal: 'Read the new mail.\n', activeSkill: expect.objectContaining({ name: 'search-board' }), source: 'routine', routineName: 'on-mail' }])
    await s.stop()
  })

  it('a failed run hands the event back for another try, but only MAX_FAILED_RUNS times in a row', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    outcome = { outcome: 'failed', summary: 'APIConnectionTimeoutError' }
    const cursor = { generation: '1', position: 8 }
    const answers: boolean[] = []
    for (let i = 0; i < MAX_FAILED_RUNS; i++) answers.push(await s.fireEvent('mail-arrived', cursor))
    expect(answers).toEqual([false, false, true])
    expect(runs).toHaveLength(MAX_FAILED_RUNS)
    expect((await store.readBot(botId)).routines['on-mail']?.lastResult).toContain('not tried again')
    // The acknowledged event left a receipt: the same mail does not start a fourth run.
    expect(await s.fireEvent('mail-arrived', cursor)).toBe(true)
    expect(runs).toHaveLength(MAX_FAILED_RUNS)
    await s.stop()
  })

  it('an event for a routine whose skill is missing is handed back the same number of times, with no run', async () => {
    await store.writeRoutine(botId, onMail)
    await rm(join(dataDir, botId, 'skills', 'search-board.md'))
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    const answers: boolean[] = []
    for (let i = 0; i < MAX_FAILED_RUNS; i++) answers.push(await s.fireEvent('mail-arrived'))
    expect(answers).toEqual([false, false, true])
    expect(runs).toEqual([])
    await s.stop()
  })

  it('a run that throws before it starts counts as a failed run', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    outcome = 'throws'
    const answers: boolean[] = []
    for (let i = 0; i < MAX_FAILED_RUNS; i++) answers.push(await s.fireEvent('mail-arrived'))
    expect(answers).toEqual([false, false, true])
    await s.stop()
  })

  it('arms a routine whose name is a member every object inherits', async () => {
    await store.writeRoutine(botId, { ...onMail, name: 'constructor' })
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    expect(await s.fireEvent('mail-arrived')).toBe(true)
    expect(runs).toHaveLength(1)
    expect((await store.readBot(botId)).routines['constructor']?.lastResult).toBe('checked 1 source, 1 new')
    await s.stop()
  })

  it('a run that succeeds clears the count of failures', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    outcome = { outcome: 'failed', summary: 'x' }
    expect(await s.fireEvent('mail-arrived')).toBe(false)
    expect(await s.fireEvent('mail-arrived')).toBe(false)
    outcome = null
    expect(await s.fireEvent('mail-arrived')).toBe(true)
    outcome = { outcome: 'failed', summary: 'x' }
    expect(await s.fireEvent('mail-arrived')).toBe(false)
    await s.stop()
  })

  it('a failure that the same goal would meet again is acknowledged at once', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    outcome = { outcome: 'failed', summary: 'the model provider refused the request', final: true }
    expect(await s.fireEvent('mail-arrived', { generation: '1', position: 8 })).toBe(true)
    expect(runs).toHaveLength(1)
    await s.stop()
  })

  it('two routines that record at the same moment both keep their result', async () => {
    await store.writeRoutine(botId, onMail)
    await store.writeRoutine(botId, { ...onMail, name: 'on-mail-too' })
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    expect(await s.fireEvent('mail-arrived')).toBe(true)
    const { routines } = await store.readBot(botId)
    expect(routines['on-mail']?.lastResult).toBe('checked 1 source, 1 new')
    expect(routines['on-mail-too']?.lastResult).toBe('checked 1 source, 1 new')
    await s.stop()
  })

  it('fireEvent runs nothing for an event no routine listens to', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    expect(await s.fireEvent('calendar-changed')).toBe(true)
    expect(runs).toEqual([])
    await s.stop()
  })

  it('fireEvent does not run a disabled event routine', async () => {
    await store.writeRoutine(botId, { ...onMail, enabled: false })
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    expect(await s.fireEvent('mail-arrived')).toBe(true)
    expect(runs).toEqual([])
    await s.stop()
  })

  // A routine save re-arms the bot from disk, and reading the disk takes time. An event with no
  // listener is acknowledged, so its source marks it as delivered: an event that arrives during
  // those reads must still find the listener that was armed before them.
  it('an event that arrives while a reload reads the disk still reaches the routine', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    const reloading = s.reload(botId)
    const fired = s.fireEvent('mail-arrived', { generation: '1', position: 8 })
    await reloading
    expect(await fired).toBe(true)
    expect(runs).toHaveLength(1)
    expect(await store.readRoutineReceipt(botId, 'on-mail')).toEqual({ event: 'mail-arrived', cursor: { generation: '1', position: 8 } })
    await s.stop()
  })

  // Two saves in a row start two reloads. Each one stops the timers that the other armed, so no
  // timer is left running outside the scheduler's own list, where stop() could not reach it.
  it('two reloads at the same moment leave one timer per routine', async () => {
    await store.writeRoutine(botId, morning)
    const s = scheduler(FRIDAY_0600)
    await Promise.all([s.reload(botId), s.reload(botId)])
    await s.stop()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(runs).toEqual([])
  })

  it('two saves close together end on the newer schedule: the second reload reads the files after the first has armed', async () => {
    await store.writeRoutine(botId, morning)
    const s = scheduler(FRIDAY_0600)
    const first = s.reload(botId)
    await store.writeRoutine(botId, { ...morning, schedule: '0 9 * * 1-5' })
    await Promise.all([first, s.reload(botId)])
    expect((await store.readBot(botId)).routines['morning']?.nextRunAt).toBe(new Date('2026-09-11T09:00:00+02:00').toISOString())
    await s.stop()
  })

  it('a reload that is still reading when stop() runs arms nothing', async () => {
    await store.writeRoutine(botId, morning)
    const s = scheduler(FRIDAY_0600)
    const reloading = s.reload(botId)
    await s.stop()
    await reloading
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(runs).toEqual([])
  })

  // Mail keeps arriving while the bot is still reading the last one: a second event must not
  // start a second run on the same bot.
  it('fireEvent does not start a second run while the first is still in flight', async () => {
    await store.writeRoutine(botId, onMail)
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    holdRun = { resolve: () => undefined }
    const first = s.fireEvent('mail-arrived')
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    const second = s.fireEvent('mail-arrived')
    expect(runs).toHaveLength(1)
    holdRun?.resolve()
    holdRun = null
    expect(await Promise.all([first, second])).toEqual([true, true])
    await s.stop()
  })

  it('records the result and the status line after a fired run completes', async () => {
    await store.writeRoutine(botId, morning)
    const s = scheduler(new Date('2026-09-11T04:59:59.000Z'))
    await s.reload(botId)
    clock = new Date('2026-09-11T05:00:01.000Z')
    await vi.advanceTimersByTimeAsync(2_000)
    // the timer fired inside the fake clock; the run's bookkeeping does real file I/O
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    await vi.waitFor(async () => expect((await store.readBot(botId)).statusLine).toBe('routine: morning — checked 1 source, 1 new'))
    expect((await store.readBot(botId)).routines.morning).toEqual({ nextRunAt: MONDAY_0700_ISO, lastRunAt: '2026-09-11T05:00:01.000Z', lastResult: 'checked 1 source, 1 new' })
    await s.stop()
  })

  // The status line is the summary behind a prefix, so a long summary takes it past 200 characters.
  // Without the cut, the whole update fails, lastRunAt and nextRunAt included.
  it('records the run even when its summary fills the whole status line', async () => {
    summary = 's'.repeat(200)
    await store.writeRoutine(botId, morning)
    const s = scheduler(new Date('2026-09-11T04:59:59.000Z'))
    await s.reload(botId)
    clock = new Date('2026-09-11T05:00:01.000Z')
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.lastRunAt).toBe('2026-09-11T05:00:01.000Z'))
    const bot = await store.readBot(botId)
    expect(bot.statusLine.length).toBeLessThanOrEqual(200)
    expect(bot.statusLine.startsWith('routine: morning — sss')).toBe(true)
    await s.stop()
  })

  it('stop() waits for a run in flight to record its result', async () => {
    await store.writeRoutine(botId, morning)
    holdRun = { resolve: () => undefined }
    const s = scheduler(new Date('2026-09-11T05:30:00.000Z'))
    await store.updateBot(botId, { routines: { morning: { nextRunAt: FRIDAY_0700_ISO, lastRunAt: null, lastResult: null } } })
    await s.reload(botId) // 30 minutes late → the missed run starts and stays in flight
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    let stopped = false
    const stopping = s.stop().then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(stopped).toBe(false) // the run is still held, so stop() is still waiting
    holdRun?.resolve()
    holdRun = null
    await stopping
    // no waitFor here on purpose: the result must already be on disk when stop() resolves.
    // nextRunAt is left out: stop() kills the cron job before this run's bookkeeping reads
    // job.nextRun(), so croner returns null and the code keeps whatever was on disk at that instant.
    expect((await store.readBot(botId)).routines.morning).toMatchObject({ lastRunAt: '2026-09-11T05:30:00.000Z', lastResult: 'checked 1 source, 1 new' })
  })

  it('stop() gives up after the grace period when a run stays in flight, and says so', async () => {
    await store.writeRoutine(botId, morning)
    holdRun = { resolve: () => undefined }
    const s = scheduler(new Date('2026-09-11T05:30:00.000Z'))
    await store.updateBot(botId, { routines: { morning: { nextRunAt: FRIDAY_0700_ISO, lastRunAt: null, lastResult: null } } })
    await s.reload(botId)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    let stopped = false
    const stopping = s.stop(1_000).then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await stopping
    expect(stopped).toBe(true)
    expect((await store.readBot(botId)).routines.morning?.lastRunAt).toBeNull() // the held run never recorded anything
    holdRun?.resolve() // let the held run finish so the teardown does not race its write
    holdRun = null
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.lastResult).toBe('checked 1 source, 1 new'))
  })

  // A routine is its skill's schedule: without the skill it would be a paid run with one line of
  // instructions.
  it('does not run a routine whose skill is missing, and says so in its state and the status line', async () => {
    await store.writeRoutine(botId, morning)
    await rm(join(store.botDir(botId), 'skills', 'search-board.md'))
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    await store.updateBot(botId, { routines: { morning: { nextRunAt: '2026-09-11T03:00:00.000Z', lastRunAt: null, lastResult: null } } })
    await s.reload(botId) // one hour late → the missed run would start
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.lastResult).toBe('skill search-board is missing; the routine did not run'))
    expect(runs).toHaveLength(0)
    expect((await store.readBot(botId)).statusLine).toBe('routine: morning — skill search-board is missing; the routine did not run')
    await s.stop()
  })

  // If nextRunAt moved only after the run, a crash mid-run would leave the planned time behind, and
  // the next boot would fire the routine again as "missed".
  it('consumes the occurrence when the run starts: a restart mid-run does not fire it again as missed', async () => {
    await store.writeRoutine(botId, morning)
    holdRun = { resolve: () => undefined }
    const s = scheduler(new Date('2026-09-11T04:59:59.000Z'))
    await s.reload(botId)
    clock = new Date('2026-09-11T05:00:01.000Z')
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    // The run is in flight and the process dies here: what bot.json holds is what the next boot sees.
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.nextRunAt).toBe(MONDAY_0700_ISO))
    const next = scheduler(new Date('2026-09-11T05:10:00.000Z'))
    await next.reload(botId)
    await vi.advanceTimersByTimeAsync(50)
    expect(runs).toHaveLength(1)
    holdRun?.resolve()
    holdRun = null
    await s.stop()
    await next.stop()
  })

  it('a reload while the routine is running does not fire it a second time', async () => {
    await store.writeRoutine(botId, morning)
    holdRun = { resolve: () => undefined }
    const s = scheduler(new Date('2026-09-11T05:30:00.000Z'))
    await store.updateBot(botId, { routines: { morning: { nextRunAt: FRIDAY_0700_ISO, lastRunAt: null, lastResult: null } } })
    await s.reload(botId) // 30 minutes late → the missed run starts and stays in flight
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    await s.reload(botId) // nextRunAt still reads as the missed time while the run is in flight
    await vi.advanceTimersByTimeAsync(50)
    expect(runs).toHaveLength(1)
    holdRun?.resolve()
    holdRun = null
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.lastResult).toBe('checked 1 source, 1 new'))
    await s.stop()
  })
})
