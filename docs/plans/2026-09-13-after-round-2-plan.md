> **STATUS: SHIPPED 2026-09-13.** Landed as eleven commits from `b2a709d` to `5c78c13`, plus the commit
> that adds this banner and ticks the TODO item. The unchecked `- [ ]` boxes below are historical — work
> is done. **Do not re-execute this plan.** If you are modifying the computer's time zone, the browser
> restart, the stream start or the unanswered-action rule, work directly in `src/server/sandbox/e2b.ts`
> (`chromeEnv`, `clockCommand`, `stopProcessesCommand`, `connectSandbox`, `restartChrome`, `stopStream`)
> and `src/server/agent/run.ts` (`noAnswerText`, `handleComputer`, the catch at the end of `runLoop`).
>
> **Commits:** `b2a709d` Task 1 (the zone), `bf7367d` Task 2 (one unanswered action), `d47c2d2` Task 3
> (the doubt rule). Corrections: `397b96d` (manager zone test), `72a0f40` (wait for the old browser to
> stop), `9b26e13` (spend the approval and warn when a run ends), `9a78de9` (an approved control with no
> name), `f5fab8b` (stop the old stream and wait), `87410d2` (the stop tests renamed), `9cf7daa`
> (websockify stopped with the old stream, a failed stop logged), `5c78c13` (two comments made
> accurate). Preflight green at 342 tests (323 before the plan).
>
> **Live check of Task 1** (2026-09-13, 20:00–20:46 UTC, Claude, server started through the launch entry):
>
> - The "say hello" run `731f668b` ended `done` and cost $0.032 (the plan estimated about $0.003). One
>   second after `sandbox connected` the server logged `browser zone differs from TZ; setting the clock
>   and restarting the browser once` with `recorded: null`. The run ended six seconds later, with no
>   companion retry.
> - The panel clock alone cannot prove the browser restart: it follows `/etc/localtime`, not the
>   browser. So `data/tz-check.mts` (git-ignored) read the environment of the process serving CDP. The
>   browser (`chrome`, pid 6886) started in that same second with `TZ=Europe/Prague`. Its sandboxed
>   child processes show no readable TZ; the browser passes the zone to pages. The marker,
>   `/etc/localtime` and `/etc/timezone` say Europe/Prague, and `date` prints CEST.
> - A full-size screenshot shows the panel clock at "Sun 13 Sep, 22:02", Prague time. The restarted
>   browser opened `about:blank` (the tabs are gone, Assumption 5) and shows a "Can't update Chrome"
>   bubble in the top-right corner.
> - The second connect (criterion 2, second half) first failed. `data/connect-check.mts` called
>   `connectSandbox` on the resumed computer, and the SDK's `stream.start()` threw "Stream is already
>   running". After the fix in `f5fab8b`, two connects in a row logged no zone restart, kept the same
>   browser process (pid 6886) and started the stream; the second one faced an x11vnc the first had
>   started. `ps` shows a later start time for the browser after each pause, because paused time does
>   not count; the unchanged pid is the proof. With `9cf7daa`, three more connects (20:33, 20:44 and
>   20:46 UTC) each replaced the stream the previous one had started: a new x11vnc held :5900, a new
>   websockify (a child of the new proxy script) held :6080, and the noVNC page answered HTTP 200 inside
>   the sandbox. At 20:46, `pgrep -f '[w]ebsockify'` matched only that websockify. The second match in
>   the two earlier runs was the check script's own shell, whose text still named the word.
> - Left to round 3: the mailbox session after the browser restart (Assumption 1), Calendly in Central
>   European Time (criterion 1), and the doubt rule on a live card (criterion 5).
>
> **Plan-vs-reality corrections discovered during execution:**
>
> - The live "say hello" check moved from right after Task 1 to after Task 3. Tasks 2 and 3 edit `src/`,
>   and tsx watch would have killed a mail-triggered run started by the boot. The mailbox was checked
>   first (`data/mail-status.mts`: next message number 29, the same as the watermark), so the boot
>   started no run.
> - Task 2 said "the five new tests fail" before the change. The test "a helper that no longer answers…"
>   passed before it, because the old loop ended the run at the first such error; it pins the helper
>   check now.
> - Task 1's Test Plan said the types enforce the zone threading. The types only force a string, so a
>   hard-coded zone compiled and passed every test (test review). `397b96d` adds a manager test that
>   fails on a hard-coded zone.
> - Task 1's restart (SIGTERM, a fixed one-second sleep, relaunch) could hand the new launch to an old
>   browser that was still running. That browser kept the old zone while the marker said otherwise, and
>   no later connect retried (code review). `72a0f40`: `stopProcessesCommand` waits until the processes
>   are gone and sends SIGKILL after 5 s; tests run the real command against local stand-in processes.
>   Live, the old browser left on SIGTERM.
> - Task 2's code threw before it spent the approval on the paths that end the run (a second failure in
>   a row, a companion that is gone), and the chat invited a plain retry although the approved click may
>   have gone through (code review). `9b26e13` spends the approval first on every path, and a failed run
>   ends with "You had approved "X", and I cannot tell whether it went through: check before you send
>   the goal again." `9a78de9` pins "an action" for a control with no name.
> - The stream: the SDK's `stream.stop()` sends x11vnc one SIGTERM without waiting, and only when its
>   own `pgrep -x x11vnc` check succeeds. An x11vnc restored from a pause was still running 10 s after
>   it, and `stream.start()` refuses while one runs. The rehearsals never hit this. Two raw SDK connects
>   by the check scripts ran between the "say hello" session and the failing connect; whether they
>   matter is not known. `f5fab8b` stops x11vnc and the noVNC proxy with the same stop command (2 s
>   grace) and logs when SIGKILL was needed; `9cf7daa` adds websockify, which holds :6080, and logs a
>   failed stop. Whether the SDK's SIGTERM never arrived or x11vnc ignored it is not settled: x11vnc's
>   stderr log is silent after `-bg`, and in the proof runs the platform's SIGTERM was enough.
> - Tests beyond the plan: a sixth test for the two-in-a-row guard, a literal test of `noAnswerText`,
>   three tests for the ending paths of an approved action, one for a control with no name, and three
>   stand-in tests of the stop command. README bullets widened: a `TZ` change also restarts the browser;
>   a companion that is gone ends the run at once; "answers every other action"; the check-first line.
>
> **Library/version drift:** none; no dependency added or changed.
>
> **Corrections applied during review:** `397b96d` (Task 1 test review, a suggestion taken),
> `72a0f40` (Task 1 code review, blocking; re-reviewed RESOLVED), `9b26e13` (Task 2 code review,
> blocking; re-reviewed RESOLVED, and the Task 2 test review's two suggestions taken), `9a78de9` (the
> re-review's suggestion taken). Task 3 was not reviewed: under 30 lines of prompt text, no gate code.
> The stream fix `f5fab8b`: the test review passed with suggestions. The describe rename was taken
> (`87410d2`). Three were declined: a test of an exported pattern constant (a reverted `stopStream`
> would simply not use it, so the test would stay green), tests that repeat the grace values, and a stub
> of `commands.run` to test the SIGKILL warning (the project rule against mocking the sandbox; the note
> behind the warning is tested for real). The code review of `f5fab8b` passed with suggestions:
> websockify is now stopped by name, and a failed stop is logged (`9cf7daa`); the SDK's own
> `stream.stop()` stays, and the comment says why. The second review of `9cf7daa` passed, both
> suggestions resolved; its two comment fixes landed in `5c78c13`.
>
> **Deferrals worth tracking** (review suggestions that did not ship; for the write-up's known limits):
>
> - The restart decision in `connectSandbox` (`recorded !== timeZone`) stays inline. The live check
>   above proves both branches; extracting `needsZoneRestart` is the upgrade if the rule ever grows.
> - `E2bSandbox.openUrl` starts a browser without the zone, and without the CDP flags, when none runs.
>   The zone then falls back to `/etc/localtime`.
> - `recordedZone` has no fallback: an E2B error while reading the marker fails the connect, like the
>   other connect calls, instead of restarting the browser.
> - One unanswered action can hold a run for about two minutes in the worst case: the action's own
>   timeout, 5 s of companion health, then up to 60 s for the fresh screenshot.
> - After an unanswered approved action, only a `failed` run's last line warns. Stop, stuck, budget and
>   `done` endings do not repeat it, and only the last such approval is named.
> - A `SandboxActionError` does not reset the two-in-a-row count, because run.ts cannot tell a real
>   command failure from a check that failed before any command ran.
> - The model-facing error text quotes an empty target as `("")` for a control with no name.
> - The "Can't update Chrome" bubble after a browser restart may cover the top-right corner of a page on
>   camera.
>
> **Plan history below is preserved as-written for context. Treat the live code as authoritative.**

# After act two, round 2: the computer's clock, an unanswered action, and doubts on the card — Implementation Plan

**Goal:** Three generic platform fixes from the act-two round-2 record, decided by the owner on 2026-09-13 evening ("all three"): the bot's computer runs in the operator's time zone, a computer action the computer does not answer no longer ends the run, and a doubt about a sender or a page goes on the approval card and never into a question in chat.
**Approach:** Thread the already-validated `TZ` setting from the config through the sandbox manager into the two E2B calls that start Chrome, set the computer's own clock with `sudo`, and keep a marker file in the sandbox so an existing computer restarts its browser once and picks the zone up. In the run loop, catch the first failure of a computer action, check that the companion still answers, hand the model an error result with a fresh screenshot, and spend an approved action's approval because its outcome is unknown; the second failure in a row, or a companion that is gone, ends the run as today. One new rule line in the system prompt. No new dependency.
**Design spec:** N/A — the recommendation and the owner's decision are in `docs/plans/2026-09-11-platform-plan.md`, "Act two, round 2" (finding 5 of part one, the unanswered `triple_click`; finding 6 of part two, the time-zone picker; fix 4 under "Skill fixes applied after the round", the doubt that became a question), and in the session of 2026-09-13 evening.
**TODO items:** section 2 "The demo path": a new item "Fixes after round 2" placed right before "Act two, round 3, unprompted" (added and ticked by Task 4), and the "Before it" list of the round-3 item, which names this plan once shipped.
**Branch:** `main`, one commit per task, no pull request (a solo repository; every plan so far did the same).
**Scope:** `src/server/sandbox/{e2b,manager}.ts`, `src/server/index.ts`, `scripts/day-one.ts`, `src/server/agent/{run,prompt}.ts`, their tests plus `src/server/agent/runner.test.ts` (a constructor argument), `README.md`, the private backlog. No change to the store, the gate rules, the companion or the page.
**Build estimate:** Claude: about four hours (four tasks with their reviews). The owner's hands: none during the build; the live proof is act two, round 3 (one seeded mail, one Allow, about ten minutes), which the demo path needs anyway, plus one "say hello" run right after Task 1 (pennies) to watch the existing computer pick the zone up. Live-run cycles: one, shared with round 3; the fact-finding probe already ran on 2026-09-13 at 18:33 UTC.

## Preconditions

- The dev server is **stopped** before `/implement` starts: `tsx watch` restarts the server on every `src/` change and kills a run in progress (CLAUDE.md working rule; the toolchain memory). The cancellation mail the owner may send meanwhile starts its run at the next boot (the reliability plan's criterion 2, expected).
- `main` at `a3535f6` or later; `pnpm preflight` green (323 tests on 2026-09-13).
- No live run on the demo bot while a task edits `src/`.

## Research (source links)

- [E2B core SDK types](https://unpkg.com/e2b@2.49.1/dist/index.d.ts) — `e2b` 2.49.1 under `@e2b/desktop` 2.4.0 (the platform plan's Research table, re-used): `commands.run(cmd, { background?, cwd?, envs?, onStdout?, onStderr?, timeoutMs? })` returns a `CommandHandle` (or, when not in the background, the finished result with `stdout`, `stderr`, `exitCode`); `files.write(path, data: string | ArrayBuffer | Blob | ReadableStream)`; `Sandbox.connect(sandboxId, opts?)` resumes a paused sandbox. The platform already passes `envs: { DISPLAY }` this way (`src/server/sandbox/e2b.ts`, `startChrome`).
- **Live probe, 2026-09-13 18:33 UTC, `data/tz-probe.mts` on sandbox `iyv3zjam4u5jxll14vzl9`** (the fact this plan rests on): the OS zone is `Etc/UTC` (`/etc/localtime -> /usr/share/zoneinfo/Etc/UTC`, `/etc/timezone` = `Etc/UTC`); the user is `user`; `sudo -n true` succeeds (passwordless sudo); `/usr/bin/timedatectl` and `/usr/share/zoneinfo/Europe/Prague` exist; `commands.run('date', { envs: { TZ: 'Europe/Prague' } })` prints `CEST`; `google-chrome --headless=new … --dump-dom` started with that env prints `Europe/Prague | … GMT+0200 (Central European Summer Time)` from `Intl.DateTimeFormat().resolvedOptions().timeZone` and `new Date().toString()`. So Chrome 150 takes its zone from the `TZ` variable of its process, and a per-command `envs` reaches that process.
- `timedatectl set-timezone` talks to systemd's `timedated` service over D-Bus, which a container without systemd as PID 1 does not run; the container-safe way is the `/etc/localtime` symlink plus `/etc/timezone`, which is what Debian and Ubuntu read ([Debian wiki, TimeZoneChanges](https://wiki.debian.org/TimeZoneChanges)). The plan uses the symlink and never `timedatectl`.
- [Anthropic SDK 0.125.0, messages types](https://unpkg.com/@anthropic-ai/sdk@0.125.0/resources/messages/messages.d.ts) (the platform plan's Research table, re-used): `ToolResultBlockParam { tool_use_id, type: 'tool_result', content?: (TextBlockParam | ImageBlockParam …)[], is_error?, toolset_name? }` — one tool result may carry a text block and an image block together, which Task 2 uses for "an error with a fresh screenshot".
- `TZ` is validated in `src/server/config.ts` by `isKnownTimeZone` (an `Intl.DateTimeFormat` construction), so only an IANA name such as `Europe/Prague` reaches the sandbox layer; it is still passed through `shellQuote` (`src/server/sandbox/shell.ts`) wherever it enters a command line.

## Assumptions made while planning

1. A browser restart keeps the profile's logins: Chrome writes cookies to the profile directory on disk and `pkill` sends `SIGTERM`, which lets it flush. Checked live in round 3: the mailbox must open without a sign-in takeover after the first connect of this version. If it does not hold, the fallback is to restart Chrome only at creation and to recreate the demo bot's computer (`sandboxId: null`, one sign-in by takeover), which the EU-cluster move needs anyway.
2. The panel clock picks the new `/etc/localtime` up on its own (glibc re-reads the file when it changed). If the panel still shows UTC after the clock command, `xfce4-panel -r` in a takeover or a probe is the by-hand fallback, and the README names the clock as cosmetic; Chrome's zone does not depend on it.
3. The E2B error for an action the computer did not answer is not matched by class. Every error thrown by a computer action that is not a `SandboxActionError` means "no answer", and the companion health check decides whether the computer is still there. This covers the `TimeoutError` seen live and a dropped connection alike.
4. The existing test "ends with failed … when the sandbox throws" (`run.test.ts`) keeps its meaning: its sandbox throws on every screenshot, so the fresh screenshot after the first failure fails too, and the run ends as before (two failures in a row).
5. The first connect of an existing computer after this version restarts its browser once, so the open tabs of that computer are lost once; every run starts from `open_url` anyway, and the record says so.

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Modify | `src/server/sandbox/e2b.ts` | `chromeEnv`, `clockCommand`, the zone marker, `setClock`, `recordedZone`; `startChrome`/`restartChrome`/`createSandbox`/`connectSandbox`/`startSession` take the zone |
| Modify | `src/server/sandbox/manager.ts` | `SessionFactory` and `SandboxManager` carry the zone to the factory |
| Modify | `src/server/index.ts` | passes `config.TZ` to the manager |
| Modify | `scripts/day-one.ts` | passes the configured zone to create, connect and the Chrome restart |
| Modify | `src/server/sandbox/manager.test.ts` | the constructor's new argument |
| Modify | `src/server/agent/runner.test.ts` | the constructor's new argument at its seven `new SandboxManager(…)` call sites |
| Modify | `src/server/sandbox/e2b.test.ts` | `clockCommand` quoting and `chromeEnv` |
| Modify | `src/server/agent/run.ts` | an unanswered computer action becomes an error result with a fresh screenshot; the second in a row ends the run; an approved action spends its approval |
| Modify | `src/server/agent/run.test.ts` | five tests for the unanswered action |
| Modify | `src/server/agent/prompt.ts` | the doubt rule |
| Modify | `src/server/agent/prompt.test.ts` | pins the doubt rule |
| Modify | `README.md` | "What you see": the clock; "Known limits": the one-time browser restart and the unanswered-action rule |
| Modify | the private backlog | the new item, ticked; the round-3 "Before it" list |
| Modify | `docs/plans/2026-09-13-after-round-2-plan.md` | the shipped status banner |

## Tasks

### Task 1: The computer's clock follows `TZ` [integration] [demo-path]

**Files:** Modify `src/server/sandbox/e2b.ts`, `src/server/sandbox/manager.ts`, `src/server/index.ts`, `scripts/day-one.ts`; Test `src/server/sandbox/e2b.test.ts`, `src/server/sandbox/manager.test.ts`, `src/server/agent/runner.test.ts` (the constructor's new argument only).
**Invariant:** 6 — the computer stays a cache of the bot folder: the zone is applied from the config on every create and connect and is never stored as truth anywhere but the operator's config; 7 — no user setup: `TZ` is the operator setting the scheduler already uses; 1 — the visible computer shows the right time.
**Demo step:** act two: the scheduling page opens in Central European Time and the picker step disappears (round 2 spent 60 steps and $0.45 there); the panel clock on camera reads Prague time.
**Verify:** `pnpm exec vitest run src/server/sandbox src/server/agent/runner.test.ts && pnpm typecheck`

- [ ] In `src/server/sandbox/e2b.test.ts`, replace the import line with `import { chromeEnv, clockCommand, typingChunks } from './e2b'` and add at the end of the file:

```ts
// The zone reaches every page through the browser process's environment (probe of 2026-09-13:
// Chrome 150 reports Intl time zone Europe/Prague when started with TZ=Europe/Prague); the
// computer's own clock is set through /etc/localtime, so the panel clock on camera agrees.
describe('the computer clock', () => {
  it('starts the browser with the display and the zone', () => {
    expect(chromeEnv('Europe/Prague')).toEqual({ DISPLAY: ':0', TZ: 'Europe/Prague' })
  })

  it('sets the clock through the zoneinfo symlink and /etc/timezone, with the zone quoted', () => {
    const cmd = clockCommand('Europe/Prague')
    expect(cmd).toContain("ln -sf /usr/share/zoneinfo/'Europe/Prague' /etc/localtime")
    expect(cmd).toContain("echo 'Europe/Prague' | sudo tee /etc/timezone")
    expect(cmd).not.toContain('timedatectl')
    // A hostile name stays one inert argument (config validates the zone, this is the second wall).
    expect(clockCommand("x'; rm -rf /")).toContain("zoneinfo/'x'\\''; rm -rf /'")
  })
})
```

- [ ] Run `pnpm exec vitest run src/server/sandbox/e2b.test.ts`; it fails on the missing exports.
- [ ] In `src/server/sandbox/e2b.ts`, after the line `const WEBSOCKET_CLIENT = 'websocket-client==1.9.2'`, add:

```ts
// The zone the browser was last started with, kept on the computer so a connect can tell whether the
// operator's TZ changed (or was never applied, on a computer from before this version) and restart
// the browser once. Written after Chrome starts, read before the companion starts.
const ZONE_MARKER = '/home/user/.dobot-tz'
```

- [ ] In the same file, after `typingChunks`, add:

```ts
/** The environment of the browser process: the display, and the zone every page will see. */
export function chromeEnv(timeZone: string): Record<string, string> {
  return { DISPLAY, TZ: timeZone }
}

/**
 * Sets the computer's own clock: the panel clock, `date`, and every process started later. The
 * symlink and /etc/timezone are what Debian and Ubuntu read; timedatectl needs systemd's service,
 * which this container does not run. The zone is an IANA name (config.ts validates it) and is
 * quoted anyway.
 */
export function clockCommand(timeZone: string): string {
  const zone = shellQuote(timeZone)
  return `sudo ln -sf /usr/share/zoneinfo/${zone} /etc/localtime && echo ${zone} | sudo tee /etc/timezone > /dev/null && date`
}
```

- [ ] Replace `createSandbox` with (the signature gains `timeZone`; the clock is set before the browser starts):

```ts
/** Creates the bot's computer: workspace files, the companion, the clock, Chrome, the stream. */
export async function createSandbox(botId: string, workspaceDir: string, companionSrc: CompanionSource, timeZone: string): Promise<SandboxSession> {
  const raw = await Sandbox.create({
    resolution: RESOLUTION,
    timeoutMs: RUN_TIMEOUT_MS,
    lifecycle: { onTimeout: 'pause' },
    metadata: { botId },
    requestTimeoutMs: API_TIMEOUT_MS,
  })
  log.info('sandbox created', { botId, sandboxId: raw.sandboxId })
  try {
    await raw.files.makeDir(WORKSPACE_DIR, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
    await raw.files.makeDir(COMPANION_DIR, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
    await uploadDirectory(raw, workspaceDir, WORKSPACE_DIR)
    await writeCompanion(raw, companionSrc)
    await raw.commands.run(`pip install ${WEBSOCKET_CLIENT}`, { timeoutMs: PIP_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
    await setClock(raw, timeZone)
    await startChrome(raw, { timeZone })
    return await startSession(raw, timeZone)
  } catch (e) {
    log.error('sandbox setup failed; killing the half-built sandbox', { botId, sandboxId: raw.sandboxId, ...errorFields(e) })
    await raw.kill().catch(() => undefined)
    throw e
  }
}
```

- [ ] Replace `connectSandbox` with:

```ts
/**
 * Resumes a paused sandbox (or attaches to a running one), restarts the stream with a fresh auth
 * key and the companion with a fresh token. A browser started with another zone than the operator's
 * TZ — or before this version, with none — is restarted once with the right one; the profile and
 * its logins are on disk and survive. Throws SandboxNotFoundError when the sandbox is gone.
 */
export async function connectSandbox(sandboxId: string, companionSrc: CompanionSource, timeZone: string): Promise<SandboxSession> {
  const raw = await Sandbox.connect(sandboxId, { requestTimeoutMs: API_TIMEOUT_MS })
  await raw.setTimeout(RUN_TIMEOUT_MS, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
  log.info('sandbox connected', { sandboxId })
  // The companion is restarted anyway, so a newer companion source reaches an existing sandbox.
  await writeCompanion(raw, companionSrc)
  await stopStream(raw)
  const recorded = await recordedZone(raw)
  if (recorded !== timeZone) {
    log.info('browser zone differs from TZ; setting the clock and restarting the browser once', { sandboxId, recorded, timeZone })
    await setClock(raw, timeZone)
    await restartChrome(raw, { timeZone })
  }
  return startSession(raw, timeZone)
}
```

- [ ] Change `startSession` to take the zone and pass it to its fallback restart: the signature becomes `async function startSession(raw: Sandbox, timeZone: string): Promise<SandboxSession>` and the line `await restartChrome(raw)` becomes `await restartChrome(raw, { timeZone })`.
- [ ] Replace the function `startChrome` with the new `startChrome`, `recordedZone` and `setClock` below, and the function `restartChrome` with the new `restartChrome` below. `maximizeChrome` is unchanged and stays exactly where it is, between `startChrome` and `restartChrome` (the new `startChrome` still calls it):

```ts
/** Exported for the day-one script, which decides whether --no-sandbox is needed in this container. */
export async function startChrome(raw: Sandbox, opts: { timeZone: string; noSandbox?: boolean }): Promise<void> {
  const flags = (opts.noSandbox ?? CHROME_NEEDS_NO_SANDBOX) ? [...CHROME_FLAGS, '--no-sandbox'] : CHROME_FLAGS
  const handle = await raw.commands.run(`google-chrome ${flags.join(' ')} about:blank > /tmp/chrome.log 2>&1`, {
    background: true,
    timeoutMs: 0,
    envs: chromeEnv(opts.timeZone),
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  })
  await handle.disconnect()
  await raw.files.write(ZONE_MARKER, opts.timeZone, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
  await maximizeChrome(raw)
}

/** The zone the browser on this computer was last started with; null before this version. */
async function recordedZone(raw: Sandbox): Promise<string | null> {
  const result = await raw.commands.run(`cat ${ZONE_MARKER} 2>/dev/null || true`, { timeoutMs: COMMAND_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
  const zone = result.stdout.trim()
  return zone === '' ? null : zone
}

/** Best effort: a panel clock that stays on UTC costs nothing but a puzzled viewer; the browser's zone does not depend on it. */
async function setClock(raw: Sandbox, timeZone: string): Promise<void> {
  try {
    await raw.commands.run(clockCommand(timeZone), { timeoutMs: COMMAND_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
  } catch (e) {
    log.warn('could not set the computer clock', { sandboxId: raw.sandboxId, timeZone, ...errorFields(e) })
  }
}

// The bracket in the pattern keeps pkill from matching the shell that runs pkill itself.
export async function restartChrome(raw: Sandbox, opts: { timeZone: string; noSandbox?: boolean }): Promise<void> {
  await raw.commands.run("pkill -f '[c]hrome-profile' || true", { timeoutMs: COMMAND_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
  await sleep(1_000)
  await startChrome(raw, opts)
}
```

- [ ] In `src/server/sandbox/manager.ts`, replace the `SessionFactory` type and the constructor:

```ts
export type SessionFactory = {
  create(botId: string, workspaceDir: string, companion: CompanionSource, timeZone: string): Promise<SandboxSession>
  connect(sandboxId: string, companion: CompanionSource, timeZone: string): Promise<SandboxSession>
}
```

  and

```ts
  constructor(
    private readonly store: Store,
    private readonly events: BotEvents | null,
    private readonly companion: CompanionSource,
    /** The operator's TZ: the computer's clock and the browser's zone follow it (config.ts validates it). */
    private readonly timeZone: string,
    deps: Partial<ManagerDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps }
  }
```

  In `start`, `this.deps.factory.connect(bot.sandboxId, this.companion)` becomes `this.deps.factory.connect(bot.sandboxId, this.companion, this.timeZone)`; in `create`, `this.deps.factory.create(botId, this.store.workspaceDir(botId), this.companion)` becomes `this.deps.factory.create(botId, this.store.workspaceDir(botId), this.companion, this.timeZone)`.
- [ ] In `src/server/index.ts`, `new SandboxManager(store, events, loadCompanionSource())` becomes `new SandboxManager(store, events, loadCompanionSource(), config.TZ)`.
- [ ] In `src/server/sandbox/manager.test.ts`, `manager = new SandboxManager(store, null, { py: '', js: '' }, { factory })` becomes `manager = new SandboxManager(store, null, { py: '', js: '' }, 'Europe/Prague', { factory })`. The fake factory's `create()` and `connect(sandboxId)` keep their shorter signatures (a method with fewer parameters still implements the type).
- [ ] In `src/server/agent/runner.test.ts`, at every `new SandboxManager(store, events, { py: '', js: '' }, …)` call (seven sites: lines 34, 192, 226, 268, 313, 348 and 421 on 2026-09-13), insert `LIMITS.timezone` as the fourth argument, before the deps object — for example line 34 becomes `const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, LIMITS.timezone, { factory })`. `LIMITS` is the file's own config constant (line 16, `timezone: 'Europe/Prague'`); the fake factories there ignore extra arguments, so nothing else changes.
- [ ] In `scripts/day-one.ts`: in `main`, `loadConfig() // loads .env.local; …` becomes `const config = loadConfig() // loads .env.local; the SDK reads E2B_API_KEY from the environment`, and `create` and `resume` get a fourth and third parameter `timeZone: string` passed from `main` (`create(args[0] ?? '', args[1] ?? '', args[2] ?? '', config.TZ)` and `resume(args[0] ?? '', args[1] ?? null, config.TZ)`); inside them `createSandbox('day-one', workspace, loadCompanionSource())` becomes `createSandbox('day-one', workspace, loadCompanionSource(), timeZone)`, `connectSandbox(sandboxId, loadCompanionSource())` becomes `connectSandbox(sandboxId, loadCompanionSource(), timeZone)`, and `restartChrome(sandbox.raw, { noSandbox: true })` becomes `restartChrome(sandbox.raw, { noSandbox: true, timeZone })`.
- [ ] Run `pnpm exec vitest run src/server/sandbox && pnpm typecheck`; both green.
- [ ] In `README.md`, under `## What you see`, add at the end of the section: `The bot's computer runs in your time zone (\`TZ\` in \`.env.local\`, Europe/Prague by default): its clock and every page it opens show local time.` Under `## Known limits`, add a bullet: `- The first run after an upgrade that changed the browser's zone restarts the browser once: open tabs are gone, logins stay (they live in the profile on disk).`
- [ ] **Commit** `Run the bot computer in the operator's time zone`.
- [ ] Live, right after the commit (the owner at the keyboard or Claude with the server started through the launch entry): send the demo bot "Say hello and do nothing else." (about $0.003). Expected in the server log: `browser zone differs from TZ; setting the clock and restarting the browser once` with `recorded: null`; in the stream, the panel clock reads Prague time. Record the result in this plan's status banner. The mailbox session is checked in round 3.

### Task 2: An unanswered computer action becomes an error result, not the end of the run [integration] [demo-path]

**Files:** Modify `src/server/agent/run.ts`; Test `src/server/agent/run.test.ts`.
**Invariant:** 4 — an approved action the computer did not answer has an unknown outcome, so its approval is spent and the model must propose again; nothing is retried in the user's name on the platform's own initiative. 1 and 2 — the run continues on the real computer instead of dying on one dropped call.
**Demo step:** act two, the booking: the reply run of round 2 died on one `triple_click` the computer did not answer in 15 s (2026-09-13 17:54 UTC), and the goal had to be sent again.
**Verify:** `pnpm exec vitest run src/server/agent/run.test.ts && pnpm typecheck`

- [ ] In `src/server/agent/run.test.ts`, import `noAnswerText` from `./run` (add it to the existing import line) and add before the `describe('Stop', …)` block:

```ts
// Seen live on 2026-09-13 (act two, round 2): one xdotool command the computer did not answer in
// 15 s ended the run, and the goal had to be sent again. One unanswered action is now an error
// result with a fresh screenshot; the run ends on the second in a row, or when the helper is gone.
describe('an action the computer does not answer', () => {
  const click = computerUse('left_click', { coordinate: [10, 20] })

  function errorResult(model: FakeModel, call: number): { text: string; images: number } {
    const block = lastUserContent(model, call)[0]
    if (!block || typeof block !== 'object' || !('content' in block) || !Array.isArray(block.content)) throw new Error('no tool result content')
    const text = block.content.find((b: { type: string }) => b.type === 'text')
    return { text: text && 'text' in text ? String(text.text) : '', images: block.content.filter((b: { type: string }) => b.type === 'image').length }
  }

  it('gets an error result with a fresh screenshot and the run goes on', async () => {
    const model = new FakeModel([message([click]), message([textBlock('Went on.')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'Went on.' })

    expect(sandbox.methods()).toEqual(['leftClick', 'screenshot'])
    const result = lastUserContent(model, 1)[0]
    expect(result).toMatchObject({ type: 'tool_result', toolset_name: 'computer', is_error: true })
    expect(errorResult(model, 1)).toEqual({ text: noAnswerText('left_click'), images: 1 })
    const logged = t.events.find((e) => e.type === 'tool_result')
    expect(logged).toMatchObject({ ok: false, summary: noAnswerText('left_click'), shot: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(t.states).toEqual([])
    expect(t.chat.map((m) => m.text)).toEqual(['Went on.'])
  })

  it('the second failure in a row ends the run as before', async () => {
    const model = new FakeModel([message([click]), message([textBlock('never')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('deadline exceeded')
    sandbox.screenshotError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'Error' })

    expect(sandbox.methods()).toEqual(['leftClick', 'screenshot'])
    expect(t.chat.at(-1)?.text).toMatch(/^I was doing left_click at \[10, 20\]; my computer stopped answering, so I stopped\./)
    expect((await store.readBot(botId)).state).toBe('idle')
  })

  it('a helper that no longer answers ends the run at the first failure, without a screenshot', async () => {
    const model = new FakeModel([message([click]), message([textBlock('never')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('socket hang up')
    sandbox.companion.health = async () => ({ ok: false, cdp: false })
    const t = makeContext({ store, botId, model, sandbox })

    expect((await runLoop(t.ctx, goal)).outcome).toBe('failed')

    expect(sandbox.methods()).toEqual(['leftClick'])
    expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'failed' })
  })

  it('an approved action the computer does not answer spends its approval and asks the model to propose again', async () => {
    const submit: ElementInfo = { ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Schedule Event', isSubmit: true, inForm: true }
    const gated = computerUse('left_click', { coordinate: [300, 400] })
    const model = new FakeModel([message([gated]), message([gated]), message([textBlock('done')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.companion.elements = [submit]
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })
    const approval = t.ctx.approvals.propose(botId, 'run-1', 0, { kind: 'book', target: 'Schedule Event', path: '/form' })
    t.ctx.approvals.resolve(approval.id, 'allowed')
    t.decisions.push('denied')

    await runLoop(t.ctx, goal)

    // The first click ran (and got no answer); the second hit the gate again, because the approval is spent.
    expect(sandbox.methods().filter((m) => m === 'leftClick')).toHaveLength(1)
    const gates = t.events.filter((e) => e.type === 'gate')
    expect(gates.map((e) => (e.type === 'gate' ? e.decision : ''))).toEqual(['consume', 'block'])
    expect(gates[0]).toMatchObject({ approvalId: approval.id, reason: expect.stringContaining('unknown') })
    expect(t.ctx.approvals.get(approval.id)?.consumed).toBe(true)
    expect(errorResult(model, 1).text).toBe(noAnswerText('left_click', 'Schedule Event'))
    expect(errorResult(model, 1).text).toContain('propose it again')
  })

  it('an answered action in between resets the count, so a later single failure is handled again', async () => {
    const model = new FakeModel([message([click]), message([computerUse('screenshot')]), message([click]), message([textBlock('ok')], 'end_turn')])
    const sandbox = new FakeSandbox()
    sandbox.clickError = new Error('deadline exceeded')
    const t = makeContext({ store, botId, model, sandbox })
    const emit = t.ctx.emit
    t.ctx.emit = async (body) => {
      // The computer fails the third action too, after the screenshot in between was answered.
      if (body.type === 'step' && body.step === 3) sandbox.clickError = new Error('deadline exceeded')
      await emit(body)
    }

    expect((await runLoop(t.ctx, goal)).outcome).toBe('done')

    expect(sandbox.methods()).toEqual(['leftClick', 'screenshot', 'screenshot', 'leftClick', 'screenshot'])
    expect(t.events.filter((e) => e.type === 'tool_result').map((e) => e.type === 'tool_result' && e.ok)).toEqual([false, true, false])
  })
})
```

- [ ] Run `pnpm exec vitest run src/server/agent/run.test.ts`; the five new tests fail (no `noAnswerText`, the run ends on the first failure).
- [ ] In `src/server/agent/run.ts`, after `const STOPPED_RESULT = …`, add:

```ts
/**
 * The error result for an action the computer did not answer (a timeout, a dropped connection).
 * With a target, the action was the one the user approved: whether it happened is unknown, so the
 * approval is spent and the model must look and propose again.
 */
export function noAnswerText(action: string, approvedTarget: string | null = null): string {
  const base = `${action} got no answer from the computer in time; here is a fresh screenshot, check the page and go on`
  if (approvedTarget === null) return base
  return `${base}. It was the action you approved ("${approvedTarget}"): whether it happened is unknown, so that approval is spent; if the page shows it did not happen, propose it again`
}
```

- [ ] In `runLoop`, after `let lastAction = 'starting'`, add:

```ts
  // One action the computer did not answer is handed to the model as an error result while the
  // companion still answers; the second in a row ends the run (act two, round 2: a 15 s timeout on
  // one xdotool command killed the reply run, and the goal had to be sent again).
  let lastFailed = false
  const companionAnswers = async (): Promise<boolean> => {
    try {
      return (await ctx.sandbox.companion.health()).ok
    } catch {
      return false
    }
  }
```

- [ ] In `handleComputer`, replace the `try { outcome = await executeAction(…) } catch (e) { … }` block with:

```ts
    let outcome: Awaited<ReturnType<typeof executeAction>>
    try {
      outcome = await executeAction(parsed, ctx.sandbox, lastShot)
    } catch (e) {
      if (e instanceof SandboxActionError) {
        // A command that failed inside the sandbox (an unknown key name, for example) is the
        // action's problem, not the computer's: the model gets an error result and the run goes on.
        // The approval, if any, stays unconsumed: the approved action has not happened.
        markPhase('model')
        const text = `${parsed.name} failed on the computer: ${e.message.slice(0, SUMMARY_CHARS)}`
        await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: false, summary: text, shot: null })
        return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: text }, stuck: false }
      }
      // The computer did not answer. Once, while the helper still answers, the model gets an error
      // result with a fresh screenshot; a second failure in a row, or a helper that is gone, ends
      // the run through the catch at the end of the loop. A failing fresh screenshot is that second
      // failure. An approved action may or may not have happened: its approval is spent.
      if (lastFailed || !(await companionAnswers())) throw e
      lastFailed = true
      log.warn('the computer did not answer an action; the model gets an error result', { botId: ctx.botId, runId: ctx.runId, step, action: parsed.name, ...errorFields(e) })
      let approvedTarget: string | null = null
      if (verdict.consume) {
        ctx.approvals.consume(verdict.consume.approvalId)
        approvedTarget = ctx.approvals.get(verdict.consume.approvalId)?.target ?? ''
        await ctx.emit({
          type: 'gate',
          step,
          decision: 'consume',
          rule: verdict.consume.rule,
          announced: verdict.consume.announced,
          approvalId: verdict.consume.approvalId,
          reason: 'the computer did not answer; whether the approved action happened is unknown, so the approval is spent',
        })
      }
      const png = await ctx.sandbox.screenshot()
      markPhase('model')
      lastShot = png
      const text = noAnswerText(parsed.name, approvedTarget)
      const hash = await ctx.store.writeShot(ctx.botId, ctx.runId, png)
      await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: false, summary: text, shot: hash })
      const result: Anthropic.Messages.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: block.id,
        toolset_name: 'computer',
        is_error: true,
        content: [
          { type: 'text', text },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } },
        ],
      }
      shots.push({ block: result, step })
      return { result, stuck: false }
    }
    lastFailed = false
    markPhase('model')
```

  (the line `markPhase('model')` that followed the old catch block is the one shown last here; nothing else after it changes).
- [ ] Run `pnpm exec vitest run src/server/agent/run.test.ts && pnpm typecheck`; every test green, the old "ends with failed … when the sandbox throws" test included (its screenshot fails every time, so the fresh screenshot is the second failure).
- [ ] In `README.md`, under `## Known limits`, add a bullet: `- One computer action the computer does not answer (a 15-second command timeout, a dropped connection) is handed to the bot as an error with a fresh screenshot, and it goes on; the second in a row ends the run with "my computer stopped answering". An approved action that got no answer may or may not have happened: its approval is spent, and the bot must look and propose it again. A computer that fails every other action never trips the two-in-a-row rule; the step and model-call budgets end such a run instead.`
- [ ] **Commit** `Let a run survive one unanswered computer action`.

### Task 3: A doubt is a warning on the card, never a question in chat [mechanical] [demo-path]

**Files:** Modify `src/server/agent/prompt.ts`; Test `src/server/agent/prompt.test.ts`.
**Invariant:** 4 — the user decides on the card; the bot neither acts alone on suspicion nor stops on it.
**Demo step:** act two, the unprompted routine run — the filmed scene. On 2026-09-13 at 17:46 UTC the bot refused two invitations as phishing and asked in chat, although the skill said doubts go on the card; a skill-level fix (fix 4) is in the fixture, this line says it for every skill.
**Verify:** `pnpm exec vitest run src/server/agent/prompt.test.ts && pnpm typecheck`

- [ ] In `src/server/agent/prompt.test.ts`, add after the test "says that questions go through ask_user …":

```ts
  // Act two, round 2 (2026-09-13): three signs of a fake at once made the model ask in chat instead
  // of proposing, against its skill. The rule now stands in the prompt for every skill.
  it('says that a doubt is a warning on the card, never a reason to stop or to ask first', () => {
    const prompt = buildSystemPrompt({ bot, memory: '', skills: [search], activeSkill: null })
    expect(prompt).toContain(DOUBT_RULE)
    expect(DOUBT_RULE).toContain('never a reason to stop or to ask first')
    expect(DOUBT_RULE).toContain('the user decides on the card')
  })
```

  and add `DOUBT_RULE` to the import from `./prompt`.
- [ ] Run `pnpm exec vitest run src/server/agent/prompt.test.ts`; it fails on the missing export.
- [ ] In `src/server/agent/prompt.ts`, after `INTERVIEW_RULE`, add:

```ts
export const DOUBT_RULE =
  'Doubt rule: a doubt about a sender, a page or a link — a personal address, a job you never applied to, a strange link, even all of them at once — is a warning on the approval card, never a reason to stop or to ask first. Propose the action with every doubt listed as a warning; the user decides on the card.'
```

  and in `buildSystemPrompt`, insert `DOUBT_RULE,` into the `rules` array right after the `'Approval rule: …'` entry.
- [ ] Run `pnpm exec vitest run src/server/agent/prompt.test.ts && pnpm typecheck`; green.
- [ ] **Commit** `Say in the prompt that a doubt is a warning on the card, never a question`.

### Task 4: The TODO item and this plan's status [mechanical] [support]

**Files:** Modify the private backlog, `docs/plans/2026-09-13-after-round-2-plan.md`.
**Invariant:** none touched.
**Demo step:** support: the next session starts from the private backlog's first unchecked item, and a plan without a status banner reads as work still to do (delivery constraint 1 for the reader, the repo rule for plans).
**Verify:** `pnpm preflight`

- [ ] In the private backlog, section 2, replace the unchecked item `- [ ] Fixes after round 2 — run /implement on …` (added on approval, right before `- [ ] Act two, round 3, unprompted`) with this ticked item (the angle-bracket fields are filled in at execution with the real date, shas, test count and the Task 1 live result; none may stay):

```markdown
- [x] Fixes after round 2 — done <date> from `docs/plans/2026-09-13-after-round-2-plan.md` (the owner's
      "all three", 2026-09-13 evening): the bot's computer runs in the operator's `TZ` (Chrome started
      with it, the clock set with sudo, a marker file so an existing computer restarts its browser
      once); one unanswered computer action becomes an error result with a fresh screenshot and only
      the second in a row ends the run, an approved action's approval spent; the doubt rule in the
      prompt. Commits <sha>, <sha>, <sha>; preflight green at <n> tests. Live: the "say hello" run
      after Task 1 (<result>); the rest in round 3.
```

  and in the round-3 item, change `Before it: yesterday's invitation deleted from the bot's inbox, the round-2 booking cancelled, and ideally the dev Google account renamed` to `Before it: the fixes plan shipped (above), the round-2 booking cancelled (yesterday's invitation is already in the Trash), and ideally the dev Google account renamed`.
- [ ] At the top of this plan, add the status banner in the style of `docs/plans/2026-09-13-reliability-pass-plan.md` (SHIPPED, the commits, plan-vs-reality corrections, library drift: none, the result of Task 1's live check).
- [ ] Run `pnpm preflight` with the full output written to a file in the scratchpad; green.
- [ ] **Commit** `Mark the after-round-2 plan shipped and tick its TODO item`.

## Verification Criteria

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | The bot's computer shows the operator's zone: a scheduling page opens in Central European Time without the picker, and the panel clock in the stream reads Prague time. **Human-observable.** | Act two, round 3: the Calendly page under "Time zone" says Central European Time before any click; the top-right clock in the stream matches the owner's watch. Right after Task 1: a "Say hello" run (pennies) resumes the computer; the log line `browser zone differs from TZ; … restarting the browser once` appears with `recorded: null`, and the stream's clock is local. |
| 2 | An existing computer restarts its browser once and keeps its logins. **Human-observable.** | Round 3: the mailbox opens without a sign-in takeover after the first connect of this version; the second connect logs no restart. |
| 3 | One unanswered action is handed to the model as an error with a fresh screenshot and the run goes on; the second in a row, or a helper that is gone, ends the run as before. | The five tests of Task 2 (`run.test.ts`). Not provoked live: a timeout cannot be produced on purpose; the record says "tests only". |
| 4 | An approved action that got no answer spends its approval, the gate event says why, and the model is told to look and propose again. | Test 4 of Task 2. |
| 5 | The prompt carries the doubt rule, and the unprompted routine run proposes with its doubts as warnings instead of asking. **Human-observable.** | The prompt test of Task 3; live: round 3's routine run ends on an approval card with warnings, no question in chat. |
| 6 | Nothing else changed: typecheck, every test and the site-name grep are clean. | `pnpm preflight` (323 tests before this plan, the new ones on top). |
| 7 | A clean clone reads the new behaviour in the README. | The "What you see" sentence and the two "Known limits" bullets of Tasks 1 and 2. |

## Test Plan

- Task 1: `pnpm exec vitest run src/server/sandbox src/server/agent/runner.test.ts` (the pure helpers `chromeEnv` and `clockCommand`; the manager and runner tests with the new constructor argument). The threading of the zone from the config to the E2B calls is enforced by the types (`pnpm typecheck`: a call without the zone does not compile), and proven live by the "Say hello" run and round 3. No test mocks the sandbox to assert the mock.
- Task 2: `pnpm exec vitest run src/server/agent/run.test.ts` (five new tests, offline, fake sandbox and fake model; the existing "sandbox throws" test unchanged).
- Task 3: `pnpm exec vitest run src/server/agent/prompt.test.ts`.
- Every test runs offline against a temp folder; none needs a key. The live criteria (1, 2, 5) need the E2B and Anthropic keys and the owner at the keyboard: the "Say hello" run after Task 1, then act two, round 3.
- End: `pnpm preflight` with the full output written to a file in the scratchpad (never piped through `tail` alone).

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan.
2. `git log --oneline -8`: the commits are titled as in the tasks' **Commit** lines, in task order.
3. Pick up from the first task whose commit is missing; run its Verify command first to see which of its steps already landed.

## Backbrief

**End-state.** Four commits on `main`: the E2B layer starts Chrome with the operator's `TZ` and sets the computer's clock, restarting the browser once on a computer from before; the run loop turns one unanswered computer action into an error result with a fresh screenshot and ends the run only on the second in a row or a dead helper, spending an approved action's approval; the prompt says a doubt is a warning on the card. A viewer of round 3 sees the Calendly page open in Prague time with no picker, the panel clock right, and the unprompted routine run end on a card with warnings instead of a question.

**Critical constraints.** The zone comes from `config.TZ` only and reaches the sandbox through function parameters, never through the process environment of the server or a literal; the marker check runs on every connect, and the restart happens at most once per zone change. An approved action that got no answer is never retried by the platform: its approval is consumed before the model sees the error, and the gate event says why. The run still ends on the second failure in a row and on a companion that does not answer; the existing "sandbox throws" test keeps passing without edits.

**Latitude.** `/implement` decides the exact log field names, the order of the two "Known limits" bullets, and whether Task 1's day-one script change is one commit with the rest of the task (it is) or a separate one; it may split a task's tests into their own describe blocks and rename test titles, but not weaken the assertions listed here.
