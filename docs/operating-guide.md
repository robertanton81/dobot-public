# Operating guide

[Back to the README](../README.md)

Use this guide after the app starts. The README contains the basic installation steps.

## Use the example bot

The default example is **Homer**, a house-search coworker whose skill was learned through chat.
Follow the [README restore command](../README.md#example-bots), then select Homer.
No schedule or mail routine is included, so copying the folder does not start a task by itself.

The template includes a fresh preference memory and one learned skill.
It does not restore the original chat, completed-work history, email account or remote computer.
Its [template notes](../examples/homer/README.md) identify the portability changes and known sample
errors. The records of the original runs are not part of this public snapshot.

### Try the saved workflow

Homer's example preferences are houses for sale outside Prague, 5+1 or larger (clearly
labelled 5+kk is acceptable), within the skill's distance rules and with no price ceiling. Change
these in chat and ask him to update both memory and the skill before a new search. The distance
rule uses straight-line distance for nearer towns and road checks for the boundary band; it is
not a guarantee that every offer is within 50 km by road.

The example is limited to **at most two houses** to reduce costs. It stops searching once two
qualifying houses are saved and reports fewer if it cannot verify two. The original
workflow reported five houses.

For a new search, ask for one part at a time, then continue in chat when it finishes:

| Part | Work |
| --- | --- |
| A | Find at most two houses, preferably one per site, and save them. |
| B | Research the first town: population, hospital, schools, transport and sports clubs. |
| C | Research the second town, if present, and save a report of at most two houses with sources and unknowns. |
| D | Send the saved report through the bot's webmail after approval, only if requested. |

Parts A–C need no mailbox. For Part D, give Homer the webmail URL, a dedicated bot mailbox address
and your report address in chat. Enter the password only during takeover on the remote screen.
Sending a requested report through webmail does not require the IMAP watcher or SMTP notices
configured below.

The original six-candidate searches needed multiple runs and cost several dollars in model usage,
plus computer time. The cost of the reduced two-house workflow has not been measured. The last recorded search stopped with an incomplete shortlist. Skills improve
repeatability but do not guarantee current listings, factual accuracy or a lower price each time.
No new live search has been run for this portable template; its loading and boot recovery are
checked locally.

### Other examples and files

The older Hunter fixture (a job-hunt persona with enabled routines) is not part of this public snapshot.

For any bot, files to attach belong in `data/bots/<id>/workspace/`. The platform copies them onto
the computer before a run. Hunter can attach a CV but cannot read it; professional facts for
letters must be supplied in chat. Never test a real application by allowing its final submit
unless you intend to apply.

## Mail and attention notices

Mail features are optional. Configure them in `.env.local` and restart the server. Use a dedicated
bot mailbox. The platform can hold that account's credentials; the model does not receive them.
The user enters browser passwords during takeover on the remote screen.

### Start a routine when mail arrives

| Variable | Meaning | Default |
| --- | --- | --- |
| `MAILBOX_HOST` | Bot mailbox's IMAP server. | Unset |
| `MAILBOX_USER` | Bot mailbox login. Use the full email address if notices are enabled. | Unset |
| `MAILBOX_PASSWORD` | Bot mailbox password. Quote values containing `#` in the env file. | Unset |
| `MAILBOX_PORT` | IMAP port. | `993` |
| `MAILBOX_POLL_MS` | Time between checks, in milliseconds. | `60000` |

Set host, user and password together. With none configured, `mail-arrived` routines do not fire.
A partial configuration disables the watcher and logs the missing setting names.

The watcher reads inbox counts and message numbers, not message bodies. The bot reads messages
through webmail on its own screen. Tell it the webmail address and sign in during takeover.
Ask the bot to save a routine for incoming mail; creating a mailbox configuration alone does not
create that routine.

There is one watched mailbox per server, shared by all mail-triggered routines. Separate computers
do not isolate bots that you sign into the same external account. `mail-arrived` is the only
implemented event source. Mail runs are spaced at least five minutes apart; later arrivals wait
for the next eligible run.

### Notify you when the bot needs help

| Variable | Meaning | Default |
| --- | --- | --- |
| `NOTIFY_EMAIL` | Your address, different from the bot's mailbox. | Unset; notices off |
| `MAILBOX_SMTP_HOST` | Outgoing server for the same bot mailbox. | Unset |
| `MAILBOX_SMTP_PORT` | Outgoing port. | `465` |

Notices reuse `MAILBOX_USER` and `MAILBOX_PASSWORD`. The user value must be a full email address.
Incorrect notice settings disable notices rather than stopping the server.

A notice is sent when an approval or answer is needed, takeover is required, a run ends blocked,
or a new job is refused because you still hold the screen. The last case sends once per hold.
Notices contain fixed text and no task details or link. They are separate from reports the bot
composes and sends through webmail.

Each notice has one send attempt and no retry. "Unconfirmed" means the mail server did not confirm
delivery; the notice may still have arrived. Stop does not recall a sent notice. A daily-budget
refusal sends no notice. Models cannot change the notice recipient.

## Connectors

A connector lets a bot use a service without its computer, which costs less and is faster. The
bot asks for one in the chat with a **Connect** card; click **Connect** or **Not now**. Every call
that changes something outside (a booking, a sent mail) stops at an approval card with its full
arguments, whatever `approval-rules.json` says.

| Connector | What it does | What the operator sets |
| --- | --- | --- |
| `wikipedia` | Article text and coordinates. On for every bot, no card. | Nothing. |
| `mapy` | Place coordinates, road distance and travel time. | `MAPY_API_KEY` (free tier at developer.mapy.com). Without it the connector is not offered. |
| `calcom-public` | Free times on a public Cal.com page, and a booking on it. | Nothing. |
| `bot-mailbox` | Reads the bot's mail as text and sends a mail. | The mailbox settings above, and `MAILBOX_BOT_ID`: the one bot that may use it. |

The server's boot log line `connectors ready` says which of these are on and why the others are
off. A bot's connections are stored in `data/bots/<id>/connections.json`; they hold no key and no
token. To remove a connection until the page has a Disconnect button, stop the server and delete
that bot's entry from the file. This is an operator shortcut; the in-product path (a Disconnect
button, and asking the bot in chat) comes with the next milestone.

## Other settings

Keep the supplied `.env.example` defaults unless you need a change. Variables already present in
the shell take precedence over `.env.local`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_ID` | `claude-sonnet-5` | Model used for every bot. The adapter uses the Claude 5 computer-use and adaptive-thinking interface; it is not a generic model router. The cost table knows `claude-sonnet-5` and `claude-opus-5`, also in a dated form; any other id is counted at the dearest known price, so the daily budget can end a day earlier than the real spend would. |
| `TZ` | `Europe/Prague` | Schedules, the bot's clock and daily budget boundary. |
| `PORT` | `3000` | API and built-app port. Vite uses `5173` in development. |
| `DATA_DIR` | `data/bots` | Bot folders. |
| `E2B_DOMAIN` | Unset | Default E2B cluster; use the matching domain and key for a custom cluster. |
| `DAILY_BUDGET_USD` | `25` | Daily model budget across all bots, in whole dollars. `0` prevents all runs. |
| `ROUTINE_MIN_INTERVAL_MINUTES` | `15` | Minimum interval for saved schedules. |
| `BLOCKED_HOLD_MINUTES` | `30` | How long to keep a blocked computer awake for a person, extended while its screen is open. |

The daily budget counts recorded model costs for runs started that day in `TZ`. It is checked
before each run, does not stop a running task, and excludes computer costs. Concurrent starts can
both pass the check. Schedule spacing is validated when a routine is saved through the platform;
hand-edited files bypass that validation.

For a custom E2B cluster, obtain its project key and domain from E2B. Existing computers cannot
move between clusters; use the rebuild procedure below. Changing `TZ` restarts the browser once:
open tabs are lost, but the browser profile keeps logins.

## Screen controls and approvals

The roster selects a bot. Chat holds goals, answers, artifacts and approval cards. The preview
shows the live desktop. **Skills** exposes memory, skills and routines; approval rules are read-only.
**Runs** shows the persisted event history, including actions, results and screenshots. It updates
while a run is active, but its shortened text is not a full model-request replay.

- **Allow once / Deny:** the model proposes an action; browser-control checks also catch actions
  it did not announce. An approval covers one control on one origin and path for up to ten steps,
  and is consumed for one activation. The control is checked again after Allow.
- **Repeated activation:** a double click, held Enter or repeated newline cannot reuse one approval.
  Unknown targets and controls inside unreadable frames require approval. Harmless buttons may
  also trigger a card. There is no Always allow button; standing rules are operator-managed in
  `approval-rules.json`, and a require-approval rule takes precedence.
- **Take over / Hand back:** the person controls the remote screen while the model waits. Passwords
  and human checks are entered there, not in chat. A new goal during an idle takeover must pass
  the same hand-back check before the bot can use the computer. When it passes, the page takes
  the screen back at once and says so in one line.
- **Stop:** ends the active job; queued goals keep their turn. A pending approval is denied.
  During takeover, use Hand back first because the page does not show Stop in that mode. An action
  already in flight may finish before Stop takes effect.

Hand-back checks password and code fields in the page, same-origin frames and open shadow roots.
For a secret-related takeover it also requires a page change. **Hand back anyway** can waive the
page-change check, but cannot waive a populated secret field or unreadable focused frame. The
override is logged. A sign-in whose URL, title and input count never change may need this override.
On an unchanged page, the override also refuses any unreadable region, even when focus is
elsewhere. Move past that page before handing back.

The guard cannot inspect closed shadow roots or cross-origin frames. Leaving an unsubmitted
secret in such a frame, moving focus outside it and changing the page can evade the check. After a
blocked computer has slept, or the server has restarted, the next goal does not retain the same
hand-back requirement. These are known limits, not guarantees that every screenshot is secret-free.
Approval controls also do not prevent all prompt injection or false statements in generated text.

## Saved state and recovery

`data/bots/<id>/` holds identity, memory, skills, routines, approval rules, chat, run history,
artifacts and workspace files. `examples/` holds templates; changes to a live bot do not change
the template. `data/` is excluded from Git and must be backed up separately if you need it.

The workspace is copied to the remote computer before each run. New and replaced files are
uploaded; deleting a local file does not remove its older remote copy until the computer is rebuilt.
Files created only on the remote computer and its login sessions are not a backup in `data/`.

An idle computer normally pauses two minutes after its last run and resumes for the next goal.
A visible takeover screen keeps it awake. An idle takeover is released on Hand back or about a
minute after the page stops checking its state. Close the page when you finish.

On normal server shutdown, new work stops and unheld computers are paused. Computers still in
use are left to their own timeout. After a crash or interrupted run, boot recovery closes open
runs and pending cards. It reports uncertainty if an approved action may already have happened.
The next goal reconnects the screen; reload the page if its event stream has not reconnected.
The previous run does not resume from its interrupted step.

### Rebuilding the bot's computer by hand

This is an operator recovery step, not a chat capability. Stop the server first. In
`data/bots/<id>/bot.json`, set `sandboxId` to `null`, then restart the server. The next goal creates
a new computer and uploads the workspace. Memory and saved artifacts remain; sign in again on
the new computer. This reset does not delete the previous remote computer.

A computer reported missing by E2B is rebuilt automatically through the same path.

### Mail recovery

The watcher stores its message position beside the bot folders, normally in
`data/mail-watermark.json`. With stable message numbers, mail that arrived while the server was
down can trigger work after restart if it is still in the inbox.

| Run result | What happens to the mail event |
| --- | --- |
| Completed, Stop or Deny | Acknowledged; no automatic retry of that event. |
| Blocked, stuck or budget limit | Acknowledged; needs a chat follow-up or another mail after resolution. |
| Failed, unknown or missing result | Left pending and retried after the five-minute spacing or at the next boot. After three failed runs in a row the event is acknowledged, and the routine's last result says so. The count starts again after a restart. |
| Failed with no use in a retry (the provider or the model refused, the context is full, the answer was cut off twice) | Acknowledged at once. |

Each routine saves its own acknowledgement so a failed listener does not repeat a completed one.
Failed acknowledgement writes are retried without rerunning the routine while the process lives.
A crash between doing the work and saving that record can still repeat partial work. Skills must
identify completed work in memory, and new irreversible actions still require approval.
The unseen-count fallback on servers without message numbers cannot provide the same restart or
per-routine acknowledgement guarantees. Connection errors close the IMAP client and retry later.

## Runtime limits and troubleshooting

- **Slow or repeated work:** a run is limited to 150 computer steps and 200 model calls. The model
  receives a warning with 15 computer steps left. A progress guard warns at 16 and 28 steps without
  new activity or a saved result, then ends the run at 40. An additional screenshot guard stops
  an unchanged screen after at least three screenshots and 30 seconds with only waits between them.
  These heuristics can stop legitimate slow work. `wait` and `hold_key` calls are capped at ten seconds.
- **A computer action times out:** a fresh screenshot lets the bot check what happened. Two
  consecutive action failures, or an unresponsive companion, end the run. An approval for an
  uncertain action is spent. Check whether it completed before asking for another attempt.
- **Model calls stall:** the adapter times out a stream that stops making progress. Two documented
  SDK edge cases remain: Stop waits for an SDK retry delay to end, and an unfinished error-response
  body may require Stop because it falls outside the timers. See the
  [lifecycle review](evidence/2026-09-17-model-lifecycle-review/README.md).
- **Provider rejects a request:** check credit, account limits and key configuration. The chat
  names the cause in fixed words: a key that was not accepted or has no permission, too little credit, a reached usage
  limit or spend cap, or a model the key cannot use. This holds whether the refusal comes as an
  HTTP error or as an error event inside an open stream. A busy provider, a rate limit and a
  conversation that grew too large keep the advice to send the goal again. The stream case is
  proven by tests through the real SDK and was not seen live after the fix; see the
  [refusal record](evidence/2026-09-20-provider-refusal-in-stream/README.md).
- **A connection fails:** the server log names the causes of an error by name and code
  (`errorCauses`), so a refused connection can be told from a name that does not resolve. The log
  never holds the text of a cause.
- **Cloud login is challenged:** complete the human check through takeover. The bot must not solve it.
- **Network hosting:** unsupported. Servers bind to loopback and reject outside Host/Origin and
  cross-site requests. There is no login; local programs still have access. Hosting requires
  authentication and an explicit origin policy.

Run outcomes are `done`, `failed`, `stuck`, `budget`, `denied`, `cancelled`, `blocked` and `unknown`.
`done` means the model ended its run, not that the output passed an independent quality check.
`denied` is a run that failed after the user denied one of its actions; its summary names the
failure. A run that goes on after a Deny and ends its turn is `done`.

## Development reference

```bash
pnpm typecheck
pnpm test
pnpm preflight
pnpm day-one create <scheduling-page-url> <application-form-url> <cv.pdf>
```

The last command creates a real remote computer and incurs provider costs. Preflight runs the
TypeScript and Python tests and checks that bot-specific instructions and project history do not
enter platform code.

| Code | Responsibility |
| --- | --- |
| `src/server/index.ts` | Configuration, boot recovery, wiring and server startup. |
| `src/server/store/` | Bot folders, records and artifacts. |
| `src/server/agent/` | Model calls, tool execution, approval, takeover and run limits. |
| `src/server/sandbox/` | Create, connect, pause and rebuild remote computers. |
| `src/server/companion/` | Browser inspection and file attachment inside the computer. |
| `src/server/scheduler/`, `src/server/mail/` | Scheduled and mail-triggered work; attention notices. |
| `src/web/` | Roster, chat, screen, Skills and Runs views. |

Architecture choices and their upgrade paths are in [decisions.md](decisions.md).
