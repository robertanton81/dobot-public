import { RateLimitError } from '@e2b/desktop'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTransport, type Transporter } from 'nodemailer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BotEvents } from '../bot-events'
import { log } from '../log'
import { NOTICE_UNCONFIRMED_TEXT, noticeBody, SmtpNotifier, type Notice, type NoticeOutcome, type NotifierPort } from '../mail/notifier'
import { fileWatermark } from '../mail/watermark'
import { MAIL_DEBOUNCE_MS, MAIL_EVENT, MailWatcher } from '../mail/watcher'
import { GRACE_MS, SandboxManager, type SessionFactory } from '../sandbox/manager'
import { Scheduler } from '../scheduler/scheduler'
import { createStore, type Store } from '../store'
import { rulesFile } from '../store/paths'
import { computerUse, ELEMENT_TEXT_INPUT, FakeModel, FakeSandbox, message, seedRun, solidPng, textBlock, toolUse } from './fakes'
import { Approvals } from './gate'
import { RunQueue } from './queue'
import { STOPPED_TEXT } from './run-text'
import { HOLD_PRESENCE_MS, holdEndedText, notStartedText, Runner } from './runner'
import { UNANSWERED_REASON, UNREADABLE_REASON, UNSAFE_REASON } from './takeover'
import type { ToolDef } from './run-context'
import { basePlatformTools } from './tools'

const LIMITS = { dailyBudgetUsd: 25, timezone: 'Europe/Prague', blockedHoldMs: 30 * 60_000 }

let dataDir: string
let store: Store
let botId: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-runner-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Worker', persona: 'Works.' })).id
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function runnerWith(factory: SessionFactory, model: FakeModel, tools: ToolDef[] = [], now?: () => Date, events = new BotEvents(), extra: { notifier?: NotifierPort; approvals?: Approvals; store?: Store } = {}): Runner {
  const used = extra.store ?? store
  const sandboxes = new SandboxManager(used, events, { py: '', js: '' }, LIMITS.timezone, { factory })
  return new Runner({ store: used, events, approvals: extra.approvals ?? new Approvals(), queue: new RunQueue(), sandboxes, model, modelId: 'claude-sonnet-5', tools, ...LIMITS, ...(now ? { now } : {}), ...(extra.notifier ? { notifier: extra.notifier } : {}) })
}

/** A factory whose computer is a FakeSandbox, so a run can get stuck and the page state can be scripted. */
function fakeFactory(sandbox: FakeSandbox): SessionFactory {
  const session = { sandbox, sandboxId: 'sbx-1', streamViewUrl: 'https://v.example/view', streamInteractiveUrl: 'https://v.example/full', keepAlive: async () => undefined, pause: async () => 'paused' as const, syncWorkspace: async () => undefined }
  return { create: async () => session, connect: async () => session }
}

/** A factory that counts keepAlive calls, so the run's hold on the computer can be observed. */
function countingFactory(sandbox: FakeSandbox): { factory: SessionFactory; keepAlives: () => number } {
  let n = 0
  const session = {
    sandbox,
    sandboxId: 'sbx-1',
    streamViewUrl: 'https://v.example/view',
    streamInteractiveUrl: 'https://v.example/full',
    keepAlive: async () => {
      n += 1
    },
    pause: async () => 'paused' as const,
    syncWorkspace: async () => undefined,
  }
  return { factory: { create: async () => session, connect: async () => session }, keepAlives: () => n }
}

describe('Runner', () => {
  it('closes the run honestly when the computer cannot start, without calling the model', async () => {
    const model = new FakeModel([])
    const runner = runnerWith(
      {
        create: async () => {
          throw new RateLimitError('too many sandboxes')
        },
        connect: async () => {
          throw new Error('not used')
        },
      },
      model,
    )

    await runner.enqueue(botId, { goal: 'search the board', activeSkill: null, source: 'message' })

    const runs = await store.listOpenRuns(botId)
    expect(runs).toEqual([])
    const [runId] = (await import('node:fs/promises').then((fs) => fs.readdir(join(dataDir, botId, 'runs')))) as string[]
    const events = await store.readRunEvents(botId, runId ?? '')
    expect(events.at(-1)).toMatchObject({ type: 'end', outcome: 'failed', summary: 'could not start my computer: RateLimitError' })
    const chat = await store.readChat(botId, { limit: 10 })
    expect(chat.map((m) => m.text ?? m.card?.card)).toEqual(['status', expect.stringMatching(/^I could not start my computer \(RateLimitError\)/)])
    expect((await store.readBot(botId)).state).toBe('idle')
    expect(model.calls).toHaveLength(0)
  })

  it('an answer longer than one chat message ends the run as done, and the chat holds all of it', async () => {
    const report = 'one line of a long report\n'.repeat(1800).trimEnd()
    const { factory } = countingFactory(new FakeSandbox())
    const runner = runnerWith(factory, new FakeModel([message([textBlock(report)], 'end_turn')]))

    const result = await runner.enqueue(botId, { goal: 'write the report', activeSkill: null, source: 'message' })

    expect(result?.outcome).toBe('done')
    const texts = (await store.readChat(botId, { limit: 10 })).filter((m) => m.role === 'bot').map((m) => m.text ?? '')
    expect(texts.length).toBeGreaterThan(1)
    expect(texts.join('')).toBe(report)
  })

  it('a finished run keeps its result when the bot state cannot be written after it', async () => {
    const { factory } = countingFactory(new FakeSandbox())
    const runner = runnerWith(factory, new FakeModel([message([textBlock('All done.')], 'end_turn')]))
    const realUpdate = store.updateBot.bind(store)
    const spy = vi.spyOn(store, 'updateBot').mockImplementation(async (id, patch) => {
      if (typeof patch !== 'function' && patch.state === 'idle') throw new Error('EIO: disk error')
      return realUpdate(id, patch)
    })
    try {
      const result = await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'routine', routineName: 'on-mail' })
      expect(result?.outcome).toBe('done')
    } finally {
      spy.mockRestore()
    }
  })

  it('names the helper when the companion does not answer', async () => {
    const model = new FakeModel([])
    const runner = runnerWith(
      {
        create: async () => {
          throw new Error('companion unreachable')
        },
        connect: async () => {
          throw new Error('not used')
        },
      },
      model,
    )

    await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })

    const chat = await store.readChat(botId, { limit: 10 })
    expect(chat.at(-1)?.text).toMatch(/helper does not answer/)
    expect(model.calls).toHaveLength(0)
  })

  // The reason may hold 300 characters and the status line only 200, so the status text is cut.
  // Without the cut the status write fails, the valid takeover becomes a tool error, and the run
  // goes on without handing the screen over.
  it('a takeover with the longest allowed reason still hands the screen over, and the card keeps the full text', async () => {
    const reason = 'r'.repeat(300)
    const sandbox = new FakeSandbox()
    sandbox.companion.states = [
      { url: 'https://example.com/login', fingerprint: 'a', unsafe: false },
      { url: 'https://example.com/inbox', fingerprint: 'b', unsafe: false },
    ]
    const model = new FakeModel([message([toolUse('request_takeover', { reason })]), message([textBlock('signed in')], 'end_turn')])
    const runner = runnerWith(fakeFactory(sandbox), model, basePlatformTools)

    const result = runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' })
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('blocked'))
    expect((await store.readBot(botId)).statusLine).toHaveLength(200)
    expect(await runner.handback(botId)).toEqual({ ok: true })
    expect((await result)?.outcome).toBe('done')

    const card = (await store.readChat(botId, { limit: 20 })).find((m) => m.card?.card === 'takeover')?.card
    expect(card).toMatchObject({ status: 'ended', reason: expect.stringContaining(reason) })
  })

  // A goal that waits behind another run needs its record on disk at once. If the run folder
  // appeared only when the run started, a restart would find no record of the waiting goal.
  it('the run record exists as soon as a goal is accepted, before its turn on the queue', async () => {
    const model = new FakeModel([
      message([toolUse('ask_user', { question: 'Which company?' })]),
      message([textBlock('first done')], 'end_turn'),
      message([textBlock('second done')], 'end_turn'),
    ])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)

    const first = runner.enqueue(botId, { goal: 'first', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))
    const second = await runner.accept(botId, { goal: 'second', activeSkill: null, source: 'message' })

    expect(await store.readRunEvents(botId, second.runId)).toEqual([expect.objectContaining({ type: 'queued', goal: 'second', source: 'message' })])
    expect(await store.listOpenRuns(botId)).toContain(second.runId)
    expect(runner.answerUser(botId, 'Acme')).toBe(true)
    expect((await first)?.outcome).toBe('done')
    expect((await second.done)?.outcome).toBe('done')
  })
})

describe('hand-back without a run', () => {
  // The page asks for the state every two seconds. On a page with unreadable frames, a warning
  // written at every question would fill the log. The warning belongs to the hand-back, once.
  it('puts unreadable regions on record at the hand-back, not at every state poll', async () => {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const runner = runnerWith(fakeFactory(sandbox), model, [], () => new Date(clock.now))
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
    sandbox.companion.states = [{ url: 'https://example.com/inbox', fingerprint: 'y', unsafe: false, unreadable: 2 }]
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const unreadableWarnings = () => warn.mock.calls.filter(([msg]) => String(msg).includes('unreadable')).length
    try {
      expect(await runner.handbackState(botId)).toEqual({ allowed: true, reason: '' })
      expect(await runner.handbackState(botId)).toEqual({ allowed: true, reason: '' })
      expect(unreadableWarnings()).toBe(0)
      expect(await runner.handback(botId)).toEqual({ ok: true })
      expect(unreadableWarnings()).toBe(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('is a no-op for an idle bot with no computer', async () => {
    const runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([]))
    expect(await runner.handbackState(botId)).toEqual({ allowed: true, reason: '' })
    expect(await runner.handback(botId)).toEqual({ ok: true })
    expect(runner.requestTakeover(botId)).toBe(false)
    expect((await store.readBot(botId)).state).toBe('idle')
  })

  it('after a run ended stuck, hand-back sets the bot idle and closes the takeover card, but not while the page is unsafe or unanswered', async () => {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const runner = runnerWith(fakeFactory(sandbox), model, [], () => new Date(clock.now))
    const result = await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })
    expect(result?.outcome).toBe('stuck')
    expect((await store.readBot(botId)).state).toBe('blocked')

    sandbox.companion.pageStateError = new Error('timeout')
    expect(await runner.handback(botId)).toEqual({ ok: false, reason: UNANSWERED_REASON })
    sandbox.companion.pageStateError = null
    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true }]
    expect(await runner.handbackState(botId)).toEqual({ allowed: false, reason: UNSAFE_REASON })
    expect(await runner.handback(botId)).toEqual({ ok: false, reason: UNSAFE_REASON })
    expect((await store.readBot(botId)).state).toBe('blocked')
    // The focus inside a frame the companion cannot read: the same refusal, with its own reason, and the override does not lift it.
    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true, unsafeReason: 'unreadable-frame' }]
    expect(await runner.handback(botId, true)).toEqual({ ok: false, reason: UNREADABLE_REASON })
    expect((await store.readBot(botId)).state).toBe('blocked')

    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: false }]
    expect(await runner.handback(botId)).toEqual({ ok: true })
    expect((await store.readBot(botId)).state).toBe('idle')
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'ended' })])
  })

  // The takeover card of a stuck run asks the human to act on the screen. Without a hold, the idle
  // pause fires two minutes after the end of the run, with that card still active.
  it('a run that ended stuck keeps its computer up until hand back, which releases it', async () => {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const timers: { fn: () => void; ms: number }[] = []
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, {
      factory: fakeFactory(sandbox),
      setTimer: (fn, ms) => {
        timers.push({ fn, ms })
        return timers.length
      },
      clearTimer: () => undefined,
    })
    const runner = new Runner({ store, events, approvals: new Approvals(), queue: new RunQueue(), sandboxes, model, modelId: 'claude-sonnet-5', tools: [], ...LIMITS, now: () => new Date(clock.now) })

    const result = await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })
    expect(result?.outcome).toBe('stuck')
    // No grace timer was armed by the end of the run: nothing will pause the computer.
    expect(timers).toEqual([])

    sandbox.companion.states = [{ url: 'https://example.com/', fingerprint: 'x', unsafe: false }]
    expect(await runner.handback(botId)).toEqual({ ok: true })
    expect(timers.map((t) => t.ms)).toEqual([GRACE_MS])
    // The session lives until that timer fires; then the computer is paused and the session gone.
    expect(sandboxes.get(botId)).not.toBeNull()
    timers[0]?.fn()
    await vi.waitFor(() => expect(sandboxes.get(botId)).toBeNull())
  })

  // A goal on a blocked bot must pass the check the hand-back makes before it ends the takeover card
  // and starts. Without it a routine could screenshot a code the human left on the screen.
  it('a goal on a blocked bot starts only when the screen passes the hand-back check; a refused goal leaves the bot blocked and the card open', async () => {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(sandbox), model, [], () => new Date(clock.now))
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
    const takeoverCards = async () => (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => (m.card?.card === 'takeover' ? m.card.status : ''))

    // A code field still holds a value: the routine does not start, nothing is screenshotted, no model call.
    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true }]
    const accepted = await runner.accept(botId, { goal: 'check mail', activeSkill: null, source: 'routine', routineName: 'check-mail' })
    expect(await accepted.done).toEqual({ outcome: 'blocked', summary: `not started: ${UNSAFE_REASON}` })
    // The run record is closed honestly and holds nothing else: no status change, no step.
    expect((await store.readRunEvents(botId, accepted.runId)).map((e) => (e.type === 'end' ? `end:${e.outcome}` : e.type))).toEqual(['queued', 'end:blocked'])
    expect((await store.readBot(botId)).state).toBe('blocked')
    expect(await takeoverCards()).toEqual(['active'])
    expect(model.calls).toHaveLength(3)
    expect(sandbox.methods().filter((m) => m === 'screenshot')).toHaveLength(3)
    const chat = await store.readChat(botId, { limit: 20 })
    expect(chat.at(-1)).toMatchObject({ role: 'bot', text: notStartedText(UNSAFE_REASON, 'check-mail') })
    expect(notStartedText(UNSAFE_REASON, 'check-mail')).toBe(`I did not start the routine "check-mail": ${UNSAFE_REASON}. Finish that step on my screen and press Hand back, then send me the goal again.`)

    // A computer that does not answer is not safe either.
    sandbox.companion.pageStateError = new Error('timeout')
    expect(await runner.enqueue(botId, { goal: 'again', activeSkill: null, source: 'message' })).toEqual({ outcome: 'blocked', summary: `not started: ${UNANSWERED_REASON}` })
    expect(notStartedText(UNANSWERED_REASON)).toBe(`I did not start: ${UNANSWERED_REASON}. Try again in a minute.`)
    expect(await takeoverCards()).toEqual(['active'])
    sandbox.companion.pageStateError = null

    // The screen is safe: the goal takes the computer, ends the card and runs.
    sandbox.companion.states = [{ url: 'https://example.com/inbox', fingerprint: 'y', unsafe: false }]
    expect((await runner.enqueue(botId, { goal: 'again', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    expect(await takeoverCards()).toEqual(['ended'])
    expect((await store.readBot(botId)).state).toBe('idle')
  })
})

// A sandbox pauses itself after 20 minutes unless the E2B API is called, and noVNC traffic does
// not count. A takeover makes no API calls at all while it waits for a person, so without this
// the computer pauses while the human is working on its screen.
describe('holding the computer awake', () => {
  it('refreshes the sandbox timeout on a timer while a run is open, and stops when it ends', async () => {
    const sandbox = new FakeSandbox()
    const { factory, keepAlives } = countingFactory(sandbox)
    const model = new FakeModel([message([textBlock('done')], 'end_turn')])
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, { factory })
    const ticks: (() => void)[] = []
    let cleared = 0
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue: new RunQueue(),
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      setKeepAlive: (fn) => {
        ticks.push(fn)
        return ticks.length
      },
      clearKeepAlive: () => {
        cleared += 1
      },
    })

    await runner.enqueue(botId, { goal: 'search the board', activeSkill: null, source: 'message' })

    // The run armed exactly one keep-alive and cleared it when it finished.
    expect(ticks).toHaveLength(1)
    expect(cleared).toBe(1)

    // Firing the timer refreshes the sandbox's own timeout, which is what stops it pausing.
    const before = keepAlives()
    ticks[0]?.()
    await new Promise((r) => setImmediate(r))
    expect(keepAlives()).toBe(before + 1)
  })

  // The takeover card of a blocked run asks the human to act on the screen; the keep-alive must
  // outlive the run, or E2B pauses the computer on its own clock while they are away.
  it('keeps refreshing the timeout after a run ended stuck, until the human hands back', async () => {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const { factory, keepAlives } = countingFactory(sandbox)
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, { factory, setTimer: () => 0, clearTimer: () => undefined })
    const ticks: (() => void)[] = []
    let cleared = 0
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue: new RunQueue(),
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      now: () => new Date(clock.now),
      setKeepAlive: (fn) => {
        ticks.push(fn)
        return ticks.length
      },
      clearKeepAlive: () => {
        cleared += 1
      },
    })

    const result = await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })
    expect(result?.outcome).toBe('stuck')
    expect(cleared).toBe(0)
    const before = keepAlives()
    ticks[0]?.()
    await new Promise((r) => setImmediate(r))
    expect(keepAlives()).toBe(before + 1)

    sandbox.companion.states = [{ url: 'https://example.com/', fingerprint: 'x', unsafe: false }]
    expect(await runner.handback(botId)).toEqual({ ok: true })
    expect(cleared).toBe(1)
  })

  it('a new goal on a blocked bot drops the held keep-alive and ends the open takeover card', async () => {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const { factory } = countingFactory(sandbox)
    const model = new FakeModel([
      message([computerUse('screenshot')]),
      message([computerUse('screenshot')]),
      message([computerUse('screenshot')]),
      message([textBlock('done')], 'end_turn'),
    ])
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, { factory, setTimer: () => 0, clearTimer: () => undefined })
    let cleared = 0
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue: new RunQueue(),
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      now: () => new Date(clock.now),
      setKeepAlive: () => 1,
      clearKeepAlive: () => {
        cleared += 1
      },
    })

    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
    expect(cleared).toBe(0)
    expect((await runner.enqueue(botId, { goal: 'again', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    // The held one and the second run's own.
    expect(cleared).toBe(2)
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'ended' })])
  })
})

// The provider pauses a held computer on its own clock when the keep-alive stops (a laptop that
// slept). Nothing but a new start brings it back, and only a run used to make one.
describe('a held computer that stopped answering', () => {
  it('is brought up once by a hand-back, under the hold that exists, and the hand-back then goes through', async () => {
    const first = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    first.clock = clock
    first.screenshotMs = 20_000
    const second = new FakeSandbox()
    const session = (sandbox: FakeSandbox, keepAlive: () => Promise<void>) => ({ sandbox, sandboxId: 'sbx-1', streamViewUrl: 'https://v.example/view', streamInteractiveUrl: 'https://v.example/full', keepAlive, pause: async () => 'paused' as const, syncWorkspace: async () => undefined })
    let asleep = false
    let connects = 0
    const factory: SessionFactory = {
      create: async () => session(first, async () => { if (asleep) throw new Error('sandbox is paused') }),
      connect: async () => {
        connects += 1
        return session(second, async () => undefined)
      },
    }
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const runner = runnerWith(factory, model, [], () => new Date(clock.now))
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')

    asleep = true
    first.companion.pageStateError = new Error('timeout')
    // The page's poll does not start a computer; the hand-back does, once.
    expect(await runner.handbackState(botId)).toEqual({ allowed: false, reason: UNANSWERED_REASON })
    expect(connects).toBe(0)
    expect(await runner.handback(botId)).toEqual({ ok: true })
    expect(connects).toBe(1)
    expect((await store.readBot(botId)).state).toBe('idle')
  })
})

// A human can be on the held screen of a blocked bot. A goal that the budget refuses must leave
// that screen with them: the hold, the open card and the blocked state.
describe('a goal that the daily budget refuses on a blocked bot', () => {
  it('leaves the hold running, the takeover card open and the bot blocked', async () => {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const { factory } = countingFactory(sandbox)
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, { factory, setTimer: () => 0, clearTimer: () => undefined })
    let cleared = 0
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue: new RunQueue(),
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      now: () => new Date(clock.now),
      setKeepAlive: () => 1,
      clearKeepAlive: () => {
        cleared += 1
      },
    })
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
    // Another bot's runs use up the day's budget while the human works on the held screen.
    const other = (await store.createBot({ name: 'Other', persona: 'Works.' })).id
    await seedRun(store, other, 'run-earlier', '2026-09-13T07:00:00Z', [25.2])

    expect((await runner.enqueue(botId, { goal: 'again', activeSkill: null, source: 'message' }))?.outcome).toBe('budget')

    expect(cleared).toBe(0)
    expect((await store.readBot(botId)).state).toBe('blocked')
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'active' })])
  })
})

// The platform's own spend limit under the organisation's: a bot-written routine or a stranger's
// mail must not be able to spend without end.
describe('the daily budget', () => {
  const NOON_IN_PRAGUE = new Date('2026-09-13T10:00:00Z')

  function runnerAt(factory: SessionFactory, model: FakeModel, dailyBudgetUsd = LIMITS.dailyBudgetUsd): Runner {
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, { factory })
    return new Runner({ store, events, approvals: new Approvals(), queue: new RunQueue(), sandboxes, model, modelId: 'claude-sonnet-5', tools: [], ...LIMITS, dailyBudgetUsd, now: () => NOON_IN_PRAGUE })
  }

  /** A factory that counts every attempt to bring the computer up. */
  function countingStarts(): { factory: SessionFactory; starts: () => number } {
    let n = 0
    const start = async (): Promise<never> => {
      n += 1
      throw new Error('the computer must not start')
    }
    return { factory: { create: start, connect: start }, starts: () => n }
  }

  it("does not start a run once today's runs have cost the budget: a status card, an end event, no computer, no model call", async () => {
    const other = (await store.createBot({ name: 'Other', persona: 'Works.' })).id
    await seedRun(store, other, 'run-earlier', '2026-09-13T07:00:00Z', [25.2])
    const { factory, starts } = countingStarts()
    const model = new FakeModel([])

    const result = await runnerAt(factory, model).enqueue(botId, { goal: 'search the board', activeSkill: null, source: 'routine', routineName: 'morning-search' })

    expect(result).toEqual({ outcome: 'budget', summary: "today's budget of $25 is used up ($25.20 spent)" })
    expect(starts()).toBe(0)
    expect(model.calls).toHaveLength(0)
    const chat = await store.readChat(botId, { limit: 10 })
    expect(chat.map((m) => m.card)).toEqual([{ card: 'status', text: "Today's budget of $25 is used up ($25.20 spent), so I did not start. Runs start again tomorrow." }])
    // Invariant 7: nothing in the chat tells the user to set a variable.
    expect(JSON.stringify(chat)).not.toMatch(/DAILY_BUDGET_USD|\.env/)
    expect((await store.readBot(botId)).state).toBe('idle')
    // Invariant 2: the refusal is a real run record on disk, closed with the outcome, not a hidden skip.
    const runs = await store.listRunCosts(botId)
    expect(runs).toHaveLength(1)
    const events = await store.readRunEvents(botId, runs[0]?.runId ?? '')
    expect(events.at(-1)).toMatchObject({ type: 'end', outcome: 'budget', summary: "today's budget of $25 is used up ($25.20 spent)" })
    expect(runs[0]?.usd).toBe(0)
  })

  it("starts the run while today's spend is under the budget, whatever was spent yesterday", async () => {
    const other = (await store.createBot({ name: 'Other', persona: 'Works.' })).id
    await seedRun(store, other, 'run-today', '2026-09-13T07:00:00Z', [24.99])
    await seedRun(store, other, 'run-yesterday', '2026-09-12T12:00:00Z', [100])
    const model = new FakeModel([message([textBlock('done')], 'end_turn')])

    const result = await runnerAt(fakeFactory(new FakeSandbox()), model).enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })

    expect(result?.outcome).toBe('done')
    expect(model.calls).toHaveLength(1)
  })

  // DAILY_BUDGET_USD=0 is the operator's off switch.
  it('with a budget of zero no run starts at all', async () => {
    const { factory, starts } = countingStarts()
    const result = await runnerAt(factory, new FakeModel([]), 0).enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })
    expect(result).toEqual({ outcome: 'budget', summary: "today's budget of $0 is used up ($0.00 spent)" })
    expect(starts()).toBe(0)
  })
})

// The model has no clock of its own, so every run tells it the date and the time. The run loop's
// own tests prove the clock line; this one proves that the Runner hands the loop its configured
// clock and zone, with a zone that no other test and no default uses.
describe("the run's clock", () => {
  it("the model is told when the run started, on the Runner's clock and in the Runner's time zone", async () => {
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, 'America/New_York', { factory: fakeFactory(new FakeSandbox()) })
    const model = new FakeModel([message([textBlock('done')], 'end_turn')])
    // 02:00 UTC on the 19th is 22:00 on the 18th in New York.
    const runner = new Runner({ store, events, approvals: new Approvals(), queue: new RunQueue(), sandboxes, model, modelId: 'claude-sonnet-5', tools: [], ...LIMITS, timezone: 'America/New_York', now: () => new Date('2026-09-19T02:00:00Z') })

    const result = await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })

    expect(result?.outcome).toBe('done')
    const content = model.calls[0]?.messages[0]?.content
    const first = Array.isArray(content) ? content[0] : undefined
    const text = typeof content === 'string' ? content : first && first.type === 'text' ? first.text : ''
    expect(text).toBe('Platform clock: this run started on Friday, 18 September 2026 at 22:00 (America/New_York).\n\nGoal: x')
  })
})

// A run that ended blocked holds its computer awake for the human. An abandoned hold would have no
// end, so a time limit caps it, but never while a person is on the screen.
describe('the blocked hold', () => {
  const HOLD_MS = LIMITS.blockedHoldMs

  async function stuckRunner(clock: { now: number }) {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    // Three identical screens end the first run stuck; the last message serves a goal sent afterwards.
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([textBlock('done')], 'end_turn')])
    const holds: { fn: () => void; ms: number }[] = []
    const graces: number[] = []
    let keepAlivesCleared = 0
    let holdsCleared = 0
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, {
      factory: fakeFactory(sandbox),
      setTimer: (_fn, ms) => {
        graces.push(ms)
        return graces.length
      },
      clearTimer: () => undefined,
    })
    const queue = new RunQueue()
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue,
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      now: () => new Date(clock.now),
      setKeepAlive: () => 1,
      clearKeepAlive: () => {
        keepAlivesCleared += 1
      },
      setHoldTimer: (fn, ms) => {
        holds.push({ fn, ms })
        return holds.length
      },
      clearHoldTimer: () => {
        holdsCleared += 1
      },
    })
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
    sandbox.companion.states = [{ url: 'https://example.com/', fingerprint: 'x', unsafe: false }]
    return { runner, queue, holds, graces, keepAlivesCleared: () => keepAlivesCleared, holdsCleared: () => holdsCleared }
  }

  const takeoverCards = async () => (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)

  it('lets the computer sleep when the hold ends with nobody on the screen: the card says so and the bot is idle', async () => {
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    const t = await stuckRunner(clock)
    expect(t.holds.map((h) => h.ms)).toEqual([HOLD_MS])

    clock.now += HOLD_MS
    t.holds[0]?.fn()

    // The release runs as a job on the bot's queue, so it lands a moment after the timer fired.
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('idle'))
    expect(await takeoverCards()).toEqual([expect.objectContaining({ status: 'ended', reason: holdEndedText(30) })])
    expect(t.keepAlivesCleared()).toBe(1)
    await vi.waitFor(() => expect(t.graces).toEqual([GRACE_MS]))
  })

  it('extends the hold while the page asks whether hand back is allowed, and ends it once the page stops asking', async () => {
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    const t = await stuckRunner(clock)

    clock.now += HOLD_MS - 30_000
    await t.runner.handbackState(botId)
    clock.now += 30_000
    t.holds[0]?.fn()

    expect(t.holds).toHaveLength(2)
    expect((await store.readBot(botId)).state).toBe('blocked')
    expect(t.keepAlivesCleared()).toBe(0)

    clock.now += HOLD_MS
    t.holds[1]?.fn()
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('idle'))
  })

  // The release is a job on the bot's queue. A goal that got there first has taken the computer and
  // the card; the stale hold job must then do nothing, or it would pause a computer a run is using.
  it('a goal that goes first leaves nothing for the hold to end: no second release, no sleep card', async () => {
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    const t = await stuckRunner(clock)

    // accept resolves once the goal is on the queue (its run record is written first), so the hold fires behind it.
    const { done: next } = await t.runner.accept(botId, { goal: 'y', activeSkill: null, source: 'message' })
    clock.now += HOLD_MS
    t.holds[0]?.fn() // queued behind the goal

    expect((await next)?.outcome).toBe('done')
    await t.queue.enqueue(botId, async () => undefined) // resolves once the hold job has run
    const bot = await store.readBot(botId)
    expect(bot.state).toBe('idle')
    expect(bot.statusLine).not.toBe('my computer went to sleep')
    expect(await takeoverCards()).toEqual([expect.objectContaining({ status: 'ended' })])
    expect((await takeoverCards())[0]).not.toHaveProperty('reason', holdEndedText(30))
    // One release: the goal's own, at its end. The hold job released nothing.
    expect(t.graces).toEqual([GRACE_MS])
  })

  it('a hand back before the hold ends cancels the hold timer', async () => {
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    const t = await stuckRunner(clock)
    expect(await t.runner.handback(botId)).toEqual({ ok: true })
    expect(t.holdsCleared()).toBe(1)
    expect(t.keepAlivesCleared()).toBe(1)
  })
})

// A Deny is the user's answer to the event that started the run. A run that fails after it must
// not hand the event back for another automatic try: the same card would come a second time.
describe('Deny', () => {
  it('keeps Deny when the model fails later, without a second run for the same mail', async () => {
    const approvals = new Approvals()
    const events = new BotEvents()
    const unsubscribe = events.subscribe(botId, (event) => {
      const card = event.event === 'chat' ? (event.data as { card?: { card?: string; approvalId?: string; status?: string } }).card : undefined
      if (card?.card === 'approval' && card.status === 'pending' && card.approvalId) approvals.resolve(card.approvalId, 'denied')
    })
    // One proposal, then the fake model has nothing left and throws, as a failing provider does.
    const model = new FakeModel([message([toolUse('propose_action', { kind: 'send', summary: 'Send the reply', consequences: [], warnings: [], target: 'Send' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events, { approvals })
    await store.writeSkill(botId, { name: 'read-mail', description: 'Read mail', body: 'Read the mail.' })
    await store.writeRoutine(botId, { name: 'on-mail', skill: 'read-mail', schedule: null, event: MAIL_EVENT, enabled: true, body: 'Read mail.' })
    let calls = 0
    let clock = 0
    let reading = { unseen: 0, uidNext: 5, uidValidity: '1' }
    const watermark = fileWatermark(join(dataDir, 'mail-watermark.json'))
    const scheduler = new Scheduler({ store, timezone: LIMITS.timezone, now: () => new Date(clock),
      enqueueRun: (id, input) => { calls++; return runner.enqueue(id, input) } })
    const watcher = () => new MailWatcher({ mailbox: { read: async () => reading }, watermark,
      now: () => clock, onMail: (cursor) => scheduler.fireEvent(MAIL_EVENT, cursor) })
    const first = watcher()
    await scheduler.reload(botId)
    try {
      await first.tick()
      reading = { unseen: 1, uidNext: 6, uidValidity: '1' }
      await first.tick()
      const cards = (await store.readChat(botId, { limit: 30 })).flatMap((m) => (m.card?.card === 'approval' ? [m.card.status] : []))
      expect(cards).toEqual(['denied'])
      expect(model.calls).toHaveLength(2)
      const [runId] = await readdir(join(dataDir, botId, 'runs'))
      expect((await store.readRunEvents(botId, runId ?? '')).at(-1)).toMatchObject({ type: 'end', outcome: 'denied', summary: 'Error (after a denied action)' })
      // The chat still says what failed, and how to try again by hand.
      expect((await store.readChat(botId, { limit: 30 })).at(-1)?.text).toMatch(/the model stopped answering, so I stopped\. Send the goal again to retry\.$/)
      expect((await watermark.read())?.uidNext).toBe(6)
      clock += MAIL_DEBOUNCE_MS
      await first.tick()
      await watcher().tick()
      expect(calls).toBe(1)
    } finally {
      unsubscribe()
      await scheduler.stop(0)
    }
  })

  it('keeps Deny when the failure escapes the loop: the line that reports it cannot be written', async () => {
    const approvals = new Approvals()
    const events = new BotEvents()
    const unsubscribe = events.subscribe(botId, (event) => {
      const card = event.event === 'chat' ? (event.data as { card?: { card?: string; approvalId?: string; status?: string } }).card : undefined
      if (card?.card === 'approval' && card.status === 'pending' && card.approvalId) approvals.resolve(card.approvalId, 'denied')
    })
    const model = new FakeModel([message([toolUse('propose_action', { kind: 'send', summary: 'Send the reply', consequences: [], warnings: [], target: 'Send' })])])
    const used: Store = { ...store, appendChat: async (id, input) => {
      if (input.role === 'bot') throw new Error('the chat file cannot be written')
      return store.appendChat(id, input)
    } }
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events, { approvals, store: used })
    const result = await runner.enqueue(botId, { goal: 'Read mail.', activeSkill: null, source: 'routine', routineName: 'on-mail' })
    unsubscribe()
    expect(result).toEqual({ outcome: 'denied', summary: 'Error (after a denied action)' })
  })

  it('leaves a failed run as failed when no action was denied in it', async () => {
    const runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([]), basePlatformTools)
    expect(await runner.enqueue(botId, { goal: 'Read mail.', activeSkill: null, source: 'routine', routineName: 'on-mail' })).toEqual({ outcome: 'failed', summary: 'Error' })
  })
})

// Stop must reach a run wherever it waits: on the human's screen, on an approval, on a question.
describe('Stop', () => {
  it('keeps Stop when computer startup later fails, without mail retry after restart', async () => {
    const began = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<never>()
    const model = new FakeModel([])
    const runner = runnerWith({ create: () => { began.resolve(); return pending.promise }, connect: () => pending.promise }, model)
    await store.writeSkill(botId, { name: 'read-mail', description: 'Read mail', body: 'Read the mail.' })
    await store.writeRoutine(botId, { name: 'on-mail', skill: 'read-mail', schedule: null, event: MAIL_EVENT, enabled: true, body: 'Read mail.' })
    let calls = 0
    let clock = 0
    let reading = { unseen: 0, uidNext: 5, uidValidity: '1' }
    const watermark = fileWatermark(join(dataDir, 'mail-watermark.json'))
    const scheduler = new Scheduler({ store, timezone: LIMITS.timezone, now: () => new Date(clock),
      enqueueRun: (id, input) => { calls++; return runner.enqueue(id, input) } })
    const watcher = () => new MailWatcher({ mailbox: { read: async () => reading }, watermark,
      now: () => clock, onMail: (cursor) => scheduler.fireEvent(MAIL_EVENT, cursor) })
    const first = watcher()
    await scheduler.reload(botId)
    try {
      await first.tick()
      reading = { unseen: 1, uidNext: 6, uidValidity: '1' }
      const tick = first.tick()
      await began.promise
      const runId = runner.activeRunId(botId)
      if (runId === null) throw new Error('mail routine did not start')
      expect(runner.cancel(botId)).toBe(true)
      pending.reject(new Error('computer start failed'))
      await tick
      expect((await store.readRunEvents(botId, runId)).at(-1)).toMatchObject({ type: 'end', outcome: 'cancelled' })
      expect((await watermark.read())?.uidNext).toBe(6)
      clock += MAIL_DEBOUNCE_MS
      await first.tick()
      await watcher().tick()
      expect(calls).toBe(1)
      expect(model.calls).toHaveLength(0)
    } finally {
      pending.reject(new Error('test cleanup'))
      await scheduler.stop(0)
    }
  })

  it('keeps Stop when run setup storage later fails', async () => {
    const began = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<never>()
    const model = new FakeModel([])
    const used = { ...store, readRules: () => { began.resolve(); return pending.promise } }
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, [], undefined, new BotEvents(), { store: used })
    const accepted = await runner.accept(botId, { goal: 'Read mail.', activeSkill: null, source: 'routine', routineName: 'on-mail' })
    await began.promise
    expect(runner.cancel(botId)).toBe(true)
    pending.reject(new Error('rules unavailable'))
    expect((await accepted.done)?.outcome).toBe('cancelled')
    expect((await store.readRunEvents(botId, accepted.runId)).at(-1)).toMatchObject({ type: 'end', outcome: 'cancelled' })
    expect(model.calls).toHaveLength(0)
  })

  it.each(['startup', 'plumbing', 'model'] as const)('keeps Stop accepted while %s failure reporting waits', async (stage) => {
    const reporting = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const used: Store = { ...store,
      readRules: stage === 'plumbing' ? async () => { throw new Error('rules unavailable') } : store.readRules,
      appendRunEvent: async (event) => {
        if (event.type === 'end' && event.outcome === 'failed') { reporting.resolve(); await release.promise }
        await store.appendRunEvent(event)
      },
    }
    const factory = stage === 'startup'
      ? { ...fakeFactory(new FakeSandbox()), create: async () => { throw new Error('computer unavailable') } }
      : fakeFactory(new FakeSandbox())
    const runner = runnerWith(factory, new FakeModel([]), [], undefined, new BotEvents(), { store: used })
    const accepted = await runner.accept(botId, { goal: 'Read mail.', activeSkill: null, source: 'routine', routineName: 'on-mail' })
    try {
      await reporting.promise
      expect(runner.cancel(botId)).toBe(true)
    } finally {
      release.resolve()
    }
    expect((await accepted.done)?.outcome).toBe('cancelled')
    expect((await store.readRunEvents(botId, accepted.runId)).at(-1)).toMatchObject({ type: 'end', outcome: 'cancelled' })
  })

  it('during a takeover wakes the run, ends it cancelled and ends the card', async () => {
    const model = new FakeModel([message([toolUse('request_takeover', { reason: 'the mailbox asks for a password' })])])
    const sandbox = new FakeSandbox()
    const runner = runnerWith(fakeFactory(sandbox), model, basePlatformTools)
    const result = runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' })
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('blocked'))

    expect(runner.cancel(botId)).toBe(true)

    expect((await result)?.outcome).toBe('cancelled')
    expect(await store.readBot(botId)).toMatchObject({ state: 'idle', statusLine: 'stopped by you' })
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'ended' })])
    // The screen stays as the human left it: no screenshot after a stop, and no hand-back check.
    expect(sandbox.methods()).not.toContain('screenshot')
    expect(runner.cancel(botId)).toBe(false)
  })

  // The stop request belongs to the run it ended: the bot's next job must not inherit it.
  it('a later run on the same bot is not stopped by the request that ended the last one', async () => {
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Which company?' })]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)
    const first = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))
    expect(runner.cancel(botId)).toBe(true)
    expect((await first)?.outcome).toBe('cancelled')

    expect((await runner.enqueue(botId, { goal: 'again', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    expect(model.calls).toHaveLength(2)
  })

  it('isBusy sees an active run and a goal queued behind it, and nothing once both are over', async () => {
    const model = new FakeModel([
      message([toolUse('ask_user', { question: 'Which company?' })]),
      message([textBlock('first done')], 'end_turn'),
      message([textBlock('second done')], 'end_turn'),
    ])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)
    expect(runner.isBusy(botId)).toBe(false)
    const first = runner.enqueue(botId, { goal: 'first', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))
    expect(runner.isBusy(botId)).toBe(true)
    const second = await runner.accept(botId, { goal: 'second', activeSkill: null, source: 'message' })
    expect(runner.isBusy(botId)).toBe(true)
    expect(runner.answerUser(botId, 'Acme')).toBe(true)
    expect((await first)?.outcome).toBe('done')
    expect((await second.done)?.outcome).toBe('done')
    expect(runner.isBusy(botId)).toBe(false)
  })

  it('while the run waits for an approval denies it and ends the run', async () => {
    const model = new FakeModel([message([toolUse('propose_action', { kind: 'submit', summary: 'Send the form', consequences: [], warnings: [], target: 'Send' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('waiting'))

    expect(runner.cancel(botId)).toBe(true)

    expect((await result)?.outcome).toBe('cancelled')
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'approval').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'denied' })])
  })

  it('while the run waits for an answer wakes it and ends the run', async () => {
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Which company?' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))

    expect(runner.cancel(botId)).toBe(true)

    expect((await result)?.outcome).toBe('cancelled')
    expect(runner.isWaitingForUser(botId)).toBe(false)
  })
})

// Stop must also end a wait that is registered after it: the approval a tool proposes once its
// screenshot is taken, the answer waiter registered once the question is posted, the takeover
// waiter registered once its card and event are out. If Stop resolved only the waits that exist at
// that moment, such a run would keep its queue slot and its computer until a second Stop, and a
// takeover has no timeout at all. Each test presses Stop inside the awaited step just before the
// wait is created. Without that rule each one times out with the run still waiting.
describe('Stop while a wait is being created', () => {
  it('an approval proposed after the stop is denied at once, and the run ends cancelled', async () => {
    const model = new FakeModel([message([toolUse('propose_action', { kind: 'submit', summary: 'Send the form', consequences: [], warnings: [], target: 'Send' })])])
    let runner!: Runner
    let stopped: boolean | null = null
    // The screenshot for the card is the tool's last await before it proposes the approval. The
    // stop's answer is asserted after the run: a throw in here would be swallowed by the tool.
    class StopDuringScreenshot extends FakeSandbox {
      override async screenshot(): Promise<Uint8Array> {
        stopped = runner.cancel(botId)
        return super.screenshot()
      }
    }
    runner = runnerWith(fakeFactory(new StopDuringScreenshot()), model, basePlatformTools)

    const result = await runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })

    expect(stopped).toBe(true)
    expect(result?.outcome).toBe('cancelled')
    // The card exists: the tool got past the stop and proposed. It is denied, not left pending.
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'approval').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'denied' })])
    expect(await store.readBot(botId)).toMatchObject({ state: 'idle', statusLine: 'stopped by you' })
    expect(runner.isBusy(botId)).toBe(false)
  })

  it('a question posted before the stop gets the stop as its answer at once, and the run ends cancelled', async () => {
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Which company?' })])])
    const events = new BotEvents()
    let runner!: Runner
    let stopped: boolean | null = null
    let waitingAtStop: boolean | null = null
    // The question reaches the chat, then the bot is set waiting, then the answer waiter is registered.
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event !== 'chat' || event.data.text !== 'Which company?') return
      waitingAtStop = runner.isWaitingForUser(botId)
      stopped = runner.cancel(botId)
    })
    runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events)

    const result = await runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    unsubscribe()

    // The stop landed before the waiter existed: the window under test, not the already-waiting case.
    expect(waitingAtStop).toBe(false)
    expect(stopped).toBe(true)
    expect(result?.outcome).toBe('cancelled')
    expect(runner.isWaitingForUser(botId)).toBe(false)
    expect((await store.readChat(botId, { limit: 20 })).map((m) => m.text)).toContain(STOPPED_TEXT)
    expect(await store.readBot(botId)).toMatchObject({ state: 'idle', statusLine: 'stopped by you' })
    expect(runner.isBusy(botId)).toBe(false)
  })

  it('a takeover whose waiter is registered after the stop ends at once: card ended, run cancelled, no screenshot', async () => {
    const model = new FakeModel([message([toolUse('request_takeover', { reason: 'the mailbox asks for a password' })])])
    const events = new BotEvents()
    const sandbox = new FakeSandbox()
    let runner!: Runner
    let stopped: boolean | null = null
    // The started event is the controller's last await before it registers the waiter.
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event === 'run' && event.data.type === 'takeover' && event.data.status === 'started') stopped = runner.cancel(botId)
    })
    runner = runnerWith(fakeFactory(sandbox), model, basePlatformTools, undefined, events)

    const result = await runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' })
    unsubscribe()

    expect(stopped).toBe(true)
    expect(result?.outcome).toBe('cancelled')
    expect((await store.readChat(botId, { limit: 20 })).map((m) => m.text)).toContain(STOPPED_TEXT)
    expect(await store.readBot(botId)).toMatchObject({ state: 'idle', statusLine: 'stopped by you' })
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'ended' })])
    // The screen stays as the human left it: no screenshot after a stop, and no hand-back check.
    expect(sandbox.methods()).not.toContain('screenshot')
    expect(runner.isBusy(botId)).toBe(false)
  })

  // The always-allow branch of the proposal tool never waits, so no check at a wait's registration
  // covers it. Without its own check of the stop it would grant the approval and write "allowed by
  // your rules" into the chat of a run that ends cancelled a moment later.
  it('an always-allowed proposal after the stop is denied, with no "allowed by your rules" line', async () => {
    await writeFile(rulesFile(dataDir, botId), JSON.stringify({ requireApproval: [], alwaysAllow: ['submit'] }))
    const model = new FakeModel([message([toolUse('propose_action', { kind: 'submit', summary: 'Send the form', consequences: [], warnings: [], target: 'Send' })])])
    let runner!: Runner
    let stopped: boolean | null = null
    class StopDuringScreenshot extends FakeSandbox {
      override async screenshot(): Promise<Uint8Array> {
        stopped = runner.cancel(botId)
        return super.screenshot()
      }
    }
    runner = runnerWith(fakeFactory(new StopDuringScreenshot()), model, basePlatformTools)

    const result = await runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })

    expect(stopped).toBe(true)
    expect(result?.outcome).toBe('cancelled')
    const chat = await store.readChat(botId, { limit: 20 })
    expect(chat.filter((m) => m.card?.card === 'approval').map((m) => m.card)).toEqual([expect.objectContaining({ status: 'denied' })])
    expect(chat.some((m) => m.card?.card === 'status' && m.card.text.includes('allowed by your rules'))).toBe(false)
  })

  // A manual takeover that ends by Stop must end the run there. Without that check the loop goes
  // straight into the next model call, with only the SDK's rejection of an aborted signal between
  // the stop and a new request.
  it('Stop during a manual takeover ends the run before the next model call', async () => {
    const model = new FakeModel([message([toolUse('remember', { note: 'x' })]), message([textBlock('done')], 'end_turn')])
    const events = new BotEvents()
    let runner!: Runner
    let stopped: boolean | null = null
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event !== 'run') return
      // The user takes over after the first tool; the loop hands the screen over before its next model call.
      if (event.data.type === 'tool_result' && event.data.name === 'remember') runner.requestTakeover(botId)
      if (event.data.type === 'takeover' && event.data.status === 'started') stopped = runner.cancel(botId)
    })
    runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events)

    const result = await runner.enqueue(botId, { goal: 'note', activeSkill: null, source: 'message' })
    unsubscribe()

    expect(stopped).toBe(true)
    expect(result?.outcome).toBe('cancelled')
    expect(model.calls).toHaveLength(1)
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'ended' })])
  })
})

// A human who takes the screen of an idle bot from the page needs something that holds the computer
// up. Without it the idle pause fires two minutes after a run ended, while the human is on the screen.
describe('a takeover of an idle bot from the page', () => {
  async function idleRunner(notifier?: NotifierPort) {
    const clock = { now: Date.parse('2026-09-16T20:00:00Z') }
    const sandbox = new FakeSandbox()
    const { factory, keepAlives } = countingFactory(sandbox)
    const model = new FakeModel([message([textBlock('done')], 'end_turn'), message([textBlock('done again')], 'end_turn')])
    const graces: { fn: () => void; ms: number }[] = []
    let gracesCleared = 0
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, {
      factory,
      setTimer: (fn, ms) => {
        graces.push({ fn, ms })
        return graces.length
      },
      clearTimer: () => {
        gracesCleared += 1
      },
    })
    const ticks: (() => void)[] = []
    let keepAlivesCleared = 0
    const presence: { fn: () => void; ms: number }[] = []
    let presenceCleared = 0
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue: new RunQueue(),
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      now: () => new Date(clock.now),
      setKeepAlive: (fn) => {
        ticks.push(fn)
        return ticks.length
      },
      clearKeepAlive: () => {
        keepAlivesCleared += 1
      },
      setHoldTimer: (fn, ms) => {
        presence.push({ fn, ms })
        return presence.length
      },
      clearHoldTimer: () => {
        presenceCleared += 1
      },
      ...(notifier ? { notifier } : {}),
    })
    // A finished run leaves the computer up, with the grace timer armed towards the idle pause.
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    expect(graces.map((g) => g.ms)).toEqual([GRACE_MS])
    expect(keepAlivesCleared).toBe(1)
    sandbox.companion.states = [{ url: 'https://example.com/', fingerprint: 'x', unsafe: false }]
    return { clock, sandbox, runner, model, graces, ticks, presence, keepAlives, gracesCleared: () => gracesCleared, keepAlivesCleared: () => keepAlivesCleared, presenceCleared: () => presenceCleared }
  }

  it('holds the computer awake from the interactive stream request until hand back, which releases it', async () => {
    const t = await idleRunner()
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    // The grace timer towards the pause is cancelled, and a keep-alive refreshes the sandbox timeout.
    expect(t.gracesCleared()).toBe(1)
    expect(t.ticks).toHaveLength(2)
    const before = t.keepAlives()
    t.ticks[1]?.()
    await new Promise((r) => setImmediate(r))
    expect(t.keepAlives()).toBe(before + 1)
    // Asking again while it is held changes nothing.
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    expect(t.ticks).toHaveLength(2)

    expect(await t.runner.handback(botId)).toEqual({ ok: true })
    expect(t.keepAlivesCleared()).toBe(2)
    expect(t.presenceCleared()).toBe(1)
    // Released: the normal grace towards the pause is armed again, and the bot was idle throughout.
    expect(t.graces.map((g) => g.ms)).toEqual([GRACE_MS, GRACE_MS])
    expect((await store.readBot(botId)).state).toBe('idle')
  })

  it('hand back is refused while the page is not safe, and the computer stays held', async () => {
    const t = await idleRunner()
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    t.sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true }]
    expect(await t.runner.handback(botId)).toEqual({ ok: false, reason: UNSAFE_REASON })
    expect(t.keepAlivesCleared()).toBe(1)
    expect(t.graces).toHaveLength(1)
  })

  it('ends when the page stops asking whether hand back is allowed, and not while it asks', async () => {
    const t = await idleRunner()
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    expect(t.presence.map((p) => p.ms)).toEqual([HOLD_PRESENCE_MS])
    t.clock.now += HOLD_PRESENCE_MS - 5_000
    await t.runner.handbackState(botId)
    t.clock.now += 10_000
    t.presence[0]?.fn()
    // Seen ten seconds before the check: still held, and the timer is re-armed.
    expect(t.presence).toHaveLength(2)
    expect(t.keepAlivesCleared()).toBe(1)

    t.clock.now += HOLD_PRESENCE_MS + 1
    t.presence[1]?.fn()
    expect(t.keepAlivesCleared()).toBe(2)
    expect(t.graces.map((g) => g.ms)).toEqual([GRACE_MS, GRACE_MS])
  })

  it('starts again when the tab asks after the hold ended (a tab that was hidden for a while), so a goal still checks the screen', async () => {
    const t = await idleRunner()
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    t.clock.now += HOLD_PRESENCE_MS + 1
    t.presence[0]?.fn()
    expect(t.presence).toHaveLength(1)

    // The human comes back to the tab: its next question takes the hold again.
    await t.runner.handbackState(botId)
    expect(t.presence).toHaveLength(2)
    t.sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true }]
    const refused = await t.runner.accept(botId, { goal: 'check mail', activeSkill: null, source: 'message' })
    expect(await refused.done).toEqual({ outcome: 'blocked', summary: `not started: ${UNSAFE_REASON}` })
  })

  it('a goal that arrives during the takeover passes the hand-back check first, then ends the takeover and runs', async () => {
    const t = await idleRunner()
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    t.sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true }]
    const refused = await t.runner.accept(botId, { goal: 'check mail', activeSkill: null, source: 'routine', routineName: 'check-mail' })
    expect(await refused.done).toEqual({ outcome: 'blocked', summary: `not started: ${UNSAFE_REASON}` })
    expect((await store.readChat(botId, { limit: 5 })).at(-1)).toMatchObject({ role: 'bot', text: notStartedText(UNSAFE_REASON, 'check-mail') })
    // Still held: the human is on the screen, and no model call was made.
    expect(t.keepAlivesCleared()).toBe(1)
    expect(t.graces).toHaveLength(1)
    expect(t.model.calls).toHaveLength(1)
    expect((await store.readBot(botId)).state).toBe('idle')

    t.sandbox.companion.states = [{ url: 'https://example.com/inbox', fingerprint: 'y', unsafe: false }]
    expect((await t.runner.enqueue(botId, { goal: 'again', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    // The takeover's keep-alive and the run's own were both cleared; the run released the computer at its end.
    expect(t.keepAlivesCleared()).toBe(3)
    expect(t.graces.map((g) => g.ms)).toEqual([GRACE_MS, GRACE_MS, GRACE_MS])
  })

  // The takeover takes its hold through the manager's own chain. A hold taken outside it could be
  // granted while a pause is already in flight, and the takeover would then stream from a computer
  // that has just paused.
  it('a takeover asked for while the pause is in flight waits for it, resumes the computer and streams from the resumed session', async () => {
    const sandbox = new FakeSandbox()
    let pauseGate: () => void = () => undefined
    const paused = new Promise<void>((resolve) => {
      pauseGate = resolve
    })
    const keepAlivesOn: string[] = []
    const session = (id: string, url: string) => ({
      sandbox,
      sandboxId: id,
      streamViewUrl: 'https://v.example/view',
      streamInteractiveUrl: url,
      keepAlive: async () => {
        keepAlivesOn.push(id)
      },
      pause: async () => {
        await paused
        return 'paused' as const
      },
      syncWorkspace: async () => undefined,
    })
    const factory: SessionFactory = { create: async () => session('sbx-1', 'https://v.example/full-1'), connect: async () => session('sbx-1', 'https://v.example/full-2') }
    const model = new FakeModel([message([textBlock('done')], 'end_turn')])
    const graces: { fn: () => void; ms: number }[] = []
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, {
      factory,
      setTimer: (fn, ms) => {
        graces.push({ fn, ms })
        return graces.length
      },
      clearTimer: () => undefined,
    })
    const ticks: (() => void)[] = []
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue: new RunQueue(),
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      setKeepAlive: (fn) => {
        ticks.push(fn)
        return ticks.length
      },
      clearKeepAlive: () => undefined,
      setHoldTimer: () => 1,
      clearHoldTimer: () => undefined,
    })
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    // The grace runs out: the pause starts and hangs on the E2B call.
    graces[0]?.fn()
    await new Promise((r) => setImmediate(r))
    expect(sandboxes.get(botId)).not.toBeNull()

    const begun = runner.beginIdleTakeover(botId)
    pauseGate()
    const held = await begun
    // The pause finished first; the takeover resumed the computer and streams from the resumed session.
    expect(held?.streamInteractiveUrl).toBe('https://v.example/full-2')
    expect(sandboxes.get(botId)?.streamInteractiveUrl).toBe('https://v.example/full-2')
    ticks.at(-1)?.()
    await new Promise((r) => setImmediate(r))
    expect(keepAlivesOn.at(-1)).toBe('sbx-1')
  })

  it('holds nothing without a running computer', async () => {
    const runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([]))
    expect(await runner.beginIdleTakeover(botId)).toBeNull()
  })

  // The refusal is decided after an awaited screen check, and the presence timer or a hand-back can
  // end the takeover while that check is out. A mark cleared at the end of a hold would be set again
  // by the late refusal, and the next hold would stay silent.
  it('6b. a hold that ends during a goal\'s screen check leaves no mark behind: the next hold still gets its notice', async () => {
    const notices: Notice[] = []
    const notifier: NotifierPort = { notify: async (n) => (notices.push(n), 'confirmed') }
    const t = await idleRunner(notifier)
    const unsafe = { url: 'https://example.com/login', fingerprint: 'x', unsafe: true }
    const refuse = async () => expect((await t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' }))?.outcome).toBe('blocked')
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    t.sandbox.companion.states = [unsafe]
    await refuse()
    expect(notices.filter((n) => n.need === 'refused')).toHaveLength(1)

    // The next goal's screen check stays out until the test lets it answer.
    let answer!: (state: typeof unsafe) => void
    const companion = t.sandbox.companion
    const scripted = companion.pageState.bind(companion)
    let held = false
    companion.pageState = async () => (held ? scripted() : ((held = true), new Promise((resolve) => (answer = resolve))))
    const late = t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' })
    await vi.waitFor(() => expect(answer).toBeDefined())
    // Nobody has asked about hand back for over a minute: the presence timer ends the takeover now.
    t.clock.now += HOLD_PRESENCE_MS + 1
    t.presence.at(-1)?.fn()
    answer(unsafe)
    expect((await late)?.outcome).toBe('blocked')
    // The late refusal belongs to the hold that has ended: it sent nothing.
    expect(notices.filter((n) => n.need === 'refused')).toHaveLength(1)

    // A new hold. Its first refused goal must call the human.
    const before = notices.filter((n) => n.need === 'refused').length
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    await refuse()
    expect(notices.filter((n) => n.need === 'refused')).toHaveLength(before + 1)
  })

  // Test 6b starts with an earlier refusal, so the mark is already set when the hold ends. Without
  // one, the late refusal is the first of its hold, and it must not announce a screen that is no
  // longer held.
  it('6c. a first refusal decided after its hold has ended calls nobody, and the next hold still gets its notice', async () => {
    const notices: Notice[] = []
    const notifier: NotifierPort = { notify: async (n) => (notices.push(n), 'confirmed') }
    const t = await idleRunner(notifier)
    const unsafe = { url: 'https://example.com/login', fingerprint: 'x', unsafe: true }
    const refused = () => notices.filter((n) => n.need === 'refused')
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    t.sandbox.companion.states = [unsafe]

    // The first goal's screen check stays out until the test lets it answer.
    let answer!: (state: typeof unsafe) => void
    const companion = t.sandbox.companion
    const scripted = companion.pageState.bind(companion)
    let held = false
    companion.pageState = async () => (held ? scripted() : ((held = true), new Promise((resolve) => (answer = resolve))))
    const late = t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' })
    await vi.waitFor(() => expect(answer).toBeDefined())
    t.clock.now += HOLD_PRESENCE_MS + 1
    t.presence.at(-1)?.fn()
    answer(unsafe)
    // The page is still not safe, so the goal is refused; but nobody holds the screen any more.
    expect((await late)?.outcome).toBe('blocked')
    expect(refused()).toEqual([])

    // A new hold. Its first refused goal must call the human: the late refusal left no mark.
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    expect((await t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' }))?.outcome).toBe('blocked')
    expect(refused()).toEqual([{ botName: 'Worker', need: 'refused' }])
  })
})

// The fake records at the moment notify() is called, which is the same synchronous block as the
// wait's registration, so "no notice" can be asserted the moment a run has ended, with no sleep.
class FakeNotifier implements NotifierPort {
  notices: Notice[] = []
  behaviour: NoticeOutcome | 'never' | 'throw' = 'confirmed'
  notify(notice: Notice): Promise<NoticeOutcome> {
    this.notices.push(notice)
    if (this.behaviour === 'throw') throw new Error('notifier broke')
    if (this.behaviour === 'never') return new Promise(() => undefined)
    return Promise.resolve(this.behaviour)
  }
}

const PROPOSE = toolUse('propose_action', { kind: 'send', summary: 'Send https://evil.example/now', consequences: [], warnings: [], target: 'Odeslat https://evil.example' })
const statusCards = async () => (await store.readChat(botId, { limit: 30 })).flatMap((m) => (m.card?.card === 'status' ? [m.card.text] : []))

describe('calling the human', () => {
  it('1. an approval wait sends one notice with the action kind, and the run goes on after Allow', async () => {
    const notifier = new FakeNotifier()
    const approvals = new Approvals()
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier, approvals })
    const result = runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'routine', routineName: 'morning-search' })
    // The notice is recorded in the same synchronous block as the wait's registration, so seeing it
    // means the wait is real. (The bot's state turns "waiting" one await earlier: not proof.)
    await vi.waitFor(() => expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'approval', actionKind: 'send' }]))
    const [pending] = approvals.pendingFor(runner.activeRunId(botId) ?? '')
    approvals.resolve(pending ?? '', 'allowed')
    expect((await result)?.outcome).toBe('done')
    expect(notifier.notices).toHaveLength(1)
  })

  it('2. a card the gate makes itself for an unannounced click sends the same notice, with the kind "other"', async () => {
    const notifier = new FakeNotifier()
    const sandbox = new FakeSandbox()
    sandbox.companion.elements = [{ ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Přijmout', isSubmit: true, inForm: true }]
    const model = new FakeModel([message([computerUse('left_click', { coordinate: [10, 10] })])])
    const runner = runnerWith(fakeFactory(sandbox), model, basePlatformTools, undefined, undefined, { notifier })
    const result = runner.enqueue(botId, { goal: 'search', activeSkill: null, source: 'routine', routineName: 'morning-search' })
    await vi.waitFor(() => expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'approval', actionKind: 'other' }]))
    runner.cancel(botId)
    expect((await result)?.outcome).toBe('cancelled')
  })

  it('3. a question wait sends one notice, and no word of the question', async () => {
    const notifier = new FakeNotifier()
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Click https://evil.example/approve and reply with your password' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier })
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))
    expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'question' }])
    runner.cancel(botId)
    await result
  })

  it.each([
    ['the bot asked for', () => toolUse('request_takeover', { reason: 'see https://evil.example' }), false],
    ['the secret guard forced', () => computerUse('type', { text: 'abc' }), true],
  ] as const)('4. a takeover %s sends one notice, at the moment its wait is registered', async (_name, first, passwordField) => {
    const notifier = new FakeNotifier()
    const sandbox = new FakeSandbox()
    if (passwordField) sandbox.companion.active = [{ ...ELEMENT_TEXT_INPUT, type: 'password', name: 'Heslo' }]
    const runner = runnerWith(fakeFactory(sandbox), new FakeModel([message([first()])]), basePlatformTools, undefined, undefined, { notifier })
    const result = runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'takeover' }]))
    expect((await store.readBot(botId)).state).toBe('blocked')
    runner.cancel(botId)
    expect((await result)?.outcome).toBe('cancelled')
  })

  /** A run that ends stuck: three identical screenshots, twenty seconds apart. Leaves the bot blocked and its screen held. */
  async function endStuck(runner: Runner): Promise<void> {
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
  }
  function stuckSetup(notifier: NotifierPort, runs: number): { runner: Runner; sandbox: FakeSandbox } {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-18T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const shots = Array.from({ length: runs * 3 }, () => message([computerUse('screenshot')]))
    return { runner: runnerWith(fakeFactory(sandbox), new FakeModel(shots), [], () => new Date(clock.now), undefined, { notifier }), sandbox }
  }

  it('5. a run that ends blocked sends one notice, after the run has ended', async () => {
    const notifier = new FakeNotifier()
    const { runner } = stuckSetup(notifier, 1)
    await endStuck(runner)
    expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'blocked' }])
  })

  it('6. goals refused while a human holds the screen send one notice per hold, and a new hold sends a new one', async () => {
    const notifier = new FakeNotifier()
    const { runner, sandbox } = stuckSetup(notifier, 2)
    await endStuck(runner)
    const refused = () => notifier.notices.filter((n) => n.need === 'refused')
    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true }]
    for (const routineName of ['check-mail', 'check-mail', 'morning-search']) expect((await runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName }))?.outcome).toBe('blocked')
    expect(refused()).toEqual([{ botName: 'Worker', need: 'refused' }])
    // The human hands back and the hold ends. The next run ends stuck again: a new hold, which starts with no mark.
    sandbox.companion.states = [{ url: 'https://example.com/inbox', fingerprint: 'y', unsafe: false }]
    expect(await runner.handback(botId)).toEqual({ ok: true })
    await endStuck(runner)
    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'z', unsafe: true }]
    expect((await runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' }))?.outcome).toBe('blocked')
    expect(refused()).toHaveLength(2)
  })

  // Tests 7 to 9 are the three windows in which Stop lands after the tool started and before its
  // wait is registered. The run must end cancelled, and nobody may be called.
  it('7. an approval proposed after the stop sends nothing', async () => {
    const notifier = new FakeNotifier()
    let runner!: Runner
    let stopped: boolean | null = null
    // The screenshot for the card is the tool's last await before it proposes the approval.
    class StopDuringScreenshot extends FakeSandbox {
      override async screenshot(): Promise<Uint8Array> {
        stopped = runner.cancel(botId)
        return super.screenshot()
      }
    }
    runner = runnerWith(fakeFactory(new StopDuringScreenshot()), new FakeModel([message([PROPOSE])]), basePlatformTools, undefined, undefined, { notifier })
    expect((await runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' }))?.outcome).toBe('cancelled')
    expect(stopped).toBe(true)
    expect(notifier.notices).toEqual([])
  })

  it('8. a question posted before the stop sends nothing', async () => {
    const notifier = new FakeNotifier()
    const events = new BotEvents()
    let runner!: Runner
    let stopped: boolean | null = null
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event === 'chat' && event.data.text === 'Which company?') stopped = runner.cancel(botId)
    })
    runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([message([toolUse('ask_user', { question: 'Which company?' })])]), basePlatformTools, undefined, events, { notifier })
    expect((await runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' }))?.outcome).toBe('cancelled')
    unsubscribe()
    expect(stopped).toBe(true)
    expect(notifier.notices).toEqual([])
  })

  it('9. a takeover stopped while its card was being written sends nothing', async () => {
    const notifier = new FakeNotifier()
    const events = new BotEvents()
    let runner!: Runner
    let stopped: boolean | null = null
    // The started event is the controller's last await before it registers the waiter.
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event === 'run' && event.data.type === 'takeover' && event.data.status === 'started') stopped = runner.cancel(botId)
    })
    runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([message([toolUse('request_takeover', { reason: 'sign in' })])]), basePlatformTools, undefined, events, { notifier })
    expect((await runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' }))?.outcome).toBe('cancelled')
    unsubscribe()
    expect(stopped).toBe(true)
    expect(notifier.notices).toEqual([])
  })

  it('10. an approval decided while its card was being written starts no wait and sends nothing', async () => {
    const notifier = new FakeNotifier()
    const approvals = new Approvals()
    const events = new BotEvents()
    const unsubscribe = events.subscribe(botId, (event) => {
      const card = event.event === 'chat' ? (event.data as { card?: { card?: string; approvalId?: string; status?: string } }).card : undefined
      if (card?.card === 'approval' && card.status === 'pending' && card.approvalId) approvals.resolve(card.approvalId, 'allowed')
    })
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events, { notifier, approvals })
    expect((await runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    unsubscribe()
    expect(notifier.notices).toEqual([])
  })

  it('11. a proposal the rules allow starts no wait and sends nothing', async () => {
    await writeFile(rulesFile(dataDir, botId), JSON.stringify({ requireApproval: [], alwaysAllow: ['send'] }))
    const notifier = new FakeNotifier()
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier })
    expect((await runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    expect(notifier.notices).toEqual([])
  })

  // A Stop at the takeover's "started" event comes before the wait is registered, so a test that
  // stops there passes even if a manual takeover does call the human. This one lets the wait
  // register and ends it by a hand-back, and the run log proves which way it ended.
  it('12. a takeover the user started himself sends nothing, from its registered wait to its hand-back', async () => {
    const notifier = new FakeNotifier()
    const events = new BotEvents()
    let runner!: Runner
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event === 'run' && event.data.type === 'tool_result' && event.data.name === 'remember') runner.requestTakeover(botId)
    })
    const model = new FakeModel([message([toolUse('remember', { note: 'x' })]), message([textBlock('done')], 'end_turn')])
    runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events, { notifier })
    const accepted = await runner.accept(botId, { goal: 'note', activeSkill: null, source: 'message' })
    // A hand-back before the wait is registered does nothing, so hand back until the run has moved on.
    await vi.waitFor(async () => {
      await runner.handback(botId)
      expect(model.calls).toHaveLength(2)
    })
    unsubscribe()
    expect((await accepted.done)?.outcome).toBe('done')
    const takeovers = (await store.readRunEvents(botId, accepted.runId)).flatMap((e) => (e.type === 'takeover' ? [`${e.status}:${e.reason}`] : []))
    expect(takeovers).toEqual(['started:manual', 'ended:handed back'])
    expect(notifier.notices).toEqual([])
  })

  it('13. the daily-budget refusal sends nothing: no action on the screen can help it', async () => {
    const notifier = new FakeNotifier()
    await seedRun(store, botId, 'run-earlier', '2026-09-18T07:00:00Z', [25.2])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([]), [], () => new Date('2026-09-18T10:00:00Z'), undefined, { notifier })
    expect((await runner.enqueue(botId, { goal: 'search', activeSkill: null, source: 'routine', routineName: 'morning-search' }))?.outcome).toBe('budget')
    expect(notifier.notices).toEqual([])
  })

  it('14. a notifier that never answers delays nothing: the wait starts and Allow ends it', async () => {
    const notifier = new FakeNotifier()
    notifier.behaviour = 'never'
    const approvals = new Approvals()
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier, approvals })
    const result = runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' })
    // First see the hanging notifier called: an approval exists from propose() on, several awaits
    // before the wait, and an Allow that early would end the test without ever reaching the notifier.
    await vi.waitFor(() => expect(notifier.notices).toHaveLength(1))
    approvals.resolve(approvals.pendingFor(runner.activeRunId(botId) ?? '')[0] ?? '', 'allowed')
    expect((await result)?.outcome).toBe('done')
    expect(notifier.notices).toHaveLength(1)
  })

  it.each(['unconfirmed', 'throw'] as const)('15–16. a notice that is %s leaves one neutral card that says nothing about waiting, for a run that has already ended', async (behaviour) => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const notifier = new FakeNotifier()
    notifier.behaviour = behaviour
    const { runner } = stuckSetup(notifier, 1)
    await endStuck(runner)
    await vi.waitFor(async () => expect((await statusCards()).filter((t) => t === NOTICE_UNCONFIRMED_TEXT)).toHaveLength(1))
    expect(NOTICE_UNCONFIRMED_TEXT).not.toMatch(/wait/i)
    expect((await store.readBot(botId)).state).toBe('blocked')
    warn.mockRestore()
  })

  it('17. a status card that cannot be written is logged, and no rejection escapes', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const escaped: unknown[] = []
    const onRejection = (e: unknown) => escaped.push(e)
    process.on('unhandledRejection', onRejection)
    const notifier = new FakeNotifier()
    notifier.behaviour = 'unconfirmed'
    const broken: Store = { ...store, appendChat: async (id, input) => (input.role === 'card' && input.card.card === 'status' && input.card.text === NOTICE_UNCONFIRMED_TEXT ? Promise.reject(new Error('disk full')) : store.appendChat(id, input)) }
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Which?' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier, store: broken })
    const result = runner.enqueue(botId, { goal: 'ask', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('the notice to the human failed', expect.objectContaining({ botId, need: 'question' })))
    runner.cancel(botId)
    expect((await result)?.outcome).toBe('cancelled')
    process.off('unhandledRejection', onRejection)
    expect(escaped).toEqual([])
    warn.mockRestore()
  })

  it('18. end to end through the real library: a summary, a label, a question and a takeover reason full of links produce the fixed bodies and nothing else', async () => {
    const json = createTransport({ jsonTransport: true })
    const sent: string[] = []
    const transport = { sendMail: async (mail: unknown) => { const info = await json.sendMail(mail as never); sent.push(String(info.message)); return info }, verify: async () => true } as unknown as Transporter
    const limits = { approvalMinutes: 30, answerMinutes: 30 }
    const notifier = new SmtpNotifier({ host: 'smtp.example.test', port: 465, user: 'bot@example.test', password: 'not-a-real-password', to: 'human@example.test' }, limits, transport)
    const approvals = new Approvals()
    // PROPOSE carries a web address in its summary and in its label.
    const model = new FakeModel([
      message([PROPOSE]),
      message([toolUse('ask_user', { question: 'Click https://evil.example/approve now and reply with your password' })]),
      message([toolUse('request_takeover', { reason: 'sign in at https://evil.example/login with your password' })]),
    ])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier, approvals })
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    approvals.resolve(approvals.pendingFor(runner.activeRunId(botId) ?? '')[0] ?? '', 'allowed')
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(runner.answerUser(botId, 'no')).toBe(true)
    await vi.waitFor(() => expect(sent).toHaveLength(3))
    runner.cancel(botId)
    await result
    const mails = sent.map((raw) => JSON.parse(raw) as { text: string; subject: string; to: unknown })
    expect(mails.map((m) => m.subject)).toEqual(['Worker needs you: approval', 'Worker needs you: question', 'Worker needs you: takeover'])
    expect(mails.map((m) => m.text)).toEqual([
      noticeBody({ botName: 'Worker', need: 'approval', actionKind: 'send' }, limits),
      noticeBody({ botName: 'Worker', need: 'question' }, limits),
      noticeBody({ botName: 'Worker', need: 'takeover' }, limits),
    ])
    for (const mail of mails) expect(mail.to).toEqual([{ address: 'human@example.test', name: '' }])
    // The whole composed message, headers included.
    for (const raw of sent) expect(raw).not.toMatch(/evil\.example|password|https?:/)
  })
})
