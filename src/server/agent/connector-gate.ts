import { ConnectorError, type ConnectorEnv, type ConnectorTool } from '../connectors/types'
import { errorFields, log } from '../log'
import { CHAT_LIMITS, type Card } from '../store'
import { CONNECTOR_PAGE } from './gate'
import type { RunContext } from './run-context'
import { DENIED_TEXT, OutcomeUnknownError, ToolError } from './tools'

// The gate for connector calls. A tool marked read in code runs. A tool marked write stops at an
// approval card every time, whatever approval-rules.json says, and runs only after Allow once. The
// approval is consumed before the call, so it can never cover a control on a page. Deny, Stop and a
// card nobody answers all mean the call is never made.

export const CONNECTOR_TIMEOUT_MS = 20_000
export const CONNECTOR_MAX_CHARS = 20_000
export const STOPPED_CALL_TEXT = 'not run: the user stopped this run'

export function unknownWriteText(tool: string): string {
  return `${tool} did not answer in time; whether it happened is unknown. Do not call it again: tell the user what you tried and let them check.`
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function cut(text: string): string {
  if (text.length <= CONNECTOR_MAX_CHARS) return text
  return `${text.slice(0, CONNECTOR_MAX_CHARS)}\n\n[truncated: the result has ${text.length} characters; only the first ${CONNECTOR_MAX_CHARS} are shown]`
}

/** `timeoutMs` is a parameter so a test can use a short limit; the registry always passes the default. */
export async function runConnectorTool(
  toolName: string,
  tool: ConnectorTool,
  input: never,
  env: ConnectorEnv,
  ctx: RunContext,
  timeoutMs = CONNECTOR_TIMEOUT_MS,
): Promise<string> {
  // What the user approved, in the card's words; null for a read, whose outcome never matters.
  let approved: string | null = null
  if (tool.class === 'write') {
    // The user approves what the card shows. Arguments that would be cut on the card are refused
    // before any card, so no approval ever covers text the user did not see.
    const shown = JSON.stringify(input, null, 2)
    if (shown.length > CHAT_LIMITS.long) {
      throw new ToolError(`${toolName} was not proposed: its content is too long to show in full on the approval card (${shown.length} characters, at most ${CHAT_LIMITS.long}); shorten it`)
    }
    const kind = tool.kind ?? 'other'
    const summary = tool.consequence?.(input) ?? `${toolName} changes something outside`
    approved = summary
    const approval = ctx.approvals.propose(ctx.botId, ctx.runId, ctx.progress.step, { kind, target: toolName, page: CONNECTOR_PAGE })
    const card: Card = {
      card: 'approval',
      approvalId: approval.id,
      runId: ctx.runId,
      actionKind: kind,
      summary,
      consequences: [],
      warnings: [],
      target: toolName,
      url: '',
      shot: null,
      status: 'pending',
      announced: true,
      connectorTool: toolName,
      connectorArgs: shown,
    }
    const posted = await ctx.postChat({ role: 'card', card })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: 'pending' })
    await ctx.setBotState('waiting', `waiting for your approval: ${toolName}`)
    const decision = await ctx.waitForApproval(approval.id)
    ctx.approvals.consume(approval.id)
    await ctx.setBotState('working', 'working')
    await ctx.updateChat(posted.id, { ...card, status: decision })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: decision })
    if (decision === 'denied') return DENIED_TEXT
    if (ctx.cancelRequested()) return STOPPED_CALL_TEXT
  }
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ctx.cancelSignal])
  try {
    // The gate stops waiting when the signal fires, even if a connector ignores it: a run never
    // hangs on a service. The connector's own abort handling then only frees its connection.
    return cut(await Promise.race([tool.run(input, env, signal), untilAborted(signal)]))
  } catch (e) {
    if (e instanceof ConnectorError) throw new ToolError(e.message)
    // An approved write that was cut off may have happened: the run is told so in a structured way.
    if (ctx.cancelRequested()) throw approved === null ? new ToolError(STOPPED_CALL_TEXT) : new OutcomeUnknownError(`${STOPPED_CALL_TEXT}; ${unknownWriteText(toolName)}`, approved)
    if (signal.aborted) throw approved === null ? new ToolError(`${toolName} did not answer in time`) : new OutcomeUnknownError(unknownWriteText(toolName), approved)
    // Anything else may carry a path, an address with a key or a server's detail: the model gets the error's name.
    log.warn('connector call failed', { botId: ctx.botId, runId: ctx.runId, tool: toolName, ...errorFields(e) })
    throw new ToolError(`${toolName} failed (${errorFields(e).errorName})`)
  }
}
