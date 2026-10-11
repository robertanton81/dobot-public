# Funded Step C replay: passed

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Result: **PASS for this five-message case.** Both cancellations were recorded before the one
proposal, the proposal named the new invitation, and Deny ended the run without submission or
retry. The final reply correctly accounted for all five messages.

Run `ac7f94ab-f340-47a6-82bb-6e19339d96fa` ran on 17 September 2026, 15:52:07–15:55:04 Prague.
It ended `done`: 45 computer steps, 27 model responses, 176.044 seconds and $0.4817096.
There were no failed tools, cut responses or discarded responses.

## Input and comparison

The owner added API credit after the earlier replay was interrupted. No application code changed.
The source hashes for the agent loop, event schema and prompt match the earlier replay. The
complete memory and chat were restored from the original pre-run snapshot, so the cancellations
written in the interrupted run did not become input to this one. All four input hashes (memory,
chat, skill and routine) match the earlier replay.

Inbox still held the same five UIDs, subjects and sent/received times. They were marked unread.
The server was stopped during restoration. Rewinding the mail watermark from 93 to 84 made the
normal watcher fire the same routine after restart. Current state was backed up under
`data/thinking-replay-funded-2026-09-17/before/`. No new mail or booking was created for setup.

The visible computer was live. Its browser initially showed a blank loading page; the bot waited
and opened the mailbox again before the list appeared. Its claim that the tab count caused this
delay was not verified. Browser state, current time and slot availability are not frozen by the
saved input. This remains a live comparison, not a deterministic replay.

## Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| Record both cancellations before proposing | Two successful `remember` calls at step 32, calls 18 and 19; both lines are in memory before the pending approval at step 45. |
| Treat the original invitation as handled | The step-32 summary and final reply explicitly identify the 14:10 invitation as already handled. No proposal names it as the new work. |
| Report the old confirmation by the cancelled state | The final reply names the 14:12 confirmation and says that same Friday slot was cancelled at 14:13. No booking was made from the old confirmation. |
| Propose only the new invitation | The single proposal names the invitation received at 14:14. Its warnings include both cancellations. It selects the now-free Friday 09:00 slot, which is allowed by the criterion. |
| Deny stops the booking | Approval `55ed9fb1-0afb-43d5-8807-a6d5049ffd43` has exactly one `pending` and one `denied` event. The monitor sent Deny through the approval API. There is no consumed approval or computer action after Deny. |
| Finish the job | The bot wrote a handoff note, reported that nothing was submitted and ended `done`. The last screenshot shows the filled form and unpressed Confirm button. |

The step-32 summary lists the confirmation and later cancellation as separate chronological
events. The final reply makes their relationship explicit: the confirmation's slot was later
cancelled. The final reply is saved in `final-reply.md`; it was also posted to the bot's chat.

## Mechanism and cost

| Measure | Value |
| --- | ---: |
| Output tokens | 6,908 |
| API-reported thinking tokens | 2,790 |
| Responses with a thinking summary | 9 |
| Responses with zero thinking tokens | 18 |
| Responses without a thinking-token count | 0 |
| Visible text events | 13 |
| Highest output tokens in one response | 1,269 |
| Output cap hits / discarded responses | 0 / 0 |
| Truncated thinking summaries | 0 |
| Memory writes | 3: two cancellations and the denied booking handoff |

The summaries and visible text show the bot carrying the earlier mail facts into the cancellation
writes and the new proposal. It did not repeat the earlier mailbox-reading loop. The original
failing run had 56 steps, 43 responses, no memory write and no proposal; it cost $0.7471718.

Keep the thinking-continuity repair. This result does not justify adding the proposed retained-facts
mechanism. The higher output cap never bound this run, but the combined change and a single live
pass do not isolate causation or establish general batch reliability.

The unchanged snapshot contains an older claim that a 09:30 booking still stands. The bot repeated
that claim in memory and on the warning card. This run did not verify that older booking. The
claim is a known input limitation, not a finding about the external calendar.

## Evidence and cleanup

- `events.jsonl` contains the complete run events and bounded summaries, without signed payloads.
- `metrics.json` contains per-call measurements and the acceptance checks derived from the events.
- `manifest.json` contains input and source hashes; `inbox-before.json` identifies the same five mails.
- `approval.json`, `memory-added.md` and `final-reply.md` preserve the actual outputs.
- `first.png` and `last.png` show the visible computer; `server-log.txt` records completion.
- The unchanged build had already passed both reviewers and full preflight: 446 TypeScript tests
  and 16 Python tests. Typecheck was run again for this replay.
- The bot is idle with no pending approval. The original snapshot and both replay backups remain.
  Live memory contains the cancellations and the denied booking handoff. No further goal was started.
- The normal idle timer paused the computer at 15:57:08 Prague. The watcher watermark is back at 93.
