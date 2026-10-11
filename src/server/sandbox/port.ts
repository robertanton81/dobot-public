import { z } from 'zod'

// The two interfaces the agent loop talks to. E2bSandbox and CompanionClient implement them for
// real; the fakes in src/server/agent/fakes.ts implement them for tests. No runtime module imports
// a fake.

export type Point = [number, number]

/** The screen every computer behind this port has, in pixels. Coordinates and screenshots are in this frame. */
export const RESOLUTION: Point = [1280, 800]

/** A command that failed on the computer (an unknown key name, an xdotool error): the action's problem, not the computer's. */
export class SandboxActionError extends Error {
  override name = 'SandboxActionError'
}

/** What the companion reports about the element under a screen point, or the focused element. */
export const ElementInfo = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('unknown'),
    reason: z.string(),
    url: z.string(),
    title: z.string(),
  }),
  // The point is above the page viewport: the browser's own frame (tab strip, address bar, a
  // bubble), where no page control can be. The gate applies no rule to it.
  z.object({
    target: z.literal('browser-ui'),
    reason: z.string(),
    url: z.string(),
    title: z.string(),
  }),
  z.object({
    target: z.literal('element'),
    tag: z.string(),
    type: z.string().nullable(),
    role: z.string().nullable(),
    name: z.string(),
    inForm: z.boolean(),
    isSubmit: z.boolean(),
    autocomplete: z.string().nullable(),
    /** True for a password field, also after a "show password" control has turned it into a text field. Absent from a companion that does not report it. */
    isPassword: z.boolean().optional(),
    /** True inside text that is edited in place (contenteditable). Absent from a companion that does not report it. */
    editable: z.boolean().optional(),
    inputMode: z.string().nullable(),
    pattern: z.string().nullable(),
    maxLength: z.number().nullable(),
    url: z.string(),
    title: z.string(),
  }),
])
export type ElementInfo = z.infer<typeof ElementInfo>

/**
 * What the hand-back check reads. `unsafe` is true while a secret field with a value is visible in a
 * document the companion can read (`secret-field`), or while the focus sits inside a frame it cannot
 * read, where such a field cannot be ruled out (`unreadable-frame`).
 */
export const PageState = z.object({
  url: z.string(),
  fingerprint: z.string(),
  unsafe: z.boolean(),
  unsafeReason: z.enum(['secret-field', 'unreadable-frame']).nullable().optional(),
  /** How many regions of the page (cross-origin frames, nesting past the cap) the companion could not read. */
  unreadable: z.number().int().nonnegative().optional(),
})
export type PageState = z.infer<typeof PageState>

export const Health = z.object({ ok: z.boolean(), cdp: z.boolean() })
export type Health = z.infer<typeof Health>

export interface CompanionPort {
  health(): Promise<Health>
  /** Resolves to `target: 'unknown'` on any failure — the gate treats that as a rule hit. */
  elementAt(p: Point): Promise<ElementInfo>
  activeElement(): Promise<ElementInfo>
  /** Throws on failure; the callers decide what an unknown page state means. */
  pageState(): Promise<PageState>
  /**
   * Attaches a file that already lives in the sandbox to the upload control at `p`. Throws on failure.
   * `click` says whether the companion may click the control when the page has no file input yet:
   * only the platform may decide that, because a click it did not vet would bypass the gate.
   */
  setFiles(p: Point, sandboxPath: string, opts: { click: boolean }): Promise<void>
}

export interface SandboxPort {
  /** PNG bytes at `RESOLUTION`. */
  screenshot(): Promise<Uint8Array>
  leftClick(p?: Point): Promise<void>
  rightClick(p?: Point): Promise<void>
  middleClick(p?: Point): Promise<void>
  doubleClick(p?: Point): Promise<void>
  tripleClick(p?: Point): Promise<void>
  moveMouse(p: Point): Promise<void>
  mouseDown(): Promise<void>
  mouseUp(): Promise<void>
  drag(from: Point, to: Point): Promise<void>
  scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number, at?: Point): Promise<void>
  type(text: string): Promise<void>
  /** xdotool key names, one chord: `['ctrl', 's']`. */
  press(keys: string[]): Promise<void>
  holdKey(key: string, seconds: number): Promise<void>
  cursorPosition(): Promise<Point>
  wait(ms: number): Promise<void>
  /** Opens an http or https address in the running browser, as a new tab. Throws on any other scheme. */
  openUrl(url: string): Promise<void>
  companion: CompanionPort
}
