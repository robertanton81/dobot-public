import type { ElementInfo } from '../sandbox/port'
import type { RuleName } from '../store'
import { activationCount, type ComputerAction } from './actions'
import type { GateResult } from './gate'
import { MIN_SHOTS, MIN_SPAN_MS } from './stuck'

// The sentences a run says: to the user in the chat and on cards, and to the model in tool results.
// Each is a fixed text or a pure function of its arguments, so a test can read the exact words.

export const STOPPED_TEXT = 'Stopped at your request. Send me the next goal when you are ready.'
export const CUT_OFF_TEXT = 'My answer was cut off inside a tool call twice, so I stopped.'
export const CONTEXT_FULL_TEXT = 'I ran out of room to think about this run.'
export const REFUSED_TEXT = 'I cannot do this: the model refused to continue.'

export function stepsLeftText(left: number): string {
  return `You have ${left} computer steps left in this run. Finish the job within them, or say what is still missing and stop; an action you propose near the end may leave no steps to do it and to see its result.`
}

/**
 * The takeover card of a run the step or call budget ended. Names an approved action done in the
 * last two steps, whose result the bot never saw. Such a run writes no memory line about the
 * action, so without this sentence the next run meets an outcome it cannot explain.
 */
export function budgetEndText(first: string, lastApproved: { target: string; step: number } | null, step: number): string {
  const base = `${first} Take over to finish on my screen, then hand back and send me the next goal.`
  if (lastApproved === null || step - lastApproved.step > 2) return base
  const what = lastApproved.target.trim() === '' ? 'the action you approved' : `the approved "${lastApproved.target}"`
  return `${base} My last action was ${what}, and I did not see its result: check whether it went through, and tell me in the next goal.`
}

/**
 * What the model is told about an action the computer did not answer (a timeout, a dropped connection).
 * With a target, the action was the one the user approved: whether it happened is unknown, so the
 * approval is spent and the model must look and propose again.
 */
export function noAnswerText(action: string, approvedTarget: string | null = null): string {
  const base = `${action} got no answer from the computer in time; here is a fresh screenshot, check the page and go on`
  if (approvedTarget === null) return base
  return `${base}. It was the action you approved ("${approvedTarget}"): whether it happened is unknown, so that approval is spent; if the page shows it did not happen, propose it again`
}

/**
 * The warning that closes every failed run once an approved action got no answer in it: that action
 * may have gone through, so the user checks before anything is retried (the wording follows boot
 * recovery's unknownText). Null while no approved action is in doubt.
 */
/** Added to the summary of a run that ended after an approved action whose outcome is unknown. */
export const UNKNOWN_OUTCOME_SUMMARY = 'an approved action may or may not have happened'

export function unknownOutcomeWarning(unansweredApproval: string | null): string | null {
  if (unansweredApproval === null) return null
  const what = unansweredApproval.trim() === '' ? 'an action' : `"${unansweredApproval}"`
  return `You had approved ${what}, and I cannot tell whether it went through: check before you send the goal again.`
}

/**
 * The HTTP status that each error type of the model provider stands for (API errors docs, "HTTP
 * errors"). The provider can also send an error as an event inside an open stream (Streaming
 * messages docs, "Error events"). That response has already begun with 200, so the SDK's error
 * carries the type from the event's body and no status (core/streaming.js), and the type is then
 * the only sign of what kind of failure it is. The links to both pages, and the table of how a
 * model call can end, are in docs/evidence/2026-09-20-provider-refusal-in-stream.
 */
const STATUS_OF_ERROR_TYPE = new Map<string, number>([
  ['invalid_request_error', 400],
  ['authentication_error', 401],
  ['billing_error', 402],
  ['permission_error', 403],
  ['not_found_error', 404],
  ['conflict_error', 409],
  ['request_too_large', 413],
  ['rate_limit_error', 429],
  ['api_error', 500],
  ['timeout_error', 504],
  ['overloaded_error', 529],
])

/**
 * What to tell the user when the model provider answered a request with a refusal that a retry
 * cannot fix: a key it does not accept, no credit, a usage limit. Null for everything else (no
 * answer, a stalled stream, a busy or failing provider, a run that grew too large), where sending
 * the goal again may help.
 * Without this, a usage limit reads as "the model stopped answering … Send the goal again to
 * retry", and the user retries something that cannot work. A refusal is read the same way whether
 * it came as an HTTP error status or as an error event inside an open stream. Only an error
 * status counts: the stream of an error event began with 200, which says nothing about the
 * failure, so the type decides there. An error with neither an error status nor a known type says
 * nothing about a retry, so it is no refusal. Only fixed words leave this function: the
 * provider's own text can carry details of the request, and it stays in the server log. An error
 * type is named only when it is one of the table's own keys.
 */
export function providerRefusal(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null
  const sent = 'status' in e && typeof e.status === 'number' && e.status >= 400 ? e.status : null
  const type = sent === null && 'type' in e && typeof e.type === 'string' ? e.type : null
  const status = sent ?? (type === null ? undefined : STATUS_OF_ERROR_TYPE.get(type))
  if (status === undefined) return null
  // The SDK's message holds the text of the provider's error body. A usage limit is read from it
  // before the status is judged: the provider's monthly spend cap answers 429 with the error type
  // of a rate limit, and no later try passes until the cap is lifted (Rate limits docs, "Reaching
  // your spend cap"). Its body carries this code, which the provider names as the way to tell the
  // two apart, so the code is enough when the sentence next to it changes.
  const message = e instanceof Error ? e.message : ''
  if (/usage limit|enforced_spend_limit_reached/i.test(message)) return 'the organisation that owns this API key has reached its usage limit'
  // 408, 409 and 429 are the client errors the SDK itself retries: a later try may pass. 413 is a
  // request that grew too large inside this run, and a new run starts small again. The same holds
  // when this run's conversation outgrew the model's context window, which the provider answers
  // with 400 and "prompt is too long" (Context windows docs, "Context window overflow behavior").
  if (status >= 500 || status === 408 || status === 409 || status === 413 || status === 429 || /prompt is too long/i.test(message)) return null
  if (/credit balance/i.test(message)) return 'the account behind this API key has too little credit'
  if (status === 401) return 'the API key was not accepted'
  if (status === 403) return 'the API key has no permission for this request'
  if (status === 404) return 'the configured MODEL_ID is not a model this API key can use'
  return sent === null ? `it answered with an error of the type ${type}` : `it answered with HTTP ${status}`
}

/**
 * The end summary of a run that failed after the user denied an action in it. Such a run ends as
 * `denied`, which no event source tries again; the summary keeps what failed.
 */
export function deniedSummary(failure: string): string {
  return `${failure} (after a denied action)`
}

/** The end of a failed run's last chat line: a plain retry, or the unknown-outcome warning when it applies. */
export function nextStepAfterFailure(unansweredApproval: string | null): string {
  return unknownOutcomeWarning(unansweredApproval) ?? 'Send the goal again to retry.'
}

/**
 * A gated action that would activate its control more than once is refused before any approval is
 * consumed: one approval is one activation. Otherwise one Allow would cover `key Return` with a
 * repeat count, or a key held down. Null when the action activates at most once.
 */
export function multiActivationText(action: ComputerAction, rule: RuleName, name: string): string | null {
  const count = activationCount(action)
  if (count <= 1) return null
  const times = Number.isFinite(count) ? `${count} times` : 'over and over while the key is held'
  const once = 'do it once: a single click, key without repeat, or type with at most one newline'
  if (rule === 'unknown-target') return `I cannot see what this would activate — it is inside an embedded frame or an unknown element — and it would activate ${times}; ${once}, and I will ask the user then`
  const label = name ? `"${name}"` : 'this control'
  return `this would activate ${label} ${times}; one approval covers one activation, so ${once}`
}

/** The refusal for typed text that would press the focused button with its first space. */
export function typeOnControlText(name: string): string {
  const label = name ? `"${name}"` : 'a button'
  return `the keyboard focus is on ${label}, not on a text field, so a space in this text would activate it; click the text field you mean first, then type`
}

export function blockSummary(result: GateResult & { decision: 'block' }, name: string): string {
  if (result.rule === 'unknown-target') return 'I cannot see what this click does — it is inside an embedded frame or an unknown element'
  if (result.mismatch) return `This is not the action you approved ("${result.mismatch.target}" on ${result.mismatch.page || 'an unknown page'})`
  return `I was about to activate "${name}" without announcing it`
}

/**
 * The tool result when the control at the approved point changed while the user decided: nothing
 * ran, and the approval is kept for the control they saw, wherever it is now.
 */
export function changedTargetText(approved: string, now: ElementInfo): string {
  const label = approved ? `"${approved}"` : 'the control the user allowed'
  const seen = now.target === 'element' ? (now.name ? `"${now.name}"` : 'a control with no name') : now.target === 'browser-ui' ? "the browser's own frame" : 'something I cannot read'
  return `not done: the page changed while the user decided, and that point now holds ${seen} instead of ${label}; take a screenshot, find ${label} again and activate it where it is now — the approval still covers it for the next 10 steps`
}

/** The takeover card of a run the stuck detector ended. */
export const STUCK_TEXT = `The screen has not changed for ${Math.round(MIN_SPAN_MS / 1000)} seconds across ${MIN_SHOTS} or more screenshots, so I stopped. Take over to move things along on my screen, then hand back and send me the next goal.`
