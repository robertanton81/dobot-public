# Cost efficiency: context hygiene Design Spec

**Date:** 2026-09-23
**Status:** Approved (2026-09-23)
**TODO items:** section "4. Product: hosted Grok Bot alternative for EU teams", item "Cost efficiency (invariant 8)"
**Scope:** `src/server/agent/run.ts` (pruning, grouped actions, request settings), `src/server/agent/actions.ts` and `src/server/agent/images.ts` (screen scaling), `src/server/agent/prompt.ts` (notes and grouping rules), a benchmark script under `data/cost-bench/`, `docs/evidence/`

## Problem

Invariant 8 (added 2026-09-23): a run takes the cheapest path that still finishes the job. The run
logs show where the money goes. Of 175 finished runs, the 119 that used the computer carried 91% of
the model cost ($71.01 of $77.76). Inside those runs, measured from the `cost` events at Sonnet 5
prices (method in "Baseline" below):

| Period | Runs | Steps | Cost per run | Cost per step | Cache read | Cache write | Output | Cache-read tokens per call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before batching (to 2026-09-19 15:00) | 78 | 2,287 | $0.45 | $0.015 | 16.3% | 68.5% | 15.2% | 19,007 |
| After batching | 41 | 1,915 | $0.88 | $0.019 | 47.6% | 35.8% | 16.6% | 55,775 |

The batching fix cut cache writes as designed, but each call now re-reads about 56,000 tokens.
Thirteen screenshots at 1280x800 are about 17,300 of them (1,334 tokens each, see Research), so the
larger part is text that never leaves the history: `fetch_url` returns up to 20,000 characters
(`tools.ts`, `FETCH_MAX_CHARS`), and so does `read_artifact` (`ARTIFACT_MAX_CHARS`). After batching,
thinking is 57% of output tokens (about 9.5% of cost), and 35% of all computer steps are plain
`screenshot` actions and 12% are `wait`, each a model call that only looks. Cache expiry during
human waits is negligible: 9 of 3,036 calls came after a gap over 5 minutes, carrying 2% of cache
writes. The periods ran different jobs (the later one includes the house research), so the table
shows where cost sits, not a clean before-and-after.

## Decisions Log

| # | Question | Decision | Reasoning |
| --- | --- | --- | --- |
| 1 | Scope | Context hygiene inside today's loop. Replaying learned routines without the model is its own later design cycle. | Routines carry 38% of computer-run cost ($26.65 of $71.01), but replay is a new execution model; the loop levers can be measured now. |
| 2 | How a lever is proven | Fixed benchmark, live A/B: two fixed goals, one lever switched on at a time, 3 runs per variant. A lever is accepted when cost per finished job falls by at least 15% and no finished job is lost. | Invariant 8: a cheaper path that finishes fewer jobs is not cheaper. Model behaviour changes (effort, grouping) cannot be estimated offline. |
| 3 | Approach | Our own context hygiene, four levers. | Works for every provider in the multi-provider design; Anthropic's server-side clearing is beta, costs the same cache write per clear, is not documented for the toolset on Sonnet 5, and other providers lack it. |
| 4 | Cache TTL of 1 hour | Not used. | 2% of cache writes follow a gap over 5 minutes; a 1-hour write costs 2x a 5-minute write. |
| 5 | Order of levers | Text pruning, then effort, then grouped actions, then screen scaling. Each later lever is measured on top of the accepted earlier ones. | Largest measured cost first; scaling changes what the model sees and carries the highest accuracy risk. |

## Relation to the multi-provider spec

`docs/specs/2026-09-23-multi-provider-models-design.md` is approved and its plan is paused until
this design exists. Build order: **this spec lands first**, on today's Anthropic-only loop, because
its levers are measured on that loop. The multi-provider plan then moves them, as follows (recorded
as an amendment in that spec):

- Pruning of both lists (screenshots and long page text) moves into the session port: the session's
  prune call takes the steps to keep for images and for long texts, and each adapter replaces the
  content in its own history.
- `toScreen` and `MODEL_SCREEN` stay in `run.ts`, at the neutral action level before the gate, so
  they hold for every provider. The images a session sends are the scaled ones for every provider;
  a later per-model screen size is a catalog field, decided in that plan, not here.
- Effort `medium` becomes part of the Anthropic adapter's request; the grouping rule and `carded`
  are already the batch rule that spec sets for OpenAI.

The re-homing is follow-on work named in the multi-provider scope budget, not throwaway work: the
logic moves, the rules stay.

## Chosen Approach

Four levers, each behind its own switch in `run.ts` (a constant, not a user setting), each accepted
or rejected by the benchmark before the next is measured:

1. **Page text leaves the history** in the same batched pass as old screenshots.
2. **Effort `medium`**, fixed for the whole run.
3. **Grouped actions**: the prompt asks for groups of actions ending with a screenshot, and the
   loop does not run the rest of a group after a failure or a human decision.
4. **Screenshots at 1024x640**, with the model's coordinates scaled back to the 1280x800 screen.

**Why this over alternatives:** see "Alternatives Considered". In short, server-side clearing is
beta, Anthropic-only and not cheaper per clear, and prompt-and-settings only leaves the largest
measured cost untouched.

## Research (source links)

- **Image tokens:** `⌈width/28⌉ × ⌈height/28⌉`; 1280x800 = 1,334, 1024x640 = 851 tokens (−36%);
  an over-limit screenshot in a computer-use result is rejected, not downscaled
  ([vision](https://platform.claude.com/docs/en/build-with-claude/vision#evaluate-image-size)).
- **Screen size and scaling:** recommended 1280x800 or 1366x768 for web applications, 1024x768 or
  1280x720 for general desktop tasks; the toolset takes no display size, and a resized screenshot
  needs the model's coordinates scaled back (`screen_x = x / scale`)
  ([computer use tool, coordinate scaling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#handle-coordinate-scaling-for-higher-resolutions)).
- **Only `screenshot` and `zoom` return images**; other actions return short text. Several computer
  `tool_use` blocks in one response run in order; execution stops at the first failure and the
  remaining blocks get "Not executed: an earlier computer action in this turn failed."; suggested
  prompt line: end each group of actions with a screenshot
  ([computer use tool, batch actions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#batch-actions)).
  Dobot already returns images only for `screenshot` and `zoom` (`actions.ts`, `executeAction`).
- **Client-side pruning on Sonnet 5:** the advice against client-side screenshot pruning applies to
  Fable 5.1 and Opus 5.5 only; batch pruning with moving cache breakpoints is the documented
  practice ([computer use tool, manage screenshot history](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)).
- **Effort:** GA as `output_config.effort`; Sonnet 5 accepts `low | medium | high | xhigh | max`,
  default `high`; `medium` is described as the cost-saving step-down; effort affects all output
  including thinking, and lower effort tends to combine operations into fewer tool calls
  ([effort](https://platform.claude.com/docs/en/build-with-claude/effort)). Changing effort or the
  thinking settings between requests invalidates the cache
  ([thinking, steering and cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)).
  `@anthropic-ai/sdk` 0.125.0 types `output_config?: OutputConfig` with
  `effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null`
  (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`, read 2026-09-23).
- **Prices (Sonnet 5):** input $2, 5-minute cache write $2.50, 1-hour cache write $4, cache read
  $0.20, output $10 per 1M tokens ([pricing](https://platform.claude.com/docs/en/about-claude/pricing));
  adding or removing images invalidates cached messages
  ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- **Server-side clearing (rejected):** `clear_tool_uses_20250919` is beta
  (`context-management-2025-06-27`) and invalidates cached prefixes on every clear
  ([context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).

## Design

### Baseline and method

The baseline is recomputed by the benchmark script, not copied from the table above:
`data/cost-bench/analyse.mjs` reads `data/bots/*/runs/*/events.jsonl`, keeps runs with an `end`
event and at least one `step`, and sums the `cost` events' `inputTokens`, `cacheRead`,
`cacheWrite`, `outputTokens` and `response.thinkingTokens` at the prices above. It prints per run:
cost, steps, model calls, cache-read tokens per call, and the outcome. A run log also records which
levers were on (see "Switches"), so the script groups runs by variant.

### Lever 1: page text leaves the history

- Today `pruneImages` (`run.ts`) keeps a list of screenshot results (`shots`) and, once there are
  more than `IMAGE_PRUNE_LIMIT` (13), replaces all but the last `IMAGES_KEPT` (3) with a text note
  in one pass.
- A second list, `texts`, holds the platform tool results of `fetch_url` and `read_artifact` whose
  text is longer than `TEXT_PRUNE_MIN_CHARS` (2,000). Each entry keeps the result block, the step,
  the tool name and its input's `url` or `name`.
- One pass, one trigger: the pass runs when `shots` exceeds 13 **or** `texts` exceeds
  `TEXTS_PRUNE_LIMIT` (4). The pass prunes both lists: all but the last 3 screenshots and all but
  the last `TEXTS_KEPT` (1) long texts. One pass means one cache rewrite, as today.
- A pruned text result keeps its first 300 characters and ends with one line:
  `[the rest of this page (fetch_url <url>, step N, <chars> characters) was removed to save context; use your notes, or fetch it again if you need it]`.
  For `read_artifact` the line names the artifact.
- Error results and short results are never pruned; the approval and unknown-outcome text that
  rides on a result stays, as today.
- `NOTES_RULE` (`prompt.ts`) changes to match what actually happens: "Of your screenshots, the
  last few stay in your context and older ones are replaced by a one-line note; long page text
  from fetch_url and read_artifact is removed the same way, except its first lines. When a
  screenshot or a page shows something you will need later …" (the rest of the rule unchanged).
  This also fixes the old claim that only three screenshots stay.

### Lever 2: effort `medium`

- The request adds `output_config: { effort: RUN_EFFORT }` with `RUN_EFFORT = 'medium'`. It is the
  same for every call of a run, so the cache is not invalidated inside a run.
- `max_tokens` and the cut-off retry stay as they are.

### Lever 3: grouped actions

- `prompt.ts` adds one sentence to the computer paragraph: "You may send several computer actions
  in one reply when you know what the screen will show; end each group with a screenshot so you
  can check the result before you continue."
- `run.ts`: while it handles the `tool_use` blocks of one response in order, a computer action that
  fails (invalid input, refused by the gate, failed on the computer) or that needed an approval card
  (allowed or denied) ends the group. Every later computer `tool_use` block in the same response is
  answered, without running, with `Not executed: an earlier computer action in this turn failed.`
  or, after a card, `Not executed: a human decision came in between; take a screenshot and plan again.`
  Platform tool calls in the same response still run, because each has its own checks. Each
  skipped action is logged as a `tool_result` event with `ok: false` and the same text, so the
  Runs tab shows it; it does not count as a step.
- The gate needs one new field to tell the loop that a card was shown: the `execute` verdict of
  `gate()` gains `carded: boolean`. It is `true` only on the last return of `gate()`, the one after
  the card was allowed and the `sameControl` check passed (today
  `return { execute: true, consume: { …, announced: false } }`). It is `false` on the other two
  `execute` returns: no gated kind or an allow rule, and the `result.decision === 'consume'` branch
  that uses an approval made earlier through `propose_action` (`announced: true`). A Deny returns
  `refused` as today and also ends the group. This is the same rule the multi-provider spec sets
  for OpenAI's batched actions.

### Lever 4: screenshots at 1024x640

- `MODEL_SCREEN = [1024, 640]` next to `RESOLUTION` (`sandbox/port.ts`). The sandbox desktop stays
  1280x800, so pages keep their desktop layout.
- Every image sent to the model (`screenshot`, the fresh screenshot after a failure, the takeover
  hand-back screenshot) is scaled to `MODEL_SCREEN` with the existing PNG code (`images.ts`,
  `cropAndScale` with the full-screen region). The PNG stored in the run log stays full size.
- `parseAction` validates `coordinate`, `start_coordinate` and the `zoom` `region` against
  `MODEL_SCREEN` (both the `Coordinate` and the `Region` schema take their bounds from it). A
  region is two corners, `[x0, y0, x1, y1]` (`images.ts`, `cropAndScale`); each x is bounded by
  1024 and each y by 640, and `cropAndScale` keeps clamping to the image as today.
- A new `toScreen(action): ComputerAction` returns a new action with every coordinate,
  `start_coordinate` and `region` value multiplied by 1.25 (1280/1024 = 800/640) and rounded to
  whole pixels. `handleComputer` calls it once, immediately after `parseAction`, and the scaled
  action replaces `parsed` for everything that follows: `gate()`, `executeAction`, `describeAction`,
  the `step` and `tool_result` events, and the stuck and progress detectors. So the gate, the
  companion and the mouse all use real screen positions, and the Runs tab shows real-screen
  coordinates. `zoom` crops the full-size screenshot with the scaled region, and its result is
  scaled to `MODEL_SCREEN`.
- The prompt states the screen as 1024 by 640.

### Switches and the benchmark

- Four constants in `run.ts`: `PRUNE_TEXT`, `EFFORT_MEDIUM`, `GROUPED_ACTIONS`, `MODEL_SCALING`,
  each read once per run. The runner records them on the `queued` event as
  `levers: { pruneText, effortMedium, groupedActions, modelScaling }` (optional, so old logs still
  parse). A run carries no other new data.
- `data/cost-bench/` (git-ignored, like the other helper scripts under `data/`) holds:
  - `goals.md`: the two fixed goals, with the exact text sent and the check the author applies;
  - `run.mjs`: sends a goal to a bot through the API, waits for the end, and writes the run id to a
    results file;
  - `analyse.mjs`: the baseline and per-variant table described above.
- Goal R (research): Homer researches one named town against its skill's criteria and writes one
  artifact (uses `fetch_url` and the computer). Goal M (mail routine): Hunter's `check-mail`
  routine on one seeded invitation mail. The author judges each run as finished or not by the
  check written in `goals.md`.
- Variants, in order: baseline (all off); +1; +1+2; +1+2+3; +1+2+3+4. A lever that fails its
  acceptance rule is switched off before the next variant runs. 3 runs per goal per variant: 30
  runs.
- The result goes to `docs/evidence/<date>-cost-levers/README.md`, dated the day the benchmark
  ends. After it is written, the four switch constants and the code that writes `levers` are
  removed: accepted levers become plain code, and a rejected lever's code is removed. The
  `levers` field stays in the `queued` schema as optional, so the benchmark's own run logs still
  parse; no new run writes it.

### Expected cost per run (invariant 8 statement)

| Lever | Expected effect | Basis |
| --- | --- | --- |
| 1 Page text | Cache-read tokens per call fall from about 56,000 toward the image-and-prompt floor of about 25,000 on research runs; smaller effect on routines | 20,000-character results stay today; estimate, measured by the benchmark |
| 2 Effort medium | Thinking falls; some fewer calls | Thinking is about 9.5% of cost; docs |
| 3 Grouped actions | Fewer calls that only look (35% of steps are screenshots) | Run logs; docs |
| 4 Scaling | Up to −36% of image tokens, about −6,000 cache-read tokens per call | Token formula |

The benchmark itself costs about $15–25 in model spend (30 runs at $0.5–0.9) and sandbox time of
about 30 runs × 10 minutes.

## Demo path

| # | What the viewer sees | What happens underneath |
| - | -------------------- | ----------------------- |
| 1 | The author sends Goal R to Homer; the bot researches on the live screen and writes an artifact. | Levers on; the `queued` event records which. |
| 2 | Midway, an old page's text in the Runs tab trace is unchanged, while the bot's next reply refers to its own notes. | A pruning pass replaced the page text in the model's history, not in the run log. |
| 3 | The bot clicks, types and takes one screenshot in one turn; the Runs tab shows three steps under one model call. | Grouped actions. |
| 4 | The bot reaches a send or submit control; the approval card appears; after Allow the remaining actions of that group are shown as not executed. | The gate's `carded` verdict ends the group. |
| 5 | The evidence page shows cost per finished job for each variant, and which levers were kept. | `analyse.mjs` output, committed as evidence. |

## Invariant coverage

| # | Invariant | Mechanism, or "not touched" |
| - | --------- | --------------------------- |
| 1 | Visible remote computer | Not touched: the live stream shows the full 1280x800 screen; only the model's copy is scaled. |
| 2 | Real work, not simulation | The benchmark runs real goals on real sites; nothing is replayed or mocked. |
| 3 | One job, finished | The acceptance rule rejects any lever that loses a finished job. |
| 4 | Approval before irreversible side effects | The gate reads real screen coordinates after scaling (`toScreen` runs before the gate); a card ends the group so no action planned before the human decision runs after it. |
| 5 | Takeover without secrets in the transcript | Not touched: the secret check and takeover run as today; the pruning note carries no page text beyond the first 300 characters, which were already in context. |
| 6 | Persistence across sessions | Not touched: pruning changes only the in-memory model history; run logs keep full text and full-size screenshots. |
| 7 | Configured in plain language | The levers are platform constants, not user settings; nothing new for the user to configure. |
| 8 | Cost efficiency | This design: measured baseline, one lever at a time, acceptance by cost per finished job. |

## Failure modes on the day

| Failure | Detection | What the operator does |
| --- | --- | --- |
| The model re-fetches pruned pages in a loop | `ProgressGuard` notices repeated `open_url`/`fetch_url` of the same page; the benchmark shows more calls | Raise `TEXTS_KEPT` or `TEXT_PRUNE_MIN_CHARS`, or reject lever 1 |
| Effort `medium` misses steps and loses a job | Benchmark: finished jobs fall | Reject lever 2 |
| A group runs an action on the wrong field after a failed click | Prevented: the rest of the group is not executed | None |
| Scaled screenshots make small text unreadable and clicks miss | Benchmark: more `zoom` calls or failed clicks, finished jobs fall | Reject lever 4 |
| The sandbox will not start or resume, a login expired, a CAPTCHA appeared | As today | As today; a benchmark run lost to such a failure is repeated, not counted |

## Scope budget

**In:** the four levers with their switches, the `levers` field on the `queued` event, the
`carded` verdict, the two prompt changes, the benchmark scripts, the evidence page, and unit tests
for: the text-pruning pass (which blocks change, one pass for both lists, error results kept), the
group-ending rule (failure and card), `toScreen` mapping and bounds, and the scaled image size.

**Parked, with reasons:**
- Replaying learned routines without the model: its own design cycle (decision 1).
- 1-hour cache TTL: 2% of cache writes (decision 4).
- Anthropic server-side context editing: beta, Anthropic-only (decision 3).
- Reading pages through the companion's DOM instead of screenshots: a DOM dump can be larger than a
  1,334-token screenshot; it needs its own measurement.
- A cheaper model for simple steps: the 2026-09-18 measurement put a router's ceiling at 1.5%
  because Haiku 4.5 cannot use the computer toolset; the multi-provider catalog reopens this later.

**Estimate:** the author's hours: seeding the invitation mail for Goal M before each of its 15 runs
(changed later on 2026-09-23: Claude sends it through Claude in Chrome from the author's Gmail, on
his word, and judges each run against the written check; the author reviews the marks from the
evidence page, about 1 hour). Live-run cycles: 30 benchmark runs in five
variants, plus one regression run after the last accepted lever.

## Alternatives Considered

### Anthropic server-side context editing

`clear_tool_uses_20250919` would clear old tool results on the server. Rejected: beta, a cache write
on every clear like our own pass, not documented for `computer_toolset_20260801` on Sonnet 5, and
not available from OpenAI or open models, which the multi-provider design adds.

### Model settings and prompt only

Effort `medium` and the grouping sentence, no pruning code. Rejected: it leaves the largest measured
cost, the growing history read on every call, untouched.

### Routine replay first

Replaying a routine's recorded steps without the model. Parked, not rejected: largest possible
saving on the 38% that routines carry, but a new execution model with its own design.

## Amendment (2026-09-23, from the plan review): `carded` on every return of `gate()`

A group ends with the "human decision" text when a human took part in the verdict, and with the
"failed" text when the gate refused on its own. The table covers all ten return points of `gate()`
in `run.ts` (line numbers of 2026-09-23):

| Line | Return | `carded` | Why |
| --- | --- | --- | --- |
| 213 | `refused`: secret field, after a takeover | true | A human held the screen; the page may have changed |
| 218 | `refused`: typed space would activate a control | false | The gate refused on its own |
| 221 | `execute`: no gated kind | false | Nothing was decided |
| 232 | `refused`: file upload control | false | The gate refused on its own |
| 239 | `refused`: repeated activation | false | The gate refused on its own |
| 244 | `execute`: allowed by a rule or no rule | false | Nothing was decided |
| 247 | `execute`: consumes an earlier `propose_action` approval | false | The decision was made before this reply was planned |
| 282 | `refused`: the user denied the card | true | A human decided |
| 291 | `refused`: the control changed while the user decided | true | A human decided, and the page moved |
| 293 | `execute`: the card was allowed and the control is the same | true | A human decided |

The refused verdict therefore carries `carded` too: `{ refused: string; carded: boolean }`.

Also from the review: the screenshot-count sentence of `NOTES_RULE` ("only the last three stay")
is corrected for every run, before the baseline is measured, so the baseline and every variant run
with the same true sentence; only the page-text sentence depends on lever 1. And a `zoom` result
under lever 4 is cropped from the full-size screenshot and fitted into `MODEL_SCREEN` with its own
aspect ratio (`cropAndScale` with `fit = MODEL_SCREEN`), never stretched.
