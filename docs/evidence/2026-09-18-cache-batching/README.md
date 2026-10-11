# Screenshot cache cost analysis, 18 September 2026

This is an offline cost estimate, not a live test of a different screenshot policy.
The application still uses its original policy. The proposed change is in the
[design spec](../../specs/2026-09-18-screenshot-cache-batching-design.md).

## Reproduce

From the repository root, using the project's existing Node runtime:

```sh
node docs/evidence/2026-09-18-cache-batching/analyse.mjs
```

No credentials, dependencies, network requests or sandbox are needed. The output matches
[results.json](results.json). The script also checks that the stored cost of each call matches
the Sonnet 5 token rates used in the calculation.

## What was captured

[usage.json](usage.json) freezes numeric fields from the 68 runs with cost events in
`data/bots/job-hunt-bot/runs/*/events.jsonl`, at code commit
`fd0807a064105063e43fad4ec11799cc54c37570`. It contains 1,137 recorded calls.
It excludes run IDs, goals, replies, thinking, tool inputs, URLs, images and account details.

Each anonymous run records the number of computer `step` events and calls to the platform tools
`open_url`, `attach_file`, `request_takeover` and `propose_action`. Each call records:

| Field | Meaning |
| --- | --- |
| `t` | The cost event time in milliseconds since the Unix epoch. |
| `i`, `o` | Uncached input and output token counts. |
| `r`, `w` | Cache-read and cache-write token counts. |
| `imgs` | Tool results with a non-null screenshot reference since the previous cost event. |
| `usd` | The platform's recorded model cost. |

The source snapshot is the platform's usage log, not a provider invoice. Requests for which no
usage response was recorded can have unrecorded provider charges. E2B costs are excluded.

## Results and corrections

The recorded total is $23.990078. Cache writes account for $16.521578, or about 69%.
Output accounts for $4.053180; cache reads for $3.410825; uncached input for $0.004496.

There are 13 runs with no computer `step` event, costing $0.716897. Three of those used
`open_url` or `request_takeover`. Excluding platform screen tools leaves ten runs costing
$0.588657. Half-price processing of those groups would save about 1.49% or 1.23% of this
sample, before classification, retries, different token counts or quality effects. This is an
estimate for routing whole runs. It is not a ceiling for every possible division of a job.

The replay reproduces the supplied `data/cost-profile/prune-replay.mjs` calculation:

| Policy | Estimated model cost | Largest estimated prompt | Estimated warm-call prunes |
| --- | ---: | ---: | ---: |
| Current policy: retain three images | $25.64 | 47,099 tokens | 540 |
| Allow 13 images; above 13, retain three | $15.04 | 54,845 tokens | 32 |
| Never remove images | $15.80 | 93,209 tokens | 0 |

The batching estimate is 37.29% below recorded spending and 41.33% below the replay's own
baseline. The baseline overestimates recorded spending by 6.87%. That discrepancy is not a
confidence interval for the changed policy. The supplied narrative also named 543 observed
cache rewrites; its separate `router-ceiling.mjs` reports 423 under a different heuristic.
This evidence makes no claim that either heuristic counts proven cache invalidations.

## What the recorded usage shows without a replay

Added in the first spec revision, 18 September 2026. The `recorded` block in `results.json` uses
only the captured numbers. It looks at warm calls: not the first call of a run, and at most five
minutes after the previous cost event.

| Warm calls | Count | Cache read | Average cache write |
| --- | ---: | --- | ---: |
| After an image removal under the three-image rule | 540 | 400 read only the base prefix | 9,727 tokens |
| With no image removal before them | 521 | 468 read beyond the base prefix | 990 tokens |

A removal is predicted from image counts, as in the replay, so the split is an estimate of which
calls followed an edit. The difference between the two rows is the mechanism the design relies on:
a call after an edit writes the conversation again, and a call without one writes only the new turn.
This is the measure the live check uses (spec criterion 7).

One limit, found in the Codex audit of spec revision 1: "warm" here means at most five minutes
between cost events, and a cost event is written when an answer ends. The cache lifetime counts
from the start of a request. So some calls in both rows were in fact cold, for example after a
long answer and a short human wait. The snapshot holds no request-start times, so this block
cannot do better. The live check does: it bounds each request start between two run-event times
and judges only the calls that are warm under the widest bound.

The same block records the time between cost events in the 19 runs with 14 or more images. That
time is the model call plus the actions before it. The per-run medians range from 3,784 ms to
6,808 ms, with a median of 4,497 ms. The spec uses the largest value as a turn-duration limit for a
candidate run (criterion 8). The number cannot say which of its parts made a run slow.

## The first image of a run

Added on 19 September 2026 for revision 4 of the spec. The snapshot and `results.json` are
unchanged; [first-image.mjs](first-image.mjs) only reads `usage.json`:

```sh
node docs/evidence/2026-09-18-cache-batching/first-image.mjs
```

55 of the 68 runs sent an image to the model. In all 55 the first request with an image came at
most four minutes after the previous cost event, and it held exactly one image, so no removal
had happened yet. In 48 of those 55 runs that request read less than 95% of the previous whole
prompt: it read the tools and system entry and wrote the messages again. In 42 runs it was the
third call of the run.

The provider documents the cause: a change in whether the prompt holds any image invalidates the
message cache and leaves the tools and system entries valid
([what invalidates the cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache),
row "Images", read on 19 September 2026). The rule that removes old screenshots has no part in
it. The live check therefore does not judge this one request of a run (spec criterion 7).

The script also applies the 90% measure of criterion 7 to each recorded run, under the
three-image rule those runs used. With the first image judged, 19 runs have ten or more judged
calls; three of them stand at exactly 90% and 12 are under 95%, so a second miss would fail a
short run. With the first image left out, 16 runs have ten or more judged calls, and every judged
call in all 16 reuses the cache. That one request was the only miss in those runs.

The same limit as above applies: "warm" is measured here between cost events. The script says how
it bounds the request starts with those times; the second call of a run cannot be judged that way.

## Assumptions and limits

- The replay holds actions, generated output, call times and outcomes fixed. A model seeing
  more historical images can choose different actions and produce different text.
- It assumes 1,306 tokens per image and 15 per replacement note. It estimates the cached
  tool/system prefix from the smallest positive cache-read count in each run.
- It predicts original pruning from screenshot-reference counts. It does not reconstruct
  the exact request payload, signed thinking, cache lookup boundaries or provider cache state.
- It treats zero cache reads and gaps over five minutes as cold calls. A cost event is recorded
  after a response; its time is not the exact time when a provider wrote or expired a cache.
- A screenshot retained on disk is a useful proxy for an image sent to the model, not a general
  guarantee for future event types. A result after the last recorded model call contributes no
  input tokens to this replay.
- The proposal preserves warning text when removing an image. The old code removes that text
  too, so the replay does not include those extra retained tokens.

The current [vision formula](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost)
gives 1,334 visual tokens for the configured 1280 by 800 full screenshot. Replacing the fixed
1,306 estimate with 1,334 changes the batching estimate to $15.10. Zoom images and other
dimensions still need their own counts. This sensitivity check does not validate behavior.

The cause is consistent with the [cache matching rules](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):
editing an earlier image changes the conversation prefix. The implementation performs that
edit in [pruneImages](../../../src/server/agent/run.ts). Exact savings require real usage after
the changed policy runs. There is no measured saving from batching in this folder.
