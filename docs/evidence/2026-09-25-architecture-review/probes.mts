import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createStore } from '../../../src/server/store/index.ts'
import { FakeModel, FakeSandbox, makeContext, message, toolUse, textBlock } from '../../../src/server/agent/fakes.ts'
import { runLoop } from '../../../src/server/agent/run.ts'
import { runConnectorTool } from '../../../src/server/agent/connector-gate.ts'
import { defineTool } from '../../../src/server/agent/tools.ts'
import { createApp } from '../../../src/server/http/app.ts'
import { BotEvents } from '../../../src/server/bot-events.ts'
import { Approvals } from '../../../src/server/agent/gate.ts'

const dataDir = await mkdtemp(join(tmpdir(), 'dobot-architecture-'))
const store = createStore(dataDir)
const botId = (await store.createBot({ name: 'Review', persona: 'Offline architecture probes' })).id
const env = { fetch: globalThis.fetch, mapyApiKey: null, mailbox: null, mailboxBotId: null }
const results = []

for (const finish of ['model-failure', 'end-turn'] as const) {
  const runId = finish
  await store.startRun(botId, runId)
  let calls = 0
  const connector = {
    name: 'write', class: 'write' as const, description: 'Synthetic uncertain write', schema: z.object({}),
    run: async () => { calls += 1; return new Promise<string>(() => {}) },
  }
  const tool = defineTool({
    name: 'review__write', description: 'Synthetic uncertain write', schema: z.object({}),
    run: (input, ctx) => runConnectorTool('review__write', connector, input as never, env, ctx, 10),
  })
  const model = new FakeModel([
    message([toolUse(tool.name, {})]),
    ...(finish === 'end-turn' ? [message([textBlock('Check the uncertain result.')], 'end_turn')] : []),
  ])
  const t = makeContext({ store, botId, runId, model, sandbox: new FakeSandbox(), tools: [tool] })
  t.decisions.push('allowed')
  const keepProcess = setInterval(() => {}, 1000)
  let result
  try {
    result = await runLoop(t.ctx, { goal: 'Exercise uncertain write handling', source: 'message', activeSkill: null })
  } finally { clearInterval(keepProcess) }
  assert.equal(calls, 1)
  assert(t.events.some(e => e.type === 'tool_result' && e.summary.includes('whether it happened is unknown')))
  assert.equal(result.outcome, finish === 'model-failure' ? 'failed' : 'done')
  assert.equal(result.final, undefined)
  results.push({ probe: finish, uncertainWriteWarningRecorded: true, outcome: result.outcome, terminalRetryFlag: result.final ?? false, externalCalls: calls })
}

await store.writeMemory(botId, 'original\n')
const originalRead = store.readMemory
let injected = false
const interleavedStore = {
  ...store,
  readMemory: async (id: string) => {
    const snapshot = await originalRead(id)
    if (!injected) {
      injected = true
      await store.appendMemory(id, 'concurrent bot note')
    }
    return snapshot
  },
}
const app = createApp({ store: interleavedStore, events: new BotEvents(), approvals: new Approvals(), runner: {} as never, sandboxes: {} as never })
const response = await app.request(`http://localhost/api/bots/${botId}/memory`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ base: 'original\n', text: 'user edit\n' }),
})
assert.equal(response.status, 200)
assert.equal(await originalRead(botId), 'user edit\n')
results.push({ probe: 'memory-check-write-interleaving', responseStatus: response.status, concurrentNoteLost: true })
console.log(JSON.stringify({ results, scope: 'Real loop, connector gate, HTTP route and file store; scripted model, synthetic connector, no external services.' }, null, 2))
