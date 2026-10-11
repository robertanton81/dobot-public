#!/usr/bin/env python3
"""Tests for the parts of companion.py that are pure logic: the CDP message loop and the
arm/disarm pairing around file-chooser interception.

The companion is the one place in this project that clicks without going through the approval
gate in run.ts, so its click has to be exactly as careful as the gate is. Run with:

    python3 -m unittest discover -s src/server/companion -p 'companion_test.py'

`websocket-client` is installed inside the sandbox, not on the developer's machine, so a stub
module stands in for it here. Nothing in this file talks to Chrome or to a network.
"""
import json
import os
import sys
import types
import unittest

sys.modules.setdefault('websocket', types.ModuleType('websocket'))
sys.modules['websocket'].create_connection = lambda *args, **kwargs: None  # type: ignore[attr-defined]
os.environ.setdefault('COMPANION_TOKEN', 'test-token')
os.environ.setdefault('COMPANION_PORT', '8765')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import companion  # noqa: E402


class FakeWs:
    """A websocket that replays scripted messages. `sent` records what the Cdp wrote."""

    def __init__(self, messages):
        self.messages = [json.dumps(m) for m in messages]
        self.sent = []
        self.reads = 0

    def send(self, payload):
        self.sent.append(json.loads(payload))

    def recv(self):
        self.reads += 1
        if not self.messages:
            raise TimeoutError('the fake socket ran out of messages')
        return self.messages.pop(0)

    def close(self):
        pass


def cdp_over(messages):
    """A Cdp wired to a fake socket, without running __init__ (which would dial a real one)."""
    cdp = companion.Cdp.__new__(companion.Cdp)
    cdp.ws = FakeWs(messages)
    cdp.n = 0
    cdp.events = []
    return cdp


class CdpMessageLoop(unittest.TestCase):
    def test_an_event_arriving_before_the_reply_is_kept_not_dropped(self):
        cdp = cdp_over([
            {'method': 'Page.fileChooserOpened', 'params': {'backendNodeId': 7}},
            {'id': 1, 'result': {'ok': True}},
        ])
        self.assertEqual(cdp.call('Page.enable'), {'ok': True})
        # Served from the buffer: the event arrived while the call was waiting for its answer.
        reads_before = cdp.ws.reads
        self.assertEqual(cdp.wait_event('Page.fileChooserOpened', 1.0), {'backendNodeId': 7})
        self.assertEqual(cdp.ws.reads, reads_before)

    def test_the_answer_to_another_id_is_ignored(self):
        cdp = cdp_over([{'id': 99, 'result': {'stale': True}}, {'id': 1, 'result': {'ok': True}}])
        self.assertEqual(cdp.call('Page.enable'), {'ok': True})

    def test_a_cdp_error_reply_raises(self):
        cdp = cdp_over([{'id': 1, 'error': {'message': 'no such method'}}])
        with self.assertRaises(RuntimeError):
            cdp.call('Page.nope')

    def test_wait_event_reads_past_other_events_until_it_finds_its_own(self):
        cdp = cdp_over([
            {'method': 'Page.frameNavigated', 'params': {}},
            {'method': 'Page.fileChooserOpened', 'params': {'backendNodeId': 3}},
        ])
        self.assertEqual(cdp.wait_event('Page.fileChooserOpened', 1.0), {'backendNodeId': 3})

    def test_wait_event_raises_when_the_event_never_comes(self):
        cdp = cdp_over([{'method': 'Page.loadEventFired', 'params': {}}])
        with self.assertRaises(TimeoutError):
            cdp.wait_event('Page.fileChooserOpened', 0.2)

    def test_the_event_buffer_is_capped(self):
        cdp = cdp_over([])
        for i in range(companion.MAX_BUFFERED_EVENTS + 10):
            cdp._note_event({'method': 'Page.lifecycleEvent', 'params': {'n': i}})
        self.assertEqual(len(cdp.events), companion.MAX_BUFFERED_EVENTS)
        # The oldest are dropped, so the newest event is always still reachable.
        self.assertEqual(cdp.events[-1]['params']['n'], companion.MAX_BUFFERED_EVENTS + 9)


class PageScriptErrors(unittest.TestCase):
    # The JS exception must reach the error message. If it were dropped on the way out, a script bug
    # would read like a companion outage.
    def test_the_exception_description_reaches_the_error_message(self):
        details = {'exception': {'description': 'TypeError: root.querySelectorAll is not a function\n    at collectInputs'}}
        cdp = cdp_over([{'id': 1, 'result': {'result': {}, 'exceptionDetails': details}}])
        with self.assertRaises(companion.PageScriptError) as raised:
            cdp.evaluate('__dobot.pageState()')
        self.assertIn('page script threw: TypeError: root.querySelectorAll is not a function', str(raised.exception))
        self.assertLessEqual(len(str(raised.exception)), 200)

    def test_a_throw_without_a_description_still_says_the_script_threw(self):
        cdp = cdp_over([{'id': 1, 'result': {'result': {}, 'exceptionDetails': {}}}])
        with self.assertRaises(companion.PageScriptError) as raised:
            cdp.evaluate('1')
        self.assertEqual(str(raised.exception), 'page script threw')


class FakeCdp:
    """Records the CDP calls the chooser flow makes, and answers the ones it reads."""

    def __init__(self, point={'x': 10.0, 'y': 20.0}, chooser=None, fail_on=None):
        self.calls = []
        self.point = point
        self.chooser = chooser
        self.fail_on = fail_on

    def page_call(self, fn, args, by_value=True):
        self.calls.append(('page_call', fn))
        return {'value': self.point}

    def call(self, method, params=None):
        self.calls.append((method, (params or {}).get('enabled')))
        if self.fail_on == method:
            raise TimeoutError('cdp call deadline exceeded')
        return {}

    def wait_event(self, method, timeout_s):
        self.calls.append(('wait_event', method))
        if self.chooser is None:
            raise TimeoutError('no ' + method)
        return self.chooser

    def methods(self):
        return [c[0] for c in self.calls]

    def intercept_calls(self):
        return [enabled for method, enabled in self.calls if method == 'Page.setInterceptFileChooserDialog']


class FileChooserInterception(unittest.TestCase):
    def test_a_successful_attach_arms_and_disarms(self):
        cdp = FakeCdp(chooser={'backendNodeId': 42})
        self.assertTrue(companion._set_files_through_chooser(cdp, 10, 20, '/home/user/workspace/cv.pdf'))
        self.assertEqual(cdp.intercept_calls(), [True, False])
        self.assertIn('DOM.setFileInputFiles', cdp.methods())

    def test_interception_is_disarmed_when_no_chooser_opens(self):
        cdp = FakeCdp(chooser=None)
        self.assertFalse(companion._set_files_through_chooser(cdp, 10, 20, '/home/user/workspace/cv.pdf'))
        self.assertEqual(cdp.intercept_calls(), [True, False])
        self.assertNotIn('DOM.setFileInputFiles', cdp.methods())

    def test_interception_is_disarmed_even_when_the_arm_call_itself_fails(self):
        # A CDP timeout can leave interception on while the reply is lost, so the disarm must run.
        cdp = FakeCdp(fail_on='Page.setInterceptFileChooserDialog')
        with self.assertRaises(TimeoutError):
            companion._set_files_through_chooser(cdp, 10, 20, '/home/user/workspace/cv.pdf')
        self.assertEqual(cdp.intercept_calls(), [True, False])

    def test_a_chooser_without_an_input_node_attaches_nothing(self):
        cdp = FakeCdp(chooser={'mode': 'selectSingle'})
        self.assertFalse(companion._set_files_through_chooser(cdp, 10, 20, '/home/user/workspace/cv.pdf'))
        self.assertNotIn('DOM.setFileInputFiles', cdp.methods())
        self.assertEqual(cdp.intercept_calls(), [True, False])

    def test_an_unusable_point_never_arms_interception_and_never_clicks(self):
        cdp = FakeCdp(point={'oops': True})
        self.assertFalse(companion._set_files_through_chooser(cdp, 10, 20, '/home/user/workspace/cv.pdf'))
        self.assertEqual(cdp.intercept_calls(), [])
        self.assertNotIn('Input.dispatchMouseEvent', cdp.methods())


class ClickPermission(unittest.TestCase):
    """The platform vets the element; without an explicit click the companion must not click."""

    def setUp(self):
        self.cdp = FakeCdp(chooser={'backendNodeId': 42})
        self.original = companion.with_page
        companion.with_page = lambda fn: fn(self.cdp)

    def tearDown(self):
        companion.with_page = self.original

    def test_without_permission_no_click_is_dispatched_and_the_call_reports_no_input(self):
        status, payload = companion.set_files(10, 20, '/home/user/workspace/cv.pdf', False)
        self.assertEqual(status, 404)
        self.assertEqual(payload, {'error': 'no file input'})
        self.assertNotIn('Input.dispatchMouseEvent', self.cdp.methods())
        self.assertEqual(self.cdp.intercept_calls(), [])

    def test_with_permission_the_chooser_path_runs(self):
        status, payload = companion.set_files(10, 20, '/home/user/workspace/cv.pdf', True)
        self.assertEqual(status, 200)
        self.assertEqual(payload, {'ok': True, 'how': 'file-chooser'})
        self.assertIn('Input.dispatchMouseEvent', self.cdp.methods())

    def test_an_existing_input_is_used_without_any_click(self):
        # fileInputAt found a real input, so the DOM path wins and nothing is clicked.
        self.cdp.page_call = lambda fn, args, by_value=True: {'objectId': 'obj-1'}
        status, payload = companion.set_files(10, 20, '/home/user/workspace/cv.pdf', True)
        self.assertEqual(status, 200)
        self.assertEqual(payload, {'ok': True, 'how': 'dom'})
        self.assertNotIn('Input.dispatchMouseEvent', self.cdp.methods())


if __name__ == '__main__':
    unittest.main()
