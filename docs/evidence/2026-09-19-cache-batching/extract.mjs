// Builds the numeric snapshot of candidate runs for the screenshot-cache batching check.
// It reads the private run events of one bot and writes only allowlisted numbers and enums:
// no run id, goal, text, tool input, URL, screenshot hash or account detail leaves this script.
// Every output object is built field by field; no source object is copied or spread.
//
// Run from the repository root:
//   node docs/evidence/2026-09-19-cache-batching/extract.mjs --since 2026-09-19T09:00:00Z --limit 13 \
//     --commits "2026-09-19T09:00:00Z=b6847da,2026-09-19T09:30:00Z=a8c711e" \
//     --out docs/evidence/2026-09-19-cache-batching/usage.json --map .local/cache-batching/run-map.json
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, word, n, all) => (word.startsWith('--') ? [...pairs, [word.slice(2), all[n + 1]]] : pairs), []))
const runsDir = args.runs ?? 'data/bots/job-hunt-bot/runs'
const since = Date.parse(args.since ?? '')
const until = args.until === undefined ? Infinity : Date.parse(args.until)
const limit = Number(args.limit)
if (!Number.isFinite(since) || !Number.isFinite(until) && until !== Infinity) throw new Error('--since (and --until, when given) must be ISO times')
if (!Number.isInteger(limit) || limit < 3) throw new Error('--limit must be the image limit the runs used (13, or 3 for the fallback)')
// --commits "2026-09-19T09:00:00Z=b6847da,2026-09-19T09:30:00Z=a8c711e": the code revision in use from
// each time on. A run gets the revision of the last entry at or before its start.
const revisions = String(args.commits ?? '').split(',').filter((pair) => pair !== '').map((pair) => {
  const [from, sha] = pair.split('=')
  if (!Number.isFinite(Date.parse(from)) || !/^[0-9a-f]{7,40}$/.test(sha ?? '')) throw new Error('--commits takes ISO=sha pairs, comma separated')
  return { from: Date.parse(from), sha }
}).sort((x, y) => x.from - y.from)
// For runs recorded earlier, across several revisions that nobody noted per run, --revision-note says
// so in words and the per-run field stays null.
const revisionNote = args['revision-note'] ?? null
if (revisions.length === 0 && revisionNote === null) throw new Error('--commits is required: the code revision the runs used, by start time (or --revision-note for older runs)')
if (revisionNote !== null && !/^[0-9a-f. ,a-z]{7,120}$/.test(revisionNote)) throw new Error('--revision-note holds revisions and plain lower-case words only')
const revisionAt = (time) => {
  if (revisions.length === 0) return null
  const hit = revisions.filter((entry) => entry.from <= time).at(-1)
  if (!hit) throw new Error('a run started before the first revision named in --commits')
  return hit.sha
}
if (!args.out || !args.map) throw new Error('--out and --map are required')

// The platform's own enum (src/server/store/types.ts, RunOutcome).
const OUTCOMES = new Set(['done', 'failed', 'blocked', 'budget', 'stuck', 'denied', 'cancelled', 'unknown'])
const EVENT_TYPES = ['queued', 'status', 'step', 'tool_call', 'tool_result', 'gate', 'approval', 'takeover', 'cost', 'text', 'end']

const number = (value, what) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${what} is not a finite number at or above zero`)
  return value
}

const found = []
for (const id of readdirSync(runsDir)) {
  const file = join(runsDir, id, 'events.jsonl')
  if (!existsSync(file)) continue
  const events = readFileSync(file, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
  const startedAt = Date.parse(events[0]?.t ?? '')
  if (!Number.isFinite(startedAt) || startedAt < since || startedAt > until) continue

  const counts = Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]))
  const calls = []
  let outcome = null
  let images = 0
  let previousTime = null
  for (const event of events) {
    const time = Date.parse(event.t)
    if (typeof event.type === 'string' && Object.hasOwn(counts, event.type)) counts[event.type] += 1
    if (event.type === 'tool_result' && typeof event.shot === 'string') images += 1
    if (event.type === 'end' && OUTCOMES.has(event.outcome)) outcome = event.outcome
    if (event.type === 'cost') {
      calls.push({
        e: previousTime === null || !Number.isFinite(previousTime) ? null : previousTime,
        c: number(time, 'a cost event time'),
        i: number(event.inputTokens, 'inputTokens'),
        o: number(event.outputTokens, 'outputTokens'),
        r: number(event.cacheRead, 'cacheRead'),
        w: number(event.cacheWrite, 'cacheWrite'),
        usd: number(event.usd, 'usd'),
        imgs: images,
        discarded: event.response?.discarded === true,
      })
      images = 0
    }
    previousTime = time
  }
  if (calls.length === 0) continue
  found.push({ id, startedAt, run: { outcome, events: counts, calls } })
}

found.sort((a, b) => a.startedAt - b.startedAt)
const runs = found.map((item, n) => ({ ordinal: n + 1, codeCommit: revisionAt(item.startedAt), outcome: item.run.outcome, events: item.run.events, calls: item.run.calls }))
const snapshot = {
  schemaVersion: 1,
  capturedOn: new Date().toISOString().slice(0, 10),
  codeCommit: revisions.at(-1)?.sha ?? null,
  ...(revisionNote === null ? {} : { revisionNote }),
  limit,
  source: 'Numeric fields and event counts from job-hunt-bot run events; run IDs, text, images, tool inputs and account details omitted',
  runs,
}
writeFileSync(args.out, JSON.stringify(snapshot) + '\n')
// The map stays on this machine: it ties an ordinal to a private run folder.
writeFileSync(args.map, JSON.stringify(Object.fromEntries(found.map((item, n) => [n + 1, item.id])), null, 2) + '\n')
console.log(JSON.stringify({ runs: runs.length, calls: runs.reduce((sum, run) => sum + run.calls.length, 0), out: args.out }))
