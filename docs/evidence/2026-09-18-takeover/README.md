# Takeover on the current code, 18 September 2026: the mailbox sign-in scene

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Result: **PASS.** The bot met the signed-out mailbox, asked for a takeover after one screenshot,
and waited. The owner signed in on the bot's screen. The server refused every hand-back while the
page was unchanged or the password was still in its field. After the hand-back the run continued
and ended `done`. The mailbox password is in no file of the platform.

This is the demo script's takeover scene (platform spec, demo steps 10–11). The sign-in scene was
last seen live on 14 September. The later live takeovers were a reCAPTCHA on 16 September and a
booking by hand on the morning of 17 September. All of them came before the idle-takeover hold
(`ed727f6`), the streamed model call and the stop-signal check in the takeover wait (`b52efca`);
the sign-in scene also came before the blocked-bot hand-back check (`11c7ab2`). No
`handback-refused` event existed in any saved run before today, so the plan's criterion 9 had not
been seen live. No code or instruction changed for this check.

## Who did what

| Step | Who | How |
| --- | --- | --- |
| Sign the mailbox out | the bot, on Claude's goal | run `d0baf06c`, a typed goal through the API |
| Start the scene | Claude | run `af0f8a48`: the `check-mail` routine's own text, typed as a goal |
| Probe the hand-back check | Claude | `GET /takeover/state` and `POST /takeover/handback` through the API, three times |
| Type the password, sign in, press Hand back | The owner | on the bot's screen, in his own browser |
| Verify, scan, record | Claude | event log, server log, count-only secret scan |

While the owner had the screen, Claude read only the event log and the API's state answer. Claude took
no screenshot and read no page in that time.

## Timeline (UTC; Prague is UTC+2)

| Time | Event |
| --- | --- |
| 06:55:18 | Server boot through a temporary launch entry that also wrote the log to a file. No missed run fired. |
| 06:55:39–06:56:13 | Run `d0baf06c`: the bot signed the mailbox out. 13 steps, 9 calls, `done`. Last screenshot: Seznam's account chooser, the account locked. |
| 06:56:48 | Run `af0f8a48` queued with the `check-mail` text. |
| 06:57:01 | Step 1 was one screenshot. Then `request_takeover`: event `takeover started`, reason `requested`, bot state `blocked`, the takeover card in the chat. |
| 06:57:09 | Probe 1, before any human action: state `unchanged`, hand-back HTTP 409, event `handback-refused` ("the page has not changed yet"). |
| 07:11:40 | Probe 2, the password typed but not sent: state `unsafe` with and without `force`; hand-back HTTP 409 with and without `force`; two `handback-refused` events ("a password or code field still has a value on screen"). |
| 07:12:32 | The owner signed in and pressed Hand back: `takeover ended`, "handed back". |
| 07:12:34 | Step 2: the first screenshot after the hand-back shows the inbox (`af0f8a48-…/after-handback.png`). |
| 07:12:48 | Run ended `done` after 3 steps: nothing new in the inbox, nothing to act on. |
| 07:14:54 | The computer paused by itself, 2 min 6 s after the run ended. |

## Criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| The bot asks for a takeover and types nothing into the login | PASS | one `screenshot` step, then `takeover started` with `requested`; no `type` or `key` action in the run |
| The loop is paused while the human has the screen | PASS | 06:57:01–07:12:32: the only events are the three `handback-refused` probes; no `step`, no `cost`, no screenshot file |
| Hand-back is refused while the page has not changed (plan criterion 9) | PASS | probe 1: code `unchanged`, HTTP 409, the event |
| Hand-back is refused while a password field holds a value, and "Hand back anyway" does not lift it (plan criterion 9) | PASS | probe 2: code `unsafe` with and without `force`, HTTP 409 twice, two events |
| Hand-back is allowed after the sign-in, and the run continues with a fresh screenshot | PASS | `takeover ended` "handed back"; step 2 two seconds later; `end: done` |
| The computer stays awake under the human's hands | PASS | `server-log.jsonl`: no pause between 06:55:39 and 07:14:54; the takeover lasted 15 min 31 s |
| The secret reaches no chat line, event, log or file (plan criterion 3, invariant 5) | PASS | count-only scan below |

**The scan.** A script loaded `.env.local`, searched 774 files under `data/` plus the server log for
each configured secret value, and printed counts only. Mailbox password: 0 files. E2B key: 0.
Anthropic key: 0. The positive control was true for each value: the scan finds the value in
`.env.local` itself. URL credential patterns (`password=`, `vnc.html?`, `autoconnect`,
`access_token`) in `data/bots/` and the server log: 0 files. The same scan over this folder: 0.

The plan's criterion 3 asks for a marker typed during the takeover. The marker was dropped during
the run (finding T1) and replaced by the scan for the real password. The scan is stronger in one way:
it uses the real secret. It is weaker in another: it covers only values the platform's own
configuration knows, so it would miss a user's secret.

## Cost

| Run | Why | Steps | Model calls | Cost |
| --- | --- | --- | --- | --- |
| `d0baf06c` | sign the mailbox out | 13 | 9 | $0.1710 |
| `af0f8a48` | the takeover scene | 3 | 6 | $0.0990 |
| **Total** | | | | **$0.2700** |

The owner's hands: two short actions (type the password; sign in and press Hand back). The takeover
stayed open for 15 min 31 s because of finding T1, not because of the product.

## Findings

**T1. Claude's first instructions were wrong and too long.** Claude told the owner to press **Take
over**. The page needs no click when the bot asks for the takeover: the card reads "Your turn on the
screen" and the panel switches to the interactive stream by itself (`src/web/App.tsx:125`). The
README says this correctly (step 5 of its walk-through). The platform spec's demo step 11 still says
"The user clicks Take over". Claude also mixed a test marker into the step, and the owner said the
instruction confused him. The simpler instruction worked at once. Nothing in the product caused this.

**T2. The bot's final message claims the sign-in.** It says "I signed back into the mailbox". The owner
signed in; the bot only asked. The tool result the model received says "the human handed the screen
back". On camera this sentence could appear after the takeover scene. A fix would be one sentence in
the prompt or the reply skill; whether to change wording on freeze day is the owner's decision.

**T3. The first screenshot after the computer resumed was black again.** Run `d0baf06c`'s first
screenshot is black, like act two's run `c1f0ddb8` and act one's run `b21a8f60` today. The bot took
a second screenshot each time. It costs one step per run that starts on a paused computer.

**T4. The chat now holds rehearsal text.** The setup goal, the takeover card and the final message
mention a "takeover rehearsal". The chat was already not clean for filming; this adds to it.

## What this check does not prove

- Stop during a takeover on the current code. `b52efca` covers it with tests; it was not pressed live.
- The secret guard (`secret-field`). The bot asked through `request_takeover` before it typed
  anything, so the guard had nothing to block.
- A takeover on an idle bot (`ed727f6`), and a human check such as a CAPTCHA. Neither appeared today.
- A second sign-in challenge by Seznam. The owner reported none; the sign-in took under a minute.

## Left in the real systems

- The mailbox is signed in again on the bot's computer. The first screenshot after the hand-back
  shows one open tab; the screenshot before the takeover showed about thirty.
- The bot's memory is unchanged (20 lines). The inbox still holds UIDs 94 and 96, both read.
- The server is stopped, and the temporary launch entry is removed from `.claude/launch.json`.

## Files

- `af0f8a48-…/`: the takeover run's events, its first and last screenshots, and `after-handback.png`.
- `d0baf06c-…/`: the sign-out run's events and its first and last screenshots.
- `takeover-card.json`: the card as the chat stored it, after it ended.
- `summary-takeover-run.txt`, `summary-signout-run.txt`: each run's final chat message in full.
- `server-log.jsonl`: the server's log lines for the session.
