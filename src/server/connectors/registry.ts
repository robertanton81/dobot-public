import { runConnectorTool } from '../agent/connector-gate'
import type { ConnectorOffer, ConnectorSnapshot, ConnectorsPort, ToolDef } from '../agent/run-context'
import { defineTool } from '../agent/tools'
import { errorFields, log } from '../log'
import type { Connection, Store } from '../store'
import type { BuiltinConnector, ConnectorEnv, ConnectorTool } from './types'

// Turns a bot's connections into platform tools named <connection>__<tool>. Only connectors this bot
// may use are listed; a connection the registry does not know, or one this bot may no longer use,
// gives no tools.

export class ConnectorRegistry implements ConnectorsPort {
  constructor(
    private readonly store: Pick<Store, 'readConnections' | 'writeConnection'>,
    private readonly builtins: BuiltinConnector[],
    private readonly env: ConnectorEnv,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(botId: string): Promise<ConnectorSnapshot> {
    const granted = await this.connected(botId)
    const tools: ToolDef[] = []
    const catalog: string[] = []
    for (const c of this.usable(botId)) {
      const on = c.onByDefault || granted.has(c.id)
      const state = on ? `connected: ${c.tools.map((t) => `${c.id}__${t.name}`).join(', ')}` : 'not connected; ask with request_connection'
      catalog.push(`${c.id} — ${c.what} (${state})`)
      if (on) for (const t of c.tools) tools.push(this.toolDef(c, t))
    }
    return { tools, catalog, key: tools.map((t) => t.name).join(',') }
  }

  async offer(botId: string, builtin: string): Promise<ConnectorOffer | { refused: string }> {
    const usable = this.usable(botId)
    const c = usable.find((b) => b.id === builtin)
    if (!c) {
      const askable = usable.filter((b) => !b.onByDefault).map((b) => b.id)
      return { refused: `there is no connector named ${builtin} you can use; the ones you can ask for are: ${askable.join(', ') || 'none'}` }
    }
    if (c.onByDefault || (await this.connected(botId)).has(c.id)) return { refused: `${c.id} is already connected` }
    return { id: c.id, title: c.title, what: c.what }
  }

  async grant(botId: string, builtin: string): Promise<string[]> {
    const c = this.usable(botId).find((b) => b.id === builtin)
    if (!c) throw new Error('not a usable connector')
    const connection: Connection = { id: c.id, kind: 'builtin', builtin: c.id, grantedAt: this.now().toISOString(), status: 'connected' }
    await this.store.writeConnection(botId, connection)
    return c.tools.map((t) => `${c.id}__${t.name}`)
  }

  private usable(botId: string): BuiltinConnector[] {
    return this.builtins.filter((c) => c.unavailable(botId, this.env) === null)
  }

  private async connected(botId: string): Promise<Set<string>> {
    try {
      const stored = (await this.store.readConnections(botId)).filter((c) => c.status === 'connected')
      const known = new Set(this.builtins.map((b) => b.id))
      for (const c of stored) {
        if (!known.has(c.builtin)) log.warn('a stored connection names a connector this server does not have; it gives no tools', { botId, connection: c.id })
      }
      return new Set(stored.map((c) => c.builtin))
    } catch (e) {
      // Fail closed: a file that cannot be read grants nothing. The run goes on with fewer tools.
      log.error('the bot connections could not be read; the run has only the connectors on by default', { botId, ...errorFields(e) })
      return new Set()
    }
  }

  private toolDef(c: BuiltinConnector, t: ConnectorTool): ToolDef {
    const name = `${c.id}__${t.name}`
    return defineTool({
      name,
      description: `${t.description}${t.class === 'write' ? ' The user approves every call on a card first.' : ''}`,
      schema: t.schema,
      // defineTool has validated `input` against the tool's own schema; `never` is the type every
      // connector tool's run accepts, whatever its schema.
      run: (input, ctx) => runConnectorTool(name, t, input as never, this.env, ctx),
    })
  }
}
