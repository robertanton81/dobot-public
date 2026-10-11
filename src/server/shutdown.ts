import { errorFields, log } from './log'

// What the process does when the operator stops it (Ctrl+C, or a plain kill). A run that is active
// is cut, as it is when the process dies any other way: recovery at the next boot closes it, and the
// event that started it was not acknowledged, so it is delivered again.

export type ShutdownParts = {
  /** Stops what starts work: the listener, the mail watcher and the schedules. */
  stopNewWork(): Promise<void>
  /** Pauses every computer that nobody holds; resolves with how many stay up. */
  pauseUnheld(): Promise<number>
}

export const SHUTDOWN_LIMIT_MS = 20_000

/** Resolves with the exit code. Never rejects, and never takes longer than `limitMs`: a stop that hangs is worse than a computer left to its own timeout. */
export async function shutDown(parts: ShutdownParts, limitMs = SHUTDOWN_LIMIT_MS): Promise<0 | 1> {
  let timer: NodeJS.Timeout | undefined
  const limit = new Promise<'limit'>((resolve) => {
    timer = setTimeout(() => resolve('limit'), limitMs)
  })
  const work = (async () => {
    await parts.stopNewWork()
    return parts.pauseUnheld()
  })()
  try {
    const result = await Promise.race([work, limit])
    if (result === 'limit') {
      log.error('shutdown took too long; leaving the computers to their own timeout', { limitMs })
      return 1
    }
    if (result > 0) log.warn('computers in use stay up; their own timeout pauses them', { count: result })
    log.info('shutdown complete')
    return 0
  } catch (e) {
    log.error('shutdown failed', errorFields(e))
    return 1
  } finally {
    clearTimeout(timer)
  }
}
