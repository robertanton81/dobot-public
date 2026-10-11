import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnthropicModel } from '../../../src/server/agent/model.ts'
import { Runner } from '../../../src/server/agent/runner.ts'
import { RunQueue } from '../../../src/server/agent/queue.ts'
import { Approvals } from '../../../src/server/agent/gate.ts'
import { FakeSandbox, ELEMENT_TEXT_INPUT, message, textBlock, toolUse, computerUse } from '../../../src/server/agent/fakes.ts'
import { basePlatformTools } from '../../../src/server/agent/tools.ts'
import { createStore } from '../../../src/server/store/index.ts'
import { BotEvents } from '../../../src/server/http/sse.ts'
import { SandboxManager } from '../../../src/server/sandbox/manager.ts'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
async function until(fn: () => boolean, why: string, ms = 2000) {
  const started = performance.now()
  while (!fn()) { assert.ok(performance.now() - started < ms, why); await sleep(2) }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
const event = (res: ServerResponse, data: any) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
function start(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  event(res, { type: 'message_start', message: { ...message([]), stop_reason: null } })
}
function block(res: ServerResponse, value: any, index = 0) {
  if (value.type === 'tool_use') {
    event(res, { type: 'content_block_start', index, content_block: { ...value, input: {} } })
    event(res, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(value.input) } })
  } else event(res, { type: 'content_block_start', index, content_block: value })
  event(res, { type: 'content_block_stop', index })
}
function finish(res: ServerResponse, reason = 'end_turn') {
  event(res, { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null, stop_details: null }, usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 7 } } })
  event(res, { type: 'message_stop' }); res.end()
}
type Handler = (res: ServerResponse, request: any) => void | Promise<void>
const answer = (blocks = [textBlock('done')], reason = 'end_turn'): Handler => res => { start(res); blocks.forEach((b, i) => block(res, b, i)); finish(res, reason) }
const cutTool: Handler = res => {
  start(res)
  event(res, { type: 'content_block_start', index: 0, content_block: toolUse('remember', {}) })
  event(res, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"note":"partial' } })
  event(res, { type: 'content_block_stop', index: 0 }); finish(res, 'max_tokens')
}
const hang: Handler = res => { start(res); const timer = setInterval(() => event(res, { type: 'ping' }), 20); res.on('close', () => clearInterval(timer)) }
const httpError = (status: number): Handler => res => { res.writeHead(status, { 'content-type': 'application/json', 'retry-after-ms': '1' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'synthetic test failure' } })) }
let handlers: Handler[] = [], requests: any[] = [], latch = deferred(), open = new Set<ServerResponse>()
const server = createServer(async (req, res) => {
  open.add(res); res.on('close', () => open.delete(res))
  let body = ''; for await (const chunk of req) body += chunk
  const request = JSON.parse(body); const index = requests.length; requests.push(request)
  assert.equal(request.stream, true)
  if (index === 0) await latch.promise
  if (res.destroyed) return
  const handler = handlers[index]
  assert.ok(handler, `unexpected request ${index}`)
  await handler(res, request)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address(); assert.ok(address && typeof address !== 'string')
process.env.ANTHROPIC_API_KEY = 'local-review-placeholder'
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`
const evidence: any[] = []
const goal = { goal: 'Review lifecycle', activeSkill: null, source: 'message' as const }
async function rig() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dobot-lifecycle-'))
  const store = createStore(dataDir); const botId = (await store.createBot({ name: 'Review', persona: 'Tests.' })).id
  const events = new BotEvents(), queue = new RunQueue(), approvals = new Approvals(), sandbox = new FakeSandbox()
  const session = { sandbox, sandboxId: 'local-fake', streamViewUrl: 'https://example.com/view', streamInteractiveUrl: 'https://example.com/full', keepAlive: async () => undefined, pause: async () => 'paused' as const, syncWorkspace: async () => undefined }
  const grace = new Set<unknown>(), alive = new Set<unknown>()
  const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, 'Europe/Prague', {
    factory: { create: async () => session, connect: async () => session },
    setTimer: () => { const handle = {}; grace.add(handle); return handle }, clearTimer: h => { grace.delete(h) },
  })
  const runner = new Runner({ store, events, queue, approvals, sandboxes, model: new AnthropicModel({ stallTimeoutMs: 120 }), modelId: 'claude-sonnet-5', tools: basePlatformTools, dailyBudgetUsd: 25, timezone: 'Europe/Prague', blockedHoldMs: 30 * 60_000,
    setKeepAlive: () => { const handle = {}; alive.add(handle); return handle }, clearKeepAlive: h => { alive.delete(h) },
  })
  return { store, botId, events, queue, approvals, sandbox, grace, alive, runner, dataDir }
}
type Rig = Awaited<ReturnType<typeof rig>>
async function clean(r: Rig, ids: string[]) {
  assert.equal(r.runner.isBusy(r.botId), false)
  assert.equal(r.runner.activeRunId(r.botId), null)
  assert.equal(r.queue.size(r.botId), 0)
  assert.equal(r.runner.isWaitingForUser(r.botId), false)
  assert.equal(r.alive.size, 0)
  assert.equal(r.grace.size, 1)
  assert.equal((await r.store.readBot(r.botId)).state, 'idle')
  assert.deepEqual(await r.store.listOpenRuns(r.botId), [])
  for (const id of ids) {
    assert.equal((await r.store.readRunEvents(r.botId, id)).filter(e => e.type === 'end').length, 1)
    assert.deepEqual(r.approvals.pendingFor(id), [])
  }
  await until(() => open.size === 0, 'HTTP response connection did not close')
}
async function scenario(name: string, firstHandlers: Handler[], expected: string, options: {
  onStart?: (r: Rig, first: any) => void | Promise<void>,
  observe?: (r: Rig) => void,
  check?: (r: Rig, first: any) => Promise<void>,
} = {}) {
  requests = []; latch = deferred(); handlers = [...firstHandlers, answer()]
  const r = await rig(); options.observe?.(r)
  const first = await r.runner.accept(r.botId, goal)
  await until(() => requests.length === 1, `${name}: no model request`)
  const second = await r.runner.accept(r.botId, { ...goal, goal: 'Next task' })
  assert.equal(r.queue.size(r.botId), 2)
  latch.resolve(); await options.onStart?.(r, first)
  const outcome = await first.done
  assert.equal(outcome?.outcome, expected, name)
  assert.equal((await second.done)?.outcome, 'done', `${name}: queued task failed`)
  await options.check?.(r, first)
  await clean(r, [first.runId, second.runId])
  const row = { name, outcome: outcome?.outcome, requests: requests.length, queueReleased: true, sandboxReleased: true, dataDir: r.dataDir }
  evidence.push(row); console.log(JSON.stringify(row))
}
try {
  await scenario('normal completion', [answer()], 'done')
  await scenario('signed thinking and tool result continue intact', [answer([{ type: 'thinking', thinking: 'Synthetic summary', signature: 'synthetic-not-a-secret' }, toolUse('remember', { note: 'Saved evidence.' })], 'tool_use'), answer()], 'done', {
    check: async r => { const assistant = requests[1].messages.find((m: any) => m.role === 'assistant'); assert.deepEqual(assistant.content[0], { type: 'thinking', thinking: 'Synthetic summary', signature: 'synthetic-not-a-secret' }); assert.match(await r.store.readMemory(r.botId), /Saved evidence/); },
  })
  await scenario('ping-only stall', [hang], 'failed')
  await scenario('successful headers with no SSE body', [res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders() }], 'failed')
  await scenario('empty successful body', [res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end() }], 'failed')
  await scenario('connection ends before message_stop', [res => { start(res); block(res, toolUse('remember', { note: 'MUST NOT RUN' })); res.end() }], 'failed', { check: async r => assert.equal(await r.store.readMemory(r.botId), '') })
  await scenario('error event after tool block', [res => { start(res); block(res, toolUse('remember', { note: 'MUST NOT RUN' })); event(res, { type: 'error', error: { type: 'overloaded_error', message: 'synthetic error' } }); res.end() }], 'failed', { check: async r => assert.equal(await r.store.readMemory(r.botId), '') })
  await scenario('HTTP 400', [httpError(400)], 'failed')
  await scenario('HTTP 529 retries then succeeds', [httpError(529), answer()], 'done')
  await scenario('HTTP 529 exhausts both retries', [httpError(529), httpError(529), httpError(529)], 'failed')
  await scenario('truncated tool retries with higher cap', [cutTool, answer()], 'done', { check: async r => { assert.deepEqual(requests.slice(0, 2).map(q => q.max_tokens), [16000, 32000]); assert.equal(await r.store.readMemory(r.botId), '') } })
  await scenario('tool truncated twice fails without execution', [cutTool, cutTool], 'failed', { check: async r => assert.equal(await r.store.readMemory(r.botId), '') })
  await scenario('text truncation continues but chat omits the first part', [answer([textBlock('Partial answer')], 'max_tokens'), answer()], 'done', { check: async r => {
    assert.equal(requests[1].messages.at(-1).content[0].text, 'continue')
    assert.ok(requests[1].messages.some((m: any) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'text' && b.text === 'Partial answer')))
    assert.equal((await r.store.readChat(r.botId, { limit: 30 })).some(m => m.text?.includes('Partial answer')), false)
    evidence.push({ name: 'BUG: completed text continuation omits earlier answer from chat', firstPartPresentInModelContext: true, firstPartPresentInChat: false, dataDir: r.dataDir })
  } })
  await scenario('pause_turn continues', [answer([textBlock('Working')], 'pause_turn'), answer()], 'done')
  await scenario('refusal ends failed', [answer([textBlock('Cannot')], 'refusal')], 'failed')
  await scenario('context limit ends failed', [answer([textBlock('Cannot')], 'model_context_window_exceeded')], 'failed')
  await scenario('Stop before headers', [() => undefined], 'cancelled', { onStart: async r => { await sleep(15); assert.equal(r.runner.cancel(r.botId), true) } })
  await scenario('Stop during ping-only stream', [hang], 'cancelled', { onStart: async r => { await sleep(25); assert.equal(r.runner.cancel(r.botId), true) } })
  await scenario('Stop during retry delay holds queue until SDK wakes', [res => { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' }); res.end('{"error":{"type":"rate_limit_error","message":"Synthetic limit"}}') }], 'cancelled', {
    onStart: async (r, first) => {
      await until(() => open.size === 0, '429 did not close')
      await sleep(20)
      let settled = false; void first.done.then(() => { settled = true })
      assert.equal(r.runner.cancel(r.botId), true)
      const stopped = performance.now()
      await sleep(150)
      assert.equal(settled, false); assert.equal(r.queue.size(r.botId), 2); assert.equal(r.alive.size, 1)
      await first.done
      const delayAfterStopMs = Math.round(performance.now() - stopped)
      assert.ok(delayAfterStopMs > 1500)
      evidence.push({ name: 'BUG: retry sleep delays Stop and queue release', delayAfterStopMs, dataDir: r.dataDir })
    },
  })
  await scenario('unfinished HTTP error body holds queue beyond stream stall timeout', [res => {
    res.writeHead(400, { 'content-type': 'application/json' }); res.write('{"error":')
    const timer = setInterval(() => res.write(' '), 20); res.on('close', () => clearInterval(timer))
  }], 'cancelled', {
    onStart: async (r, first) => {
      let settled = false; void first.done.then(() => { settled = true })
      await sleep(350)
      assert.equal(settled, false); assert.equal(r.queue.size(r.botId), 2); assert.equal(r.alive.size, 1)
      evidence.push({ name: 'BUG: unfinished HTTP error body bypasses stall timer', sampleMs: 350, stallMs: 120, queueBlocked: true, dataDir: r.dataDir })
      assert.equal(r.runner.cancel(r.botId), true)
    },
  })
  {
    const lines: string[] = [], originalWrite = process.stderr.write
    process.stderr.write = function(chunk: any, ...args: any[]) { lines.push(String(chunk)); const callback = args.find(a => typeof a === 'function'); callback?.(); return true } as typeof process.stderr.write
    try {
      await scenario('malformed stream fails but raw payload is logged', [res => {
        start(res); res.end('event: content_block_delta\ndata: {"signature":"SYNTHETIC_OPAQUE_MARKER",\n\n')
      }], 'failed')
      const rawWrites = lines.filter(line => line.includes('SYNTHETIC_OPAQUE_MARKER')).length
      assert.ok(rawWrites >= 2)
      evidence.push({ name: 'BUG: malformed model payload reaches stderr', rawWrites, applicationLogAlsoContainsMarker: lines.some(line => line.includes('"msg":"run failed"') && line.includes('SYNTHETIC_OPAQUE_MARKER')) })
    } finally { process.stderr.write = originalWrite }
  }
  await scenario('Stop after model response before platform tool', [answer([toolUse('remember', { note: 'MUST NOT RUN' })], 'tool_use')], 'cancelled', {
    observe: r => { let once = false; r.events.subscribe(r.botId, e => { if (!once && e.event === 'run' && e.data.type === 'cost') { once = true; r.runner.cancel(r.botId) } }) },
    check: async r => assert.equal(await r.store.readMemory(r.botId), ''),
  })
  await scenario('Stop after final response is accepted but outcome is done', [answer()], 'done', {
    observe: r => { let once = false; r.events.subscribe(r.botId, e => { if (!once && e.event === 'run' && e.data.type === 'cost') { once = true; assert.equal(r.runner.cancel(r.botId), true) } }) },
  })
  for (const kind of ['approval', 'question', 'takeover'] as const) {
    const response = kind === 'approval' ? computerUse('left_click', { coordinate: [5, 5] }) : kind === 'question' ? toolUse('ask_user', { question: 'Synthetic question?' }) : toolUse('request_takeover', { reason: 'Synthetic takeover.' })
    await scenario(`Stop before ${kind} wait registration is lost`, [answer([response], 'tool_use')], 'cancelled', {
      observe: r => {
        r.sandbox.companion.elements = [{ ...ELEMENT_TEXT_INPUT, tag: 'button', name: 'Send', isSubmit: true }]
        let once = false
        r.events.subscribe(r.botId, e => {
          const trigger = kind === 'approval' ? e.event === 'run' && e.data.type === 'gate' && e.data.decision === 'block'
            : kind === 'question' ? e.event === 'chat' && e.data.text === 'Synthetic question?'
            : e.event === 'run' && e.data.type === 'takeover' && e.data.status === 'started'
          if (trigger && !once) { once = true; assert.equal(r.runner.cancel(r.botId), true) }
        })
      },
      onStart: async (r, first) => {
        let settled = false; void first.done.then(() => { settled = true })
        await sleep(150)
        assert.equal(settled, false, `${kind}: expected the cancellation gap`)
        assert.equal(r.queue.size(r.botId), 2)
        assert.equal(r.alive.size, 1)
        if (kind === 'approval') assert.equal(r.approvals.pendingFor(first.runId).length, 1)
        if (kind === 'question') assert.equal(r.runner.isWaitingForUser(r.botId), true)
        evidence.push({ name: `BUG: Stop lost before ${kind} waiter`, queueBlocked: true, keepAliveHeld: true, recovery: 'second Stop', dataDir: r.dataDir })
        assert.equal(r.runner.cancel(r.botId), true)
      },
      check: async r => { if (kind === 'approval') assert.equal(r.sandbox.methods().includes('leftClick'), false) },
    })
  }
  console.log(JSON.stringify({ completedScenarios: evidence.filter(e => e.queueReleased).length, reproducedWaitRaces: 3 }))
} finally {
  await writeFile('/tmp/dobot-run-lifecycle-results.json', JSON.stringify(evidence, null, 2))
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
