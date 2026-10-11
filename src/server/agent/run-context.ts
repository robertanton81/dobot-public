import type { z } from 'zod'
import type { SandboxPort } from '../sandbox/port'
import type { ApprovalRules, BotState, Card, ChatInput, ChatMessage, RunEventBody, Store } from '../store'
import type { Approvals } from './gate'
import type { ModelPort } from './model'

// The seam of the agent package. The runner builds a RunContext for each run and owns everything
// that outlives the loop; the loop, the tools and the takeover controller see only this type.

/** Everything a run needs. Built by the runner (`Runner.run`); the tests build it from fakes. */
export type RunContext = {
  botId: string
  runId: string
  store: Store
  sandbox: SandboxPort
  model: ModelPort
  modelId: string
  tools: ToolDef[]
  approvals: Approvals
  rules: ApprovalRules
  /** The loop keeps this current; tools read it to stamp approvals with the step they were made at. */
  progress: { step: number }
  /** Appends the event to the run log and pushes it to the UI. */
  emit(event: RunEventBody): Promise<void>
  /** Appends to the chat and pushes it to the UI. */
  postChat(input: ChatInput): Promise<ChatMessage>
  /** Replaces a card in place (pending → allowed, active → ended) and pushes it to the UI. */
  updateChat(messageId: string, card: Card): Promise<void>
  setBotState(state: BotState, statusLine?: string): Promise<void>
  /** Resolves with the user's next chat message (ask_user). */
  waitForUser(): Promise<string>
  /** Resolves with the user's decision on an approval card (propose_action). */
  waitForApproval(approvalId: string): Promise<'allowed' | 'denied'>
  /** Hands the screen to the human; resolves when the human handed back, with a fresh screenshot. */
  takeover(trigger: TakeoverTrigger, reason: string): Promise<Uint8Array | null>
  /** True once the user pressed Take over; the loop honours it before the next model call. */
  takeoverRequested(): boolean
  /** True once the user pressed Stop; the loop ends before its next model call or action. */
  cancelRequested(): boolean
  /** Aborted when the user pressed Stop; a pending model call is cancelled through it. */
  cancelSignal: AbortSignal
  /** The bot's connectors: the tools they add, the prompt's lines about them, and the grant. */
  connectors: ConnectorsPort
  /** Re-arms the bot's routines after save_routine (the scheduler). */
  reloadRoutines(): Promise<void>
  /** The clock the stuck detector and the run's clock line read, in epoch milliseconds: injected in tests, the wall clock otherwise. */
  now?: () => number
  /** The routines' clock (`TZ`): the zone of the date and time a run is told at its start. */
  timezone: string
}

/** The bot's connector tools and the prompt's connector lines. `key` changes exactly when the tool list does. */
export type ConnectorSnapshot = { tools: ToolDef[]; catalog: string[]; key: string }
export type ConnectorOffer = { id: string; title: string; what: string }
export type ConnectorsPort = {
  snapshot(botId: string): Promise<ConnectorSnapshot>
  /** A built-in this bot may be offered, or the refusal written for the model. */
  offer(botId: string, builtin: string): Promise<ConnectorOffer | { refused: string }>
  /** Grants the built-in and returns the tool names the bot now has. */
  grant(botId: string, builtin: string): Promise<string[]>
}

/** A platform with no connector: the runner's default when none is given. */
export const NO_CONNECTORS: ConnectorsPort = {
  snapshot: async () => ({ tools: [], catalog: [], key: '' }),
  offer: async () => ({ refused: 'there are no connectors on this server' }),
  grant: async () => {
    throw new Error('there are no connectors on this server')
  },
}

export type TakeoverTrigger = 'secret-field' | 'requested' | 'stuck' | 'budget' | 'manual'

export type ToolDef = {
  name: string
  description: string
  schema: z.ZodObject
  run(input: unknown, ctx: RunContext): Promise<string>
}
