# Act two, 18 September 2026: invitation → card → Allow → real booking

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Result: **PASS.** The seeded invitation started `check-mail` with nobody typing. The bot stopped at
one approval card for Cal.com's **Confirm** button. After Allow, Cal.com said "This meeting is
scheduled". The confirmation mail then started a second run, which ended with no card.

This is the first Act two run since the streamed model call, the act-one grounding changes, and
the loopback binding (`0bca433`). No code or instruction changed for this run.

## Who did what

The owner asked for a fully autonomous run and gave three permissions in chat for this run only:
archive the old test mails, allow the booking card if it matches, and deny any other card.
Claude did every step. No human touched the bot's screen.

| Step | Who | How |
| --- | --- | --- |
| Archive yesterday's five test mails (UIDs 84–92) | Claude | IMAP, `data/step-c-mail.mts archive` |
| Start the server, stop the missed `morning-search` | Claude | launch entry, `POST /api/bots/job-hunt-bot/stop` |
| Send the fixture mail | Claude | the dev Gmail account in the owner's Chrome; the text of "The fixture as sent" in the job-selection spec |
| Check and allow the card | Claude | read the card and its screenshot, then clicked **Allow once** in the app page |
| Stop the server after the runs | Claude | so a Cal.com reminder mail cannot start an unattended run |

The Allow click was Claude's, on the owner's word. It proves the gate mechanism: the run stopped,
waited, and acted only after Allow. On filming day the owner clicks it himself (invariant 4).

Allow conditions set before the card appeared: the page is `cal.com/interviewer-xy`, there is one
slot, and the guest email is the bot's address. All three matched (`approval-card.json`,
`c1f0ddb8-…/approval-card.png`).

## Timeline (UTC; Prague is UTC+2)

| Time | Event |
| --- | --- |
| 06:07:23 | Server boot. The missed 07:00 Prague `morning-search` started (planned 05:00 UTC). |
| 06:07:33 | Stop through the API. Run `9d9d4f16` ended `cancelled` at step 0. The pending model call was aborted. |
| 06:34:15 | Fixture mail received (UID 94, sender name "Interviewer XY"). |
| 06:34:34 | The watcher started `check-mail` by itself: run `c1f0ddb8`. |
| 06:35:57 | Step 23: approval card for **Confirm**, action kind `book`, four warnings, no question in chat. |
| 06:36:32 | Allow once. At step 24 the gate consumed it: rule `submit-control`, "matches the approved action". |
| 06:36:42 | Cal.com's confirmation mail received (UID 96). |
| 06:36:43 | Step 26: "This meeting is scheduled", Fri 18 Sep 11:00–11:30 CEST, host Interviewer XY, guest `bot@example.test`. No CAPTCHA or other human check. |
| 06:36:48 | Run `c1f0ddb8` ended `done`. The memory line was written (`memory-added.md`). |
| 06:39:49 | The confirmation mail started `check-mail` by itself: run `9f7070b6`. |
| 06:40:16 | Run `9f7070b6` ended `done`: "nothing needs action". No card and no memory write. |

## Cost

| Run | Why | Steps | Model calls | Cost |
| --- | --- | --- | --- | --- |
| `9d9d4f16` | missed `morning-search`, stopped | 0 | 1 | $0.0471 |
| `c1f0ddb8` | the booking | 26 | 14 | $0.2600 |
| `9f7070b6` | the confirmation mail | 5 | 6 | $0.0732 |
| **Total** | | | | **$0.3803** |

The stopped run still cost one model call: the prompt-cache write was billed before Stop aborted
the request.

## Criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| The invitation starts the routine with nobody typing | PASS | `queued` event, `source: routine`, 19 s after the mail arrived |
| One card, doubts as warnings, no question in chat | PASS | `approval-card.json`: four warnings; the chat has no question |
| The gate runs only the approved control | PASS | step 24 gate event: `consume`, `submit-control`, "matches the approved action" |
| A real booking in a real system | PASS | `c1f0ddb8-…/last.png`; confirmation mail UID 96 in the bot's inbox (`9f7070b6-…/last.png`) |
| The booking is written to memory with received time and subject | PASS | `memory-added.md` |
| The confirmation mail causes no second card | PASS | run `9f7070b6`: 5 steps, zero approval events |
| No secret in logs, chat or this folder | PASS | scan for stream URLs, `password=`, provider key prefixes: 0 matches |

## Findings

**F1. A stale claim reached the card as a warning, and now sits in memory.** The card's second
warning says the 09:30–10:00 booking from the 2026-09-16 invitation "is still standing/active".
That slot was Thursday 17 September, so it is in the past. The claim has no booking line of its
own. It sits inside memory lines 12 and 13, which the bot wrote on 17 September, and the Step C
record of that day already called it unverified (`docs/evidence/2026-09-17-step-c/README.md`,
"Limits of the comparison"). The new memory line 20 repeats it as a fact. The booking itself is correct, and the line's link to the
application of 2026-09-12 matches memory line 11. On camera, the stale warning would be read aloud
as a fact. What to clear from memory and chat before filming is the owner's decision.

**F2. The first screenshot after the computer resumed was black.** The run's first screenshot
(06:34:44, 13.5 KB) is black. The bot waited 2 seconds, and the next screenshot at 06:34:49 was
normal. Act one's run `b21a8f60` shows the same black first frame. It cost one extra step here.

**F3. The page showed a black screen and a stale status for about 2 seconds.** Claude selected
Hunter in the app page while the card was waiting. For about 2 seconds the screen panel was black,
and its header said "the bot is not doing anything right now". At the same time, the roster already
said "waiting for your approval". Later the panel showed the live mailbox, and the header showed the
run's result. The cause was not investigated. On filming day, select the bot before the mail arrives.

## What this run does not prove

- A human click on camera. Claude clicked Allow, on the owner's word.
- A takeover. No CAPTCHA appeared, so invariant 5 was not exercised in this run.
- Reliability over many runs. This is one clean pass on a one-mail inbox.

## Left in the real systems

- The booking stands: Friday 18 September 2026, 11:00–11:30 CEST, on the host's calendar
  (Interviewer XY). Cancel it as the host if it is not wanted. Cancelling sends a "Canceled" mail
  to the bot's inbox.
- The bot's inbox holds UIDs 94 (the invitation) and 96 (the confirmation), both read. Yesterday's
  five test mails are in Archive.
- The server is stopped. The computer `i4wbt3opyimbukfb07snp` pauses by itself when idle.

## Files

- `approval-card.json`: the card as the chat stored it.
- `c1f0ddb8-…/`: the booking run's events, first and last screenshots, and the card's screenshot.
- `9f7070b6-…/`: the confirmation run's events and first and last screenshots.
- `summary-booking-run.txt`, `summary-confirmation-run.txt`: each run's final chat message in full.
- `memory-added.md`: the memory line the booking run wrote.
