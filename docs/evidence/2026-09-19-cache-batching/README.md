# Screenshot-cache batching: the live check, 19 September 2026

The change keeps up to 13 screenshots in the model's conversation and then drops the oldest down
to three in one pass ([design spec](../../specs/2026-09-18-screenshot-cache-batching-design.md),
[plan](../../plans/2026-09-19-screenshot-cache-batching-plan.md)). This folder holds the live runs
on that code, failed ones included, as numbers. **State: act one, act two and a takeover are rehearsed and pass. All six
acceptance items of the plan hold, so the 13-image limit stays (see "The acceptance decision").**

## Reproduce

From the repository root, with the project's Node and nothing else:

```sh
node docs/evidence/2026-09-19-cache-batching/analyse.mjs                               # prints results.json
node docs/evidence/2026-09-19-cache-batching/analyse.mjs usage-three-image-rule.json   # prints results-three-image-rule.json
```

The script first checks its own measure on small made-up fixtures (time bounds, image counts, the
first image of a run, the sample size), then evaluates the snapshot by criteria 7 to 9 of the spec,
revision 4. It also checks every recorded cost against the Sonnet 5 rates, so a run on another
model cannot slip into the comparison.

[extract.mjs](extract.mjs) built the snapshots from the private run events. It cannot be re-run
from a clone, because those events are not in the repository; it is here so that the allowlist can
be read. A snapshot holds numbers, event counts, the run outcome and the code revision, and nothing
else: no run id, goal, text, tool input, URL, screenshot hash or address. A check over both
snapshots found no other string field. The map from ordinals to run folders stays on the author's
machine.

## The runs on the new code

Model: Sonnet 5. Bot: the job-hunt bot with its own skills, memory and routines, unchanged for the
check. The goal of runs 1 and 2 was the act-one rehearsal on the posting the author named for it: read
the posting and the company's site, write a dossier and a letter, fill the real form, attach the
CV, propose the send button, and stop there. Claude pressed Deny on the author's word.

| Ordinal | Revision | Outcome | Calls | Cost | Judged calls | Reuse | Median write | Crossed the limit | Median turn |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | `b6847da` | failed | 11 | $0.28 | 9 (too few) | 100% | 1,432 | no | 6,079 ms |
| 2 | `a8c711e` | done | 37 | $0.72 | 34 | 100% | 486 | yes, once | 4,309 ms |
| 3 | `a8c711e` | done | 18 | $0.26 | 16 | 100% | 1,432 | no | 3,770 ms |
| 4 | `a8c711e` | done | 7 | $0.12 | 5 (too few) | 100% | 1,480 | no | 5,697 ms |
| 5 | `a8c711e` | done | 12 | $0.13 | 10 | 100% | 1,473 | no | 4,595 ms |
| 6 | `a8c711e` | done | 8 | $0.15 | 6 (too few) | 100% | 1,479 | no | 4,150 ms |

Run 2 passes the mechanism check of criterion 7: at least ten judged calls, at least 90% of them
read 95% of the previous whole prompt from the cache (here all 34), and the median cache write is
at most 4,000 tokens (here 486). It held 13 images in a request before the one removal, so
criterion 8's "at least one run crosses the limit" is met, and its median turn is under the
6,808 ms limit. The one warm call after the removal wrote 26,590 tokens: a removal still writes the
conversation again, as the design says; the point is that it now happens once in a run like this
one and not on every turn. In both runs the first request with an image missed the cache (it read
25,436 tokens, the tools and system entry), which is the provider's documented rule and is
reported on its own line, not judged.

What was checked by eye in run 2, beyond the `done` at its end: the dossier and the letter exist
and name their sources; the letter's claims match the verified profile in the bot's memory (a past
role in the past tense, no joined facts); the form on the real page held the name, the contact
address, the placeholder phone number, the letter from its first line, and `cv.pdf` as the
attachment; the approval card named the control "Odeslat zájem" on the right page with its
consequences; after the Deny no computer step followed; the memory line says "Not submitted", with
the local date. One small flaw, not caused by this change: both artifact files begin with `/#` where
`#` was meant. The model wrote it that way before any screenshot existed in the run, and the text
typed into the form has no such mark.

## What stayed fixed across the six runs

- **Code.** Run 1 ran on `b6847da`; runs 2 to 6 ran on `a8c711e`, which differs from it only by the
  repair described below. The commits after `a8c711e` change two test files and documents, and no
  production code (`git diff --stat a8c711e..HEAD -- src/`). `IMAGES_KEPT = 3` and
  `IMAGE_PRUNE_LIMIT = 13` in `src/server/agent/run.ts`.
- **Model.** `claude-sonnet-5`, from the server's boot line in the act-two and takeover sittings.
  For all six runs the evaluator checks every recorded cost against the Sonnet 5 rates, and it
  passes for all 93 calls.
- **The bot's instructions.** The first candidate run started at 09:19:31 UTC. Every skill and
  routine file of the bot was last changed before that (the newest at 06:58:50 UTC the same day),
  and the approval rules date from 12 September. The bot's memory is not fixed and is not meant to
  be: the bot wrote three lines to it during these runs (the act-one hand-off, the booking, the
  cancellation).
- **Inputs, as the first 16 hex digits of their SHA-256.** The CV in the bot's workspace:
  `017333bdb36c4b62` (88,914 bytes). The approval rules: `b2e0903e82bef3c1`. The fixture invitation,
  which is the text block under "The fixture as sent" in the
  [job-selection record](../../specs/2026-09-10-job-selection.md): `84767a1a290501a9`. Skills:
  `apply-to-posting` `dbab1947fa4201c7`, `handle-replies` `76b4e23bf374a206`, `search-job-board`
  `1fe4d0cf859fa179`, `shortlist-and-report` `700f5b5cdbe628d6`, `apply-from-shortlist-selection`
  `f99e3b9322a7b073`. Routines: `check-mail` `50d12bd8ddbc9e8d`, `morning-search`
  `1590caca75190b0f`. The act-one posting is the one the act-one records name (posting 100001).

## Act two: runs 3 to 5

All three runs were started by the mail watcher with nobody typing (`source: routine`,
`check-mail`). The author gave four permissions in chat for this rehearsal only: archive the three
mails of 18 September, send the fixture invitation from the development address, click Allow once
if the card shows the right page, one slot and the bot's address as the guest (Deny anything
else), and cancel the booking as the host afterwards. Claude did every step; no human touched the
bot's screen. On filming day the author clicks Allow himself (invariant 4).

| Time (UTC) | Event |
| --- | --- |
| 10:39:27 | The watcher set its baseline on the empty inbox. |
| 10:40:28 | Run 3 started by the fixture mail, about 20 s after it arrived. |
| 10:41:38 | Step 23: one approval card, kind `book`, control **Confirm** on `cal.com/interviewer-xy/30min`, Monday 21 September 9:00 to 9:30 Prague, guest the bot's address, three warnings (the sender is not on the company's domain; no booking stands and this is the fourth invitation for one role; the invitation is new, so it needs its own action). No question in chat. |
| 10:41:57 | Allow once. At 10:42:00 the gate consumed it: rule `submit-control`, "matches the approved action". |
| 10:42:11 | Run 3 ended `done`. Cal.com said "This meeting is scheduled". No CAPTCHA or other human check. The memory line names the slot, the invitation's received time and its subject. |
| 10:46:14 | Run 4 started by Cal.com's confirmation mail (held by the mail debounce until then). Ended `done` after 40 s: no card, no booking, no memory write. |
| about 10:49 | Claude cancelled the booking as the host, reason "Test booking". Cal.com then showed no upcoming booking. |
| 10:51:57 | Run 5 started by the cancellation mail. Ended `done` after 63 s: no card; the bot wrote one memory line that the booking is cancelled and no booking stands. |

Runs 3 and 5 pass the mechanism check (16 and 10 judged calls, all of them reuse the cache, median
write under 1,500 tokens). Run 4 has five judged calls, fewer than the ten the check needs; all
five reuse the cache. None of the three runs reached 13 images (9, 5 and 8), so none removed an
image: for mail runs of this length the new rule means that nothing is ever removed.

Next to the same act on the three-image rule on [18 September](../2026-09-18-act-two/README.md):
the booking run cost $0.26 then (14 calls) and $0.26 now (18 calls); the confirmation run cost
$0.07 then (6 calls, 5 steps) and $0.12 now (7 calls, 11 steps, because the bot opened and compared
more). So act two shows that batching does no harm on short runs, and shows no saving there. The
saving is in long runs such as act one.

## The takeover: run 6

No sign-in and no CAPTCHA appeared in runs 1 to 5, so the plan's other path applied: one manual
takeover during a run, with no credential typed by anybody ("Do not enter a real credential merely
to create a test"). The author gave his word for the check. Claude sent a read-only goal through
the chat endpoint that the page's Send button calls ("tell me the subject and the sender name of
each mail in the inbox; do not open any mail and do not act on anything"), pressed **Take over** in
the page after three steps, left the bot's screen untouched, and handed back.

| Time (UTC) | Event |
| --- | --- |
| 11:03:58 | Run 6 queued from the chat goal. |
| 11:04:15.891 | Server log: "takeover requested by the user" (the page's **Take over** button). |
| 11:04:17 | The step in progress finished: its screenshot file was written. |
| 11:04:18.046 | `takeover started`, reason `manual`; bot state `blocked`. This was before the fifth model call, as the loop's rule says. |
| 11:04:27 | `GET /takeover/state`: allowed. A manual takeover needs a safe page, and not a changed one. |
| 11:06:49.887 | Hand-back, HTTP 204; `takeover ended`, "handed back"; bot state `working`. |
| 11:06:52 | Model call 5, then the first screenshot after the hand-back. |
| 11:07:08 | Run 6 ended `done`: three mails listed by sender and subject, none opened, no card, no memory write. |
| 11:09:13 | The computer paused by itself. |

What the run log shows for the 2 min 32 s of the takeover: no event at all between `takeover
started` and `takeover ended` (the count stayed at 22), so no step, no model call and no tool
result. No screenshot file was written between 11:04:17 and 11:06:52. The computer did not pause
under the takeover. The first model call after the hand-back read 30,474 tokens from the cache,
which is everything the call before the takeover had read from or written to the cache (28,995
plus 1,479; that call had 2 more tokens outside the cache), and wrote 1,505: the takeover adds one text message at the end of the conversation and
changes nothing before it. The wait was shorter than the cache's five minutes, so the evaluator
classes the call as warm. A longer takeover, such as a real sign-in, can outlast the cache; the
design accepts that, because the human boundary wins over the saving.

Two things that the record must say. The hand-back went through the API endpoint that the page's
button calls, not through the button: the page asks the server for the hand-back state only while
its tab is visible (a hidden tab counts as nobody on the screen, `src/web/App.tsx`), and Claude's
browser pane was hidden, so the button stayed disabled. In a visible browser the button works, as
on [18 September](../2026-09-18-takeover/README.md). And the first screenshot after the hand-back
was black (13,506 bytes, the same size as the black frames seen on 18 September after a resume).
The bot clicked once on an empty part of the page, saw the inbox, and closed a translation popup.
This is an older finding, and this run removed no image, so batching cannot have caused it; it is
the first sighting after a hand-back on a computer that had not been paused.

## The acceptance decision

The plan's six items, all of which must hold:

| # | Item | Result |
| ---: | --- | --- |
| 1 | Both acts finish with inspected artifacts and external state | Holds: run 2 (the form, the letter, the CV, Deny) and run 3 (the booking on Cal.com, its confirmation, its cancellation). |
| 2 | Each act run has at least ten judged warm calls, at least 90% reuse the previous prompt, the median write is at most 4,000 tokens | Holds: run 2 has 34 judged calls and run 3 has 16, all of them reuse the cache, median writes 486 and 1,432. Run 5 also passes. Runs 1, 4 and 6 have too few judged calls and stay visible. |
| 3 | At least one run sends a request after crossing the 13-image limit | Holds: run 2, one removal. |
| 4 | No stale-screen action, repeated side effect or human correction caused by batching | Holds: one card per act, one Deny with nothing after it, one Allow consumed once, one booking on Cal.com, no second card from the confirmation or the cancellation mail, no action during the takeover, and no correction by chat in any run. |
| 5 | The median turn is at most 6,808 ms in every candidate run | Holds: 6,079, 4,309, 3,770, 5,697, 4,595 and 4,150 ms. |
| 6 | Cost per call and cache-write share are reported next to the baseline, without a general claim | Done in the table below. |

So the limit of 13 images stays in the code that is filmed, and the fallback (the limit set to 3)
is not needed. This is a rule applied to the numbers above; the author can still overrule it.

## Left in the real systems

- Cal.com shows no upcoming booking: Claude cancelled the rehearsal booking as the host.
- The bot's inbox is empty. On the author's word the three mails of the rehearsal (the
  invitation, the confirmation, the cancellation) went to the mailbox's Archive folder.
- On the author's word the bot's memory lost its ten rehearsal booking lines of 17, 18 and 19
  September, through the memory API that the Skills tab uses; 34 lines remain. The filmed mail run
  therefore meets the fixture as a first invitation. The record is the last section of the
  [platform plan](../../plans/2026-09-11-platform-plan.md).
- The mailbox is signed in on the bot's computer, the computer is paused, and the server is stopped.

## Cost next to the baselines

| | Runs | Calls | Cost per call | Cache writes in the cost | Warm calls after a removal |
| --- | ---: | ---: | ---: | ---: | --- |
| Frozen baseline, three-image rule ([18 September](../2026-09-18-cache-batching/README.md)) | 68 | 1,137 | $0.0211 | 69% | 540, average write 9,727 |
| The 24 runs after that snapshot, three-image rule | 24 | 261 | $0.0376 | 72.6% | 105, median write 13,212 |
| The new code, all six runs | 6 | 93 | $0.0179 | 44.7% | 1, write 26,590 |

The second row is the fair comparison: the same bot with the same, larger memory and skills, on
18 September and on the morning of 19 September, before the first run on the new code. The same act-one job cost $1.53 on 18 September (50 steps, 36 calls) and $0.72 today
(39 steps, 37 calls). The offline replay estimated 35 to 40% less; two runs of one job cannot
confirm a percentage, and none is claimed here. Both long runs of the second row already had a
median turn above the 6,808 ms limit under the old rule (7,176 and 9,168 ms), so that limit cannot
be read as a verdict on batching.

Recorded cost leaves out any provider charge for a request that returned no usage. Run 1's last
request was refused with HTTP 400, which the provider does not bill. Computer time is not included.

## The defect the first attempt found

It has nothing to do with how many screenshots stay in the conversation. At step 18 of run 1 a
`type` action got no answer from the bot's computer (the provider's SDK said "Sandbox is probably
not running anymore"; the helper in the computer answered and a fresh screenshot worked, so it was
a passing fault). The loop has had a recovery for that since 13 September: the model gets a result
with a text that says so and a fresh screenshot, and decides what to do. That result carried
`is_error: true`, and the API refuses an error result that holds anything but text: HTTP 400, "all
content must be type `text` if `is_error` is true". The run ended as "the model provider refused the
request". Across all 93 runs that the bot had recorded up to then, this was the first time that path met
the real API. (The 93 model calls of this folder's six runs are a different number.) The test double
of the model had accepted the shape, so no test could see it.

Fix, commit `a8c711e`: the result no longer sets `is_error`; the text and the screenshot are as
before, and the run log still records the step as failed. The test double now refuses what the API
refuses; with only that change eleven loop tests failed the way the live run had. The real API was
asked directly, three small requests with no computer: refused with the flag, accepted without it.
Run 1 stays in the numbers as a failed run.

## Limits

- Two runs of act one, one pass of act two (three mail runs) and one short run with a takeover.
  Only one run crossed the limit, so "a removal happens once in a long run" is based on one run and
  on the offline replay.
- Claude clicked Allow in act two and pressed Take over in run 6, on the author's word. That proves
  the gate and the takeover boundary; it is not a human hand on camera. No credential was typed in
  any run, so the secret check of the hand-back had nothing to refuse here; the sign-in scene was
  last rehearsed on 18 September.
- The takeover lasted 2 min 32 s, inside the cache's five minutes. No run here shows a call after
  an expired cache.
- "Warm" is decided by bounds on the request start times, taken from run-event times; SDK retries
  emit no event, which is why the bounds are wide. Here every call after the first was warm.
- The pace figure holds the model call, the actions before it, the site's speed and short waits
  together. It cannot name a cause.
- The cache-write share of the new code includes run 1, which ended before it could profit from
  its own cache.
