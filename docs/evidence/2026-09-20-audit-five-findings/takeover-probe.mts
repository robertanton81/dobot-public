// A no-cost probe of the takeover page: the real HTTP app, runner, scheduler and store, with a
// fake computer and a fake model. No key is read, no sandbox is created, no model is called.
// Run from the repository root, after `pnpm build`, so the app serves the built page from dist/web:
//   pnpm tsx docs/evidence/2026-09-20-audit-five-findings/takeover-probe.mts
// Then open http://127.0.0.1:3199/ and follow the README next to this file.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WT = new URL('../../../src/server', import.meta.url).pathname
const { Approvals } = await import(`${WT}/agent/gate.ts`)
const { RunQueue } = await import(`${WT}/agent/queue.ts`)
const { Runner } = await import(`${WT}/agent/runner.ts`)
const { basePlatformTools } = await import(`${WT}/agent/tools.ts`)
const { FakeSandbox, message, textBlock, computerUse } = await import(`${WT}/agent/fakes.ts`)
const { BotEvents } = await import(`${WT}/bot-events.ts`)
const { createApp } = await import(`${WT}/http/app.ts`)
const { SandboxManager } = await import(`${WT}/sandbox/manager.ts`)
const { Scheduler } = await import(`${WT}/scheduler/scheduler.ts`)
const { createStore } = await import(`${WT}/store/index.ts`)
const { MAIL_EVENT } = await import(`${WT}/mail/watcher.ts`)

const PORT = 3199
const dataDir = await mkdtemp(join(tmpdir(), 'dobot-takeover-probe-'))
const store = createStore(dataDir)
const events = new BotEvents()

// The fake computer: its two "streams" are pages of this server.
const sandbox = new FakeSandbox()
const session = {
  sandbox,
  sandboxId: 'sbx-probe',
  streamViewUrl: `http://127.0.0.1:${PORT}/fake-screen/view`,
  streamInteractiveUrl: `http://127.0.0.1:${PORT}/fake-screen/interactive`,
  keepAlive: async () => undefined,
  pause: async () => 'paused' as const,
  syncWorkspace: async () => undefined,
}
// Timers that never fire: the fake computer is never paused during the probe.
const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, 'Europe/Prague', {
  factory: { create: async () => session, connect: async () => session },
  setTimer: () => 0,
  clearTimer: () => undefined,
})

// The fake model: the first call ends the turn at once (it brings the computer up); every later
// call waits until POST /probe/release, so the bot stays "working" long enough to look at the page.
let modelCalls = 0
let release: ((goOn: boolean) => void) | null = null
const model = {
  create: (_params: unknown, options?: { signal?: AbortSignal }) => {
    modelCalls += 1
    if (modelCalls === 1) return Promise.resolve(message([textBlock('The computer is up.')], 'end_turn'))
    return new Promise((resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      // goOn: the model asks for a screenshot, so the loop makes another turn (and can hand over first).
      release = (goOn) => resolve(goOn ? message([computerUse('screenshot')]) : message([textBlock('Read the mail; nothing to do.')], 'end_turn'))
    })
  },
}

const approvals = new Approvals()
const runner = new Runner({
  store, events, approvals, queue: new RunQueue(), sandboxes, model, modelId: 'claude-sonnet-5', tools: basePlatformTools,
  dailyBudgetUsd: 25, timezone: 'Europe/Prague', blockedHoldMs: 30 * 60_000,
  reloadRoutines: (botId: string) => scheduler.reload(botId),
})
const scheduler = new Scheduler({
  store, enqueueRun: (botId: string, input: unknown) => runner.enqueue(botId, input), now: () => new Date(), timezone: 'Europe/Prague',
  onBotUpdated: (bot: unknown) => events.emitBot(bot),
})

const bot = await store.createBot({ name: 'Probe', persona: 'Reads mail.' })
await store.writeSkill(bot.id, { name: 'read-mail', description: 'Read mail', body: 'Read the mail.' })
await store.writeRoutine(bot.id, { name: 'on-mail', skill: 'read-mail', schedule: null, event: MAIL_EVENT, enabled: true, body: 'Read the new mail.' })
await scheduler.reload(bot.id)
// One quick run brings the fake computer up, as a first goal does.
await runner.enqueue(bot.id, { goal: 'wake up', activeSkill: null, source: 'message' })

const screen = (mode: string) => `<!doctype html><meta charset="utf-8"><body style="font:16px sans-serif;padding:24px;background:${mode === 'interactive' ? '#fee2e2' : '#e0f2fe'}">
<h2 id="mode">${mode === 'interactive' ? 'INTERACTIVE STREAM: keyboard and mouse reach the computer' : 'VIEW-ONLY STREAM'}</h2>
${mode === 'interactive' ? '<input id="typed" placeholder="the human types here" style="font:16px sans-serif;width:320px">' : ''}</body>`

const root = new Hono()
root.get('/fake-screen/:mode', (c) => c.html(screen(c.req.param('mode'))))
root.post('/probe/fire-mail', (c) => {
  // Not awaited: it resolves when the run has ended.
  void scheduler.fireEvent(MAIL_EVENT)
  return c.json({ fired: true })
})
root.post('/probe/release', (c) => {
  const had = release !== null
  const waiting = release
  release = null
  waiting?.(c.req.query('then') === 'screenshot')
  return c.json({ released: had })
})
root.get('/probe/state', async (c) => c.json({ botId: bot.id, state: (await store.readBot(bot.id)).state, modelCalls, activeRun: runner.activeRunId(bot.id) }))
root.route('/', createApp({ store, events, approvals, runner, sandboxes, onRoutineSaved: (botId: string) => scheduler.reload(botId) }))

serve({ fetch: root.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`takeover probe listening on ${info.port}; bot ${bot.id}; data ${dataDir}`)
})
