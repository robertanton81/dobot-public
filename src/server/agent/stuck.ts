import { meanAbsDiff } from './images'

// A loop: the model takes screenshot after screenshot of a screen that does not change, with
// nothing but waits between them. A count alone is not enough: a page that is still painting after
// the computer resumes gives three near-identical screenshots within ten seconds. So the unchanged
// series must also span some time: a slow page paints, and the next screenshot differs; a real
// loop keeps going and is caught a few screenshots later. Any other action resets the series.

export const THRESHOLD = 2
export const MIN_SHOTS = 3
/** How long the screen must have stayed the same, first screenshot to last, before the run is stuck. */
export const MIN_SPAN_MS = 30_000

export type StuckKind = 'screenshot' | 'wait' | 'other'

export class StuckDetector {
  /** When the first screenshot of the unchanged run was taken, in epoch milliseconds. */
  private firstAt = 0
  private last: Uint8Array | null = null
  private count = 0

  /** `now` is the clock the span is measured on: injected in tests, the wall clock otherwise. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Returns true when the run is stuck. `wait` is neutral; `other` resets. */
  note(kind: StuckKind, png?: Uint8Array): boolean {
    if (kind === 'other') {
      this.reset()
      return false
    }
    if (kind === 'wait' || !png) return false
    const at = this.now()
    if (this.last !== null && meanAbsDiff(this.last, png) < THRESHOLD) {
      this.count += 1
    } else {
      // A screen that changed starts a new run from this screenshot.
      this.firstAt = at
      this.count = 1
    }
    this.last = png
    return this.count >= MIN_SHOTS && at - this.firstAt >= MIN_SPAN_MS
  }

  private reset(): void {
    this.last = null
    this.count = 0
  }
}
