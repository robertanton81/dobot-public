import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log } from '../log'
import { createStore, DEFAULT_RULES, splitChatText, validateRoutine, type Card, type RunEvent, type RunEventBody, type Store } from './index'

// The one mock in this file: it lets a test make the rename step fail once, to prove that
// bot.json is written through a temp file and the original survives a crash in between.
const renameControl = vi.hoisted(() => ({ failNext: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (renameControl.failNext) {
        renameControl.failNext = false
        throw new Error('simulated crash before rename')
      }
      return actual.rename(from, to)
    },
  }
})

let dataDir: string
let store: Store

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-store-'))
  store = createStore(dataDir)
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

async function newBot() {
  return store.createBot({ name: 'Job Hunter', avatar: '🕵️', persona: 'Finds jobs.' })
}

function event(botId: string, runId: string, body: RunEventBody): RunEvent {
  return { t: new Date().toISOString(), runId, botId, ...body } as RunEvent
}

describe('bot folder', () => {
  it('createBot then readBot returns the same bot and the folder has its entries', async () => {
    const bot = await newBot()
    expect(bot.id).toMatch(/^job-hunter-[a-f0-9]{4}$/)
    expect(await store.readBot(bot.id)).toEqual(bot)
    const entries = (await readdir(join(dataDir, bot.id))).sort()
    expect(entries).toEqual(['approval-rules.json', 'artifacts', 'bot.json', 'memory.md', 'routines', 'runs', 'skills', 'workspace'])
    expect(JSON.parse(await readFile(join(dataDir, bot.id, 'approval-rules.json'), 'utf8'))).toEqual(DEFAULT_RULES)
  })

  it('listBots returns every bot and skips a folder whose bot.json is broken', async () => {
    const a = await store.createBot({ name: 'Alpha', persona: 'a' })
    const b = await store.createBot({ name: 'Beta', persona: 'b' })
    await writeFile(join(dataDir, a.id, 'bot.json'), '{ not json', 'utf8')
    expect((await store.listBots()).map((x) => x.id)).toEqual([b.id])
  })

  it('listBots ignores a hidden entry such as Finder\'s .DS_Store without a warning', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    try {
      const bot = await store.createBot({ name: 'Alpha', persona: 'a' })
      await writeFile(join(dataDir, '.DS_Store'), 'x', 'utf8')
      expect((await store.listBots()).map((x) => x.id)).toEqual([bot.id])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('updateBot persists the patch and leaves no temp file behind', async () => {
    const bot = await newBot()
    const updated = await store.updateBot(bot.id, { state: 'working', sandboxId: 'sbx-1' })
    expect(updated).toMatchObject({ state: 'working', sandboxId: 'sbx-1', name: 'Job Hunter' })
    expect(await store.readBot(bot.id)).toEqual(updated)
    expect((await readdir(join(dataDir, bot.id))).some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('a failure between the temp write and the rename leaves bot.json untouched', async () => {
    const bot = await newBot()
    renameControl.failNext = true
    await expect(store.updateBot(bot.id, { state: 'working' })).rejects.toThrow('simulated crash')
    expect(await store.readBot(bot.id)).toEqual(bot)
  })

  it('updates that start at the same moment all land, each on a different field', async () => {
    const bot = await newBot()
    await Promise.all([
      store.updateBot(bot.id, { state: 'working' }),
      store.updateBot(bot.id, { sandboxId: 'sbx-1' }),
      store.updateBot(bot.id, { statusLine: 'opening the page' }),
    ])
    expect(await store.readBot(bot.id)).toMatchObject({ state: 'working', sandboxId: 'sbx-1', statusLine: 'opening the page' })
  })

  it('a patch written as a function reads the file that the update before it wrote', async () => {
    const bot = await newBot()
    const names = Array.from({ length: 12 }, (_, i) => `routine-${i}`)
    await Promise.all(
      names.map((name) => store.updateBot(bot.id, (current) => ({ routines: { ...current.routines, [name]: { nextRunAt: null, lastRunAt: null, lastResult: name } } }))),
    )
    expect(Object.keys((await store.readBot(bot.id)).routines).sort()).toEqual([...names].sort())
  })

  it('an update that fails does not hold back the next one', async () => {
    const bot = await newBot()
    renameControl.failNext = true
    const failed = store.updateBot(bot.id, { state: 'working' })
    const next = store.updateBot(bot.id, { sandboxId: 'sbx-2' })
    await expect(failed).rejects.toThrow('simulated crash')
    expect(await next).toMatchObject({ state: 'idle', sandboxId: 'sbx-2' })
  })

  // A bot folder holds a person's chat, memory and screenshots: nobody else on the machine reads it.
  it('creates every file and folder of a bot for the owner alone', async () => {
    const bot = await newBot()
    await store.appendChat(bot.id, { role: 'user', text: 'hello' })
    await store.appendMemory(bot.id, 'a fact')
    await store.startRun(bot.id, 'run-1')
    await store.appendRunEvent({ t: new Date().toISOString(), runId: 'run-1', botId: bot.id, type: 'queued', goal: 'g', source: 'message' })
    const shot = await store.writeShot(bot.id, 'run-1', new Uint8Array([1, 2, 3]))
    const mode = async (...parts: string[]) => (await stat(join(dataDir, bot.id, ...parts))).mode & 0o777
    for (const file of [['bot.json'], ['chat.jsonl'], ['memory.md'], ['approval-rules.json'], ['runs', 'run-1', 'events.jsonl'], ['runs', 'run-1', 'shots', `${shot}.png`]]) {
      expect(await mode(...file), file.join('/')).toBe(0o600)
    }
    for (const dir of [[], ['runs'], ['runs', 'run-1'], ['runs', 'run-1', 'shots'], ['skills'], ['workspace']]) {
      expect(await mode(...dir), dir.join('/') || 'the bot folder').toBe(0o700)
    }
  })

  it('makes the folder of all bots private at boot, also one that was made by hand, and creates it when it is missing', async () => {
    await chmod(dataDir, 0o755)
    await store.makePrivate()
    expect((await stat(dataDir)).mode & 0o777).toBe(0o700)
    const fresh = join(dataDir, 'not', 'there', 'yet')
    await createStore(fresh).makePrivate()
    expect((await stat(fresh)).mode & 0o777).toBe(0o700)
  })

  it('goes on when the folder cannot be made private, and says so', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    try {
      // A path under a file cannot be a folder.
      await writeFile(join(dataDir, 'a-file'), 'x', 'utf8')
      await expect(createStore(join(dataDir, 'a-file', 'bots')).makePrivate()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not make the data folder private'), expect.anything())
    } finally {
      warn.mockRestore()
    }
  })

  it('makes a file that others could read private when it is rewritten', async () => {
    const bot = await newBot()
    const file = join(dataDir, bot.id, 'bot.json')
    await chmod(file, 0o644)
    await store.updateBot(bot.id, { state: 'working' })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('readBot rejects a bot.json that does not match the schema', async () => {
    const bot = await newBot()
    await writeFile(join(dataDir, bot.id, 'bot.json'), JSON.stringify({ id: bot.id, name: 'x' }), 'utf8')
    await expect(store.readBot(bot.id)).rejects.toThrow('does not match the schema')
  })

  it('rejects a bot id that is not a slug, including a leading dash', async () => {
    await expect(store.readBot('../etc')).rejects.toThrow('invalid name')
    await expect(store.readBot('-rf')).rejects.toThrow('invalid name')
    await expect(store.readBot('')).rejects.toThrow('invalid name')
  })
})

describe('chat', () => {
  it('appendChat three times then readChat with limit 2 returns the last two in order', async () => {
    const bot = await newBot()
    await store.appendChat(bot.id, { role: 'user', text: 'one' })
    await store.appendChat(bot.id, { role: 'bot', text: 'two' })
    await store.appendChat(bot.id, { role: 'card', card: { card: 'status', text: 'three' } })
    const last = await store.readChat(bot.id, { limit: 2 })
    expect(last.map((m) => m.text ?? m.card?.card)).toEqual(['two', 'status'])
    expect(last[0]?.botId).toBe(bot.id)
    expect(last[0]?.id).not.toBe(last[1]?.id)
  })

  it('a card with an address or a summary over the limit is stored cut, not refused', async () => {
    const bot = await store.createBot({ name: 'Bot', persona: 'p' })
    const url = 'https://example.com/?q=' + 'a'.repeat(3000)
    const posted = await store.appendChat(bot.id, { role: 'card', card: { card: 'approval', approvalId: 'a', runId: 'r', actionKind: 'send', summary: 's'.repeat(600), consequences: [], warnings: [], target: 'Send', url, shot: null, status: 'pending', announced: true } })
    expect(posted.card).toMatchObject({ target: 'Send', approvalId: 'a' })
    if (posted.card?.card !== 'approval') throw new Error('not an approval card')
    expect(posted.card.url).toHaveLength(2000)
    expect(posted.card.summary).toHaveLength(500)
    const updated = await store.updateChatCard(bot.id, posted.id, { ...posted.card, url, status: 'allowed' })
    expect(updated?.card).toMatchObject({ status: 'allowed' })
    expect(await store.readChat(bot.id, { limit: 5 })).toHaveLength(1)
  })

  it('text over the limit of one message is cut at the store, and splitChatText keeps all of it in pieces', async () => {
    const bot = await store.createBot({ name: 'Bot', persona: 'p' })
    const long = ('line of a long report 🙂\n'.repeat(3000)).trimEnd()
    const posted = await store.appendChat(bot.id, { role: 'bot', text: long })
    expect(posted.text?.length).toBeLessThanOrEqual(20_000)
    const parts = splitChatText(long)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe(long)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(20_000)
      // No piece starts or ends with half of a character.
      expect(part).toBe(part.toWellFormed())
    }
    expect(splitChatText('short')).toEqual(['short'])
    const noBreaks = '🙂'.repeat(15_000)
    expect(splitChatText(noBreaks).every((part) => part === part.toWellFormed() && part.length <= 20_000)).toBe(true)
  })

  it('appendChat rejects a card that does not match the schema', async () => {
    const bot = await newBot()
    const bad = { card: 'approval', approvalId: 'a' } as unknown as Card
    await expect(store.appendChat(bot.id, { role: 'card', card: bad })).rejects.toThrow()
    expect(await store.readChat(bot.id, { limit: 5 })).toEqual([])
  })

  it('skips a corrupt line and keeps the rest', async () => {
    const bot = await newBot()
    await store.appendChat(bot.id, { role: 'user', text: 'kept' })
    await writeFile(join(dataDir, bot.id, 'chat.jsonl'), '{ broken\n', { flag: 'a' })
    await store.appendChat(bot.id, { role: 'bot', text: 'also kept' })
    expect((await store.readChat(bot.id, { limit: 10 })).map((m) => m.text)).toEqual(['kept', 'also kept'])
  })

  it('updateChatCard replaces one card in place and keeps the order', async () => {
    const bot = await newBot()
    await store.appendChat(bot.id, { role: 'user', text: 'first' })
    const card = await store.appendChat(bot.id, { role: 'card', card: { card: 'takeover', reason: 'login', status: 'active' } })
    await store.appendChat(bot.id, { role: 'bot', text: 'last' })
    const updated = await store.updateChatCard(bot.id, card.id, { card: 'takeover', reason: 'login', status: 'ended' })
    expect(updated).toEqual({ ...card, card: { card: 'takeover', reason: 'login', status: 'ended' } })
    const all = await store.readChat(bot.id, { limit: 10 })
    expect(all.map((m) => m.text ?? m.card?.card)).toEqual(['first', 'takeover', 'last'])
    expect(all[1]?.card).toMatchObject({ status: 'ended' })
    expect(await store.updateChatCard(bot.id, 'no-such-id', { card: 'status', text: 'x' })).toBeNull()
    expect((await readdir(join(dataDir, bot.id))).some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  // An update rewrites the file through a rename. Without one write lock per file, an append that
  // lands on the old file in between is lost (an approval decided while the user types a message).
  it('a message appended while a card is being updated survives, and so does the update', async () => {
    const bot = await newBot()
    const card = await store.appendChat(bot.id, { role: 'card', card: { card: 'approval', approvalId: 'a', runId: 'r', actionKind: 'send', summary: 's', consequences: [], warnings: [], target: 'Send', url: '', shot: null, status: 'pending', announced: true } })
    const [updated, typed] = await Promise.all([
      store.updateChatCard(bot.id, card.id, { ...(card.card as Extract<NonNullable<typeof card.card>, { card: 'approval' }>), status: 'allowed' }),
      store.appendChat(bot.id, { role: 'user', text: 'typed while deciding' }),
    ])
    const all = await store.readChat(bot.id, { limit: 10 })
    expect(all.map((m) => m.id)).toEqual([card.id, typed.id])
    expect(all[0]?.card).toMatchObject({ status: 'allowed' })
    expect(updated?.card).toMatchObject({ status: 'allowed' })
  })

  it('returns an empty list before the first message', async () => {
    const bot = await newBot()
    expect(await store.readChat(bot.id, { limit: 5 })).toEqual([])
  })
})

describe('runs', () => {
  it('appendRunEvent then readRunEvents round-trips, and listOpenRuns lists only runs without an end', async () => {
    const bot = await newBot()
    await store.startRun(bot.id, 'run-a')
    await store.startRun(bot.id, 'run-b')
    const stepA = event(bot.id, 'run-a', { type: 'step', step: 1, action: 'left_click', input: { coordinate: [1, 2] } })
    await store.appendRunEvent(stepA)
    await store.appendRunEvent(event(bot.id, 'run-b', { type: 'step', step: 1, action: 'screenshot', input: {} }))
    await store.appendRunEvent(event(bot.id, 'run-b', { type: 'end', outcome: 'done', summary: 'finished' }))
    expect(await store.readRunEvents(bot.id, 'run-a')).toEqual([stepA])
    expect(await store.listOpenRuns(bot.id)).toEqual(['run-a'])
  })

  it('listOpenRuns ignores hidden files and names that are not run ids (the shipped example folder carries runs/.gitkeep)', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    try {
      const bot = await newBot()
      await store.startRun(bot.id, 'run-a')
      await writeFile(join(dataDir, bot.id, 'runs', '.gitkeep'), '', 'utf8')
      await writeFile(join(dataDir, bot.id, 'runs', 'Not A Run'), '', 'utf8')
      expect(await store.listOpenRuns(bot.id)).toEqual(['run-a'])
      // A hidden entry is expected noise; anything else gets one warning naming it.
      expect(warn.mock.calls).toEqual([['ignoring an entry under runs/ that is not a run', { botId: bot.id, entry: 'Not A Run' }]])
    } finally {
      warn.mockRestore()
    }
  })

  it('listRunSummaries gives one line per run, newest first: goal, source, outcome and action count, and no cost', async () => {
    const bot = await newBot()
    const at = (t: string, runId: string, body: Parameters<typeof event>[2]): RunEvent => ({ ...event(bot.id, runId, body), t })
    await store.startRun(bot.id, 'run-old')
    await store.startRun(bot.id, 'run-new')
    await writeFile(join(dataDir, bot.id, 'runs', '.gitkeep'), '', 'utf8')
    await store.appendRunEvent(at('2026-01-01T08:00:00.000Z', 'run-old', { type: 'queued', goal: 'water the plants', source: 'routine', routineName: 'morning' }))
    await store.appendRunEvent(at('2026-01-01T08:00:01.000Z', 'run-old', { type: 'tool_call', step: 0, name: 'open_url', input: {} }))
    await store.appendRunEvent(at('2026-01-01T08:00:02.000Z', 'run-old', { type: 'step', step: 1, action: 'screenshot', input: {} }))
    await store.appendRunEvent(at('2026-01-01T08:00:03.000Z', 'run-old', { type: 'tool_result', step: 1, name: 'screenshot', ok: true, summary: 'screenshot', shot: null }))
    await store.appendRunEvent(at('2026-01-01T08:00:04.000Z', 'run-old', { type: 'cost', inputTokens: 1, outputTokens: 1, cacheRead: 0, cacheWrite: 0, usd: 0.25 }))
    await store.appendRunEvent(at('2026-01-01T08:00:06.000Z', 'run-old', { type: 'end', outcome: 'done', summary: 'watered' }))
    await store.appendRunEvent(at('2026-01-02T08:00:00.000Z', 'run-new', { type: 'queued', goal: 'count the chairs', source: 'message' }))

    expect(await store.listRunSummaries(bot.id)).toEqual([
      { runId: 'run-new', startedAt: '2026-01-02T08:00:00.000Z', goal: 'count the chairs', source: 'message', routineName: null, outcome: null, summary: '', actions: 0 },
      { runId: 'run-old', startedAt: '2026-01-01T08:00:00.000Z', goal: 'water the plants', source: 'routine', routineName: 'morning', outcome: 'done', summary: 'watered', actions: 2 },
    ])
  })

  it('listRunSummaries puts a run with no event yet first: it has no time, and it was created last', async () => {
    const bot = await newBot()
    await store.startRun(bot.id, 'run-dated')
    await store.startRun(bot.id, 'run-fresh')
    await store.appendRunEvent({ ...event(bot.id, 'run-dated', { type: 'queued', goal: 'count the chairs', source: 'message' }), t: '2026-01-02T08:00:00.000Z' })
    const runs = await store.listRunSummaries(bot.id)
    expect(runs.map((r) => [r.runId, r.startedAt])).toEqual([
      ['run-fresh', null],
      ['run-dated', '2026-01-02T08:00:00.000Z'],
    ])
  })

  it('listRunSummaries answers an empty list for a bot with no runs folder', async () => {
    const bot = await newBot()
    await rm(join(dataDir, bot.id, 'runs'), { recursive: true, force: true })
    expect(await store.listRunSummaries(bot.id)).toEqual([])
  })

  it('appendRunEvent rejects an event that does not match the schema', async () => {
    const bot = await newBot()
    await store.startRun(bot.id, 'run-a')
    const bad = { t: 'now', runId: 'run-a', botId: bot.id, type: 'gate', step: 1 } as unknown as RunEvent
    await expect(store.appendRunEvent(bad)).rejects.toThrow()
    expect(await store.readRunEvents(bot.id, 'run-a')).toEqual([])
  })

  it('a run that crashed before its first event is still listed as open', async () => {
    const bot = await newBot()
    await store.startRun(bot.id, 'run-c')
    expect(await store.listOpenRuns(bot.id)).toEqual(['run-c'])
  })

  it('skips a corrupt run event line and keeps the rest', async () => {
    const bot = await newBot()
    await store.startRun(bot.id, 'run-a')
    const stepA = event(bot.id, 'run-a', { type: 'step', step: 1, action: 'screenshot', input: {} })
    await store.appendRunEvent(stepA)
    await writeFile(
      join(dataDir, bot.id, 'runs', 'run-a', 'events.jsonl'),
      '{ broken\n{"type":"step"}\n{"t":"x","runId":"run-a","botId":"' + bot.id + '","type":"gate","step":1}\n',
      { flag: 'a' },
    )
    const stepB = event(bot.id, 'run-a', { type: 'step', step: 2, action: 'screenshot', input: {} })
    await store.appendRunEvent(stepB)
    expect(await store.readRunEvents(bot.id, 'run-a')).toEqual([stepA, stepB])
  })

  it('rejects a run id that is not a slug', async () => {
    const bot = await newBot()
    await expect(store.startRun(bot.id, '../escape')).rejects.toThrow('invalid name')
  })

  it('writeShot returns the sha256 of the bytes and readShot returns them', async () => {
    const bot = await newBot()
    await store.startRun(bot.id, 'run-a')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const hash = await store.writeShot(bot.id, 'run-a', png)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    const { createHash } = await import('node:crypto')
    expect(hash).toBe(createHash('sha256').update(png).digest('hex'))
    expect(Buffer.from(await store.readShot(bot.id, 'run-a', hash))).toEqual(Buffer.from(png))
    await expect(store.readShot(bot.id, 'run-a', '../../bot')).rejects.toThrow('invalid screenshot hash')
  })
})

describe('memory', () => {
  it('appendMemory writes a dated line and readMemory returns it', async () => {
    const bot = await newBot()
    await store.appendMemory(bot.id, 'Outcome: two interviews a month')
    const text = await store.readMemory(bot.id)
    expect(text).toMatch(/^- \d{4}-\d{2}-\d{2}: Outcome: two interviews a month\n$/)
  })

  it('flattens a note with line breaks into one line so the file stays one note per line', async () => {
    const bot = await newBot()
    await store.appendMemory(bot.id, 'first line\n  second line\n')
    const lines = (await store.readMemory(bot.id)).split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/: first line second line$/)
  })
})

describe('skills and routines', () => {
  it('writeSkill with a path-like name throws and approval-rules.json is unchanged', async () => {
    const bot = await newBot()
    const rulesPath = join(dataDir, bot.id, 'approval-rules.json')
    const before = await readFile(rulesPath, 'utf8')
    await expect(store.writeSkill(bot.id, { name: '../approval-rules', description: 'x', body: 'y' })).rejects.toThrow()
    expect(await readFile(rulesPath, 'utf8')).toBe(before)
    expect(await readdir(join(dataDir, bot.id, 'skills'))).toEqual([])
  })

  it('writeRoutine with a path-like name throws and no routine file is written', async () => {
    const bot = await newBot()
    await expect(
      store.writeRoutine(bot.id, { name: '../evil', skill: 's', schedule: '0 7 * * *', event: null, enabled: true, body: '' }),
    ).rejects.toThrow()
    expect(await readdir(join(dataDir, bot.id, 'routines'))).toEqual([])
    expect(await store.readRoutine(bot.id, 'missing')).toBeNull()
  })

  it('writeSkill with a valid name then listSkills returns it', async () => {
    const bot = await newBot()
    const skill = { name: 'search-board', description: 'Search the board', body: 'Open the board.\n' }
    await store.writeSkill(bot.id, skill)
    expect(await store.listSkills(bot.id)).toEqual([skill])
    expect(await store.readSkill(bot.id, 'missing')).toBeNull()
  })

  it('writeRoutine rejects a schedule that is not a cron expression with an invalid schedule message', async () => {
    const bot = await newBot()
    await expect(
      store.writeRoutine(bot.id, { name: 'morning', skill: 'search-board', schedule: 'every morning', event: null, enabled: true, body: 'Run.' }),
    ).rejects.toThrow(/^invalid schedule/)
    expect(await store.listRoutines(bot.id)).toEqual([])
  })

  it('writeRoutine accepts a cron expression and round-trips enabled as a boolean', async () => {
    const bot = await newBot()
    await store.writeSkill(bot.id, { name: 'search-board', description: 'Search', body: 'Open the board.\n' })
    const routine = { name: 'morning', skill: 'search-board', schedule: '0 7 * * 1-5', event: null, enabled: false, body: 'Run the search.\n' }
    await store.writeRoutine(bot.id, routine)
    expect(await store.listRoutines(bot.id)).toEqual([routine])
    expect(await readFile(join(dataDir, bot.id, 'routines', 'morning.md'), 'utf8')).toContain('enabled: false')
  })

  it('a routine file on disk with neither schedule nor event is skipped, not returned half-valid', async () => {
    const bot = await newBot()
    await writeFile(join(dataDir, bot.id, 'routines', 'odd.md'), '---\nname: odd\nskill: s\n---\nbody\n', 'utf8')
    expect(await store.readRoutine(bot.id, 'odd')).toBeNull()
    expect(await store.listRoutines(bot.id)).toEqual([])
  })

  it('writeRoutine refuses an enabled routine whose skill is missing, and writes a disabled one', async () => {
    const bot = await newBot()
    const base = { name: 'morning', skill: 'ghost', schedule: '0 7 * * *', event: null, body: 'Run.' }
    await expect(store.writeRoutine(bot.id, { ...base, enabled: true })).rejects.toThrow('there is no skill named ghost; save the skill first')
    expect(await store.readRoutine(bot.id, 'morning')).toBeNull()
    await store.writeRoutine(bot.id, { ...base, enabled: false })
    expect(await store.readRoutine(bot.id, 'morning')).toMatchObject({ enabled: false, skill: 'ghost' })
  })

  it('writeRoutine requires exactly one of schedule and event', async () => {
    const bot = await newBot()
    await store.writeSkill(bot.id, { name: 's', description: 'S', body: 'Do.\n' })
    const base = { name: 'r', skill: 's', enabled: true, body: '' }
    await expect(store.writeRoutine(bot.id, { ...base, schedule: null, event: null })).rejects.toThrow('exactly one')
    await expect(store.writeRoutine(bot.id, { ...base, schedule: '0 7 * * *', event: 'mail' })).rejects.toThrow('exactly one')
    await store.writeRoutine(bot.id, { ...base, schedule: null, event: 'mail' })
    expect((await store.listRoutines(bot.id)).map((r) => r.event)).toEqual(['mail'])
  })

  it('writeRoutine refuses a schedule that runs more often than every 15 minutes and saves one that runs every 15', async () => {
    const bot = await newBot()
    await store.writeSkill(bot.id, { name: 'search-board', description: 'Search', body: 'Open the board.\n' })
    const base = { name: 'often', skill: 'search-board', event: null, enabled: true, body: 'Run.' }
    await expect(store.writeRoutine(bot.id, { ...base, schedule: '*/10 * * * *' })).rejects.toThrow('schedule runs too often: the closest a routine may run is every 15 minutes')
    // Five minutes apart once a day and sparse otherwise: the refusal must not depend on the minute of saving.
    await expect(store.writeRoutine(bot.id, { ...base, schedule: '0,5 7 * * 1-5' })).rejects.toThrow('every 15 minutes')
    expect(await store.listRoutines(bot.id)).toEqual([])
    await store.writeRoutine(bot.id, { ...base, schedule: '*/15 * * * *' })
    expect((await store.listRoutines(bot.id)).map((r) => r.schedule)).toEqual(['*/15 * * * *'])
  })

  it('measures the gaps on the routines\' clock: a weekly run is one hour closer across a daylight-saving change', () => {
    // Noon every Sunday: 168 hours apart in UTC, 167 hours once a year where clocks go forward.
    // A hundred weekly runs always span one such change, so the outcome does not depend on the day of the test.
    const weekly = { name: 'weekly', skill: 'search-board', schedule: '0 12 * * 0', event: null, enabled: true, body: 'Run.' }
    const week = 7 * 24 * 60 * 60_000
    expect(validateRoutine(weekly, { minIntervalMs: week, timezone: 'UTC' })).toEqual(weekly)
    expect(() => validateRoutine(weekly, { minIntervalMs: week, timezone: 'Europe/Prague' })).toThrow('schedule runs too often')
  })

  it('takes the minimum interval from the store options', async () => {
    const strict = createStore(dataDir, { minIntervalMs: 60 * 60_000 })
    const bot = await newBot()
    await expect(
      strict.writeRoutine(bot.id, { name: 'half-hourly', skill: 'search-board', schedule: '*/30 * * * *', event: null, enabled: true, body: 'Run.' }),
    ).rejects.toThrow('every 60 minutes')
  })
})

describe('a stray file in the skills or routines folder', () => {
  it('is skipped by the lists, so one file under a foreign name cannot fail a run or the boot', async () => {
    const bot = await store.createBot({ name: 'Bot', persona: 'p' })
    await store.writeSkill(bot.id, { name: 'search-board', description: 'Search', body: 'Open the board.\n' })
    await store.writeRoutine(bot.id, { name: 'daily', skill: 'search-board', schedule: '0 7 * * *', event: null, enabled: true, body: 'Search.\n' })
    await writeFile(join(dataDir, bot.id, 'skills', 'My Notes (copy).md'), 'not a skill')
    await writeFile(join(dataDir, bot.id, 'routines', 'README.md'), 'not a routine')
    expect((await store.listSkills(bot.id)).map((s) => s.name)).toEqual(['search-board'])
    expect((await store.listRoutines(bot.id)).map((r) => r.name)).toEqual(['daily'])
  })
})

describe('rules', () => {
  it('readRules returns DEFAULT_RULES when the file was deleted', async () => {
    const bot = await newBot()
    await rm(join(dataDir, bot.id, 'approval-rules.json'))
    expect(await store.readRules(bot.id)).toEqual(DEFAULT_RULES)
  })

  it('readRules returns DEFAULT_RULES when the file is malformed, and the file when it is valid', async () => {
    const bot = await newBot()
    const path = join(dataDir, bot.id, 'approval-rules.json')
    await writeFile(path, '{"requireApproval": "send"}', 'utf8')
    expect(await store.readRules(bot.id)).toEqual(DEFAULT_RULES)
    await writeFile(path, JSON.stringify({ requireApproval: ['send'], alwaysAllow: ['submit-control'] }), 'utf8')
    expect(await store.readRules(bot.id)).toEqual({ requireApproval: ['send'], alwaysAllow: ['submit-control'] })
  })

  it('the store exposes no function that writes the rules file', () => {
    const writers = Object.keys(store).filter((k) => /rule/i.test(k))
    expect(writers).toEqual(['readRules'])
  })
})

describe('artifacts', () => {
  it('writes, lists and reads .md and .txt artifacts and rejects other names', async () => {
    const bot = await newBot()
    await store.writeArtifact(bot.id, 'dossier-acme.md', '# Acme\n')
    await store.writeArtifact(bot.id, 'letter.txt', 'Dear team,\n')
    expect(await store.listArtifacts(bot.id)).toEqual(['dossier-acme.md', 'letter.txt'])
    expect(await store.readArtifact(bot.id, 'dossier-acme.md')).toBe('# Acme\n')
    expect(await store.readArtifact(bot.id, 'nothing.md')).toBeNull()
    await expect(store.writeArtifact(bot.id, '../evil.md', 'x')).rejects.toThrow('invalid name')
    await expect(store.writeArtifact(bot.id, 'script.sh', 'x')).rejects.toThrow('.md or .txt')
  })
})

describe('connections', () => {
  const granted = { id: 'maps', kind: 'builtin' as const, builtin: 'maps', grantedAt: '2026-09-24T10:00:00.000Z', status: 'connected' as const }

  it('a bot with no connections file has no connections', async () => {
    const bot = await newBot()
    expect(await store.readConnections(bot.id)).toEqual([])
  })

  it('a connection written by one store is read back by a new store on the same folder, from a private file', async () => {
    const bot = await newBot()
    await store.writeConnection(bot.id, granted)
    expect(await createStore(dataDir).readConnections(bot.id)).toEqual([granted])
    expect((await stat(join(dataDir, bot.id, 'connections.json'))).mode & 0o777).toBe(0o600)
  })

  it('writing the same id again keeps one entry with the later values', async () => {
    const bot = await newBot()
    const other = { ...granted, id: 'encyclopedia', builtin: 'encyclopedia' }
    await store.writeConnection(bot.id, granted)
    await store.writeConnection(bot.id, other)
    await store.writeConnection(bot.id, { ...granted, status: 'disconnected', grantedAt: '2026-09-24T11:00:00.000Z' })
    const read = await store.readConnections(bot.id)
    expect(read).toHaveLength(2)
    expect(read.find((c) => c.id === 'maps')).toMatchObject({ status: 'disconnected', grantedAt: '2026-09-24T11:00:00.000Z' })
  })

  it('two writes started together both land', async () => {
    const bot = await newBot()
    await Promise.all([store.writeConnection(bot.id, granted), store.writeConnection(bot.id, { ...granted, id: 'mail', builtin: 'mail' })])
    expect((await store.readConnections(bot.id)).map((c) => c.id).sort()).toEqual(['mail', 'maps'])
  })

  it('a file that does not parse makes the read fail instead of reading as no connections', async () => {
    const bot = await newBot()
    await writeFile(join(dataDir, bot.id, 'connections.json'), '{', 'utf8')
    await expect(store.readConnections(bot.id)).rejects.toThrow()
  })

  it('a file of valid JSON in the wrong shape makes the read fail too', async () => {
    const bot = await newBot()
    await writeFile(join(dataDir, bot.id, 'connections.json'), JSON.stringify([{ id: 'maps', kind: 'builtin', status: 'pending' }]), 'utf8')
    await expect(store.readConnections(bot.id)).rejects.toThrow(/builtin|status/)
  })
})

describe('a memory save with a base', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dobot-memory-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps a note appended while the save is under way', async () => {
    const s = createStore(dir)
    const id = (await s.createBot({ name: 'Keeper', persona: 'Keeps notes.' })).id
    await s.writeMemory(id, 'original\n')

    const [written] = await Promise.all([s.writeMemory(id, 'user edit\n', 'original\n'), s.appendMemory(id, 'concurrent bot note')])

    expect(written).toBe(true)
    expect(await s.readMemory(id)).toMatch(/^user edit\n- \d{4}-\d{2}-\d{2}: concurrent bot note\n$/)
  })

  it('writes nothing when a note arrived before the save', async () => {
    const s = createStore(dir)
    const id = (await s.createBot({ name: 'Keeper', persona: 'Keeps notes.' })).id
    await s.writeMemory(id, 'original\n')

    const [, written] = await Promise.all([s.appendMemory(id, 'concurrent bot note'), s.writeMemory(id, 'user edit\n', 'original\n')])

    expect(written).toBe(false)
    expect(await s.readMemory(id)).toContain('concurrent bot note')
    expect(await s.readMemory(id)).not.toContain('user edit')
  })
})
