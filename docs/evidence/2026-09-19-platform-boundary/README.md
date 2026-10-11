# The platform boundary in `src/`: comments and model-facing text, 19 September 2026

`src/` is the platform. It serves any bot. Before this change it read like the diary of one bot:
comments told when and how a defect was found ("act two, round 4, finding D"), and a few texts the
model reads used words of the job hunt. The logic was already generic: no file under `src/`
branches on a site, a mailbox provider, a job or a booking. The base commit of every comparison
below is `57f6de6`, the code that both acts and the takeover were rehearsed on.

## What changed

1. **Comments, 50 files.** Every comment under `src/` now says what the code does and why, in
   present tense, as a general case. Dates, review names, rehearsal names, plan-task names, run ids
   and defect stories are gone; the reason each guard exists stays. Where a number came from a
   measurement, the comment keeps the fact and points to its record under `docs/evidence/`.
2. **Model-facing text, 13 phrases.** Five noun phrases in two prompt rules and eight examples in
   tool descriptions. No clause was added or removed.
3. **Checks.** `scripts/preflight.sh` has three new greps that must find nothing, and
   `src/server/agent/prompt.test.ts` has a new group, "the platform boundary".
4. **The rule** is in `CLAUDE.md` and `AGENTS.md` ("Platform code (`src/`)"), and the decision with
   its trade-off is in `docs/decisions.md` ("The platform's text knows nothing of one bot's work").

## The 13 phrases

| Where | Before | After |
| --- | --- | --- |
| `DOUBT_RULE` | a personal address, a job you never applied to, a strange link | a personal address, a reply to something you never sent, a strange link |
| `DOUBT_RULE` | a mail that confirms a booking you already made, an invitation you already acted on | a mail that confirms something you already did, a mail you already acted on |
| `DOUBT_RULE` | a booking that was cancelled or changed does not make the mail it came from new again | something that was cancelled or changed does not make the mail it came from new again |
| `DOUBT_RULE` | does not identify the mail or the booking well enough | does not identify the mail or the item well enough |
| `NOTES_RULE` | what it says, a slot, a page's answer | what it says, a date or a time, a page's answer |
| `write_artifact` | (a dossier, a letter, a summary) | (a report, a letter, a summary) |
| `write_artifact`, `name` | e.g. dossier-acme.md | e.g. report-acme.md |
| `read_artifact` | (a dossier, a letter) | (a report, a letter) |
| `ask_user` | Use it for the interview and for anything you cannot decide alone. | Use it for your questions about a new goal and for anything you cannot decide alone. |
| `propose_action`, `target` | e.g. "Schedule Event" | e.g. "Send" |
| `save_skill`, `name` | e.g. search-job-board | e.g. check-prices |
| `save_routine`, `name` | e.g. morning-search | e.g. morning-check |
| `set_routine_enabled`, `name` | the routine, e.g. morning-search | the routine, e.g. morning-check |

"Mail" stays in the platform's text. The platform has a mail event and a bot has a mailbox, so mail
is a platform word. "Interview" in the comments of `prompt.ts` means the bot's questions to its
user about a new goal, not a job interview.

## Why the doubt rule stays in the platform prompt

A first proposal was to move the whole rule into the job-hunt bot's `handle-replies` skill, where
the same instructions already stand. That was tried before, the other way round: with the rule in
the skill alone, several signs of a fake at once made the model ask in chat instead of proposing,
against its own skill. The rule is about how the approval card is used (a doubt is a warning on the
card, never a reason to stop or to ask first; work that memory shows as done is not proposed
again), so every bot gets it. Only its examples were the job hunt's, and the skill still holds
those word for word.

## The proofs

Run both from the repository root.

```sh
bash docs/evidence/2026-09-19-platform-boundary/comments-only.sh 57f6de6
pnpm exec tsx docs/evidence/2026-09-19-platform-boundary/bot-prompt-diff.mts 57f6de6
```

- **The comment change does not change behaviour.** `comments-only.sh` compiles every changed file
  at the base commit and in the working tree with every comment dropped, and compares the output
  (Python files by their syntax tree). Result: 50 files changed, 47 compile to identical code. The
  three that differ are the intended ones: `prompt.ts` and `tools.ts` (the 13 phrases) and
  `prompt.test.ts` (the new tests and one test title that said the opposite of what it checks).
- **What the example bot is given.** `bot-prompt-diff.mts` builds the system prompt of a
  mail-started run for `examples/job-hunt-bot` with the old and the new `prompt.ts`. Result: 23,797
  and 23,805 characters; exactly five sentence parts differ, the five phrases above; all eight
  instructions that the mail run depends on are still in the prompt, among them "a job never
  applied to" and "Never book a new slot on your own because of it", which come from the bot's own
  skill. The same check on the author's live bot folder gave 48,585 and 48,593 characters, the
  same five parts and the same eight instructions.
- **The checks can fail.** Run against `src/` of the base commit, the new greps find 13 lines with
  words of the job hunt, 136 lines with history names and 48 lines with dates in runtime files. On
  the working tree they find none. The new tests were written first and failed on the old wording
  ("applied", "booking", "invitation", "slot" in the prompt; "dossier", "interview", "Schedule
  Event" in the tool list).
- `pnpm preflight` passes: typecheck, 577 tests, 16 Python tests, all greps.

## The live pass on the new wording

Tests prove what the model is given. Only a live run proves what it then does, and the five phrases
stand in rules that were tuned on live runs. So both acts ran once more on commit `a0405de`, the
same afternoon, on the author's word ("I want that pass ... do that autonomously"; he was away).
Model: Sonnet 5. Bot: the job-hunt bot with its own skills, memory and routines, unchanged. The
limits Claude set for itself before the first run: Deny on the submit card of act one; Allow once
only on a `book` card for **Confirm** on the author's Cal.com page with one slot and the bot's
address as the guest, Deny on anything else; no password and no human check, a takeover request
ends that run. No takeover was asked for and no human check appeared.

| Run | Started (UTC) | Started by | Steps | Model calls | Cost | Cards | Outcome |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Act one | 13:21:49 | a typed goal, through the endpoint the page's Send button calls | 26 | 22 | $0.47 | 1 | `done` |
| The invitation | 13:28:22 | the mail watcher | 32 | 16 | $0.23 | 1 | `done` |
| The confirmation mail | 13:34:57 | the mail watcher | 4 | 6 | $0.10 | 0 | `done` |
| The cancellation mail | 13:40:29 | the mail watcher | 4 | 5 | $0.11 | 0 | `done` |

Four runs, $0.91. No run asked a question in chat (`ask_user` was never called).

**Act one.** The goal was the one of the morning's rehearsal, with new artifact names. One card:
kind `submit`, control "Odeslat zájem" on the posting's page, four consequences, and the earlier
attempts on the same posting as two warnings, not as a question. Checked on the bot's screen before
the decision: the real form held the name, the bot's contact address, the placeholder phone number
and the new letter, and the button was not pressed. Claude pressed Deny. No computer step followed;
the bot wrote one memory line ("Handed to the user ...") and said in chat that nothing was
submitted. Both artifacts exist and begin with a clean heading.

**The invitation.** Claude sent the fixture from the development address (the text in the
[job-selection record](../../specs/2026-09-10-job-selection.md), "The fixture as sent") through the
author's Chrome. The watcher saw it within a minute. One card: kind `book`, control **Confirm** on
`cal.com/interviewer-xy/30min`, Monday 21 September 9:00 to 9:30 Prague, the guest the bot's
address, two consequences, two warnings (the sender's personal address under the name "Interviewer
XY"; the same slot was booked and cancelled earlier the same day). This is the behaviour the doubt
rule exists for: the doubts are on the card, and the user decides there. Claude allowed once. The
gate consumed the approval once (rule `submit-control`, "matches the approved action"), Cal.com
said "This meeting is scheduled", and the bot wrote its "Booked on" line.

**The confirmation and the cancellation.** Cal.com's confirmation mail started a run by itself, held
by the mail debounce for about a minute: no card, no booking, one sentence. Claude then cancelled
the booking as the host, reason "Test booking". The cancellation mail started the last run: no
card, one "Cancelled on" memory line, nothing new done.

**Two observations, neither caused by the wording.**

- The warning about the earlier booking did not come from the bot's memory, which held no booking
  line (it had been pruned for filming). It came from the last six chat lines that every goal
  carries (`RECENT_LINES` in `src/server/agent/context.ts`): they still held the morning rehearsal's
  closing messages, and the model called them "memory". Pruning the memory is therefore not enough
  to make a later invitation look like the first one. Six newer chat lines are: act one is two, and
  two short questions in chat are four more.
- The confirmation run wrote a memory line this time ("Received Cal.com confirmation mail ...");
  in the morning it wrote none. It proposed nothing either way.

**The chat window, cleaned the same evening.** On the author's word Claude asked the bot three short
questions in chat (the date, the start time of the run, the number of its skills): three runs with
no computer step, $0.08 together. The last six chat lines are now these questions and answers.
Built with the platform's own functions from the live bot folder, the input of a mail run started
at that moment holds no trace of an earlier booking: none in the 35 memory lines, none in the
847 characters of its first message. What the mailbox and the booking page show is outside this
check. A booking rehearsal after this puts the old state back.

**Left in the real systems.** Cal.com shows no upcoming booking. The three mails of the pass (the
invitation, the confirmation, the cancellation) are in the mailbox's Archive folder, and the inbox
is empty. The three booking lines of the pass left the bot's memory through the memory API that the
Skills tab uses; 35 lines remain, the 34 from before and the act-one line. The bot's computer
paused by itself two minutes after the last run, and the server was stopped after that.

**Limits.** One pass: one run of act one and three mail runs. It shows that the new wording does
the filmed scenes once, not how often. No credential was typed and no human check appeared, so the
takeover had nothing to do here. Claude pressed Deny and Allow on the author's word; on filming day
the author does.

One number in a comment was checked against the author's private run logs, which are not in the
repository: up to 17 September, 32 runs finished, and their longest stretch of steps without
progress was 15, except one walk through result pages at 26, which the "new screen" rule now
counts as progress. The loops of that day reached 17 to 53
([docs/evidence/2026-09-17-loops](../2026-09-17-loops/README.md)).
