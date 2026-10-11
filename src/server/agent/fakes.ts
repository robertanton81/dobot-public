import type Anthropic from '@anthropic-ai/sdk'
import { PNG } from 'pngjs'
import type { CompanionPort, ElementInfo, PageState, Point, SandboxPort } from '../sandbox/port'
import { DEFAULT_RULES, type ApprovalRules, type BotState, type Card, type ChatInput, type ChatMessage, type RunEvent, type RunEventBody, type Store } from '../store'
import { Approvals } from './gate'
import type { ModelPort } from './model'
import { TakeoverController } from './takeover'
import { NO_CONNECTORS, type ConnectorsPort, type RunContext, type ToolDef } from './run-context'

// Test doubles. Imported by no production file: the loop is proven on a real sandbox and a real
// model; these exist so the tests can assert on the loop's events, store writes and the sandbox
// call log without a network.

export type Call = { method: string; args: unknown[] }

export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0]
    png.data[i * 4 + 1] = rgb[1]
    png.data[i * 4 + 2] = rgb[2]
    png.data[i * 4 + 3] = 255
  }
  return new Uint8Array(PNG.sync.write(png))
}

export function setPixel(png: Uint8Array, x: number, y: number, rgb: [number, number, number]): Uint8Array {
  const image = PNG.sync.read(Buffer.from(png))
  const offset = (y * image.width + x) * 4
  image.data[offset] = rgb[0]
  image.data[offset + 1] = rgb[1]
  image.data[offset + 2] = rgb[2]
  return new Uint8Array(PNG.sync.write(image))
}

export type KnownElement = Extract<ElementInfo, { target: 'element' }>

export const ELEMENT_TEXT_INPUT: KnownElement = {
  target: 'element',
  tag: 'input',
  type: 'text',
  role: null,
  name: 'Name',
  inForm: true,
  isSubmit: false,
  autocomplete: null,
  inputMode: null,
  pattern: null,
  maxLength: null,
  url: 'https://example.com/form',
  title: 'Form',
}

export class FakeCompanion implements CompanionPort {
  calls: Call[] = []
  /** Scripted answers; the last one repeats. */
  elements: ElementInfo[] = [ELEMENT_TEXT_INPUT]
  active: ElementInfo[] = [ELEMENT_TEXT_INPUT]
  states: PageState[] = [{ url: 'https://example.com/form', fingerprint: 'a', unsafe: false }]
  /** When set, pageState() throws it (the companion does not answer). */
  pageStateError: Error | null = null

  private next<T>(queue: T[]): T {
    const value = queue.length > 1 ? queue.shift() : queue[0]
    if (value === undefined) throw new Error('fake companion has no scripted answer')
    return value
  }

  async health(): Promise<{ ok: boolean; cdp: boolean }> {
    return { ok: true, cdp: true }
  }

  async elementAt(p: Point): Promise<ElementInfo> {
    this.calls.push({ method: 'elementAt', args: [p] })
    return this.next(this.elements)
  }

  async activeElement(): Promise<ElementInfo> {
    this.calls.push({ method: 'activeElement', args: [] })
    return this.next(this.active)
  }

  async pageState(): Promise<PageState> {
    this.calls.push({ method: 'pageState', args: [] })
    if (this.pageStateError) throw this.pageStateError
    return this.next(this.states)
  }

  async setFiles(p: Point, sandboxPath: string, opts: { click: boolean }): Promise<void> {
    this.calls.push({ method: 'setFiles', args: [p, sandboxPath, opts] })
  }
}

export class FakeSandbox implements SandboxPort {
  calls: Call[] = []
  /** Scripted screenshots; the last one repeats. */
  shots: Uint8Array[]
  /** When set, screenshot() throws it. */
  screenshotError: Error | null = null
  /** When set, the next leftClick() throws it (a command that failed on the computer). */
  clickError: Error | null = null
  companion = new FakeCompanion()
  /** When set, every screenshot moves this clock by `screenshotMs`: time passes while it is taken, which the stuck detector's span rule reads. */
  clock: { now: number } | null = null
  screenshotMs = 0

  constructor(shots: Uint8Array[] = [solidPng(64, 64, [0, 0, 0])]) {
    this.shots = shots
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args })
  }

  async screenshot(): Promise<Uint8Array> {
    this.record('screenshot')
    if (this.screenshotError) throw this.screenshotError
    if (this.clock) this.clock.now += this.screenshotMs
    const shot = this.shots.length > 1 ? this.shots.shift() : this.shots[0]
    if (!shot) throw new Error('fake sandbox has no screenshot')
    return shot
  }

  async leftClick(p?: Point): Promise<void> {
    this.record('leftClick', p)
    if (this.clickError) {
      const e = this.clickError
      this.clickError = null
      throw e
    }
  }
  async rightClick(p?: Point): Promise<void> {
    this.record('rightClick', p)
  }
  async middleClick(p?: Point): Promise<void> {
    this.record('middleClick', p)
  }
  async doubleClick(p?: Point): Promise<void> {
    this.record('doubleClick', p)
  }
  async tripleClick(p?: Point): Promise<void> {
    this.record('tripleClick', p)
  }
  async moveMouse(p: Point): Promise<void> {
    this.record('moveMouse', p)
  }
  async mouseDown(): Promise<void> {
    this.record('mouseDown')
  }
  async mouseUp(): Promise<void> {
    this.record('mouseUp')
  }
  async drag(from: Point, to: Point): Promise<void> {
    this.record('drag', from, to)
  }
  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number, at?: Point): Promise<void> {
    this.record('scroll', direction, amount, at)
  }
  async type(text: string): Promise<void> {
    this.record('type', text)
  }
  async press(keys: string[]): Promise<void> {
    this.record('press', keys)
  }
  async holdKey(key: string, seconds: number): Promise<void> {
    this.record('holdKey', key, seconds)
  }
  async cursorPosition(): Promise<Point> {
    this.record('cursorPosition')
    return [5, 6]
  }
  async wait(ms: number): Promise<void> {
    this.record('wait', ms)
  }
  async openUrl(url: string): Promise<void> {
    this.record('openUrl', url)
  }

  /** The methods called, in order. */
  methods(): string[] {
    return this.calls.map((c) => c.method)
  }
}

/**
 * A request shape the real API answers with HTTP 400, refused here in the same way. The shape is a
 * tool result with `is_error: true` that carries a screenshot. The API's answer ends the run with
 * "all content must be type `text` if `is_error` is true". A fake that accepts that shape hides
 * such a request from every test.
 */
function refuseWhatTheApiRefuses(params: Anthropic.Messages.MessageCreateParamsNonStreaming): void {
  params.messages.forEach((m, i) => {
    if (!Array.isArray(m.content)) return
    m.content.forEach((block, j) => {
      if (block.type !== 'tool_result' || block.is_error !== true || !Array.isArray(block.content)) return
      if (block.content.every((inner) => inner.type === 'text')) return
      const message = `400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.${i}.content.${j}.tool_result: all content must be type \`text\` if \`is_error\` is true"}}`
      throw Object.assign(new Error(message), { status: 400 })
    })
  })
}

export class FakeModel implements ModelPort {
  calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = []
  private readonly responses: Anthropic.Messages.Message[]

  constructor(responses: Anthropic.Messages.Message[]) {
    this.responses = [...responses]
  }

  async create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message> {
    this.calls.push(structuredClone(params))
    refuseWhatTheApiRefuses(params)
    const next = this.responses.shift()
    if (!next) throw new Error('fake model has no scripted response left')
    return next
  }
}

let blockCounter = 0

export function textBlock(text: string): Anthropic.Messages.TextBlock {
  return { type: 'text', text, citations: null }
}

export function toolUse(name: string, input: unknown, toolset?: 'computer'): Anthropic.Messages.ToolUseBlock {
  blockCounter += 1
  const block: Anthropic.Messages.ToolUseBlock = { type: 'tool_use', id: `toolu_${blockCounter}`, name, input, caller: { type: 'direct' } }
  if (toolset) block.toolset_name = toolset
  return block
}

export function computerUse(action: string, input: unknown = {}): Anthropic.Messages.ToolUseBlock {
  return toolUse(action, input, 'computer')
}

export function message(content: Anthropic.Messages.ContentBlock[], stopReason: Anthropic.Messages.StopReason = 'tool_use'): Anthropic.Messages.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  }
}

export type TestContext = {
  ctx: RunContext
  events: RunEvent[]
  chat: ChatMessage[]
  states: BotState[]
  takeovers: { trigger: string; reason: string }[]
  /** How many hand-back attempts the test makes during a takeover, with their results. */
  handbackAttempts: { planned: number; results: ({ ok: true } | { ok: false; reason: string })[] }
  /** The user's Take over button. */
  manualTakeover: { requested: boolean }
  /** The user's Stop button: `request()` aborts the context's stop signal, as the runner does. */
  stop: { readonly requested: boolean; request(): void }
  /** Bot ids whose routines were re-armed by save_routine. */
  reloads: string[]
  /** The next answers ask_user receives. */
  userAnswers: string[]
  /** The next decisions propose_action receives. */
  decisions: ('allowed' | 'denied')[]
}

export function makeContext(opts: {
  store: Store
  botId: string
  model: ModelPort
  sandbox: SandboxPort
  tools?: ToolDef[]
  runId?: string
  modelId?: string
  rules?: ApprovalRules
  approvals?: Approvals
  /** The clock the stuck detector and the run's clock line read; the wall clock when absent. */
  now?: () => number
  /** The routines' clock; Europe/Prague when absent. */
  timezone?: string
  /** The bot's connectors; none when absent, so a run's tool list is the platform tools alone. */
  connectors?: ConnectorsPort
}): TestContext {
  const events: RunEvent[] = []
  const chat: ChatMessage[] = []
  const states: BotState[] = []
  const userAnswers: string[] = []
  const decisions: ('allowed' | 'denied')[] = []
  const takeovers: { trigger: string; reason: string }[] = []
  const handbackAttempts: TestContext['handbackAttempts'] = { planned: 1, results: [] }
  const manualTakeover = { requested: false }
  const stopController = new AbortController()
  const stop = {
    get requested() {
      return stopController.signal.aborted
    },
    request: () => stopController.abort(),
  }
  const reloads: string[] = []
  const runId = opts.runId ?? 'run-1'
  const ctx: RunContext = {
    botId: opts.botId,
    runId,
    store: opts.store,
    sandbox: opts.sandbox,
    model: opts.model,
    modelId: opts.modelId ?? 'claude-sonnet-5',
    tools: opts.tools ?? [],
    approvals: opts.approvals ?? new Approvals(),
    rules: opts.rules ?? DEFAULT_RULES,
    connectors: opts.connectors ?? NO_CONNECTORS,
    progress: { step: 0 },
    ...(opts.now ? { now: opts.now } : {}),
    timezone: opts.timezone ?? 'Europe/Prague',
    emit: async (body: RunEventBody) => {
      const event = { t: new Date().toISOString(), runId, botId: opts.botId, ...body } as RunEvent
      events.push(event)
      await opts.store.appendRunEvent(event)
    },
    postChat: async (input: ChatInput) => {
      const message = await opts.store.appendChat(opts.botId, input)
      chat.push(message)
      return message
    },
    updateChat: async (messageId: string, card: Card) => {
      const updated = await opts.store.updateChatCard(opts.botId, messageId, card)
      const index = chat.findIndex((m) => m.id === messageId)
      if (updated && index !== -1) chat[index] = updated
    },
    setBotState: async (state: BotState, statusLine?: string) => {
      states.push(state)
      await opts.store.updateBot(opts.botId, statusLine === undefined ? { state } : { state, statusLine })
    },
    waitForUser: async () => {
      const answer = userAnswers.shift()
      if (answer === undefined) throw new Error('no scripted user answer')
      return answer
    },
    waitForApproval: async (approvalId: string) => {
      const decision = decisions.shift()
      if (decision === undefined) throw new Error('no scripted approval decision')
      ctx.approvals.resolve(approvalId, decision)
      return decision
    },
    // A real controller; the test "presses Hand back" the planned number of times once the takeover is active.
    takeover: async (trigger, reason) => {
      takeovers.push({ trigger, reason })
      manualTakeover.requested = false
      const controller = new TakeoverController({
        botId: opts.botId,
        runId,
        sandbox: opts.sandbox,
        signal: stopController.signal,
        emit: ctx.emit,
        postChat: ctx.postChat,
        updateChat: ctx.updateChat,
        setBotState: ctx.setBotState,
      })
      const ended = controller.begin(trigger, reason)
      while (!controller.active) await new Promise((resolve) => setImmediate(resolve))
      for (let i = 0; i < handbackAttempts.planned && controller.active; i++) {
        handbackAttempts.results.push(await controller.handback())
      }
      if (controller.active) throw new Error('the test never handed the screen back')
      return ended
    },
    takeoverRequested: () => manualTakeover.requested,
    cancelRequested: () => stop.requested,
    cancelSignal: stopController.signal,
    reloadRoutines: async () => {
      reloads.push(opts.botId)
    },
  }
  return { ctx, events, chat, states, takeovers, handbackAttempts, manualTakeover, stop, reloads, userAnswers, decisions }
}

/** A finished run whose events are all stamped `startedAt` and whose model calls cost `usd`; for the budget tests. */
export async function seedRun(store: Store, botId: string, runId: string, startedAt: string, usd: number[]): Promise<void> {
  await store.startRun(botId, runId)
  await store.appendRunEvent({ t: startedAt, runId, botId, type: 'status', text: 'working', botState: 'working' })
  for (const amount of usd) {
    await store.appendRunEvent({ t: startedAt, runId, botId, type: 'cost', inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, usd: amount })
  }
  await store.appendRunEvent({ t: startedAt, runId, botId, type: 'end', outcome: 'done', summary: 'done' })
}
