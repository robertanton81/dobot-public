# Screen Ownership Implementation Plan

**Goal:** No model sees a screen a human had until a check passes, even after a restart, sleep or
the end of a hold. While the bot works, no stream URL sends input.
**Approach:** One persisted flag, `screenCheckDue` on `bot.json`, and x11vnc's runtime view-only
switch, tied together so that input is on only while the flag is true. One per-bot screen lock in
`Runner` orders every transition. The goal-start check reads the flag, not the in-memory maps.
**Design spec:** [docs/specs/2026-09-25-screen-ownership-design.md](../specs/2026-09-25-screen-ownership-design.md) (approved 2026-09-25)
**TODO items:** the private backlog section 4, "Screen safety across restart and old interactive URLs"
**Branch:** `main`, one commit per task (standing rule: decided fixes land in `main`; the owner pushes)
**Scope:** `src/server/store/`, `src/server/sandbox/`, `src/server/agent/runner.ts`,
`src/server/agent/takeover.ts`, `src/server/http/app.ts`, `src/web/`, `docs/decisions.md`,
`docs/operating-guide.md`
**Build estimate:** The owner's hours: about 15 minutes, for one live step in `/verify` (type a
password into a field on the bot's screen and leave it). Live-run cycles: one, the spec's demo path
(one refused routine, one normal goal; the model cost of one short run). The x11vnc probe is done.

## Research (source links)

All from the spec; nothing new is needed.

- `@e2b/desktop` 2.4.0, `node_modules/@e2b/desktop/dist/index.mjs:451-502`: one stream password; `view_only` is a URL parameter; `sandbox.display` is the X display; `sandbox.commands.run(cmd, { envs, timeoutMs })`.
- [x11vnc OPTIONS](https://raw.githubusercontent.com/LibVNC/x11vnc/master/doc/OPTIONS.md): `-remote`/`-R viewonly|noviewonly`, `-sync`, `-query viewonly`, `-display`.
- [Probe of 2026-09-25](../evidence/2026-09-25-screen-ownership/README.md): on the template's x11vnc 0.9.16, `-sync -R viewonly` answers `ack=1` and `ans=viewonly:1`, discards input from new and already-connected clients; `noviewonly` restores it. The query prints `ans=viewonly:1` or `ans=viewonly:0`.
- [E2B persistence](https://docs.e2b.dev/sandbox/persistence): pause keeps processes, so a page with a secret survives a pause.

## File Changes

| Action | Path | Purpose |
| --- | --- | --- |
| Modify | `src/server/store/types.ts` | `screenCheckDue` on `Bot`, default `false` |
| Modify | `src/server/store/store.test.ts` | the field's default and persistence |
| Modify | `src/server/agent/recovery.test.ts` | recovery keeps the flag |
| Modify | `src/server/sandbox/e2b.ts` | `setHumanInput` on the session; every new stream starts with input off |
| Modify | `src/server/sandbox/manager.ts` | `streamGeneration(botId)` |
| Modify | `src/server/sandbox/manager.test.ts` | generation per started session; fake session gains `setHumanInput` |
| Modify | `src/server/agent/fakes.ts` | `fakeSession()`, one fake `SandboxSession` that records input switches |
| Modify | `src/server/agent/runner.ts` | screen lock, grant, give-back, goal-start check on the flag, timers switch input off, poll repair |
| Modify | `src/server/agent/takeover.ts` | `giveBack` hook before the loop resumes |
| Modify | `src/server/agent/runner.test.ts` | the behaviour of every row in the spec's state table |
| Modify | `src/server/http/app.ts` | the stream route calls `runner.grantTakeover`; the state route returns `streamGeneration` |
| Modify | `src/server/http/app.test.ts` | route answers for grant refusals and the generation |
| Modify | `src/web/api.ts` | `streamGeneration` in the stream and state answers |
| Modify | `src/web/takeover-view.ts` | `needsFreshInteractive()` |
| Modify | `src/web/takeover-view.test.ts` | its cases |
| Modify | `src/web/App.tsx` | fetch the interactive URL again when the generation changes |
| Modify | `docs/decisions.md`, `docs/operating-guide.md` | the known gap closed, the new trade-off |

## Tasks

### Task 1: The persisted flag [mechanical] [support]

**Files:** Modify `src/server/store/types.ts`, Test `src/server/store/store.test.ts`, `src/server/agent/recovery.test.ts`
**Invariant:** 6 (the flag survives a restart) and 5 (recovery never clears it). Proven by the two tests.
**Demo step:** row 3 (recovery leaves the flag). Every later task reads it.
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/store src/server/agent/recovery.test.ts`

- [ ] Write failing tests. In `store.test.ts`:

```ts
describe('the screen check flag', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dobot-flag-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('is false for a bot.json written before the field existed, and survives a write', async () => {
    const s = createStore(dir)
    const id = (await s.createBot({ name: 'Old', persona: 'p' })).id
    const path = join(dir, 'bots', id, 'bot.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    delete raw.screenCheckDue
    await writeFile(path, JSON.stringify(raw))
    expect((await s.readBot(id)).screenCheckDue).toBe(false)
    await s.updateBot(id, { screenCheckDue: true })
    expect((await createStore(dir).readBot(id)).screenCheckDue).toBe(true)
  })
})
```

  In `recovery.test.ts`, one case: a bot with `state: 'blocked'` and `screenCheckDue: true`;
  after `recoverAtBoot(store)` the bot is `idle` and `screenCheckDue` is still `true`.
- [ ] Verify the tests fail (the field does not exist).
- [ ] In `Bot` (`types.ts`), add after `routines`:

```ts
  /**
   * True from the moment a human is given input on the bot's screen until a check shows the page
   * is safe and input is off again. The next goal checks the screen while it is true. Kept on disk,
   * so a restart, a sleep or the end of a hold cannot skip the check (invariant 5).
   */
  screenCheckDue: z.boolean().default(false),
```

  `createBot` builds the bot through `Bot.parse`, so the default applies; check that it does, and
  add `screenCheckDue: false` to its literal if it does not.
- [ ] Verify the tests pass and `pnpm typecheck` is clean (every `Bot` literal in tests must still compile; the field is optional on input because of the default, required on output).
- [ ] Commit: `Persist whether a bot's screen needs a check before the model sees it`

### Task 2: The input switch and the stream generation [integration] [demo-path]

**Files:** Modify `src/server/sandbox/e2b.ts`, `src/server/sandbox/manager.ts`, `src/server/agent/fakes.ts`, Test `src/server/sandbox/manager.test.ts`, and every test literal of a `SandboxSession` (`src/server/agent/runner.test.ts:49`, `:59`, `:472`, `:1269`, `src/server/http/app.test.ts` `beginIdleTakeover` stand-in (`:49`) and the `get` stand-in (`:263`), `src/server/sandbox/manager.test.ts:37`)
**Invariant:** 5 and 4: input from a stream URL is refused by the VNC server while the bot owns the screen. Proven live by the probe and in `/verify` row 7; the switch itself runs only in a sandbox, so no unit test mocks it.
**Demo step:** rows 1, 5 and 7.
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/sandbox`

- [ ] Write a failing test in `manager.test.ts`: two `ensureRunning` calls with a pause in between
  (the factory's `connect` is called twice) give `streamGeneration('bot')` 1 and then 2, and it is
  `null` for a bot with no session.
- [ ] Verify it fails.
- [ ] In `e2b.ts`, extend `SandboxSession`:

```ts
  /**
   * Turns VNC input on or off for every client of this stream, through x11vnc's view-only switch.
   * The server enforces it, whatever a URL says. Throws unless x11vnc confirms the new mode.
   */
  setHumanInput(on: boolean): Promise<void>
```

  and add, next to `startStream`:

```ts
const INPUT_SWITCH_TIMEOUT_MS = 15_000

/** x11vnc's global view-only mode, set and read back. The display comes from the SDK. */
async function switchInput(raw: Sandbox, on: boolean): Promise<void> {
  const envs = { DISPLAY: raw.display }
  const mode = on ? 'noviewonly' : 'viewonly'
  const options = { envs, timeoutMs: INPUT_SWITCH_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS }
  await raw.commands.run(`x11vnc -display "$DISPLAY" -sync -R ${mode}`, options)
  const answer = (await raw.commands.run('x11vnc -display "$DISPLAY" -query viewonly', options)).stdout
  const want = on ? 'viewonly:0' : 'viewonly:1'
  if (!answer.includes(`ans=${want}`)) throw new Error(`the stream did not confirm ${mode}`)
}
```

  In `startStream`, after `raw.stream.start(...)` and before the URLs are built:
  `await switchInput(raw, false)`, with a comment: a new stream starts with input off, so no URL
  leaves before the server refuses its input. In `startSession`, add
  `setHumanInput: (on) => switchInput(raw, on)` to the returned object.
- [ ] In `manager.ts`: a `private readonly generations = new Map<string, number>()`; in `start()`,
  after each `this.sessions.set(botId, session)`, `this.generations.set(botId, (this.generations.get(botId) ?? 0) + 1)`.
  Add:

```ts
  /** Raised each time a session starts for the bot: a new stream, with a new key. Null while no session is up. */
  streamGeneration(botId: string): number | null {
    return this.sessions.has(botId) ? (this.generations.get(botId) ?? null) : null
  }
```

- [ ] In `fakes.ts`, add one fake session the other tests use from now on:

```ts
/** A SandboxSession around a FakeSandbox. `inputs` records every input switch, in order; `failInput` makes the next switch throw. */
export function fakeSession(sandbox: FakeSandbox, over: Partial<SandboxSession> = {}) {
  const inputs: boolean[] = []
  const control = { failInput: false }
  const session: SandboxSession = {
    sandbox,
    sandboxId: 'sbx-1',
    streamViewUrl: 'https://v.example/view',
    streamInteractiveUrl: 'https://v.example/full',
    keepAlive: async () => undefined,
    pause: async () => 'paused' as const,
    syncWorkspace: async () => undefined,
    setHumanInput: async (on) => {
      if (control.failInput) {
        control.failInput = false
        throw new Error('the stream did not confirm')
      }
      inputs.push(on)
    },
    ...over,
  }
  return { session, inputs, control }
}
```

  Replace the session literals listed under **Files** with `fakeSession(...)` (or add
  `setHumanInput: async () => undefined` where a literal must stay).
- [ ] Verify the test passes and `pnpm typecheck` is clean.
- [ ] Commit: `Switch stream input with x11vnc's view-only mode, and start every stream with input off`

### Task 3: The screen lock and the grant [integration] [demo-path]

**Files:** Modify `src/server/agent/runner.ts`, `src/server/http/app.ts`, Test `src/server/agent/runner.test.ts`, `src/server/http/app.test.ts`
**Invariant:** 5: input turns on only after the flag is true (spec decision 6). Proven by the order test and the race test.
**Demo step:** rows 1 and 5.
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/agent/runner.test.ts src/server/http/app.test.ts`

- [ ] Write failing tests in `runner.test.ts`, `describe('taking the screen')`:
  1. Idle bot with a running computer: `grantTakeover` returns the interactive URL and the
     generation; `bot.json` has `screenCheckDue: true`; `inputs` is `[true]`; and the flag was true
     before the input call (record the flag inside `setHumanInput` through `store.readBot`).
  2. The input call fails: `{ ok: false, status: 409 }`, `screenCheckDue` true, no URL.
  3. A run is active and the bot is `working`: refused with 403, flag and input untouched.
  4. Race: start a goal (`runner.accept`) and `grantTakeover` in the same tick on an idle bot with
     a safe page. Whatever order the lock gives, the end state has `inputs` ending in `false`
     while the run is active, or the grant refused; never input on during the run. Assert on the
     sequence of `inputs` and the run's `status` events.
  In `app.test.ts`: `GET /stream?mode=interactive` answers with `runner.grantTakeover`'s result
  (`{ url, streamGeneration }` or `{ error }` with its status).
- [ ] Verify they fail.
- [ ] In `runner.ts`, add the lock and the grant:

```ts
  /** One chain per bot: every change of who owns the screen runs after the one before it. Never taken twice for one bot on one call path. */
  private readonly screenChains = new Map<string, Promise<unknown>>()

  private screenLock<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.screenChains.get(botId) ?? Promise.resolve()
    const next = previous.then(() => work(), () => work())
    this.screenChains.set(botId, next)
    return next.finally(() => {
      if (this.screenChains.get(botId) === next) this.screenChains.delete(botId)
    })
  }

  /**
   * The only way a human gets input on the screen. The flag is written before input turns on, so
   * input on always means a check is due, whatever fails in between. Idle: the computer is held
   * through beginIdleTakeover first, outside the lock. Blocked: the run's takeover or a blocked
   * end holds it already.
   */
  async grantTakeover(botId: string): Promise<{ ok: true; url: string; streamGeneration: number | null } | { ok: false; status: 403 | 409 | 500; error: string }> {
    const first = await this.deps.store.readBot(botId)
    if (first.state !== 'blocked' && first.state !== 'idle') return { ok: false, status: 403, error: 'the bot is working; press Take over first' }
    const session = first.state === 'idle' ? await this.beginIdleTakeover(botId) : this.deps.sandboxes.get(botId)
    if (!session) return { ok: false, status: 409, error: 'the takeover could not start: a goal took the computer, or it is not running; try again in a moment' }
    return this.screenLock(botId, async () => {
      const bot = await this.deps.store.readBot(botId)
      const owned = bot.state === 'blocked' || (bot.state === 'idle' && !this.activeRuns.has(botId))
      if (!owned) return { ok: false as const, status: 409 as const, error: 'the bot took its screen back; try again when it is done' }
      try {
        await this.deps.store.updateBot(botId, { screenCheckDue: true })
      } catch (e) {
        log.error('could not record that the screen needs a check; no input given', { botId, ...errorFields(e) })
        return { ok: false as const, status: 500 as const, error: 'the takeover could not start; try again' }
      }
      try {
        await session.setHumanInput(true)
      } catch (e) {
        log.warn('could not give the stream input', { botId, ...errorFields(e) })
        return { ok: false as const, status: 409 as const, error: 'the takeover could not start: the screen did not accept input; try again' }
      }
      return { ok: true as const, url: session.streamInteractiveUrl, streamGeneration: this.deps.sandboxes.streamGeneration(botId) }
    })
  }
```

  Add `'grantTakeover'` to `RunnerPort` in `app.ts` (and remove `'beginIdleTakeover'` if no route
  uses it any more). Replace the interactive branch of the stream route:

```ts
    if (mode === 'interactive') {
      const granted = await runner.grantTakeover(loaded.bot.id)
      if (!granted.ok) return c.json({ error: granted.error }, granted.status)
      return c.json({ url: granted.url, streamGeneration: granted.streamGeneration })
    }
```

  `SandboxesPort` in `app.ts` stays as it is; the runner reaches the manager through `this.deps.sandboxes`.
  The route's existing `if (!session) return 409 'the computer is not running'` before the mode
  branch stays: it answers "no computer at all". `grantTakeover`'s own 409s answer the races after
  that (a goal took the screen, the hold could not start).
- [ ] Verify the tests pass.
- [ ] Commit: `Give a human input on the screen only after recording that a check is due`

### Task 4: Giving the screen back [integration] [demo-path]

**Files:** Modify `src/server/agent/runner.ts`, `src/server/agent/takeover.ts`, Test `src/server/agent/runner.test.ts`
**Invariant:** 5: input goes off before the flag clears, and the flag clears only after a passing check.
**Demo step:** row 5.
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/agent/runner.test.ts src/server/agent/takeover.test.ts`

- [ ] Write failing tests:
  1. Hand-back without a run (idle takeover) on a safe page: `inputs` ends with `false`, then the
     flag is `false` (assert the order the same way as in Task 3).
  2. The same, with `control.failInput = true`: `{ ok: false }` with `INPUT_BACK_REASON`, flag
     still `true`.
  3. An unsafe page: refused as today, `inputs` unchanged, flag `true`.
  4. In-run takeover (existing pattern in `describe('Stop')`): the hand-back switches input off
     and clears the flag before the loop's next model call (the `FakeModel` records no call until
     `inputs` ends with `false`). With `failInput`, the hand-back is refused and the loop still waits.
  5. Stop during an in-run takeover: the flag stays `true` and `inputs` is unchanged.
- [ ] Verify they fail.
- [ ] In `takeover.ts`: export
  `export const INPUT_BACK_REASON = "I could not take the screen's input back; try again"`, map it to
  `'unanswered'` in `handbackCode`, add `giveBack?: () => Promise<void>` to `TakeoverDeps` with the
  comment "Runs after the check passes and before the loop resumes: input off, then the flag. A
  throw refuses the hand-back.", and in `handback`, after the `if (!result.allowed)` block and
  before `this.waiting = null`:

```ts
    try {
      await this.deps.giveBack?.()
    } catch (e) {
      log.warn('the screen could not be taken back; the hand-back is refused', { botId: this.deps.botId, ...errorFields(e) })
      return { ok: false, reason: INPUT_BACK_REASON }
    }
    if (this.waiting !== waiting) return { ok: true }
```

- [ ] In `runner.ts`, add `INPUT_BACK_REASON` to the import from `./takeover` (`runner.ts:14`), and one unlocked helper, used by every give-back:

```ts
  /** After a passing check: input off, then the flag. Runs inside the screen lock of its caller; takes no lock itself. */
  private async takeScreenBack(botId: string, session: SandboxSession): Promise<void> {
    await session.setHumanInput(false)
    await this.deps.store.updateBot(botId, { screenCheckDue: false })
  }
```

  Pass `giveBack: () => this.takeScreenBack(botId, session)` to the `TakeoverController` in `run()`.
  Wrap the controller path of `Runner.handback` as `return this.screenLock(botId, () => controller.handback(force))`.
  In the no-run path of `Runner.handback`, put everything after `safeWithoutRun(botId, true)` inside
  `this.screenLock(botId, ...)`: read the check again inside the lock with `safeWithoutRun(botId)`;
  when allowed, get `const session = this.deps.sandboxes.get(botId)`; if a session exists call
  `takeScreenBack` in a try, and on a throw return `{ ok: false, reason: INPUT_BACK_REASON }`; when no
  session exists (after a restart), return `{ ok: true }` without touching the flag (spec: the next
  goal is the check that counts). The rest of the path (idle takeover end, blocked to idle) follows unchanged.
- [ ] Verify the tests pass.
- [ ] Commit: `Take input back and clear the check flag only after a hand-back check passes`

### Task 5: The check at goal start [integration] [demo-path]

**Files:** Modify `src/server/agent/runner.ts`, Test `src/server/agent/runner.test.ts`
**Invariant:** 5: after a restart, sleep or the end of a hold, the model never sees a screen a human had before a check passes. Proven by a test that builds a fresh `Runner` on a store whose bot has `screenCheckDue: true`.
**Demo step:** rows 3, 4 and 6.
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/agent/runner.test.ts`

- [ ] Write failing tests, `describe('a goal on a screen that needs a check')`:
  0. Every refusal below leaves `bot.state` as asserted, and no `status` event with `botState: 'working'` is emitted for a refused goal.
  1. Restart: a fresh `Runner` and `SandboxManager`, bot `idle`, `screenCheckDue: true`, the fake
     companion's `pageState` answers `unsafe`. A routine goal ends `{ outcome: 'blocked' }` with
     summary `not started: <UNSAFE_REASON>`; the model has no call; no screenshot was taken; the bot
     is `blocked`; the chat has one active takeover card with the reason and one bot line from
     `notStartedText`; the notifier got `refused`; the flag is still `true`.
  2. The same with a safe page: `inputs` is `[false]`, the flag is `false`, the model gets its call.
  3. `screenCheckDue: false`: `pageState` is never called.
  4. A blocked hold exists (the existing `describe('the blocked hold')` setup) and the page is
     unsafe: no second takeover card, the old hold stands (one keep-alive interval, not two), one
     notice for the hold; `bot.state` stays `blocked`.
  5. An idle takeover is active and the page is unsafe: the bot state stays `idle`, no card, and the
     run's `'run'` hold is released (the manager's holders are only `'takeover'`).
  6. The computer does not start (`ensureRunning` throws): `failed` as today, flag unchanged.
  6b. The same while a blocked hold (or an idle takeover) stands: only the failure chat line is
     posted; `bot.state`, the active takeover card, the hold's keep-alive and its timer are unchanged.
  7. `failInput` on the give-back: the goal ends `blocked` as in case 1, with the reason `INPUT_BACK_REASON`.
- [ ] Verify they fail.
- [ ] In `run()`: remove the `humanOnScreen` block before `ensureRunning`
  (`runner.ts:485-520` today), and move `setBotState('working', ...)` (`runner.ts:522`) from before
  `ensureRunning` to after the check below. The bot then keeps its state (idle or blocked) while the
  computer comes up and the screen is checked, and a refused goal never shows "working". A grant
  during that time is refused by `grantTakeover` because `activeRuns` already has the bot. The
  "could not start my computer" path keeps its chat line, but its `setBotState('idle', ...)`
  becomes conditional, as the daily-budget branch already is (`runner.ts:480-481`):

```ts
        const heldAlready = this.blockedKeepAlives.has(botId) || this.idleTakeovers.has(botId)
        // A human's hold on this screen stands: its card, state and keep-alive are not this goal's to end.
        if (!heldAlready) await setBotState('idle', 'could not start my computer')
        endedBlocked = this.blockedKeepAlives.has(botId)
```

  (`endedBlocked` true keeps the finally block from releasing the blocked hold's `'run'` holder.)
  Keep `ensureRunning` and the keep-alive where they are. Directly after the keep-alive is armed, add:

```ts
      // A human may have typed on this screen since the last check (the flag is on disk, so a
      // restart, a sleep or an ended hold cannot lose it). The model sees nothing before the page
      // is checked and input is off again.
      const refusal = await this.screenLock(botId, async () => {
        if (!(await store.readBot(botId)).screenCheckDue) return null
        const screen = await this.safeWithoutRun(botId, true)
        if (!screen.allowed) return screen.reason
        if (screen.unreadable > 0) log.warn('goal took a screen with unreadable regions on the page', { botId, runId, unreadable: screen.unreadable })
        try {
          await this.takeScreenBack(botId, session)
        } catch (e) {
          log.warn('could not take the screen back before a goal', { botId, runId, ...errorFields(e) })
          return INPUT_BACK_REASON
        }
        return null
      })
      if (refusal !== null) return await refuseOnScreen(refusal)
      if (this.blockedKeepAlives.has(botId)) {
        this.dropBlockedKeepAlive(botId)
        await this.endOpenTakeoverCard(botId)
      }
      if (this.idleTakeovers.has(botId)) {
        this.endIdleTakeover(botId)
        log.info('takeover of an idle bot ended: a goal took the computer', { botId, runId })
      }
      await setBotState('working', input.source === 'routine' ? `routine: ${input.routineName ?? ''}` : 'working')
```

  and define `refuseOnScreen` next to `stopped` inside `run()`:

```ts
    /**
     * The screen still needs its check and it failed. A human is on it (an idle takeover, or a blocked
     * hold with its card): that stays as it is. Nobody is (a restart, an ended hold): the bot is
     * blocked with a takeover card, and this run's keep-alive becomes the hold. No model call either way.
     */
    const refuseOnScreen = async (reason: string): Promise<RunResult> => {
      const summary = `not started: ${reason}`
      const heldAlready = this.blockedKeepAlives.has(botId)
      const humanOnIdle = this.idleTakeovers.has(botId)
      log.warn('run refused: the screen is not safe yet', { botId, runId, source: input.source, heldAlready, humanOnIdle, reason })
      await postChat({ role: 'bot', text: notStartedText(reason, input.routineName) })
      if (heldAlready || humanOnIdle) {
        this.clearKeepAlive(keepAlive)
        keepAlive = null
        endedBlocked = heldAlready
      } else {
        await setBotState('blocked', reason)
        await postChat({ role: 'card', card: { card: 'takeover', reason, status: 'active' } })
        endedBlocked = true
      }
      if (!this.refusedNotified.has(botId)) {
        this.refusedNotified.add(botId)
        this.callHuman(human, 'refused')
      }
      await emit({ type: 'end', outcome: 'blocked', summary })
      return { outcome: 'blocked', summary }
    }
```

  `endedBlocked` and `keepAlive` are declared before `refuseOnScreen` is defined; move the
  declaration of `endedBlocked` above it if needed. The `finally` block then holds the computer
  exactly as for a blocked end (`blockedKeepAlives.set`, `armBlockedHold`) when `keepAlive` is
  non-null and `endedBlocked` is true, and releases the `'run'` holder when `endedBlocked` is false.
  Stop during the check: the existing `if (stopSignal.signal.aborted) return await stopped()` after
  `ensureRunning` covers the start; add the same check after the lock returns.
- [ ] Verify the tests pass, and that the existing `describe('a takeover of an idle bot from the page')`
  and `describe('the blocked hold')` tests still pass. A test that expected the check on a blocked
  bot nobody took over now expects no check (spec decision 5); change it and name the decision in its comment.
- [ ] Commit: `Check the screen at goal start whenever the check flag is set, after a restart too`

### Task 6: Timers switch input off [mechanical] [support]

**Files:** Modify `src/server/agent/runner.ts`, Test `src/server/agent/runner.test.ts`
**Reason this is needed:** without it a stale interactive URL keeps input after the page stopped asking (spec decision 8, review finding).
**Invariant:** 5. Proven by the tests.
**Demo step:** row 2 (the presence timer ends the idle takeover).
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/agent/runner.test.ts`

- [ ] Write failing tests: when `endBlockedHold` runs and when the idle presence timer ends the
  takeover (fire the injected timer), `inputs` ends with `false` and the flag stays `true`. With
  `failInput`, the hold still ends and the error is logged.
- [ ] Verify they fail.
- [ ] Add one helper. Call it only from the two timer paths, which are outermost callers and hold
  no screen lock: the idle presence timer in `armIdlePresence`, right after its
  `this.endIdleTakeover(botId)`, and `endBlockedHold`, after `dropBlockedKeepAlive`. Do **not** call
  it from `endIdleTakeover` itself: that function is also reached from inside the hand-back's
  lock (Task 4) and after the goal-start check (Task 5), where input is already off, and
  `endIdleTakeover` must stay free of lock-taking code (spec: no re-entry).

```ts
  /** Nobody is on the screen any more: input off, the flag untouched, so the next goal still checks. Never throws. */
  private inputOffUnattended(botId: string): void {
    const session = this.deps.sandboxes.get(botId)
    if (!session) return
    void this.screenLock(botId, () => session.setHumanInput(false)).catch((e: unknown) =>
      log.warn('could not switch the stream input off after the hold ended; the flag still requires a check', { botId, ...errorFields(e) }))
  }
```

  `endBlockedHold` runs as a job on the run queue; it takes the screen lock inside that job, and no
  holder of the screen lock waits on the run queue, so the two cannot wait on each other. `session`
  is read before the lock is taken: the manager's session may be gone after the release, and then
  there is no stream to switch.
- [ ] Verify the tests pass.
- [ ] Commit: `Switch stream input off when a hold ends with nobody on the screen`

### Task 7: The page fetches the interactive URL again after a resume [integration] [demo-path]

**Files:** Modify `src/server/agent/runner.ts`, `src/server/http/app.ts`, `src/web/api.ts`, `src/web/takeover-view.ts`, `src/web/App.tsx`, Test `src/server/agent/runner.test.ts`, `src/server/http/app.test.ts`, `src/web/takeover-view.test.ts`
**Invariant:** 1: a human in a takeover keeps a working screen after the computer paused and resumed.
**Demo step:** the spec's failure mode "the laptop sleeps during a takeover".
**Verify:** `pnpm typecheck && pnpm exec vitest run src/server/agent/runner.test.ts src/server/http/app.test.ts src/web`

- [ ] Write failing tests:
  1. `takeover-view.test.ts`: `needsFreshInteractive(held, polled)` is true only when both are
     numbers and differ; `null` on either side is false.
  2. `runner.test.ts`: during a held idle takeover whose companion throws on `pageState`,
     `handbackState` resumes the computer (the factory's `connect` runs) and returns a raised
     `streamGeneration`. With no hold, it does not resume (`connect` not called).
  3. `app.test.ts`: `GET /takeover/state` includes `streamGeneration`.
- [ ] Verify they fail.
- [ ] `runner.ts`, `handbackState`: the no-controller path passes `repair` when a hold stands, and
  the answer carries the generation:

```ts
    const held = this.idleTakeovers.has(botId) || this.blockedKeepAlives.has(botId)
    const { allowed, reason } = await this.safeWithoutRun(botId, held)
    return { allowed, reason, streamGeneration: this.deps.sandboxes.streamGeneration(botId) }
```

  The controller path returns `{ ...(await controller.state(force)), streamGeneration: this.deps.sandboxes.streamGeneration(botId) }`.
  Widen the return type to `{ allowed: boolean; reason: string; streamGeneration: number | null }`.
- [ ] `app.ts`: the state route already spreads `state`, so it passes the field through; no change beyond the type.
- [ ] `api.ts`: `HandbackState` gains `streamGeneration: number | null`; `streamUrl` returns
  `{ url: string; streamGeneration?: number | null }`.
- [ ] `takeover-view.ts`:

```ts
/** The stream was started again (a resume gives it a new key): the interactive frame is dead and must be fetched again. */
export function needsFreshInteractive(held: number | null, polled: number | null): boolean {
  return held !== null && polled !== null && held !== polled
}
```

- [ ] `App.tsx`: a `const interactiveGeneration = useRef<number | null>(null)`, set from
  `streamGeneration` wherever `setInteractiveUrl(url)` is called with a fetched URL, and reset in
  `leaveTakeover`. In the hand-back poll, after `setHandback(state)`:

```ts
        if (needsFreshInteractive(interactiveGeneration.current, state.streamGeneration)) {
          const fresh = await api.streamUrl(selected, 'interactive')
          if (stopped) return
          interactiveGeneration.current = fresh.streamGeneration ?? null
          setInteractiveUrl(fresh.url)
        }
```

  Initialise the `setHandback` default objects with `streamGeneration: null`.
- [ ] Verify the tests pass and `pnpm build` succeeds (the page compiles).
- [ ] Commit: `Fetch the interactive stream again when a resume restarted it`

### Task 8: Record the closed gap [mechanical] [support]

**Files:** Modify `docs/decisions.md`, `docs/operating-guide.md`, `docs/build-history.md`
**Reason this is needed:** the decisions document still names this as a known gap, and a trade-off that is not written down is lost (CLAUDE.md, "Name the trade-off").
**Invariant:** none touched.
**Demo step:** none; documentation.
**Verify:** `pnpm preflight`

- [ ] `docs/decisions.md`, section "Takeover with a hand-back check enforced by the server": replace
  the paragraph "The person never types while the model acts..." and the "Known gap" paragraph with:
  the server switches input with x11vnc's view-only mode (the view URL had carried full input,
  because `view_only` is only a noVNC parameter); input is on only while `screenCheckDue` is true;
  the flag lives in `bot.json`, so the check survives restart, sleep and the end of a hold.
  **Trade-off:** during a takeover anyone holding the page's view URL can also type; in a per-team
  deployment those people can press Take over anyway. **Upgrade:** a separate view-only password
  (x11vnc `-passwdfile` with `__BEGIN_VIEWONLY__`), link the spec.
- [ ] `docs/operating-guide.md`, the screen-controls section: one paragraph on the refusal after a
  restart (what the user sees, what to do: Take over, clear the page, Hand back, send the goal again).
- [ ] `docs/build-history.md`: a short entry with the link to the spec and the probe.
- [ ] Verify `pnpm preflight` passes.
- [ ] Commit: `Record that the screen check and stream input survive restart and holds`

## Verification Criteria

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | After a restart with a password left in a field, a routine does not start: blocked, a takeover card, a notice, no model call | `/verify` live, the spec's demo path rows 1 to 4; the run log has no `cost` event |
| 2 | Take over, clear the field, Hand back: the bot is idle, the flag is false | demo rows 5; read `bot.json` |
| 3 | A normal goal after that runs and is visible live | demo row 6 |
| 4 | While the bot works, an old interactive URL and the view URL without `view_only` send no input | demo row 7: open both in a second tab, click, the pointer does not move on the view stream |
| 5 | Input on implies `screenCheckDue` true in every transition | the order tests in Tasks 3 and 4, and `pnpm test` |
| 6 | The check is skipped when no human had input | Task 5 test 3 |
| 7 | A clean clone still runs with the documented steps | `pnpm preflight` in the main tree; no new key or setting |

## Test Plan

- Offline, per task: the scoped `vitest` commands above. The fakes record input switches; no test
  mocks x11vnc itself.
- Live, in `/verify`: the demo path on the real EU sandbox, with the owner typing into a password field
  (his 15 minutes). The x11vnc behaviour is proven by the committed probe; re-run it only if the
  template changes.
- At the end: `pnpm preflight`, then a Codex review of the whole change.

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan
2. Check `git log` for completed commits (the subjects above)
3. Pick up from the first uncompleted task
