import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Approvals } from '../agent/gate'
import type { RunInput } from '../agent/run'
import { createStore, type RunEvent, type RunEventBody, type Store } from '../store'
import { createApp, type RunnerPort, type SandboxesPort } from './app'
import { BotEvents } from '../bot-events'

// The routes with a real store (temp folder) and a real Approvals registry; the runner and the
// sandbox manager are small stand-ins that record what the routes asked of them.

let dataDir: string
let store: Store
let botId: string
let approvals: Approvals
let runner: RunnerPort & { enqueued: RunInput[]; answers: boolean[]; busy: boolean; cancels: boolean[]; idleTakeovers: string[]; holdsForTakeover: boolean }
let app: ReturnType<typeof createApp>

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-app-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Worker', persona: 'Works.' })).id
  approvals = new Approvals()
  runner = {
    enqueued: [],
    answers: [],
    busy: false,
    cancels: [],
    idleTakeovers: [],
    holdsForTakeover: true,
    answerUser: () => runner.answers.shift() ?? false,
    accept: async (_id, input) => {
      runner.enqueued.push(input)
      return { runId: 'run-test', done: Promise.resolve(undefined) }
    },
    isBusy: () => runner.busy,
    cancel: () => runner.cancels.shift() ?? false,
    requestTakeover: () => false,
    handbackState: async () => ({ allowed: true, reason: '' }),
    handback: async () => ({ ok: true }),
    beginIdleTakeover: async (id) => {
      runner.idleTakeovers.push(id)
      if (!runner.holdsForTakeover) return null
      // The session the manager brought up for the takeover, which need not be the one the route saw first.
      return { sandboxId: 's', streamViewUrl: 'https://v.example/view', streamInteractiveUrl: 'https://v.example/fresh', sandbox: {} as never, keepAlive: async () => undefined, pause: async () => 'paused' as const, syncWorkspace: async () => undefined }
    },
  }
  const sandboxes: SandboxesPort = { get: () => null, setUp: async () => undefined }
  app = createApp({ store, events: new BotEvents(), approvals, runner, sandboxes })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('a save from the Skills tab', () => {
  const put = (path: string, body: unknown) => app.request(`/api/bots/${botId}/${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('is refused when the bot wrote a note after the tab loaded the memory, and the note stays', async () => {
    await store.appendMemory(botId, 'first note')
    const loaded = await store.readMemory(botId)
    await store.appendMemory(botId, 'applied to Acme; do not apply again')

    const stale = await put('memory', { text: loaded.replace('first', 'corrected'), base: loaded })
    expect(stale.status).toBe(409)
    expect(await store.readMemory(botId)).toContain('applied to Acme')

    const fresh = await store.readMemory(botId)
    const ok = await put('memory', { text: fresh.replace('first', 'corrected').trimEnd(), base: fresh })
    expect(ok.status).toBe(200)
    // The stored text comes back as the next base, and it ends with a line break, so the next note starts its own line.
    const stored = ((await ok.json()) as { text: string }).text
    expect(stored).toBe(await store.readMemory(botId))
    expect(stored.endsWith('\n')).toBe(true)
    await store.appendMemory(botId, 'next')
    expect((await store.readMemory(botId)).split('\n').filter(Boolean)).toHaveLength(3)
  })

  it('is refused when the bot rewrote the skill after the tab loaded it', async () => {
    await store.writeSkill(botId, { name: 'search', description: 'Search', body: 'Step one.\n' })
    const files = (await (await app.request(`/api/bots/${botId}/files`)).json()) as { skills: { name: string; text: string }[] }
    const base = files.skills[0]?.text ?? ''
    await store.writeSkill(botId, { name: 'search', description: 'Search', body: 'Step one.\nStep two, learned in a run.\n' })

    const stale = await put('skills/search', { text: base.replace('Step one.', 'Step 1.'), base })
    expect(stale.status).toBe(409)
    expect((await store.readSkill(botId, 'search'))?.body).toContain('Step two')
  })
  // The comparison with the base and the write are one step in the store, inside the file's write
  // chain: a note or a second save that arrives while a save is under way cannot slip in between.
  it('keeps a note the bot adds while the save is under way, or refuses the save', async () => {
    await store.writeMemory(botId, 'original\n')
    const saving = put('memory', { text: 'user edit\n', base: 'original\n' })
    const noting = store.appendMemory(botId, 'concurrent bot note')
    const [res] = await Promise.all([saving, noting])

    const stored = await store.readMemory(botId)
    expect(stored).toContain('concurrent bot note')
    if (res.status === 200) expect(stored).toContain('user edit')
    else expect(res.status).toBe(409)
  })

  it('lets only one of two saves from the same base through', async () => {
    await store.writeMemory(botId, 'original\n')
    const results = await Promise.all([put('memory', { text: 'edit A\n', base: 'original\n' }), put('memory', { text: 'edit B\n', base: 'original\n' })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])

    await store.writeSkill(botId, { name: 'search', description: 'Search', body: 'Step one.\n' })
    const files = (await (await app.request(`/api/bots/${botId}/files`)).json()) as { skills: { name: string; text: string }[] }
    const base = files.skills[0]?.text ?? ''
    const skillResults = await Promise.all([put('skills/search', { text: base.replace('one', 'A'), base }), put('skills/search', { text: base.replace('one', 'B'), base })])
    expect(skillResults.map((r) => r.status).sort()).toEqual([200, 409])
  })
})

describe('a refused hand-back', () => {
  it('answers 409 with the reason under the key the page reads for every error', async () => {
    runner.handback = async () => ({ ok: false, reason: 'the page still shows a secret field' })
    const res = await app.request(`/api/bots/${botId}/takeover/handback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'the page still shows a secret field' })
  })
})

describe('local access boundary', () => {
  it.each(['https://outside.example', 'http://outside.example:3000', 'http://localhost.outside.example:3000'])(
    'rejects origin %s before a goal reaches chat or the runner', async (origin) => {
    const res = await app.request(`http://127.0.0.1:3000/api/bots/${botId}/messages`, {
      method: 'POST',
      headers: { origin, 'content-type': 'text/plain' },
      body: JSON.stringify({ text: 'start a job' }),
    })
    expect(res.status).toBe(403)
    expect(runner.enqueued).toEqual([])
    expect(await store.readChat(botId, { limit: 5 })).toEqual([])
  })

  it('rejects an outside Host before returning bot data', async () => {
    const res = await app.request('/api/bots', { headers: { host: 'outside.example:3000' } })
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain(botId)
  })

  it('rejects a null origin without deciding an approval', async () => {
    const approval = approvals.propose(botId, 'run-1', 1, { kind: 'send', target: 'Send', page: 'https://example.com' })
    const res = await app.request(`/api/bots/${botId}/approvals/${approval.id}`, {
      ...json({ decision: 'allow' }), headers: { origin: 'null', 'content-type': 'application/json' },
    })
    expect(res.status).toBe(403)
    expect(approvals.get(approval.id)?.status).toBe('pending')
  })

  it('rejects a cross-site browser request without an Origin header', async () => {
    const res = await app.request('/api/bots', { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(res.status).toBe(403)
  })

  it('accepts the page served by this server', async () => {
    const res = await app.request('http://127.0.0.1:3000/api/health', { headers: { origin: 'http://localhost:3000', host: '127.0.0.1:3000' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('accepts the page\'s development server only when the server was started for development', async () => {
    const dev = createApp({ store, events: new BotEvents(), approvals, runner, sandboxes: { get: () => null, setUp: async () => undefined }, devPage: true })
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const headers = { origin, host: '127.0.0.1:3000' }
      expect((await dev.request('http://127.0.0.1:3000/api/health', { headers })).status, origin).toBe(200)
      expect((await app.request('http://127.0.0.1:3000/api/health', { headers })).status, origin).toBe(403)
    }
    expect((await dev.request('http://127.0.0.1:3000/api/health', { headers: { origin: 'http://localhost:5174', host: '127.0.0.1:3000' } })).status).toBe(403)
  })
})

describe('approval decision route (invariant 4)', () => {
  it('answers 404 for an unknown approval', async () => {
    const res = await app.request(`/api/bots/${botId}/approvals/nope`, json({ decision: 'allow' }))
    expect(res.status).toBe(404)
  })

  it('decides a pending approval once and answers 409 for a second decision without changing it', async () => {
    const approval = approvals.propose(botId, 'run-1', 1, { kind: 'send', target: 'Send', page: 'https://example.com/mail' })
    expect((await app.request(`/api/bots/${botId}/approvals/${approval.id}`, json({ decision: 'deny' }))).status).toBe(204)
    expect(approvals.get(approval.id)?.status).toBe('denied')
    expect((await app.request(`/api/bots/${botId}/approvals/${approval.id}`, json({ decision: 'allow' }))).status).toBe(409)
    expect(approvals.get(approval.id)?.status).toBe('denied')
  })

  it('refuses to decide another bot\'s approval and leaves it pending', async () => {
    const other = await store.createBot({ name: 'Other', persona: 'x' })
    const approval = approvals.propose(other.id, 'run-2', 1, { kind: 'send', target: 'Send', page: 'https://example.com/mail' })
    const res = await app.request(`/api/bots/${botId}/approvals/${approval.id}`, json({ decision: 'allow' }))
    expect(res.status).toBe(404)
    expect(approvals.get(approval.id)?.status).toBe('pending')
  })

  it('rejects a decision that is neither allow nor deny', async () => {
    const approval = approvals.propose(botId, 'run-1', 1, { kind: 'send', target: 'Send', page: 'https://example.com/mail' })
    expect((await app.request(`/api/bots/${botId}/approvals/${approval.id}`, json({ decision: 'maybe' }))).status).toBe(400)
    expect(approvals.get(approval.id)?.status).toBe('pending')
  })
})

describe('creating a bot', () => {
  it('answers while the computer setup it started for the new bot is still going', async () => {
    const setUp: string[] = []
    // A setup that never ends: an answer proves the route did not wait for it.
    const never = new Promise<void>(() => undefined)
    const wired = createApp({ store, events: new BotEvents(), approvals, runner, sandboxes: { get: () => null, setUp: (id) => (setUp.push(id), never) } })
    const res = await wired.request('/api/bots', json({ name: 'New', persona: 'Fresh.' }))
    expect(res.status).toBe(201)
    const { bot } = (await res.json()) as { bot: { id: string } }
    expect(setUp).toEqual([bot.id])
  })
})

describe('messages route', () => {
  it('answers a waiting ask_user instead of starting a run', async () => {
    runner.answers.push(true)
    const res = await app.request(`/api/bots/${botId}/messages`, json({ text: 'Prague' }))
    expect(await res.json()).toMatchObject({ answered: true, message: { role: 'user', text: 'Prague' } })
    const listed = (await (await app.request('/api/bots')).json()) as { bots: Record<string, unknown>[] }
    expect(Object.keys(listed.bots[0] ?? {}).sort()).toEqual(['avatar', 'createdAt', 'id', 'name', 'persona', 'state', 'statusLine'])
    expect(runner.enqueued).toEqual([])
    expect((await store.readChat(botId, { limit: 5 })).map((m) => m.text)).toEqual(['Prague'])
  })

  it('starts a run with the text as the goal when nothing is waiting', async () => {
    const res = await app.request(`/api/bots/${botId}/messages`, json({ text: 'find a job' }))
    expect(await res.json()).toMatchObject({ answered: false, runId: 'run-test' })
    expect(runner.enqueued).toEqual([{ goal: 'find a job', activeSkill: null, source: 'message' }])
  })
})

describe('input handling', () => {
  it('answers 400 for a body that is not JSON, 413 for an oversized one, 404 for an unknown bot', async () => {
    const bad = await app.request(`/api/bots/${botId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ nope' })
    expect(bad.status).toBe(400)
    const big = await app.request(`/api/bots/${botId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '999999999' }, body: '{}' })
    expect(big.status).toBe(413)
    expect((await app.request('/api/bots/ghost-1', { method: 'GET' })).status).toBe(404)
    expect((await app.request('/api/bots/Ghost', { method: 'GET' })).status).toBe(400) // not a slug: never reaches the disk
  })

  it('validates the screenshot route parameters before touching the disk', async () => {
    expect((await app.request(`/api/bots/${botId}/runs/run-1/shots/notahash`)).status).toBe(400)
    expect((await app.request(`/api/bots/${botId}/runs/..%2F..%2Fx/shots/${'a'.repeat(64)}`)).status).toBe(400)
    expect((await app.request(`/api/bots/${botId}/runs/run-1/shots/${'a'.repeat(64)}`)).status).toBe(404)
  })

  it('answers 409 for the stream while the computer is not running and 403 for the interactive stream while working', async () => {
    expect((await app.request(`/api/bots/${botId}/stream`)).status).toBe(409)
    const withSession = createApp({
      store,
      events: new BotEvents(),
      approvals,
      runner,
      sandboxes: {
        get: () => ({ sandboxId: 's', streamViewUrl: 'https://v.example/view', streamInteractiveUrl: 'https://v.example/full', sandbox: {} as never, keepAlive: async () => undefined, pause: async () => 'paused' as const, syncWorkspace: async () => undefined }),
        setUp: async () => undefined,
      },
    })
    expect(await (await withSession.request(`/api/bots/${botId}/stream`)).json()).toEqual({ url: 'https://v.example/view' })
    await store.updateBot(botId, { state: 'working' })
    expect((await withSession.request(`/api/bots/${botId}/stream?mode=interactive`)).status).toBe(403)
    await store.updateBot(botId, { state: 'blocked' })
    expect(await (await withSession.request(`/api/bots/${botId}/stream?mode=interactive`)).json()).toEqual({ url: 'https://v.example/full' })
    // A blocked bot's computer is held already; an idle bot's is held from this request on, and the
    // stream comes from the session the hold brought up.
    expect(runner.idleTakeovers).toEqual([])
    await store.updateBot(botId, { state: 'idle' })
    expect(await (await withSession.request(`/api/bots/${botId}/stream?mode=interactive`)).json()).toEqual({ url: 'https://v.example/fresh' })
    expect(runner.idleTakeovers).toEqual([botId])
    // No hold (a goal took the computer meanwhile, or it could not come up): no URL at all, never the
    // session read before the hold, which the model may be driving.
    runner.holdsForTakeover = false
    const refused = await withSession.request(`/api/bots/${botId}/stream?mode=interactive`)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: expect.stringMatching(/^the takeover could not start/) })
  })
})

describe('the Runs tab routes', () => {
  const at = (t: string, runId: string, body: RunEventBody): RunEvent => ({ t, runId, botId, ...body }) as RunEvent

  it('lists the runs newest first and returns one run as it was recorded', async () => {
    await store.startRun(botId, 'run-1')
    await store.startRun(botId, 'run-2')
    const first = [
      at('2026-01-01T08:00:00.000Z', 'run-1', { type: 'queued', goal: 'water the plants', source: 'message' }),
      at('2026-01-01T08:00:01.000Z', 'run-1', { type: 'step', step: 1, action: 'left_click', input: { coordinate: [3, 4] } }),
      at('2026-01-01T08:00:02.000Z', 'run-1', { type: 'end', outcome: 'failed', summary: 'the tap is dry' }),
    ]
    for (const event of first) await store.appendRunEvent(event)
    await store.appendRunEvent(at('2026-01-02T08:00:00.000Z', 'run-2', { type: 'queued', goal: 'count the chairs', source: 'message' }))

    const list = await app.request(`/api/bots/${botId}/runs`)
    expect(list.status).toBe(200)
    const { runs } = (await list.json()) as { runs: { runId: string; outcome: string | null; actions: number }[] }
    expect(runs.map((r) => [r.runId, r.outcome, r.actions])).toEqual([
      ['run-2', null, 0],
      ['run-1', 'failed', 1],
    ])

    const one = await app.request(`/api/bots/${botId}/runs/run-1`)
    expect(one.status).toBe(200)
    expect(await one.json()).toEqual({ events: first })
  })

  it('answers 404 for an unknown bot or a run with no events, and 400 for a run id that is not a slug', async () => {
    expect((await app.request('/api/bots/ghost-1/runs')).status).toBe(404)
    expect((await app.request(`/api/bots/${botId}/runs/run-9`)).status).toBe(404)
    await store.startRun(botId, 'run-3')
    expect((await app.request(`/api/bots/${botId}/runs/run-3`)).status).toBe(404)
    expect((await app.request(`/api/bots/${botId}/runs/..%2F..%2Fx`)).status).toBe(400)
    expect((await app.request(`/api/bots/${botId}/runs/Not%20A%20Run`)).status).toBe(400)
  })

  it('a bot with no run yet has an empty list', async () => {
    const res = await app.request(`/api/bots/${botId}/runs`)
    expect(await res.json()).toEqual({ runs: [] })
  })
})

describe('the Skills tab routes', () => {
  it('lists the files and rejects a routine with a bad schedule on save', async () => {
    await store.writeSkill(botId, { name: 'search', description: 'Search', body: 'Open the board.\n' })
    const files = (await (await app.request(`/api/bots/${botId}/files`)).json()) as { skills: { name: string; text: string }[]; rules: string }
    expect(files.skills.map((s) => s.name)).toEqual(['search'])
    expect(files.skills[0]?.text).toContain('description: Search')
    expect(JSON.parse(files.rules)).toEqual({ requireApproval: ['*'], alwaysAllow: [] })
    const bad = await app.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '---\nskill: search\nschedule: every morning\n---\nRun.' }) })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: expect.stringMatching(/^invalid schedule/) })
    const noSkill = await app.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Run.' }) })
    expect(noSkill.status).toBe(400)
    expect(await noSkill.json()).toEqual({ error: expect.stringContaining('invalid routine') })
    const dense = await app.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '---\nskill: search\nschedule: */5 * * * *\n---\nRun.' }) })
    expect(dense.status).toBe(400)
    expect(await dense.json()).toEqual({ error: expect.stringContaining('the closest a routine may run is every 15 minutes') })
    const ghost = await app.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '---\nskill: ghost\nschedule: 0 7 * * 1-5\n---\nRun.' }) })
    expect(ghost.status).toBe(400)
    expect(await ghost.json()).toEqual({ error: 'there is no skill named ghost; save the skill first' })
    const ok = await app.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '---\nskill: search\nschedule: 0 7 * * 1-5\n---\nRun.' }) })
    expect(ok.status).toBe(200)
    expect((await store.listRoutines(botId)).map((r) => r.schedule)).toEqual(['0 7 * * 1-5'])
  })

  it('a saved routine re-arms the scheduler for that bot, a rejected one does not', async () => {
    await store.writeSkill(botId, { name: 'search', description: 'Search', body: 'Open the board.\n' })
    const reloaded: string[] = []
    const wired = createApp({
      store,
      events: new BotEvents(),
      approvals,
      runner,
      sandboxes: { get: () => null, setUp: async () => undefined },
      onRoutineSaved: async (id) => {
        reloaded.push(id)
      },
    })
    const put = (text: string) => wired.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    expect((await put('---\nskill: search\nschedule: nope\n---\nRun.')).status).toBe(400)
    expect(reloaded).toEqual([])
    expect((await put('---\nskill: search\nschedule: 0 8 * * 1-5\n---\nRun.')).status).toBe(200)
    expect(reloaded).toEqual([botId])
  })
})

describe('Stop and the queue', () => {
  it('the stop route answers 204 when a run is active and 409 when nothing runs', async () => {
    runner.cancels.push(true)
    expect((await app.request(`/api/bots/${botId}/stop`, json({}))).status).toBe(204)
    const idle = await app.request(`/api/bots/${botId}/stop`, json({}))
    expect(idle.status).toBe(409)
    expect(await idle.json()).toEqual({ error: 'nothing is running' })
  })

  it('a message during a run is accepted, queued behind it, and the chat says so', async () => {
    runner.busy = true
    const res = await app.request(`/api/bots/${botId}/messages`, json({ text: 'stop, wrong company' }))
    expect(await res.json()).toMatchObject({ answered: false, runId: 'run-test' })
    expect(runner.enqueued).toEqual([{ goal: 'stop, wrong company', activeSkill: null, source: 'message' }])
    const chat = await store.readChat(botId, { limit: 5 })
    expect(chat.map((m) => m.role)).toEqual(['user', 'card'])
    expect(chat[1]?.card).toEqual({ card: 'status', text: 'Queued: I will start this after the current job. Press Stop to end the current job first.' })
  })
})
