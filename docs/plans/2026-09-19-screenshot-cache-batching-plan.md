# Screenshot Cache Batching Implementation Plan

**Date:** 2026-09-19.
**Status:** Approved by the owner on 2026-09-19. The plan reviewer passed round 1 with no blocking findings or suggestions. Claude then reviewed the plan against the code, the frozen evidence and the caching documentation; its five findings are applied here and listed in the review record. Claude implements.
**Goal:** Reduce repeated prompt-cache writes while preserving the warnings and controls needed to finish the two real jobs safely.
**Approach:** First fix image removal so it preserves every non-image block, under the existing three-image limit. In a second code commit, allow 13 images and remove the oldest ones down to three only when that limit is exceeded. Verify the candidate during the two rehearsals before accepting it for filming.
**Design spec:** [Screenshot cache batching, revision 4](../specs/2026-09-18-screenshot-cache-batching-design.md). The plan was written against revision 3; revision 4 changed one rule of criterion 7, and this plan follows it.
**TODO items:** [the private backlog, Delivery](../../the private backlog#3-delivery), “Screenshot-cache batching after the cost review”. This does not complete the earlier shortlist-mail work.
**Branch:** The current `main` checkout. Keep the two code commits separate. Do not push as part of this plan.
**Scope:** `src/server/agent/run.ts`, its existing loop tests, numeric evaluation evidence, and the decisions record. No dependency, product setting, event schema, model, prompt, or provider change.
**Build estimate:** The owner spends 0.25–0.5 hours checking artifacts, approving the controlled booking, and completing any sign-in, CAPTCHA or cleanup. Two live candidate runs, one per act, plus their follow-ups. They are the Saturday rehearsals. An insufficient sample needs another real task; a rejected candidate needs another rehearsal on the fallback. These are estimates, not completed checks.

## Resolved assumptions and current workspace

- The owner requested `/plan` after the review of revision 3 passed on 2026-09-19. The retention rule and acceptance thresholds are already decided.
- Planning creates documents only. Implementation starts after plan approval. Live external actions need the scoped authorization described under Task 3.
- The current branch is `main`; the final inspected HEAD is `4db979b`. Re-read status and HEAD at implementation start because other work is active. At implementation start on 2026-09-19 HEAD was `c60f5df`, a change of documents only, so the planning preflight still describes the code.
- Order of work, decided by the owner on 2026-09-19: the two code commits of this plan land before any live run of the day. The open shortlist-mail cycles (the private backlog, section 2, Task 10 onwards) and both rehearsals then run on the code that will be filmed, and each of them is a candidate run for Task 3. If this order changes, a code change after a rehearsal makes that rehearsal's evidence void.
- The design spec, this plan and the frozen evidence folder were untracked files when the plan was approved. One commit of documents adds them before Task 1, so the baseline has a commit behind it and the links work from a clean clone. It also carries the three hunks of the private backlog that belong to this work and the change of delivery constraint 3 in `CLAUDE.md` and `AGENTS.md`, which design decision 11 depends on. Other uncommitted files belong to other work and stay as they are.
- The run-date context change was committed as `4db979b` during planning. Preserve it in `context.ts`, `run.ts`, `run.test.ts`, `fakes.ts`, `runner.ts` and `tools.ts`. The date is read once per run, so it does not change the prefix between model calls. Unrelated documentation and skill changes remain uncommitted and do not belong in the batching commits.
- Before editing overlapping files, save an ignored patch of the existing diff under `.local/cache-batching/before.patch`. Stage only this task's hunks. Review the staged diff before committing. Do not reset, stash, or commit another task's edits. If the overlap is still being edited, coordinate before changing the same section.
- Reuse installed dependencies. Offline tasks use the real loop and file store with the existing `FakeModel` and `FakeSandbox` at external boundaries. They need no key, server, browser or E2B computer.
- Live verification uses the existing job-hunt bot, current skills, current booking surface, and operator configuration. Check key presence without printing values. Start the normal app only when the operator is ready; its scheduler can start work immediately.
- The latest successful act-two evidence uses Cal.com. Follow that evidence and the current [job-selection decision](../specs/2026-09-10-job-selection.md), not older Calendly instructions.
- No unresolved product choice or new API is needed to draft this plan.

## Research and verified code boundaries

Reuse the design's R1–R7 sources. The preceding review re-read the caching and vision documentation on 2026-09-19. Versions stay as installed in [package.json](../../package.json).

| Source | Version or boundary | Fact used by this plan |
| --- | --- | --- |
| [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Anthropic API, rechecked 2026-09-19 | Prefixes must match. Writes occur at breakpoints. The default lifetime starts at the request start. Existing system and last-user-block breakpoints stay unchanged. |
| [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) and [SDK message types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts) | Installed `@anthropic-ai/sdk` 0.125.0 | Return assistant blocks unchanged. Image removal can edit a tool result's nested content without changing its identity or other fields. |
| [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) | Anthropic API, rechecked 2026-09-19 | Images in tool results count toward request limits. More retained base64 data means larger requests; the live pace check is required. |
| [run.ts](../../src/server/agent/run.ts) | `handleComputer`, `pruneImages`, `setCacheBreakpoint`, `runLoop` | Each tracked result holds one image. Both normal and recoverable-error images enter `shots`. Pruning runs after the complete result batch is appended. `lastShot` and saved PNG files are separate. |
| [run.test.ts](../../src/server/agent/run.test.ts), [fakes.ts](../../src/server/agent/fakes.ts) | Existing Vitest 5.0.0 tests | `FakeModel.create` deep-copies submitted requests. Existing helpers produce unique tool IDs, PNGs, an actual file store, approvals and takeover controllers. |
| [actions.ts](../../src/server/agent/actions.ts), [images.ts](../../src/server/agent/images.ts), [progress.ts](../../src/server/agent/progress.ts) | Existing code | Zoom crops `lastShot`; only a full screenshot or recoverable error updates it. Progress warnings can share an image result. Distinct screens and the fake clock avoid unrelated stuck detection in retention tests. |
| [model.ts](../../src/server/agent/model.ts), [runner.ts](../../src/server/agent/runner.ts), [event schema](../../src/server/store/types.ts) | Existing model and event contracts | SDK retries emit no run event. A cost event follows the completed response, including a discarded response. Every run event has a timestamp. |
| [Frozen baseline](../evidence/2026-09-18-cache-batching/README.md) | 68 runs, 1,137 recorded responses | Arithmetic is reproducible, but the replay is an estimate. The original snapshot and results remain unchanged. |

The upstream example is background only. No helper is copied from its moving `main` branch.
No sandbox API, storage format, timeout, stream or approval API is changed.

## File changes

| Action | Path | Purpose |
| --- | --- | --- |
| Modify | `src/server/agent/run.ts` | Preserve nested text, then add the batch limit. |
| Modify | `src/server/agent/run.test.ts` | Exercise actual submitted requests, preservation, repeated pruning, mixed image sources, saved files and signed thinking. |
| Create during verification | `docs/evidence/2026-09-19-cache-batching/usage.json` | Allowlisted numeric candidate observations. |
| Create during verification | `docs/evidence/2026-09-19-cache-batching/analyse.mjs` | Reproduce the live metrics from the sanitized snapshot with Node built-ins. |
| Create during verification | `docs/evidence/2026-09-19-cache-batching/results.json` | Derived metrics, including insufficient and failed runs. |
| Create during verification | `docs/evidence/2026-09-19-cache-batching/README.md` | Code revision, run coverage, artifact checks, human interventions, limitations and acceptance decision. |
| Modify after verification | `docs/decisions.md` | Estimated versus measured cost, larger-history trade-off and the chosen final limit. |
| Modify after acceptance only | `docs/specs/2026-09-11-platform-design.md` | A dated amendment: the sentence near line 281 says only the last three screenshots stay in the history. It stays true if the fallback is chosen. |
| Modify before Task 1 | `docs/specs/2026-09-18-screenshot-cache-batching-design.md` | Revision 4: criterion 7 does not judge the first request of a run that carries an image. |
| Create before Task 1 | `docs/evidence/2026-09-18-cache-batching/first-image.mjs`, and a section in that folder's README | The counts behind revision 4. It reads the frozen snapshot and changes nothing in it. |
| Modify | the private backlog | Link this plan now; record actual implementation and live status later. |
| Create/update | `docs/plans/2026-09-19-screenshot-cache-batching-plan.md` | Reviewed plan and implementation checkpoints. |

The old evidence files are inputs, not files to regenerate with candidate data. Raw events,
screenshots, private page text and the local run-ID mapping stay outside the new committed
numeric evidence. Test helpers stay in `run.test.ts`; no shared module is needed.

## State contract

This is a synchronous context edit. The existing lifecycle remains in control.

| State | Required result | Check |
| --- | --- | --- |
| At or below the limit | No image content changes. | Requests at 0, 3, 4 and 13 images. |
| Above the limit, including a multi-tool batch | Keep exactly the newest three in their existing positions. | Requests following 14 and 17 images. |
| Later growth | Start another accumulation period; removed images never return. | Requests after 24 and 25 total images. |
| Recoverable action failure or partial action | Count the returned image and preserve error/warning text and fields. | Error-image regression and existing partial-action tests. |
| Model/sandbox failure, timeout, Stop | Existing outcome and cancellation behavior; no replay or policy change. | Existing loop/model/runner tests and full preflight. |
| Truncated tool response and retry | No partial tool runs; preserve existing retry and recorded usage. | Existing retry tests; numeric evidence includes discarded responses. |
| Partial text response | Existing continuation and delivered text remain. | Existing output-cap tests. |
| Approval, Deny, takeover and hand-back | Existing wait and permission boundaries remain; expiry does not justify bypassing them. | Existing guard tests and both live acts. |
| Restart | Old run closes through recovery; new run starts new in-memory history. Saved files remain. | Existing recovery tests and direct saved-PNG checks. |

## Tasks

### Task 1: Preserve non-image content when removing screenshots [integration] [demo-path]

> **Done 2026-09-19, commit `b6bcf4a`.** The three cases failed first on the old code with the warning
> missing and only the removal note left, then passed. Spec compliance passed. Code review: one blocking
> point (two non-null assertions in a new test, removed), nothing on its second pass. Test review:
> nothing blocking; both suggestions taken (the title of the first case names both things it asserts;
> the words of `noProgressText(16)` are pinned by a literal string). Preflight: 562 TypeScript tests,
> 16 Python tests, typecheck, site check. Deviation: the helper `resultsAt` landed here, not in Task 2,
> because these cases find a tool result by its `tool_use_id`; `resultFor`, `outerFields` and `greys` are
> three more test-only helpers.

**Files:** `src/server/agent/run.ts`, `src/server/agent/run.test.ts`.
**Invariant:** 4: the model retains the warning that an approved action may already have happened. 5 and 6: assistant blocks, takeover handling and stored evidence remain unchanged.
**Demo steps:** 2–7. The model must retain action and progress warnings while it reads and acts.
**Verify:** `pnpm test src/server/agent/run.test.ts`, then `pnpm typecheck` and `pnpm preflight`.

Root cause, confirmed in the reviewed code: `handleComputer` stores the warning and image in
the same `ToolResultBlockParam.content` array. `pruneImages` then assigns a new one-item array
to the entire result. This deletes the warning as soon as its image is old enough. The fix must
change only each nested image block.

- [x] Add the three preservation cases below to `run.test.ts`. Use a fixed clock through `makeContext({ now: () => 0, ... })`. Use distinct PNGs where the test needs new visual progress. Do not disable either progress detector.
- [x] Run the new cases on the current three-image code. Confirm a failed assertion about missing text, not a setup error, provider call or stuck outcome.
- [x] Replace only the body of `pruneImages` with the following code. Keep `IMAGES_KEPT = 3`.

```ts
const pruneImages = (): void => {
  while (shots.length > IMAGES_KEPT) {
    const old = shots.shift()
    if (old && Array.isArray(old.block.content)) {
      old.block.content = old.block.content.map((block) =>
        block.type === 'image'
          ? { type: 'text' as const, text: `screenshot after step ${old.step} (removed to save context)` }
          : block,
      )
    }
  }
}
```

Every current `ShotRef` is created with array content and one image. Keep that internal
contract; do not add a new fallback, log path or generalized image tracker.

| New case | Concrete setup | Assertions on captured requests and real loop effects |
| --- | --- | --- |
| An approved action's unknown-outcome warning survives | Script a submit click with `FakeSandbox.clickError = new Error('deadline exceeded')`. Use the existing submit-element and allowed-approval fixture. Then script 25 distinct screenshots and an `end_turn`. | Capture the error result by its original `tool_use_id`. In the final request its original `noAnswerText('left_click', approvedTarget)` remains byte-for-byte, followed by one removal note. `is_error`, `toolset_name` and `tool_use_id` match the first result. The approval is consumed once. Only one click executes. The earlier copied request still contains its image. |
| A partial-action warning survives | Adapt the existing repeated-key fixture: script `computerUse('key', { text: 'Down', repeat: 5 })` and make its third `sandbox.press` throw `new Error('deadline exceeded')`. Use a plain `Error`, because `SandboxActionError` returns no image. Follow it with 25 distinct screenshots and finish. | The original error text, including `(2 of 5 presses were sent before this)`, survives in its original position. The result retains `is_error` and one removal note. The error image was removed. Existing partial-action behavior remains verified. |
| A normal image's progress warning survives | At a fixed fake time, return one full screenshot, then 16 identical zoom actions so the 16-step progress warning shares the last zoom's image. Follow with 25 distinct full screenshots to reset progress and remove that image. | In the final request, the warned result has one removal note followed by exactly `noProgressText(16)`. Its outer fields remain unchanged. Earlier warning text is unchanged across later pruning passes. The run finishes, proving the warning is not merely observed on an aborted setup. |

These sequences exceed both the current and proposed limits. They remain useful without
rewriting them in Task 2. The warnings originate in the real loop; do not inject warning text
into a fake model response or mutate a captured request to manufacture the test.

- [x] Keep the existing five-screenshot/three-retained test unchanged for this commit.
- [x] Run the scoped tests, typecheck and full preflight. Inspect downstream type consumers if a test import changes; no production type export is required.
- [x] Run the implementation skill's Stage 1 spec-compliance reviewer, then its Stage 2 code reviewer and test-quality reviewer. Resolve blocking/high findings before moving on.
- [x] Commit only this change and its tests with subject `Preserve tool warnings when pruning screenshots`.

### Task 2: Batch image removal at the 13-image limit [integration] [demo-path]

> **Done 2026-09-19, commit `a831f69`.** On Task 1's code the four policy cases failed as expected
> (image counts `[0,3,3,3,3,3,3]` where `[0,3,4,13,3,13,3]` is expected; "request 4 begins with request
> 3"; 3 images where 13 are expected, twice), and the preservation, saved-file and signed-thinking cases
> stayed green. Spec compliance passed; code review and test review found nothing blocking. Taken from
> their suggestions: one sentence on a limit below `IMAGES_KEPT`; a seventh case, an error screenshot
> and looks that cross the limit in the middle of one turn (a mutation that prunes after each result
> fails it and the batch case); a duplicate assertion became a comment. Not taken: splitting the
> mixed-sources case. A reviewer also found that no test pinned how the stuck detector sees a zoom;
> that test is its own commit, `b6847da`, checked by mutation. Final preflight on `b6847da`: 568
> TypeScript tests, 16 Python tests, typecheck, site check. Dirty files at that point: this plan only.
> Two more test-only helpers than planned: `notesAt` and `base64`.

**Files:** `src/server/agent/run.ts`, `src/server/agent/run.test.ts`.
**Invariant:** 4 and 5: warning preservation, tool pairing and signed assistant blocks survive pruning. 6: saved images and the last full screenshot remain usable. 1–3 and 7 retain their existing paths; live proof is Task 3.
**Demo steps:** 2–7, with a larger model image history and the same visible computer.
**Verify:** `pnpm test src/server/agent/run.test.ts`, then `pnpm typecheck` and `pnpm preflight`.

- [x] Replace the old five-screenshot assertion with the threshold and repeat-cycle checks below. Add the batched and mixed-source cases. Extend the existing signed-thinking test.
- [x] Run the new assertions on Task 1's code. The four/13-image cases must fail because it still retains only three. The preservation tests must stay green.
- [x] Add the new constant beside the retained target:

```ts
const IMAGES_KEPT = 3
const IMAGE_PRUNE_LIMIT = 13
```

- [x] Add this line at the start of Task 1's `pruneImages`, leaving the rest of that function unchanged:

```ts
if (shots.length <= IMAGE_PRUNE_LIMIT) return
```

Keep its single existing call after `messages.push({ role: 'user', content: results })`.
Do not prune inside `handleComputer` or between individual results of one response.

Use typed inspection helpers local to the test file. They inspect actual requests and do not
implement the retention rule. Add a type-only Anthropic import for these helpers.

```ts
function resultsAt(model: FakeModel, call: number): Anthropic.Messages.ToolResultBlockParam[] {
  const request = model.calls[call]
  if (!request) throw new Error(`missing model request ${call}`)
  return request.messages.flatMap((m) => Array.isArray(m.content) ? m.content : [])
    .filter((b): b is Anthropic.Messages.ToolResultBlockParam => b.type === 'tool_result')
}

function imagesAt(model: FakeModel, call: number): string[] {
  return resultsAt(model, call).flatMap((result) =>
    Array.isArray(result.content)
      ? result.content.flatMap((b) => b.type === 'image' && b.source.type === 'base64' ? [b.source.data] : [])
      : [],
  )
}

function withoutCacheMarkers<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item) => key === 'cache_control' ? undefined : item)) as T
}
```

Use literal expected image sequences from the input fixtures. Never calculate expected results
with a second implementation of the pruning algorithm. Store image identities as base64 in
test memory only. Do not print image payloads or use production screenshots in fixtures.

Numbering in the table below: "image k" is the k-th image the loop saw in the run, counted from 1.
A fixture array is indexed from 0, so fixture `n` is image `n + 1`. Request indexes are counted
from 0, and request `k` is sent after `k` single-screenshot responses. So "request 14 holds images
12–14" means fixtures 11, 12 and 13.

| Case | Concrete setup | Required observations |
| --- | --- | --- |
| Threshold and second cycle | 25 screenshot responses, then `end_turn`; make 25 distinct solid PNGs, with grayscale `n * 10` for `n = 0..24`, and a fixed fake clock. | Zero-based request indexes 0, 3, 4, 13, 14, 24, 25 hold respectively 0, 3, 4, 13, 3, 13, 3 images. Request 14 holds images 12–14 (fixtures 11–13); request 25 holds images 23–25 (fixtures 22–24). All remaining images keep their order. Notes number 11 then 22, exactly once for each removed result. |
| Prefix stability | Use the same sequence. Strip only cache markers from copied messages. | For each accumulation request, the older request's messages equal the same-length prefix of the newer request. Request 13 still holds every original image after the run ends. Request 14 preserves assistant blocks and tool-result pairing while replacing only the 11 old image positions. Assert no duplicate or missing tool-use IDs. |
| Complete tool batch | 13 individual screenshots, then one response containing four distinct screenshot tool calls, then `end_turn`. | The next request holds images 15–17 and 14 removal notes. All four result IDs from the batch exist in call order. There was no model request partway through the batch. |
| Mixed sources and zoom after pruning | An approved failed click returns a green error image. The next full screenshot is 2×2 pixels, red in the left column and blue in the right column, made with `solidPng` and `setPixel`. Script 12 zooms of `[0, 0, 1, 2]`, then one zoom of `[1, 0, 2, 2]`, then finish. Keep the fake clock fixed. | Error, full and zoom images share one limit. The request with 13 accumulated images has 13; at 14 it has three. The original full screenshot is now removed from context. The final zoom still produces a blue 400×800 image from the full screenshot's right column. Cropping the preceding red zoom would fail this pixel check. The sandbox took exactly the initial error screenshot and full screenshot. |
| Saved evidence | During either sequence, collect all non-null `tool_result.shot` references from the real loop events. | `store.readShot` returns the exact PNG bytes for removed and retained images after the run. Pruning never deletes a file. Hash duplicates from repeated zooms need only one read each. |
| Signed thinking across actual pruning | Retain the existing first two responses containing signed and redacted thinking. Append 12 more screenshot responses, then `end_turn`. Supply 14 distinct PNGs and fixed time. | The final captured request has three images and 11 removal notes. Its first two assistant contents still equal the original deep copies, including signatures and redacted data. The original responses and earlier request snapshots are unchanged. |

Retain all existing cache-breakpoint, Stop, incomplete-tool retry, approval, Deny, takeover,
recovery and unknown-outcome tests. These tests prove request construction and state handling;
they do not prove provider caching or model quality.

- [x] Run scoped tests, typecheck and preflight. Resolve any unexpected failure at its cause.
- [x] Run Stage 1 review, then Stage 2 code and test-quality reviews before proceeding.
- [x] Commit only the limit and its tests with subject `Batch screenshot pruning to preserve cached context`.
- [x] Record the actual commit and dirty-file state for Task 3. No feature flag or automatic runtime fallback is added.

### Task 3: Verify the two real jobs and record the retention decision [integration] [demo-path]

**Files:** The four new evidence files in the file table, `docs/decisions.md`, this plan, and the private backlog.
**Invariants:** 1–3: observe the real computer and verify completed artifacts. 4: approve only the exact controlled booking; Deny the application. 5: sign-in and challenges stay in takeover. 6: verify saved artifacts and outcome memory. 7: use the existing chat, skills and routines.
**Demo steps:** All seven rows of the design's demo path.
**Verify:** `node docs/evidence/2026-09-19-cache-batching/analyse.mjs` reproduces `results.json`; `pnpm preflight` passes on the final code.

This task belongs to `/verify` after both code commits and their reviews. It is not completed by
offline tests. Before live work, show the owner the concrete rehearsal side effects and obtain the
permission required by the design. A previous rehearsal's permission is not reused. Ask for each
user action only when its step is ready; do not present a list of console chores.

- [x] Record the code revision and final diff, model ID, image limit, and fingerprints of the current fixture inputs. Store only non-secret identifiers/fingerprints. Keep prompts, tools and settings fixed during candidate runs. If another change lands, establish a new candidate code revision before rehearsing.
- [x] Check configured key presence by name only. Start the app with `pnpm start` (the launch entry `dobot-start`): it runs the server from source with no file watcher, so an edit cannot restart it in the middle of a run. Observe its real live screen. Account for scheduler-started and failed runs in the measurement window. Do not alter routine files or memory to simplify the result.
- [x] Run act one on the designated real posting through the existing chat workflow. Inspect the dossier, letter, completed form and CV attachment. Press Deny at submission. Verify no submit action followed it and that the saved outcome says not submitted.
- [x] Run act two from one expressly authorized invitation. Observe the routine starting without a chat instruction, inspect the exact host/guest/slot and the approval card, then let the owner Allow or use his explicit scoped authorization. Verify the external confirmation and outcome memory. Observe the confirmation-mail follow-up and confirm it produces no duplicate proposal or booking.
- [x] If no sign-in or CAPTCHA occurred, request one manual takeover during the run and hand back safely. No model action or screenshot runs while the human controls the screen. Do not enter a real credential merely to create a test.
- [x] Capture every run in the experiment, including failed/aborted attempts, truncated-response retries and mail follow-ups. Preserve a local mapping to anonymized run numbers in `.local/cache-batching/run-map.json`. Do not copy raw events or private artifacts into the numeric evidence.
- [x] Extract only the allowlisted data and evaluate it using the contract below. A review of the output must establish that no arbitrary source fields survived.
- [x] After the last live run of a sitting, wait for the server's log line `sandbox paused`, then stop the server. A running computer and a running server cost money; nothing stays up while nobody watches it.
- [x] Apply the acceptance decision below. If rejected, use the fallback before the final rehearsal.
- [x] Update the evidence README, decisions entry and checkpoints with observed results. If the 13-image limit is accepted, add a dated amendment to `docs/specs/2026-09-11-platform-design.md` where it says only the last three screenshots stay in the history. Do not mark the TODO item complete until implementation and live acceptance, including a required fallback rehearsal, are complete.
- [x] Review the evidence and documentation against the spec with the implementation reviewers. Commit the sanitized evidence and final decision with subject `Record screenshot batching rehearsal results`.

This last documentation commit is separate from the two code commits required by design
decision 10. Do not make unrelated product repairs inside this task. Diagnose an observed failure
and keep its evidence; the retention fallback remains available.

### Live record

Evidence, with every number: [docs/evidence/2026-09-19-cache-batching](../evidence/2026-09-19-cache-batching/README.md).

**Act one, 2026-09-19, on the owner's word ("start act one"); Claude drove the page and pressed Deny.**

- Before the start: $2.31 spent that day, the bot's computer paused, the mail watcher's reading equal
  to its watermark (so a server start fires no run), the morning routine armed for weekdays only.
- **Attempt 1, 11:19 Prague, revision `b6847da`: failed after 115 s and $0.28, and not because of
  batching.** At step 18 a `type` action got no answer from the computer. The loop's recovery result,
  a warning text and a fresh screenshot with `is_error: true`, was refused by the API with HTTP 400:
  an error result may hold text only. It was that path's first live use in 93 runs; the fake model
  had accepted the shape. Fixed the same hour as its own change, commit `a8c711e`: the result carries
  no `is_error`, the fake model refuses what the API refuses (eleven loop tests then failed the way
  the live run had), and a direct probe of the real API confirmed both halves. Code review: nothing
  blocking. Test review: nothing blocking; its suggestions are in a follow-up commit. This was a
  repair outside this plan's subject; it was made because no rehearsal is safe while any unanswered
  action ends the run, and it set a new code revision for every run after it.
- **Attempt 2, 11:38 Prague, revision `a8c711e`: passed.** 37 calls, 39 steps, 15 images, 269 s,
  $0.72 (the same job cost $1.53 on 18 September). Dossier and letter written and checked against
  the saved profile; the real form held the right fields, the letter and `cv.pdf`; the card named
  "Odeslat zájem" on the right page; Deny; no computer step after it; the memory line says "Not
  submitted" with the local date. Mechanism: 34 judged calls, all 34 reuse the cache, median write
  486 tokens: pass. The run held 13 images before its one removal, so a run has crossed the limit.
  Median turn 4,309 ms, under the limit. One small flaw that batching cannot have caused: both
  artifact files begin with `/#`; the model wrote that before the run held any screenshot, and the
  form text has no such mark.
- After each attempt the server was stopped once the log said `sandbox paused`.

**Act two, 2026-09-19, on the owner's word ("act two", then four permissions for this rehearsal in
chat: archive the three mails of 18 September, send the fixture, Allow once on a matching card and
Deny anything else, cancel the booking as the host). Claude did every step. Revision `a8c711e`.**

- Before the start: $3.31 spent that day, no server running, the watcher's reading equal to its
  watermark. After the archive the inbox was empty; the watcher set its baseline on it at boot.
- **Run 3, 12:40 Prague, the booking: passed.** The fixture mail started `check-mail` with nobody
  typing. 18 calls, 25 steps, 9 images, 103 s, $0.26. One card, kind `book`, control Confirm on the
  host's Cal.com page, Monday 21 September 9:00 to 9:30 Prague, guest the bot's address, three
  warnings, no question in chat. Allow once; the gate consumed it on the approved control; Cal.com
  said "This meeting is scheduled"; no CAPTCHA. The memory line names the slot and the invitation.
- **Run 4, 12:46 Prague, the confirmation mail: passed.** 7 calls, 11 steps, $0.12. No card, no
  booking, no memory write.
- **Run 5, 12:51 Prague, the cancellation mail: passed.** Claude cancelled the booking as the host
  (Cal.com then showed no upcoming booking). 12 calls, 17 steps, $0.13. No card; one memory line
  says the booking is cancelled and none stands.
- Mechanism: runs 3 and 5 pass (16 and 10 judged calls, all reuse the cache); run 4 has five judged
  calls, too few to judge, and all five reuse the cache. No run reached 13 images, so no run
  removed one. Next to 18 September on the old rule the booking run costs the same ($0.26), so act
  two shows no harm and no saving; the saving is in long runs.
- The server was stopped once the log said `sandbox paused`.

**The takeover, 2026-09-19, on the owner's word ("takeover"). Revision `a8c711e`.** No sign-in and no
CAPTCHA had appeared in runs 1 to 5, so this task's other path applied: one manual takeover during
a run, and no credential typed by anybody.

- Before the start: $3.82 spent that day, no server running, the watcher's reading equal to its
  watermark.
- **Run 6, 13:03 Prague: passed.** A read-only goal (list the inbox by sender and subject, open
  nothing, act on nothing), sent through the chat endpoint. After three steps Claude pressed **Take
  over** in the page. `takeover started`, reason `manual`, at 11:04:18 UTC, before the fifth model
  call; hand-back at 11:06:49; the run ended `done` at 11:07:08. 8 calls, 11 steps, 6 images, $0.15.
- During the 2 min 32 s of the takeover the run log holds no event: no step, no model call, no
  tool result. No screenshot file was written in that time, and the computer did not pause.
- The first model call after the hand-back read 30,474 tokens from the cache, which is everything
  the call before the takeover had read from or written to it, and wrote 1,505. The takeover adds one text message at
  the end of the conversation and changes nothing before it.
- Two notes. The hand-back went through the API endpoint that the page's button calls: the page
  polls the hand-back state only in a visible tab, and Claude's browser pane was hidden, so the
  button stayed disabled. It is the page's own rule, not a defect. And the first screenshot after
  the hand-back was black; the bot clicked once on an empty part of the page and went on. The
  finding is older than batching, and this run removed no image.
- The server was stopped once the log said `sandbox paused` (11:09:13 UTC).

**The acceptance decision, 2026-09-19: all six items hold, so the limit of 13 images stays and the
fallback is not needed.** Item by item, with the numbers:
[the evidence README](../evidence/2026-09-19-cache-batching/README.md), "The acceptance decision".
In short: both acts finished with inspected artifacts and external state (runs 2 and 3); runs 2
and 3 have 34 and 16 judged calls, all of which reuse the cache, with median writes of 486 and
1,432 tokens; run 2 crossed the limit once; no run shows a stale-screen action, a repeated side
effect or a correction by chat; every median turn is under 6,808 ms, so no pace judgment by the owner
was needed; six runs cost $0.0179 per call with a cache-write share of 44.7%, next to $0.0211 and
69% (frozen baseline) and $0.0376 and 72.6% (the 24 runs of 18 and 19 September on the old rule).
The offline replay's 35 to 40% stays an estimate: one job measured twice ($1.53, then $0.72)
cannot confirm a percentage.

### Numeric extraction and evaluation contract

Write `analyse.mjs` using Node built-ins only. It reads `usage.json`, performs the calculations
below and writes formatted JSON to stdout. The snapshot is constructed locally from existing run
events in file order. Do not log an event or include a source object with object spread.

The snapshot contains `codeCommit`, `limit`, and an ordered `runs` array. Each run has an anonymous
integer `ordinal`, an allowlisted `outcome` enum or `null`, numeric event counts, and `calls`.
Each call contains only these fields:

```text
e: preceding run-event time, in Unix milliseconds, or null
c: cost-event time, in Unix milliseconds
i: inputTokens
o: outputTokens
r: cacheRead
w: cacheWrite
usd: recorded model cost
imgs: count of image-bearing tool results since the previous cost event
discarded: whether the loop discarded this completed response
```

For `e`, use the event immediately before this cost event in the full event sequence, before
filtering event types. For `imgs`, count `tool_result` events with non-null `shot`, including
recoverable errors and zoom. Do not retain the shot hash. After a cost event reset the image
counter; still count later events even when the current response was discarded. Include the
discarded cost event itself when finding the next `e`. Missing or reversed times make a call
uncertain; they never become zero-duration evidence.

The following calculation is complete for the existing event and one-image-per-result contracts:

```js
const upperMedian = (xs) => xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function evaluateRun(run, limit) {
  let retained = 0
  let imageSeen = false
  const rows = run.calls.map((call, n) => {
    // The first request that carries an image misses the message cache by the provider's rule.
    const firstImage = !imageSeen && call.imgs > 0
    if (firstImage) imageSeen = true
    const before = retained + call.imgs
    const removed = before > limit ? before - 3 : 0
    retained = removed > 0 ? 3 : before
    const previous = run.calls[n - 1]
    const timesValid = previous !== undefined && previous.e !== null && call.e !== null
      && previous.e <= previous.c && previous.c <= call.e && call.e <= call.c
    const warmth = !timesValid ? 'uncertain'
      : call.c - previous.e <= 240_000 ? 'warm'
      : call.e - previous.c > 300_000 ? 'expired' : 'uncertain'
    const previousPrompt = previous ? previous.i + previous.r + previous.w : null
    return {
      call: n + 1, retained, removed, warmth, firstImage,
      read: call.r, write: call.w,
      reusesPrevious: previousPrompt !== null && call.r >= 0.95 * previousPrompt,
      gapMs: previous && call.c >= previous.c ? call.c - previous.c : null,
      callBoundMs: call.e !== null && call.e <= call.c ? call.c - call.e : null,
    }
  })
  const judged = rows.filter((row) => row.call > 1 && !row.firstImage && row.warmth === 'warm' && row.removed === 0)
  const reuseFraction = judged.length === 0 ? null : judged.filter((row) => row.reusesPrevious).length / judged.length
  const medianWrite = upperMedian(judged.map((row) => row.write))
  const mechanism = judged.length < 10 ? 'insufficient'
    : reuseFraction >= 0.9 && medianWrite <= 4_000 ? 'pass' : 'fail'
  return {
    ordinal: run.ordinal, outcome: run.outcome, rows,
    calls: run.calls.length,
    usd: run.calls.reduce((sum, call) => sum + call.usd, 0),
    judgedCalls: judged.length, reuseFraction, medianWrite, mechanism,
    crossedLimit: rows.some((row) => row.removed > 0),
    medianTurnMs: upperMedian(rows.flatMap((row) => row.gapMs !== null && row.gapMs <= 300_000 ? [row.gapMs] : [])),
    medianCallBoundMs: upperMedian(rows.flatMap((row) => row.callBoundMs === null ? [] : [row.callBoundMs])),
  }
}
```

Count and report warm-after-removal, warm-without-removal, expired and uncertain calls separately;
report the first call separately, since it cannot establish reuse of a previous call. Report the
first request of a run that carries an image separately too, with its cache read and write: the
provider drops the message cache when a prompt goes from no image to some image, so that request
misses whatever the retention rule is (spec criterion 7, revision 4; 48 of 55 recorded runs). Also report
cache-write counts for the after-removal group. Use the upper median for an even sample, matching
the frozen baseline script. `callBoundMs` is a bound on a logical model-call interval, including
SDK retries and the gap from the preceding event; it is not a measured HTTP-attempt duration.

Before evaluating live data, check the evaluator with small numeric fixtures using `node:assert/strict`:
an upper bound of exactly 240,000 ms is warm; 240,001 is uncertain; a lower bound of 300,000 is
uncertain and 300,001 is expired; a retry-delayed interval is uncertain despite a short cost-to-cost
gap; consecutive cost events after a discarded response are allowed; missing/reversed times are
uncertain. Check 13 images without removal, 14 and 17 dropping to three, and zero new images after
a discarded call. Check nine judged calls as insufficient, and ten with exactly nine successful
reuse ratios as pass when median writes are within the limit. Check that the first image-bearing
call of a run is marked and not judged even when it is warm and misses, and that the second
image-bearing call is judged. Keep these assertions in the evidence
script; they check the measurement, not the product loop.

Require finite nonnegative token counts, costs and image counts in the saved snapshot. Missing data
is an evidence error, not a zero. The script's top-level report must include cost per recorded call
and the cache-write share of recorded cost, using the existing Sonnet 5 five-minute write rate
of $2.50 per million tokens from the frozen baseline. If the configured model is different, stop
the comparison and resolve the candidate configuration; do not silently apply another model's rates.

Recorded cost excludes any provider charge for an attempt that returned no usage response. State
this limit beside the totals, as the original evidence does. Include such failed run outcomes and
known provider charges separately if they are available; never estimate a missing charge as zero.
No new application instrumentation is needed for these measurements.

### Acceptance and fallback

All of these must hold:

1. Both act runs finish with correct, inspected artifacts and external state. An `end: done` event alone is insufficient.
2. Each representative act run has at least ten judged warm calls without removal. The first request of a run that carries an image is not judged (spec criterion 7, revision 4). At least 90% reuse 95% of the previous whole prompt; median cache writes are at most 4,000 tokens. A short confirmation-mail follow-up remains in cost and behavior reporting, but does not replace the required representative act sample. Evaluate every additional run that has enough judged calls; keep insufficient samples visible.
3. At least one run sends a request after crossing the 13-image limit. If neither act does, use a naturally longer real reading task. Do not add meaningless screenshots to a live goal.
4. No new stale-screen action, repeated side effect or additional human correction is caused by batching. Inspect actual actions and artifacts; do not infer this from cost.
5. Median time between cost events, excluding gaps over five minutes, is at most 6,808 ms per candidate run. A higher value is inconclusive on speed. Report it with the median logical-call bound, and obtain the owner's judgment of the pace he watched. Do not claim the larger request caused the delay.
6. Report recorded cost per call and cache-write share beside the baseline of $0.0211 and 69%. Report the 35–40% estimate beside the observed result and sample size. No general saving claim follows from two runs.

Measured on 2026-09-19 while the evidence scripts were tested, and added here because it changes how
items 5 and 6 are read. The 24 runs recorded after the frozen snapshot (18 and 19 September, the
three-image rule, the shortlist-mail work) cost $0.0376 per call with a cache-write share of 72.6%,
well above the older baseline: their prompts are larger. Two of them held 14 or more images, and both
already exceed the pace limit under the old rule: 7,176 ms and 9,168 ms. So a candidate run above
6,808 ms says nothing about batching by itself, which is what "inconclusive" in item 5 means, and
the evidence reports the candidate next to both baselines. With the first image of a run left out,
every judged call of these 24 runs reuses the cache. No threshold changes.

If a representative sample is insufficient, another suitable run is needed. If acceptance fails
or remains inconclusive, change only `IMAGE_PRUNE_LIMIT` from 13 to 3 in production code. Keep
Task 1's text-preservation fix. Restore the three-retained-image expectations in the policy tests;
retain preservation and signed-thinking checks that exercise pruning. Four of Task 2's six cases
assert that 13 images survive and need new expectations; the old five-screenshot test is the
starting point, and `git show <Task 1 commit>:src/server/agent/run.test.ts` prints it. Run scoped tests, typecheck,
preflight and the required reviews. Commit with subject `Restore three-image retention after rehearsal`.
Rehearse the affected jobs on this final code before filming. Keep failed candidate results and
report the saving estimate as unconfirmed. Never reverse a real external action by reverting code.

## Verification criteria

| # | Criterion | Evidence and owner |
| --- | --- | --- |
| 1 | Four and 13 images survive; 14 and batched 17 retain the newest three. | Task 2 captured requests and exact image identities; `/implement`. |
| 2 | Prefixes stay stable between removals; old snapshots stay unchanged. | Task 2 content comparison ignoring only cache markers; `/implement`. |
| 3 | Error, partial-action and progress warnings survive repeated pruning with their result fields. | Task 1 tests passing under both code commits; `/implement`. |
| 4 | Every current image source counts; saved files and zoom input survive context removal. | Mixed-source and file-store checks; `/implement`. |
| 5 | Signed thinking, tool pairing, the two breakpoints and lifecycle controls remain correct. | Extended 14-image thinking test plus existing loop/model/runner/gate/takeover/recovery suites; `/implement`. |
| 6 | Typecheck, TypeScript tests, Python tests and site-code check pass. | Final `pnpm preflight`; `/implement`, repeated only after later changes. |
| 7 | Both real jobs complete visibly with correct artifacts, Deny/Allow behavior and a takeover boundary. | Task 3 observations and external confirmation; `/verify` with the owner at human-only steps. |
| 8 | Cache mechanism meets the warm-call thresholds; a real run crosses the limit. | Sanitized snapshot, reproduced metrics and sample counts; `/verify`. |
| 9 | Pace and behavior permit filming; measured cost is reported honestly or fallback is rehearsed. | Acceptance decision, retained failures and decisions entry; `/verify`, the owner for an above-limit pace judgment. |

## Test plan and review order

Offline verification uses the normal commands:

```sh
pnpm test src/server/agent/run.test.ts
pnpm typecheck
pnpm preflight
```

The full preflight includes existing secret/takeover, approval, Stop, model lifecycle, recovery
and persistence tests. Those boundaries are unchanged; do not add duplicate tests merely to
repeat the invariant list. The new tests target data that disappears silently during pruning.
No sleeps, mocked internal pruning helper, exported testing-only policy, or provider calls belong
in the new loop tests. Local-port and process-list tests need the established authorized execution
environment; a sandbox restriction is not a product failure.

After each code task, review spec compliance first, then code quality and test quality. Only then
start the next task. Keep reproduction failures and passing command results in the implementation
record. An offline pass does not close the live criteria.

## Checkpoint recovery

1. Read this plan, the design's revision and the private backlog. Inspect the current branch, working diff and recent commits.
2. Match the two named code commits to checked task boxes. Preserve other tasks' edits and the pre-edit patch.
3. Resume the first unfinished task. A green Task 1 commit must still use the three-image limit.
4. For interrupted live work, inspect actual external state before repeating a booking, send or cleanup. Read the local run map and saved numeric evidence; include the interrupted attempt.
5. Verify the constant in the final filmed code and its rehearsal evidence. Do not infer acceptance from the presence of the candidate commit.

## Review record

The design review on 2026-09-19 passed with no new blocking findings. Its numeric replay matched
all 1,137 recorded responses. Baseline preflight passed 557 TypeScript tests and 16 Python tests,
plus typecheck and the site-code check. That review changed no file and proved no live saving.

The plan reviewer passed round 1 on 2026-09-19 with no blocking findings or suggestions. It checked
the actual image tracking, feasible warning and zoom fixtures, numeric evaluation, live acceptance,
all seven invariants and the two-code-commit scope. No implementation task has started.

The three typed request-inspection helpers compile under the installed TypeScript with strict mode
and unchecked-index checks. Seventeen numeric assertions passed against the evaluator printed in
this plan, including timing boundaries, retry uncertainty, discarded calls, image limits, sample
size, reuse ratio and median writes. All existing local document links resolve. These checks prove
the plan's examples; they do not substitute for implementing the regression tests or running the jobs.

Final planning preflight on `4db979b` passed typecheck, 558 TypeScript tests, 16 Python tests and
the site-code check. Only this plan and its pointer in the private backlog were changed by this planning task.
Both are left uncommitted for the normal implementation workflow.

### Review of the Task 3 record, 2026-09-19

After the takeover run the evidence README, this plan's live record, the decisions entry and the
platform-spec amendment went to the two implementation reviewers. Spec compliance: pass, no
findings; every number in the acceptance table matches `results.json`, and the takeover, the fixed
inputs, the amendment and the decisions entry meet Task 3. Quality: nothing blocking; two points
to fix and five small ones, all applied. The comparison group of 24 runs was called "one day
earlier", and it is 18 September and the morning of 19 September. The decisions entry said a
takeover "did not disturb the cache" without saying that the one tested takeover was shorter than
the cache's five minutes. The small ones: two rare words, a "never" about mail runs that is an
observation on a few runs, two unrelated numbers that are both 93, and "exactly the whole prompt"
for a sum that is 2 tokens short of it. Preflight after the fixes: 572 TypeScript tests and 16
Python tests; `analyse.mjs` reproduces `results.json`.

### Review by Claude, 2026-09-19, and the owner's decisions

The owner asked Claude to review the plan. Claude traced all nine test setups through `run.ts`,
`progress.ts`, `stuck.ts`, `gate.ts` and `images.ts`, compiled the prescribed `pruneImages` body and
the three helpers with the project's compiler options (TypeScript 7.0.2), ran the evaluator above on
twelve boundary cases and on the frozen snapshot, and re-read the caching documentation. The test
setups, the code and the baseline numbers held. Five findings, all applied on the owner's word
("do as you recommend"):

1. **The acceptance rule could reject batching for a reason that is not batching.** The first
   request of a run that carries an image misses the message cache by the provider's own rule; it
   did in 48 of 55 recorded runs, with one image in the context. The evaluator counted it as a
   judged miss, so a run with 10 to 19 judged calls had no room for a second miss. Spec revision 4
   and the evaluator above now leave that one request out of the judged set and report it on its
   own line. With it left out, every judged call in all 16 recorded runs with ten or more of them
   reuses the cache. The counts come from `docs/evidence/2026-09-18-cache-batching/first-image.mjs`.
2. **The spec, this plan and the frozen evidence were untracked.** One commit of documents adds
   them before Task 1 ("Resolved assumptions").
3. **The order against the open shortlist-mail item was not stated.** The owner decided: the two code
   commits first, then every live run of the day on that code ("Resolved assumptions").
4. **The platform design spec says only the last three screenshots stay in the history.** Task 3
   amends it if the 13-image limit is accepted.
5. **Small points.** The image numbering in Task 2's table now says what it counts from. Task 3
   names the start command and ends a sitting by stopping the server after `sandbox paused`. The
   fallback says where the old test is.

Checked and left as it is: HEAD had moved from `4db979b` to `c60f5df`, which changed documents only.

## Backbrief

The implementation will keep action warnings available to the model, then reduce how often old
screenshots are removed from its request history. The visible jobs will use the same computer,
tools and approval paths, and the two rehearsals will determine whether the larger history is
accepted. The fixed constraints are preservation of text and signed assistant blocks, a maximum
of 13 tracked images per request, and a separately usable three-image fallback. Implementation may
choose local test organization and evidence formatting within the named files; it may not change
the model, prompts, permissions, timing bounds or acceptance thresholds.
