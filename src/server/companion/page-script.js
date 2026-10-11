// Runs inside the page through CDP Runtime.evaluate. companion.py wraps it in an IIFE and calls
// one of the __dobot functions. Screen coordinates come from the screenshot; toPage() turns them
// into viewport coordinates for the visible page. Everything returned is a plain object.
const __dobot = (() => {
  const CONTROL = 'button, input, a, [role=button], select, textarea'
  // Chrome's frame above the page — tab strip and address bar — is 91 px on the sandbox's screen.
  // The gap between the outer and the inner height also grows when something takes room at the
  // bottom of the window (DevTools docked there, a bottom bar), which shifts the mapping without
  // moving the page's top edge: a control at the top of the page, within the height of that bottom
  // bar, would then look like frame.
  // The bound therefore sits just above the plain frame, so at most about 20 px of bottom chrome
  // can pass, and a bookmarks bar or an infobar (which only add space at the top) push the point
  // to unknown, which fails closed.
  const MAX_BROWSER_FRAME = 110
  const DIGIT_PATTERN = /^[0-9d\\\[\]{},\-*+]+$/

  function toPage(x, y) {
    const dpr = window.devicePixelRatio || 1
    const toolbar = window.outerHeight - window.innerHeight
    return [x / dpr - window.screenX, y / dpr - window.screenY - toolbar]
  }

  function isElement(node) {
    return !!node && node.nodeType === 1
  }

  // Follows same-origin frames and open shadow roots down to the leaf under the point.
  function descend(doc, x, y) {
    let el = doc.elementFromPoint(x, y)
    for (let depth = 0; isElement(el) && depth < 20; depth++) {
      const tag = el.tagName.toUpperCase()
      if (tag === 'IFRAME' || tag === 'FRAME') {
        const inner = el.contentDocument
        if (!inner) return { unknown: 'cross-origin frame' }
        const r = el.getBoundingClientRect()
        return descend(inner, x - r.left - el.clientLeft, y - r.top - el.clientTop)
      }
      if (el.shadowRoot) {
        const innerEl = el.shadowRoot.elementFromPoint(x, y)
        if (isElement(innerEl) && innerEl !== el) {
          el = innerEl
          continue
        }
      }
      break
    }
    return isElement(el) ? el : { unknown: 'no element' }
  }

  function text(node) {
    return ((node && node.textContent) || '').replace(/\s+/g, ' ').trim()
  }

  function accessibleName(c) {
    const doc = c.ownerDocument
    let name = c.getAttribute('aria-label') || ''
    if (!name.trim()) {
      const ids = c.getAttribute('aria-labelledby')
      if (ids) name = ids.split(/\s+/).map((id) => text(doc.getElementById(id))).filter(Boolean).join(' ')
    }
    if (!name.trim()) {
      const tag = c.tagName.toLowerCase()
      const type = (c.getAttribute('type') || '').toLowerCase()
      if (tag === 'input' && (type === 'submit' || type === 'button' || type === 'image' || type === 'reset')) {
        name = c.value || c.getAttribute('alt') || ''
      }
    }
    if (!name.trim() && c.id) {
      const label = doc.querySelector('label[for="' + CSS.escape(c.id) + '"]')
      if (label) name = text(label)
    }
    if (!name.trim()) name = text(c)
    if (!name.trim()) name = c.getAttribute('placeholder') || ''
    if (!name.trim()) name = c.getAttribute('title') || ''
    return name.replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  function isSubmitControl(c, tag, type) {
    if (tag === 'button') {
      if ((type ?? 'submit') !== 'submit') return false
      // A <button> with no type submits only when it belongs to a form.
      return type === 'submit' || !!c.form
    }
    if (tag === 'input') return type === 'submit' || type === 'image'
    return false
  }

  function describe(el) {
    const control = el.closest(CONTROL) || el
    const tag = control.tagName.toLowerCase()
    const typeAttr = control.getAttribute('type')
    const type = typeAttr ? typeAttr.toLowerCase() : null
    const maxLength = typeof control.maxLength === 'number' && control.maxLength > 0 ? control.maxLength : null
    return {
      target: 'element',
      tag,
      type,
      role: control.getAttribute('role'),
      name: accessibleName(control),
      inForm: !!control.closest('form'),
      isSubmit: isSubmitControl(control, tag, type),
      autocomplete: control.getAttribute('autocomplete'),
      // A password field by more than its type: see isPasswordField.
      isPassword: tag === 'input' && isPasswordField(control, true),
      // Text the user edits in place (a mail body, a rich comment box), where a send shortcut acts.
      editable: !!el.isContentEditable,
      inputMode: control.getAttribute('inputmode'),
      pattern: control.getAttribute('pattern'),
      maxLength,
      url: location.href,
      title: document.title,
    }
  }

  function unknownResult(reason) {
    return { target: 'unknown', reason, url: location.href, title: document.title }
  }

  // The mapping holds on the sandbox's screen at 100 % zoom, where one screen pixel is one page
  // pixel. Page zoom changes the ratio and the inner height but not the outer height, so a point
  // would land on another element. A zoomed page fails closed: every activation asks the user.
  function zoomed() {
    return (window.devicePixelRatio || 1) !== 1
  }

  function elementAt(x, y) {
    if (zoomed()) return unknownResult('the page is zoomed, so a screen point cannot be mapped to it')
    const [px, py] = toPage(x, y)
    if (py < 0) {
      // Above the viewport is the browser's own frame — tab strip, address bar, a bubble — where no
      // page control can be, but only while the frame height is plausible. Beyond that, and beside
      // or below the page, the point fails closed like any other target that cannot be read.
      if (window.outerHeight - window.innerHeight <= MAX_BROWSER_FRAME) {
        return { target: 'browser-ui', reason: 'above the page', url: location.href, title: document.title }
      }
      return unknownResult('above the page, and the browser frame is too tall to trust')
    }
    const found = descend(document, px, py)
    if (!isElement(found)) return unknownResult(found.unknown || 'no element')
    return describe(found)
  }

  // The element that has the focus, following open shadow roots and same-origin frames down to
  // the leaf. `unreadable` when the focus sits inside a frame whose document cannot be read.
  function focusedLeaf() {
    let el = document.activeElement
    for (let depth = 0; isElement(el); depth++) {
      // Still descending at the cap: what lies below cannot be read, and is reported as such.
      if (depth >= 20) return { el: null, unreadable: true }
      if (el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement
        continue
      }
      const tag = el.tagName.toUpperCase()
      if (tag === 'IFRAME' || tag === 'FRAME') {
        const inner = el.contentDocument
        if (!inner) return { el: null, unreadable: true }
        if (isElement(inner.activeElement)) {
          el = inner.activeElement
          continue
        }
      }
      break
    }
    return { el: isElement(el) ? el : null, unreadable: false }
  }

  function activeElement() {
    const focus = focusedLeaf()
    if (focus.unreadable) return unknownResult('cross-origin frame')
    if (!focus.el) return unknownResult('no element')
    return describe(focus.el)
  }

  // Every input the script can read: the document's own, then those inside its open shadow roots
  // and same-origin frames, recursively. A visible frame whose document cannot be read is counted
  // as unreadable instead (a hidden one holds nothing on screen), and so is anything below the
  // depth cap: what the script did not read is never reported as read.
  function collectInputs(root, found, depth) {
    for (const input of root.querySelectorAll('input')) found.inputs.push(input)
    const hosts = Array.from(root.querySelectorAll('*')).filter((host) => host.shadowRoot)
    const frames = Array.from(root.querySelectorAll('iframe, frame')).filter((frame) => frame.getClientRects().length > 0)
    if (depth >= 10) {
      if (hosts.length + frames.length > 0) found.unreadable += 1
      return
    }
    for (const host of hosts) collectInputs(host.shadowRoot, found, depth + 1)
    for (const frame of frames) {
      const inner = frame.contentDocument
      if (inner) collectInputs(inner, found, depth + 1)
      else found.unreadable += 1
    }
  }

  // A field that was a password field stays one after a "show password" control has turned it into
  // a text field: from then on its value can be read on the screen. Each call of this script starts
  // anew, so the fields it has seen as passwords are kept on the page's global object. A page can
  // also put a new text field in place of the old one; that one is known by the hints a sign-in form
  // carries for the browser's password manager, or by its name. The hints count on a text field
  // only, so a "remember my password" checkbox is not taken for the password. The name or id must
  // end in the word, a number or a bracket aside: `loginPassword`, `user[pwd]` and `password2` are
  // passwords; `password_hint` and `passwordless_email` are not. A field taken for a password by
  // mistake costs the human one step: the hand-back waits until that field is empty.
  const PASSWORD_HINT = /^(current|new)-password$/
  const PASSWORD_NAME = /(?:password|passwd|pwd)\d*\]?$/i

  function seenAsPassword() {
    if (!(globalThis.__dobotPasswordFields instanceof WeakSet)) globalThis.__dobotPasswordFields = new WeakSet()
    return globalThis.__dobotPasswordFields
  }

  // `forTyping` is the question of the typing guard, which is narrower in one point. Many pages put
  // `autocomplete="new-password"` on plain text fields only to switch the browser's autofill off. For
  // the hand-back that mistake costs one step. For typing it would cost the whole form: the bot could
  // never fill such a field. So the `new-password` hint alone does not stop typing.
  function isPasswordField(i, forTyping) {
    const type = (i.getAttribute('type') || 'text').toLowerCase()
    if (type === 'password') {
      seenAsPassword().add(i)
      return true
    }
    if (seenAsPassword().has(i)) return true
    if (type !== 'text') return false
    const hints = (i.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/)
    if (hints.some((hint) => (forTyping ? hint === 'current-password' : PASSWORD_HINT.test(hint)))) return true
    return PASSWORD_NAME.test(i.getAttribute('name') || '') || PASSWORD_NAME.test(i.getAttribute('id') || '')
  }

  // A password or one-time-code field, or a short numeric field, holding a value the next
  // screenshot would carry.
  function holdsSecret(i) {
    if ((i.value || '') === '') return false
    if (isPasswordField(i)) return true
    if ((i.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).includes('one-time-code')) return true
    const numeric = (i.getAttribute('inputmode') || '').toLowerCase() === 'numeric' || DIGIT_PATTERN.test(i.getAttribute('pattern') || '')
    return numeric && i.maxLength > 0 && i.maxLength <= 8
  }

  // unsafe: a secret field the script can reach holds a value (`secret-field`), or the focus — where
  // the human last typed — sits inside a frame the script cannot read, so no such field can be ruled
  // out there (`unreadable-frame`). An unreadable frame nobody is typing in does not block by itself:
  // many pages carry one (an advert, a challenge widget), and refusing every hand-back on them would
  // leave the human no way out. `unreadable` says how many regions were skipped; the server keeps
  // the page-changed check in force while it is above zero.
  function pageState() {
    const found = { inputs: [], unreadable: 0 }
    collectInputs(document, found, 0)
    // Every password field is noted now, empty or hidden too: the hand-back question comes every few
    // seconds, so the field is known before anyone presses "show".
    for (const input of found.inputs) isPasswordField(input)
    const inputs = found.inputs.filter((i) => i.getClientRects().length > 0)
    const unsafeReason = inputs.some(holdsSecret) ? 'secret-field' : focusedLeaf().unreadable ? 'unreadable-frame' : null
    return {
      url: location.href,
      fingerprint: location.href + '|' + document.title + '|' + inputs.length,
      unsafe: unsafeReason !== null,
      unsafeReason,
      unreadable: found.unreadable,
    }
  }

  // Screen point to viewport point, for a CDP Input.dispatchMouseEvent from the companion.
  function toPagePoint(x, y) {
    const [px, py] = toPage(x, y)
    return { x: px, y: py }
  }

  // The file input behind the control at the point: the input itself, its label, an element
  // with a `for`, or the only file input of the enclosing form (or document).
  function fileInputAt(x, y) {
    if (zoomed()) return null
    const [px, py] = toPage(x, y)
    const el = descend(document, px, py)
    if (!isElement(el)) return null
    const doc = el.ownerDocument
    if (el.matches('input[type=file]')) return el
    const label = el.closest('label')
    if (label && label.control && label.control.matches('input[type=file]')) return label.control
    const forEl = el.closest('[for]')
    if (forEl) {
      const target = doc.getElementById(forEl.getAttribute('for'))
      if (target && target.matches('input[type=file]')) return target
    }
    // With several file inputs in reach and none tied to the control, a guess could put the file
    // into the wrong one; no answer leaves it to the click and the file chooser it opens.
    const scope = el.closest('form') || doc
    const inputs = scope.querySelectorAll('input[type=file]')
    return inputs.length === 1 ? inputs[0] : null
  }

  return { elementAt, activeElement, pageState, fileInputAt, toPagePoint }
})()
