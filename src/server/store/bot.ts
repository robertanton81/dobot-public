import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, readFile } from 'node:fs/promises'
import { errorFields, log } from '../log'
import { artifactsDir, botDir, botFile, isNotFound, memoryFile, PRIVATE_DIR, routinesDir, rulesFile, runsDir, skillsDir, withFileLock, workspaceDir, writeFileAtomic } from './paths'
import { clipStatus } from './status'
import { Bot, DEFAULT_RULES } from './types'

/**
 * At boot: the folder that holds every bot is for this account alone. A mode counts only when a path
 * is created, so a bot folder made by hand, or copied from the examples, keeps the modes of its copy;
 * closing the one folder above them keeps every other account out of all of them. Never rejects: a
 * folder that belongs to someone else stays as it is, and the log says so.
 */
export async function makeDataDirPrivate(dataDir: string): Promise<void> {
  try {
    await mkdir(dataDir, { recursive: true, mode: PRIVATE_DIR })
    await chmod(dataDir, PRIVATE_DIR)
  } catch (e) {
    log.warn('could not make the data folder private; other accounts on this machine may read it', errorFields(e))
  }
}

export async function listBots(dataDir: string): Promise<Bot[]> {
  let entries: string[]
  try {
    entries = await readdir(dataDir)
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const bots: Bot[] = []
  for (const id of entries.sort()) {
    if (id.startsWith('.')) continue // a Finder .DS_Store or a .gitkeep is not a bot folder
    try {
      bots.push(await readBot(dataDir, id))
    } catch (e) {
      // One damaged folder must not hide the others; readBot already logged the reason.
      if (!isNotFound(e)) log.warn('skipping a bot folder that does not load', { botId: id })
    }
  }
  return bots
}

/** Throws (after logging) when the folder is missing or bot.json is malformed. */
export async function readBot(dataDir: string, botId: string): Promise<Bot> {
  const path = botFile(dataDir, botId, 'bot.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (e) {
    if (isNotFound(e)) throw e
    log.error('bot.json unreadable', { botId, ...errorFields(e) })
    throw e
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    log.error('bot.json is not valid JSON', { botId, ...errorFields(e) })
    throw new Error(`bot.json of ${botId} is not valid JSON`)
  }
  const parsed = Bot.safeParse(json)
  if (!parsed.success) {
    log.error('bot.json does not match the schema', { botId, issues: parsed.error.issues.map((i) => i.path.join('.')) })
    throw new Error(`bot.json of ${botId} does not match the schema`)
  }
  return parsed.data
}

/** Atomic: a unique temp file, then a rename over bot.json. */
export async function writeBot(dataDir: string, bot: Bot): Promise<void> {
  await writeFileAtomic(botFile(dataDir, bot.id, 'bot.json'), JSON.stringify(bot, null, 2) + '\n')
}

export type CreateBotInput = { name: string; avatar?: string; persona: string }

export async function createBot(dataDir: string, input: CreateBotInput): Promise<Bot> {
  const id = await newBotId(dataDir, input.name)
  const bot: Bot = {
    id,
    name: input.name,
    avatar: input.avatar ?? '🤖',
    persona: input.persona,
    sandboxId: null,
    state: 'idle',
    statusLine: '',
    createdAt: new Date().toISOString(),
    routines: {},
  }
  Bot.parse(bot)
  const dir = botDir(dataDir, id)
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR })
  for (const sub of [skillsDir, routinesDir, artifactsDir, workspaceDir, runsDir]) {
    await mkdir(sub(dataDir, id), { recursive: true, mode: PRIVATE_DIR })
  }
  await writeFileAtomic(memoryFile(dataDir, id), '')
  await writeFileAtomic(rulesFile(dataDir, id), JSON.stringify(DEFAULT_RULES, null, 2) + '\n')
  await writeBot(dataDir, bot)
  log.info('bot created', { botId: id })
  return bot
}

export type BotPatch = Partial<Omit<Bot, 'id'>>

/**
 * Reads bot.json, applies the patch and writes it back, all inside the file's write chain: the run
 * loop, the scheduler and the sandbox manager all write this file, and two of them at once would
 * otherwise each write back a copy without the other's field. A patch that depends on the file's
 * content is a function of the bot as the chain reads it, never of a copy read earlier.
 */
export async function updateBot(dataDir: string, botId: string, patch: BotPatch | ((current: Bot) => BotPatch)): Promise<Bot> {
  return withFileLock(botFile(dataDir, botId, 'bot.json'), async () => {
    const current = await readBot(dataDir, botId)
    const fields = typeof patch === 'function' ? patch(current) : patch
    // The status line is display text: clipped here, once, so no caller can fail a state change with it.
    const clipped = fields.statusLine === undefined ? fields : { ...fields, statusLine: clipStatus(fields.statusLine) }
    const next = Bot.parse({ ...current, ...clipped, id: current.id })
    await writeBot(dataDir, next)
    return next
  })
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '')
  return slug || 'bot'
}

async function newBotId(dataDir: string, name: string): Promise<string> {
  const base = slugify(name)
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = `${base}-${randomBytes(2).toString('hex')}`
    try {
      await readdir(botDir(dataDir, id))
    } catch (e) {
      if (isNotFound(e)) return id
      throw e
    }
  }
  throw new Error('could not find a free bot id')
}
