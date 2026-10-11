import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore, type Store } from '../store'
import { dayIn, spentToday } from './budget'
import { seedRun } from './fakes'

let dataDir: string
let store: Store

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-budget-'))
  store = createStore(dataDir)
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const NOON_IN_PRAGUE = new Date('2026-09-13T10:00:00Z')

describe('dayIn', () => {
  it('names the calendar date in the given time zone, not in UTC', () => {
    // 23:30 UTC on 12 September is 01:30 on 13 September in Prague (summer time, UTC+2).
    expect(dayIn(new Date('2026-09-12T23:30:00Z'), 'Europe/Prague')).toBe('2026-09-13')
    expect(dayIn(new Date('2026-09-12T23:30:00Z'), 'UTC')).toBe('2026-09-12')
  })
})

describe('spentToday', () => {
  it("adds up every bot's runs that started today on the routines' clock and leaves out yesterday's", async () => {
    const alpha = (await store.createBot({ name: 'Alpha', persona: 'Works.' })).id
    const beta = (await store.createBot({ name: 'Beta', persona: 'Works.' })).id
    await seedRun(store, alpha, 'run-today', '2026-09-13T08:00:00Z', [1.25, 0.5])
    await seedRun(store, beta, 'run-after-midnight', '2026-09-12T22:30:00Z', [2]) // 00:30 on the 13th in Prague
    await seedRun(store, beta, 'run-before-midnight', '2026-09-12T21:30:00Z', [10]) // 23:30 on the 12th in Prague
    expect(await spentToday(store, NOON_IN_PRAGUE, 'Europe/Prague')).toBeCloseTo(3.75)
  })

  // The example bot folder ships runs/.gitkeep. An entry under runs/ that is not a run must be
  // skipped: this sum is taken before every run, so a failure on a stray entry would stop every run.
  it('is zero without runs and skips an entry under runs/ that is not a run', async () => {
    const alpha = (await store.createBot({ name: 'Alpha', persona: 'Works.' })).id
    await mkdir(join(dataDir, alpha, 'runs'), { recursive: true })
    await writeFile(join(dataDir, alpha, 'runs', '.gitkeep'), '', 'utf8')
    expect(await spentToday(store, NOON_IN_PRAGUE, 'Europe/Prague')).toBe(0)
  })

  // A crash between startRun and the first event leaves a run folder with no events; a run whose
  // first event carries a time that does not parse must not stop every run of every bot.
  it('skips a run with no events yet and a run whose first event has no readable time, and still counts the rest', async () => {
    const alpha = (await store.createBot({ name: 'Alpha', persona: 'Works.' })).id
    await store.startRun(alpha, 'run-empty')
    await store.startRun(alpha, 'run-garbled')
    await appendFile(
      join(dataDir, alpha, 'runs', 'run-garbled', 'events.jsonl'),
      JSON.stringify({ t: 'no such time', runId: 'run-garbled', botId: alpha, type: 'cost', inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, usd: 50 }) + '\n',
      'utf8',
    )
    await seedRun(store, alpha, 'run-today', '2026-09-13T08:00:00Z', [1.25])
    expect(await spentToday(store, NOON_IN_PRAGUE, 'Europe/Prague')).toBeCloseTo(1.25)
  })
})
