import { describe, expect, it } from 'vitest'
import { ElementInfo, Health, PageState } from './port'
import { shellQuote } from './shell'

describe('ElementInfo schema (what the gate trusts)', () => {
  it('accepts an unknown target and a full element', () => {
    expect(ElementInfo.safeParse({ target: 'unknown', reason: 'cross-origin frame', url: 'https://example.com', title: 'x' }).success).toBe(true)
    expect(
      ElementInfo.safeParse({
        target: 'element',
        tag: 'button',
        type: 'submit',
        role: null,
        name: 'Send',
        inForm: true,
        isSubmit: true,
        autocomplete: null,
        inputMode: null,
        pattern: null,
        maxLength: null,
        url: 'https://example.com/form',
        title: 'Form',
      }).success,
    ).toBe(true)
  })

  it('rejects a response that could be mistaken for a harmless element', () => {
    expect(ElementInfo.safeParse({ tag: 'button', name: 'Send' }).success).toBe(false) // no target
    expect(ElementInfo.safeParse({ target: 'element', tag: 'button' }).success).toBe(false) // fields missing
    expect(ElementInfo.safeParse({ target: 'elem', reason: 'x', url: '', title: '' }).success).toBe(false) // wrong literal
    expect(ElementInfo.safeParse({ target: 'element', tag: 'button', type: null, role: null, name: 'Send', inForm: 'yes', isSubmit: false, autocomplete: null, inputMode: null, pattern: null, maxLength: null, url: '', title: '' }).success).toBe(false)
    expect(ElementInfo.safeParse(null).success).toBe(false)
  })
})

describe('PageState and Health schemas', () => {
  it('require every field with the right type', () => {
    expect(PageState.safeParse({ url: 'https://example.com', fingerprint: 'a|b|1', unsafe: false }).success).toBe(true)
    expect(PageState.safeParse({ url: 'https://example.com', fingerprint: 'a', unsafe: 'no' }).success).toBe(false)
    expect(PageState.safeParse({ url: 'https://example.com' }).success).toBe(false)
    expect(Health.safeParse({ ok: true, cdp: false }).success).toBe(true)
    expect(Health.safeParse({ ok: 'true', cdp: true }).success).toBe(false)
  })
})

describe('shellQuote', () => {
  it('turns quotes and metacharacters into one inert argument', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote('https://example.com/?a=1; rm -rf / && echo $HOME `id`')).toBe("'https://example.com/?a=1; rm -rf / && echo $HOME `id`'")
    expect(shellQuote('')).toBe("''")
  })
})
