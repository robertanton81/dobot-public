import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAction } from '../../../src/server/agent/actions'
import { sample, sampleDiff, type Sample } from '../../../src/server/agent/images'
import { NO_PROGRESS_NOTICE_AT, NO_PROGRESS_STUCK_AT, ProgressGuard, type ProgressVerdict } from '../../../src/server/agent/progress'
import { THRESHOLD } from '../../../src/server/agent/stuck'

// Replays the recorded runs of 2026-09-17 through the progress guard: the old rule (signatures
// only) and the new one (failed tools count, a screenshot of an unseen screen is progress).
// Run from the repo root: `pnpm exec tsx docs/evidence/2026-09-17-loops/replay-guard.ts [run-id-prefix] [all]`.
// The first argument prints every screenshot's decision for that run; `all` replays every run under
// data/bots/job-hunt-bot/runs (git-ignored, so only on the machine that ran them) instead of the
// event logs copied into this folder. The screenshots are read from the run folders either way.
const evidence = 'docs/evidence/2026-09-17-loops'
const runsDir = 'data/bots/job-hunt-bot/runs'
type Row = Record<string, any>

function fire(v: ProgressVerdict, step: number, out: { notices: number[]; stuck: number | null }): void {
  if (v === null) return
  if ('stuck' in v) { if (out.stuck === null) out.stuck = step; return }
  out.notices.push(step)
}

const detail = process.argv[2] ?? ''
const sources = process.argv[3] === 'all'
  ? readdirSync(runsDir).filter((d) => existsSync(join(runsDir, d, 'events.jsonl'))).map((d) => join(runsDir, d, 'events.jsonl'))
  : readdirSync(evidence).filter((f) => f.endsWith('-events.jsonl')).sort().map((f) => join(evidence, f))
const runs = sources.map((path) => ({ path, rows: readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row) })).filter((r) => r.rows.length > 0)
runs.sort((a, b) => String(a.rows[0]!.t).localeCompare(String(b.rows[0]!.t)))
for (const { path, rows } of runs) {
  const runId = rows[0]!.runId as string
  const file = `${String(rows[0]!.t).slice(5, 16)} ${runId.slice(0, 8)}`
  const shotsDir = join(runsDir, runId, 'shots')
  const oldGuard = new ProgressGuard()
  const newGuard = new ProgressGuard()
  const oldOut = { notices: [] as number[], stuck: null as number | null }
  const newOut = { notices: [] as number[], stuck: null as number | null }
  let pending: Row | null = null
  let steps = 0, loaded = 0, missing = 0, parseErrors = 0, failedTools = 0
  const samples: { step: number; hash: string; s: Sample }[] = []
  const decisions: string[] = []
  for (const row of rows) {
    if (row.type === 'step' || row.type === 'tool_call') { pending = row; continue }
    if (row.type !== 'tool_result' || pending === null) continue
    const call = pending
    pending = null
    if (call.type === 'tool_call') {
      if (!row.ok) failedTools += 1
      fire(oldGuard.noteTool(call.name, call.input, true), call.step, oldOut)
      fire(newGuard.noteTool(call.name, call.input, !!row.ok), call.step, newOut)
      continue
    }
    steps += 1
    const parsed = parseAction(call.action, call.input ?? {})
    if ('error' in parsed) { parseErrors += 1; continue }
    if (!row.ok) continue // a failed computer action never reaches the guard in run.ts
    let png: Uint8Array | undefined
    if (parsed.name === 'screenshot' && typeof row.shot === 'string') {
      const path = join(shotsDir, `${row.shot}.png`)
      if (existsSync(path)) { png = readFileSync(path); loaded += 1 } else missing += 1
    }
    fire(oldGuard.noteAction(parsed), call.step, oldOut)
    if (png !== undefined) {
      const s = sample(png)
      let nearest = Infinity, nearestStep = 0
      for (const seen of samples) { const d = sampleDiff(seen.s, s); if (d < nearest) { nearest = d; nearestStep = seen.step } }
      const isNew = nearest >= THRESHOLD
      samples.push({ step: call.step, hash: row.shot, s })
      decisions.push(`${String(call.step).padStart(3)} ${isNew ? 'NEW ' : 'seen'} nearest=${nearest === Infinity ? '-' : nearest.toFixed(2)}@${nearestStep}`)
    }
    fire(newGuard.noteAction(parsed, png), call.step, newOut)
  }
  const end = rows.filter((r) => r.type === 'end').map((r) => r.outcome).at(-1) ?? 'open'
  const distinct = samples.length - decisions.filter((d) => d.includes('seen')).length
  console.log(`${file} ${end.padEnd(9)} steps=${String(steps).padStart(3)} | old: notices=${JSON.stringify(oldOut.notices)} stuck@${oldOut.stuck ?? '-'} | new: notices=${JSON.stringify(newOut.notices)} stuck@${newOut.stuck ?? '-'} | shots ${loaded} loaded, ${missing} missing, ${distinct} distinct screens | failed tools ${failedTools}, parse errors ${parseErrors}`)
  if (runId.startsWith(detail)) for (const d of decisions) console.log('   ' + d)
}
console.log(`stuck at ${NO_PROGRESS_STUCK_AT}, notices at ${NO_PROGRESS_NOTICE_AT.join(',')}, same-screen distance < ${THRESHOLD}`)
