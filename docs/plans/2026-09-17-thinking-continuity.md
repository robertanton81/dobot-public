# Thinking continuity repair and Step C replay

Status: complete for this case. Implementation and both reviews passed. After the owner restored
API credit, the funded replay passed Step C on the same saved input: both cancellations recorded,
old mail reported correctly, one proposal for the new invitation, Deny, then `done`.
Evidence: `docs/evidence/2026-09-17-thinking-replay-funded/README.md`.
The earlier credit-interrupted run remains at `docs/evidence/2026-09-17-thinking-replay/README.md`.

Decision after the replay: keep the continuity repair and do not add the proposed notes
mechanism. One pass supports this case, not general batch reliability or isolated causation.

## Implementation checks

The regression test failed on the original conversion: the captured next request omitted thinking
and redacted-thinking blocks. It passes with the complete response returned unchanged, including
after screenshot pruning. Separate tests cover request options, the 4,000-character summary
boundary, exclusion of signed data from logs and thinking from chat, absent/zero/nonzero thinking
counts, and all existing cutoff paths.

Code review passed without findings. Test review requested separate tests for separate contracts
and a fixed summary boundary; both were changed and the second review passed. Full preflight
passed on 17 September at 15:26 Prague: 446 TypeScript tests and 16 Python tests, plus typecheck
and the site-name check. The restricted attempt failed only because process tests could not run
`pgrep`; the unrestricted run passed.

## Confirmed defect and agreed scope

The Step C failure is saved in `docs/evidence/2026-09-17-step-c/`. The model recognized
cancellations but repeated its reading without recording them or proposing the new invitation.
This does not establish the cause of the loop.

The API integration has a separate, confirmed defect: `toParams` kept only text and tool calls.
Sonnet 5 enables adaptive thinking by default. The tool continuation must return its complete
thinking blocks unchanged, including signatures. The removed blocks can carry reasoning across
tool calls even when their display text is empty.

The owner approved this combined repair in the task on 17 September:

- Return the complete assistant content unchanged, including thinking and redacted thinking.
- Raise the output cap from 4,096 to 16,000 tokens. Keep the existing one retry at twice the cap.
- Request summarized thinking. Log at most 4,000 summary characters per response, never signatures
  or redacted payloads. The full original blocks stay in model context.
- Add optional response diagnostics to each cost event before any response can be discarded:
  call, step, cap, stop reason, discard decision, block types, tool names, API thinking-token count,
  summary and truncation flag, and visible text length. An absent token count is null, not zero.
- Run the regression tests, review agents and full preflight before one live replay.

This is a combined repair test. A pass supports this version on this input. It cannot isolate
the effect of preserving thinking from the higher cap. Summary visibility provides evidence;
the summaries are not the raw reasoning or a complete explanation of the model's decisions.
No notes mechanism, prompt change or screenshot-retention change is included.

## Research checked against the installed SDK and current documentation

- SDK `@anthropic-ai/sdk` 0.125.0 supports adaptive thinking, summarized display, intact thinking
  block request parameters and `usage.output_tokens_details.thinking_tokens`.
- [Sonnet 5 migration](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide):
  thinking is enabled by default; tool loops return thinking blocks unchanged.
- [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking): display selects
  whether summaries are returned; the signature and reasoning billing stay the same. The model
  does not see the generated summary. Output limits cover thinking plus response output.
- [Messages API](https://platform.claude.com/docs/en/api/messages): the thinking-token count
  reports internal reasoning, including delimiters; total output tokens remain authoritative.
- [Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons):
  retry an incomplete tool call with a higher limit and do not execute incomplete arguments.

## Replay and acceptance

Back up current memory, chat, routine state and mail watermark before changing the fixture.
Verify that Inbox still contains the saved five UIDs and envelopes. Restore the saved pre-run
memory and chat, mark those emails unread and keep the routine and skill identical. The watcher
uses UIDNEXT rather than unread flags when IDs are available, so unread flags alone cannot fire
this replay. Rewind its saved watermark while the server is stopped, then let the normal watcher
and scheduler start the routine. Record this fixture operation explicitly.

Use the same live computer. Record elapsed time and any browser-state difference; this is not a
deterministic replay of a model response. Deny the proposed booking through the existing approval
API. Do not send new messages or make new bookings. A login or challenge, if one appears, still
requires takeover.

Pass requires both cancellations recorded before any proposal, the old confirmation reported as
cancelled, the original invitation treated as handled, and one proposal naming the new invitation.
After Deny the run must finish without retrying the booking. Report steps, calls, cost, thinking
tokens per call, visible notes and every cap hit. Preserve the evidence whether it passes or fails.

If it fails, examine this evidence before choosing another change. A larger cap does not remove
all possible truncation. A missing API token breakdown remains unknown. A single pass demonstrates
this case only; the notes mechanism stays undecided until the replay is examined.

## Review finding after the handoff: the cap was larger than the timeout allowed (Claude, 2026-09-17)

The review of the handoff confirmed the repair and every figure in the evidence, and found one gap.
The model call is not streamed and `src/server/agent/model.ts` gave every request a fixed timeout
of 120 s with two SDK retries. Output speed measured from the event timestamps of both runs:

| Fact | Value |
| --- | ---: |
| Output speed, upper bound from the original and the funded run | 80 to 93 tokens/s |
| Output reachable inside 120 s | about 10,000 tokens |
| Cap / retry cap | 16,000 / 32,000 |
| Largest response observed live | 4,096 tokens in 44.5 s |

So the timeout, not the cap, was the real ceiling. A response past it would have timed out, been
retried twice by the SDK (each attempt billed if the server finished it), and ended the run with
"the model stopped answering". The 32,000 retry could never complete. The raise still covered the
one cut that was observed.

Fix: the timeout now follows the cap the loop sends, `modelTimeoutMs(maxTokens)`: 60 s for input
processing plus 15 ms an output token (67 tokens/s, under the slowest measured speed). That gives
300 s at 16,000 and 540 s at 32,000. Trade-off: a call that hangs is given up after 5 minutes instead
of 2, and the two SDK retries repeat that, so at the retry cap the worst case is about 27 minutes
before the run reports the failure; streaming would remove the coupling and is the upgrade path if
long answers become normal. The explicit timeout also skips the SDK's own guard against calls that
are not streamed and may run past 10 minutes; a test keeps the retry cap under that limit. Both
reviewers passed the change. Tests in `src/server/agent/model.test.ts`, including one that checks
the class hands the computed timeout to the SDK.

## Review finding after the timeout change: the transport, not the SDK, set the ceiling (Codex review, fixed by Claude, 2026-09-17)

The Codex review of the timeout change found that the 540 s timeout was never reached. Node's
`fetch` (undici) waits at most 300 s for the response headers, whatever timeout the SDK is given
(undici, Dispatcher docs: `headersTimeout` defaults to 300 seconds). A response that is not streamed
sends its headers only when the whole answer is ready, so the transport gave up at about 300 s; the
review reproduced it three times with a local server that delayed the headers.

Fix: the call is streamed and the SDK assembles the final message (`messages.stream(...).finalMessage()`
in `src/server/agent/model.ts`). The SDK's own guidance for long requests says to stream, because
networks drop idle connections. With a stream the headers arrive at once and the body flows token
by token, so no transport limit depends on the answer's length, and the SDK's ten-minute rule for
calls that are not streamed no longer applies. The `ModelPort` interface, the loop and the fakes are
unchanged: the loop still receives one complete message with its signed thinking blocks.

Trade-offs, replacing the ones of the previous finding:

| What | Before (not streamed) | Now (streamed) |
| --- | --- | --- |
| Long answer | fails at 300 s on the transport | flows for as long as the caps allow |
| Timeout | the whole response, 300 or 540 s | the first byte only, 120 s, retried twice by the SDK |
| A stream that goes silent | — | ended by undici's idle body timeout, 300 s between chunks; the run reports "the model stopped answering" |
| A failure after the first byte | the SDK retried the whole call | not retried; the run ends as failed and the user sends the goal again |
| Total time | bounded by the timeout | bounded by the loop's turn and token caps |
| Dependency | none | none: no custom dispatcher, no `undici` package |

Not chosen: a custom undici `Agent` with a longer `headersTimeout` passed through the SDK's
`fetchOptions`. It needs the `undici` package as a dependency and keeps every answer under one
timeout; streaming removes the limit with no dependency and is what the SDK documents.

Verified: 453 tests pass, including `model.test.ts` (the class streams, hands the SDK the first-byte
timeout and two retries, and resolves with the assembled message) and one live probe of the streamed
call with adaptive thinking and a tool (`data/probes/stream-shape.ts`, not committed; Sonnet 5,
163 output tokens, 2.7 s), which returned the same message shape the loop reads: a signed thinking
block, a text block, a `tool_use` block with its input parsed into an object, `stop_reason`
`tool_use`, and usage with `output_tokens_details.thinking_tokens`.

Two more findings from the same review, both in the progress guard (`src/server/agent/progress.ts`):

- A tool call that failed reset the count. An invalid `remember` call stretched a repeated-click
  loop from 42 to 60 steps without saving anything. A failed call now counts as a step without
  progress; the loop passes the outcome to the guard.
- Paging was read as a loop. The guard told actions apart by place only, so the same "Next" click
  at the same place ended a page walk at step 41 with 20 distinct screenshots behind it. A full
  screenshot of a screen the run has not shown before now counts as progress. A screen is "seen" when
  it is within the stuck detector's same-screen distance (mean luminance difference under 2 on the
  sampled pixels) of one already recorded, so a clock or a hover highlight does not make an old page
  new. Trade-off: a page that changes a lot on every visit (a live feed) reads as new content
  each time; the step budget still bounds such a run.

Checked by replay, not asserted (the code reviewer's blocking finding on the first draft of this
section): `docs/evidence/2026-09-17-loops/replay-guard.ts` feeds every recorded run on disk, its
screenshots included, through the old rule and the new one. The old rule's replay reproduces the
one run the live guard ended (`c5dd5468`, stuck at step 56), which says the replay is faithful. On
the loop runs the new rule fires at the same step or a few steps later, never earlier; on the
finished runs it never fires:

| Run (2026-09-17) | Ended by | Steps | Old rule: notices; end | New rule: notices; end | Screenshots; distinct screens |
| --- | --- | ---: | --- | --- | --- |
| `cbd1f246` loop 1 | the step budget | 100 | 65, 89; — | 65, 90; — | 41; 8 |
| `d4e20693` loop 2 | the user | 106 | 46, 69, 81; 93 | 46, 78, 90; 102 | 34; 6 |
| `f88c136c` loop 3 | the user | 47 | 46; — | 46; — | 14; 3 |
| `23092bd0` loop 4 | the user | 77 | 47, 71; — | 48, 71; — | 27; 6 |
| `7b72be72` loop 5 | the user | 82 | 37, 49; — | 37, 49; — | 27; 5 |
| `c5dd5468` the loop under the live guard | the guard | 56 | 32, 44; 56 | 32, 44; 56 | 22; 5 |
| `118b2ee2` the refused slot | the step budget | 102 | 85, 97; — | 85, 97; — | 27; 6 |
| `3f0235c8`, `68a0fad7`, `e2c49aee`, `952674f2`, `ac7f94ab`, finished | done | 23 to 45 | none | none | — |

Notices at a stretch of 16 and 28; "end" is the step at which the stretch reaches 40; "—" means
the run ended another way first. The worst case is loop 2, ended nine steps later than under the
old rule, because three screens the old rule had no credit for were new (measured 3.5, 5.3 and 4.3
from their nearest recorded screen).

Distances on the real screens: a revisit of a screen the run had shown measured 0.00 to 1.65; a
screen not shown before measured 2.40 to 9.42; the threshold 2 sits in that gap. Two different
cancellation mails in the same template (loop 2, steps 8 and 17: the same layout, a different time
line and unread badge) measure 0.47, so the guard reads them as one screen. That is the accepted
trade-off: a mail that differs from one already read by a line of digits is not new content to the
guard. It cannot make anything worse than the old rule, which credits a new place, new text or a
new page, and nothing else: the screen rule only adds credit. It is pinned by a test on the two
screenshots, kept in the evidence folder as `d4e20693-mail-mid75.png` and `d4e20693-mail-mid73.png`.

Not replayed: the page walk of the finding itself, the same "Next" click with 20 distinct pages,
ran in the reviewer's environment and is not on disk. It is covered by the tests with synthetic
screens and by the measured gap, not by a replay of the real pages.

Tests: `progress.test.ts` (a failed tool counts as a step; new screens are progress, seen screens are
not; a zoom or a screenshot without a picture never is) and `run.test.ts` (a failed remember in the
middle of the same clicks still ends the run stuck; the same click followed by new screens runs to
the end past the stuck limit).

## Review finding after the streaming change: a stream of pings kept the run busy for ever (Codex review, second round, fixed by Claude, 2026-09-17)

The second Codex review of the streaming change found that nothing ended a stream that carried
only `ping` events. The API may send any number of them (Streaming messages docs, "Ping events").
The SDK drops them before the consumer sees an event (`core/streaming.js`), and undici's idle body
timeout counts them as traffic, so the connection stayed open and `finalMessage()` stayed pending.
Stop could not reach it either: the loop read the stop flag only between calls. The review
reproduced it through the real SDK with a local server, including after Stop: the run stayed busy
with zero steps. The previous section's claim that undici ends a silent stream was wrong for this
case.

Fix, in two parts:

- A stall timer in `src/server/agent/model.ts`: armed when the headers arrive and re-armed by every
  event the SDK passes on (message start, block starts, deltas, stops). After 120 s without an
  event the stream is aborted and the call rejects with `ModelStalledError`; the run ends as failed
  with the loop's existing wording, "the model stopped answering".
- Stop reaches the pending call. The runner creates one `AbortController` per run, the loop hands
  its signal to the model call (`ModelPort.create(params, { signal })`), and the SDK aborts the
  request on it. The loop treats the abort error as the stop, not a failure, and ends the run as
  cancelled with the usual chat line.

Trade-offs, replacing the "stream that goes silent" row of the previous section:

| What | Before | Now |
| --- | --- | --- |
| A stream that goes silent | never ended while pings arrived | ended after 120 s without an event; the run reports "the model stopped answering" |
| Stop during a model call | waited for the call to return | the call ends at once; the run ends as cancelled |
| A slow answer | flowed for as long as the caps allowed | the same, while an event arrives at least every 120 s; a delay between events while the model works on a tool input is documented, and the measured runs take seconds per call |
| Pings for longer than 120 s, then the answer | completed | ended as stalled; the user sends the goal again |

Not chosen: a shorter stall, because a false stop would end a run on the demo path; a bound on the
whole call (`AbortSignal.timeout`), because the turn and token caps already bound the total and it
would cut a long answer that is still flowing.

Verified: 463 tests pass. `model.stream.test.ts` speaks to the real SDK over a local SSE server
(a pings-only stream ends as stalled and the connection closes; events past the stall total keep
the stream alive; a stop signal aborts a pending stream and the connection closes). `run.test.ts`:
a stop during a pending model call ends the run as cancelled with no cost event. `model.test.ts`:
the signal is handed to the SDK. The reviewer's script (`/tmp/dobot-review-2-stream.mts`, patched
to the fake context's `stop.request()`): its last check, which asserted that the run stays pending
after Stop, now fails because the run settles. Its first check, a stream that sends only pings for
25 scaled minutes before the answer, fails too, by design, and passes with the stall timeout raised
explicitly.

## Review finding after the stall timer: the lifecycle review (Codex review, third round, 2026-09-17)

The third Codex round ran 26 Runner scenarios and nine transport scenarios through the real SDK, a
local HTTP server, the real store, queue and approval registry, with only the computer faked
(`docs/evidence/2026-09-17-model-lifecycle-review/`). The stall timer and the stop signal passed
their cases. Five findings remained; Claude confirmed each at the cited lines and in the installed
SDK source. The decision was taken with the owner the same night.

| Finding | Where | Decision |
| --- | --- | --- |
| F1 Stop lost while a human wait was being created: `cancel()` woke only the waits that existed; a question, approval or takeover registered after it was never resolved, and a takeover wait has no timeout | `runner.ts` waitForUser and waitForApproval, `takeover.ts` begin | fixed, `b52efca` |
| F2 Stop cannot interrupt the SDK's retry sleep (`client.ts:1487` does not take the signal) | `model.ts`, `maxRetries: 2` | known limit (README) |
| F3 an error response whose body never finishes is covered by neither the header timeout nor the stall timer | `model.ts` | known limit (README) |
| F4 the SDK's stream parser prints a malformed event's raw data through its default logger; the code review added that the parser's own error message quotes about ten characters of the data around the failure, which the application's error log would carry | `model.ts`, the client and the catch | fixed, `109f699`: SDK logging off, and a named `ModelStreamParseError` whose message carries the request id, never the data |
| F5 a text answer continued after `max_tokens` reached the chat without its first part | `run.ts`, the `max_tokens` case | fixed, `cbd24de` |

The contract F1 restores is "a stopped run enters no human wait". Its state table, written before
the fix as the new KISS rule asks (`50cd7dc`):

| Trigger | Outcome | Where |
| --- | --- | --- |
| Stop before the tool starts | no tool runs; the run ends cancelled | the loop's checks, `run.ts` 360, 481, 498 |
| Stop while the wait is registered | `cancel()` wakes it with the cancellation outcome; cancelled | `runner.ts` cancel, `takeover.ts` cancel |
| Stop between the tool's first await and the registration | the registration sees the aborted signal, with no await in between: the question is answered with the stop, the approval is denied, the takeover ends with its card and no screenshot; cancelled; queue slot and computer released | the three checks |
| The wait times out | unchanged: 30 minutes for a question or an approval, none for a takeover | `runner.ts` |
| An answer, a decision or a hand-back arrives | unchanged | |
| The next queued goal | a fresh stop controller per run; it starts | `runner.ts` run |
| Stop while an always-allowed proposal is being written (found by the code review: this branch never waits, so no registration guarded it) | the approval is denied and no "allowed by your rules" line is written; cancelled | `tools.ts` propose_action |
| Stop during a manual takeover (found by the same review) | the run ends before another model call, not only by the aborted signal on that call | `run.ts`, after the manual takeover |

Why F2 and F3 are limits and not fixes: neither has been seen in a live run; both need the provider
to misbehave in a specific way (a retry delay during a Stop; an error status followed by a body that
drips for ever); and the remedy the proposal recommends, the adapter owning retries with one
deadline before the stream connects, would be the third rewrite of `model.ts` in one day, and each
rewrite so far has opened new paths (F4 came from the streaming switch). A retry that saves a run
from an overloaded answer is worth more to the demo than an instant Stop during it. The upgrade
path is the proposal's F2/F3 section, unchanged.

Verified: 475 tests and typecheck. The five F1 tests, the six F5 tests and the two F4 tests each
fail on the old code for the intended reason: a run still waiting at the test timeout (or a card
that says allowed, or a second model call after the stop), a chat that holds only the last part,
the opaque marker printed by the SDK and a fragment of it quoted in the error the application logs.
Each fix went through the spec-compliance, code and test-quality reviews; the code reviews added
the two F1 rows and the F4 error-message gap above, which is the review doing what the new rule
asks of it: a correct implementation of an incomplete contract is a finding.
