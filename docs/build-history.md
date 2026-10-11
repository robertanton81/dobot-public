# Build history and review notes

Historical notes moved from [decisions.md](decisions.md) during its editorial revision.
They preserve the original failures, corrections and measurements. They describe the revisions
and runs named below; they are not a new verification of the current tree.

For current choices and limitations, read [decisions.md](decisions.md). For the evidence index
and the limits of each claim, read [verification.md](verification.md). References below to
product decisions such as “Two approval signals” refer to the decisions document.

## What the build week found

<!-- Filled from the plan's "Day-one results" and "Rehearsal notes" after the live checks. -->

- Day-one checks, 11 and 12 September: the companion, the token on its public port, CDP with
  Chrome's default flags, `elementAt` on the real application form and on the scheduling page, and
  the pause all passed. A computer that had been paused for 13 hours resumed with its tabs and its
  browser profile. The file upload failed: the posting's page has no file input until its upload
  button is pressed. The companion now intercepts the browser's file chooser, the way Playwright
  handles such inputs, and it clicks only an element that the platform has checked first; the CV
  was attached on the real page the next day. From the computer's address the scheduling page
  loaded freely, and a human check came at submit: four image grids on a new browser profile, one
  on a used profile. So a human check is a takeover by design and never the bot's step. Record:
  "Day-one results" in `docs/plans/2026-09-11-platform-plan.md`.
- Act-one rehearsal, on a posting the author will not apply to, always ended with Deny: three
  rounds on 12 September. The first round met four setup defects before the first message was
  typed, and a reviewer's clean clone would have hit two of them; all were fixed. The third round
  ran clean in 5 min 44 s: the form filled from memory, the letter typed with every diacritic, the
  CV attached, one announced card for "Odeslat zájem", no other card, and no failed tool (44 steps,
  $1.18). The act passed again on the EU computer on 18 September, where no computer action
  followed Deny (29 steps, $0.43; what was wrong with the letter's content is in "Act One
  verification" below), and on the batching code on 19 September ($0.72). Records: "Rehearsal
  notes" in the same plan, `docs/evidence/2026-09-18-act-one/`.
- Act-two rehearsal: four rounds from 12 to 17 September, then passes on 18 and 19 September. Round
  one finished the job: the seeded invitation started `check-mail` with nobody typing, the author
  signed in to the mailbox by takeover, the bot asked about a sender it did not trust instead of
  proposing, and the slot was booked (50 steps, $0.42). The booking took two cards, because the
  gate binds an approval to one control on one page: the first card named "Next", and the button
  that books is "Schedule Event". Round four found that Calendly's spam filter refuses every
  booking from the computer's address, a booking by hand included, so the scheduling page moved to
  Cal.com. On 18 September the act passed with an agent doing every human step that is not a secret
  (26 steps, $0.26, no human check). The takeover scene passed the same day: the run waited 15
  minutes with no step and no model call, a hand-back was refused while the password sat in its
  field, and a scan found the password in 0 of 774 files under `data/`. Records: "Rehearsal notes",
  `docs/evidence/2026-09-18-act-two/`, `docs/evidence/2026-09-18-takeover/`.
- Measured cost per run, 19 September, Sonnet 5, model cost only (computer time not included):
  act one $0.72 (37 model calls, 39 steps, 4.5 minutes); act two $0.26 for the booking run, $0.12
  for the confirmation mail's run and $0.13 for the cancellation mail's run. Where the money goes
  and what was done about it: [screenshot batching](#old-screenshots-leave-the-models-history-in-batches-not-one-per-turn).


## Two more bots, born on the page

Hunter's three demo skills are a hand-written fixture, on purpose. To show that the platform serves
work it was not built around, two other bots were made from the page's blank form and taught only
by chat. Nothing in their folders was written by hand, and nothing of their work is in `src/`.

| Bot | The job | What ran | Record |
| --- | --- | --- | --- |
| Swimmer, 18 September | Reads a swimming pool's occupancy site every morning and mails the best time to swim. | The whole cycle: a goal in one sentence, corrections by chat, the mailbox sign-in by takeover, a real mail after one Allow, two skills and two routines written by the bot, and a scheduled run with nobody typing. Twelve runs, $6.06; the run that its saved skill drove cost $0.39. | `docs/evidence/2026-09-18-side-proof/` |
| Homer, 19 to 20 September | Finds houses for sale near Prague on two property sites, researches the town around each offer (inhabitants, the hospital and its ratings, the elementary schools, public transport, sports clubs) and mails five offers. | The whole job three times, each with a real mail after one Allow. The bot wrote its own skill after the first pass and took two rounds of corrections as rewrites of it. From its skill the second pass took 216 computer steps and $5.31, against 525 steps and $8.51 for the first. The third pass, in the four parts of the corrected skill, cost $5.96: the research, report and send half fell again (to $2.80 from $3.58), and the search half rose (to $3.15 from $1.73). A fourth, partial pass showed why: it let the towns repeat and its search was dearer still, because the offers that pass the user's limits and were not yet reported were nearly used up. After the first gain from the skill, the cost follows the market, not the wording. Checked against the live sources: all 18 offers were right on price, layout and reservation, and three weak points were corrected by chat (a hospital the bot had missed, a village part given for its municipality, a garden given as the land). | `docs/evidence/2026-09-20-house-bot/` |

What the two bots showed about the product, beyond "it works":

- **A first, undirected run is dear and can deliver nothing; the bot's own skill makes the job
  cheap.** Swimmer's first readings cost $1.50 to $2 each, and the run its skill drove cost $0.39.
  Homer's first search used all 150 steps and saved nothing; told to save each offer as it went, the
  next run ended at the limit with three offers in a file. **Trade-off:** the step limit fails
  safe, but the user pays for the lesson. **Upgrade path:** when the platform tells the bot that 15
  steps are left, it also tells it to save what it has.
- **What the user says once is kept only if the bot writes it down, and a run sees the last six
  chat lines only.** Both bots lost limits that stood in the first goal; Homer asked for two links
  that stood in its own files. One sentence fixed each. **Upgrade path:** the limits of a first goal
  go to memory by a platform rule, as the answers to the bot's questions already do.
- **A page read as text never leaves the run's context.** Old screenshots leave in batches; old
  page texts stay, so a run that reads many pages pays for all of them on every later call. Homer's
  town research reached 225,000 tokens and $4.44 in one run. A user can only split the job into
  runs, and the corrected skill does that. **Upgrade path:** an old page text is replaced by a short
  note, the way an old screenshot is.
- **The gate stops a harmless search button as it stops a send button.** Six of Homer's cards were
  search buttons the bot had not announced. That is the price of failing closed with no "Always
  allow" (see [approval policy](decisions.md#two-approval-signals-and-no-always-allow-button)), and it means an unattended run of such a job waits for a human. The corrected
  skill opens result pages by their address and meets no such card.
- **A shared mailbox shows one bot's mail on another bot's screen.** Homer is signed in to the same
  mail account as Hunter, so the property site of the same provider showed the subjects of Hunter's
  test mails in a notification panel. Homer left them alone and put a warning on both send cards.
  This is the cost already named under "One computer per bot"; the upgrade path is a mailbox for
  each bot.
- **A persona cannot be corrected, and a bot cannot be removed, in the page.** The first house bot
  was created with "to rent" in its persona; the user then wanted to buy. The persona is the first
  line of every prompt and the page shows it nowhere, so the clean fix was a new bot, and the old
  one left the list only by an operator's hand. Both are gaps against "configured in plain
  language, never by engineering", and both are small: a tool for the bot to rewrite its own
  persona on the user's word, and an archive button.


## Act One verification on the EU computer, 18 September 2026

The real form, CV attachment and Deny path worked with the current streamed model adapter.
The completed run took 29 computer steps, 18 model calls and $0.4269. With an interrupted
research run, the rehearsal cost $0.5193 in model usage. No application was submitted.

The content was not ready for a real application. Hunter attached the CV without reading it.
It wrote a concrete experience example without obtaining those facts in this run. A separate
check of the PDF supported the broad experience, but did not validate the bot's process. The
letter also confused time in business with time as market leader, and the approval card gave
the wrong date for the earlier denied application. A working approval gate does not make the
draft accurate. At that point, the Act One item stayed open for a demonstrated source of CV facts
and another content check. The follow-up below closes that specific requirement.

The operator's browser inspection exposed a temporary screen password in the embedded stream
URL. The run was stopped and that credential invalidated before resuming. Future inspection
must redact authenticated URLs before they enter tool output. This was an operator failure,
not evidence that the bot model received a password. The full record and limits are in
`docs/evidence/2026-09-18-act-one/README.md`.


## Act One follow-up: sourced facts and local access, 18 September 2026

The Deny rehearsal now passes. Codex checked selected facts in the existing PDF, supplied them
through the product chat, and Hunter saved the profile and corrected its skills. After restart,
a fresh dossier and letter passed both source checking and independent review. The final card
used the right application dates. Deny caused no further computer action, and memory correctly
records that nothing was submitted. The final run cost $1.5272; all five follow-up runs cost
$2.3334 in model usage. Full preflight passed 482 TypeScript and 16 Python tests.

The first corrected draft still combined separate achievements and invented a preference.
That failure led to explicit sentence-level checks. This demonstrates why a prompt change
needs another live result, not just a wording review. Automatic PDF reading remains absent:
profile facts come through chat, and a changed CV needs updated facts. This run also received
the local date explicitly and kept the existing rehearsal phone placeholder.

The rehearsal exposed a second issue: the unauthenticated local API listened on every network
interface. Both servers now bind to loopback, and the API rejects outside Host/Origin and
cross-site requests before routes execute. Tests prove rejected requests cannot save a goal
or decide an approval. Live listener and HTTP checks passed. Local programs still have access;
this POC is not ready for network hosting without authentication.

Evidence: `docs/evidence/2026-09-18-act-one-grounding/README.md` (record omitted from this snapshot). Earlier failures remain in
their original evidence records. No application was submitted.


## Dossier delivery belongs to Hunter's skill, 19 September 2026

The user requires the dossier report in the same email as the numbered shortlist.
The previous skill explicitly limited that email to 15 lines. Hunter learned the
correction through chat: keep a short summary at the top, then include a compact
dossier for every offer, with facts, fit, concerns, unknowns and public sources.
The saved artifact and email use the same code and offer numbers.

This is a use-case rule in the example bot's skills and routine. The platform has
no dossier field, job-specific prompt rule or special email path. Send approval
and confirmation still use the existing generic tools.

Trade-off: the report is longer, but the recipient can read it without opening
the local app or a local artifact path. Research remains bounded; missing facts
are labeled instead of invented. This is a compact dossier for choosing offers;
the deeper preparation happens after a selection. If longer reports become hard
to read, the next change belongs in the skill's report format, not the platform.

Evidence: `docs/evidence/2026-09-19-hunter-mail-checks/README.md` distinguishes the
saved-instruction check from actual delivery and the remaining live checks.

### Email orders and attention notices

The platform detects mailbox events and delivers fixed attention notices. Hunter's
skills interpret shortlist replies, build dossiers and choose application steps.
The live record is `docs/evidence/2026-09-19-hunter-mail-checks/README.md`.

- Sending even a report to the owner needs approval. Allowing every `send` action
  would also allow mail to other recipients. The cost is an extra notice and click
  on an unattended morning. Recipient-scoped approval rules are the upgrade.
- Matching the visible sender address does not authenticate authorship. Someone
  who spoofs that address and knows a shortlist code could trigger paid preparation
  under the daily budget, but still cannot approve a submission. This matters when
  the bot address is public. Verified mail-authentication results are the upgrade.
- Notices use fixed text with no page content or link. The user must open the app
  to judge urgency. This keeps untrusted page text out of notification mail. A
  trusted structured urgency field could improve that later.
- Selection progress lives in model-written memory lines. Restart and overlap
  checks passed, but the model still has to interpret those records and the prompt
  grows with them. A typed task record is the upgrade if memory size or repeated
  interpretation errors become a measured problem.
- A notice has one attempt, no retry, and an in-flight notice is not cancelled by
  Stop. A spent daily budget sends no notice. Delivery failure can leave the user
  unaware; a queued, deduplicated notice with bounded retries is the upgrade.
- The attention-notice address is operator setup. The model cannot change where
  approval requests reach the operator. Hunter's report recipient is instead
  learned in chat and stored in its own memory. A dedicated trusted settings flow
  is the upgrade for notice setup.

A denied approval result means only that the action was not approved. The same
binary state covers manual Deny, expiry and Stop. The tool now uses neutral text
rather than blaming the user for an expired card. Cause-specific reporting would
require a separate reason field; the approval gate itself is unchanged.

The platform's default report style yields to a skill or routine's requested
format. It still prevents repeated work and records changed outcomes before a
new proposal. The old unconditional report instruction conflicted with a skill
that required silence about completed work. Keeping formatting in the skill
allows each bot to choose its report without adding a use-case branch to the
platform. Prompt tests cover the instruction; the mailbox replay checks behavior.


## Code review of the whole platform, 20 September 2026

Three reviewers read all of `src/`: architecture and patterns, code style, and security. Each
finding was checked against the cited lines before it was accepted. What changed:

- **`fetch_url` reads only public addresses.** The model chooses the address, and the model reads
  pages and mail that strangers write. A request from this process could reach the platform's own
  API on the loopback address: the API's guard was written against browser pages, and a server-side
  request carries a local `Host` and no `Origin` (observed: status 200). One route answers with the
  screen's stream address, which holds the stream key, so invariant 5 rested on the model never
  being talked into that request. Now the first address and every redirect are checked before a
  request goes out: this machine, private and link-local ranges, IPv6 literals and names with no dot
  are refused. One time limit covers all hops and the body, Stop ends the request, and the 5 MB
  limit holds also when the sender names no length. **Not covered:** a public name that resolves to
  a local address still connects. The platform's own API refuses that request by its `Host` header;
  another local program would not. **Upgrade path:** resolve the name first and connect to the
  address that was checked.
- **The page's development origin is trusted only under `pnpm dev`.** The origin check always
  accepted port 5173. In production that only gave a page served from `localhost:5173` by another
  project a way to write to the API blind. It could never read an answer (the API sends no CORS
  headers) or decide an approval (the ids are random UUIDs).
- **Ctrl+C pauses the computers that nobody holds.** The process had no handler for SIGINT and
  SIGTERM, so a computer inside its two-minute grace period stayed up until the sandbox's own
  timeout, up to twenty minutes later. A computer that a run or a human holds is left alone and
  counted in the log. A run is cut as before and is not cancelled: "cancelled" would acknowledge the
  event that started it, and boot recovery with redelivery is the better end.
- **Writes to `bot.json` run one after another** (see "The bot folder is the system of record").
- **Import direction.** The in-process event bus lived next to the SSE handler, so the sandbox
  manager and the runner imported from `http/`; the agent read the screen size from the E2B adapter
  instead of the port; the types that join the runner, the loop and the tools were declared inside
  the tool implementations. Each now has its own module, with no behaviour change.
- **The page uses the server's types**, imported as types only, so a field renamed on the server
  fails the typecheck instead of reading as `undefined` in the browser.

What the review tried to break and could not: the shell quoting of every model-chosen string, the
approval rules (no tool or route writes them, and a broken file means "require approval"), the
decision route (no tool can send a POST, and the ids are random), the two independent guards on a
file attach, the companion's token, and script from a model-written file (artifacts are served as
plain text). What stays open is named where it belongs: under "Pixels plus a DOM check" and "Two
approval signals" in [the decisions document](decisions.md). One more: the run log keeps the address a tool was given and the first
line of its answer. It is the operator's own record, and with `fetch_url` closed to local
addresses it no longer holds anything the operator could not already read.


## Security audit and the DNS check, 20 September 2026

An automated check of the pushed review commits, and then a security audit of the repository,
named six findings. Each fix was tested against wrong versions of the code made on purpose, and
review agents read the fixes. What changed:

- **`fetch_url` checks a name where the connection is made.** The host check read the name in the
  address, not the address the name resolves to. The tool's client is now `node:http` and
  `node:https` with a lookup of its own: the name is resolved inside the connection, every address
  must pass the range check, and the socket connects only to those addresses. The built-in `fetch`
  has no place for such a lookup without another package. Proven on the real network: a public name
  that resolves to `127.0.0.1` is refused, and public sites read as before.
- **A fetched page cannot hold the process.** Three patterns that turn HTML into text searched the
  rest of the page again from every opening that never closes. Measured: 160 KB of `<!--` took 5 s,
  so the 5 MB the tool accepts would have held the one thread of the process, with the API and
  Stop, for more than an hour. Now 5 MB of the same input takes 7 to 235 ms. One of the new log
  patterns had the same defect (200 KB: 15 s) and was fixed before it was merged.
- **A revealed password still blocks the hand-back, and the model's typing.** The check knew a
  password by `type=password` alone, so a “show password” control made a readable password pass,
  and the next screenshot would have carried it. Proven in a real browser engine, also for a field
  inside an iframe. A hint that stands among other words (`section-login one-time-code`) is now
  read as well.
- **The log hides secrets on the way out**, by value and by shape, and keeps only the start of a
  long error message.
- **A bot folder is private on the disk**: files `0600`, folders `0700`, the data folder closed at
  boot, and every `.env.*` name ignored by git except the example.

Not changed: the personal address and profile data in the committed evidence, which the author
accepts because everyone who gets access already knows them. What stays open is named in
[the decisions document](decisions.md): a secret shown as plain text on a page, and IPv4 only in
`fetch_url`.

## A provider's refusal is named as a refusal, 20 September 2026

In the house bot's fourth pass the model account ran out of credit, and the chat said "the model
stopped answering … Send the goal again to retry". A retry could not work. The refusal had come as
an error event inside an open stream. Such a response has already begun with 200, so the SDK's
error carries the error type and no HTTP status, and the function that names a refusal looked for
a status only. What changed:

- **The error type decides when there is no error status.** A table maps each of the provider's
  error types to its HTTP status, so a refusal reads the same on both paths.
- **The monthly spend cap is a refusal.** It answers 429 with the type of a rate limit, and no
  later try passes until the cap is lifted. The code in its body tells the two apart.
- **A conversation that outgrew the context window keeps the retry advice.** It answers 400, and a
  new run starts small again.
- **The server log names an error's causes by name and code, never by text.** Under the SDK's
  "Connection error." lies the system error whose code tells a refused connection from a name
  that does not resolve.

The fix was written on a branch while another session had open changes under `src/`. The merge
into `main` met two later changes: the texts of a run had moved to `run-text.ts`, and the security
audit had cut long error messages in `log.ts`. Both sides are kept. Both probes of the record ran
again on the merged code and gave the recorded output, and the pre-flight passed with 760 tests.
Not seen live: no refusal came after the fix.
[Refusal record](evidence/2026-09-20-provider-refusal-in-stream/README.md).

## Five findings of a late audit, 20 September 2026

An outside audit of `main` at `67f6826` reported five defects. Each one was first reproduced, by a
test that failed on that code or by a run of the real page, and only then fixed.

- **A takeover the user opened stayed interactive when the bot started to work.** The server ends
  the takeover of an idle bot when a goal or a routine takes the computer. The page ended only a
  takeover that a card had switched on, so the tab still said "you have the screen" and kept the
  interactive stream while the model worked. Reproduced with the real server code, a fake computer
  and a fake model, at no cost: the bot's state read `working` with a model call open, and the page
  still held the interactive stream. Now a tab that holds the interactive stream drops it as
  soon as the bot's state is `working` or `waiting`, whoever opened it, and says why in one line.
  The same rule covers a takeover during a run that another copy of the page handed back. A tab
  that pressed Take over and still waits for the bot to hand over holds no interactive stream, so
  the rule does not touch it. A tab that the takeover card had switched to the screen goes back
  without the line, as before. The server ends the card first and sets the bot's state second,
  and the two events can reach the page in one render or in two, so one function decides both
  cases; two separate rules showed the line on an ordinary hand-back when the events came together.
- **A long error message could put most of a registered secret into the log.** The message was cut
  to 2,000 characters first and cleaned second. A registered value that the cut divides no longer
  matches its registered form: the probe showed 48 of a marker's 49 characters. The message is now
  cleaned first. Cleaning 5 MB of hostile text takes about 17 ms and grows with the size, so the
  whole message can be cleaned. A message that is not text, which a library can set, is turned
  into text first, so the cleaning never throws inside a catch block.
- **A mail event could be lost while a bot's routines were armed again.** `reload()` dropped the
  bot's timers and listeners, then read the disk. An event in that gap found no listener, and an
  event with no listener is acknowledged, so the watcher moved its mark and no run started. The
  old timers and listeners now stay until the disk is read, and the swap has no await in it. The
  same change closes a second defect the probe found: two reloads at the same moment left a timer
  outside the scheduler's own list, where `stop()` could not reach it.
- **A Deny could be followed by the same card again.** The documents said a Deny consumes the mail
  event, and the scheduler acknowledged an outcome `denied`, but no code produced that outcome. A
  run in which the user denied an action and the model then failed ended as `failed`, the event
  stayed pending, and the next try proposed the same action. A run that would end as `failed`
  now ends as `denied` when one of its cards was denied; its summary keeps what failed, and the
  chat line is unchanged. Stop keeps its own path: the runner names a stopped run `cancelled`.
- **The budget card did not name an approved action that worked.** The card names an approved
  action done in the last two steps, because the bot did not see its result. Only the path where
  the computer gave no answer recorded that action; the usual path, where the click went through,
  did not.

| Case after a Deny in a run that mail started | Before | Now |
| --- | --- | --- |
| The model ends its turn | `done`, event consumed | the same |
| The model, the provider or the computer fails | `failed`, event tried again, same card again | `denied`, event consumed |
| The card is not answered in 30 minutes (it reads as denied) | as the two rows above | the same rule |
| Stop | `cancelled`, event consumed | the same |
| The run then ends stuck or over its budget | consumed | the same |
| The server restarts before the run ends | the event fires again at boot | the same: no result was returned, so nothing was acknowledged |

**What this costs.** When a disk read fails during `reload()`, the timers and listeners armed
before stay armed; before, nothing stayed armed. A stale timer reads its routine from disk when it
fires, so a routine that was turned off does not run. A restart between a Deny and the end of the
run still repeats the event, as any unacknowledged event does. The interactive stream's address
stays valid after the page drops it: the page ends the human's input, the server does not
revoke the address.

The pre-flight passed with 775 tests. Not seen live: none of the five paths ran against a real
computer or a real model after the fix.
[Audit record](evidence/2026-09-20-audit-five-findings/README.md).

## Six fixes from the deep review, 20 September 2026

A review of all of `src/` on the evening of 20 September left a list of open findings. The six
that could show on the filmed path, or lose the bot's computer, were fixed the same evening. Each
fix has a test that fails on the code before it.

- **Typed text could press a button that the gate never read.** The gate checked a `type` action
  only for a newline, and it read the focused element once, before the text was typed. A Tab inside
  the text moved the focus to the next control, and the next space or Enter activated it with no
  card. Now a Tab character inside typed text is refused (the model presses Tab as its own key
  action, and the gate reads the new focus before the next action), and text with a space is
  refused while a button holds the focus. The refusal needs no extra call: the secret guard
  already reads the focused element for every `type`.
- **A short E2B error during a resume made the platform forget the computer.** The SDK reports
  HTTP 429, 502, 503 and 504 on a command as `SandboxNotFoundError`. The manager caught that error
  around the whole connect sequence, cleared the sandbox id and built a new computer, and the real
  one stayed on E2B with every login. Now only the connect call itself can say that the sandbox is
  gone; the same error from a later step is a failed start that keeps the id.
- **A failed mail-triggered run was retried every five minutes with no end**, also after a
  provider's refusal, where the chat already said that sending the goal again would not help. Now a
  failure that a retry cannot help consumes the event at once, and any other failure is handed back
  at most three times in a row.
- **A long answer or a long page address ended a finished run as `failed`.** The chat schema
  enforced its length limits by throwing. Now the chat store cuts a card's display fields to the
  limits, and the runner posts text longer than one message as several messages, so nothing is lost.
- **A goal that the daily budget refused took a held screen away from the human.** The budget check
  came after the held keep-alive was dropped and the takeover card was ended. It now comes first,
  and a refused goal leaves a blocked bot as it was.
- **Take over pressed late in a run left the tab in a false takeover mode.** When the run ended
  before its next model call, no takeover happened, and the tab said "you have the screen" over a
  view-only stream with Stop hidden. The rule in `takeover-view.ts` now takes that tab back to
  watching and says that the run ended first.

**Evidence and limits:** unit and loop tests with fakes; pre-flight green. None of the six has run
against a real computer, a real model or a real mailbox. The other findings of that review are
still open.

## More fixes from the deep review and the audit's open list, 20 September 2026

The same evening, a second batch closed the other findings of the deep review that a user can meet,
and five known defects that the audit of the same day had left open. Each fix has a test that fails
on the code before it; the page changes were also checked in a real browser with the no-cost probe
(the real server code, a fake computer and a fake model).

- **The page went back into takeover mode right after a Hand back.** The hand-back answers before
  the card's end and the bot's new state reach the page, so for a moment the page still held "card
  active" and "blocked" and switched back. The tab now remembers the card it handed back, and a
  stream answer that arrives after the tab left takeover mode is dropped. Browser check: 60 samples
  over three seconds after Hand back, no return to takeover mode and no error line.
- **A refused Hand back showed "http 409".** The server sent the reason under another key than the
  page reads. One key now.
- **The send shortcut and numeric key names passed the gate.** Enter with Ctrl or Meta inside a mail
  body, a textarea or text edited in place is a rule hit (`send-shortcut`). A key is taken by its
  name only: a key code or a key symbol in numbers is refused, and the keypad space, Linefeed and
  ISO_Enter count as activating keys.
- **A held computer that stopped answering could not be repaired from the page.** A hand-back or a
  goal now brings it up once, under the hold that exists, and asks again; the two-second poll does
  not. Takeover mode shows Stop while a job waits for the hand-back, and only then: after a run
  that ended with an open takeover card there is nothing to stop, so the button is not shown.
- **An idle takeover was lost for good after a minute in another tab.** The tab's next question
  takes the hold again, so the computer does not pause under the user's hands and a goal still
  checks the screen first.
- **One bot's odd file could stop the boot.** A routine's stored state is read by the record's own
  keys (a routine may be named `constructor`), the lists skip files whose name is not a valid name,
  and the boot arms each bot on its own.
- **A zoomed page made the gate read another element.** The mapping from a screen point to the page
  holds at 100 % zoom only, so a zoomed page now answers "unknown", which asks the user for every
  activation. A file is no longer put into the first file input of a form that holds several.
- **The `new-password` hint stopped the bot from filling plain fields.** Many pages put that hint
  on text fields only to switch autofill off. It no longer stops typing; it still holds the
  hand-back while such a field has a value.
- **An unknown model id cost $0**, so the daily budget never ended a day. A dated form of a known
  model takes its price; any other id counts at the dearest known price.
- **A save in the Skills tab erased what the bot wrote meanwhile.** The page sends the text it
  loaded, and the server refuses the save when the stored text differs. Saved memory ends with a
  line break.
- **From the audit's open list:** the reloads of one bot run one after another, so two saves close
  together end on the newer schedule; a reload arms nothing after `stop()`; a finished run keeps
  its result when the state write after it fails; outside text is cleaned before it is cut for an
  error message.

**Evidence and limits:** unit, loop and HTTP tests with fakes, two browser checks, pre-flight green.
None of this has run against a real computer, a real model or a real mailbox. Changes to the gate
and the page script are believed only after a live run. Still open from the audit's list: a restart
between a Deny and the end of its run repeats the mail event (written as a trade-off in
`docs/decisions.md`). The lower findings of the deep review are open.

## Old screenshots leave the model's history in batches, not one per turn

Every model call carries the run's conversation, screenshots included, and the provider's prompt
cache makes a call cheap only while the beginning of that conversation is unchanged. The first
rule kept the last three screenshots and replaced the oldest one after every turn. That edit sits
early in the conversation, so almost every turn wrote the whole conversation to the cache again, at
1.25 times the input price. Measured on 68 recorded runs (1,137 model calls, $23.99): cache writes
were 69% of the model cost. Anthropic's reference loop for computer use removes images in chunks
for the same reason. Now up to 13 screenshots stay; the fourteenth removes the oldest ones down to
three in one pass. Text that came with a removed screenshot stays, so a warning is never lost
with its image.

A replay of the recorded runs estimated 35 to 40% less model cost. Live, on 19 September, on the
code that is filmed: the same act-one job cost $1.53 the day before and $0.72 now (37 calls, all 34
judged calls reuse the cache, one removal in the run). Six runs on the new rule cost $0.0179 per
call with 44.7% of it in cache writes; the 24 runs on the old rule that came before them (14 on 18
September, 10 on the morning of 19 September) cost $0.0376 per call with 72.6%. The mail runs
measured here held at most 9 screenshots, so nothing was removed. The booking run cost $0.26 on both
days; the confirmation run cost $0.12 against $0.07, with 11 steps against 5. One job measured twice
does not confirm a percentage, and none is claimed: the estimate stays an estimate. One manual
takeover of two and a half minutes in the middle of a run did not disturb the cache: the first call
after the hand-back read the entire cached part of the previous prompt from it. A takeover longer
than the cache's five minutes loses it, under either rule. The record, with the failed first attempt
and the acceptance check item by item:
[docs/evidence/2026-09-19-cache-batching](evidence/2026-09-19-cache-batching/README.md).

The idea this replaced was a model router: send easy runs to a cheaper model. Measured ceiling:
1.5% of the bill. Runs that never touch the computer are 3% of the spend, the half-price model
cannot use the computer toolset, and Sonnet 5 is already the cheapest model that can.
**Trade-off:** up to ten more old screenshots travel in every request, so a call reads more
cached tokens and the model sees more history when it decides. The median turn in the long run
was 4.3 s, under the 6.8 s limit taken from the old rule's runs, and no run showed an action on a
stale screen; that is based on six runs, one of which crossed the limit. When a removal happens, that
one call writes the conversation again (26,590 tokens in the measured run). A wait for a human
that outlasts the cache's five minutes loses the cache under either rule; the approval and the
takeover are never shortened to save money. **Fallback:** one constant, `IMAGE_PRUNE_LIMIT = 3`,
restores the old rule. **When it would start to matter:** a job with many more screenshots per
run; then measure again, the scripts are in the evidence folder.

## Built-in connectors: a service's API before its web page, 24 September 2026

Invariant 8 was extended on 24 September: a run uses a service's API or MCP server before its web
page. Milestone 1 of the [connectors spec](specs/2026-09-24-connectors-design.md) added four
built-in connectors (Wikipedia, Mapy.com, Cal.com public pages, the bot's own mailbox), a gate
that stops every connector write at an approval card, a Connect card the bot posts in the chat,
and a prompt rule that orders the channels. The [plan](plans/2026-09-24-connectors-m1-plan.md) ran
as nine tasks with a spec check, a code review and a test review each; they found and fixed five
blocking defects: a secret test that never saw the real log line, a Stop test that never reached
its Stop check, service answers read without a schema, a card that could show a cut text while the
full text was sent, and outgoing mail from the bot's mailbox that did not require TLS.

Live, the bots used the connectors, but only after a correction in the chat: an explicit line in a
bot's own skill ("open Mapy.cz on the computer") beat the new channel rule in the prompt. After
the correction, a town research ran with no computer step at $0.39 against baselines of $0.55 to
$1.93, and an invitation was read and a booking proposed with no computer step. The mail run cost
$0.44 against a $0.26 baseline, because it granted two connectors in one run and each grant
rewrites the prompt cache. [Evidence](evidence/2026-09-24-connectors-m1/README.md).


## Two defects from the architecture review, 25 September 2026

An outside [architecture review](evidence/2026-09-25-architecture-review/README.md) reproduced two
defects with offline probes; both are fixed.

- **An approved write whose outcome is unknown.** A connector write that timed out or was stopped
  reached the model only as text. The run could then end as a plain `failed`, which the scheduler
  tries again, or as `done`. The computer path had the same gap after an approved click got no
  answer. Now both paths share one record, and a run that fails or finishes after such a write ends
  as `unknown` and final: no automatic retry, and no `done` for a result nobody confirmed.
- **A Skills-tab save could erase a bot's note.** The route compared the base text and wrote in two
  steps. The store now does both inside the file's write chain, for memory, skills and routines.

No live run: both fixes are proven by tests through the real loop, gate, route and file store.
