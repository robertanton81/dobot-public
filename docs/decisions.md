# Decisions, trade-offs and what comes next

Dobot tests whether a bot with memory, reusable skills and its own visible computer can finish
useful work under human control. This document explains the choices, their costs and their limits.
The [verification summary](verification.md) links to real runs. Detailed rehearsal notes and
measurements are preserved in [build history](build-history.md).

The main choices are a computer per bot, conversation-based setup, approval before external
actions, and a small local platform. State survives restarts, but there is no durable execution:
an interrupted run cannot continue from its last step.

## The job: a job hunt, with the loop closed by a real booking

Hunter finds opportunities, researches companies, prepares applications and handles interview
invitations. The job needs persistent preferences, browser interaction, recurring work and a
clear decision before sending anything. It exercises those capabilities in one workflow.

Application preparation ends at an approval card naming the action and its consequences.
Testing used **Deny**, so no job application was sent. Preparation, attachment and Deny worked
on startupjobs.cz and jobs.cz. Interview invitations were supplied by the author; the resulting
bookings were real. The scheduling site moved from Calendly to Cal.com after Calendly refused
bookings from the remote computer's address.

**Trade-off:** seeded invitations make the test repeatable, but do not prove a real employer's
reply was handled. Denying applications avoids unwanted submissions, but leaves the Allow and
submission paths unverified on both sites. See [verification limits](verification.md#what-this-does-not-establish).

## Product decisions

### One computer per bot, not one per user

Each bot has its own desktop, browser profile, logins and files. This differs from Grok Bot's
shared user computer: a new bot does not automatically receive every other bot's accounts.

**Trade-off:** signing in again becomes inconvenient when a second bot needs the same account.
Separate computers also do not isolate a deliberately shared account: Hunter's mail subjects
appeared on Homer's screen because both used the same mailbox. Bot-to-bot communication is not
built. The intended hand-off is a message with an artifact, not a shared drive.
**Upgrade:** separate mailboxes and explicit, approved grants for any shared login.

### The bot has its own mailbox and writes its own address into forms

Replies arrive in the bot's dedicated mailbox. The demo mailbox forwards copies to the user;
the user's own inbox needs no forwarding rules. Bot-account credentials may be held by the
platform for the mail watcher. The user's credentials stay outside the platform, and the model
must see neither kind. Passwords and human checks are completed on screen through takeover.

**Trade-off:** employers see the bot-managed address, and mailbox setup needs the operator.
This matters when presenting the bot as acting for a real applicant. **Upgrade:** a trusted
account-setup flow with a masked secret form and a separate mailbox per bot.

### The mail routine waits for mail, it does not poll with a model

An IMAP watcher detects new mail without paying for a model run. It reads mailbox metadata,
not message bodies; the bot reads messages in its browser. The watcher persists its position
using message identities actually present in INBOX, so retained mail that arrived during downtime
can trigger work after restart. Each routine saves its own acknowledgement.

Failed, unknown or missing results stay pending and retry after five minutes, at most three runs
in a row for one routine; after the third failure the event is consumed and the routine's last
result says so. A failure that the same goal would meet again (a refusal by the provider or the
model, a full context, an answer cut off twice) consumes the event at once. The count lives in
memory, so an event that comes back after a restart gets its three tries again. Completion,
Stop, Deny, human-intervention outcomes and budget limits consume the event. A run that fails
after the user denied one of its actions ends as `denied`, not as `failed`: another automatic try
would put the same card in front of them. Blocked work then needs a chat follow-up or new mail;
automatic retries must not repeatedly take a held screen.
Connection errors close the client and retry later without ending the server.

**Trade-off:** one configured mailbox per process. A crash after partial work or before saving
its acknowledgement can repeat work. While the process lives, failed acknowledgement writes
retry without rerunning the routine. The unseen-count fallback cannot provide the same recovery
guarantees as stable message identities. **Upgrade:** per-bot mailboxes and individual message
records when batch recovery is insufficient. [Mail recovery evidence](evidence/2026-09-19-email-trigger-fixes/README.md).

### Pixels plus a DOM check

The model sees screenshots and operates the desktop. A Python companion inspects the DOM,
the browser's representation of the page, before an activation. It identifies controls under
the cursor and attaches files through the browser's file-input API. Unknown targets, including
unreadable cross-origin frames, require approval.

**Trade-off:** the companion adds another runtime. Inspection trusts what the page says and
cannot identify browser overlays such as permission bubbles or native menus; it may describe
the page element underneath. A JavaScript confirmation dialog blocks inspection and therefore
requires approval. **Upgrade:** detect overlays or changed window geometry and treat affected
clicks as unknown targets.

### Two approval signals, and no "Always allow" button

The model must announce irreversible actions with `propose_action`. Independently, the platform
checks clicks, Enter, Space and typed newlines against generic control rules. An approval covers
one control on one origin and path, is consumed once, and remains valid for up to ten steps.
The gate reads the control again after approval; if it changed, nothing is clicked. Repeated
activations such as double clicks or repeated Enter are refused before an approval is spent.
Typed text cannot stand in for a key press: a Tab character inside typed text is refused, because
it would move the focus after the gate read the focused control, and text with a space is refused
while a button holds the focus. **Limit:** when the companion cannot read the focused element (an
embedded frame of another origin), typed text goes through, so that forms inside such frames can
be filled; clicks and Enter there still need a card.

`requireApproval` wins over `alwaysAllow`. No bot tool or API route writes the standing rules.
There is no “Always allow” button because current rules match button labels: allowing “Send”
would not constrain the recipient. Even a report to the owner needs approval.

**Trade-off:** harmless search buttons can stop an unattended run. The independent check reduces
reliance on the model, but is not a complete security boundary:

- A hostile page can describe its final control in a way the generic rules miss. If the model
  also fails to announce it, the action is unguarded.
- `open_url` is not an approval point. A confirmation, cancellation or unsubscribe link that
  acts when opened can take effect without a card in the signed-in browser.
- Enter with Ctrl or Meta inside a text (a mail body, a textarea) is gated as the send shortcut. Other
  send shortcuts, such as `alt+s`, are not gated activations, and a plain Enter inside edited text
  is treated as a line break, although some chat pages send on it.
- The gate maps a screen point to the page at 100 % zoom only. A zoomed page answers "unknown",
  so every activation on it asks the user; the fix is to set the zoom back, not more cards.
- The typing guard ignores the `new-password` hint on a plain text field, because many pages use
  it only to switch autofill off. A page that turns a new-password field into such a text field is
  then typed into like any field; the hand-back check still counts its value as a secret.
- Treating page, mail and file text as data is a prompt rule. Prompt injection, where that text
  tries to redirect the bot, has no dedicated live adversarial proof here.
- Manual Deny, expiry and Stop share one denied result. The report cannot reliably name the
  cause without a separate reason field.

**Upgrade:** gate risky navigation and modifier shortcuts, accepting more approval cards;
add narrow permissions verified by the platform, as described under “What I would build next”.

### Takeover with a hand-back check enforced by the server

Takeover keystrokes go directly to the remote computer through noVNC. Hand-back is refused while
a password or code field contains a value, or focus is inside an unreadable frame. After a
secret-related takeover, the page must also change. “Hand back anyway” can lift only that
page-change requirement, not a populated secret field or the unreadable-page check. A password
field stays one after a “show password” control has turned it into a text field: the page script
remembers the fields it has seen as passwords, and knows a replaced field by its password-manager
hint or by a name that ends in the word. The guard that keeps the model from typing into a
password field reads the same answer.

Checking the focused frame avoids blocking forever on an unrelated advert or CAPTCHA frame.
**Trade-off:** a code left in a cross-origin frame can evade the check if focus moves away and
the page changes. Closed shadow roots are not detected. An unchanged sign-in page may need the
logged override. The same guard applies to new goals while a blocked computer is held awake.
The name rule can take a plain field for a password; the cost is one step, because hand-back
waits until that field is empty. A secret that a page shows as plain text, such as a recovery code
or a new API key, is no input field, and this check cannot see it.

The person never types while the model acts. The server gives out the interactive stream only
while the bot is idle or blocked, and the page drops it as soon as the bot's state says the bot
acts again: a goal or a routine took the computer of an idle bot, or another copy of the page
handed back. **Trade-off:** the page ends the person's input, the server does not. The stream's
address stays valid, so a copy of it opened outside the page would still accept input.
**Upgrade:** restart the stream with a new key when control returns to the bot.

**Known gap:** that requirement does not survive sleep or a server restart. A secret left on
screen could enter the next run's first screenshot. **Upgrade:** persist the need for a screen
check, or clear the page before sleep. See [takeover limits](operating-guide.md#screen-controls-and-approvals)
and [live evidence](evidence/2026-09-18-takeover/README.md).

### The bot folder is the system of record; the sandbox is a cache

Identity, memory, skills, routines, rules, chat, runs and artifacts live in `data/bots/<id>/`.
There is no database. Workspace files are uploaded before every run; a failed copy fails startup.
A lost computer is rebuilt from local files. Logins and files saved only on the remote computer
are not restored. Backups of `data/` are the operator's responsibility.

Bot files are created for the owner of the process alone (`0600`, folders `0700`), and at boot
the server closes the folder above all bots, which also covers a bot folder copied from
`examples/`. Writes to shared local records are ordered within the process. **Trade-off:** no transaction
across files, replication or cross-bot query layer. Multiple processes cannot safely share the
store using those in-process write controls alone. **Upgrade:** SQLite or Postgres behind the
same store interface when transactions or multiple workers are needed.

Memory is model-written prose. Each run receives memory and skills, plus up to six recent chat
messages with length limits. A constraint never saved to memory can be lost. Preventing repeated
work depends partly on the model interpreting its notes, not on a structured task record.
**Upgrade:** save initial constraints explicitly and use typed task state when interpretation
errors or memory growth justify it.

### One long-running process, not serverless

One Node process runs the API, agent loop, scheduler and mail watcher. A scheduled worker needs
to be alive when its schedule fires, and a run can last many minutes or wait for the user.
Keeping these together avoids a separate worker service and queue in the POC.

**Trade-off:** one process is a single point of failure. Persistence is not durable execution:
after a restart, unfinished runs and pending cards close rather than resume. If an approved
action may have happened, recovery reports an unknown outcome. A retry needs to check the
external result first. Normal shutdown pauses unheld computers; held computers reach their own
timeout. [Recovery behavior](operating-guide.md#saved-state-and-recovery).

**Upgrade:** a separate worker with a persistent queue and recoverable workflow checkpoints.
A queue alone cannot make browser submissions happen exactly once. Recovery must reconcile
uncertain outcomes before repeating external actions.

### Users never write skills; the bot does, after a run that worked

The bot asks only for missing parts of a goal, one question at a time, and saves answers to
memory. After successful work it offers to save the procedure as a skill. Scheduling is a
separate choice. Corrections rewrite the existing skill; routines can be paused, resumed or
rescheduled through chat. A generated skill cannot grant itself permissions.

**Trade-off:** this behavior depends on prompt instructions. Tests prove persisted instructions
reach later runs; live checks establish whether the model follows them. A skill cannot add
missing capabilities such as arbitrary code execution or another event source. Hunter's original
demo skills are hand-written fixtures. Fresh-bot learning was checked
[separately](plans/2026-09-15-learning-gap-plan.md), and Swimmer and Homer learned through chat.

Persona correction and bot archiving are absent from the UI. Mailbox setup and manual computer
rebuilds still require an operator. **Upgrade:** add those flows without making users edit bot
files. See [lessons from the additional bots](build-history.md#two-more-bots-born-on-the-page).

### The platform's text knows nothing of one bot's work

Shared prompts, tools and runtime code contain no job-specific sites or instructions. A bot's
persona, memory and skills define its work. Preflight checks source text, and a prompt test uses
a bot with unrelated work. Live runs checked the neutral wording on both demo acts.

Approval behavior is shared: doubts belong on the approval card, and work recorded as complete
is not proposed again without a new reason. Report format belongs to the skill or routine.
Hunter's emailed dossiers therefore required a skill correction, not a platform feature.

**Trade-off:** shared rules and task-specific restatements can drift. Source checks prove the
wording supplied to the model, not its behavior. **Upgrade:** check example skills when changing
shared rules and repeat affected live runs.
[Platform-boundary evidence](evidence/2026-09-19-platform-boundary/README.md).

### A run can be read on the page, from the record it already wrote

The Runs tab reads `events.jsonl` and saved screenshots. The record includes goals, actions,
tool results, approvals, takeover and model costs. Reusing it avoids a separate tracing system.
Cost stays in the operator's record; the UI does not present it as a customer bill.

**Trade-off:** the list reads all run logs on each request, measured at 30 ms for 154 runs.
Tool results and model text are shortened, and signed thinking blocks are omitted, so logs
cannot reconstruct the exact model request. Costs still reach the browser in those records;
a product with separate users must filter them at the server.
**Upgrade:** a per-bot index for larger histories and secret-free replay inputs for evaluation.

### Limits bound runs, but do not guarantee a finished artifact

Runs have limits on computer steps and model calls. A no-progress guard warns after 16 and 28
steps without new evidence and stops at 40. Those thresholds came from one bot's recorded runs;
another kind of work may need different values. The daily model budget is checked before a run,
so work already in progress can exceed it. Computer costs are separate.

**Trade-off:** Homer's first search reached its limit without saving a result. Longer research
also retains old page text, increasing context and cost even after screenshots are removed.
**Upgrade:** save partial results before limits, replace old page text with notes, and measure
per-bot progress thresholds when another workflow needs them.
[Loop measurements](evidence/2026-09-17-loops/README.md),
house-search evidence (record omitted from this snapshot).

### Old screenshots leave the model's history in batches, not one per turn

Prompt caching reuses an unchanged beginning of the conversation. Removing one screenshot every
turn changed that beginning repeatedly. Cache writes accounted for 69% of model cost in the
68-run measurement. Now up to 13 screenshots remain; the fourteenth removes the oldest down to
three. Accompanying text is preserved.

**Trade-off:** requests carry more old images and cached tokens. Each removal still causes a
cache rewrite, and a long human wait can outlast the cache. Approval and takeover waits are
never shortened for cost. Six live runs supported the change, but only one crossed the removal
threshold, so the replay estimate of 35–40% savings is not a proven general reduction.

Model routing was rejected for this measured workload: eligible whole runs suggested only
about 1.2–1.5% gross savings before overhead or quality effects. Revisit it when eligible spend
changes. **Fallback:** `IMAGE_PRUNE_LIMIT = 3` restores the earlier retention policy.
[Cache evidence](evidence/2026-09-19-cache-batching/README.md) and
[detailed measurements](build-history.md#old-screenshots-leave-the-models-history-in-batches-not-one-per-turn).

### Local access, public-page fetching and fixed notices

The unauthenticated app binds to loopback and rejects outside Host/Origin and cross-site
requests. The development origin is accepted only in development. **Trade-off:** local programs
still have access; this is a single-operator POC, not a network-hosted multi-user service.
**Upgrade:** authentication and user isolation before network hosting.

`fetch_url` checks the initial address and every redirect, rejects literal local and private
addresses, and limits time and the size of the decoded response. A hostname is checked again
where the connection is made: the tool's network client resolves the name itself and connects
only to addresses that passed the same range check, so a public name that resolves to a local
address, or changes its answer between two questions (DNS rebinding), is refused. The HTML
reader takes time that grows with the page's size, not with its square, so one fetched page
cannot hold the process. **Trade-off:** the client asks for IPv4 addresses only, so a host with
only an IPv6 address cannot be read; and `fetch_url` runs on the operator's machine, so a site
the bot reads sees the operator's network address. **Upgrade:** the same check for IPv6 ranges.
[Review record](build-history.md#code-review-of-the-whole-platform-20-september-2026),
[audit record](build-history.md#security-audit-and-the-dns-check-20-september-2026).

Every log line is cleaned before it is written: the configured keys and the keys a session
makes by their value, and the shapes a credential has inside a text, such as a key in an
address or a bearer token. An error's message is text from outside, so only its start is kept,
and the causes under an error are logged by name and code, never by their text.
**Trade-off:** patterns miss a secret with no known shape, and they blank a harmless word after
`token:`. The first layer stays the rule that no caller logs a secret.

Attention notices contain fixed text, no page content or link, and use an operator-set recipient
the model cannot change. **Trade-off:** the user must open the app to judge urgency. A notice has
one attempt, no retry; Stop does not cancel an in-flight send, and daily-budget refusal sends no
notice. **Upgrade:** queued notices with bounded retries and duplicate prevention.

A visible mail sender is not authenticated authorship. A spoofed owner address and known
shortlist code could trigger paid preparation within the run-start budget check, though they
cannot approve submission. **Upgrade:** verified mail-authentication results before trusting
email orders. [Mail checks and limits](evidence/2026-09-19-hunter-mail-checks/README.md).

### Connectors: a service's API before its web page

A connector is a fixed set of tools a bot can call without its computer. The first four are built
in: Wikipedia (text and coordinates of an article), Mapy.com (coordinates, road distance and time),
Cal.com public pages (free times, and a booking), and the bot's own mailbox (read as text, send).
Each tool is marked read or write in code. A read runs at once. A write stops at an approval card
every time, with the tool and its full arguments on the card, and `approval-rules.json` cannot
switch that off. The approval is used up before the call, so it can never cover a button on a
page. Design: [connectors spec](specs/2026-09-24-connectors-design.md); plan:
[milestone 1](plans/2026-09-24-connectors-m1-plan.md).

Connections are per bot. Wikipedia is on for every bot, because it reads public text and holds no
account. The other three each need one Connect click on a card that the bot posts in the chat.
Grok Bot shares connectors across the account; per-bot connections mean a prompt injection in one
bot reaches fewer accounts.

A connection granted in the middle of a run is usable in that same run. The tool list sits at the
front of the prompt cache, so each grant rewrites the whole cache once. Measured on 24 September:
a mail run that granted two connectors wrote about 126,000 cache tokens and cost $0.44, against
$0.26 for the same job on the computer; the town research, with the connection already granted,
cost $0.39 against $0.55 to $1.93. A later mail run with both connections already granted cost
$0.34: no rewrite, no computer step, but most of its cost was the model's thinking about a second
copy of the invitation. So connectors save model cost where the computer work was long (the map,
the pages of a search); where the computer work was short and the thinking dominates (one booking),
they remove the computer steps and the sign-in, not model cost.
**Upgrade:** grant a connection before the run that needs it (on the Connect card outside a run,
or at the start of the next run), so no run pays the rewrite in its middle.

**Trade-offs:**

- A bot with the mailbox connector reads its mail through the platform over IMAP, not in webmail
  on its screen. The user no longer watches that part of the work on the computer; the Runs tab
  and the chat still show each read. In exchange, the largest cost of the mail routine goes away.
- A bot follows its own skill before the platform's channel rule: a skill that says "open the
  map on the computer" wins over "use a connector first". Live, both bots used the computer or
  asked for it until the user corrected the skill in the chat. **Upgrade:** when a bot gains a
  connector, it offers to rewrite the skills that name the same service.
- The bot's computer still starts at the beginning of every run, even when a run needs only
  connectors. Sandbox hours do not fall yet. **Upgrade:** start the computer on the first computer
  action, with its own state table (start failure, Stop during the start, takeover before it).
- A built-in connector names its service, which the platform's text otherwise never does. The
  exception is one folder, `src/server/connectors/builtin/`, and `scripts/preflight.sh` checks
  every other file as before. A connector is an adapter for a service and serves every bot that
  uses it, like the sandbox module serves every bot.
- A service can change its answer. Every answer is read through a schema of the fields the tool
  uses; a changed answer becomes a readable error, and the bot falls back to `fetch_url` or its
  computer. A booking the service accepted is reported as made even when its answer is odd, so the
  bot never books twice.

**Upgrade:** connectors for a team's own tools through their MCP servers, with the user's own
sign-in (milestone 2 of the spec); a way to disconnect from the page.

### One deployment per team, not one shared service

Decided by the author on 2026-09-25, on the recommendation of the
[architecture review](evidence/2026-09-25-architecture-review/README.md) (finding 4). Each customer
team gets its own deployment: its own process, data folder, credentials and sandbox project. No
two teams share a process. The team is the tenant, and the deployment is the tenant boundary.

Why: the code already assumes one owner per process. Model settings, budget, timezone, watched
mailbox and notice address are per deployment. The Bot schema has no owner, and mail events fan
out to every bot in the process. A shared service would need ownership checks on every route,
stream, artifact, screenshot, approval, connector credential, interactive screen and background
trigger before the first team could use it. A deployment per team needs none of that to keep two
teams apart.

What this does not remove: a hosted deployment still needs authenticated access (the server binds
to loopback today), credentials kept per deployment, backups of the data folder, and a way to
update and restart many deployments. Changing the bind address alone must never expose a server.

**Trade-off:** one process and one set of keys per team costs more to run and to update than one
shared service, and nothing is shared between teams (no cross-team bot, no pooled capacity). It
starts to matter with many small teams, when per-team hosting cost and update work grow with the
count. **Upgrade:** a shared service with tenant ownership on every resource, designed with the
durable execution records the review names (finding 3), not added route by route.

### TypeSafe's Jev is an exception to EU hosting, for now

Dobot's first user is an EU team that needs its data and model calls hosted in the EU. Decided by
the author on 2026-09-25: TypeSafe's classifier Jev may be used before that holds for it. Jev
answers fixed questions about a text with probabilities and writes no text. It is a candidate for
routing a run to a cheaper model, for "watch for X" routines that score new items without waking
the model, and for an add-only second signal at the approval gate. Nothing that calls Jev is built
yet; each use still needs its own design.

TypeSafe's public legal page states no EU data residency. It offers zero data retention to
enterprise customers only; its data processing agreement was not read.

Jev is not the only part outside the EU today. Every model call, with every screenshot, page text
and mail it carries, goes to Anthropic's first-party API, which offers no EU processing
(`inference_geo` is `global` or `us`). The EU route for the model is Claude on Vertex `eu`, in the
[multi-provider spec](specs/2026-09-23-multi-provider-models-design.md). Once that lands, Jev is
the one part left outside the EU, so it follows the same rule as a non-EU model in that spec:
off unless the operator turns it on, and a run that used it says so.

Every use of Jev keeps these rules:

- **Off by default for a deployment.** An operator turns Jev on; with it off, the platform works
  as it does without Jev. A team that refuses the exception gets a working product.
- **Fail safe.** A Jev answer can only make the platform more careful or more complete: add an
  approval card, pick the stronger model, start the run. It never removes a card or skips a step.
  A failed or slow call is treated as the careful answer.
- **No secrets, no credentials.** Nothing that invariant 5 keeps from the model is sent to Jev.

**Trade-off:** the text Jev reads (a goal, a mail subject and sender, an item's text, a button
label) leaves the EU and is kept by TypeSafe under its default retention. It starts to matter with
the first customer who asks where their data goes, and for any use that sends personal data
under GDPR, which then needs a data processing agreement and a transfer basis with TypeSafe.
**Upgrade:** read TypeSafe's DPA and ask for EU processing or zero retention; otherwise keep Jev off
for EU customers, or replace it with a classifier hosted in the EU.

## Stack

TypeScript on Node 24, one package: Hono for API and streaming, React/Vite for UI, E2B for the
desktop, and the Anthropic Messages API for the model. Exact dependency versions were checked
against the registry and advisory database at installation; the lockfile records the build.

The agent loop is custom because approval and takeover must sit between model tool calls and
execution. **Trade-off:** the project owns retry, streaming and lifecycle behavior instead of
delegating it to a framework. [Model lifecycle checks](evidence/2026-09-17-model-lifecycle-review/README.md).

The demonstration uses E2B's EU cluster because the US address changed privacy notices on the
target sites. **Trade-off:** a separate paid project and fresh logins when switching clusters.
The region is configured through `E2B_DOMAIN`; it is not hardcoded. The clean-machine evidence
uses that EU project and does not reverify the default cluster.

## What I would build next

These are proposed improvements. Their order should follow the job a user needs and the
failures measured in real runs.

- **Reliable continuation:** structured task progress, recoverable checkpoints and persistent
  work and notice queues. Check external outcomes before retrying uncertain actions. Add
  database transactions when the file store becomes the constraint.
- **Better memory and research cost:** save the initial goal's constraints, save partial results
  near limits, and replace old page text with short notes. Homer and Swimmer exposed these gaps.
- **Repeatable output checks:** turn reviewed letters and takeover reports into labelled cases
  with sources. First establish what context can be recovered and what must be saved without
  secrets. Resample answers from fixed context without operating the computer; this evaluates
  wording, not the whole workflow. Check complete assertions and relationships against sources.
  Evaluate a checker such as TypeSafe against manual labels only when output volume justifies
  it; measure missed errors and false alarms. Use approval events and action targets for
  repeated-work checks. Letter evidence (record omitted from this snapshot),
  [takeover reports](evidence/2026-09-18-takeover-report-fix/README.md).
- **Narrow, revocable “Always allow”:** scope a permission to a bot, action, site and recipient,
  verified by the platform. The proposed trust rule is five consecutive Allows with no Deny
  before offering it. Only the UI writes the rule, and the user can revoke it. Deny, a changed
  recipient or a warning removes the permission; warnings always ask. Show filled values and
  attestations on application cards. A simpler owner-report tool could send only to the fixed
  operator address, avoiding recipient inference from a webmail page.
- **More of the job hunt:** interview preparation from saved company and role research, then
  application tracking and follow-ups across weeks. Broaden application-flow coverage beyond
  the two prepared forms. Actual submission on either site needs a real, authorized application.
- **More event sources and account control:** calendar changes, webhooks and eventually bot
  hand-offs; separate mailboxes and explicit login grants. Keep account setup in a trusted
  secret form. Let users correct a persona in chat and archive a bot in the UI.

## Open-source components, and what was added on top

| Component | Used for | Added on top |
| --- | --- | --- |
| E2B desktop SDK (`@e2b/desktop`, `e2b`) | Remote computer, stream, files and commands | Per-bot lifecycle, pause/resume/rebuild, companion authentication and computer-action adapter |
| Anthropic SDK | Messages API and computer-use toolset | Agent loop, approval and secret guards, prompt caching and platform tools |
| Hono, `@hono/node-server` | API, SSE and static files | Routes, local-access checks and per-bot event history replay |
| React, Vite | Web UI | Roster, chat, cards, preview, Skills and Runs tabs |
| croner | Cron schedules | Persisted next-run times and missed-run policy |
| imapflow | IMAP connection and mailbox metadata | New-mail detection, persisted position, per-routine acknowledgement and recovery |
| nodemailer | SMTP delivery | Fixed notices, protected recipient and failure handling |
| zod | Validation | Store, tool and request schemas |
| pngjs | PNG decode and encode | Screenshot differences, crop and zoom |
| Vitest, tsx, concurrently, TypeScript | Tests and development tooling | Project-specific tests and preflight checks |
| Python `websocket-client` | Chrome DevTools Protocol connection | Browser-control inspection and file-chooser handling in the companion |
| noVNC and x11vnc, through E2B | Live desktop stream | Switching between view-only and interactive takeover |
| E2B Surf, studied but not forked | Reference for screen integration | Dobot's platform was built separately |
