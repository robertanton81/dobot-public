import type { z } from 'zod'
import type { ActionKind } from '../store'

// A built-in connector: a fixed list of tools, each marked read or write in code. The registry
// turns them into platform tools; the gate decides from the mark, never from what a tool says.

export type ToolClass = 'read' | 'write'

export type MailHeader = { uid: number; from: string; subject: string; date: string }

/** The bot's own mailbox, as the mailbox connector uses it. The login stays inside the implementation. */
export type MailboxClient = {
  address: string
  list(folder: string, since: Date, signal: AbortSignal): Promise<MailHeader[]>
  read(uid: number, signal: AbortSignal): Promise<{ header: MailHeader; text: string }>
  send(mail: { to: string; subject: string; body: string }, signal: AbortSignal): Promise<void>
}

/** What a connector call may use: the network, the operator's keys it needs, and the mailbox of the one bot that may use it. */
export type ConnectorEnv = {
  fetch: typeof fetch
  mapyApiKey: string | null
  mailbox: MailboxClient | null
  /** The one bot that may use the mailbox (`MAILBOX_BOT_ID`). */
  mailboxBotId: string | null
}

export type ConnectorTool = {
  name: string
  class: ToolClass
  description: string
  schema: z.ZodObject
  /** For a write: the kind on the approval card. */
  kind?: ActionKind
  /** For a write: the one sentence the user reads on the approval card. */
  consequence?(input: never): string
  run(input: never, env: ConnectorEnv, signal: AbortSignal): Promise<string>
}

export type BuiltinConnector = {
  id: string
  title: string
  /** One line for the prompt's connector section and the connect card. */
  what: string
  /** True for a connector every bot has without a card. */
  onByDefault: boolean
  /** Null when this bot may use it; otherwise why not, for the operator log. */
  unavailable(botId: string, env: ConnectorEnv): string | null
  tools: ConnectorTool[]
}

/** A failure whose message is written for the model: no key, no internal detail. */
export class ConnectorError extends Error {
  override name = 'ConnectorError'
}
