# Live mailbox trigger check

The owner requested a live mailbox test with no real application or similar external action.

## Planned boundaries and states

Hunter stays stopped. Its existing mail routine can resume unfinished applications even for an
unrelated new message, so it is not armed for this test. A separate bot folder, a fresh remote
computer, and one chat-only acknowledgement routine use the unchanged production server.
The test has no job skills, memory, attachments, mailbox browser login, or notification sender.
Approval rules remain require-all; no approval will be allowed. The IMAP reader still uses the
configured real mailbox. The test message goes from the owner's signed-in Gmail to the bot mailbox.

| State | Expected result |
| --- | --- |
| Baseline | Read the real inbox and save its current position, without starting a run. |
| Mail arrives | Remove only the temporary test skill after arming, then send one harmless test message. The missing skill must leave the watermark unchanged. |
| Retry after restart | Restore the temporary skill and restart the isolated server. The same mail must start a real model run and end with a chat acknowledgement. |
| Success | Persist the event receipt and watermark. The run has no side-effecting tool calls. |
| Second restart | The acknowledged email must not start another run. |
| Failure or timeout | Stop the isolated server, retain evidence, and report the actual failure. Never compensate with an application, booking, or outgoing bot mail. |
| Cleanup | Pause the temporary computer, stop the test server, and archive only the identified test message. Compare Hunter's folder to its original file hashes. |

## Result: passed

One email was sent through the owner's existing Gmail session to the configured bot mailbox.
Subject: `Dobot trigger test 20260919-2303`. The body asked for a chat acknowledgement only and
explicitly forbade emails, forms, applications, bookings, and continuing earlier work.
The received message's sender matched the configured operator address. No address or credential
is stored in this evidence. The test used the production server entry point and current source;
only its data directory, port, ten-second poll interval, and disabled notice sender differed.

| Time (UTC) | Observed result |
| --- | --- |
| 21:02:48 | The real INBOX was empty. The test watermark was generation `1`, position `1`. |
| 21:03:41 | The watcher detected the message. The scheduler found the deliberately missing test skill and returned a failed delivery. The watermark stayed at `1`; no model run started. |
| 21:05:26 | After restoring the skill and restarting, the watcher detected position `159` above the saved `1` and dispatched the same pending event. |
| 21:05:31 | E2B created the temporary bot's real remote computer. |
| 21:05:43 | Run `108b3a5e-a732-41c8-9907-fb59b59ca708` ended `done`, with one real model response and zero tool calls or computer actions. The chat acknowledgement was visible on the Dobot page. |
| 21:06:54–21:07:31 | A second restart and more than three polling intervals produced no second run. The mailbox still contained the unread test message. |
| Cleanup | Only test message UID `158` was marked read and moved to Archive. INBOX returned to zero unseen messages and position `1`. The temporary sandbox was confirmed paused; both server ports were closed. |

The routine receipt and test watermark both saved generation `1`, position `159`. The real model
call cost `$0.0245215`. The response was:

> Got it — I can confirm a new mail arrived in the mailbox that triggered this routine, at 23:05 on Saturday, 19 September 2026 (Europe/Prague). No further action was needed or taken; this acknowledgement completes the task.

File hashes of all 1,131 files in Hunter's folder matched the before-test snapshot. No application,
booking, or outgoing bot message was made. The sole sent message was the authorized Gmail probe.
The isolated data and scripts remain under `.local/live-mailbox-test-20260919/` for inspection.

Machine-readable evidence: [live-result.json](live-result.json). Final preflight passed typecheck,
617 TypeScript tests, 16 Python tests, and the platform-boundary checks. Local test log:
`/tmp/dobot-email-live-preflight.log`.

This proves a real email from the owner reaches the trigger, a failed dispatch stays pending,
restart retries it successfully, and acknowledged mail does not run again on restart. It does
not retest Hunter's application-selection or booking skills, the five-minute in-process retry,
or a real provider outage. Those retry and connection-error cases have automated coverage in
the accompanying fix record.
