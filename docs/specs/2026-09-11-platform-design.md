# Platform Design Spec

**Date:** 2026-09-11
**Status:** Approved by the author on 2026-09-11. Two design-review rounds (3 blocking + 3
should-fix in round 1, all fixed; 1 new blocking in round 2 — approval not scoped to the
announced action — fixed), then a self-audit that closed 17 gaps and moved every research row
to a primary source. Input for `/plan`.
**TODO items:** section 0 "Run `/design-spec`" and "Decide the stack"; section 1 Foundation (all
four items); section 2 The demo path (the mechanisms every item depends on).
**Scope:** the platform — the product core that every use case runs on: bots with identity and
memory, chats, skills and routines, a visible remote computer, an approval gate and takeover.
The job hunt in `docs/specs/2026-09-10-job-selection.md` is the demo configuration; that record
binds this one. Nothing in this spec is specific to a job, a site or a mailbox.

## Problem

E2B Surf is one short session with one anonymous agent on a remote desktop. The brief says the
delta over Surf is the assignment: identity, memory, work that starts without a prompt, an
approval gate, takeover, and artifacts that leave the sandbox. All of that is platform. The
job-selection record decided *what* the demo shows and left the platform undecided, with ten
open questions. This spec decides the platform in nine decisions made with the author plus nine
refinements, records the research behind each, and fixes the demo path, the invariant
mechanisms, the failure modes and the scope budget.

Every component below is the smallest one that the demo path needs: the brief asks for the
smallest convincing experience, and each extra part is one more thing that can fail on camera.

## Decisions Log

Decisions 0–9 were made by the author on 2026-09-11 in this session. Decisions 10–18 are
refinements Claude made while writing the spec; they follow from 0–9 and are open for the
author to overrule at the Backbrief.

| #   | Question | Decision | Reasoning |
| --- | -------- | -------- | --------- |
| 0 | Fork E2B Surf, or treat it as a reference? | Reference only. No Surf code is forked or copied. | Surf is one short session with one anonymous agent. The platform needs a long-running process, persistence, an approval gate and a scheduler, so a fork would be mostly replaced anyway. Surf is read for how it embeds the desktop stream. This does not decide the sandbox: E2B Desktop is still used (decision 4). |
| 1 | How does the bot act on the remote computer? | Pixels plus a DOM check. The model sees screenshots and clicks and types like a person (Anthropic's computer-use tool). The platform also holds a connection to the browser through a small companion process inside the sandbox. Before every click and every Enter it resolves the element under the cursor and checks the approval rules in code. File upload goes through the browser's file-input API, never the native file picker. | It keeps real computer use, which the brief says its authors care about most, and it lets the gate fail closed without trusting the model (invariant 4). The native file picker, the highest-probability failure in the job-selection record, is avoided. Rejected: pixels only (the gate becomes probabilistic; the file picker stays), DOM only (reads as "Playwright with a model", loses anything outside the browser and the human-like cursor). Conditional on the day-one prototype in "Design › Companion". |
| 2 | How does the gate recognise an irreversible action without site-specific code? | Two signals; either one stops the action. (a) The model must call a `propose_action` tool before any irreversible step; that call supplies the readable approval card. (b) The platform checks every click, and every Enter, Space or typed newline on a focused control, with generic DOM rules: a submit control, an action that submits a form, or an accessible name from a short multilingual verb list. A rule hit without a matching approval is blocked, and the card says the bot did not announce it. | The model gives a card a human can read; the rule makes the gate fail closed even when the model forgets or is manipulated by page content. **Remaining gap, written down:** a final action behind a plain "Continue" button that is not a form submit, that the verb list misses, and that the model also fails to announce. Rejected: DOM rules only (unreadable card), holding every state-changing network request (searches and autosave also POST — too many approvals, fails the delegate-or-manage filter), a reviewer model on every step (probabilistic, slow, not testable). |
| 3 | One computer per user (Grok Bot) or per bot, and where do logins live? | One computer per bot. Skills and artifacts are account-level and live in a store outside any sandbox. A bot's computer, browser profile, logins, files, memory and routines are private to it. Bot-to-bot hand-off is a chat message with an artifact attached (designed, not built). Logins are never shared unless the user grants one explicitly (not built). | "Sharing is a message, not a shared drive": everything one bot knows about another's work went through a chat the user can read. This is the deliberate difference from Grok Bot's shared computer, whose most-cited flaw is that bots are not security boundaries. **Trade-off:** the user signs in once per bot, not once per account; it starts to matter with the second bot that needs the same mailbox. **Upgrade path:** an explicit, approved "grant this site's login to bot X". Rejected: a shared artifact drive mounted into every sandbox (hidden shared state returns), a fresh sandbox per task (profile sync that invariant 6 would then depend on). |
| 4 | Which sandbox provider, and how does the computer survive a restart? | E2B Desktop Sandbox, one per bot. The platform pauses the sandbox when the bot is idle and resumes it on a message or a routine. The platform's own store is the system of record; the sandbox is a cache that can be rebuilt from it — files re-uploaded, logins re-entered by the human through takeover. | Full desktop, the client's own stack, a $100 free credit, about $0.06 per hour running, nothing while paused, and pause/resume keeps the open browser (beta; kept up to 30 days from creation). **Trade-off:** pause is beta, and a sandbox older than 30 days may be gone; the rebuild path covers it. Rejected: Steel (browser only, so "visible remote computer" becomes "visible remote browser"), a self-hosted Docker desktop (build days for the image and the stream, and a clean-clone setup that needs Docker and a host). |
| 5 | Where do the agent loop and the scheduler run? | One long-running Node process holds the web UI, the API, the agent loop and the scheduler. Routines are timers whose next run time is persisted, so a restart recomputes them. It runs on a laptop with one command, or unchanged on a container host. | Chosen on the "fewest obstacles" criterion. Vercel Hobby stops a function at 300 s and runs cron once a day, so a 15-minute run and a 7 am routine cannot live there. A coworker that starts work at 7 am needs a process that is alive at 7 am; serverless is the wrong shape for it. **Trade-off:** not Vercel; one process is a single point of failure and holds one machine's worth of bots. **Upgrade path:** UI on Vercel, the worker in a container, a queue between them. Rejected: Vercel UI plus a separate worker (a day of plumbing the demo never shows), Vercel Pro long functions (13-minute ceiling; a run dies mid-form). |
| 6 | Which model, and which loop code? | A plain Messages API loop with `@anthropic-ai/sdk` and `computer_toolset_20260801`. Sonnet 5 (`claude-sonnet-5`) by default; the model id is one env variable so a run can switch to Opus 5. Writing tasks use the same model. | Fewest moving parts; the gate sits between the model's tool call and our execution, where a raw loop makes it one check. A 40-step run with prompt caching costs roughly $1–2 on Sonnet 5 and $3–6 on Opus 5. Rejected: Opus 5 everywhere (2.5× cost, slower steps, switchable anyway), the Vercel AI SDK (documents only the older `computer_20250124` tool; one more dependency on the critical path), the Claude Agent SDK (cannot host the computer-use tool). |
| 7 | How does the bot read its mailbox, and where does takeover get its scene? | The bot's mailbox is open in its own browser on the remote computer. The first sign-in is a takeover: the bot reaches the login page, hands the screen to the human, the human types the password, hands back. The session survives in the paused sandbox. A routine opens the inbox and looks for new mail. | Takeover gets a guaranteed scene, and "a coworker with a mailbox in its browser" is the model being demonstrated. **Whose address goes where (decided with the author on 2026-09-11, after one reversal):** the bot has its own mailbox, and it writes **that** address into every external form it fills for the work it was given — the application, the Calendly booking. Every reply to that work lands in the bot's mailbox by construction, and the bot's mailbox forwards everything it receives to the user, so the user is copied on all of it. The user never writes inbox rules and the bot never holds the user's login — the deliberate difference from Grok Bot, where the bot signs into the user's real Gmail. Rejected: the user's real address on forms plus a forwarding rule from the user's mailbox to the bot's — the user cannot know in advance which senders belong to the bot, so it becomes rule management, which fails the delegate-or-manage filter. **Trade-offs:** the employer sees the address the bot manages (in a real product it would read as the user's — `firstname.lastname.jobs@…` or `jobs@` on the user's domain; for the demo nothing is submitted, so it does not matter), and a reply the user sends from their personal mail splits the thread away from the bot. For the demo the seeded invitation is sent from the dev address straight to the bot's mailbox, which is exactly where the form pointed. **Trade-off, written down:** mail has APIs; in production an IMAP tool with a masked secret card would be cheaper (about $0.15 per check in screenshots today) and more robust. The job-selection record's "mailbox tool" line is superseded by this decision. Rejected: IMAP plus a secret card (takeover would have no guaranteed scene), both (two credential paths in four days). |
| 8 | Where does the demo start? | The interview (goal in plain language; the bot asks for outcome, sources, constraints, deliverable, review point) is done before recording and is visible as chat history. The video starts with the bot idle; a routine fires and the bot does the job live. At the end it offers "Want me to do this every morning?" and writes its skill and routine on screen. | Live minutes go to the remote computer, not to typing questions, and the skill-writing claim is still a scene. Rejected: a blank platform with everything live (3–5 more minutes before anything visible, no rehearsal of that exact prompt); skills pre-written with no skill writing on camera (the "bot writes its own skills" decision becomes an argument instead of a scene). |
| 9 | Language and stack | TypeScript. Node 22, one package, Hono for the HTTP server and SSE, React + Vite for the UI, `croner` for schedules, Vitest for tests. | E2B publishes official SDKs for JavaScript/TypeScript and Python only; Anthropic's C# SDK is beta; Playwright has all bindings. .NET with Blazor would have won the live-UI row (SignalR pushes updates with no API layer) and lost the most expensive row (hand-written E2B control). Python loses on the UI. **Not chosen on purpose:** an agent framework — the loop is screenshot → model → tool calls → gate → execute → repeat, and frameworks put their own loop exactly where the gate must sit. |
| 10 | Where is state stored? | A bot is a folder on disk. `bot.json`, `memory.md`, `skills/*.md`, `routines/*.md`, `chat.jsonl`, `runs/<id>/`, `artifacts/`, `workspace/`. No database. | The option the author approved in decision 5 said "SQLite on disk"; files replace it because readable memory and skills are a product point (Grok Bot's memory is a black box), one process needs no concurrent writers, and a native SQLite build is one more thing that can fail on the reviewer's machine. **Trade-off:** no queries across bots, no transactions; fine for one machine's worth of bots. **Upgrade path:** SQLite or Postgres behind the same store interface. |
| 11 | Skill, routine and memory format | Skills are Markdown with YAML frontmatter (`name`, `description`), body in plain sentences. Routines are the same with a `skill` and a `schedule` (cron expression) or `event` field. Memory is one Markdown file the bot appends to through a `remember` tool. All three are shown in the UI as text the user can read and edit. | The user never writes one, but can always read and correct one. The bot writes them through `save_skill`, `save_routine` and `remember` tools. Approval rules are **not** in this set: they live in `approval-rules.json`, which no tool can write. |
| 12 | Cheap path first, computer when needed | The bot has a `fetch_url` tool for reading public pages and the computer for anything interactive. The system prompt states the order: fetch first, computer when a page needs interaction, a login, or a form. | Grok Bot's own execution hierarchy. The dossier is built from fetched pages and shown as a chat card, which answers open question 2 of the job-selection record (the dossier stretch is the least watchable part). The search of a job board may use either; the skill decides. |
| 13 | One decision per opening | The bot does not ask before researching or filling the form. It prepares everything and hands over one page with one decision: click submit, or not. | Open question 1 of the job-selection record. Filling a form is not irreversible, so it needs no approval; asking twice fails the delegate-or-manage filter. |
| 14 | The always-awake claim on screen | No ticker. The roster shows the bot's state and its last routine result as one line ("checked 1 source at 07:00, 1 new"). | Open question 3. A ticker is a feature the demo would have to explain; one status line is Grok Bot's design law 2 (the avatar carries identity and state). |
| 15 | Sender check for the seeded invitation | The `propose_action` tool has a `warnings` list. The skill tells the bot to add a warning when a sender's domain does not match the organisation it claims. The platform renders warnings on the card; it does not know what a company is. | Open question 10a. A platform rule would need the platform to know about companies, which is job-specific. |
| 16 | What the bot records at the end of act one | A memory line: "Handed to the user on <date>: application to <company> for <role> at <url>, letter and CV attached. I did not submit it." When an invitation later names that company, the bot says "this looks like a reply to the application I prepared on <date>; I did not submit it, you may have." | Open question 10b. The wording never claims the application was sent. |
| 17 | Enforcing "no site-specific code" | Both: a `grep` in the pre-flight script that fails on a list of site names and hostnames, and a line in the code reviewer's checklist. | Open question 8. The grep is cheap and a reviewer can run it in one command, which is what the job-selection record promised. |
| 18 | Language of the companion inside the sandbox | Python 3, one file, standard library plus `websocket-client`, speaking raw CDP to Chrome on localhost. Installed with `pip` at sandbox creation. | The default E2B desktop template has Python 3 and no Node.js, and Chrome refuses DevTools HTTP requests from outside localhost, so the CDP client must live in the sandbox. A custom template with Node would add a template build step to the reviewer's setup, and its availability on the Hobby plan is not stated. **Trade-off:** one Python file in a TypeScript repository, about 150 lines. **Fallback:** a custom template with Node and `playwright-core`, if raw CDP proves painful on day one. |

## Chosen Approach

One TypeScript process. It serves a React page with a roster, a chat and a preview panel. Each
bot is a folder on disk and owns one E2B desktop sandbox that is paused when idle. A routine or a
message resumes the sandbox and starts a run: a plain loop over the Anthropic Messages API with
the computer-use toolset and a handful of platform tools. Before every click, the platform asks a
companion process inside the sandbox what is under the cursor and applies the approval rules;
a proposed irreversible action becomes a card in the chat and the run waits. When the bot is
blocked on a password or a CAPTCHA, the preview panel switches to the interactive stream URL and
the human completes only that step. Artifacts, memory, skills and routines are files the user can
read in the UI.

**Why this over alternatives:** every piece is the smallest one the demo path needs, every
external dependency has an official TypeScript SDK, and the gate and takeover are enforced in
code rather than by prompt. The alternatives per component are in the Decisions Log and in
"Alternatives Considered".

## Research (source links)

All checked on 2026-09-11 through research subagents using Ref, Context7 and primary GitHub or
docs pages. Every row below was read from a primary source (official docs, a repository file, or
a package's type definitions) unless the row itself says "not documented" or "not stated".

### E2B Desktop Sandbox

| Fact | Version | Source |
| ---- | ------- | ------ |
| `@e2b/desktop` 2.4.0 (published 2026-09-09); `e2b` 2.49.1 | npm | <https://registry.npmjs.org/@e2b/desktop> |
| Default timeout 5 min. Max continuous session: Hobby 1 h, Pro 24 h. Extend with `timeoutMs` | core SDK | <https://github.com/e2b-dev/e2b/blob/main/apps/web/src/app/(docs)/docs/sandbox/persistence/page.mdx> |
| Pause/resume is public beta. Pause keeps the filesystem and memory, including running processes. Kept up to 30 days from creation. Pause about 4 s per GiB RAM, resume about 1 s. Network services are unreachable while paused; clients reconnect after resume | core SDK | same |
| Auto-pause in 2.49.1 is `SandboxOpts.lifecycle: { onTimeout: 'pause', autoResume: true }`; the docs' `betaCreate` no longer exists in the type definitions | `e2b` 2.49.1 | <https://unpkg.com/e2b@2.49.1/dist/index.d.ts> |
| Desktop `Sandbox` extends the core class: `Sandbox.connect(id)`, `betaPause()` inherited; `template`, `metadata`, `envs`, `timeoutMs`, `resolution`, `dpi` on create | 2.4.0 | <https://unpkg.com/@e2b/desktop@2.4.0/dist/index.d.ts> |
| "Paused and killed sandboxes are not billed … no time limit on how long a sandbox can remain paused" | docs | <https://docs.e2b.dev/faq/calculate-sandbox-price.md>, <https://docs.e2b.dev/faq/paused-sandboxes-concurrency.md> |
| $0.000014 per vCPU-second, $0.0000045 per GiB-second; default 2 vCPU / 512 MiB; about $0.06 per hour running. Hobby: one-time $100 credit, 20 concurrent sandboxes | pricing | <https://github.com/e2b-dev/e2b/blob/main/apps/web/src/app/(docs)/docs/legacy/pricing/page.mdx>, <https://github.com/e2b-dev/e2b/blob/main/apps/web/src/app/(docs)/docs/sandbox/rate-limits/page.mdx> |
| Stream: `desktop.stream.start({ requireAuth })`, `getAuthKey()`, `getUrl({ authKey, viewOnly })`, `stop()`. `viewOnly` is a parameter of `getUrl()`, so a view-only link and an interactive link come from the same running stream. One stream per sandbox. Backed by x11vnc + noVNC | 2.4.0 | <https://github.com/e2b-dev/desktop/blob/main/README.md> |
| Google Chrome (`google-chrome-stable`) and Firefox are in the default template; `desktop.launch('google-chrome')`, `desktop.commands.run(...)`, `desktop.files.write(path, data)` | 2.4.0 | <https://github.com/e2b-dev/desktop/blob/main/template/template.py>, README |
| The default template is Ubuntu 22.04 with `python3-pip` installed and **no Node.js** (`template.py` has no `node`, `nvm` or `npm`) | 2.4.0 | same `template.py` |
| Custom templates are built with `e2b template build`; only *custom compute size* is listed as Pro-only. Whether Hobby may build a default-size custom template is not stated in one sentence — inferred, unverified | docs | <https://github.com/e2b-dev/e2b/blob/main/apps/web/src/app/(docs)/docs/legacy/pricing/page.mdx> |
| Default resolution 1024×768 at 96 dpi | 2.4.0 | type definitions above |
| Control API, from the type definitions: `screenshot(): Promise<Uint8Array>`, `leftClick(x?, y?)`, `doubleClick`, `rightClick`, `middleClick`, `scroll(direction: 'up'\|'down', amount)`, `moveMouse(x, y)`, `mousePress(button)`, `mouseRelease(button)`, `getCursorPosition()`, `getScreenSize()`, `write(text, { chunkSize = 25, delayInMs = 75 })`, `press(key \| key[])`, `drag(from, to)`, `wait(ms)`, `open(fileOrUrl)`, `launch(app, uri?)`. No triple click, no hold key. `commands` and `files` are inherited from the core class. `stream: VNCServer` with `start({ requireAuth, port, vncPort, windowId })`, `stop()`, `getAuthKey()`, `getUrl({ autoConnect, viewOnly, resize, authKey })` | 2.4.0 | <https://unpkg.com/@e2b/desktop@2.4.0/dist/index.d.ts> |
| E2B Surf embeds the stream as `<iframe src={vncUrl} allow="clipboard-read; clipboard-write">` in `app/page.tsx`, so the noVNC page can be embedded | Surf main | <https://github.com/e2b-dev/surf/blob/main/app/page.tsx> |
| `getHost(port)` gives a public URL with **no authentication** | core SDK | <https://github.com/e2b-dev/e2b/blob/main/apps/web/src/app/(docs)/docs/sandbox/internet-access/page.mdx> |
| Chrome with `--remote-debugging-port` reached from outside the desktop sandbox: **not documented**. Day-one prototype | — | searched e2b-dev repos and docs, no result |
| Sandbox IP ranges and CAPTCHA behaviour: not documented | — | — |
| Whether the Hobby "1 hour" limit is the longest *running* stretch (then a paused sandbox can live for days on Hobby) or the sandbox's total lifetime (then Pro at $150/month, or a daily rebuild, is needed): **not stated**. The persistence page says paused sandboxes are kept 30 days from creation with no plan restriction named. Day-one check | — | persistence page above |
| E2B Surf: Apache-2.0, last commit 2026-09-09, OpenAI computer use by default | — | <https://github.com/e2b-dev/surf> |

### Model and loop

| Fact | Version | Source |
| ---- | ------- | ------ |
| Anthropic computer-use tool is `computer_toolset_20260801` (17 actions: screenshot, zoom, clicks, drag, mouse_move, mouse down/up, cursor_position, scroll, type, key, hold_key, wait); no beta header on Opus 5 / Sonnet 5. Haiku 4.5 needs the older `computer_20250124` tool with a beta header | Claude API | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool> |
| Recommended resolution 1280×720 to 1366×768 for web apps; the toolset adds about 4,500 input tokens per request | same | same |
| Request shape: the `tools` entry is `{ "type": "computer_toolset_20260801" }` with optional `configs: { zoom: { enabled } }` and `cache_control`; it **rejects** `display_width_px`, `display_height_px`, `display_number` and `name` from older versions (the model reads the size from the screenshot). Sent through the standard `client.messages.create`, no beta namespace. The model emits one `tool_use` block per action with `name` = the member (`left_click`, `type`, `key`, `screenshot`, …), `toolset_name: "computer"` and the action's parameters as `input` (for example `{ "coordinate": [512, 742] }`); `key` accepts `repeat` 1–100. Screenshots return as a `tool_result` with `toolset_name: "computer"` and an image block. The TypeScript type name for the entry in `@anthropic-ai/sdk` 0.125.0 was not read from the SDK's `.d.ts`; `/plan` pins it with `/find-docs` | same | same |
| Prices per million tokens: Opus 5 $5 in / $25 out; Sonnet 5 $2 in / $10 out; Haiku 4.5 $1 / $5 | same | same, pricing section |
| The docs only *recommend* human confirmation for consequential actions; the API does not enforce it. Anthropic runs prompt-injection classifiers on screenshots and steers the model to ask for confirmation when one fires | same | same, security section |
| Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.268) hosts in-process MCP tools and a `PreToolUse` hook can deny a call, but it has no documented way to use the computer-use tool | SDK 0.3.268 | <https://docs.claude.com/en/docs/claude-code/sdk/custom-tools>, <https://docs.claude.com/en/docs/claude-code/sdk/sdk-permissions> |
| Managed Agents: public beta, no visible desktop ("not currently available" for computer use) | — | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#compatibility> |
| Vercel AI SDK `ai` 7.0.x: tools without `execute` return the call to the app; the Anthropic provider documents `anthropic.tools.computer_20250124` only | 7.0.97 | <https://ai-sdk.dev/docs/foundations/tools>, <https://ai-sdk.dev/providers/ai-sdk-providers/anthropic> |
| Vercel function limit: Hobby 300 s hard; Pro 800 s GA, 1800 s beta. Vercel Cron on Hobby: once per day, imprecise | Fluid compute | <https://vercel.com/docs/fluid-compute#default-settings-by-plan>, <https://vercel.com/docs/cron-jobs/usage-and-pricing> |

### Browser control

| Fact | Version | Source |
| ---- | ------- | ------ |
| Playwright `chromium.connectOverCDP(endpointURL)`; official bindings for Node, Python, .NET, Java | since 1.9 | <https://github.com/microsoft/playwright/blob/main/docs/src/api/class-browsertype.md> |
| CDP `DOM.getNodeForLocation({x, y})` returns the node under a point; `DOM.setFileInputFiles` sets files on an input; `Runtime.evaluate` runs page JavaScript | CDP | <https://chromedevtools.github.io/devtools-protocol/tot/DOM/>, <https://chromedevtools.github.io/devtools-protocol/tot/Runtime/> |
| Chrome's DevTools HTTP endpoint (`/json*`) refuses requests whose `Host` header is not `localhost` or an IP address (`RequestIsSafeToServe` in `devtools_http_handler.cc`). So CDP through E2B's public port proxy would be refused; the CDP client must run inside the sandbox. `--remote-allow-origins` is a separate allow-list for the WebSocket origin | Chromium | <https://chromium.googlesource.com/chromium/src/+/master/content/browser/devtools/devtools_http_handler.cc> |
| Playwright `page.setInputFiles` / `locator.setInputFiles(path)` | 1.63 | <https://github.com/microsoft/playwright/blob/main/docs/src/api/class-locator.md> |
| Stagehand 4.1.0 (MIT, about 809k weekly downloads, works with Claude) — DOM-agent reference, not chosen | 4.1.0 | <https://github.com/browserbase/stagehand> |

### Language and SDK availability

| Fact | Source |
| ---- | ------ |
| E2B official SDKs: JavaScript/TypeScript and Python only; the REST API is described by an OpenAPI file in `e2b-dev/infra`, not by a hosted reference | <https://e2b.dev/docs/sdk-reference>, <https://github.com/e2b-dev/infra> |
| Anthropic official SDKs: Python, TypeScript, Java, Go, Ruby, PHP, C#. The C# SDK is beta | <https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/csharp>, <https://github.com/anthropics/anthropic-sdk-csharp> |
| Blazor Server pushes UI updates over a SignalR circuit with no separate API layer | <https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/signalr?view=aspnetcore-10.0> |
| Microsoft Agent Framework has an Anthropic provider (Python, Go) and no computer-use support found | <https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/model-providers/anthropic> |

### Sandbox alternatives

Scrapybara shut down on 2025-10-15. What E2B has that the browser-only services lack: a full
desktop — a terminal, files, and applications outside the browser.

| Product | Live view + takeover | Persistence | CDP | Notes | Source |
| ------- | -------------------- | ----------- | --- | ----- | ------ |
| Steel | iframe, `interactive=true/false` | Chromium profile persists (300 MB, 30 days); Files API | yes | CAPTCHA solving off by default. Browser only | <https://docs.steel.dev/overview/sessions-api/human-in-the-loop> |
| Browserbase | iframe, interactive | Contexts persist cookies; no file workspace | yes | CAPTCHA solving **on by default**. Free 1 h/month | <https://docs.browserbase.com/platform/browser/observability/session-live-view> |
| Kernel | iframe, `readOnly` flag | profiles persist; files deleted at session end | yes | free $5/month credits | <https://github.com/kernel/docs> |
| Hyperbrowser, Anchor | iframe, interactive | profiles persist | yes | small free tiers | vendor docs |
| Orgo | noVNC, view-only flag | persistent computers, billed per computer | undocumented | no free tier | <https://docs.orgo.ai/guides/embed-vms> |
| Cua | noVNC | session-only by default | own SDK | usage-based, no free tier | <https://github.com/trycua/cua> |

### Package vetting

Checked 2026-09-11 against the npm registry, GitHub and the GitHub Advisory database (last 12
months). These are the versions `/plan` pins.

| Package | Version | Published | Weekly downloads | Licence | Advisories in the last 12 months |
| ------- | ------- | --------- | ---------------- | ------- | -------------------------------- |
| `@anthropic-ai/sdk` | 0.125.0 | 2026-09-10 | 22.3M | MIT | two medium (Apr 2026) in the memory-tool helper, which this design does not use |
| `@e2b/desktop` | 2.4.0 | 2026-09-09 | 40K | MIT | none |
| `e2b` | 2.49.1 | 2026-09-10 | 932K | MIT | none |
| `hono` | 4.13.7 | 2026-09-04 | 36.2M | MIT | ten, mostly medium, Jul–Sep 2026, all fixed in 4.13.7; a widely used package that gets audited a lot — accepted, pinned to the fixed version |
| `@hono/node-server` | 2.1.1 | 2026-08-14 | 33.6M | MIT | four, one high (Mar 2026, static-path auth bypass), fixed |
| `playwright-core` | 1.63.0 | 2026-09-04 | 55.9M | Apache-2.0 | none — used only if the companion moves to Node (see Companion) |
| `croner` | 10.0.1 | 2026-02-01 | 5.0M | MIT | none |
| `zod` | 4.6.2 | 2026-09-10 | 154.9M | MIT | none |
| `react`, `react-dom` | 19.3.0 | 2026-09-09 | 95.7M | MIT | none |
| `vite` | 8.3.0 | 2026-09-10 | 99.0M | MIT | several high in 2026 in the dev server (file access), fixed; dev-only surface |
| `@vitejs/plugin-react` | 6.1.1 | 2026-08-28 | 48.2M | MIT | none |
| `tsx` | 4.23.13 | 2026-08-30 | 48.3M | MIT | none |
| `typescript` | 5.9.x | — | 151.5M | Apache-2.0 | none. TypeScript 7.0.2 (the native compiler) is two months old; `/plan` stays on 5.9 unless Vite and Vitest are confirmed compatible with 7 |
| `vitest` | 5.0.0 | 2026-09-03 | 57.5M | MIT | one critical (Jun 2026, UI server), fixed; dev-only. Version 5 is one week old and pairs with Vite 8 |

Verified imports: `import { streamSSE } from 'hono/streaming'` and
`import { serveStatic } from '@hono/node-server/serve-static'`
(<https://hono.dev/docs/helpers/streaming>, <https://hono.dev/docs/getting-started/nodejs>).

Sources: <https://registry.npmjs.org/>, <https://github.com/advisories>.

## Design

### Repository layout

```
package.json            one package, pnpm, Node 22
src/server/             Hono app: API, SSE, static files, scheduler, run loop
src/server/store/       the bot folder: read and write bot.json, memory, skills, routines, chat, runs
src/server/sandbox/     E2B: create, connect, pause, stream URLs, files, companion client
src/server/agent/       the loop, tool definitions, the gate, takeover, stuck detection
src/server/companion/   companion.py, uploaded into the sandbox (see Companion), and its TS client
src/web/                React + Vite: roster, chat, preview panel, cards, skills tab
data/bots/<id>/         one folder per bot (git-ignored)
examples/job-hunt-bot/  a committed bot folder with the demo skills, copied into data/ by the README;
                        outside src/, so the site-name grep does not cover it — on purpose
scripts/preflight.sh    typecheck, tests, the no-site-specific-code grep
.env.example            E2B_API_KEY, ANTHROPIC_API_KEY, MODEL_ID, TZ (empty values)
```

Commands: `pnpm dev` runs the Vite dev server and the Hono server (`tsx watch`) under one
script, with Vite proxying `/api` and `/events`; `pnpm build && pnpm start` runs the single
production process that also serves the built UI; `pnpm preflight` runs `scripts/preflight.sh`.
Node 22 and pnpm (through `corepack`) are the only local requirements; Python is needed only
inside the sandbox.

### The bot folder (store)

| File | Content | Written by |
| ---- | ------- | ---------- |
| `bot.json` | `id`, `name`, `avatar`, `persona` (one paragraph), `sandboxId`, `state` (`idle`, `working`, `waiting`, `blocked`), `createdAt` | platform |
| `memory.md` | free-text notes, one dated line per entry | the `remember` tool; editable in the UI |
| `skills/<name>.md` | frontmatter `name`, `description`; body in plain sentences | the `save_skill` tool; editable in the UI |
| `routines/<name>.md` | frontmatter `name`, `skill`, `schedule` (cron) or `event`, `enabled`; body: the instruction for that run | the `save_routine` tool; editable in the UI |
| `approval-rules.json` | `requireApproval: string[]`, `alwaysAllow: string[]` — glob patterns over `propose_action` kinds (`send`, `submit`, `book`, `pay`, `delete`, `publish`, `accept-terms`, `other`) and DOM-rule names. Default: `requireApproval: ["*"]`, `alwaysAllow: []` | the user only; no tool can write it |
| `chat.jsonl` | one message per line: `user`, `bot`, `card` (artifact, approval, takeover, status) | platform |
| `runs/<runId>/events.jsonl`, `runs/<runId>/shots/` | every event of a run: step, tool call, gate decision, screenshot hash, cost; the screenshots as files | platform |
| `artifacts/` | files the bot produced through `write_artifact` | platform |
| `workspace/` | files the user gave the bot (for the demo: the CV). Copied into the sandbox at `/home/user/workspace` on create or rebuild | the user, by placing files there |

A bot is created from the UI with a name and a persona. The store is a small module with
`readBot`, `appendChat`, `appendRunEvent`, `writeSkill` and so on; nothing else touches the disk.

### Sandbox layer

- **Create:** `Sandbox.create({ resolution: [1280, 800], timeoutMs: 20 * 60_000, lifecycle: { onTimeout: 'pause', autoResume: true }, metadata: { botId } })`. The resolution follows Anthropic's recommendation for web apps and keeps screenshots at one token budget. Then upload `workspace/` and the companion, start Chrome through `commands.run` in the background with `DISPLAY=:0` and the flags `--remote-debugging-port=9222 --user-data-dir=/home/user/chrome-profile --no-first-run --no-default-browser-check --disable-session-crashed-bubble --window-position=0,0 --start-maximized` (and `--no-sandbox` if the day-one check shows Chrome needs it in this container, as it often does), start the companion, start the stream with `requireAuth: true`. Store `sandboxId` in `bot.json`.
- **Resume:** on a message or a routine, `Sandbox.connect(sandboxId)`; the lifecycle option resumes a paused sandbox. Because only one stream may exist per sandbox, the platform calls `stream.stop()` and then `stream.start()` again after every resume and re-reads the auth key; the companion is restarted if it does not answer within 5 s (the docs say network services need a reconnect after resume).
- **Pause:** when a run ends and no run is queued, the platform calls `betaPause()` after a 2-minute grace period, so a follow-up message does not pay the resume cost. Paused sandboxes cost nothing. If the call throws, the platform logs it, leaves the sandbox running and retries at the next idle check (every 5 minutes); the safety net is the sandbox's own `lifecycle.onTimeout: 'pause'`, which pauses it when the 20-minute timeout runs out.
- **Interrupted run:** if the sandbox stops answering during a run (crash, quota kill, network drop), the run is marked `failed` in `events.jsonl` with the last step, the bot's state returns to `idle`, and the bot posts in chat what it was doing and that it stopped. Nothing resumes on its own; the user sends the goal again. On boot, any run still marked `working` in its `events.jsonl` (the server died mid-run) is closed the same way.
- **Rebuild:** if `connect` fails with not-found (the sandbox was deleted after 30 days, or by hand), the platform creates a new sandbox, uploads `workspace/` again, clears `sandboxId`-dependent state, and posts a status card in the chat: "My computer was rebuilt. Files are back; logins are gone, I will ask you to sign in again." Logins are the only thing lost, and invariant 5 already covers re-entering them.
- **Keep-alive during a run:** the loop calls `setTimeout(20 min)` on the sandbox at the start of every run. The Hobby limit of 1 hour continuous session bounds a single run; the step budget (below) ends a run well before that.

### Companion (the DOM check)

A small Python script (`companion.py`, standard library plus `websocket-client`) uploaded into
the sandbox at create time and started with `desktop.commands.run` in the background. It reads
Chrome's `http://127.0.0.1:9222/json` to find the page target, opens the CDP WebSocket, and
serves three HTTP endpoints with `http.server` on a port that the platform reaches through
`getHost(port)`. Every request carries a bearer token that the platform generates per sandbox
and passes to the companion as an environment variable; a request without it is refused. The
port is public with no authentication of its own, so the token is what protects it. The client
cannot run outside the sandbox: Chrome refuses DevTools HTTP requests whose `Host` header is not
localhost, and E2B's proxy sets a public hostname.

| Endpoint | Input | Output | Used for |
| -------- | ----- | ------ | -------- |
| `POST /element-at` | screen `x, y` | tag, `type`, role, accessible name, `form` presence, whether the element or its nearest button/anchor ancestor is a submit control, page URL, page title | the gate, before every click. `Runtime.evaluate` of a small page script around `document.elementFromPoint` |
| `POST /active-element` | — | the same fields as `/element-at`, plus `autocomplete` | the secret guard before every `type`, and the gate before Enter, Return, Space and typed newlines. `Runtime.evaluate` on `document.activeElement` |
| `POST /page-state` | — | URL, a fingerprint of the page (URL, title, number of inputs), and `unsafe: true` when any visible input is `type=password`, has `autocomplete=one-time-code`, or is a short numeric field (`inputmode=numeric` or `pattern` of digits with `maxlength` ≤ 8) with a non-empty value | the hand-back check in Takeover |
| `POST /set-files` | screen `x, y` of the upload control, sandbox file path | ok | file upload. `DOM.getNodeForLocation` then `DOM.setFileInputFiles`; if the control is a label or button for a hidden input, the page script resolves the associated `input[type=file]` first |

Screen to page coordinates: the page script reads `window.screenX`, `window.screenY`,
`window.outerHeight - window.innerHeight` (toolbar height) and `devicePixelRatio`, and
subtracts them before calling `document.elementFromPoint`. Chrome runs maximised, not in kiosk
mode, so the model can still see the address bar.

**Frames, shadow DOM and unknown targets — fail closed.** `elementFromPoint` returns the
`<iframe>` element for anything inside a frame and the host element for anything inside a shadow
root. The page script descends into same-origin frames (`contentDocument.elementFromPoint`) and
open shadow roots (`shadowRoot.elementFromPoint`) until it reaches a leaf. A cross-origin frame,
a closed shadow root, a companion error or a timeout returns `target: unknown`, and **the gate
treats an unknown target as a rule hit**: the click needs a matching approval or it is blocked
with a card ("I cannot see what this click does — it is inside an embedded frame. Allow once /
Deny"). This is noisier on sites that embed their forms in a third-party frame, and the
write-up says so; the upgrade path is attaching to child frame targets over CDP
(`Target.getTargets`). A reCAPTCHA widget is such a frame, and it is a takeover anyway.

**Day-one prototype, before any other feature work:** (1) `pip install websocket-client` works
in the sandbox and the companion starts; (2) `getHost(port)` reaches the companion with the
token; (3) the CDP WebSocket on localhost accepts the connection with Chrome started as
`google-chrome --remote-debugging-port=9222 --user-data-dir=/home/user/chrome-profile`;
(4) `elementFromPoint` with the offset above returns the element the model clicked, on the
Calendly page and the startupjobs.cz form; (5) `DOM.setFileInputFiles` attaches a file from
`/home/user/workspace` to the startupjobs.cz upload field. **Fallback if (2) or (3) fails:**
decision 1 falls back to pixels plus the `propose_action` signal only, and file upload uses the
native picker with the model typing the full path into the GTK dialog. The fallback is a weaker
gate and is written into the spec as a trade-off if it happens.

### Agent loop

One run = one goal (a message, or a routine's instruction) on one bot. Runs on one bot are
serialised; a second request waits in the bot's queue. The loop:

1. Build the system prompt: the persona, the task-shape scaffold (outcome, sources, constraints, deliverable, review point), the cheap-path-first rule, the takeover rule ("never type a password, code or CAPTCHA answer; call `request_takeover`"), the approval rule ("before any action that sends, submits, books, pays, deletes, publishes or accepts terms, call `propose_action` and wait"), `memory.md`, the skills list with descriptions, and the relevant skill bodies.
2. Take a screenshot, send the messages with the computer toolset plus the platform tools, with prompt caching on the system prompt and tool definitions. Only the last three screenshots stay in the message history; older image blocks are replaced by a one-line text note ("screenshot after step 12"), which keeps a 60-step run under about 60k tokens of context. *Amendment of 2026-09-19:* up to 13 screenshots stay, and the fourteenth removes the oldest ones down to three in one pass (see Amendments).
3. For each tool call: computer actions go through the **gate** and then to the E2B control API; platform tools run in-process. Results (screenshots, tool output) go back as tool results. Every step is appended to `runs/<id>/events.jsonl` and emitted to the UI over SSE. Each toolset action maps to one desktop-SDK method (`left_click` → `leftClick(x, y)`, `type` → `write`, `key` → `press`, `scroll` → `scroll`, `left_click_drag` → `drag`, `mouse_move` → `moveMouse`, `left_mouse_down/up` → `mousePress/mouseRelease`, `cursor_position` → `getCursorPosition`, `wait` → `wait`, `screenshot` → `screenshot`); the two with no method are composed — `triple_click` is three `leftClick` calls, `hold_key` is `xdotool keydown … keyup` through `commands.run` (the desktop SDK itself drives `xdotool`) — and `zoom` is a server-side crop of the last screenshot scaled to the requested size.
4. Stop when the model ends its turn, when the step budget (60 steps) is spent, or when the stuck detector fires: three or more consecutive screenshots that are *near-identical* (mean pixel difference below a small threshold on a downscaled grey copy — the panel clock and the cursor make exact hashes useless) with no tool other than screenshot or wait between them, spanning at least 30 seconds from the first to the last (the span since 2026-09-17, see Amendments). Budget and stuck both put the bot in `blocked` and post a takeover offer.
5. On end, the bot posts a summary message and, if the run was started by a plain message and no skill matched, offers to save what worked (the `save_skill` flow).

Platform tools (all generic; none knows what a job or a company is):

| Tool | Purpose | Side effect |
| ---- | ------- | ----------- |
| `fetch_url(url)` | read a public page as text (HTML stripped, capped at 20k characters). Amended 2026-09-20: only public addresses, checked on the first request and on every redirect (`docs/decisions.md`, "Code review of the whole platform") | none |
| `write_artifact(name, content)` | save a produced document to `artifacts/` and show it as a card | file on disk |
| `remember(note)` | append a dated line to `memory.md` | file on disk |
| `save_skill(name, description, body)` | write `skills/<name>.md` and show it as a card | file on disk |
| `save_routine(name, skill, schedule, instruction)` | write `routines/<name>.md`; the scheduler picks it up | file on disk |
| `propose_action(kind, summary, consequences[], warnings[], target)` | request approval for one irreversible step, named by the label of the control it will activate; the run waits | approval card |
| `request_takeover(reason)` | hand the screen to the human; the run waits | takeover card |
| `ask_user(question)` | ask in chat and wait (used by the interview) | chat |

Grok Bot's task-shape interview is a prompt, not code: when a bot has no skills and receives a
goal, the system prompt tells it to ask for the five items with `ask_user` before starting.

### The approval gate

Two signals; either one stops the action. The gate runs in the platform, between the model's
tool call and its execution.

**Signal A — `propose_action`.** The tool takes `kind`, `summary`, `consequences`, `warnings`
and `target` — the visible label of the control the bot intends to activate (for example
"Schedule Event"). The card shows all of them, the page URL and a fresh screenshot. Buttons:
**Allow once**, **Deny**. Allow creates a one-shot approval **scoped to that proposal**: the
`kind`, the `target` label and the page path. It is valid for 10 steps. Deny returns "denied" to
the model, which must not retry. *Amendment of 2026-09-15 (review finding):* "the page path" is the
origin and the path, so the same label on the same path of another site never matches; and after an
Allow on a blocked click the gate reads the control at that point again before it clicks, because the
page may have moved on while the user decided. A changed control is not clicked, the bot is told to
find it again, and the approval stays valid for it.

**The approval is consumed only by the action it describes.** When a DOM rule fires, the gate
compares the element's accessible name with the approved `target` (case-insensitive, whole
label) and the page path with the approved path. A match consumes the approval and the action
runs. A rule hit that does not match — a different button, the same button on another page, a
misclick — is blocked and posts a fresh card: "This is not the action you approved (*Schedule
Event* on calendly.com). Allow once / Deny." The approved action stays approved. A test covers
the mismatch. **Always allow** is deliberately absent from the card: a standing
rule is written by the user into `approval-rules.json`, not granted in a moment of flow.

**Signal B — DOM rules,** applied to every action that can activate a control: `left_click`,
`double_click`, `left_click_drag` end points, `key` with Enter, Return or Space, and `type` whose
text contains a newline. For clicks the companion returns the element under the cursor
(`/element-at`); for keys it returns the focused element (`/active-element`), because a button
activates on Enter and on Space as well as on a click. The rule set is:

| Rule | Fires when |
| ---- | ---------- |
| `submit-control` | the target element (under the cursor, or focused for a key) or its nearest button/anchor ancestor is `button[type=submit]`, `input[type=submit]`, `input[type=image]`, or a button with no type inside a `form` |
| `enter-in-form` | Enter, Return or a typed newline while the focused element is an `input` inside a `form` |
| `verb-name` | the target is a button, link or input and its accessible name **starts with** a verb from the list (whole word, case-insensitive) and has at most four words — "Apply now", "Odeslat zájem", "Schedule Event" fire; "Sort order" and "Sign in" do not. Verbs: send, submit, apply, book, schedule, confirm, pay, buy, order, delete, remove, publish, post, accept, agree; odeslat, potvrdit, rezervovat, zaplatit, koupit, objednat, smazat, odstranit, zveřejnit, souhlasím, přijmout. "Sign" is deliberately absent: signing in is reversible, and terms are covered by accept/agree |
| `unknown-target` | the companion could not resolve the element (cross-origin frame, closed shadow root, error, timeout) — see "Frames, shadow DOM and unknown targets" |

When a rule fires and a matching approval exists, the action runs and the approval is consumed.
When a rule fires and no approval exists, the action is blocked and a card is posted: "I was
about to click *Odeslat zájem* without announcing it. Allow once / Deny." The event log records
`gate: blocked, rule: submit-control, announced: false`.

**Conflict rule:** when an `alwaysAllow` pattern and a `requireApproval` pattern both match, the
action requires approval. Fail closed, as Grok Bot states and invariant 4 requires. Generated
skills cannot change this: no tool writes `approval-rules.json`.

**Secret guard (invariant 5 in code):** before every `type` action the platform asks the
companion for the active element. If it is `input[type=password]`, or an input whose
`autocomplete` is `one-time-code`, the action is blocked and takeover starts. The model is told
"a human will complete this step". This holds even if the prompt is ignored or the page tries
to trick the model.

### Takeover

- **Triggers:** `request_takeover`, the secret guard, the stuck detector, the step budget, or the user pressing **Take over** at any time.
- **Mechanics:** the bot's state becomes `blocked`. The preview panel's iframe switches from `getUrl({ authKey, viewOnly: true })` to `getUrl({ authKey })` (interactive). The run's loop awaits a promise. No screenshot is taken and no model call is made while the human has control. The user presses **Hand back**; the iframe returns to view-only; the loop resumes with a fresh screenshot and the tool result "the human completed the step".
- **Secrets:** what the human types travels through noVNC into the sandbox. It never passes through the platform process, the event log, the chat or the model's context.
- **Hand-back check (enforced, not assumed):** when takeover starts, the platform records the page fingerprint from `/page-state`. During takeover the UI polls `/page-state` every 2 s and the **Hand back** button stays disabled while `unsafe` is true or the fingerprint has not changed — so a one-time code typed into a plain text field (which the browser does not mask) can never be on screen when the loop resumes. The panel says why: "finish the step and move past the sign-in page, then hand back". No screenshot is taken and nothing is pushed over SSE until hand-back succeeds. A test covers it (below).
- **Session:** the login lives in Chrome's profile in the sandbox and survives pause/resume. It is lost only on rebuild.

### Scheduler and routines

- On boot and on every `save_routine`, the platform parses each enabled routine's `schedule` with `croner` in the timezone from `TZ` (default `Europe/Prague`), computes the next run and sets one timer per routine. Next-run times are written to `bot.json` so a restart shows what was missed; a missed run is started at boot if it is less than 12 hours late, otherwise skipped and logged.
- A firing routine enqueues a run on its bot with the routine's instruction and skill. If the bot is busy, the run waits.
- `event` routines are parsed and stored but no event source is built; the write-up names them as the upgrade path.

### UI

Three columns, following Grok Bot's design laws; one page, React + Vite, updated over one SSE
stream per bot.

| Area | Content |
| ---- | ------- |
| Roster (left) | one row per bot: avatar with a state ring (`idle` grey, `working` animated, `waiting` amber, `blocked` red), name, one status line (last routine result or current action). **New bot** button. |
| Chat (centre) | messages and cards. Cards: artifact (title, first lines, download), approval (summary, consequences, warnings, screenshot, Allow once / Deny), takeover (reason, Take over / Hand back), status (rebuild, routine fired), skill saved (the plain-sentence body). Composer at the bottom. |
| Preview (right) | the noVNC iframe (view-only), the current action as one line above it, **Take over** button. Full-width during takeover. |
| Skills tab | `memory.md`, `skills/*.md`, `routines/*.md` as editable text; `approval-rules.json` read-only with a note that it is edited on disk. |
| Runs tab (added 2026-09-20) | read-only: one line per run (outcome, start, source, actions, goal, end summary), and one run step by step from `runs/<id>/events.jsonl` with the screenshot after each action. An open run is polled every 3 s until its `end` event. Routes: `GET /api/bots/:id/runs`, `GET /api/bots/:id/runs/:runId`. |

The UI shows nothing about the sandbox except its state; no sandbox id, no timers, no cost
(design law 8: ask less of the person). The Runs tab (added 2026-09-20) keeps to this: the
cost in the run record is the operator's cost, not a price, and the tab does not show it.

### Events

Every run event is one JSON line: `{ t, runId, type, ...data }` with types `step`, `tool_call`,
`tool_result`, `gate`, `approval`, `takeover`, `status`, `cost`, `end`. Appended to
`runs/<id>/events.jsonl` and pushed to the bot's SSE channel. Screenshots are stored as files
under `runs/<id>/shots/` and referenced by hash, so the event log stays small and the chat can
show the screenshot that an approval card was based on.

### Secrets and configuration

`E2B_API_KEY`, `ANTHROPIC_API_KEY`, `MODEL_ID` in `.env.local` (git-ignored), empty in
`.env.example`. The companion token is generated per sandbox with `crypto.randomBytes` and stored
in memory only. Stream auth keys are stored in memory only and re-fetched on resume. Nothing
under `data/` holds a credential.

### Enforcing "no site-specific code"

`scripts/preflight.sh` runs `tsc --noEmit`, `vitest run`, and
`grep -rniE 'startupjobs|calendly|linkedin|jobs\.cz|seznam|gmail' src/` which must return
nothing (`examples/` is outside the grep on purpose: it holds skills, which is where site
knowledge belongs). The list is extended when a demo surface is added. The code reviewer checklist gets one
line: "no hostname, selector or field name of any site in `src/`". Everything the bot knows about
a site lives in `data/bots/<id>/skills/`.

### Tests that matter

Not a coverage target — the four places where a wrong answer breaks an invariant:

| Area | Test |
| ---- | ---- |
| Gate | rule matching on fixture elements (submit button, plain button, Czech verb, "Sign in" and "Sort order" do not fire, Enter in a form, unknown target fires); an approval is consumed exactly once and only by a matching target and page (origin and path, since the 2026-09-15 amendment) — a different button or page with an approval outstanding is blocked; an unannounced rule hit blocks; `requireApproval` beats `alwaysAllow` |
| Secret guard | a `type` into a password input is blocked and starts takeover; into a text input passes; Enter and Space on a focused submit button hit `submit-control` |
| Hand-back check | hand-back is refused while the page reports `unsafe` or an unchanged fingerprint, and accepted once both clear; no screenshot event is emitted in between |
| Store | a bot folder round-trips; `save_skill` cannot write `approval-rules.json`; a routine with a bad cron expression is rejected with a message |
| Scheduler | next-run computation across a restart; a missed run within 12 h starts once, older is skipped |

The sandbox and model calls are behind two small interfaces (`SandboxPort`, `ModelPort`) so
these tests run without a network. There are no tests of the E2B or Anthropic SDKs themselves.

## Demo path

The configuration is the job hunt from the job-selection record. Steps 1–3 are recorded as
history before filming (decision 8). "Underneath" names the platform mechanism; none of it knows
about jobs.

| # | What the viewer sees | What happens underneath |
| - | -------------------- | ----------------------- |
| 1 | Roster with one bot, its persona, and the chat history: the user's goal in plain language and the bot's five interview questions with answers | `ask_user` from the interview prompt; answers become `memory.md` lines |
| 2 | (history) The bot's first run: it searched the job board on its screen, found a posting, read the company's site, wrote a dossier card and a cover letter card | `fetch_url`, the computer, `write_artifact` |
| 3 | (history) "Want me to check every weekday morning?" — yes — a skill card and a routine card in plain sentences. From the interview's review point, a second pair: a skill for handling replies and a routine that checks the mailbox every 30 minutes. The Skills tab shows all four as text | `save_skill`, `save_routine` twice; the scheduler sets two timers |
| 4 | **Live starts.** Bot idle. Its ring turns to working with nobody typing; status line: "routine: morning search" | the scheduler fires; the sandbox resumes from pause in about 1 s; a run starts with the routine's instruction |
| 5 | Preview panel: the job board on the remote screen, the bot scrolls, opens a new posting | computer toolset actions; every click passes the gate with no rule hit |
| 6 | A dossier card and a cover letter card appear in the chat | `fetch_url` on the company site, `write_artifact` twice |
| 7 | The application form on the remote screen fills in field by field; the CV appears in the upload field | computer actions for text; `POST /set-files` for the upload from `/home/user/workspace` |
| 8 | The bot stops. Chat: "Everything is filled in. I did not press *Odeslat zájem* — that is your click." The user hovers the button on the preview, does not click | the skill's review point; a `remember` line "handed to the user … I did not submit it" |
| 9 | (The operator states on camera that no application is sent, and that the invitation in the next scene is seeded) | — |
| 10 | Days later (cut). The bot's ring turns to working on its own; status: "routine: check mail". Preview: webmail login page. Ring turns red; a takeover card: "The mailbox asks for a password. Take over?" | the secret guard or `request_takeover`; the iframe switches to the interactive stream |
| 11 | The user clicks **Take over**, types the password on the remote screen, presses **Hand back**. The chat shows no password anywhere | the loop is paused; keystrokes go through noVNC only |
| 12 | The bot reads the invitation, opens the Calendly link, picks a slot. An approval card: "Book Tue 15 Sep 14:00–14:30 for the interview with <company>. Consequences: a calendar invitation is sent to my address; this accepts Calendly's Participant Terms. Warnings: sender is not on the company's domain." Allow once / Deny | `propose_action`; the run waits |
| 13 | The user presses **Allow once**. The bot fills name and email and clicks **Schedule Event**. Calendly shows "You are scheduled!" | the DOM rule `submit-control` fires, finds the approval, consumes it |
| 14 | The user opens their own calendar: the event exists. The bot's chat shows the confirmation and a memory line linking it to the application | the artifact left the sandbox: a real calendar event in a real system |
| 15 | The user reloads the page, then stops and starts the server. The roster, the chat, the skills and the memory are all still there; the bot's screen is where it was | the bot folder; `Sandbox.connect` resumes the paused sandbox |

Approval gate: step 12–13. Takeover: steps 10–11. Artifact at the end: the calendar event
(step 14), the filled application page (step 8), the dossier and the letter (step 6).

## Invariant coverage

| # | Invariant | Mechanism |
| - | --------- | --------- |
| 1 | Visible remote computer | The E2B desktop stream in the preview panel, view-only, live, for every computer action. No recording, no replay. |
| 2 | Real work, not simulation | Real job board, real company pages, real form, real Calendly page, real calendar event. The seeded invitation is input, not outcome, and is narrated. No mocked outcome exists on the path; the `ModelPort`/`SandboxPort` fakes exist only in tests. |
| 3 | One job, finished | Step 13–14: a real booking exists in a real calendar. |
| 4 | Approval before irreversible side effects | The gate: `propose_action` cards plus DOM rules on every click and Enter; `requireApproval` beats `alwaysAllow`; no tool can write the rules file. One approval is one activation: a repeated key, a held Enter, a typed double newline or a multi-click on a gated control is refused before any approval is spent (2026-09-13). |
| 5 | Takeover without secrets in the transcript | The interactive stream URL swap; the loop paused during takeover; keystrokes through noVNC only; the secret guard blocks any `type` into a password or one-time-code field in code; the hand-back check refuses to resume while a password or code field with a value is visible in the page, its same-origin frames or its open shadow roots, or while the focus sits inside a frame the companion cannot read, so no screenshot can carry one. *Hand back anyway* lifts the page-changed check only, and not while part of the page is unreadable. **Residual risk, written down (2026-09-13):** a code typed into a cross-origin frame, left there, with the focus moved outside the frame and the page moved on, is not seen; closed shadow roots are not detected. The choice over "any unreadable frame blocks" is argued in `docs/decisions.md`. |
| 6 | Persistence across sessions | The bot folder is the system of record; the sandbox is paused, not killed, and resumed by `Sandbox.connect`; a lost sandbox is rebuilt from the folder with only logins lost. |

## Failure modes on the day

| Failure | Detected by | Fallback |
| ------- | ----------- | -------- |
| Sandbox will not resume (E2B outage, beta pause lost the sandbox) | `connect` throws; status card "rebuilding" | Rebuild from the folder (about 60 s), sign in again by takeover. If E2B is down entirely: stop filming; the platform cannot start a computer. A second E2B account's key in `.env.local` covers a per-account problem. |
| The job board changed its layout | The model reports it, or the stuck detector fires | The bot has no selectors, so a layout change is a normal page for it. If it still fails: takeover, the human finds the posting, hands back. |
| Chrome inside the sandbox lost the mailbox session | Login page appears | That is the scripted takeover scene; it costs nothing extra. |
| Calendly shows a reCAPTCHA from the sandbox IP | The model reports a CAPTCHA, or the stuck detector fires | Takeover; the human solves it; hand back. Rehearsals are spread out and test bookings cancelled, as the job-selection record says. If Calendly blocks the IP outright: Google Calendar appointment page as the fallback surface, decided in the job-selection record. |
| The model loops or misclicks | Stuck detector (three or more near-identical screenshots over at least 30 seconds), step budget (60) | Bot goes `blocked`, takeover card. Switch `MODEL_ID` to Opus 5 for the next run. |
| The gate blocks a harmless click (a search button named "Send") | A card appears that the operator did not expect | Press **Allow once**; the card is the product working as designed, and can be narrated. |
| The companion is unreachable (port, token, crashed) | Health check before each run fails | The sandbox layer restarts the companion (the same step it runs after every resume). If it still does not answer, the run refuses to start and posts a status card. The loop never falls back silently to a weaker gate. |
| Slow network, screenshots take seconds | Step timing in the event log | Nothing to do live; the resolution is already the smallest recommended. Film in the morning when the connection is quiet. |
| The scheduler fires while the operator is not ready | The ring changes on its own | For filming, the routine's schedule is set to a specific minute a few minutes ahead. |

## Scope budget

> **Superseded 2026-09-12.** This section budgeted the build in human days and ordered a cut list by
> the days each cut saved. Two things made that framework wrong. The build landed in about one day,
> all seventeen tasks, so the four-day premise never held. And the author ruled that time is
> information, never a reason: nothing is cut for the days left, only for proving nothing the demo
> needs or adding a failure mode to the filmed path (`CLAUDE.md`, delivery constraint 4). The text
> below is kept as the record of what was decided on 2026-09-11. Its three cuts were re-decided on
> their merits on 2026-09-12: the second apply surface and the skill-writing evidence in the
> job-selection record, the per-application CV in the private backlog Parked. The "never cut" list still
> stands, because it is a merits list.

Effective build days: about four (calendar 2026-09-12 to 2026-09-18, shared with a second case
study). The plan below spends all four on the assumption that the three day-one checks pass
(companion, pause across a day on Hobby, Calendly from a sandbox IP). It carries no slack, so
**the cut decision is taken at the end of day 1, not on day 3:** each failed check costs about
half a day of fallback work, and every half day is paid for from the cut list below, in order,
before day 2 starts. The order of the days follows the demo path's dependencies, so a cut late in
the list still leaves a coherent demo.

| Day | Build | Demo steps it unlocks |
| --- | ----- | --------------------- |
| 1 | Sandbox layer (create, connect, pause, stream); companion prototype (the five checks); loop with the computer toolset and `propose_action`; bare event stream to a page. **Ends with go/no-go on the three checks and the cut list applied** | 4, 5, 7 |
| 2 | UI (roster, chat, preview, approval and takeover cards, hand-back check); DOM rules and the secret guard; store with pause/resume; `remember`, `write_artifact` | 6, 8, 10, 11, 12, 13, 15 |
| 3 | Skills, routines, scheduler, `save_skill`, `save_routine`, `fetch_url`, the interview prompt; act one rehearsal on the real job board, **on a different real posting than the filmed one**, so the filmed run is still the bot's first encounter with the filmed form (job-selection hard rule 2) | 1, 2, 3 |
| 4 | Act two rehearsal (mail routine, Calendly); README from a clean clone; write-up skeleton; pre-flight grep | 9, 14, delivery |

Day 2 is the most loaded day and has no slack of its own. If it runs long, cuts 1 and 2 are
taken that evening, before day 3 starts, so that day 3 and 4 keep their content.

The rebuild path is **not** in the day plan: it is documented from day one as a manual procedure
(delete `sandboxId`, restart, sign in again) and built only if the day-one pause check fails,
because then it is the persistence mechanism rather than a fallback.

**Cuts, in order, when a day-one check fails or a day overruns:**

1. Skill writing on camera → skills pre-written by hand in the bot folder, the `save_skill` flow argued in the write-up (loses step 3 as a scene; saves about half a day).
2. The Skills tab as an editor → read-only view; editing on disk (saves a quarter day).
3. Act two → argued in the write-up (loses invariant 3's only demonstration — the last cut, as the job-selection record's R6 says; saves a day).

**Never cut:** the gate with both signals, takeover with the secret guard, the paused sandbox
with the bot folder as the system of record. Those are the delta over Surf.

**Running cost of the live checks and rehearsals, estimated:** about 20 hours of sandbox time at $0.06 is
$1.20, inside the $100 credit; about 30 model runs at $1–2 each on Sonnet 5 is $30–60. A filmed
run costs about $2.

**Parked (moved to the private backlog Parked with these reasons):**

- Bot-to-bot hand-off and login grants — designed in decision 3, no second bot in the demo.
- Event-triggered routines — parsed and stored; no event source is built.
- An `Always allow` button on the approval card — standing rules are edited in the rules file by the user; a button in the moment of flow is how permissions creep.
- A file-upload UI for the workspace — files are placed in the folder; the interview is recorded before filming anyway.
- IMAP mailbox tool with a masked secret card — the production upgrade named in decision 7.
- Multi-user, authentication on the platform itself — one operator on one machine.
- Prompt-injection defences beyond Anthropic's screenshot classifier and the gate — the gate is the defence: a page that tells the model to "click submit" still hits a rule.

## Alternatives Considered

### Fork E2B Surf

Sanctioned by the brief, and it would give the stream embedding for free. Rejected because Surf
is a Next.js app built around one short session; the long-running process, the store, the gate
and the scheduler would replace nearly all of it, and a fork that keeps its shape would inherit
Vercel's function limits. Surf is read, not forked.

### DOM-only agent (Stagehand or browser-use)

Faster, cheaper and more reliable on forms, and the gate is trivial. Rejected because the brief
names "real work in a visible remote computer" as what its authors care about most; an agent that
never moves a cursor reads as Playwright with a model, and it cannot leave the browser.

### Shared computer per user (Grok Bot)

Sign in once, every bot inherits it. Rejected in decision 3 for the product argument: bots that
share cookies are not security boundaries, and this POC's opinion is that they should be.

### Steel, Browserbase and the other browser services

Excellent live view, takeover and profile persistence; Steel in particular has CAPTCHA solving
off by default and interactive/read-only as a URL flag. Rejected because they are browsers, not
computers, and because the design would then be "the bot's browser" rather than "the bot's
computer". Named in the write-up as the cheaper path if the product never needs a desktop.

### Vercel plus a worker

The client's own shape. Rejected because the demo never shows it and it solves nothing the demo needs; named as the upgrade
path in decision 5.

### An agent framework (Agent SDK, Vercel AI SDK, LangGraph, Microsoft Agent Framework)

Each puts its own loop between the model's tool call and our execution, which is where the gate
sits. The Agent SDK cannot host the computer-use tool at all. The Vercel AI SDK's
"tool without `execute`" pattern would work and is the closest second; rejected because it only
documents the older computer tool.

## Open Questions

| # | Question | Who decides |
| - | -------- | ----------- |
| 1 | ~~Which mail provider for the bot's dedicated mailbox~~ — decided 2026-09-11: Seznam Email, `bot@example.test` (free, plain password login, IMAP included for future event routines). Still open: whether a cloud-IP sign-in passes without a challenge — the day-one check. | Day-one prototype |
| 2 | Which posting the filmed run uses — question 9 of the job-selection record, unchanged. It must differ from the rehearsal posting. | The author, before day 3 |
| 3 | Whether the Python companion's raw CDP works on the first try, or the custom-template-with-Node fallback in decision 18 is needed. | Day-one prototype |
| 4 | Whether a paused sandbox on the Hobby plan can be resumed the next day (the "1 hour" limit's meaning). If not: rebuild daily during the build (logins re-entered by takeover) and put the Pro plan in the write-up as the production cost. | Day-one prototype: pause, wait past the hour, resume |

## Amendments

Dated changes to the decisions above, each proposed by Claude and closed only on the owner's word.

### 2026-09-12 — Daily budget, routine density, and the blocked-bot hold (accepted 2026-09-13 on the owner's word: $25 a day, the other defaults kept)

**Why now.** The first act-one rehearsal measured the cost of a run: a clean act one is $1.18
(44 steps, 41 model calls); a run that spends its whole 100-step budget is about $1.90; a step
costs about two cents. A run is capped (150 steps, 200 model calls, 30-minute waits on a question
or an approval), but nothing caps runs per day: a bot-written routine may fire every minute, the
mail trigger is fired by anyone who emails the bot, and since today a run that ends blocked keeps
its computer awake until the human hands back. The owner set organisation spend limits on 2026-09-12;
this is the platform's own layer under them, and it must exist before the server runs unattended
and before a reviewer puts their own key into a clone.

**Proposed limits (defaults; each is one operator setting in `.env.local`, named in the README as
operator setup, not as something a user configures in chat):**

| Limit | Default | Reasoning |
| --- | --- | --- |
| `DAILY_BUDGET_USD` | 25 (the owner's word on 2026-09-13; proposed 15) | About thirteen worst-case runs ($1.89 each) or twenty clean act-one runs ($1.18) a day across all bots. A normal demo day is the morning routine ($1–2), zero to two mail-triggered runs ($1–2 each) and a few typed goals; a rehearsal day is more. The organisation limit stays the outer wall. |
| `ROUTINE_MIN_INTERVAL_MINUTES` | 15 | A routine denser than every 15 minutes is refused at save with a message the bot can act on ("the closest a routine may run is every 15 minutes"). Nothing on the demo path needs a denser schedule; the daily budget covers the rest. |
| Mail trigger debounce | 5 minutes (constant) | After a mail-triggered run starts, further rises in the unseen count within 5 minutes are folded into that run; the bot reads everything new when it opens the mailbox anyway. |
| `BLOCKED_HOLD_MINUTES` | 30 | A run that ends stuck or over budget keeps its computer awake this long for the human; then the computer goes to sleep (the normal two-minute pause) and the takeover card is updated to say so. A new goal wakes it (the manager already resumes a paused computer); hand back after the sleep is refused as "not answering", which is right, because the screen may still hold what the human left on it, and the next run's first screenshot would carry it. |

**Where each is enforced, and how it shows.**

- The budget: before a run acquires its computer, the runner sums the `cost` events of every run of
  every bot that started today (the day boundary is midnight in `TZ`, the same clock the routines
  use). Past the limit the run does not start: a status card says "Today's budget of $25 is used
  up ($25.20 spent), so I did not start. Runs start again tomorrow." (it names no setting; the log
  line and the README do), the run ends with outcome
  `budget`, and a routine's `lastResult` records it. A run in flight is never cut mid-way: the
  step and call caps bound it, and cutting a run at a form half-filled is worse than one run over
  the line.
- Routine density: `writeRoutine` in the store validates the cron with `croner` by computing the
  gap between the next two runs; a gap under the minimum is refused with the message above, so
  `save_routine` (the bot's tool) and the Skills tab (the user's editor) both hit it. Event
  routines have no schedule and are bounded by the debounce and the budget.
- The debounce: in `MailWatcher`, a rise seen within five minutes of the last fired event is logged
  and not fired.
- The blocked hold: the runner arms a timer with the held keep-alive; when it fires, it drops the
  keep-alive, releases the computer and updates the open takeover card's text.

**Tests that matter:** a run refused past the budget posts the card and starts no computer; a
run under the budget starts; the sum ignores yesterday's runs; a routine every 10 minutes is
refused and one every 15 is saved; a second rise within five minutes fires no second event; a
blocked run's computer is released when the hold timer fires and the card says so.

**Trade-offs written down.** A budget in dollars depends on the price table in `model.ts`; a model
without a price costs $0 in the sum and is already warned about at boot. Summing event files on
every run start reads a handful of files a day, which is fine for one operator; a running total in
one file is the upgrade if it ever shows in the logs. The blocked hold trades up to 30 minutes of
sandbox time per blocked run for a takeover card that points at a live screen.

**Not in this amendment:** a per-bot budget (one operator, one bot on the demo path), a cost line
in the UI (the page shows nothing about the sandbox but the bot's state, decision 15 above), and
the `Always allow` button (parked).

**Implementation (2026-09-13):** `docs/plans/2026-09-13-daily-budget-plan.md`. Its table D1–D9
records where the code differs from the text above and why: the budget card names no setting, a
budget of 0 stops every run, the mail debounce fires the held mail once its five minutes are over
instead of dropping it, the hold is extended while the bot's screen is open in the page, the end of
the hold ends the takeover card and sets the bot idle, the density check reads the next 100 runs, and
two sentences above were wrong about which files the sum reads and when a missing price is warned.

### 2026-09-13 — Interrupted work, truthful outcomes and continuity (accepted on the owner's word)

Two code reviews on 2026-09-13 found nine gaps; the verdicts and the fixes are in
`docs/plans/2026-09-13-reliability-pass-plan.md`. What changes in this spec: the "Interrupted run"
paragraph above now has three closing states instead of one. A run the previous process accepted
but never started is closed `failed` with "the server restarted before this run started" and the
goal named; a run cut mid-work is closed `failed` as before; a run cut after the user approved an
action is closed `unknown`, and the bot says it cannot tell whether the action went through, so
"send it again" is the user's informed choice. A scheduled routine consumes its occurrence when its
run starts, so a restart never fires it again as missed. New: a Stop button (outcome `cancelled`,
a pending approval denied, never allowed), the last six chat lines with each goal and a
`read_artifact` tool, and a persisted mailbox next-UID so mail that arrived while the platform was
down starts its routine at boot.

### 2026-09-15 — Learning any job through conversation (review of the product goal against the code)

The product goal says a user describes a job in ordinary language, the bot asks for what is
missing, does the job, saves reusable skills and memory, and creates a routine when asked; the
user writes no skill, edits no file and learns no internal name. Against the code on 2026-09-15
(`docs/plans/2026-09-15-learning-gap-plan.md`, "Gap assessment"), four things fell short, all in
the system prompt (`src/server/agent/prompt.ts`), and the tools were one sentence short. What
changes in this spec:

- **The interview is for every goal no skill covers, not for a bot with no skills.** "When a bot
  has no skills and receives a goal, the system prompt tells it to ask for the five items" (Agent
  loop) becomes: on every message run, the bot works out the task shape of a goal no skill covers
  from the goal, its memory and its skills, and asks with `ask_user` only for a part that is still
  missing, one question at a time, writing each answer to memory before the next question, so an
  interrupted conversation loses nothing. A goal a skill covers gets no questions. The interview
  stays a prompt, not code.
- **A skill is saved on request; a schedule is a separate question.** Step 5 of the Agent loop
  ("offers to save what worked") and Demo path row 3 ("Want me to check every weekday morning?" —
  one question for the skill and the routine) are superseded: after a job no skill covered ran to
  the end, the bot offers to save the way it did it as a skill, and the user may ask for that at any
  time ("save this so you can do it again"); a skill needs no routine. Whether to run it on a
  schedule or on an event is asked apart, and only then is the routine written. A skill is never
  saved for a job that did not finish; the bot says what is missing instead.
- **A correction is a rewrite under the same name.** "Skills … the user can read and correct"
  (decision 11) gains the in-chat path: "next time do X" rewrites the skill through `save_skill`
  under its own name, the whole body, and the bot says what changed; `save_skill` and
  `save_routine` say "updated" when the name existed, and their descriptions say that an existing
  name is replaced, so a routine keeps running the corrected skill instead of an old copy. A fact
  goes to memory; a change of time or instruction is a new `save_routine` under the routine's name.
- **The capability boundary is stated to the model.** A skill is instructions, never a capability.
  The prompt lists what the platform can do — public pages through `fetch_url`; any site, form or
  login in the bot's own browser, with a human typing every secret by takeover; files from the
  workspace; artifacts; memory; questions in chat; skills; routines on a schedule or on the events
  `save_routine` lists — and what it cannot: another computer or file, code, an API call, a phone,
  a text message, a message to anyone except through a web page on its screen, an event that is not
  listed, and any secret; the user's own logins never enter the platform. When a goal needs such a
  step, the bot names it before it starts and offers the nearest thing it can do, instead of saving
  a skill that claims it.

Unchanged: no tool writes `approval-rules.json`; the approval gate, the secret guard and the
takeover are not touched; nothing job-specific enters `src/`. **Trade-off:** these are rules in a
prompt, so they bind the model only as far as it follows them; the tests pin the wording and the
plumbing (what one run saves is what the next run receives after a restart), and a live run on a
fresh bot is the check on the model. A rule the model ignored gets a wording fix and another run.
The Skills tab stays as the by-hand path to read and correct a skill.

### 2026-09-16 (evening): the booking surface is Cal.com

Calendly refused bookings from the bot's computer's address (its spam filter; the record is "Act
two, round 4" in the platform plan). The demo path's act-two rows stay as written with one page
name changed: the booking is made on a Cal.com page owned by the same interviewer account, with the
same Google calendar behind it, and the button is **Confirm**. The decision, the accepted trade-off
(Cal.com has a public booking API) and the fallbacks are recorded in the job-selection spec,
"Decision 2026-09-16, evening: Cal.com replaces Calendly as the booking surface".

### 2026-09-17 — Round 4 fixes: the stuck detector needs time as well as screenshots, and a takeover of an idle bot holds its computer

Two findings of act two, round 4 (2026-09-16 evening, "Rehearsal notes" in the platform plan),
fixed on 2026-09-17 before the video.

- **Finding A.** The stuck detector ended a run after three near-identical screenshots taken
  within about ten seconds of a page that was still painting after the computer resumed. The rule
  now needs both: three or more consecutive near-identical screenshots with nothing but waits
  between them, *and* at least 30 seconds from the first of them to the last. A slow page paints
  and the next screenshot differs, which starts the count again; a real loop keeps going and is
  caught a few screenshots later. **Trade-off:** a genuine loop now costs up to 30 seconds and a
  handful of model calls more before it is stopped, about ten cents; a page that takes longer than
  30 seconds to paint still ends the run. The upgrade, if that shows: ask the companion whether the
  page is still loading before a screenshot counts.
- **Finding D.** A takeover started from the page on an idle bot had nothing holding the computer
  up, and the two-minute idle pause fired under the human's hands. Now the interactive stream
  request on an idle bot takes a hold on its computer (a third holder next to the run and the
  setup, brought up through the manager's own serialized path like a run's, so a pause already in
  flight settles first and a computer that paused a moment ago is resumed, and the page streams from
  the session that comes back; with the same keep-alive the run uses); the hold ends when the human
  presses Hand back, or
  a minute after the page stopped asking whether hand back is allowed, which is what a closed tab
  looks like. A goal that arrives while the human has the screen passes the same check as Hand
  back before it takes the screen, as a goal on a blocked bot already did (review of 2026-09-15),
  and ends the takeover only once it has passed the budget check and takes the computer.
  **Trade-off:** a tab left open on the screen holds the computer awake, as it already did for a
  blocked bot; E2B's own session limit ends it.

- **Length, at the owner's request after the timing analysis of the booking run (2026-09-17).** The
  five-minute run spent 246 of 303 seconds in model calls, and two calls of about 40 seconds
  each wrote pages of reasoning between actions, with a closing report under headings. A new rule
  in the system prompt caps both: between actions a sentence or two, the reasoning about memory,
  doubts and rules on the approval card as warnings, one short closing message without headings, one
  sentence when a run found nothing to do. The reply skill of the example bot was rewritten from
  1,192 to about 820 words with the same rules in numbered kinds of mail, because the Skills tab
  shows it on camera as the plain sentences a user can read. **Trade-off:** the careful comparison
  against memory is what made the card of 2026-09-17 right, so both changes are believed only after
  the three live runs of the duplicate plan's Task 4 (Steps A, B and C) with correct warnings.

- **The step cap, the notice and the budget card (2026-09-17, the re-run of round 4's Step A
  under the length rule; commit `ab5c093`).** The run reached a correct card in 102 seconds, but
  Cal.com refused the first slot (its two-hour minimum notice, most likely), the retry cost 58
  steps, and the run ended by the cap one step after the second approved click, before the bot saw
  the confirmation page or wrote its "Booked on" line; the next run met a confirmation it could
  not place and spent 100 steps opening mails in a click loop. Now: 150 steps and 200 model calls;
  every tool result carries a notice once fifteen steps remain, so the model finishes or says
  what is missing; the budget card names an approved action done in the last two steps, whose
  result the bot never saw. **Trade-off:** the worst case of a run costs about three dollars
  instead of two, inside the daily budget. **Known limit, written down:** a click loop is ended by
  the cap, not by the stuck detector, which counts only screenshots with nothing between them;
  the upgrade is to count repeated identical actions on an unchanged screen. The length rule
  stays: it halved the time to the card; it gains one clause, when unsure say so in one sentence,
  because a confused run under it left no narration to read.

- **Correction and the progress guard (2026-09-17 afternoon, `4da2796`).** The two bullets above
  name causes the evidence does not isolate; the owner's review of the logs ("Correction" at the end
  of the platform plan's rehearsal notes) withdraws them. What is established: four mail runs looped
  between the inbox and its mails without a memory line or a proposal, the first of them on the
  plan's own five mails; the stuck detector resets on any action but a screenshot or a wait, so a
  click loop is invisible to it. A progress guard now counts the loop itself: a stretch of steps
  with nothing new and no tool call, which finished runs never took past 15 (one page walk: 26) and
  the loops took to 17–53; the model is told at 16 and 28, the run ends at 40. The run log keeps
  the model's emitted text. The length rule is cut back to the ending only, and whether the
  shorter skill, the routine's wording, screenshot retention or the duplicates make a batch loop is
  open; a retained-facts mechanism was proposed but was not built.

- **Thinking continuity verified on the five-mail case (2026-09-17, 15:55 Prague).** The loop
  discarded thinking blocks even though Sonnet 5 enables them by default. It now returns complete
  assistant content unchanged, raises the output cap and records bounded summaries plus API
  thinking-token counts. With the original memory/chat restored and the same five mails unread,
  the bot recorded both cancellations, proposed only the new invitation, respected Deny and
  finished. Evidence: `docs/evidence/2026-09-17-thinking-replay-funded/README.md`. Keep this repair;
  the proposed retained-facts mechanism is not needed on this evidence. The combined change and
  one live pass do not isolate causation or prove general batch reliability. The review of the
  handoff found that the fixed 120 s request timeout covered only about 10,000 output tokens at the
  measured speed, so the timeout was made to follow the cap; the next review found that Node's
  fetch gives up on the headers at 300 s whatever the SDK's timeout, so the call is now streamed
  and the SDK assembles the message; the second Codex round found that a stream of `ping` events
  kept the run busy for ever, out of Stop's reach, so a stall timer ends a stream that carries no
  event for 120 s and Stop aborts the pending call (thinking-continuity plan, the three "Review
  finding" sections). The third Codex round, a lifecycle review with 26 Runner and nine transport
  probes through the real SDK, found five more: Stop lost while a human wait was being created, Stop
  waiting out an SDK retry delay, an error body that never finishes outside both timers, the SDK
  printing malformed stream data raw, and a continued answer reaching the chat without its first
  part. The first, fourth and fifth are fixed; the second and third stay as known limits in the
  README; and the round changed the KISS rule and the fix protocol, because each earlier patch had
  been correct for its case and incomplete on the contract (the proposal's status line in
  `docs/plans/2026-09-17-lifecycle-and-review-hardening-proposal.md`; the thinking-continuity plan,
  the fourth "Review finding" section).
  The same review corrected the progress guard: a failed tool call is no longer progress, and a
  screenshot of a screen the run has not shown before is.

Unchanged: the gate, the secret guard, the hand-back check and the bot folder.

### Amendment — 18 September 2026: applicant facts come from chat

The Act One rehearsal exposed a missing source: the bot can attach the workspace PDF, but no
tool reads that PDF. The old search skill nevertheless told it to use the CV when writing a
letter. Attaching a document does not establish knowledge of its contents.

The current setup path uses the existing chat and memory primitives. The user supplies relevant
career facts and a concrete project example in chat. The bot records the source with `remember`.
A letter may use that profile and company sources the bot actually read. If a relevant example
is missing, it asks before drafting. If the user says the CV changed, it asks for updated facts
and records which old profile they replace. It does not claim to detect or read a changed PDF.

The reusable skills also require source dates, quantities and qualifiers to keep their meaning.
An approval warning about earlier work uses an application entry for the same posting URL, not
an interview booking. The event date inside the note governs the warning; a UTC storage prefix
is not a substitute for that local event date.

**Trade-off:** there are two inputs to keep consistent: the PDF to attach and the profile supplied
in chat. This matters when the CV changes. The upgrade is a bounded workspace document reader.
For the rehearsal, Codex checked selected facts against the existing PDF and supplied them in
the product chat; Hunter saved the facts and rewrote its own skills. That is assisted setup,
not evidence of automatic PDF ingestion. No platform capability or approval rule was added.

Correction and verification record: `docs/plans/2026-09-18-act-one-grounding-correction.md`.

### Amendment — 18 September 2026: local network boundary

The rehearsal found the API listening on all interfaces without a login. Both the API and Vite
now bind to `127.0.0.1`; the development proxy uses that address too. Before any route executes,
the API rejects outside Host/Origin values, opaque origins and cross-site browser requests.
Tests use real approval state and temporary store files to prove rejection has no side effect.
Live HTTP checks and listener inspection verify the deployed local behavior.

This remains one trusted operator on one machine. Other local programs can access the API.
Direct network hosting and reverse proxies are unsupported. Hosting for other users requires
explicit authentication and a deployment-specific origin policy. No dependency was added.

### Amendment — 19 September 2026: a run is told its date and time

Live cycle 3 of the shortlist feature found that the platform gave the model no date (finding F
in `docs/evidence/2026-09-18-shortlist-and-notices/README.md`). Neither the system prompt nor the
first message of a run carried one. On the 19th a bot whose newest memory note was a day old wrote
"today (2026-09-18)"; the evening before, the same bot had asked its user for the date. Skills
write dated memory lines, and a rule such as "one shortlist in the last seven days" needs today's
date, so a wrong day is a wrong record.

The first message of every run now begins with one line from the platform's clock, for example
"Platform clock: this run started on Saturday, 19 September 2026 at 08:13 (Europe/Prague)." The
zone is `TZ`, the clock the scheduler and the daily budget already use, never UTC. The line is read
once, when the run starts, and the same first message goes into every model call of that run.

Two choices, with their reasons. The line stands in the first message and not in the system
prompt: the system block of two runs with unchanged memory then stays identical, so the prompt
cache can still be reused between runs that are close in time. And it says when the run
*started*, because that stays true while a run waits half an hour for its user.

What is lost: a run that crosses midnight, or that waits long, keeps the date and time of its
start, and the model has no way to ask for the time later. It would start to matter for a job
that must act at an exact minute inside a long run. The upgrade is a small platform tool that
returns the current time; nothing in the demo needs it. No dependency was added.

Left as it is, on purpose: the date that the platform puts in front of every memory note is still
a UTC date (`src/server/store/memory.ts`), so a note written between midnight and two in the
morning, Prague summer time, carries the day before in its prefix. The code review of this change
found it. It stays because the skill `apply-to-posting` already tells the bot that this prefix is
a storage stamp in UTC and never the date of the event, because a change would leave one memory
file with two kinds of prefix, and because the harm that mattered is gone: with the clock line the
model no longer works out today from its notes. The upgrade is `dayIn(now, TZ)` in `appendMemory`,
together with a corrected sentence in that skill.

### Amendment — 19 September 2026: old screenshots leave the history in batches

The loop section says that only the last three screenshots stay in the message history. That rule
replaced the oldest screenshot after every turn. The edit sits early in the conversation, and the
provider's prompt cache only matches an unchanged beginning, so almost every turn wrote the whole
conversation to the cache again. Measured on 68 recorded runs: cache writes were 69% of the model
cost (`docs/evidence/2026-09-18-cache-batching/`).

The rule now: up to 13 screenshots stay in the history (`IMAGE_PRUNE_LIMIT`). The fourteenth
removes the oldest ones down to three (`IMAGES_KEPT`) in one pass. Only the image block is
replaced by its one-line note; text that came in the same tool result stays, so a warning beside
a screenshot is never lost (invariant 4). Every kind of image counts: a screenshot, a zoom, the
fresh screenshot after an action that got no answer. Design:
`docs/specs/2026-09-18-screenshot-cache-batching-design.md`; plan and live record:
`docs/plans/2026-09-19-screenshot-cache-batching-plan.md`; commits `b6bcf4a` and `a831f69`.

Accepted on 19 September 2026 by the plan's six acceptance items, on six live runs, the first on
revision `b6847da` and the other five on `a8c711e`, which adds only the repair of that first
attempt: both acts, a manual takeover, and one failed first attempt that stays in the numbers
(`docs/evidence/2026-09-19-cache-batching/README.md`). The same act-one job cost $1.53 on the old
rule and $0.72 on the new one; the mail runs measured held at most 9 screenshots, so nothing was
removed; the booking run cost $0.26 on both days, and the confirmation run cost $0.12 against $0.07,
with 11 steps against 5.

What is lost: up to ten more old screenshots travel in every request. In the replay of the
recorded runs the largest prompt grew from about 47k tokens on the old rule to about 55k on this
one, still under the "about 60k tokens" the loop section names (never removing an image reached
about 93k). The one call after a removal writes the conversation to the cache again. It would
start to matter for a job with many more screenshots per run. The fallback is one constant:
`IMAGE_PRUNE_LIMIT = 3` is the old rule. No dependency was added.

## Demo-path amendment — shortlist and reply orders

Recorded 2026-09-20 for the design agreed on 2026-09-18. The original act-one
steps 4–8 now use steps 4–13 of
`docs/specs/2026-09-18-shortlist-mail-and-notifications-design.md`: Hunter emails
a numbered shortlist with a compact dossier for every offer, then prepares
applications only after the user's selection in chat or a reply email. Every
submission still stops at its own approval card. Both application sites were
verified through Deny; neither submission branch has been run for real.
The mailbox trigger, notices and approval machinery remain generic platform
features. All job-specific behavior stays in Hunter's skills and routines.
