import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../log'
import { isNotFound, PRIVATE_DIR, PRIVATE_FILE, runDir, runsDir, shotsDir } from './paths'
import { RunEvent, SLUG, type RunOutcome } from './types'

export const SHOT_HASH = /^[a-f0-9]{64}$/

export async function startRun(dataDir: string, botId: string, runId: string): Promise<void> {
  await mkdir(shotsDir(dataDir, botId, runId), { recursive: true, mode: PRIVATE_DIR })
}

export async function appendRunEvent(dataDir: string, event: RunEvent): Promise<void> {
  const valid = RunEvent.parse(event)
  await appendFile(join(runDir(dataDir, valid.botId, valid.runId), 'events.jsonl'), JSON.stringify(valid) + '\n', { encoding: 'utf8', mode: PRIVATE_FILE })
}

export async function readRunEvents(dataDir: string, botId: string, runId: string): Promise<RunEvent[]> {
  let raw: string
  try {
    raw = await readFile(join(runDir(dataDir, botId, runId), 'events.jsonl'), 'utf8')
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const events: RunEvent[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      log.warn('skipping a corrupt run event line', { botId, runId, line: i + 1 })
      continue
    }
    const parsed = RunEvent.safeParse(json)
    if (parsed.success) events.push(parsed.data)
    else log.warn('skipping a run event that does not match the schema', { botId, runId, line: i + 1 })
  }
  return events
}

/** Stores the PNG as <sha256>.png and returns the hash. */
export async function writeShot(dataDir: string, botId: string, runId: string, png: Uint8Array): Promise<string> {
  const hash = createHash('sha256').update(png).digest('hex')
  await writeFile(join(shotsDir(dataDir, botId, runId), hash + '.png'), png, { mode: PRIVATE_FILE })
  return hash
}

export async function readShot(dataDir: string, botId: string, runId: string, hash: string): Promise<Uint8Array> {
  if (!SHOT_HASH.test(hash)) throw new Error('invalid screenshot hash')
  return readFile(join(shotsDir(dataDir, botId, runId), hash + '.png'))
}

/** Runs whose events hold no `end` event: interrupted by a crash or a restart. */
export async function listOpenRuns(dataDir: string, botId: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(runsDir(dataDir, botId))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const open: string[] = []
  for (const runId of entries.sort()) {
    // A folder copied from examples/ carries a .gitkeep and Finder adds .DS_Store; neither is a run,
    // and a stray file must not stop the whole platform from booting.
    if (!SLUG.test(runId)) {
      if (!runId.startsWith('.')) log.warn('ignoring an entry under runs/ that is not a run', { botId, entry: runId })
      continue
    }
    const events = await readRunEvents(dataDir, botId, runId)
    if (!events.some((e) => e.type === 'end')) open.push(runId)
  }
  return open
}

export type RunCost = { runId: string; startedAt: string | null; usd: number }

/**
 * Every run of the bot, with the time of its first event and the sum of its cost events. An entry
 * that is not a run id is skipped without a warning: this runs before every run.
 */
export async function listRunCosts(dataDir: string, botId: string): Promise<RunCost[]> {
  let entries: string[]
  try {
    entries = await readdir(runsDir(dataDir, botId))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const costs: RunCost[] = []
  for (const runId of entries.sort()) {
    if (!SLUG.test(runId)) continue
    const events = await readRunEvents(dataDir, botId, runId)
    let usd = 0
    for (const event of events) if (event.type === 'cost') usd += event.usd
    costs.push({ runId, startedAt: events[0]?.t ?? null, usd })
  }
  return costs
}

export type RunSummary = {
  runId: string
  startedAt: string | null
  goal: string
  source: 'message' | 'routine' | null
  routineName: string | null
  /** null while the run has no `end` event: it is running, or the process died under it. */
  outcome: RunOutcome | null
  summary: string
  /** Screen actions plus platform tool calls. */
  actions: number
}

/**
 * One line per run, newest first, for a page that lists them. It carries no cost: what a run costs
 * the operator is read with listRunCosts, and the page does not show it. Reads every run's event
 * log on each call: fine for the hundreds of runs one bot collects, and an index file is the next
 * step when it is not. An entry that is not a run id is skipped without a warning, as in
 * listRunCosts.
 */
export async function listRunSummaries(dataDir: string, botId: string): Promise<RunSummary[]> {
  let entries: string[]
  try {
    entries = await readdir(runsDir(dataDir, botId))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const runs: RunSummary[] = []
  for (const runId of entries) {
    if (!SLUG.test(runId)) continue
    const events = await readRunEvents(dataDir, botId, runId)
    const run: RunSummary = { runId, startedAt: events[0]?.t ?? null, goal: '', source: null, routineName: null, outcome: null, summary: '', actions: 0 }
    for (const event of events) {
      if (event.type === 'queued') {
        run.goal = event.goal
        run.source = event.source
        run.routineName = event.routineName ?? null
      } else if (event.type === 'step' || event.type === 'tool_call') run.actions += 1
      else if (event.type === 'end') {
        run.outcome = event.outcome
        run.summary = event.summary
      }
    }
    runs.push(run)
  }
  // A run with no event yet has no time; it was created last, so it sorts first.
  return runs.sort((a, b) => (b.startedAt ?? '\uffff').localeCompare(a.startedAt ?? '\uffff'))
}
