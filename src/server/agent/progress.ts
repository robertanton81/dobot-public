import type { ComputerAction } from './actions'
import { sample, sampleDiff, type Sample } from './images'
import { THRESHOLD as SAME_SCREEN } from './stuck'

// A loop the screenshot detector cannot see: the model goes back and forth between a list and its
// items, and every click changes the screen. Such a loop records nothing: no memory line, no
// proposal, no document. What marks it is a stretch of steps with nothing new — no click at a new
// place, no new text, no new page, no screen this run has not shown before — and no successful
// platform tool call (a page opened a second time does not count as one). The model gets a notice
// at 16 and at 28 such steps, and the run ends at 40. The numbers come from a measurement on
// recorded runs of one kind of work: a loop reaches 17 to 53 such steps in a row, and a run that
// finishes stays at 15 or under. So the first notice comes at 16. docs/evidence/2026-09-17-loops
// holds the loop runs and the measuring script. Other kinds of work may need other numbers.
//
// A tool call that failed is not progress: an invalid call saves nothing, so it must not reset the
// count. A screenshot of a screen this run has not shown before is progress: paging through results
// is the same "Next" click at the same place. A screen counts as seen when it is within the stuck
// detector's "same screen" distance of one already recorded, so a clock or a hover highlight does
// not make an old page new.

export const NO_PROGRESS_NOTICE_AT: readonly number[] = [16, 28]
export const NO_PROGRESS_STUCK_AT = 40
/** Clicks within this many pixels of each other count as the same place. */
const GRID = 16

export type ProgressVerdict = { notice: string } | { stuck: true } | null

export function noProgressText(steps: number): string {
  return `You have taken ${steps} steps without doing anything new or recording anything: no click at a new place, no new text, no new page, no memory line, no proposal, no document. If you are opening things you already read, stop and use your notes instead; if you have what you need, act on it now; if you cannot finish, say what is missing. At ${NO_PROGRESS_STUCK_AT} such steps the run ends.`
}

export const NO_PROGRESS_STUCK_TEXT = `I took ${NO_PROGRESS_STUCK_AT} steps without doing anything new or recording anything, so I stopped. Take over to move things along on my screen, then hand back and send me the next goal.`

/** What an action is and where; null for actions that only look (screenshot, zoom, wait, cursor position). */
export function signatureOf(action: ComputerAction): string | null {
  if (action.name === 'screenshot' || action.name === 'zoom' || action.name === 'wait' || action.name === 'cursor_position') return null
  const parts: string[] = [action.name]
  if ('coordinate' in action && action.coordinate) parts.push(`@${Math.round(action.coordinate[0] / GRID)},${Math.round(action.coordinate[1] / GRID)}`)
  if ('text' in action && typeof action.text === 'string') parts.push(`:${action.text.slice(0, 40)}`)
  if ('scroll_direction' in action) parts.push(`:${action.scroll_direction}`)
  return parts.join('')
}

export class ProgressGuard {
  private readonly seen = new Set<string>()
  private readonly urls = new Set<string>()
  /** One sample per distinct screen, at most one per step: 64 KB each at 1280x800, bounded by the step budget, so not capped. */
  private readonly screens: Sample[] = []
  private stretch = 0

  /**
   * A computer action ran. Progress is a signature this run has not seen, or a screenshot (`png`,
   * full screenshots only) of a screen this run has not shown before; looking around is not.
   */
  noteAction(action: ComputerAction, png?: Uint8Array): ProgressVerdict {
    const sig = signatureOf(action)
    if (sig !== null && !this.seen.has(sig)) {
      this.seen.add(sig)
      this.stretch = 0
      return null
    }
    if (action.name === 'screenshot' && png !== undefined && this.newScreen(png)) {
      this.stretch = 0
      return null
    }
    return this.step()
  }

  /** A platform tool ran: progress when it succeeded, unless it opened a page this run already opened. A failed call is not progress. */
  noteTool(name: string, input: unknown, ok: boolean): ProgressVerdict {
    if (!ok) return this.step()
    if (name === 'open_url') {
      const url = typeof input === 'object' && input !== null && 'url' in input && typeof input.url === 'string' ? input.url : ''
      if (this.urls.has(url)) return this.step()
      this.urls.add(url)
    }
    this.stretch = 0
    return null
  }

  /** Records the screen and returns true when no recorded screen is close to it. */
  private newScreen(png: Uint8Array): boolean {
    const shot = sample(png)
    if (this.screens.some((seen) => sampleDiff(seen, shot) < SAME_SCREEN)) return false
    this.screens.push(shot)
    return true
  }

  private step(): ProgressVerdict {
    this.stretch += 1
    if (this.stretch >= NO_PROGRESS_STUCK_AT) return { stuck: true }
    if (NO_PROGRESS_NOTICE_AT.includes(this.stretch)) return { notice: noProgressText(this.stretch) }
    return null
  }
}
