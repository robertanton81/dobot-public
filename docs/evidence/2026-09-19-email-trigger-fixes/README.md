# Email trigger fixes — 19 September 2026

The owner requested fixes for the two defects reproduced by the email-trigger review on commit
`abdf47f`. This record covers the platform only. The remaining live reply-skill checks keep their
own status in `../2026-09-18-shortlist-and-notices/README.md`.

## Causes

1. `ImapMailbox` creates an ImapFlow client without an `error` listener. A socket error after
   connection is an asynchronous event, outside the catch around the reading. The reproduction
   ends the process with `Unhandled 'error' event`.
2. `Scheduler.fireEvent` resolves after a failed run because `runRoutine` discards the outcome
   and `fire` catches every rejection. The watcher advances its saved message number even when
   the remote computer never started. A later poll or restart then sees nothing to retry.

## State table, written before implementation

| State | Mail reading | Event delivery |
| --- | --- | --- |
| Success | Read INBOX without changing flags; release its lock; log out. | A completed run acknowledges the reading. |
| Failure | Handle connection error events; close the client; reject the reading without exposing the server's error text. Leave the saved message number unchanged. | A failed, unknown, missing, or rejected run result leaves delivery pending. A skill missing from disk or an exception while loading the routine also leaves it pending. |
| Timeout | The existing connection, greeting and socket timeouts close the connection and fail the reading. | Model failures follow the failed-run rule. Approval and question waits keep their existing behavior. |
| Stop or Deny | Stopping the watcher prevents future scheduled polls. It does not cancel an already running read. | `cancelled` and `denied` acknowledge the event so an automatic retry cannot undo the user's decision. |
| Human intervention or limit | Not applicable to reading. | `blocked`, `stuck`, and `budget` acknowledge the event and require the existing user follow-up. They do not start an automatic loop around a human hold or a spending limit. |
| Retry | A fresh client reads again on the next poll. | Failed delivery is retried after the existing five-minute debounce. A pending run is awaited, not treated as successful merely because it already exists. No listener or an explicitly disabled/deleted routine consumes the event. |
| Partial result | An interrupted read delivers no partial status. An error during logout also fails the reading. | A failed run can have done some work. Retrying starts a new run with persisted memory and fresh approvals; the skill must identify work already done. Each routine persists its acknowledgement in a separate file, so another listener's failure cannot repeat a completed run or undo Stop or Deny. |
| Restart | The next process uses a fresh client. | A failed delivery leaves the saved number behind, so the next boot retries if that mail is still represented in INBOX. Completed and deliberately stopped deliveries stay acknowledged. |

The acknowledgement of `blocked`, `stuck`, and `budget` preserves existing behavior. It means
these outcomes need a chat follow-up or another mail; they are not a promise of automatic
completion after the human acts or the budget resets. This limit must be stated in the README.

The event API will return a delivery acknowledgement separately from promise settlement.
The watcher will keep its exception catch for other event handlers, but production retries must
not depend on an exception that the scheduler intentionally catches.

## Library evidence

- Installed `imapflow` 1.7.8: `emitError` emits `error` after connection; its socket handlers use
  this method. `close` tears down the socket and rejects pending commands.
- [ImapFlow error events](https://imapflow.com/docs/api/imapflow-client/#event-error), checked in
  the review: connection errors have a separate event handler.
- No dependency change is needed.

## Verification record

### Connection errors

The new tests use the installed ImapFlow library against a local TCP mail server. The peer
starts authenticated without credentials and deliberately stops answering STATUS or LOGOUT.
The actual socket watchdog then exercises the error-event path. No production mailbox is used.

The first fixture attempt lacked the library's LSUB response. Adding that protocol response
made the normal connection pass. Before the source fix, the completed fixture produced three
uncaught `Socket timeout` errors, and the logout-timeout test incorrectly received a successful
reading. After the fix, typecheck and all 37 watcher tests passed with no uncaught error.

On a failed command the client now closes immediately, rather than attempting a graceful
logout on the failed connection. Three older test assertions were updated for that intentional
cleanup change. A successful reading still logs out. The event listener stays on the discarded
client to consume errors that arrive during its teardown. Server error messages are not logged.

Both the code reviewer and the test-quality reviewer requested a regression check for the log
filter. It now injects a synthetic private-text marker and checks that the warning contains only
the error class, never the marker. Both reviewers passed after this addition; 38 watcher tests
passed. The older test title saying a failed read logs out was also corrected.

### Delivery acknowledgement

The new integration suite joins the real scheduler, watcher, store, and saved-message-number
file. Only the external run result and mailbox readings are controlled. The completed fixture
failed 11 cases before the fix and passed seven existing-behavior controls. The missing-skill
case removes the saved skill after the routine is armed, then restores it before retrying.

After the fix, typecheck and all 66 scheduler, watcher, and delivery tests passed. The new cases
cover every run outcome, rejected and missing results, retry timing, failure before restart,
missing skill, routine read errors, a disabled routine, shared pending runs, and several listeners
with different results. The timer callback still returns `Promise<void>` as Cron requires.

The old overlap test now awaits both triggers after releasing the shared run. A second trigger
no longer resolves early: it reports the result of the run already in progress.

### Review corrections, before implementation

The second review found two Stop cases that the first state table did not fully cover:

- A startup or runner-plumbing failure after Stop still returns `failed`. The runner must record
  and return `cancelled` when its stop signal has already been aborted.
- One stopped listener and one failed listener cannot share a single acknowledgement. Each
  routine now needs its own durable receipt: event name, mailbox generation, and highest observed
  message position. The scheduler skips a routine whose receipt covers this reading, including
  after a restart or after inbox cleanup lowers the current position. A higher position or a new
  mailbox generation is a new event. Without message identifiers, the existing count fallback
  cannot provide this guarantee across restarts.

Receipts live in separate per-routine files in the bot folder. They do not share `bot.json` with
concurrent status writes. A routine's own in-flight guard serializes its receipt writes. A crash
between the run ending and its receipt being saved can still repeat work; this is at-least-once
delivery, not exactly-once execution.

The test review also found that malformed routine files return null like missing files. A strict
read when an armed routine fires must distinguish malformed content (retry) from a deliberately
deleted file (consume). Normal UI listing keeps its existing skip-invalid-file behavior.

The next review found two remaining asynchronous cases. Stop accepted during failure reporting
must also return `cancelled`; checking only when the catch begins is too early. Each failed-result
return therefore checks Stop after its last awaited write. An acknowledged event whose receipt
write fails stays in memory, and later polls retry that write before dispatching the routine.
The documented restart-before-save limit remains, but a write failure in a running process must
not override Stop or Deny. The mixed-listener tests must identify each routine, rather than just
counting the total runs.

### Correction verification

- The malformed-file, mixed-listener, and early-Stop cases failed nine tests before their fixes.
  After the fixes, 171 focused tests passed. Malformed content uses an actual routine file that
  is corrupted and then repaired; explicit deletion remains a consumed event.
- Stop during startup, storage, or model failure reporting also failed before the final return
  checks. Both cancelled and denied listeners ran twice after a receipt-write failure before
  pending acknowledgements were retained in memory. All five cases now pass.
- The mixed-listener tests script results by routine name. They prove the acknowledged routine
  runs once while the failed routine runs three times, including after a scheduler restart.
- The startup Stop test uses the real runner, queue, scheduler, watcher, and watermark file.
  It proves no retry after the five-minute interval or a watcher restart. External computer
  startup is controlled so Stop lands before its failure.
- Receipts survive scheduler restart. Equal or lower message positions skip acknowledged work;
  higher positions and new mailbox generations dispatch again. A receipt that fails to save
  stays pending; restart before a successful save retains the documented possible-repeat limit.
- The latest focused run passed typecheck and 106 runner, delivery, and scheduler tests.

### Final result

The code reviewer and test-quality reviewer both passed the final changes. The code reviewer
also reran the failure-reporting race independently: Stop was accepted and the result was
`cancelled`. The timer-occurrence comment now distinguishes timers from event delivery.

Full `pnpm preflight` passed: typecheck, 617 TypeScript tests in 33 files, 16 Python tests, and
the platform-boundary checks. `git diff --check` passed. The first full run inside the sandbox
was blocked from opening local TCP listeners and inspecting processes; the complete run passed
outside that sandbox. The final local log is `/tmp/dobot-email-fixes-preflight.log`.

The automated tests above changed no live mailbox, provider, or bot workspace. The owner then
requested a live mailbox check: it passed with a harmless Gmail probe, an isolated test bot,
the real model and remote computer, failure recovery, and a restart check. See
[the live test record](live-test.md) and [machine-readable results](live-result.json).
Hunter's files stayed unchanged, and no application or booking was made. The remaining
reply-skill live checks are unchanged. Changes are in the working tree; this fix did not create
a commit.
