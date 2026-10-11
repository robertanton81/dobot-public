import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

// page-script.js runs inside the page through CDP. Here it is evaluated with a stub window,
// document and location, which is enough for the coordinate mapping and the target kinds.
const source = readFileSync(new URL('./page-script.js', import.meta.url), 'utf8')

type State = { url: string; fingerprint: string; unsafe: boolean; unsafeReason: string | null; unreadable: number }
type Dobot = { elementAt(x: number, y: number): { target: string; reason?: string; name?: string }; pageState(): State; activeElement(): { target: string; reason?: string; isPassword?: boolean } }
type Win = { outerHeight: number; innerHeight: number; screenY?: number }

function load(win: Win, elementFromPoint: (x: number, y: number) => unknown = () => null, document: unknown = fakeDoc({})): Dobot {
  const g = globalThis as Record<string, unknown>
  g.window = { devicePixelRatio: 1, screenX: 0, screenY: 27, outerWidth: 1280, innerWidth: 1280, ...win }
  g.document = { ...(document as object), elementFromPoint }
  g.location = { href: 'https://example.com/apply' }
  return new Function(source + '\nreturn __dobot')() as Dobot
}

// A document, or a shadow root, holding inputs, shadow hosts and frames; answers the three
// selectors pageState() asks for. Frames and hosts are elements of the document too ('*').
function fakeDoc(parts: { inputs?: unknown[]; hosts?: unknown[]; frames?: unknown[]; active?: unknown }): unknown {
  const inputs = parts.inputs ?? []
  const hosts = parts.hosts ?? []
  const frames = parts.frames ?? []
  return {
    title: 'Form',
    activeElement: parts.active ?? null,
    querySelectorAll: (selector: string) => (selector === 'input' ? inputs : selector === '*' ? [...inputs, ...hosts, ...frames] : selector === 'iframe, frame' ? frames : []),
  }
}

/** Enough of an <input> for pageState() and, when it is the focused leaf, for describe(). */
function fakeInput(attrs: Record<string, string>, value: string, visible = true): unknown {
  const el: Record<string, unknown> = {
    nodeType: 1,
    tagName: 'INPUT',
    id: '',
    textContent: '',
    value,
    maxLength: attrs.maxlength === undefined ? -1 : Number(attrs.maxlength),
    shadowRoot: null,
    ownerDocument: { querySelector: () => null, getElementById: () => null },
    getAttribute: (name: string) => attrs[name] ?? null,
    getClientRects: () => (visible ? [1] : []),
    closest: () => null,
  }
  return el
}

/** `inner` null is a cross-origin frame: its document cannot be read. */
function fakeFrame(inner: unknown, visible = true): unknown {
  return { nodeType: 1, tagName: 'IFRAME', contentDocument: inner, shadowRoot: null, getClientRects: () => (visible ? [1] : []) }
}

function fakeHost(shadowRoot: unknown): unknown {
  return { nodeType: 1, tagName: 'DIV', shadowRoot, getClientRects: () => [1] }
}

/** A minimal DOM element: enough for describe() and accessibleName(). */
function fakeButton(text: string): unknown {
  const el: Record<string, unknown> = {
    nodeType: 1,
    tagName: 'BUTTON',
    id: '',
    form: null,
    textContent: text,
    shadowRoot: null,
    getAttribute: () => null,
    matches: () => false,
    closest: (selector: string) => (selector.includes('form') ? null : el),
  }
  el.ownerDocument = (globalThis as Record<string, unknown>).document
  return el
}

afterEach(() => {
  for (const key of ['window', 'document', 'location']) delete (globalThis as Record<string, unknown>)[key]
})

describe('elementAt', () => {
  // A maximised Chrome at y=27 with a 91 px tab strip and address bar.
  const chrome = { outerHeight: 753, innerHeight: 662 }

  it('reports the browser frame above the page as browser-ui when the frame height is plausible', () => {
    const dobot = load(chrome)
    expect(dobot.elementAt(490, 90)).toMatchObject({ target: 'browser-ui', reason: 'above the page' }) // the address bar
    expect(dobot.elementAt(200, 47)).toMatchObject({ target: 'browser-ui' }) // the tab strip
  })

  it('fails closed on a zoomed page: at 90 % a screen point would land on another element', () => {
    const button = { nodeType: 1, tagName: 'BUTTON' }
    const dobot = load({ ...chrome, innerHeight: 735, devicePixelRatio: 0.9 } as Win, () => button)
    expect(dobot.elementAt(640, 400)).toMatchObject({ target: 'unknown', reason: expect.stringContaining('zoomed') })
  })

  it('fails closed above the page when something below the page inflates the frame height (DevTools docked at the bottom)', () => {
    const dobot = load({ outerHeight: 753, innerHeight: 300 })
    // With a 453 px frame, a real control at screen y=400 maps above the page; it must not become browser-ui.
    expect(dobot.elementAt(640, 400)).toMatchObject({ target: 'unknown' })
  })

  it('fails closed for a short bottom bar too: a control 40 px into the page must not pass as frame', () => {
    // A 60 px bar at the bottom makes the gap 151 px without moving the page's top edge (screen y=118).
    const dobot = load({ outerHeight: 753, innerHeight: 602 })
    expect(dobot.elementAt(640, 158)).toMatchObject({ target: 'unknown' })
  })

  it('a bookmarks bar or an infobar above the page pushes a frame click to unknown, never to a page element', () => {
    const dobot = load({ outerHeight: 753, innerHeight: 630 }) // 123 px of frame
    expect(dobot.elementAt(490, 90)).toMatchObject({ target: 'unknown' })
  })

  it('resolves a point inside the page through elementFromPoint, and a point below the page is unknown', () => {
    const button = fakeButton('Odeslat zájem')
    const dobot = load(chrome, (_x, y) => (y >= 0 && y <= 662 ? button : null))
    expect(dobot.elementAt(600, 500)).toMatchObject({ target: 'element', name: 'Odeslat zájem' }) // page y = 500 - 27 - 91
    expect(dobot.elementAt(600, 790)).toMatchObject({ target: 'unknown' }) // page y = 672, past the viewport
  })
})

// pageState() reads same-origin frames and open shadow roots too. If it inspected only the top
// document, a password typed into one of them would pass the hand-back check with its value still
// on screen.
describe('pageState', () => {
  const chrome = { outerHeight: 753, innerHeight: 662 }
  const password = (value: string) => fakeInput({ type: 'password' }, value)
  const code = (value: string) => fakeInput({ type: 'text', autocomplete: 'one-time-code' }, value)

  it('a plain page with an empty password field is safe, and its fingerprint counts the visible inputs', () => {
    const dobot = load(chrome, () => null, fakeDoc({ inputs: [password(''), fakeInput({ type: 'text' }, 'x'), fakeInput({ type: 'text' }, 'x', false)] }))
    expect(dobot.pageState()).toEqual({ url: 'https://example.com/apply', fingerprint: 'https://example.com/apply|Form|2', unsafe: false, unsafeReason: null, unreadable: 0 })
  })

  // A "show password" control turns the field into a text field, and the value is then on the screen.
  it('a password field that was turned into a text field is still a secret, because the script saw it as a password before', () => {
    const attrs: Record<string, string> = { type: 'password' }
    const field = fakeInput(attrs, 'hunter2')
    const dobot = load(chrome, () => null, fakeDoc({ inputs: [field] }))
    expect(dobot.pageState()).toMatchObject({ unsafe: true, unsafeReason: 'secret-field' })
    attrs.type = 'text'
    // A later call is a new evaluation of the script in the same page.
    const later = load(chrome, () => null, fakeDoc({ inputs: [field] }))
    expect(later.pageState()).toMatchObject({ unsafe: true, unsafeReason: 'secret-field' })
  })

  it('notes an empty or hidden password field too, so a reveal after typing is caught', () => {
    const attrs: Record<string, string> = { type: 'password' }
    const field = fakeInput(attrs, '') as { value: string }
    expect(load(chrome, () => null, fakeDoc({ inputs: [field] })).pageState()).toMatchObject({ unsafe: false })
    attrs.type = 'text'
    field.value = 'hunter2'
    expect(load(chrome, () => null, fakeDoc({ inputs: [field] })).pageState()).toMatchObject({ unsafe: true, unsafeReason: 'secret-field' })
  })

  it('a new text field put in place of the password field is known by its password-manager hint or by its name', () => {
    const fields: Record<string, string>[] = [{ type: 'text', autocomplete: 'current-password' }, { type: 'text', autocomplete: 'section-login new-password' }, { type: 'text', name: 'Passwd' }, { type: 'text', id: 'login-pwd' }, { type: 'text', name: 'loginPassword' }, { type: 'text', name: 'user[password]' }, { type: 'text', name: 'password2' }, { autocomplete: 'current-password' }]
    for (const attrs of fields) {
      const dobot = load(chrome, () => null, fakeDoc({ inputs: [fakeInput(attrs, 'hunter2')] }))
      expect(dobot.pageState(), JSON.stringify(attrs)).toMatchObject({ unsafe: true, unsafeReason: 'secret-field' })
    }
  })

  it('does not take a checkbox or an empty text field for a password because of its name', () => {
    const remember = fakeInput({ type: 'checkbox', name: 'rememberPassword' }, 'on')
    const empty = fakeInput({ type: 'text', name: 'password' }, '')
    const plain = fakeInput({ type: 'text', name: 'city' }, 'Prague')
    // The word stands inside the name, not at its end: these are no passwords, and a human who typed
    // into one must not be held on the screen for it.
    const near = ['password_hint', 'passwordless_email', 'pwd-reset-email', 'forgot-pwd-address'].map((name) => fakeInput({ type: 'text', name }, 'someone@example.com'))
    expect(load(chrome, () => null, fakeDoc({ inputs: [remember, empty, plain, ...near] })).pageState()).toMatchObject({ unsafe: false, unsafeReason: null })
  })

  it('knows a one-time-code field whose hint stands among other words', () => {
    const field = fakeInput({ type: 'text', autocomplete: 'section-login One-Time-Code' }, '123456')
    expect(load(chrome, () => null, fakeDoc({ inputs: [field] })).pageState()).toMatchObject({ unsafe: true, unsafeReason: 'secret-field' })
  })

  it('tells the typing guard that the focused field is a password, also after it was made visible', () => {
    const attrs: Record<string, string> = { type: 'password', 'aria-label': 'Password' }
    const field = fakeInput(attrs, '')
    expect(load(chrome, () => null, fakeDoc({ inputs: [field], active: field })).activeElement()).toMatchObject({ target: 'element', type: 'password', isPassword: true })
    attrs.type = 'text'
    expect(load(chrome, () => null, fakeDoc({ inputs: [field], active: field })).activeElement()).toMatchObject({ target: 'element', type: 'text', isPassword: true })
    const plain = fakeInput({ type: 'text', 'aria-label': 'City' }, '')
    expect(load(chrome, () => null, fakeDoc({ inputs: [plain], active: plain })).activeElement()).toMatchObject({ target: 'element', isPassword: false })
    // A plain text field that only switches autofill off stays fillable, but its value still holds the hand-back.
    const noAutofill = fakeInput({ type: 'text', name: 'company', autocomplete: 'new-password' }, 'Acme')
    expect(load(chrome, () => null, fakeDoc({ inputs: [noAutofill], active: noAutofill })).activeElement()).toMatchObject({ target: 'element', isPassword: false })
    expect(load(chrome, () => null, fakeDoc({ inputs: [noAutofill] })).pageState()).toMatchObject({ unsafe: true })
  })

  it('a password with a value inside a same-origin frame makes the page unsafe', () => {
    const dobot = load(chrome, () => null, fakeDoc({ frames: [fakeFrame(fakeDoc({ inputs: [password('hunter2')] }))] }))
    expect(dobot.pageState()).toMatchObject({ unsafe: true, unsafeReason: 'secret-field' })
  })

  it('a one-time code with a value inside an open shadow root makes the page unsafe, two levels down too', () => {
    const inner = fakeDoc({ hosts: [fakeHost(fakeDoc({ inputs: [code('123456')] }))] })
    const dobot = load(chrome, () => null, fakeDoc({ hosts: [fakeHost(inner)] }))
    expect(dobot.pageState()).toMatchObject({ unsafe: true, unsafeReason: 'secret-field' })
  })

  it('the focus inside a frame that cannot be read makes the page unsafe, because no secret can be ruled out there', () => {
    const crossOrigin = fakeFrame(null)
    const dobot = load(chrome, () => null, fakeDoc({ frames: [crossOrigin], active: crossOrigin }))
    expect(dobot.pageState()).toMatchObject({ unsafe: true, unsafeReason: 'unreadable-frame', unreadable: 1 })
    expect(dobot.activeElement()).toMatchObject({ target: 'unknown', reason: 'cross-origin frame' })
  })

  it('a visible frame that cannot be read is counted, not blocking, while the focus is elsewhere; a hidden one is neither', () => {
    const dobot = load(chrome, () => null, fakeDoc({ inputs: [fakeInput({ type: 'text' }, 'a')], frames: [fakeFrame(null), fakeFrame(null, false)] }))
    expect(dobot.pageState()).toMatchObject({ unsafe: false, unsafeReason: null, unreadable: 1 })
  })

  it('follows the focus through a shadow root into a same-origin frame, down to the focused field', () => {
    const field = fakeInput({ type: 'password', 'aria-label': 'Heslo' }, '')
    const framed = fakeDoc({ inputs: [field], active: field })
    const frame = fakeFrame(framed)
    const shadow = fakeDoc({ frames: [frame], active: frame })
    const host = fakeHost(shadow)
    const dobot = load(chrome, () => null, fakeDoc({ hosts: [host], active: host }))
    expect(dobot.pageState()).toMatchObject({ unsafe: false, unreadable: 0 })
    expect(dobot.activeElement()).toMatchObject({ target: 'element', tag: 'input', type: 'password', name: 'Heslo' })
  })

  it('reads ten levels of nesting, and reports what lies deeper as unreadable instead of as read', () => {
    const nest = (levels: number, leaf: unknown): unknown => {
      let doc = leaf
      for (let i = 0; i < levels; i++) doc = fakeDoc({ hosts: [fakeHost(doc)] })
      return doc
    }
    const atTen = load(chrome, () => null, nest(10, fakeDoc({ inputs: [password('deep')] })))
    expect(atTen.pageState()).toMatchObject({ unsafe: true, unsafeReason: 'secret-field', unreadable: 0 })
    const atTwelve = load(chrome, () => null, nest(12, fakeDoc({ inputs: [password('deeper')] })))
    expect(atTwelve.pageState()).toMatchObject({ unsafe: false, unreadable: 1 })
  })

  it('a focus still descending at the twentieth level is unreadable, so it fails closed', () => {
    let doc: unknown = fakeDoc({ inputs: [password('')] })
    for (let i = 0; i < 25; i++) {
      const host = fakeHost(doc)
      doc = fakeDoc({ hosts: [host], active: host })
    }
    const dobot = load(chrome, () => null, doc)
    expect(dobot.pageState()).toMatchObject({ unsafe: true, unsafeReason: 'unreadable-frame' })
  })
})
