// Connector proposals: which websites cost the most computer work, measured from the run logs.
//
//   node docs/evidence/2026-09-24-connector-proposals/propose.mjs [data/bots] [--min-runs 3]
//
// Every model call that asked for a computer action is counted toward the website the run opened
// last with open_url. The result is a ranking for people to read: whether a connector is possible
// (a public API, an MCP server) and whether it would save anything is a person's judgement.
// Limits: a click that leads to another site, without open_url, still counts toward the site
// before it; a model call that asked for a computer action and a platform tool at once counts in
// full; sandbox time is not counted.

import fs from 'node:fs'
import path from 'node:path'

// The computer actions of the toolset, as src/server/agent/actions.ts names them.
const COMPUTER_ACTIONS = new Set([
  'screenshot', 'zoom', 'left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'left_click_drag',
  'mouse_move', 'left_mouse_down', 'left_mouse_up', 'cursor_position', 'scroll', 'type', 'key', 'hold_key', 'wait',
])
const NO_PAGE = '(before any open_url)'

const args = process.argv.slice(2)
const minIndex = args.indexOf('--min-runs')
const minRuns = minIndex === -1 ? 3 : Number(args[minIndex + 1])
const dataDir = args.find((a, i) => !a.startsWith('--') && (minIndex === -1 || i !== minIndex + 1)) ?? 'data/bots'

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Reads one run's events; a line that does not parse is skipped, so one damaged run cannot stop the report. */
function eventsOf(file) {
  const events = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // skipped
    }
  }
  return events
}

const sites = new Map()
let runCount = 0
// Cost events written before the log named each call's tools cannot be split; those runs are counted apart.
let unsplitRuns = 0
let unsplitUsd = 0
let totalUsd = 0
let computerUsd = 0

for (const bot of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
  const runsDir = path.join(dataDir, bot, 'runs')
  if (!fs.existsSync(runsDir)) continue
  for (const run of fs.readdirSync(runsDir)) {
    const file = path.join(runsDir, run, 'events.jsonl')
    if (!fs.existsSync(file)) continue
    runCount += 1
    let host = NO_PAGE
    const events = eventsOf(file)
    const costs = events.filter((e) => e.type === 'cost')
    if (costs.length > 0 && costs.every((e) => e.response === undefined)) {
      unsplitRuns += 1
      unsplitUsd += costs.reduce((sum, e) => sum + e.usd, 0)
    }
    for (const e of events) {
      if (e.type === 'tool_call' && e.name === 'open_url') host = hostOf(e.input?.url) ?? host
      const site = sites.get(host) ?? { steps: 0, usd: 0, runs: new Set() }
      sites.set(host, site)
      if (e.type === 'step') {
        site.steps += 1
        site.runs.add(`${bot}/${run}`)
      }
      if (e.type === 'cost') {
        totalUsd += e.usd
        if ((e.response?.toolNames ?? []).some((name) => COMPUTER_ACTIONS.has(name))) {
          site.usd += e.usd
          computerUsd += e.usd
        }
      }
    }
  }
}

const rows = [...sites.entries()]
  .filter(([, s]) => s.steps > 0)
  .map(([host, s]) => ({ host, runs: s.runs.size, steps: s.steps, usd: s.usd, perRun: s.usd / s.runs.size }))
const ranked = rows.filter((r) => r.runs >= minRuns && r.host !== NO_PAGE).sort((a, b) => b.perRun - a.perRun)
const rest = rows.filter((r) => !ranked.includes(r)).sort((a, b) => b.usd - a.usd)

const table = (list) =>
  ['| Website | Runs | Computer steps | Model cost of its computer steps | Per run |', '| --- | ---: | ---: | ---: | ---: |']
    .concat(list.map((r) => `| ${r.host} | ${r.runs} | ${r.steps} | $${r.usd.toFixed(2)} | $${r.perRun.toFixed(2)} |`))
    .join('\n')

console.log(`Runs read: ${runCount} from ${dataDir}. Model cost: $${totalUsd.toFixed(2)}, of which $${computerUsd.toFixed(2)} (${((100 * computerUsd) / (totalUsd || 1)).toFixed(0)}%) in calls that asked for a computer action.`)
console.log(`Not split: ${unsplitRuns} older runs ($${unsplitUsd.toFixed(2)}) whose cost events do not name their tools; their computer steps are counted, their cost is not.\n`)
console.log(`Ranked by cost per run (websites with at least ${minRuns} runs):\n`)
console.log(table(ranked))
console.log(`\nThe rest, by total cost:\n`)
console.log(table(rest))
