import { errorFields, log } from '../log'
import type { CompanionPort, PageState, SandboxPort } from '../sandbox/port'
import type { Card, ChatInput, ChatMessage, RunEventBody, BotState } from '../store'
import type { TakeoverTrigger } from './run-context'

// Takeover: the human gets the screen, the loop waits. Hand-back is refused by the server while
// a password or code field with a value is visible, while the focus sits inside a frame the
// companion cannot read, and — for a takeover that started because a secret was needed — while
// the page has not changed, so a one-time code typed into a plain field cannot still be on screen
// when the loop resumes (invariant 5). The first two refusals are the secret check: "Hand back
// anyway" never lifts them. While the human has the screen no screenshot is taken and no model
// call is made.

export const UNSAFE_REASON = 'a password or code field still has a value on screen'
export const UNREADABLE_REASON = 'the focus is inside a frame I cannot read, so I cannot confirm no secret is on screen — finish that step and click outside the frame, or move past this page'
export const UNCHANGED_REASON = 'the page has not changed yet — finish the sign-in and move past this page (if this page is where you end up, use Hand back anyway)'
export const UNCHANGED_UNREADABLE_REASON = 'the page has not changed, and part of it is inside a frame I cannot read, so I cannot hand back anyway — move past this page'
export const UNANSWERED_REASON = 'the computer is not answering, so I cannot confirm the page is safe'
export const STOPPED_HOW = 'stopped by the user'

export type HandbackCode = 'ok' | 'unsafe' | 'unchanged' | 'unanswered'

/** The code the page switches on; the reason text is for the human. */
export function handbackCode(reason: string): HandbackCode {
  if (reason === UNSAFE_REASON || reason === UNREADABLE_REASON || reason === UNCHANGED_UNREADABLE_REASON) return 'unsafe'
  if (reason === UNCHANGED_REASON) return 'unchanged'
  if (reason === UNANSWERED_REASON) return 'unanswered'
  return 'ok'
}

/** The secret check: the refusal a page state calls for, or null when the page is safe to show the model. */
export function unsafeReason(now: PageState): string | null {
  if (!now.unsafe) return null
  return now.unsafeReason === 'unreadable-frame' ? UNREADABLE_REASON : UNSAFE_REASON
}

/** Only for the start of a takeover: any real state differs from it, and its `unsafe` is never read. */
const UNKNOWN_START: PageState = { url: '', fingerprint: 'unknown', unsafe: false }

/** Pure hand-back rules for one takeover. */
export class Takeover {
  active = false
  private trigger: TakeoverTrigger = 'manual'
  private startState: PageState = UNKNOWN_START

  start(trigger: TakeoverTrigger, _reason: string, startState: PageState): void {
    this.trigger = trigger
    this.startState = startState
    this.active = true
  }

  /**
   * Always requires a safe page; for a secret-driven takeover also a changed page. `force` (Hand
   * back anyway) lifts the page-changed check alone, and not while part of the page is unreadable:
   * a code typed into a frame the companion cannot see could still be there, and the way out is to
   * move past the page.
   */
  check(now: PageState, force = false): { allowed: boolean; reason: string } {
    const unsafe = unsafeReason(now)
    if (unsafe !== null) return { allowed: false, reason: unsafe }
    const needsChange = this.trigger === 'secret-field' || this.trigger === 'requested'
    if (needsChange && now.fingerprint === this.startState.fingerprint) {
      if (!force) return { allowed: false, reason: UNCHANGED_REASON }
      if ((now.unreadable ?? 0) > 0) return { allowed: false, reason: UNCHANGED_UNREADABLE_REASON }
    }
    return { allowed: true, reason: '' }
  }

  end(): void {
    this.active = false
  }
}

export type TakeoverDeps = {
  botId: string
  runId: string
  sandbox: SandboxPort
  /** The run's stop signal: once it is aborted, no takeover wait is entered. */
  signal: AbortSignal
  emit(event: RunEventBody): Promise<void>
  postChat(input: ChatInput): Promise<ChatMessage>
  updateChat(messageId: string, card: Card): Promise<void>
  setBotState(state: BotState, statusLine?: string): Promise<void>
  /**
   * Called once, at the line that registers the wait, so a takeover that was stopped while its
   * card was being written announces nothing (the notice mail hangs here). It runs inside the
   * wait's own registration: a throw is logged and the wait stands.
   */
  onWaiting?: (trigger: TakeoverTrigger) => void
}

type Waiting = { takeover: Takeover; cardId: string; reason: string; resolve: (how: string) => void }

/** Drives one run's takeovers: the loop calls begin() and waits; the HTTP layer calls state() and handback(). */
export class TakeoverController {
  private waiting: Waiting | null = null

  constructor(private readonly deps: TakeoverDeps) {}

  get active(): boolean {
    return this.waiting !== null
  }

  private get companion(): CompanionPort {
    return this.deps.sandbox.companion
  }

  /** null when the companion did not answer: the callers decide what that means. */
  private async readState(): Promise<PageState | null> {
    try {
      return await this.companion.pageState()
    } catch (e) {
      log.warn('page state unavailable during takeover', { botId: this.deps.botId, ...errorFields(e) })
      return null
    }
  }

  /** Blocks the bot, posts the card and resolves when the human handed back, with a fresh screenshot. */
  async begin(trigger: TakeoverTrigger, reason: string): Promise<Uint8Array | null> {
    const { emit, postChat, updateChat, setBotState } = this.deps
    const startState = (await this.readState()) ?? UNKNOWN_START
    const takeover = new Takeover()
    takeover.start(trigger, reason, startState)
    const card: Card = { card: 'takeover', reason, status: 'active' }
    await setBotState('blocked', reason)
    const posted = await postChat({ role: 'card', card })
    await emit({ type: 'takeover', status: 'started', reason: trigger })
    // A stop can arrive while the card and the event are being written, when no waiter exists to
    // wake. So the wait is not entered, and the takeover ends as a stop.
    const how = this.deps.signal.aborted
      ? STOPPED_HOW
      : await new Promise<string>((resolve) => {
          this.waiting = { takeover, cardId: posted.id, reason, resolve }
          try {
            this.deps.onWaiting?.(trigger)
          } catch (e) {
            log.warn('the takeover wait hook threw; the wait stands', { botId: this.deps.botId, runId: this.deps.runId, ...errorFields(e) })
          }
        })
    takeover.end()
    await updateChat(posted.id, { ...card, status: 'ended' })
    await emit({ type: 'takeover', status: 'ended', reason: how })
    // A stopped run ends as idle next; it does not pass through "working" on the way.
    if (how === STOPPED_HOW) return null
    await setBotState('working', 'working')
    try {
      return await this.deps.sandbox.screenshot()
    } catch (e) {
      log.warn('screenshot after hand-back failed', { botId: this.deps.botId, ...errorFields(e) })
      return null
    }
  }

  /**
   * Whether the human may hand back now, and why not. A companion that does not answer is a
   * refusal: "cannot tell" never counts as safe. With `force` the page-changed check is lifted — the
   * escape for a sign-in that ends on a page whose fingerprint never changed — and nothing else.
   */
  async state(force = false): Promise<{ allowed: boolean; reason: string }> {
    return (await this.decide(force)).result
  }

  private async decide(force: boolean): Promise<{ result: { allowed: boolean; reason: string }; now: PageState | null }> {
    const waiting = this.waiting
    if (!waiting) return { result: { allowed: true, reason: '' }, now: null }
    const now = await this.readState()
    // The takeover can end while the companion answers: the page's state poll that was in flight
    // when the human handed back, or pressed Stop. Nothing waits any more, so the answer is the one
    // for no takeover; the field itself is null now and must not be read.
    if (this.waiting !== waiting) return { result: { allowed: true, reason: '' }, now }
    if (now === null) return { result: { allowed: false, reason: UNANSWERED_REASON }, now }
    return { result: waiting.takeover.check(now, force), now }
  }

  /** Refuses (and logs the refusal as an event) or resumes the loop. */
  async handback(force = false): Promise<{ ok: true } | { ok: false; reason: string }> {
    const waiting = this.waiting
    if (!waiting) return { ok: true }
    const { result, now } = await this.decide(force)
    if (this.waiting !== waiting) return { ok: true } // ended meanwhile (a second hand-back, or Stop): nothing left to resume
    if (!result.allowed) {
      await this.deps.emit({ type: 'takeover', status: 'handback-refused', reason: result.reason })
      return { ok: false, reason: result.reason }
    }
    // The one case the secret check cannot decide: a region it could not read, with the focus
    // elsewhere and the page moved on. Allowed, and on record.
    if ((now?.unreadable ?? 0) > 0) log.warn('hand-back allowed with unreadable regions on the page', { botId: this.deps.botId, runId: this.deps.runId, unreadable: now?.unreadable })
    this.waiting = null
    waiting.resolve(force ? 'handed back by override: the page had not changed' : 'handed back')
    return { ok: true }
  }

  /** The user pressed Stop while they had the screen: the loop wakes and ends; nothing is checked. */
  cancel(): void {
    const waiting = this.waiting
    if (!waiting) return
    this.waiting = null
    waiting.resolve(STOPPED_HOW)
  }
}
