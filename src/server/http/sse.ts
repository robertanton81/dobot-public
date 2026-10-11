import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { BotEvent, BotEvents } from '../bot-events'
import { toBotView } from '../bot-view'
import { errorFields, log } from '../log'
import { assertSlug, isNotFound, type Bot, type ChatMessage, type Store } from '../store'

// One SSE stream per bot: `bot` (state and status line), `chat` (a new or updated message) and
// `run` (one run event). On connect the page gets the bot and the last 50 chat messages, then
// every event from the moment the connection was accepted: the subscription is opened before the
// snapshot is read and events that arrive meanwhile are held back and sent after it, in order.
// A message that is in the snapshot and in the held-back events reaches the page twice; the
// page replaces a message by id, so the later copy wins and nothing is lost.

const HISTORY = 50
const PING_MS = 15_000

export function sseHandler(store: Store, events: BotEvents) {
  return async (c: Context): Promise<Response> => {
    const botId = c.req.param('botId') ?? ''
    try {
      assertSlug(botId)
    } catch {
      return c.json({ error: 'invalid bot id' }, 400)
    }
    // Subscribed first: nothing emitted while the snapshot is read can slip past this connection.
    const held: BotEvent[] = []
    let deliver: (event: BotEvent) => void = (event) => held.push(event)
    const unsubscribe = events.subscribe(botId, (event) => deliver(event))
    let bot: Bot
    let history: ChatMessage[]
    try {
      bot = await store.readBot(botId)
      history = await store.readChat(botId, { limit: HISTORY })
    } catch (e) {
      unsubscribe()
      // A missing folder is a 404; anything else (a chat file that cannot be read) reaches
      // app.onError, which logs it and answers 500, instead of passing as an unknown bot.
      if (isNotFound(e)) return c.json({ error: 'unknown bot' }, 404)
      throw e
    }
    return streamSSE(
      c,
      async (stream) => {
        let counter = 0
        const send = async (event: BotEvent): Promise<void> => {
          counter += 1
          await stream.writeSSE({ event: event.event, data: JSON.stringify(event.data), id: String(counter) })
        }
        // Live events are written one after another, in the order they arrived.
        let chain: Promise<void> = Promise.resolve()
        const enqueue = (event: BotEvent): void => {
          chain = chain.then(() => send(event)).catch((e: unknown) => log.warn('sse write failed', { botId, ...errorFields(e) }))
        }
        stream.onAbort(unsubscribe)
        try {
          await send({ event: 'bot', data: toBotView(bot) })
          for (const message of history) await send({ event: 'chat', data: message })
          // The switch to live delivery and the flush of the held events happen in one synchronous
          // block, so no event can arrive between them and jump the queue.
          for (const event of held) enqueue(event)
          held.length = 0
          deliver = enqueue
          while (!stream.aborted && !stream.closed) {
            await stream.sleep(PING_MS)
            if (stream.aborted || stream.closed) break
            await stream.write(': ping\n\n')
          }
        } finally {
          // Whatever ends the stream — the client leaving, an error, the loop above — the listener goes.
          unsubscribe()
        }
      },
      async (e) => {
        log.warn('sse stream error', { botId, ...errorFields(e) })
      },
    )
  }
}
