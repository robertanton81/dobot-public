import { appendFile, readFile } from 'node:fs/promises'
import { isNotFound, memoryFile, PRIVATE_FILE, withFileLock, writeFileAtomic } from './paths'

/** One dated line per note; a note with line breaks becomes one line. */
export async function appendMemory(dataDir: string, botId: string, note: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const line = note.replace(/\s*\n\s*/g, ' ').trim()
  const path = memoryFile(dataDir, botId)
  await withFileLock(path, () => appendFile(path, `- ${date}: ${line}\n`, { encoding: 'utf8', mode: PRIVATE_FILE }))
}

export async function readMemory(dataDir: string, botId: string): Promise<string> {
  try {
    return await readFile(memoryFile(dataDir, botId), 'utf8')
  } catch (e) {
    if (isNotFound(e)) return ''
    throw e
  }
}

/**
 * The Skills tab saves the whole file at once. The text ends with a line break, so the next appended
 * note starts its own line. With `base`, the file is replaced only if it still holds `base`; the
 * comparison and the write run inside the file's write chain, with the bot's appends, so a note the
 * bot adds while the tab is open is never erased. False means the file changed and nothing was written.
 */
export async function writeMemory(dataDir: string, botId: string, text: string, base?: string): Promise<boolean> {
  const path = memoryFile(dataDir, botId)
  return withFileLock(path, async () => {
    if (base !== undefined && base !== (await readMemory(dataDir, botId))) return false
    await writeFileAtomic(path, text === '' || text.endsWith('\n') ? text : `${text}\n`)
    return true
  })
}
