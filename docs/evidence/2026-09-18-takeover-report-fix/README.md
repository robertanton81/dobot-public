# The takeover report fix, one live run, and the cleanup after act two — 18 September 2026

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Result: **the false claim did not come back in one live run.** That is weaker than "the fix is
proven", and the section "What one run shows" says why. Two cleanup items from the act-two record
were closed the same hour, both through the product: the stale booking claim (F1) and today's test
booking.

Code under test: commit `8960406` (the takeover rule names who gets the credit for a step done
during a takeover). No other code or instruction changed.

## Why

Finding T2 of `docs/evidence/2026-09-18-takeover/`: after the owner signed the mailbox in by takeover,
the bot's closing message said "I signed back into the mailbox". The prompt's takeover rule said
what to do at a secret and nothing about the report. The tool result after a hand-back says "the
human handed the screen back" and is also silent on the report.

## The runs (UTC; Prague is UTC+2)

| Run | Started by | What | Steps | Calls | Cost | End |
| --- | --- | --- | --- | --- | --- | --- |
| `0e04ea2c` | Claude, a chat message | F1: a correction to memory, in plain language | 0 | 2 | $0.0550 | 07:36:32 `done` |
| `7c87efdf` | Claude, a chat message | setup: sign the mailbox out | 6 | 5 | $0.0643 | 07:37:03 `done` |
| `112b7cba` | Claude, a chat message | the check: the `check-mail` text as a goal, the same input as this morning's run `af0f8a48` | 4 | 6 | $0.0932 | 07:48:38 `done` |
| `98f8aef9` | the mail watcher, nobody typing | the cancellation mail of today's booking | 6 | 7 | $0.0790 | 07:51:48 `done` |
| **Total** | | | | | **$0.2915** | |

The owner's hands: one sign-in on the bot's screen and one press of Hand back, inside run `112b7cba`
(takeover 07:38:42–07:48:22). Claude read only the event log in that time: no probe, no screenshot.
The event log holds no event between the takeover's start and its end.

## What one run shows

The three closing messages after the same scene, a mailbox sign-in by takeover:

| Date | Run | Rule in the prompt | The message starts |
| --- | --- | --- | --- |
| 14 Sep | `0b149d27` | old | "I checked the mailbox (with your help signing in): …" |
| 18 Sep, morning | `af0f8a48` | old | "I signed back into the mailbox (after the takeover rehearsal sign-out) and checked the inbox: …" |
| 18 Sep, after the fix | `112b7cba` | new | "I checked the mailbox: only the same two messages already in memory are present …" |

- The false claim is gone in this run. The message does not say that the bot signed in.
- The message also does not say "you signed in". The rule asks for that credit. The model left the
  sign-in out instead. The defect was the false claim, so this is an acceptable outcome, and it is
  recorded as it happened.
- One run cannot separate the fix from chance: under the old rule the wording was right once and
  wrong once. The unit test pins the sentence in both kinds of run; the live evidence is this one
  message. A second sighting comes for free with the next sign-in takeover, for example on filming
  day. No extra run was made for it: each costs the owner a password.

The full messages are in each run's `closing-message.txt`.

## F1: the stale "still-standing 09:30 booking" claim

Finding F1 of `docs/evidence/2026-09-18-act-two/`: memory lines 12, 13 and 20 said a booking for
Thursday 17 September 09:30 "still stands", and the claim reached today's approval card as a warning.
The owner delegated the decision. Claude corrected it the product's way, in chat, not in the file
(invariant 7). The bot wrote memory line 21 itself, with no computer step:

> Correction 2026-09-18: the 09:30-10:00 CET booking from the 2026-09-16 invitation was for
> Thursday, September 17, 2026, which has now passed. It no longer stands as an active booking. Do
> not list it as active or cite it as a warning on future approval cards; …

Lines 12, 13 and 20 still carry the old words; memory is a log, and the prompt tells the bot that
the latest line about the same thing tells its current state. Whether the next card stays free of
the claim is seen at the next booking. Pruning the old lines in the Skills tab before filming stays
the owner's option.

## Today's test booking, cancelled

The owner delegated the cancellation. At 07:50 UTC Claude cancelled the 11:00–11:30 booking as the host
in the owner's signed-in Cal.com (reason text: "Cancelled by the host."). Cal.com then showed "No
upcoming bookings".

The cancellation mail (UID 98, received 07:50:25) started `check-mail` by itself 50 s later, 31 s
after the computer had paused; the computer resumed within a second. Run `98f8aef9` read the mail,
wrote memory line 22 and proposed nothing:

> Cancelled on 2026-09-18: the booking on Friday, September 18, 2026, 11:00-11:30am CEST with
> Interviewer XY (Company A), from the invitation received 2026-09-18 08:34. Cal.com cancellation mail
> received 09:50, reason "Cancelled by the host." No active booking currently stands for this interview.

This is the doubt rule's "a mail cancels something in memory: record the change and do nothing new"
path, live on one mail, with no card and no loop (the five-mail case of 17 September is
`docs/evidence/2026-09-17-thinking-replay-funded/`).

## Secrets

The count-only scan ran again after the takeover: 783 files under `data/` plus this session's server
log. Mailbox password: 0 files. E2B key: 0. Anthropic key: 0. The positive control was true for each.
URL credential patterns in `data/bots/` and the server log: 0 files.

## Left in the real systems

- Cal.com: no upcoming booking. The bot's inbox: UIDs 94, 96 and 98, all read.
- The mailbox is signed in on the bot's computer. The bot's memory has 22 lines.
- The chat holds today's rehearsal messages, as before.

## Files

- One folder per run: `events.jsonl`, `closing-message.txt`, and `last.png` where the run used the screen.
- `memory-added.md`: memory lines 21 and 22 as the bot wrote them.
- `server-log.jsonl`: the server's log lines for the session.
