import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../store'
import { firstUserMessage, RECENT_CHARS, RECENT_LINES, recentConversation, runClockLine } from './context'

let n = 0
function line(role: 'user' | 'bot', text: string): ChatMessage {
  n += 1
  return { id: `m${n}`, t: `2026-09-13T10:00:${String(n).padStart(2, '0')}.000Z`, botId: 'b', role, text }
}
const card: ChatMessage = { id: 'c1', t: '2026-09-13T10:00:00.000Z', botId: 'b', role: 'card', card: { card: 'status', text: 'my computer is ready' } }

describe('recentConversation', () => {
  it('gives the last lines before the goal, cards left out, the goal itself left out, newest last', () => {
    const chat = [line('user', 'Prepare a letter for Acme'), card, line('bot', 'I saved letter-acme.md. Do you want it shorter?'), line('user', 'make that letter shorter')]
    expect(recentConversation(chat, 'make that letter shorter', 'Hunter')).toBe('user: Prepare a letter for Acme\nHunter: I saved letter-acme.md. Do you want it shorter?')
  })

  it('is empty for a fresh chat and for a chat that holds only the goal', () => {
    expect(recentConversation([], 'go', 'Hunter')).toBe('')
    expect(recentConversation([line('user', 'go')], 'go', 'Hunter')).toBe('')
  })

  it('keeps at most the last RECENT_LINES lines and at most RECENT_CHARS characters', () => {
    const many = Array.from({ length: RECENT_LINES + 3 }, (_, i) => line(i % 2 === 0 ? 'user' : 'bot', `line ${i}`))
    expect(recentConversation(many, 'new goal', 'Hunter').split('\n')).toHaveLength(RECENT_LINES)
    const long = [line('bot', 'a'.repeat(900)), line('bot', 'b'.repeat(900)), line('bot', 'c'.repeat(900)), line('bot', 'd'.repeat(900)), line('bot', 'e'.repeat(900))]
    const text = recentConversation(long, 'new goal', 'Hunter')
    expect(text.length).toBeLessThanOrEqual(RECENT_CHARS)
    expect(text.endsWith('e'.repeat(900))).toBe(true)
  })

  it('leaves out only the newest copy of the goal, and folds line breaks', () => {
    const chat = [line('user', 'again'), line('bot', 'first\nanswer'), line('user', 'again')]
    expect(recentConversation(chat, 'again', 'Hunter')).toBe('user: again\nHunter: first answer')
  })
})

describe('runClockLine', () => {
  it('names the weekday, the date and the time on the given clock, and the clock itself', () => {
    expect(runClockLine(new Date('2026-09-19T06:13:34.000Z'), 'Europe/Prague')).toBe('Platform clock: this run started on Saturday, 19 September 2026 at 08:13 (Europe/Prague).')
  })

  it('gives the local date, ahead of or behind the UTC date depending on the zone', () => {
    const late = new Date('2026-09-18T22:30:00.000Z')
    expect(runClockLine(late, 'Europe/Prague')).toContain('Saturday, 19 September 2026 at 00:30')
    expect(runClockLine(late, 'UTC')).toContain('Friday, 18 September 2026 at 22:30')
    expect(runClockLine(new Date('2026-09-19T02:00:00.000Z'), 'America/New_York')).toContain('Friday, 18 September 2026 at 22:00')
  })

  it('writes midnight as 00, never as 24, and follows summer and winter time', () => {
    expect(runClockLine(new Date('2026-09-18T22:00:00.000Z'), 'Europe/Prague')).toContain('Saturday, 19 September 2026 at 00:00')
    expect(runClockLine(new Date('2026-12-01T06:05:00.000Z'), 'Europe/Prague')).toContain('Tuesday, 1 December 2026 at 07:05')
  })
})

describe('firstUserMessage', () => {
  const clock = 'Platform clock: this run started on Saturday, 19 September 2026 at 08:13 (Europe/Prague).'

  it('is the clock and the goal without context, and the context between them with it', () => {
    expect(firstUserMessage(clock, '', 'do it')).toBe(`${clock}\n\nGoal: do it`)
    expect(firstUserMessage(clock, 'user: hi', 'do it')).toBe(`${clock}\n\nRecent conversation, newest last (context only):\nuser: hi\n\nGoal: do it`)
  })
})
