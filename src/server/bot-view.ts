import type { Bot } from './store'

/** The bot as the page sees it: no sandbox id, no timers. The design law says the page shows only the state. */
export type BotView = Pick<Bot, 'id' | 'name' | 'avatar' | 'persona' | 'state' | 'statusLine' | 'createdAt'>

export function toBotView(bot: Bot): BotView {
  return { id: bot.id, name: bot.name, avatar: bot.avatar, persona: bot.persona, state: bot.state, statusLine: bot.statusLine, createdAt: bot.createdAt }
}
