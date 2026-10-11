import { describe, expect, it, vi } from 'vitest'
import { log } from '../log'
import { FakeSandbox } from './fakes'
import { handbackCode, Takeover, TakeoverController, UNANSWERED_REASON, UNCHANGED_REASON, UNCHANGED_UNREADABLE_REASON, UNREADABLE_REASON, UNSAFE_REASON, unsafeReason } from './takeover'

const start = { url: 'https://example.com/login', fingerprint: 'login|Sign in|2', unsafe: false }
const same = { ...start }
const changed = { url: 'https://example.com/inbox', fingerprint: 'inbox|Inbox|0', unsafe: false }

describe('Takeover.check', () => {
  it('for a secret-field takeover refuses while unsafe, refuses while unchanged, allows when both clear', () => {
    const t = new Takeover()
    t.start('secret-field', 'password', start)
    expect(t.check({ ...same, unsafe: true })).toEqual({ allowed: false, reason: UNSAFE_REASON })
    expect(t.check(same)).toEqual({ allowed: false, reason: UNCHANGED_REASON })
    expect(t.check({ ...changed, unsafe: true })).toEqual({ allowed: false, reason: UNSAFE_REASON })
    expect(t.check(changed)).toEqual({ allowed: true, reason: '' })
  })

  it('for a requested takeover the same rules apply as for secret-field', () => {
    const t = new Takeover()
    t.start('requested', 'the mailbox asks for a password', start)
    expect(t.check(same).allowed).toBe(false)
    expect(t.check(changed).allowed).toBe(true)
  })

  it('for stuck, budget and manual takeovers an unchanged page is allowed, an unsafe one is not', () => {
    for (const trigger of ['stuck', 'budget', 'manual'] as const) {
      const t = new Takeover()
      t.start(trigger, 'nudge', start)
      expect(t.check(same)).toEqual({ allowed: true, reason: '' })
      expect(t.check({ ...same, unsafe: true })).toEqual({ allowed: false, reason: UNSAFE_REASON })
    }
  })

  it('an unknown start state counts as changed by any real state', () => {
    const t = new Takeover()
    t.start('secret-field', 'password', { url: '', fingerprint: 'unknown', unsafe: false })
    expect(t.check(same).allowed).toBe(true)
  })
})

describe('TakeoverController', () => {
  function controller(sandbox: FakeSandbox, signal: AbortSignal = new AbortController().signal, onWaiting?: (trigger: string) => void) {
    const events: string[] = []
    const ctl = new TakeoverController({
      botId: 'b',
      runId: 'r',
      sandbox,
      signal,
      emit: async (e) => {
        events.push(e.type === 'takeover' ? `${e.status}:${e.reason}` : e.type)
      },
      postChat: async (input) => ({ id: 'card-1', t: '', botId: 'b', role: input.role, ...(input.role === 'card' ? { card: input.card } : { text: input.text }) }),
      updateChat: async () => undefined,
      setBotState: async () => undefined,
      ...(onWaiting ? { onWaiting } : {}),
    })
    return { ctl, events }
  }

  it('allows hand-back when no takeover is active', async () => {
    const { ctl } = controller(new FakeSandbox())
    expect(await ctl.state()).toEqual({ allowed: true, reason: '' })
    expect(await ctl.handback()).toEqual({ ok: true })
  })

  it('refuses hand-back while the companion does not answer, and again once it answers unsafe', async () => {
    const sandbox = new FakeSandbox()
    const { ctl, events } = controller(sandbox)
    sandbox.companion.states = [start]
    const ended = ctl.begin('secret-field', 'password', )
    while (!ctl.active) await new Promise((resolve) => setImmediate(resolve))
    sandbox.companion.pageStateError = new Error('timeout')
    expect(await ctl.state()).toEqual({ allowed: false, reason: UNANSWERED_REASON })
    expect(await ctl.handback()).toEqual({ ok: false, reason: UNANSWERED_REASON })
    expect(await ctl.handback(true)).toEqual({ ok: false, reason: UNANSWERED_REASON })
    sandbox.companion.pageStateError = null
    sandbox.companion.states = [{ ...changed, unsafe: true }]
    expect(await ctl.handback(true)).toEqual({ ok: false, reason: UNSAFE_REASON })
    sandbox.companion.states = [changed]
    expect(await ctl.handback()).toEqual({ ok: true })
    await ended
    expect(events).toEqual(['started:secret-field', `handback-refused:${UNANSWERED_REASON}`, `handback-refused:${UNANSWERED_REASON}`, `handback-refused:${UNSAFE_REASON}`, 'ended:handed back'])
  })

  it('the override hands back on an unchanged but safe page and says so in the event', async () => {
    const sandbox = new FakeSandbox()
    const { ctl, events } = controller(sandbox)
    sandbox.companion.states = [start]
    const ended = ctl.begin('requested', 'password', )
    while (!ctl.active) await new Promise((resolve) => setImmediate(resolve))
    expect(await ctl.handback()).toEqual({ ok: false, reason: UNCHANGED_REASON })
    expect(await ctl.state(true)).toEqual({ allowed: true, reason: '' })
    expect(await ctl.handback(true)).toEqual({ ok: true })
    await ended
    expect(events.at(-1)).toBe('ended:handed back by override: the page had not changed')
  })

  // The page asks for the state every two seconds while the human has the screen, so one of those
  // polls can still be waiting for the companion when the hand-back clears the takeover. The poll
  // must answer as for no takeover, not throw.
  it('a state poll that is in flight when the screen is handed back answers as if no takeover were active', async () => {
    const sandbox = new FakeSandbox()
    const { ctl, events } = controller(sandbox)
    sandbox.companion.states = [start]
    const ended = ctl.begin('requested', 'password')
    while (!ctl.active) await new Promise((resolve) => setImmediate(resolve))
    sandbox.companion.states = [changed]
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const answer = sandbox.companion.pageState.bind(sandbox.companion)
    let held = false
    sandbox.companion.pageState = async () => {
      if (!held) { held = true; await gate } // the first question (the poll) waits; the hand-back's own does not
      return answer()
    }
    const poll = ctl.state()
    expect(await ctl.handback()).toEqual({ ok: true })
    release()
    await expect(poll).resolves.toEqual({ allowed: true, reason: '' })
    await ended
    expect(events.at(-1)).toBe('ended:handed back')
  })

  it('tells its owner that the wait is real at the moment it registers it, with the trigger', async () => {
    const sandbox = new FakeSandbox()
    sandbox.companion.states = [start, changed]
    const seen: Array<{ trigger: string; active: boolean }> = []
    const { ctl } = controller(sandbox, undefined, (trigger) => seen.push({ trigger, active: ctl.active }))
    const waiting = ctl.begin('requested', 'the mailbox asks for a password')
    await vi.waitFor(() => expect(ctl.active).toBe(true))
    expect(seen).toEqual([{ trigger: 'requested', active: true }])
    expect(await ctl.handback()).toEqual({ ok: true })
    await waiting
    expect(seen).toHaveLength(1)
  })

  it('says nothing when the run was stopped before the wait is registered: begin() takes its stopped branch', async () => {
    const stop = new AbortController()
    const seen: string[] = []
    const { ctl } = controller(new FakeSandbox(), stop.signal, (trigger) => seen.push(trigger))
    stop.abort()
    expect(await ctl.begin('secret-field', 'password')).toBeNull()
    expect(seen).toEqual([])
    expect(ctl.active).toBe(false)
  })

  it('a hook that throws does not break the wait', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const sandbox = new FakeSandbox()
    sandbox.companion.states = [start, changed]
    const { ctl } = controller(sandbox, undefined, () => {
      throw new Error('hook broke')
    })
    const waiting = ctl.begin('requested', 'sign in')
    await vi.waitFor(() => expect(ctl.active).toBe(true))
    expect(await ctl.handback()).toEqual({ ok: true })
    await expect(waiting).resolves.not.toBeNull()
    expect(warn).toHaveBeenCalledWith('the takeover wait hook threw; the wait stands', expect.objectContaining({ botId: 'b' }))
    warn.mockRestore()
  })
})

// The focus inside a frame the companion cannot read is a page whose safety cannot be established;
// it is refused like a secret on screen, and the override does not lift it.
describe('an unreadable frame under the focus', () => {
  const unreadable = { ...changed, unsafe: true, unsafeReason: 'unreadable-frame' as const }

  it('is the secret check, with its own reason and the unsafe code', () => {
    expect(unsafeReason(unreadable)).toBe(UNREADABLE_REASON)
    expect(unsafeReason({ ...changed, unsafe: true })).toBe(UNSAFE_REASON)
    expect(unsafeReason({ ...changed, unsafe: true, unsafeReason: 'secret-field' })).toBe(UNSAFE_REASON)
    expect(unsafeReason(changed)).toBeNull()
    expect(handbackCode(UNREADABLE_REASON)).toBe('unsafe')
    expect(new Takeover().check(unreadable)).toEqual({ allowed: false, reason: UNREADABLE_REASON })
  })

  it('refuses hand-back, with and without the override, until the focus leaves the frame', async () => {
    const sandbox = new FakeSandbox()
    const events: string[] = []
    const ctl = new TakeoverController({
      botId: 'b',
      runId: 'r',
      sandbox,
      signal: new AbortController().signal,
      emit: async (e) => {
        events.push(e.type === 'takeover' ? `${e.status}:${e.reason}` : e.type)
      },
      postChat: async (input) => ({ id: 'card-1', t: '', botId: 'b', role: input.role, ...(input.role === 'card' ? { card: input.card } : { text: input.text }) }),
      updateChat: async () => undefined,
      setBotState: async () => undefined,
    })
    sandbox.companion.states = [start]
    const ended = ctl.begin('requested', 'a code')
    while (!ctl.active) await new Promise((resolve) => setImmediate(resolve))
    sandbox.companion.states = [unreadable]
    expect(await ctl.handback()).toEqual({ ok: false, reason: UNREADABLE_REASON })
    expect(await ctl.handback(true)).toEqual({ ok: false, reason: UNREADABLE_REASON })
    sandbox.companion.states = [changed]
    expect(await ctl.handback()).toEqual({ ok: true })
    await ended
    expect(events).toEqual(['started:requested', `handback-refused:${UNREADABLE_REASON}`, `handback-refused:${UNREADABLE_REASON}`, 'ended:handed back'])
  })
})

// The override must not lift the page-changed check on a page with a frame the companion cannot
// read: a typed code could still sit in that frame with the focus moved away.
describe('the override on a page with unreadable regions', () => {
  it('does not lift the page-changed check while part of the page is unreadable, and does once the page changed', () => {
    const t = new Takeover()
    t.start('requested', 'a code', start)
    const sameWithFrame = { ...same, unreadable: 1 }
    expect(t.check(sameWithFrame)).toEqual({ allowed: false, reason: UNCHANGED_REASON })
    expect(t.check(sameWithFrame, true)).toEqual({ allowed: false, reason: UNCHANGED_UNREADABLE_REASON })
    expect(handbackCode(UNCHANGED_UNREADABLE_REASON)).toBe('unsafe')
    expect(t.check({ ...same, unreadable: 0 }, true)).toEqual({ allowed: true, reason: '' })
    expect(t.check({ ...changed, unreadable: 1 })).toEqual({ allowed: true, reason: '' })
  })

  it('a manual takeover never needed the page to change, so the override changes nothing for it', () => {
    const t = new Takeover()
    t.start('manual', 'look', start)
    expect(t.check({ ...same, unreadable: 1 })).toEqual({ allowed: true, reason: '' })
  })
})
