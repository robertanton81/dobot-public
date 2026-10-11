// Evaluates the candidate runs of the screenshot-cache batching check (design spec criterion 7 to 9,
// revision 4). It reads usage.json beside this file: numbers and enums only. It first checks its own
// measure on small fixtures, then prints the report as JSON; the saved copy is results.json.
//
// Run from the repository root: node docs/evidence/2026-09-19-cache-batching/analyse.mjs
// The runs of the day before, under the old rule: add the argument usage-three-image-rule.json
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Sonnet 5, USD per million tokens: input, output, cache read, five-minute cache write.
const RATES = { i: 2, o: 10, r: 0.2, w: 2.5 }
// The frozen baseline: docs/evidence/2026-09-18-cache-batching (68 runs, 1,137 calls, three-image rule).
const BASELINE = { runs: 68, calls: 1137, usdPerCall: 0.0211, cacheWriteShare: 0.69, turnLimitMs: 6808, replayEstimate: '35 to 40% less model cost' }

const upperMedian = (xs) => xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function evaluateRun(run, limit) {
  let retained = 0
  let imageSeen = false
  const rows = run.calls.map((call, n) => {
    // The first request that carries an image misses the message cache by the provider's rule.
    const firstImage = !imageSeen && call.imgs > 0
    if (firstImage) imageSeen = true
    const before = retained + call.imgs
    const removed = before > limit ? before - 3 : 0
    retained = removed > 0 ? 3 : before
    const previous = run.calls[n - 1]
    const timesValid = previous !== undefined && previous.e !== null && call.e !== null
      && previous.e <= previous.c && previous.c <= call.e && call.e <= call.c
    const warmth = !timesValid ? 'uncertain'
      : call.c - previous.e <= 240_000 ? 'warm'
      : call.e - previous.c > 300_000 ? 'expired' : 'uncertain'
    const previousPrompt = previous ? previous.i + previous.r + previous.w : null
    return {
      call: n + 1, retained, removed, warmth, firstImage,
      read: call.r, write: call.w,
      reusesPrevious: previousPrompt !== null && call.r >= 0.95 * previousPrompt,
      gapMs: previous && call.c >= previous.c ? call.c - previous.c : null,
      callBoundMs: call.e !== null && call.e <= call.c ? call.c - call.e : null,
    }
  })
  const judged = rows.filter((row) => row.call > 1 && !row.firstImage && row.warmth === 'warm' && row.removed === 0)
  const reuseFraction = judged.length === 0 ? null : judged.filter((row) => row.reusesPrevious).length / judged.length
  const medianWrite = upperMedian(judged.map((row) => row.write))
  const mechanism = judged.length < 10 ? 'insufficient'
    : reuseFraction >= 0.9 && medianWrite <= 4_000 ? 'pass' : 'fail'
  return {
    ordinal: run.ordinal, outcome: run.outcome, rows,
    calls: run.calls.length,
    usd: run.calls.reduce((sum, call) => sum + call.usd, 0),
    judgedCalls: judged.length, reuseFraction, medianWrite, mechanism,
    crossedLimit: rows.some((row) => row.removed > 0),
    medianTurnMs: upperMedian(rows.flatMap((row) => row.gapMs !== null && row.gapMs <= 300_000 ? [row.gapMs] : [])),
    medianCallBoundMs: upperMedian(rows.flatMap((row) => row.callBoundMs === null ? [] : [row.callBoundMs])),
  }
}

// --- The measure is checked before it is used. These fixtures are numbers made up for the check. ---
{
  const call = (e, c, more = {}) => ({ e, c, i: 1, o: 10, r: 0, w: 1000, usd: 0.0026, imgs: 0, discarded: false, ...more })
  const second = (a, b) => evaluateRun({ ordinal: 1, outcome: 'done', calls: [a, b] }, 13).rows[1]
  // Bounds on the time between two request starts: at most C(n+1) - E(n), at least E(n+1) - C(n).
  assert.equal(second(call(0, 1_000), call(2_000, 240_000)).warmth, 'warm')
  assert.equal(second(call(0, 1_000), call(2_000, 240_001)).warmth, 'uncertain')
  assert.equal(second(call(0, 1_000), call(301_000, 400_000)).warmth, 'uncertain')
  assert.equal(second(call(0, 1_000), call(301_001, 400_000)).warmth, 'expired')
  // SDK retries delayed the first answer: the cost events are one second apart, the starts may not be.
  assert.equal(second(call(0, 250_000), call(250_500, 251_000)).warmth, 'uncertain')
  // After a discarded answer the event before the next call is that answer's own cost event.
  assert.equal(second(call(0, 1_000, { discarded: true }), call(1_000, 3_000)).warmth, 'warm')
  assert.equal(second(call(0, 1_000), call(null, 3_000)).warmth, 'uncertain')
  assert.equal(second(call(0, 1_000), call(5_000, 3_000)).warmth, 'uncertain')
  assert.equal(second(call(2_000, 1_000), call(3_000, 4_000)).warmth, 'uncertain')

  const kept = (images, limit = 13) => evaluateRun({ ordinal: 1, outcome: 'done', calls: images.map((imgs, n) => call(n * 1_000, n * 1_000 + 500, { imgs })) }, limit).rows.map((row) => [row.retained, row.removed])
  assert.deepEqual(kept([0, 13]).at(-1), [13, 0])
  assert.deepEqual(kept([0, 13, 1]).at(-1), [3, 11])
  assert.deepEqual(kept([0, 13, 4]).at(-1), [3, 14])
  assert.deepEqual(kept([0, 13, 0]).at(-1), [13, 0])
  assert.deepEqual(kept([0, 3, 1], 3).at(-1), [3, 1])

  // A run of `count` warm calls one second apart. Call 3 is the first with an image and misses the
  // cache, as the provider's rule says it must; `missAt` names later calls that miss too.
  const run = (count, missAt = []) => {
    const calls = []
    let prompt = 10_000
    for (let n = 0; n < count; n++) {
      const miss = n === 2 || missAt.includes(n + 1)
      const r = n === 0 ? 0 : miss ? 5_000 : prompt
      const w = n === 0 ? prompt : miss ? prompt - 5_000 + 1_000 : 1_000
      calls.push(call(n * 1_000, n * 1_000 + 500, { imgs: n >= 2 ? 1 : 0, r, w }))
      prompt = 1 + r + w
    }
    return evaluateRun({ ordinal: 1, outcome: 'done', calls }, 99)
  }
  const nine = run(11)
  assert.equal(nine.rows[2].firstImage, true)
  assert.equal(nine.rows[2].reusesPrevious, false)
  assert.equal(nine.rows[3].firstImage, false)
  assert.equal(nine.judgedCalls, 9)
  assert.equal(nine.mechanism, 'insufficient')
  const ten = run(12, [7])
  assert.equal(ten.judgedCalls, 10)
  assert.equal(ten.reuseFraction, 0.9)
  assert.equal(ten.mechanism, 'pass')
  assert.equal(run(12, [7, 9]).mechanism, 'fail')
}

// --- The snapshot ---
// With no argument the candidate snapshot is read; a file name beside this script reads another one.
const snapshot = JSON.parse(readFileSync(new URL(`./${process.argv[2] ?? 'usage.json'}`, import.meta.url), 'utf8'))
const finite = (value, what) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${what} is missing or not a number at or above zero: an evidence error, never a zero`)
}
for (const run of snapshot.runs) {
  for (const [n, call] of run.calls.entries()) {
    for (const field of ['c', 'i', 'o', 'r', 'w', 'usd', 'imgs']) finite(call[field], `run ${run.ordinal} call ${n + 1} ${field}`)
    // The rates above are Sonnet 5's. A run on another model must not be compared with this baseline.
    const expected = (call.i * RATES.i + call.o * RATES.o + call.r * RATES.r + call.w * RATES.w) / 1_000_000
    if (Math.abs(expected - call.usd) > 1e-9) throw new Error(`run ${run.ordinal} call ${n + 1}: the recorded cost does not match the Sonnet 5 rates; check the model of the candidate runs`)
  }
}

const evaluated = snapshot.runs.map((run) => evaluateRun(run, snapshot.limit))
const allCalls = snapshot.runs.flatMap((run) => run.calls)
const usd = allCalls.reduce((sum, call) => sum + call.usd, 0)
const writeUsd = allCalls.reduce((sum, call) => sum + call.w, 0) * RATES.w / 1_000_000
const rows = evaluated.flatMap((run) => run.rows)
const later = rows.filter((row) => row.call > 1 && !row.firstImage)
const afterRemoval = later.filter((row) => row.warmth === 'warm' && row.removed > 0)
const round = (value, digits) => value === null ? null : Number(value.toFixed(digits))

console.log(JSON.stringify({
  codeCommit: snapshot.codeCommit,
  ...(snapshot.revisionNote === undefined ? {} : { revisionNote: snapshot.revisionNote }),
  imageLimit: snapshot.limit,
  runs: snapshot.runs.length,
  calls: allCalls.length,
  recordedUsd: round(usd, 6),
  usdPerCall: allCalls.length === 0 ? null : round(usd / allCalls.length, 4),
  cacheWriteShare: usd === 0 ? null : round(writeUsd / usd, 3),
  note: 'Recorded cost leaves out any provider charge for an attempt that returned no usage. Two rehearsals are a bounded check, not a general saving.',
  baseline: BASELINE,
  callClasses: {
    firstCallOfARun: rows.filter((row) => row.call === 1).length,
    firstImageOfARun: rows.filter((row) => row.call > 1 && row.firstImage).length,
    warmWithoutRemoval: later.filter((row) => row.warmth === 'warm' && row.removed === 0).length,
    warmAfterRemoval: afterRemoval.length,
    expired: later.filter((row) => row.warmth === 'expired').length,
    uncertain: later.filter((row) => row.warmth === 'uncertain').length,
  },
  afterRemoval: {
    calls: afterRemoval.length,
    medianWrite: upperMedian(afterRemoval.map((row) => row.write)),
    averageWrite: afterRemoval.length === 0 ? null : Math.round(afterRemoval.reduce((sum, row) => sum + row.write, 0) / afterRemoval.length),
  },
  perRun: evaluated.map((run) => {
    const first = run.rows.find((row) => row.firstImage)
    return {
      ordinal: run.ordinal, codeCommit: snapshot.runs.find((r) => r.ordinal === run.ordinal)?.codeCommit ?? null, outcome: run.outcome, calls: run.calls, usd: round(run.usd, 4),
      judgedCalls: run.judgedCalls, reuseFraction: round(run.reuseFraction, 3), medianWrite: run.medianWrite, mechanism: run.mechanism,
      crossedLimit: run.crossedLimit, removals: run.rows.filter((row) => row.removed > 0).length,
      mostImagesInARequest: Math.max(0, ...run.rows.map((row) => row.retained)),
      medianTurnMs: run.medianTurnMs, pace: run.medianTurnMs === null ? null : run.medianTurnMs <= BASELINE.turnLimitMs ? 'within the limit' : 'above the limit: inconclusive',
      medianCallBoundMs: run.medianCallBoundMs,
      firstImage: first === undefined ? null : { call: first.call, warmth: first.warmth, read: first.read, write: first.write, reusedThePreviousPrompt: first.reusesPrevious },
    }
  }),
}, null, 2))
