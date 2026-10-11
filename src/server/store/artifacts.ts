import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { artifactsDir, assertSlug, isNotFound, writeFileAtomic } from './paths'

const EXTENSIONS = ['.md', '.txt']

/** `report-acme.md`: a slug plus .md or .txt. Anything else is rejected. */
export function assertArtifactName(name: string): void {
  const dot = name.lastIndexOf('.')
  if (dot === -1 || !EXTENSIONS.includes(name.slice(dot))) throw new Error('artifact names end in .md or .txt')
  assertSlug(name.slice(0, dot))
}

export async function writeArtifact(dataDir: string, botId: string, name: string, content: string): Promise<string> {
  assertArtifactName(name)
  const path = join(artifactsDir(dataDir, botId), name)
  await writeFileAtomic(path, content)
  return path
}

export async function listArtifacts(dataDir: string, botId: string): Promise<string[]> {
  try {
    return (await readdir(artifactsDir(dataDir, botId))).filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext))).sort()
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
}

export async function readArtifact(dataDir: string, botId: string, name: string): Promise<string | null> {
  assertArtifactName(name)
  try {
    return await readFile(join(artifactsDir(dataDir, botId), name), 'utf8')
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}
