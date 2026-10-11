# Proposed lifecycle repairs and review process changes

Status: reviewed with the owner on 17 September 2026, the same night. Accepted and landed: F1 in its
minimal form (a check of the run's stop signal at each of the three wait registrations, `b52efca`),
F4 (`109f699`), F5 (`cbd24de`), and the rule edits of section 2 that map to the misses (the KISS rule in
`CLAUDE.md` and `AGENTS.md`, the fix protocol and the review exception in both copies of the
implement skill, `50cd7dc`). Recorded as known limits, not fixed: F2 and F3 (README, "Known limits";
the reason is in the thinking-continuity plan's fourth review-finding section). Deferred past the
deadline: the rest of sections 3 to 7 (the change brief, the reviewer duty tables, the shared policy
document, CI); the one harness change still open is Bash for the two reviewers, so they can run
scratch probes. Prepared by the Codex review against `b636628`; the rest of this document is the
proposal as written.

Evidence: [the lifecycle review](../evidence/2026-09-17-model-lifecycle-review/README.md), with
26 Runner scenarios and nine transport scenarios. The code review findings remain open.

## Recommendation

Keep the current stack. Repair the ownership of cancellation and timeouts, then make the
generation and review workflow prove behavior across the whole affected operation. Extend the
existing skills and reviewers. The evidence supports changing their inputs and acceptance rules;
it does not establish that more agents or a different model would solve the problem.

The current instructions already demand timeouts, meaningful tests, and independent review.
Those requirements were interpreted too narrowly. We checked options and individual functions
without always checking what happens across the SDK, run loop, queue, persistence, and UI.
That was an implementation and review failure. A rule file alone will not prevent its recurrence.

## 1. Proposed fixes

### F1: Make every human wait obey the run's cancellation signal

Change `src/server/agent/runner.ts`, `tools.ts`, `run.ts`, and `takeover.ts` as needed to enforce
one contract: a stopped run cannot start or remain in a human wait. A contract is a behavior
that all implementations and callers must preserve.

- Keep the Runner as the owner of the existing per-run AbortController.
- Question, approval, and takeover registration must handle both an already-aborted signal and
  a future abort. Registration and its initial signal check must have no awaited gap.
- On abort, resolve the wait with its existing cancellation outcome, close its card, and remove
  its timer and listeners. Approval remains denied; cancellation never grants approval.
- Check cancellation after awaited preparation and before creating a new wait or issuing the
  next action. A check only at tool entry misses the awaits inside the tool.
- Use a small shared helper only for the repeated wait-registration and cleanup behavior.
  Keep approval decisions and takeover safety checks in their existing modules.

Proof: Stop before registration, during preparation, and while waiting must end each of the
three paths with one terminal run event. No later action may execute. The next queued goal must
finish with a fresh signal. Timers, listeners, pending approvals, and sandbox holds must be
released. Tests must include a controlled awaited-I/O boundary, not just synchronous event hooks.

Limit: an action already dispatched to a remote system may have happened before Stop. Preserve
the existing unknown-outcome warning. Cancellation is not a promise to undo an external effect.

### F2 and F3: Make the model adapter own the entire request lifecycle

Change `src/server/agent/model.ts`. The adapter should own retries, cancellation, and the periods
covered by its timers. The caller should not need knowledge of SDK retry sleeps or body parsing.

Recommended policy:

| Phase | Proposed policy |
| --- | --- |
| Before a successful stream connection | One 120-second deadline for the whole phase, including retries, backoff, and HTTP error-body consumption. |
| SDK retries | Set `maxRetries: 0`; remove the current per-request override of two retries. |
| Adapter retries | Keep at most two retries for eligible failures before stream connection, within the same deadline. |
| Retry delay | Respect a valid server delay only if it fits the remaining deadline. Otherwise fail visibly; do not retry earlier than requested. |
| No server delay | Use a small bounded backoff, implemented with an abortable wait. |
| Active stream | Keep the current 120-second gap limit between meaningful events. Pings do not reset it. |
| Error after stream connection | Fail the call without silently replaying partial output. |
| Stop or deadline | Abort the underlying transport, settle the call, and clean up timers and listeners. |

For retry classification, preserve the intended transient-error policy explicitly: connection
failures and eligible 408, 409, 429, and 5xx responses. Honor explicit provider retry directives
only within the operation's attempt and deadline limits. Do not retry cancellation, a parse
failure, refusal, or an already-started stream.

This replaces a potentially repeated 120-second header wait with one bounded startup phase.
Trade-off: a request that uses the whole startup deadline gets no extra attempt. This favors a
visible failure and a released bot over a much longer occupied queue. Healthy streams may run
longer than 120 seconds when they keep making progress.

Do not implement cancellation only as `Promise.race()`. Returning early while the transport or
retry task continues would make the caller look finished while work remains alive.

Proof: exercise no headers, incomplete error bodies, retry delays, retry exhaustion, active
progress, ping-only streams, and Stop in each phase through the real SDK and a local HTTP server.
Check transport closure and then the next queued goal, not only the thrown error.

The official SDK supports disabling retries with `maxRetries: 0`. The specific retry-sleep and
error-body gaps were verified in the installed `0.125.0` source and local probes; documentation
alone did not establish them. [SDK retry configuration](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#retries).

### F4: Disable raw SDK logging and preserve safe application diagnostics

Construct the SDK client with an explicit `logLevel: 'off'`. Keep application logs containing
approved metadata: run ID, phase, error category, HTTP status, attempt count, and request ID.
Do not copy arbitrary upstream bodies or parser messages into those fields.

This is simpler than attempting to redact arbitrary SDK log argument shapes. The trade-off is
losing verbose SDK diagnostics. Application metadata and synthetic reproductions remain available.

Proof: malformed SSE containing a synthetic opaque marker must fail without that marker reaching
stdout, stderr, persisted events, or chat. Repeat with SDK logging requested through the environment
to verify that the explicit client setting still wins. Also test the application's error path,
not only the SDK logger.

The installed SDK exposes this option. Official documentation says it disables SDK logging and
that the client setting overrides the environment setting. [SDK logging configuration](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#logging).

### F5: Persist every user-visible part of a continued text answer

Change `src/server/agent/run.ts` to persist the text emitted on a `max_tokens` response before
requesting its continuation. Append each received part through the existing chat writer, then
post the final continuation normally. This retains the partial answer if the next request fails
or the process restarts.

- Apply this to a text answer being continued, not ordinary commentary before tools.
- Persist subsequent text in order, without duplicating earlier parts. Do not include thinking
  or signatures.
- If continuation fails or is cancelled, retain the received text and the visible failure or
  cancellation notice. Verify that restart recovery identifies an unfinished run too.
- If the next response changes into tool use, keep the earlier text segment and continue normal
  tool handling. Do not merge later, unrelated replies into it.
- Keep the full original assistant blocks in model context, as the existing repair requires.

Proof: two consecutive cutoffs followed by completion must produce every part exactly once and
in order in persisted chat. Reload must show the same answer. Failure after a cutoff must retain
the partial text and the failure notice. Thinking remains absent from chat.

Trade-off: a continued answer uses several chat messages. A single editable answer would require
expanding the current card-only update API in the store and RunContext. That is a separate UI
refinement; retaining the full answer does not depend on it.

## 2. Concrete weaknesses in the existing workflow

These are observed instruction gaps, not proof that every reviewer followed each line literally.

| Current source | Current weakness | Proposed replacement |
| --- | --- | --- |
| `.agents/skills/implement/SKILL.md:175` | "Change as few lines as possible" favors a local patch even when the behavior crosses modules. | Make the smallest complete change that restores the contract across affected callers and owners. |
| `implement/SKILL.md:186–188` | The small-diff exception names four risk areas but does not explicitly cover retries, streams, cancellation, or queues. | Always review asynchronous lifecycle, transport policy, and logging changes, regardless of line count. |
| `implement/SKILL.md:197,220` | Review input centers on the diff and changed files. | Add the affected execution path, relevant unchanged callers, lifecycle contract, and evidence matrix. |
| `implement/SKILL.md:177` | Any other test failure is treated as proof the root cause was wrong. | Classify the failure: introduced regression, changed contract, pre-existing defect, or test/environment problem. Never revert someone else's work. |
| `implement/SKILL.md:178` | Three failed fixes are declared an architecture problem. | Repeated fixes trigger a fresh review of the whole operation. Architecture remains a hypothesis requiring evidence. |
| `.claude/agents/test-quality-reviewer.md:47` | Missing tests outside four categories are only suggestions. | Include SDK integration assumptions, cancellation, timeouts, streaming, and queue recovery among required tests when affected. |
| `test-quality-reviewer.md:145` | "Trust the library" can discourage testing a dependency assumption our behavior relies on. | Do not retest a library broadly; test our contract through the installed library at critical boundaries. |
| `.agents/skills/plan/SKILL.md:52` | A source link and version can be treated as proof of behavior. | State the exact assumption supported by the source; probe runtime behavior when our guarantee depends on it. |
| `.agents/skills/verify/SKILL.md:33–44` | Standing checks cover successful work and key invariants, but not cancellation and recovery across every affected phase. | Add applicable failure, cancellation, cleanup, and next-task criteria. |

The same review policy exists in `.claude/agents/*.md` and `.codex/agents/*.toml`. Skills are
also maintained separately under `.claude/skills/` and `.agents/skills/`. Most current differences
are intentional provider names and paths. Duplication is a future drift risk, not an established
cause of these defects. `.Codex` and `.codex` are the same directory on this checkout; do not
mistake their case variants for two independent copies.

## 3. Strengthen generation before code is written

Add one compact change brief to `/plan` and to `/implement` when a small fix skips a formal plan.
It should fit beside the task description and reuse known facts.

```text
User-visible guarantee:
Entry point -> dependencies -> stored/UI result -> cleanup:
Owner of cancellation, timeout, retry, and resource release:
Relevant states: success, failure, timeout, Stop, retry, partial result:
Dependency assumptions and evidence for each:
Tests that would fail on the current defect:
Adjacent behavior that must still work:
Explicit limits of verification:
```

Require this for changes involving async waits, external I/O, side effects, or persistence.
Do not require a state table for a copy edit or a simple style change. The purpose is to make
missing transitions visible before generation, not to expand every task into a design exercise.

Give workers this brief and the relevant unchanged boundary code. A worker receiving only a
five-line edit instruction cannot reliably identify a cancellation gap in its caller. Workers
may propose an expanded file scope when the contract requires it; they should explain why.

Separate product decisions from technical discovery. Ask the user when a trade-off changes
observable behavior or authorized scope. Inspect code, docs, and local probes for technical facts
instead of asking the user to settle an SDK behavior question.

## 4. Change what reviewers must prove

Keep the existing compliance, code, and test review roles. Give them different, explicit duties.

| Role | Required question | Evidence |
| --- | --- | --- |
| Spec compliance | Does the implementation meet the stated contract? | Requirements mapped to code and checks. |
| Code review | What breaks along the affected operation, including unchanged code and dependency behavior? | Trace the complete path; identify a concrete failing transition or confirm its handling. |
| Test review | Would these tests reject the actual bug, and do their assertions reach the claimed user outcome? | Run against the unfixed code or temporarily remove the relevant behavior in an isolated copy. |

A correct implementation of an incomplete plan is still a finding. Reviewers should flag missing
contract cases even when the implementation matches the plan. The code reviewer owns the
whole-operation assessment so it cannot disappear between the three roles.

Require a small result matrix for each affected lifecycle:

| Trigger | Expected outcome | Required absence | Cleanup and next operation | Evidence |
| --- | --- | --- | --- | --- |
| Stop while a wait is registering | Cancelled | No later action or new waiting card | Wait ends; next goal runs | Named test or reproduction. |
| Retryable error | Bounded recovery or failure | No retry after Stop | Connection/listeners released | Named SDK/local HTTP test. |
| Text cutoff | Complete or visibly incomplete chat answer | No lost text or thinking in chat | Run eventually terminates | Persisted chat assertion. |

An adversarial review should exercise the selected boundaries, not merely use stronger language
such as "assume the code is wrong." At minimum, cover the paths changed by the fix and one
plausible adjacent failure that the original reproduction did not exercise.

Allow the reviewer to run bounded local tests and create scratch reproductions while keeping
production files read-only. Where the tool configuration exposes only reading, the parent must
execute the requested probe and return its evidence. A review cannot claim an executed check
when its tools only permitted inspection.

After the final code change, do one integrated review of the affected operation. Reuse an
existing reviewer. Per-task approvals do not by themselves prove that the assembled change
works. Re-run only checks invalidated by later edits, plus the normal final preflight.

## 5. Use three kinds of tests for three different claims

1. Unit tests check our decisions with controlled collaborators. A spy verifying that a signal
   is forwarded proves forwarding only. Name it accordingly; do not say it proves cancellation.
2. Integration tests run our adapter through the real installed SDK and a local HTTP server.
   They check response parsing, error-body behavior, retry timing, cancellation, and logging.
   Runner tests include real queue/store behavior and prove that the next goal can start.
3. A live smoke test checks the real provider and remote computer after the combined repair.
   It complements local fault injection. It cannot reliably generate a retry-delay race or
   malformed provider stream on demand.

Use controlled promises or I/O barriers to select race timing. Use fake timers for timers owned
by our code. Where the real SDK and HTTP transport need real timers, use short bounded deadlines
and observable events. Do not globally accelerate arbitrary timers in permanent tests. The
diagnostic scripts' global timer substitution is evidence tooling, not the proposed CI design.

Keep assertions for outcome, forbidden action, cleanup, and next-goal success together when they
prove one lifecycle contract. Avoid unrelated assertions, but do not split a coherent recovery
scenario until each fragment can pass while the whole operation is broken.

For every repaired bug, demonstrate at least one test that fails on the unfixed code for the
intended reason. A targeted temporary removal of a cancellation check is enough when comparing
with the old version is impractical. No new mutation-testing package is needed.

Move the relevant cases from the review scripts into the existing Vitest suites with typed,
reusable HTTP fixtures. The review scripts deliberately assert that some defects exist; they
must not be added to CI unchanged. Tests for the repaired system assert the desired behavior.

## 6. Put durable rules in one place and enforce the behavior automatically

Proposed file changes:

| File or area | Proposed change |
| --- | --- |
| New `docs/engineering/verification-contract.md` | Short shared policy: risk triggers, lifecycle ownership, evidence levels, and release criteria. |
| `AGENTS.md` and `CLAUDE.md` | Reference that policy, require the brief for relevant changes, and reconcile the conflicting small-change review rules. |
| Both copies of `/plan` | Add the change brief, dependency assumptions, and the lifecycle verification matrix. |
| Both copies of `/implement` | Replace line minimization with complete contract repair; correct the automatic architecture/revert conclusions; pass boundary context to workers and reviewers. |
| Both copies of `/verify` | Add failure recovery, cancellation timing, log filtering, complete persisted output, and next-goal checks when applicable. |
| Code, test, and plan reviewer definitions for both tools | Reference the shared policy and require evidence appropriate to the claim. |
| `src/server/agent/*.test.ts` and shared test fixtures | Turn the reproduced failures into permanent desired-behavior regression tests. |
| Proposed CI workflow under `.github/workflows/` | Run the existing preflight from a clean checkout with pinned project tooling and synthetic local test credentials; require no paid services. |

Keep provider-specific entry files short. Store common behavioral policy once and make the
skills explicitly read it. Do not add another large, independently maintained copy to each role.
No new skill, plugin, agent framework, test library, or external service is needed for this scope.

If process text and tests conflict, resolve the contract explicitly. A green preflight proves
the checked behaviors; it does not prove the completeness of the contract or replace the live
verification required by the product.

## 7. Adoption order and proof of improvement

1. Adopt the brief, risk triggers, and revised reviewer evidence requirements before repairing
   these findings. That lets this repair exercise the proposed process immediately.
2. Implement F1 and the combined F2/F3 adapter change with failing tests first. Keep F4 logging
   and F5 text delivery as separate reviewable changes.
3. Run the final integrated matrix, preflight, and a live model/tool continuation. Verify queued
   recovery locally and the complete persisted answer locally plus in the UI.
4. Consolidate the common policy references and wire the existing preflight into CI. Keep this
   mechanical work separate from application changes.

Judge the process by evidence on this repair: all five previous defects are caught by permanent
tests; a known-bad version fails them; reviewers inspect unchanged boundary code; and no required
case is silently marked passed without execution. Record any escaped defect and which assumption
or check missed it. Do not use total test count, reviewer count, or document length as success
metrics. These changes should reduce repeated omissions; they cannot guarantee that no new bug
will be found.

The proposal needs no new product decision beyond its stated retry-deadline and partial-answer
trade-offs. Those are recommendations, not implemented behavior. Source inspection and the
existing reproductions support the proposal; the proposed repairs still need their own tests
and reviews when implemented.
