import { describe, expect, it } from 'vitest'
import { entersByCard, takeoverEnd, type TakeoverTab } from './takeover-view'

const SCREEN = 'https://stream.example/interactive'
/** A tab whose user pressed Take over and got the interactive stream. */
const opened: TakeoverTab = { takingOver: true, interactiveUrl: SCREEN, switchedByCard: false, cardActive: false, handingBack: false }
/** A tab that the bot's takeover card switched to the interactive stream. */
const byCard: TakeoverTab = { ...opened, switchedByCard: true, cardActive: true }

// The user never types while the model acts. The page's part of that rule: a tab that still shows
// the interactive stream drops it as soon as the bot's state says the bot acts again.
describe('takeoverEnd', () => {
  it('ends a takeover of an idle bot when a goal or a routine starts, and says why', () => {
    expect(takeoverEnd(opened, 'idle')).toBe('stay')
    expect(takeoverEnd(opened, 'working')).toBe('leave-and-say-why')
  })

  it('ends a takeover that another copy of the page handed back, also when the run then waits for an approval', () => {
    expect(takeoverEnd({ ...opened, cardActive: true }, 'blocked')).toBe('stay')
    expect(takeoverEnd(opened, 'working')).toBe('leave-and-say-why')
    expect(takeoverEnd(opened, 'waiting')).toBe('leave-and-say-why')
  })

  it("says nothing after the tab's own Hand back, also when the new state arrives before the answer to that request", () => {
    expect(takeoverEnd({ ...opened, handingBack: true }, 'working')).toBe('leave')
  })

  it('does not touch a tab that pressed Take over during a run and waits for the bot to hand over', () => {
    expect(takeoverEnd({ ...opened, interactiveUrl: null }, 'working')).toBe('stay')
    expect(takeoverEnd({ ...opened, interactiveUrl: null }, 'waiting')).toBe('stay')
    expect(takeoverEnd({ ...opened, interactiveUrl: null, cardActive: true }, 'blocked')).toBe('stay')
  })

  it('takes a tab out of its wait when the run ended before the bot could hand the screen over', () => {
    // Take over was pressed late in a run: the run ended, no takeover happened, the bot is idle.
    expect(takeoverEnd({ ...opened, interactiveUrl: null }, 'idle')).toBe('leave-run-ended')
    // A tab that took over an idle bot holds its stream and stays.
    expect(takeoverEnd(opened, 'idle')).toBe('stay')
  })

  // The server ends the card first and sets the bot to working second. The two events can reach
  // the page in one render or in two; a tab the card switched goes back without a word either way.
  it('takes a tab that the card switched back without a notice, whether the two events come together or apart', () => {
    expect(takeoverEnd(byCard, 'blocked')).toBe('stay')
    expect(takeoverEnd({ ...byCard, cardActive: false }, 'blocked')).toBe('leave')
    expect(takeoverEnd({ ...byCard, cardActive: false }, 'working')).toBe('leave')
    expect(takeoverEnd({ ...byCard, cardActive: false }, 'idle')).toBe('leave')
  })

  it('takes the screen back from a tab the card switched when the bot works and the end of the card never arrived', () => {
    expect(takeoverEnd(byCard, 'working')).toBe('leave')
  })

  it('does nothing in a tab that only watches, and nothing before the bot is known', () => {
    expect(takeoverEnd({ ...opened, takingOver: false, interactiveUrl: null }, 'working')).toBe('stay')
    expect(takeoverEnd(opened, undefined)).toBe('stay')
  })
})

describe('entersByCard', () => {
  const watching = { takingOver: false, activeCardId: 'card-1', handedBackCardId: null }

  it('switches a watching tab to the screen when the bot is blocked under an active card', () => {
    expect(entersByCard(watching, 'blocked')).toBe(true)
    expect(entersByCard(watching, 'working')).toBe(false)
    expect(entersByCard({ ...watching, activeCardId: null }, 'blocked')).toBe(false)
    expect(entersByCard({ ...watching, takingOver: true }, 'blocked')).toBe(false)
  })

  it('does not go back to the screen for the card this tab has just handed back, but does for the next card', () => {
    expect(entersByCard({ ...watching, handedBackCardId: 'card-1' }, 'blocked')).toBe(false)
    expect(entersByCard({ ...watching, activeCardId: 'card-2', handedBackCardId: 'card-1' }, 'blocked')).toBe(true)
  })
})
