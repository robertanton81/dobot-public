import type { BotState } from './api'

/** What a tab knows about its own takeover when the server's state moves on. */
export type TakeoverTab = {
  takingOver: boolean
  interactiveUrl: string | null
  /** The bot's takeover card switched this tab to the screen; false when the user pressed Take over. */
  switchedByCard: boolean
  /** The chat holds a takeover card that is still active. */
  cardActive: boolean
  /** This tab's own Hand back request is on its way. */
  handingBack: boolean
}

/**
 * Whether a tab in takeover mode goes back to watching, and whether it says why.
 *
 * The bot acts again: the server hands out an interactive stream only while the bot is idle or
 * blocked, so a tab that holds one while the bot is working or waiting got it before the bot took
 * control back. A goal or a routine started on an idle bot whose screen the user had taken, which
 * ends no card, or another copy of the page handed back. The tab drops the stream at once,
 * whoever opened it: the user never types while the model acts. It says why when the user opened
 * the takeover and did not end it here. A tab that pressed Take over during a run holds no
 * interactive stream until the bot is blocked, so its wait for the hand-over goes on.
 *
 * The card ended elsewhere (another copy of the page handed back, or Stop): a tab that the card
 * switched to the screen switches back without a word. Only a switch the card made is undone by
 * the card's end. The server ends the card first and sets the bot's state second; the two can
 * reach the page in one render or in two, and one decision covers both.
 *
 * The run ended before it could hand over: a tab that pressed Take over during a run waits with no
 * interactive stream. When the bot is idle, no takeover will come, and the tab would say "you have
 * the screen" over a view-only stream. It leaves and says so. A takeover of an idle bot sets the
 * stream and the takeover mode in one step, so that tab never matches here.
 */
export function takeoverEnd(tab: TakeoverTab, botState: BotState | undefined): 'stay' | 'leave' | 'leave-and-say-why' | 'leave-run-ended' {
  if (!tab.takingOver) return 'stay'
  const botActs = tab.interactiveUrl !== null && (botState === 'working' || botState === 'waiting')
  if (botActs) return tab.switchedByCard || tab.handingBack ? 'leave' : 'leave-and-say-why'
  if (!tab.switchedByCard && tab.interactiveUrl === null && botState === 'idle') return 'leave-run-ended'
  return tab.switchedByCard && !tab.cardActive ? 'leave' : 'stay'
}

/**
 * Whether a tab that only watches switches to the screen because the chat holds an active takeover
 * card while the bot is blocked (a page reload during a takeover). A card that this tab has just
 * handed back does not count: the hand-back answers before the card's end and the bot's new state
 * reach the page, and for that moment the page still holds "card active" and "blocked".
 */
export function entersByCard(tab: { takingOver: boolean; activeCardId: string | null; handedBackCardId: string | null }, botState: BotState | undefined): boolean {
  if (tab.takingOver || tab.activeCardId === null || botState !== 'blocked') return false
  return tab.activeCardId !== tab.handedBackCardId
}
