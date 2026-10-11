import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log } from '../log'
import { mkdtemp, rm } from 'node:fs/promises'
import type { LookupAddress } from 'node:dns'
import { createServer, type Server } from 'node:http'
import type { AddressInfo, LookupFunction } from 'node:net'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachFile, basePlatformTools, defineTool, fetchUrlTool, htmlToText, openUrl, requestConnection, saveRoutine, saveSkill, setRoutineEnabled, toolDefinitions, runPlatformTool, ToolError } from './tools'
import type { ConnectorsPort } from './run-context'
import { checkedLookup, createPageFetch } from './page-fetch'
import type { RunContext } from './run-context'
import { createStore } from '../store'
import { MAIL_EVENT } from '../events'
import { ELEMENT_TEXT_INPUT, FakeModel, FakeSandbox, makeContext, type KnownElement } from './fakes'
import { Approvals } from './gate'
import type { ElementInfo } from '../sandbox/port'

describe('htmlToText', () => {
  it('drops scripts, styles and tags, keeps the text with line breaks at block ends', () => {
    const html = '<html><head><title>Acme</title><style>p{}</style><script>alert(1)</script></head><body><h1>Jobs</h1><p>Senior <b>engineer</b></p><ul><li>Prague</li><li>Remote</li></ul></body></html>'
    expect(htmlToText(html)).toBe('Acme\nJobs\nSenior engineer\nPrague\nRemote')
  })

  it('decodes named and numeric entities and collapses whitespace', () => {
    expect(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f &#8364; &#x41;   g')).toBe('a & b <c> "d" \'e\' f € A g')
  })

  // One thread serves the whole process, so a page must not be able to hold it. The size is chosen
  // so that a pattern which searches the rest of the page again from every opening needs far more
  // than the second allowed here, and still fails this test in under a minute instead of hanging it.
  it('reads a page of openings that never close in time that grows with its size, not with its square', () => {
    for (const opening of ['<!--', '<script ', '<style>', '<', '<a ', '</p', '<br ']) {
      const page = opening.repeat(Math.ceil(400_000 / opening.length))
      const started = performance.now()
      htmlToText(page)
      expect(performance.now() - started, opening).toBeLessThan(1_000)
    }
  })

  it('drops a comment or a script that never closes, to the end of the page, as a browser does', () => {
    expect(htmlToText('<p>Before</p><!-- never closed <p>hidden</p>')).toBe('Before')
    expect(htmlToText('<p>Before</p><script>var a = "<p>hidden</p>"')).toBe('Before')
    expect(htmlToText('<p>One</p><!-- closed --><p>Two</p><script>x()</script><p>Three</p>')).toBe('One\nTwo\nThree')
  })

  it('keeps a lone < in the text and still drops the tags around it', () => {
    expect(htmlToText('<p>3 < 5 and <b>bold</b></p>')).toBe('3 < 5 and bold')
  })

  it('keeps an unknown entity as written', () => {
    expect(htmlToText('&bogus; x')).toBe('&bogus; x')
  })
})

describe('toolDefinitions', () => {
  it('turns zod schemas into JSON schema inputs and marks the last tool as the cache breakpoint', () => {
    const a = defineTool({ name: 'a', description: 'A', schema: z.object({ x: z.string() }), run: async () => 'ok' })
    const b = defineTool({ name: 'b', description: 'B', schema: z.object({ n: z.number().int() }), run: async () => 'ok' })
    const defs = toolDefinitions([a, b])
    expect(defs.map((d) => d.name)).toEqual(['a', 'b'])
    expect(defs[0]?.input_schema).toMatchObject({ type: 'object', properties: { x: { type: 'string' } }, required: ['x'] })
    expect(defs[0]?.input_schema).not.toHaveProperty('$schema')
    expect(defs[0]?.cache_control).toBeUndefined()
    expect(defs[1]?.cache_control).toEqual({ type: 'ephemeral' })
  })
})

describe('runPlatformTool', () => {
  const ctx = { botId: 'b', runId: 'r' } as RunContext
  const echo = defineTool({ name: 'echo', description: 'E', schema: z.object({ text: z.string().min(1) }), run: async ({ text }) => `echo ${text}` })

  it('validates the input before the tool runs and reports the field', async () => {
    expect(await runPlatformTool(echo, { text: '' }, ctx)).toEqual({ text: expect.stringContaining('invalid input for echo: text'), isError: true })
    expect(await runPlatformTool(echo, { text: 'hi' }, ctx)).toEqual({ text: 'echo hi', isError: false })
  })

  it('turns an unexpected error into an error result that carries only the error name', async () => {
    const boom = defineTool({ name: 'boom', description: 'B', schema: z.object({}), run: async () => { throw new Error('ENOENT: /Users/someone/data/bots/x/artifacts/a.md') } })
    expect(await runPlatformTool(boom, {}, ctx)).toEqual({ text: 'boom failed (Error)', isError: true })
  })

  it('passes a ToolError message through as written for the model', async () => {
    const soft = defineTool({ name: 'soft', description: 'S', schema: z.object({}), run: async () => { throw new ToolError('no upload control under that coordinate') } })
    expect(await runPlatformTool(soft, {}, ctx)).toEqual({ text: 'no upload control under that coordinate', isError: true })
  })
})

describe('attach_file', () => {
  const control = (overrides: Partial<KnownElement>): KnownElement => ({ ...ELEMENT_TEXT_INPUT, tag: 'button', type: null, ...overrides })
  const unresolvable: ElementInfo = { target: 'unknown', reason: 'cross-origin frame', url: 'https://example.com/form', title: 'Form' }

  function contextWith(element: ElementInfo, approvals = new Approvals()): { ctx: RunContext; sandbox: FakeSandbox } {
    const sandbox = new FakeSandbox()
    sandbox.companion.elements = [element]
    return { ctx: { botId: 'b', runId: 'r', sandbox, approvals, progress: { step: 0 } } as unknown as RunContext, sandbox }
  }

  it('attaches the workspace file and lets the companion click a vetted upload control', async () => {
    const { ctx, sandbox } = contextWith(control({ name: '+ uploadnout přílohu' }))
    const result = await attachFile.run({ coordinate: [120, 400], filename: 'cv.pdf' }, ctx)
    expect(result).toContain('attached cv.pdf')
    expect(sandbox.companion.calls).toContainEqual({ method: 'setFiles', args: [[120, 400], '/home/user/workspace/cv.pdf', { click: true }] })
  })

  // The companion clicks the control when the page has no file input yet, so a mistaken
  // coordinate must never let the platform press submit on the model's behalf.
  it('refuses a submit control and never calls the companion', async () => {
    const { ctx, sandbox } = contextWith(control({ type: 'submit', isSubmit: true, name: 'Continue' }))
    await expect(attachFile.run({ coordinate: [10, 20], filename: 'cv.pdf' }, ctx)).rejects.toThrow(ToolError)
    expect(sandbox.companion.calls.some((c) => c.method === 'setFiles')).toBe(false)
  })

  it('refuses a control whose name starts with an action verb', async () => {
    const { ctx, sandbox } = contextWith(control({ name: 'Odeslat zájem' }))
    await expect(attachFile.run({ coordinate: [10, 20], filename: 'cv.pdf' }, ctx)).rejects.toThrow(/send control \("Odeslat zájem"\)/)
    expect(sandbox.companion.calls.some((c) => c.method === 'setFiles')).toBe(false)
  })

  // attach_file reads the DOM rules directly and never the approvals, unlike an ordinary click.
  // Its click is performed inside the companion and is not the audited click path, so an approval
  // the user granted for that same button must not travel to it. This pins that: a refactor to
  // the shared `evaluate()` helper, which does consume approvals, has to fail here.
  it('refuses a send control even when the user has already approved that exact control', async () => {
    const approvals = new Approvals()
    const approval = approvals.propose('b', 'r', 0, { kind: 'submit', target: 'Continue', page: 'https://example.com/form' })
    approvals.resolve(approval.id, 'allowed')
    const { ctx, sandbox } = contextWith(control({ type: 'submit', isSubmit: true, name: 'Continue', url: 'https://example.com/form' }), approvals)
    await expect(attachFile.run({ coordinate: [10, 20], filename: 'cv.pdf' }, ctx)).rejects.toThrow(ToolError)
    expect(sandbox.companion.calls.some((c) => c.method === 'setFiles')).toBe(false)
  })

  // An element the companion cannot read is not refused, but the click is withheld: the companion
  // may still use a file input that already exists, and never clicks something nobody vetted.
  it('withholds the click when the element cannot be resolved, instead of refusing outright', async () => {
    const { ctx, sandbox } = contextWith(unresolvable)
    await attachFile.run({ coordinate: [10, 20], filename: 'cv.pdf' }, ctx)
    expect(sandbox.companion.calls).toContainEqual({ method: 'setFiles', args: [[10, 20], '/home/user/workspace/cv.pdf', { click: false }] })
  })

  it('withholds the click for a point on the browser frame above the page', async () => {
    const { ctx, sandbox } = contextWith({ target: 'browser-ui', reason: 'above the page', url: 'https://example.com/form', title: 'Form' })
    await attachFile.run({ coordinate: [500, 90], filename: 'cv.pdf' }, ctx)
    expect(sandbox.companion.calls).toContainEqual({ method: 'setFiles', args: [[500, 90], '/home/user/workspace/cv.pdf', { click: false }] })
  })

  it('tells the model to take over when an unresolvable point holds no existing file input', async () => {
    const { ctx, sandbox } = contextWith(unresolvable)
    sandbox.companion.setFiles = async () => {
      throw new Error('companion set-files failed: http 404 {"error":"no file input"}')
    }
    await expect(attachFile.run({ coordinate: [10, 20], filename: 'cv.pdf' }, ctx)).rejects.toThrow(/request_takeover/)
  })

  it('turns the companion\'s "no file input" into an instruction the model can act on', async () => {
    const { ctx, sandbox } = contextWith(control({ name: 'Attachments' }))
    sandbox.companion.setFiles = async () => {
      throw new Error('companion set-files failed: http 404 {"error":"no file input"}')
    }
    await expect(attachFile.run({ coordinate: [10, 20], filename: 'cv.pdf' }, ctx)).rejects.toThrow(/point at the upload field/)
  })
})

// The bot writes its own routines. If its tool does not know an event exists, the natural-language
// path cannot produce a mail-triggered routine and only a hand-edited file can, which is the
// "harness engineering" the product forbids. These pin that the bot can reach the event itself.
describe('save_routine and events', () => {
  async function botWithSkill(): Promise<{ ctx: RunContext; botId: string; dataDir: string; store: ReturnType<typeof createStore> }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'dobot-tools-'))
    const store = createStore(dataDir)
    const botId = (await store.createBot({ name: 'Hunter', persona: 'Hunts.' })).id
    await store.writeSkill(botId, { name: 'handle-replies', description: 'Reads mail', body: 'Open the mailbox.\n' })
    const { ctx } = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox() })
    return { ctx, botId, dataDir, store }
  }

  it('tells the bot which events exist, in the tool definition it reads', () => {
    const [def] = toolDefinitions([saveRoutine])
    expect(def?.description).toContain(MAIL_EVENT)
    expect(def?.description).not.toMatch(/not yet/)
  })

  it('saves a routine that waits for the mail event and says it will run when mail arrives', async () => {
    const { ctx, botId, dataDir, store } = await botWithSkill()
    try {
      const text = await saveRoutine.run({ name: 'check-mail', skill: 'handle-replies', event: MAIL_EVENT, instruction: 'Read the new mail.' }, ctx)
      expect(text).toBe(`saved routine check-mail: it runs handle-replies whenever the event ${MAIL_EVENT} happens`)
      expect(await store.readRoutine(botId, 'check-mail')).toMatchObject({ event: MAIL_EVENT, schedule: null, enabled: true })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('refuses an event that does not exist, names the ones that do, and stores nothing', async () => {
    const { ctx, botId, dataDir, store } = await botWithSkill()
    try {
      await expect(saveRoutine.run({ name: 'on-call', skill: 'handle-replies', event: 'phone-rang', instruction: 'Answer.' }, ctx)).rejects.toThrow(
        new RegExp(`no event named phone-rang.*${MAIL_EVENT}`),
      )
      expect(await store.readRoutine(botId, 'on-call')).toBeNull()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('refuses a schedule denser than the minimum with a sentence the bot can act on, and stores nothing', async () => {
    const { ctx, botId, dataDir, store } = await botWithSkill()
    try {
      await expect(saveRoutine.run({ name: 'check-often', skill: 'handle-replies', schedule: '*/5 * * * *', instruction: 'Read the new mail.' }, ctx)).rejects.toThrow(
        'the closest a routine may run is every 15 minutes',
      )
      expect(await store.readRoutine(botId, 'check-often')).toBeNull()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

// A correction is a rewrite of the skill under the same name; the tool must say that an existing
// name is replaced, or the model saves a copy under a new name and the routine keeps running the
// old one.
describe('save_skill and save_routine over an existing name', () => {
  async function botWithRoutine(): Promise<{ ctx: RunContext; botId: string; dataDir: string; store: ReturnType<typeof createStore>; t: ReturnType<typeof makeContext> }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'dobot-tools-'))
    const store = createStore(dataDir)
    const botId = (await store.createBot({ name: 'Hunter', persona: 'Hunts.' })).id
    await store.writeSkill(botId, { name: 'search-board', description: 'Searches', body: 'Open the board.\n' })
    await store.writeRoutine(botId, { name: 'morning', skill: 'search-board', schedule: '0 7 * * 1-5', event: null, enabled: true, body: 'Search.\n' })
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox() })
    return { ctx: t.ctx, botId, dataDir, store, t }
  }

  it('tells the bot that an existing name is replaced', () => {
    const [skill, routine] = toolDefinitions([saveSkill, saveRoutine])
    expect(skill?.description).toContain('Saving under an existing name replaces that skill')
    expect(routine?.description).toContain('Saving under an existing name replaces that routine')
  })

  it('save_skill under a new name says it was saved, not updated', async () => {
    const { ctx, botId, dataDir, store } = await botWithRoutine()
    try {
      expect(await saveSkill.run({ name: 'read-mail', description: 'Reads mail', body: 'Open the mailbox.\n' }, ctx)).toBe('saved skill read-mail')
      expect((await store.listSkills(botId)).map((s) => s.name)).toEqual(['read-mail', 'search-board'])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('save_skill under an existing name replaces the body, says so, and leaves the routine on that skill', async () => {
    const { ctx, botId, dataDir, store, t } = await botWithRoutine()
    try {
      const text = await saveSkill.run({ name: 'search-board', description: 'Searches, newest first', body: 'Open the board and sort by date.\n' }, ctx)
      expect(text).toBe('updated skill search-board')
      expect(await store.readSkill(botId, 'search-board')).toEqual({ name: 'search-board', description: 'Searches, newest first', body: 'Open the board and sort by date.\n' })
      expect((await store.listSkills(botId)).map((s) => s.name)).toEqual(['search-board'])
      expect(await store.readRoutine(botId, 'morning')).toMatchObject({ skill: 'search-board', schedule: '0 7 * * 1-5', enabled: true })
      expect(t.chat.at(-1)?.card).toMatchObject({ card: 'skill', name: 'search-board', body: 'Open the board and sort by date.\n' })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('save_routine under an existing name replaces the schedule and the instruction, and says so', async () => {
    const { ctx, botId, dataDir, store, t } = await botWithRoutine()
    try {
      const text = await saveRoutine.run({ name: 'morning', skill: 'search-board', schedule: '0 8 * * 1-5', instruction: 'Search, newest first.' }, ctx)
      expect(text).toBe('updated routine morning: it runs search-board on the schedule 0 8 * * 1-5')
      expect(await store.readRoutine(botId, 'morning')).toMatchObject({ skill: 'search-board', schedule: '0 8 * * 1-5', event: null, enabled: true, body: 'Search, newest first.' })
      expect(t.reloads).toEqual([botId])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

// Without this tool the bot can enable a routine through chat but not disable it, so "stop the
// morning search" has no in-product path. These pin the tool that gives it one.
describe('set_routine_enabled', () => {
  async function botWithRoutine(): Promise<{ ctx: RunContext; botId: string; dataDir: string; store: ReturnType<typeof createStore>; t: ReturnType<typeof makeContext> }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'dobot-tools-'))
    const store = createStore(dataDir)
    const botId = (await store.createBot({ name: 'Hunter', persona: 'Hunts.' })).id
    await store.writeSkill(botId, { name: 'search-board', description: 'Searches', body: 'Open the board.\n' })
    await store.writeRoutine(botId, { name: 'morning', skill: 'search-board', schedule: '0 7 * * 1-5', event: null, enabled: true, body: 'Search.\n' })
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox() })
    return { ctx: t.ctx, botId, dataDir, store, t }
  }

  it('is one of the tools every run gets', () => {
    expect(basePlatformTools.map((tool) => tool.name)).toContain('set_routine_enabled')
  })

  it('turns a routine off: the file says so, the scheduler is re-armed, a card says so, and it keeps its schedule', async () => {
    const { ctx, botId, dataDir, store, t } = await botWithRoutine()
    try {
      const text = await setRoutineEnabled.run({ name: 'morning', enabled: false }, ctx)
      expect(text).toBe('routine morning is off: it starts no run until you turn it on again')
      expect(await store.readRoutine(botId, 'morning')).toMatchObject({ enabled: false, schedule: '0 7 * * 1-5', skill: 'search-board', body: 'Search.\n' })
      expect(t.reloads).toEqual([botId])
      expect(t.chat.map((m) => m.card)).toEqual([{ card: 'status', text: 'routine morning is now off' }])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('turns it back on, and says when nothing changes', async () => {
    const { ctx, botId, dataDir, store, t } = await botWithRoutine()
    try {
      await setRoutineEnabled.run({ name: 'morning', enabled: false }, ctx)
      expect(await setRoutineEnabled.run({ name: 'morning', enabled: false }, ctx)).toBe('routine morning is already off')
      expect(await setRoutineEnabled.run({ name: 'morning', enabled: true }, ctx)).toBe('routine morning is on again: it runs search-board as before')
      expect((await store.readRoutine(botId, 'morning'))?.enabled).toBe(true)
      expect(t.reloads).toEqual([botId, botId])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('names the routines that exist when the name is unknown, and changes nothing', async () => {
    const { ctx, botId, dataDir, store } = await botWithRoutine()
    try {
      await expect(setRoutineEnabled.run({ name: 'evening', enabled: false }, ctx)).rejects.toThrow('there is no routine named evening; the routines are: morning')
      expect((await store.readRoutine(botId, 'morning'))?.enabled).toBe(true)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  // A store error turned into model text would stay unlogged and would show the model a file path.
  it('hands an infrastructure failure to the generic path, which logs it and gives the model the error name only', async () => {
    const { ctx, dataDir } = await botWithRoutine()
    try {
      ctx.store.writeRoutine = async () => {
        throw Object.assign(new Error(`EACCES: permission denied, open '${dataDir}/routines/morning.md'`), { code: 'EACCES', name: 'Error' })
      }
      const outcome = await runPlatformTool(setRoutineEnabled, { name: 'morning', enabled: false }, ctx)
      expect(outcome).toEqual({ text: 'set_routine_enabled failed (Error)', isError: true })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('says the file is saved when only the re-arm failed, instead of reporting the change as not made', async () => {
    const { ctx, botId, dataDir, store } = await botWithRoutine()
    try {
      ctx.reloadRoutines = async () => {
        throw new Error('scheduler down')
      }
      const outcome = await runPlatformTool(setRoutineEnabled, { name: 'morning', enabled: false }, ctx)
      expect(outcome).toEqual({ text: 'routine morning is saved, but its schedule could not be re-armed; ask the user to restart the server', isError: true })
      expect((await store.readRoutine(botId, 'morning'))?.enabled).toBe(false)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('turns off a routine whose skill is gone, but will not turn it back on', async () => {
    const { ctx, botId, dataDir, store } = await botWithRoutine()
    try {
      await rm(join(dataDir, botId, 'skills', 'search-board.md'))
      expect(await setRoutineEnabled.run({ name: 'morning', enabled: false }, ctx)).toContain('is off')
      expect((await store.readRoutine(botId, 'morning'))?.enabled).toBe(false)
      await expect(setRoutineEnabled.run({ name: 'morning', enabled: true }, ctx)).rejects.toThrow('there is no skill named search-board; save the skill first')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

// The model chooses the address, and a page or a mail can put one in front of the model. A request
// from this process can reach what no outside page can: the platform's own API and the local network.
describe('fetch_url', () => {
  /** A network that answers from a table and records every address it was asked for. */
  function network(answers: Record<string, () => Response>): { fetchFn: typeof fetch; asked: string[] } {
    const asked: string[] = []
    const fetchFn = (async (input: URL | RequestInfo) => {
      const address = String(input)
      asked.push(address)
      const answer = answers[address]
      if (!answer) throw new TypeError('fetch failed')
      return answer()
    }) as typeof fetch
    return { fetchFn, asked }
  }
  function context(signal: AbortSignal = new AbortController().signal): RunContext {
    return { botId: 'b', runId: 'r', cancelSignal: signal } as unknown as RunContext
  }
  const page = (body: string, headers: Record<string, string> = { 'content-type': 'text/html' }) => () => new Response(body, { headers })
  const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } })

  it('returns a public page as text', async () => {
    const { fetchFn, asked } = network({ 'https://example.com/news': page('<h1>News</h1><p>One &amp; two</p>') })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/news' }, context())).toBe('News\nOne & two')
    expect(asked).toEqual(['https://example.com/news'])
  })

  it('refuses this machine and the local network, and sends no request', async () => {
    for (const url of ['http://127.0.0.1:3000/api/bots', 'http://localhost:3000/api/bots', 'http://2130706433:3000/', 'http://[::1]:3000/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://router/']) {
      const { fetchFn, asked } = network({})
      expect(await fetchUrlTool(fetchFn).run({ url }, context()), url).toBe('fetch failed: only public web addresses can be read')
      expect(asked, url).toEqual([])
    }
  })

  it('follows a redirect to a public address', async () => {
    const { fetchFn, asked } = network({
      'http://example.com/': redirect('https://www.example.com/start', 301),
      'https://www.example.com/start': redirect('/home'),
      'https://www.example.com/home': page('<p>Home</p>'),
    })
    expect(await fetchUrlTool(fetchFn).run({ url: 'http://example.com/' }, context())).toBe('Home')
    expect(asked).toEqual(['http://example.com/', 'https://www.example.com/start', 'https://www.example.com/home'])
  })

  it('refuses a public page that redirects to this machine, and never asks this machine', async () => {
    const { fetchFn, asked } = network({
      'https://example.com/go': redirect('http://127.0.0.1:3000/api/bots'),
      'http://127.0.0.1:3000/api/bots': page('[{"id":"bot-1"}]', { 'content-type': 'application/json' }),
    })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/go' }, context())).toBe('fetch failed: only public web addresses can be read')
    expect(asked).toEqual(['https://example.com/go'])
  })

  // The fake network above stands for the client. These two tests use the real client and a real
  // server on this machine. `site.test` alone is led to that server unchecked; every other name goes
  // through the checked lookup, with a resolver that answers as a hostile name owner would.
  describe('with the real client', () => {
    let server: Server
    let port: number
    let paths: string[]
    let redirectTo: string
    const hostile = (_hostname: string, _options: { family: 4; all: true }, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void): void => callback(null, [{ address: '127.0.0.1', family: 4 }])
    const lookup: LookupFunction = (hostname, options, callback) => {
      if (hostname !== 'site.test') return checkedLookup(hostile)(hostname, options, callback)
      if (options.all) return callback(null, [{ address: '127.0.0.1', family: 4 }])
      callback(null, '127.0.0.1', 4)
    }

    beforeEach(async () => {
      paths = []
      server = createServer((req, res) => {
        paths.push(req.url ?? '')
        if (req.url === '/go') {
          res.writeHead(302, { location: redirectTo })
          res.end()
          return
        }
        if (req.url === '/bomb') {
          // 20 MB of text in about 20 KB on the wire, with no length the early check could read.
          res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
          res.end(gzipSync(Buffer.alloc(20_000_000, 'x')))
          return
        }
        res.writeHead(200, { 'content-type': req.url === '/page' ? 'text/html' : 'application/json' })
        res.end(req.url === '/page' ? '<p>A page</p>' : '[{"id":"bot-1"}]')
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      port = (server.address() as AddressInfo).port
    })
    afterEach(async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    })

    it('reads a page through a real connection', async () => {
      expect(await fetchUrlTool(createPageFetch(lookup)).run({ url: `http://site.test:${port}/page` }, context())).toBe('A page')
      expect(paths).toEqual(['/page'])
    })

    it('counts the 5 MB limit on the decoded body, so a small zipped answer cannot unfold past it', async () => {
      expect(await fetchUrlTool(createPageFetch(lookup)).run({ url: `http://site.test:${port}/bomb` }, context())).toBe('fetch failed: the page is larger than 5 MB')
    })

    it('refuses a redirect to this machine, written as numbers or as a name that leads here, and never asks for it', async () => {
      for (const target of [`http://127.0.0.1:${port}/api/bots`, `http://rebind.example:${port}/api/bots`]) {
        paths = []
        redirectTo = target
        expect(await fetchUrlTool(createPageFetch(lookup)).run({ url: `http://site.test:${port}/go` }, context()), target).toBe('fetch failed: only public web addresses can be read')
        expect(paths, target).toEqual(['/go'])
      }
    })

    it('refuses a first address whose public-looking name leads to this machine', async () => {
      expect(await fetchUrlTool(createPageFetch(lookup)).run({ url: `http://rebind.example:${port}/api/bots` }, context())).toBe('fetch failed: only public web addresses can be read')
      expect(paths).toEqual([])
    })
  })

  it('refuses a redirect to anything but http and https', async () => {
    const { fetchFn, asked } = network({ 'https://example.com/go': redirect('file:///etc/passwd') })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/go' }, context())).toBe('fetch failed: only http and https URLs can be read')
    expect(asked).toEqual(['https://example.com/go'])
  })

  it('gives up on a redirect loop', async () => {
    const { fetchFn, asked } = network({ 'https://example.com/a': redirect('/b'), 'https://example.com/b': redirect('/a') })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/a' }, context())).toBe('fetch failed: too many redirects')
    expect(asked).toHaveLength(11)
  })

  it('reports a status that is not a success, and a redirect that names no address, by the status', async () => {
    const { fetchFn } = network({
      'https://example.com/gone': () => new Response('no', { status: 404 }),
      'https://example.com/odd': () => new Response(null, { status: 302 }),
    })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/gone' }, context())).toBe('fetch failed: http 404')
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/odd' }, context())).toBe('fetch failed: http 302')
  })

  it('stops reading a body that is over the limit, also when the sender names no length', async () => {
    let sent = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1
        controller.enqueue(new Uint8Array(1_000_000))
      },
      cancel() {
        cancelled = true
      },
    })
    const { fetchFn } = network({ 'https://example.com/big': () => new Response(endless, { headers: { 'content-type': 'text/html' } }) })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/big' }, context())).toBe('fetch failed: the page is larger than 5 MB')
    expect(cancelled).toBe(true)
    expect(sent).toBeLessThan(10)
  })

  it('says that a page has no readable text instead of giving an empty answer', async () => {
    const { fetchFn } = network({ 'https://example.com/app': page('<html><head><script>render()</script></head><body><div id="root"></div></body></html>') })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/app' }, context())).toBe('the page has no readable text')
  })

  it('refuses a body that is not text before it reads it', async () => {
    const { fetchFn } = network({ 'https://example.com/shot.png': page('PNG', { 'content-type': 'image/png' }) })
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/shot.png' }, context())).toBe('fetch failed: the page is image/png, not text')
  })

  it('hands the run\'s stop signal to the request, so Stop ends a slow page', async () => {
    const stop = new AbortController()
    const fetchFn = ((_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')))
      })) as typeof fetch
    const pending = fetchUrlTool(fetchFn).run({ url: 'https://example.com/slow' }, context(stop.signal))
    stop.abort()
    expect(await pending).toBe('fetch failed: AbortError')
  })

  it('names a network failure by the error name only', async () => {
    const { fetchFn } = network({})
    expect(await fetchUrlTool(fetchFn).run({ url: 'https://example.com/down' }, context())).toBe('fetch failed: TypeError')
  })
})

// A navigation must not cost an approval card: the bot opens an address with this tool, with no
// click on the address bar.
describe('open_url', () => {
  function context(): { ctx: RunContext; sandbox: FakeSandbox } {
    const sandbox = new FakeSandbox()
    return { ctx: { botId: 'b', runId: 'r', sandbox } as unknown as RunContext, sandbox }
  }

  it('opens an https address in the browser and waits for the page to settle', async () => {
    const { ctx, sandbox } = context()
    const result = await openUrl.run({ url: 'https://example.com/jobs?x=1' }, ctx)
    expect(result).toContain('opened https://example.com/jobs?x=1')
    expect(sandbox.calls).toEqual([
      { method: 'openUrl', args: ['https://example.com/jobs?x=1'] },
      { method: 'wait', args: [2000] },
    ])
  })

  it('refuses anything but http and https, and never touches the browser', async () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      const { ctx, sandbox } = context()
      await expect(openUrl.run({ url }, ctx)).rejects.toBeInstanceOf(ToolError)
      expect(sandbox.calls).toEqual([])
    }
  })
})

describe('request_connection', () => {
  /** A port that offers `maps` and records every grant. */
  function port(offer: Awaited<ReturnType<ConnectorsPort['offer']>> = { id: 'maps', title: 'Maps', what: 'road distances without the browser' }) {
    const grants: string[] = []
    const connectors: ConnectorsPort = {
      snapshot: async () => ({ tools: [], catalog: [], key: '' }),
      offer: async () => offer,
      grant: async (_botId, builtin) => {
        grants.push(builtin)
        return [`${builtin}__route`, `${builtin}__geocode`]
      },
    }
    return { connectors, grants }
  }

  async function setup(connectors: ConnectorsPort) {
    const dataDir = await mkdtemp(join(tmpdir(), 'dobot-connect-'))
    const store = createStore(dataDir)
    const botId = (await store.createBot({ name: 'Asker', persona: 'Asks.' })).id
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox(), connectors })
    return { t, dataDir }
  }

  const input = { connector: 'maps', reason: 'to measure the road distance without the browser' }

  it('Connect grants the connector once, ends the card connected, and names the new tools', async () => {
    const { connectors, grants } = port()
    const { t, dataDir } = await setup(connectors)
    try {
      t.decisions.push('allowed')
      expect(await requestConnection.run(input, t.ctx)).toBe('connected maps; from your next step you have: maps__route, maps__geocode')
      expect(grants).toEqual(['maps'])
      expect(t.chat.map((m) => m.card)).toEqual([
        { card: 'connect', approvalId: expect.any(String), runId: 'run-1', connector: 'maps', title: 'Maps', what: 'road distances without the browser', reason: input.reason, status: 'connected' },
      ])
      expect(t.states).toEqual(['waiting', 'working'])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('Not now grants nothing, ends the card declined, and does not count as a denied action', async () => {
    const { connectors, grants } = port()
    const { t, dataDir } = await setup(connectors)
    try {
      t.decisions.push('denied')
      expect(await requestConnection.run(input, t.ctx)).toBe('the user did not connect maps; do this job with fetch_url or your computer')
      expect(grants).toEqual([])
      expect(t.chat[0]?.card).toMatchObject({ card: 'connect', status: 'declined' })
      expect(t.ctx.approvals.deniedFor(t.ctx.runId)).toBe(false)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('Stop while the card waits grants nothing', async () => {
    const { connectors, grants } = port()
    const { t, dataDir } = await setup(connectors)
    try {
      // Connect and Stop race: the answer comes back allowed, but the run is already stopping.
      t.ctx.waitForApproval = async (id) => {
        t.stop.request()
        t.ctx.approvals.resolve(id, 'allowed')
        return 'allowed'
      }
      await requestConnection.run(input, t.ctx)
      expect(grants).toEqual([])
      expect(t.chat[0]?.card).toMatchObject({ card: 'connect', status: 'declined' })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('ends the card as failed and tells the model when the grant cannot be saved after Connect', async () => {
    const { connectors } = port()
    connectors.grant = async () => {
      throw new Error('disk full')
    }
    const { t, dataDir } = await setup(connectors)
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined)
    try {
      t.decisions.push('allowed')
      const outcome = await runPlatformTool(requestConnection, input, t.ctx)
      expect(outcome.isError).toBe(true)
      expect(outcome.text).toContain('could not be saved')
      expect(t.chat[0]?.card).toMatchObject({ card: 'connect', status: 'failed' })
      expect(error).toHaveBeenCalledWith('a connection the user granted could not be saved', expect.objectContaining({ connector: 'maps' }))
    } finally {
      error.mockRestore()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps the answered record, so a second click is told it was already decided, and uses it up so it covers no control', async () => {
    const { connectors } = port()
    const { t, dataDir } = await setup(connectors)
    try {
      t.decisions.push('allowed')
      await requestConnection.run(input, t.ctx)
      const card = t.chat[0]?.card
      const id = card?.card === 'connect' ? card.approvalId : ''
      expect(t.ctx.approvals.resolve(id, 'allowed')).toBe('not-pending')
      expect(t.ctx.approvals.pendingOrAllowedFor(t.ctx.runId, t.ctx.progress.step)).toBeNull()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('a connector the bot may not ask for posts no card and gives the refusal to the model', async () => {
    const { connectors, grants } = port({ refused: 'there is no connector named maps you can use; the ones you can ask for are: none' })
    const { t, dataDir } = await setup(connectors)
    try {
      const outcome = await runPlatformTool(requestConnection, input, t.ctx)
      expect(outcome).toEqual({ text: 'there is no connector named maps you can use; the ones you can ask for are: none', isError: true })
      expect(t.chat).toEqual([])
      expect(grants).toEqual([])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('is one of the tools every run gets', () => {
    expect(basePlatformTools.map((t) => t.name)).toContain('request_connection')
  })
})
