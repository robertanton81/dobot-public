import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { Approvals } from '../agent/gate'
import type { Runner } from '../agent/runner'
import { errorFields, log } from '../log'
import type { SandboxManager } from '../sandbox/manager'
import { assertArtifactName, assertSlug, isNotFound, parseFrontmatter, serializeFrontmatter, SHOT_HASH, type Bot, type Routine, type Skill, type Store } from '../store'
import { handbackCode } from '../agent/takeover'
import type { BotEvents } from '../bot-events'
import { toBotView } from '../bot-view'
import { sseHandler } from './sse'

// The HTTP API. Every JSON body goes through a zod safeParse; a bad body is a 400, never a crash.
// The allow/deny route only resolves a pending approval: it cannot start an action (invariant 4).

/** What the routes need from the runner and the sandbox manager; the tests pass small stand-ins. */
export type RunnerPort = Pick<Runner, 'answerUser' | 'accept' | 'isBusy' | 'cancel' | 'requestTakeover' | 'handbackState' | 'handback' | 'beginIdleTakeover'>
export type SandboxesPort = Pick<SandboxManager, 'get' | 'setUp'>

export type AppDeps = {
  store: Store
  events: BotEvents
  approvals: Approvals
  runner: RunnerPort
  sandboxes: SandboxesPort
  /** True under `pnpm dev` only: the page then comes from its development server, another origin, which the API must accept. */
  devPage?: boolean
  /** Called after the page saves a routine. `src/server/index.ts` passes the scheduler's reload here, so the saved routine is armed again. */
  onRoutineSaved?: (botId: string) => Promise<void>
}

const CreateBotBody = z.object({
  name: z.string().min(1).max(60),
  avatar: z.string().max(4).optional(),
  persona: z.string().max(2000),
})
const MessageBody = z.object({ text: z.string().min(1).max(20_000) })
/** `base` is the text the page loaded; with it, a save is refused when the file has changed since. */
const FileBody = z.object({ text: z.string().max(100_000), base: z.string().max(100_000).optional() })
const CHANGED_TEXT = 'the bot changed this file after you opened it; your text was not saved. Copy your change, open the tab again, and make it on the new text'
const HandbackBody = z.object({ force: z.boolean().optional() })
const DecisionBody = z.object({ decision: z.enum(['allow', 'deny']) })
const CHAT_LIMIT = 200
/** The port of the page's development server (vite.config.ts). */
const DEV_PAGE_PORT = '5173'
const MAX_BODY_BYTES = 262_144
export const QUEUED_TEXT = 'Queued: I will start this after the current job. Press Stop to end the current job first.'

async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; body: T } | { ok: false; res: Response }> {
  // Best effort, before the body is buffered: a client can omit Content-Length, but the usual
  // oversized request is stopped here instead of being parsed into memory.
  const length = Number(c.req.header('content-length') ?? '0')
  if (length > MAX_BODY_BYTES) {
    log.warn('rejected an oversized request body', { path: c.req.path, contentLength: length })
    return { ok: false, res: c.json({ error: 'request body too large' }, 413) }
  }
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    return { ok: false, res: c.json({ error: 'the request body is not valid JSON' }, 400) }
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    log.warn('rejected a request body', { path: c.req.path, issues })
    return { ok: false, res: c.json({ error: 'invalid body', issues }, 400) }
  }
  return { ok: true, body: parsed.data }
}

/** A skill and a routine as the text the Skills tab shows and saves. */
function skillText(s: Skill): string {
  return serializeFrontmatter({ name: s.name, description: s.description }, s.body)
}

function routineText(r: Routine): string {
  return serializeFrontmatter(
    { name: r.name, skill: r.skill, ...(r.schedule !== null ? { schedule: r.schedule } : {}), ...(r.event !== null ? { event: r.event } : {}), enabled: String(r.enabled) },
    r.body,
  )
}

export function createApp(deps: AppDeps): Hono {
  const { store, events, approvals, runner, sandboxes, onRoutineSaved } = deps
  const devPage = deps.devPage === true
  const app = new Hono()

  // Loopback binding excludes other machines; these checks exclude outside browser pages.
  app.use('*', async (c, next) => {
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/
    const request = new URL(c.req.url)
    if (!localHost.test(c.req.header('host') ?? request.host) ||
        c.req.header('sec-fetch-site') === 'cross-site') {
      return c.json({ error: 'local access only' }, 403)
    }
    const origin = c.req.header('origin')
    if (origin !== undefined) {
      try {
        const source = new URL(origin)
        if (source.origin !== origin || source.protocol !== 'http:' ||
            !localHost.test(source.host) ||
            (source.port !== request.port && !(devPage && source.port === DEV_PAGE_PORT))) {
          return c.json({ error: 'local access only' }, 403)
        }
      } catch {
        return c.json({ error: 'local access only' }, 403)
      }
    }
    return next()
  })

  app.onError((e, c) => {
    log.error('request failed', { path: c.req.path, ...errorFields(e) })
    return c.json({ error: 'internal error' }, 500)
  })

  /** The bot for the :id parameter, or the 400/404 response to send. */
  const loadBot = async (c: Context): Promise<{ bot: Bot } | { res: Response }> => {
    const id = c.req.param('id') ?? ''
    try {
      assertSlug(id)
    } catch {
      return { res: c.json({ error: 'invalid bot id' }, 400) }
    }
    try {
      return { bot: await store.readBot(id) }
    } catch (e) {
      // A missing folder is a 404; a corrupt bot.json is already logged by the store and surfaces as a 500.
      if (isNotFound(e)) return { res: c.json({ error: 'unknown bot' }, 404) }
      throw e
    }
  }

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/bots', async (c) => c.json({ bots: (await store.listBots()).map(toBotView) }))

  app.post('/api/bots', async (c) => {
    const parsed = await readJson(c, CreateBotBody)
    if (!parsed.ok) return parsed.res
    const bot = await store.createBot(parsed.body)
    // In the background, so the page can show the bot at once. setUp never rejects.
    void sandboxes.setUp(bot.id)
    return c.json({ bot: toBotView(bot) }, 201)
  })

  app.get('/api/bots/:id', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const chat = await store.readChat(loaded.bot.id, { limit: CHAT_LIMIT })
    return c.json({ bot: toBotView(loaded.bot), chat })
  })

  app.post('/api/bots/:id/messages', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const parsed = await readJson(c, MessageBody)
    if (!parsed.ok) return parsed.res
    const message = await store.appendChat(loaded.bot.id, { role: 'user', text: parsed.body.text })
    events.emitChat(message)
    if (runner.answerUser(loaded.bot.id, parsed.body.text)) return c.json({ message, answered: true })
    // Accepted before the note, so the record exists whatever the note does; the note is for a
    // person who typed while the bot works and would otherwise wonder why nothing happens.
    const busy = runner.isBusy(loaded.bot.id)
    const { runId } = await runner.accept(loaded.bot.id, { goal: parsed.body.text, activeSkill: null, source: 'message' })
    if (busy) {
      const note = await store.appendChat(loaded.bot.id, { role: 'card', card: { card: 'status', text: QUEUED_TEXT } })
      events.emitChat(note)
    }
    return c.json({ message, answered: false, runId })
  })

  app.post('/api/bots/:id/approvals/:approvalId', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const parsed = await readJson(c, DecisionBody)
    if (!parsed.ok) return parsed.res
    const approvalId = c.req.param('approvalId') ?? ''
    const approval = approvals.get(approvalId)
    if (!approval || approval.botId !== loaded.bot.id) return c.json({ error: 'unknown approval' }, 404)
    const result = approvals.resolve(approvalId, parsed.body.decision === 'allow' ? 'allowed' : 'denied')
    if (result === 'not-found') return c.json({ error: 'unknown approval' }, 404)
    if (result === 'not-pending') return c.json({ error: 'this approval was already decided' }, 409)
    log.info('approval decided', { botId: loaded.bot.id, approvalId, decision: parsed.body.decision })
    return c.body(null, 204)
  })

  // Stop: the active run ends before its next action. It denies a pending approval and never allows one.
  app.post('/api/bots/:id/stop', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    if (!runner.cancel(loaded.bot.id)) return c.json({ error: 'nothing is running' }, 409)
    log.info('stop requested through the page', { botId: loaded.bot.id })
    return c.body(null, 204)
  })

  // The interactive stream only while the bot is blocked or idle: the operator never types while the model acts.
  app.get('/api/bots/:id/stream', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const mode = c.req.query('mode') ?? 'view'
    if (mode !== 'view' && mode !== 'interactive') return c.json({ error: 'mode must be view or interactive' }, 400)
    const session = sandboxes.get(loaded.bot.id)
    if (!session) return c.json({ error: 'the computer is not running' }, 409)
    if (mode === 'interactive') {
      if (loaded.bot.state !== 'blocked' && loaded.bot.state !== 'idle') return c.json({ error: 'the bot is working; press Take over first' }, 403)
      // A blocked bot's computer is held for the human already; an idle bot's has nothing holding it
      // up, and the pause would fire while they use the screen. The hold comes up through the manager, so
      // the session to stream from is the one it resolves with.
      if (loaded.bot.state === 'idle') {
        const held = await runner.beginIdleTakeover(loaded.bot.id)
        if (held) return c.json({ url: held.streamInteractiveUrl })
        // No hold: a goal took the computer while it came up, or it could not be brought up. The
        // session read above is not one to hand a human: the model may be driving it.
        return c.json({ error: 'the takeover could not start: a goal took the computer, or it is not running; try again in a moment' }, 409)
      }
      return c.json({ url: session.streamInteractiveUrl })
    }
    return c.json({ url: session.streamViewUrl })
  })

  app.post('/api/bots/:id/takeover', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    if (!runner.requestTakeover(loaded.bot.id)) return c.json({ error: 'no run is active; open the interactive stream directly' }, 409)
    log.info('takeover requested by the user', { botId: loaded.bot.id })
    return c.body(null, 204)
  })

  app.get('/api/bots/:id/takeover/state', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const state = await runner.handbackState(loaded.bot.id, c.req.query('force') === 'true')
    return c.json({ ...state, code: handbackCode(state.reason) })
  })

  // `force` is the operator's escape for a sign-in that ends on a page whose fingerprint never
  // changed; the secret check still applies, and the event log records the override.
  app.post('/api/bots/:id/takeover/handback', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const parsed = await readJson(c, HandbackBody)
    if (!parsed.ok) return parsed.res
    const force = parsed.body.force === true
    const result = await runner.handback(loaded.bot.id, force)
    if (!result.ok) return c.json({ error: result.reason }, 409)
    log.info('screen handed back', { botId: loaded.bot.id, force })
    return c.body(null, 204)
  })

  app.get('/api/bots/:id/runs/:runId/shots/:hash', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const runId = c.req.param('runId') ?? ''
    const hash = c.req.param('hash') ?? ''
    try {
      assertSlug(runId)
    } catch {
      return c.json({ error: 'invalid run id' }, 400)
    }
    if (!SHOT_HASH.test(hash)) return c.json({ error: 'invalid screenshot hash' }, 400)
    try {
      const png = await store.readShot(loaded.bot.id, runId, hash)
      return c.body(Buffer.from(png), 200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' })
    } catch {
      return c.json({ error: 'unknown screenshot' }, 404)
    }
  })

  // The Runs tab: every run of the bot as one line, and one run's events as they were recorded.
  // Read-only, and nothing the page was not sent before: each event went out on the bot's event
  // stream when it happened. A page that follows a run asks for it every few seconds, and each
  // answer reads that run's whole log again: a few hundred lines.
  app.get('/api/bots/:id/runs', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    return c.json({ runs: await store.listRunSummaries(loaded.bot.id) })
  })

  app.get('/api/bots/:id/runs/:runId', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const runId = c.req.param('runId') ?? ''
    try {
      assertSlug(runId)
    } catch {
      return c.json({ error: 'invalid run id' }, 400)
    }
    // A run that does not exist and a run that died before its first event read the same: no events.
    const events = await store.readRunEvents(loaded.bot.id, runId)
    if (events.length === 0) return c.json({ error: 'no events recorded for this run' }, 404)
    return c.json({ events })
  })

  // The Skills tab: memory, skills and routines as text the user can read and correct;
  // approval-rules.json read-only (it is edited on disk, and no tool can write it).
  app.get('/api/bots/:id/files', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const id = loaded.bot.id
    const [memory, skills, routines, rules, artifacts] = await Promise.all([
      store.readMemory(id),
      store.listSkills(id),
      store.listRoutines(id),
      store.readRules(id),
      store.listArtifacts(id),
    ])
    return c.json({
      memory,
      skills: skills.map((s) => ({ name: s.name, text: skillText(s) })),
      routines: routines.map((r) => ({ name: r.name, text: routineText(r) })),
      rules: JSON.stringify(rules, null, 2),
      artifacts,
    })
  })

  app.put('/api/bots/:id/memory', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const parsed = await readJson(c, FileBody)
    if (!parsed.ok) return parsed.res
    // The bot appends notes while the tab is open; a save of the older text would erase them. The
    // store compares and writes in one step, so a note that arrives in between is not lost either.
    if (!(await store.writeMemory(loaded.bot.id, parsed.body.text, parsed.body.base))) return c.json({ error: CHANGED_TEXT }, 409)
    return c.json({ text: await store.readMemory(loaded.bot.id) })
  })

  app.put('/api/bots/:id/skills/:name', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const parsed = await readJson(c, FileBody)
    if (!parsed.ok) return parsed.res
    const name = c.req.param('name') ?? ''
    const { fields, body } = parseFrontmatter(parsed.body.text)
    try {
      const base = parsed.body.base
      const unchanged = base === undefined ? undefined : (stored: Skill | null) => stored === null || base === skillText(stored)
      if (!(await store.writeSkill(loaded.bot.id, { name, description: fields.description ?? '', body }, unchanged))) return c.json({ error: CHANGED_TEXT }, 409)
      const saved = await store.readSkill(loaded.bot.id, name)
      return c.json({ text: saved === null ? parsed.body.text : skillText(saved) })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'invalid skill' }, 400)
    }
  })

  app.put('/api/bots/:id/routines/:name', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const parsed = await readJson(c, FileBody)
    if (!parsed.ok) return parsed.res
    const name = c.req.param('name') ?? ''
    const { fields, body } = parseFrontmatter(parsed.body.text)
    try {
      const base = parsed.body.base
      const unchanged = base === undefined ? undefined : (stored: Routine | null) => stored === null || base === routineText(stored)
      // The store validates with the operator's limits; a separate validateRoutine call here would use the defaults.
      const written = await store.writeRoutine(loaded.bot.id, {
        name,
        skill: fields.skill ?? '',
        schedule: fields.schedule ?? null,
        event: fields.event ?? null,
        enabled: fields.enabled !== 'false',
        body,
      }, unchanged)
      if (!written) return c.json({ error: CHANGED_TEXT }, 409)
      await onRoutineSaved?.(loaded.bot.id)
      const saved = await store.readRoutine(loaded.bot.id, name)
      return c.json({ text: saved === null ? parsed.body.text : routineText(saved) })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'invalid routine' }, 400)
    }
  })

  app.get('/api/bots/:id/artifacts/:name', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    const name = c.req.param('name') ?? ''
    try {
      assertArtifactName(name)
    } catch {
      return c.json({ error: 'invalid artifact name' }, 400)
    }
    const content = await store.readArtifact(loaded.bot.id, name)
    if (content === null) return c.json({ error: 'unknown artifact' }, 404)
    return c.body(content, 200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `inline; filename="${name}"` })
  })

  app.get('/events/:botId', sseHandler(store, events))

  // In production the built UI is served from dist/web; in dev Vite serves it and proxies /api here.
  if (existsSync('dist/web')) {
    app.use('*', serveStatic({ root: './dist/web' }))
    app.get('*', serveStatic({ path: './dist/web/index.html' }))
  }

  return app
}
