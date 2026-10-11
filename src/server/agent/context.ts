import type { ChatMessage } from '../store'

// The few chat lines a goal answers. The whole transcript never reaches the model: memory is for
// what must last, and this window is for "yes", "that one" and "make it shorter".

export const RECENT_LINES = 6
/** How many chat messages to read to find those lines: cards are left out first, and a run posts several cards between two lines of talk. */
export const RECENT_LOOKBACK = 40
export const RECENT_CHARS = 4_000
const LINE_CHARS = 1_000

/**
 * The last lines before the goal, newest last, as `user: …` and `<bot name>: …`. Cards are left
 * out (they are the platform's, not the conversation's); the newest copy of the goal is left out,
 * because it is sent on its own under the context. Bounded by lines and by characters, newest first.
 */
export function recentConversation(chat: ChatMessage[], goal: string, botName: string): string {
  const texts = chat.filter((m) => m.role !== 'card' && typeof m.text === 'string')
  const goalIndex = texts.map((m) => m.role === 'user' && m.text === goal).lastIndexOf(true)
  const before = goalIndex === -1 ? texts : [...texts.slice(0, goalIndex), ...texts.slice(goalIndex + 1)]
  const lines: string[] = []
  let chars = 0
  for (const m of before.slice(-RECENT_LINES).reverse()) {
    const text = (m.text ?? '').replace(/\s+/g, ' ').trim()
    const line = `${m.role === 'user' ? 'user' : botName}: ${text.length > LINE_CHARS ? text.slice(0, LINE_CHARS - 1) + '…' : text}`
    if (chars + line.length > RECENT_CHARS) break
    chars += line.length
    lines.unshift(line)
  }
  return lines.join('\n')
}

/**
 * The platform's clock as one line: when the run started, on the routines' clock (`TZ`), never in
 * UTC. The model has no clock of its own; without this line a bot whose newest memory note is a
 * day old takes that day for today. The line stands in the first message
 * and not in the system prompt, so the system block of two runs with the same memory stays
 * identical for the prompt cache. It says "started", because a run can wait for its user for half
 * an hour; a run that crosses midnight keeps the date of its start.
 */
export function runClockLine(startedAt: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(startedAt)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return `Platform clock: this run started on ${part('weekday')}, ${part('day')} ${part('month')} ${part('year')} at ${part('hour')}:${part('minute')} (${timezone}).`
}

/** The first user message of a run: the platform's clock, the recent lines if there are any, the goal. */
export function firstUserMessage(clock: string, recent: string, goal: string): string {
  return recent === '' ? `${clock}\n\nGoal: ${goal}` : `${clock}\n\nRecent conversation, newest last (context only):\n${recent}\n\nGoal: ${goal}`
}
