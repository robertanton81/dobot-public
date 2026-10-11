import { describe, expect, it } from 'vitest'
import { solidPng } from './fakes'
import { MIN_SPAN_MS, StuckDetector, THRESHOLD } from './stuck'

const same = solidPng(64, 64, [50, 50, 50])
const different = solidPng(64, 64, [50 + THRESHOLD * 3, 50 + THRESHOLD * 3, 50 + THRESHOLD * 3])

/** A clock the test moves by hand. */
function clock(start = 1_000_000): { now: number; read: () => number } {
  const c = { now: start, read: () => c.now }
  return c
}

describe('StuckDetector', () => {
  it('fires on three identical screenshots that span the minimum time', () => {
    const c = clock()
    const d = new StuckDetector(c.read)
    expect(d.note('screenshot', same)).toBe(false)
    c.now += MIN_SPAN_MS / 2
    expect(d.note('screenshot', same)).toBe(false)
    c.now += MIN_SPAN_MS / 2
    expect(d.note('screenshot', same)).toBe(true)
  })

  // A page that is still painting after a resume gives three identical screenshots within ten
  // seconds. Judged by the count alone, the run would end stuck on a page that is merely slow.
  it('does not fire on three identical screenshots within a few seconds, and fires once the unchanged run is long enough', () => {
    const c = clock()
    const d = new StuckDetector(c.read)
    d.note('screenshot', same)
    c.now += 5_000
    d.note('screenshot', same)
    c.now += 5_000
    expect(d.note('screenshot', same)).toBe(false)
    c.now += MIN_SPAN_MS - 10_000
    expect(d.note('screenshot', same)).toBe(true)
  })

  it('a screenshot that differs starts the run again from that screenshot, clock included', () => {
    const c = clock()
    const d = new StuckDetector(c.read)
    d.note('screenshot', same)
    c.now += MIN_SPAN_MS + 1_000
    d.note('screenshot', same)
    c.now += 1_000
    expect(d.note('screenshot', different)).toBe(false)
    c.now += 1_000
    expect(d.note('screenshot', different)).toBe(false)
    c.now += 1_000
    // Three screenshots since the change, two seconds apart in all: not a loop. A start time left
    // over from the first screenshot would see more than half a minute here and fire wrongly.
    expect(d.note('screenshot', different)).toBe(false)
    c.now += MIN_SPAN_MS
    expect(d.note('screenshot', different)).toBe(true)
  })

  it('is reset by any action other than a screenshot or a wait, clock included', () => {
    const c = clock()
    const d = new StuckDetector(c.read)
    d.note('screenshot', same)
    c.now += MIN_SPAN_MS - 1_000
    expect(d.note('other')).toBe(false)
    d.note('screenshot', same)
    c.now += 1_000
    d.note('screenshot', same)
    c.now += 1_000
    // Three screenshots since the reset, two seconds apart in all: not a loop. A start time left
    // over from before the reset would see more than half a minute here and fire wrongly.
    expect(d.note('screenshot', same)).toBe(false)
    c.now += MIN_SPAN_MS
    expect(d.note('screenshot', same)).toBe(true)
  })

  it('is not reset by a wait between screenshots', () => {
    const c = clock()
    const d = new StuckDetector(c.read)
    d.note('screenshot', same)
    d.note('wait')
    c.now += MIN_SPAN_MS / 2
    d.note('screenshot', same)
    d.note('wait')
    c.now += MIN_SPAN_MS / 2
    expect(d.note('screenshot', same)).toBe(true)
  })

  it('without a clock of its own it does not crash, and three screenshots within milliseconds are not a loop', () => {
    const d = new StuckDetector()
    d.note('screenshot', same)
    d.note('screenshot', same)
    expect(d.note('screenshot', same)).toBe(false)
  })
})
