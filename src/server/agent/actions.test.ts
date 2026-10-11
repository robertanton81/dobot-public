import { describe, expect, it } from 'vitest'
import { ACTION_NAMES, activationCount, describeAction, executeAction, loggableInput, parseAction, PartialActionError, type ComputerAction } from './actions'
import { FakeSandbox, solidPng } from './fakes'
import { decode } from './images'

function parsed(name: string, input: unknown): ComputerAction {
  const result = parseAction(name, input)
  if ('error' in result) throw new Error(result.error)
  return result
}

describe('parseAction', () => {
  const valid: Record<string, unknown> = {
    screenshot: {},
    zoom: { region: [0, 0, 100, 50] },
    left_click: { coordinate: [10, 20] },
    right_click: { coordinate: [10, 20] },
    middle_click: { coordinate: [10, 20] },
    double_click: { coordinate: [10, 20] },
    triple_click: { coordinate: [10, 20] },
    left_click_drag: { start_coordinate: [1, 2], coordinate: [3, 4] },
    mouse_move: { coordinate: [5, 6] },
    left_mouse_down: {},
    left_mouse_up: {},
    cursor_position: {},
    scroll: { scroll_direction: 'down', scroll_amount: 3, coordinate: [7, 8] },
    type: { text: 'hello' },
    key: { text: 'Return', repeat: 3 },
    hold_key: { text: 'shift', duration: 2 },
    wait: { duration: 1 },
  }

  it('covers all 17 actions of the toolset', () => {
    expect(ACTION_NAMES).toHaveLength(17)
    expect(Object.keys(valid).sort()).toEqual([...ACTION_NAMES].sort())
  })

  it('parses a valid input of every action into the matching action', () => {
    for (const name of ACTION_NAMES) {
      expect(parseAction(name, valid[name])).toEqual({ name, ...(valid[name] as object) })
    }
  })

  it.each([
    ['left_click', { coordinate: [10] }],
    ['left_click', { coordinate: ['a', 'b'] }],
    ['left_click', { coordinate: [10.5, 20] }],
    ['left_click', { coordinate: [-1, 20] }],
    ['key', {}],
    ['key', { text: 'Return', repeat: 0 }],
    ['key', { text: 'Return', repeat: 101 }],
    ['key', { text: 'Return; rm -rf /' }],
    ['scroll', { scroll_direction: 'diagonal', scroll_amount: 1 }],
    ['zoom', { region: [0, 0, 10] }],
    ['type', { text: '' }],
    ['wait', { duration: 0 }],
  ])('rejects %s with %j', (name, input) => {
    const result = parseAction(name, input)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain(`invalid input for ${name}`)
  })

  it('takes a key by its name only: a key code or a key symbol in numbers is refused', () => {
    for (const text of ['Return', 'ctrl+a', 'KP_Enter', '5', 'ctrl+5', 'F5', 'shift+Tab']) expect(parseAction('key', { text })).toMatchObject({ name: 'key', text })
    for (const text of ['0xff0d', '0x20', '36', 'ctrl+0xff0d', '_x']) expect(parseAction('key', { text })).toHaveProperty('error')
    expect(parseAction('hold_key', { text: '0xff0d', duration: 1 })).toHaveProperty('error')
  })

  it('rejects an unknown action name', () => {
    expect(parseAction('teleport', {})).toEqual({ error: 'unknown computer action "teleport"' })
  })
})

describe('executeAction', () => {
  it('caps wait at 10 s and says so', async () => {
    const sandbox = new FakeSandbox()
    const result = await executeAction(parsed('wait', { duration: 60 }), sandbox, null)
    expect(sandbox.calls).toEqual([{ method: 'wait', args: [10_000] }])
    expect(result).toEqual({ text: expect.stringContaining('capped at 10 s') })
    expect(await executeAction(parsed('wait', { duration: 2 }), sandbox, null)).toEqual({ text: 'OK' })
  })

  it('caps hold_key at 10 s and says so', async () => {
    const sandbox = new FakeSandbox()
    const result = await executeAction(parsed('hold_key', { text: 'shift', duration: 30 }), sandbox, null)
    expect(sandbox.calls).toEqual([{ method: 'holdKey', args: ['shift', 10] }])
    expect(result).toEqual({ text: expect.stringContaining('capped at 10 s') })
  })

  it('zooms into a region partly outside the screen and returns a PNG that fits 1280x800', async () => {
    const sandbox = new FakeSandbox()
    const shot = solidPng(1280, 800, [1, 2, 3])
    const result = await executeAction(parsed('zoom', { region: [1200, 700, 1400, 900] }), sandbox, shot)
    expect('png' in result).toBe(true)
    if (!('png' in result)) return
    const image = decode(result.png)
    expect(image.width).toBeLessThanOrEqual(1280)
    expect(image.height).toBeLessThanOrEqual(800)
    expect(sandbox.calls).toEqual([])
  })

  it('takes a screenshot for zoom when there is no last screenshot', async () => {
    const sandbox = new FakeSandbox([solidPng(1280, 800, [0, 0, 0])])
    await executeAction(parsed('zoom', { region: [0, 0, 100, 100] }), sandbox, null)
    expect(sandbox.methods()).toEqual(['screenshot'])
  })

  it('splits a key chord on + and repeats it', async () => {
    const sandbox = new FakeSandbox()
    await executeAction(parsed('key', { text: 'ctrl+s' }), sandbox, null)
    await executeAction(parsed('key', { text: 'Tab', repeat: 2 }), sandbox, null)
    expect(sandbox.calls).toEqual([
      { method: 'press', args: [['ctrl', 's']] },
      { method: 'press', args: [['Tab']] },
      { method: 'press', args: [['Tab']] },
    ])
  })

  it('scrolls at the given coordinate', async () => {
    const sandbox = new FakeSandbox()
    await executeAction(parsed('scroll', { scroll_direction: 'down', scroll_amount: 5, coordinate: [100, 200] }), sandbox, null)
    expect(sandbox.calls).toEqual([{ method: 'scroll', args: ['down', 5, [100, 200]] }])
  })

  it('maps clicks, drag, mouse buttons, cursor position and typing onto the sandbox', async () => {
    const sandbox = new FakeSandbox()
    await executeAction(parsed('left_click', { coordinate: [1, 2] }), sandbox, null)
    await executeAction(parsed('triple_click', { coordinate: [3, 4] }), sandbox, null)
    await executeAction(parsed('left_click_drag', { start_coordinate: [1, 1], coordinate: [9, 9] }), sandbox, null)
    await executeAction(parsed('left_mouse_down', { coordinate: [5, 5] }), sandbox, null)
    await executeAction(parsed('left_mouse_up', {}), sandbox, null)
    const position = await executeAction(parsed('cursor_position', {}), sandbox, null)
    await executeAction(parsed('type', { text: 'abc' }), sandbox, null)
    expect(sandbox.calls).toEqual([
      { method: 'leftClick', args: [[1, 2]] },
      { method: 'tripleClick', args: [[3, 4]] },
      { method: 'drag', args: [[1, 1], [9, 9]] },
      { method: 'moveMouse', args: [[5, 5]] },
      { method: 'mouseDown', args: [] },
      { method: 'mouseUp', args: [] },
      { method: 'cursorPosition', args: [] },
      { method: 'type', args: ['abc'] },
    ])
    expect(position).toEqual({ text: '[5, 6]' })
  })
})

// One approval must cover one activation, and a repeated action that fails part-way must say how
// far it got.
describe('activationCount', () => {
  it.each<[string, unknown, number]>([
    ['key', { text: 'Return' }, 1],
    ['key', { text: 'Return', repeat: 3 }, 3],
    ['hold_key', { text: 'Return', duration: 1 }, Number.POSITIVE_INFINITY],
    ['type', { text: 'hello' }, 0],
    ['type', { text: 'hello\n' }, 1],
    ['type', { text: 'a\r\nb\n' }, 2],
    ['double_click', {}, 2],
    ['triple_click', {}, 3],
    ['left_click', { coordinate: [1, 1] }, 1],
  ])('%s %j activates %d time(s)', (name, input, expected) => {
    expect(activationCount(parsed(name, input))).toBe(expected)
  })
})

describe('a repeated key that fails part-way', () => {
  it('throws a PartialActionError that carries the cause and the count when some presses went through', async () => {
    const sandbox = new FakeSandbox()
    const cause = new Error('deadline exceeded')
    let n = 0
    sandbox.press = async () => {
      n += 1
      if (n === 3) throw cause
    }
    const failure = await executeAction(parsed('key', { text: 'Down', repeat: 5 }), sandbox, null).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(PartialActionError)
    expect(failure).toMatchObject({ cause, done: 2, total: 5 })
  })

  it('rethrows the failure itself when the first press fails, so nothing is reported as sent', async () => {
    const sandbox = new FakeSandbox()
    const cause = new Error('deadline exceeded')
    sandbox.press = async () => {
      throw cause
    }
    await expect(executeAction(parsed('key', { text: 'Down', repeat: 5 }), sandbox, null)).rejects.toBe(cause)
  })
})

describe('loggableInput', () => {
  it('replaces typed text and single-character keys by their length, keeps the rest', () => {
    expect(loggableInput(parsed('type', { text: 'hunter2' }))).toEqual({ text: '[7 characters]' })
    expect(loggableInput(parsed('key', { text: 'h' }))).toEqual({ text: '[1 character]' })
    expect(loggableInput(parsed('hold_key', { text: '7', duration: 1 }))).toEqual({ text: '[1 character]', duration: 1 })
    expect(loggableInput(parsed('key', { text: 'ctrl+s', repeat: 2 }))).toEqual({ text: 'ctrl+s', repeat: 2 })
    expect(loggableInput(parsed('left_click', { coordinate: [1, 2] }))).toEqual({ coordinate: [1, 2] })
  })
})

describe('describeAction', () => {
  it('never includes typed text or a single-character key', () => {
    expect(describeAction(parsed('type', { text: 'hunter2' }))).toBe('typing 7 characters')
    expect(describeAction(parsed('key', { text: 'h' }))).toBe('key [1 character]')
    expect(describeAction(parsed('hold_key', { text: '7', duration: 1 }))).toBe('hold_key [1 character]')
    expect(describeAction(parsed('key', { text: 'ctrl+s' }))).toBe('key ctrl+s')
    expect(describeAction(parsed('left_click', { coordinate: [1, 2] }))).toBe('left_click at [1, 2]')
  })
})
