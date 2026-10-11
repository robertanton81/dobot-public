import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore, type ChatMessage, type Store } from '../store'
import { BotEvents } from '../bot-events'
import { sseHandler } from './sse'

// The stream subscribes before it reads the history. If it subscribed only after the history had
// been read and sent, a card posted in that gap would not reach the page until a reload.

let dataDir: string
let store: Store
let botId: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-sse-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Worker', persona: 'Works.' })).id
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

type Frame = { event: string; data: unknown }

/** Reads frames until `count` have arrived, then closes the connection. */
async function readFrames(res: Response, count: number): Promise<Frame[]> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  const decoder = new TextDecoder()
  let buffered = ''
  const frames: Frame[] = []
  while (frames.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const parts = buffered.split('\n\n')
    buffered = parts.pop() ?? ''
    for (const part of parts) {
      const event = part.match(/^event: (.*)$/m)?.[1]
      const data = part.match(/^data: (.*)$/m)?.[1]
      if (event && data !== undefined) frames.push({ event, data: JSON.parse(data) })
    }
  }
  await reader.cancel()
  return frames
}

describe('the event stream', () => {
  it('delivers events emitted while the snapshot is being read, after the snapshot and in order', async () => {
    const events = new BotEvents()
    const inHistory = await store.appendChat(botId, { role: 'user', text: 'before' })
    // The snapshot is taken at once but handed over only when the test says so: what is emitted in
    // between is not in the snapshot: it is the window in which a late subscription loses events.
    let started!: () => void
    let release!: () => void
    const reading = new Promise<void>((resolve) => (started = resolve))
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: Store = {
      ...store,
      readChat: async (id, opts) => {
        const snapshot = await store.readChat(id, opts)
        started()
        await gate
        return snapshot
      },
    }
    const app = new Hono().get('/events/:botId', sseHandler(slow, events))

    const pending = app.request(`/events/${botId}`)
    await reading
    const card = await store.appendChat(botId, { role: 'card', card: { card: 'takeover', reason: 'sign in', status: 'active' } })
    const answer = await store.appendChat(botId, { role: 'bot', text: 'after the card' })
    events.emitChat(card)
    events.emitChat(answer)
    release()

    const frames = await readFrames(await pending, 4)
    expect(frames.map((f) => f.event)).toEqual(['bot', 'chat', 'chat', 'chat'])
    expect(frames.slice(1).map((f) => (f.data as ChatMessage).id)).toEqual([inHistory.id, card.id, answer.id])
  })

  // A chat file that cannot be read must not pass as an unknown bot: a 404 would hide the failure.
  it('a chat file that cannot be read is a server error, not an unknown bot, and leaves no listener', async () => {
    const events = new BotEvents()
    const failing: Store = {
      ...store,
      readChat: async () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      },
    }
    const app = new Hono().get('/events/:botId', sseHandler(failing, events))
    const res = await app.request(`/events/${botId}`)
    expect(res.status).toBe(500)
    const emitter = (events as unknown as { emitter: { listenerCount(name: string): number } }).emitter
    expect(emitter.listenerCount(botId)).toBe(0)
  })

  it('answers 404 for an unknown bot and leaves no listener behind', async () => {
    const events = new BotEvents()
    const app = new Hono().get('/events/:botId', sseHandler(store, events))
    const res = await app.request('/events/no-such-bot')
    expect(res.status).toBe(404)
    // A leaked listener would receive this; the emitter's count says whether one is there.
    const emitter = (events as unknown as { emitter: { listenerCount(name: string): number } }).emitter
    expect(emitter.listenerCount('no-such-bot')).toBe(0)
  })
})
