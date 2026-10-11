import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ComputerAction } from './actions'
import { solidPng } from './fakes'
import { sample, sampleDiff } from './images'
import { THRESHOLD as SAME_SCREEN } from './stuck'
import { NO_PROGRESS_NOTICE_AT, NO_PROGRESS_STUCK_AT, noProgressText, ProgressGuard, signatureOf } from './progress'

const click = (x: number, y: number): ComputerAction => ({ name: 'left_click', coordinate: [x, y] })
const shot = { name: 'screenshot' } as ComputerAction

/** The observed cycle: back to the inbox, open a mail, look, over and over. */
function cycle(g: ProgressGuard, rounds: number): ReturnType<ProgressGuard['noteAction']>[] {
  const out: ReturnType<ProgressGuard['noteAction']>[] = []
  for (let i = 0; i < rounds; i++) {
    out.push(g.noteAction(click(313, 202)), g.noteAction(click(700, 253 + (i % 5) * 40)), g.noteAction(shot))
  }
  return out
}

describe('ProgressGuard', () => {
  it('counts the observed cycle as no progress once every place has been visited, and never a first visit', () => {
    const g = new ProgressGuard()
    // The first round visits new places: the back control and the first mail row. A screenshot is never progress.
    expect(g.noteAction(click(313, 202))).toBeNull()
    expect(g.noteAction(click(700, 253))).toBeNull()
    expect(g.noteAction(shot)).toEqual(null)
    // Five rows, one new each round, then nothing new: the stretch grows two per round and hits the first notice.
    const verdicts = cycle(g, 12)
    const notices = verdicts.flatMap((v) => (v !== null && 'notice' in v ? [v.notice] : []))
    expect(notices[0]).toBe(noProgressText(NO_PROGRESS_NOTICE_AT[0]!))
  })

  it('ends the run at the fortieth step without progress, with a second notice on the way', () => {
    const g = new ProgressGuard()
    const verdicts = cycle(g, 30)
    const kinds = verdicts.map((v) => (v === null ? '.' : 'stuck' in v ? 'S' : 'N')).join('')
    expect(kinds.split('N').length - 1).toBe(NO_PROGRESS_NOTICE_AT.length)
    expect(kinds.indexOf('S')).toBeGreaterThan(kinds.lastIndexOf('N'))
    expect(kinds.split('S').length - 1).toBeGreaterThanOrEqual(1)
  })

  it('a memory line, a proposal or a new page resets the count; opening a page again does not', () => {
    const g = new ProgressGuard()
    cycle(g, 6)
    expect(g.noteTool('remember', { note: 'x' }, true)).toBeNull()
    // Right after progress, the next old action starts the count from one.
    expect(g.noteAction(click(313, 202))).toBeNull()
    expect(g.noteTool('open_url', { url: 'https://cal.com/a' }, true)).toBeNull()
    expect(g.noteTool('open_url', { url: 'https://cal.com/a' }, true)).toBeNull() // counted, but far from the notice
    let last: ReturnType<ProgressGuard['noteTool']> = null
    for (let i = 0; i < NO_PROGRESS_STUCK_AT; i++) last = g.noteTool('open_url', { url: 'https://cal.com/a' }, true)
    expect(last).toEqual({ stuck: true })
  })

  // An invalid `remember` call saves nothing, so it must not reset the count. If it did, a
  // repeated-click loop would run longer before the guard ends it, and still save nothing.
  it('a tool call that failed is not progress', () => {
    const g = new ProgressGuard()
    cycle(g, 6) // leaves the count at 4: the last round added nothing new
    expect(g.noteTool('remember', {}, false)).toBeNull() // step 5, counted
    // Eleven old clicks reach the first notice at step 16 only if the failed call counted as a step.
    const verdicts = Array.from({ length: 11 }, () => g.noteAction(click(313, 202)))
    expect(verdicts.slice(0, 10).every((v) => v === null)).toBe(true)
    expect(verdicts[10]).toEqual({ notice: noProgressText(NO_PROGRESS_NOTICE_AT[0]!) })
  })

  // Paging through results is the same "Next" click at the same place. Judged by the clicks alone,
  // the guard would end a page walk at the stuck limit with many distinct screens behind it.
  it('a screenshot of a screen this run has not shown before is progress; one it has shown is not', () => {
    const g = new ProgressGuard()
    const page = (n: number) => solidPng(64, 64, [n * 10, n * 10, n * 10])
    // Next, look; Next, look: the click repeats, the pages are new, the count never grows.
    expect(g.noteAction(click(600, 700))).toBeNull()
    for (let i = 0; i < NO_PROGRESS_STUCK_AT; i++) {
      expect(g.noteAction(shot, page(i % 25))).toBeNull() // a page within the same-screen distance of... none
      expect(g.noteAction(click(600, 700))).toBeNull()
      if (i >= 24) break
    }
    // Back on pages already seen (a clock's worth of change does not make them new), every step counts.
    let verdict: ReturnType<ProgressGuard['noteAction']> = null
    for (let i = 0; i < NO_PROGRESS_STUCK_AT; i++) {
      verdict = g.noteAction(shot, page(i % 25))
      if (verdict !== null && 'stuck' in verdict) break
      verdict = g.noteAction(click(600, 700))
      if (verdict !== null && 'stuck' in verdict) break
    }
    expect(verdict).toEqual({ stuck: true })
  })

  it('a zoom or a screenshot without a picture is never progress on its own', () => {
    const g = new ProgressGuard()
    cycle(g, 6) // count at 4
    expect(g.noteAction(shot)).toBeNull() // 5
    expect(g.noteAction({ name: 'zoom', region: [0, 0, 10, 10] } as ComputerAction, solidPng(8, 8, [200, 200, 200]))).toBeNull() // 6
    const verdicts = Array.from({ length: 10 }, () => g.noteAction(click(313, 202)))
    expect(verdicts[9]).toEqual({ notice: noProgressText(NO_PROGRESS_NOTICE_AT[0]!) })
  })

  it('tells actions apart by place, text and direction, and treats a few pixels as the same place', () => {
    expect(signatureOf(click(313, 202))).toBe(signatureOf(click(318, 206)))
    expect(signatureOf(click(313, 202))).not.toBe(signatureOf(click(700, 253)))
    expect(signatureOf({ name: 'type', text: 'a' })).not.toBe(signatureOf({ name: 'type', text: 'b' }))
    expect(signatureOf({ name: 'scroll', scroll_direction: 'down', scroll_amount: 3, coordinate: [400, 400] })).toBe('scroll@25,25:down')
    expect(signatureOf({ name: 'wait', duration: 1 })).toBeNull()
  })
})

/** A screenshot from the recorded runs, kept in the loop evidence folder that the path below names. */
const evidence = (name: string): Uint8Array => readFileSync(fileURLToPath(new URL(`../../../docs/evidence/2026-09-17-loops/${name}`, import.meta.url)))

describe('the same-screen distance on real screenshots', () => {
  // Two screenshots of one recorded run: two different cancellation mails in the same template; a
  // time line and the unread badge differ, nothing else. They measure 0.47, so the guard reads them
  // as one screen: a mail that differs from one already read by a line of digits is not new content
  // to it. The inbox and a mail measure 9.4. On the recorded loop runs, revisits measure 0.00 to 1.65
  // and new screens 2.40 to 9.42 (replay-guard.ts in the evidence folder); the threshold sits in
  // that gap.
  it('two mails that differ by a line of digits are one screen to the guard; the inbox and a mail are two', () => {
    const inbox = sample(evidence('d4e20693-first-inbox.png'))
    const mail75 = sample(evidence('d4e20693-mail-mid75.png'))
    const mail73 = sample(evidence('d4e20693-mail-mid73.png'))
    // Same size first: sampleDiff answers Infinity for different sizes, which would pass the checks below for nothing.
    expect([mail75.width, mail75.height, mail73.width, mail73.height]).toEqual([inbox.width, inbox.height, inbox.width, inbox.height])
    expect(sampleDiff(mail75, mail73)).toBeLessThan(SAME_SCREEN)
    expect(sampleDiff(inbox, mail75)).toBeGreaterThanOrEqual(SAME_SCREEN)
    expect(sampleDiff(inbox, mail73)).toBeGreaterThanOrEqual(SAME_SCREEN)
  })

  it('so the observed mail loop, screenshots included, still ends at the stuck limit', () => {
    const g = new ProgressGuard()
    const inbox = evidence('d4e20693-first-inbox.png')
    const mails = [evidence('d4e20693-mail-mid75.png'), evidence('d4e20693-mail-mid73.png')]
    // Back to the inbox, look, open a mail, look; the two mails in turn. Only the first round is new.
    let steps = 0
    let verdict: ReturnType<ProgressGuard['noteAction']> = null
    while (steps < 200 && (verdict === null || !('stuck' in verdict))) {
      const round = Math.floor(steps / 4)
      const turn = steps % 4
      verdict =
        turn === 0 ? g.noteAction(click(313, 202))
        : turn === 1 ? g.noteAction(shot, inbox)
        : turn === 2 ? g.noteAction(click(700, 253 + (round % 2) * 40))
        : g.noteAction(shot, mails[round % 2])
      steps += 1
    }
    expect(verdict).toEqual({ stuck: true })
    // The first round credits two clicks and two screens; everything after is a step.
    expect(steps).toBeLessThanOrEqual(NO_PROGRESS_STUCK_AT + 8)
  })
})
