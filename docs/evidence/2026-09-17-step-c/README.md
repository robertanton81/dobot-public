# Step C with five fresh messages and model text retained

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Result: **FAIL** for Step C. **PASS** for the progress guard ending this observed loop.

Run `c5dd5468-352c-4b14-8d96-60841edf83c6` ran on commit `cf1478a` on 17 September 2026,
14:15:16–14:20:11 Prague time (12:15:16–12:20:11 UTC). It ended `stuck` after 56 computer
steps and 43 model calls. Duration: 294.371 seconds. Estimated model cost: $0.7471718.
There were no failed tool results, no `remember` calls and no approval events.

## Setup

The original emails were absent from Inbox, Archive and Trash. The owner authorized rebuilding the
test with fresh invitations and real test bookings and cancellations. The mail routine was disabled
during preparation and restored before the final invitation arrived. Its text and the reply skill
were byte-for-byte identical to the versions saved before preparation. No prompt or code changed.

Two setup runs booked real slots through approval on the owned Cal.com page:

| Setup run | Booking | Steps | Estimated cost |
| --- | --- | --- | --- |
| `e2c49aee-00bc-4cd0-93e6-387ed1ee751f` | Thu 17 September, 16:30–17:00 CEST, requested directly | 40 | $0.2695616 |
| `952674f2-40ad-4752-b4fa-91ed3108c10a` | Fri 18 September, 09:00–09:30 CEST, from the 14:10 invitation | 23 | $0.2416617 |

Both bookings were cancelled through the host account. The host's Upcoming page then showed no
bookings. The confirmation of the directly requested booking was moved to Archive. The four
remaining messages were marked unread. One final invitation was sent from the dev Gmail account.
The mail watcher started the unmodified `check-mail` routine with exactly five unread messages:

| Received time, Prague | Message | Required treatment |
| --- | --- | --- |
| 14:10 | Original invitation | Already handled, because the booking note identifies its subject and time |
| 14:12 | Confirmation of Friday 09:00 | Report cancelled after reading the cancellation |
| 14:12 | Cancellation of Thursday 16:30 | Record before proposing anything |
| 14:13 | Cancellation of Friday 09:00 | Record before proposing anything |
| 14:14 | New invitation | Propose one slot, with cancellations as warnings; deny the proposal |

The inbox was not changed during the run. No proposal appeared, so there was nothing to deny.
The total estimated model cost, including setup, was $1.2583951.

## What the retained text shows

| Step after which text was emitted | Observation |
| --- | --- |
| 7 | The model matched the Friday confirmation to the booking from the 14:10 invitation. |
| 10 | It identified Friday's cancellation and its 14:13 received time. |
| 23 | It said it needed the inbox list and exact timestamps again. |
| 38 | It identified Thursday's cancellation and said it would check Friday's cancellation next. |
| 51 | It identified Friday's cancellation again and said it would check the 14:14 invitation next. |
| 56 | The platform ended the run as stuck. |

Both cancellations were recognized in emitted text. The model still reopened messages and never
recorded the changes or proposed a slot. This supports the need to track processed messages and
retained facts. It does not establish that screenshot pruning, skill wording or one other factor
alone caused the failure. The model's private reasoning was not recorded.

Replaying the logged actions through the actual `ProgressGuard` produces notices at steps 32 and
44, and a stop at 56. The live `end` event confirms that stop. Notice text is added to tool results
sent to the model, but is not itself persisted in the current event log; notice timing is therefore
derived from the code and action replay, not a direct notice event.

## Limits of the comparison

This is a fresh five-message reproduction, not an exact replay of the morning input. Slot times,
message times and recent conversation differ. The setup notes repeat an old claim that a 09:30
booking still stands; that claim came from existing conversation context and was not verified here.
The booking-memory excerpt preserves it rather than silently correcting the experiment's input.
Neither extra resends during the run nor a change to the routine instruction explains this failure.

The memory file was unchanged across Step C. The two setup bookings are cancelled in the real
system, but their cancellation notes are still missing from the bot's memory. Keep this distinction
when preparing any later run. A retained-facts mechanism remains a candidate fix, not a verified fix.

## Evidence and cleanup

- `events.jsonl`: full Step C events, including five model-text events.
- `inbox-before.json`: five actual IMAP envelopes and their unread flags, captured at the start.
- `first.png` and `last.png`: first and final remote-computer screenshots.
- `memory-before.md`: booking-memory excerpt. Full memory and recent chat are saved locally under
  `data/step-c-2026-09-17/pre-run/`, which is git-ignored.
- `skill-before.md`, `routine.md`, `manifest.json`: the instructions and input fingerprints.
- Preflight passed: 438 TypeScript tests and 16 Python companion tests. The first restricted run
  failed only because three process tests could not use `pgrep`; the unrestricted rerun passed.
- The ended run's takeover was released. No further goal was started. The screen-access password
  exposed by browser accessibility output during observation was replaced through the existing
  sandbox reconnect path. A value-free comparison confirmed that the key changed. The remote
  computer was then paused. No key value is recorded in this evidence directory.
