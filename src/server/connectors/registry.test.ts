import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { log } from '../log'
import { createStore, type Store } from '../store'
import { ConnectorRegistry } from './registry'
import type { BuiltinConnector, ConnectorEnv } from './types'

const ENV: ConnectorEnv = { fetch: globalThis.fetch, mapyApiKey: null, mailbox: null, mailboxBotId: null }

function connector(id: string, opts: { onByDefault?: boolean; unavailable?: string; write?: boolean } = {}): BuiltinConnector {
  return {
    id,
    title: id.toUpperCase(),
    what: `does ${id} things`,
    onByDefault: opts.onByDefault ?? false,
    unavailable: () => opts.unavailable ?? null,
    tools: [
      { name: 'look', class: 'read', description: `read ${id}`, schema: z.object({}), run: async () => `${id} looked` },
      ...(opts.write ? [{ name: 'change', class: 'write' as const, kind: 'publish' as const, description: `change ${id}`, schema: z.object({}), run: async () => `${id} changed` }] : []),
    ],
  }
}

const BUILTINS = [connector('alpha', { onByDefault: true }), connector('beta', { write: true }), connector('gamma', { unavailable: 'no key set' })]

let dataDir: string
let store: Store
let botId: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-registry-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Tester', persona: 'tests' })).id
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dataDir, { recursive: true, force: true })
})

describe('the connector registry', () => {
  it('gives a new bot the tools of the connectors on by default and lists the others it may ask for', async () => {
    const snap = await new ConnectorRegistry(store, BUILTINS, ENV).snapshot(botId)
    expect(snap.tools.map((t) => t.name)).toEqual(['alpha__look'])
    expect(snap.catalog).toEqual(['alpha — does alpha things (connected: alpha__look)', 'beta — does beta things (not connected; ask with request_connection)'])
    expect(snap.catalog.join('\n')).not.toContain('gamma')
  })

  it('adds a granted connector\'s tools, with a new key, and keeps them for a new registry on the same folder', async () => {
    const registry = new ConnectorRegistry(store, BUILTINS, ENV, () => new Date('2026-09-24T10:00:00Z'))
    const before = await registry.snapshot(botId)
    expect(await registry.grant(botId, 'beta')).toEqual(['beta__look', 'beta__change'])
    const after = await new ConnectorRegistry(createStore(dataDir), BUILTINS, ENV).snapshot(botId)
    expect(after.tools.map((t) => t.name)).toEqual(['alpha__look', 'beta__look', 'beta__change'])
    expect(after.key).not.toBe(before.key)
    expect(await store.readConnections(botId)).toEqual([{ id: 'beta', kind: 'builtin', builtin: 'beta', grantedAt: '2026-09-24T10:00:00.000Z', status: 'connected' }])
  })

  it('says in a write tool\'s description that every call is approved on a card', async () => {
    const registry = new ConnectorRegistry(store, BUILTINS, ENV)
    await registry.grant(botId, 'beta')
    const tools = (await registry.snapshot(botId)).tools
    expect(tools.find((t) => t.name === 'beta__change')?.description).toContain('approves every call on a card')
    expect(tools.find((t) => t.name === 'beta__look')?.description).not.toContain('card')
  })

  it('offers only a connector this bot may ask for, and refuses the rest by naming the ones it may', async () => {
    const registry = new ConnectorRegistry(store, BUILTINS, ENV)
    expect(await registry.offer(botId, 'beta')).toEqual({ id: 'beta', title: 'BETA', what: 'does beta things' })
    expect(await registry.offer(botId, 'gamma')).toEqual({ refused: 'there is no connector named gamma you can use; the ones you can ask for are: beta' })
    expect(await registry.offer(botId, 'nope')).toEqual({ refused: 'there is no connector named nope you can use; the ones you can ask for are: beta' })
    expect(await registry.offer(botId, 'alpha')).toEqual({ refused: 'alpha is already connected' })
    await registry.grant(botId, 'beta')
    expect(await registry.offer(botId, 'beta')).toEqual({ refused: 'beta is already connected' })
    await expect(registry.grant(botId, 'gamma')).rejects.toThrow('not a usable connector')
  })

  it('grants nothing from a connections file it cannot read, and says which bot in the log', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined)
    await writeFile(join(dataDir, botId, 'connections.json'), '{', 'utf8')
    const snap = await new ConnectorRegistry(store, BUILTINS, ENV).snapshot(botId)
    expect(snap.tools.map((t) => t.name)).toEqual(['alpha__look'])
    expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be read'), expect.objectContaining({ botId }))
  })

  it('gives no tool for a stored connection it does not know, or one this bot may no longer use, and warns about the unknown one', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    await store.writeConnection(botId, { id: 'retired', kind: 'builtin', builtin: 'retired', grantedAt: 'x', status: 'connected' })
    await store.writeConnection(botId, { id: 'gamma', kind: 'builtin', builtin: 'gamma', grantedAt: 'x', status: 'connected' })
    const snap = await new ConnectorRegistry(store, BUILTINS, ENV).snapshot(botId)
    expect(snap.tools.map((t) => t.name)).toEqual(['alpha__look'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not have'), { botId, connection: 'retired' })
  })

  it('gives no tool for a connection that is disconnected', async () => {
    await store.writeConnection(botId, { id: 'beta', kind: 'builtin', builtin: 'beta', grantedAt: 'x', status: 'disconnected' })
    const snap = await new ConnectorRegistry(store, BUILTINS, ENV).snapshot(botId)
    expect(snap.tools.map((t) => t.name)).toEqual(['alpha__look'])
  })
})
