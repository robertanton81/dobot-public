import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { log } from '../log'
import { isNotFound, writeFileAtomic } from '../store'
import type { Watermark, WatermarkStore } from './watcher'

const Mark = z.object({ uidValidity: z.string().nullable(), uidNext: z.number().int().nonnegative() })

/**
 * The watermark as a small JSON file next to the bot folders (`data/mail-watermark.json` by
 * default). A missing or unreadable file means "no watermark"; the watcher then starts from a
 * baseline, as it did before the file existed.
 */
export function fileWatermark(path: string): WatermarkStore {
  return {
    async read() {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
      try {
        const parsed = Mark.safeParse(JSON.parse(raw))
        if (parsed.success) return parsed.data
      } catch {
        // fall through: a corrupt file is the same as none
      }
      log.warn('the mail watermark file is not readable; starting from a baseline', { path })
      return null
    },
    async write(mark) {
      await writeFileAtomic(path, JSON.stringify(mark) + '\n')
    },
  }
}
