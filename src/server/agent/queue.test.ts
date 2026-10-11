import { describe, expect, it } from 'vitest'
import { RunQueue } from './queue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('RunQueue', () => {
  it('runs two jobs on one bot in order and never overlapping', async () => {
    const queue = new RunQueue()
    const gate = deferred()
    const log: string[] = []
    const first = queue.enqueue('a', async () => {
      log.push('first start')
      await gate.promise
      log.push('first end')
    })
    const second = queue.enqueue('a', async () => {
      log.push('second start')
    })
    await Promise.resolve()
    expect(log).toEqual(['first start'])
    expect(queue.size('a')).toBe(2)
    gate.resolve()
    await first
    await second
    expect(log).toEqual(['first start', 'first end', 'second start'])
    expect(queue.size('a')).toBe(0)
  })

  it('runs jobs on two bots concurrently', async () => {
    const queue = new RunQueue()
    const gate = deferred()
    const log: string[] = []
    const a = queue.enqueue('a', async () => {
      log.push('a start')
      await gate.promise
      log.push('a end')
    })
    const b = queue.enqueue('b', async () => {
      log.push('b done')
    })
    await b
    expect(log).toEqual(['a start', 'b done'])
    gate.resolve()
    await a
    expect(log).toEqual(['a start', 'b done', 'a end'])
  })

  it('a throwing job does not stop the next one', async () => {
    const queue = new RunQueue()
    const log: string[] = []
    const first = queue.enqueue('a', async () => {
      throw new Error('boom')
    })
    const second = queue.enqueue('a', async () => {
      log.push('second ran')
    })
    await expect(first).resolves.toBeUndefined()
    await second
    expect(log).toEqual(['second ran'])
    expect(queue.size('a')).toBe(0)
  })
})
