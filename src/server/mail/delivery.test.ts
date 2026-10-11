import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunResult } from '../agent/run'
import { Scheduler } from '../scheduler/scheduler'
import { createStore, type RunOutcome } from '../store'
import { fileWatermark } from './watermark'
import { MAIL_DEBOUNCE_MS, MAIL_EVENT, MailWatcher } from './watcher'

const roots: string[] = []
const schedulers: Scheduler[] = []

afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop(0)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

type Result = RunOutcome | 'throws' | 'undefined'

async function setup(results: Result[] | Record<string, Result[]>) {
  const root = await mkdtemp(join(tmpdir(), 'dobot-mail-delivery-'))
  roots.push(root)
  const store = createStore(join(root, 'bots'))
  const bot = await store.createBot({ name: 'Reader', persona: 'Read the incoming mail.' })
  const routine = { name: 'on-mail', skill: 'read-mail', schedule: null, event: MAIL_EVENT, enabled: true, body: 'Read the mail.' }
  await store.writeSkill(bot.id, { name: 'read-mail', description: 'Read mail', body: 'Read the mail.' })
  await store.writeRoutine(bot.id, routine)
  let calls = 0
  const runCounts = new Map<string, number>()
  let clock = 0
  let reading = { unseen: 0, uidNext: 5, uidValidity: '1' }
  const makeScheduler = () => new Scheduler({
    store, timezone: 'Europe/Prague', now: () => new Date(clock),
    enqueueRun: async (_botId, input) => {
      const name = input.routineName
      if (name === undefined) throw new Error('routine input is missing its name')
      const index = runCounts.get(name) ?? 0
      runCounts.set(name, index + 1)
      const script = Array.isArray(results) ? results : results[name] ?? []
      const position = Array.isArray(results) ? calls : index
      calls++
      const result = script[Math.min(position, script.length - 1)]
      if (result === 'throws') throw new Error('run could not start')
      if (result === 'undefined' || result === undefined) return undefined
      return { outcome: result, summary: result === 'failed' ? 'computer could not start' : result }
    },
  })
  let scheduler = makeScheduler()
  schedulers.push(scheduler)
  await scheduler.reload(bot.id)
  const watermark = fileWatermark(join(root, 'mail-watermark.json'))
  // Each watcher loads the real file, as it would after a server restart.
  const restart = () => new MailWatcher({ mailbox: { read: async () => reading }, watermark,
    now: () => clock, onMail: (cursor) => scheduler.fireEvent(MAIL_EVENT, cursor) })
  const watcher = restart()
  await watcher.tick()
  return { store, bot, routine, get scheduler() { return scheduler }, watcher, restart, watermark,
    calls: () => calls, runCounts: () => Object.fromEntries(runCounts),
    arrive: () => { reading = { unseen: 1, uidNext: 6, uidValidity: '1' }; clock = 60_000 },
    retryTime: () => { clock = 60_000 + MAIL_DEBOUNCE_MS },
    restartScheduler: async () => {
      await scheduler.stop()
      scheduler = makeScheduler()
      schedulers.push(scheduler)
      await scheduler.reload(bot.id)
    } }
}

describe('mail delivery through the scheduler', () => {
  it.each(['failed', 'unknown', 'throws', 'undefined'] as const)('retries a %s run after the debounce and only then acknowledges it', async (failure) => {
    const f = await setup([failure, 'done'])
    f.arrive()
    await f.watcher.tick()
    expect((await f.watermark.read())?.uidNext).toBe(5)
    await f.watcher.tick()
    expect(f.calls()).toBe(1)
    f.retryTime()
    await f.watcher.tick()
    expect(f.calls()).toBe(2)
    expect((await f.watermark.read())?.uidNext).toBe(6)
    await f.restart().tick()
    expect(f.calls()).toBe(2)
  })

  it.each(['failed', 'throws', 'undefined'] as const)('keeps a %s delivery pending across a restart', async (failure) => {
    const f = await setup([failure, 'done'])
    f.arrive()
    await f.watcher.tick()
    await f.restart().tick()
    expect(f.calls()).toBe(2)
    expect((await f.watermark.read())?.uidNext).toBe(6)
  })

  it.each(['done', 'cancelled', 'denied', 'blocked', 'stuck', 'budget'] as const)('acknowledges %s without an automatic repeat or a restart repeat', async (outcome) => {
    const f = await setup([outcome])
    f.arrive()
    await f.watcher.tick()
    expect((await f.watermark.read())?.uidNext).toBe(6)
    f.retryTime()
    await f.watcher.tick()
    await f.restart().tick()
    expect(f.calls()).toBe(1)
  })

  it('keeps mail pending when the skill is missing, then delivers after it is restored', async () => {
    const f = await setup(['done'])
    await unlink(join(f.store.botDir(f.bot.id), 'skills', 'read-mail.md'))
    f.arrive()
    await f.watcher.tick()
    expect(f.calls()).toBe(0)
    expect((await f.watermark.read())?.uidNext).toBe(5)
    await f.store.writeSkill(f.bot.id, { name: 'read-mail', description: 'Read mail', body: 'Read mail.' })
    f.retryTime()
    await f.watcher.tick()
    expect(f.calls()).toBe(1)
    expect((await f.watermark.read())?.uidNext).toBe(6)
  })

  it('keeps mail pending when its routine cannot be read', async () => {
    const f = await setup(['done'])
    vi.spyOn(f.store, 'readRoutine').mockRejectedValueOnce(new Error('temporary read error'))
    f.arrive()
    await f.watcher.tick()
    expect((await f.watermark.read())?.uidNext).toBe(5)
    f.retryTime()
    await f.watcher.tick()
    expect(f.calls()).toBe(1)
  })

  it('does not leave delivery pending after the routine was explicitly disabled', async () => {
    const f = await setup(['done'])
    await f.store.writeRoutine(f.bot.id, { ...f.routine, enabled: false })
    f.arrive()
    await f.watcher.tick()
    expect(f.calls()).toBe(0)
    expect((await f.watermark.read())?.uidNext).toBe(6)
  })

  it('retries a malformed armed routine after its file is repaired', async () => {
    const f = await setup(['done'])
    await writeFile(join(f.store.botDir(f.bot.id), 'routines', 'on-mail.md'), '---\nenabled: perhaps\n---\nRead mail.')
    f.arrive()
    await f.watcher.tick()
    expect((await f.watermark.read())?.uidNext).toBe(5)
    await f.store.writeRoutine(f.bot.id, f.routine)
    f.retryTime()
    await f.watcher.tick()
    expect(f.calls()).toBe(1)
    expect((await f.watermark.read())?.uidNext).toBe(6)
  })

  it('consumes an event for an explicitly deleted routine', async () => {
    const f = await setup(['done'])
    await unlink(join(f.store.botDir(f.bot.id), 'routines', 'on-mail.md'))
    f.arrive()
    await f.watcher.tick()
    expect(f.calls()).toBe(0)
    expect((await f.watermark.read())?.uidNext).toBe(6)
  })

  it('waits for an existing run and preserves its failed delivery', async () => {
    const f = await setup(['done'])
    const started = Promise.withResolvers<void>()
    const run = Promise.withResolvers<RunResult>()
    let calls = 0
    const scheduler = new Scheduler({ store: f.store, timezone: 'Europe/Prague', now: () => new Date(0),
      enqueueRun: () => { calls++; started.resolve(); return run.promise } })
    schedulers.push(scheduler)
    await scheduler.reload(f.bot.id)
    const first = scheduler.fireEvent(MAIL_EVENT)
    await started.promise
    const second = scheduler.fireEvent(MAIL_EVENT)
    let settled = false
    void second.then(() => { settled = true })
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      run.resolve({ outcome: 'failed', summary: 'computer could not start' })
      expect(await Promise.all([first, second])).toEqual([false, false])
      expect(calls).toBe(1)
    } finally {
      run.resolve({ outcome: 'cancelled', summary: 'test cleanup' })
      await Promise.all([first, second])
    }
  })

  it.each(['done', 'cancelled', 'denied', 'blocked', 'stuck', 'budget'] as const)('retries only the failed listener after another returned %s, including after restart', async (outcome) => {
    const f = await setup({ 'on-mail': [outcome], 'on-mail-too': ['failed', 'failed', 'done'] })
    await f.store.writeRoutine(f.bot.id, { ...f.routine, name: 'on-mail-too' })
    await f.scheduler.reload(f.bot.id)
    f.arrive()
    await f.watcher.tick()
    expect(f.calls()).toBe(2)
    expect(f.runCounts()).toEqual({ 'on-mail': 1, 'on-mail-too': 1 })
    expect((await f.watermark.read())?.uidNext).toBe(5)
    f.retryTime()
    await f.watcher.tick()
    expect(f.calls()).toBe(3)
    expect(f.runCounts()).toEqual({ 'on-mail': 1, 'on-mail-too': 2 })
    expect((await f.watermark.read())?.uidNext).toBe(5)
    await f.restartScheduler()
    await f.restart().tick()
    expect(f.calls()).toBe(4)
    expect(f.runCounts()).toEqual({ 'on-mail': 1, 'on-mail-too': 3 })
    expect((await f.watermark.read())?.uidNext).toBe(6)
  })

  it('preserves receipts after inbox cleanup but runs for a newer position or a new generation', async () => {
    const f = await setup(['cancelled'])
    f.arrive()
    await f.watcher.tick()
    await f.restartScheduler()
    // A fresh scheduler reads the saved receipt even when cleanup lowered the source's position.
    expect(await f.scheduler.fireEvent(MAIL_EVENT, { generation: '1', position: 6 })).toBe(true)
    expect(await f.scheduler.fireEvent(MAIL_EVENT, { generation: '1', position: 2 })).toBe(true)
    expect(f.calls()).toBe(1)
    expect(await f.scheduler.fireEvent(MAIL_EVENT, { generation: '1', position: 7 })).toBe(true)
    expect(f.calls()).toBe(2)
    expect(await f.scheduler.fireEvent(MAIL_EVENT, { generation: '2', position: 2 })).toBe(true)
    expect(f.calls()).toBe(3)
  })

  it('leaves delivery pending when a receipt cannot be saved', async () => {
    const f = await setup(['done'])
    vi.spyOn(f.store, 'writeRoutineReceipt').mockRejectedValueOnce(new Error('disk unavailable'))
    f.arrive()
    await f.watcher.tick()
    expect((await f.watermark.read())?.uidNext).toBe(5)
    await f.restartScheduler()
    await f.restart().tick()
    expect(f.calls()).toBe(2)
    expect((await f.watermark.read())?.uidNext).toBe(6)
  })

  it.each(['cancelled', 'denied'] as const)('retries a failed receipt write without repeating a %s listener', async (outcome) => {
    const f = await setup([outcome])
    vi.spyOn(f.store, 'writeRoutineReceipt').mockRejectedValueOnce(new Error('disk unavailable'))
    f.arrive()
    await f.watcher.tick()
    expect((await f.watermark.read())?.uidNext).toBe(5)
    f.retryTime()
    await f.watcher.tick()
    expect(f.calls()).toBe(1)
    expect((await f.watermark.read())?.uidNext).toBe(6)
    await f.restartScheduler()
    await f.restart().tick()
    expect(f.calls()).toBe(1)
  })
})
