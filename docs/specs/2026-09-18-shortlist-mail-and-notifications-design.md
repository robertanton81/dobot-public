# Shortlist Mail, Apply by Reply, and a Mail When the Bot Needs Its Human — Design Spec

**Date:** 2026-09-18
**Status:** Draft, revised four times the same day: after three rounds of findings that the owner
relayed and two passes of the design reviewer (see "Review record" at the end). **Approved by
the owner on 2026-09-18**, the library of decision 6 included.
**TODO items:** none existed. The owner asked for this on 2026-09-18. New items go under "2. The demo
path" (parts A and B) and "1. Foundation" (part C) after approval.
**Scope:** Part C is platform code (`src/server/mail/`, `src/server/agent/runner.ts`,
`src/server/agent/takeover.ts`, `src/server/config.ts`, `src/server/index.ts`). Parts A and B are
configuration of one bot, made by chat: no file under `src/` changes for them.

## Problem

Hunter's morning run chooses one posting by itself and fills its form before the user has seen any
choice. Act one also ends with nothing delivered outside the bot's computer, because the filmed
application ends on Deny. And when a bot stops for a human, only the page shows it. On 2026-09-17
the unattended morning run waited at three approval cards, each timed out unseen, and the run cost
$0.32 for nothing (the private backlog, "The consent dialog").

The owner asked for three things on 2026-09-18:

- **A. A shortlist mail.** Hunter reads two job sites, keeps only the offers that fit, writes the
  dossier, and mails the owner the shortlist with one recommendation.
- **B. Apply on the user's word.** The owner answers with the numbers of the offers to apply to, by
  replying to that mail or by typing the same words in chat. Hunter then prepares each application
  and stops at its submit card, as act one does today.
- **C. A mail for every step that needs the human.** Whenever a bot needs the user's action on the
  screen, the user gets a mail at his own address.

## Decisions Log

| # | Question | Decision | Reasoning |
| - | -------- | -------- | --------- |
| 1 | Which sources? | startupjobs.cz and jobs.cz (the owner). | Two sources turn "sources are configurable" (job-selection spec) into evidence on the reading side. |
| 2 | What happens after the mail? | The morning run ends with the mail. Applying starts on the owner's reply mail or on the same words in chat (the owner). | The user chooses the job. Two short runs replace one long run near the step cap of 150. |
| 3 | Who tells the user that the bot waits? | The platform, not the bot (Claude; the owner asked for the mail). | A bot cannot announce its own wait. Every send from its webmail needs an Allow, so a notice about a card would need a card. At a mailbox sign-in the bot has no mailbox at all. |
| 4 | Who teaches Hunter, who presses Allow in rehearsal? | Claude, through the API. Allow only on a Send card whose recipient is the owner's address and whose text matches the shortlist card (the owner). | Same permission as the side proof of 2026-09-18, given again for this work. |
| 5 | Where does the notice address live? | Operator setup: `NOTIFY_EMAIL` in `.env.local`. No tool can set it. | The channel that calls the human is part of the safety boundary, like `approval-rules.json`. If the model could change the recipient, text on a web page could tell it to, and the human would never be called again. The shortlist's recipient may live in the bot's memory because the human reads the Send card before that mail leaves; the notice is the channel for the moment when nobody reads any card, so it cannot lean on the same protection. |
| 6 | Which mail library and version? | `nodemailer` 9.1.1 with `@types/nodemailer` 8.0.2, not the newest 10.0.10. Needs the owner's word before install. | 10.0.0 is 14 days old and had 11 releases, eight of them between 10 and 14 September. The project's own precedent (imapflow, 2026-09-12) pins one line behind a days-old major. 9.1.1 has no known advisory and carries the fix for the newest one. |
| 7 | Do the skills that passed today change? | No. `search-job-board`, `apply-to-posting` and `handle-replies` stay byte-identical. Two new skills are added, and the two routine instructions change. | In the side proof a bot's rewrite of a long skill lost rules (finding S9). The three skills hold the grounding rules and the act-two rules that passed live on 2026-09-18. |
| 8 | How far is a mail trusted? | A mail is a request, never an authority. The only order a mail can give is a list of numbers from a shortlist Hunter sent. Every application still stops at its submit card. A reply whose sender is not the user's address is refused, not warned about. | The From line of a mail can be forged, so the sender check proves nothing; the closed list of orders, the approval gate and the daily budget bound the damage. The refusal is still right: a doubt about a third party is a warning on a card (the platform's doubt rule); a doubt about who gives the order is a refusal. Only the user commands the bot. |
| 9 | May Hunter apply on jobs.cz? | Not with `apply-to-posting`, whose buttons belong to the first site. Its form is learned in one chat-led run on Deny and saved as its own skill. Until then a jobs.cz offer gets a dossier and a letter only. | Rule of 2026-09-12 in the job-selection spec for a second apply surface: both acts ran clean (2026-09-18), the final control was inspected by eye (2026-09-18: pass), every rule requires approval. |
| 10 | What is in a notice mail? | Fixed platform text only: the bot's name, the kind of need, and for an approval the action kind from the platform's closed list. No word written by the model, no screenshot, no link. The details stay on the page. | Text written by the model can carry a link or "click here" that a web page put there. Quoting it or removing line breaks does not stop that. A mail that holds no such text keeps its promise by construction. |
| 11 | How are the two result lists read? | Both on the bot's screen. `fetch_url` is for the text of one posting or one company page whose address is already known. | `fetch_url` drops every link (`htmlToText`), so a posting's address can only be read on the screen. It also keeps the second source visible to the viewer (invariant 1). |
| 12 | Where does the progress of a selection live? | In memory lines written before each step, not after: the shortlist's numbered list before the send is proposed, the selection before any work, "Started" before each application. A number whose outcome is unknown is never applied to again by the bot alone. | A restart re-runs a mail routine at boot (`src/server/mail/watcher.ts:199-204`), and the reply is already read by then. A marker written only after acting lets the first application repeat or the second get lost. |
| 13 | Which moments send a notice? | Five: an approval wait, a question wait, a takeover wait (requested by the bot or forced by the secret guard), a run that ended blocked, and a goal refused because a human still holds the bot's screen. Not the daily-budget refusal. A `refused` notice goes out once per hold of the screen. | The owner asked for "every step that requires my action on the screen". No action on the screen can help a used-up daily budget; the chat card and the routine's last result record it. |
| 14 | When is a shortlist "sent"? | When the webmail's own confirmation was seen after the click, or the mail is found in the Sent folder. An Allow is a permission, not a send. A shortlist with a "prepared" line and no outcome has an unknown delivery. Only the Sent folder settles it, with three results: found, searched and not found, could not look (unknown stays unknown). A mail is a reason to look, and only after it passed its own checks; it is never proof of delivery. A shortlist is never sent again by the bot alone. | `propose_action` only grants the click. The click can miss, the webmail can refuse, and the server can restart before the line is written. If a mail could mark a shortlist as sent, a mail with a guessed id and a wrong sender would hide offers the user never saw. |
| 15 | What does the platform say when a notice did not go through? | `confirmed` or `unconfirmed`, never "lost" or "failed", and one neutral status card that says nothing about waiting. | A server can accept a message and the connection can end before its answer arrives (SMTP specification, section 4.5.3.2.6). A blocked or refused run is not waiting, and a wait can end before the outcome is known. |

## Chosen Approach

Part C is a small platform module: when a bot needs its human, the platform sends one plain-text
mail with fixed wording from the bot's mailbox to the operator's address over SMTP. No run ever
waits for that send. Parts A and B are two new skills and two changed routine instructions that
Hunter writes itself after Claude describes the goal in chat, as a user would.

**Why this over alternatives:** the platform already holds the mailbox sign-in for the IMAP mail
trigger, so part C needs no new secret. Parts A and B use only tools that have run live: reading a
site on the screen (act one), `write_artifact` (act one), a mail typed and sent from the bot's
webmail behind one Allow (side proof, run `af709685`: 34 steps, $0.39).

**Order of work, by value against risk (Claude's opinion, stated once):** C first, then A, then B
by chat, then B by reply mail, then the jobs.cz form. B by reply mail proves no new platform
mechanism, because act two already shows "mail arrives, a run starts by itself". It also adds the
only new attack surface, and most of the rules in this spec exist because of it. The owner asked for
it, so it is built, but after the shortlist scene works, so a defect in it cannot take that scene
down with it.

## Research (source links)

- [nodemailer SMTP transport](https://nodemailer.com/smtp) — `createTransport({ host, port, secure, auth: { user, pass } })`; `secure: true` for port 465; defaults `connectionTimeout` 120 s, `greetingTimeout` 30 s, `socketTimeout` 600 s, so this design sets its own; `logger` and `debug` are off unless set, and `debug` would log message content; `verify()` tests DNS, TCP, TLS and sign-in without sending.
- [nodemailer message fields](https://nodemailer.com/message) — `from`, `to`, `subject`, `text`.
- [nodemailer error reference](https://nodemailer.com/errors) — an error carries `code` (for example `EAUTH`, `ETIMEDOUT`, `ECONNECTION`), `command` (the SMTP command in progress) and `responseCode`; the log takes these three, never the message text. "Connection closed unexpectedly during a transaction" and a socket timeout are among them, so an error alone does not show whether the server had already accepted the message.
- [SMTP specification, RFC 5321, section 4.5.3.2.6](https://www.rfc-editor.org/rfc/rfc5321#section-4.5.3.2.6), read 2026-09-18 — while the client waits for the "250 OK" after the message data, the server is already delivering; a timeout at that point loses the answer, not the mail: "it has been successfully sent and the server has accepted responsibility for delivery". The specification's own limit for that wait is ten minutes.
- [nodemailer on the npm registry](https://registry.npmjs.org/nodemailer), read 2026-09-18 — latest 10.0.10 (2026-09-14), 9.1.1 (2026-09-01), zero dependencies, MIT-0, one maintainer (`andris`, who also maintains `imapflow`), 21.3 million downloads a week ([downloads API](https://api.npmjs.org/downloads/point/last-week/nodemailer)).
- Packaging, read 2026-09-18 from the published file lists: [9.1.1](https://unpkg.com/nodemailer@9.1.1/?meta) holds 52 files under `lib/`, CommonJS, and no type file, so it needs [`@types/nodemailer`](https://registry.npmjs.org/@types/nodemailer) 8.0.2 (2026-09-15; it describes the 8.0 API, and no types for 9.x exist). [10.0.10](https://unpkg.com/nodemailer@10.0.10/?meta) holds 161 files with both an ES-module and a CommonJS build and 76 type files of its own. The design uses three long-standing calls (`createTransport`, `sendMail`, `verify`); `/plan` confirms on install day that the 8.0 types compile against 9.1.1, and if they do not, a local declaration of those three calls replaces the types package.
- [OSV, nodemailer](https://osv.dev/list?ecosystem=npm&q=nodemailer), queried 2026-09-18 — no known advisory for 9.1.1 or 10.0.10; the newest advisory, [GHSA-8m3c-c648-2xjj](https://github.com/advisories/GHSA-8m3c-c648-2xjj), is fixed in 9.1.1. Older advisories were header and command injection through CR and LF characters; decision 10 removes that input altogether. `/plan` checks the chosen version again on install day.
- Seznam Email help, page "Poštovní programy a aplikace" (mail programs) — outgoing server `smtp.example.test`, port 465, SSL/TLS, sign-in required with the full address and the account password. The page names no application passwords.
- Code facts, each read on 2026-09-18 at the line given:
  - An unanswered approval is denied after 30 minutes; an unanswered question resumes the run with "(no answer within 30 minutes; decide yourself or stop)" (`src/server/agent/runner.ts:478-495`). A takeover wait has no timeout: only a hand-back or Stop ends it (`src/server/agent/takeover.ts:124-128, 165-188`).
  - `TakeoverController.begin()` awaits the page state, the bot state, the card and an event before it checks the stop signal and registers its waiter (`takeover.ts:113-128`). The Runner's `takeover` closure has no stop check of its own (`runner.ts:496-500`).
  - `Approvals.waitFor` resolves at once when the decision was already made (`src/server/agent/gate.ts`, `waitFor`). A card the gate creates itself for an unannounced click also waits through `waitForApproval`, with the kind `other` (`src/server/agent/run.ts:333-338`).
  - A run ends blocked only right after a stop check with no await in between (`run.ts:528-530, 638-644`), through `blockedEnd` (`run.ts:255-259`). Two refusals return before the run loop exists: a goal refused while a human holds the screen, outcome `blocked` (`runner.ts:400-411`), and the daily-budget refusal, outcome `budget` with the bot left idle (`runner.ts:418-427`). The step and call budgets inside the loop also end as `budget`, but blocked.
  - The mail watermark moves only after the routine's run has returned, and the file's own comment names the price: "a restart during a mail-triggered run starts the routine again at boot" (`src/server/mail/watcher.ts:199-204`). In one process a run that fails, is stopped or ends blocked fires nothing again, because `fire` never rejects (`src/server/scheduler/scheduler.ts:105-117`). After a restart that followed an approved action the platform says in chat that it cannot tell whether the action went through (`src/server/agent/recovery.ts:26`).
  - The prompt puts the routine's instruction before the rules, the memory and the skills (`src/server/agent/prompt.ts:91-100`); every skill is there in full on every run. The doubt rule makes a doubt about a sender "a warning on the approval card, never a reason to stop" (`prompt.ts:31-32`). The cheap-path rule tells the model to use `fetch_url` before the computer (`prompt.ts:62`). `htmlToText` removes every tag, links included (`src/server/agent/tools.ts:127-136`).
  - `handle-replies` reads "the unread messages" and sorts them into "one of four kinds"; `apply-to-posting` names the first site, its opening button "Mám zájem o nabídku" and its final button "Odeslat zájem" (`examples/job-hunt-bot/skills/`).
  - A half-set mailbox is a warning and the feature is off; it never ends the process (`src/server/config.ts:60-68`). A skill can be corrected on the page (`PUT /api/bots/:id/skills/:name`, `src/server/http/app.ts`). After a mail event, the next one fires five minutes later at the earliest (`watcher.ts`, `MAIL_DEBOUNCE_MS`). The gate stops a click on any submit control, and on a button or link whose first word is on the verb list (`gate.ts`, `matchRule`).
- Measured on 2026-09-18 from a home address: the result list of startupjobs.cz is drawn by the browser, so `fetch_url` sees no posting at all; the result list of jobs.cz is plain HTML (30 postings, about 7,000 characters as text, no bot check), but its links are lost in `fetch_url`'s text.

## Design

### Part C — a mail when the bot needs its human (platform)

**Module.** `src/server/mail/notifier.ts`, next to the IMAP watcher. It exports a port and one
adapter, the same shape as `MailboxPort` and `ImapMailbox`:

```ts
export type HumanNeed = 'approval' | 'question' | 'takeover' | 'blocked' | 'refused'
export type Notice = { botName: string; need: HumanNeed; actionKind?: ActionKind }
export type NotifierPort = { notify(notice: Notice): Promise<'confirmed' | 'unconfirmed'> } // never rejects
```

A `Notice` has no free-text field. Nothing the model wrote — a summary, a label, a question, a
reason — can reach the mail, because the type has no place for it (decision 10). `botName` comes
from `bot.json`, which the user sets when he creates the bot and no tool can change; control
characters are removed and it is cut at 60 characters. `actionKind` is one value of the platform's
closed list (`send`, `submit`, `book`, `pay`, `delete`, `publish`, `accept-terms`, `other`).

**When a notice is sent.** At the point where the need is real, and not before:

| Need | Exact point | Not sent when |
| ---- | ----------- | ------------- |
| `approval` | in the Runner's `waitForApproval` closure, after its stop check, right after the wait is registered | the run is stopped; the approval is no longer pending at that point (decided, or allowed by the rules, so no wait starts) |
| `question` | in the Runner's `waitForUser` closure, after its stop check, right after the waiter is registered | the run is stopped |
| `takeover` | inside `TakeoverController.begin()`, at the line that registers the waiter, through a callback the Runner passes in; only for the triggers `requested` and `secret-field` | Stop arrived while `begin()` prepared the card (it ends as stopped and registers nothing); the trigger is `manual`; a takeover of an idle bot (it never calls `begin()`) |
| `blocked` | in the Runner, after `runLoop` returned `stuck` or `budget` | — (a stop check with no await after it precedes every blocked end) |
| `refused` | in the Runner, at the early return "the screen a human is on is not safe yet" | a `refused` notice already went out during the same hold of the screen (see "How often" below) |

No notice at boot, and none for the daily-budget refusal (decision 13). The callback is invoked
inside a wait's own registration, so it must never throw: the Runner's helper wraps the call, and
the promise chain behind it ends in a catch that only logs. That chain holds the status card's
`postChat` too, which can reject when the disk or the bot folder fails.

**The mail.** Plain text. Subject: `<bot> needs you: <need>`. Body: one fixed paragraph for the
need, then one fixed closing line. The minutes are taken from the platform's own constants, so the
text cannot go out of date.

| Need | Fixed body |
| ---- | ---------- |
| `approval` | "<bot> is waiting for your approval (<action kind>). Open the dobot page to see the request and to allow or deny it. A request nobody answers within 30 minutes counts as denied, and the run goes on without that step." |
| `question` | "<bot> asked you a question in the chat. Open the dobot page to read and answer it. If nobody answers within 30 minutes, <bot> decides by itself or stops." |
| `takeover` | "<bot> needs you on its screen for a step it must not do itself: a sign-in, a code or a human check. Open the dobot page, do that step, then hand the screen back. <bot> waits until you hand back or press Stop." |
| `blocked` | "<bot> stopped before it finished and needs you. The run has ended, so nothing is waiting for an answer. Open the dobot page to see why." |
| `refused` | "<bot> did not start a job. Its screen is still held for you, and it cannot take the screen back yet. Open the dobot page to see why." (Reworded by the plan of 2026-09-18: the refusal has two causes, a page that is not safe yet and a computer that does not answer, and "hand the screen back" fits only the first.) |

Closing line, always: "This mail is only a notice. It never asks you to click a link or to reply."
From: the mailbox address with the bot's name as display name.

**Configuration.** Three new optional keys, listed in `.env.example` with empty values:
`NOTIFY_EMAIL`, `MAILBOX_SMTP_HOST`, `MAILBOX_SMTP_PORT` (default 465). Sign-in reuses
`MAILBOX_USER` and `MAILBOX_PASSWORD`. No host name is written in `src/` (the pre-flight grep).
A wrong setting never ends the process: as with a half-set mailbox, the notifier is off and the
boot log says why. Two cases: `NOTIFY_EMAIL` set while the SMTP host, the user or the password is
empty; and `NOTIFY_EMAIL` equal to `MAILBOX_USER`, because a notice that lands in the bot's own
inbox would fire the mail routine. A third case was found by live cycle 1 on 2026-09-18:
`MAILBOX_USER` must be the mailbox's full address when the notifier is on, because the notice is
sent from it. The design had assumed that the sign-in name is the address. A bare login name
signs in to the mail server (the boot check said "sign-in ok"), and then the server refuses the
sender with 501 at `MAIL FROM`, so every notice came back unconfirmed; and a login name can
never equal `NOTIFY_EMAIL`, so the "bot's own inbox" guard above could not fire. `noticeSettings`
now checks the user's shape as it checks the notice address, and turns the notifier off with a
warning that names the key. With `NOTIFY_EMAIL` empty the Runner gets no notifier and
nothing changes, so a clean clone runs as before, with any sign-in name the mailbox accepts.

**At boot.** One `verify()` that nothing waits for. It logs "notice mail: sign-in ok" or a warning
with the error code, so a wrong setting shows at start and not at 7 in the morning.

**State table** (rule of 2026-09-17: written before any change that awaits external I/O):

| State | What happens | How it is covered |
| ----- | ------------ | ----------------- |
| Confirmed | the server answers the message data with 250 | `notify` resolves `confirmed`; log line with the bot id and the need; the address is not logged |
| Anything else: sign-in refused, DNS, TLS, recipient refused, a timeout, a connection that ends | `notify` resolves `unconfirmed`. The platform does not say "lost" or "failed": a server can accept a message and the connection can end before its 250 arrives (SMTP specification, section 4.5.3.2.6) | warning with nodemailer's error code, SMTP command and response code, so the operator can tell a refused sign-in from a lost answer; one status card in the bot's chat, the same for every need: "I could not confirm that the notice mail for this step went out." The card says nothing about waiting, because a blocked or refused run has already ended and a wait can end before the outcome is known. The run and its wait are untouched |
| The status card cannot be written | `postChat` rejects inside a chain nothing awaits | the chain ends in a catch that logs; a test proves no unhandled rejection |
| Timeout | connection 10 s, greeting 10 s, socket 60 s, then `unconfirmed`. The socket limit is the long one on purpose: nothing waits for the send, and the wait for the final 250 is the one place where a short limit makes a delivered mail look undelivered | as the row above |
| Stop before the wait is registered | no wait starts | no notice: the hook sits at the registration itself (table above); a test stops a run while the takeover card is being written |
| Stop after the notice left | Stop resolves the wait; a send in flight is not cancelled | accepted and written down: the notice was true when it was sent; the page shows the truth |
| Retry | none, one attempt per need. A second attempt after a lost 250 could deliver the notice twice (the same section of the SMTP specification), and a notice is not worth that machinery | an unconfirmed notice is visible as the status card and the log line |
| Partial result | one recipient: accepted or refused as a whole | not applicable |
| Restart | boot recovery expires pending cards and ends takeovers; no notice is sent at boot, none is sent again | the next need sends a new notice |
| Server exits during a send | the outcome is unknown: the mail may or may not have been accepted, and no card or log line can say so | accepted and written down |
| Two bots need their human at once | two sends, one connection each; no pool, no queue | — |
| Several goals are refused during one hold of the screen | the first sends the `refused` notice; the others send none | the per-bot mark described under "How often a notice can go out"; a test refuses several goals in one hold, and one more in a new hold |
| A hold ends while a goal's screen check is still out, and the check then refuses the goal | the late refusal belongs to the old hold and sends nothing new; the next hold starts with no mark | the mark is reset where a hold starts, never where one ends; a test ends an idle takeover during the screen check and expects a notice in the next hold |
| The same race with no earlier refusal in that hold: the first refusal is decided after the hold has ended | no notice: "its screen is still held for you" would be false. The goal is still refused, because the page is not safe; the chat and the routine's last result say so | the hook sends only while the hold it was refused for still exists (the blocked hold, or the idle takeover), and sets no mark otherwise; a test ends the hold during the first screen check, expects no notice, and expects one in the next hold |
| The notifier throws instead of resolving | would break the wait it was called from | the Runner's helper catches it; a test proves the wait still works |

**How often a notice can go out.** The five needs are not paced alike, so they are argued one by
one:

- `approval`, `question`, `takeover`: a run holds one wait at a time, and the run pays for every
  step between two waits. A model that a web page talked into asking again and again is slowed by
  its own waits, and the run's step cap and the daily budget end it. No limit is added.
- `blocked`: once per run, and a run that reached a blocked end has spent model budget. No limit
  is added.
- `refused` is different: the refusal returns before any wait, any model call and the daily-budget
  check (`src/server/agent/runner.ts:400-427`), so it costs nothing and nothing paces it. While a
  human holds the screen, every mail event (five minutes apart at the least) and every scheduled
  occurrence would send one more notice. The hold itself can last as long as the page stays open:
  both the blocked hold and the idle takeover are extended while someone is on the screen
  (`runner.ts:209-228, 288-304`). So `refused` is limited: **one notice per hold.** The Runner
  remembers, per bot, that the notice for the current hold went out, and **forgets it when a new
  hold starts**, not when the old one ends. The reason is a race: the refusal is decided after an
  awaited screen check (`runner.ts:400-403`), and a hand-back or the presence timer can end an
  idle takeover while that check is still out (`runner.ts:221, 257-261`). A mark cleared at the
  end of the hold would be set again by the late refusal, with no hold left to clear it, and the
  next hold would inherit it and stay silent. A hold starts in exactly two places (a run that
  ended blocked keeps its keep-alive; a takeover of an idle bot begins), and both reset the mark.
  The same race has a second face: with no earlier refusal in that hold, the late refusal would
  itself announce a hold that is over. So the hook looks once more, at the moment it would send:
  the notice goes out only while the hold the goal was refused for still exists, and a refusal
  that comes too late sets no mark. That can drop one stale notice; it never silences the next
  hold.
  The hold and the mark live in memory only, so a restart clears them together. The first notice
  is the useful one ("the screen is still held for you"); a second one tells the user nothing new.

**Secrets (invariant 5).** The SMTP password is the mailbox password the platform already holds for
IMAP, under the author's rule of 2026-09-12: a bot's own accounts are the platform's to hold.
nodemailer's `logger` and `debug` stay off. The log takes the error code, not the message text.

**Tests that matter.** Through the real Runner with a fake port: each of the five needs sends
exactly one notice of its kind; two goals refused during one hold send one `refused` notice, and
a goal refused in a later hold sends a new one; a stopped run, a proposal the rules allow, an approval decided
before its wait, a manual takeover and the daily-budget refusal send none; Stop while the takeover
card is being written sends none; a port that never resolves does not delay the wait; a port that
throws, and a status card that cannot be written, leave the run working and the process alive; an
unconfirmed send posts the one neutral card for a blocked run as for a waiting one, and the card
never says that the bot is waiting. A first refusal that is decided after its hold has
ended sends nothing, and the next hold still gets its notice.
Through the real library with a transport that writes the message instead of sending it: a run
whose question, summary, label and takeover reason all hold a web address produces a mail with none
of that text, the fixed body for its need and the configured recipient. Config: the two wrong
settings turn the notifier off with a warning and the process stays up.

### Parts A and B — what Hunter learns by chat (no code)

Claude types the goal as a user would, in plain sentences, and answers Hunter's questions. Hunter
writes the skills and routines with `save_skill` and `save_routine`. Working names below; Hunter
chooses the real ones. The rule lists below are the acceptance checklist for the texts Hunter
saves: a missing rule is corrected by chat until it is there.

**The goal, in substance.** "Each weekday morning, open the result lists of startupjobs.cz and of
jobs.cz on your screen, the first two pages of each, for the roles in your memory. Keep only
offers that fit my constraints and that you have not shown me before, five at most. Read each one.
Research the company's own site for the best three. Save the shortlist as one document. Then mail
it to me from your own mailbox: a numbered list with role, company, link and one line on why it
fits, then your one recommendation and why, then the sentence that I can answer with the numbers
to apply to. Fifteen lines at most, in Czech. Do not fill in any form until I say which. Keep your
other skills as they are. My address is <typed on the day, written nowhere in the repository>."
The rules about interruptions below are added the same way, as a careful user would say them: "note
each job before you start it, so that you never apply twice if something cuts you off".

#### Skill `shortlist-and-report` (new)

1. Both result lists are opened on the screen; a posting's address is read there. `fetch_url` is
   for the text of a posting or of a company page whose address is known (decision 11). Since
   live cycle 2 (2026-09-18) the skill also holds cost rules, because the first taught run used
   all 150 computer steps before it could send: each list is opened by its search address, with
   no typing and no filter clicks; the first page of each list only; eight candidates at most
   are chosen from the titles, and an address is read only for those, by hovering over the title;
   a black screen after a page opens is waited out once; the mail is written in one go, and at
   110 steps the search stops so that twenty steps remain for the mail and its send.
2. "New" means not named in a shortlist that memory shows as sent. An offer from a shortlist that
   was never sent may appear again. A source that shows a bot check or a dialog it cannot pass is
   skipped and named in the mail. A cookie bar that does not cover the list is left alone. One
   that covers it (the second site's bar is modal, seen in live cycle 2) is never "scrolled
   past": Hunter proposes its "only necessary" button by its exact label and waits, and never
   accepts all; the gate makes that card by itself if Hunter forgets to announce the click. An
   employer's own page with a cookie dialog is not clicked at all; the posting is read with
   `fetch_url`.
3. Facts keep the source's own words, as the grounding rules of `search-job-board` say.
4. The document `shortlist-<id>.md`. The id is a code of six letters and digits that Hunter makes
   up and has not used before. It tells one shortlist from another; it proves nothing about a
   sender.
5. **Before the send is proposed**, one memory line holds the numbered list: `Shortlist <id>
   prepared on <date>: 1. <role> — <company> — <url>; 2. …; recommended: <n>.` So the numbers can
   be resolved even if the run is cut right after the send.
6. The mail is typed in the webmail; a sign-in page goes to takeover. The subject holds the id.
   `propose_action` with kind `send`, the recipient and the subject in the summary, target the
   exact label of the send button.
7. An Allow is a permission, not a send. After Allow: click the send control, take a screenshot,
   and look for the webmail's own confirmation that the mail went out. Only then the line
   `Shortlist <id>: sent on <date> <time> with the subject "<subject>"; the webmail confirmed it.`
8. No confirmation on the screen (an error, a page that did not change, a click that missed): read
   the Sent folder, as rule 10 says, in the same run. The send control is never clicked a second
   time under the same approval; a new try is a new card.
9. Not approved: `Shortlist <id>: not sent — not approved.` The platform gives the same answer for
   a Deny and for a card nobody answered within 30 minutes, so the line does not claim which. No
   retry; the shortlist card stays in the chat, and the user can say "send it" later.
10. **A shortlist with a "prepared" line and no outcome line has an unknown delivery**: the run
    was cut, or the screen gave no confirmation. Only the Sent folder settles it, and reading the
    Sent folder has three results, not two:
    - **Found:** the search ran and shows the subject with the id. `Shortlist <id>: sent — found
      in the Sent folder on <date>.`
    - **Searched and not found:** the Sent folder opened, the search ran, and nothing matches.
      `Shortlist <id>: not sent — no record in the Sent folder on <date>.` A shortlist that was
      not sent is never sent again by the bot alone; its offers are new again for the next one.
    - **Could not look:** a sign-in page, an error, a list that did not load, a search that did not
      run. No line is written and the delivery stays unknown. The chat says so, and the next run
      that needs this shortlist looks again. An empty screen is never read as "not found".
    The Sent folder is read when something needs the shortlist: the next run of this skill, a chat
    order that names it, or a mail with its id that has passed its own checks (see
    `apply-from-shortlist`). While the delivery is unknown the offers count as not shown: the user
    may see an offer twice, which is harmless; hiding an offer he never saw is not.
11. **A mail is never proof of delivery.** A mail with the shortlist's id is a reason to read the
    Sent folder, and only after the mail itself passed its checks. No "sent" line is ever written
    because a mail arrived: a mail with a guessed id and a wrong sender must not be able to mark
    a shortlist that never left, and so hide its offers from the next morning's list.

**Where the send can be cut, and what memory shows afterwards:**

| Cut | Memory | Settled by |
| --- | ------ | ---------- |
| Before the "prepared" line | nothing | nothing was proposed or sent; the next morning run starts fresh |
| While the card waits: Stop, or a restart (boot recovery expires the card) | "prepared" only | rule 10: the Sent folder is searched and shows nothing, so "not sent". A mail that names this shortlist meanwhile changes nothing (rule 11) |
| After Allow, before or during the click | "prepared" only; after a restart the platform says it cannot tell whether the approved action went through | rule 10: the Sent folder decides |
| After the click, before the outcome line | "prepared" only, and the mail is in the user's inbox | rule 10: the Sent folder shows it. The user's reply, once it passed its checks, is what makes the run look |
| The click missed or the webmail showed an error | — | rule 8, in the same run |
| The Sent folder cannot be read when it is needed | "prepared" only, still | rule 10, third result: unknown stays unknown; the next run looks again; the user can also settle it in chat |

`morning-search` runs on a schedule, and the platform does not start a cut scheduled run again at
boot (`src/server/scheduler/scheduler.ts:142-144`), so no second shortlist mail can go out because
of a restart.

#### Skill `apply-from-shortlist` (new) — the whole operation

**Input.** An order: numbers from one shortlist, from the chat or from a reply mail.

**Which shortlist.** From a mail: the id in the subject; a subject with no id that memory knows
names no shortlist, so nothing is prepared and the chat says so. From the chat: the id or the date
the user names ("today's", "Monday's"); if he names none and exactly one shortlist was sent in the
last seven days, that one; otherwise `ask_user`, naming the candidates with what their number means
("number 2 of <id> from Monday is <company A>, of <id> from today is <company B>"). A number that
is not on the shortlist is asked about in chat, and refused from a mail. The numbered list is
always there, because it is written before the send is proposed. For a chat order, a shortlist
whose delivery is unknown has its Sent folder read first (rule 10 of the shortlist skill). For a
mail, the mail's own checks come first and the Sent folder after them (verdict 3 below): a mail
is a reason to look, never proof that the shortlist was delivered.

**Reading a reply mail.** Four rules, all stricter than chat:

- The sender must be the user's address in memory. Unlike other doubts, a sender that does not
  match is not a warning: prepare nothing and say so in chat (decision 8).
- Only the user's own new text counts: the part above the quoted original. The quote starts at the
  first line that begins with ">", at a line such as "On … wrote:", "Dne … napsal(a):" or
  "Původní zpráva", or where the shortlist's own text begins again. The quoted shortlist is full
  of numbers and none of them is an order. If Hunter cannot tell where the user's text ends, or it
  holds no number, nothing is prepared and the chat says so.
- Only numbers count. Anything else the mail asks for — a link, a new job, any other action — is
  quoted in chat and not done. A number that another selection of the same shortlist already
  names is left out of a selection made from a mail, whatever its state there: open, started,
  uncertain, left or finished. The report names it. A mail never opens a second attempt on a
  number; only the chat does. The user can order it again in chat, and a chat order is done as
  asked: it is a new attempt, not finished work. (Before the review of 2026-09-18 only a number
  with an outcome was left out. Then "apply 1" and "apply 1, 2" made two open selections for
  number 1, and "leave it" for the first attempt did not stop the second.)

- An order is short. If the user's new text is longer than about 600 characters, no order is
  taken from it: the mail is closed with the reason "the text is too long for an order", and the
  chat asks for the numbers alone, by mail or in chat. The reason is durability, not taste: a
  mail is named in memory by its whole text (verdict 1), and `remember` refuses a note over 2,000
  characters (`tools.ts:244`). Without this rule a long reply could never get its selection line
  or its "Closed" line, and every later mail run would meet it again. Hunter judges the length by
  eye, and the tool is the hard stop behind that: every text up to about 1,700 characters still
  fits into one line, and if `remember` ever refuses a line as too long, the text is long and
  this rule applies. What is lost: a real order inside a long letter is not taken until the user
  sends it again, short.

**Every mail with a shortlist id belongs to this skill, and gets exactly one verdict.** The
routine sends every mail whose subject holds a shortlist id from memory here, whoever sent it and
whether it is read or unread; such a mail never goes to `handle-replies`, where a doubtful sender
would be only a warning. This skill then decides, in this order:

1. **Skip:** a memory line already names this very mail (a selection line or a closed line). A
   mail is named by four things together, because the mailbox shows a received time only to the
   minute and two mails can share it: **the sender's address, the received date and time, the
   shortlist id in its subject, and the whole of its new text** (the part above the quote,
   written in one line, with " / " where a line ends). Two mails that agree in all four are the
   same order twice, and skipping the second is right. A wrong-sender mail and the user's own
   reply in the same minute differ in the sender, so closing the first can never hide the
   second. Two replies "apply 1" to two shortlists differ in the id. Two replies that open with
   the same greeting differ in the text below it. (The first line alone, as this rule stood
   before the review of 2026-09-18, merged both pairs.) The webmail shows no stable message
   identifier on the screen, so the name is built from what Hunter can read there. One
   exception: the text of a mail from any other sender is never copied into memory, because
   memory is read into every later run and a stranger's words do not belong there. Such a mail
   is named by its sender, its time and the id alone; a second one that agrees in those is
   skipped, which loses nothing, because nothing is ever prepared for that sender. A long mail
   from the user (the fourth reading rule) is named by a bounded marker in place of its text:
   `long text of about <count> characters that begins "<its first 100 characters>"`. A marker
   names a mail only if that mail is long too and begins with the same 100 characters. So a
   marker can never hide a short reply received in the same minute: a text shorter than the
   quoted beginning cannot begin with it, and a longer one is not "long", which the size in the
   marker (thousands against a few hundred) makes plain. Two long mails that agree in everything
   else and in their first 100 characters are taken as one; that loses nothing, because no order
   is ever taken from a long mail. It was handled; say nothing about it.
2. **Close without an order:** the mail fails a check above. One sentence in chat, and the line
   `Closed on <date>: the mail from <sender> received <date> <time> to shortlist <id>, text
   "<the whole new text>" (for another sender: text not kept; for a long text: the marker of
   verdict 1), no order taken: <the sender is not the user's address / the text is too long for
   an order / no number above the quoted text / number <n> is not on the shortlist / every number
   is already named by another selection>.` A plain "thanks" ends here too. The line is separate from the selections, and it
   closes the mail for good, so no later mail run reads or reports it again.
3. **Check the delivery, only for a mail that passed its checks.** If memory holds the
   shortlist's "sent" line, go on. If the delivery is unknown, read the Sent folder now (rule 10
   of the shortlist skill). Found: write the "sent" line and go on. Searched and not found: write
   the "not sent" line, and close the mail: `… no order taken: it names a shortlist that was
   never sent.` Could not look: no verdict in this run; the delivery and the mail both stay open,
   the report says so, and the next mail run tries again. If memory holds the "not sent" line:
   close the mail with the same reason. A mail whose checks failed never gets this far, so it can
   never touch a shortlist's delivery record.
4. **Claim:** `Selection <id>/<k> on <date>: numbers <list> of shortlist <id>, from the mail
   from <sender> received <date> <time> to shortlist <id>, text "<the whole new text>"` (for a
   chat order: `from the chat`), written before any work on a number. `<k>` counts the
   selections of one shortlist. The list holds only the numbers that no other selection of this
   shortlist names; the numbers left out are named in the same line (`left out: <n>, named by
   selection <id>/<j>`).
5. **Resume:** whatever the mail was, selections with an open or uncertain number are continued
   as the state table below says, where the routine's order allows it.

**Each number, two started in one run at most.** First the line `Started on <date>: number <n> of
shortlist <id> (<url>), selection <id>/<k>.` Then, from `search-job-board`, only its rules for
reading the posting, researching the company, the dossier, the claim checklist and the letter; its
search paragraphs and its last sentence (the hand-over to `apply-to-posting`) do not apply here.
Then the site decides what follows:

- A posting on the first site: `apply-to-posting`, unchanged. It writes the outcome line itself
  ("Handed to the user on …" or "Submitted on …").
- A posting on a site whose form Hunter has no skill for: no form is opened. The outcome line is
  `Prepared on <date>: dossier and letter for <company> at <url>; the form on that site is not
  learned yet.` `apply-to-posting` is never used there: its opening button and its final button
  belong to the first site.
- Once a skill for that site's form exists (live cycle 7), the user tells Hunter in chat to use it
  for that site, and Hunter rewrites this short skill under its own name.

**The state of a number is the state of one attempt**, the number inside one selection, read
from memory. The "Started" line names its selection, so an outcome that an earlier selection left
for the same address is history, not the state of this attempt: on a new chat order it becomes a
warning on the card (`apply-to-posting` already quotes an earlier outcome for the same address),
and it never makes Hunter skip work the user has just asked for.

| State | Memory shows, for this selection | What Hunter does |
| ----- | -------------------------------- | ---------------- |
| open | the selection names the number; no "Started" line names this selection and number | start it |
| finished | the "Started" line of this selection and number, then a later outcome line for the same address | skip it; name it in the report |
| uncertain | the "Started" line of this selection and number, and no outcome line and no "Left" line after it | never apply again alone. Look in the inbox for the job site's confirmation mail for that posting. Ask once with `ask_user`: "I started number <n> on <date> and have no record of how it ended; I found / did not find a confirmation. Try again, or leave it?" On "try again": a new "Started" line, and the submit card carries the warning "an earlier attempt on <date> may have been submitted". On "leave it", or no answer: the line below |
| left | `Left on <date>: number <n> of shortlist <id> (<url>): no record of how it ended; confirmation mail <found / not found>; <the user said to leave it / the user did not answer>.` | closed. Only a new order in chat opens it again |
| covered (a selection from a mail only) | the number is open in this selection, and another selection of the same shortlist names it too | never start it. Write `Covered on <date>: number <n> of shortlist <id>, selection <id>/<k>: selection <id>/<j> names it too.` and name it in the report. Closed in this selection |

**One order per number by mail, checked twice.** The state of one attempt is read inside its
selection, so something else must stop two mail orders from working on one number. It is checked
at the claim (verdict 4 leaves the number out) and again before each start (the "covered" row).
The second check is for what the first cannot see: a chat order for the same number that came
after the mail was claimed, and a claim that went wrong. If two mail selections ever name one
number, each sees the other and neither starts it. That fails closed: the report names the
number, and the user orders it in chat. A chat order is never "covered": it is the user's own
word, given with the state in front of him.

**Where a run can be cut, and what happens next:**

| Cut | State afterwards | Next |
| --- | ---------------- | ---- |
| After the reply was read, before the selection line | the reply is read, nothing is claimed | the platform runs the routine again at boot; the reply still counts as new, so step 1 of the routine's instruction claims it; nothing is lost or repeated |
| After the selection line, before any "Started" | the reply is claimed, every number open | the boot run finds no unclaimed reply; step 4 of the routine's instruction leads it to the selection, and it starts the numbers |
| After "Started", before the card; or while the card waits (boot recovery expires the card) | uncertain; nothing was sent | the boot run reaches the selection through step 4 and asks; the question sends a notice (part C) |
| After Allow and the click, before the outcome line | uncertain; the platform's boot message says it cannot tell whether the action went through | the boot run reaches the selection through step 4, looks for the confirmation mail, asks, and never submits again alone |
| After the outcome line of one number, before the next "Started" | finished, then open | the boot run, through step 4, skips the first and does the next |
| The run fails, is stopped, or ends blocked in the same process | states stay as written; the platform fires nothing again | on the user's "continue" in chat; or through step 4 of a later mail run in which `handle-replies` proposed or booked nothing. A blocked end sends a notice |
| An interview invitation and a shortlist reply are new in the same run | the reply is claimed (step 1), the invitation is handled (step 2), the run stops (step 3) | the numbers stay open and are named in the report; the booking's confirmation mail starts the next mail run, which takes them through step 4 |
| Deny, or a card nobody answers | `apply-to-posting` writes "Handed to the user" | finished; on to the next number |
| The question about an uncertain number gets no answer | "Left" line | closed |
| An order typed in chat is cut by a restart | same states; the platform says "Send the goal again to retry" | the user's next word; Hunter reads the states first |

**Unfinished selections** are continued in two places only: a mail run in which `handle-replies`
proposed or booked nothing (the boot run of an interrupted routine is such a run), and a chat
order, "continue" included. A run that proposed or booked an interview slot never goes on to
applications; its report names the open numbers, and the next mail run or the user's "continue"
takes them. This keeps act two's run as short as it is today. The rule also stands in the
`check-mail` instruction (steps 3 and 4 under "Routines"), because that is the text a mail run
reads first.

**The report** at the end names every number: finished and how, left, prepared only, or still
open ("say 'continue'").

#### Routines

`morning-search` keeps its name and schedule and now names the shortlist skill. `check-mail` keeps
`handle-replies` as its skill. Its instruction becomes the dispatch order of a mail run, read
before either skill's procedure, because the prompt puts the routine's instruction first and
`handle-replies` closes its list at four kinds. The order, in substance:

1. Sort by shortlist identity first. Every mail whose subject holds a shortlist id from memory,
   read or unread, whoever sent it, belongs to the skill apply-from-shortlist and never to
   handle-replies. Give each its verdict as that skill says: skip, close without an order, or
   claim. A mail whose shortlist's delivery cannot be checked right now stays open for the next
   run. Do not start any number yet.
2. Handle all other new mail with handle-replies, as it is.
3. If handle-replies proposed or booked anything in this run, stop there: name every open or
   uncertain shortlist number in the report and start none of them now.
4. Otherwise look into memory for selections that still have an open or uncertain number, and
   continue them with apply-from-shortlist, the oldest first. This covers a selection claimed in
   step 1 and one that an earlier run left unfinished, whether or not any mail in this run
   belongs to it.
5. Only when steps 1 to 4 found nothing to do — no verdict to give, no other mail to act on, no
   unfinished selection — report in one sentence that nothing needs action.

The sender is not part of step 1's test, on purpose: a reply with a shortlist id from a wrong
address must reach the skill that refuses it, not the skill that would treat the sender as a
warning. Step 4 is what wires every "the boot run continues" row of the cut table: after a cut the
reply is already claimed, so step 1 skips it, and only the look into memory leads the run back to
the selection. Step 3 is in the instruction, not only in the skill, because `handle-replies` reads
all new mail as one batch and has no stopping point of its own.

Both instructions are rewritten by `save_routine` under the same name. Finding S8 of the side
proof (a "moved" routine became a second one) is checked after each change: the bot has exactly
two routines.

#### Acceptance check after the teaching

`diff` of `search-job-board`, `apply-to-posting` and `handle-replies` against
`examples/job-hunt-bot/` shows nothing. If Hunter changed one, it is told in chat to put it back,
or the text is restored in the Skills tab; both are in-product. Every numbered rule above is found
in the saved texts. When the live cycles below have passed, the new skills and the two routine
files are copied into `examples/job-hunt-bot/` (the fixture stays a copy of what ran), and the
fixture's memory gets the line "The user's own address for my reports: ask the user once with
ask_user, then remember it here."

#### jobs.cz as an apply surface (decision 9)

**Inspected 2026-09-18, posting 100015, nothing typed and nothing sent: pass.** The link
"Odpovědět" opens a form page with no sign-in, no CAPTCHA element and no frame. Fields: first name,
surname, email, phone, cover letter, a CV file input that exists in the page, a second file input,
two terms checkboxes and one opt-out checkbox. The form has two final controls, both labelled
"Odeslat odpověď": one is `type="submit"` (the gate's `submit-control` rule) and one is
`type="button"` (the `verb-name` rule: "odeslat" is on the list). A click on either stops at a
card. The form also holds two hidden trap fields for scripts (`hp_field_input`,
`hp_field_checkbox`); a bot that works by sight never sees them, a script that fills every field
falls into them. The cookie notice is a bar at the bottom with "Přijmout nezbytné" and "Přijmout
všechny"; both start with a verb on the list, so a click on either needs an Allow, and the skill
tells the bot to leave the bar alone and scroll.

The gate covers the final control, but a skill that names another site's buttons does not become
right because of that. So the form is learned the product's own way (live cycle 7): a chat goal
names one jobs.cz posting and says "fill in the form with the letter you wrote, stop before the
final button and ask me". No skill covers it, so Hunter works the form out by sight under the
platform's rules (`propose_action` with the exact label, `attach_file` for the CV, takeover for a
human check). After a run that ended at the card and on Deny, Hunter offers to save the way as a
skill of its own for that site; the user says yes. That skill's Allow branch has never run, the
same limit the README already states for the first site.

#### Live cycles before anything is believed (each recorded under `docs/evidence/`)

1. C: the first run that reaches a card sends the approval notice to the owner's inbox; a wrong SMTP port shows the boot warning and the status card.
2. A: the first Send card gets **Deny**: nothing is sent (no such subject in the Sent folder or in the owner's inbox), the run proposes nothing again, and memory gets "not sent — not approved". Then "send it" in chat makes a new card, and the taught run ends with the shortlist in the owner's inbox after one Allow. While the card waits, the "prepared" line is already in memory and no "sent" line is; the "sent" line appears only after the webmail's confirmation is on the screen. Claude opens every link in the mail. Then the saved skill runs once from the scheduler with nobody typing.
3. B by chat: "apply 2" writes the selection and "Started" lines, reaches the submit card, Deny, the hand-off line. Then a second chat order for the same number is a new attempt: a new selection, a new "Started" line, the card again with the earlier hand-off as a warning, Deny. It is not skipped as finished.
4. B by mail: (a) the owner sends two replies inside one displayed minute, "apply <x>" to each of the two shortlists, the same number and the same text. `check-mail` starts by itself; both are claimed, each selection line naming its own shortlist id and the whole text; each number is read above the quote and runs to its end (the submit card and Deny, or "prepared only" on the second site); a second `check-mail` run on the same inbox prepares nothing. (b) A reply with the right subject from another address (the dev mailbox, sent by Claude on the owner's word), timed so that it and a valid reply from the owner are received in the same displayed minute: the wrong-sender mail is closed and the owner's reply is still claimed, because a mail is named by its sender, its received time, the shortlist id and its whole new text together. For the wrong-sender mail: nothing prepared, one sentence in chat, one "Closed" line; the next mail run does not mention that mail again, and the mail never reaches `handle-replies`. The same again against a shortlist that was prepared and never sent (Stop while its Send card waited): the wrong-sender mail is closed, memory gets no "sent" line because of it, and the next run of the shortlist skill settles that shortlist as "not sent" from the Sent folder, so its offers are not hidden. (c) A repeat by mail, twice in one displayed minute: two replies to one shortlist that open with the same greeting line and then order two different numbers, both already named by a selection. Nothing is started; each mail gets its own "Closed" line with its own text; the report tells the user to order them again in chat; the next mail run is silent about both. (d) Unknown delivery: after a shortlist was really sent, its "sent" line is removed through the page's memory editor, which leaves memory as a cut between the click and the line would; then the owner replies. Pass: the reply passes its checks first, then the run reads the Sent folder and writes "sent — found in the Sent folder", then the selection as usual. The record says how the state was made. (e) An oversized reply: inside one displayed minute the owner sends a reply of about 2,500 characters that begins "apply <x>", and a second reply that is "apply <x>" alone, where `<x>` is already named by a selection. Pass: two "Closed" lines, one with the long-text marker and the reason "too long", one with the whole short text and its own reason; the short reply is not skipped as the long one; the next mail run writes no line and says nothing about either.
5. The interruption test, with overlapping replies: a reply "apply 1". Claude kills the server after the "Started" line of number 1 and before its card. While the server is down, a second reply arrives: "apply 1, 2". At boot the routine runs again by itself. Pass: the boot run claims the second reply with number 2 only, and its selection line says that number 1 was left out and which selection names it; the run reaches the first selection through step 4 of the routine's instruction; number 1 is asked about once (a question notice arrives), the answer "leave it" writes the "Left" line, and no form is filled for number 1 again, under either selection; number 2 runs to its card and Deny. A cut before any "Started" line takes the same road through step 4, with every number open.
6. Act two once more with the new `check-mail` instruction, and with an unclaimed shortlist reply in the inbox next to the fixture invitation. Pass: the reply is claimed (one selection line) and none of its numbers is started; the invitation still reaches one card and one booking; the run stops and its report names the open number. Then the booking's confirmation mail starts the next run by itself, and that run takes the open number to its card (Deny). The booking is cancelled afterwards.
7. The jobs.cz form, chat-led, on Deny: the form filled, the CV attached, a card at "Odeslat odpověď", Deny, nothing sent; then the site's skill saved and `apply-from-shortlist` corrected by chat to name it. Not on the filmed path; filmed only if the owner wants the clip.

## Demo path

Replaces steps 4–8 of the platform spec's demo path with steps 4–13 below. The platform spec's
steps 1–3 stay. Its steps 9–15 (the operator's statement, the mailbox takeover, the booking, the
calendar, persistence) follow unchanged as steps 14–20.

| # | What the viewer sees | What happens underneath |
| - | -------------------- | ----------------------- |
| 4 | Bot idle. Its ring turns to working with nobody typing; status "routine: morning-search" | the scheduler fires; the computer resumes |
| 5 | Preview: the first job board's result list on the remote screen, the bot filters and pages through it; then the second site's result list, also on the screen | computer actions for both lists (decision 11); `fetch_url` only for the text of chosen postings and company pages |
| 6 | A shortlist card in the chat: up to five offers with sourced facts and one recommendation | `write_artifact`; then the "prepared" memory line |
| 7 | Preview: the bot's webmail; a new message is typed: numbered offers, the recommendation, "answer with the numbers" | computer actions in the webmail |
| 8 | **Approval gate.** A card: "Send this shortlist to <address>". At the same moment the owner's phone shows the mail "Hunter needs you: approval" | `propose_action` kind `send`; the notifier's SMTP mail |
| 9 | Allow once. The webmail confirms the send. Cut to the owner's own inbox: the shortlist is there | the gate consumes the approval (`submit-control`); **a real mail in a real system** |
| 10 | The owner answers the mail from his own mailbox: "apply 2" | the reply lands in the bot's inbox; the IMAP watcher fires `check-mail` |
| 11 | The ring turns to working by itself; the bot reads the reply in its webmail and opens posting 2 | the routine's dispatch step, then `apply-from-shortlist`: the selection line, the "Started" line |
| 12 | Dossier and letter cards; the form fills in field by field; the CV appears in the upload field | as act one today |
| 13 | **Approval gate.** The card for "Odeslat zájem", and the notice on the phone. The owner presses Deny | the gate; the hand-off line in memory |

For filming, number 2 is an offer on the first site, where the form skill has passed live.
**Takeover** stays where it is: the mailbox sign-in (now steps 15 and 16); with part C the phone
shows "Hunter needs you: takeover" when it starts. **Artifacts at the end:** the shortlist mail in
the owner's inbox, the filled form, act two's booking.

## Invariant coverage

| # | Invariant | Mechanism, or "not touched" |
| - | --------- | --------------------------- |
| 1 | Visible remote computer | Both result lists are read on the live screen; a posting's address can be read nowhere else. The mail is typed in the webmail on the live screen. Honest limit: sending a mail is not where a visible computer earns its place (the job-selection spec said so for act two); here it is the bot's only channel to anyone, and a mailbox tool is the named upgrade (platform decision 7). |
| 2 | Real work, not simulation | Real job sites, a real mail in the user's real inbox, real notices. Nothing on the path is mocked. |
| 3 | One job, finished | Act one now ends with a delivered artifact even on Deny. The finished job is still act two's booking. An offer on a site whose form is not learned ends as "prepared", and the report says so; it is not called an application. |
| 4 | Approval before irreversible side effects | The shortlist send and every application submit stop at a card; rules stay `requireApproval: ["*"]`. A reply mail can only name numbers, and each number still ends at its card. A number with an unknown outcome is never submitted again by the bot alone. A notice is not a bot action: fixed recipient out of the model's reach, fixed text, sent only when a need starts. |
| 5 | Takeover without secrets in the transcript | A notice holds no text from the model, no screenshot and no secret. The SMTP sign-in is the platform-held mailbox sign-in, never logged. The user's address is typed into the goal and lives in the bot's memory and in `.env.local`, both git-ignored, and nowhere in the repository. |
| 6 | Persistence across sessions | The shortlist, selection, "Started", outcome and "Left" lines carry a selection across restarts, and live cycle 5 cuts a run on purpose to prove it. The notifier holds no state. |
| 7 | Configured in plain language | Parts A and B are made by chat and written by the bot. `NOTIFY_EMAIL` is operator setup on purpose (decision 5); the write-up names it with the in-product path it stands for: a settings field on the page that only the human can edit. |

## Failure modes on the day

| Failure | Detected by | Fallback |
| ------- | ----------- | -------- |
| The second site shows a bot check from the bot's address, or its cookie bar covers a control | the bot says so; or a card for "Přijmout nezbytné" | The skill skips that source and names it in the mail. Before filming, the bar is settled once by hand in a takeover (the privacy-preserving choice), as on the first site. |
| The webmail asks for a sign-in | the login page | The scripted takeover; the notice mail now announces it. |
| SMTP sign-in refused, or the port is blocked | the boot warning; a status card at the first need | Film without the phone shot; everything else is unchanged. |
| The send was allowed, but the webmail shows no confirmation | the screenshot after the click | Rule 8 of the shortlist skill: the Sent folder decides; no second click without a new card. |
| `check-mail` sorts the user's reply into one of `handle-replies`' four kinds, or ignores it | no selection line after the run; the run's report | Type "apply 2" in chat: the same skill. Correct the routine's instruction by chat. Live cycle 4 exists to find this before filming. |
| The reply mail is slow, or another mail fired the routine less than five minutes before | no run starts within a minute or two | Type "apply 2" in chat. Keep the inbox quiet before filming. |
| A link in the shortlist mail is wrong | Claude opens every link of the rehearsal mail (live cycle 2) | The search path that ends with a link the bot found itself has never run to the end live: act one passed on a posting the owner named. The bot reads an address off its screen. If cycle 2 shows a wrong link, the smallest generic fix is decided then, from two candidates: the page's address in the screenshot result's text (the companion already knows it), or links kept in `fetch_url`'s text. Not built before it is measured. |
| Hunter acts on a reply twice, or loses half of one after an interruption | two selection lines for one reply; a number with no state | The claim-before-act rule and the state table; live cycles 4a and 5 check both. Stop, and correct the skill in chat. |
| An unfinished selection is still open when act two is filmed | memory, read before filming | The filming-day check: no selection has an open or uncertain number. Step 3 of the `check-mail` instruction covers a miss in the invitation's own run; without the check, the confirmation mail's run would start an application on camera. |
| A mail run does both an interview booking and an application, and runs long | the run's step count; a second card in one run | Step 3 of the `check-mail` instruction; live cycle 6 puts both mails into one inbox to find this before filming. |
| A routine does not start because a human still holds the screen | the `refused` notice | Hand the screen back on the page. |
| The daily budget ends a rehearsal day, and the next morning's routine is refused | the status card; the routine's last result (no notice: decision 13) | The operator raises `DAILY_BUDGET_USD`, or the cycles continue the next day. |
| Sandbox will not resume, a layout changed, the model loops, the network is slow | as in the platform spec | as in the platform spec |

## Scope budget

**In:** part C with its tests; two new skills and two routine instructions written by Hunter; the
seven live cycles; the fixture copy; README (the three keys, "What has run" rows),
`docs/decisions.md` entries for the trade-offs below; an amendment note in the platform spec's demo
path; the filming-day check above added to the filming procedure in the private backlog.

**Trade-offs to write down in `docs/decisions.md`:**

- A report to the user's own address still needs a click, and the notice about that card is a
  second mail. The rules file allows by kind only, and `alwaysAllow: ["send"]` would free every
  send to anyone. It matters on the first unattended morning. Upgrade: approval rules scoped to a
  recipient. This is also the first concrete answer to the open item "what trust is earned means".
- Mail as a way to give orders cannot prove who wrote it. What is lost: someone who forges the
  user's address and knows a shortlist's id can make the bot prepare, never send, an application
  from its own shortlist, about $1.50 each, under the daily budget. It matters when the bot's
  address is public. Upgrade: the platform's IMAP reader checks the mail's authentication results.
- The notice says that the bot needs you, not what for; the page holds the details. What is lost:
  judging from the phone whether it can wait. Why: a mail must not carry text a web page could
  have written.
- The progress of a selection is a set of memory lines the model writes and reads. It is the
  platform's only persistence for a bot's own work, and act two relies on the same kind of lines.
  Each shortlist adds about a kilobyte to the memory the prompt carries. Upgrade: a small task
  record in the bot folder that the platform, not the model, keeps.
- One notice, no retry, not cancelled by Stop. No notice for a used-up daily budget.
- The notice address is operator setup, and why the shortlist's address is not (decision 5).

**Parked, with the reason:** recipient-scoped approval rules (gate code under invariant 4, not
needed for the filmed path); a link to the page in the notice (the server cannot know whether the
page is on the dev port or its own, and a wrong link is worse than none); push notifications
through a third-party service (that service would learn when and how often the bot needs its
human).

**Estimate, in the units of delivery constraint 4.** The owner's hands: about 25 minutes — the
address, a yes to the library, three lines in `.env.local`, six short reply mails (cycles 4a to
4d, 5 and 6) and one answer in chat, a yes per act-two run, perhaps one takeover for the second site's
cookie bar. Claude's work: about three hours for part C with both reviews. Live cycles: seventeen
to twenty runs, $16 to $21; $3.99 of today's $25 was spent when this was written.

## Alternatives Considered

### The bot sends the notice from its webmail

Rejected: every send needs an Allow, so the notice about a card would need a card; and at a mailbox
sign-in the bot has no mailbox.

### The notice quotes the card's summary or the bot's question

Rejected after review: a web page can put words into the model's text, a link or "click here"
among them, and quoting does not disarm them. Fixed text cannot be written by anyone but the
platform.

### `alwaysAllow: ["send"]` so the bot could mail without a card

Rejected: rules match a kind, not a recipient. It would free every send, including a reply to a
recruiter. Invariant 4.

### A tool that lets the bot set the notice address in chat

Rejected: text on a web page could talk the model into changing it, and the human would never be
called again. Same reasoning as "no tool writes `approval-rules.json`".

### A sender that does not match is only a warning on the submit card

This is what the platform's doubt rule would do, and it would spare a user who answers from his
second address. Rejected: the doubt rule is about third parties, where the user decides on the
card. Who may give the bot an order is a different question, and the answer is the user alone. A
user who answered from the wrong address gets one sentence in chat and sends it again.

### One marker written after the whole reply was handled

The first draft of this spec. Rejected after review: a restart between two applications repeats
the first or loses the second (decision 12).

### `apply-to-posting` for every site, trusting the gate to stop the final click

The first draft. Rejected after review: the gate would stop the click, but the skill would still
tell the bot to look for buttons that are not there. A site's form gets its own skill, learned in a
run (decision 9).

### Hunter rewrites `handle-replies` with a fifth kind of mail

Rejected: finding S9 of the side proof. The routine's instruction is read first and dispatches the
reply to the new skill, and the act-two skill stays the text that passed.

### A second routine on the mail event

Rejected: every mail would start two runs that read the same inbox.

### nodemailer 10.0.10, or SMTP written by hand

10.0.10: eight releases between 10 and 14 September, two weeks after a new major; its own types
are its one advantage. By hand: SMTP over TLS with sign-in is a protocol, not a function;
advisories in this very library show how header injection happens.

### A push service instead of mail

Rejected: The owner asked for mail, and a public push service would learn when the bot needs him.

## Open Questions

- ~~the owner's word on installing `nodemailer` 9.1.1 and `@types/nodemailer` 8.0.2~~ — given with the approval of 2026-09-18. `/plan` checks the versions and the advisories again on install day.
- Before filming, not before building: the webmail's compose window and the notice on the phone show the owner's personal address on camera. The owner decides whether the filmed run uses another address of his.

## Review record

Two reviews on 2026-09-18, each finding checked against the code before it was accepted. All were
confirmed.

| Finding | Source | Resolution |
| ------- | ------ | ---------- |
| A restart between two applications repeats the first or loses the second; the marker is written only after acting | relayed by the owner | Decision 12; the claim-before-act rule, the state table and the cut table of `apply-from-shortlist`; live cycle 5 |
| "Apply 2" names no shortlist; the numbered list is saved only after the send; the quoted original is full of numbers | relayed by the owner | The "prepared" line before the send; "Which shortlist"; "Reading a reply mail" |
| `apply-to-posting` names the first site's buttons and cannot cover jobs.cz | relayed by the owner | Decision 9; the site branch; the form learned in live cycle 7 |
| The notice body carries model text, which can hold a link, against the promise | relayed by the owner | Decision 10; `Notice` has no free-text field; the test with a web address in every model text |
| The takeover hook sits before `begin()`'s stop check and registration | relayed by the owner, and the design reviewer | The hook table; the callback at the registration line; the Stop test |
| "Denied after 30 minutes" is true for an approval only | relayed by the owner | One fixed body per need, minutes from the constants |
| The second source would be read off-screen | design reviewer | Decision 11; demo step 5 |
| Two refusals never reach the three closures | design reviewer | Decision 13: `refused` added, the daily-budget refusal left out with its reason; failure-mode rows |
| The status card's `postChat` can reject in a chain nothing awaits | design reviewer | State table row; the chain ends in a catch; test |
| One sentence in the routine competes with `handle-replies`' closed list | design reviewer | The instruction is a dispatch step read first; failure-mode row; live cycle 4 |
| The hard sender check contradicts "doubts are warnings" | design reviewer | Decision 8 states the exception and its principle; live cycle 4b |
| nodemailer's packaging claim was not backed by a source | design reviewer | Checked against the published file lists; wording corrected; links added |
| Suggestions: the memory-or-env asymmetry, the address on camera, refuse-or-warn in config, step numbering | design reviewer | Decision 5; Open Questions; "Configuration"; the demo path's first paragraph |
| After a cut the reply is already claimed, so nothing routes the boot run back to its open numbers | design reviewer, second pass | Step 4 of the `check-mail` instruction; the cut table names it in every row; live cycle 5's pass criteria |
| "An invitation run never goes on to applications" stood only in the skill, not in the instruction a mail run reads first | design reviewer, second pass | Steps 1 to 3 of the `check-mail` instruction; a cut-table row and a failure-mode row; live cycle 6 with both mails in one inbox |

| A mail was named by its received time alone; two mails in one displayed minute could collide | relayed by the owner on the plan | A mail is named by sender, received time and first line together (verdict 1, the closed and selection lines); live cycle 4b |
| A number's state was read across selections, so a new chat order was skipped as finished | relayed by the owner on the plan | "The state of a number is the state of one attempt"; live cycle 3's second order and cycle 4c |
| No live cycle pressed Deny on the Send card | relayed by the owner on the plan | Live cycle 2 starts with a Deny |
| Every reply was claimed, so "apply 1" and "apply 1, 2" made two open selections for number 1; after "leave it" for the first attempt, the state read "for this selection only" still let the second start | relayed by the owner on the plan, fourth round; checked against the reading rule, verdict 4 and the state table | One order per number by mail, checked at the claim and before each start; the "covered" row; live cycle 5 runs with overlapping replies |
| Sender, minute and first line still merged two orders: "apply 1" to two shortlists in one minute, and two replies that share a greeting | relayed by the owner on the plan, fourth round | A mail is named by sender, received time, shortlist id and its whole new text; a stranger's text is never copied into memory; live cycle 4a and 4c send such pairs in one displayed minute |
| A mail is named by its whole text, and `remember` refuses a note over 2,000 characters: a long reply could never be claimed or closed, so every later run met it again | relayed by the owner on the plan, fifth round; checked at `tools.ts:244` | The fourth reading rule: no order from a text over about 600 characters, closed with a bounded marker (size and first 100 characters); a marker names long mails only, so it cannot hide a short reply in the same minute; the tool's refusal is the hard stop; live cycle 4e |
| The sender of the notice is `MAILBOX_USER`, and the design assumed it is a full address. With a bare login name the boot check passed and every notice was refused at `MAIL FROM` (501) | live cycle 1, second half, 2026-09-18 (run `e2398a99`) | `noticeSettings` refuses a mailbox user that is not a plain address and names the key; a failing test first; "Configuration" above; `.env.example` and the README say so |
| Live cycle 2, finding A: the job as first taught did not fit the platform's 150 computer steps; it missed the Send card by one or two steps (13 steps on a black screen, about 40 on reading addresses by hover and zoom, about 25 on filters, 10 on cookie dialogs) | run `bbcbfb0a`, 2026-09-18 | The owner chose "teach a cheaper way by chat": the cost rules in rule 1 of the shortlist skill; the run from the scheduler then used 109 steps. Not chosen: a higher step limit, a "links on this page" tool |
| Live cycle 2, finding B: the mail watcher took a rise of the inbox's UIDNEXT as new mail, and this mail server counts message numbers for the whole account, so Hunter's own drafts and sent mails started the mail routine (three times in one evening) | runs `9a569f5c`, `436fee2c`, `b34b8335` | The owner chose "fix it now": the watcher reads the number of the inbox's own last message (commits `6c9cfbd`, `732c54b`; state table, failing test first, both reviewers) |
| Live cycle 2, finding C: the webmail wraps the plain-text part of a sent mail at about 76 characters and cuts long links in two; the HTML part keeps them whole | the sent copies of both shortlist mails, read over IMAP | Named as a trade-off: mail programs show the HTML part, where every link opened; a text-only program would show cut links, and Hunter cannot change how the webmail builds that part |
| Live cycle 2, findings D and E: Hunter has no tool to read its routines (it asked the user for the schedule and for today's date) and none to delete one (a one-off routine ends switched off, not removed) | runs `115226c4`, `d15f5790`, `0966b615` | Named for the write-up's "what I would build next"; nothing built |
| Live cycle 2: "scroll past the cookie bar" cannot work on the second site, whose bar is modal | run `bbcbfb0a`, the gate's own card for "Přijmout nezbytné" | Rule 2 of the shortlist skill is rewritten; the owner allowed that one button once, and Claude denied the same label on an employer's own page |
| A first refusal could announce a hold that ended during the screen check | relayed by the owner on the plan, fourth round; checked at `runner.ts:400-403` | The hook sends only while the hold it was refused for still exists; a state-table row and a test |
| The `refused` mark, cleared at the end of a hold, could be set again by a screen check still out | relayed by the owner on the plan | The mark is reset where a hold starts; a state-table row and a test |
| A reply that gives no order (a wrong sender, a plain "thanks") was never marked, so every later mail run would read and report it again | Claude, on re-reading the rewrite; relayed by the owner the same hour | The "Closed … no order taken" line, separate from the selections; verdict 2 of `apply-from-shortlist`; live cycle 4b |
| The dispatch step tested the sender and "unclaimed", so a wrong-sender reply went to `handle-replies`, a claimed reply missed recovery, and "nothing needs action" could be said over an unfinished selection | relayed by the owner, second round | Step 1 of the `check-mail` instruction sorts by shortlist id alone; the skill gives one verdict (skip, close, claim) and resumes; step 5 may speak only after steps 1 to 4 |
| An Allow was written down as a send | relayed by the owner, second round | Decision 14; rules 7 to 10 of the shortlist skill and its cut table; live cycles 2 and 4c |
| A mail with a shortlist's id wrote "sent" before its sender was checked, so a wrong-sender mail could hide the offers of a shortlist that never left | relayed by the owner, third round | Rule 11 of the shortlist skill; verdict 3 of `apply-from-shortlist` comes after the mail's own checks; decision 14; live cycle 4b with a prepared-but-never-sent shortlist |
| Reading the Sent folder had two results; a sign-in page or an error would have been read as "not sent" | relayed by the owner, third round | Rule 10: found, searched and not found, could not look; unknown stays unknown |
| The argument against a rate limit did not cover refused goals, which cost nothing and are paced by nothing | relayed by the owner, third round | "How often a notice can go out": one `refused` notice per hold; a state-table row and a test |
| The status card said "I am still waiting here" for runs that had ended, and a timeout was called a lost mail | relayed by the owner, second round | Decision 15; outcomes `confirmed` and `unconfirmed`; one neutral card; the socket limit raised to 60 s; checked against section 4.5.3.2.6 of the SMTP specification |

The second pass confirmed every earlier finding as closed and checked three points against the
code with no finding: the hooks can sit at the registration lines with no new await
(`runner.ts:478-495`, `takeover.ts:126-128`); no run can send two notices, or none, for one event;
the dispatch step cannot match the act-two fixture's subject. The fixes to its two new findings
were not reviewed again: the design skill allows two review rounds.
