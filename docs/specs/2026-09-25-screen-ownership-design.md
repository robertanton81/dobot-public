# Screen Ownership Design Spec

**Date:** 2026-09-25
**Status:** Approved (the owner, 2026-09-25)
**TODO items:** the private backlog section 4, "Screen safety across restart and old interactive URLs
(architecture review finding 2)"
**Scope:** `src/server/agent/runner.ts`, `src/server/http/app.ts` (the stream and hand-back
routes), `src/server/sandbox/` (the stream and a new input switch), `src/server/store/` (one field on
`bot.json`), `src/server/agent/recovery.ts` (reads, never clears, the new field). The page changes
only where it fetches the interactive stream again after a resume.

## Problem

The [architecture review](../evidence/2026-09-25-architecture-review/README.md) (finding 2) found
two gaps in who controls the bot's screen. Both were checked against the code on 2026-09-25.

**(a) The screen check is lost.** Before a goal takes a screen that a human had, the runner checks
the page: no secret field with a value, no unreadable frame in focus (`safeWithoutRun`,
`runner.ts:357`). It knows a human had the screen only from two in-memory maps, `blockedKeepAlives`
and `idleTakeovers`. They are emptied in four ways, and after each one the next goal reaches the
model with no check:

1. A server restart. `recoverAtBoot` sets every bot to idle and ends the open cards (`recovery.ts:37`).
2. A blocked hold runs out after `BLOCKED_HOLD_MINUTES` with nobody on the page (`endBlockedHold`).
3. An idle takeover ends when the page has stopped asking about hand-back for a minute (`armIdlePresence`).
4. After a restart the manager has no session, and `safeWithoutRun` then answers "allowed" (`runner.ts:359`).

A human who typed a password and left it in the field, then closed the laptop, can have that
password in the next run's first screenshot. `docs/decisions.md` records this as a known gap.

**(b) Any stream URL can drive the screen.** The page gets two URLs: a view URL while the bot works
and an interactive URL during a takeover. In `@e2b/desktop` 2.4.0 both carry the same password;
"view only" is only a noVNC client parameter (`view_only=true`), and x11vnc gets one full-access
password. Removing one query parameter from the view URL gives full input while the model acts. An
interactive URL also stays valid after hand-back, until the computer next pauses. The page drops
the interactive frame, but the server does not take input back. The decisions document calls this
"the page ends the person's input, the server does not"; the view-URL half was not known.

Why now: the deployment decision of 2026-09-25 (one deployment per team) puts the server in front of
several people of one team. Invariant 5 must hold before any customer can reach it.

## Decisions Log

| # | Question | Decision | Reasoning |
| --- | --- | --- | --- |
| 1 | One spec or two for (a) and (b)? | One spec. | Both depend on one fact: who owns the screen. One persisted record drives both the check and the input switch, with one state table (the owner, 2026-09-25). |
| 2 | How does the server stop input while the bot owns the screen? | x11vnc's global view-only switch at runtime: `-R viewonly` when the bot takes the screen, `-R noviewonly` when a human takes over. | Enforced by the VNC server, one command, no reconnect, no change to the SDK's stream start. Gap: during a takeover anyone holding the page's view URL can type too; in a per-team deployment those people can press Take over anyway (the owner, 2026-09-25). |
| 3 | A check is due and fails (secret on screen, unreadable, no answer). What then? | The goal does not start. The bot goes to blocked, a takeover card opens, the human gets one notice. A routine is acknowledged, not retried. | Same as today's refusal on a held screen. A 7 am routine that fails quietly helps nobody (the owner, 2026-09-25). |
| 4 | What persists? | One boolean on `bot.json`: `screenCheckDue`. True from the moment the server hands out an interactive URL until a screen check passes. | The weakest fact that is always safe: "a human may have typed on this screen". It survives restart, sleep and every hold ending. |
| 5 | When is a check needed? | Exactly when `screenCheckDue` is true. | With input off whenever the flag is false, no human can have typed since the last passing check. A bot that ended blocked but was never taken over needs no check, and nothing wakes a computer for a check nobody needs (invariant 8). |
| 6 | The order of the steps | Take over: flag true, then input on, then the URL. Give back: check, then input off, then flag false. | Invariant of this design: **input on implies `screenCheckDue` is true**, at every moment, across every failure. Each order keeps it; the reverse order breaks it. |
| 7 | How do the stream route and a goal start avoid interleaving? | A per-bot screen lock, held for each ownership transition. | The route's grant does not run on the bot's run queue (an in-run takeover happens while the run holds the queue), so the queue cannot be used. A short in-memory lock is enough in one process per deployment; after a restart nothing is in flight and the flag is on disk (design review, 2026-09-25). |
| 8 | When a hold or an idle takeover times out, is input switched off? | Yes, input off; the flag stays true. | Switching input off needs no page check, costs one command, and ends a stale URL's input as soon as nobody is on the page (design review, 2026-09-25). |

## Chosen Approach

A persisted "a human may have touched this screen" flag, and the VNC server's input switch tied to
it. The flag turns on before a human gets input and turns off only after a check shows the page is
safe and input is off again. The check at goal start reads the flag, not the in-memory maps, so it
survives restart, sleep and the end of any hold.

**Why this over alternatives:** it closes both gaps with one field, one sandbox command and one
check that already exists. It needs no new password scheme, no stream restarts at hand-back, and no
database.

## Research (source links)

- **The view-only URL is client-side only.** `@e2b/desktop` 2.4.0,
  `node_modules/@e2b/desktop/dist/index.mjs:451-458`: `getUrl({ viewOnly })` adds `view_only=true`
  and `password=<authKey>` to the noVNC page URL. Lines 494-502: `getVNCCommand` runs
  `x11vnc -storepasswd <password>` and starts `x11vnc ... -usepw`, with one password and no
  view-only flag. Our wrapper passes the same key to both URLs (`src/server/sandbox/e2b.ts:545-552`).
- **x11vnc can switch all input off at runtime.** [x11vnc OPTIONS](https://raw.githubusercontent.com/LibVNC/x11vnc/master/doc/OPTIONS.md):
  `-remote command` ("-R" is an alias) controls a running server through the `X11VNC_REMOTE` X
  property, run "with correct settings for DISPLAY"; `viewonly` / `noviewonly` "enable / disable
  -viewonly mode"; `-viewonly`: "All VNC clients can only watch"; `-input`: "a global -viewonly is in
  effect (all input is discarded in that case)"; `-yesremote` is the default; `-sync` runs a remote
  command synchronously; `-query` reads a value back.
- **A resume restarts the stream with a new key.** `connectSandbox` stops the old stream and starts a
  new one on every connect (`src/server/sandbox/e2b.ts:335-352`, `startStream` at 545). So a URL
  handed out before a pause dies at the next resume, and the new x11vnc starts with input on until
  the switch runs.
- **Pause and resume keep the screen.** [E2B persistence](https://docs.e2b.dev/sandbox/persistence),
  fetched 2026-09-25: on pause "all the running processes, loaded variables, data, etc." are saved
  and restored. So the browser and its page survive, and a secret left on screen before a pause is
  still there after it.
- **Verified live on the template.** [Probe of 2026-09-25](../evidence/2026-09-25-screen-ownership/README.md):
  E2B's `desktop` template runs x11vnc 0.9.16. After `-sync -R viewonly`, `-query viewonly` answers
  `viewonly:1`, and VNC input is discarded both from a new client and from a client that was already
  connected. `-R noviewonly` gives input back (`viewonly:0`), and the switch works repeatedly.

## Design

### 1. The flag

`Bot` gains `screenCheckDue: boolean`, default `false`, read with a default so older `bot.json`
files parse. It is written only through `updateBot` (inside the file's write chain). Recovery at
boot never clears it. Nothing else clears it except the two passing checks below.

### 2. The input switch

`SandboxSession` gains `setHumanInput(on: boolean): Promise<void>`. The E2B implementation runs
`x11vnc -display <raw.display> -sync -R noviewonly` or `-R viewonly`, then `x11vnc -display
<raw.display> -query viewonly` and throws unless the answer matches. A fake records the calls. It
has the same short command timeout as the other desktop passthroughs.

`startStream` calls `setHumanInput(false)` right after x11vnc starts and before any URL leaves the
function, so every new stream starts with input off. If that call fails, the session start fails:
a stream whose input state is unknown is not handed out.

### 3. The screen lock

`Runner` holds one promise chain per bot, `screenLock(botId, work)`, of the same shape as
`withFileLock` in `src/server/store/paths.ts`. Every ownership transition runs inside it: the grant
in section 4, the give-back in section 5, and the goal-start section in section 6. Inside the lock
each step reads the facts it depends on again: the bot's state, `activeRuns`, the run's takeover
controller, and `screenCheckDue` from `bot.json`. No step decides on a value read before the lock.
The lock is never held across a wait for a human, a model call or an approval; it covers only the
check, the input command and the flag write, so a hand-back and a goal cannot deadlock.

Two rules for `/plan`:

- **No re-entry.** Sections 4, 5 and 6 share plain helper functions that do not take the lock. Only
  the outermost caller takes it: the stream route, `Runner.handback`, the runner's wrapper around
  `TakeoverController.handback`, the goal-start block in `run()`, and the two timers. No code path
  calls `screenLock` for a bot while it already holds it for that bot. `endBlockedHold` runs as a
  job on the run queue; it takes the screen lock inside that job, and nothing that holds the screen
  lock waits on the run queue.
- **Bring the computer up first.** `ensureRunning` runs before the lock is taken. The lock covers
  only the tail: read the owner again, check, switch input, write the flag. This is the pattern
  `beginIdleTakeover` already uses (it checks `activeRuns` again after its awaited `ensureRunning`,
  `runner.ts:204-210`).

### 4. Taking over (the only way input turns on)

The interactive branch of `GET /api/bots/:id/stream` is the one place where input turns on. For
the idle case (through `beginIdleTakeover`) and for the blocked case (a run's takeover or a blocked
end), inside the screen lock, in this order:

0. Read the owner again. The grant is refused (409, as today) unless the bot is blocked, or idle with
   no entry in `activeRuns`. A goal that took the screen first has already switched input off and
   owns it; the grant then does nothing.
1. `updateBot({ screenCheckDue: true })`. If it fails: 500, no URL.
2. `session.setHumanInput(true)`. If it fails: 409 "the takeover could not start", no URL. The flag stays
   true, which costs at most one check later.
3. Return the interactive URL together with the session's `streamGeneration` (section 4a).

#### 4a. A resume during a takeover

A resume during a takeover (the repair path in `safeWithoutRun`, or a paused computer brought up for
a hand-back) starts a new stream with input off and a new key. The page's interactive frame then
shows a dead connection, and today nothing notices: the page fetches the interactive URL once per
takeover (`src/web/App.tsx:171-184`, `229-242`) and resets it only in `leaveTakeover`.

The signal is a number. `SandboxSession` gains `streamGeneration`, a counter that the manager raises
each time it starts a session for the bot. The stream route returns it with the interactive URL. The
hand-back state route (`GET /api/bots/:id/takeover/state`, polled every two seconds while the tab is in
takeover mode, `App.tsx:122-145`) returns the current session's `streamGeneration`, or `null` while
no session is up. When the poll returns a number different from the one the page holds, the page
fetches `stream?mode=interactive` again and replaces the frame. That call goes through section 4
and turns input on for the new stream. `null` changes nothing.

Today the poll never brings a paused computer up: `handbackState` calls `safeWithoutRun(botId)`
without `repair` (`runner.ts:261`), and `beginIdleTakeover` refuses to wake a sleeping computer
(`runner.ts:194`). This design changes one thing there: while a takeover is still held (an entry in
`idleTakeovers` or `blockedKeepAlives`), the poll calls `safeWithoutRun(botId, true)`, so the repair
path resumes the computer under the hold that already exists. The rule "a computer that is asleep
is not woken for a takeover" stays for starting a new takeover. A held takeover was already paid
for, and the human is looking at a dead frame. When the hold has ended (nobody asked for a
minute, or the blocked hold ran out), the poll does not wake the computer: the page shows the
takeover as ended, and the flag makes the next goal check the screen.

### 5. Giving the screen back (the only ways the flag turns off)

A **passing check** is `safeWithoutRun` (or the run's `TakeoverController.check`) answering
allowed. The check and the steps after it run inside the screen lock, in this order:

1. `session.setHumanInput(false)`. If it fails: the hand-back is refused with "I could not take the
   screen's input back; try again", or the goal is refused as in section 6. The flag stays true.
2. `updateBot({ screenCheckDue: false })`. If it fails: the hand-back or goal fails with an error. The
   flag stays true and input is off, so the next attempt checks again. Nothing unsafe is left.
3. Only then: the run resumes, the bot goes idle, or the model gets its first call.

This applies at three places: the run's hand-back (`TakeoverController.handback`, wrapped by the
runner), the hand-back without a run (`Runner.handback`), and goal start (section 6).

### 6. Goal start

In `Runner.run`, after the budget check and inside the screen lock, the question "is a check due"
becomes `(await store.readBot(botId)).screenCheckDue`. The two maps stay, but only for their keep-alive and
timer handles. When a check is due:

1. `sandboxes.ensureRunning(botId)` (the step that follows today anyway). A computer that does not
   come up ends the goal as today ("I could not start my computer"): `failed`, flag unchanged.
2. `safeWithoutRun(botId, true)`.
3. Refused (unsafe, unreadable, no answer) or step 4 below fails: the goal ends `blocked` with summary
   `not started: <reason>`. The bot goes to blocked, a takeover card opens with the reason, the
   human gets one `refused` notice, and the computer is held like any blocked end
   (`blockedKeepAlives`, `armBlockedHold`). The scheduler acknowledges `blocked`, so a routine is not
   retried. The model is never called and no screenshot is taken.
4. Allowed: section 5 steps 1 and 2, then the lock is released and the run goes on as today.

When no check is due, goal start is unchanged. The existing refusal for a held screen becomes a
special case of this path, not a second path.

### 7. Timers and holds

`endBlockedHold` and the idle presence timer keep releasing the computer. Inside the screen lock they
also call `setHumanInput(false)`, and they leave the flag true. Both run only when the page has not
asked about hand-back for a while, so nobody is typing; a stale URL loses input at that moment, and
the flag still makes the next goal check the screen. A failed input command is logged and changes
nothing else: the flag is true either way, and the computer pauses on its own clock, which ends the
stream. The next resume starts with input off (section 2).

### State table

Every row keeps "input on implies `screenCheckDue`".

| Event | Success | Failure | Timeout | Stop | Retry | Partial result | Restart |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Take over (stream route) | flag true, input on, URL returned | flag write fails: 500, input off. Input-on fails: 409, flag true, input off | the input command times out: as failure, 409 | not applicable (no run) | the route again: flag already true, input on again | flag true, input off: harmless, one check later | flag persisted. The next connect restarts the stream: input off, old URL dead |
| Hand-back, with or without a run | check passes, input off, flag false, run resumes or bot idle | check refuses: input on, flag true, the human keeps the screen. Input-off fails: refused, flag true | the check or input command times out: refused, as today's `UNANSWERED_REASON` | during a run: Stop ends the run as today; flag and input unchanged, so the next goal checks | the hand-back again: every step is idempotent | input off, flag write fails: error, flag true, input off; the next attempt checks again | flag persisted. After a restart no hold exists, so a hand-back call may return without a check; the flag stays true regardless, and the next goal is the check that counts |
| Goal start, check due | check passes, input off, flag false, the model's first call | the computer does not start: `failed`, flag true, no model call. The check refuses: blocked, card, notice, held, no model call | the check times out: blocked with `UNANSWERED_REASON` | during the check: `stopped()` as today; flag and input unchanged | a routine is acknowledged (`blocked`); a person sends the goal again after fixing the screen | input off, flag write fails: `failed` before any model call, flag true | a restart between check and model call: the run is closed by recovery, flag true or false as last written, both safe |
| Hold ends, idle presence ends | input off, flag true, computer released | input command fails: logged, flag true; the pause ends the stream | as failure | not applicable | not applicable | not applicable | flag persisted |
| Take over and goal start at the same time | the screen lock orders them. Grant first: flag true, input on, then the goal checks the screen (refused while a human types, or passes and takes input back). Goal first: it owns the screen, and the grant is refused with 409 | each side's own failure row applies | each side's own timeout row applies | Stop of the goal while the grant waits for the lock: the goal ends, the grant then runs on an idle bot | the page asks again | not possible: each transition finishes inside the lock | nothing is in flight after a restart; the flag decides |
| Resume during a takeover | new stream, input off, `streamGeneration` raised; the page's poll sees it and fetches the interactive URL again, which turns input on | the fetch fails: the page shows the error, the human presses Take over again | as failure | not applicable | the next poll | not applicable | not applicable |
| Computer pauses or resumes | the resume starts a new stream with a new key and input off | the input-off step fails: the session start fails, no URL leaves | as failure | not applicable | the next `ensureRunning` | not applicable | not applicable |

## Demo path

| # | What the user sees | What happens underneath |
| - | ------------------ | ----------------------- |
| 1 | The bot is idle. The user presses Take over on the page. | The stream route sets `screenCheckDue` true, runs `x11vnc -R noviewonly`, returns the interactive URL. |
| 2 | The user signs in to a site on the bot's screen, types the password, and closes the laptop before submitting. | The password stays in the field. The presence timer ends the idle takeover a minute later and releases the computer; the flag stays true. |
| 3 | The operator restarts the server. | Recovery sets the bot idle and leaves `screenCheckDue` true. |
| 4 | At 7:00 a routine fires. The chat shows "I did not start: a password or code field still has a value on screen" and a takeover card. A notice mail arrives. | The runner reads the flag, resumes the computer (new stream, input off), asks the companion for the page state, and gets `unsafe`. No model call, no screenshot. The bot goes to blocked and is held. |
| 5 | The user opens the page, presses Take over on the card, clears the field and presses Hand back. | Flag stays true, input on. The hand-back check passes, input goes off, the flag goes false, the bot goes idle. |
| 6 | The user sends a goal. The bot works as usual; the view stream shows it live. | No check is due. The run goes on as today. |
| 7 | (Proof of (b)) The user had copied the interactive URL into a second tab at step 5. Clicks in it now do nothing while the bot works. The view URL with `view_only` removed does nothing either. | x11vnc is in view-only mode, so all input is discarded, whatever the URL says. |

The artifact at the end is the goal's normal artifact. The approval gate is not touched by this design.

## Invariant coverage

| # | Invariant | Mechanism, or "not touched" |
| - | --------- | --------------------------- |
| 1 | Visible remote computer | The view stream stays live; view-only mode changes input, not what is shown. |
| 2 | Real work, not simulation | Not touched. |
| 3 | One job, finished | A goal refused by a failed check is not a job stopped half-way: nothing started. The takeover card is the way to finish it. |
| 4 | Approval before irreversible side effects | Not touched. The server's input switch also removes one way around the gate: typing through a URL while the model works. |
| 5 | Takeover without secrets in the transcript | The core of this design: the check before the model sees a screen a human had now survives restart, sleep and every hold ending, and input comes only from a URL issued during a takeover. |
| 6 | Persistence across sessions | `screenCheckDue` lives in `bot.json` and survives a reload and a restart. |
| 7 | Configured in plain language | Not touched: nothing for the user to set. |
| 8 | Cost efficiency | No model call, no screenshot. Per ownership change: one x11vnc command and one query (a sandbox command each). A check wakes the computer only when a goal would wake it anyway. A refused check holds the computer up to `BLOCKED_HOLD_MINUTES` (30 min of sandbox time), the same as any blocked run today. Cheaper path considered: checking on every goal (a companion call each time); the flag limits the check to the goals that need it. |

## Failure modes in use

| Failure | Detected by | What happens / what the operator does |
| --- | --- | --- |
| The computer does not start or resume | `ensureRunning` throws | The goal fails as today, with the flag unchanged. The operator retries later. |
| The companion does not answer | `safeWithoutRun` answers `UNANSWERED_REASON` | Blocked with a card. The user takes over, or retries when the computer answers. |
| A future template changes x11vnc so that `-R` is not honoured | `setHumanInput` checks `-query viewonly` after every switch and throws on a mismatch | Every take-over and give-back fails closed (409 or refused) until the template is fixed. The probe in the evidence folder shows which step broke. |
| The laptop sleeps during a takeover and the computer pauses | While the hold still stands, the next hand-back poll calls `safeWithoutRun(botId, true)`; the repair path resumes the computer and the poll returns a new `streamGeneration` | The page fetches the interactive URL again; input is on for the new stream. If the hold ended during the sleep, the poll wakes nothing; the takeover shows as ended and the flag makes the next goal check. The flag stays true throughout. |
| The input command fails or times out | `setHumanInput` throws | Take over: 409. Give back: refused, flag stays true. Session start: fails, no URL. |
| The site changed its layout, a login expired, a CAPTCHA appeared | Not this design | Unchanged: the run's own takeover. |
| The model loops or stalls | Not this design | Unchanged. |
| A slow network | Command and companion timeouts | Treated as failure. Every failure leaves the flag true, so the result is always "check again". |

## Scope budget

**In:** the flag, the input switch, the ordered take-over and give-back steps, the goal-start check
based on the flag, a new stream starting with input off, and the page fetching the interactive URL
again after a resume.

**Parked, with reason:**
- A separate view-only password, so a view URL never gives input even during a takeover. Reason: in
  a per-team deployment everyone who holds the view URL can press Take over anyway, and it would
  replace the SDK's stream start. Trade-off recorded in `docs/decisions.md` when this lands.
- Clearing the screen before sleep (the other upgrade named in `docs/decisions.md`). Reason: the
  persisted check covers the same risk without touching the user's page.

**Estimate:** The owner's hours: none for the build. About 15 minutes for one live step at the end:
type into a password field on the bot's screen, leave it, and watch the restart refusal. Live-run
cycles: the raw-SDK probe of `-R viewonly` is done (evidence folder). One live run of the demo path
remains (one refused routine, one normal goal; model cost of one short run).

## Alternatives Considered

### Rotate the stream key at every hand-back

Restart the stream with a new key whenever the bot takes the screen back. It kills old interactive
URLs, but the view URL still carries full input while the bot works, so gap (b) stays open. Each
hand-back also blacks out the screen for a few seconds. Rejected.

### A separate view-only password

Start x11vnc ourselves with a full and a view-only password (`-passwdfile` with
`__BEGIN_VIEWONLY__`), and rotate the full one on hand-back (`read:` rereads the file when a client
connects). It closes (b) during takeovers too. Rejected for now (decision 2); it is the upgrade if a team needs the view URL to carry
no input even during a takeover.

### Keep checking on the in-memory maps, and persist them

Write both maps to disk and restore them at boot. That restores holds and timers after a restart, a
harder problem (their keep-alives and timers are process-local), and still leaves holds 2 and 3
above. The flag records the fact the check needs, not the process state around it. Rejected.
