import { z } from 'zod'
import { STATUS_LINE_MAX } from './status'

// The bot folder's file formats. Everything the product promises to keep lives here on disk
// (invariant 6); the sandbox is a cache of it.

export const BotState = z.enum(['idle', 'working', 'waiting', 'blocked'])
export type BotState = z.infer<typeof BotState>

export const RoutineState = z.object({
  nextRunAt: z.string().nullable(), // ISO time computed by croner; persisted for restart
  lastRunAt: z.string().nullable(),
  lastResult: z.string().nullable(), // the one-line status, e.g. "checked 1 source at 07:00, 1 new"
})
export type RoutineState = z.infer<typeof RoutineState>

/** An event source's generation and increasing position within it. */
export const EventCursor = z.object({ generation: z.string(), position: z.number().int().nonnegative() })
export type EventCursor = z.infer<typeof EventCursor>
export const RoutineReceipt = z.object({ event: z.string(), cursor: EventCursor })
export type RoutineReceipt = z.infer<typeof RoutineReceipt>

// 1-40 lower-case letters, digits or dashes; no leading or trailing dash (a leading dash reads as a flag).
export const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/

export const Bot = z.object({
  id: z.string().regex(SLUG),
  name: z.string().min(1).max(60),
  avatar: z.string().max(4), // an emoji
  persona: z.string().max(2000),
  sandboxId: z.string().nullable(),
  state: BotState,
  statusLine: z.string().max(STATUS_LINE_MAX),
  createdAt: z.string(),
  routines: z.record(z.string(), RoutineState),
})
export type Bot = z.infer<typeof Bot>

export const ActionKind = z.enum(['send', 'submit', 'book', 'pay', 'delete', 'publish', 'accept-terms', 'other'])
export type ActionKind = z.infer<typeof ActionKind>

/** The longest texts a chat line holds. The chat store fits display text to them, so no writer can fail on length. */
export const CHAT_LIMITS = { short: 500, long: 20_000, url: 2000 }
const SHORT = z.string().max(CHAT_LIMITS.short)
const LONG = z.string().max(CHAT_LIMITS.long)

export const Card = z.discriminatedUnion('card', [
  z.object({ card: z.literal('artifact'), name: SHORT, preview: SHORT, path: SHORT }),
  z.object({
    card: z.literal('approval'),
    approvalId: z.string().max(100),
    runId: z.string().max(100),
    actionKind: ActionKind,
    summary: SHORT,
    consequences: z.array(SHORT).max(10),
    warnings: z.array(SHORT).max(10),
    target: SHORT,
    url: z.string().max(CHAT_LIMITS.url),
    shot: z.string().max(64).nullable(),
    // `expired`: the server restarted before the user decided; the run behind the card is over.
    status: z.enum(['pending', 'allowed', 'denied', 'expired']),
    announced: z.boolean(),
    // Set for a connector call: the tool and its arguments stand where a page control stands otherwise.
    connectorTool: SHORT.optional(),
    connectorArgs: LONG.optional(),
  }),
  z.object({ card: z.literal('takeover'), reason: SHORT, status: z.enum(['active', 'ended']) }),
  z.object({
    card: z.literal('connect'),
    approvalId: z.string().max(100),
    runId: z.string().max(100),
    connector: SHORT,
    title: SHORT,
    what: SHORT,
    reason: SHORT,
    // `expired`: the server restarted before the user answered. `failed`: Connect was clicked, but
    // the grant could not be saved.
    status: z.enum(['pending', 'connected', 'declined', 'expired', 'failed']),
  }),
  z.object({ card: z.literal('status'), text: SHORT }),
  z.object({ card: z.literal('skill'), name: SHORT, description: SHORT, body: LONG }),
  z.object({
    card: z.literal('routine'),
    name: SHORT,
    skill: SHORT,
    schedule: SHORT.nullable(),
    event: SHORT.nullable(),
    instruction: LONG,
  }),
])
export type Card = z.infer<typeof Card>

export const ChatMessage = z.object({
  id: z.string(),
  t: z.string(),
  botId: z.string(),
  role: z.enum(['user', 'bot', 'card']),
  text: LONG.optional(),
  card: Card.optional(),
})
export type ChatMessage = z.infer<typeof ChatMessage>

export const ApprovalRules = z.object({
  requireApproval: z.array(z.string()),
  alwaysAllow: z.array(z.string()),
})
export type ApprovalRules = z.infer<typeof ApprovalRules>
export const DEFAULT_RULES: ApprovalRules = { requireApproval: ['*'], alwaysAllow: [] }

/** One connector granted to a bot. `builtin` names a built-in the registry knows; the store does not check which. */
export const Connection = z.object({
  id: z.string().regex(SLUG),
  kind: z.literal('builtin'),
  builtin: z.string().regex(SLUG),
  grantedAt: z.string(),
  status: z.enum(['connected', 'disconnected']),
})
export type Connection = z.infer<typeof Connection>
export const Connections = z.array(Connection)

export const Skill = z.object({
  name: z.string().regex(SLUG),
  description: z.string().min(1).max(500),
  body: LONG,
})
export type Skill = z.infer<typeof Skill>

export const Routine = z.object({
  name: z.string().regex(SLUG),
  skill: z.string().regex(SLUG),
  schedule: SHORT.nullable(),
  event: SHORT.nullable(),
  enabled: z.boolean(),
  body: LONG,
})
export type Routine = z.infer<typeof Routine>

export const RuleName = z.enum(['submit-control', 'enter-in-form', 'send-shortcut', 'verb-name', 'unknown-target'])
export type RuleName = z.infer<typeof RuleName>

/**
 * `budget` is a run stopped by a cap: the per-run step or call cap, after which the computer is
 * held for a takeover, or the daily budget, which refuses the run before it starts and holds
 * nothing. `cancelled`: the user pressed Stop. `denied`: the run failed after the user denied one
 * of its actions, and its summary names the failure; a run that goes on after a Deny and ends its
 * turn is `done`. `unknown`: the server restarted after the user approved an action, and the
 * platform cannot tell whether it happened. The run's chat card and its end summary say which.
 */
export const RunOutcome = z.enum(['done', 'failed', 'blocked', 'budget', 'stuck', 'denied', 'cancelled', 'unknown'])
export type RunOutcome = z.infer<typeof RunOutcome>

const envelope = { t: z.string(), runId: z.string(), botId: z.string() }

/** One line of runs/<id>/events.jsonl. `input` is the model's raw tool input and stays unknown. */
export const RunEvent = z.discriminatedUnion('type', [
  // Written when the goal is accepted, before its turn on the queue: the record a restart finds.
  z.object({ ...envelope, type: z.literal('queued'), goal: z.string(), source: z.enum(['message', 'routine']), routineName: z.string().optional() }),
  z.object({ ...envelope, type: z.literal('step'), step: z.number().int(), action: z.string(), input: z.unknown() }),
  z.object({ ...envelope, type: z.literal('tool_call'), step: z.number().int(), name: z.string(), input: z.unknown() }),
  z.object({
    ...envelope,
    type: z.literal('tool_result'),
    step: z.number().int(),
    name: z.string(),
    ok: z.boolean(),
    summary: z.string(),
    shot: z.string().nullable(),
  }),
  z.object({
    ...envelope,
    type: z.literal('gate'),
    step: z.number().int(),
    decision: z.enum(['allow', 'block', 'consume']),
    rule: RuleName.nullable(),
    announced: z.boolean(),
    approvalId: z.string().nullable(),
    reason: z.string(),
    /**
     * The control an allowed activation reached: its label, tag, role and page (origin and path, no
     * query). It makes the name rules measurable: which labels ran without a card. Absent from older
     * run logs and from events about no page control.
     */
    control: z.object({ kind: z.string(), tag: z.string(), role: z.string().nullable(), name: z.string(), page: z.string() }).optional(),
  }),
  z.object({ ...envelope, type: z.literal('approval'), approvalId: z.string(), status: z.enum(['pending', 'allowed', 'denied']) }),
  z.object({ ...envelope, type: z.literal('takeover'), status: z.enum(['started', 'handback-refused', 'ended']), reason: z.string() }),
  z.object({ ...envelope, type: z.literal('status'), text: z.string(), botState: BotState }),
  z.object({
    ...envelope,
    type: z.literal('cost'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    usd: z.number(),
    // Optional so existing run logs still parse. Counts come from the API, never from text length.
    response: z.object({
      call: z.number().int(), step: z.number().int(), maxTokens: z.number().int(),
      stopReason: z.string().nullable(), discarded: z.boolean(),
      thinkingTokens: z.number().nullable(), blockTypes: z.array(z.string()), toolNames: z.array(z.string()),
      thinkingSummary: z.string(), thinkingSummaryTruncated: z.boolean(), textChars: z.number().int(),
    }).optional(),
  }),
  z.object({ ...envelope, type: z.literal('end'), outcome: RunOutcome, summary: z.string() }),
  // What the model wrote in a turn, cut to a few thousand characters: the run's own reasoning, so a
  // loop can be read afterwards; without it, the screenshots are the only record of a loop.
  z.object({ ...envelope, type: z.literal('text'), step: z.number().int(), text: z.string() }),
])
export type RunEvent = z.infer<typeof RunEvent>

/** A RunEvent without its envelope; `Omit` would collapse the union, so it distributes. */
export type RunEventBody = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, 't' | 'runId' | 'botId'> : never) : never
