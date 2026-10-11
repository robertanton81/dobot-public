import { randomUUID } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import { log } from '../log'
import { chatFile, isNotFound, PRIVATE_FILE, withFileLock, writeFileAtomic } from './paths'
import { CHAT_LIMITS, ChatMessage, type Card } from './types'

export type ChatInput = { role: 'user' | 'bot' } & { text: string } | { role: 'card'; card: Card }

// Every write to one chat.jsonl goes through the file's write chain. An update rewrites the whole
// file through a rename; an append that lands on the old file between the read and the rename would
// be lost without the chain (an approval decided while the user types, for example).

// Chat text is display text: a long answer or a long page address never fails the writer. Text is
// split into several messages, so nothing is lost; a card's fields are cut with an ellipsis.

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = Array.from(text.slice(0, max - 1))
  // A cut inside a surrogate pair would leave half a character.
  if (/[\uD800-\uDBFF]$/.test(cut.at(-1) ?? '')) cut.pop()
  return cut.join('') + '…'
}

/** The text as the messages that hold it: one when it fits, else pieces cut at a line break where one is near. */
export function splitChatText(text: string): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > CHAT_LIMITS.long) {
    let at = rest.lastIndexOf('\n', CHAT_LIMITS.long)
    if (at < CHAT_LIMITS.long / 2) at = CHAT_LIMITS.long
    // Never between the two halves of one character.
    if (at === CHAT_LIMITS.long && /[\uD800-\uDBFF]/.test(rest[at - 1] ?? '')) at -= 1
    parts.push(rest.slice(0, at))
    rest = rest.slice(at)
  }
  parts.push(rest)
  return parts
}

const LONG_FIELDS = new Set(['body', 'instruction', 'connectorArgs'])
const ID_FIELDS = new Set(['card', 'approvalId', 'runId', 'shot', 'status', 'actionKind'])

/** The card with every display field cut to its limit. Ids and enums pass as they are: a wrong one must still fail. */
export function fitCard(card: Card): Card {
  const fitted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(card)) {
    if (ID_FIELDS.has(key)) fitted[key] = value
    else if (typeof value === 'string') fitted[key] = clip(value, key === 'url' ? CHAT_LIMITS.url : LONG_FIELDS.has(key) ? CHAT_LIMITS.long : CHAT_LIMITS.short)
    else if (Array.isArray(value)) fitted[key] = value.slice(0, 10).map((item) => (typeof item === 'string' ? clip(item, CHAT_LIMITS.short) : item))
    else fitted[key] = value
  }
  return fitted as Card
}

/**
 * Appends one JSON line to chat.jsonl and returns the stored message (with id and time). A card is
 * fitted to the limits. Text longer than one message is cut here; a caller that must keep all of it
 * posts the pieces of splitChatText.
 */
export async function appendChat(dataDir: string, botId: string, input: ChatInput): Promise<ChatMessage> {
  const message: ChatMessage =
    input.role === 'card'
      ? { id: randomUUID(), t: new Date().toISOString(), botId, role: 'card', card: fitCard(input.card) }
      : { id: randomUUID(), t: new Date().toISOString(), botId, role: input.role, text: clip(input.text, CHAT_LIMITS.long) }
  ChatMessage.parse(message)
  const path = chatFile(dataDir, botId)
  await withFileLock(path, () => appendFile(path, JSON.stringify(message) + '\n', { encoding: 'utf8', mode: PRIVATE_FILE }))
  return message
}

/** The last `limit` messages in order. A corrupt line is skipped and logged, never fatal. */
export async function readChat(dataDir: string, botId: string, opts: { limit: number }): Promise<ChatMessage[]> {
  let raw: string
  try {
    raw = await readFile(chatFile(dataDir, botId), 'utf8')
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const messages: ChatMessage[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      log.warn('skipping a corrupt chat line', { botId, line: i + 1 })
      continue
    }
    const parsed = ChatMessage.safeParse(json)
    if (!parsed.success) {
      log.warn('skipping a chat line that does not match the schema', { botId, line: i + 1 })
      continue
    }
    messages.push(parsed.data)
  }
  return messages.slice(Math.max(0, messages.length - opts.limit))
}

/**
 * Replaces the card of one message (an approval that was decided, a takeover that ended).
 * The file is rewritten through a temp file, under the file's write lock so no append is lost;
 * returns the updated message or null when unknown.
 */
export async function updateChatCard(dataDir: string, botId: string, messageId: string, card: Card): Promise<ChatMessage | null> {
  const path = chatFile(dataDir, botId)
  return withFileLock(path, async () => {
    const messages = await readChat(dataDir, botId, { limit: Number.MAX_SAFE_INTEGER })
    const index = messages.findIndex((m) => m.id === messageId && m.role === 'card')
    const current = messages[index]
    if (!current) return null
    const updated = ChatMessage.parse({ ...current, card: fitCard(card) })
    messages[index] = updated
    await writeFileAtomic(path, messages.map((m) => JSON.stringify(m)).join('\n') + '\n')
    return updated
  })
}
