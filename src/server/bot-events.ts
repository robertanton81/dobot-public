import { EventEmitter } from 'node:events'
import { toBotView, type BotView } from './bot-view'
import type { Bot, ChatMessage, RunEvent } from './store'

// The in-process event bus: what happens to a bot, told to whoever listens. The run loop, the
// scheduler and the sandbox manager emit; the SSE handler subscribes, once per open page. A bot goes
// out as its view, so no listener ever holds the fields the page must not see.

export type BotEvent = { event: 'run'; data: RunEvent } | { event: 'chat'; data: ChatMessage } | { event: 'bot'; data: BotView }

export class BotEvents {
  private readonly emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(100)
  }

  emitRun(event: RunEvent): void {
    this.emitter.emit(event.botId, { event: 'run', data: event } satisfies BotEvent)
  }

  emitChat(message: ChatMessage): void {
    this.emitter.emit(message.botId, { event: 'chat', data: message } satisfies BotEvent)
  }

  emitBot(bot: Bot): void {
    this.emitter.emit(bot.id, { event: 'bot', data: toBotView(bot) } satisfies BotEvent)
  }

  subscribe(botId: string, listener: (event: BotEvent) => void): () => void {
    this.emitter.on(botId, listener)
    return () => this.emitter.off(botId, listener)
  }
}
