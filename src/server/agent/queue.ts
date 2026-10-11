import { errorFields, log } from '../log'

// One chain of jobs per bot: runs on one bot never overlap; different bots run concurrently.

export class RunQueue {
  private readonly chains = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, number>()

  /** Resolves with the job's result when it has finished; a job that throws is logged, yields undefined and does not break the chain. */
  enqueue<T>(botId: string, job: () => Promise<T>): Promise<T | undefined> {
    this.pending.set(botId, (this.pending.get(botId) ?? 0) + 1)
    const previous = this.chains.get(botId) ?? Promise.resolve()
    const next = previous
      .then(job)
      .catch((e: unknown): undefined => {
        log.error('queued run failed outside its own error handling', { botId, ...errorFields(e) })
        return undefined
      })
      .finally(() => {
        const left = (this.pending.get(botId) ?? 1) - 1
        if (left <= 0) this.pending.delete(botId)
        else this.pending.set(botId, left)
      })
    this.chains.set(botId, next.then(() => undefined))
    return next
  }

  /** Jobs running or waiting for this bot. */
  size(botId: string): number {
    return this.pending.get(botId) ?? 0
  }
}
