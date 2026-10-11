import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { describeEvents, isKnownEvent, MAIL_EVENT } from '../events'
import { errorFields, log } from '../log'
import { ActionKind, SLUG, type Card } from '../store'
import { CONNECTOR_PAGE, matchRule, needsApproval, pageOf } from './gate'
import { LocalAddressError, pageFetch, type PageFetch } from './page-fetch'
import { isPublicHost } from './public-host'
import type { RunContext, ToolDef } from './run-context'

// Platform tools: generic, in-process. None of them knows anything about one kind of work or one site.
// Site knowledge lives in a bot's skills, never here.

export class ToolInputError extends Error {
  override name = 'ToolInputError'
}

/** A failure whose message is written for the model (no paths, no internals). */
export class ToolError extends Error {
  override name = 'ToolError'
}

/**
 * An approved write that may or may not have happened. `target` names what the user approved; the
 * run keeps it, so the run cannot end as a plain failure that an event source tries again.
 */
export class OutcomeUnknownError extends ToolError {
  override name = 'OutcomeUnknownError'
  constructor(message: string, readonly target: string) {
    super(message)
  }
}

/** Wraps a typed tool so its input is validated before `run` sees it. */
export function defineTool<S extends z.ZodObject>(tool: {
  name: string
  description: string
  schema: S
  run(input: z.infer<S>, ctx: RunContext): Promise<string>
}): ToolDef {
  return {
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    run: async (input, ctx) => {
      const parsed = tool.schema.safeParse(input ?? {})
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
        throw new ToolInputError(`invalid input for ${tool.name}: ${issues}`)
      }
      return tool.run(parsed.data as z.infer<S>, ctx)
    },
  }
}

/** Tool definitions for the API; the last one carries the cache breakpoint for the whole tool list. */
export function toolDefinitions(tools: ToolDef[]): Anthropic.Messages.Tool[] {
  return tools.map((tool, index) => {
    const { $schema: _schema, ...inputSchema } = z.toJSONSchema(tool.schema)
    const definition: Anthropic.Messages.Tool = {
      name: tool.name,
      description: tool.description,
      input_schema: { ...inputSchema, type: 'object' },
    }
    if (index === tools.length - 1) definition.cache_control = { type: 'ephemeral' }
    return definition
  })
}

/** `outcomeUnknown` is set when an approved write may have happened: it names what was approved. */
export type ToolOutcome = { text: string; isError: boolean; outcomeUnknown?: string }

/** Runs a tool; a bad input or a thrown error becomes an error result for the model, never a crash. */
export async function runPlatformTool(tool: ToolDef, input: unknown, ctx: RunContext): Promise<ToolOutcome> {
  try {
    return { text: await tool.run(input, ctx), isError: false }
  } catch (e) {
    if (e instanceof OutcomeUnknownError) return { text: e.message, isError: true, outcomeUnknown: e.target }
    if (e instanceof ToolInputError || e instanceof ToolError) return { text: e.message, isError: true }
    // Anything else may carry a path or an internal detail: the model gets the error's name only.
    log.warn('platform tool failed', { botId: ctx.botId, runId: ctx.runId, tool: tool.name, ...errorFields(e) })
    return { text: `${tool.name} failed (${errorFields(e).errorName})`, isError: true }
  }
}

const FETCH_TIMEOUT_MS = 15_000
const FETCH_MAX_CHARS = 20_000
const FETCH_MAX_BYTES = 5_000_000
const FETCH_MAX_REDIRECTS = 10
// A media type is case-insensitive.
const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|json|xml))/i

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * HTML to readable text: scripts and styles dropped, block ends become line breaks, entities decoded.
 * The page is a stranger's, and these patterns run on the one thread the whole process has, so each
 * must read its input once. A comment or a script that never closes runs to the end of the page, as
 * it does in a browser; without that, every opening would search the rest of the page again. For the
 * same reason a tag holds no `<`: a lone `<` then stops at the next one.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(p|div|li|tr|h[1-6]|title|head|body|nav|main|aside|section|article|header|footer|form|fieldset|blockquote|pre|table|ul|ol|dd|dt|option)\s*>/gi,
      '\n',
    )
    .replace(/<[^<>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      const lower = entity.toLowerCase()
      if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
      if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10))
      return ENTITIES[lower] ?? match
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n+/g, '\n')
    .trim()
}

const FETCH_HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) dobot/0.1',
}
const TOO_LARGE = 'fetch failed: the page is larger than 5 MB'
const NOT_PUBLIC = 'fetch failed: only public web addresses can be read'

/** Null when `url` is an http or https address of a public host; otherwise the refusal, written for the model. */
function refusedAddress(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'fetch failed: only http and https URLs can be read'
  if (!isPublicHost(url.hostname)) return NOT_PUBLIC
  return null
}

/** The body as text, or null once it is longer than `maxBytes`: a sender that names no length cannot make the process read without end. */
async function readTextUpTo(res: Response, maxBytes: number): Promise<string | null> {
  if (res.body === null) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
}

/**
 * The model chooses the address, and the model reads text that strangers wrote, so every address is
 * checked before a request goes to it: the first one and each redirect. A host written as a name is
 * checked again where the connection is made (page-fetch.ts), because only there is it known where
 * the name leads. One time limit covers all hops and the body, and Stop ends the request. `fetchFn`
 * is the network; the tests pass their own.
 */
export function fetchUrlTool(fetchFn: PageFetch = pageFetch): ToolDef {
  return defineTool({
    name: 'fetch_url',
    description:
      'Read a public web page as plain text (HTML stripped, at most 20000 characters). The cheap path: use it before the computer for anything that needs no login and no interaction.',
    schema: z.object({ url: z.string().describe('an http or https URL') }),
    run: async ({ url }, ctx) => {
      let current: URL
      try {
        current = new URL(url)
      } catch {
        return 'fetch failed: not a valid URL'
      }
      const signal = AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), ctx.cancelSignal])
      try {
        for (let redirects = 0; ; redirects += 1) {
          const refusal = refusedAddress(current)
          if (refusal !== null) return refusal
          const res = await fetchFn(current, { signal, headers: FETCH_HEADERS })
          const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
          if (location === null) {
            if (!res.ok) {
              await res.body?.cancel()
              return `fetch failed: http ${res.status}`
            }
            return await pageText(res)
          }
          await res.body?.cancel()
          if (redirects === FETCH_MAX_REDIRECTS) return 'fetch failed: too many redirects'
          if (!URL.canParse(location, current)) return 'fetch failed: the page redirects to an address that is not valid'
          current = new URL(location, current)
        }
      } catch (e) {
        if (e instanceof LocalAddressError) return NOT_PUBLIC
        // After the time limit or Stop, the broken connection is the effect; the signal holds the cause.
        return `fetch failed: ${errorFields(signal.aborted ? signal.reason : e).errorName}`
      }
    },
  })
}

async function pageText(res: Response): Promise<string> {
  const type = res.headers.get('content-type') ?? ''
  if (!TEXT_TYPES.test(type)) {
    await res.body?.cancel()
    return `fetch failed: the page is ${type || 'binary'}, not text`
  }
  if (Number(res.headers.get('content-length') ?? 0) > FETCH_MAX_BYTES) {
    await res.body?.cancel()
    return TOO_LARGE
  }
  const body = await readTextUpTo(res, FETCH_MAX_BYTES)
  if (body === null) return TOO_LARGE
  const text = htmlToText(body)
  // An empty result reads like a failure; a page whose text is all drawn by script is not one.
  if (text === '') return 'the page has no readable text'
  if (text.length <= FETCH_MAX_CHARS) return text
  return `${text.slice(0, FETCH_MAX_CHARS)}\n\n[truncated: the page has ${text.length} characters; only the first ${FETCH_MAX_CHARS} are shown]`
}

export const fetchUrl = fetchUrlTool()

const PAGE_SETTLE_MS = 2_000

export const openUrl = defineTool({
  name: 'open_url',
  description:
    'Open a web address in your browser, as a new tab. Use it for every address you visit and never type into the address bar. Take a screenshot afterwards to see the page.',
  schema: z.object({ url: z.string().describe('an http or https URL') }),
  run: async ({ url }, ctx) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ToolError('that is not a valid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new ToolError('only http and https addresses can be opened')
    await ctx.sandbox.openUrl(parsed.toString())
    await ctx.sandbox.wait(PAGE_SETTLE_MS)
    return `opened ${parsed.toString()} in a new tab; take a screenshot to see the page`
  },
})

const PREVIEW_CHARS = 300
const ARTIFACT_NAME = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?\.(md|txt)$/

export const writeArtifact = defineTool({
  name: 'write_artifact',
  description: 'Save a document you produced (a report, a letter, a summary) as a file and show it to the user as a card.',
  schema: z.object({
    name: z.string().regex(ARTIFACT_NAME, 'lower-case letters, digits and dashes, ending in .md or .txt').describe('file name, e.g. report-acme.md'),
    content: z.string().min(1).max(100_000),
  }),
  run: async ({ name, content }, ctx) => {
    const path = await ctx.store.writeArtifact(ctx.botId, name, content)
    await ctx.postChat({ role: 'card', card: { card: 'artifact', name, preview: content.slice(0, PREVIEW_CHARS), path } })
    return `saved ${name} (${content.length} characters)`
  },
})

const ARTIFACT_MAX_CHARS = 20_000

export const readArtifact = defineTool({
  name: 'read_artifact',
  description: 'Read back a document you saved with write_artifact (a report, a letter), for example to shorten or rewrite it. Names end in .md or .txt.',
  schema: z.object({ name: z.string().regex(ARTIFACT_NAME, 'lower-case letters, digits and dashes, ending in .md or .txt') }),
  run: async ({ name }, ctx) => {
    const content = await ctx.store.readArtifact(ctx.botId, name)
    if (content === null) {
      const names = await ctx.store.listArtifacts(ctx.botId)
      throw new ToolError(names.length === 0 ? 'there are no artifacts yet' : `there is no artifact named ${name}; the artifacts are: ${names.join(', ')}`)
    }
    if (content.length <= ARTIFACT_MAX_CHARS) return content
    return `${content.slice(0, ARTIFACT_MAX_CHARS)}\n\n[truncated: the artifact has ${content.length} characters; only the first ${ARTIFACT_MAX_CHARS} are shown]`
  },
})

export const remember = defineTool({
  name: 'remember',
  description: 'Append one note to your memory. Memory survives restarts; the chat does not, except the last few lines that come with each goal.',
  schema: z.object({ note: z.string().min(1).max(2000) }),
  run: async ({ note }, ctx) => {
    await ctx.store.appendMemory(ctx.botId, note)
    return 'remembered'
  },
})

export const askUser = defineTool({
  name: 'ask_user',
  description: 'Ask the user one question in the chat and wait for the answer. Use it for your questions about a new goal and for anything you cannot decide alone.',
  schema: z.object({ question: z.string().min(1).max(1000) }),
  run: async ({ question }, ctx) => {
    await ctx.postChat({ role: 'bot', text: question })
    await ctx.setBotState('waiting', 'waiting for your answer')
    const answer = await ctx.waitForUser()
    await ctx.setBotState('working', 'working')
    return `the user answered: ${answer}`
  },
})

const WORKSPACE_DIR = '/home/user/workspace'
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export const attachFile = defineTool({
  name: 'attach_file',
  description:
    'Attach a file from your workspace to the file upload control at the given screenshot coordinate. Use this instead of clicking an upload control; the native file picker cannot be used.',
  schema: z.object({
    coordinate: z.tuple([z.number().int().min(0), z.number().int().min(0)]).describe('[x, y] of the upload control on the screenshot'),
    filename: z.string().regex(FILE_NAME, 'a plain file name from the workspace, no directories'),
  }),
  run: async ({ coordinate, filename }, ctx) => {
    // The companion may have to click the control before the page creates its file input, so the
    // gate's own rules decide here, in the platform, exactly as they do for a click the model
    // makes itself. A send control is refused outright. Anything that is not a resolved element
    // (a cross-origin frame, a closed shadow root, the browser's own frame) is not refused, but
    // the click is withheld: the companion may then only use a file input that already exists,
    // so no unvetted click ever happens.
    const target = await ctx.sandbox.companion.elementAt(coordinate)
    const rule = matchRule('click', target)
    if (rule === 'submit-control' || rule === 'verb-name') {
      const name = target.target === 'element' ? target.name : ''
      throw new ToolError(`that looks like a send control${name ? ` ("${name}")` : ''}, not an upload control; point at the upload field or its button`)
    }
    const mayClick = rule === null && target.target === 'element'
    try {
      await ctx.sandbox.companion.setFiles(coordinate, `${WORKSPACE_DIR}/${filename}`, { click: mayClick })
    } catch (e) {
      log.warn('attach_file failed', { botId: ctx.botId, runId: ctx.runId, ...errorFields(e) })
      const message = e instanceof Error ? e.message : ''
      if (message.includes('no file input')) {
        if (!mayClick)
          throw new ToolError(
            'I cannot see what is at that point — it is inside an embedded frame or an element I cannot read — so I did not click it, and there is no upload field there I can use. Point at the upload control itself, or call request_takeover and ask the human to attach the file.',
          )
        throw new ToolError('no file upload control is under that coordinate; point at the upload field or its button')
      }
      if (message.includes('file not found')) throw new ToolError(`${filename} is not in the workspace`)
      throw new ToolError('the file could not be attached; take a screenshot and try the control again')
    }
    return `attached ${filename} to the upload control at [${coordinate[0]}, ${coordinate[1]}]; take a screenshot to confirm the file name shows`
  },
})

export function approvedText(target: string): string {
  return `approved: you may activate "${target}" on this page within the next 10 steps`
}

export const DENIED_TEXT = 'denied: this action was not approved; do not retry it'

/** Signal A of the approval gate: the model announces one irreversible step and the run waits. */
export const proposeAction = defineTool({
  name: 'propose_action',
  description:
    'Announce one irreversible step (send, submit, book, pay, delete, publish, accept terms) and wait for the user to allow or deny it. Name the exact visible label of the control you will activate: the approval is valid only for that control on the current page and only for the next 10 steps. Never retry a denied action.',
  schema: z.object({
    kind: ActionKind,
    summary: z.string().min(1).max(500).describe('one sentence: what will happen'),
    consequences: z.array(z.string().max(300)).max(10).describe('what cannot be undone afterwards'),
    warnings: z.array(z.string().max(300)).max(10).describe('anything the user should doubt, e.g. a sender not on the expected domain'),
    target: z.string().min(1).max(80).describe('the visible label of the control, e.g. "Send"'),
  }),
  run: async ({ kind, summary, consequences, warnings, target }, ctx) => {
    let url = ''
    try {
      url = (await ctx.sandbox.companion.pageState()).url
    } catch (e) {
      log.warn('propose_action: page state unavailable; the approval will match no page', { botId: ctx.botId, runId: ctx.runId, ...errorFields(e) })
    }
    let shot: string | null = null
    try {
      shot = await ctx.store.writeShot(ctx.botId, ctx.runId, await ctx.sandbox.screenshot())
    } catch (e) {
      log.warn('propose_action: screenshot for the card failed', { botId: ctx.botId, runId: ctx.runId, ...errorFields(e) })
    }
    const approval = ctx.approvals.propose(ctx.botId, ctx.runId, ctx.progress.step, { kind, target, page: pageOf(url) })
    const card: Card = {
      card: 'approval',
      approvalId: approval.id,
      runId: ctx.runId,
      actionKind: kind,
      summary,
      consequences,
      warnings,
      target,
      url,
      shot,
      status: 'pending',
      announced: true,
    }
    const posted = await ctx.postChat({ role: 'card', card })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: 'pending' })

    let decision: 'allowed' | 'denied'
    if (!needsApproval(kind, ctx.rules)) {
      // This branch never waits, so no wait registration guards it: a stop that arrived while the
      // card was being written grants nothing, and the record says denied, not "allowed by your
      // rules".
      decision = ctx.cancelRequested() ? 'denied' : 'allowed'
      ctx.approvals.resolve(approval.id, decision)
      if (decision === 'allowed') await ctx.postChat({ role: 'card', card: { card: 'status', text: `"${target}" is allowed by your rules (${kind})` } })
    } else {
      await ctx.setBotState('waiting', `waiting for your approval: ${target}`)
      decision = await ctx.waitForApproval(approval.id)
      await ctx.setBotState('working', 'working')
    }
    await ctx.updateChat(posted.id, { ...card, status: decision })
    await ctx.emit({ type: 'approval', approvalId: approval.id, status: decision })
    return decision === 'allowed' ? approvedText(target) : DENIED_TEXT
  },
})

export const HUMAN_STEP_TEXT = 'a human will complete this step'
export const STOPPED_ANSWER = '(the user stopped this run)'

export const requestTakeover = defineTool({
  name: 'request_takeover',
  description:
    'Hand your screen to the human for one step you must not do yourself: a password, a one-time code, a CAPTCHA. Say what the page asks for. You get the screen back when the human is done; never type a secret yourself.',
  schema: z.object({ reason: z.string().min(1).max(300).describe('what the page asks for, e.g. "the mailbox asks for a password"') }),
  run: async ({ reason }, ctx) => {
    await ctx.takeover('requested', `${reason} — take over, complete that step on my screen, then hand back.`)
    return `${HUMAN_STEP_TEXT}: the human handed the screen back; take a screenshot to see the result`
  },
})

const NAME = z.string().regex(SLUG, 'lower-case letters, digits and dashes, 1-40 characters')

export const saveSkill = defineTool({
  name: 'save_skill',
  description:
    'Write a skill: plain sentences that describe how to do a job you finished, so you can do it again the same way. Say what to open, what to look for, what to write, where to stop and what to remember. Saving under an existing name replaces that skill: that is how a correction is kept. Never put a password in a skill.',
  schema: z.object({
    name: NAME.describe('e.g. check-prices'),
    description: z.string().min(1).max(200).describe('one line: when to use it'),
    body: z.string().min(1).max(20_000).describe('the steps in plain sentences'),
  }),
  run: async ({ name, description, body }, ctx) => {
    // Read before the write, so the result can say whether this was a correction of a skill the
    // bot already had. A routine names its skill, so after the rewrite it runs the new body with
    // no further step; the model is told "updated" so it does not save a copy under a new name.
    const existed = (await ctx.store.readSkill(ctx.botId, name)) !== null
    await ctx.store.writeSkill(ctx.botId, { name, description, body })
    await ctx.postChat({ role: 'card', card: { card: 'skill', name, description, body } })
    return `${existed ? 'updated' : 'saved'} skill ${name}`
  },
})

export const saveRoutine = defineTool({
  name: 'save_routine',
  description:
    `Schedule a skill: the routine runs the skill with your instruction either on a cron schedule (five fields, e.g. "0 7 * * 1-5" for weekdays at 07:00) or when an event happens. Events you can wait for: ${describeEvents()}. Use an event when the user wants you to act as soon as something arrives, and a schedule when they want a fixed time. Saving under an existing name replaces that routine: use it to change its time or its instruction.`,
  schema: z.object({
    name: NAME.describe('e.g. morning-check'),
    skill: NAME.describe('the skill to run'),
    schedule: z.string().max(100).optional().describe('a cron expression; leave out when using an event'),
    event: z.string().max(100).optional().describe(`one of the events listed in the description, e.g. "${MAIL_EVENT}"; leave out when using a schedule`),
    instruction: z.string().min(1).max(5000).describe('what to do on each run, in plain sentences'),
  }),
  run: async ({ name, skill, schedule, event, instruction }, ctx) => {
    const existing = await ctx.store.readSkill(ctx.botId, skill)
    if (!existing) throw new ToolError(`there is no skill named ${skill}; save the skill first`)
    // An unknown event would be stored and never fire. Refuse it now, while the bot can still fix
    // the call, instead of leaving a routine that silently waits forever.
    if (event !== undefined && !isKnownEvent(event)) throw new ToolError(`there is no event named ${event}; the events you can wait for are: ${describeEvents()}`)
    const existed = (await ctx.store.readRoutine(ctx.botId, name)) !== null
    try {
      await ctx.store.writeRoutine(ctx.botId, { name, skill, schedule: schedule ?? null, event: event ?? null, enabled: true, body: instruction })
    } catch (e) {
      // The store's own message (an invalid cron expression, both or neither trigger) lets the model fix the call.
      throw new ToolError(e instanceof Error ? e.message : 'invalid routine')
    }
    await rearmRoutines(ctx, name)
    await ctx.postChat({ role: 'card', card: { card: 'routine', name, skill, schedule: schedule ?? null, event: event ?? null, instruction } })
    const verb = existed ? 'updated' : 'saved'
    return schedule ? `${verb} routine ${name}: it runs ${skill} on the schedule ${schedule}` : `${verb} routine ${name}: it runs ${skill} whenever the event ${event ?? ''} happens`
  },
})

/**
 * Re-arms the bot's schedules after a routine file changed. The file is already written when this
 * fails, so the model is told exactly that instead of "the tool failed", and the operator gets an
 * error line: disk and scheduler are apart until a restart or the next routine save.
 */
async function rearmRoutines(ctx: RunContext, name: string): Promise<void> {
  try {
    await ctx.reloadRoutines()
  } catch (e) {
    log.error('routine saved but the schedules could not be re-armed', { botId: ctx.botId, runId: ctx.runId, routine: name, ...errorFields(e) })
    throw new ToolError(`routine ${name} is saved, but its schedule could not be re-armed; ask the user to restart the server`)
  }
}

const MISSING_SKILL = /^there is no skill named /

/**
 * The other half of save_routine: a routine the user wants stopped is turned off, not replaced by
 * one that runs and does nothing. Without this tool the bot can turn a routine on through chat but
 * not off, and only a hand-edited file can, which invariant 7 forbids.
 */
export const setRoutineEnabled = defineTool({
  name: 'set_routine_enabled',
  description:
    'Turn a routine off, or back on, when the user asks you to stop or resume a scheduled job. Off, the routine keeps its skill, schedule and instruction and starts no run until it is turned on again. Use this instead of saving a routine that does nothing.',
  schema: z.object({
    name: NAME.describe('the routine, e.g. morning-check'),
    enabled: z.boolean().describe('false to turn it off, true to turn it back on'),
  }),
  run: async ({ name, enabled }, ctx) => {
    const routine = await ctx.store.readRoutine(ctx.botId, name)
    if (!routine) {
      const names = (await ctx.store.listRoutines(ctx.botId)).map((r) => r.name)
      throw new ToolError(names.length === 0 ? 'there are no routines yet' : `there is no routine named ${name}; the routines are: ${names.join(', ')}`)
    }
    const state = enabled ? 'on' : 'off'
    if (routine.enabled === enabled) return `routine ${name} is already ${state}`
    try {
      await ctx.store.writeRoutine(ctx.botId, { ...routine, enabled })
    } catch (e) {
      // The one failure the model can act on: turning a routine on whose skill is gone. Anything
      // else is the platform's problem and goes to the log, redacted, through runPlatformTool.
      if (enabled && e instanceof Error && MISSING_SKILL.test(e.message)) throw new ToolError(e.message)
      throw e
    }
    await rearmRoutines(ctx, name)
    await ctx.postChat({ role: 'card', card: { card: 'status', text: `routine ${name} is now ${state}` } })
    return enabled ? `routine ${name} is on again: it runs ${routine.skill} as before` : `routine ${name} is off: it starts no run until you turn it on again`
  },
})

/**
 * Asks the user to connect a connector, and waits. Connect grants it, and its tools are there from
 * the next step; Not now leaves everything as it was. The answer is not an action: its record is
 * marked so, and a Not now never counts as a denied action; it is used up once answered, so it can
 * never cover a control on a page. For the same reason the wait writes no approval event to the run
 * log: after a restart an allowed approval reads as an outside action whose outcome is unknown, and
 * granting a connection is none. The run log still shows the call.
 */
export const requestConnection = defineTool({
  name: 'request_connection',
  description:
    'Ask the user to connect one of the connectors your prompt lists as not connected, and wait for the answer. Say in reason what it saves the job. Ask once per connector and job; after Not now, use fetch_url or your computer instead.',
  schema: z.object({
    connector: NAME.describe('the connector id, as the prompt lists it'),
    reason: z.string().min(1).max(300).describe('one sentence: what it lets you do without the computer'),
  }),
  run: async ({ connector, reason }, ctx) => {
    const offer = await ctx.connectors.offer(ctx.botId, connector)
    if ('refused' in offer) throw new ToolError(offer.refused)
    const approval = ctx.approvals.propose(ctx.botId, ctx.runId, ctx.progress.step, { kind: 'other', target: `connect ${offer.id}`, page: CONNECTOR_PAGE, action: false })
    const card: Card = { card: 'connect', approvalId: approval.id, runId: ctx.runId, connector: offer.id, title: offer.title, what: offer.what, reason, status: 'pending' }
    const posted = await ctx.postChat({ role: 'card', card })
    await ctx.setBotState('waiting', `waiting for your answer: connect ${offer.title}`)
    const decision = await ctx.waitForApproval(approval.id)
    ctx.approvals.consume(approval.id)
    await ctx.setBotState('working', 'working')
    if (decision === 'denied' || ctx.cancelRequested()) {
      await ctx.updateChat(posted.id, { ...card, status: 'declined' })
      return `the user did not connect ${offer.id}; do this job with fetch_url or your computer`
    }
    let names: string[]
    try {
      names = await ctx.connectors.grant(ctx.botId, offer.id)
    } catch (e) {
      // The card must not stay open with buttons that no longer lead anywhere.
      log.error('a connection the user granted could not be saved', { botId: ctx.botId, runId: ctx.runId, connector: offer.id, ...errorFields(e) })
      await ctx.updateChat(posted.id, { ...card, status: 'failed' })
      throw new ToolError(`the user said Connect, but ${offer.id} could not be saved; do this job with fetch_url or your computer, and say so in your report`)
    }
    await ctx.updateChat(posted.id, { ...card, status: 'connected' })
    return `connected ${offer.id}; from your next step you have: ${names.join(', ')}`
  },
})

/** The tools every run gets. */
export const basePlatformTools: ToolDef[] = [fetchUrl, openUrl, writeArtifact, readArtifact, remember, askUser, attachFile, proposeAction, requestTakeover, requestConnection, saveSkill, saveRoutine, setRoutineEnabled]
