import { randomBytes } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG } from './types'

// Every path under the data directory goes through here. assertSlug is what keeps a tool from
// writing outside its bot folder or naming `../approval-rules`.

export function assertSlug(name: string): void {
  if (!SLUG.test(name)) throw new Error(`invalid name "${name}": use 1-40 lower-case letters, digits or dashes`)
}

export function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as NodeJS.ErrnoException).code === 'ENOENT'
}

export function botDir(dataDir: string, botId: string): string {
  assertSlug(botId)
  return join(dataDir, botId)
}

export function botFile(dataDir: string, botId: string, file: string): string {
  return join(botDir(dataDir, botId), file)
}

export function memoryFile(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'memory.md')
}

export function rulesFile(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'approval-rules.json')
}

export function connectionsFile(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'connections.json')
}

export function chatFile(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'chat.jsonl')
}

// A bot folder holds a person's chat, memory, run records and screenshots. Its files and folders are
// for the account that runs the process and for nobody else on the machine. A mode counts when a file
// or a folder is created; one that exists keeps the mode it has.
export const PRIVATE_FILE = 0o600
export const PRIVATE_DIR = 0o700

/**
 * Writes through a temp file with a unique name, then renames over the target: readers never see
 * a half-written file, and two overlapping writers cannot truncate each other's temp file. The
 * rename carries the temp file's mode, so a rewritten file ends private whatever it was before.
 */
export async function writeFileAtomic(target: string, content: string | Uint8Array): Promise<void> {
  const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, content, { mode: PRIVATE_FILE })
  await rename(tmp, target)
}

// One chain of promises per file path: a read-change-write of one file runs after every earlier one
// on that file has settled, so no writer in this process works from a copy that another writer has
// already replaced. A write that fails rejects to its own caller only; the next one still runs. The
// chain lives in memory: after a restart the file is whole, old or new, because the rename is atomic.
// Reads outside a write need no lock, for the same reason.
const writeChains = new Map<string, Promise<unknown>>()

export async function withFileLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(path) ?? Promise.resolve()
  const next = previous.then(() => work(), () => work())
  writeChains.set(path, next)
  try {
    return await next
  } finally {
    if (writeChains.get(path) === next) writeChains.delete(path)
  }
}

export function runsDir(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'runs')
}

export function runDir(dataDir: string, botId: string, runId: string): string {
  assertSlug(runId)
  return join(runsDir(dataDir, botId), runId)
}

export function shotsDir(dataDir: string, botId: string, runId: string): string {
  return join(runDir(dataDir, botId, runId), 'shots')
}

export function skillsDir(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'skills')
}

export function routinesDir(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'routines')
}

export function artifactsDir(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'artifacts')
}

export function workspaceDir(dataDir: string, botId: string): string {
  return botFile(dataDir, botId, 'workspace')
}
