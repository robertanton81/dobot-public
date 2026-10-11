import { randomUUID } from 'node:crypto'
import type { ElementInfo } from '../sandbox/port'
import type { ActionKind, ApprovalRules, RuleName } from '../store'
import type { ComputerAction } from './actions'

// The approval gate. Signal A: one-shot approvals scoped to a control label and a page (origin
// and path), consumed exactly once, valid for ten steps; after the user's Allow the control is read
// again, so the page cannot swap it while they decide. Signal B: generic DOM rules on every click, Enter,
// Space and typed newline, answered by the companion; typed text with a space is refused while a
// button holds the focus. The secret guard blocks typing into a
// password or one-time-code field. Fail closed: an unknown target is a rule hit, and a
// requireApproval pattern beats an alwaysAllow pattern. The browser's own frame above the page
// (a `browser-ui` target) holds no page control, so no rule applies there. Pure functions;
// run.ts applies them.

export const APPROVAL_STEPS = 10

export type ApprovalStatus = 'pending' | 'allowed' | 'denied'

export type Approval = {
  id: string
  botId: string
  runId: string
  kind: ActionKind
  target: string
  /** The page the control was on: origin and path, as pageOf() gives it. */
  page: string
  createdStep: number
  expiresStep: number
  consumed: boolean
  status: ApprovalStatus
  /** False for an answer that is not an action, such as a connect card: it never counts as a denied action. */
  action: boolean
}

export type Decision = 'allowed' | 'denied'

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The page part of a URL: origin (scheme, host, port) and path, without the query and the hash. An
 * unparseable URL gives '' so nothing matches it. The origin is part of it so that an approval for
 * "Send" on one site's /form never covers "Send" on another site's /form.
 */
export function pageOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return ''
  }
}

/** The page of an approval that is for no page (a connector call, a connect card): a value pageOf() never gives, so no page control can ever match it. */
export const CONNECTOR_PAGE = 'connector:'

/** Whether the approval is for this control: the same label (spaces and case aside) on the same page. */
export function coversControl(approval: Pick<Approval, 'target' | 'page'>, element: { name: string; url: string }): boolean {
  return normalizeLabel(approval.target) === normalizeLabel(element.name) && approval.page === pageOf(element.url)
}

/**
 * Whether the control read again after the user's decision is still the one they saw on the card.
 * A known control must carry the same label on the same page. A control the companion could not
 * read (a cross-origin frame) is still "the frame on this page" while the page is the same and it
 * is still unreadable; anything else at that point is a different control.
 */
export function sameControl(approval: Pick<Approval, 'target' | 'page'>, before: ElementInfo, after: ElementInfo): boolean {
  if (before.target === 'element') return after.target === 'element' && coversControl(approval, after)
  return after.target === before.target && pageOf(after.url) === approval.page
}

export class Approvals {
  private readonly byId = new Map<string, Approval>()
  private readonly waiters = new Map<string, (decision: Decision) => void>()

  propose(botId: string, runId: string, step: number, input: { kind: ActionKind; target: string; page: string; action?: boolean }): Approval {
    const approval: Approval = {
      id: randomUUID(),
      botId,
      runId,
      kind: input.kind,
      target: input.target,
      page: input.page,
      createdStep: step,
      expiresStep: step + APPROVAL_STEPS,
      consumed: false,
      status: 'pending',
      action: input.action ?? true,
    }
    this.byId.set(approval.id, approval)
    return approval
  }

  get(id: string): Approval | null {
    return this.byId.get(id) ?? null
  }

  /** The run's approvals nobody has decided yet: Stop denies them so the run can end. */
  pendingFor(runId: string): string[] {
    return [...this.byId.values()].filter((a) => a.runId === runId && a.status === 'pending').map((a) => a.id)
  }

  /** Whether one of the run's action cards was answered with Deny. A card nobody answered in time reads the same. */
  deniedFor(runId: string): boolean {
    return [...this.byId.values()].some((a) => a.runId === runId && a.action && a.status === 'denied')
  }

  /** The user's decision. 'not-found' and 'not-pending' let the HTTP layer answer 404 and 409. */
  resolve(id: string, decision: Decision): 'ok' | 'not-found' | 'not-pending' {
    const approval = this.byId.get(id)
    if (!approval) return 'not-found'
    if (approval.status !== 'pending') return 'not-pending'
    approval.status = decision
    const waiter = this.waiters.get(id)
    if (waiter) {
      this.waiters.delete(id)
      waiter(decision)
    }
    return 'ok'
  }

  /** Resolves when the user decides; at once when the decision was already made. */
  waitFor(id: string): Promise<Decision> {
    const approval = this.byId.get(id)
    if (!approval) return Promise.reject(new Error('unknown approval'))
    if (approval.status !== 'pending') return Promise.resolve(approval.status)
    return new Promise((resolve) => this.waiters.set(id, resolve))
  }

  /** The newest approval of the run that is pending, or allowed and still usable at this step. */
  pendingOrAllowedFor(runId: string, step: number): Approval | null {
    let newest: Approval | null = null
    for (const approval of this.byId.values()) {
      if (approval.runId !== runId) continue
      const usable = approval.status === 'pending' || (approval.status === 'allowed' && !approval.consumed && step <= approval.expiresStep)
      if (usable) newest = approval
    }
    return newest
  }

  /** An allowed, unconsumed, unexpired approval for exactly this label on exactly this page (origin and path). */
  findMatch(runId: string, step: number, element: { name: string; url: string }): Approval | null {
    for (const approval of this.byId.values()) {
      if (approval.runId !== runId || approval.status !== 'allowed' || approval.consumed) continue
      if (step > approval.expiresStep) continue
      if (!coversControl(approval, element)) continue
      return approval
    }
    return null
  }

  consume(id: string): void {
    const approval = this.byId.get(id)
    if (approval) approval.consumed = true
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  // Safe: the escape above quotes every regex metacharacter; only `*` becomes `.*`. The patterns come
  // from the operator's approval rules and are matched against short control labels.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return new RegExp(`^${escaped}$`, 'i')
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(name))
}

/** requireApproval wins over alwaysAllow; a name matched by neither needs approval too. */
export function needsApproval(name: string, rules: ApprovalRules): boolean {
  if (matchesAny(name, rules.requireApproval)) return true
  if (matchesAny(name, rules.alwaysAllow)) return false
  return true
}

// ---- Signal B: the DOM rules ----

export const VERBS = [
  'send', 'submit', 'apply', 'book', 'schedule', 'confirm', 'pay', 'buy', 'order', 'delete', 'remove', 'publish', 'post', 'accept', 'agree',
  'odeslat', 'potvrdit', 'rezervovat', 'zaplatit', 'koupit', 'objednat', 'smazat', 'odstranit', 'zveřejnit', 'souhlasím', 'přijmout',
]
const VERB_SET = new Set(VERBS)
const MAX_NAME_WORDS = 4
const ENTER_KEYS = new Set(['return', 'enter', 'kp_enter', 'iso_enter', 'linefeed'])
const ACTIVATING_KEYS = new Set([...ENTER_KEYS, 'space', 'kp_space'])
/** With Enter, these make the send shortcut of mail and chat pages. Shift is not one: Shift+Enter is a line break. */
const SEND_MODIFIERS = new Set(['ctrl', 'control', 'control_l', 'control_r', 'meta', 'meta_l', 'meta_r', 'super', 'super_l', 'super_r', 'cmd'])

export type GatedKind = 'click' | 'key-activate' | 'send-shortcut' | 'newline'

/**
 * Which kind of activation an action is, or null when no DOM rule applies (no companion call).
 * A mouse-up at a point is a click at that point (the browser fires the click on mouse-up);
 * a chord counts as activating when ANY of its keys is one (the order in the text is free);
 * Enter with Ctrl or Meta is the send shortcut, which also acts from inside a text.
 * Right and middle clicks do not activate a control in a browser and are not gated.
 */
export function gatedKind(action: ComputerAction): GatedKind | null {
  switch (action.name) {
    case 'left_click':
    case 'double_click':
    case 'triple_click':
    case 'left_click_drag':
    case 'left_mouse_up':
      return 'click'
    case 'key':
    case 'hold_key': {
      const keys = action.text.split('+').map((k) => k.toLowerCase())
      if (keys.some((k) => ENTER_KEYS.has(k)) && keys.some((k) => SEND_MODIFIERS.has(k))) return 'send-shortcut'
      return keys.some((k) => ACTIVATING_KEYS.has(k)) ? 'key-activate' : null
    }
    case 'type':
      return /[\r\n]/.test(action.text) ? 'newline' : null
    default:
      return null
  }
}

const SPACE_ACTIVATED_INPUTS = new Set(['submit', 'button', 'image', 'reset'])

/**
 * True when typed text holds a space and the focus sits on a control that a space activates (a
 * button, not a text field). Typed text is meant for a field, so run.ts refuses such a `type`
 * without a card. A focused element the companion cannot read gives false: text typed into a field
 * inside an embedded frame must stay possible, and the clicks and Enter there are still gated.
 */
export function typedSpaceActivates(text: string, el: ElementInfo): boolean {
  if (!text.includes(' ') || el.target !== 'element') return false
  if (el.isSubmit || el.tag === 'button' || el.role === 'button') return true
  return el.tag === 'input' && SPACE_ACTIVATED_INPUTS.has((el.type ?? '').toLowerCase())
}

/** True for actions that put characters into the focused field: `type`, and `key` or `hold_key` with one printable character. */
export function needsSecretCheck(action: ComputerAction): boolean {
  if (action.name === 'type') return true
  if (action.name === 'key' || action.name === 'hold_key') return action.text.length === 1
  return false
}

function verbHit(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > MAX_NAME_WORDS) return false
  const word = (words[0] ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return VERB_SET.has(word)
}

export function matchRule(kind: GatedKind, el: ElementInfo): RuleName | null {
  if (el.target === 'browser-ui') return null
  if (el.target === 'unknown') return 'unknown-target'
  if (el.isSubmit) return 'submit-control'
  if (kind !== 'click' && el.tag === 'input' && el.inForm) return 'enter-in-form'
  // Ctrl+Enter sends from inside the text: a mail body, a textarea of a form, a comment box. Plain
  // Enter there is a line break on most pages, so only the shortcut is a rule hit.
  if (kind === 'send-shortcut' && (el.tag === 'textarea' || el.role === 'textbox' || el.editable === true)) return 'send-shortcut'
  const activatable = el.tag === 'button' || el.tag === 'a' || el.tag === 'input' || el.role === 'button'
  if (activatable && verbHit(el.name)) return 'verb-name'
  return null
}

export type GateResult =
  | { decision: 'allow'; rule: RuleName | null }
  | { decision: 'consume'; rule: RuleName; approval: Approval }
  | { decision: 'block'; rule: RuleName; announced: boolean; mismatch: Approval | null }

export function evaluate(input: {
  kind: GatedKind
  element: ElementInfo
  rules: ApprovalRules
  approvals: Approvals
  runId: string
  step: number
}): GateResult {
  const rule = matchRule(input.kind, input.element)
  if (rule === null) return { decision: 'allow', rule: null }
  if (!needsApproval(rule, input.rules)) return { decision: 'allow', rule }
  if (input.element.target === 'element') {
    const approval = input.approvals.findMatch(input.runId, input.step, input.element)
    if (approval) return { decision: 'consume', rule, approval }
  }
  const outstanding = input.approvals.pendingOrAllowedFor(input.runId, input.step)
  return { decision: 'block', rule, announced: outstanding !== null, mismatch: outstanding }
}

// ---- The secret guard (invariant 5 in code) ----

/** Blocks typing into a password or one-time-code field. An unknown target does not block: typing is reversible; the gate covers activation. */
export function secretGuard(el: ElementInfo): { blocked: boolean; reason: string } {
  if (el.target !== 'element') return { blocked: false, reason: '' }
  if (el.type === 'password' || el.isPassword === true) return { blocked: true, reason: 'the focused field is a password field' }
  // The attribute is a list of words: a section name or a field group can stand before this one.
  if ((el.autocomplete ?? '').toLowerCase().split(/\s+/).includes('one-time-code')) return { blocked: true, reason: 'the focused field is a one-time-code field' }
  return { blocked: false, reason: '' }
}

/** A click on a file input would open the native picker, which nothing can drive; attach_file is the way. */
export function isFileInput(el: ElementInfo): boolean {
  return el.target === 'element' && el.tag === 'input' && el.type === 'file'
}
