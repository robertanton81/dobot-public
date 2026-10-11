# Built-in connectors: the live check, 24 September 2026

Milestone 1 of the connectors ([design spec](../../specs/2026-09-24-connectors-design.md),
[plan](../../plans/2026-09-24-connectors-m1-plan.md)) gives a bot four built-in connectors:
Wikipedia, Mapy.com, Cal.com public pages and the bot's own mailbox. This page holds the two live
cycles of the plan's Task 9, failed attempts included, as numbers. **State: both cycles did their
job with no computer step. Cycle 1 cost less than its baseline; cycle 2 cost more, both with two
grants in the run ($0.44) and with the connections already granted ($0.34), against $0.26 for the
same booking on the computer. Both computers were paused and the server stopped afterwards.**

The runs used the code on branch `connectors` at `c3b0346`, the bot folders of the author's
machine, model `claude-sonnet-5`, and a real key for Mapy.com. Run ids, goals and addresses stay
on the author's machine; the ordinals below are enough to follow the story.

## Cycle 1: Homer researches a town

The goal was the one of three earlier runs, "research the town … for the house search" against
the town facts of Homer's skill, with a new town. Nymburk already had its research file, so Homer
correctly did nothing (run 1). Sedlčany is about 47.6 km from Prague in a straight line, which is
the band where Homer's skill asks for a road-distance check.

| # | What happened | Model cost | Model calls | Computer steps |
| -: | --- | ---: | ---: | ---: |
| 1 | Nymburk: the file already existed; Homer said so and stopped | — | — | 0 |
| 2 | Sedlčany, before the skill correction: `wikipedia__page` with no card, then the skill's own line sent Homer to Mapy.cz on the computer. A blind click stopped at the gate (unknown target); Denied. The browser showed only black pages, and the run ended `denied` on a screenshot timeout | $0.80 | 28 | 19 |
| 3 | The skill correction by chat: Homer asked for `mapy` with a connect card; Connect; the next model call got no answer for 120 s and the run ended `failed` (see "Network") | — | — | 0 |
| 4 | The same correction again: the model call got no answer; `failed` | — | — | 0 |
| 5 | The same correction again, after the network was back: Homer rewrote `house-search-prague` (road check through `mapy__geocode` and `mapy__route`, never Mapy.cz on the computer). A word diff shows only the distance lines changed; 2,145 words before, 2,247 after | $0.15 | 2 | 0 |
| 6 | **Sedlčany again: `wikipedia__page`, two `mapy__geocode`, two `mapy__route` (76.2 km, 60 minutes by car: the offer fails the 50 km rule), `fetch_url` for the rest, `town-sedlcany.md` written, `done`** | **$0.39** | 18 | **0** |

**Baseline:** the three Nymburk runs of 23 September 2026 cost $0.55, $0.99 and $1.93, with 16, 41
and 88 computer steps. Run 6 cost $0.39 and used no computer step. The town differs, the job and
the skill are the same; one run is not a measurement of variance, which was 3.5x between the three
baseline runs (see the cost-lever benchmark note in the private backlog).

**What run 2 shows:** the channel rule in the prompt did not beat an explicit line in the bot's
own skill. Homer read Wikipedia through the connector on its own, but went to the computer for the
road check because the skill said so. The fix is the product's normal path: the user corrects the
skill in the chat, and the bot rewrites it (invariant 7).

## Cycle 2: Hunter reads an invitation and proposes a booking

First, a correction by chat: `handle-replies` reads mail with `bot-mailbox` and books with
`calcom-public` instead of webmail and the booking page on the computer (run 7). A word diff shows
the rules for deciding which mail is new and what goes to memory unchanged; 853 words before,
1,087 after, and the skill keeps a fallback to the computer for a link that is not a Cal.com page.

Then Claude sent the invitation fixture of the job-selection spec from the author's development
Gmail address to the bot's mailbox, on the author's word. The mail routine started 35 seconds later
(run 8):

| Time (UTC) | Event |
| --- | --- |
| 12:11:59 | the mail routine starts |
| 12:12 | `request_connection` for `bot-mailbox`; the connect card; Connect |
| 12:13 | `bot-mailbox__list` finds the invitation; `bot-mailbox__read` reads it as text |
| 12:13 | `request_connection` for `calcom-public`; the connect card; Connect |
| 12:14 | `calcom-public__slots` lists one free time today, 16:30 |
| 12:14 | `calcom-public__book` stops at an approval card: kind `book`, "books 2026-09-24T16:30 … on https://cal.com/interviewer-xy/30min for Test Owner <bot@example.test>", the full arguments on the card |
| 12:15 | **Deny** (Claude, through the page's route). The tool result "denied: … do not retry it"; no retry; the report; `done` |

After the run, the Cal.com API still offered 16:30 on that page: no booking was made.

| # | Run | Model cost | Model calls | Computer steps | Cache write (tokens) |
| -: | --- | ---: | ---: | ---: | ---: |
| 7 | the skill correction | $0.20 | 2 | 0 | 46,522 |
| 8 | **the mail run, with two grants and the denied booking** | **$0.44** | 8 | **0** | 125,828 |

**Baseline:** run 3 of the screenshot-cache batching check (19 September 2026), the same fixture
and the same booking on the computer: $0.26 and 18 model calls.

**Run 8 cost more than its baseline, although it made fewer than half the model calls and no
computer step.** Each Connect in the middle of the run rebuilds the tool list, and the tool list
sits at the front of the prompt cache, so the whole prompt is written to the cache again (spec
decision 11). Two grants wrote about 126,000 cache tokens. This is paid once per connection: the
next mail run starts with both connections and pays no rewrite. That next run was not measured
here, so the claim that a steady-state mail run is cheaper than $0.26 is not proven by this page.
Decision 11 expected one use to repay a rewrite; that estimate was made against the computer's
cost before the screenshot batching, and it did not hold for this job.

## Cycle 2 again, with both connections already granted

On the author's word, a second copy of the same invitation was sent at 12:27 UTC, from a server
started on `main` after the merge (run 9). No connect card: `bot-mailbox__list`,
`bot-mailbox__read`, `calcom-public__slots`, then `calcom-public__book` stopped at its card; Deny;
`done`. Both booking calls of the day ended "denied: … do not retry it", which the gate returns
before the tool runs, so no request reached Cal.com. (Today's 16:30 later left the list of free
times because of the page's minimum notice; the next day still showed all 16 times.)

| # | Run | Model cost | Model calls | Computer steps | Cache write (tokens) |
| -: | --- | ---: | ---: | ---: | ---: |
| 9 | the mail run, connections already granted | **$0.34** | 6 | **0** | 60,329 |

Per call: the first call wrote the 43,393-token prompt to the cache ($0.110), which every run pays,
the baseline too; the reads and the free times cost $0.044; the call that proposed the booking and
the call after the Deny thought for 5,654 and 4,757 tokens ($0.155), because this mail was a second
copy of an invitation the bot had already answered, and the rules for doubtful mail make it weigh a
duplicate. **For this job the connectors remove every computer step and the webmail sign-in, but
not model cost:** $0.34 against the $0.26 of a first invitation on the computer. The two runs
differ in the duplicate, so this is not a clean comparison of the channels.

## Network

From about 11:10 to 12:05 UTC the author's machine intermittently failed to resolve addresses:
the server's pause calls to the sandbox provider failed with `ENOTFOUND` at 11:46, 11:51, 11:56 and
12:01, and a review agent failed the same way. Runs 3 and 4 ended with the model's stall error in
that window. A probe at 12:03 sent four small requests (no tools, the computer toolset, the four
connectors' tools, both) and every one answered its first event within 1.7 s; run 5 then worked.
The stall is the network, not the connector tools.

## What this does not show

- A Cal.com booking that is allowed: the plan's cycle denies it, so `calcom-public__book` has never
  booked live. Its request is checked against the documented API in tests only.
- `bot-mailbox__send`: not called in either cycle.
- Sandbox hours: every run still starts the bot's computer (plan decision P9), even run 6 and run 8,
  which used no computer step.
