import { describe, expect, it } from 'vitest'
import { APPROVAL_STEPS, Approvals, coversControl, needsApproval, pageOf, sameControl } from './gate'

const element = (name: string, url = 'https://example.com/book/slot?x=1') => ({ name, url })

describe('Approvals (signal A)', () => {
  it('matches an allowed approval once: the second lookup after consume finds nothing', () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 5, { kind: 'book', target: 'Schedule Event', page: 'https://example.com/book/slot' })
    expect(approvals.findMatch('run-1', 6, element('Schedule Event'))).toBeNull() // still pending
    approvals.resolve(a.id, 'allowed')
    const match = approvals.findMatch('run-1', 6, element('  schedule   event '))
    expect(match?.id).toBe(a.id)
    approvals.consume(a.id)
    expect(approvals.findMatch('run-1', 7, element('Schedule Event'))).toBeNull()
  })

  it('does not match a different label, a different path or another run', () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 1, { kind: 'submit', target: 'Odeslat', page: 'https://example.com/apply' })
    approvals.resolve(a.id, 'allowed')
    expect(approvals.findMatch('run-1', 2, element('Odeslat', 'https://example.com/apply'))?.id).toBe(a.id)
    expect(approvals.findMatch('run-1', 2, element('Odeslat', 'https://example.com/apply?step=2#top'))?.id).toBe(a.id)
    expect(approvals.findMatch('run-1', 2, element('Odeslat vše', 'https://example.com/apply'))).toBeNull()
    expect(approvals.findMatch('run-1', 2, element('Odeslat', 'https://example.com/other'))).toBeNull()
    expect(approvals.findMatch('run-2', 2, element('Odeslat', 'https://example.com/apply'))).toBeNull()
  })

  // The origin is part of the page: with the path alone, an approval for a label on one site would
  // cover the same label on the same path of another site. The same label on another origin is
  // another control.
  it('does not match the same label on the same path of another site, scheme or port', () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 1, { kind: 'submit', target: 'Odeslat', page: 'https://example.com/apply' })
    approvals.resolve(a.id, 'allowed')
    expect(approvals.findMatch('run-1', 2, element('Odeslat', 'https://other.example/apply'))).toBeNull()
    expect(approvals.findMatch('run-1', 2, element('Odeslat', 'http://example.com/apply'))).toBeNull()
    expect(approvals.findMatch('run-1', 2, element('Odeslat', 'https://example.com:8443/apply'))).toBeNull()
    expect(approvals.findMatch('run-1', 2, element('Odeslat', 'https://example.com/apply'))?.id).toBe(a.id)
  })

  it('expires after ten steps', () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 10, { kind: 'send', target: 'Send', page: 'https://example.com/mail' })
    approvals.resolve(a.id, 'allowed')
    expect(approvals.findMatch('run-1', 10 + APPROVAL_STEPS, element('Send', 'https://example.com/mail'))?.id).toBe(a.id)
    expect(approvals.findMatch('run-1', 11 + APPROVAL_STEPS, element('Send', 'https://example.com/mail'))).toBeNull()
  })

  it('a denied approval never matches', () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 1, { kind: 'send', target: 'Send', page: 'https://example.com/mail' })
    approvals.resolve(a.id, 'denied')
    expect(approvals.findMatch('run-1', 2, element('Send', 'https://example.com/mail'))).toBeNull()
  })

  it('resolve reports unknown and already-decided approvals, and waitFor settles with the decision', async () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 1, { kind: 'pay', target: 'Pay', page: 'https://example.com/checkout' })
    const waiting = approvals.waitFor(a.id)
    expect(approvals.resolve('nope', 'allowed')).toBe('not-found')
    expect(approvals.resolve(a.id, 'denied')).toBe('ok')
    expect(approvals.resolve(a.id, 'allowed')).toBe('not-pending')
    expect(await waiting).toBe('denied')
    expect(await approvals.waitFor(a.id)).toBe('denied')
    expect(approvals.get(a.id)?.status).toBe('denied')
  })

  it('pendingOrAllowedFor returns the newest usable approval of the run', () => {
    const approvals = new Approvals()
    expect(approvals.pendingOrAllowedFor('run-1', 1)).toBeNull()
    const a = approvals.propose('bot-1', 'run-1', 1, { kind: 'send', target: 'A', page: 'https://example.com/a' })
    expect(approvals.pendingOrAllowedFor('run-1', 1)?.id).toBe(a.id)
    approvals.resolve(a.id, 'allowed')
    expect(approvals.pendingOrAllowedFor('run-1', 5)?.id).toBe(a.id)
    expect(approvals.pendingOrAllowedFor('run-1', 12)).toBeNull() // expired
    approvals.consume(a.id)
    expect(approvals.pendingOrAllowedFor('run-1', 5)).toBeNull()
  })
})

describe('needsApproval', () => {
  it('fails closed: requireApproval beats alwaysAllow', () => {
    expect(needsApproval('send', { requireApproval: ['*'], alwaysAllow: ['send'] })).toBe(true)
  })

  it('allows only what alwaysAllow names and nothing else', () => {
    expect(needsApproval('send', { requireApproval: [], alwaysAllow: ['send'] })).toBe(false)
    expect(needsApproval('book', { requireApproval: [], alwaysAllow: [] })).toBe(true)
    expect(needsApproval('book', { requireApproval: [], alwaysAllow: ['b*'] })).toBe(false)
    expect(needsApproval('submit-control', { requireApproval: ['submit*'], alwaysAllow: ['*'] })).toBe(true)
  })
})

describe('pageOf', () => {
  it('returns the origin and path of a URL, without query and hash, and an empty string for garbage', () => {
    expect(pageOf('https://example.com/a/b?c=1#d')).toBe('https://example.com/a/b')
    expect(pageOf('https://example.com:8443/a')).toBe('https://example.com:8443/a')
    expect(pageOf('https://example.com')).toBe('https://example.com/')
    expect(pageOf('')).toBe('')
    expect(pageOf('not a url')).toBe('')
  })
})

describe('coversControl', () => {
  it('compares the label loosely and the page exactly', () => {
    const approval = { target: 'Schedule Event', page: 'https://example.com/book' }
    expect(coversControl(approval, { name: ' schedule   EVENT ', url: 'https://example.com/book?d=1' })).toBe(true)
    expect(coversControl(approval, { name: 'Schedule Event', url: 'https://example.com/book/' })).toBe(false)
    expect(coversControl(approval, { name: 'Schedule Event', url: 'https://evil.example/book' })).toBe(false)
  })
})

// ---- Signal B and the secret guard ----

import type { ElementInfo } from '../sandbox/port'
import { parseAction, type ComputerAction } from './actions'
import { evaluate, gatedKind, isFileInput, matchRule, needsSecretCheck, secretGuard } from './gate'

const URL_FORM = 'https://example.com/apply'

function el(overrides: Partial<Extract<ElementInfo, { target: 'element' }>>): ElementInfo {
  return {
    target: 'element',
    tag: 'button',
    type: null,
    role: null,
    name: '',
    inForm: false,
    isSubmit: false,
    autocomplete: null,
    inputMode: null,
    pattern: null,
    maxLength: null,
    url: URL_FORM,
    title: 'Form',
    ...overrides,
  }
}

const UNKNOWN: ElementInfo = { target: 'unknown', reason: 'cross-origin frame', url: URL_FORM, title: 'Form' }

function action(name: string, input: unknown): ComputerAction {
  const parsed = parseAction(name, input)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed
}

describe('matchRule', () => {
  it.each<[string, ElementInfo, ReturnType<typeof matchRule>]>([
    ['button type=submit in a form', el({ type: 'submit', inForm: true, isSubmit: true, name: 'Continue' }), 'submit-control'],
    ['button without type in a form', el({ inForm: true, isSubmit: true, name: 'Continue' }), 'submit-control'],
    ['button without type outside a form named Menu', el({ name: 'Menu' }), null],
    ['input type=submit', el({ tag: 'input', type: 'submit', isSubmit: true, name: 'Go' }), 'submit-control'],
    ['plain button "Odeslat zájem"', el({ name: 'Odeslat zájem' }), 'verb-name'],
    ['plain button "Apply now"', el({ name: 'Apply now' }), 'verb-name'],
    ['plain button "Schedule Event"', el({ name: 'Schedule Event' }), 'verb-name'],
    ['plain button "Sign in"', el({ name: 'Sign in' }), null],
    ['plain button "Sort order"', el({ name: 'Sort order' }), null],
    ['six-word name starting with a verb', el({ name: 'Send me the weekly newsletter and other updates' }), null],
    ['link named "Book"', el({ tag: 'a', name: 'Book' }), 'verb-name'],
    ['div with role=button named "Pay"', el({ tag: 'div', role: 'button', name: 'Pay' }), 'verb-name'],
    ['span named "Pay" with no role', el({ tag: 'span', name: 'Pay' }), null],
    ['unknown target', UNKNOWN, 'unknown-target'],
  ])('click on %s', (_label, element, expected) => {
    expect(matchRule('click', element)).toBe(expected)
  })

  it('Enter on a focused input inside a form is enter-in-form; on a focused submit button it is submit-control', () => {
    expect(matchRule('key-activate', el({ tag: 'input', type: 'text', inForm: true, name: 'Email' }))).toBe('enter-in-form')
    expect(matchRule('newline', el({ tag: 'input', type: 'text', inForm: true, name: 'Email' }))).toBe('enter-in-form')
    expect(matchRule('key-activate', el({ tag: 'input', type: 'text', inForm: false, name: 'Search' }))).toBeNull()
    expect(matchRule('key-activate', el({ type: 'submit', inForm: true, isSubmit: true, name: 'Odeslat' }))).toBe('submit-control')
    expect(matchRule('click', el({ tag: 'input', type: 'text', inForm: true, name: 'Email' }))).toBeNull()
  })
})

describe('the send shortcut', () => {
  const mailBody = el({ tag: 'div', role: 'textbox', name: 'Message Body' })
  it('is a rule hit inside a text: a mail body, a textarea, text edited in place', () => {
    expect(matchRule('send-shortcut', mailBody)).toBe('send-shortcut')
    expect(matchRule('send-shortcut', el({ tag: 'textarea', name: 'Comment', inForm: true }))).toBe('send-shortcut')
    expect(matchRule('send-shortcut', el({ tag: 'div', name: '', editable: true }))).toBe('send-shortcut')
    expect(matchRule('send-shortcut', el({ tag: 'input', type: 'text', name: 'Subject', inForm: true }))).toBe('enter-in-form')
  })

  it('leaves a plain Enter inside a text alone (a line break), and the shortcut on a plain element too', () => {
    expect(matchRule('key-activate', mailBody)).toBeNull()
    expect(matchRule('newline', mailBody)).toBeNull()
    expect(matchRule('send-shortcut', el({ tag: 'div', name: 'Menu' }))).toBeNull()
  })
})

describe('gatedKind and needsSecretCheck', () => {
  it('classifies clicks, activating keys and typed newlines', () => {
    expect(gatedKind(action('left_click', { coordinate: [1, 1] }))).toBe('click')
    expect(gatedKind(action('double_click', {}))).toBe('click')
    expect(gatedKind(action('triple_click', {}))).toBe('click')
    expect(gatedKind(action('left_click_drag', { start_coordinate: [1, 1], coordinate: [2, 2] }))).toBe('click')
    expect(gatedKind(action('right_click', {}))).toBeNull()
    for (const text of ['Return', 'KP_Enter', 'space', 'Enter', 'Return+shift', 'KP_Space', 'Linefeed', 'ISO_Enter']) expect(gatedKind(action('key', { text }))).toBe('key-activate')
    for (const text of ['ctrl+Return', 'Return+ctrl', 'Control_L+KP_Enter', 'super+Enter', 'ctrl+shift+Return']) expect(gatedKind(action('key', { text }))).toBe('send-shortcut')
    expect(gatedKind(action('key', { text: 'Tab' }))).toBeNull()
    expect(gatedKind(action('hold_key', { text: 'Return', duration: 1 }))).toBe('key-activate')
    expect(gatedKind(action('hold_key', { text: 'shift', duration: 1 }))).toBeNull()
    expect(gatedKind(action('left_mouse_up', { coordinate: [1, 1] }))).toBe('click')
    expect(gatedKind(action('left_mouse_down', { coordinate: [1, 1] }))).toBeNull()
    expect(gatedKind(action('type', { text: 'hello\n' }))).toBe('newline')
    expect(gatedKind(action('type', { text: 'hello\r' }))).toBe('newline')
    expect(gatedKind(action('type', { text: 'hello' }))).toBeNull()
    expect(gatedKind(action('screenshot', {}))).toBeNull()
  })

  it('needsSecretCheck is true for type and for a single printable key', () => {
    expect(needsSecretCheck(action('type', { text: 'abc' }))).toBe(true)
    expect(needsSecretCheck(action('key', { text: 'a' }))).toBe(true)
    expect(needsSecretCheck(action('key', { text: '7' }))).toBe(true)
    expect(needsSecretCheck(action('hold_key', { text: '7', duration: 1 }))).toBe(true)
    expect(needsSecretCheck(action('hold_key', { text: 'shift', duration: 1 }))).toBe(false)
    expect(needsSecretCheck(action('key', { text: 'Tab' }))).toBe(false)
    expect(needsSecretCheck(action('key', { text: 'ctrl+a' }))).toBe(false)
    expect(needsSecretCheck(action('key', { text: 'Return' }))).toBe(false)
    expect(needsSecretCheck(action('left_click', {}))).toBe(false)
  })
})

describe('evaluate', () => {
  const rules = { requireApproval: ['*'], alwaysAllow: [] }
  const submit = el({ type: 'submit', inForm: true, isSubmit: true, name: 'Schedule Event' })

  it('consumes a matching allowed approval exactly once', () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 1, { kind: 'book', target: 'schedule event', page: 'https://example.com/apply' })
    approvals.resolve(a.id, 'allowed')
    const first = evaluate({ kind: 'click', element: submit, rules, approvals, runId: 'run-1', step: 2 })
    expect(first).toMatchObject({ decision: 'consume', rule: 'submit-control', approval: { id: a.id } })
    approvals.consume(a.id)
    const second = evaluate({ kind: 'click', element: submit, rules, approvals, runId: 'run-1', step: 3 })
    expect(second).toMatchObject({ decision: 'block', rule: 'submit-control', announced: false, mismatch: null })
  })

  it('blocks with the mismatch when the outstanding approval names another control', () => {
    const approvals = new Approvals()
    const a = approvals.propose('bot-1', 'run-1', 1, { kind: 'book', target: 'Confirm', page: 'https://example.com/apply' })
    approvals.resolve(a.id, 'allowed')
    const result = evaluate({ kind: 'click', element: submit, rules, approvals, runId: 'run-1', step: 2 })
    expect(result).toMatchObject({ decision: 'block', rule: 'submit-control', announced: true, mismatch: { id: a.id } })
  })

  it('blocks an unannounced hit, an unknown target, and still blocks when requireApproval covers everything', () => {
    const approvals = new Approvals()
    expect(evaluate({ kind: 'click', element: submit, rules, approvals, runId: 'run-1', step: 1 })).toMatchObject({ decision: 'block', announced: false })
    expect(evaluate({ kind: 'click', element: UNKNOWN, rules, approvals, runId: 'run-1', step: 1 })).toMatchObject({ decision: 'block', rule: 'unknown-target' })
    const closed = { requireApproval: ['*'], alwaysAllow: ['submit-control'] }
    expect(evaluate({ kind: 'click', element: submit, rules: closed, approvals, runId: 'run-1', step: 1 })).toMatchObject({ decision: 'block' })
  })

  it('allows a verb hit the rules always allow, and any click that hits no rule', () => {
    const approvals = new Approvals()
    const open = { requireApproval: [], alwaysAllow: ['verb-name'] }
    expect(evaluate({ kind: 'click', element: el({ name: 'Apply now' }), rules: open, approvals, runId: 'run-1', step: 1 })).toEqual({ decision: 'allow', rule: 'verb-name' })
    expect(evaluate({ kind: 'click', element: el({ name: 'Menu' }), rules, approvals, runId: 'run-1', step: 1 })).toEqual({ decision: 'allow', rule: null })
  })
})

describe('secretGuard and isFileInput', () => {
  it('blocks password and one-time-code fields, not text fields or unknown targets', () => {
    expect(secretGuard(el({ tag: 'input', type: 'password', name: 'Password' })).blocked).toBe(true)
    expect(secretGuard(el({ tag: 'input', type: 'text', autocomplete: 'one-time-code', name: 'Code' })).blocked).toBe(true)
    expect(secretGuard(el({ tag: 'input', type: 'text', name: 'Email' })).blocked).toBe(false)
    expect(secretGuard(UNKNOWN).blocked).toBe(false)
  })

  it('blocks a password field that was made visible, and a code field whose hint stands among other words', () => {
    expect(secretGuard(el({ tag: 'input', type: 'text', name: 'Password', isPassword: true })).blocked).toBe(true)
    expect(secretGuard(el({ tag: 'input', type: 'text', name: 'Password', isPassword: false })).blocked).toBe(false)
    expect(secretGuard(el({ tag: 'input', type: 'text', autocomplete: 'section-login One-Time-Code', name: 'Code' })).blocked).toBe(true)
    expect(secretGuard(el({ tag: 'input', type: 'text', autocomplete: 'section-login username', name: 'User' })).blocked).toBe(false)
  })

  it('recognises a file input', () => {
    expect(isFileInput(el({ tag: 'input', type: 'file', name: 'CV' }))).toBe(true)
    expect(isFileInput(el({ tag: 'input', type: 'text', name: 'CV' }))).toBe(false)
    expect(isFileInput(UNKNOWN)).toBe(false)
  })
})

// The browser's own frame (address bar, tab strip, the desktop panel) holds no page control. The
// page script reports a click there as `browser-ui`. Read as an unknown target, every such click
// would be a gate card.
describe('browser-ui', () => {
  const BROWSER_UI: ElementInfo = { target: 'browser-ui', reason: 'above the page', url: URL_FORM, title: 'Form' }

  it('a click or Enter on the browser frame hits no rule, even when the rules require approval for everything', () => {
    expect(matchRule('click', BROWSER_UI)).toBeNull()
    expect(matchRule('key-activate', BROWSER_UI)).toBeNull()
    const result = evaluate({ kind: 'click', element: BROWSER_UI, rules: { requireApproval: ['*'], alwaysAllow: [] }, approvals: new Approvals(), runId: 'r', step: 1 })
    expect(result).toEqual({ decision: 'allow', rule: null })
  })

  it('is neither a secret field nor a file input', () => {
    expect(secretGuard(BROWSER_UI)).toEqual({ blocked: false, reason: '' })
    expect(isFileInput(BROWSER_UI)).toBe(false)
  })
})

// The control is read again after the user's Allow: the page may have changed while they decided.
describe('sameControl', () => {
  const approval = { target: 'Odeslat zájem', page: URL_FORM }
  const sendLike = { type: 'submit', isSubmit: true, name: 'Odeslat zájem' }
  const send = el(sendLike)

  it('a known control must keep its label and its page', () => {
    expect(sameControl(approval, send, el({ ...sendLike, name: 'odeslat  zájem', url: `${URL_FORM}?x=1` }))).toBe(true)
    expect(sameControl(approval, send, el({ ...sendLike, name: 'Smazat účet' }))).toBe(false)
    expect(sameControl(approval, send, el({ ...sendLike, url: 'https://other.example/apply' }))).toBe(false)
    expect(sameControl(approval, send, UNKNOWN)).toBe(false)
    expect(sameControl(approval, send, { target: 'browser-ui', reason: 'above the page', url: URL_FORM, title: 'Form' })).toBe(false)
  })

  it('a control the companion could not read is the same while the page is the same and it is still unreadable', () => {
    const unknownApproval = { target: '', page: URL_FORM }
    expect(sameControl(unknownApproval, UNKNOWN, { ...UNKNOWN, reason: 'timeout' })).toBe(true)
    expect(sameControl(unknownApproval, UNKNOWN, { ...UNKNOWN, url: 'https://other.example/apply' })).toBe(false)
    expect(sameControl(unknownApproval, UNKNOWN, el({ name: '' }))).toBe(false)
  })
})
