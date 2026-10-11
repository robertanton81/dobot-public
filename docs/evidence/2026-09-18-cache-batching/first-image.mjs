// Added on 19 September 2026 for revision 4 of the design spec. It reads usage.json and changes
// nothing: the snapshot and results.json stay as they were frozen.
//
// Question: does the first request of a run that carries an image reuse the message cache?
// The API drops the message cache when a prompt goes from no image to some image, so it should
// not, whatever rule removes old screenshots.
//
// Run from the repository root: node docs/evidence/2026-09-18-cache-batching/first-image.mjs
import { readFileSync } from 'node:fs'

const usage = JSON.parse(readFileSync(new URL('./usage.json', import.meta.url), 'utf8'))

let runsWithAnImage = 0
let warm = 0
let missed = 0
/** Which call of the run was the first with an image, and in how many runs. */
const firstImageCall = {}
/** How many images the context held when that request was sent. */
const imagesInThatRequest = {}

for (const run of usage.runs) {
  const k = run.calls.findIndex((call) => call.imgs > 0)
  if (k === -1) continue
  runsWithAnImage += 1
  firstImageCall[k + 1] = (firstImageCall[k + 1] ?? 0) + 1
  const call = run.calls[k]
  imagesInThatRequest[call.imgs] = (imagesInThatRequest[call.imgs] ?? 0) + 1
  const previous = run.calls[k - 1]
  if (previous === undefined) continue
  // Cost-event times are the only clock in this snapshot (see the README on that limit). Four
  // minutes between two cost events keeps a margin under the five-minute cache lifetime.
  if (call.t - previous.t > 240_000) continue
  warm += 1
  // The measure of spec criterion 7: a cache read of at least 95% of the previous whole prompt.
  if (call.r < 0.95 * (previous.i + previous.r + previous.w)) missed += 1
}

// What that one miss does to the 90% measure of criterion 7, run by run, under the three-image
// rule these runs used. A call is judged when it is warm and no image removal came just before it.
// The snapshot has no run-event times, so the last event before call n is replaced by its earliest
// possible time, the cost event of call n-1. The widest interval between the request starts of
// calls n-1 and n is then t(n) - t(n-2), and the second call of a run cannot be judged here.
function reuseByRun(judgeFirstImage) {
  const fractions = []
  for (const run of usage.runs) {
    let retained = 0
    let imageSeen = false
    let judged = 0
    let reused = 0
    run.calls.forEach((call, n) => {
      const firstImage = !imageSeen && call.imgs > 0
      if (firstImage) imageSeen = true
      const before = retained + call.imgs
      const removed = before > 3
      retained = removed ? 3 : before
      if (n < 2 || removed || (firstImage && !judgeFirstImage)) return
      if (call.t - run.calls[n - 2].t > 240_000) return
      judged += 1
      const previous = run.calls[n - 1]
      if (call.r >= 0.95 * (previous.i + previous.r + previous.w)) reused += 1
    })
    if (judged >= 10) fractions.push(reused / judged)
  }
  return {
    runsWithTenJudgedCalls: fractions.length,
    atExactly90Percent: fractions.filter((f) => f === 0.9).length,
    under95Percent: fractions.filter((f) => f < 0.95).length,
    under90Percent: fractions.filter((f) => f < 0.9).length,
    lowest: fractions.length === 0 ? null : Math.min(...fractions),
  }
}

console.log(JSON.stringify({
  runs: usage.runs.length, runsWithAnImage, warm, missed, firstImageCall, imagesInThatRequest,
  reuseWithTheFirstImageJudged: reuseByRun(true),
  reuseWithTheFirstImageLeftOut: reuseByRun(false),
}, null, 2))
