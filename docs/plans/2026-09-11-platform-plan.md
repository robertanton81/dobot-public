# Platform Implementation Plan

> **STATUS: BUILT 2026-09-11 — LIVE CHECKS PENDING.** Every task's code landed as 27 commits on
> `main`, from `88c8ca8` to the commit that adds this header; 203 tests, `pnpm preflight` clean.
> The unchecked `- [ ]` boxes below are historical for the code — **do not re-execute this plan.**
> What is still open is exactly what needs a real sandbox and the API keys: the live part of
> Task 4 (the day-one checks and the "Day-one results" section), the manual checks of Tasks 7 and
> 11, and the rehearsals of Tasks 14 and 15 with their "Rehearsal notes". Flip this header to
> `STATUS: SHIPPED` when those are recorded. If you are modifying the platform, work directly in
> `src/server/**`, `src/web/**` and `examples/job-hunt-bot/**`.
>
> **Plan-vs-reality corrections discovered during execution:**
>
> **Library/version drift:** no pinned version moved (all re-checked against the registry and OSV
> on 2026-09-11). pnpm 10's automatic switch to the pinned 12.3.4 fails with ENOEXEC (pnpm 12's
> bin is a placeholder its own install script replaces), so pnpm 12 was installed globally with
> `npm i -g pnpm@12.3.4`. pnpm 12 refuses esbuild's post-install script until approved:
> `pnpm-workspace.yaml` carries `allowBuilds` (written by `pnpm approve-builds esbuild`) and the
> release-age exclusions pnpm added for the three packages published the day before.
>
> **Plan code prescriptions that needed adjustment:**
> - `config.ts` exports `loadConfig()` instead of a module-level `config` constant: a constant
>   reads `.env.local` at import time and would make `pnpm test` need the keys. `index.ts` calls
>   it once. The store takes its data directory as a parameter (`createStore(dataDir)`) for the
>   same reason; every store function is `fn(dataDir, …)` bound by `createStore`.
> - `SandboxSession.sandbox` is typed `SandboxPort` and the session carries `keepAlive()` and
>   `pause()`, so the lifecycle manager never touches the SDK; `pauseSandbox` takes the raw
>   `Sandbox`. `sandbox.open(url)` (which goes through `xdg-open`) was replaced by
>   `E2bSandbox.openUrl`, which hands the URL to the running Chrome profile. Chrome gets
>   `--remote-allow-origins` for the loopback origins because `websocket-client` sends an `Origin`
>   header; the companion also connects with `suppress_origin=True`. The SDK's `CommandExitError`
>   is translated into `SandboxActionError` in `e2b.ts`, so a failed command is an error result for
>   the model, not the end of the run.
> - The Anthropic types are reached as `Anthropic.Messages.X` (the package exposes no
>   `resources/messages` subpath); the `Message` type needs `stop_details` in the fakes.
> - `RunEvent` is a zod discriminated union (the plan wrote a TS type); `RunEventBody` distributes
>   `Omit` over it. `ChatMessage` and `RunEvent` lines are validated on write and skipped on read.
>   Every file the store rewrites goes through `writeFileAtomic` (unique temp name). `SLUG`
>   rejects a leading or trailing dash. `Routine.skill` is a slug.
> - The companion's `/health` is a `GET` (the plan's Task 2 text said every call is POST; its
>   Task 3 text said GET). `pageState` treats a password or one-time-code field as unsafe only
>   while it holds a value (the spec's wording) and uses `getClientRects()` for visibility.
>   `toPage` divides by the device pixel ratio before subtracting `screenX`/`screenY`. A closed
>   shadow root cannot be told from a plain element, so the host element is described.
> - A platform tool the plan did not name, `attach_file({ coordinate, filename })`, does the CV
>   upload of demo step 7 through the companion's `set-files`; the gate refuses a click or an
>   Enter on a file input and points the model to it.
> - `Approval` carries `botId` and `propose(botId, runId, step, …)`; `pendingOrAllowedFor` takes
>   the current step. Approval cards change status in place through `store.updateChatCard`. The
>   gate emits a `gate: allow` event for every gated action; a computer action logs `step` and
>   `tool_result`, a platform tool `tool_call` and `tool_result`. A second budget of 150 model
>   calls guards platform-tool loops. `step` events log typed text and single-character keys as
>   a length only.
> - Takeover lives in a `TakeoverController` per run (`begin`, `state`, `handback`); the runner
>   holds one per active run, and the same routes handle hand-back after a run that ended blocked.
>   A companion that does not answer refuses hand-back; a logged override (`force`) exists for a
>   sign-in whose page fingerprint never changes.
> - The run starter is a `Runner` class; `RunQueue.enqueue` and `Runner.enqueue` return the run's
>   result so the scheduler can record it. `SandboxManager` takes `{ factory, setTimer, clearTimer }`.
>   The scheduler's cron callback returns the run's promise (so `protect` works), keeps an
>   in-flight set so a reload cannot fire a running routine twice, and never throws.
> - The API sends the page a bot view without `sandboxId` and the routine timers; the hand-back
>   state carries a machine-readable `code`.
>
> - The prompt loads **every** skill body on every run and marks the run's own skill, restoring
>   the spec's "the relevant skill bodies": the plan had narrowed it to the active skill only, so a
>   skill that said "then follow the skill apply-to-posting" pointed at text the model could not
>   see, and a typed goal ran with no skill body at all. Found 2026-09-12 while preparing the first
>   rehearsal, before it could cost a run.
>
> **Corrections applied during review:** `234df09` process-level error handlers; `cf86dc6`
> companion body cap, socket timeout and CDP deadline, symlink-safe `set-files`, schema tests;
> `160c387` and `23699e5` store tests, atomic writes, run-event and chat validation, CRLF
> frontmatter; `b8d37e2` `SandboxActionError`, redacted "I was doing" text, `ToolError`;
> `feb9748` 256 KB request-body cap, HTTP route tests; `5aed470` and `bd1a4ce` gate bypasses
> (`left_mouse_up`, `hold_key`, `Return+shift`, `\r`) and approval consumed only after the action
> ran; `48f68cd` hand-back fails closed when the companion does not answer, the override, the
> runner's hand-back tests; `54c3503` a routine without a skill no longer crashes the process,
> `protect` restored, the bot view; `edb79c6` the route-to-scheduler wiring test; the commit
> "Make Scheduler.stop() wait for the runs in flight" (2026-09-11, found by re-running the
> preflight): `stop()` returned before a fired run had recorded its result, so a shutdown or the
> test teardown could race the bookkeeping write (`ENOTEMPTY` in about one run of seven);
> `inFlight` now maps the routine key to the run's promise, `stop()` awaits them, and a
> regression test reads the result right after `stop()` resolves.
>
> **Deferrals worth tracking (for the write-up's known limits and "next"):** the process has no
> shutdown handler (`SIGTERM`/`SIGINT`), so nothing calls `scheduler.stop()` or pauses the
> sandboxes on exit — the bounded `stop()` is ready for one; a click inside a
> cross-origin frame or on an unresolvable element needs *Allow once* (spec choice); `pageState`
> inspects only the top document; the secret guard cannot see inside a cross-origin frame; the
> user's *Take over* pressed during `ask_user` or a pending approval waits for that answer (up
> to 30 minutes) before the loop hands over; `reload()` racing an in-flight `fire()` can overwrite
> one routine's bookkeeping in a small window; the page casts SSE payloads instead of validating
> them; `fetch_url`'s branches, `propose_action`'s failure branches and the stuck-detector reset
> through the loop have no unit test; event routines are stored, never triggered. Accepted plan
> deviations: the setup card wording and a failure card on computer set-up (Task 7), two extra
> memory lines in the example bot (the name for forms, the CV path) that its skills need.
>
> **Plan history below is preserved as-written for context. Treat the live code as authoritative.**

**Goal:** Build the AI coworker platform from `docs/specs/2026-09-11-platform-design.md` so that the
job-hunt demo path runs end to end on a visible remote computer, with the approval gate, takeover
and persistence enforced in code.
**Approach:** One TypeScript process (Hono + React), one E2B desktop sandbox per bot with a small
Python companion for DOM checks, a plain Anthropic Messages loop with the computer toolset, and a
bot folder on disk as the system of record. The work is split into four milestones that follow the
spec's four build days. Milestone 1 ends with the day-one go/no-go on the live checks; the spec's
cut list maps to named tasks below so a cut is a deletion, not a redesign.
**Design spec:** `docs/specs/2026-09-11-platform-design.md` (binding), with
`docs/specs/2026-09-10-job-selection.md` as the demo configuration.
**TODO items:** section 0 "Run `/plan`" (this document), "Day-one check on the first sandbox",
"Initialise the git repository and make the first commit"; section 1 Foundation (all four items);
section 2 The demo path (all five items); section 3 "README with setup instructions".
**Branch:** `main`. The repository is not a git repository yet; Task 0 runs `git init` and every
task commits directly to `main` (solo repository, no pull requests).
**Scope:** `package.json` and tooling, `src/server/**`, `src/web/**`, `scripts/**`,
`examples/job-hunt-bot/**`, `README.md`, `.env.example`, `.gitignore`, `CLAUDE.md` (the Stack
table, the Commands comment and the "Adding a dependency" rule — already edited on 2026-09-11,
committed by Task 0), `docs/decisions.md` (skeleton).
**Build estimate:** 4 effective build days (M1 1.25, M2 1.25, M3 0.75, M4 0.75) against 7
calendar days to the build freeze on 2026-09-18, shared with a second case study. No slack of its
own: the cut list in "Scope and cuts" is applied at the end of M1 and again at the end of M2. (Written before the build. The build itself landed in about one day, and
the days-based cut list was retired on 2026-09-12: time is information, never a reason — see
`CLAUDE.md`, delivery constraint 4.)

## Assumptions made while planning (confirm or overrule before `/implement`)

| # | Assumption | Why | Cost to change |
| - | ---------- | --- | -------------- |
| A1 | Commits go straight to `main`; Task 0 initialises the repository. | Solo repository, small atomic commits, no review overhead. | none |
| A2 | Runtime is **Node 24 LTS** (`v24.21.0` "Krypton" is the newest LTS line on 2026-09-11; local machine has 24.14.0), not Node 22 as the spec wrote. `engines.node >=24`, `.nvmrc` = `24`. `CLAUDE.md` Stack is updated by Task 0. | Rule from the author on 2026-09-11: always the latest LTS, verified live. | 5 min |
| A3 | Package manager is **pnpm 12.3.4** pinned in `packageManager`; the README gives the one-line install (`corepack enable` or `npm i -g pnpm@12`). pnpm 10 and later auto-switch to the pinned version. npm, Yarn 1 and Yarn Berry were compared on 2026-09-11 (npm needs no install but gives nothing else; Yarn 1 is in maintenance; Yarn Berry's Plug'n'Play adds tooling risk for no gain on one package). | The author asked; pnpm keeps the harness allowlist and the spec unchanged. | 15 min to switch to npm |
| A4 | **TypeScript 7.0.2** (the native compiler, `latest` on npm) runs `tsc --noEmit`. It ships a `darwin-arm64` binary. Vite, Vitest and tsx do not use the TypeScript API, so its missing API does not matter. If a tsconfig option misbehaves, fall back to `typescript@6` (15 min). | Same latest-version rule. | 15 min |
| A5 | One plan for the whole platform, four milestones, a go/no-go after M1. | The spec's cut decision is taken at the end of day 1; the later tasks are written now so the cuts are named. | none |
| A6 | `Sandbox.pause()` replaces the spec's `betaPause()` (deprecated in `e2b` 2.49.1). | Type definitions read 2026-09-11. | none |
| A7 | `lifecycle.autoResume` stays **off** (the default), a deviation from the spec's `autoResume: true`. With it on, any request to the companion port or a stale noVNC iframe would silently resume a paused sandbox; the platform must be the only thing that resumes, so its state stays truthful. `Sandbox.connect()` still resumes a paused sandbox. | E2B auto-resume docs, read 2026-09-11. | none |
| A8 | Paused sandboxes are kept **indefinitely** (docs read 2026-09-11; the spec's 30-day clock is outdated). The rebuild path stays for a killed sandbox and for the committed example bot, which has no sandbox yet. | Live docs. | none |
| A9 | The Hobby "1 hour" limit is the longest **continuous** stretch and resets on every pause and resume (docs read 2026-09-11). The day-one check confirms it; the spec's open question 4 is answered by the docs already. | Live docs. | none |
| A10 | Rehearsal bookings on the author's Calendly page are real and are cancelled afterwards, spread out to stay under the reCAPTCHA threshold. | Job-selection record, R6. | none |
| A11 | The companion is restarted with a **fresh token on every resume**, not only when it fails to answer within 5 s as the spec says. The token lives in the server's memory only, so after a server restart the old token is gone while the paused companion still holds it; a restart is also the documented reconnect step for services after a resume. | Spec "Secrets and configuration" plus the E2B persistence docs. | none |
| A12 | The rebuild-on-not-found branch is built in Task 10 (about ten lines) rather than kept manual: `ensureRunning` must already handle a bot without a sandbox (the committed example bot), and `SandboxNotFoundError` is the same path with a status card. | Same code path either way. | none |
| A13 | `triple_click` goes through the DOM rules like the other clicks (the spec lists `left_click`, `double_click` and drag end points); a triple click can activate a control too, and the code path is shared. | Fail closed. | none |
| A14 | `wait` and `hold_key` are executed at most 10 s per call (the toolset allows 300 s); the result text says when the request was capped. Protects the 60-step budget and the 20-minute sandbox timeout. | Step budget. | none |
| A15 | Non-screenshot computer actions return the text "OK", as the toolset docs prescribe; the model requests screenshots itself. The stuck detector therefore works on the model's own screenshots. | Toolset docs. | none |
| A16 | `triple_click` is one `xdotool click --repeat 3 --delay 80 1` command, not three SDK `leftClick` calls as the spec wrote. Three separate SDK calls each go through the API and may land too far apart for the page to see a triple-click (browsers use a click-interval threshold), while xdotool's repeat is one X11 event sequence. | Same for the DOM, more reliable. | none |

## Research (source links)

All rows verified live on 2026-09-11: versions from the npm registry, advisories from the OSV
database for the exact version, API shapes from the package's own type definitions or the
official docs. The spec's rows are reused only where this table says so.

### Versions and advisories (OSV batch query, 2026-09-11)

| Package | Version (npm `latest`) | Published | Licence | OSV advisories for this exact version |
| ------- | ---------------------- | --------- | ------- | ------------------------------------- |
| Node.js | 24 LTS (`v24.21.0`, local 24.14.0) | 2026-09-07 | MIT | n/a — <https://nodejs.org/dist/index.json> |
| `pnpm` | 12.3.4 (`engines.node >=18`) | 2026-09-04 | MIT | none |
| `typescript` | 7.0.2 (`engines.node >=16.20`; native binaries incl. `darwin-arm64`, `linux-x64`, `win32-x64`) | 2026-07-08 | Apache-2.0 | none |
| `@anthropic-ai/sdk` | 0.125.0 | 2026-09-10 | MIT | none |
| `e2b` | 2.49.1 (`engines.node >=20.18.1 <21 \|\| >=22`) | 2026-09-10 | MIT | none |
| `@e2b/desktop` | 2.4.0 (depends on `e2b ^2.48.0`) | 2026-09-09 | MIT | none |
| `hono` | 4.13.7 | 2026-09-04 | MIT | none |
| `@hono/node-server` | 2.1.1 (`engines.node >=20`, peer `hono ^4`) | 2026-08-14 | MIT | none |
| `croner` | 10.0.1 (`engines.node >=18`) | 2026-02-01 | MIT | none |
| `zod` | 4.6.2 | 2026-09-10 | MIT | none |
| `react`, `react-dom` | 19.3.0 | 2026-09-09 | MIT | none |
| `vite` | 8.3.0 (`engines.node ^20.19 \|\| >=22.12`) | 2026-09-10 | MIT | none |
| `@vitejs/plugin-react` | 6.1.1 (peer `vite ^8`) | 2026-08-28 | MIT | none |
| `vitest` | 5.0.0 (`engines.node ^22.12 \|\| ^24 \|\| >=26`, peer `vite ^6.4 \|\| ^7 \|\| ^8`) | 2026-09-03 | MIT | none |
| `tsx` | 4.23.13 | 2026-08-30 | MIT | none |
| `pngjs` | 7.0.0 (pure JS, no dependencies) | 2023-02-20 | MIT | none |
| `concurrently` | 10.0.5 (`engines.node >=22`) | 2026-08-15 | MIT | none |
| `@types/node` | 24.13.4 (highest 24.x; the `latest` tag points at 22.x, so the version is pinned explicitly) | 2026-09-09 | MIT | none |
| `@types/react`, `@types/react-dom` | 19.3.0 | 2026-09-09 | MIT | none |
| `@types/pngjs` | 6.0.5 | 2024-05-02 | MIT | none |
| `websocket-client` (PyPI, inside the sandbox) | 1.9.2 (`requires_python >=3.10`; the E2B template is Ubuntu 22.04 with Python 3.10) | — | Apache-2.0 | none |

Rule for `/implement` (from the author, 2026-09-11): on install day re-run `npm view <pkg> version`
and the OSV query for the exact version before `pnpm add`; take a newer patch or minor if one
appeared, re-check the docs before taking a new major. The query used:

```bash
curl -s -X POST https://api.osv.dev/v1/querybatch -H 'Content-Type: application/json' \
  -d '{"queries":[{"package":{"name":"hono","ecosystem":"npm"},"version":"4.13.7"}]}'
```

### APIs (primary sources)

| Fact used by the plan | Source |
| --------------------- | ------ |
| `ComputerToolset20260801 { type: 'computer_toolset_20260801'; cache_control?; configs?: ComputerToolsetConfigs }` is a member of `ToolUnion`; `ToolUseBlock.toolset_name?: string`; `ToolResultBlockParam { tool_use_id, type: 'tool_result', content?: (TextBlockParam \| ImageBlockParam …)[], is_error?, toolset_name? }`; `ImageBlockParam.source: Base64ImageSource { type: 'base64', media_type: 'image/png', data }`; `StopReason = 'end_turn' \| 'max_tokens' \| 'stop_sequence' \| 'tool_use' \| 'pause_turn' \| 'refusal' \| 'model_context_window_exceeded'`; custom `Tool { name, description?, input_schema, cache_control? }`; `MessageCreateParams.system?: string \| TextBlockParam[]`, `tools?: ToolUnion[]`; `CacheControlEphemeral { type: 'ephemeral', ttl?: '5m' \| '1h' }`; per-request `RequestOptions { timeout?, maxRetries?, signal? }` | <https://unpkg.com/@anthropic-ai/sdk@0.125.0/resources/messages/messages.d.ts>, <https://unpkg.com/@anthropic-ai/sdk@0.125.0/internal/request-options.d.ts> |
| Toolset request/response shapes: tool entry `{ "type": "computer_toolset_20260801", "configs": { "zoom": { "enabled": true } } }`; the model emits `tool_use` with `name` = action (`left_click`, `type`, `key`, `screenshot`, `zoom`, …), `toolset_name: "computer"`, `input` = the action's parameters; every computer `tool_result` carries `toolset_name: "computer"`; screenshot and zoom results carry an image block, other actions a text "OK"; `zoom` input `region: [x0, y0, x1, y1]` in full-screenshot pixel space, the app crops and scales to fit and the model keeps using full-screenshot coordinates; `key` has `text` and `repeat` 1–100; `scroll` has `scroll_direction` up/down/left/right, `scroll_amount`, optional `coordinate`; `hold_key` and `wait` have `duration` seconds; supported without a beta header on `claude-sonnet-5` and `claude-opus-5`; recommended 1280×800 for web apps | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool> |
| Prompt caching: up to 4 breakpoints; `cache_control` on the last tool caches all tools; on the last system block caches the system prompt; minimum cacheable prompt 1,024 tokens on Sonnet 5; cache write 1.25× input price, cache read 0.1× | <https://platform.claude.com/docs/en/build-with-claude/prompt-caching> |
| Client construction reads `ANTHROPIC_API_KEY` from the environment by default | <https://github.com/anthropics/anthropic-sdk-typescript/blob/main/README.md> |
| Desktop `Sandbox.create(opts?: SandboxOpts & { resolution?: [w, h]; dpi?; display? })`; `screenshot(): Promise<Uint8Array>` (PNG bytes, per the README example that writes them to `screenshot.png`); `leftClick(x?, y?)`, `doubleClick`, `rightClick`, `middleClick`, `scroll(direction?: 'up' \| 'down', amount?)`, `moveMouse(x, y)`, `mousePress(button?)`, `mouseRelease(button?)`, `getCursorPosition()`, `getScreenSize()`, `write(text, { chunkSize, delayInMs }?)`, `press(key \| key[])`, `drag(from, to)`, `wait(ms)`, `open(fileOrUrl)`, `launch(app, uri?)`; `stream: VNCServer` with `start({ vncPort?, port?, requireAuth?, windowId? })`, `stop()`, `getAuthKey()`, `getUrl({ autoConnect?, viewOnly?, resize?: 'off' \| 'scale' \| 'remote', authKey? })`; only one stream at a time | <https://unpkg.com/@e2b/desktop@2.4.0/dist/index.d.ts>, <https://github.com/e2b-dev/desktop/blob/main/README.md> |
| Core `SandboxOpts { template?, metadata?, envs?, timeoutMs?, allowInternetAccess?, lifecycle?: SandboxLifecycle, requestTimeoutMs? … }`; `SandboxLifecycle { onTimeout: 'pause' \| 'kill' \| { action, keepMemory? }; autoResume?: boolean }`; `Sandbox.connect(sandboxId, opts?: SandboxConnectOpts)` where `SandboxConnectOpts = ConnectionOpts & { timeoutMs?, onResume?: 'restore' \| 'reboot' }` and "if the sandbox is paused, it will be automatically resumed"; `pause(opts?: { keepMemory? }): Promise<boolean>` (`betaPause` deprecated); `setTimeout(timeoutMs)`; `kill()`; `isRunning()`; `getInfo()`; `getHost(port): string` (hostname; the URL is `https://${host}`); `commands.run(cmd, { background?, cwd?, envs?, onStdout?, onStderr?, timeoutMs? })` returning a `CommandHandle` with `wait()`, `kill()`; `files.write(path, data: string \| ArrayBuffer \| Blob \| ReadableStream)`, `files.makeDir(path)`, `files.exists(path)`; errors `SandboxError`, `NotFoundError` → `SandboxNotFoundError`, `TimeoutError`, `RateLimitError`, `ServiceBusyError` (not a `SandboxError`) | <https://unpkg.com/e2b@2.49.1/dist/index.d.ts> |
| `@e2b/desktop@2.4.0`'s `index.d.ts` line 2 is `export * from "e2b"`, and `e2b@2.49.1`'s export list includes `SandboxNotFoundError`, `ServiceBusyError`, `NotFoundError`, `TimeoutError`, `RateLimitError`, `SandboxError`; so `import { Sandbox, SandboxNotFoundError, ServiceBusyError } from '@e2b/desktop'` resolves. `ConnectionOpts` carries `requestTimeoutMs` and `signal` (the core methods take `Pick<ConnectionOpts, 'requestTimeoutMs' \| 'signal'>`), so `Sandbox.connect(id, { requestTimeoutMs })` type-checks | <https://unpkg.com/@e2b/desktop@2.4.0/dist/index.d.ts>, <https://unpkg.com/e2b@2.49.1/dist/index.d.ts> |
| Persistence: `pause()` keeps filesystem and memory; paused sandboxes are kept **indefinitely**; `connect()` resumes and only *extends* the timeout (use `setTimeout()` for an exact value); pause ≈ 4 s per GiB, resume ≈ 1 s; network services must be reconnected after resume; Hobby continuous-runtime limit 1 hour, **reset by a pause and resume**; a refused pause returns `ServiceBusyError` and the sandbox keeps running — retry after a few seconds; `lifecycle.onTimeout: 'pause'` auto-pauses on timeout | <https://e2b.dev/docs/sandbox/persistence> |
| Auto-resume: `autoResume` defaults to `false`; when `true`, `commands.run`, `files.read/write` and any request to a tunnelled port resume a paused sandbox; a resumed sandbox gets at least a 5-minute timeout | <https://e2b.dev/docs/sandbox/auto-resume> |
| Every sandbox has outbound internet access by default | <https://e2b.dev/docs/sandbox/internet-access> |
| `getHost(port)` gives a public URL with no authentication; Chrome refuses DevTools HTTP requests whose `Host` header is not localhost; the default desktop template has Python 3, `pip`, Google Chrome and **no Node.js** | spec rows, re-used: <https://github.com/e2b-dev/desktop/blob/main/template/template.py>, <https://chromium.googlesource.com/chromium/src/+/master/content/browser/devtools/devtools_http_handler.cc> |
| Chrome DevTools HTTP endpoints: `GET /json` (or `/json/list`) lists targets with `id`, `type`, `url`, `title`, `webSocketDebuggerUrl`; enabled by `--remote-debugging-port` | <https://chromedevtools.github.io/devtools-protocol/> |
| CDP `Runtime.evaluate({ expression, returnByValue?, awaitPromise? })` → `{ result: RemoteObject { type, value?, objectId? }, exceptionDetails? }`; `Runtime.releaseObject({ objectId })`; `DOM.setFileInputFiles({ files: string[], nodeId? \| backendNodeId? \| objectId? })`; `DOM.getNodeForLocation({ x, y })` returns `backendNodeId` always | <https://chromedevtools.github.io/devtools-protocol/tot/Runtime/>, <https://chromedevtools.github.io/devtools-protocol/tot/DOM/> |
| `websocket-client`: `from websocket import create_connection`; `ws = create_connection(url, timeout=5)`; `ws.send(str)`; `ws.recv()`; `ws.close()` | <https://websocket-client.readthedocs.io/en/latest/examples.html> |
| Hono: `import { streamSSE } from 'hono/streaming'` → `streamSSE(c, async (stream) => { await stream.writeSSE({ data, event, id }); stream.onAbort(fn); await stream.sleep(ms) })`; `import { serve } from '@hono/node-server'` → `serve({ fetch: app.fetch, port })`; `import { serveStatic } from '@hono/node-server/serve-static'` → `serveStatic({ root, path?, rewriteRequestPath? })` (root is relative to `process.cwd()`); `c.req.json()`, `c.req.param('id')`, `c.req.query('mode')`, `c.json(body, status)` | <https://hono.dev/docs/helpers/streaming>, <https://hono.dev/docs/getting-started/nodejs>, <https://hono.dev/docs/api/request> |
| croner: `new Cron(pattern, { timezone, protect, catch, paused }?, fn?)`; `job.nextRun(): Date \| null`; `job.stop()`; `job.msToNext()`. **An invalid pattern throws at construction** (`TypeError` "CronPattern: invalid configuration format …" for `not a cron`; `RangeError` "Invalid value for minute: 61") and `{ paused: true }` builds without starting a timer — verified by running croner 10.0.1 on Node 24.14 on 2026-09-11 | <https://github.com/Hexagon/croner/blob/master/README.md>, <https://croner.56k.guru/usage/examples/> |
| zod 4: `z.toJSONSchema(schema)` (draft 2020-12, `additionalProperties: false` on objects); `z.object`, `z.enum`, `z.array`, `z.string().min()`, `safeParse` | <https://zod.dev/json-schema> |
| Vite 8: Rolldown and Oxc replace Rollup and esbuild; `server.proxy: Record<string, string \| ProxyOptions>` (`'/api': 'http://localhost:3000'`); `server.port` default 5173 | <https://vite.dev/guide/migration>, <https://vite.dev/config/server-options> |
| Vitest 5: Node ≥ 22.12, Vite ≥ 6.4; `clearMocks` now defaults to `true`; unawaited async assertions fail; config via `defineConfig` from `vitest/config` with a `test` block | <https://vitest.dev/guide/migration>, <https://vitest.dev/config/> |
| TypeScript 7.0: native compiler, `tsc` unchanged; new defaults `strict: true`, `module: esnext`, `types: []` (so `@types/node` must be listed explicitly), `target: es2025`, `rootDir: .`; removed `baseUrl`, `moduleResolution: node10`, `esModuleInterop: false`; no programmatic API (irrelevant here) | <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>, <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/> |
| pnpm 12: `--frozen-lockfile false` removed (use `--no-frozen-lockfile`); unknown keys in `pnpm-workspace.yaml` fail; nothing else that affects a one-package repository | <https://github.com/pnpm/pnpm/releases/tag/v12.0.0> |
| Node 24: `process.loadEnvFile(path)` throws `ENOENT` for a missing file and does **not** override variables that are already set — verified by running it on Node 24.14 on 2026-09-11 | <https://nodejs.org/docs/latest-v24.x/api/process.html#processloadenvfilepath> |
| pngjs: `import { PNG } from 'pngjs'`; `PNG.sync.read(buffer)` → `{ width, height, data }` with 4 bytes per pixel (RGBA); `new PNG({ width, height })`; `PNG.sync.write(png)` → Buffer | <https://github.com/pngjs/pngjs/blob/master/README.md> |
| concurrently: `concurrently -k -n server,web "cmd1" "cmd2"` (`-k` kills the others when one exits) | <https://github.com/open-cli-tools/concurrently/blob/main/README.md> |
| React 19: `import { createRoot } from 'react-dom/client'; createRoot(node).render(<App />)` | <https://react.dev/reference/react-dom/client/createRoot> |
| `MessageCreateParamsNonStreaming` (extends `MessageCreateParamsBase`) is exported; `Usage` has `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` | <https://unpkg.com/@anthropic-ai/sdk@0.125.0/resources/messages/messages.d.ts> |
| Vitest fake timers: `vi.useFakeTimers()`, `vi.useRealTimers()`, `vi.advanceTimersByTimeAsync(ms)`, `vi.setSystemTime(date)`, `vi.runAllTimersAsync()` | <https://vitest.dev/api/vi.html> |
| xdotool: `click [--repeat N] [--delay ms] <button>` where 1 = left, 2 = middle, 3 = right, 4 = wheel up, 5 = wheel down; `mousemove X Y`; `keydown <key>`, `keyup <key>`; several commands can be chained in one invocation. **Buttons 6 and 7 (horizontal wheel) are X11 convention and are not in the man page** — checked on day one (Task 4); if they do nothing, horizontal scroll returns "not supported on this computer" as the tool result | <https://man.archlinux.org/man/xdotool.1.en> |
| zod 4: `z.coerce.number()`, `z.discriminatedUnion('key', [...])`, `z.record(key, value)` (two arguments), `z.enum([...])`, `z.literal()`, `.safeParse()`, `z.string().regex()`, `.default()`, `z.infer` | <https://zod.dev/api> |

## Scope and cuts

The spec's cut list, mapped to tasks. A cut deletes the named task or the named part of it.

| Cut (spec order) | What is deleted | Saves |
| ---------------- | --------------- | ----- |
| 1. Skill writing on camera | Task 13 keeps the `save_skill`/`save_routine` tools (they are 40 lines) but drops the prompt work and the rehearsal of the on-camera skill-writing scene; the example bot folder is written by hand | ~½ day |
| 2. Skills tab as an editor | Task 11 drops the `PUT` handlers and the textarea save buttons; the tab is read-only | ~¼ day |
| 3. Act two | Task 15 is dropped; invariant 3 is argued in the write-up | ~1 day |

**Never cut:** Tasks 8 (gate, both signals), 9 (takeover with the secret guard and the hand-back
check), 10 (paused sandbox with the bot folder as the system of record).

**The go/no-go (Task 4) lands in two parts.** The four in-sandbox checks (companion, token, CDP,
`elementFromPoint` and file upload on real pages) decide at the end of day 1. The overnight
pause-and-resume check and the Calendly-from-the-sandbox check can only be read on the **morning
of day 2**, before any M2 work starts; that morning is the point where cuts 1 and 2 are taken if
those two checks fail. Task 1 (the store) depends on no sandbox and is done on the evening of day
1 while the overnight check is pending, so nothing waits idle. It decides between:

- All five live checks pass → continue as planned.
- Check 2 or 3 fails (companion unreachable or CDP refused) → decision 1 falls back to pixels plus
  `propose_action` only; Task 3 is reduced to the health endpoint, Task 8 keeps only Signal A and
  the `unknown-target` rule becomes "every click without an approval outstanding is allowed";
  file upload uses the native picker with the model typing the path. Cut 1 is taken to pay for it.
- The pause-across-a-day check fails → the rebuild path in Task 10 becomes the persistence
  mechanism (daily rebuild, logins re-entered by takeover) and the write-up names the Pro plan.
- Calendly blocks the sandbox IP outright → act two moves to a Google Calendar appointment page
  (job-selection record), same tasks.

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Create | `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` | Toolchain (Task 0) |
| Modify | `.gitignore` | add `node_modules/`, `dist/`, `data/`, `.vitest/`, `*.log` |
| Create | `.env.example` | `E2B_API_KEY=`, `ANTHROPIC_API_KEY=`, `MODEL_ID=claude-sonnet-5`, `TZ=Europe/Prague`, `PORT=3000` |
| Modify | `CLAUDE.md` | Stack rows: Node 24 LTS, pnpm 12, TypeScript 7; the latest-version rule under "Adding a dependency" |
| Create | `scripts/preflight.sh` | typecheck, tests, the site-name grep |
| Create | `scripts/day-one.ts` | the live checks of Task 4 |
| Create | `src/server/index.ts` | boot: config, store, sandbox manager, scheduler, HTTP |
| Create | `src/server/config.ts` | `.env.local` loading and validation |
| Create | `src/server/log.ts` | structured JSON logger |
| Create | `src/server/store/types.ts` | zod schemas: `Bot`, `ChatMessage`, `Card`, `RunEvent`, `ApprovalRules`, `Skill`, `Routine` |
| Create | `src/server/store/paths.ts`, `bot.ts`, `chat.ts`, `runs.ts`, `memory.ts`, `frontmatter.ts`, `skills.ts`, `routines.ts`, `rules.ts`, `artifacts.ts`, `index.ts` | the bot folder |
| Create | `src/server/store/frontmatter.test.ts`, `src/server/store/store.test.ts` | store tests |
| Create | `src/server/sandbox/port.ts` | `SandboxPort` interface |
| Create | `src/server/sandbox/e2b.ts` | `E2bSandbox`: create, connect, pause, stream, actions, companion start |
| Create | `src/server/sandbox/manager.ts` | per-bot lifecycle: ensure running, keep-alive, idle pause, rebuild |
| Create | `src/server/companion/companion.py`, `page-script.js` | the in-sandbox companion |
| Create | `src/server/companion/client.ts` | `CompanionClient` and `ElementInfo` |
| Create | `src/server/agent/model.ts` | `ModelPort`, `AnthropicModel`, cost table |
| Create | `src/server/agent/tools.ts` | platform tool registry |
| Create | `src/server/agent/prompt.ts`, `prompt.test.ts` | system prompt builder |
| Create | `src/server/agent/actions.ts` | computer action → sandbox mapping |
| Create | `src/server/agent/images.ts`, `images.test.ts` | PNG decode, difference, crop and scale |
| Create | `src/server/agent/stuck.ts`, `stuck.test.ts` | stuck detector |
| Create | `src/server/agent/gate.ts`, `gate.test.ts` | rules, approvals, secret guard (pure) |
| Create | `src/server/agent/takeover.ts`, `takeover.test.ts` | takeover state and the hand-back check |
| Create | `src/server/agent/queue.ts`, `queue.test.ts` | per-bot run queue |
| Create | `src/server/agent/run.ts`, `run.test.ts` | the loop |
| Create | `src/server/agent/fakes.ts` | `FakeSandbox`, `FakeModel`, `FakeCompanion` for tests |
| Create | `src/server/scheduler/scheduler.ts`, `scheduler.test.ts` | routines as timers |
| Create | `src/server/http/app.ts`, `sse.ts` | API, SSE, static files |
| Create | `src/web/index.html`, `main.tsx`, `App.tsx`, `api.ts`, `events.ts`, `styles.css` | the page |
| Create | `src/web/components/Roster.tsx`, `Chat.tsx`, `Cards.tsx`, `Composer.tsx`, `Preview.tsx`, `SkillsTab.tsx` | UI areas |
| Create | `examples/job-hunt-bot/bot.json`, `memory.md`, `approval-rules.json`, `skills/*.md`, `routines/*.md`, `workspace/README.md` | the demo bot folder |
| Create | `README.md` (rewrite), `docs/decisions.md` (skeleton) | delivery |

## Shared definitions (used by several tasks)

### Types (`src/server/store/types.ts`)

```ts
import { z } from 'zod'

export const BotState = z.enum(['idle', 'working', 'waiting', 'blocked'])
export type BotState = z.infer<typeof BotState>

export const RoutineState = z.object({
  nextRunAt: z.string().nullable(),   // ISO time computed by croner; persisted for restart
  lastRunAt: z.string().nullable(),
  lastResult: z.string().nullable(),  // the one-line status, e.g. "checked 1 source at 07:00, 1 new"
})

export const Bot = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  avatar: z.string().max(4),           // an emoji
  persona: z.string().max(2000),
  sandboxId: z.string().nullable(),
  state: BotState,
  statusLine: z.string().max(200),
  createdAt: z.string(),
  routines: z.record(z.string(), RoutineState),
})
export type Bot = z.infer<typeof Bot>

export const ActionKind = z.enum(['send', 'submit', 'book', 'pay', 'delete', 'publish', 'accept-terms', 'other'])
export type ActionKind = z.infer<typeof ActionKind>

export const Card = z.discriminatedUnion('card', [
  z.object({ card: z.literal('artifact'), name: z.string(), preview: z.string(), path: z.string() }),
  z.object({
    card: z.literal('approval'), approvalId: z.string(), runId: z.string(), actionKind: ActionKind,
    summary: z.string(), consequences: z.array(z.string()), warnings: z.array(z.string()),
    target: z.string(), url: z.string(), shot: z.string().nullable(),
    status: z.enum(['pending', 'allowed', 'denied']), announced: z.boolean(),
  }),
  z.object({ card: z.literal('takeover'), reason: z.string(), status: z.enum(['active', 'ended']) }),
  z.object({ card: z.literal('status'), text: z.string() }),
  z.object({ card: z.literal('skill'), name: z.string(), description: z.string(), body: z.string() }),
  z.object({ card: z.literal('routine'), name: z.string(), skill: z.string(), schedule: z.string().nullable(), event: z.string().nullable(), instruction: z.string() }),
])
export type Card = z.infer<typeof Card>

export const ChatMessage = z.object({
  id: z.string(), t: z.string(), botId: z.string(),
  role: z.enum(['user', 'bot', 'card']),
  text: z.string().optional(),
  card: Card.optional(),
})
export type ChatMessage = z.infer<typeof ChatMessage>

export const ApprovalRules = z.object({
  requireApproval: z.array(z.string()),
  alwaysAllow: z.array(z.string()),
})
export type ApprovalRules = z.infer<typeof ApprovalRules>
export const DEFAULT_RULES: ApprovalRules = { requireApproval: ['*'], alwaysAllow: [] }

export const Skill = z.object({ name: z.string().regex(/^[a-z0-9-]{1,40}$/), description: z.string().min(1), body: z.string() })
export const Routine = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,40}$/), skill: z.string(),
  schedule: z.string().nullable(), event: z.string().nullable(), enabled: z.boolean(), body: z.string(),
})
export type Skill = z.infer<typeof Skill>
export type Routine = z.infer<typeof Routine>

export const RuleName = z.enum(['submit-control', 'enter-in-form', 'verb-name', 'unknown-target'])
export type RuleName = z.infer<typeof RuleName>

export type RunEvent = { t: string; runId: string; botId: string } & (
  | { type: 'step'; step: number; action: string; input: unknown }
  | { type: 'tool_call'; step: number; name: string; input: unknown }
  | { type: 'tool_result'; step: number; name: string; ok: boolean; summary: string; shot: string | null }
  | { type: 'gate'; step: number; decision: 'allow' | 'block' | 'consume'; rule: RuleName | null; announced: boolean; approvalId: string | null; reason: string }
  | { type: 'approval'; approvalId: string; status: 'pending' | 'allowed' | 'denied' }
  | { type: 'takeover'; status: 'started' | 'handback-refused' | 'ended'; reason: string }
  | { type: 'status'; text: string; botState: BotState }
  | { type: 'cost'; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; usd: number }
  | { type: 'end'; outcome: 'done' | 'failed' | 'blocked' | 'budget' | 'stuck' | 'denied'; summary: string }
)
```

### Ports

```ts
// src/server/sandbox/port.ts
export type Point = [number, number]
export interface SandboxPort {
  screenshot(): Promise<Uint8Array>                       // PNG, 1280x800
  leftClick(p?: Point): Promise<void>; rightClick(p?: Point): Promise<void>
  middleClick(p?: Point): Promise<void>; doubleClick(p?: Point): Promise<void>
  tripleClick(p?: Point): Promise<void>
  moveMouse(p: Point): Promise<void>; mouseDown(): Promise<void>; mouseUp(): Promise<void>
  drag(from: Point, to: Point): Promise<void>
  scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number, at?: Point): Promise<void>
  type(text: string): Promise<void>; press(keys: string[]): Promise<void>; holdKey(key: string, seconds: number): Promise<void>
  cursorPosition(): Promise<Point>; wait(ms: number): Promise<void>
  companion: CompanionPort
}
export interface CompanionPort {
  health(): Promise<{ ok: boolean; cdp: boolean }>
  elementAt(p: Point): Promise<ElementInfo>
  activeElement(): Promise<ElementInfo>
  pageState(): Promise<PageState>
  setFiles(p: Point, sandboxPath: string): Promise<void>
}
export type ElementInfo =
  | { target: 'unknown'; reason: string; url: string; title: string }
  | { target: 'element'; tag: string; type: string | null; role: string | null; name: string;
      inForm: boolean; isSubmit: boolean; autocomplete: string | null; inputMode: string | null;
      pattern: string | null; maxLength: number | null; url: string; title: string }
export type PageState = { url: string; fingerprint: string; unsafe: boolean }

// src/server/agent/model.ts
import type Anthropic from '@anthropic-ai/sdk'
export interface ModelPort {
  create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>
}
```

### Project rules that every task follows

- Strict typing (`strict`, `noUncheckedIndexedAccess`), no `any`, no suppression comments.
- `src/server/log.ts` only; no `console.*` in server code. No secret value (API keys, the
  companion token, the stream auth key) in any log line or event.
- Every network, sandbox and model call carries a timeout: E2B calls pass `requestTimeoutMs`
  (60 s for create/connect, 30 s otherwise); the model call passes `{ timeout: 120_000,
  maxRetries: 2 }`; companion and `fetch_url` calls use `AbortSignal.timeout(ms)`.
- Malformed input (an unparseable tool input, a bad JSON body, a bad file) is rejected with a
  logged message, never a crash. All JSON bodies go through a zod `safeParse`.
- The site-name grep in `scripts/preflight.sh` must stay clean: nothing under `src/` names a site;
  tests use `example.com` and generic labels.
- Commit subject: imperative, no Conventional Commits prefix, no assistant attribution footer.

---

## Milestone 1 — Sandbox, companion, loop, bare page (spec day 1)

### Task 0: Repository bootstrap [mechanical] [support]

**Files:** Create `package.json`, `.nvmrc`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
`.env.example`, `scripts/preflight.sh`, `src/server/config.ts`, `src/server/log.ts`,
`src/server/index.ts`, `src/web/index.html`, `src/web/main.tsx`, `src/web/App.tsx`; Modify
`.gitignore`, `CLAUDE.md`, `README.md`; Test `src/server/config.test.ts`.
**Invariant:** none touched (secrets rule: keys are read only in `config.ts`, `.env.local` is git-ignored).
**Demo step:** support — nothing runs without a repository, a toolchain and a server process.
**Verify:** `pnpm typecheck && pnpm test`

- [ ] `git init -b main`. Commit nothing yet.
- [ ] Re-run the version and OSV check for every package in the Research table (the `curl` above,
      or the equivalent one-liner) and record the result in the commit message body if a version moved.
- [ ] Write `.nvmrc` with `24` and `package.json`:

```json
{
  "name": "dobot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.3.4",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "concurrently -k -n server,web \"tsx watch src/server/index.ts\" \"vite\"",
    "build": "vite build",
    "start": "tsx src/server/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "preflight": "bash scripts/preflight.sh",
    "day-one": "tsx scripts/day-one.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.125.0", "@e2b/desktop": "2.4.0", "e2b": "2.49.1",
    "@hono/node-server": "2.1.1", "hono": "4.13.7", "croner": "10.0.1", "zod": "4.6.2",
    "pngjs": "7.0.0", "react": "19.3.0", "react-dom": "19.3.0", "tsx": "4.23.13"
  },
  "devDependencies": {
    "@types/node": "24.13.4", "@types/pngjs": "6.0.5", "@types/react": "19.3.0", "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1", "concurrently": "10.0.5", "typescript": "7.0.2", "vite": "8.3.0", "vitest": "5.0.0"
  }
}
```

- [ ] `pnpm install` (pnpm 10.29 on the author's machine switches to 12.3.4 through `packageManager`;
      if it does not, `npm i -g pnpm@12`). Commit `pnpm-lock.yaml`.
- [ ] `tsconfig.json` (TypeScript 7 defaults are `strict: true`, `types: []`, so `types` is explicit):

```json
{
  "compilerOptions": {
    "target": "ES2024", "module": "esnext", "moduleResolution": "bundler",
    "lib": ["ES2024", "DOM", "DOM.Iterable"], "types": ["node", "vite/client"],
    "jsx": "react-jsx", "strict": true, "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true, "isolatedModules": true, "skipLibCheck": true, "noEmit": true
  },
  "include": ["src", "scripts", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] `vite.config.ts`: `root: 'src/web'`, `plugins: [react()]`, `server: { port: 5173, proxy:
      { '/api': 'http://localhost:3000', '/events': 'http://localhost:3000' } }`, `build: { outDir:
      '../../dist/web', emptyOutDir: true }`. `vitest.config.ts`: `import { defineConfig } from
      'vitest/config'; export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } })`.
- [ ] `.gitignore`: append `node_modules/`, `dist/`, `data/`, `.vitest/`, `*.log`. Keep the existing
      `.env*` lines. `examples/` is **not** ignored.
- [ ] `.env.example` with empty `E2B_API_KEY=`, `ANTHROPIC_API_KEY=`, and defaults
      `MODEL_ID=claude-sonnet-5`, `TZ=Europe/Prague`, `PORT=3000`.
- [ ] `src/server/log.ts`: `export const log = { info, warn, error }` where each writes one JSON line
      `{ t: new Date().toISOString(), level, msg, ...fields }` to `process.stdout` (`error` to
      `stderr`). No formatting library.
- [ ] `src/server/config.ts`: `try { process.loadEnvFile('.env.local') } catch (e) { if ((e as
      NodeJS.ErrnoException).code !== 'ENOENT') throw e }` (verified: a missing file throws
      `ENOENT`; existing variables are not overridden, so a shell export wins), then
      `z.object({ E2B_API_KEY: z.string().min(1), ANTHROPIC_API_KEY: z.string().min(1), MODEL_ID:
      z.string().default('claude-sonnet-5'), TZ: z.string().default('Europe/Prague'), PORT:
      z.coerce.number().default(3000), DATA_DIR: z.string().default('data/bots') }).safeParse(process.env)`;
      on failure log which **names** are missing (never values) and exit 1. Export `config`.
- [ ] Test `config.test.ts`: `parseEnv({})` reports `E2B_API_KEY` and `ANTHROPIC_API_KEY` as missing
      by name; `parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' })` yields the defaults. (Expose
      `parseEnv(env: Record<string, string | undefined>)` so the test never touches `process.env`.)
- [ ] `src/server/index.ts`: create the Hono app (Task 7 fills it; for now `GET /api/health` →
      `{ ok: true }`), serve `dist/web` with `serveStatic({ root: './dist/web' })` and
      `app.get('*', serveStatic({ path: './dist/web/index.html' }))` when the directory exists,
      `serve({ fetch: app.fetch, port: config.PORT })`, log the port. `src/web/main.tsx` renders
      `<App />` with `createRoot`; `App.tsx` shows the health JSON.
- [ ] `scripts/preflight.sh` (executable): `set -euo pipefail; pnpm typecheck; pnpm test; if grep
      -rniE 'startupjobs|calendly|linkedin|jobs\.cz|seznam|gmail' src/; then echo "site-specific
      code found under src/"; exit 1; fi; echo "preflight ok"`.
- [ ] `CLAUDE.md`: already updated by `/plan` on 2026-09-11 (Stack rows for Node 24 LTS, pnpm 12,
      TypeScript 7; the live-version rule under "Adding a dependency"); commit it in this task.
      `README.md`: replace "Currently: research only" with the three setup steps (Node 24, pnpm 12,
      `pnpm install`, copy `.env.example` to `.env.local`) — Task 16 completes it.
- [ ] Verify `pnpm typecheck && pnpm test` pass and `pnpm dev` serves the page on `:5173` with the
      proxied health JSON.
- [ ] Commit `Bootstrap the TypeScript project with Hono, Vite and Vitest`.

### Task 2: Sandbox layer [integration] [demo-path]

**Files:** Create `src/server/sandbox/port.ts`, `src/server/sandbox/e2b.ts`; Create `src/server/companion/client.ts` (the HTTP client only; the Python side is Task 3).
**Invariant:** 1 (the stream URL is the live desktop) and 6 (the sandbox is paused, never killed, and its id is returned to the caller for `bot.json`). Proven by the day-one script (Task 4) and by `/verify`'s standing criteria; no unit test mocks E2B.
**Demo step:** 4, 5, 15.
**Verify:** `pnpm typecheck`

- [ ] `port.ts`: the interfaces from "Shared definitions".
- [ ] `client.ts`: `class CompanionClient implements CompanionPort` with `constructor(baseUrl: string,
      token: string)`. Every call is `fetch(baseUrl + path, { method: 'POST', headers: { authorization:
      'Bearer ' + token, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(5000) })`.
      A non-200, a timeout or a JSON parse failure resolves to `{ target: 'unknown', reason:
      '<status or error name>', url: '', title: '' }` for the element calls, and **throws** for
      `pageState` and `setFiles` (the callers decide). Parse every response with a zod schema for
      `ElementInfo` and `PageState`.
- [ ] `e2b.ts`: `export class E2bSandbox implements SandboxPort` wrapping a `Sandbox` from
      `@e2b/desktop`, plus three static-like functions:

```ts
import { Sandbox, SandboxNotFoundError, ServiceBusyError } from '@e2b/desktop'   // re-exported from e2b

export const RESOLUTION: [number, number] = [1280, 800]
export const RUN_TIMEOUT_MS = 20 * 60_000
const COMPANION_PORT = 8765
const CHROME_FLAGS = ['--remote-debugging-port=9222', '--user-data-dir=/home/user/chrome-profile',
  '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
  '--window-position=0,0', '--start-maximized']   // '--no-sandbox' is appended when NEEDS_NO_SANDBOX (Task 4 decides)

export type SandboxSession = { sandbox: E2bSandbox; sandboxId: string; streamViewUrl: string; streamInteractiveUrl: string }

export async function createSandbox(botId: string, workspaceDir: string, companionSrc: { py: string; js: string }): Promise<SandboxSession>
export async function connectSandbox(sandboxId: string, companionSrc): Promise<SandboxSession>   // throws SandboxNotFoundError
export async function pauseSandbox(session: SandboxSession): Promise<'paused' | 'already-paused' | 'busy' | 'failed'>
```

      `createSandbox`: `Sandbox.create({ resolution: RESOLUTION, timeoutMs: RUN_TIMEOUT_MS, lifecycle:
      { onTimeout: 'pause' }, metadata: { botId }, requestTimeoutMs: 60_000 })`; `files.makeDir('/home/user/workspace')`
      and `/home/user/companion`; upload every file of `workspaceDir` with `files.write(path, new
      Blob([bytes]))`; write `companion.py` and `page-script.js`; `commands.run('pip install
      websocket-client==1.9.2', { timeoutMs: 180_000 })`; generate `token = randomBytes(24).toString('hex')`
      (kept in memory on the session object only); `startChrome()`; `startCompanion()`; wait for
      `companion.health()` to report `{ ok: true, cdp: true }` (poll every 500 ms, 20 s); `stream.start({
      requireAuth: true })`; `authKey = stream.getAuthKey()`; URLs from `getUrl({ authKey, viewOnly: true,
      resize: 'scale' })` and `getUrl({ authKey, resize: 'scale' })`.
      `startChrome`: `commands.run('google-chrome ' + flags.join(' ') + ' about:blank', { background:
      true, envs: { DISPLAY: ':0' } })`. `startCompanion`: `commands.run('python3
      /home/user/companion/companion.py', { background: true, envs: { COMPANION_TOKEN: token,
      COMPANION_PORT: String(COMPANION_PORT), DISPLAY: ':0' } })`. Companion base URL:
      `'https://' + sandbox.getHost(COMPANION_PORT)`.
      `connectSandbox`: `Sandbox.connect(id, { requestTimeoutMs: 60_000 })` (resumes if paused); then
      `setTimeout(RUN_TIMEOUT_MS)`; `stream.stop()` in a try/catch (logged), `stream.start({ requireAuth:
      true })`, re-read the auth key; a **new** token is generated and the companion is restarted
      (the old token died with the old process, and a restart is the documented reconnect step);
      if `health()` is not `{ ok, cdp }` within 20 s, restart Chrome and the companion once more; if
      still not, throw `new Error('companion unreachable')` — the caller refuses to start the run.
      `pauseSandbox`: `await sandbox.pause()` → `'paused'`/`'already-paused'` from the boolean; on
      `ServiceBusyError` wait 5 s and retry once, then `'busy'`; any other error is logged and `'failed'`.
- [ ] Action methods: `screenshot()` → `sandbox.screenshot()`; `leftClick(p)` → `moveMouse` then
      `leftClick(x, y)` (the SDK method already moves); `doubleClick`, `rightClick`, `middleClick`
      likewise; `tripleClick(p)` → `commands.run('xdotool mousemove X Y click --repeat 3 --delay 80 1',
      { envs: { DISPLAY: ':0' } })`; `drag(from, to)` → `sandbox.drag`; `scroll(dir, n, at)` →
      `moveMouse(at)` when given, then `sandbox.scroll('up' | 'down', n)` for vertical and
      `commands.run('xdotool click --repeat N 6|7')` for left/right; `type(text)` → `sandbox.write(text)`;
      `press(keys)` → `sandbox.press(keys)`; `holdKey(key, s)` → `commands.run(`xdotool keydown ${key};
      sleep ${s}; xdotool keyup ${key}`)`; `mouseDown/Up` → `mousePress('left')`/`mouseRelease('left')`;
      `cursorPosition` → `getCursorPosition()`; `wait(ms)` → `sandbox.wait(ms)`. Every `commands.run`
      passes `timeoutMs: 15_000`. xdotool key names are passed through unchanged (the toolset uses
      the same names: `Return`, `ctrl`, `shift`, …); `ctrl+s` splits on `+` into `press(['ctrl', 's'])`.
- [ ] Commit `Add the E2B desktop sandbox layer and the companion client`.

### Task 3: The companion [integration] [demo-path]

**Files:** Create `src/server/companion/companion.py`, `src/server/companion/page-script.js`.
**Invariant:** 4 and 5 — the gate and the secret guard depend on what this returns; it fails
closed (`target: 'unknown'`) on any error. Proven on real pages by Task 4 and by the gate tests
in Task 8 that treat `unknown` as a rule hit.
**Demo step:** 5, 7, 10, 13.
**Verify:** `python3 -m py_compile src/server/companion/companion.py && node --check src/server/companion/page-script.js`

- [ ] `companion.py` (standard library plus `websocket-client`, about 150 lines):
  - `ThreadingHTTPServer(('0.0.0.0', int(os.environ['COMPANION_PORT'])), Handler)`.
  - Every request: `Authorization` must equal `'Bearer ' + os.environ['COMPANION_TOKEN']`, else 401.
    Only `POST` with a JSON body; `GET /health` is the exception (still needs the token).
  - `find_page_target()`: `urllib.request.urlopen('http://127.0.0.1:9222/json', timeout=2)`, keep
    entries with `type == 'page'`; for each, open the socket and evaluate `document.visibilityState`;
    return the first `'visible'` one, else the first page. No page → `503 {"error": "no page target"}`.
  - `cdp(ws, method, params)`: `ws.send(json.dumps({'id': n, 'method': method, 'params': params}))`
    then `recv()` until a message with that `id` arrives (skip events); raise on `error`.
  - `evaluate(expr, by_value=True)`: `Runtime.evaluate` with `returnByValue`, `awaitPromise: False`;
    an `exceptionDetails` becomes `{"target": "unknown", "reason": "page script threw"}`.
  - Page script injection: `PAGE_SCRIPT = open('/home/user/companion/page-script.js').read()` once;
    the expression is `'(() => {' + PAGE_SCRIPT + '; return __dobot.' + fn + '(' + args + ') })()'`.
  - Endpoints: `POST /element-at {x, y}` → `elementAt(x, y)`; `POST /active-element {}` →
    `activeElement()`; `POST /page-state {}` → `pageState()`; `POST /set-files {x, y, path}` →
    `evaluate('… __dobot.fileInputAt(x, y)', by_value=False)` → `objectId` (none → 404
    `{"error": "no file input"}`) → `DOM.setFileInputFiles({'files': [path], 'objectId': id})` →
    `Runtime.releaseObject`; `GET /health` → `{"ok": true, "cdp": <bool of find_page_target succeeded>}`.
  - Each request opens its own WebSocket (`create_connection(url, timeout=5)`) and closes it —
    no shared socket survives a pause. Any exception → `200 {"target": "unknown", "reason": "<class name>"}`
    for the element endpoints, `500` for the others. Log one line per request to stdout.
- [ ] `page-script.js`: defines `const __dobot = { elementAt, activeElement, pageState, fileInputAt }`.
  - `toPage(x, y)`: `const dpr = window.devicePixelRatio || 1; const tb = window.outerHeight -
    window.innerHeight; return [(x - window.screenX) / dpr, (y - window.screenY - tb) / dpr]`.
  - `descend(doc, x, y)`: `el = doc.elementFromPoint(x, y)`; loop: if `el` is an `IFRAME` and
    `el.contentDocument` is null → return `{ unknown: 'cross-origin frame' }`; if `IFRAME` → `r =
    el.getBoundingClientRect(); return descend(el.contentDocument, x - r.left, y - r.top)`; if
    `el.shadowRoot` → `inner = el.shadowRoot.elementFromPoint(x, y)`; if `inner && inner !== el`
    → `el = inner` and continue; else break. Return `el` (null → `{ unknown: 'no element' }`).
  - `describe(el)`: `control = el.closest('button, input, a, [role=button], select, textarea') || el`;
    `tag`, `type` (`control.getAttribute('type')` lower-cased or null), `role`, `name` =
    `accessibleName(control)`, `inForm = !!control.closest('form')`, `isSubmit = isSubmitControl(control)`,
    `autocomplete`, `inputMode = control.getAttribute('inputmode')`, `pattern`, `maxLength`
    (`control.maxLength > 0 ? control.maxLength : null`), `url = location.href`, `title = document.title`.
  - `isSubmitControl(c)`: `tag === 'button' && ((type ?? 'submit') === 'submit') && (type === 'submit' || !!c.form)`
    (a `<button>` with no `type` counts only inside a form); `tag === 'input' && (type === 'submit' || type === 'image')`.
  - `accessibleName(c)`: `aria-label` → `aria-labelledby` (join the referenced elements' text) →
    for `input[type=submit|button|image]`: `value` or `alt` → `<label for=id>` text → `c.textContent`
    → `placeholder` → `title`; trimmed, whitespace collapsed, at most 80 characters.
  - `activeElement()`: `document.activeElement`, descending into `shadowRoot.activeElement` and
    `contentDocument.activeElement` while present; `describe` it (null → unknown).
  - `pageState()`: `inputs = all visible inputs (offsetParent !== null)`; `unsafe = inputs.some(i =>
    i.type === 'password' || i.autocomplete === 'one-time-code' || ((i.inputMode === 'numeric' ||
    /^[\[\]\\d\-\{\},]+$/.test(i.pattern || '')) && i.maxLength > 0 && i.maxLength <= 8 && i.value !== ''))`;
    `fingerprint = location.href + '|' + document.title + '|' + inputs.length`.
  - `fileInputAt(x, y)`: `el = descend(...)`; `el.matches('input[type=file]')` → el; `label = el.closest('label')`
    → `label.control` if it is a file input; `el.closest('[for]')` → `document.getElementById(for)`;
    otherwise the nearest `input[type=file]` inside `el.closest('form') || document` (first one). Returns
    the element or `null`.
- [ ] Commit `Add the in-sandbox companion for DOM checks and file upload`.

### Task 4: Day-one prototype and go/no-go [integration] [demo-path]

**Files:** Create `scripts/day-one.ts`; Modify `docs/plans/2026-09-11-platform-plan.md` (append the "Day-one results" section at the end of this file).
**Invariant:** 1, 4, 5, 6 — this task decides whether the mechanisms the spec prescribes work on E2B at all.
**Demo step:** 4, 5, 7, 10, 13, 15.
**Verify:** `pnpm day-one create <scheduling-page-url> <application-form-url> <path-to-a-cv.pdf>` then `pnpm day-one resume <sandboxId>` the next day.

- [ ] `scripts/day-one.ts` takes a subcommand. `create <urlA> <urlB> <cvPath>`: copies `cvPath` into
      a temporary workspace directory (`mkdtemp`) and calls `createSandbox('day-one', thatDir, src)`
      (the example bot folder does not exist yet at this point in the order); prints the view-only
      and interactive stream URLs; then, in order, prints PASS/FAIL for:
  1. `health()` returns `{ ok: true, cdp: true }` (the pip install worked and the companion started).
  2. A request without the token gets 401 (the token protects the public port).
  3. Chrome started with the flags accepts CDP: `cdp` is true above. If `health` reports `cdp: false`
     or Chrome died, re-run `startChrome` with `--no-sandbox` and record `NEEDS_NO_SANDBOX = true`.
     Also `commands.run('which xdotool')` must exit 0 (the `tripleClick`, `holdKey` and horizontal
     scroll paths depend on it; if absent, `apt-get install -y xdotool` is added to `createSandbox`),
     and `xdotool click 7` on a horizontally scrollable page must move it (buttons 6/7 are an X11
     convention the man page does not list; if they do nothing, `scroll('left' | 'right')` returns
     the text "horizontal scroll is not supported on this computer").
  4. Open `urlA` (`sandbox.open(urlA)`), wait 5 s, take a screenshot, save it to the scratch
     directory, and print `elementAt` for a point the operator chooses on it (the script asks for
     `x y` on stdin and prints the descriptor) — repeat on `urlB` for the submit control and for the
     upload control. PASS when the descriptor names the control under the cursor with the expected
     `isSubmit` and `name`.
  5. `setFiles([x, y], '/home/user/workspace/<cv file>')` on `urlB`'s upload control, then a
     screenshot showing the file name in the field.
  6. `pause()` → prints the sandbox id and "resume tomorrow with: pnpm day-one resume <id>".
  - `resume <id>`: `connectSandbox(id, src)`; PASS when the stream and the companion come back
    and the page from step 4 is still open (the Chrome profile survived); then the operator uses
    the interactive URL to sign in to the bot's mailbox (the private backlog: "Day-one check on the first
    sandbox") and to make one Calendly booking by hand from the sandbox IP (reCAPTCHA check; cancel
    it afterwards); then `pause()` again. The script prints what the operator must do; it never
    types a password.
- [ ] Append to this plan under "Day-one results": the six PASS/FAIL lines, the `--no-sandbox`
      decision, the Hobby resume-next-day result, the Calendly-from-sandbox result, and the cut
      decision taken (see "Scope and cuts"). Update `CHROME_FLAGS` in `e2b.ts` accordingly.
- [ ] Commit `Add the day-one sandbox checks and record their results`.

### Task 1: The store [integration] [demo-path]

**Files:** Create `src/server/store/types.ts`, `paths.ts`, `bot.ts`, `chat.ts`, `runs.ts`, `memory.ts`, `frontmatter.ts`, `skills.ts`, `routines.ts`, `rules.ts`, `artifacts.ts`, `index.ts`; Test `src/server/store/frontmatter.test.ts`, `src/server/store/store.test.ts`.
**Invariant:** 6 — the bot folder is the system of record; proven by the round-trip tests and by verification criterion 4. Invariant 4 — no function can write `approval-rules.json`; proven by a test.
**Demo step:** 1, 3, 15.
**Verify:** `pnpm exec vitest run src/server/store`

- [ ] `paths.ts`: `botDir(id)`, `botFile(id, 'bot.json')`, `runDir(id, runId)`, `shotsDir`, `skillsDir`,
      `routinesDir`, `artifactsDir`, `workspaceDir`; all under `config.DATA_DIR`. A helper
      `assertSlug(name)` rejects anything but `/^[a-z0-9-]{1,40}$/` (this is what keeps a tool from
      writing outside its folder or naming `../approval-rules`).
- [ ] `bot.ts`: `listBots()`, `readBot(id)` (zod-parsed; a malformed file throws a logged error),
      `writeBot(bot)` (write to `bot.json.tmp` then `rename` — atomic on one disk), `createBot({ name,
      avatar, persona })` (id = slug of the name plus a 4-char suffix; creates the folder, an empty
      `memory.md`, `approval-rules.json` with `DEFAULT_RULES`, `skills/`, `routines/`, `artifacts/`,
      `workspace/`, `runs/`), `updateBot(id, patch)`.
- [ ] `chat.ts`: `appendChat(botId, msg)` (one JSON line), `readChat(botId, { limit })` (last N lines;
      a corrupt line is skipped and logged). `runs.ts`: `startRun(botId, runId)` (creates the dir),
      `appendRunEvent(event)`, `readRunEvents(botId, runId)`, `writeShot(botId, runId, png): string`
      (sha256 hex of the bytes, stored as `<hash>.png`, returns the hash), `readShot(botId, runId, hash)`,
      `listOpenRuns(botId)` (runs whose `events.jsonl` has no `end` event — used by boot recovery).
- [ ] `memory.ts`: `appendMemory(botId, note)` writes `- <YYYY-MM-DD>: <note>\n`; `readMemory(botId)`.
- [ ] `frontmatter.ts`: `parseFrontmatter(text): { fields: Record<string, string>; body: string }`
      (a leading `---` block of `key: value` lines, split on the first colon; a boolean-looking
      value stays a string — the callers parse); `serializeFrontmatter(fields, body)`.
- [ ] `skills.ts`: `listSkills(botId)` (name, description from frontmatter; body), `writeSkill(botId,
      skill)` (validates with `Skill`, `assertSlug`), `readSkill`. `routines.ts`: same, plus:
      `writeRoutine` validates `schedule` with `new Cron(schedule, { paused: true })` inside
      try/catch and rethrows `new Error('invalid schedule: ' + message)`; exactly one of `schedule`,
      `event` must be set; `enabled` serialises as `true`/`false`.
- [ ] `rules.ts`: `readRules(botId)`: parse `approval-rules.json` with `ApprovalRules`; a missing or
      malformed file returns `DEFAULT_RULES` with a logged warning (fail closed). **There is no write
      function**, and `index.ts` re-exports the store's public API without one.
- [ ] `artifacts.ts`: `writeArtifact(botId, name, content)` (`assertSlug` on the name without
      extension; `.md` or `.txt` only), `listArtifacts`, `readArtifact`.
- [ ] Tests (a temp `DATA_DIR` per test via `mkdtemp`):
  - `frontmatter.test.ts`: round-trips fields and body; a body containing `---` lines survives; a
    value with a colon (`description: search: daily`) keeps everything after the first colon; no
    frontmatter → empty fields.
  - `store.test.ts`: `createBot` then `readBot` returns the same bot and the folder has the seven
    entries; `appendChat` ×3 then `readChat({ limit: 2 })` returns the last two in order;
    `appendRunEvent` then `readRunEvents` round-trips and `listOpenRuns` lists a run without `end`
    and not one with it; `writeSkill` with name `../approval-rules` throws and `approval-rules.json`
    is unchanged; `writeSkill` with a valid name then `listSkills` returns it; `writeRoutine` with
    `schedule: 'every morning'` throws with a message that starts with `invalid schedule`; with
    `'0 7 * * 1-5'` it succeeds; `readRules` on a bot with a deleted rules file returns
    `DEFAULT_RULES`; `writeShot` returns the sha256 of the bytes and `readShot` returns them.
- [ ] Commit `Add the bot folder store`.

### Task 5: Model port, actions, images and the loop [integration] [demo-path]

**Files:** Create `src/server/agent/model.ts`, `tools.ts`, `prompt.ts`, `actions.ts`, `images.ts`, `stuck.ts`, `run.ts`, `fakes.ts`; Test `model.test.ts`, `actions.test.ts`, `images.test.ts`, `stuck.test.ts`, `prompt.test.ts`, `run.test.ts` (the parts listed here; Task 6 extends `run.test.ts`).
**Invariant:** 2 (the loop drives a real sandbox; nothing on the demo path is mocked — the fakes are test-only and live in `fakes.ts`, imported by no production file; the code reviewer checks that import graph), 1 (every computer action is executed on the sandbox and logged as an event).
**Demo step:** 2, 5, 6.
**Verify:** `pnpm exec vitest run src/server/agent`

- [ ] `model.ts`: `AnthropicModel` wraps `new Anthropic()` (key from the environment, set by
      `config.ts`); `create(params)` → `client.messages.create(params, { timeout: 120_000, maxRetries: 2 })`.
      `costUsd(model, usage)` with a table `{ 'claude-sonnet-5': { in: 2, out: 10 }, 'claude-opus-5':
      { in: 5, out: 25 } }` per million tokens, cache read at 0.1× and cache write at 1.25× of `in`;
      an unknown model id logs once and returns 0. `model.test.ts`: `costUsd('claude-sonnet-5',
      { input 1,000,000, output 100,000, cacheRead 500,000, cacheWrite 200,000 })` equals
      `2 + 1 + 0.1 + 0.5 = 3.6`; an unknown id returns 0.
- [ ] `tools.ts`: `type PlatformTool<S extends z.ZodObject> = { name; description; schema: S;
      run(input: z.infer<S>, ctx: RunContext): Promise<string> }` and `toolDefinitions(tools)` →
      `Anthropic.Messages.Tool[]` using `const { $schema, ...input_schema } = z.toJSONSchema(t.schema)`;
      the last definition gets `cache_control: { type: 'ephemeral' }`. Tools in this task:
      `fetch_url({ url })` (http/https only; `fetch` with `AbortSignal.timeout(15_000)` and
      `redirect: 'follow'`; strip `<script>`, `<style>`, tags, collapse whitespace, decode `&amp;
      &lt; &gt; &quot; &#39; &nbsp;`; cap at 20,000 characters with a trailing note),
      `write_artifact({ name, content })` → store + an artifact card in chat, `remember({ note })` →
      `appendMemory`, `ask_user({ question })` → posts the question as a bot message, sets the bot
      `waiting`, awaits `ctx.waitForUser()` (Task 7 resolves it from the messages endpoint) and returns
      the user's text. `propose_action`, `request_takeover`, `save_skill`, `save_routine` are added
      by Tasks 6, 9 and 13. The `RunContext` type carries `botId`, `runId`, `store`, `postChat`,
      `emit`, `waitForUser`, `waitForApproval`, `takeover`, `waitForHandback`.
- [ ] `prompt.ts`: `buildSystemPrompt({ bot, memory, skills, activeSkill })` returns the persona, the
      task-shape scaffold (outcome, sources, constraints, deliverable, review point), the
      cheap-path-first rule, the takeover rule ("never type a password, a code or a CAPTCHA answer;
      call `request_takeover`"), the approval rule ("before any action that sends, submits, books,
      pays, deletes, publishes or accepts terms, call `propose_action` and wait for the answer; never
      retry a denied action"), the skill-offer rule ("when you finish a job that no skill covered, end
      by asking whether to do it on a schedule"), the interview rule when `skills.length === 0` ("ask
      for the five items one at a time with `ask_user` before starting, then write each answer to
      memory with `remember` so it survives"), then `## Memory` with the
      file, `## Skills` with `name — description` per skill and the full body of `activeSkill`.
      `prompt.test.ts`: a bot with no skills gets the interview paragraph and a bot with one does not;
      the active skill's body appears and an inactive skill's body does not; memory lines appear verbatim.
- [ ] `images.ts` (pngjs): `decode(png: Uint8Array)`, `meanAbsDiff(a, b)` (luminance
      `0.299R+0.587G+0.114B`, sampled every 8th pixel on both axes, `Infinity` when sizes differ),
      `cropAndScale(png, region: [x0, y0, x1, y1], fit: [w, h])` (clamp the region to the image, crop,
      nearest-neighbour scale to the largest size that fits `fit` while keeping the aspect ratio,
      encode). `images.test.ts`: two synthetic 64×64 images that differ in one pixel have a diff
      below 1; one all-black and one all-white have a diff of 255; a 20×10 region scaled into
      1280×800 yields a 1280×640 image; a region outside the image is clamped and does not throw.
- [ ] `stuck.ts`: `class StuckDetector { note(kind: 'screenshot' | 'wait' | 'other', png?: Uint8Array):
      boolean }` — keeps the last three screenshots; `'other'` resets; returns `true` when three
      consecutive screenshots each differ from the previous by less than `THRESHOLD = 2` with only
      `screenshot`/`wait` between them. `stuck.test.ts`: three identical frames → true; identical,
      identical, different → false; identical, click, identical, identical → false (the click reset
      it); the threshold is a named export and the test uses it.
- [ ] `actions.ts`: `parseAction(name, input): ComputerAction | { error: string }` with a zod schema per
      action (`coordinate: [int, int]`, `text`, `repeat`, `region`, `duration`, `scroll_direction`,
      `scroll_amount`, `start_coordinate`); `executeAction(action, sandbox, lastShot)` maps to the
      `SandboxPort` methods listed in Task 2; `wait` is capped at 10 s and `hold_key` at 10 s (a
      longer request is executed at the cap and the result says so); `zoom` uses `cropAndScale(lastShot,
      region, RESOLUTION)`; `cursor_position` returns the text `[x, y]`. Results are `{ text }` or
      `{ png }`. `actions.test.ts`: every one of the 17 action names parses a valid input into the
      matching `ComputerAction` (`left_click` with `coordinate: [10, 20]`, `key` with `text: 'Return',
      repeat: 3`, `scroll` with direction, amount and coordinate, `zoom` with a region, `type` with
      text, `wait`/`hold_key` with a duration, the no-input actions with `{}`); concrete invalid
      inputs return `{ error }` (`coordinate: [10]`, `coordinate: ['a', 'b']`, `key` without `text`,
      `repeat: 0`, `repeat: 101`, `scroll_direction: 'diagonal'`, `zoom` with a 3-number region, an
      unknown action name); `executeAction` for `wait` with `duration: 60` calls the sandbox's `wait`
      with 10,000 ms and the result text contains "capped at 10 s"; `hold_key` with `duration: 30`
      calls `holdKey(key, 10)` with the same note; `zoom` with a region partly outside 1280×800
      produces a PNG whose size fits in 1280×800 (decoded with pngjs); `key` with `text: 'ctrl+s'`
      calls `press(['ctrl', 's'])`; `scroll` with a coordinate calls `moveMouse` before `scroll`.
      These assert on the `FakeSandbox` call log (what the loop asked the sandbox to do), not on a
      return value the fake was told to give.
- [ ] `run.ts`: `runLoop(ctx, { goal, activeSkill, source: 'message' | 'routine' })`:
  1. `messages = [{ role: 'user', content: goal }]`; `tools = [{ type: 'computer_toolset_20260801' },
     ...toolDefinitions(platformTools)]`; `system = [{ type: 'text', text: buildSystemPrompt(...),
     cache_control: { type: 'ephemeral' } }]`.
  2. Loop while `step < STEP_BUDGET (60)`: `res = await model.create({ model: config.MODEL_ID,
     max_tokens: 4096, system, tools, messages })`; emit `cost`; append `{ role: 'assistant',
     content: res.content }`.
  3. `stop_reason`: `end_turn` → post the text blocks as one bot message, `end: done`;
     `pause_turn` → continue; `max_tokens` → append a user message `"continue"` and continue;
     `refusal` → `end: failed` with "the model refused"; `model_context_window_exceeded` → `end: failed`;
     `tool_use` → execute every `tool_use` block in order and reply with **one** user message holding
     all `tool_result` blocks.
  4. A `tool_use` with `toolset_name === 'computer'`: `parseAction` (an error → `tool_result` with
     `is_error: true` and the message); `step++`; emit `step`; **the gate runs here**, between the
     parsed action and its execution (Task 8 adds the DOM rules and the secret guard at this exact
     point; this task calls `gate.check(...)` which for now returns `allow`; Task 6 adds the
     `propose_action` tool, which is Signal A); `executeAction`; screenshot results are stored with `writeShot`, fed to
     the stuck detector and returned as an image block; every `tool_result` for a computer action
     carries `toolset_name: 'computer'`. Any other `tool_use` runs the platform tool by name
     (unknown name → `is_error` result "unknown tool").
  5. After each model turn, replace image blocks older than the last three with
     `{ type: 'text', text: 'screenshot after step N (removed to save context)' }`; put
     `cache_control: { type: 'ephemeral' }` on the last content block of the last user message.
  6. Stuck → `end: stuck`; budget → `end: budget`; both set the bot `blocked` and post a takeover
     card (Task 9 wires the button). A thrown error from the sandbox or the model → `end: failed`
     with the error name, the bot `idle`, and a bot message "I was doing <last action>; my
     computer stopped answering, so I stopped. Send the goal again to retry."
  7. Every event goes through `ctx.emit` (Task 7 fans it out to the store and SSE).
- [ ] `fakes.ts`: `FakeSandbox` (records calls; `screenshot()` returns a fixed PNG or a scripted
      sequence; `companion` returns scripted `ElementInfo`), `FakeModel` (returns a scripted list of
      `Message`s in order). These exist so the tests below assert on **the loop's events and store
      writes**, never on the fakes themselves.
- [ ] `run.test.ts` (this task's part): a scripted model that emits `left_click` then `screenshot`
      then `end_turn` produces events `step`, `tool_call`, `tool_result` ×2, `end: done`, one bot
      message, and the sandbox saw one click at the given coordinate; an unparseable action input
      yields a `tool_result` with `is_error` and the run continues; a model that returns the same
      screenshot three times with only `screenshot` calls ends with `end: stuck`; a sandbox whose
      `screenshot` throws ends with `end: failed` and a bot message that starts with "I was doing";
      after five screenshots the messages array holds exactly three image blocks.
- [ ] Commit `Add the agent loop with the computer toolset and platform tools`.

### Task 6: Approval gate — Signal A [integration] [demo-path]

**Files:** Create `src/server/agent/gate.ts` (approval registry and `propose_action`; Task 8 adds the rules), Test `src/server/agent/gate.test.ts` (Signal A part), extend `run.test.ts`.
**Invariant:** 4 — the check runs in `run.ts` between the model's tool call and `executeAction`, never in the UI. Deny returns "denied" to the model and executes nothing. Proven by the tests below.
**Demo step:** 12, 13.
**Verify:** `pnpm exec vitest run src/server/agent`

- [ ] `gate.ts`: `type Approval = { id; runId; kind: ActionKind; target: string; path: string;
      createdStep: number; expiresStep: number; consumed: boolean; status: 'pending' | 'allowed' |
      'denied' }`. `class Approvals { propose(runId, step, input): Approval; resolve(id, 'allowed' |
      'denied'): void; pendingOrAllowedFor(runId): Approval | null; findMatch(runId, step, element):
      Approval | null }` where `pendingOrAllowedFor` returns the newest approval of that run that is
      `pending`, or `allowed` and not consumed and not expired (used by Task 8 to tell an unannounced
      hit from a mismatch), and `findMatch` requires `status === 'allowed'`, `!consumed`,
      `step <= expiresStep` (`expiresStep = createdStep + 10`), `element.name` equal to `target`
      case-insensitively after trimming, and `new URL(element.url).pathname === path`.
      `needsApproval(name: string, rules: ApprovalRules): boolean` with a glob matcher (`*` only):
      `requireApproval` matching → `true`; else `alwaysAllow` matching → `false`; else `true`.
- [ ] `propose_action` tool (`tools.ts`): input `{ kind: ActionKind, summary: string,
      consequences: string[], warnings: string[], target: string }`. Run: take a fresh screenshot
      (stored, hash on the card), `approvals.propose(...)` with `path` from `companion.pageState().url`
      (a companion failure uses the last known URL and logs), post the approval card, emit `approval:
      pending`, set the bot `waiting`; if `!needsApproval(kind, rules)` resolve as `allowed` at once
      with a status card "allowed by your rules"; else `await ctx.waitForApproval(id)`; return
      `approved: you may activate "<target>" on this page within the next 10 steps` or `denied: the
      user refused this action; do not retry it`. The bot returns to `working`.
- [ ] `gate.test.ts` (Signal A): an approval is consumed exactly once (`findMatch` then mark
      consumed; the second call returns null); a different label or a different path does not match;
      an expired step does not match; `needsApproval('send', { requireApproval: ['*'], alwaysAllow:
      ['send'] })` is `true` (fail closed); `needsApproval('send', { requireApproval: [], alwaysAllow:
      ['send'] })` is `false`; `needsApproval('book', { requireApproval: [], alwaysAllow: [] })` is `true`.
- [ ] `run.test.ts`: a scripted model that calls `propose_action` then, after the result, `end_turn`:
      with `waitForApproval` resolving `denied` the tool result text starts with `denied` and no
      sandbox action ran; with `allowed` it starts with `approved` and the chat holds one approval
      card whose `status` is `allowed`; the run's events contain `approval: pending` before
      `approval: allowed`.
- [ ] Commit `Add the propose_action approval flow`.

### Task 7: API, SSE and the bare page [integration] [demo-path]

**Files:** Create `src/server/http/app.ts`, `src/server/http/sse.ts`, `src/server/agent/queue.ts`; Modify `src/server/index.ts`, `src/web/App.tsx`, `src/web/api.ts`, `src/web/events.ts`; Test `src/server/agent/queue.test.ts`.
**Invariant:** 1 — the preview iframe shows the live view-only stream while the run happens; proven by the manual check at the end of this task. 4 — the allow/deny endpoint only resolves a pending approval and cannot start an action; proven by the 404/409 behaviour and the Task 6 tests that the gate consumes an approval only inside `run.ts`.
**Demo step:** 4, 5, 12 (bare version; Task 11 makes it presentable).
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/agent/queue.test.ts`

- [ ] `sse.ts`: `class BotEvents extends EventEmitter` keyed by bot id; `emitRun(event)`, `emitChat(msg)`,
      `emitBot(bot)`; the handler `GET /events/:botId` uses `streamSSE`: on connect send `bot` and
      the last 50 chat messages as `chat` events, then forward live events with `event: 'run' | 'chat'
      | 'bot'` and `data: JSON`; a comment line `: ping` every 15 s; `stream.onAbort` unsubscribes.
- [ ] `queue.ts`: `class RunQueue { enqueue(botId, job: () => Promise<void>): Promise<void> }` —
      one chain per bot; a job that throws is logged and does not break the chain. `queue.test.ts`:
      two jobs on one bot run in order and never overlap (the first awaits a deferred the test
      resolves after asserting the second has not started); jobs on two bots run concurrently; a
      throwing job does not stop the next one.
- [ ] `app.ts` routes (all JSON bodies through `safeParse`, 400 with `{ error }` on failure):
      `GET /api/bots`; `POST /api/bots { name, avatar?, persona }` → `createBot` and a sandbox
      created in the background (status card "setting up my computer", then "ready");
      `GET /api/bots/:id` → bot + chat (last 200); `POST /api/bots/:id/messages { text }` → if the
      bot's run is waiting on `ask_user`, resolve it; else append the user message and enqueue a run
      (`source: 'message'`); `POST /api/bots/:id/approvals/:approvalId { decision: 'allow' | 'deny' }`
      → `approvals.resolve` (404 when unknown, 409 when not pending); `GET /api/bots/:id/stream?mode=view`
      → `{ url }` of the view-only stream (`mode=interactive` is enabled by Task 9);
      `GET /api/bots/:id/runs/:runId/shots/:hash` → the PNG; `GET /events/:botId`. Static files as in Task 0.
- [ ] `index.ts` boot order: config → store → `SandboxManager` (Task 10; for now a map of sessions
      created on demand) → `Approvals` → `RunQueue` → app → `serve`. Boot recovery (Task 10) is a stub.
- [ ] Web: `api.ts` (fetch helpers), `events.ts` (`new EventSource('/events/' + botId)` with handlers
      per event name); `App.tsx`: a bot list, a create form, the chat as a list of messages and
      cards (approval card with Allow once / Deny buttons that `POST` the decision), a composer, and
      the preview `<iframe src={viewUrl} allow="clipboard-read; clipboard-write">`. No styling yet.
- [ ] Manual check: `pnpm dev`, create a bot, send "open the browser and search for the weather in
      Prague, then tell me what you see"; the iframe shows the remote screen moving; the chat shows
      the final message. Send "propose to send an email to test@example.com"; an approval card
      appears; Deny; the bot reports it was denied.
- [ ] Commit `Add the HTTP API, the SSE stream and a bare page`.

**Milestone 1 exit:** demo steps 4, 5 and 12 work in the bare page; the four in-sandbox day-one
results are in this file with the cut decision they imply. The two overnight results (resume the
next morning, Calendly from the sandbox IP) are written down on the morning of day 2 before Task 8
starts, and the cut decision is completed then.

---

## Milestone 2 — Gate signal B, secret guard, takeover, lifecycle, UI (spec day 2)

### Task 8: Approval gate — Signal B and the secret guard [integration] [demo-path]

**Files:** Modify `src/server/agent/gate.ts`, `src/server/agent/run.ts`; Test `src/server/agent/gate.test.ts`, `run.test.ts`.
**Invariant:** 4 (every click, Enter, Space and typed newline is checked against the DOM rules before it is executed; a rule hit without a matching approval is blocked; `requireApproval` beats `alwaysAllow`) and 5 (a `type` into a password or one-time-code field is blocked in code and starts takeover). Proven by the tests below.
**Demo step:** 7, 8, 13.
**Verify:** `pnpm exec vitest run src/server/agent`

- [ ] `gate.ts` additions:
  - `VERBS = ['send', 'submit', 'apply', 'book', 'schedule', 'confirm', 'pay', 'buy', 'order',
    'delete', 'remove', 'publish', 'post', 'accept', 'agree', 'odeslat', 'potvrdit', 'rezervovat',
    'zaplatit', 'koupit', 'objednat', 'smazat', 'odstranit', 'zveřejnit', 'souhlasím', 'přijmout']`.
  - `gatedKind(action): 'click' | 'key-activate' | 'newline' | null` — `left_click`, `double_click`,
    `triple_click`, `left_click_drag` → `'click'`; `key` whose `text` (split on `+`, last part)
    is `Return`, `Enter`, `KP_Enter` or `space` → `'key-activate'`; `type` with `\n` in `text` →
    `'newline'`; else `null` (no companion call, no rule).
  - `matchRule(kind, el: ElementInfo): RuleName | null`: `el.target === 'unknown'` → `unknown-target`;
    `el.isSubmit` → `submit-control`; `(kind === 'key-activate' || kind === 'newline') && el.tag ===
    'input' && el.inForm` → `enter-in-form`; `['button', 'a', 'input'].includes(el.tag) || el.role
    === 'button'` and `el.name` has ≤ 4 words and its first word (lower-cased, punctuation stripped)
    is in `VERBS` → `verb-name`; else `null`.
  - `evaluate({ kind, element, rules, approvals, runId, step }): GateResult` — rule null →
    `{ decision: 'allow' }`; rule hit and `!needsApproval(rule, rules)` → `allow` (with the rule
    named); rule hit and `approvals.findMatch(...)` → `{ decision: 'consume', approval, rule }`;
    else `{ decision: 'block', rule, announced: approvals.pendingOrAllowedFor(runId) !== null,
    mismatch: <that approval or null> }`.
  - `secretGuard(el): { blocked: boolean; reason: string }` → blocked when `el.target === 'element'`
    and (`el.type === 'password'` or `el.autocomplete === 'one-time-code'`). An unknown target does
    **not** block typing (typing is reversible; the gate covers activation).
- [ ] `run.ts`: before `executeAction` for a `type`, **and** for a `key` whose `text` is a single
      printable character (length 1, so a model spelling a secret one key at a time is caught too):
      `el = await companion.activeElement()`; `secretGuard(el).blocked` → emit `gate: block` with
      reason `secret-field`, return the tool result "a human will complete this step", and start
      takeover (Task 9; until then set `blocked` and post the takeover card). For
      `gatedKind(action) !== null`: `el = kind === 'click' ?
      companion.elementAt(point) : companion.activeElement()` (for a drag, the end point); `evaluate`;
      `allow` → execute; `consume` → mark consumed, emit `gate: consume`, execute; `block` → emit
      `gate: block, rule, announced`, post an approval card with `announced: false` whose summary is
      `I was about to activate "<name>" without announcing it` (mismatch: `This is not the action you
      approved ("<target>" on <path>)`; unknown target: `I cannot see what this click does — it is
      inside an embedded frame or an unknown element`), set the bot `waiting`, await the decision:
      allow → create a one-shot approval for exactly that label and path and execute; deny → tool
      result "denied: the user refused this action" and nothing executes.
- [ ] `gate.test.ts` (Signal B), with fixture `ElementInfo` objects: `button type=submit` in a form →
      `submit-control`; `button` without type in a form → `submit-control`; `button` without type
      outside a form named "Menu" → null; `input type=submit` → `submit-control`; a plain `button`
      named "Odeslat zájem" → `verb-name`; named "Apply now" → `verb-name`; named "Schedule Event"
      → `verb-name`; named "Sign in" → null; named "Sort order" → null; named "Send me the weekly
      newsletter and other updates" (6 words) → null; `a` named "Book" → `verb-name`; `key-activate`
      on a focused `input` in a form → `enter-in-form`; `key-activate` on a focused submit button →
      `submit-control`; `unknown` → `unknown-target`; `evaluate` with a matching allowed approval →
      `consume` and the approval is consumed only once; with an approval for a different label →
      `block` with `mismatch` set; with no approval → `block` with `announced: false`; with rules
      `{ requireApproval: ['*'], alwaysAllow: ['submit-control'] }` → still `block`; with
      `{ requireApproval: [], alwaysAllow: ['verb-name'] }` on a verb hit → `allow`; `secretGuard` on
      `input type=password` → blocked; on `input type=text` → not blocked; on `autocomplete=one-time-code`
      → blocked; `gatedKind` for `key` with `text: 'Return'`, `'KP_Enter'`, `'space'`, `'ctrl+Return'`
      → `key-activate`, for `'Tab'` → null, for `type` with a newline → `newline`; `needsSecretCheck`
      (the helper `run.ts` uses) is `true` for `type`, for `key` with `text: 'a'` or `'7'`, and
      `false` for `key` with `text: 'Tab'`, `'ctrl+a'` or `'Return'`.
- [ ] `run.test.ts`: a scripted `left_click` on a fixture submit control with no approval → no sandbox
      click, one approval card with `announced: false`, and after the test resolves it `deny` the tool
      result starts with `denied`; the same with an allowed approval for that label and path → the
      click runs and the events hold `gate: consume`; a `type` while the companion reports a password
      field → no `type` call on the sandbox, a `gate: block` event with reason `secret-field`, and the
      bot is `blocked`.
- [ ] Commit `Add the DOM rules and the secret guard to the approval gate`.

### Task 9: Takeover and the hand-back check [integration] [demo-path]

**Files:** Create `src/server/agent/takeover.ts`; Modify `run.ts`, `tools.ts`, `http/app.ts`, `App.tsx`; Test `src/server/agent/takeover.test.ts`, `run.test.ts`.
**Invariant:** 5 — during takeover the loop is paused (no screenshot, no model call, no SSE run event); keystrokes travel through the noVNC iframe into the sandbox only; hand-back is refused by the **server** while a password or code field with a value is visible or the page has not changed. Proven by the tests below and by verification criterion 3 (grep the store and logs for a marker typed during takeover).
**Demo step:** 10, 11.
**Verify:** `pnpm exec vitest run src/server/agent`

- [ ] `takeover.ts`: `class Takeover { start(trigger: 'secret-field' | 'requested' | 'stuck' |
      'budget' | 'manual', reason: string, startState: PageState): void; check(now: PageState):
      { allowed: boolean; reason: string }; end(): void; active: boolean }` — `check` always
      requires `!now.unsafe`; for the triggers `secret-field` and `requested` (the model itself
      said a secret is needed) it also requires `now.fingerprint !== startState.fingerprint`, so a
      one-time code typed into a plain text field cannot still be on screen; for `stuck`, `budget`
      and `manual` an unchanged page is allowed (the operator often only nudges a misclick), and
      the takeover card says "if you typed a code into a plain field, move past that page before
      handing back". Reasons: `"a password or code field still has a value on screen"`, `"the page
      has not changed yet — finish the sign-in and move past this page"`.
- [ ] `run.ts`: `ctx.takeover(reason)`: emit `takeover: started`, set the bot `blocked`, post the
      takeover card (`status: 'active'`), record `startState = await companion.pageState()` (failure
      → a fingerprint of `'unknown'` so any real state differs, and `unsafe: false`), then `await
      ctx.waitForHandback()`. While waiting **no** screenshot is taken, no model call is made (the
      await sits before the next model call), and the only events emitted or pushed over SSE are
      `takeover: *` events, which carry a reason string and never page content. On resume: card `status: 'ended'`, emit `takeover:
      ended`, bot `working`, a fresh screenshot, tool result "the human completed the step".
      Triggers: the `request_takeover({ reason })` tool, the secret guard (Task 8), stuck, budget,
      and the user's button. The user's button sets a flag checked before every model call; the
      current action finishes first.
- [ ] `app.ts`: `POST /api/bots/:id/takeover` → sets the flag (204; 409 when no run is active — the
      user can still open the interactive stream, see below); `GET /api/bots/:id/takeover/state` →
      `companion.pageState()` through `takeover.check` → `{ allowed, reason }`; `POST
      /api/bots/:id/takeover/handback` → same check; `409 { reason }` when refused, else resolves the
      wait and 204; `GET /api/bots/:id/stream?mode=interactive` → the interactive URL, only while
      the bot is `blocked` or idle (403 otherwise, so the operator cannot type while the model acts).
- [ ] `App.tsx` (bare): the takeover card shows the reason, a **Take over** button (switches the
      iframe `src` to the interactive URL) and a **Hand back** button that polls `takeover/state`
      every 2 s and stays disabled with the reason text until `allowed`; on success the iframe
      returns to the view-only URL.
- [ ] `takeover.test.ts`: for a `secret-field` takeover, `check` refuses while `unsafe`; refuses
      while the fingerprint is unchanged even when safe; allows when both clear; the reason strings
      match. For a `stuck` takeover, an unchanged fingerprint with `unsafe: false` is allowed, and
      `unsafe: true` is still refused. For `manual`, the same as `stuck`.
- [ ] `run.test.ts`: a scripted `request_takeover` with a companion whose `pageState` returns
      `unsafe: true` twice then `{ unsafe: false, fingerprint: 'b' }`: the first two hand-back attempts
      are refused (`takeover: handback-refused` events with the reason), the third succeeds, and
      between `takeover: started` and `takeover: ended` the only events are `takeover: *` — no
      `step`, no `tool_result`, no shot — and no model call happened (`FakeModel.calls` unchanged);
      the sandbox saw no `type` call during that window.
- [ ] Commit `Add takeover with the hand-back check`.

### Task 10: Run lifecycle and sandbox idle pause [integration] [demo-path]

**Files:** Create `src/server/sandbox/manager.ts`; Modify `src/server/index.ts`, `run.ts`, `app.ts`; Test `src/server/sandbox/manager.test.ts` (timer logic only, with fake timers and a fake session factory).
**Invariant:** 6 — the sandbox is paused after 2 minutes idle and resumed on the next run; a lost sandbox is rebuilt from the folder; a run interrupted by a crash or a restart is closed honestly. Proven by the tests below and by verification criterion 4.
**Demo step:** 4, 15.
**Verify:** `pnpm exec vitest run src/server/sandbox`

- [ ] `manager.ts`: `class SandboxManager { ensureRunning(botId): Promise<SandboxSession>; release(botId):
      void; pauseIdle(): Promise<void> }` with an injectable `{ create, connect, pause, now, setTimer,
      clearTimer }` so the tests use fakes. `ensureRunning`: a live session → `setTimeout(RUN_TIMEOUT_MS)`
      on it and return; `bot.sandboxId` null → `create` (status card "setting up my computer") and
      `updateBot({ sandboxId })`; else `connect`; `SandboxNotFoundError` → `updateBot({ sandboxId:
      null })`, status card "My computer was rebuilt. Files are back; logins are gone, I will ask you
      to sign in again.", then `create`. `release` (called at run end when the queue is empty): arm a
      2-minute grace timer; when it fires and no run started, `pause` and drop the session; a new run
      during the grace cancels it. `pauseIdle` runs every 5 minutes: any session with no run and no
      grace timer is paused (the retry path for a failed pause). Per-bot serialisation: `ensureRunning`
      calls on one bot share one in-flight promise.
- [ ] `run.ts`: the run record is created first (`startRun`, bot `working`, a `status` event), then
      `ensureRunning` is awaited inside the run's own try/catch. **Any** failure there — the companion
      unreachable, `create` or `connect` throwing (E2B outage, `AuthenticationError`, `RateLimitError`,
      `TimeoutError`, anything else) — ends the run with `end: failed` whose summary is "could not
      start my computer: <error class name>", posts the bot message "I could not start my computer
      (<error class name>). Try again in a minute.", and puts the bot back to `idle`. The
      companion-unreachable case uses the wording "my computer's helper does not answer" instead.
      The `RunQueue`'s catch-all is a last resort that must never be the only handler; the test below
      covers the path. The run ends with `release`.
- [ ] `index.ts` boot recovery: for every bot, `listOpenRuns` → append `end: failed` with summary
      "the server restarted during this run", post the chat message from Task 5 step 6, set the bot
      `idle`; sandboxes are **not** touched at boot (they are paused or will be resumed on demand).
- [ ] `manager.test.ts` (fake timers via `vi.useFakeTimers()`, assertions on the fake factory's
      recorded calls — not on whether a mock was called, but on the sequence `create → pause` and on
      the persisted `sandboxId`): a bot without a sandbox gets `create` and its `bot.json` holds the id;
      the second `ensureRunning` connects instead of creating; `release` then 119 s → no pause; 120 s
      → pause; `release` then a new `ensureRunning` at 60 s cancels the pause and no pause happens at
      120 s; `connect` throwing `SandboxNotFoundError` clears the id, creates, and the chat holds the
      rebuild status card; two concurrent `ensureRunning` calls on one bot create once.
- [ ] `run.test.ts` (this task's part): with a session factory whose `create` throws a
      `RateLimitError`, a run started by a message produces `end: failed` with a summary that starts
      with "could not start my computer", one bot message that starts with "I could not start my
      computer", the bot's `state` is `idle` afterwards, and no model call was made.
- [ ] Commit `Add the sandbox lifecycle manager with idle pause and rebuild`.

### Task 11: The UI [integration] [demo-path]

**Files:** Create `src/web/styles.css`, `src/web/components/Roster.tsx`, `Chat.tsx`, `Cards.tsx`, `Composer.tsx`, `Preview.tsx`, `SkillsTab.tsx`; Modify `App.tsx`, `api.ts`, `events.ts`, `http/app.ts`.
**Invariant:** 1 — the preview panel is the live stream and the current action line comes from `step` events; proven by the manual walk-through at the end of this task. 5 — the preview is full-width during takeover and the Hand back button obeys the server's answer (the server, not the button, decides — Task 9's tests); proven by the same walk-through and by verification criterion 9.
**Demo step:** 1, 3, 4, 6, 8, 10, 11, 12, 14, 15.
**Verify:** `pnpm typecheck && pnpm build`

- [ ] Three columns, plain CSS (no UI library): Roster (avatar with a state ring: `idle` grey,
      `working` animated, `waiting` amber, `blocked` red; name; `statusLine`; **New bot** form with
      name, emoji, persona), Chat (messages by role; cards from `Cards.tsx`: artifact with title,
      first lines and a download link to `/api/bots/:id/artifacts/:name`; approval with summary,
      consequences, warnings, the screenshot from `/runs/:runId/shots/:hash`, Allow once / Deny;
      takeover with reason and the two buttons; status; skill and routine cards showing the plain
      body), Composer, Preview (the iframe, the current action line above it from the last `step`
      event, **Take over**, full width while a takeover card is active).
- [ ] Skills tab (a toggle in the header): `memory.md`, each `skills/*.md`, each `routines/*.md`
      as textareas with a Save button → `PUT /api/bots/:id/memory`, `PUT /api/bots/:id/skills/:name`,
      `PUT /api/bots/:id/routines/:name` (each body `{ text }`; the routine handler re-validates the
      cron and returns 400 with the message); `approval-rules.json` shown read-only with the note
      "edited on disk, no tool can write it". Add the three `PUT` routes, `GET
      /api/bots/:id/files` (memory, skills, routines, rules) and `GET /api/bots/:id/artifacts/:name`
      (the artifact file as `text/plain`) to `app.ts`. (Cut 2 removes the textareas' Save buttons
      and the `PUT` routes.)
- [ ] The UI shows nothing about the sandbox except the state (no id, no timers, no cost).
- [ ] Manual check: walk demo steps 4–8 and 10–13 in the styled page against a real sandbox.
- [ ] Commit `Add the roster, chat, preview and skills views`.

**Milestone 2 exit:** demo steps 6, 8, 10, 11, 12, 13 and 15 work; the second cut decision is
taken if M2 overran.

---

## Milestone 3 — Skills, routines, scheduler, prompt, act-one rehearsal (spec day 3)

### Task 12: Scheduler and routines [integration] [demo-path]

**Files:** Create `src/server/scheduler/scheduler.ts`; Modify `src/server/index.ts`, `store/bot.ts`; Test `src/server/scheduler/scheduler.test.ts`.
**Invariant:** 6 — next-run times are persisted in `bot.json`, so a restart shows what was missed and starts a run that is less than 12 hours late. Proven by the tests below.
**Demo step:** 4, 10 (a routine starts a run with nobody typing).
**Verify:** `pnpm exec vitest run src/server/scheduler`

- [ ] `scheduler.ts`: `class Scheduler { constructor(deps: { store, enqueueRun, now, timezone }) ;
      reload(botId): Promise<void>; stop(): void }`. `reload`: stop that bot's jobs; for every
      enabled routine with a `schedule`: `job = new Cron(schedule, { timezone, protect: true, catch:
      (e) => log.error(...) }, () => this.fire(botId, routine))`; persist `routines[name].nextRunAt =
      job.nextRun()?.toISOString() ?? null`. Before arming, the **missed-run rule**: if the persisted
      `nextRunAt` (from before the restart) is in the past and less than 12 hours old, `fire` once
      now and log "missed run started"; if older, log "missed run skipped" and update. `fire`:
      `enqueueRun(botId, { goal: routine.body, activeSkill: routine.skill, source: 'routine',
      routineName })`; after the run, `lastRunAt`, `lastResult` (the run's `end` summary, trimmed to
      one line) and `nextRunAt` are written and `statusLine` becomes `"routine: <name> — <lastResult>"`.
      Routines with `event` set are listed but never armed (logged once as "event routines are not
      scheduled in this build").
- [ ] `index.ts`: `scheduler.reload(bot.id)` for every bot at boot and after every `save_routine`
      and every routine `PUT`.
- [ ] `scheduler.test.ts` (fake `now`, fake `enqueueRun` recording calls, temp store): a routine
      `0 7 * * 1-5` armed at Friday 06:00 Europe/Prague persists `nextRunAt` = that day 07:00 local;
      a restart (new `Scheduler` over the same folder) with `now` = 07:30 fires once and only once
      even after a second `reload`; with `now` = the next day 20:00 (13 h late) it does not fire and
      `nextRunAt` moves to the next weekday; a disabled routine arms nothing; an `event` routine arms
      nothing and `enqueueRun` is never called; `lastResult` and `statusLine` are written after a
      fired run completes.
- [ ] Commit `Add the routine scheduler with persisted next-run times`.

### Task 13: Skill tools, the example bot and the prompts [integration] [demo-path]

**Files:** Modify `src/server/agent/tools.ts`, `prompt.ts`; Create `examples/job-hunt-bot/bot.json`, `memory.md`, `approval-rules.json`, `skills/search-job-board.md`, `skills/apply-to-posting.md`, `skills/handle-replies.md`, `routines/morning-search.md`, `routines/check-mail.md`, `workspace/README.md`; Test `prompt.test.ts`, `store.test.ts` (one case).
**Invariant:** 4 — `save_skill` and `save_routine` go through the store's slug validation and there is no tool that writes the rules file; proven by the `store.test.ts` case added in this task. 6 — the example folder is a complete bot that survives a copy to `data/`; proven by the Task 14 rehearsal, which starts from that copy, and by verification criterion 4.
**Demo step:** 1, 2, 3.
**Verify:** `pnpm preflight` (the grep must stay clean: the example folder is outside `src/`)

- [ ] Tools: `save_skill({ name, description, body })` → `writeSkill` + a skill card; `save_routine({
      name, skill, schedule?, event?, instruction })` → `writeRoutine` (an invalid cron returns the
      store's message as the tool result so the model can fix it) + a routine card + `scheduler.reload`.
      Add to the `store.test.ts`: the tool registry's names never include anything that writes
      `approval-rules.json` (assert the file is byte-identical after calling every tool's `run` with
      minimal input against a temp bot).
- [ ] `prompt.ts`: the routine run prepends "You are running the routine <name>. Use the skill
      <skill>. Instruction: <body>." and, for `source: 'message'` with no matching skill, the
      skill-offer rule from Task 5. Add to `prompt.test.ts`: the routine header appears for a routine run
      and not for a message run.
- [ ] Example bot (the state after demo step 3; the reviewer copies it with one command): `bot.json`
      (`sandboxId: null`, `state: idle`, `routines: {}`), `memory.md` with the five interview answers as
      dated lines (outcome, sources, constraints, deliverable, review point) written in the second
      person about the author's job search — no real company named; `approval-rules.json` =
      `DEFAULT_RULES`; the skills in plain sentences (search the board with the filters from memory;
      research the company with `fetch_url`, write the dossier and the letter as artifacts, fill the
      form with the bot's own address, attach the CV from `/home/user/workspace`, stop before the
      final button, say so in chat, and `remember` the line "Handed to the user on <date>: application
      to <company> for <role> at <url>, letter and CV attached. I did not submit it." (spec decision
      16); handle replies: open the mailbox, read new mail, check that the sender's domain matches the
      company and add a warning if not (spec decision 15), when the mail names a company from a
      hand-off line say "this looks like a reply to the application I prepared on <date>; I did not
      submit it, you may have", open the scheduling link, pick the first slot that matches the
      constraints, `propose_action` with kind `book`, the terms consequence and the sender warning);
      `memory.md` also holds the line "My own email address for forms: <the bot's mailbox address>"
      (the spec's decision 7: the bot writes its own address into every form);
      routines `morning-search` (`0 7 * * 1-5`, skill `search-job-board`) and `check-mail`
      (`*/30 * * * *`, skill `handle-replies`); `workspace/README.md` says "put the CV here as
      `cv.pdf`". The site names appear only in these files.
- [ ] `README.md` gains the line `cp -r examples/job-hunt-bot data/bots/job-hunt-bot` and "put your
      CV at `data/bots/job-hunt-bot/workspace/cv.pdf`".
- [ ] Commit `Add skill and routine tools and the example job-hunt bot`.

### Task 14: Act-one rehearsal [integration] [demo-path]

**Files:** Modify, as the rehearsal shows the need: `examples/job-hunt-bot/skills/search-job-board.md`, `examples/job-hunt-bot/skills/apply-to-posting.md`, `src/server/agent/prompt.ts`, `src/server/agent/actions.ts`, `src/server/companion/page-script.js`; Modify this plan (append "Rehearsal notes"). No other file.
**Invariant:** 1, 2, 5 — a real board, a real posting, a real form, the CV really attached, the run stops before the final button.
**Demo step:** 4–8, on a **different posting than the filmed one** (job-selection hard rule 2).
**Verify:** the run's `events.jsonl` shows `end: done`, a `remember` call whose note starts with "Handed to the user", no `submit-control` consume; the form on screen is filled and the CV name is in the upload field.

- [x] Copy the example bot, put a CV in the workspace, start the server, trigger the morning routine
      by setting its schedule a few minutes ahead, watch, fix what breaks (skill wording first, code
      second), re-run once on another posting. — Done 2026-09-12 with a typed goal instead of the
      routine (TODO's revised procedure), three rounds on one posting; see "Rehearsal notes".
- [x] Record in "Rehearsal notes": steps used, cost from the `cost` events, what was changed.
- [ ] Commit `Adjust skills and prompts after the act-one rehearsal`.

---

## Milestone 4 — Act two, README, write-up skeleton (spec day 4)

### Task 15: Act-two rehearsal [integration] [demo-path]

**Files:** Modify, as the rehearsal shows the need: `examples/job-hunt-bot/skills/handle-replies.md`, `examples/job-hunt-bot/routines/check-mail.md`, `src/server/agent/prompt.ts`, `src/server/agent/gate.ts` (the verb list only), `src/server/companion/page-script.js`; Modify this plan ("Rehearsal notes"). No other file.
**Invariant:** 3 (a real calendar event exists afterwards), 4 (the booking waits for Allow once; the `submit-control` hit consumes it), 5 (the mailbox password is typed only in the interactive stream).
**Demo step:** 10–14.
**Verify:** the calendar event exists in the author's calendar; `grep -r "<marker>" data/ *.log` for a marker typed during takeover returns nothing; the run's events show `gate: consume` with `rule: submit-control`.

- [ ] Send the seeded invitation from the dev address to the bot's mailbox (job-selection record:
      the real act-one company in the body, a visibly mock sender, the author's neutral Calendly page).
- [ ] Trigger `check-mail`; the login page appears; Take over; sign in with a marker string typed
      into the notes field before the password to prove the transcript stays clean; Hand back; the
      bot reads the mail, opens the link, proposes; Allow once; the booking completes; cancel it
      afterwards.
- [ ] Commit `Adjust the reply-handling skill after the act-two rehearsal`.

### Task 16: README, write-up skeleton, pre-flight [mechanical] [support]

**Files:** Modify `README.md`, `.env.example`; Create `docs/decisions.md`.
**Invariant:** none touched (delivery constraint 1).
**Demo step:** support — the reviewer cannot run the demo from a clean clone without it, and the graded write-up needs its skeleton before the video day.
**Verify:** `pnpm preflight`; a clean clone in a temp dir following the README only.

- [ ] README: prerequisites (Node 24 LTS, pnpm 12, an E2B key, an Anthropic key), the five setup
      commands, the example-bot copy, `pnpm dev` and `pnpm build && pnpm start`, what you see, the
      demo walk-through, the manual rebuild procedure (delete `sandboxId` in `bot.json`, restart),
      known limits (cross-origin frames fail closed, `wait` capped at 10 s, one operator, no auth).
- [ ] `docs/decisions.md` skeleton: the decisions log rows from the spec as headings, the
      trade-offs, "what I would build next" seeded from the job-selection record, and the
      open-source components list (E2B desktop SDK, Anthropic SDK, Hono, React, Vite, Vitest,
      croner, zod, pngjs, concurrently, websocket-client, noVNC via E2B) with what was added on top.
- [ ] **The owner's action, not Claude's:** create the GitHub repository, push `main`, and if it is
      private invite the client's reviewer (`CLAUDE.md` marks this deliverable as easy to miss; the private backlog
      section 0 carries it). The README's clean-clone check in Verification criterion 7 is run
      against that remote.
- [ ] Commit `Write the README and the decisions skeleton`.

## Verification Criteria

| # | Criterion | How to verify |
| - | --------- | ------------- |
| 1 | The bot's remote screen is visible and live in the preview panel within 15 s of a run starting (demo step 4–5, human-observable) | start a routine a minute ahead, watch the ring turn to working and the screen move; time it |
| 2 | An unannounced click on a submit control stops with a card; Deny leaves the form unsubmitted; Allow once on a `propose_action` card lets exactly that button on that page through and a different button is still blocked | run the gate tests; then on a real form press Deny and inspect the page; then approve one and click another |
| 3 | A marker typed during takeover appears in no chat line, no event, no log | takeover, type the marker into a text field before the password, hand back; `grep -r marker data/ server.log` returns nothing |
| 4 | The roster, chat, skills, memory and the bot's screen survive a page reload **and** a server restart (demo step 15) | reload; stop and start `pnpm dev`; the sandbox resumes on the next message |
| 5 | A routine fires with nobody typing and its result is one status line on the roster (demo step 4, 14) | set a schedule two minutes ahead, wait |
| 6 | The job finishes: a real calendar event exists after Allow once (demo step 13–14) | open the author's calendar |
| 7 | A clean clone runs with only the README's steps and the two keys | `git clone` into a temp dir, follow the README literally |
| 8 | `pnpm preflight` passes and the site-name grep returns nothing | run it |
| 9 | Hand back is refused while a password field has a value or the page has not changed | takeover, type into the password field, try Hand back: refused with the reason; move past the login: allowed |

## Test Plan

- Offline (no key, no network): `store`, `frontmatter`, `gate`, `takeover`, `stuck`, `images`,
  `actions`, `model` (cost table), `prompt`, `queue`, `manager` (fake timers, fake session factory),
  `scheduler` (fake clock, temp store), `run` (fake sandbox, fake model, fake companion — asserting
  on events, store writes and the sandbox call log, never on the fakes' own return values),
  `config`. Command: `pnpm test`.
- Live (needs `E2B_API_KEY`, `ANTHROPIC_API_KEY`): `pnpm day-one create …` / `resume …` (Task 4),
  the manual checks in Tasks 7 and 11, the rehearsals in Tasks 14 and 15. Evidence goes into this
  file's "Day-one results" and "Rehearsal notes" sections and into `/verify`.
- Not tested with mocks on purpose: the E2B and Anthropic SDK calls themselves, the companion's
  page script (verified on real pages in Task 4), the UI (verified by the walk-through).
- Full pre-flight at the end of every task: `pnpm preflight`.

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan and its "Day-one results" and "Rehearsal notes" sections at the end.
2. `git log --oneline` — each task ends with the commit subject given above.
3. Pick up from the first task whose commit is missing. Tasks 0, 2, 3, 4, 1, 5, 6, 7 (M1), then
   8, 9, 10, 11 (M2), 12, 13, 14 (M3), 15, 16 (M4).
4. If the day-one results say a check failed, apply the matching row of "Scope and cuts" before
   continuing.

## Backbrief

**End-state.** Seventeen tasks, one commit each (a task may land as two), on `main`, that turn the spec into a running platform: after the
last one a viewer can watch a routine start a bot's run on a visible remote desktop, see the bot
fill a real form and stop before the final button, hand the screen to a human for a password
without that password reaching the transcript, approve a real booking on a card and find the
event in a real calendar, then restart the server and find everything still there.

**Critical constraints.** The gate and the secret guard run in `run.ts` between the model's tool
call and `executeAction`, on the companion's answer, and treat an unknown target as a rule hit —
never in the UI and never after the action. Nothing under `src/` may name a site, and nothing
outside `config.ts` reads a key; the companion token and the stream key never reach a log, an
event or the chat. The bot folder is written before the sandbox is touched, and the sandbox is
paused, never killed, so that a restart finds the folder and `Sandbox.connect` finds the screen.

**Latitude.** Implementers decide the internal decomposition inside the listed files, the exact
wording of card texts and log fields, the CSS, the test file organisation within the named files,
whether a task lands as one or two commits, and the concrete values of retry counts and poll
intervals within the timeouts given here.

## Day-one results

Run on 2026-09-11 in the evening with `pnpm day-one create` (sandbox clock 21:17–21:33 UTC).
Sandbox `ilz0pmm96mr49jl6krjln`, paused at the end. Resume on 2026-09-12 with:

```bash
pnpm day-one resume ilz0pmm96mr49jl6krjln https://calendly.com/what-a-fake-company/30min
```

| # | Check | Result |
| - | ----- | ------ |
| 1 | Companion health | PASS `{"ok":true,"cdp":true}`. The pip install and the companion start work on the template. |
| 2 | The token protects the public port | PASS. A request without the token gets 401. |
| 3 | Chrome accepts CDP with the default flags | PASS. `CHROME_NEEDS_NO_SANDBOX` stays `false`. |
| 3b | xdotool present | PASS (`/usr/bin/xdotool`). The horizontal wheel is not decided: the page that opened (Calendly's 404 page) has no horizontal scroll, mean pixel difference 0.00. Re-check on a wide page. |
| 4a | `elementAt` on the scheduling page | PASS on the DOM: the point on "Contact us" returned `a`, role `button`, name "Contact us". The booking page itself was not reached: the address in the job-selection record (`owner-name`) returned 404 from the sandbox and from a home connection, because the account had been renamed to its neutral display name; the new address is `https://calendly.com/what-a-fake-company/30min`. The day and time buttons are inspected at resume. |
| 4b | `elementAt` on the application form | PASS. The send control returned `button`, `type=button`, name "Odeslat zájem", `inForm=false`, `isSubmit=false` (the site posts through its own JavaScript, not through a `<form>` submit); the gate stops it through the verb-name rule ("odeslat"), which is what Signal B was designed for. The upload control returned `button`, name "+ uploadnout přílohu". |
| 5 | `setFiles` on the upload control | **FAIL**. The companion answered 404 `no file input`. Root cause, verified from a home connection: the page has no `input[type=file]`; its upload button creates a detached file input (`accept` PDF, DOC and ZIP, `multiple`) and calls `.click()` on it, so nothing exists at the point until the click. Fix (decided): the companion arms `Page.setInterceptFileChooserDialog`, clicks the control with a trusted CDP `Input.dispatchMouseEvent`, waits for `Page.fileChooserOpened` and calls `DOM.setFileInputFiles` with the event's `backendNodeId`. This is the pattern Playwright uses for detached inputs; `set-files` keeps the DOM lookup as its first attempt. **Fix landed 2026-09-12:** `set_files` tries the DOM input first, then arms `Page.setInterceptFileChooserDialog`, clicks with `Input.dispatchMouseEvent`, waits for `Page.fileChooserOpened` and calls `DOM.setFileInputFiles` with its `backendNodeId`; Chrome shows no native picker while interception is on. Both CDP facts were checked against the protocol reference. Because the companion may now click, the platform resolves the element first: a `submit-control` or `verb-name` target is refused, and a target the companion cannot read gets no click at all (the companion only accepts a click the platform explicitly allowed). Unverified on the real page. **Re-run check 5, and add check 5b:** point the upload at the real send control ("Odeslat zájem") and confirm the tool refuses it, nothing is clicked and nothing is submitted. No Python in this repository has any test, so 5b is the only proof that the companion's click lands where the platform vetted. |
| 6 | Pause | PASS (`paused`). The resume-next-day result is recorded below. |

**Decision:** continue as planned, no cut. Check 5 is a companion change of about half a day,
not a design change; the DOM rules, the token and the paused sandbox all held.

**Also found, for the code and the write-up:**

- Chrome starts as a window of about 1050×780 on the 1280×800 screen; the maximise button had
  to be clicked. Add `--start-maximized` to the Chrome flags and verify at the next create.
- Chrome's translate bubble ("Czech / English") opens over Czech pages. Add
  `--disable-features=Translate`.
- Chrome shows "Relaunch to update" in the toolbar: the template's Chrome is behind. The version
  is printed at resume; update it in `createSandbox` only if a site needs it.
- The sandbox's IP is in the United States. startupjobs.cz shows its US-only "Oznámení /
  Neprodávejte mé osobní údaje" notice, which covers the bottom 110 px of the page and the form's
  sticky send button; Calendly shows its cookie banner (declined by click). A visitor from Prague
  never sees the first one. Check whether E2B offers an EU region; otherwise the model has to cope
  with the notice, and the write-up names it.
- The form's send button is a sticky footer of the overlay, and the upload box only appears after
  scrolling the overlay; a page-down click on its scrollbar track worked.
- Operator note: the script reads one answer per prompt; lines sent while it is busy are dropped
  (Node readline). Type one answer at a time.
- The day-one script gained `click x y` in the inspect loop (used for the cookie banner, the
  maximise button and the scrollbar) and an optional scheduling-page address for `resume`. After
  review, a click describes its target first and needs a typed `yes` when the gate's rules call it
  a send control, because the send button and the scrollbar were pixels apart.

**Resume on 2026-09-12 (partial — the human half is still open).** Connected to the paused
sandbox `ilz0pmm96mr49jl6krjln` at 10:50 UTC, about 13 hours after it was paused. Automated
checks and the two screenshots are recorded; the mailbox sign-in and the booking need the human
with the password and were left for the operator. Re-paused cleanly at the end (`{"paused":true}`).

| # | Check | Result |
| - | ----- | ------ |
| A | Resume a day-old paused sandbox on the Hobby plan (open question 4) | **PASS.** It resumed and answered. A paused sandbox does survive past the "1 hour" continuous-session limit, which is about run time, not calendar time. |
| B | Companion back after resume | **PASS** `{"ok":true,"cdp":true}`. |
| C | Chrome version (the code-review risk: `backendNodeId` on `fileChooserOpened` is experimental and the template's Chrome was "behind") | **Google Chrome 150.0.7871.114** — current enough that the experimental field is long present; the risk is effectively closed. "Relaunch to update" still shows in the toolbar but no update is needed for the fix. |
| D | Chrome profile survived pause+resume | **PASS.** The Seznam tab is still open with the bot's address pre-filled in the email field, the startupjobs posting tab from yesterday is still there, and the Calendly tabs are open. Only the mailbox is not signed in — because nobody has signed in yet. |
| E | Calendly loads from the sandbox's US IP with no reCAPTCHA on load (the load-bearing risk for act two, R6) | **PASS on load.** The booking page rendered fully: the mock interviewer name "Mock Name", the September calendar with bookable weekdays, no reCAPTCHA. **Caveat:** reCAPTCHA can still appear at submit; that is unverified and waits for the real booking. |
| F | Time zone from the sandbox | Calendly shows **UTC**, because the sandbox is in the US. The booking skill must convert to Prague when it picks a slot, and yesterday's US-only startupjobs privacy notice is the same root cause. |

**The human half, run by the operator on the interactive stream later the same morning:**

| # | Check | Result |
| - | ----- | ------ |
| G | Mailbox sign-in from the sandbox's US IP | **PASS.** The password alone got in; Seznam raised no extra challenge from the cloud IP. Answers platform-spec open question 1. |
| H | Book from the sandbox IP | **PASS, with a cost.** The booking completed and the "You are scheduled!" page appeared. But **reCAPTCHA fires at submit**, not at load: a tick box, then **four image grids** on the first attempt before it let the booking through. |
| I | Confirmation mail reaches the bot's inbox | **PASS.** Calendly's calendar invitation arrived at `bot@example.test` within a minute. External mail reaches the inbox the bot watches, which act two depends on. |
| J | Does a solved challenge make the next booking cheaper, across a pause and resume? | **Mostly yes.** A second booking from the same Chrome profile, after the sandbox had paused and been resumed, asked for **one** grid instead of four. The profile keeps the token through a pause; it does not remove the challenge. |

**What this fixes in the act-two design.** The CAPTCHA is now a designed beat, not an accident, and
it is a takeover. `handle-replies.md` tells the bot to expect the check after "Schedule Event",
never to attempt it, and to hand the screen over and ask the human to finish it and press Continue.
One grid is about fifteen seconds on camera and it reads well: it is the most universally
understood human-in-the-loop moment there is.

**Filming-day procedure that follows from check J: warm the profile.** Make one throwaway booking
about an hour before recording and cancel it. That turns the cold four-grid case into the warm
one-grid case. Without it, the first booking of a session is the expensive one.

**Rejected: moving act two to another scheduling surface.** The spec's named fallback was a Google
Calendar appointment page, for the case where Calendly blocks the datacenter IP outright. Calendly
does not block, it challenges, and a challenge is precisely what takeover exists for. The decision
rests on three technical points, not on effort:

1. **Calendly needs no account to book.** Checked live: an invitee types a name and an address and
   books. Google's appointment pages can require the invitee to be signed in to a Google account.
   That would put a Google credential inside the bot's browser on a datacenter IP, which is both a
   worse security story for the write-up and the sign-in Google challenges hardest.
2. **The whole path is proven end to end here** — invitation, booking, confirmation mail to the
   bot's inbox — and the challenge is bounded at one image grid on a warmed profile.
3. **Calendly has no API a candidate can call**, which is what makes the visible computer necessary
   at this step rather than decorative. Google Calendar's API is public and well known, so a
   reviewer could reasonably ask why a browser is being driven at all.

**This is not a closed question and it is cheap to reopen.** If the warmed one-grid case turns out
to be unreliable across several sessions, the Google page can be tested properly rather than
assumed: the unknown is only whether it permits booking without a sign-in, which is one experiment.

**Two things found while running this, both now fixed or recorded:**

- **The sandbox paused under the human's hands, mid-takeover.** A sandbox pauses after its own
  20-minute timeout unless the E2B API is called, and noVNC traffic does not count; `keepAlive` ran
  once when the run acquired the computer and never again. A takeover is the worst case, because
  the loop makes no calls at all while it waits for a person. Fixed: a run refreshes the timeout
  every five minutes until it ends.
- **The calendar invitation arrives under the author's real name.** Calendly sends it through the
  connected Google account, whose display name is the author's own, so the neutral Calendly name
  ("Mock Name") does not reach the invitation's sender. On camera the booking confirmation
  therefore looks self-dealt. Cheap fix before filming: rename that Google account. Not a blocker.

**Tooling note:** the automated half was driven from `pnpm exec tsx` (connect + pause via the raw
SDK), not from `pnpm day-one resume`, because the interactive script's readline prompts cannot be
fed from a background process cleanly. The resume script gained `type`/`key` commands next to its
`click` for filling a form through platform actions, but the sign-in and booking still belong to
the human on the stream, so they were not used here.

### The file-chooser fix: sources and the risk it carries

Written 2026-09-12 after the code review asked where the protocol facts came from. The plan's
original CDP research row cited only the `DOM` and `Runtime` domains, so the `Page` domain this
fix depends on had no source link. Checked against the protocol reference, not from memory:

| Fact the fix depends on | Source |
| --- | --- |
| `Page.setInterceptFileChooserDialog` exists and is not deprecated | <https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setInterceptFileChooserDialog> |
| `Page.fileChooserOpened` is "Emitted only when `page.interceptFileChooser` is enabled", and carries `backendNodeId`, "Only present for file choosers opened via an `<input type="file">` element" | <https://chromedevtools.github.io/devtools-protocol/tot/Page/#event-fileChooserOpened> |
| `DOM.setFileInputFiles` accepts `backendNodeId` as an alternative to `nodeId` and `objectId` | <https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-setFileInputFiles> |

**The risk that stays open.** `backendNodeId` on that event is marked *Experimental* in the
reference, which means it can differ between Chrome builds, and the day-one run found the
template's Chrome is behind ("Relaunch to update" in the toolbar). If the field is missing on that
build, the companion logs "the file chooser names no input node" and the upload fails the same way
it did before the fix — the input the page created is detached, so no selector can reach it. **The
signal is that exact log line, and the answer is to update Chrome in `createSandbox`.** The day-one
script prints the Chrome version at resume; record it with check 5.

**Suggestions from the review that were not taken, and why:**

- *A structured error code instead of matching the companion's error text.* `attach_file` decides
  which failure happened with `message.includes('no file input')`, so a reworded companion message
  silently degrades it to the generic branch. Real, but it is a refactor across the HTTP boundary
  and the wording is now covered by a companion test; the demo path does not depend on it.
- *Re-checking the element inside the same CDP session just before the click.* The platform vets
  the element in one call and the companion clicks in another, so a page that mutates in between
  is clicked without a fresh check. The model does not control that timing, and the window is one
  round trip.

## Rehearsal notes

Every act-one and act-two rehearsal is recorded here: what was typed, what appeared, what it cost,
which gate cards were false positives, and what was changed before the next round.

### Round 1 — 2026-09-12, act one on Deny (posting 100001, Senior Node.js Developer at Company A)

**Setup, per the README:** `mkdir -p data/bots`, copy of `examples/job-hunt-bot`, the CV as
`workspace/cv.pdf` (3 pages, 89 KB), `pnpm dev`, Hunter selected, one typed message:
"Prepare an application for <posting URL>. Do not submit; I will decide on the card."
The posting was named by the owner as one he will not apply to. Preflight before the run: 20 files,
234 tests, green.

**Four defects before the first message was typed.** All four are recorded because a reviewer's
clean clone hits the first two.

| # | What happened | Cause | Fix |
| - | ------------- | ----- | --- |
| S1 | The server died at boot: `invalid name ".gitkeep"`. | `cp -r examples/job-hunt-bot` copies `runs/.gitkeep`; `listOpenRuns` passed every entry to the run-id check, which throws, and nothing caught it. | `listOpenRuns` skips names that are not run ids (hidden ones silently, others with a warning). Two tests: one on the listing, one that boots a literal copy of the example folder, which also pins the example's `bot.json` to the schema. |
| S2 | The dev page was blank. | The Vite proxy keys `/api` and `/events` are prefixes, so the page's own `/api.ts` and `/events.ts` modules (the web root is `src/web`) were proxied to Hono. The dev UI had never rendered before this run. | The keys are anchored regexes `^/api/` and `^/events/` (Vite docs: a key starting with `^` is a RegExp). |
| S3 | The API answered 502 after S1 and S2 were fixed. | The desktop app's preview tool injects `PORT=5173` into the dev process, and a shell variable wins over `.env.local`, so Hono bound 5173 next to Vite while the proxy pointed at 3000. Not a project defect. | `.claude/launch.json` starts the server with `env -u PORT pnpm dev`. |
| S4 | "the mailbox is only half configured" at boot, although all three keys are set. | `MAILBOX_PASSWORD` starts with `#`, which Node's env-file parser reads as a comment, so the value parses as empty. Found by value length and first-character class only; the value was never printed. | The owner's: wrap the value in double quotes. Only act two needs it. |

**The run** (run id `84ce44c5…`, sandbox `iyv3zjam4u5jxll14vzl9`, all times UTC):

| Time | What |
| ---- | ---- |
| 13:33:47 | Message sent; "setting up my computer". |
| 13:33:53 | Sandbox created: 6 seconds. Chrome up, stream in the preview. |
| 13:34:06–13:34:38 | The cheap path, before any screenshot: `fetch_url` on the posting, on company-a.example/o-nas (404) and on company-a.example; `write_artifact` dossier (3154 chars) and cover letter in Czech (1336 chars). Both cards in the chat 50 seconds after the message. |
| 13:34:45 | Card 1: unannounced click on the address bar of `about:blank`, rule `unknown-target`. Allowed once. |
| 13:36:31 | The typed URL was appended after the existing "about:blank" in the address bar; Enter went to a broken address. Escape, then card 2: the address bar again. Allowed once. |
| 13:38:07 | `ctrl+a`, the URL, Enter: the posting opened. Steps 15–37: clicks at the bottom of the page (the privacy notice), zooms, scrolls. |
| 13:39:02 | Card 3: double-click at (200, 47), the tab strip, to maximise the window. Allowed once. |
| 13:40:15 | Card 4: double-click at (640, 15), the desktop's top panel. Allowed once (through the API). |
| 13:42:00 | End, outcome `stuck`: three unchanged screenshots. Takeover card posted. |
| 13:44:01 | The sandbox paused by the two-minute idle rule, with the takeover card still active. |

**Numbers:** 51 steps in the log (14 screenshots, 10 waits, 9 clicks, 8 zooms, 4 keys, 2 types,
2 scrolls, 2 double-clicks); 26 model calls; **$1.06** for the run (cache reads 237k tokens,
cache writes 242k, output 4.9k); 8 minutes from message to end.

**Gate cards: 4, all false positives.** None was a page control: two clicks on the address bar,
one on the tab strip, one on the desktop panel. The companion maps a screen point into the page
viewport and finds nothing above it, so the gate fails closed on browser chrome exactly as it
does on a cross-origin frame. Correct by the rule as written, wrong for the product: the first
approval card of the demo would be about the address bar.

**Not reached:** the application form, the CV upload (day-one check 5 stays unverified on a real
page), the "Odeslat zájem" card, Deny. The dossier and letter cards are the round's only product
evidence, and they are good: the cheap path works and the letter is in the posting's language.

**What the model got wrong:** it clicked the address bar instead of using a keyboard shortcut;
its first URL was appended to the existing text; it spent three clicks on the privacy notice
without dismissing it; it tried to maximise the window by double-clicking a tab and then the
panel, which does nothing on this desktop.

**What the platform got wrong:**

1. Chrome starts as a 1050×753 window on the 1280×800 screen although `--start-maximized` and
   `--window-position=0,0` are set. The model saw a quarter of the screen black and tried to fix it.
2. There is no tool to open an address, so every navigation is an address-bar click, and every
   address-bar click is a gate card.
3. The gate's `unknown-target` rule fires on the browser's own frame (tab strip, address bar, the
   desktop panel), where no page control can exist.
4. The stuck end posts a takeover card that says "nudge me, then hand back", but the run is over:
   hand back only sets the bot idle, and the sandbox pauses two minutes after the end, under the
   human's hands if they took over.
5. The 60-step budget is tight: 51 steps were spent before the form was even open. Measured cost
   per step is about two cents, so the cap is not protecting much money.
6. The US-only privacy notice (day-one finding) is real and costs steps.

**Experiment on the paused sandbox afterwards** (raw SDK, `data/experiment.mts`, no model):

- The template's xdotool (3.20160805.1) has no `windowstate` command and there is no `wmctrl`.
  `xdotool windowactivate --sync <id> key alt+F10` — the window manager's own maximise key —
  took the window from 1050×753 to 1288×777 at (-4, 27), the full work area under the panel.
  That state was paused with the sandbox, so the next run on it starts maximised.
- The notice is CookieYes (`.cky-consent-container.cky-banner-bottom`), shown to US visitors. Its
  only control, "Neprodávejte mé osobní údaje", opens a dialog "Opravdu si přejete odhlásit se?"
  with a checkbox and the buttons "zrušení" and "Potvrdit"; only ticking the box and pressing
  Potvrdit removes the notice, and "potvrdit" is a gated verb. Escape brings the notice back.
  The clean fix is a sandbox in the EU, which E2B offers on the Pro tier through support
  (<https://docs.e2b.dev/faq/eu-region.md>); the Deny path does not need the notice gone, because
  the bot proposes the send button by label and never clicks it.

**Changed before round 2** (each with its test where one is possible):

- Sandbox layer: `--start-maximized` replaced by an xdotool maximise after Chrome starts, sent only
  when the window is narrower than the screen (alt+F10 is a toggle); `--disable-features=Translate`
  added (day-one recommendation).
- New platform tool `open_url`: opens an address in the running browser as a new tab; the prompt
  says to use it and never touch the address bar.
- The companion reports a point above the page viewport as `browser-ui`, and the gate applies no
  rule to it. Points beside or below the viewport stay `unknown` and fail closed, because a
  mis-measured toolbar height could otherwise turn a real control at the bottom of a page into
  "browser UI". `attach_file` withholds its click for anything that is not a resolved element.
- A run that ends stuck or over budget keeps its computer up until the human hands back, and
  the takeover card says what hand back does.
- Step budget 60 → 100 (README updated).
- `listBots` skips hidden entries silently (review suggestion), and the runs-listing test asserts
  the warning for a non-hidden stray entry.
- Skills (`apply-to-posting`, `search-job-board`): open pages with `open_url`; the posting's
  "Mám zájem o nabídku" button opens the form; leave the privacy notice alone and scroll the form
  so the needed field is above it.

**For the owner:** (a) quote the mailbox password in `.env.local`; (b) decide on the E2B EU region
(Pro tier, support request) — it removes the notice and the UTC clock in one move; (c) a
`pnpm day-one resume` session from this morning is still open in a terminal (ttys006), waiting at
its prompt.

### Round 2 — 2026-09-12, same posting, after the round-1 fixes

**Setup:** the same bot folder and the same sandbox, resumed from pause (its window already
maximised by the experiment above); the same typed message. Preflight before the run: 20 files,
243 tests, green.

| Time (UTC) | What |
| ---------- | ---- |
| 14:00:53 | Message sent. |
| 14:01:12–14:01:28 | Cheap path again: two `fetch_url`, dossier and letter rewritten under the same names. |
| 14:01:30 | `open_url` on the posting — no address bar, no card. Two clicks with no rule: "Mám zájem o nabídku" opened the form overlay. |
| 14:01:50 | `ask_user`: "The application form asks for a phone number. What phone number should I use on job application forms going forward?" — the memory line says to ask once. The owner chose a placeholder for the rehearsal (+420 000 000 000); `remember` wrote it. |
| 14:04:45–14:05:00 | Name, LinkedIn, e-mail and phone (prefix +420, number) filled in correctly. |
| 14:05:01 | First failed `type` on the letter: "Invalid multi-byte sequence encountered — xdo_enter_text_window reported an error". Six more followed. |
| 14:11:08 | End, outcome `budget` (100 steps). |

**Numbers:** 101 steps (28 keys, 22 types, 18 clicks, 16 screenshots, 15 zooms, 1 scroll, 1 wait);
55 model calls; **$1.89**; 10 minutes. **Gate cards: 0.** Failed tool results: 7, all `type`.

**What worked, and is new since round 1:** the whole path to the form is card-free (`open_url`,
the browser-frame rule, the maximised window); the privacy notice cost no steps, the model left
it alone as the skill says; the bot asked the user for the one value its memory lacked and
remembered the answer; four fields were filled correctly; after the blocked end the computer stayed
up under the takeover card instead of pausing two minutes later (checked live at 14:14, three
minutes after the end; the pause followed the hand back, as designed).

**What failed:** the cover letter. The E2B SDK's `write()` runs `xdotool type` without a UTF-8
locale, so any character with a diacritic fails and the command exits 1. A Czech letter is the
demo's normal case (the skill writes it in the posting's language). The model spent the rest of
the budget probing one character at a time, clearing the field with ctrl+a and Delete and
retrying; the field was empty at the end. Not reached again: `attach_file` (day-one check 5),
`propose_action`, Deny.

**What the model got wrong:** nothing that cost more than a step or two; the typing failure was
the platform's.

**Changed before round 3:**

- The sandbox layer types through its own `xdotool type` call with `LC_ALL=C.UTF-8` (the sandbox
  has `C.utf8`, and its default locale is plain `C`) in code-point chunks of 25 characters, instead
  of the SDK's `write()`.
- Two blocking findings from the code review of the round-2 changes, both real on inspection:
  1. A run that ended blocked kept its session but its keep-alive was cleared with the run, so a
     human away for more than E2B's 20-minute timeout would come back to a computer E2B had paused
     while the platform still held a live-looking session: hand back refused forever ("not
     answering"), and the next run failing on the stale session. Now the keep-alive is held until
     hand back or the next goal (either drops it and ends the takeover card), and the sandbox
     manager brings a computer up again when its session stops answering (a resume) instead of
     failing the run. Tests on both.
  2. `browser-ui` trusted the frame height without a bound: anything that takes room at the
     bottom of the window (DevTools docked there, a bottom bar) inflates `outerHeight -
     innerHeight`, and real page controls would have mapped above the page and passed the gate
     with no rule. A point above the page is `browser-ui` only while the frame is at most 160 px;
     beyond that it fails closed. The page script now has a unit test with a stub window
     (`page-script.test.ts`), covering the address bar, the tab strip, the docked-DevTools case, a
     control inside the page and a point below it. **Tightened after round 3** by the second
     review: a short bottom bar (under 69 px) inflates the same gap without moving the page's top
     edge, so a control in the top few dozen pixels of a page could still have passed as frame.
     The bound is now 110 px, just above the plain 91 px frame: at most about 20 px of bottom
     chrome can pass, and a bookmarks bar or an infobar pushes a frame click to unknown (fails
     closed). Two more unit tests pin both directions. Round 3 ran with the 160 px bound; the
     change only turns more frame clicks into approval cards, never the reverse.
- The runner test proves the session is torn down only after hand back, and a duplicate assertion
  left the gate test (test review suggestions). `openUrl` throws the sandbox layer's own error class.
- From the second review, after round 3: when a live session is reused, the manager also asks the
  companion for its health and, if it does not answer, reconnects (which restarts the helper) —
  tested; the reconnect log line names the sandbox. **Trade-off written down:** a bot that ended
  blocked and is then abandoned (no hand back, no new goal) holds its computer awake until the
  server restarts or E2B's own limits end it; that is the price of the takeover card pointing at a
  live screen, and the daily budget item in TODO section 3 is where a cap on that hold belongs.

### Round 3 — 2026-09-12, same posting, after the round-2 fixes: the act ran clean

**Setup:** the same bot folder and sandbox; the same typed message. Preflight before the run: 22
files, 251 tests, green. Both reviews of the round-2 changes were in: the test review passed, the
code review's two blocking findings were fixed and tested (above).

| Time (UTC) | What |
| ---------- | ---- |
| 14:22:04 | Message sent. |
| 14:22:22–14:22:41 | Cheap path: three `fetch_url`, dossier and letter rewritten (same names). |
| 14:22:43 | `open_url` on the posting; "Mám zájem o nabídku"; the form overlay. |
| 14:22:50–14:23:15 | Name, LinkedIn, e-mail and phone filled from memory — no question this time, the phone line is remembered. |
| 14:23:27–14:25:29 | The cover letter typed in nine parts with every diacritic intact, then scrolled into view and checked. |
| 14:25:34 | `attach_file` at the upload control ("+ uploadnout přílohu"): `attached cv.pdf`. The next screenshot shows a "cv.pdf" row above the control. **Day-one check 5 passes on the real page**: the page has no file input, the companion's file-chooser interception did it, and no native picker appeared. |
| 14:27:05 | `propose_action`, kind `submit`, target "Odeslat zájem", page `…/100001/example-posting-a#application`. The card: "Submit this application to Company A for the Senior Node.js Developer (Company A) role"; consequences: the employer receives it under my name, the letter and CV are sent, this certifies the form is accurate, it cannot be withdrawn; one warning the bot added itself: "Role also expects PHP for a core integration; Node.js/TypeScript is the primary skill sought"; a screenshot of the filled form. |
| 14:27:38 | **Deny**, pressed on the card. |
| 14:27:42 | `remember`: "Handed to the user on 2026-09-12: application to Company A for Senior Node.js Developer (Company A) at <url>, letter and CV attached. Not submitted — the user denied it." |
| 14:27:48 | End, outcome `done`. Chat: "I did not submit it. Everything stays filled in if you want to press "Odeslat zájem" yourself — the form on that tab still has your name, LinkedIn, email, phone, the tailored cover letter, and cv.pdf attached", then a summary of the dossier, the letter and the form, and the PHP note again. |
| 14:29:49 | Idle pause, two minutes after the end (server log). |

**Numbers:** 44 steps (15 screenshots, 9 types, 9 scrolls, 7 clicks, 4 zooms); 41 model calls;
**$1.18** (cache reads 777k tokens, cache writes 374k, output 9.3k); **5 min 44 s** from message to
end. **Gate cards: 0. Failed tools: 0. Consumes: 0** — the only approval of the run was the announced
one, and it was denied.

**Task 14's verification, line by line:** `end: done` — yes; a `remember` note starting with
"Handed to the user" — yes; no `submit-control` consume — none (no consume at all); the form on
screen filled and the CV name in the upload field — yes, in the bot's own screenshot after step 30.

**What the model got wrong:** nothing on the path. Two things worth knowing for the video: it
types the letter in parts of two to four sentences (about twenty seconds each at the 40 ms key
delay), and the "Odeslat zájem" sticky footer is partly under the privacy notice, which the Deny
path never needs to press.

**Cost of the three rounds together:** $4.13 ($1.06 + $1.89 + $1.18) and 24 minutes of run time.
A clean act one costs about $1.20 and six minutes; a second run on the same posting reuses the
prompt cache almost entirely.

**Still open after this rehearsal:**

- For the owner: ~~the mailbox password (quote it)~~ — done the same evening, IMAP login verified;
  the EU region: **decided 2026-09-12 evening, the owner pays for E2B Pro** ($150 a month plus
  usage, 24-hour sessions, per e2b.dev/pricing that day; the EU cluster comes with it through
  support — corrected 2026-09-14: E2B support answered that the EU cluster is a separate project
  with its own API key and its own Pro subscription, see the private backlog) because the product may go
  further than the take-home; the bot gets a fresh EU
  sandbox once access is granted, which means a cold Chrome profile and one more rehearsal of
  each act from an EU address (no US-only notice, local time on Calendly); the placeholder
  phone number in the bot's memory (correct it in the Skills tab before filming), the day-one
  sandbox `ilz0pmm96mr49jl6krjln` (unused now; kill it or leave it paused), and the `pnpm day-one
  resume` session still open in a terminal.
- Three tabs of the same posting are open in the bot's Chrome, one per round: `open_url` opens a
  new tab each time. Harmless; a tidier `open_url` that reuses the current tab is a small companion
  change (CDP `Page.navigate`) if the tabs ever get in the way.
- The dossier and letter artifacts are rewritten on every run under the same names; a run id or a
  date in the name would keep the history, if the write-up wants it.

### Act two, round 1 — 2026-09-12 evening: the job finished

**Setup:** the same bot and sandbox (mailbox not signed in: the sandbox is from today); the mailbox
settings verified beforehand by an IMAP login through the platform's own watcher class (1 unseen).
The Calendly profile was not warmed (a takeover needs a running computer, and none was up).
The owner was at the keyboard; each human step was given one at a time.

| Time (UTC) | What |
| ---------- | ---- |
| 19:57:11 | Server up; "mail watcher started"; baseline set at 19:58:11 with 1 unseen. |
| ~20:02 | The owner sent the seeded invitation from his development Gmail address: subject "Pozvánka na pohovor – Senior Node.js Developer (Company A)", a short Czech body naming Company A and the skills the letter raised, the Calendly link, signed "Interviewer XY". Gmail showed his account's display name as the sender name, not "Interviewer XY". |
| 20:03:13 | "new mail, unseen 2, previous 1"; the `mail-arrived` event fired; the `check-mail` routine started a run with nobody typing. |
| 20:03:15 | Sandbox resumed; `open_url` on mail.example.test; the bot typed its address on the sign-in page. |
| 20:03:27 | Card 1: unannounced click on the login page's "Continue", rule `submit-control`. Correct by the rule (a real form submit), pointless for the product; allowed once through the API. |
| 20:04:28 | `request_takeover` "the mailbox asks for a password"; the takeover card; the owner signed in on the bot's screen and pressed Hand back at 20:13:14. No password touched the platform, the chat or the model. |
| 20:13:54 | The bot read the invitation and **asked instead of proposing**: a Gmail sender, an application it recorded as not submitted, and a link that says "what-a-fake-company" — "I don't think this is legitimate. Do you want me to open that link anyway?" The owner answered in the chat that he arranged it as a test. |
| 20:15:54 | `open_url` on the Calendly page; the bot set the page's time zone to Prague itself; it picked Monday 14 September, 9:00–9:30. |
| 20:16:44 | Card 2 (announced): "Book Monday, September 14, 2026, 9:00am–9:30am (Central European Time) for the interview with Company A (Senior Node.js Developer, Company A)", two consequences, the sender warning in red quoting the owner's confirmation. Target named "Next" instead of "Schedule Event". The owner pressed Allow once at 20:21:15. |
| 20:21:28 | Card 3: "This is not the action you approved ("Next" on /what-a-fake-company/30min)", control "Schedule Event" on the booking form, filled with the name and the bot's address. The gate keeping an approval bound to one control on one page. The owner pressed Allow once at 20:22:40. |
| 20:22:40 | "Schedule Event" clicked. **No human check appeared.** Calendly: "You are scheduled! 30 Minute Interview, Monday, September 14, 2026, 9:00am–9:30am CET". |
| 20:22:51 | `remember`: "Booked on 2026-09-12: interview with Company A on Monday 2026-09-14, 9:00am-9:30am Central European Time, from the invitation received 2026-09-12; linked to the application I prepared on 2026-09-12 …". |
| 20:22:58 | End, outcome `done`, with a summary in the chat (task shape, what it found, what it did, the review point). |
| 20:24:59 | Idle pause. |

**Numbers:** 50 steps (16 screenshots, 14 clicks, 13 waits, 5 types, 1 zoom, 1 triple-click);
24 model calls; **$0.42**; 20 minutes from the mail to the end, 9 of them the takeover waiting for
the human. Gate cards: 3 (one unannounced on the login page, one announced booking, one mismatch on
the real button). Failed tools: 0. **Invariant 3 holds: a real event exists on the interviewer's
calendar, made by the bot after the user's approval.**

**What the platform got right, seen live for the first time:** the routine started from mail with
nobody typing (invariant 6 in its "unprompted" sense); the sign-in by takeover (invariant 5); the
approval card on a genuinely irreversible action with the sender warning (invariant 4); the
booking (invariant 3); the memory line that links the interview to the application. The time-zone
handling the day-one notes worried about was done by the bot on its own.

**What the model got wrong, and the skill wording that fixes each** (applied to
`examples/job-hunt-bot/skills/handle-replies.md` and the live bot after the run):

1. It pressed "Continue" on the login page instead of handing the whole sign-in over. The skill now
   says: a sign-in page of any kind means `request_takeover` at once, press nothing there.
2. It stopped and asked about the doubtful sender instead of proposing with the warning. The
   job-selection record designed this as a warning on the card, with the user deciding there; the
   skill now says so in one sentence. The bot's instinct was sound (a Gmail invitation naming a
   real company is a phishing pattern), and the video can say so; but the card is the review point.
3. It proposed at "Next" (the slot page) and was stopped at "Schedule Event" (the form). The skill
   now walks: slot, Next, fill the form, then `propose_action` with target "Schedule Event", then
   the click. One card at the real button.

**Not exercised this round:** the CAPTCHA hand-over (Calendly showed none from this sandbox; the
skill keeps the branch, worded "may follow"); a server restart mid-run (deliberately left out of
the first run of the act; it is a separate small check). The day-one residual "does the mailbox
session survive a day" gets its answer at the next run that opens the mailbox.

**Fixture notes for the video:** Gmail overrides the sender name with the account's own; the
address and the signature still mark the mail as mock. The Calendly slug "what-a-fake-company" is
what the bot called "an obvious placeholder"; whether to keep it is the owner's, and either way the
seam is narrated when it appears.

**Changed on 2026-09-13, before round 2:** The owner renamed the Calendly host to "Interviewer XY" and
moved the page to <https://calendly.com/interviewer-xy/30min>. Checked that morning: the public page
shows the new host, and the old slug returns 404. The invitation text now sits in the job-selection
record under "Decision: the seeded email is a fixture", with the new address. (An earlier version of
this paragraph also said Gmail's "Send mail as" name was set to "Interviewer XY"; the owner corrected
that the same evening: the setting was never changed.) Round 2 shows which name the mail and the
calendar invitation carry.

**The follow-up mail:** on day one Calendly's invitee confirmation reached the bot's inbox within a
minute; this time the inbox's unseen count had not risen by 20:29 UTC, six minutes after the
booking (checked with the platform's own watcher class), so no second run fired before the server
was stopped for the night. Either the mail is delayed or Seznam filed it outside the inbox; the owner
can look. A mail that arrives while the server is down starts nothing, by the documented limit.

**For the owner after this round:** cancel the test booking (Monday 14 September, 9:00 CET) from the
Calendly host account or its confirmation mail; the cancellation mail will start one more
mail-triggered run when the server is next up, which is expected and cheap.

### Persistence check — 2026-09-13: a restart mid-run, and a restart of a blocked bot

**What ran** (the live bot in `data/bots/job-hunt-bot`, sandbox `iyv3zjam4u5jxll14vzl9`,
`DAILY_BUDGET_USD=25`; four runs, $0.70 in total; nothing filmed, nothing submitted):

| Run | Goal | Steps / model calls / cost | What happened |
| --- | --- | --- | --- |
| 1 | Open example.com and example.org, tell me both titles | 1 / 4 / $0.04 | `done` in 16 s, too fast to restart under. The computer resumed from its 2026-09-12 pause ("sandbox connected"). |
| 2 | Open eight pages one after another with a screenshot on each | 4 / 9 / $0.06 | The server was killed at step 4 (09:39:13 UTC, no `end` event, bot `working`). At boot `recoverAtBoot` wrote `end` / `failed` / "the server restarted during this run", posted "The server restarted while I was working, so I stopped. Send the goal again to retry." and set the bot idle with the status "restarted". |
| 3 | Which pages are open in your browser right now? | 100 / 32 / $0.60 | "sandbox connected" with the same id; the stream showed the Wikipedia page that was open at the kill. The model read tab titles by hovering over each tab (mouse move, wait, screenshot, again and again) until the 100-step cap: `budget`, bot `blocked`, takeover card active. The server was restarted in that state. |
| 4 | Say hello and do nothing else | 0 / 1 / $0.003 | `done` on the same computer; "sandbox paused" two minutes after the run ended (09:47:35 UTC). |

**Persistence, seen live (invariant 6 holds).** After the mid-run restart the page showed the whole
chat with the closing message; the Skills tab listed `memory.md`, the three skills, both routines,
the rules and the two artifacts; md5 fingerprints of memory, skills, routines, rules and the
workspace were identical before and after; `bot.json` kept its sandbox id; and the next goal
reconnected to the same computer (never "creating the bot computer"), with Chrome still on the page
from the moment of the kill.

**What the page shows after a restart.** "the computer is not running" until the next goal, although
the computer stays up in E2B for up to 20 minutes and then pauses itself (`onTimeout: 'pause'`;
E2B listed it `running` after both kills). The platform does not reconnect at boot, only on demand.
A known limit, harmless.

**Defect found: a stale takeover card after a restart of a blocked bot.** Restarted while run 3's
card was active, with the held keep-alive and the 30-minute hold in memory. At boot the bot went idle
("restarted") but the card stayed `active` in `chat.jsonl`. The page then shows "Your turn on the
screen — active … Press Take over above the screen" next to a screen panel that says "the computer is
not running", and there is no Take over button (`canTakeOver` needs a stream URL). Run 4 did not end
it either: `Runner.run` ends the open card only when its in-memory map of held keep-alives has the
bot, and `handback` for an idle bot returns ok without touching the card. So the card stays active in
the chat until code ends it; it is in the live bot's chat now. Minimal fix: `recoverAtBoot` ends
every active takeover card when it sets a bot idle, with a reason such as "the server restarted; my
computer went to sleep" (the `readChat` + `updateChatCard` pattern of `Runner.endOpenTakeoverCard`),
with a test. A second option is an unconditional top-of-run cleanup in `Runner.run`. The boot fix
cleans this very card at the next start.

**A finding about goals, for the video.** "Which pages are open in your browser?" cost 100 steps
and $0.60 because the model inspected a crowded browser tab by tab. The step cap did its job and
asked for a takeover. A cheap demo goal names a URL; it never asks the bot to survey its own browser.

**Sandbox lifecycle across the kills.** Run 1 resumed the computer paused since 2026-09-12; both
kills left it running; run 4's release paused it through the platform's own two-minute grace.
Nothing was lost, and the bot is idle with its computer paused for the next rehearsal.

**Fixed the same day.** `d5242e6`: boot recovery ends every takeover card still active with the note
"The server restarted, so I am no longer waiting for you on my screen. Send me the next goal." and
marks every approval card still pending as `expired`, a new card status the page renders without
buttons and with a one-line note. The approval hole was found by reading the approvals route while
fixing the first: the registry that answers Allow lives in memory, so a pending card answered
"unknown approval" forever. Four recovery tests cover both, including a card that outlived an earlier
boot on an idle bot, cards already ended, denied or allowed, a card of another kind, message order,
and a second boot that finds nothing to end. `8d951ef`: the screen panel says "no live screen right
now; your next goal brings the computer back", and the README names the restart limit. The code and
test reviewers passed both with no blocking finding; preflight green at 277 tests. Live: the next
boot ended the demo bot's stale card ("cards left open by the previous process were ended at boot:
1") and the page shows "Takeover ended" with the note. Deferred from review, for the write-up: the
run log gets no event for a card the boot expired (the run's own `end` event already says the run
was cut short), and one unreadable bot folder would stop recovery for the other bots (the boot loop
had that shape before). Not changed on purpose: a computer the old process held is still paused by
E2B's own timeout rather than by an E2B call at boot (pennies of runtime against one more network
call before the server listens), and the vague-goal cost is the model's behaviour under the step
cap; a demo goal names a URL.

### Act two, round 2 — 2026-09-13: the round-1 skill fixes, the renamed sender, the daily budget

**Setup, checked before the server started** (nothing paid):

- Code: `main` at `5f646ab`, the same as origin. `pnpm preflight` is green at 277 tests. No `src/`
  change since `8d951ef`; `5f646ab` adds only `.agents/`, `.codex/` and `AGENTS.md`.
- Bot: the live `data/bots/job-hunt-bot`, sandbox `iyv3zjam4u5jxll14vzl9`, listed `paused` by E2B.
  Its skills, routines and approval rules are identical to `examples/job-hunt-bot` (`diff -r` is
  empty), so `handle-replies` carries the three round-1 fixes. The rules are `requireApproval: ["*"]`.
- Budget: `.env.local` does not set `DAILY_BUDGET_USD`, so the default of 25 in
  `src/server/config.ts` applies, and the boot's "server listening" line prints it. Spent today
  before the round: $0.70, the persistence check's four runs.
- Memory: line 12, round 1's booking note, was removed on the owner's word. The model reads the whole
  memory file (`src/server/agent/prompt.ts`), so that note would have tested round 1's history
  instead of the fixes: it says the user already confirmed the Gmail sender, and it records a
  booking for the same interview. The chat does not reach the model (same file), so the chat keeps
  round 1 and the four persistence-check goals. Lines 1–11 stay, including act one's hand-off line.
- Inbox: one unseen message at every boot today (watcher baseline 1). The watcher fires only on a
  rise, so the seeded invitation must arrive while the server is up.
- Invitation: the fixture text in the job-selection record ("The fixture as sent"), with
  <https://calendly.com/interviewer-xy/30min>, sent from the owner's development address.

The removed memory line, word for word:

```text
- 2026-09-12: Booked on 2026-09-12: interview with Company A on Monday 2026-09-14, 9:00am-9:30am Central European Time, from the invitation received 2026-09-12; linked to the application I prepared on 2026-09-12. Note: user confirmed this was a test invitation they arranged (sender was a Gmail address, Calendly link contained "what-a-fake-company"); no human-verification challenge appeared during booking.
```

**Progress, 2026-09-13 evening (the session was cleared mid-round; resume from the private backlog):**

The reliability plan (`docs/plans/2026-09-13-reliability-pass-plan.md`, shipped the same day) ran
its live checks first. Server through the launch entry; `DAILY_BUDGET_USD` at the default 25,
printed at boot; $0.70 spent today before the session.

| Time (UTC) | Run | What |
| --- | --- | --- |
| 17:23:33 | — | Boot: routines armed, mail watcher started; baseline at 17:24:33 (1 unseen); `data/mail-watermark.json` written with the next message number 25. |
| 17:25:34 | stuck, 7 steps, $0.04 | "Open https://example.com, then take three screenshots ten seconds apart": the stuck detector ended it on identical screenshots before Stop was pressed. A wrong goal for the check, not a defect; the owner took over and handed back. |
| 17:28:57 | done, 5 steps, $0.04 | Three pages with ten-second waits; Stop was not pressed inside the window; the run completed. |
| 17:35:44 | cancelled, 4 steps, $0.04 | Thirty-second waits. **Stop pressed in the page at 17:36:24 during a `wait`; the run ended `cancelled` at 17:36:29 when that call returned, nothing executed after the press; chat "Stopped at your request…"; bot idle, "stopped by you". Reliability criterion 1: PASS.** |
| 17:37:19 | done, 0 steps, $0.00 | "Say what you did in one sentence." named the stopped run, the three example pages and the thirty-second waits, none of which is in memory. **Criterion 7: PASS.** |
| ~17:41 | — | Server stopped; the owner sent the seeded invitation (new Calendly link) from the dev Gmail; server started at 17:45:28. |
| 17:46:29 | — | First poll: "mail arrived while the platform was down" (next number 27 against the stored 25); `mail-arrived` fired; `check-mail` started with nobody typing. **Criterion 2: PASS.** Two messages had arrived. |
| 17:46:29 | done, 35 steps, 27 calls, $0.41 | The mailbox session from round 1 still held after 22 hours (no sign-in takeover; the day-one residual is answered). The bot found two invitations with the same subject, today's and yesterday's round-1 mail, still in the inbox with the "what-a-fake-company" link; both from "Test Owner" at the dev Gmail address; memory says the application was never submitted. It reported all three as phishing signs and asked what to do, instead of proposing with the warning on the card: round-1 fix 2 did not hold against three signals, and the prompt's "questions through ask_user" rule was not followed either (a final text with a soft question). It booked nothing. |
| 17:54:09 | failed, 9 steps, $0.08 | The owner's reply: both are his test mails, act on today's, book the earliest free weekday slot, doubts on the card. The new chat window carried the report and the reply: the bot went straight to the interviewer-xy page, clicked a date, typed six characters, then a `triple_click` timed out on the sandbox (E2B `TimeoutError`, deadline exceeded after 15 s). The run closed honestly: "my computer stopped answering, so I stopped. Send the goal again to retry." |

Cost this evening: $0.61 over 6 runs, $1.31 for the day. The owner's hands: two Stop presses, one hand
back, one mail, one reply.

**Findings for the record:**

1. The sender name is still "Test Owner". (This finding first blamed Gmail's "Send mail as" name
   for not applying; the owner corrected that the same evening: the setting was never changed. The name
   is the dev Google account's own name; finding 8 in part two below has the calendar invitation.)
2. The inbox still holds round 1's invitation with the old "what-a-fake-company" link. Delete or
   archive it in the bot's mailbox before the next round: two invitations for one job plus a
   fake-looking link is the phishing pattern the bot rightly refuses.
3. A fourth skill fix for `handle-replies`, to write after the round as in round 1: several
   invitations for the same job means act on the newest; a doubtful sender is a line on the card,
   never a reason to stop.
4. The reliability plan's continuity window worked on the real job: the reply run knew which mail
   and which link without being told again.
5. An E2B command timeout mid-run (`triple_click`, 15 s) is a failure seen live for the first time;
   the run closed honestly. A README known-limits line if it repeats.

**Part two, the same evening (server started 18:03:18 UTC through the launch entry, budget 25 printed
at boot; the first poll set the baseline at 1 unseen and found no mail that had arrived while the
server was down):**

| Time (UTC) | Run | What |
| --- | --- | --- |
| 18:05:43 | done, 88 steps, 36 calls, $0.73 | Goal: "Continue: book the earliest free weekday slot on https://calendly.com/interviewer-xy/30min for today's invitation; put your doubts on the card". The computer resumed from its pause with the Calendly page still open. Steps 3–62 went into the time-zone picker: the skill says "set the page's time zone to Prague", the picker's search shows nothing for "Prague" or "Pra" (the list is grouped by zone name, not by city), and the bot cleared the box, retyped, scrolled the empty list, closed and reopened the picker — about 60 steps and $0.45. At step 64 it typed "Central Europe", the list showed "Central European Time", and the rest took 20 steps: Monday 14 September, 9:00–9:30, "Next", name "Test Owner", email bot@example.test, one stray click into the notes box, then `propose_action` at step 85 with target "Schedule Event", three consequences and three warnings (the personal Gmail sender, the never-submitted application, the user's own confirmation). **The owner pressed Allow once** at 18:11:50; the gate consumed the approval on the click at step 86 ("matches the approved action", rule `submit-control`); no human check appeared; Calendly answered "You are scheduled!"; `remember` wrote the booking line; end `done` at 18:12:04. |
| 18:12:22 | done, 9 steps, 8 calls, $0.07 | The calendar invitation reached the bot's inbox within a minute of the booking; the watcher saw unseen 2 against 1 and fired `check-mail` with nobody typing. The bot read the four mails in the inbox and reported "nothing new needs action". The computer paused itself at 18:14:52. |

The booking line the bot wrote, word for word:

```text
- 2026-09-13: Booked on 2026-09-13: interview with "Interviewer XY" (test invitation, sender owner@example.com, not a verified company domain) on Monday, September 14, 2026, 9:00am–9:30am Central European Time, via https://calendly.com/interviewer-xy/30min; from the invitation email received today; linked to the Company A Senior Node.js Developer (Company A) application prepared on 2026-09-12 (never actually submitted). User confirmed both invitations were their own test mails and approved booking this one.
```

**Which name the calendar invitation carries.** In the bot's inbox it is "Pozvánka: Test Owner and
Interviewer XY – po 14. zář 2026 9AM – 9:30…" from sender **"Test Owner"**. Google Calendar sends
the invitation on the host's behalf under the Google account's own name; the Calendly host name
"Interviewer XY" appears only in the event title (after the invitee's name from the form) and on the
confirmation page. So the rename of the Calendly host did not reach the one mail the camera would
see. The fix is the Google account's own name (the owner, before filming; the TODO item says so).

**The two page checks (reliability plan, criteria 5 and 8)**, done in the live page from Claude's
in-app browser while the bot was idle, the files fingerprinted before and after:

- Criterion 5: the `check-mail` routine saved with `skill: ghost` — the note reads "Error: there is
  no skill named ghost; save the skill first"; the file on disk is unchanged. **PASS.**
- Criterion 8: the local server answers a save in milliseconds, too fast for a hand, so the page's
  `fetch` was wrapped to delay every PUT by four seconds. Memory with "x" appended, Save, "y" appended
  during the request. During the request: the note shows the default text, Save is disabled (one
  request at a time). When the request came back with the draft changed meanwhile: the note does not
  say "saved", Save is enabled. Restored to the original: "saved", Save disabled; the file is
  byte-identical to before. **PASS.**

**Findings of part two:**

6. The time-zone picker cost 60 steps and $0.45. Round 1 got through it at the first try because the
   model happened to type the zone's name; round 2 typed the city. Skill fix 5 below.
7. The card's third "warning" ("the user has confirmed … so I am proceeding") is a note, not a
   warning. Cosmetic; the model's choice; left alone.
8. Finding 1 above is corrected: Gmail's "Send mail as" setting was never changed (the owner, this
   evening). The sender name on the seeded mails and on the calendar invitation is the dev Google
   account's own name; renaming that account reaches both, which "Send mail as" would not.

**Skill fixes applied after the round** (the fixture `examples/job-hunt-bot/skills/handle-replies.md`
and the live bot's copy, kept identical, as in round 1):

- Fix 4: several invitations for the same job mean act on the newest and name the older ones on the
  card; a personal address, a job never applied to and a strange link — even all three at once — are
  warnings on the card, and asking in chat first is wrong. This is the fix for the unprompted run at
  17:46, which is the filmed scene: the routine fires on the seeded mail with nobody typing, and the
  bot must propose, not ask. Round 2 only tested fix 2 after the owner's answer in chat, so fix 4 is
  still unverified; an unprompted act-two round (round 3) verifies it before filming.
- Fix 5: the time-zone line now says to search the picker for "Central European" ("Prague" finds
  nothing) and, if the list stays empty after one try, to keep the page's zone and name it on the
  card.

**Cost.** Round 2: 8 runs, $1.41 ($0.61 in part one, $0.80 in part two); the day: $2.13, all under
the $25 budget printed at boot. The owner's hands in part two: one goal typed, one Allow; no takeover,
no human check. Part one: two Stop presses, one hand back, one mail, one reply.

**Inbox tidied at 18:29 UTC, on the owner's word:** the two seeded invitations (message numbers 10 and
26, both already handled) were moved to the mailbox's Trash over IMAP by `data/mail-tidy.mts`
(git-ignored; it uses the platform's own mailbox settings, prints no secret, and moves only when
exactly two subjects match, only into the `\Trash` folder). A SUBJECT search for the non-ASCII word
returned nothing on this server, so the probe fetches every envelope and matches the subject itself.
The inbox now holds the Seznam welcome mail and the calendar invitation (number 28). Two details for
the next fixture: today's mail carried the literal prefix "Subject: " in its subject line (pasted
with the label), and Google wrote the zone as "(SELČ)", Czech for CEST, because the dev account's
language is Czech.

**For the owner after this round:** cancel the test booking (Monday 14 September, 9:00 CET; the
cancellation mail starts one more `check-mail` run, expected and cheap); rename the dev Google
account before filming.

### Act two, round 3 — 2026-09-15: unprompted, on the EU computer

**Setup, checked before the server started** (nothing paid):

- Code: `main` at `45b6c91`, the same as origin. `pnpm preflight` is green at 419 tests. The live
  bot's skills, routines and approval rules are identical to `examples/job-hunt-bot` (`diff -r` is
  empty), so `handle-replies` carries fixes 4 and 5. The rules are `requireApproval: ["*"]`.
- Bot: the live `data/bots/job-hunt-bot`, computer `i4wbt3opyimbukfb07snp` on the EU cluster,
  listed `paused` by E2B. Its mailbox was signed in by takeover on 2026-09-14 and opened with no
  sign-in on the run at 21:50 UTC that evening.
- Budget: `.env.local` does not set `DAILY_BUDGET_USD`, so the default of 25 applies. Spent today
  on the demo bot before the round: $0.00 (the evidence bot's $0.57 lived in a worktree's own data
  folder, deleted).
- Inbox: 4 messages, 1 unseen, next message number 33, the same as `data/mail-watermark.json`. So a
  boot sets a baseline and starts no run; the seeded invitation fires on the next rise. The unseen
  message is the cancellation mail of the 30 September throwaway booking: the `check-mail` run it
  started at 22:13 UTC on 2026-09-14 (`2e18afd8`) was cut at step 6 when the server was stopped, and
  the watermark had already moved (the fix that holds it back until the run ends, `29fa76b`, landed
  the next day), so that mail is not delivered again. Expected and harmless.
- Memory: 13 lines. Lines 12 and 13 are the two cancelled test bookings (round 2's on 2026-09-13,
  the takeover booking of 2026-09-14). The owner's decision whether they stay, pending at the time of
  writing: the model reads the whole memory file, so with them the run tests a bot that already knows
  two test bookings from this sender; without them it tests the filmed state.
- Scheduler at boot: `morning-search` had a planned run at 05:00 UTC today that nobody served (the
  server was down); 14 hours late is past the 12-hour limit, so it was skipped and logged, next run
  2026-09-16 05:00 UTC. `check-mail` armed on `mail-arrived`.
- Invitation: the fixture text in the job-selection record ("The fixture as sent"), sent from
  the owner's development address, without the literal "Subject: " label in the subject line.

**Boot, 19:20:50 UTC** (Claude's shell, `env -u PORT pnpm dev`, not the launch entry; the log in the
session's scratchpad): recovery closed run `2e18afd8` as `failed` with the restart line in chat and
put the bot to idle, "restarted"; the missed morning run was skipped; the boot line printed the EU
cluster (`e2bDomain: e2b-juliett.dev`), the model and the budget of 25. First mail reading at
19:21:51 UTC: baseline set at 1 unseen, no run started, as computed above.

**Decision and stop, 2026-09-15 evening.** The owner's word: "remove both and stop for tonight". The
two booking lines were removed from the live bot's memory at about 19:26 UTC; the memory now has 11
lines and ends with act one's hand-off line, the state the filmed bot will have. The server was
stopped at about 19:25 UTC after five idle minutes: no mail arrived and no run started while it was up, so
the round has cost $0.00 so far. The removed lines, word for word:

```text
- 2026-09-13: Booked on 2026-09-13: interview with "Interviewer XY" (test invitation, sender owner@example.com, not a verified company domain) on Monday, September 14, 2026, 9:00am–9:30am Central European Time, via https://calendly.com/interviewer-xy/30min; from the invitation email received today; linked to the Company A Senior Node.js Developer (Company A) application prepared on 2026-09-12 (never actually submitted). User confirmed both invitations were their own test mails and approved booking this one.
- 2026-09-14: 2026-09-14: A second test booking was made (by the user, during a takeover) via https://calendly.com/interviewer-xy/30min: "30 Minute Interview" with "Interviewer XY" on Wednesday, September 30, 2026, 11:00am-11:30am Central European Time. Confirmation page showed "You are scheduled!" This is separate from the earlier Sept 14, 9:00-9:30am booking. Both are test bookings tied to the same sender (owner@example.com, not a verified company domain) and not linked to a real submitted application.
```

**The round itself, next session** (the bot idle, the server down, memory at 11 lines):

1. The owner, optional: rename the dev Google account, so the seeded mail and the calendar invitation
   carry the neutral name.
2. Claude starts the server through `env -u PORT pnpm dev` and waits for the boot and the baseline
   reading (the boot starts no run while the inbox's next number equals the watermark).
3. The owner sends the fixture mail from the dev address, subject without the "Subject: " label, with
   <https://calendly.com/interviewer-xy/30min>. The watcher sees the rise at the next poll (60 s)
   and `check-mail` starts with nobody typing: the filmed path. (Sending while the server is down
   also works: the boot delivers it, seen in round 2 part one.)
4. The owner at <http://localhost:5173>: press Allow once on the "Schedule Event" card; take over only
   if the mailbox asks to sign in or a human check appears.
5. Claude records the run (steps, calls, cost) and the criteria: no sign-in takeover; Central
   European Time shown before any click and the picker reached at the first try if needed; the
   "Can't update Chrome" bubble absent or clear of the page; the card's doubts as warnings and no
   question in chat; the calendar invitation starting one more `check-mail` run by itself.
6. The owner cancels the booking as the host; the cancellation mail starts one more run, expected.

**Act two, round 3 — 2026-09-16, the EU computer, unprompted. PASS.**

Setup: the dev Google account was renamed to "Interviewer XY" before the round, so the seeded mail
and the calendar invitation carry the neutral name (proof: a test mail at 16:25 Prague arrived as
`Interviewer XY <owner@example.com>`). The bot started idle with 11 memory lines on the EU
sandbox `i4wbt3opyimbukfb07snp`.

Not in the runbook, found at boot: **a daily routine missed while the server is down runs at the
next boot.** `morning-search` is planned for 05:00 UTC and the server had been down since the night
before, so act one started at 14:33:02, six steps in, and stopped on the job board's cookie banner
("Přijmout", rule `verb-name`, blocked because it was unannounced). The owner chose to stop it to keep
the round clean: `POST /api/bots/job-hunt-bot/stop` at 14:34:23, outcome `cancelled`, the pending
approval went to `denied`, $0.055 for 9 steps, memory untouched. The filming-day procedure now
carries this: start the server before 07:00 Prague, or expect act one first.

| Time (UTC) | Event |
| --- | --- |
| 14:34:03 | mail watcher baseline set, `unseen: 1` |
| 14:39:05 | the fixture mail arrived and the watcher fired `check-mail` on the rise — **nobody typed**, the filmed path |
| 14:39:12 | `open_url` to the mailbox; it opened on the saved session, **no sign-in takeover**, three days after the one-time browser restart of 2026-09-13 |
| 14:39:41 | `open_url` to <https://calendly.com/interviewer-xy/30min> |
| 14:40:15 | `propose_action` at step 22 — kind `book`, target "Schedule Event", two consequences, **three warnings**, no question in chat (skill fix 4 holds) |
| 14:41:27 | The owner pressed Allow once |
| 14:41:29 | gate step 23: `consume`, rule `submit-control`, `announced: true`, "matches the approved action" — **the first live run of the 2026-09-15 safety fixes** (the control re-read after Allow, the approval scoped to origin and path) |
| 14:41:34 | Calendly asked for a reCAPTCHA; the bot went `blocked` and asked for a takeover instead of trying to pass it (invariant 5) |
| ~14:42–14:44 | The owner took the screen, ticked "I'm not a robot" and pressed Continue |
| 14:44:03 | hand back accepted, the loop resumed |
| 14:44:16 | end `done` — "You are scheduled!", Thu 2026-09-17 09:30–10:00 CET, invitation to `bot@example.test`; memory line 12 written |

**26 steps, 21 model calls, $0.27.** Round 2 needed 88 steps and $0.73 for the same booking.

Criteria from the fixes plan, all met: no sign-in takeover; **"Central European Time" was shown
before any click and the time-zone picker was never opened** (skill fix 5 — round 2 spent about 60
steps and $0.45 in that picker); the Chrome update notice sat in the toolbar as "New Chrome
available", clear of the booking form; the card's doubts were warnings; the model's own summary
named the takeover and the confirmation.

**New finding — the hand-back guard and the reCAPTCHA frame.** After the check was solved, hand back
was refused with `UNREADABLE_REASON`: the focus still sat inside the reCAPTCHA iframe, which the
companion cannot read, so it could not prove no secret was on screen. This is the secret check, and
"Hand back anyway" does not lift it (`src/server/agent/takeover.ts`, `check()`). The way out is the
one the message gives: finish the step and click outside the frame. It cost about a minute of
confusion at the screen. It is correct behaviour, but the human must know it in advance, so it goes
into the filming-day procedure rather than into a code change.

**The follow-up run — the criterion passed, and it exposed a defect.**

The calendar invitation reached the mailbox and started a second `check-mail` by itself at 14:45:16,
which is the last criterion of the round. What it then did is the finding: it read **its own booking
confirmation as a new invitation**, went back to Calendly, picked Thursday 17 September 10:00–10:30
— half an hour after the slot it had just booked — filled the form and proposed it. The owner pressed
Deny at 14:50:32; the run ended `done` at 14:50:42 with no retry and a memory line recording the
denial. 39 steps, $0.558. Round 2's equivalent run was 9 steps and $0.07; the inbox now holds
several old test mails, which is part of the difference.

The card's own fourth warning names the problem better than any summary could:

> Recommend confirming with the user whether this is meant to replace the earlier Sept 17 09:30
> booking or is a duplicate/test before proceeding, but per the skill's doubt rule I am still
> presenting this slot for your decision.

Two defects sit behind that sentence.

1. **A booking confirmation looks like an invitation.** Google Calendar sends it with "Pozvánka"
   in the subject and a Calendly link in the body, and the skill has no rule that a confirmation of
   a booking already in memory needs no action. Memory line 12 held that booking, and the model
   read it — its warnings quote the 09:30 slot — but nothing told it that a match means stop.
2. **The doubt rule has no "no action needed" exit.** Skill fix 4 (2026-09-13) said doubts are
   warnings on the card and never a question in chat. It was written to stop the bot asking instead
   of acting. Here the bot suspected a duplicate, said so, and proposed anyway, because the rule
   left it no third option. The rule needs the case where the right answer is to do nothing and
   report it.

On the filmed path this appears about a minute after the successful booking, as a second card
proposing a duplicate slot. It must be fixed before the video.

**Round 3 cost: $0.88 over three runs** — act one stopped ($0.055, 9 steps), the booking ($0.27,
26 steps), the follow-up ($0.558, 39 steps). Memory went from 11 lines to 13.

### Act two, round 4 — 2026-09-16 evening: the duplicate-invitation fix in place, and Calendly's spam filter

Setup: Tasks 1–3 of `docs/plans/2026-09-16-duplicate-invitation-plan.md` committed (`3e3eeab`, `cfd025a`,
`156ed55`, the review corrections `a59f6bd` and `4c7a856`), the live bot's skill identical to the
fixture, preflight green at 419 tests. Memory at 13 lines: line 12 is round 3's booking note without
a subject or a received time (the uncertain-match case, on purpose), line 13 the denied duplicate.
The owner emptied the inbox of the old test mails. The server started at 19:28:13 UTC through the launch
entry; the missed morning search did not fire at boot this time, because it had already run and
been stopped at 14:33 the same day.

| Time (UTC) | Event |
| --- | --- |
| 19:29:13 | first reading: next-message number 43 against the watermark 37 (the six deleted mails) and one unseen message, a Seznam welcome mail; `check-mail` fired by itself. Stopped at 19:29:55 to keep the round clean: `cancelled`, 11 steps, $0.098, memory untouched. The watermark moved to 43 although the run was cancelled: a stop by the user counts as ended |
| 19:32:02 | the welcome mail deleted, the fixture mail arrived inside the five-minute debounce: "it fires once the debounce is over" |
| 19:32:05 | the computer paused, two minutes after the cancelled run |
| 19:35:04 | `check-mail` fired on the fixture mail; the computer resumed within a second |
| 19:35:09–22 | `open_url` to the mailbox; the tab was still loading — blank page, spinner — at 3.5, 8.5 and 13 seconds after the open, and the stuck detector ended the run `stuck` after 5 steps, $0.059 (**finding A**). The bot went `blocked` with its computer held awake |
| 19:41 | The owner deleted the read fixture mail and sent it again (received 21:41 Prague); nobody took over |
| 19:42:25 | `check-mail` fired; the run started on the blocked bot after the screen-safety check, with no resume delay |
| 19:42:28 | the mailbox opened and the invitation was read; 19:43:13 `open_url` to <https://calendly.com/interviewer-xy/30min>; "Central European Time" shown before any click |
| 19:43:55 | `propose_action` at step 26 — kind `book`, target "Schedule Event", summary "Book Thursday 2026-09-17 10:00–10:30 CET for the interview with "Interviewer XY" (Company A-related), from the invitation email received today 2026-09-16 21:41"; **four warnings** (the personal sender; this slot denied earlier; the existing booking Thu 09:30–10:00; the application never submitted); **no question in chat**. The run's own summary: "this mail (received today 21:41) didn't match any "Booked on" line, so it counted as new/open work" — **criterion 2 of the fix plan met** |
| 19:59:19 | Allow once; 19:59:22 the click consumed (`submit-control`, "matches the approved action") — but the page did not move: the browser's address suggestion under the email field was still open in the next screenshot and most likely took the click (**finding B**) |
| 19:59:34 | the second click blocked as unannounced, a gate card; allowed at 19:59:54; consumed at 20:00:09 "allowed once by the user" |
| 20:00:12 | Calendly: **"This booking cannot be completed. For security reasons, we are not able to finalize this booking from your current session."**, code `tid-rb-0341db42-…`. No booking. The bot wrote memory line 14 itself ("No booking was actually created. Only the earlier Sept 17 09:30-10:00 booking … remains valid.") and ended `done` at 20:00:29; 34 steps, 17 model calls, $0.365 |
| 20:04:41 | The owner's goal to open the scheduling page (3 steps, $0.046), then a takeover with the stale tabs closed: a booking by hand with the owner's own name and email got the same refusal (`tid-rb-751b3299-…`), and so did one from an incognito window. The block is on the computer's address, not on the session and not on the bot's clicks (**finding C**) |
| 20:06:56 | the idle pause fired under the owner's hands, two minutes after the goal run ended: "The sandbox was not found" on the hand-back check at 20:06:58, "sandbox paused" at 20:07:00, the takeover stream dropped (**finding D**) |

**Round 4 so far: $0.568 over four runs; memory 13 to 14 lines; no booking.** Criterion 2 of the
fix plan (the resent invitation reaches a card with the earlier booking as a warning, nothing asked
in chat, the summary names the received time) PASS. Criterion 3 — the confirmation run, the belief
criterion of the TODO item — not reached, because no booking happened. Steps B and C not run.

**Finding A — the stuck detector cannot tell a slow page load from a loop.** `src/server/agent/stuck.ts`
ends a run after three screenshots that differ by less than its threshold with only waits between
them; the model waited two seconds between screenshots, so a page that takes more than about ten
seconds to paint looks like a loop. It happened on a computer resumed seconds earlier (paused at
19:32:05, resumed at 19:35:04); round 3's mailbox opened on a computer that had been awake for six
minutes. Filming-day rule until it is fixed: keep the computer awake before the mail arrives (a small
goal shortly before). The fix candidates: count only screenshots at least some seconds apart, or ask
the companion whether the page is still loading before counting a screenshot.
**Fixed 2026-09-17 in `ed727f6`:** the unchanged run must also span 30 seconds from its first
screenshot to its last (`MIN_SPAN_MS`); the spec's amendment of 2026-09-17 records the trade-off.
Not yet seen live.

**Finding B — an approved click can be swallowed by the browser's autofill popup.** After the bot
typed its address, Chrome's suggestion popup stayed open under the field; the approved click on
"Schedule Event" closed the popup instead of pressing the button, and the gate then stopped the
second click as unannounced — the gate doing its job, at the price of two Allows for one booking
(round 1 needed two for another reason). The skill can say to press Escape after typing the address;
a platform fix is not needed. **Done:** the sentence is in the Cal.com skill since `6f6ae14` (2026-09-16).

**Finding C — Calendly's spam filter blocks bookings from the computer's address.** Refused for the
bot, for a human on the same computer, and in an incognito window with fresh cookies. Calendly's
community manager describes the same class of error as their spam filter locking an address after
about ten bookings, with "contact support" as the remedy
(<https://community.calendly.com/how-do-i-40/locked-out-after-10-appointments-created-from-one-ip-address-4530>).
The computer's outgoing address is a datacenter address, probably shared with other E2B sandboxes;
this event type has taken several bookings and cancellations from it this week; round 3's reCAPTCHA
five hours earlier was the softer form of the same suspicion. The job-selection spec already states
the rule for this case: "If a real booking surface cannot be made to work, cut act two entirely
rather than shipping the email-only version" — a decision for the owner, with the options in the private backlog.
Every further attempt from the same address probably feeds the filter, so none was made after 20:07.

**Finding D — a takeover on an idle bot does not hold the computer awake.** The keep-alive is held
for the whole run, takeovers included, and after a run that ended blocked (`src/server/agent/runner.ts`);
after a run that ended `done`, a takeover started from the page has nothing holding the computer,
and the two-minute idle pause fires under the human's hands. Fix: hold the keep-alive while a
takeover is active on an idle bot, and release it on hand back.
**Fixed 2026-09-17 in `ed727f6`:** the interactive stream request on an idle bot brings the computer
up through the manager for a `takeover` holder and keeps it awake until Hand back, or a minute after
the page stops asking; a goal that arrives meanwhile passes the hand-back check first. The review
found and closed a race with a pause already in flight, and a second pass made the route hand out no
stream when the hold did not come up (`a0dc98c`). Not yet seen live.

**Finding E — tabs pile up.** Every run opens the mailbox and the scheduling page in new tabs and
closes none; the round started with eleven old tabs in the bot's browser. Harmless so far, but a
slower browser on a resumed computer is exactly what finding A punishes. The owner closed them by hand
during the takeover.

### The unattended morning run — 2026-09-17: the consent dialog on the EU computer

The server had stayed up overnight, so `morning-search` fired at 07:00 Prague with nobody at the
page. On the EU computer the job board opened with a cookie consent dialog in the middle of the page
("Souhlas se soubory cookies", buttons "Přizpůsobit" and "Přijmout"), not the bottom notice the
skills describe for the US address. The bot clicked "Přijmout" at 07:30; "přijmout" is on the
gate's Czech verb list, so the click was stopped as unannounced and a card waited. The card timed
out as denied after thirty minutes, the bot clicked again, and again; after the third denial, at
08:31, it asked in chat whether the user still had the screen ("my clicks on the job board tab are
being refused"), reading the denials as a takeover, with the old Calendly tab still open beside it.
Cost $0.32 over ninety minutes, 18 steps, nothing searched.

What it says: the gate did its job (accepting a consent is on the hard-stop list, and the model had
not announced it); the skill's "scroll past the notice" rule does not fit the EU page; a denied
click needs a better next move than the same click. For filming: accept the dialog once by hand
during a takeover, the profile keeps the consent. For the write-up: a bot's computer in another
region meets other pages, and a rule written for one page is a rule.

### Act two, round 4 continued — 2026-09-17: the Cal.com warm-up from the bot's screen

Setup: the round 4 fixes merged into `main` at `84eb148` at 08:38 Prague and the dev server
restarted on the change; Hunter idle after the stopped morning run. Times are UTC.

| Time | Event |
| --- | --- |
| 06:50:15 | The owner's goal "Ask me to take over now…"; the takeover card 5 s later, the bot `blocked`. The page showed neither: its event stream had not come back after the server restart, and the goal was sent a second time at 06:50:38, which queued a copy. A reload showed the card and switched the preview to the interactive stream by itself |
| 06:53 | On the bot's screen by hand: "Přijmout" on the job board's consent dialog (the profile keeps the consent) |
| 06:56 | A booking by hand on <https://cal.com/interviewer-xy/30min> with a neutral guest name and the owner's personal address: "This meeting is scheduled", Thursday 24 September 2026 11:00–11:30 CEST, host Interviewer XY, Cal Video. **No human check.** Cal.com accepts a booking from the bot's computer's address, where Calendly refused one the evening before |
| 06:58:32 | The old tabs closed, Hand back accepted; the run ended `done`, 12 events, $0.076. The queued copy started at once and posted a second takeover card; stopped through the API at 07:0x, `cancelled` |

The warm-up used the owner's own address on purpose: a confirmation to the bot's mailbox would have
started its mail check, and the reply skill treats a booking memory does not know as open work.
Round 4 continues at Step A with the fixture mail carrying the Cal.com link. Found: the page needs a
reload after a server restart before it shows new lines; noted for the README's known limits.

### Act two, round 4, Step A and its confirmation run — 2026-09-17 morning: the booking on Cal.com, and no second card

Setup: `main` at `e7ba8b7` (the round 4 fixes, the Cal.com fixture text), the server up since
08:38 Prague, Hunter idle after the warm-up, memory at 14 lines (line 12 round 3's booking note
without a subject or a received time, the uncertain-match case on purpose; 13 the denied
duplicate; 14 "no booking was actually created"). The owner sent the fixture mail with the Cal.com
link from the dev Gmail at 09:05 Prague. Times are UTC.

| Time | Event |
| --- | --- |
| 07:05:39 | `check-mail` fired by itself, 26 s after the mail was sent; the computer was still awake from the warm-up, so the slow-page fix (finding A) was not exercised |
| 07:05:46 | the mailbox opened with no sign-in; the invitation read |
| 07:09:00 | `open_url` to <https://cal.com/interviewer-xy/30min>; the first slot that fit picked; the form filled; **Escape pressed after the address** (finding B's sentence, followed) |
| 07:09:24 | `propose_action` at step 28, kind `book`, target "Confirm": "Book Thu Sept 17, 2026, 11:30am–12:00pm … from the invitation received today (Thu 17 Sep, 09:05) — a new cal.com scheduling link, distinct from the earlier Calendly links"; two consequences (a calendar invitation to the bot's address; Cal.com's terms accepted); **five warnings**: the personal sender, the existing booking today 09:30 from 2026-09-16, yesterday's denied and then failed attempt, the application never submitted, the overlap with the existing booking. **No question in chat.** $0.425 to the card |
| 07:10:05 | Allow once (the owner; the page had to be reloaded first to show the card) |
| 07:10:07 | the click at step 29 consumed the approval: `submit-control`, "matches the approved action" (the control read again after Allow, the 2026-09-15 fix); **no human check**; "This meeting is scheduled", Thursday 17 September 2026 11:30–12:00 CEST, guest Test Owner, bot@example.test |
| 07:10:15 | `remember`: "Booked on 2026-09-17: interview with "Interviewer XY" on Thu 2026-09-17 11:30-12:00 CEST (Cal.com booking, confirmed successfully), from the invitation received 2026-09-17 09:05 with subject about a 30 min meeting (cal.com link …); linked to the Company A … application prepared on 2026-09-12" — the received time exact, the subject paraphrased rather than quoted |
| 07:10:18–07:10:41 | back to the mailbox; yesterday's old invitation read again and named as already handled; the run ended `done`, 39 steps, $0.559, with a long closing message under markdown headings |
| 07:10 | Cal.com's confirmation ("30 min meeting between Interviewer XY and Test Owner") reached the bot's inbox |
| 07:11:42 | the debounced `check-mail` run; `open_url` to the mailbox only; ended `done` at 07:12:07 after 4 steps, $0.055: "this is the confirmation of that booking, not a new invitation, and I did not open any links in it or take further action … Nothing new needs action". **Zero approval events, no new memory line** (15 lines before and after) |

**Criteria of `docs/plans/2026-09-16-duplicate-invitation-plan.md`:** 2 PASS (the card carries the
sender warning and the earlier booking, the summary names the received time, nothing asked in chat,
one `approvalId` with one `pending` and one `allowed`, the memory line names the received time; the
subject is paraphrased, not quoted), 3 PASS — the belief criterion of the TODO item. Steps B (a
typed request for one more slot) and C (five mails in one run) were not run. Cost of the day's
round so far: $0.695 over these two runs, plus the warm-up run $0.076 and the stopped duplicate
goal $0.005.

**Seen and noted.** The page did not show the takeover card, the approval card or the new chat lines
until it was reloaded: its event stream had not come back after the server restart at 08:38 (the
README's known limits carry it since `e7ba8b7`). The bot read the sender of the 09:05 mail as the owner's full name, the name the bot's mailbox shows for the dev address, although the dev Google account was
renamed to "Interviewer XY" on 2026-09-16; the mailbox's own address book may be the source, to be
checked before filming. Two test bookings stand on the Cal.com page, today 11:30 (the bot's) and 24
September 11:00 (the warm-up); the owner cancels them as host, which sends cancellation mails to the
bot's inbox for the first one, a live case of the cancellation path.

**The cancellation, 09:18–09:19 Prague.** The owner cancelled the bot's booking as host; Cal.com's
cancellation mail reached the bot's inbox at 09:18 and `check-mail` fired at 09:19:10: `open_url`
to the mailbox, `remember` ("Cancelled on 2026-09-17: the booking on Thu 2026-09-17 11:30-12:00
CEST … cancellation email received 2026-09-17 09:18, reason given "no time""), and the run ended
`done` in 5 steps, $0.086, with one sentence: "This is a cancellation of an existing booking, not
a new invitation, so per the skill I record the change and take no new booking action on my own."
No card. The cancellation half of the duplicate plan's criterion 5, seen live. The warm-up booking
of 24 September was cancelled too; its guest was the owner's own address, so the bot saw nothing.

**Memory pruned, 09:3x Prague, on the owner's word** ("removing the rehearsal debris"): lines 12–16,
the rehearsal bookings of rounds 3 and 4 (the 16 September booking, the denied duplicate, the
failed attempt, today's booking and its cancellation), removed through the memory API, the Skills
tab's path; 11 lines remain, the interview answers, the form details and the act-one hand-off of
2026-09-12 that the fixture invitation links to. Their content stays in these notes. The filmed
mail run therefore meets the fixture as a first invitation: fewer warnings, less to compare, a
shorter run.

**Where the five minutes of the booking run went** (the owner's question): 246 s of 303 in 33 model
calls, 40 s waiting for Allow, 11 s of computer actions. The median call takes 3 s; the two
longest took 44 s and 39 s and produced about 3,500 tokens each, the model reasoning in text
about memory and the rules before it acted; three zooms to read the mail's small text took about
20 s each. The mailbox phase took 201 s, the Cal.com phase 25 s, the closing message 37 s.

### Act two, round 4, Step A re-run under the length rule — 2026-09-17, 09:28–09:45 Prague

Setup: `main` at `59eef95` (the length rule, the reply skill a third shorter, pushed to the live
bot through the Skills API and identical to the example), memory at 11 lines, Hunter idle, the
fixture mail resent at 09:28. Times are UTC.

| Time | Event |
| --- | --- |
| 07:28:58 | `check-mail` fired by itself; the mailbox opened; the invitation read |
| 07:30:40 | `propose_action` at step 40: "Book Thursday Sept 17 2026 11:30–12:00 … from the invitation received today at 09:28", target "Confirm", **four warnings** (the personal sender, now read as "Interviewer XY"; the same slot booked and cancelled earlier today; the 09:30 booking of 2026-09-16; the overlap), from the recent chat lines, since memory held no booking. **102 seconds from the mail to the card**, 22 model calls, $0.34, no question in chat; Escape pressed after the address |
| 07:32:07 | Allow once; the click consumed at step 41 ("matches the approved action"); **Cal.com refused the 11:30 slot**, most likely its two-hour minimum notice, the slot being 1 h 58 min away |
| 07:33:26 | the bot picked 12:00–12:30, filled the form again and proposed again at step 99, a new proposal and not a retry of a denied one; Allow at 07:33:45; the click consumed at step 100 |
| 07:33:50 | **the run ended by the step cap**, 102 steps, 39 calls, $0.80, 291 s, with a takeover card; the bot never saw the confirmation page and wrote no memory line. Cal.com's mail at 09:33 Prague proves the booking: "Your event has been scheduled, 12:00–12:30" |
| 07:34:50 | the confirmation mail's run started after the debounce and took the screen back after the safety check (the card ended by itself). With no "Booked on" line to match, the bot **opened mails and went back to the inbox for 100 steps**, 52 clicks, 41 screenshots, 72 calls, $1.68, no message; ended by the cap at 07:45:39. The stuck detector saw nothing: clicks reset it |
| later | the dev server went down with the app session; at the next start boot recovery closes the card |

**Findings.** G: the cap can end a run right after an approved click, and the bot's own record of
what it did is lost; fixed in `ab5c093` (150 steps, the steps-left notice, the budget card
names the action). H: a click loop is invisible to the stuck detector; ended by the cap; a known
limit. The length rule halved the time to the card and kept the card correct; its cost is that
a confused run leaves no narration, hence the clause added in the same commit. The retry after a
refused slot is right but expensive; the skill could say to pick the next slot at once. Cost of the
re-run: $2.48 over two runs. Steps A to C are run again after the fix.

### Act two, round 4 after the fixes — 2026-09-17, 11:29–11:53 Prague: Step A believed again, Step C looped twice

Setup: `main` at `f512f0c` (the cap at 150, the steps-left notice, the budget card's sentence),
the server restarted at 11:29 through the launch entry, the bot's inbox emptied by the owner, memory
at 11 lines. Times are UTC.

| Time | Event |
| --- | --- |
| 09:30:01 | the fixture mail, sent while the platform was down, fired `check-mail` at boot's first reading ("mail arrived while the platform was down", 59 → 69) |
| 09:32:34 | the card at step 80, 154 s after the start: "Book Thu Sept 17, 2026, 2:00pm–2:30pm CEST … from the invitation received today at 11:30 (subject …)"; Allow two seconds later; the click consumed at step 81; **the page seen and the memory line written at step 83**, with the subject quoted and the received time; ended `done`, 83 steps, 28 calls, $0.59, 169 s, no human check. The closing message still flagged a "standing 09:30 booking" that no longer exists, from the old cards in the recent chat lines |
| 09:35:51 | the confirmation run, after the debounce: 7 steps, 7 calls, $0.07, 32 s, `open_url` only, no memory line, one sentence: both new messages accounted for, the invitation booked from and its confirmation. **Criterion 3 PASS again** |
| 09:39–09:41 | Step C staged: the 14:00 booking cancelled as host, the fixture and the confirmation marked unread, the fixture sent once more; the older "Canceled 12:00" mail unread too; all held by the debounce and delivered in one run at 09:41:25 |
| 09:41:25–09:50 | **a reading loop**: the bot opened each of the five mails, zoomed, went back to the inbox and started over, seven times; no memory line, no card, no message; stopped through the API at 104 steps, 56 calls, $1.58 |
| 09:49:33 | another mail fired the routine; the same loop; stopped at 46 steps, 41 calls, $0.71 |

**Finding I.** The length rule's cap "at most a sentence or two between actions" broke batches:
the two-mail run sorted fine, the five-mail runs never wrote the sorting pass a batch needs and read
the mails again and again, the click loop of finding H. The rule now asks for exactly one written
sorting pass before acting on several things, keeps the short ending, and still says to speak up
when unsure. Believed only after Step C runs to a card. Cost of these loops: $2.29; of the day so
far about $9.

**Step C, tries three and four, and Step B — 12:00–12:21 Prague.** With the length rule corrected
(`bafdbce`, one written sorting pass) the batch looped again (77 steps, $1.30, stopped); with the
rule cut back to the ending only (`4845dc5`) and a notes rule added (`605593d`: old screenshots
leave the context, write the facts down, never open the same mail twice) it looped once more
(82 steps, $1.24, stopped; twenty returns to the inbox over eight rows). Four loops on the batch,
under three versions of the rule, all with the shorter skill. What the inbox held by then: three
copies of the fixture with different received times, two cancellations, two confirmations of
cancelled bookings, one more mail: harder and more ambiguous than the five mails the plan designed,
because every resend added a copy. **Step B, 12:19:** a typed request for one more slot after
14:00 on a memory that held the 14:00 booking: the bot read the mailbox first, recorded the two
cancellations in one memory line in six steps, opened Cal.com, picked 14:30–15:00, filled the form
and proposed it with the cancelled bookings as warnings; denied through the API; a memory line and
a short closing message; 33 steps, 25 calls, $0.30, 103 s. **Criterion 4 PASS.** The clue: the
same inbox the routine runs looped on was handled at once under a specific goal. So the loops are
tied to the routine's open goal on an ambiguous batch, not to the rule alone; whether the shorter
skill matters is untested, because the batch was never clean. Cost of the day's runs: $9.36.
Memory at 14 lines (the 14:00 booking, the cancellations, the denial).

### Correction, 2026-09-17 afternoon — the owner's review of the loop logs

The owner read the four loop logs, the Step B log, the screenshots and the code. The diagnoses written
above during the day do not stand, and the sentences that name a cause are withdrawn: "the cause is
the length rule", "the loops turn out to stem from the duplicates", "the loops are tied to the
routine's open goal on an ambiguous batch". What the evidence supports:

- The first loop (11:41) already had the plan's five mails: two invitations, two cancellations, one
  confirmation (`docs/evidence/2026-09-17-loops/d4e20693-first-inbox.png`). The later resends added
  copies, but they cannot explain the first failure.
- The bot was looping, not waiting on a broken tool: no tool failed before the stop, none of the four
  runs called `remember` or `propose_action`, and the last one clicked the return-to-inbox control
  twenty times (`docs/evidence/2026-09-17-loops/7b72be72-events.jsonl`).
- The stuck detector could not see it: it resets on every action other than a screenshot or a wait
  (`src/server/agent/stuck.ts`), and opening a mail is an action. A confirmed limitation of the code.
- Step B did not prove the batch problem solved: it opened three mail rows, recorded the cancellations
  at step 6 and moved to the booking, a narrower task, without showing that every invitation was
  accounted for.
- The model's intermediate text was not logged, so the record cannot say whether the bot forgot the
  mails' contents once their screenshots left its context, never took notes, or kept reconsidering.

Open, as hypotheses and not causes: the shorter reply skill; the routine's instruction against a
typed goal; screenshot retention; the cancellation handling; the duplicates. Too many of them
changed between attempts, and the owner's hands were asked for before the previous failure was
understood; that was the fault of the investigation, not of the product.

Done on it (`4da2796`): the loop logs and screenshots preserved under `docs/evidence/2026-09-17-loops/`
with an index and the measurement script; a progress guard that counts the observed cycle, a stretch
of steps with nothing new (no click at a new place, no new text, no new page) and no platform tool
call, measured over every run on disk (below), with a notice to the model at 16 and 28 and the end
of the run at 40; the model's emitted text in the run log, which is its text, actions and results,
not its private reasoning. The retained-facts mechanism, a run's own notes that stay in the context
after the screenshots leave it, is the candidate fix for finishing a batch: proposed, not built into
the same experiment. Next: Step C on a fixed five-mail inbox with unchanged instructions, one
variable at a time.

| Runs | Longest stretch without a new action or a tool call |
| --- | --- |
| Finished runs, all days, 28 of them | 0 to 15; one read-only page walk of 2026-09-13: 26 |
| The five loops and the refused-slot retry of today | 17, 23, 27, 30, 31, 53 |

Also seen: the run of 12:25 found the mailbox page blank for 37 seconds after a resume and was
ended by the 30-second rule, its first live firing; the restart of 12:27 cleared its card.

### Step C with a rebuilt five-mail inbox — 2026-09-17, 14:15–14:20 Prague

The owner requested the controlled run and authorized fresh test bookings and cancellations because
the original emails were no longer in the bot's folders. Two real setup bookings were made and
cancelled. Exactly five unread emails reached the unmodified `check-mail` routine: two invitations,
one confirmation and two cancellations. No inbox, prompt, skill or code changes occurred during it.

**Step C FAIL.** Run `c5dd5468-352c-4b14-8d96-60841edf83c6` ended `stuck` at 56 steps, 43 model
calls, 294 seconds and $0.7472. No tool failed, no `remember` ran and no approval card appeared.
The retained model text identifies Friday's cancellation at step 10, Thursday's at step 38, and
Friday's again at step 51. It then continued reading. This proves recognition followed by repetition,
not a specific cause of that repetition. Memory was byte-for-byte unchanged across the run.

**Progress guard PASS for this loop.** Action replay through the current guard yields notices at
steps 32 and 44 and a stop at 56; the live end event confirms the stop. Notices are not separate
events in the current log. The guard limited the run but did not make the job finish.

Evidence, setup details, input fingerprints and comparison limits:
`docs/evidence/2026-09-17-step-c/README.md`. Setup plus the failed run cost $1.2584. Both setup
bookings are cancelled in Cal.com; the cancellation notes remain missing from bot memory. The
computer is paused. The next candidate is retained facts within a run, designed and tested as a
separate change. Step C remains unpassed; no further live retry was started.

### Thinking continuity repair and Step C replay — 2026-09-17, 15:38–15:40 Prague

Review found a confirmed API integration defect: `toParams` dropped thinking blocks from every
tool continuation although Sonnet 5 enables thinking by default. The owner approved preserving the
full response, increasing the output cap to 16,000, and recording bounded thinking summaries and
per-call API token counts before discarding any cut response. The regression test failed on the
old conversion. Code review and the revised test review passed; preflight passed with 446
TypeScript tests and 16 Python tests. Scope and sources: `2026-09-17-thinking-continuity.md`.

The same five mail UIDs were still present. Memory and chat were restored from the saved pre-run
snapshot, all five mails were marked unread, and the normal watcher fired after its saved
watermark was rewound while the server was stopped. No new mail or booking was needed.

Run `30d8fd4d-b70a-4aa6-8f72-8bfb58aa7278` recorded both cancellations at computer step 17 and
opened the new invitation's booking page. It filled the form after correcting a field-targeting
mistake. Its next model request failed because the Anthropic account had insufficient API credit.
The run ended `failed`: 39 steps, 22 successful model responses, 138.502 seconds and $0.3822164.
No tool failed and no approval appeared. Step C remains incomplete.

The API reported 4,138 thinking tokens across 6,172 output tokens, ten responses with summaries
and twelve with zero thinking tokens. No response was cut or discarded; the largest response
used 1,591 tokens, below even the previous cap. This run supports keeping the continuity repair,
but does not isolate its effect or prove the whole job. Do not build the proposed notes mechanism
from this evidence. The next verification waits for API credit and another staged run.

Evidence: `docs/evidence/2026-09-17-thinking-replay/README.md`. The pre-run snapshot is retained;
live memory now contains the two cancellations. The bot is idle with no pending approval and the
normal timer paused its computer at 15:42:59 Prague. The watcher watermark is back at 93.

### Funded Step C replay — 2026-09-17, 15:52–15:55 Prague

The owner added API credit. The same five mails, memory, chat, skill and routine were restored again.
Application code was unchanged from the reviewed build that passed full preflight. The normal
watcher started run `ac7f94ab-f340-47a6-82bb-6e19339d96fa`; no new mail or booking was created.

**Step C PASS for this case.** Both cancellations were recorded at step 32, before the single
proposal at step 45. The proposal identified the new invitation. The final reply treated the old
invitation as handled and the old confirmation as superseded by its cancellation. Deny was sent
through the approval API. No computer action followed it, no approval was consumed, and nothing
was submitted. The bot saved a handoff note and ended `done`.

The run took 45 computer steps, 27 model responses and 176.044 seconds, at an estimated cost of
$0.4817096. The API reported 2,790 thinking tokens out of 6,908 output tokens. Nine responses had
thinking summaries; eighteen had zero thinking tokens. No token count was missing. No tool
failed, no response hit the cap, and no response or summary was cut. The largest response used
1,269 output tokens. Typecheck passed again after the replay.

Keep the thinking-continuity repair; this result does not justify building the proposed notes
mechanism. A single pass of the combined change does not isolate causation or establish general
reliability. The unchanged snapshot's older claim about a 09:30 booking was repeated, but this run
did not verify that booking in the external calendar.

Evidence and cleanup: `docs/evidence/2026-09-17-thinking-replay-funded/README.md`. The original
snapshot and both replay backups remain. Live memory contains the two cancellations and the
denied booking handoff. No further goal was started.

### Act one on the EU computer — 2026-09-18, 00:15–00:20 Prague

The Deny workflow passed on the current streamed model adapter, build `4c50032`.
The real Company A posting was read again, a fresh dossier and Czech letter were saved, the real
form was filled and `cv.pdf` attached. One announced approval named `Odeslat zájem`; Codex pressed
Deny in the UI. No approval was consumed and no computer action followed Deny. Hunter saved a
handoff note and ended `done`. The form remained filled on the visible computer.

Run `cea07d3c-6893-4ebb-9895-d8f41a82d7ca`: 29 computer steps, 18 model responses,
169.574 seconds, $0.4269235, zero failed tools and zero output-cap hits. It reused the dossier
from the interrupted research run `a146b1d3-84cc-4db9-b3a4-18289c72064a` ($0.0923917).
Total model cost was $0.5193152. This was a typed goal on a designated posting, not a new
unprompted search. Preflight passed with 475 TypeScript tests and 16 Python tests.

**Content verification failed.** Hunter attached the CV without reading its facts. The letter
also merged Company A's time in business with its time as market leader. The approval warning
dated the earlier application Deny as 17 September, while memory says 12 September. These are
separate from the successful form and approval mechanics. The Act One TODO stays open for a
demonstrated CV-fact source and a corrected, verified draft and card.

**Operator incident:** the first browser accessibility inspection printed a temporary noVNC
password inside its iframe URL. Codex reported it, stopped the run and server, stopped the old
stream through the existing reconnect path, and replaced the credential before resuming.
Subsequent inspection output redacted credential parameters. The original exposure is not a
pass of secret hygiene. No provider key or account password was exposed in that incident.

The full result, source checks, root causes, screenshots, events, cost, unchanged-input
fingerprints and cleanup checks are in `docs/evidence/2026-09-18-act-one/README.md`.
No product code or skill was changed during this rehearsal.

### Act one grounded follow-up — 2026-09-18, final run 01:37–01:42 Prague

**PASS for the Deny rehearsal.** Profile facts were checked against the operator's PDF, taught
through product chat and saved by Hunter. Hunter rewrote the two skills. A second teaching
correction addressed the first rerun's unsupported link between achievements and wrong tense.
The final profile and skills survived restart. No PDF reader or new agent tool was added.

Run `ed4d89fd-ae80-468d-8957-5b4f2b2a1c0c` read the current posting and company homepage,
wrote a fresh sourced dossier and letter, filled the real form and attached the CV. Independent
factual review passed. The single visible approval card named `Odeslat zájem` and correctly
cited application dates 12 and 18 September. Codex chose Deny in the UI. No computer action
followed it, no approval was consumed, and the correct local outcome was saved; end `done`.
50 steps, 36 calls, 317.596 seconds, $1.5271613. The five follow-up runs total $2.3334312.
A 404, an overlong-warning rejection and a typing error were recovered within the final run.

A safety check also found the unauthenticated API on all network interfaces. The server was
stopped; both API and Vite now bind to 127.0.0.1, and early Host/Origin checks reject outside
browser requests. Four reproduction cases failed before the fix. Seven boundary cases now
pass, with real approval/store assertions. Code and test-quality reviews passed; actual
listeners and HTTP probes confirmed the boundary. Full preflight: 482 TypeScript + 16 Python.

This is a designated-posting rehearsal with assisted chat profile setup, explicit local date,
and the existing placeholder phone. It does not prove automatic PDF reading or real submission.
Current evidence and cleanup: `docs/evidence/2026-09-18-act-one-grounding/README.md` (record omitted from this snapshot).

### Act two on Cal.com, run by an agent end to end — 2026-09-18, 08:34–08:40 Prague

**PASS.** On the owner's word Claude did every step: archived the five test mails of 17 September,
sent the fixture mail from the dev Gmail through the owner's Chrome, checked the approval card (the
page, one slot, the guest address) and clicked Allow once. The watcher started `check-mail` 19 s
after the mail. Run `c1f0ddb8`: one card for **Confirm** with four warnings and no question in
chat; the gate consumed the approval at step 24 with `submit-control`; "This meeting is scheduled",
Fri 18 Sep 11:00–11:30 CEST, no human check; the memory line with the received time and the
subject. 26 steps, 14 calls, $0.26. The confirmation mail started run `9f7070b6` by itself: 5
steps, no card, $0.07. A missed `morning-search` fired at boot and was stopped at step 0 ($0.05).
Findings: a stale "still-standing 09:30 booking" claim from memory reached the card as a warning
(F1); the first screenshot after a resume was black (F2); the page's screen panel and status lagged
about 2 s after the bot was selected during a wait (F3).
Evidence: `docs/evidence/2026-09-18-act-two/README.md`.

### The takeover scene on the current code — 2026-09-18, 08:55–09:15 Prague

**PASS.** A typed goal signed the mailbox out (`d0baf06c`, 13 steps, $0.17). Run `af0f8a48`, with
the `check-mail` text as its goal, asked for a takeover after one screenshot and waited 15 min 31 s
with no step, no model call and no screenshot. Claude probed the hand-back check through the API:
refused while the page was unchanged, and refused while the password sat in its field, with and
without `force` (HTTP 409; the first live `handback-refused` events, criterion 9). The owner signed
in and pressed Hand back; the run went on 2 s later and ended `done`; $0.10. A count-only scan of
774 files under `data/` plus the server log found the mailbox password in 0 files (criterion 3,
with the real secret in place of a marker). Findings: the closing message claimed the sign-in (T2);
the black first screenshot again (T3); the spec's demo step 11 says "clicks Take over", but the
page switches by itself (T1). Not covered live: Stop during a takeover, the secret guard, an idle
takeover. Evidence: `docs/evidence/2026-09-18-takeover/README.md`.

### The report fix, the F1 correction and the cancelled booking — 2026-09-18, 09:36–09:52 Prague

T2 fixed in `8960406`: the takeover rule says a step done during a takeover is the user's, and only
when the screen shows it is done. One live run on the same input (`112b7cba`, a second sign-in by
the owner, $0.09): the closing message starts "I checked the mailbox" and claims no sign-in. It does
not credit the user either, and one run cannot separate the fix from chance, because the old rule
got it right on 14 September and wrong this morning. F1 was corrected in chat and the bot wrote
memory line 21 itself (`0e04ea2c`, no computer step, $0.06). Claude cancelled today's 11:00 booking
as the host on the owner's word; the cancellation mail started `check-mail` by itself 50 s later, and
run `98f8aef9` wrote the cancellation to memory and proposed nothing (6 steps, $0.08). Four runs,
$0.29. Evidence: `docs/evidence/2026-09-18-takeover-report-fix/README.md`.

### Clean clone, and a small window on a new computer — 2026-09-18, 09:55–10:20 Prague

The README's Setup block ran literally on a fresh clone of `839b76a`: install, keys copied file to
file, the example bot, preflight, `pnpm dev`, the page, a first goal on a newly created computer
(`done` in 24 s, $0.05). It found that a new computer's browser window stayed 1050 wide: `xdotool
search` dies with an X BadWindow error while Chrome creates and destroys short-lived windows, and
the one-shot maximise command never tried again. Fixed in `d452eec` with a bounded retry inside the
same command; six of six newly created computers were wide afterwards.
Evidence: `docs/evidence/2026-09-18-clean-clone/README.md`.

### Side proof: a bot born on the page — 2026-09-18, 10:26–12:47 Prague

**The cycle is complete; it took corrections to get there.** Claude drove the page on the owner's word;
the owner chose the report's address, allowed Allow on send cards for it only, and signed the bot in to
its mailbox by takeover. "Swimmer" (`swimmer-0cc4`) was created in the page's form. Twelve runs,
$6.06 against "under a dollar"; a run the saved skill drives costs $0.39.

| Run | What | Steps | Cost | End |
| --- | --- | --- | --- | --- |
| `f88ba91f` | read the whole site, then the developer tools and the site's data API; Stop | 85 | $1.53 | `cancelled` |
| `1f36ddcb` | the gate stopped a click on the tools' close button; Deny after 26 s | 7 | $0.04 | `stuck`: a platform defect, fixed in `e5f3ed9` |
| `fc48aa39` | Gmail and a takeover for the owner's own Google sign-in, twice; Stop during the takeover | 82 | $1.95 | `cancelled` |
| `31424384` | the right mailbox, the right takeover (58 minutes of waiting, no step), the report, Allow, then the provider's refusal (usage limit) | 70 | $1.83 | `failed` |
| `5704b27c` | "send the report you wrote": card, Allow, sent | 4 | $0.06 | `done` |
| `8d874fb9` | the evening capture once: one screenshot, one zoom, one correct memory line | 2 | $0.05 | `done` |
| `4a9417a5`, `4d47b835`, `6ba2de2d` | two skills and two routines; a correction as a rewrite; a "move" that made a second routine | 0 | $0.12 | `done` |
| `af709685` | **the scheduler started it at 12:41:00, nobody typing**, on a paused computer: the whole job by the saved skill, a second mail after one Allow | 34 | $0.39 | `done` |
| `a7faa814`, `18538ee3` | three corrections into the skill and memory; all three routines off by chat | 0 | $0.11 | `done` |

Two platform defects found and fixed the same day: a Deny after a slow decision ended a run as stuck
(`e5f3ed9`), and a refusal by the model provider was reported as "the model stopped answering …
retry" (`9b61c04`). Behaviours for the write-up: the bot reached for the developer tools and lifted
the site's publishable key into a `fetch_url` call; it asked for the user's own Google sign-in; asked
to move a routine, it made a second one; the skill it wrote had lost the user's limits from the goal.
Each was corrected with one or a few plain sentences in chat, and each correction stuck. Not proven:
a morning report that uses a capture note from the evening before. The owner decides: filmed or proof
only, and whether Swimmer stays. Evidence: `docs/evidence/2026-09-18-side-proof/README.md`.

### Rehearsals on the batching code, then the inbox and the memory made ready for filming — 2026-09-19

Act one, act two and a manual takeover passed on revision `a8c711e`; the runs, the numbers and the
acceptance decision are in `docs/evidence/2026-09-19-cache-batching/README.md` and in the live
record of `docs/plans/2026-09-19-screenshot-cache-batching-plan.md`.

**Inbox archived, 13:2x Prague, on the owner's word ("archive"):** the three mails of the act-two
rehearsal (the fixture invitation, Cal.com's confirmation and its cancellation; UIDs 116, 118 and
120) moved to the mailbox's Archive folder over IMAP. The inbox is empty, as it was before the
rehearsal. The watcher reads an empty inbox as "next number 1"; at the next start it sets a new
baseline, and the next mail counts as a rise (seen in the act-two rehearsal the same day).

**Memory pruned, 13:3x Prague, on the owner's word ("prune"):** ten lines removed through the memory
API, the Skills tab's path, as on 17 September: the rehearsal bookings and their cancellations of
17 September (lines 12 to 15), the denied booking of the 14:14 invitation (16), the booking of
18 September, the correction about the 09:30 booking and the cancellation (20 to 22), and the
booking and cancellation of this day's rehearsal (43, 44). 34 lines remain, and none of them
mentions a booking except the bot's own rule from day one ("propose one slot and wait for
approval"). Checked: the difference to the file from before is exactly those ten lines, the file
on disk equals the text that was sent, and the API returns it. No computer was started for this.
The events behind the removed lines stay in these notes and in the evidence folders of 17, 18 and
19 September; a copy of the file from before stays on the author's machine. The filmed mail run
therefore meets the fixture as a first invitation: the card of this day's rehearsal had carried a
warning about "the fourth distinct invitation for the same role".

