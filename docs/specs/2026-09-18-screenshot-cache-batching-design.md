# Screenshot Cache Batching Design Spec

**Date:** 2026-09-18
**Status:** Revision 4 (2026-09-19). Revisions 1 to 3 (2026-09-18) followed a second review
against the code and the numeric evidence (revision 1) and two audit rounds by Codex (revisions 2
and 3). Revision 4 follows the review of the plan and changes one rule of criterion 7. The owner
decided on 2026-09-18 to apply the change on Saturday 19 September, before the rehearsals of both
acts; filming is on Sunday 20. The changes of all revisions are listed under "Review and document
verification". The plan is `docs/plans/2026-09-19-screenshot-cache-batching-plan.md`; the owner
approved it on 2026-09-19.
**TODO items:** Section 3, "Screenshot-cache batching after the cost review".
**Scope:** Image retention in the existing agent loop, focused tests, numeric evidence and a
decisions entry after verification. One milestone. No router, provider integration or new package.

## Problem

The owner asked whether using cheaper models for work without the computer would reduce bot costs.
An analysis of the existing job-hunt bot found a larger opportunity in how the loop removes old
screenshots. The owner chose "Design screenshot-cache batching" after reviewing those findings.
This design serves the existing job: research a posting, prepare an application, and handle an
interview invitation on a visible remote computer. It adds no new user workflow.

The [frozen numeric evidence](../evidence/2026-09-18-cache-batching/README.md) covers 68 runs and
1,137 calls with $23.99 of recorded model usage. About 69% was cache-write cost. Only $0.72
was spent on runs without computer `step` events; some of those still opened the browser or
requested takeover. Routing whole runs to a half-price model suggests a gross saving of about
1.2–1.5% for this sample. This is not a universal upper bound on model routing.

The current [run loop](../../src/server/agent/run.ts) retains three image results. Each new image
beyond that limit edits an older result before the next request. The unchanged prefix can then
end at the cached tools/system prompt, forcing the later conversation to be written again.
This follows the provider's exact-prefix matching rule [R1]. The baseline is already cached;
the problem is repeated mutation of that cached history.

The mechanism, step by step [R1, C1]: a cache entry is written only at a breakpoint, and the loop
has one moving breakpoint on the last user block. So every entry was written while the newest three
images were still intact. Each of those images is later replaced by a note. After that, no earlier
entry matches the conversation any more, and only the system-prompt entry can be read. The recorded
usage shows this without any replay: of 540 warm calls that followed a removal, 400 read only the
base prefix, and they wrote 9,727 tokens on average. The 521 warm calls with no removal before them
wrote 990 tokens on average. "Warm" is judged here by cost-event times, the only clock in the
frozen snapshot; the live check uses bounds on the request-start times (criterion 7).

The offline replay estimates about $15.04 with batching, versus $25.64 for the current rule and
$23.99 recorded usage. A possible 35–40% saving is a reason to validate this small change,
not a promise. The average recorded run costs $0.35. The value is lower recurring model usage;
the cost is a larger visual history that may change decisions. [Evidence](../evidence/2026-09-18-cache-batching/results.json)

## Decisions Log

| # | Question | Decision | Reasoning |
| --- | --- | --- | --- |
| 1 | Which cost change is being designed? | Screenshot-cache batching, selected by the owner. | The measured cache-write spending is much larger than the whole-run routing opportunity. |
| 2 | What happens to model routing? | Park it for this workload. | Another model adds request compatibility, handoff and quality checks for a small measured eligible share. Revisit if the workload or measured eligible spending changes. |
| 3 | Which retention rule? | Keep up to 13 tracked images; when the count exceeds 13, remove all but the newest three. | This is the bounded policy evaluated by the supplied replay. Thirteen is the total, not 13 old images plus three recent ones. |
| 4 | What is allowed to change inside an old result? | Replace its image block with the existing removal note; retain every non-image block and result field. | Warning text and tool identity must survive image removal. The existing function replaces the whole content array. |
| 5 | When does trimming happen? | Once after a completed tool-result batch joins the conversation, before the next model request. | This is the existing pruning boundary; multiple screenshots in one response cannot send an oversized history on the next call. |
| 6 | What stays fixed? | Model, thinking settings, prompts, tools, cache breakpoints, SDK, gate, timers, storage and sandbox lifecycle. | This keeps the live comparison about image retention. |
| 7 | How is the rule configured? | Two internal constants: retained target 3 and limit 13. | No user setting, env variable, strategy interface or automatic tuner earns a place in the demo. |
| 8 | What proves success? | Correct request construction in tests. Then one live candidate run per act: the cache mechanism is proven by per-call cache-write tokens, and job quality by verified artifacts. The baseline is the 68 recorded runs. No paired baseline runs. | Passing a unit test cannot prove cache hits or model behavior. The mechanism is deterministic, so one run shows it. Run totals vary too much for two pairs to show a cost difference, and two pairs cannot prove quality either. Fewer live runs also means one real test booking, not two. |
| 9 | What happens if validation fails? | Keep the three-image retention policy and retain the evidence. | A lower estimated cost does not justify wrong actions, worse artifacts or more human correction. |
| 10 | Is text preservation part of batching? | No. It is a separate correctness fix. It lands first, in its own commit, and it stays under either limit. | Today the model loses the "an approved action may already have happened" text once three newer screenshots exist. The chat warning survives through the run's own state, but the model's context does not keep it (invariant 4). The fix is right whether or not batching is accepted. |
| 11 | When is it applied? | Saturday 19 September, before the rehearsals of both acts. The rehearsals are the validation runs. The build freeze is the end of those rehearsals. | The owner, 2026-09-18: the technical solution is graded as well as the video, and a measured cost fix is part of it. The code that is filmed must be the code that was rehearsed, so the limit does not change after the rehearsals. |

## Chosen Approach

Apply a bounded batch-removal rule inside the current loop. Preserve earlier message content
between removals so the cache can reuse a longer prefix. Keep the newest three images after
each removal. The maximum sent on a later request is 13 tracked images, including screenshots,
zoom results and screenshots returned with recoverable action errors. [C1, C2, R1]

This differs from Grok Bot's opaque model usage by recording the measured cost trade-off, while
keeping the user free of model and cache settings. It preserves Dobot's existing per-bot
computer isolation. It does not add a new scene to the demo: the existing real work must still
finish with the same approvals and takeover behavior. [Product](../01-product.md),
[architecture](../02-architecture.md). The project started as a take-home proof of concept for a company, September 2026.

## Research (source links)

Verified 2026-09-18. Existing versions stay pinned in [package.json](../../package.json).
No dependency installation or upgrade is proposed.

- **R1 — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):**
  cache hits require identical prefixes, including images; a five-minute write costs 1.25 times
  base input and a Sonnet cache read costs 0.1 times base input. Changing an earlier image can
  invalidate message caching. No new caching API is needed. Re-read on 2026-09-18 for revision 1:
  a cache entry is written only at a breakpoint, never at an earlier position; a read walks back
  at most 20 block positions from the breakpoint, and a run of consecutive `tool_result` blocks
  counts as one position; the five-minute lifetime is measured from the start of the request that
  wrote or read the entry, so a slow answer shortens the window for the next call. Re-read on
  2026-09-19 for revision 4: a change in whether the prompt holds any image invalidates the
  message cache and leaves the tools and system entries valid ("What invalidates the cache", row
  "Images", and the note under "Troubleshooting common issues").
- **R2 — [Anthropic reference loop](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/computer_use_demo/loop.py):**
  its image-removal helper removes in chunks. Its current Anthropic caching branch disables
  pruning entirely. The bounded 13-to-three rule here is our proposed trade-off, not a claim
  that the reference uses that exact rule.
- **R3 — [Messages types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts):**
  checked against installed `@anthropic-ai/sdk` 0.125.0. `ToolResultBlockParam.content` can contain
  text and image blocks; `tool_use_id`, `toolset_name` and `is_error` belong to the result.
  Image removal need not discard any of them.
- **R4 — [Thinking preservation](https://platform.claude.com/docs/en/build-with-claude/thinking):**
  thinking blocks returned during tool use must be passed back unchanged. This design edits
  user tool-result image content only, never assistant thinking or tool calls.
- **R5 — [Vision limits and token cost](https://platform.claude.com/docs/en/build-with-claude/vision):**
  the per-request limit is 100 images for models with a 200k-token context window and 600 for
  all other models. Above 20 images in one request, a stricter per-image size limit applies (keep
  both sides at or under 2,000 px), and images inside `tool_result` blocks count. Thirteen images
  stays under both numbers, and 1280 by 800 is under the stricter size in any case. Base64 images
  are sent again in full on every request, so more retained images mean a larger request body;
  the page names latency as the cost. The current formula gives 1,334
  visual tokens for a 1280 by 800 image. The replay's fixed 1,306-token assumption is an
  approximation; its sensitivity check and other limitations are in the evidence README.
- **R6 — [Model prices](https://platform.claude.com/docs/en/about-claude/pricing) and
  [computer-tool compatibility](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#compatibility):**
  Sonnet 5 input/output rates are $2/$10 per million tokens; Haiku 4.5 rates are $1/$5.
  Haiku uses an older computer-tool version, not the current toolset. Sonnet is the cheapest
  listed compatible model for this integration. This does not prove Haiku cannot use a computer.
- **R7 — [E2B persistence](https://docs.e2b.dev/sandbox/persistence) and
  [pricing](https://e2b.dev/pricing):** pause preserves filesystem and memory; current docs say
  paused sandboxes have no automatic expiry. Running compute is billed per second. This change
  uses existing `@e2b/desktop` 2.4.0 / `e2b` 2.49.1 behavior and changes neither pause nor resume.
  The earlier platform spec's 30-day note is historical; batching relies on no retention period.
- **C1 — [run.ts](../../src/server/agent/run.ts):** `handleComputer` adds image-bearing results to
  `shots`; `pruneImages` currently replaces the whole old content array; `setCacheBreakpoint`
  places the moving message breakpoint on the last user block. `lastShot` is separate. There are
  two breakpoints, not three: a fixed one on the system block, which also covers the tools because
  tools come before the system prompt in the prefix, and the moving one. `STEP_BUDGET` is 150 and
  `TURN_BUDGET` is 200. Saved screenshots average 115 KB and the largest is 215 KB (400 files under
  `data/bots/job-hunt-bot`, measured 2026-09-18).
- **C2 — [actions.ts](../../src/server/agent/actions.ts), [e2b.ts](../../src/server/sandbox/e2b.ts):**
  screenshots and zoom return image results; the desktop resolution is 1280 by 800.
- **C3 — [runner.ts](../../src/server/agent/runner.ts), [recovery.ts](../../src/server/agent/recovery.ts),
  [model.ts](../../src/server/agent/model.ts):** the runner owns sandbox holds and Stop; recovery
  closes interrupted runs; the model adapter owns first-byte and stream-stall limits.
- **C4 — [run.test.ts](../../src/server/agent/run.test.ts), [fakes.ts](../../src/server/agent/fakes.ts):**
  an existing test expects three images after five screenshots. `FakeModel` stores a deep copy
  of each submitted request, which permits checks of actual loop input at every boundary.

## Design

### State table before changing the loop

The pruning operation is synchronous and does no external I/O. The table defines its contract
with the existing model-call and action lifecycle. It introduces no retry or timer. [C1, C3]

| State | Required behavior |
| --- | --- |
| Success, zero to 13 tracked images | Leave image content and its order unchanged. The existing cache-marker update still runs. |
| Success, 14 or more tracked images | Remove oldest images until exactly three remain, in one pass before the next model request. |
| Multiple results in one response | Append the complete batch first; apply the same threshold to the total, not separately to each result. |
| Recoverable action failure | Its screenshot counts as an image; preserve the error text, partial-action warning and `is_error` when that image is later removed. |
| Model or sandbox failure | Follow the existing failure path. Do not replay tools or alter approvals to recover a cache hit. |
| Timeout or slow stream | Keep the existing adapter timeouts and error wording. No policy switch or new request is added. |
| Stop | Existing Stop checks end the run and abort the model request. Pruning cannot start an action or a replacement request. |
| Retry after incomplete tool input | Keep the existing one retry at the raised output limit; no partial tool executes and no new image is added from it. |
| Partial text response | Keep the existing delivered text and continuation. Do not discard it or change retention because of an output cap. |
| Approval or takeover wait | Retain current context while waiting. A cache can expire during the wait; the existing human boundary wins over savings. |
| Hand-back | Use the existing safe-hand-back checks and fresh-screen behavior; no new screenshot or model call occurs during human control. |
| Restart | Existing recovery ends the old run; a later goal starts new in-memory history. Saved artifacts, memories and screenshot files remain. No replay or policy state is restored. |

### Exact retention contract

Use `IMAGES_KEPT = 3` as the retained target and one new internal limit of 13. On each existing
call to `pruneImages`, return without editing when `shots.length <= 13`. Otherwise remove the
oldest references until the length is three. The choice of constant name is left to `/plan`.
[Existing location: C1]

For each removed reference, replace its image block in place in `content` with the existing
text note, `screenshot after step N (removed to save context)`. Preserve the order and exact text
of other content blocks. Preserve the outer result's identity and fields. Do not replace the
entire content array with a one-item array. All current tracked results carry one image; if a
future result carries several images, its tracking must count individual image blocks before
using this policy. [C1, R3]

| Images just before pruning | Images on the next request | Removed in this pass |
| ---: | ---: | ---: |
| 0 | 0 | 0 |
| 3 | 3 | 0 |
| 4 | 4 | 0 |
| 13 | 13 | 0 |
| 14 | 3 | 11 |
| 17 from a tool batch | 3 | 14 |

This is not "remove ten every time". Ten is the extra allowance above the retained target.
Do not remove a screenshot file from disk. Do not change `lastShot`, the progress detector's
image samples, screenshot dimensions, action ordering or the number of tools executed. [C1, C2]

### Cache and context boundaries

Keep the two existing breakpoints: the fixed one on the system block, which also covers the
tools, and the moving one on the last user block. Do not add a third. Between pruning passes, old
content stays unchanged apart from the already-existing marker movement. A removal still
causes a cache miss for part of the history. The intended improvement is fewer removals,
not eliminating all misses. Human waits, different prompts and cache expiry still matter. [R1, C1]

Keep every assistant content block unchanged, including thinking signatures, tool-use IDs and
the complete tool-use/result pairing. Never reconstruct or summarize thinking to reduce cost.
Do not add a second model, compact the text history, change prompts or change thinking effort.
[R3, R4]

Preserving non-image text is part of this contract because a removed error image must not remove
the accompanying warning that an approved action may already have happened. Tests must exercise
that case. The proposed change is small, but "five lines plus a test" understates its validation
needs. [C1, C4]

### Observability and rollback

Use the existing per-response token counts and cost events for evaluation. No new product UI,
event schema, telemetry service or payload logging is required. Tests inspect submitted requests
at the model boundary; live comparisons inspect the numeric usage events. Do not print base64
images, signed thinking, raw model payloads, secrets or private page text into evaluation output.
[C1, C3, evidence](../evidence/2026-09-18-cache-batching/README.md)

The work lands as two commits (decision 10). The first preserves non-image text and keeps the
limit at three; tests for criterion 3 pass on it alone. The second raises the limit to 13. This
keeps the fallback a change of one constant, and it keeps the correctness fix if batching is rejected.

The fallback retention rule sets the limit back to three while retaining the preservation of
non-image text. `/plan` must keep that fallback easy to apply and verify. No automatic fallback
mid-run is added. This avoids two simultaneous context policies within a conversation.

## Demo path

The visible job is unchanged. Routing and cache settings do not appear in the product.
The existing successful act-one evidence (record omitted from this snapshot)
and [act-two evidence](../evidence/2026-09-18-act-two/README.md) define the working baseline.
This table describes the proof path, not a video script.

| # | What the viewer sees | What happens underneath |
| --- | --- | --- |
| 1 | The user gives Hunter a posting to research and prepare. | The same model, memory and skill start the same job on its live computer. |
| 2 | Hunter reads the real pages; dossier and letter cards appear. | Screenshots accumulate up to 13. A later batch drops the older images to three, without changing the live screen or saved evidence. |
| 3 | Hunter fills the application and shows the submit approval card. | The existing gate still checks the real target before execution. |
| 4 | The user presses Deny; Hunter records that nothing was submitted. | The job's prepared artifacts remain, and denial grants no execution. |
| 5 | An authorized rehearsal invitation arrives; Hunter opens its mailbox and the booking page. | The existing routine and skills run. The same retention rule applies to this separate run. |
| 6 | If a login or CAPTCHA appears, the user takes over and hands back after completing it. | Existing secret guards and safe hand-back remain in control. If no challenge appears, one requested manual takeover verifies this boundary without manufacturing a challenge. |
| 7 | Hunter proposes one booking, waits for Allow, then shows the site's confirmation. | An expressly authorized test booking is the real external artifact; the confirmation and memory establish completion. |

The design authorizes no sending, booking, deletion or mailbox cleanup by the agent that does the
work, Codex or Claude. During live verification the owner approves the exact test side effects himself
or gives explicit scoped permission. Existing permissions recorded for earlier rehearsals are not reused. [Invariant 4]

## Verification criteria

`/plan` must turn these requirements into loop-level regression checks and a live evidence plan.
No standalone tests of an implementation-shaped `if` statement are sufficient. [C4]

1. With distinct screenshots, submitted requests contain four and then 13 images without earlier
   image removal. At 14, the next request contains exactly the newest three, in order. A batched
   response crossing the threshold also leaves exactly the newest three before the next call.
2. A request before the threshold retains the earlier request's image-bearing content prefix;
   compare payload content while ignoring only cache-marker placement. After trimming, notes
   replace the removed image positions. Older request snapshots remain unchanged.
3. After an image from a recoverable action error is removed, its unknown-outcome/partial-action
   text, `is_error`, `tool_use_id` and `toolset_name` remain unchanged. A normal image with an
   attached progress warning also retains its warning. No duplicate notes appear on later passes.
4. Screenshot, zoom and error-image results share the same limit. Saved screenshot files and the
   latest screenshot used for zoom remain available after the corresponding context image is removed.
5. Signed assistant thinking, tool-use/result order and the existing cache-breakpoint assertions
   still pass. Existing Stop, truncated-response retry, gate, Deny, takeover and recovery tests
   pass. The changed image test checks the new contract through `runLoop` and captured requests.
   The signed-thinking test ("returns complete assistant blocks unchanged across tool results and
   screenshot pruning") is extended to at least 14 screenshots, and it asserts that the final request
   holds a removal note. Its four screenshots prune under the three-image rule but not under the new
   one, so without this change it would pass while no longer testing pruning at all.
6. `pnpm preflight` passes, including typecheck, TypeScript tests, Python companion tests and the
   no-site-specific-code check. Tests run against the real loop with simulated external boundaries;
   they do not claim to prove provider billing or model quality.
7. Prove the cache mechanism in one live candidate run per act: the application Deny path and the
   controlled interview-booking path, both with the 13-image limit. These are the Saturday
   rehearsals (decision 11). Use the numeric usage events and the event times only.
   - **The clock.** The cache lifetime counts from the start of the request that wrote or read
     the entry, not from the end of its answer [R1]. A cost event is written when the answer ends,
     so the time between cost events is the wrong clock: a four-minute answer followed by a
     two-minute approval wait looks warm on that clock, and the entry has expired. The run events
     do not hold the request start either. One logical model call can be up to three HTTP attempts,
     because the adapter allows two SDK retries with a 120-second wait for the first byte on each
     [C3, `model.ts` lines 58 to 60], and a retry emits no run event. So the successful attempt can
     start minutes after the last run event before the call.
   - **Bounds, not estimates.** For call n, let E(n) be the time of the last run event before its
     cost event, and C(n) the time of its cost event. Every run event carries a time. The attempt
     that was answered started somewhere between E(n) and C(n). So the interval between the
     request starts of call n and call n+1 is at most C(n+1) minus E(n), and at least E(n+1) minus
     C(n). After a discarded answer, E of the next call is the discarded call's own cost event.
   - **Classes.** A call after the first is warm only when C(n+1) minus E(n) is at most 240
     seconds: then the cache was alive whatever the retries did. It is expired when E(n+1) minus
     C(n) is more than 300 seconds. Every other call is uncertain. Only warm calls are judged.
     Expired and uncertain calls are counted and reported, and they never count against the
     candidate. The cost of this rule is that a call with a long answer on either side is not
     judged; a normal turn takes about five seconds, so few calls are lost.
   - **The first image of a run.** The first request of a run that carries an image is not
     judged. The API drops the message cache when a prompt goes from no image to some image [R1],
     so this request reads only the tools and system entry, whatever the retention rule is. The
     recorded runs show it: 55 runs sent an image, and in 48 of them the first request with an
     image missed, with one image in the context and no removal before it
     ([evidence](../evidence/2026-09-18-cache-batching/README.md), "The first image of a run").
     Report this request on its own line, like the first call of a run. Without this rule every
     run starts with one miss, and a run with 10 to 19 judged calls cannot afford a second one
     under the 90% measure below: three of the 19 recorded runs with ten or more judged calls
     stand at exactly 90%.
   - **Measure.** Split the warm calls by whether an image removal happened just before the call.
     On at least 90% of the warm calls with no removal before them, the cache read is at least 95%
     of the previous call's whole prompt (uncached input plus cache read plus cache write), and
     the median cache write on those calls is at most 4,000 tokens. The recorded baseline writes
     9,727 tokens on average after a removal and 990 without one; a call under batching also
     writes one new image of about 1,334 tokens, which is why the limit is 4,000 and not 1,000.
     Count the calls that followed a removal and record their cache writes as well.
   - **Too few warm calls.** A run with fewer than ten judged calls proves nothing either way; it
     is reported as such and another run is needed.
   There are no paired baseline runs; the baseline is the 68 recorded runs in the
   [evidence](../evidence/2026-09-18-cache-batching/results.json) (decision 8). That baseline was
   classified by cost-event times, because the frozen snapshot holds nothing else; the evidence
   README names this limit.
8. At least one candidate run must cross the 13-image limit; 19 of the 68 recorded runs did. If the
   two acts do not reach it, the live policy check remains incomplete; select a naturally longer
   real reading task rather than instructing the bot to take meaningless screenshots. Capture run
   outcome, calls, total model cost, cache reads/writes, artifact correctness, approval behavior and
   human corrections. A completion requires verified artifacts, not merely an `end: done` event.
   Turn duration has a limit: the median time between cost events in a candidate run, leaving out
   gaps over five minutes, is at most 6,808 ms. That is the largest per-run median among the 19
   recorded runs with 14 or more images. This number holds the model call, the tool execution, the
   site's speed and any short human wait together, so it cannot name a cause, and this spec does not
   try to. A run at or under the limit passes. A run above it is inconclusive on speed: report the
   number, and next to it the median time of a logical model call in that run (C(n) minus E(n) of
   criterion 7, SDK retries included), for which no recorded baseline exists. The owner, who
   watched the rehearsal, decides whether the pace is acceptable for filming.
9. Accept the change only if all of these hold: both jobs finish correctly; criterion 7 holds in
   every candidate run with enough warm calls to judge; no new stale-screen action or repeated side
   effect is observed; no extra human correction is caused by batching; the turn-duration limit of
   criterion 8 holds, or the owner accepted the pace of a run above it. Report the cost per call and the cache-write share of the candidate runs next
   to the recorded baseline ($0.0211 per call, 69% cache writes). Include failed attempts, retries
   and confirmation-mail follow-ups; do not discard failed runs to improve the numbers. The write-up
   states the estimate and the measured figure side by side, with the number of runs behind the
   measured one. If a condition fails or the result is inconclusive, set the limit back to three,
   rehearse once more on that code, and report the estimate as unconfirmed. A handful of runs is a
   bounded regression check, not a general statistical guarantee of a 35–40% saving.

## Invariant coverage

| # | Invariant | Mechanism |
| --- | --- | --- |
| 1 | Visible remote computer | Only model context changes; the live stream and real desktop actions remain. [C1, C2] |
| 2 | Real work, not simulation | Offline arithmetic is labeled as such; acceptance requires the real dossier/application and authorized booking paths. |
| 3 | One job, finished | Artifact and confirmation checks define completion; cheaper usage never substitutes for finishing the job. |
| 4 | Approval before irreversible side effects | Existing gate and approval state remain; preserve unknown-outcome text; no new execution path or retry. [C1, C3] |
| 5 | Takeover without secrets in the transcript | Existing takeover guards remain; no images are newly captured during human control; evidence contains only numeric usage. [C3] |
| 6 | Persistence across sessions | Pruning edits in-memory request content only; bot files and screenshot evidence remain; interrupted runs keep existing recovery semantics. [C1, C3] |
| 7 | Configured in plain language, never by engineering | The bot's goals, skills and routines remain chat-led; retention is an internal platform constant, with no new user controls. |

## Failure modes on the day

| Failure | Detection and response |
| --- | --- |
| Sandbox cannot start or resume | Existing runner reports failure; operator resolves it before another run. Cache policy cannot recover or replace a computer. [C3, R7] |
| Target site changes its layout | Live artifact/action checks expose wrong navigation; Stop and inspect. Update site knowledge through the established chat-led process, outside this cost change. |
| Login expired or CAPTCHA appears | Existing takeover asks the human to complete only that step. A long wait may expire the cache; do not bypass takeover for cost. [C3, R1] |
| More history causes a stale-screen action | Stop, inspect the real outcome, and reject the candidate policy for filming until diagnosed. Revert the retention limit, not the user's external action. |
| Model loops or stalls | Existing progress/step/call limits and adapter stall timeout apply. Preserve warning text and the honest final outcome. [C1, C3] |
| Slow network or cache expiry | Existing timeouts and retry rules apply; include the cost, and judge only the calls that criterion 7 classes as warm by its time bounds. No extra action retry. [C3, R1] |
| Calls get slower because the request is larger | A request carries about 2 MB of images at 13 retained, against about 0.5 MB at three (average file 115 KB, base64). Criterion 8 sets a turn-duration limit. That measure cannot separate a large request from a slow site or a long answer, so a run above it is reported as inconclusive and the owner decides on the pace he saw. [R5, C1] |
| Request is too large or context is exhausted | Existing error path ends the run honestly; restore the three-image limit for later runs if the extra images caused it. Thirteen is an image-count bound, not a complete byte/token budget. [R5, C1] |
| Failure after an approved action | Preserve consumed approval and unknown-outcome warning. Check the external system before repeating anything. [C1, C3] |

## Scope budget

In: the retention threshold, removal of image blocks with text preserved, meaningful loop tests,
the numeric cost evidence, one live candidate run per act, and a decisions entry with measured outcomes.
The changed implementation should stay in `src/server/agent/run.ts` and its existing tests unless
test readability needs a small local helper. No package, framework or storage schema is added.

Out: model routing, provider changes, lazy sandbox startup, new cache-breakpoint strategies,
text compaction, screenshot compression, automatic threshold tuning and a usage dashboard.
Each changes a second variable or adds a failure mode that this cost experiment does not need.
Model routing is recorded in the private backlog.

Estimated the owner-only effort: 0.25–0.5 hours to review artifacts, approve the one controlled
booking and perform any required sign-in/CAPTCHA or cleanup. Estimated live work: two candidate
runs, one per act, plus confirmation-mail follow-ups. They are the Saturday rehearsals, which are
owed before filming in any case, so the change adds no live cycle of its own unless a run fails
or does not reach 14 images. A rejected candidate costs one more rehearsal on the three-image
limit. An agent, Codex or Claude, does the technical work; the owner names which.
These are estimates, not a claim that the live checks have already happened.

## Alternatives Considered

| Approach | Gain | Cost and reason for decision | Human-only work and live cycles |
| --- | --- | --- | --- |
| Keep three images after every turn | Keeps the currently verified visual context; no behavior change. | Repeated prefix edits remain; retained as the fallback if batching does not pass. [C1, R1] | No new human steps or live cycles. |
| Allow 13, then retain three | Fewer prefix edits with a fixed image-count bound; same model and action path. | Up to ten more historical images may change decisions; selected for validation because the replay indicates material savings. [Numeric evidence](../evidence/2026-09-18-cache-batching/results.json) | 0.25–0.5 the owner hours; two candidate runs, which are the rehearsals owed before filming. |
| Never prune images | Longest stable history; matches the current Anthropic reference caching branch. [R2] | Replay reaches about 93k prompt tokens; larger histories and request sizes need their own quality/limit evaluation; it is not cheaper than batching in this replay. There is also a hard limit: `STEP_BUDGET` is 150, and the API refuses more than 100 images per request on models with a 200k-token context window (600 on the others), with a stricter per-image size rule above 20. A long run without pruning would fail outright on the lower limit. [R5, C1] | At least the same two candidate runs, plus a long-run request-limit check. |

The earlier router proposal remains a valid general pattern. It is not the chosen optimization
for this measured workload. A more expensive default model alone would not change the eligible
share: at an unchanged 3% share, an 80% price reduction saves only about 2.4% overall. A separate
classifier is also not inherent to routing; a model can answer or request escalation. Neither
point creates a current case to add the router. [R6, evidence](../evidence/2026-09-18-cache-batching/README.md)

## Review and document verification

The design reviewer passed the draft on 2026-09-18 with no blocking findings after checking the
loop, evidence calculation and all seven invariants. Its suggestion to define experiment cost
precisely is incorporated in criterion 9: compare totals across the same two jobs, include failed
attempts and follow-ups, and reject extra human correction caused by the candidate.
The optional suggestion to pin the upstream reference loop to a commit remains a source-provenance
limit: the verified link targets `main` and can change. R2 records the behavior inspected on this
date; `/plan` must recheck that source if it uses the reference helper. The implementation contract
in this spec does not depend on copying that helper.

The numeric evidence reproduces all 1,137 captured usage events and contains no conversation
content. Local document links and the placeholder scan passed. The full existing preflight
passed typecheck, 543 TypeScript tests, 16 Python tests and the site-code check. The first sandboxed
attempt could not listen on localhost or inspect processes; the authorized rerun passed.
These checks verify the design artifacts and current baseline, not an implemented batching policy.

### Revision 1, 2026-09-18

A second review (Claude, on the owner's request) checked the spec against `run.ts`, the evidence
script and `usage.json`, and re-read R1 and R5 on the same day. The core claims held. Changes:

1. Decisions 8, 10 and 11 are new or rewritten: a single-run proof of the mechanism, text
   preservation as its own fix and commit, and the Saturday schedule with its freeze.
2. Criteria 7 to 9 are rewritten. The paired baseline runs are gone. "Reduced cache-write
   pressure", which had no definition, is now a measure with numbers. One test booking is needed,
   not two.
3. The evidence script has a new `recorded` block, and `results.json` and the evidence README
   carry its output: 540 warm calls after a removal (400 read only the base prefix, 9,727 tokens
   written on average) against 521 without one (990 tokens). Every earlier number in
   `results.json` is unchanged.
4. Latency has a limit (criterion 8) and a failure-mode row. The first draft recorded duration
   but set no limit.
5. The breakpoint wording is corrected: two breakpoints, not three (C1 and "Cache and context
   boundaries").
6. R1 now records that writes happen only at a breakpoint, the 20-block lookback and the lifetime
   rule. R5 now records the per-request image limits. The "never prune" row uses them.

### Revision 2, 2026-09-18

Codex audited revision 1 and the owner relayed three findings. Each was checked against the cited
lines, the run events and R1 before it was addressed. All three held.

1. Blocking: criterion 7 classed a call as warm by the time between cost events. A cost event is
   written when the answer ends, and the cache lifetime counts from the request start [R1]. The
   criterion now estimates request starts from the run events, which all carry a time (checked on
   a run of 2026-09-18), uses three classes with a 60-second margin, and judges warm calls only.
2. Blocking: criterion 8 claimed that comparing calls with many and few retained images would
   show whether the larger request caused a slow run. The time between cost events also holds tool
   execution, site speed, answer length and short waits, so that comparison proves nothing. The
   claim is removed. The limit stays as a turn-duration limit with no cause assigned; a run above
   it is inconclusive and the owner decides.
3. Suggestion, accepted: criterion 5 now extends the signed-thinking test to 14 or more
   screenshots. Its four screenshots would not trigger pruning under the new limit.

The same clock problem applies to the `recorded` block of the evidence script, which can only use
cost-event times. The evidence README now says so. The numbers are unchanged.

### Revision 3, 2026-09-18

Codex audited revision 2 and found one blocking defect. It was checked at `model.ts` lines 58 to
60 and 77 to 78 and it held: the adapter allows two SDK retries with a 120-second first-byte wait
each, and a retry emits no run event. Revision 2 took the last run event before a call as its
request start, so an answered attempt could start minutes later, after the cache had expired, and
still be classed as warm. The 60-second margin did not cover that.

Criterion 7 now uses bounds in place of an estimate. The answered attempt of a call started
between the last run event before it and its cost event. A call is warm only when the longest
possible interval between two request starts is at most 240 seconds, expired when the shortest
possible interval is over 300 seconds, and uncertain otherwise. Only warm calls are judged. This
needs no new instrumentation, and a retry delay can no longer count against batching. Criterion 8
names its extra number as the time of a logical model call, retries included.

### Revision 4, 2026-09-19

Claude reviewed the plan on the owner's request and ran the plan's evaluator on the frozen snapshot,
under the three-image rule. One finding reached this spec, and the owner accepted it the same day.

The first request of a run that carries an image misses the message cache by the provider's own
rule [R1], and criterion 7 counted it as a judged miss. So every run started with one miss that
has nothing to do with image removal. The 90% measure then leaves a run with 10 to 19 judged
calls no room for a second miss, and a short candidate run could have sent a working change to
the fallback. Criterion 7 now leaves that one request out of the judged set and reports it on its
own line. The thresholds are unchanged. The counts behind it come from `first-image.mjs`, a new
script in the evidence folder: the miss in 48 of 55 runs, and the recorded runs under the 90%
measure. With that request judged, three of 19 runs stand at exactly 90%. With it left out, every
judged call in all 16 runs with ten or more of them reuses the cache, so a miss that remains in a
candidate run is a real signal. The frozen snapshot and `results.json` are unchanged.

### Note after the first rehearsal, 2026-09-19

The state table and criterion 3 above say that a recoverable action failure keeps its `is_error`
when its image is removed. They were written while that result carried `is_error: true`. The first
act-one rehearsal showed that the API refuses exactly that result: an error result may hold text
only (HTTP 400, "all content must be type `text` if `is_error` is true"). Since commit `a8c711e`
the result for an action the computer did not answer carries the warning text and the fresh
screenshot and no `is_error`; the text-only result for a command that failed inside the computer
still carries it. Criterion 3 now reads: removing an image leaves every outer field of the result as
it was, whatever those fields are. The tests compare the outer fields before and after a removal.
The defect was older than this change and has nothing to do with image retention; the record is in
the plan's live record and in `docs/evidence/2026-09-19-cache-batching/`.

Not re-run in any revision: `pnpm preflight`, because no application code changed. The design
reviewer agent was not run again; its pass applies to the first draft.

## Backbrief

The bot will keep more recent screenshots between occasional removals so repeated model calls
can reuse more cached context. It will use the same model and finish the same visible jobs.
The critical constraints are a maximum of 13 tracked images on the next request, preservation
of tool warnings and signed thinking, and unchanged approval, takeover and Stop behavior.
The work lands on Saturday 19 September as two commits: text preservation first, then the limit.
The two rehearsals of that day are the live checks, and the limit does not change after them.
`/plan` may choose constant names and test helpers; it may not add another model, change prompts,
add a third cache breakpoint or claim savings before the live checks of criteria 7 to 9 pass.
