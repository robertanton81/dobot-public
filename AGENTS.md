# Dobot — AI Coworker — Project Guidance for Codex

A product prototype that the author, Claude and Codex build together: an AI coworker with its own
visible computer, inspired by Grok Bot. It began as a take-home proof of concept for a company
(September 2026) and has continued as a product prototype since then.

## Where to start in a new session

1. Read this file's **Invariants** and **Delivery constraints** — they bind every design, plan and review.
2. Start with `docs/README.md`, `docs/decisions.md`, `docs/operating-guide.md` and `docs/verification.md`. The research pack, specs and plans preserve earlier decisions and amendments.
3. Run `/design-spec` (approach undecided), `/plan` (approach decided), `/implement`, then `/verify`.

## The product

The product direction is a hosted alternative to Grok Bot for EU teams. The first user is an EU
team that needs its data and its model calls hosted in the EU. The current product work is cost
efficiency, connectors (an API or MCP server before the browser), and models from more than one
provider with the EU as the default.

The research pack (`docs/01-product.md`, `docs/02-architecture.md`, `docs/03-build-story.md`)
is kept because the invariants below came from it. It is not a list of requirements. Use
`/grok-bot-product` to load the option space when making a product decision.

Decided on 2026-09-25: one deployment per customer team, not one shared service (`docs/decisions.md`).

## Stack

Decided 2026-09-11 in `docs/specs/2026-09-11-platform-design.md` (decisions 5, 9, 10, 18),
on the "fewest build obstacles" criterion. `package.json` and `pnpm-lock.yaml` are the current
version records. The platform plan records the registry and advisory checks at installation;
its historical research table is not an instruction to upgrade a clean clone.

| Part | Choice | Pinned |
| --- | --- | --- |
| Language, runtime | TypeScript, **Node 24**, one package, pnpm 12 (`npm install -g pnpm@12` if needed) | `typescript` 7.0.2, `pnpm` 12.3.4 |
| Server | Hono on `@hono/node-server`: API, SSE, static files, scheduler, agent loop — one long-running process, no serverless | `hono` 4.13.7, `@hono/node-server` 2.1.1 |
| UI | React + Vite, one page, one SSE stream per bot | `react` 19.3.0, `vite` 8.3.0 |
| Remote computer | E2B Desktop Sandbox, one per bot, paused when idle | `@e2b/desktop` 2.4.0, `e2b` 2.49.1 |
| Model | Anthropic Messages API, `computer_toolset_20260801`, Sonnet 5 by default (`MODEL_ID` env) | `@anthropic-ai/sdk` 0.125.0 |
| In-sandbox companion | Python 3 companion using CDP to Chrome, with `page-script.js` for DOM inspection | `websocket-client` |
| State | files on disk — a bot is a folder under `data/bots/<id>/`; no database | — |
| Schedules, validation, tests | `croner` 10.0.1, `zod` 4.6.2, `vitest` 5.0.0, `tsx` 4.23.13 | — |
| Mail trigger | IMAP mailbox metadata and persisted message positions; no message bodies read by the watcher | `imapflow` 1.7.8 |
| Attention notices | Fixed SMTP notices to an operator-set recipient | `nodemailer` 9.1.1 |
| Screenshot processing | PNG decoding, differences and zoom | `pngjs` 7.0.0 |

Not chosen on purpose: an agent framework (the approval gate must sit between the model's tool
call and execution, where frameworks put their own loop), Vercel (a 15-minute run and a 7 am
routine need a process that is alive at 7 am), a database, a fork of E2B Surf.

Library facts are never written from memory. Every library, SDK or service the design depends
on is verified with `/find-docs` (Ref → context7 → web) for the pinned version, and the source
link is recorded in the spec or plan.

## Repo layout

```
docs/                    research pack, specs (docs/specs/), plans (docs/plans/)
.agents/skills/         Codex workflow skills, committed with the project
.claude/                Claude Code harness and review agents, see .claude/README.md
.codex/                 Codex review agents and the session hook, same roles as in .claude/
src/server/              Hono app: API, SSE, static files, scheduler, run loop
src/server/store/        the bot folder: bot.json, memory, skills, routines, chat, runs, artifacts
src/server/sandbox/      E2B: create, connect, pause, stream URLs, files, companion client
src/server/agent/        the loop, tool definitions, the approval gate, takeover, stuck detection
src/server/companion/    companion.py (uploaded into the sandbox) and its TypeScript client
src/web/                 React + Vite: roster, chat, preview, cards, Skills and Runs tabs
data/bots/<id>/          one folder per bot — git-ignored
examples/homer/          portable example bot; the README shows how to restore it
scripts/preflight.sh     typecheck, tests, the greps that keep one bot's work and the project's history out of src/
```

The platform is implemented. Specs and plans record its design history; the operating guide
and verification summary describe current behavior and the limits of its evidence.

## Invariants (product — every design, plan and review checks them)

These come from the product being built. They do not depend on the stack.

1. **Visible remote computer.** The user can watch the agent work on a real remote machine,
   live. Hiding the screen, or replaying a recording instead of live work, breaks the core
   claim of the product.
2. **Real work, not simulation.** A bot's job produces a real artifact in a real system.
   A mocked outcome or a hardcoded happy path anywhere on a user's job path is a blocking defect.
3. **One job, finished.** A bot's job completes end to end. Grok Bot's own thesis is
   that 100% of a job is categorically different from 90%. A workflow that stops short is a
   failure, not partial success.
4. **Approval before irreversible side effects.** Sending, publishing, paying, deleting and
   overwriting stop for human approval. Fail closed: when an allow rule and a require-approval
   rule both match, require-approval wins.
5. **Takeover without secrets in the transcript.** When the agent is blocked on a password,
   two-factor code or CAPTCHA, the human takes over the screen and completes only that step.
   Secrets never enter the chat transcript, the logs, or the model's context. Two kinds of secret,
   two rules (author, 2026-09-12): the bot's own accounts are set up by the user and their
   credentials are the platform's to hold, like the sandbox key; the user's own credentials never
   enter the platform at all. The model sees neither. Takeover is for the user's secrets and for
   the checks no machine may pass. One exception (author, 2026-09-24): a connector may hold an OAuth
   token for the user's own account, granted by the user signing in on the provider's own page. It
   is scoped, revocable in one click, stored encrypted, never shown to the model or written to a
   log, and every write it makes still stops at the approval gate. Passwords, two-factor codes and
   CAPTCHAs still go only through takeover.
6. **Persistence across sessions.** The agent's identity, memory and workspace survive a page
   reload and a restart. An agent that resets every session is E2B Surf, not this product.
7. **Configured in plain language, never by engineering.** A user builds a bot's job by
   describing the goal in chat and answering the bot's questions. The bot writes its own
   skills and routines; the user only reads or corrects them. Placing a file in the bot's workspace
   and signing in on the bot's screen are the only things a user does outside the chat. Anything
   that asks the user to edit a file, learn a name the platform invented, or set an environment
   variable is operator setup at best and a defect at worst: it is named as a shortcut in
   `docs/decisions.md`, with the in-product path it stands in for. A feature the bot cannot reach through its
   own tools, and only a hand-edited bot folder can, is not built. (Stated by the author on
   2026-09-12; it binds every design, plan and review.)
8. **Cost efficiency.** A run takes the cheapest path that still finishes the job: a service's API or
   MCP server before its web page, text before the screen, the computer only when no API, MCP server
   or public text covers the step (a page that needs interaction, a login or a form), and no more
   screenshots or model strength than the step needs. The intent is a product people can afford to
   leave running, not the lowest possible bill: a cheaper path that finishes fewer jobs is not
   cheaper. Trigger: every design and plan that adds a model call, a screenshot, a computer
   wake-up or a routine states its expected cost per run in measured units (model USD from the run
   log's `cost` events, sandbox hours) and the cheaper path it considered; a change that raises the
   cost of a typical run without that statement is a defect. Measured baseline on 2026-09-23: of
   175 finished runs, the 119 that used the computer carried 91% of the model cost. (Stated by the
   author on 2026-09-23; "API or MCP before the browser" added by the author on 2026-09-24.)

## Delivery constraints

1. **Reproducible from a clean clone.** The README's setup steps work on a machine that has
   never run this project. An operator who self-hosts, and every new session, depends on it.
2. **Smallest convincing scope.** Every feature earns its place with the first user, an EU team.
   If that user would not notice its absence, it probably should not be built. Cutting is the
   default answer.
3. **No deadline.** The original take-home deadline has passed and no longer binds. A product
   date, when the author sets one, goes here with its reason.
   `docs/build-history.md` records the take-home's freeze and the fixes made after it.
4. **Time is information, never a reason.** A date is a fact to plan around, not an argument.
   Nothing is cut, parked or rejected because of the days left; it is cut because it proves
   nothing the first user needs, adds a failure mode to a user's job path, or fails an invariant,
   and the record says which. The real constraints are the author's hours on the steps only a
   human can do (a password, a challenge, a decision) and the live-run cycles a change needs
   before it is believed. Estimates are stated in those units. (Rule from the author, 2026-09-12:
   the technical work is the AI agents' and is measured in hours, and a decision closed on days instead
   of merits does not survive a second look.)

## Writing and deciding (binding)

### Answers

- Reply in the language the user writes in. Code, comments, commits, specs and plans stay in English.
- Plain language: short sentences, everyday words, one idea per sentence. No filler, no hedging,
  no marketing tone, no restating the question.
- Keep established technical terms — sandbox, idempotency, approval gate, streaming, persistence.
  Renaming them into "simpler" words is worse than using them. If the reader may not know a term,
  explain it once in a sentence and then use it.
- Say what was done, what was found and what is still open. Commands, code and numbers go into
  code blocks or tables, not into prose.

### Decisions

- **KISS wins.** The simplest solution that finishes the user's job is the default. Add a
  layer, an abstraction, a library or an infrastructure component only when the product needs it.
  KISS applies to the solution, not to the problem. Before a change that touches an await on
  external I/O, a timer, a stop signal, a retry, a stream, a queue, or state that survives a
  restart, write the state table first: success, failure, timeout, Stop, retry, partial result,
  restart. The change must cover every row; then choose the simplest solution that does. A patch
  that fixes one state is not simple, it is incomplete. Fewer lines is not the goal; fewer
  unhandled states is. (Rule from the author, 2026-09-17, after three review rounds found local
  patches of the model-call lifecycle, each correct for its case and incomplete on the contract.)
- **Name the trade-off.** When the simple solution gives something up — reliability, isolation,
  multi-user support, cost — write down what is lost, when it would start to matter, and what
  the upgrade path is. These go into `docs/decisions.md`. A trade-off that is not written down
  is lost to the next session and cannot answer a customer's question.
- **No premature optimisation.** Optimise only against a bottleneck that is measured or clearly
  reasoned and named in a spec. "For scale" indirection without such a reason is an
  over-engineering finding.
- **Have an opinion.** Product judgment is what makes this product. Where Dobot deliberately differs
  from Grok Bot — for example on the shared-computer model that gives every bot the same
  credentials — say so and defend it. Copying Grok Bot without an opinion leaves no reason to
  choose Dobot.

## Working rules (portable — they do not depend on anyone's personal Codex configuration)

These rules travel with the repository so that Codex behaves the same for every user who opens
it. They are copied from the author's personal setup on purpose; if a personal configuration
says otherwise, the rules here win inside this repository.

### Plain language (hard rule)

The author is not a native English speaker. Write every answer in plain English: short
sentences, one idea per sentence, active voice. Keep real technical terms and explain each once.
Cut idioms, metaphors and rare words — "table stakes", "load-bearing", "low-hanging fruit" are
the problem, not "sandbox". Simple language and full technical depth are not in conflict: never
reduce the detail, the rigour or the honesty of an answer in the name of readability.

### End-of-turn report (hard rule)

The last message of every turn that did work ends with this block and nothing after it. Plain
language, one line per item, each line a full sentence that says what and where. Never bury a
status inside a paragraph.

The block answers two questions and nothing else: what is now true and proven, and what only the
user can do next. There is no "To do" section.

**Done** — only what actually landed _and_ was verified, with the proof on the line (a commit
sha, a test count, a file path). Small fixes made in passing go here too.
**Your actions** — everything only the user can do: console steps, merges, decisions, physical
steps. Imperative phrasing, with the exact input or link needed, and what the step unblocks. A
decision is a question with the agent's recommendation on the same line. If there are none, write
`none`.

Finish first. Before writing the block, test every open item in this order:

1. Can it be done now, inside the task and with the authority already given? Then do it and
   report it under Done. Work that could be done is never listed. "Next turn" is not a status.
2. Does it need the user — a decision, a secret, a physical step? Then it is one line under Your
   actions, and only there.
3. Is it outside the task? If a standing rule already covers it and the fix is small, make the
   fix and list it under Done. If not, it becomes one decision line under Your actions, and only
   when ignoring it has a cost that the line can name. Otherwise drop it: future work lives in
   the private backlog and the plans, not in this block.

**Not done** — a third section, written only when something the user asked for in this turn did
not land and step 1 could not fix it. Each line says what did not land and why: an external wait
(name the process) or a failure that could not be resolved (say what was tried). Partial work
goes here with what is missing, never under Done. When this section is absent, the block claims
that everything asked for in this turn is finished.

- Keep it short: at most six lines per section; lead-in above the block at most two sentences;
  no other headers in the report.
- An item is done or it is not. "Mostly done", "should work", "pending confirmation" are Not done
  items.
- The same item never appears in two sections.
- When a skill prescribes its own hand-off block (Output / Next step / Session hygiene), render
  its content inside these sections, not in addition to them: the output under Done, the next
  step and the session hygiene under Your actions.
- Mid-turn progress notes stay short and never repeat the block; the block appears once, at the end.
- Changed on 2026-09-19 at the author's request: the "To do" section is gone. In one session it
  held six lines over three reports: two were the user's decisions written as the agent's work,
  three repeated the backlog, and one was a one-word fix that the agent parked instead of making.
  A section that must be filled gets filled.

### Secrets

- A secret value never appears in the conversation, on a command line, or in a log. Inspect files
  that hold secrets with redaction only (key names, never values).
- API keys for the sandbox provider and the model provider live in `.env.local` (git-ignored) and
  in `.env.example` with empty values. If a secret leaks into the chat, say so at once and treat
  it as compromised: recommend rotation.
- This binds the product too — see invariant 5. A demo that pastes a password into the chat
  transcript fails the invariant even if it works.

### Verification after changes

Run the project's typecheck or build after every change, and the full pre-flight before reporting
anything as done. When imports or types change across modules, check the consumers as well.
The exact commands go in **Commands** once the stack is chosen.

### Debugging

Before proposing any fix: read the full error output and stack trace, trace the path from the
entry point to the failure, identify the exact line or condition, and explain the root cause.
Only then apply the minimal fix, with a test that reproduces the bug first. Never jump to the
first plausible fix. If other tests break, revert and re-analyse.

### Adding a dependency

The version-selection checks below apply when adding or upgrading dependencies. A clean clone
installs the committed lockfile; it does not upgrade dependencies as part of setup.

Before proposing or installing any package: check maintenance (last publish, maintainers, open
issues), adoption (weekly downloads) and known advisories, verify the current API in its
documentation, and record the findings with the pinned version in the spec or plan before the
package lands. **Versions are never taken from memory or from an older document:** the runtime
is the latest LTS and every package is its latest stable release as of install day, verified
against the registry, and that exact version is checked for advisories (OSV) before it is
installed. A version written in a spec or plan is a hint to re-check, not the answer
(rule from the author, 2026-09-11).

### Walking the user through steps

When a procedure needs the user's own actions (console steps, pushes, decisions), present one
step at a time and wait for confirmation before the next one. Never dump the whole remaining
list as instructions to execute.

### Honest correction over agreement

Treat the user's stated view as open to correction. Say plainly where it is right, partly right
or wrong, with reasoning and sources; steelman the other side before critiquing it; flag
confirmation bias or anchoring when you see it. Praise for directness is not a reason to soften
the next answer.

### Platform code (`src/`)

The intent: a stranger who opens `src/` reads a platform that serves any bot, and understands each
guard from its comment alone.

- The runtime files under `src/` hold nothing of one bot's work: no site, and no words of the
  example bot's job, in code, comments, prompt rules or tool descriptions. A rule that only one bot
  needs goes into that bot's skill. A platform rule that the model reads uses neutral examples.
- A comment says what the code does now and why, in present tense, as a general case. Dates, review
  names, run ids, rehearsal names and the story of how a defect was found go into `docs/` or the
  commit message. A number that was measured may point to its record under `docs/evidence/`.
- Before text leaves the shared prompt, check that every bot that relies on it has the same
  instruction in its own skill. Tests prove what the model is given; only a live run proves what it
  then does.
- The trigger: `pnpm preflight` must find nothing: no word of the example bot's work and no date
  in the runtime files, and no review, rehearsal or plan-task name anywhere under `src/`, tests
  included. `prompt.test.ts` ("the platform boundary") builds the prompt and the tool list for a
  bot with unrelated work and finds none of the words. Test files keep their concrete scenarios and
  their dates, which are test data.

## Commands

```bash
pnpm install          # after a clean clone; Node 24 and the pnpm version pinned in package.json
pnpm dev              # Vite dev server + Hono server under one script
pnpm build && pnpm start   # the single production process, serving the built UI
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm preflight        # scripts/preflight.sh: typecheck, tests, and the greps that must return nothing:
                      #   site names and project-history names anywhere under src/,
                      #   words of one bot's work and dates in the runtime files
```

Keys live in `.env.local` (git-ignored): `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `MODEL_ID`, `TZ`, and the
operator limits `DAILY_BUDGET_USD`, `ROUTINE_MIN_INTERVAL_MINUTES`, `BLOCKED_HOLD_MINUTES` (defaults 25,
15, 30).
`.env.example` leaves API keys empty and supplies defaults for model, timezone and limits.
Optional mailbox, notice and cluster settings are described in `docs/operating-guide.md`.
Run `pnpm preflight` before reporting anything as done.

## Workflow

### Skills (`.agents/skills/`) — invoke with `/<name>`

| Skill | When | Output |
| --- | --- | --- |
| `/discover` | The use case is not chosen, or a candidate has not been attacked yet — generate, score against a rubric, then challenge. | `docs/specs/YYYY-MM-DD-job-selection.md` |
| `/design-spec` | Approach not yet decided — one question at a time, 2–3 approaches with trade-offs, spec. | `docs/specs/YYYY-MM-DD-<topic>-design.md` |
| `/plan` | Approach is clear — reviewed implementation plan with tasks, verify commands, verification criteria. | `docs/plans/YYYY-MM-DD-<topic>-plan.md` |
| `/implement` | Plan approved — per-task execution (inline or fresh subagent), two-stage review, atomic commits. | Code + commits |
| `/verify` | After `/implement` — run every verification criterion, report pass/fail with evidence. | Verification report |
| `/grok-bot-product` | Making a product decision — supplies Grok Bot's option space and design laws. Does not decide. | Reference only |

**Default loop:** `/discover` → `/design-spec` → `/plan` → `/implement` → `/verify`.
Run `/discover` once, to choose the job. Skip it only when `docs/specs/` already records
a job-selection decision.

**Run the loop per milestone, not per small task.** The full ceremony on every
small step buys nothing the user sees.
A milestone is a piece of the product that can be shown working on its own.

Each flow skill ends with a fixed hand-off block (output path, next step, session-clear signal).
`/design-spec` and `/plan` end with a **Backbrief** (end-state, critical constraints, latitude)
so the delegation to the next step is visible.

User-scope skills the author uses alongside, not part of this repo and not required:
`/find-docs` (current library docs), `/debug` (root-cause-first bug fixing — the Debugging rule
above is the fallback), `/grill-me` (stress-testing a design before it is written down).

### Review agents — spawned by the skills, not user-invoked

The same six review roles exist for both tools: `.claude/agents/*.md` for Claude Code and
`.codex/agents/*.toml` for Codex.

| Agent | Model | Spawned by | Role |
| --- | --- | --- | --- |
| `job-challenger` | sonnet | `/discover` | Independent adversarial verdict on a candidate job, with fresh context |
| `design-reviewer` | sonnet | `/design-spec` | Adversarial review of the spec against the invariants, the scope budget and the user's job path |
| `plan-reviewer` | sonnet | `/plan` | Adversarial review of the plan before `/implement` |
| `spec-compliance-reviewer` | haiku | `/implement` Stage 1 | Binary "does the code match the plan task?" |
| `code-reviewer` | sonnet | `/implement` Stage 2 | Code quality, resilience, invariants, security, test _existence_ |
| `test-quality-reviewer` | sonnet | `/implement` Stage 2 | Test _meaningfulness_: rejects tautology, mock-only, framework and sleep-driven tests |
