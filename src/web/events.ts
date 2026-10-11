import type { Bot, ChatMessage, RunEvent } from './api'

// One EventSource per selected bot. The browser reconnects on its own when the connection drops.

export type Handlers = {
  onBot(bot: Bot): void
  onChat(message: ChatMessage): void
  onRun(event: RunEvent): void
  onError(): void
}

export function subscribe(botId: string, handlers: Handlers): () => void {
  const source = new EventSource(`/events/${botId}`)
  const parse = <T>(raw: string): T | null => {
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  source.addEventListener('bot', (e) => {
    const bot = parse<Bot>((e as MessageEvent<string>).data)
    if (bot) handlers.onBot(bot)
  })
  source.addEventListener('chat', (e) => {
    const message = parse<ChatMessage>((e as MessageEvent<string>).data)
    if (message) handlers.onChat(message)
  })
  source.addEventListener('run', (e) => {
    const event = parse<RunEvent>((e as MessageEvent<string>).data)
    if (event) handlers.onRun(event)
  })
  source.onerror = () => handlers.onError()
  return () => source.close()
}
