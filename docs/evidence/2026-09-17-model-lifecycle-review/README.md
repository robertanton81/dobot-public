# Model-call lifecycle review

Reviewed on 17 September 2026 against `b636628` and the installed Anthropic SDK `0.125.0`.
This review changes no application code. Its scripts use a local HTTP server, synthetic responses,
temporary bot folders, and a fake remote computer. They never load operator credentials or call
Anthropic or E2B.

## Verdict

The latest stream timeout and cancellation changes fix their main reported cases. Successful
streams preserve the complete response. Ping-only streams fail. Stop interrupts an active HTTP
request. Once a run ends, the runner releases its queue slot and sandbox hold correctly.

Five actionable findings remain. One comes from the recent switch to streaming. Two are older
application defects. Two are SDK boundary cases that the latest timeout and cancellation repair
does not cover. None establishes a need to change the framework or replace the architecture.

## Findings

### F1 — P1: Stop can be lost when a human wait is being created

Locations: `src/server/agent/runner.ts:150`, `runner.ts:475`, `runner.ts:483`,
`src/server/agent/run.ts:303`, and `src/server/agent/takeover.ts:117`.

`Runner.cancel()` aborts the model signal and resolves only waits that already exist. Tool code
can be between an awaited operation and registering its next wait. No registration checks the
already-aborted signal. The new wait therefore survives a successful Stop request.

The harness reproduces all three paths through the real Runner:

| Path | Where Stop arrives | What follows |
| --- | --- | --- |
| Approval | After the block event, before the approval is created | A new pending approval holds the run. |
| Question | After posting the question, before registering its answer waiter | A new answer waiter holds the run. |
| Takeover | After the takeover-started event, before registering its waiter | A new takeover waiter holds the run. |

The harness injects Stop synchronously through event subscribers to select the timing precisely.
An actual HTTP Stop can arrive during the preceding awaited file or sandbox I/O. This is not a
claim that HTTP handlers can interrupt synchronous code or run between every pair of microtasks.

In every reproduction, the queued next goal remains blocked and the sandbox keep-alive remains
held. A second Stop releases the wait and both runs finish. No click executes in the approval
case. Question and approval waits have a 30-minute timeout. Takeover has no equivalent timeout.
The short observation in the harness proves the missed cancellation; these longer consequences
follow from the timer and waiter code, rather than a 30-minute experiment.

This is a race condition: the result depends on when Stop arrives relative to wait registration.
The waiter code predates the recent fixes (`5272260`, `efcc95f`, and `7a7c27` on 11 September).

Repair contract: every wait must handle an already-aborted run and future aborts. Check cancellation
before creating a new wait, subscribe while it is active, and remove the subscription when it ends.
Apply this consistently to questions, approvals, and takeovers. A check only before a tool starts
does not cover the awaits inside that tool.

### F2 — P2: Stop cannot interrupt an SDK retry delay

Location: `src/server/agent/model.ts:59`.

The adapter delegates two retries to the SDK. Its `src/client.ts:1487` waits with `sleep()` and
does not pass the abort signal. It checks cancellation only when that delay ends and the next
request is about to start. The application stall timer is not active before stream connection.

A local `429` with `Retry-After: 2` kept the real Runner and its queued next goal waiting for
about two seconds after Stop. A separate transport probe with `Retry-After: 3` reproduced about
three seconds. The SDK accepts any positive delay representable by a JavaScript timer, so this
is not limited to the short delays used in the probes.

This is a remaining gap in the latest cancellation repair, not evidence that its signal wiring
is wholly ineffective. Cancellation before headers and during an active stream passed.

Repair contract: Stop must settle the adapter promptly during retry delays. Avoid delegating
uncancellable waits to the SDK. Either disable those retries explicitly or retain the retry
policy in the adapter with bounded, abortable waits. Test cancellation during the delay itself.

### F3 — P2: An unfinished HTTP error body bypasses both application timers

Location: `src/server/agent/model.ts:72`.

The SDK clears its fetch timeout after receiving headers. On an error response that it will not
retry, `src/client.ts:1257` then waits for the entire body through `response.text()`. The stream's
`connect` event has not fired, so the application stall timer has not started.

A local `400` sent headers and then body whitespace every 20 milliseconds. With the stream stall
setting reduced to 120 milliseconds, the run still held the queue after 350 milliseconds. Stop
released it. The separate transport probe reproduces the same behavior at a 100-millisecond
stall setting. Reading the SDK confirms why: neither application timer covers this body read.
Regular body bytes can also keep the transport's idle timeout from firing.

This is an uncovered error path. It does not reproduce on normal error responses with complete
bodies; those fail and release the next queued goal correctly.

Repair contract: bound the whole phase before stream connection, including error-body consumption
and retry delays. Expiry must abort the underlying request and release the run. Do not put one
short total deadline around a healthy, progressing stream.

### F4 — P2: Malformed streamed data is printed without the application's filtering

Location: `src/server/agent/model.ts:49`, at the default SDK client construction.

The SDK's `src/core/streaming.ts:129–130` prints both the malformed event data and its raw chunk
through its default logger. A synthetic malformed event containing an opaque signature marker
produced two stderr writes with that marker. The response still failed and the next goal ran.

This path was introduced by the streaming change in `9258098`. It bypasses the explicit rule in
the thinking-continuity plan that signatures and redacted payloads must never enter logs. The
synthetic marker was not a real signature or credential. No actual secret was used or exposed.
The application error log did not contain this marker in the recorded reproduction; the two
raw SDK writes alone establish the finding.

Repair contract: configure SDK logging so it cannot emit raw model payloads. Preserve safe error
metadata such as error type, status, and request ID. Include malformed input in the log-filtering
test, not only valid thinking blocks.

### F5 — P2: Text continuation loses the first part of the answer in chat

Location: `src/server/agent/run.ts:556–558`, with the final reply posted at `run.ts:569–570`.

On `max_tokens` without a tool call, the loop adds the partial answer to model context and asks
the model to continue. It eventually posts only the final response's text to chat. The earlier
part exists in a run event, but the web UI does not display text run events (`src/web/App.tsx:85`).

The local stream returns `Partial answer` with `max_tokens`, then `done` with `end_turn`. The
next model request contains the first part. Stored chat contains only `done`. A user receiving
a long answer can therefore see only its final section even though the run reports success.

This behavior predates the recent fixes (`d2313de`, 11 September). The existing cutoff test checks
model context and cap values, but does not assert the complete answer delivered to chat.

Repair contract: preserve all user-visible parts of a text continuation, either in the final
assembled reply or as persisted chat messages. Keep ordinary intermediate tool commentary and
thinking separate. Assert the complete answer in chat after more than one text cutoff.

## Lifecycle checks

The scripts exercise 26 Runner scenarios and nine transport scenarios. They use the actual
Anthropic SDK and local HTTP responses. The Runner cases also use the real store, run loop,
approval registry, queue, and sandbox lifecycle manager. Only the remote computer is simulated.

| Phase | Checked behavior | Result |
| --- | --- | --- |
| Starting | Already-aborted signal; cancellation before headers | Rejects; no request for the already-aborted signal. |
| Waiting for headers | SDK timeout and both retries | Rejects after three attempts; timer scaled from 120 seconds to 40 milliseconds for this probe. |
| Receiving content | Normal response; signed thinking; tool continuation | Response and signed blocks preserved; the tool runs and its result continues. |
| Stalling | Ping-only stream; successful headers without body | Stall failure releases the next goal. |
| Breaking midstream | Empty body; missing message stop; error after a tool block | Fails without executing the partial tool. |
| Retrying | Retryable errors then success; exhausted retries | Correct attempt count and queue release. Stop during retry delay exposes F2. |
| Error bodies | Complete error body; unfinished body | Complete error fails normally; unfinished body exposes F3. |
| Truncating | Partial tool once and twice | Raises the cap once, never executes partial input, and fails after a second cutoff. |
| Continuing text | Text cutoff and pause-turn | Model continuation works. Chat completeness exposes F5. |
| Terminal failures | Refusal and context limit | Fails and releases the next goal. |
| Stopping | Before headers; active stream; before a platform tool | Cancels, skips the tool, and releases the next goal. |
| Creating waits | Approval, question, takeover | Exposes F1 in all three paths. A second Stop recovers each. |
| Logging | Malformed stream payload | Failure cleanup works; raw stderr output exposes F4. |
| Releasing | Queue slot, active run, run record, keep-alive, sandbox hold, HTTP response | Correct after every settled case, including explicit recovery from the reproduced defects. |

Transport probes also check that settled calls leave no listeners on the caller's abort signal.
Runner probes verify a fresh queued task succeeds after every case. Sandbox release is checked
through the manager's pause-grace timer; this does not prove that the real E2B service pauses.

One lower-impact observation is recorded without making it a sixth repair finding: Stop accepted
after a complete final response can still end as `done`. The completion branch does not recheck
cancellation. No tool runs after Stop in that case, and the next goal starts. Define whether
completion or cancellation wins at this boundary before adding another behavior change.

## What this says about the repeated findings

The main cause is incomplete handling across lifecycle phases. Previous tests proved individual
functions and option wiring. They did not prove the complete chain from HTTP behavior through
cancellation, stored outcome, and release of the next goal. The text-cutoff test similarly proved
the next request but not what the user receives.

There is a local structural issue: cancellation has no single contract across model requests,
retry waits, and human waits. The existing per-run AbortSignal is a suitable place to enforce that
contract. This calls for a focused repair across those boundaries. It does not justify a new
agent framework, database, worker service, or rewrite. An SDK does not remove the application's
responsibility to verify retry, timeout, logging, and cancellation behavior.

## Reproduction

From the repository root, with the existing dependencies installed:

```sh
pnpm exec tsx docs/evidence/2026-09-17-model-lifecycle-review/runner.mts
pnpm exec tsx docs/evidence/2026-09-17-model-lifecycle-review/transport.mts
pnpm preflight
```

These are diagnostic scripts for this reviewed commit. Some assertions deliberately confirm the
defects. A successful script exit means the recorded behavior was reproduced; it does not mean
every lifecycle contract passed. Convert those assertions into desired-behavior regression tests
when implementing repairs. The runner script writes its result JSON under `/tmp` and creates
synthetic bot folders in the operating system's temporary directory.

Saved results: `runner-results.json` and `transport-results.json`. The full preflight passes with
463 TypeScript tests, 16 Python tests, typecheck, and the site-name check. No live model output,
real credentials, live browser interaction, or real E2B failure was exercised by these probes.
Partial usage after a broken or cancelled response remains outside the tested cost-accounting
guarantees. Existing live replay evidence remains a separate verification result.

## Next implementation scope

Codex or the implementation task should address F1 through F5 and use this matrix as its
acceptance criteria. Start with cancellation across all waits and the model adapter, then logging
and text delivery. Keep the current architecture. After implementation, rerun these local cases,
the full preflight, and one live model/tool continuation before calling the repair complete.
