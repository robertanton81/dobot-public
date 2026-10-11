import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log } from './log'
import { shutDown } from './shutdown'

beforeEach(() => {
  vi.useFakeTimers()
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(log, level).mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('shutDown', () => {
  it('pauses no computer until everything that starts work has stopped, and exits clean', async () => {
    let stopped!: () => void
    const pauseUnheld = vi.fn(async () => 0)
    const pending = shutDown({ stopNewWork: () => new Promise<void>((resolve) => (stopped = resolve)), pauseUnheld })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pauseUnheld).not.toHaveBeenCalled()
    stopped()
    expect(await pending).toBe(0)
    expect(pauseUnheld).toHaveBeenCalledTimes(1)
  })

  it('says how many computers stay up because someone is using them', async () => {
    expect(await shutDown({ stopNewWork: async () => undefined, pauseUnheld: async () => 2 })).toBe(0)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('stay up'), { count: 2 })
  })

  it('gives up after the limit when a pause never answers', async () => {
    const pending = shutDown({ stopNewWork: async () => undefined, pauseUnheld: () => new Promise<number>(() => undefined) }, 5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toBe(1)
  })

  it('turns a failure into exit code 1, never into a rejection', async () => {
    expect(await shutDown({ stopNewWork: async () => { throw new Error('scheduler broke') }, pauseUnheld: async () => 0 })).toBe(1)
  })
})
