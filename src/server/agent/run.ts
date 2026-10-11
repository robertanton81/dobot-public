import type Anthropic from '@anthropic-ai/sdk'
import { errorFields, log } from '../log'
import { SandboxActionError, type ElementInfo, type Point } from '../sandbox/port'
import type { RuleName, RunOutcome, Skill } from '../store'
import { describeAction, executeAction, loggableInput, parseAction, PartialActionError, targetPoint, type ComputerAction } from './actions'
import { firstUserMessage, RECENT_LOOKBACK, recentConversation, runClockLine } from './context'
import { evaluate, gatedKind, isFileInput, matchRule, needsSecretCheck, pageOf, sameControl, secretGuard, typedSpaceActivates } from './gate'
import { costUsd, usageOf } from './model'
import { buildSystemPrompt } from './prompt'
import { NO_PROGRESS_STUCK_TEXT, ProgressGuard } from './progress'
import type { RunContext, ToolDef } from './run-context'
import { blockSummary, budgetEndText, changedTargetText, CONTEXT_FULL_TEXT, CUT_OFF_TEXT, deniedSummary, multiActivationText, nextStepAfterFailure, noAnswerText, providerRefusal, REFUSED_TEXT, stepsLeftText, STOPPED_TEXT, STUCK_TEXT, typeOnControlText, UNKNOWN_OUTCOME_SUMMARY, unknownOutcomeWarning } from './run-text'
import { StuckDetector, type StuckKind } from './stuck'
import { DENIED_TEXT, HUMAN_STEP_TEXT, runPlatformTool, toolDefinitions } from './tools'

// One run = one goal on one bot: a plain loop over the Messages API with the computer toolset and
// the platform tools. The approval gate sits in this file, between the model's tool call and its
// execution (invariant 4); every computer action is executed on the real sandbox and logged as an
// event (invariants 1 and 2).

// Reaching a form can take about 50 computer steps. When a page refuses the first attempt, a run
// can need more than 100: a budget of 100 ends such a run right after its approved action, before
// it sees the result. The budget of 150 leaves room for that, and it bounds what one run can cost.
export const STEP_BUDGET = 150
const TURN_BUDGET = 200
/** With this many computer steps left, every tool result carries a notice, so the model can finish or stop instead of running into the cap. */
export const STEPS_LEFT_NOTICE = 15
/** How much of what the model wrote in a turn is kept in the run log. */
export const TEXT_LOG_CHARS = 4000
/** Only the API's summary goes in the log. Complete signed blocks stay in model context. */
export const THINKING_LOG_CHARS = 4000

const MAX_TOKENS = 16000
// The docs' rule for a response cut inside a tool call: retry with a higher limit, once.
const MAX_TOKENS_RAISED = 2 * MAX_TOKENS
const CUT_OFF_SUMMARY = 'the model answer was cut off inside a tool call twice'
// Old screenshots leave the conversation in batches. Removing one changes an early message, and the
// prompt cache matches whole prefixes, so every removal makes the next call write the conversation
// again. One screenshot removed per turn does that on every turn, and those cache writes are then
// the largest part of a run's cost (measured in docs/evidence/2026-09-18-cache-batching). Up to
// IMAGE_PRUNE_LIMIT images stay; one more drops the oldest down to IMAGES_KEPT in one pass. A limit
// equal to IMAGES_KEPT removes one image per turn, with no batching; a lower limit acts the same.
const IMAGES_KEPT = 3
const IMAGE_PRUNE_LIMIT = 13
const SUMMARY_CHARS = 200

export type RunInput = {
  goal: string
  activeSkill: Skill | null
  source: 'message' | 'routine'
  routineName?: string
}

/** `final` marks a failure that the same goal would meet again (a refusal, a full context): an event source must not try it again. */
export type RunResult = { outcome: RunOutcome; summary: string; final?: true }

type ShotRef = { block: Anthropic.Messages.ToolResultBlockParam; step: number }

export { HUMAN_STEP_TEXT }
const STOPPED_RESULT = 'the user stopped this run; do nothing more'

function stuckKind(action: ComputerAction): StuckKind {
  if (action.name === 'screenshot') return 'screenshot'
  if (action.name === 'wait' || action.name === 'zoom' || action.name === 'cursor_position') return 'wait'
  return 'other'
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? ''
  return line.trim().slice(0, SUMMARY_CHARS)
}

type CacheableBlock = Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam | Anthropic.Messages.ToolResultBlockParam

function cacheable(block: Anthropic.Messages.ContentBlockParam): block is CacheableBlock {
  return block.type === 'text' || block.type === 'image' || block.type === 'tool_result'
}

/** One moving cache breakpoint on the last block of the last user message. */
function setCacheBreakpoint(messages: Anthropic.Messages.MessageParam[]): void {
  let last: Anthropic.Messages.MessageParam | null = null
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (Array.isArray(message.content)) for (const block of message.content) if (cacheable(block)) delete block.cache_control
    last = message
  }
  if (!last) return
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }]
    return
  }
  const block = last.content[last.content.length - 1]
  if (block && cacheable(block)) block.cache_control = { type: 'ephemeral' }
}

function textOf(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim()
}

export async function runLoop(ctx: RunContext, input: RunInput): Promise<RunResult> {
  const bot = await ctx.store.readBot(ctx.botId)
  const memory = await ctx.store.readMemory(ctx.botId)
  const skills = await ctx.store.listSkills(ctx.botId)
  const routinePart = input.source === 'routine' && input.routineName ? { routine: { name: input.routineName, skill: input.activeSkill?.name ?? '', instruction: input.goal } } : {}
  const systemFor = (catalog: string[]): Anthropic.Messages.TextBlockParam => ({
    type: 'text',
    text: buildSystemPrompt({ bot, memory, skills, activeSkill: input.activeSkill, connectors: catalog, ...routinePart }),
    cache_control: { type: 'ephemeral' },
  })
  // The bot's connectors add tools and a section of the prompt. Both are read again before every
  // model call and rebuilt only when the tool list changed (a connection granted during the run),
  // so every other call sends the same prefix and reads it from the prompt cache.
  let connectors = await ctx.connectors.snapshot(ctx.botId)
  let runTools: ToolDef[] = [...ctx.tools, ...connectors.tools]
  const system: Anthropic.Messages.TextBlockParam[] = [systemFor(connectors.catalog)]
  let tools: Anthropic.Messages.ToolUnion[] = [{ type: 'computer_toolset_20260801' }, ...toolDefinitions(runTools)]
  const recent = recentConversation(await ctx.store.readChat(ctx.botId, { limit: RECENT_LOOKBACK }), input.goal, bot.name)
  // Read once: the first message must stay the same for every model call of the run (the prompt cache).
  const clock = runClockLine(new Date((ctx.now ?? Date.now)()), ctx.timezone)
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: firstUserMessage(clock, recent, input.goal) }]
  const stuck = new StuckDetector(ctx.now)
  const progress = new ProgressGuard()
  const shots: ShotRef[] = []
  let step = 0
  let turns = 0
  let maxTokens = MAX_TOKENS
  let lastShot: Uint8Array | null = null
  let lastAction = 'starting'
  // One action the computer did not answer is handed to the model with a fresh screenshot, if the
  // companion still answers. A second one ends the run, unless an action ran in between. A single
  // timeout on one input command is not a reason to end a run and make the user send the goal again.
  let lastFailed = false
  // The target of the last approved action the computer did not answer in this run. Its outcome stays
  // unknown for the rest of the run, so a run that fails afterwards says so instead of inviting a plain
  // retry. Kept in an object for the reason given at `activity` below.
  const unanswered: { approval: string | null } = { approval: null }
  /** The last approved action and the step it ran at, for the budget end's card. */
  let lastApproved: { target: string; step: number } | null = null
  const companionAnswers = async (): Promise<boolean> => {
    try {
      return (await ctx.sandbox.companion.health()).ok
    } catch {
      return false
    }
  }
  // Which side was busy when an error escaped: it decides the wording of the failure message.
  // Kept in an object and set through a closure so the catch block sees the union, not a narrowed literal.
  const activity: { phase: 'model' | 'sandbox' } = { phase: 'model' }
  const markPhase = (p: 'model' | 'sandbox'): void => {
    activity.phase = p
  }

  const end = async (outcome: RunOutcome, summary: string, final = false): Promise<RunResult> => {
    // A run that failed or finished after an approved action whose outcome is unknown ends as
    // `unknown` and final: no event source may try it again, and "done" would record a result the
    // platform never confirmed. The failure paths have told the user in chat. At the end of a turn
    // the model has had the tool's warning and may have checked the result itself, so no line is added.
    if ((outcome === 'failed' || outcome === 'done') && unanswered.approval !== null) {
      const result: RunResult = { outcome: 'unknown', summary: `${summary}; ${UNKNOWN_OUTCOME_SUMMARY}`, final: true }
      await ctx.emit({ type: 'end', outcome: result.outcome, summary: result.summary })
      log.info('run ended', { botId: ctx.botId, runId: ctx.runId, outcome: result.outcome, steps: step })
      return result
    }
    // A failed run hands the event that started it back for another automatic try. A run in which
    // the user denied an action does not: the next try would bring the same card again. Stop denies
    // the open cards too, and the runner names a stopped run itself.
    const afterDeny = outcome === 'failed' && !ctx.cancelRequested() && ctx.approvals.deniedFor(ctx.runId)
    const result: RunResult = afterDeny ? { outcome: 'denied', summary: deniedSummary(summary) } : { outcome, summary, ...(final ? { final: true as const } : {}) }
    await ctx.emit({ type: 'end', outcome: result.outcome, summary: result.summary })
    log.info('run ended', { botId: ctx.botId, runId: ctx.runId, outcome: result.outcome, steps: step })
    return result
  }

  const blockedEnd = async (outcome: 'stuck' | 'budget', reason: string): Promise<RunResult> => {
    await ctx.setBotState('blocked', reason)
    await ctx.postChat({ role: 'card', card: { card: 'takeover', reason, status: 'active' } })
    return end(outcome, reason)
  }

  const stoppedEnd = async (): Promise<RunResult> => {
    const warning = unknownOutcomeWarning(unanswered.approval)
    await ctx.postChat({ role: 'bot', text: warning === null ? STOPPED_TEXT : `${STOPPED_TEXT} ${warning}` })
    await ctx.setBotState('idle', 'stopped by you')
    return end('cancelled', 'stopped by the user')
  }

  // Only the image goes. A warning that came with it stays where it was, and so do the result's own
  // fields: "the action you approved may have happened" must outlive its screenshot (invariant 4).
  const pruneImages = (): void => {
    if (shots.length <= IMAGE_PRUNE_LIMIT) return
    while (shots.length > IMAGES_KEPT) {
      const old = shots.shift()
      if (old && Array.isArray(old.block.content)) {
        old.block.content = old.block.content.map((block) =>
          block.type === 'image'
            ? { type: 'text' as const, text: `screenshot after step ${old.step} (removed to save context)` }
            : block,
        )
      }
    }
  }

  // The approval gate and the secret guard, between the parsed action and its execution. An
  // approval that lets the action through is consumed only after the action ran (see handleComputer).
  type GateVerdict = { execute: true; consume: { approvalId: string; rule: RuleName; announced: boolean } | null } | { refused: string }
  const gate = async (action: ComputerAction): Promise<GateVerdict> => {
    const companion = ctx.sandbox.companion
    let focused: ElementInfo | null = null
    if (needsSecretCheck(action)) {
      focused = await companion.activeElement()
      const el = focused
      if (el.target !== 'element') log.warn('secret guard could not see the focused element; typing goes through', { botId: ctx.botId, runId: ctx.runId, step, reason: el.reason })
      const guard = secretGuard(el)
      if (guard.blocked) {
        await ctx.emit({ type: 'gate', step, decision: 'block', rule: null, announced: false, approvalId: null, reason: 'secret-field' })
        log.info('secret guard blocked typing', { botId: ctx.botId, runId: ctx.runId, step, reason: guard.reason })
        const shot = await ctx.takeover('secret-field', `The page asks for a secret (${guard.reason}). Take over, complete that step on my screen, then hand back.`)
        if (shot) lastShot = shot
        return { refused: `${HUMAN_STEP_TEXT}: the human handed the screen back; take a screenshot to see the result` }
      }
    }
    if (action.name === 'type' && focused !== null && typedSpaceActivates(action.text, focused)) {
      await ctx.emit({ type: 'gate', step, decision: 'block', rule: null, announced: false, approvalId: null, reason: 'focus-on-control' })
      return { refused: typeOnControlText(focused.target === 'element' ? focused.name : '') }
    }
    const kind = gatedKind(action)
    if (kind === null) return { execute: true, consume: null }
    let el: ElementInfo
    let point: Point | null = null
    if (kind === 'click') {
      point = targetPoint(action) ?? (await ctx.sandbox.cursorPosition())
      el = await companion.elementAt(point)
    } else {
      el = focused ?? (await companion.activeElement())
    }
    if (isFileInput(el)) {
      await ctx.emit({ type: 'gate', step, decision: 'block', rule: null, announced: false, approvalId: null, reason: 'file-input' })
      return { refused: 'this is a file upload control; do not activate it, call attach_file with its coordinate instead' }
    }
    const matched = matchRule(kind, el)
    const repeated = matched === null ? null : multiActivationText(action, matched, el.target === 'element' ? el.name : '')
    if (matched !== null && repeated !== null) {
      await ctx.emit({ type: 'gate', step, decision: 'block', rule: matched, announced: false, approvalId: null, reason: 'multi-activation' })
      log.info('gate refused an action that would activate a control more than once', { botId: ctx.botId, runId: ctx.runId, step, action: action.name, rule: matched })
      return { refused: repeated }
    }
    const result = evaluate({ kind, element: el, rules: ctx.rules, approvals: ctx.approvals, runId: ctx.runId, step })
    if (result.decision === 'allow') {
      const control = el.target === 'element' ? { kind, tag: el.tag, role: el.role, name: el.name, page: pageOf(el.url) } : undefined
      await ctx.emit({ type: 'gate', step, decision: 'allow', rule: result.rule, announced: false, approvalId: null, reason: result.rule ? 'allowed by your rules' : 'no rule', control })
      return { execute: true, consume: null }
    }
    if (result.decision === 'consume') {
      return { execute: true, consume: { approvalId: result.approval.id, rule: result.rule, announced: true } }
    }
    // Blocked: a card the user decides on. Allow creates a one-shot approval for exactly this control.
    const name = el.target === 'element' ? el.name : ''
    const url = el.url
    const summary = blockSummary(result, name)
    await ctx.emit({ type: 'gate', step, decision: 'block', rule: result.rule, announced: result.announced, approvalId: result.mismatch?.id ?? null, reason: summary })
    let shot: string | null = null
    try {
      shot = await ctx.store.writeShot(ctx.botId, ctx.runId, await ctx.sandbox.screenshot())
    } catch (e) {
      log.warn('screenshot for the block card failed', { botId: ctx.botId, runId: ctx.runId, step, ...errorFields(e) })
    }
    const approval = ctx.approvals.propose(ctx.botId, ctx.runId, step, { kind: 'other', target: name, page: pageOf(url) })
    const card = {
      card: 'approval' as const,
      approvalId: approval.id,
      runId: ctx.runId,
      actionKind: 'other' as const,
      summary,
      consequences: [],
      warnings: [`rule: ${result.rule}`],
      target: name,
      url,
      shot,
      status: 'pending' as const,
      announced: false,
    }
    const posted = await ctx.postChat({ role: 'card', card })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: 'pending' })
    await ctx.setBotState('waiting', `waiting for your approval: ${name || 'an unknown control'}`)
    const decision = await ctx.waitForApproval(approval.id)
    await ctx.setBotState('working', 'working')
    await ctx.updateChat(posted.id, { ...card, status: decision })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: decision })
    if (decision === 'denied') return { refused: DENIED_TEXT }
    // The user decided on the control the companion read before the card, and the page may have
    // moved on while they decided (a dialog, a redirect, a late layout shift). The point is read
    // again and only the control they saw is activated; the approval stays valid for that control,
    // so the next click on it goes through without a second card.
    const again = point === null ? await companion.activeElement() : await companion.elementAt(point)
    if (!sameControl(approval, el, again)) {
      await ctx.emit({ type: 'gate', step, decision: 'block', rule: result.rule, announced: false, approvalId: approval.id, reason: 'the control at that point changed while the user decided' })
      log.info('gate did not run an allowed action: the control changed while the user decided', { botId: ctx.botId, runId: ctx.runId, step, approved: name, now: again.target === 'element' ? again.name : again.target })
      return { refused: changedTargetText(name, again) }
    }
    return { execute: true, consume: { approvalId: approval.id, rule: result.rule, announced: false } }
  }

  /** `stuck` is the takeover card's text when this action ended the run as stuck, else null. */
  const handleComputer = async (block: Anthropic.Messages.ToolUseBlock): Promise<{ result: Anthropic.Messages.ToolResultBlockParam; stuck: string | null }> => {
    const parsed = parseAction(block.name, block.input)
    if ('error' in parsed) {
      await ctx.emit({ type: 'tool_result', step, name: block.name, ok: false, summary: parsed.error, shot: null })
      return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: parsed.error }, stuck: null }
    }
    step += 1
    ctx.progress.step = step
    await ctx.emit({ type: 'step', step, action: parsed.name, input: loggableInput(parsed) })
    const verdict = await gate(parsed)
    if (!('execute' in verdict)) {
      // A refused action is still an action: it ends the detector's run of unchanged screenshots, as an
      // executed one does. It may also have waited for a human (a card, a takeover), and that wait must
      // never count as "the screen did not change": a Deny leaves the screen as it was by design, and
      // two looks at it after a slow decision would otherwise end the run as stuck.
      stuck.note('other')
      return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: verdict.refused }, stuck: null }
    }
    if (ctx.cancelRequested()) {
      await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: false, summary: STOPPED_RESULT, shot: null })
      return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: STOPPED_RESULT }, stuck: null }
    }
    // Only an action that passed the gate is ever described in a message; the text is redacted.
    lastAction = describeAction(parsed)
    markPhase('sandbox')
    let outcome: Awaited<ReturnType<typeof executeAction>>
    try {
      outcome = await executeAction(parsed, ctx.sandbox, lastShot)
    } catch (raw) {
      // A repeated key that failed after some presses went through says so: the model must not
      // read "failed" as "nothing happened" when two of five arrows were sent.
      const partial = raw instanceof PartialActionError ? raw : null
      const e = partial ? partial.cause : raw
      const partialNote = partial ? ` (${partial.done} of ${partial.total} presses were sent before this)` : ''
      if (e instanceof SandboxActionError) {
        // A command that failed inside the sandbox (an unknown key name, for example) is the
        // action's problem, not the computer's: the model gets an error result and the run goes on.
        // The approval, if any, stays unconsumed: the approved action has not happened.
        markPhase('model')
        const text = `${parsed.name} failed on the computer: ${e.message.slice(0, SUMMARY_CHARS)}${partialNote}`
        await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: false, summary: text, shot: null })
        return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: text }, stuck: null }
      }
      // The computer did not answer. The time this took stays inside the stuck detector's span on
      // purpose, unlike a human's wait: a screen that stands still while the computer does not answer
      // is a stuck run. An approved action may or may not have happened: its approval is
      // spent first, whether the run goes on or ends here, and a run that fails later says so. Then,
      // once, while the helper still answers, the model gets a result that says so, with a fresh screenshot;
      // a second failure in a row, or a helper that is gone, ends the run through the catch at the end
      // of the loop. A failing fresh screenshot is that second failure.
      let approvedTarget: string | null = null
      if (verdict.consume) {
        ctx.approvals.consume(verdict.consume.approvalId)
        approvedTarget = ctx.approvals.get(verdict.consume.approvalId)?.target ?? ''
        unanswered.approval = approvedTarget
        lastApproved = { target: approvedTarget, step }
        await ctx.emit({
          type: 'gate',
          step,
          decision: 'consume',
          rule: verdict.consume.rule,
          announced: verdict.consume.announced,
          approvalId: verdict.consume.approvalId,
          reason: 'the computer did not answer; whether the approved action happened is unknown, so the approval is spent',
        })
      }
      // On the fatal path the wrapper is not rethrown, so the count goes to the log here.
      if (partial) log.warn('a repeated key failed part-way', { botId: ctx.botId, runId: ctx.runId, step, done: partial.done, total: partial.total })
      if (lastFailed || !(await companionAnswers())) throw e
      lastFailed = true
      log.warn('the computer did not answer an action; the model gets a warning and a fresh screenshot', { botId: ctx.botId, runId: ctx.runId, step, action: parsed.name, ...errorFields(e) })
      const png = await ctx.sandbox.screenshot()
      markPhase('model')
      lastShot = png
      const text = noAnswerText(parsed.name, approvedTarget) + partialNote
      const hash = await ctx.store.writeShot(ctx.botId, ctx.runId, png)
      await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: false, summary: text, shot: hash })
      // No `is_error` here, on purpose. The API refuses an error result that holds anything but text
      // ("all content must be type `text` if `is_error` is true"), and the fresh screenshot is the
      // point of this result: the model must see the page before it decides. With the flag set, the
      // provider refuses the whole request and the run fails. The text says what went wrong, and the
      // run log above still records the step as failed.
      const result: Anthropic.Messages.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: block.id,
        toolset_name: 'computer',
        content: [
          { type: 'text', text },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } },
        ],
      }
      shots.push({ block: result, step })
      return { result, stuck: null }
    }
    lastFailed = false
    markPhase('model')
    if (verdict.consume) {
      ctx.approvals.consume(verdict.consume.approvalId)
      // The computer did the action; what the page made of it is seen only at a later step. A
      // run that the budget ends before that step names the action on its card.
      lastApproved = { target: ctx.approvals.get(verdict.consume.approvalId)?.target ?? '', step }
      await ctx.emit({
        type: 'gate',
        step,
        decision: 'consume',
        rule: verdict.consume.rule,
        announced: verdict.consume.announced,
        approvalId: verdict.consume.approvalId,
        reason: verdict.consume.announced ? 'matches the approved action' : 'allowed once by the user',
      })
    }
    // Nothing new for many steps is a loop: first a notice with the result, then the end of the run.
    // A full screenshot goes along, so a screen this run has not shown before counts as new content.
    const moved = progress.noteAction(parsed, parsed.name === 'screenshot' && 'png' in outcome ? outcome.png : undefined)
    const repeatedStuck = moved !== null && 'stuck' in moved ? NO_PROGRESS_STUCK_TEXT : null
    const notice = moved !== null && 'notice' in moved ? moved.notice : null
    if ('png' in outcome) {
      if (parsed.name === 'screenshot') lastShot = outcome.png
      const isStuck = stuck.note(stuckKind(parsed), outcome.png) ? STUCK_TEXT : repeatedStuck
      const hash = await ctx.store.writeShot(ctx.botId, ctx.runId, outcome.png)
      await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: true, summary: parsed.name, shot: hash })
      const result: Anthropic.Messages.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: block.id,
        toolset_name: 'computer',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(outcome.png).toString('base64') } },
          ...(notice === null ? [] : [{ type: 'text' as const, text: notice }]),
        ],
      }
      shots.push({ block: result, step })
      return { result, stuck: isStuck }
    }
    const isStuck = stuck.note(stuckKind(parsed)) ? STUCK_TEXT : repeatedStuck
    await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: true, summary: outcome.text, shot: null })
    return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', content: notice === null ? outcome.text : `${outcome.text}\n\n${notice}` }, stuck: isStuck }
  }

  const handlePlatform = async (block: Anthropic.Messages.ToolUseBlock): Promise<{ result: Anthropic.Messages.ToolResultBlockParam; stuck: string | null }> => {
    await ctx.emit({ type: 'tool_call', step, name: block.name, input: block.input })
    stuck.note('other')
    const tool = runTools.find((t) => t.name === block.name)
    if (!tool) {
      const text = `unknown tool: ${block.name}`
      await ctx.emit({ type: 'tool_result', step, name: block.name, ok: false, summary: text, shot: null })
      return { result: { type: 'tool_result', tool_use_id: block.id, is_error: true, content: text }, stuck: null }
    }
    lastAction = `the ${block.name} tool`
    if (ctx.cancelRequested()) {
      await ctx.emit({ type: 'tool_result', step, name: block.name, ok: false, summary: STOPPED_RESULT, shot: null })
      return { result: { type: 'tool_result', tool_use_id: block.id, is_error: true, content: STOPPED_RESULT }, stuck: null }
    }
    const outcome = await runPlatformTool(tool, block.input, ctx)
    if (outcome.outcomeUnknown !== undefined) unanswered.approval = outcome.outcomeUnknown
    await ctx.emit({ type: 'tool_result', step, name: block.name, ok: !outcome.isError, summary: firstLine(outcome.text), shot: null })
    const result: Anthropic.Messages.ToolResultBlockParam = { type: 'tool_result', tool_use_id: block.id, content: outcome.text }
    if (outcome.isError) result.is_error = true
    // A tool call that worked is progress, unless it opened a page this run already opened. One
    // that failed did nothing, so it counts as a step without progress.
    const moved = progress.noteTool(block.name, block.input, !outcome.isError)
    if (moved !== null && 'notice' in moved) result.content = `${outcome.text}\n\n${moved.notice}`
    return { result, stuck: moved !== null && 'stuck' in moved ? NO_PROGRESS_STUCK_TEXT : null }
  }

  try {
    while (true) {
      if (ctx.cancelRequested()) return await stoppedEnd()
      if (step >= STEP_BUDGET) return await blockedEnd('budget', budgetEndText(`I used all ${STEP_BUDGET} computer steps without finishing, so I stopped.`, lastApproved, step))
      if (turns >= TURN_BUDGET) return await blockedEnd('budget', budgetEndText(`I made ${TURN_BUDGET} model calls without finishing, so I stopped.`, lastApproved, step))
      turns += 1
      if (ctx.takeoverRequested()) {
        const shot = await ctx.takeover('manual', 'You asked to take over. Hand back when you are done.')
        // Stop during the takeover ends the run here, before another model call. Without this check
        // the aborted signal on that call is the only thing between the stop and a new request.
        if (ctx.cancelRequested()) return await stoppedEnd()
        if (shot) lastShot = shot
        // The same rule as for a refused action: the time a human held the screen is not the screen
        // standing still, even when they changed nothing.
        stuck.note('other')
        messages.push({ role: 'user', content: 'The user took over the screen for a moment and handed it back. Take a screenshot before you continue.' })
      }
      const current = await ctx.connectors.snapshot(ctx.botId)
      if (current.key !== connectors.key) {
        connectors = current
        runTools = [...ctx.tools, ...connectors.tools]
        tools = [{ type: 'computer_toolset_20260801' }, ...toolDefinitions(runTools)]
        system[0] = systemFor(connectors.catalog)
      }
      setCacheBreakpoint(messages)
      markPhase('model')
      // Stop cancels a pending call through the signal; the SDK's abort error is then the stop, not a failure.
      let res: Anthropic.Messages.Message
      try {
        res = await ctx.model.create({ model: ctx.modelId, max_tokens: maxTokens, thinking: { type: 'adaptive', display: 'summarized' }, system, tools, messages }, { signal: ctx.cancelSignal })
      } catch (e) {
        if (ctx.cancelRequested()) {
          // Logged, because a failure that lands in the moment after Stop is reported as the stop.
          log.info('model call ended while a stop was pending', { botId: ctx.botId, runId: ctx.runId, step, ...errorFields(e) })
          return await stoppedEnd()
        }
        throw e
      }
      const usage = usageOf(res.usage)
      const discarded = res.stop_reason === 'max_tokens' && res.content.some((b) => b.type === 'tool_use')
      const thinkingSummary = res.content.filter((b): b is Anthropic.Messages.ThinkingBlock => b.type === 'thinking').map((b) => b.thinking).join('\n\n')
      const said = textOf(res.content)
      // Record every response before a retry can discard it. Never log signatures or redacted data.
      await ctx.emit({ type: 'cost', ...usage, usd: costUsd(ctx.modelId, usage), response: {
        call: turns, step, maxTokens, stopReason: res.stop_reason, discarded,
        thinkingTokens: res.usage.output_tokens_details?.thinking_tokens ?? null,
        blockTypes: res.content.map((b) => b.type),
        toolNames: res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use').map((b) => b.name),
        thinkingSummary: thinkingSummary.slice(0, THINKING_LOG_CHARS),
        thinkingSummaryTruncated: thinkingSummary.length > THINKING_LOG_CHARS,
        textChars: said.length,
      } })
      if (discarded) {
        // A response cut inside a tool call is not added to the conversation, where a tool call
        // without a result is invalid, and its partial input never runs: the request is sent again
        // with a higher limit (Anthropic docs, "Handling the max_tokens stop reason").
        if (maxTokens === MAX_TOKENS_RAISED) {
          await ctx.postChat({ role: 'bot', text: `${CUT_OFF_TEXT} ${nextStepAfterFailure(unanswered.approval)}` })
          return await end('failed', CUT_OFF_SUMMARY, true)
        }
        log.warn('model answer cut off inside a tool call; retrying with a higher max_tokens', { botId: ctx.botId, runId: ctx.runId, step })
        maxTokens = MAX_TOKENS_RAISED
        continue
      }
      // Tool continuations need the full response, including signed thinking blocks, unchanged.
      messages.push({ role: 'assistant', content: res.content })
      if (said.trim() !== '') await ctx.emit({ type: 'text', step, text: said.slice(0, TEXT_LOG_CHARS) })

      switch (res.stop_reason) {
        case 'tool_use':
          break
        case 'pause_turn':
          // Only a server-side tool pauses a turn, and none is passed in `tools`; if one is ever
          // added, its text before the pause needs the same delivery as the cut answer below.
          continue
        case 'max_tokens':
          // A text answer cut by the output cap. The part the user was going to read is posted now,
          // so the answer arrives whole and in order, as more than one chat line, and a continuation
          // that fails or is stopped does not lose it. The model's context keeps the full blocks,
          // because a later request must send the signed thinking blocks back unchanged.
          if (said.trim() !== '') await ctx.postChat({ role: 'bot', text: said })
          messages.push({ role: 'user', content: 'continue' })
          continue
        case 'refusal': {
          // No retry is suggested after a refusal; the unknown-outcome warning still applies.
          const warning = unknownOutcomeWarning(unanswered.approval)
          await ctx.postChat({ role: 'bot', text: warning === null ? REFUSED_TEXT : `${REFUSED_TEXT} ${warning}` })
          return await end('failed', 'the model refused', true)
        }
        case 'model_context_window_exceeded':
          await ctx.postChat({ role: 'bot', text: `${CONTEXT_FULL_TEXT} ${nextStepAfterFailure(unanswered.approval)}` })
          return await end('failed', 'context window exceeded', true)
        default: {
          const text = textOf(res.content)
          if (text) await ctx.postChat({ role: 'bot', text })
          return await end('done', firstLine(text) || 'done')
        }
      }

      const results: Anthropic.Messages.ContentBlockParam[] = []
      let isStuck: string | null = null
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue
        if (block.toolset_name === 'computer') {
          const handled = await handleComputer(block)
          results.push(handled.result)
          isStuck = isStuck ?? handled.stuck
        } else {
          const handled = await handlePlatform(block)
          results.push(handled.result)
          isStuck = isStuck ?? handled.stuck
        }
      }
      if (results.length === 0) {
        // stop_reason said tool_use but no tool_use block came: treat it as the end of the turn.
        const text = textOf(res.content)
        if (text) await ctx.postChat({ role: 'bot', text })
        return await end('done', firstLine(text) || 'done')
      }
      if (ctx.cancelRequested()) return await stoppedEnd()
      // Near the cap the model is told how many steps remain, after the tool results of this turn.
      const left = STEP_BUDGET - step
      if (left > 0 && left <= STEPS_LEFT_NOTICE) results.push({ type: 'text', text: stepsLeftText(left) })
      messages.push({ role: 'user', content: results })
      pruneImages()
      if (isStuck !== null) return await blockedEnd('stuck', isStuck)
    }
  } catch (e) {
    const fields = errorFields(e)
    log.error('run failed', { botId: ctx.botId, runId: ctx.runId, step, phase: activity.phase, approvalOutcomeUnknown: unanswered.approval !== null, ...fields })
    // A refusal by the model provider is not "stopped answering", and a retry will not fix it.
    const refusal = activity.phase === 'model' ? providerRefusal(e) : null
    await ctx.setBotState('idle', refusal === null ? `stopped: ${fields.errorName}` : 'stopped: the model provider refused the request')
    if (refusal !== null) {
      const warning = unknownOutcomeWarning(unanswered.approval)
      await ctx.postChat({ role: 'bot', text: `I was doing ${lastAction}; the model provider refused my request: ${refusal}. Sending the goal again will not help until that is fixed.${warning === null ? '' : ` ${warning}`}` })
      return end('failed', 'the model provider refused the request', true)
    }
    const who = activity.phase === 'sandbox' ? 'my computer' : 'the model'
    await ctx.postChat({ role: 'bot', text: `I was doing ${lastAction}; ${who} stopped answering, so I stopped. ${nextStepAfterFailure(unanswered.approval)}` })
    return end('failed', fields.errorName)
  }
}
