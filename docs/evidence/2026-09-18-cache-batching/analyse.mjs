// Offline arithmetic over a numeric snapshot. No API calls or conversation content.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const snapshot = JSON.parse(readFileSync(new URL('./usage.json', import.meta.url), 'utf8'))
const runs = snapshot.runs
const price = (i, o, r, w) => (i * 2 + o * 10 + r * 0.2 + w * 2.5) / 1e6
const round = (n) => Math.round(n * 1e6) / 1e6
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0)
const calls = runs.flatMap((run) => run.calls)
for (const call of calls) {
  for (const value of Object.values(call)) assert(Number.isFinite(value) && value >= 0)
  assert(Math.abs(call.usd - price(call.i, call.o, call.r, call.w)) < 1e-9)
}
const actual = sum(calls, (c) => c.usd)
const noSteps = runs.filter((run) => run.computerSteps === 0)
const noScreen = noSteps.filter((run) => run.screenToolCalls === 0)
const costOf = (selected) => sum(selected, (run) => sum(run.calls, (c) => c.usd))

// Same counterfactual as the supplied data/cost-profile/prune-replay.mjs.
// The recorded actions, output tokens and call times stay fixed. This is not an API replay.
function simulate(extraImages, imageTokens = 1306) {
  const stubTokens = 15
  const retainedTarget = 3
  let usd = 0, maxPromptTokens = 0, batchPrunes = 0
  for (const { calls } of runs) {
    const base = Math.min(...calls.map((c) => c.r).filter((r) => r > 0), Infinity)
    let totalImages = 0, removed = 0, previousPrompt = 0
    calls.forEach((c, n) => {
      totalImages += c.imgs
      const actualRemoved = Math.max(0, totalImages - retainedTarget)
      const unpruned = c.i + c.r + c.w + actualRemoved * (imageTokens - stubTokens)
      let edited = false
      if (totalImages - removed > retainedTarget + extraImages) {
        removed = totalImages - retainedTarget
        edited = true
      }
      const prompt = unpruned - removed * (imageTokens - stubTokens)
      const cold = n === 0 || c.r === 0 || c.t - calls[n - 1].t > 300_000
      let read, write
      if (cold) {
        read = Math.min(c.r, prompt)
        write = prompt - c.i - read
      } else if (edited && Number.isFinite(base)) {
        read = Math.min(base, prompt)
        write = prompt - c.i - read
        batchPrunes++
      } else {
        read = Math.min(previousPrompt, prompt - c.i)
        write = prompt - c.i - read
      }
      usd += price(c.i, c.o, Math.max(0, read), Math.max(0, write))
      maxPromptTokens = Math.max(maxPromptTokens, prompt)
      previousPrompt = prompt
    })
  }
  return { usd: round(usd), maxPromptTokens, batchPrunes }
}

// What the recorded usage itself shows, with no replay: on warm calls (not the first call of a run,
// and at most five minutes after the previous cost event), compare the calls that followed an image
// removal under the three-image rule with the calls that did not. A removal is predicted from image
// counts, as in simulate(). The same pass collects the time between cost events, which is the model
// call plus the actions before it, as a latency baseline for the live check.
function recorded() {
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  const after = { calls: 0, readOnlyBase: 0, writeTokens: 0 }
  const without = { calls: 0, readBeyondBase: 0, writeTokens: 0 }
  const longRunMedians = []
  for (const { calls } of runs) {
    const base = Math.min(...calls.map((c) => c.r).filter((r) => r > 0), Infinity)
    const gaps = []
    let totalImages = 0
    calls.forEach((c, n) => {
      totalImages += c.imgs
      if (n === 0 || c.t - calls[n - 1].t > 300_000) return
      gaps.push(c.t - calls[n - 1].t)
      if (totalImages > 3 && c.imgs > 0) {
        after.calls++
        after.writeTokens += c.w
        if (c.r <= base * 1.05) after.readOnlyBase++
      } else {
        without.calls++
        without.writeTokens += c.w
        if (c.r > base * 1.05) without.readBeyondBase++
      }
    })
    if (totalImages >= 14 && gaps.length > 0) longRunMedians.push(median(gaps))
  }
  return {
    warmCallsAfterRemoval: { calls: after.calls, readOnlyBasePrefix: after.readOnlyBase, averageWriteTokens: Math.round(after.writeTokens / after.calls) },
    warmCallsWithoutRemoval: { calls: without.calls, readBeyondBasePrefix: without.readBeyondBase, averageWriteTokens: Math.round(without.writeTokens / without.calls) },
    msBetweenCostEventsInRunsWith14OrMoreImages: {
      runs: longRunMedians.length,
      smallestRunMedian: Math.min(...longRunMedians),
      medianOfRunMedians: median(longRunMedians),
      largestRunMedian: Math.max(...longRunMedians),
    },
  }
}

const baseline = simulate(0)
const batching = simulate(10)
console.log(JSON.stringify({
  sourceCommit: snapshot.sourceCommit,
  runs: runs.length,
  calls: calls.length,
  actualUsd: round(actual),
  averageRunUsd: round(actual / runs.length),
  costBreakdownUsd: {
    input: round(sum(calls, (c) => c.i * 2 / 1e6)),
    output: round(sum(calls, (c) => c.o * 10 / 1e6)),
    cacheRead: round(sum(calls, (c) => c.r * 0.2 / 1e6)),
    cacheWrite: round(sum(calls, (c) => c.w * 2.5 / 1e6)),
  },
  wholeRunRouting: {
    noComputerSteps: { runs: noSteps.length, usd: round(costOf(noSteps)) },
    alsoExcludingScreenTools: { runs: noScreen.length, usd: round(costOf(noScreen)) },
    grossSavingPercent: round(costOf(noSteps) * 0.5 / actual * 100),
    grossSavingExcludingScreenToolsPercent: round(costOf(noScreen) * 0.5 / actual * 100),
  },
  recorded: recorded(),
  replay: {
    imageTokens: 1306,
    stubTokens: 15,
    baseline,
    batching,
    neverPrune: simulate(Infinity),
    baselineErrorPercent: round((baseline.usd - actual) / actual * 100),
    savingVsRecordedPercent: round((actual - batching.usd) / actual * 100),
    savingVsSimulatedBaselinePercent: round((baseline.usd - batching.usd) / baseline.usd * 100),
    // The current vision formula gives 1334 visual tokens for a 1280 x 800 image.
    // This checks one assumption; it cannot predict different model decisions or zoom sizes.
    sensitivityAt1334ImageTokens: { baseline: simulate(0, 1334), batching: simulate(10, 1334) },
  },
}, null, 2))
