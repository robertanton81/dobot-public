import { readFile } from 'node:fs/promises'
import { connectionsFile, isNotFound, withFileLock, writeFileAtomic } from './paths'
import { Connections, type Connection } from './types'

// The bot's connectors. A missing file is a bot with no connections; a file that does not parse
// throws, and the caller decides what that means (the registry grants nothing and logs the bot id).

export async function readConnections(dataDir: string, botId: string): Promise<Connection[]> {
  try {
    return Connections.parse(JSON.parse(await readFile(connectionsFile(dataDir, botId), 'utf8')))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
}

/** Adds the connection, or replaces the one with the same id. */
export async function writeConnection(dataDir: string, botId: string, connection: Connection): Promise<void> {
  const path = connectionsFile(dataDir, botId)
  await withFileLock(path, async () => {
    const others = (await readConnections(dataDir, botId)).filter((c) => c.id !== connection.id)
    await writeFileAtomic(path, `${JSON.stringify([...others, connection], null, 2)}\n`)
  })
}
