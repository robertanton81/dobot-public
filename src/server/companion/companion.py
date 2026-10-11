#!/usr/bin/env python3
"""The in-sandbox companion: a small HTTP server that answers DOM questions over CDP.

It runs inside the E2B desktop sandbox next to Chrome, because Chrome refuses DevTools requests
whose Host header is not localhost. The platform reaches it through the sandbox's public port
proxy, which has no authentication of its own, so every request must carry the bearer token the
platform generated for this sandbox. Standard library plus websocket-client.

Endpoints (JSON in, JSON out):
  GET  /health                  {ok, cdp}
  POST /element-at {x, y}       ElementInfo for the element under a screen point
  POST /active-element {}       ElementInfo for the focused element
  POST /page-state {}           {url, fingerprint, unsafe}
  POST /set-files {x, y, path, click}  attaches a workspace file to the upload control under the point
                                       (the DOM input if one exists; only with click=true may the
                                       companion click the control and intercept the file chooser
                                       it opens, and only the platform decides that)
"""
import hmac
import json
import os
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from websocket import create_connection

TOKEN = os.environ['COMPANION_TOKEN']
PORT = int(os.environ['COMPANION_PORT'])
CDP_HTTP = 'http://127.0.0.1:9222'
WORKSPACE = os.path.realpath('/home/user/workspace') + os.sep
MAX_BODY_BYTES = 16 * 1024
CDP_CALL_DEADLINE_S = 5.0
FILE_CHOOSER_DEADLINE_S = 5.0
MAX_BUFFERED_EVENTS = 50
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'page-script.js'), encoding='utf-8') as f:
    PAGE_SCRIPT = f.read()

ELEMENT_ENDPOINTS = {'/element-at': 'elementAt', '/active-element': 'activeElement'}


def log(msg, **fields):
    line = {'t': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'msg': msg}
    line.update(fields)
    print(json.dumps(line), flush=True)


class PageScriptError(Exception):
    pass


class Cdp:
    """One WebSocket per request; nothing survives a pause."""

    def __init__(self, ws_url):
        self.ws = create_connection(ws_url, timeout=CDP_CALL_DEADLINE_S, suppress_origin=True)
        self.n = 0
        self.events = []  # events that arrived while waiting for a call's answer

    def _note_event(self, msg):
        self.events.append(msg)
        if len(self.events) > MAX_BUFFERED_EVENTS:
            del self.events[0]

    def call(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params or {}}))
        deadline = time.monotonic() + CDP_CALL_DEADLINE_S
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError('cdp call deadline exceeded')
            msg = json.loads(self.ws.recv())
            if 'method' in msg:
                self._note_event(msg)  # keep it: wait_event may be looking for it
                continue
            if msg.get('id') != self.n:
                continue  # the answer to another id
            if 'error' in msg:
                raise RuntimeError(msg['error'].get('message', 'cdp error'))
            return msg.get('result', {})

    def wait_event(self, method, timeout_s):
        """Params of the first matching event, buffered or incoming. Raises TimeoutError."""
        for i, msg in enumerate(self.events):
            if msg.get('method') == method:
                return self.events.pop(i).get('params', {})
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            try:
                msg = json.loads(self.ws.recv())
            except Exception:
                break  # the socket timed out or closed; the deadline decides
            if msg.get('method') == method:
                return msg.get('params', {})
            if 'method' in msg:
                self._note_event(msg)
        raise TimeoutError('no ' + method)

    def evaluate(self, expression, by_value=True):
        res = self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': by_value, 'awaitPromise': False})
        if 'exceptionDetails' in res:
            # The description names the JS error and its line; without it a script bug in a frame
            # walk reads like a companion outage from the server.
            description = str(res['exceptionDetails'].get('exception', {}).get('description', ''))
            raise PageScriptError(('page script threw: ' + description)[:200] if description else 'page script threw')
        return res.get('result', {})

    def page_call(self, fn, args, by_value=True):
        expression = '(() => {' + PAGE_SCRIPT + '; return __dobot.' + fn + '(' + args + ') })()'
        return self.evaluate(expression, by_value)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def list_pages():
    # Safe: CDP_HTTP is a constant for Chrome's local debugging port inside the sandbox, never user input.
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected, python.lang.security.audit.insecure-transport.urllib.insecure-urlopen.insecure-urlopen
    with urllib.request.urlopen(CDP_HTTP + '/json', timeout=2) as r:
        targets = json.load(r)
    return [t for t in targets if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')]


def find_page_target():
    """The visible page, else the first page. Raises LookupError when Chrome has none."""
    pages = list_pages()
    if not pages:
        raise LookupError('no page target')
    for t in pages:
        cdp = None
        try:
            cdp = Cdp(t['webSocketDebuggerUrl'])
            res = cdp.evaluate('document.visibilityState')
            if res.get('value') == 'visible':
                return t
        except Exception:
            continue
        finally:
            if cdp:
                cdp.close()
    return pages[0]


def with_page(fn):
    """Runs fn(cdp) against the visible page on a fresh socket."""
    target = find_page_target()
    cdp = Cdp(target['webSocketDebuggerUrl'])
    try:
        return fn(cdp)
    finally:
        cdp.close()


def _set_files_on_existing_input(cdp, x, y, path):
    """The plain case: an <input type=file> already exists at or behind the point."""
    res = cdp.page_call('fileInputAt', '%d, %d' % (x, y), by_value=False)
    object_id = res.get('objectId')
    if not object_id:
        return False
    try:
        cdp.call('DOM.setFileInputFiles', {'files': [path], 'objectId': object_id})
    finally:
        try:
            cdp.call('Runtime.releaseObject', {'objectId': object_id})
        except Exception:
            pass
    return True


def _set_files_through_chooser(cdp, x, y, path):
    """The detached case: the control creates its file input only when it is clicked.

    Page.setInterceptFileChooserDialog stops Chrome from ever showing the native picker and
    makes it emit Page.fileChooserOpened instead, which names the input node. The click is a
    CDP mouse event on the page, not an xdotool click, so no dialog can appear even briefly.
    The platform refuses to call this on a send control before we get here.
    """
    point = cdp.page_call('toPagePoint', '%d, %d' % (x, y)).get('value')
    if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
        return False
    cdp.call('Page.enable')
    cdp.call('DOM.enable')
    # The arm call is inside the try: a CDP timeout can leave interception on even when the reply
    # never arrives, and interception left armed swallows the next real file dialog on this page.
    # Closing the socket ends the session and resets it too, but the explicit disarm does not
    # depend on that.
    try:
        cdp.call('Page.setInterceptFileChooserDialog', {'enabled': True})
        # Press and release are separate CDP calls. If the release is lost the page can believe the
        # button is still down until the next real input event; that is the model's next action.
        cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': point['x'], 'y': point['y'], 'button': 'left', 'buttons': 1, 'clickCount': 1})
        cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': point['x'], 'y': point['y'], 'button': 'left', 'buttons': 0, 'clickCount': 1})
        try:
            event = cdp.wait_event('Page.fileChooserOpened', FILE_CHOOSER_DEADLINE_S)
        except TimeoutError:
            log('set-files: the control opened no file chooser')
            return False
        node_id = event.get('backendNodeId')
        if node_id is None:
            # A chooser not backed by an <input type=file> (the File System Access API).
            log('set-files: the file chooser names no input node')
            return False
        cdp.call('DOM.setFileInputFiles', {'files': [path], 'backendNodeId': node_id})
        return True
    finally:
        try:
            cdp.call('Page.setInterceptFileChooserDialog', {'enabled': False})
        except Exception:
            pass


def set_files(x, y, path, click):
    """`click` comes from the platform, which has vetted the element under the point with its own
    gate rules. Without it the companion only looks for an input that already exists: an
    unvetted click is a gate bypass, whatever it turns out to land on."""

    def run(cdp):
        if _set_files_on_existing_input(cdp, x, y, path):
            return 200, {'ok': True, 'how': 'dom'}
        if not click:
            return 404, {'error': 'no file input'}
        if _set_files_through_chooser(cdp, x, y, path):
            return 200, {'ok': True, 'how': 'file-chooser'}
        return 404, {'error': 'no file input'}

    return with_page(run)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    timeout = 10  # socket timeout for the whole request, so a stalled client cannot hold a thread

    def log_message(self, format, *args):  # noqa: A002 - the default access log is replaced by log()
        pass

    def _json(self, status, body):
        data = json.dumps(body).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self):
        header = self.headers.get('Authorization', '')
        return hmac.compare_digest(header, 'Bearer ' + TOKEN)

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY_BYTES:
            raise ValueError('body too large')
        raw = self.rfile.read(length) if length > 0 else b''
        if not raw:
            return {}
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError('body must be an object')
        return body

    def do_GET(self):
        started = time.time()
        if not self._authorized():
            self._json(401, {'error': 'unauthorized'})
            return
        if self.path != '/health':
            self._json(404, {'error': 'not found'})
            return
        cdp_ok = False
        try:
            with_page(lambda cdp: cdp.evaluate('1 + 1'))
            cdp_ok = True
        except Exception as e:
            log('health: cdp check failed', error=type(e).__name__)
        self._json(200, {'ok': True, 'cdp': cdp_ok})
        log('request', method='GET', path=self.path, status=200, ms=int((time.time() - started) * 1000))

    def do_POST(self):
        started = time.time()
        if not self._authorized():
            self._json(401, {'error': 'unauthorized'})
            return
        try:
            body = self._body()
        except Exception as e:
            self._json(400, {'error': 'malformed body: ' + type(e).__name__})
            return
        status = 500
        try:
            status = self._handle(self.path, body)
        except Exception as e:
            log('request failed', path=self.path, error=type(e).__name__, detail=str(e)[:200])
            self._json(500, {'error': type(e).__name__, 'detail': str(e)[:200]})
        log('request', method='POST', path=self.path, status=status, ms=int((time.time() - started) * 1000))

    def _handle(self, path, body):
        if path in ELEMENT_ENDPOINTS:
            fn = ELEMENT_ENDPOINTS[path]
            try:
                if fn == 'elementAt':
                    x, y = int(body['x']), int(body['y'])
                    res = with_page(lambda cdp: cdp.page_call('elementAt', '%d, %d' % (x, y)))
                else:
                    res = with_page(lambda cdp: cdp.page_call('activeElement', ''))
                value = res.get('value')
                if not isinstance(value, dict) or 'target' not in value:
                    raise PageScriptError('malformed page script result')
                self._json(200, value)
            except Exception as e:
                # Fail closed: the gate treats an unknown target as a rule hit.
                self._json(200, {'target': 'unknown', 'reason': type(e).__name__, 'url': '', 'title': ''})
            return 200
        if path == '/page-state':
            try:
                res = with_page(lambda cdp: cdp.page_call('pageState', ''))
            except LookupError:
                self._json(503, {'error': 'no page target'})
                return 503
            value = res.get('value')
            if not isinstance(value, dict):
                raise PageScriptError('malformed page script result')
            self._json(200, value)
            return 200
        if path == '/set-files':
            x, y = int(body['x']), int(body['y'])
            # realpath follows symlinks, so a link inside the workspace cannot point outside it
            file_path = os.path.realpath(str(body['path']))
            if not file_path.startswith(WORKSPACE) or not os.path.isfile(file_path):
                self._json(404, {'error': 'file not found in the workspace'})
                return 404
            # Fail closed: only an explicit `click: true` from the platform allows the click.
            click = body.get('click') is True
            try:
                status, payload = set_files(x, y, file_path, click)
            except LookupError:
                self._json(503, {'error': 'no page target'})
                return 503
            self._json(status, payload)
            return status
        self._json(404, {'error': 'not found'})
        return 404


def main():
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    log('companion listening', port=PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
