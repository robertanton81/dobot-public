import { z } from 'zod'
import { RESOLUTION } from '../sandbox/port'
import type { Point, SandboxPort } from '../sandbox/port'
import { cropAndScale } from './images'

// The 17 members of computer_toolset_20260801, validated and mapped onto SandboxPort.

const MAX_WAIT_SECONDS = 10
const MAX_HOLD_SECONDS = 10
// A key is an xdotool key NAME: it starts with a letter, or it is one digit. xdotool also takes a
// number as a key code and `0x…` as a key symbol, which would press Enter under a name no list knows.
const KEY = '(?:[A-Za-z][A-Za-z0-9_]*|[0-9])'
const KEY_CHORD = new RegExp(`^${KEY}(\\+${KEY})*$`)

const Coordinate = z.tuple([z.number().int().min(0).max(RESOLUTION[0]), z.number().int().min(0).max(RESOLUTION[1])])
const Region = z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(0), z.number().int().min(0)])
const Click = z.object({ coordinate: Coordinate.optional() })
const KeyText = z.string().regex(KEY_CHORD, 'a key is an xdotool key name, with + between the keys of a chord')

const schemas = {
  screenshot: z.object({}),
  zoom: z.object({ region: Region }),
  left_click: Click,
  right_click: Click,
  middle_click: Click,
  double_click: Click,
  triple_click: Click,
  left_click_drag: z.object({ start_coordinate: Coordinate, coordinate: Coordinate }),
  mouse_move: z.object({ coordinate: Coordinate }),
  left_mouse_down: Click,
  left_mouse_up: Click,
  cursor_position: z.object({}),
  scroll: z.object({
    coordinate: Coordinate.optional(),
    scroll_direction: z.enum(['up', 'down', 'left', 'right']),
    scroll_amount: z.number().int().min(1).max(100),
  }),
  // A Tab inside typed text moves the focus after the gate has read the focused element, so the
  // characters that follow would land on a control nobody checked. Tab is its own `key` action.
  type: z.object({ text: z.string().min(1).refine((t) => !t.includes('\t'), 'typed text must not hold a Tab character; press Tab as its own key action') }),
  key: z.object({ text: KeyText, repeat: z.number().int().min(1).max(100).optional() }),
  hold_key: z.object({ text: KeyText, duration: z.number().positive() }),
  wait: z.object({ duration: z.number().positive() }),
}

export type ActionName = keyof typeof schemas
export const ACTION_NAMES = Object.keys(schemas) as ActionName[]

export type ComputerAction = { [N in ActionName]: { name: N } & z.infer<(typeof schemas)[N]> }[ActionName]

function isActionName(name: string): name is ActionName {
  return Object.hasOwn(schemas, name)
}

export function parseAction(name: string, input: unknown): ComputerAction | { error: string } {
  if (!isActionName(name)) return { error: `unknown computer action "${name}"` }
  const parsed = schemas[name].safeParse(input ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    return { error: `invalid input for ${name}: ${issues}` }
  }
  return { name, ...parsed.data } as ComputerAction
}

export type ActionResult = { text: string } | { png: Uint8Array }

/**
 * An action made of several operations that failed after some of them ran (a repeated key whose
 * third press got no answer). `cause` is the failure itself; `done` of `total` operations were
 * sent before it, so the loop can say so instead of reporting the whole action as not happened.
 */
export class PartialActionError extends Error {
  override name = 'PartialActionError'
  constructor(
    override readonly cause: unknown,
    readonly done: number,
    readonly total: number,
  ) {
    super(`${done} of ${total} operations were sent before the failure`)
  }
}

/** Runs one action on the sandbox. `lastShot` feeds zoom, which crops the last screenshot. */
export async function executeAction(action: ComputerAction, sandbox: SandboxPort, lastShot: Uint8Array | null): Promise<ActionResult> {
  switch (action.name) {
    case 'screenshot':
      return { png: await sandbox.screenshot() }
    case 'zoom': {
      const shot = lastShot ?? (await sandbox.screenshot())
      return { png: cropAndScale(shot, action.region, RESOLUTION) }
    }
    case 'left_click':
      await sandbox.leftClick(action.coordinate)
      return { text: 'OK' }
    case 'right_click':
      await sandbox.rightClick(action.coordinate)
      return { text: 'OK' }
    case 'middle_click':
      await sandbox.middleClick(action.coordinate)
      return { text: 'OK' }
    case 'double_click':
      await sandbox.doubleClick(action.coordinate)
      return { text: 'OK' }
    case 'triple_click':
      await sandbox.tripleClick(action.coordinate)
      return { text: 'OK' }
    case 'left_click_drag':
      await sandbox.drag(action.start_coordinate, action.coordinate)
      return { text: 'OK' }
    case 'mouse_move':
      await sandbox.moveMouse(action.coordinate)
      return { text: 'OK' }
    case 'left_mouse_down':
      if (action.coordinate) await sandbox.moveMouse(action.coordinate)
      await sandbox.mouseDown()
      return { text: 'OK' }
    case 'left_mouse_up':
      if (action.coordinate) await sandbox.moveMouse(action.coordinate)
      await sandbox.mouseUp()
      return { text: 'OK' }
    case 'cursor_position': {
      const [x, y] = await sandbox.cursorPosition()
      return { text: `[${x}, ${y}]` }
    }
    case 'scroll':
      await sandbox.scroll(action.scroll_direction, action.scroll_amount, action.coordinate)
      return { text: 'OK' }
    case 'type':
      await sandbox.type(action.text)
      return { text: 'OK' }
    case 'key': {
      const keys = action.text.split('+')
      const total = action.repeat ?? 1
      for (let i = 0; i < total; i++) {
        try {
          await sandbox.press(keys)
        } catch (e) {
          if (i === 0) throw e
          throw new PartialActionError(e, i, total)
        }
      }
      return { text: 'OK' }
    }
    case 'hold_key': {
      const seconds = Math.min(action.duration, MAX_HOLD_SECONDS)
      await sandbox.holdKey(action.text, seconds)
      return { text: seconds < action.duration ? `OK (held for ${seconds} s; capped at ${MAX_HOLD_SECONDS} s)` : 'OK' }
    }
    case 'wait': {
      const seconds = Math.min(action.duration, MAX_WAIT_SECONDS)
      await sandbox.wait(seconds * 1000)
      return { text: seconds < action.duration ? `OK (waited ${seconds} s; capped at ${MAX_WAIT_SECONDS} s)` : 'OK' }
    }
  }
}

/**
 * How many times the action would activate the control it lands on: a repeated key presses it
 * `repeat` times, a held activating key auto-repeats for as long as it is down (unbounded), each
 * typed newline is one Enter, a double and a triple click activate twice and three times. One
 * approval covers exactly one activation, so the gate refuses anything above one.
 */
export function activationCount(action: ComputerAction): number {
  switch (action.name) {
    case 'key':
      return action.repeat ?? 1
    case 'hold_key':
      return Number.POSITIVE_INFINITY
    case 'type':
      return (action.text.match(/\r\n|\r|\n/g) ?? []).length
    case 'double_click':
      return 2
    case 'triple_click':
      return 3
    default:
      return 1
  }
}

/** The point an activation lands on: the click point, or a drag's end point. */
export function targetPoint(action: ComputerAction): Point | null {
  switch (action.name) {
    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click':
    case 'triple_click':
    case 'left_mouse_down':
    case 'left_mouse_up':
      return action.coordinate ?? null
    case 'left_click_drag':
    case 'mouse_move':
      return action.coordinate
    default:
      return null
  }
}

/** One line for the event log and the "I was doing …" message. Never includes typed text. */
export function describeAction(action: ComputerAction): string {
  const p = targetPoint(action)
  if (action.name === 'type') return `typing ${action.text.length} characters`
  if (action.name === 'key' || action.name === 'hold_key') return `${action.name} ${action.text.length === 1 ? '[1 character]' : action.text}`
  if (action.name === 'scroll') return `scroll ${action.scroll_direction} ${action.scroll_amount}`
  return p ? `${action.name} at [${p[0]}, ${p[1]}]` : action.name
}

/**
 * The tool input as it may be logged: typed text and single-character keys are replaced by their
 * length, so a secret the model should not have typed can never reach the event log (invariant 5).
 */
export function loggableInput(action: ComputerAction): unknown {
  if (action.name === 'type') return { text: `[${action.text.length} characters]` }
  const { name: _name, ...rest } = action
  if ((action.name === 'key' || action.name === 'hold_key') && action.text.length === 1) return { ...rest, text: '[1 character]' }
  return rest
}
