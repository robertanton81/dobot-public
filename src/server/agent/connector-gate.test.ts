import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ConnectorError, type ConnectorEnv, type ConnectorTool } from '../connectors/types'
import { log } from '../log'
import { CHAT_LIMITS, createStore, type Store } from '../store'
import { CONNECTOR_MAX_CHARS, runConnectorTool, STOPPED_CALL_TEXT } from './connector-gate'
import { CONNECTOR_PAGE, pageOf } from './gate'
import { FakeModel, FakeSandbox, makeContext } from './fakes'
import { DENIED_TEXT, runPlatformTool, ToolError } from './tools'
import { defineTool } from './tools'

const ENV: ConnectorEnv = { fetch: globalThis.fetch, mapyApiKey: null, mailbox: null, mailboxBotId: null }

/** A read and a write that count their calls; `answer` decides what each call does. */
function counting(cls: 'read' | 'write', answer: (input: { text: string }, signal: AbortSignal) => Promise<string> = async ({ text }) => `did ${text}`) {
  const calls: string[] = []
  const tool: ConnectorTool = {
    name: cls === 'read' ? 'echo' : 'note',
    class: cls,
    description: 'test',
    schema: z.object({ text: z.string() }),
    ...(cls === 'write' ? { kind: 'publish' as const, consequence: (input: { text: string }) => `publishes "${input.text}"` } : {}),
    run: (input: { text: string }, _env: ConnectorEnv, signal: AbortSignal) => {
      calls.push(input.text)
      return answer(input, signal)
    },
  }
  return { tool, calls }
}

let dataDir: string
let store: Store
let botId: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-connector-gate-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Tester', persona: 'tests' })).id
  await store.startRun(botId, 'run-1')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dataDir, { recursive: true, force: true })
})

function context() {
  return makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox() })
}

describe('the connector gate', () => {
  it('runs a read at once and posts no card', async () => {
    const t = context()
    const { tool, calls } = counting('read')
    expect(await runConnectorTool('conn__echo', tool, { text: 'a' } as never, ENV, t.ctx)).toBe('did a')
    expect(calls).toEqual(['a'])
    expect(t.chat).toHaveLength(0)
    expect(t.events.filter((e) => e.type === 'approval')).toHaveLength(0)
  })

  it('stops a write at one approval card with the tool and its arguments, and calls nothing before the decision', async () => {
    const t = context()
    const { tool, calls } = counting('write')
    let callsWhenAsked = -1
    const scripted = t.ctx.waitForApproval
    t.ctx.waitForApproval = (id) => {
      callsWhenAsked = calls.length
      return scripted(id)
    }
    t.decisions.push('allowed')
    await runConnectorTool('conn__note', tool, { text: 'hello' } as never, ENV, t.ctx)
    expect(callsWhenAsked).toBe(0)
    const cards = t.chat.filter((m) => m.card?.card === 'approval')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.card).toMatchObject({ connectorTool: 'conn__note', actionKind: 'publish', summary: 'publishes "hello"', status: 'allowed' })
    expect(cards[0]?.card?.card === 'approval' && JSON.parse(cards[0].card.connectorArgs ?? '')).toEqual({ text: 'hello' })
    expect(t.events.filter((e) => e.type === 'approval').map((e) => e.type === 'approval' && e.status)).toEqual(['pending', 'allowed'])
  })

  it('Deny returns the denied text and the write is never called', async () => {
    const t = context()
    const { tool, calls } = counting('write')
    t.decisions.push('denied')
    expect(await runConnectorTool('conn__note', tool, { text: 'x' } as never, ENV, t.ctx)).toBe(DENIED_TEXT)
    expect(calls).toEqual([])
  })

  it('Allow once runs the write once and uses the approval up, so it can cover no page control', async () => {
    const t = context()
    const { tool, calls } = counting('write')
    t.decisions.push('allowed')
    expect(await runConnectorTool('conn__note', tool, { text: 'x' } as never, ENV, t.ctx)).toBe('did x')
    expect(calls).toEqual(['x'])
    expect(t.ctx.approvals.findMatch(t.ctx.runId, t.ctx.progress.step, { name: 'conn__note', url: '' })).toBeNull()
    expect(t.ctx.approvals.findMatch(t.ctx.runId, t.ctx.progress.step, { name: 'conn__note', url: 'not a url' })).toBeNull()
    expect(t.ctx.approvals.pendingOrAllowedFor(t.ctx.runId, t.ctx.progress.step)).toBeNull()
  })

  it('scopes a connector approval to a page no control can be on', async () => {
    const t = context()
    const { tool } = counting('write')
    let page = ''
    t.ctx.waitForApproval = async (id) => {
      page = t.ctx.approvals.get(id)?.page ?? ''
      t.ctx.approvals.resolve(id, 'denied')
      return 'denied'
    }
    await runConnectorTool('conn__note', tool, { text: 'x' } as never, ENV, t.ctx)
    expect(page).toBe(CONNECTOR_PAGE)
    expect([pageOf(''), pageOf('not a url'), pageOf('connector:'), pageOf('https://example.com/connector:')]).not.toContain(CONNECTOR_PAGE)
  })

  it('asks for a write even when the approval rules allow everything', async () => {
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox(), rules: { requireApproval: [], alwaysAllow: ['*'] } })
    const { tool, calls } = counting('write')
    t.decisions.push('denied')
    expect(await runConnectorTool('conn__note', tool, { text: 'x' } as never, ENV, t.ctx)).toBe(DENIED_TEXT)
    expect(calls).toEqual([])
    expect(t.chat.some((m) => m.card?.card === 'approval')).toBe(true)
  })

  it('Stop while the card waits means the write is never called', async () => {
    const t = context()
    const { tool, calls } = counting('write')
    // The runner's wait: Stop denies the pending card.
    t.ctx.waitForApproval = async (id) => {
      t.stop.request()
      t.ctx.approvals.resolve(id, 'denied')
      return 'denied'
    }
    expect(await runConnectorTool('conn__note', tool, { text: 'x' } as never, ENV, t.ctx)).toBe(DENIED_TEXT)
    expect(calls).toEqual([])
  })

  it('Stop between Allow and the call means the write is never called', async () => {
    const t = context()
    const { tool, calls } = counting('write')
    t.ctx.waitForApproval = async (id) => {
      t.ctx.approvals.resolve(id, 'allowed')
      t.stop.request()
      return 'allowed'
    }
    expect(await runConnectorTool('conn__note', tool, { text: 'x' } as never, ENV, t.ctx)).toBe(STOPPED_CALL_TEXT)
    expect(calls).toEqual([])
  })

  it('stops waiting at the time limit even when the connector ignores its signal', async () => {
    const t = context()
    const never = () => new Promise<string>(() => undefined)
    const read = counting('read', never).tool
    const write = counting('write', never).tool
    await expect(runConnectorTool('conn__echo', read, { text: 'x' } as never, ENV, t.ctx, 50)).rejects.toThrow('conn__echo did not answer in time')
    t.decisions.push('allowed')
    await expect(runConnectorTool('conn__note', write, { text: 'x' } as never, ENV, t.ctx, 50)).rejects.toThrow('whether it happened is unknown')
  })

  it('Stop during the call ends the wait and says the outcome of a write is unknown', async () => {
    const t = context()
    const write = counting('write', () => {
      t.stop.request()
      return new Promise<string>(() => undefined)
    }).tool
    t.decisions.push('allowed')
    await expect(runConnectorTool('conn__note', write, { text: 'x' } as never, ENV, t.ctx)).rejects.toThrow(/not run: the user stopped this run; .*whether it happened is unknown/)
  })

  it('passes a message the connector wrote for the model', async () => {
    const t = context()
    const read = counting('read', async () => {
      throw new ConnectorError('the service says no such page')
    }).tool
    await expect(runConnectorTool('conn__echo', read, { text: 'x' } as never, ENV, t.ctx)).rejects.toThrow(new ToolError('the service says no such page'))
  })

  it('gives the model only the name of any other error, so a key in its text reaches no result, chat line or log line', async () => {
    const t = context()
    // The real logger runs; only the stream it writes to is captured.
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk))
      return true
    })
    const read = counting('read', async () => {
      throw new Error('GET https://api.example/route?apikey=SECRET-KEY-123 failed')
    }).tool
    const def = defineTool({ name: 'conn__echo', description: 'test', schema: z.object({ text: z.string() }), run: (input, ctx) => runConnectorTool('conn__echo', read, input as never, ENV, ctx) })
    const outcome = await runPlatformTool(def, { text: 'x' }, t.ctx)
    expect(outcome).toEqual({ text: 'conn__echo failed (Error)', isError: true })
    expect(JSON.stringify(t.chat)).not.toContain('SECRET-KEY-123')
    const line = lines.find((l) => l.includes('connector call failed'))
    expect(line).toBeDefined()
    expect(JSON.parse(line ?? '{}')).toMatchObject({ level: 'warn', tool: 'conn__echo', errorName: 'Error' })
    expect(lines.join('')).not.toContain('SECRET-KEY-123')
  })

  it('refuses a write whose arguments would be cut on the card, before any card and without calling it', async () => {
    const t = context()
    const { tool, calls } = counting('write')
    await expect(runConnectorTool('conn__note', tool, { text: 'x'.repeat(CHAT_LIMITS.long) } as never, ENV, t.ctx)).rejects.toThrow(/too long to show in full on the approval card/)
    expect(calls).toEqual([])
    expect(t.chat).toEqual([])
  })

  it('shows the arguments on the card in full, exactly as the call gets them', async () => {
    const t = context()
    const { tool } = counting('write')
    t.decisions.push('denied')
    const text = 'line one\nline "two"\n' + 'y'.repeat(15_000)
    await runConnectorTool('conn__note', tool, { text } as never, ENV, t.ctx)
    const card = t.chat[0]?.card
    expect(card?.card === 'approval' && JSON.parse(card.connectorArgs ?? '')).toEqual({ text })
  })

  it('cuts a long result to the limit and says so', async () => {
    const t = context()
    const read = counting('read', async () => 'a'.repeat(25_000)).tool
    const text = await runConnectorTool('conn__echo', read, { text: 'x' } as never, ENV, t.ctx)
    expect(text.startsWith('a'.repeat(CONNECTOR_MAX_CHARS))).toBe(true)
    expect(text).toContain(`[truncated: the result has 25000 characters; only the first ${CONNECTOR_MAX_CHARS} are shown]`)
  })
})
