> **STATUS: SHIPPED 2026-09-13.** Landed as 11 commits from `4631c52` to `de64d4e`. The unchecked
> `- [ ]` boxes below are historical — work is done. **Do not re-execute this plan.** If you are
> modifying the limits, work directly in `src/server/agent/budget.ts`, `src/server/agent/runner.ts`
> (the budget refusal and the blocked hold), `src/server/store/routines.ts` (the density check),
> `src/server/mail/watcher.ts` (the debounce) and `src/server/config.ts` (the three settings).
>
> **Plan-vs-reality corrections discovered during execution:**
>
> **Library/version drift:** none. No package added; croner 10.0.1, vitest 5.0.0 and Node 24.21.0 as
> pinned.
>
> **Plan code prescriptions that needed adjustment:** two of the five `new Runner({ ... })` calls in
> `src/server/agent/runner.test.ts` end in `tools: [] })` with no trailing comma, so the `...LIMITS`
> spread went before the closing brace there. The log line for the held mail firing was reworded
> from the plan's "new mail held by the debounce" to "held mail fires now that the debounce is over"
> (`977eb21`), because the plan's text read as if the mail were being held at the moment it fires.
>
> **Corrections applied during review:** every Stage 1 check passed first time; the code reviewers
> found nothing blocking. The test-quality reviewer found four blocking gaps, each fixed in its own
> commit: the bounds of `ROUTINE_MIN_INTERVAL_MINUTES` and the time zone reaching croner were
> untested (`f19b34c`, the time-zone test uses a weekly noon schedule, whose smallest gap is 167 hours
> in a daylight-saving zone and 168 in UTC on any date); the refused run's `end` event was never read
> back from disk and the null and unparseable start-time guards in `spentToday` were unexercised
> (`e2b07a8`); the race where a goal takes the computer ahead of the queued hold-end job was untested
> (`0a12495`); the held-mail test could not see a missing reset of the held flag (`85e069d`, plus a
> drop-then-fire case). One code-review suggestion was promoted to a fix on the author's word: an
> unknown `TZ` is rejected at boot by name (`de64d4e`), because the budget check formats dates in it
> before every run and would otherwise end every run `failed` after one typo in `.env.local`.
>
> **Deferrals worth tracking:** (1) An unreadable first-event time is skipped with no log line; the
> platform writes every timestamp itself, so the branch is unreachable without a hand-edited file.
> (2) The budget sum is floating-point; a sub-cent shortfall could let one run start at the line,
> which assumption A5 already accepts. (3) `Runner.lastSeenOnScreen` keeps one entry per bot and is
> never cleared; bounded by the bot count, one operator. (4) The page's visibility gate in
> `src/web/App.tsx` has no test; the page has no test setup, and the typecheck covers it. (5) The
> `startedAt === null` guard in `spentToday` is pinned only by TypeScript, not by a test that would
> fail at runtime. (6) Several tests bundle sequential checkpoints into one `it`, matching the file's
> existing style. (7) Found while planning and left for the restart check in TODO section 2:
> `recoverAtBoot` sets a blocked bot idle but leaves its takeover card active. (8) The hold timers
> live in memory; after a restart E2B's own timeout pauses the computer, as before.
>
> **Plan history below is preserved as-written for context. Treat the live code as authoritative.**

# Daily Budget, Routine Density and Blocked Hold — Implementation Plan

**Goal:** Put the platform's own spending limits under the organisation limit. No run starts once
today's runs have cost the daily budget. No routine is saved to run more often than every 15
minutes. A stream of mail starts at most one run every five minutes, and no mail is dropped. A bot
that stopped for help lets its computer sleep once nobody has been on its screen for the hold.

**Approach:** Each check goes into the module that already owns the decision. The store refuses a
dense schedule when a routine is saved. The runner adds up today's `cost` events before a run takes
its computer, and arms a hold timer when a run ends blocked. The mail watcher holds a rise that
comes within five minutes of its last event and fires it once when the five minutes are over. Three
operator settings in `.env.local` carry the numbers. No new dependency, no new file format, nothing
in `src/web/`. A running total in one file was considered for the budget and left as the upgrade
path: summing the run logs keeps no second state that can drift from them.

**Design spec:** `docs/specs/2026-09-11-platform-design.md`, section "Amendments" → "2026-09-12 —
Daily budget, routine density, and the blocked-bot hold", accepted on the owner's word on 2026-09-13.
**Numbers (the owner, 2026-09-13):** `DAILY_BUDGET_USD` 25 (proposed 15); `ROUTINE_MIN_INTERVAL_MINUTES`
15; mail debounce 5 minutes, a constant; `BLOCKED_HOLD_MINUTES` 30.
**TODO items:** section 3, Delivery → "Daily budget and minimum routine interval".
**Branch:** `main`, one commit per task.
**Scope:** `src/server/config.ts`, `src/server/index.ts`, `src/server/http/app.ts`,
`src/server/store/{routines,runs,index,types}.ts`, `src/server/agent/{budget,runner,fakes}.ts`,
`src/server/mail/watcher.ts`, their tests, one condition in `src/web/App.tsx` (the hand-back
question is asked only while the tab is visible), `.env.example`, `README.md`, `CLAUDE.md`, the private backlog.
**Build estimate:** The owner's hours on human-only steps: none. Live-run cycles: no paid run. One
server start with `DAILY_BUDGET_USD=0` on a scratch data folder, which makes no model call and starts
no computer (verification criterion 1). The next paid rehearsal (act two, round 2) is the first live
proof that a run under the limit still starts.

## Where the code differs from the amendment, and why (confirm or overrule before `/implement`)

| # | Deviation | Why | Cost to change |
| - | --------- | --- | -------------- |
| D1 | The budget card names no setting: "Today's budget of $25 is used up ($25.20 spent), so I did not start. Runs start again tomorrow." The amendment's card ended "or raise `DAILY_BUDGET_USD`". The server log line and the README name the variable. | Invariant 7: a user never learns a name the platform invented and never sets an environment variable. The operator reads the log and the README. | 5 min |
| D2 | `DAILY_BUDGET_USD=0` is valid and refuses every run. | The operator's off switch. It also makes verification criterion 1 free: no model call, no computer. | 5 min |
| D3 | The mail debounce does not drop a rise inside its five minutes. It remembers the rise and fires one event at the first reading after the five minutes. | The amendment's reason for dropping ("the bot reads everything new when it opens the mailbox anyway") holds only for mail that lands before the bot opens its inbox. Failure scenario: mail A at 10:00 starts a run; the bot reads its inbox at 10:01; mail B lands at 10:03, a rise inside the window. Dropped, it starts nothing, and because the watcher compares counts, B waits for the next new mail, possibly for days. | 15 min |
| D4 | The blocked hold is extended while the page asks whether hand back is allowed: a request in the last minute counts as someone on the screen. The page sends that request every two seconds while it shows the bot's screen in takeover mode (`HANDBACK_POLL_MS` in `src/web/App.tsx`), and it enters that mode by itself for a blocked bot with an active takeover card. This plan adds one condition there: the page asks only while its tab is visible (`document.visibilityState`), so a hidden tab or a minimised window is nobody on the screen. A visible tab left open keeps the computer awake for as long as it is open; the README names that as a known limit, and E2B's own session limit ends it. | A fixed 30 minutes would pause the computer under the hands of a person who took over in minute 25. That is the defect the held keep-alive was built to fix after act one, round 2. Without the visibility condition, a tab left open would extend the hold without end, which is the abandoned case the hold exists for. | 30 min |
| D5 | When the hold ends, the takeover card is ended with a new text, the bot goes idle, and the computer is released to the normal two-minute grace and pause. The release runs as a job on the bot's run queue, so it is serialised with runs. The amendment kept the card and expected a later hand back to be refused as "not answering". The page is not changed for this: after the hold ended in a hidden tab, the page is still in takeover mode when the person returns, and Hand back resets it (it succeeds at once for an idle bot). | `Runner.handback` for a bot with no live session returns ok without a check (`safeWithoutRun`: no session means allowed), so the refusal the amendment describes does not happen in this code. An active card over a sleeping computer would also invite a takeover of a dead screen. The queue removes a race: released after a plain timer, the computer could be paused under a run that started between the timer and the release. | 20 min |
| D6 | The density check takes the smallest gap between consecutive runs among the next 100 (`nextRuns(100)`), not "the gap between the next two runs". | `0,5 7 * * 1-5` saved on a Monday at 07:03 in Prague has its next two runs at 07:05 and Tuesday 07:00 (checked with the installed croner, see Research). A two-run check would pass a five-minute routine, depending on the minute of saving. | 5 min |
| D7 | The budget sum reads every run log of every bot, not "a handful of files a day". A run is dated by its first event. | The amendment's trade-off sentence was wrong about which files are read. The choice stays (KISS: about a hundred runs over the life of the project). The upgrade path is unchanged: a running total in one file. | — |
| D8 | The Skills-tab route (`PUT /api/bots/:id/routines/:name`) stops calling `validateRoutine` itself and hands the routine to `store.writeRoutine`, which validates it with the configured limits. | The route's own call ran with the default limits, so an operator who lowered `ROUTINE_MIN_INTERVAL_MINUTES` would still see the Skills tab refuse at 15. The error texts and the 400 stay the same. | 5 min |
| D9 | A model with no price in `model.ts` counts $0 toward the budget, and the warning is logged at its first model call, not at boot as the amendment says. | Only the amendment's text was wrong. `MODEL_ID` defaults to a priced model. | — |

## Assumptions made while planning

| # | Assumption | Why | Cost to change |
| - | ---------- | --- | -------------- |
| A1 | Commits go straight to `main`, one per task. | The repository's practice since the first commit. | none |
| A2 | A refused run keeps the amendment's outcome `budget`. `endedBlocked` in `Runner.run` is computed only from `runLoop`'s result, so a refused run never holds its computer. The page only prints the outcome in its last-action line. | Read in `src/server/agent/runner.ts` and `src/web/App.tsx`. | 10 min |
| A3 | A refused run still gets its run folder, a `status` event and an `end` event, like the "could not start my computer" path. The refusal is visible in the run log, and `Scheduler.runRoutine` records its summary as the routine's `lastResult` with no change. | Platform plan Task 10: the run record is created first. | none |
| A4 | A refused goal on a blocked bot still ends that bot's held takeover, as every new goal does at the top of `Runner.run`. | Existing behaviour: a new goal is the other way out of blocked. | none |
| A5 | Two bots that start in the same second can both pass the check. One run over the line is accepted. | The amendment: a run in flight is never cut, and one run over the line beats a form cut half-filled. | none |
| A6 | The density check runs when a routine is saved (`save_routine` and the Skills tab). A routine file edited by hand outside the page is armed without it; the daily budget still applies. The README's known limits say so. | The amendment scopes the check to save; invariant 7 makes a hand-edited file operator action. | 20 min |
| A7 | `RunnerDeps` gets the budget, the time zone and the hold as required fields: `index.ts` passes the configuration, and `runner.test.ts` spreads a `LIMITS` constant into its `new Runner(...)` calls. `createStore` takes the routine limits as an optional second argument with the 15-minute default, because nine test files call `createStore(dataDir)`. That default lives once, in `store/routines.ts`, and `config.ts` imports it. | One source for each number. | none |
| A8 | If adding up the costs throws (a disk error), the run does not start: the error reaches the existing catch in `Runner.run`, which ends the run `failed` and sets the bot idle. | Fail closed, with no new code path. | none |
| A9 | `RunOutcome` keeps the one value `budget` for both caps: the per-run step or call cap (the computer is held for a takeover) and the daily budget (nothing started, nothing held). A comment on the enum says so; the chat card and the summary tell them apart. | The amendment's wording; the page prints the outcome and switches on nothing. A second value is a small later change if a log reader ever needs it. | 10 min |

**Found while planning, left out on purpose.** (a) After a server restart, `recoverAtBoot` sets a
blocked bot idle but leaves its takeover card active, so the page shows a stale card; pre-existing,
and it belongs to the restart check in TODO section 2, where Task 5 notes it. (b) The page does not
leave takeover mode by itself when the hold ends in a hidden tab; Hand back does it (D5). (c) The
hold timers live in memory like the held keep-alive they extend; after a restart the computer is
paused by E2B's own timeout, which is the existing behaviour.

## Research (source links)

| What the plan relies on | Version | Source |
| ----------------------- | ------- | ------ |
| `new Cron(pattern, { paused, timezone })`; `job.nextRuns(n: number, previous?: Date \| string): Date[]` ("Find next n runs, based on supplied date. Strips milliseconds."). An invalid pattern throws at construction, which `validateRoutine` already relies on. Checked in this repository on 2026-09-13: `0,5 7 * * 1-5` in `Europe/Prague` from `2026-09-14T05:03:00Z` gives `2026-09-14T05:05Z`, `2026-09-15T05:00Z`, `2026-09-15T05:05Z`; `*/15 * * * *` gives a smallest gap of 15 minutes over 100 runs. | croner 10.0.1, installed, no version change | <https://unpkg.com/croner@10.0.1/dist/croner.d.ts> (the installed `node_modules/croner/dist/croner.d.ts`, `CronOptions` and `nextRuns`) |
| `new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })` accepts any IANA time zone name; `formatToParts(date)` returns `{ type, value }` objects whose types include `year`, `month` and `day`. The code reads the parts by type, so their order does not matter. Checked on 2026-09-13 on Node v24.21.0: `2026-09-12T23:30:00Z` in `Europe/Prague` gives `month=09 day=13 year=2026`. | ECMA-402; Node 24.21.0 | <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat>, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts> |
| `vi.waitFor(async () => expect(...))` retries an async assertion. | vitest 5.0.0, installed | Already used four times in `src/server/scheduler/scheduler.test.ts` |
| `document.visibilityState` is `'visible'` when the page is the foreground tab of a window that is not minimised, and `'hidden'` for a background tab, a minimised window or a locked screen. Typed as `DocumentVisibilityState` in the `DOM` lib that `tsconfig.json` includes. | HTML Living Standard; every browser since 2015 | <https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState> (read 2026-09-13) |
| No new package. | — | — |

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Modify | `src/server/store/routines.ts` | `RoutineLimits`, the 15-minute default, `smallestGapMs`, the density check in `validateRoutine` and `writeRoutine` |
| Modify | `src/server/store/runs.ts` | `listRunCosts`: each run's first-event time and cost sum |
| Modify | `src/server/store/index.ts` | `createStore(dataDir, routineLimits?)`, binds `listRunCosts`, re-exports the new names |
| Modify | `src/server/store/types.ts` | A comment on `RunOutcome`: `budget` covers both caps (A9) |
| Modify | `src/web/App.tsx` | The hand-back question is asked only while the tab is visible (D4) |
| Modify | `src/server/http/app.ts` | The routine route hands the routine to `store.writeRoutine` only (D8) |
| Create | `src/server/agent/budget.ts` | `dayIn`, `spentToday`, `budgetText` |
| Create | `src/server/agent/budget.test.ts` | The day in a time zone; the sum over all bots, today only |
| Modify | `src/server/agent/runner.ts` | The budget refusal before the computer; the blocked hold with presence |
| Modify | `src/server/agent/fakes.ts` | `seedRun`: a finished run with cost events, for the tests |
| Modify | `src/server/mail/watcher.ts` | `MAIL_DEBOUNCE_MS` and the held rise |
| Modify | `src/server/config.ts` | `ROUTINE_MIN_INTERVAL_MINUTES`, `DAILY_BUDGET_USD`, `BLOCKED_HOLD_MINUTES` |
| Modify | `src/server/index.ts` | Passes the three settings to the store and the runner |
| Modify | `src/server/store/store.test.ts`, `src/server/agent/tools.test.ts`, `src/server/http/app.test.ts`, `src/server/config.test.ts`, `src/server/agent/runner.test.ts`, `src/server/mail/watcher.test.ts`, `src/server/agent/run.test.ts` | New tests, the `LIMITS` spread, the defaults object, one schedule in the no-rules-file test |
| Modify | `.env.example` | The three settings with their defaults, appended |
| Modify | `README.md`, `CLAUDE.md`, the private backlog | The limits as operator setup, two known limits, the TODO tick |

## Tasks

### Task 1: A routine may not run more often than the minimum interval [integration] [support]

**Files:** Modify `src/server/store/routines.ts`, `src/server/store/index.ts`, `src/server/http/app.ts`,
`src/server/config.ts`, `src/server/index.ts`, `.env.example`, `src/server/agent/run.test.ts`; Test
`src/server/store/store.test.ts`, `src/server/agent/tools.test.ts`, `src/server/http/app.test.ts`,
`src/server/config.test.ts`.
**Invariant:** 7 — the bot writes its own routines, so the refusal is a sentence written for the bot,
which it can act on in the same run; nobody edits a file to fix a schedule. Proven by the
`save_routine` test. The Skills tab, the user's editor, gets the same refusal (the app test).
**Demo step:** none. Support: a bot-written routine that fires every minute spends the operator's
money unattended (TODO section 3), and a reviewer's clone runs on the reviewer's key (delivery
constraint 1).
**Verify:** `pnpm exec vitest run src/server/store src/server/agent/tools.test.ts src/server/http/app.test.ts src/server/config.test.ts src/server/agent/run.test.ts && pnpm typecheck`

- [ ] **Write the failing tests.**

In `src/server/store/store.test.ts`, inside `describe('skills and routines', ...)`, after the test
"writeRoutine requires exactly one of schedule and event", add:

```ts
  it('writeRoutine refuses a schedule that runs more often than every 15 minutes and saves one that runs every 15', async () => {
    const bot = await newBot()
    const base = { name: 'often', skill: 'search-board', event: null, enabled: true, body: 'Run.' }
    await expect(store.writeRoutine(bot.id, { ...base, schedule: '*/10 * * * *' })).rejects.toThrow('schedule runs too often: the closest a routine may run is every 15 minutes')
    // Five minutes apart once a day and sparse otherwise: the refusal must not depend on the minute of saving.
    await expect(store.writeRoutine(bot.id, { ...base, schedule: '0,5 7 * * 1-5' })).rejects.toThrow('every 15 minutes')
    expect(await store.listRoutines(bot.id)).toEqual([])
    await store.writeRoutine(bot.id, { ...base, schedule: '*/15 * * * *' })
    expect((await store.listRoutines(bot.id)).map((r) => r.schedule)).toEqual(['*/15 * * * *'])
  })

  it('takes the minimum interval from the store options', async () => {
    const strict = createStore(dataDir, { minIntervalMs: 60 * 60_000 })
    const bot = await newBot()
    await expect(
      strict.writeRoutine(bot.id, { name: 'half-hourly', skill: 'search-board', schedule: '*/30 * * * *', event: null, enabled: true, body: 'Run.' }),
    ).rejects.toThrow('every 60 minutes')
  })
```

In `src/server/agent/tools.test.ts`, inside `describe('save_routine and events', ...)`, after the test
"refuses an event that does not exist, names the ones that do, and stores nothing", add:

```ts
  it('refuses a schedule denser than the minimum with a sentence the bot can act on, and stores nothing', async () => {
    const { ctx, botId, dataDir, store } = await botWithSkill()
    try {
      await expect(saveRoutine.run({ name: 'check-often', skill: 'handle-replies', schedule: '*/5 * * * *', instruction: 'Read the new mail.' }, ctx)).rejects.toThrow(
        'the closest a routine may run is every 15 minutes',
      )
      expect(await store.readRoutine(botId, 'check-often')).toBeNull()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
```

In `src/server/http/app.test.ts`, in the test "lists the files and rejects a routine with a bad
schedule on save", after `expect(await noSkill.json()).toEqual({ error: expect.stringContaining('invalid routine') })`, add:

```ts
    const dense = await app.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '---\nskill: search\nschedule: */5 * * * *\n---\nRun.' }) })
    expect(dense.status).toBe(400)
    expect(await dense.json()).toEqual({ error: expect.stringContaining('the closest a routine may run is every 15 minutes') })
```

In `src/server/config.test.ts`, in "fills in the defaults when only the keys are set", add
`ROUTINE_MIN_INTERVAL_MINUTES: 15,` after `MAILBOX_POLL_MS: 60_000,`.

In `src/server/agent/run.test.ts`, in "no platform tool writes approval-rules.json, whatever it is
called with", replace the `save_routine:` line with:

```ts
      // A schedule the density check accepts, so the routine write itself runs with the hostile name.
      save_routine: { name: 'approval-rules', skill: 'approval-rules', schedule: '0 7 * * *', instruction: 'i' },
```

- [ ] **Verify the new tests fail:** run the Verify command. The store, tools, app and config tests
fail: there is no density check and no setting.

- [ ] **Implement.**

In `src/server/store/routines.ts`, replace the whole `validateRoutine` function, and the first two
lines of `writeRoutine`, with:

```ts
/** The closest two runs of one routine may be, unless the operator sets `ROUTINE_MIN_INTERVAL_MINUTES`. */
export const DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES = 15

export type RoutineLimits = {
  /** A schedule whose two closest runs are nearer than this is refused when it is saved. */
  minIntervalMs: number
  /** The routines' clock (`TZ`), so gaps are measured the way the scheduler fires them. */
  timezone?: string
}

export const DEFAULT_ROUTINE_LIMITS: RoutineLimits = { minIntervalMs: DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES * 60_000 }

/**
 * How many upcoming runs the density check compares. A cron repeats its shape every day, week or
 * year, so a close pair shows up within the first runs of that shape; the next two runs alone miss
 * `0,5 7 * * *` saved at 07:03.
 */
const DENSITY_RUNS = 100

/** The smallest gap between consecutive run times, or null when there are fewer than two. */
export function smallestGapMs(runs: Date[]): number | null {
  let smallest: number | null = null
  for (let i = 1; i < runs.length; i++) {
    const before = runs[i - 1]
    const after = runs[i]
    if (!before || !after) continue
    const gap = after.getTime() - before.getTime()
    if (smallest === null || gap < smallest) smallest = gap
  }
  return smallest
}

/**
 * Throws `invalid schedule: …` for a bad cron expression and `schedule runs too often: …` for one
 * denser than the limit; exactly one of schedule, event is required.
 */
export function validateRoutine(routine: Routine, limits: RoutineLimits = DEFAULT_ROUTINE_LIMITS): Routine {
  const parsed = Routine.safeParse(routine)
  if (!parsed.success) {
    throw new Error('invalid routine: ' + parsed.error.issues.map((i) => `${i.path.join('.') || 'routine'} ${i.message}`).join('; '))
  }
  const valid = parsed.data
  assertSlug(valid.name)
  if ((valid.schedule === null) === (valid.event === null)) {
    throw new Error('a routine needs exactly one of schedule or event')
  }
  if (valid.schedule !== null) {
    let job: Cron
    try {
      job = new Cron(valid.schedule, { paused: true, ...(limits.timezone === undefined ? {} : { timezone: limits.timezone }) })
    } catch (e) {
      throw new Error('invalid schedule: ' + (e instanceof Error ? e.message : String(e)))
    }
    const gap = smallestGapMs(job.nextRuns(DENSITY_RUNS))
    if (gap !== null && gap < limits.minIntervalMs) {
      // Written for the bot: save_routine hands this sentence to the model, which can pick a wider schedule.
      throw new Error(`schedule runs too often: the closest a routine may run is every ${Math.round(limits.minIntervalMs / 60_000)} minutes`)
    }
  }
  return valid
}

export async function writeRoutine(dataDir: string, botId: string, routine: Routine, limits: RoutineLimits = DEFAULT_ROUTINE_LIMITS): Promise<void> {
  const valid = validateRoutine(routine, limits)
```

The rest of `writeRoutine` stays as it is.

In `src/server/store/index.ts`:

- replace `import { listRoutines, readRoutine, writeRoutine } from './routines'` with
  `import { DEFAULT_ROUTINE_LIMITS, listRoutines, readRoutine, writeRoutine, type RoutineLimits } from './routines'`;
- add `import type { Routine } from './types'` below it;
- replace `export { validateRoutine } from './routines'` with
  `export { DEFAULT_ROUTINE_LIMITS, DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES, validateRoutine, type RoutineLimits } from './routines'`;
- replace the doc comment and signature of `createStore` with:

```ts
/** The bot folder, bound to one data directory. Nothing else touches the disk. `routineLimits` apply when a routine is saved. */
export function createStore(dataDir: string, routineLimits: RoutineLimits = DEFAULT_ROUTINE_LIMITS) {
```

- replace `writeRoutine: writeRoutine.bind(null, dataDir),` with
  `writeRoutine: (botId: string, routine: Routine) => writeRoutine(dataDir, botId, routine, routineLimits),`.

In `src/server/http/app.ts`, in `app.put('/api/bots/:id/routines/:name', ...)`, replace everything
inside the `try { ... }` with:

```ts
      // The store validates with the operator's limits; a separate validateRoutine call here would use the defaults.
      await store.writeRoutine(loaded.bot.id, {
        name,
        skill: fields.skill ?? '',
        schedule: fields.schedule ?? null,
        event: fields.event ?? null,
        enabled: fields.enabled !== 'false',
        body,
      })
      await onRoutineSaved?.(loaded.bot.id)
```

and remove `validateRoutine, ` from the `'../store'` import at the top of the file.

In `src/server/config.ts`, add `import { DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES } from './store/routines'`
below the existing imports, and add to `EnvSchema` after the `MAILBOX_POLL_MS` line:

```ts
  // Operator limits (spec amendment of 2026-09-12). Operator setup, never a user setting (invariant 7).
  ROUTINE_MIN_INTERVAL_MINUTES: optionalNumber(DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES, 1, 24 * 60),
```

In `src/server/index.ts`, replace `const store = createStore(config.DATA_DIR)` with:

```ts
const store = createStore(config.DATA_DIR, { minIntervalMs: config.ROUTINE_MIN_INTERVAL_MINUTES * 60_000, timezone: config.TZ })
```

Append these lines to the end of `.env.example` (append with the shell; the file is not rewritten):

```text

# Operator limits, defaults shown. Operator setup, not something a user sets in chat.
ROUTINE_MIN_INTERVAL_MINUTES=15
```

- [ ] **Verify the tests pass:** run the Verify command.
- [ ] **Commit** `Refuse a routine that would run more often than the minimum interval`.

### Task 2: No run starts once today's runs have cost the daily budget [integration] [support]

**Files:** Create `src/server/agent/budget.ts`; Test `src/server/agent/budget.test.ts`; Modify
`src/server/store/runs.ts`, `src/server/store/index.ts`, `src/server/agent/runner.ts`,
`src/server/agent/fakes.ts`, `src/server/config.ts`, `src/server/index.ts`, `.env.example`; Test
`src/server/agent/runner.test.ts`, `src/server/config.test.ts`.
**Invariant:** 2 — the refusal is a real run record with a real outcome, not a hidden skip: the run
log ends `budget`, and a routine's last result says why. 7 — the card names no setting (asserted in
the runner test). 6 — the sum is read from the run logs on disk, so a restart keeps it; proven by
`spentToday` reading runs that the test wrote to a store, with nothing held in memory.
**Demo step:** none. Support: the server must not run unattended, and a reviewer must not run the
clone on their own key, without a spend cap (TODO section 3).
**Verify:** `pnpm exec vitest run src/server/agent/budget.test.ts src/server/agent/runner.test.ts src/server/config.test.ts src/server/store && pnpm typecheck`

- [ ] **Write the failing tests.**

In `src/server/agent/fakes.ts`, add at the end of the file:

```ts
/** A finished run whose events are all stamped `startedAt` and whose model calls cost `usd`; for the budget tests. */
export async function seedRun(store: Store, botId: string, runId: string, startedAt: string, usd: number[]): Promise<void> {
  await store.startRun(botId, runId)
  await store.appendRunEvent({ t: startedAt, runId, botId, type: 'status', text: 'working', botState: 'working' })
  for (const amount of usd) {
    await store.appendRunEvent({ t: startedAt, runId, botId, type: 'cost', inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, usd: amount })
  }
  await store.appendRunEvent({ t: startedAt, runId, botId, type: 'end', outcome: 'done', summary: 'done' })
}
```

Create `src/server/agent/budget.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore, type Store } from '../store'
import { dayIn, spentToday } from './budget'
import { seedRun } from './fakes'

let dataDir: string
let store: Store

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-budget-'))
  store = createStore(dataDir)
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const NOON_IN_PRAGUE = new Date('2026-09-13T10:00:00Z')

describe('dayIn', () => {
  it('names the calendar date in the given time zone, not in UTC', () => {
    // 23:30 UTC on 12 September is 01:30 on 13 September in Prague (summer time, UTC+2).
    expect(dayIn(new Date('2026-09-12T23:30:00Z'), 'Europe/Prague')).toBe('2026-09-13')
    expect(dayIn(new Date('2026-09-12T23:30:00Z'), 'UTC')).toBe('2026-09-12')
  })
})

describe('spentToday', () => {
  it("adds up every bot's runs that started today on the routines' clock and leaves out yesterday's", async () => {
    const alpha = (await store.createBot({ name: 'Alpha', persona: 'Works.' })).id
    const beta = (await store.createBot({ name: 'Beta', persona: 'Works.' })).id
    await seedRun(store, alpha, 'run-today', '2026-09-13T08:00:00Z', [1.25, 0.5])
    await seedRun(store, beta, 'run-after-midnight', '2026-09-12T22:30:00Z', [2]) // 00:30 on the 13th in Prague
    await seedRun(store, beta, 'run-before-midnight', '2026-09-12T21:30:00Z', [10]) // 23:30 on the 12th in Prague
    expect(await spentToday(store, NOON_IN_PRAGUE, 'Europe/Prague')).toBeCloseTo(3.75)
  })

  // The example bot folder ships runs/.gitkeep; in the first rehearsal a stray entry there crashed the boot.
  it('is zero without runs and skips an entry under runs/ that is not a run', async () => {
    const alpha = (await store.createBot({ name: 'Alpha', persona: 'Works.' })).id
    await mkdir(join(dataDir, alpha, 'runs'), { recursive: true })
    await writeFile(join(dataDir, alpha, 'runs', '.gitkeep'), '', 'utf8')
    expect(await spentToday(store, NOON_IN_PRAGUE, 'Europe/Prague')).toBe(0)
  })
})
```

In `src/server/agent/runner.test.ts`:

- replace the `./fakes` import with `import { computerUse, FakeModel, FakeSandbox, message, seedRun, solidPng, textBlock } from './fakes'`;
- add below the imports: `const LIMITS = { dailyBudgetUsd: 25, timezone: 'Europe/Prague' }`;
- in `runnerWith` and in each of the four `new Runner({` calls in the file, add `...LIMITS,` right after `tools: [],`;
- add at the end of the file:

```ts
// The platform's own spend limit under the organisation's: a bot-written routine or a stranger's
// mail must not be able to spend without end (spec amendment of 2026-09-12).
describe('the daily budget', () => {
  const NOON_IN_PRAGUE = new Date('2026-09-13T10:00:00Z')

  function runnerAt(factory: SessionFactory, model: FakeModel, dailyBudgetUsd = LIMITS.dailyBudgetUsd): Runner {
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, { factory })
    return new Runner({ store, events, approvals: new Approvals(), queue: new RunQueue(), sandboxes, model, modelId: 'claude-sonnet-5', tools: [], ...LIMITS, dailyBudgetUsd, now: () => NOON_IN_PRAGUE })
  }

  /** A factory that counts every attempt to bring the computer up. */
  function countingStarts(): { factory: SessionFactory; starts: () => number } {
    let n = 0
    const start = async (): Promise<never> => {
      n += 1
      throw new Error('the computer must not start')
    }
    return { factory: { create: start, connect: start }, starts: () => n }
  }

  it("does not start a run once today's runs have cost the budget: a status card, an end event, no computer, no model call", async () => {
    const other = (await store.createBot({ name: 'Other', persona: 'Works.' })).id
    await seedRun(store, other, 'run-earlier', '2026-09-13T07:00:00Z', [25.2])
    const { factory, starts } = countingStarts()
    const model = new FakeModel([])

    const result = await runnerAt(factory, model).enqueue(botId, { goal: 'search the board', activeSkill: null, source: 'routine', routineName: 'morning-search' })

    expect(result).toEqual({ outcome: 'budget', summary: "today's budget of $25 is used up ($25.20 spent)" })
    expect(starts()).toBe(0)
    expect(model.calls).toHaveLength(0)
    const chat = await store.readChat(botId, { limit: 10 })
    expect(chat.map((m) => m.card)).toEqual([{ card: 'status', text: "Today's budget of $25 is used up ($25.20 spent), so I did not start. Runs start again tomorrow." }])
    // Invariant 7: nothing in the chat tells the user to set a variable.
    expect(JSON.stringify(chat)).not.toMatch(/DAILY_BUDGET_USD|\.env/)
    expect((await store.readBot(botId)).state).toBe('idle')
  })

  it("starts the run while today's spend is under the budget, whatever was spent yesterday", async () => {
    const other = (await store.createBot({ name: 'Other', persona: 'Works.' })).id
    await seedRun(store, other, 'run-today', '2026-09-13T07:00:00Z', [24.99])
    await seedRun(store, other, 'run-yesterday', '2026-09-12T12:00:00Z', [100])
    const model = new FakeModel([message([textBlock('done')], 'end_turn')])

    const result = await runnerAt(fakeFactory(new FakeSandbox()), model).enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })

    expect(result?.outcome).toBe('done')
    expect(model.calls).toHaveLength(1)
  })

  // DAILY_BUDGET_USD=0 is the operator's off switch.
  it('with a budget of zero no run starts at all', async () => {
    const { factory, starts } = countingStarts()
    const result = await runnerAt(factory, new FakeModel([]), 0).enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' })
    expect(result).toEqual({ outcome: 'budget', summary: "today's budget of $0 is used up ($0.00 spent)" })
    expect(starts()).toBe(0)
  })
})
```

In `src/server/config.test.ts`, in "fills in the defaults when only the keys are set", add
`DAILY_BUDGET_USD: 25,` after `ROUTINE_MIN_INTERVAL_MINUTES: 15,`; and add inside
`describe('parseEnv', ...)`, after "rejects a poll interval below ten seconds by name":

```ts
  // DAILY_BUDGET_USD=0 is the operator's off switch: every run is refused and nothing is spent.
  it('accepts a daily budget of zero and rejects a negative one by name', () => {
    const zero = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', DAILY_BUDGET_USD: '0' })
    expect(zero.ok && zero.config.DAILY_BUDGET_USD).toBe(0)
    const negative = parseEnv({ E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', DAILY_BUDGET_USD: '-1' })
    expect(negative.ok).toBe(false)
    if (negative.ok) return
    expect(negative.invalid).toEqual(['DAILY_BUDGET_USD'])
  })
```

- [ ] **Verify the new tests fail:** run the Verify command. `budget.test.ts` cannot import
`./budget`; the runner refuses nothing; the config has no `DAILY_BUDGET_USD`.

- [ ] **Implement.**

In `src/server/store/runs.ts`, add after `listOpenRuns`:

```ts
export type RunCost = { runId: string; startedAt: string | null; usd: number }

/**
 * Every run of the bot, with the time of its first event and the sum of its cost events. An entry
 * that is not a run id is skipped without a warning: this runs before every run.
 */
export async function listRunCosts(dataDir: string, botId: string): Promise<RunCost[]> {
  let entries: string[]
  try {
    entries = await readdir(runsDir(dataDir, botId))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const costs: RunCost[] = []
  for (const runId of entries.sort()) {
    if (!SLUG.test(runId)) continue
    const events = await readRunEvents(dataDir, botId, runId)
    let usd = 0
    for (const event of events) if (event.type === 'cost') usd += event.usd
    costs.push({ runId, startedAt: events[0]?.t ?? null, usd })
  }
  return costs
}
```

In `src/server/store/index.ts`, add `listRunCosts` to the `./runs` import, add
`listRunCosts: listRunCosts.bind(null, dataDir),` after `listOpenRuns: listOpenRuns.bind(null, dataDir),`,
and add `export type { RunCost } from './runs'` after `export type { CreateBotInput } from './bot'`.

Create `src/server/agent/budget.ts`:

```ts
import type { Store } from '../store'

// The platform's own spend limit, under the organisation limit set in the Anthropic console. Before
// a run takes its computer, the cost events of every run of every bot that started today are added
// up (spec amendment of 2026-09-12). Today ends at midnight on the routines' clock.

/** The calendar date of `date` in `timezone`, as YYYY-MM-DD. */
export function dayIn(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: 'year' | 'month' | 'day'): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** What the runs of every bot that started on `now`'s date in `timezone` have cost, in USD. A run is dated by its first event. */
export async function spentToday(store: Store, now: Date, timezone: string): Promise<number> {
  const today = dayIn(now, timezone)
  let total = 0
  for (const bot of await store.listBots()) {
    for (const run of await store.listRunCosts(bot.id)) {
      if (run.startedAt === null) continue
      const started = new Date(run.startedAt)
      if (Number.isNaN(started.getTime())) continue
      if (dayIn(started, timezone) === today) total += run.usd
    }
  }
  return total
}

/**
 * The words for a run the budget refused: the chat card for the user, and the one-line summary for
 * the run log and a routine's last result. Neither names a setting (invariant 7).
 */
export function budgetText(budgetUsd: number, spentUsd: number): { card: string; summary: string } {
  const spent = `$${spentUsd.toFixed(2)}`
  return {
    card: `Today's budget of $${budgetUsd} is used up (${spent} spent), so I did not start. Runs start again tomorrow.`,
    summary: `today's budget of $${budgetUsd} is used up (${spent} spent)`,
  }
}
```

In `src/server/agent/runner.ts`:

- add `import { budgetText, spentToday } from './budget'` to the imports;
- in `RunnerDeps`, add after `tools: ToolDef[]`:

```ts
  /** The operator's spend limit for one day across all bots, in USD (`DAILY_BUDGET_USD`). */
  dailyBudgetUsd: number
  /** The budget's day ends at midnight here: the routines' clock (`TZ`). */
  timezone: string
```

  and after `clearKeepAlive?: (handle: unknown) => void`:

```ts
  /** Injected in tests; defaults to the wall clock. */
  now?: () => Date
```

- add after the constructor:

```ts
  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }
```

- in `run`, insert as the first statements inside `try {`, before
  `await setBotState('working', ...)`:

```ts
      // Checked before the computer is touched and before any model call: a refused run costs nothing.
      const spentUsd = await spentToday(store, this.now(), this.deps.timezone)
      if (spentUsd >= this.deps.dailyBudgetUsd) {
        const text = budgetText(this.deps.dailyBudgetUsd, spentUsd)
        log.warn('daily budget used up; the run did not start (DAILY_BUDGET_USD in .env.local sets the limit)', { botId, runId, spentUsd, budgetUsd: this.deps.dailyBudgetUsd })
        await postChat({ role: 'card', card: { card: 'status', text: text.card } })
        await setBotState('idle', 'daily budget used up')
        await emit({ type: 'end', outcome: 'budget', summary: text.summary })
        return { outcome: 'budget', summary: text.summary }
      }
```

In `src/server/store/types.ts`, replace the line `export const RunOutcome = z.enum([...])` with:

```ts
/**
 * `budget` is a run stopped by a cap: the per-run step or call cap, after which the computer is
 * held for a takeover, or the daily budget, which refuses the run before it starts and holds
 * nothing. The run's chat card and its end summary say which.
 */
export const RunOutcome = z.enum(['done', 'failed', 'blocked', 'budget', 'stuck', 'denied'])
```

In `src/server/config.ts`, add to `EnvSchema` after `ROUTINE_MIN_INTERVAL_MINUTES`:

```ts
  DAILY_BUDGET_USD: optionalNumber(25, 0, 100_000),
```

In `src/server/index.ts`, add to the `new Runner({ ... })` object after `tools: basePlatformTools,`:

```ts
  dailyBudgetUsd: config.DAILY_BUDGET_USD,
  timezone: config.TZ,
```

and change the `server listening` log line to
`log.info('server listening', { port: info.port, dataDir: config.DATA_DIR, model: config.MODEL_ID, dailyBudgetUsd: config.DAILY_BUDGET_USD })`.

Append to the end of `.env.example`:

```text
DAILY_BUDGET_USD=25
```

- [ ] **Verify the tests pass:** run the Verify command.
- [ ] **Commit** `Refuse to start a run once today's runs have cost the daily budget`.

### Task 3: A blocked bot's computer sleeps once nobody has been on its screen for the hold [integration] [support]

**Files:** Modify `src/server/agent/runner.ts`, `src/server/config.ts`, `src/server/index.ts`,
`src/web/App.tsx`, `.env.example`; Test `src/server/agent/runner.test.ts`, `src/server/config.test.ts`.
**Invariant:** 1 — the page never shows a screen the platform let go to sleep as live: the hold does
not end while the page shows the screen (D4), and when it ends the card says so. 6 — the sandbox
lifecycle: a computer held for a human is released to the normal pause, never killed, and the release
is serialised behind the bot's runs, so it can never pause a computer a new run has just taken.
Proven by the three hold tests; the serialisation is the queue's existing guarantee (`queue.test.ts`).
**Demo step:** none on camera. Support: since act one, round 2, a run that ends blocked holds its
computer awake with no end; abandoned, it holds it until the server restarts or E2B's own limits end
it (the trade-off recorded in the platform plan's Rehearsal notes).
**Verify:** `pnpm exec vitest run src/server/agent/runner.test.ts src/server/config.test.ts && pnpm typecheck`

- [ ] **Write the failing tests.**

In `src/server/agent/runner.test.ts`:

- replace `import { Runner } from './runner'` with `import { holdEndedText, Runner } from './runner'`;
- replace the `LIMITS` line with `const LIMITS = { dailyBudgetUsd: 25, timezone: 'Europe/Prague', blockedHoldMs: 30 * 60_000 }`;
- add at the end of the file:

```ts
// A run that ended blocked holds its computer awake for the human (act one, round 2). Abandoned,
// that hold had no end; the amendment of 2026-09-12 caps it, but never under a person's hands.
describe('the blocked hold', () => {
  const HOLD_MS = LIMITS.blockedHoldMs

  async function stuckRunner(clock: { now: number }) {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const model = new FakeModel([message([computerUse('screenshot')]), message([computerUse('screenshot')]), message([computerUse('screenshot')])])
    const holds: { fn: () => void; ms: number }[] = []
    const graces: number[] = []
    let keepAlivesCleared = 0
    let holdsCleared = 0
    const events = new BotEvents()
    const sandboxes = new SandboxManager(store, events, { py: '', js: '' }, {
      factory: fakeFactory(sandbox),
      setTimer: (_fn, ms) => {
        graces.push(ms)
        return graces.length
      },
      clearTimer: () => undefined,
    })
    const runner = new Runner({
      store,
      events,
      approvals: new Approvals(),
      queue: new RunQueue(),
      sandboxes,
      model,
      modelId: 'claude-sonnet-5',
      tools: [],
      ...LIMITS,
      now: () => new Date(clock.now),
      setKeepAlive: () => 1,
      clearKeepAlive: () => {
        keepAlivesCleared += 1
      },
      setHoldTimer: (fn, ms) => {
        holds.push({ fn, ms })
        return holds.length
      },
      clearHoldTimer: () => {
        holdsCleared += 1
      },
    })
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
    sandbox.companion.states = [{ url: 'https://example.com/', fingerprint: 'x', unsafe: false }]
    return { runner, holds, graces, keepAlivesCleared: () => keepAlivesCleared, holdsCleared: () => holdsCleared }
  }

  const takeoverCards = async () => (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)

  it('lets the computer sleep when the hold ends with nobody on the screen: the card says so and the bot is idle', async () => {
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    const t = await stuckRunner(clock)
    expect(t.holds.map((h) => h.ms)).toEqual([HOLD_MS])

    clock.now += HOLD_MS
    t.holds[0]?.fn()

    // The release runs as a job on the bot's queue, so it lands a moment after the timer fired.
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('idle'))
    expect(await takeoverCards()).toEqual([expect.objectContaining({ status: 'ended', reason: holdEndedText(30) })])
    expect(t.keepAlivesCleared()).toBe(1)
    await vi.waitFor(() => expect(t.graces).toEqual([GRACE_MS]))
  })

  it('extends the hold while the page asks whether hand back is allowed, and ends it once the page stops asking', async () => {
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    const t = await stuckRunner(clock)

    clock.now += HOLD_MS - 30_000
    await t.runner.handbackState(botId)
    clock.now += 30_000
    t.holds[0]?.fn()

    expect(t.holds).toHaveLength(2)
    expect((await store.readBot(botId)).state).toBe('blocked')
    expect(t.keepAlivesCleared()).toBe(0)

    clock.now += HOLD_MS
    t.holds[1]?.fn()
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('idle'))
  })

  it('a hand back before the hold ends cancels the hold timer', async () => {
    const clock = { now: Date.parse('2026-09-13T10:00:00Z') }
    const t = await stuckRunner(clock)
    expect(await t.runner.handback(botId)).toEqual({ ok: true })
    expect(t.holdsCleared()).toBe(1)
    expect(t.keepAlivesCleared()).toBe(1)
  })
})
```

In `src/server/config.test.ts`, in "fills in the defaults when only the keys are set", add
`BLOCKED_HOLD_MINUTES: 30,` after `DAILY_BUDGET_USD: 25,`.

- [ ] **Verify the new tests fail:** run the Verify command. `holdEndedText` does not exist and no
hold timer is armed.

- [ ] **Implement.** All in `src/server/agent/runner.ts` unless named.

In `RunnerDeps`, add after `now?: () => Date`:

```ts
  /** How long a run that ended blocked holds its computer awake while nobody is on its screen (`BLOCKED_HOLD_MINUTES`). */
  blockedHoldMs: number
  /** Injected in tests; defaults to an unref'd setTimeout. */
  setHoldTimer?: (fn: () => void, ms: number) => unknown
  clearHoldTimer?: (handle: unknown) => void
```

Add after `export const KEEPALIVE_MS = 5 * 60_000`:

```ts
/**
 * While the page shows the bot's screen in takeover mode, it asks every two seconds whether hand
 * back is allowed. A question within this window counts as a person on the screen, and the
 * blocked hold does not end under their hands.
 */
export const HOLD_PRESENCE_MS = 60_000

export function holdEndedText(minutes: number): string {
  return `I waited ${minutes} minutes for you and then let my computer go to sleep. Send me the next goal to wake it.`
}
```

Add to the class fields, after `private readonly manualRequests = new Set<string>()`:

```ts
  /** The hold timer of each bot whose run ended blocked. */
  private readonly blockedHolds = new Map<string, unknown>()
  /** When the page last asked whether hand back is allowed, per bot, in epoch milliseconds. */
  private readonly lastSeenOnScreen = new Map<string, number>()
```

In `handbackState`, add as its first statement:

```ts
    this.lastSeenOnScreen.set(botId, this.now().getTime())
```

Replace `dropBlockedKeepAlive` with:

```ts
  private dropBlockedKeepAlive(botId: string): void {
    this.clearBlockedHold(botId)
    const held = this.blockedKeepAlives.get(botId)
    if (held === undefined) return
    this.clearKeepAlive(held)
    this.blockedKeepAlives.delete(botId)
  }

  private armBlockedHold(botId: string): void {
    const setHold = this.deps.setHoldTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref())
    const handle = setHold(() => {
      this.blockedHolds.delete(botId)
      const seen = this.lastSeenOnScreen.get(botId)
      if (seen !== undefined && this.now().getTime() - seen < HOLD_PRESENCE_MS) {
        log.info('blocked hold extended: someone is on the bot screen', { botId })
        this.armBlockedHold(botId)
        return
      }
      // Queued behind the bot's runs: a goal that arrives in the meantime either goes first (and
      // takes the computer and the card itself) or waits until the release is done. Nothing can
      // pause a computer a run has just taken.
      void this.deps.queue.enqueue(botId, () => this.endBlockedHold(botId))
    }, this.deps.blockedHoldMs)
    this.blockedHolds.set(botId, handle)
  }

  private clearBlockedHold(botId: string): void {
    const handle = this.blockedHolds.get(botId)
    if (handle === undefined) return
    ;(this.deps.clearHoldTimer ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout)))(handle)
    this.blockedHolds.delete(botId)
  }

  /**
   * The hold ran out with nobody on the screen: the held keep-alive is dropped, the takeover card
   * says the computer went to sleep, the bot goes idle and the computer is released to the normal
   * pause. Runs as a job on the bot's queue; a run that went first has dropped the keep-alive
   * already, and then there is nothing to do. Never rejects: the queue would only log it.
   */
  private async endBlockedHold(botId: string): Promise<void> {
    try {
      if (!this.blockedKeepAlives.has(botId)) return
      this.dropBlockedKeepAlive(botId)
      await this.endOpenTakeoverCard(botId, holdEndedText(Math.round(this.deps.blockedHoldMs / 60_000)))
      const bot = await this.deps.store.readBot(botId)
      if (bot.state === 'blocked') {
        const updated = await this.deps.store.updateBot(botId, { state: 'idle', statusLine: 'my computer went to sleep' })
        this.deps.events.emitBot(updated)
      }
      this.deps.sandboxes.release(botId)
      log.info('blocked hold ended; the computer is released', { botId })
    } catch (e) {
      log.error('could not end the blocked hold', { botId, ...errorFields(e) })
    }
  }
```

Replace `endOpenTakeoverCard` with:

```ts
  /** Ends the bot's open takeover card; `reason` replaces its text when the user needs to know why it ended. */
  private async endOpenTakeoverCard(botId: string, reason?: string): Promise<void> {
    const chat = await this.deps.store.readChat(botId, { limit: 50 })
    const open = [...chat].reverse().find((m) => m.card?.card === 'takeover' && m.card.status === 'active')
    if (!open?.card || open.card.card !== 'takeover') return
    const updated = await this.deps.store.updateChatCard(botId, open.id, { ...open.card, status: 'ended', ...(reason === undefined ? {} : { reason }) })
    if (updated) this.deps.events.emitChat(updated)
  }
```

In `run`, in the `finally` block, replace the `if (keepAlive !== null) { ... }` block with:

```ts
      if (keepAlive !== null) {
        // A blocked run keeps refreshing the computer's timeout until the human hands back, a new run
        // starts, or the hold ends with nobody on the screen; otherwise E2B pauses it on its own clock
        // under the takeover card.
        if (endedBlocked) {
          this.blockedKeepAlives.set(botId, keepAlive)
          this.armBlockedHold(botId)
        } else this.clearKeepAlive(keepAlive)
      }
```

In `handback`, insert before `this.deps.sandboxes.release(botId)`:

```ts
      // A goal that arrived while the card was being ended has the computer now; its run releases it.
      if (this.deps.queue.size(botId) > 0) return { ok: true }
```

This closes a pre-existing window of two awaited file writes between the queue check at the top of
the branch and the release. No test: a deterministic one needs a store that enqueues a run from
inside `readChat`; the hold path avoids the same window by running on the queue instead.

In `src/web/App.tsx`, in the effect that starts with the comment "While the human has the screen,
ask the server every two seconds whether hand-back is allowed", make the first lines of `poll`:

```ts
    const poll = async () => {
      // The server counts this question as a person on the screen (the blocked hold); a hidden
      // tab or a minimised window is nobody on the screen.
      if (document.visibilityState !== 'visible') return
      try {
```

Nothing else in the page changes. After the hold ended in a hidden tab, the page is still in takeover
mode when the person returns; Hand back resets it and succeeds at once for an idle bot.

In `src/server/config.ts`, add to `EnvSchema` after `DAILY_BUDGET_USD`:

```ts
  BLOCKED_HOLD_MINUTES: optionalNumber(30, 1, 24 * 60),
```

In `src/server/index.ts`, add to the `new Runner({ ... })` object after `timezone: config.TZ,`:

```ts
  blockedHoldMs: config.BLOCKED_HOLD_MINUTES * 60_000,
```

Append to the end of `.env.example`:

```text
BLOCKED_HOLD_MINUTES=30
```

- [ ] **Verify the tests pass:** run the Verify command.
- [ ] **Commit** `Let a blocked bot's computer sleep once nobody has been on its screen for the hold`.

### Task 4: Mail within five minutes of a mail-triggered run starts one run when they are over [integration] [support]

**Files:** Modify `src/server/mail/watcher.ts`; Test `src/server/mail/watcher.test.ts`.
**Invariant:** 6, in its unprompted sense — a routine starts when mail arrives, and the debounce
never swallows a mail (D3). Proven by the hold-then-fire test.
**Demo step:** 10 (the mail-triggered run) is unchanged: the first mail still fires at once, which
the existing test "fires once when the unseen count rises" keeps pinned. Support: anyone can email the
bot, so a stream of mail must not start a run a minute.
**Verify:** `pnpm exec vitest run src/server/mail && pnpm typecheck`

- [ ] **Write the failing tests.**

In `src/server/mail/watcher.test.ts`:

- replace the watcher import with `import { MAIL_DEBOUNCE_MS, MailWatcher, type MailboxPort } from './watcher'`;
- in the test "swallows a failing handler so the watcher keeps polling", add `debounceMs: 0,` after
  `mailbox,` in its `new MailWatcher({ ... })` call, so its third tick still reaches the throwing
  handler (with the default debounce the third rise would be held, and the test would pass without
  exercising the second throw);
- replace `watcherOver` with:

```ts
function watcherOver(counts: (number | Error)[], clock?: () => number): { watcher: MailWatcher; fired: () => number } {
  let fires = 0
  const watcher = new MailWatcher({
    mailbox: new FakeMailbox(counts),
    onMail: async () => {
      fires += 1
    },
    // Without a clock a test is about the counts alone; the debounce has its own tests below.
    ...(clock ? { now: clock } : { debounceMs: 0 }),
  })
  return { watcher, fired: () => fires }
}
```

- add at the end of the file:

```ts
// Anyone can email the bot. The debounce keeps a stream of mail from starting a run a minute, and it
// must not lose the mail it holds back: that mail may land after the bot has read its inbox.
describe('the mail debounce', () => {
  it('holds a rise inside the five minutes and fires it once at the first reading after them', async () => {
    let clock = 0
    const { watcher, fired } = watcherOver([0, 1, 2, 2, 2], () => clock)
    await watcher.tick() // baseline 0
    clock = 60_000
    await watcher.tick() // 1: fires at once
    expect(fired()).toBe(1)
    clock = 180_000
    await watcher.tick() // 2: inside the five minutes, held
    expect(fired()).toBe(1)
    clock = 60_000 + MAIL_DEBOUNCE_MS
    await watcher.tick() // still 2: the held mail fires now
    expect(fired()).toBe(2)
    clock += 60_000
    await watcher.tick() // still 2: nothing new, nothing held
    expect(fired()).toBe(2)
  })

  it('fires at once for a rise after the five minutes', async () => {
    let clock = 0
    const { watcher, fired } = watcherOver([0, 1, 2], () => clock)
    await watcher.tick()
    clock = 60_000
    await watcher.tick()
    clock = 60_000 + MAIL_DEBOUNCE_MS
    await watcher.tick()
    expect(fired()).toBe(2)
  })
})
```

- [ ] **Verify the new tests fail:** run the Verify command. `MAIL_DEBOUNCE_MS` does not exist and
the held rise never fires.

- [ ] **Implement.** In `src/server/mail/watcher.ts`:

Add after `export const DEFAULT_POLL_MS = 60_000`:

```ts
/**
 * After a mail event fires, a rise within this window does not fire at once: it fires one event at
 * the first reading after the window. A stream of mail then starts at most one run every five
 * minutes, and no mail is dropped (spec amendment of 2026-09-12).
 */
export const MAIL_DEBOUNCE_MS = 5 * 60_000
```

In `WatcherDeps`, add after `clearTimer?(handle: unknown): void`:

```ts
  /** Injected in tests; defaults to MAIL_DEBOUNCE_MS. */
  debounceMs?: number
  /** Injected in tests; defaults to Date.now. */
  now?(): number
```

In the class doc comment of `MailWatcher`, add a paragraph after the first line:

```ts
 * A rise within MAIL_DEBOUNCE_MS of the last fired event is held and fires once at the first
 * reading after that window. No reading is taken while `onMail` runs (the scheduler waits for the
 * runs it started), so a long run delays the next event; it never loses it.
 *
```

Add to the class fields, after `private stopped = false`:

```ts
  private lastFiredAt: number | null = null
  /** A rise was seen inside the debounce and has not fired yet. */
  private pending = false
  private readonly debounceMs: number
  private readonly now: () => number
```

In the constructor, add after `this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS`:

```ts
    this.debounceMs = deps.debounceMs ?? MAIL_DEBOUNCE_MS
    this.now = deps.now ?? (() => Date.now())
```

In `tick`, replace everything from `const previous = this.lastCount` to the end of the method with:

```ts
    const previous = this.lastCount
    this.lastCount = count
    if (previous === null) {
      log.info('mail watcher baseline set', { unseen: count })
      return
    }
    const rose = count > previous
    if (!rose && !this.pending) return
    const now = this.now()
    if (this.lastFiredAt !== null && now - this.lastFiredAt < this.debounceMs) {
      if (rose) log.info('new mail inside the debounce; it fires once the debounce is over', { unseen: count, previous })
      this.pending = true
      return
    }
    log.info(rose ? 'new mail' : 'new mail held by the debounce', { unseen: count, previous })
    this.pending = false
    this.lastFiredAt = now
    try {
      await this.deps.onMail()
    } catch (e) {
      log.error('the mail event handler failed', errorFields(e))
    }
```

- [ ] **Verify the tests pass:** run the Verify command.
- [ ] **Commit** `Fold mail that arrives within five minutes of a mail-triggered run into one later run`.

### Task 5: The limits are documented as operator setup [mechanical] [support]

**Files:** Modify `README.md`, `CLAUDE.md`, the private backlog.
**Invariant:** none touched (documentation). Delivery constraint 1: a reviewer who clones the
repository learns the limits from the README and `.env.example`.
**Demo step:** none. Support: the README is a graded deliverable.
**Verify:** `pnpm preflight` (full output to a file in the scratchpad)

- [ ] In `README.md`, after the paragraph that ends "which costs nothing while you try the rest.",
add:

```markdown
Three operator limits live in `.env.local` as well, with their defaults in `.env.example`. They are
operator setup, not something a user sets in chat:

- `DAILY_BUDGET_USD` (default `25`, whole dollars). Before a run starts, the platform adds up what the runs of all
  bots that started today have cost, midnight to midnight in `TZ`. At or past the limit the run does
  not start, and the chat shows a status card that says so. A run already going is never cut. `0`
  stops every run.
- `ROUTINE_MIN_INTERVAL_MINUTES` (default `15`). A routine that would run more often is refused when
  it is saved, whether the bot saves it or you edit it in the Skills tab.
- `BLOCKED_HOLD_MINUTES` (default `30`). A run that stopped for help keeps its computer awake this
  long for you, and longer while the bot's screen is open in the page. Then the computer goes to
  sleep, and your next goal wakes it.

Mail that arrives within five minutes of a mail-triggered run starts one more run when those five
minutes are over, so a stream of mail starts at most one run every five minutes.
```

- [ ] In `README.md`, in "Known limits", after the bullet that starts "The mail trigger compares
unseen counts", add:

```markdown
- The daily budget is checked when a run starts, so the last run of a day can end above it, and two
  bots that start in the same second can both pass. Adding up the cost reads every run log; a
  running total in one file is the upgrade if that ever shows.
- The routine interval is checked when a routine is saved. A routine file edited by hand outside the
  page is armed without the check; the daily budget still applies.
- A visible tab open on a blocked bot's screen keeps its computer awake for as long as it is open:
  the page's hand-back question counts as a person on the screen, and a hidden tab does not. Close
  the tab or press Hand back; E2B's own session limit ends it otherwise.
```

- [ ] In `CLAUDE.md`, in "Commands", replace
"Keys live in `.env.local` (git-ignored): `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `MODEL_ID`, `TZ`." with
"Keys live in `.env.local` (git-ignored): `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `MODEL_ID`, `TZ`, and the
operator limits `DAILY_BUDGET_USD`, `ROUTINE_MIN_INTERVAL_MINUTES`, `BLOCKED_HOLD_MINUTES` (defaults 25,
15, 30)."

- [ ] In the private backlog, in section 3, replace the opening `- [ ] Daily budget and minimum routine interval — `
of the item with this text, and keep the rest of the item as it is:

```text
- [x] Daily budget and minimum routine interval — built 2026-09-13 on the owner's word ($25 a day, the
      other defaults kept): `docs/plans/2026-09-13-daily-budget-plan.md`, commits <sha1>–<sha4>,
      preflight green at <n> tests; verification criterion 1 (a refused run under a zero budget) seen
      live. The record before the build:
```

  Fill `<sha1>`–`<sha4>` from `git log --oneline -5` (the Task 1 and Task 4 commits) and `<n>` from
  the preflight output. Criterion 1 is run by Task 5 before this tick; if it was not run, write
  "criterion 1 not yet seen live" instead.

- [ ] In the private backlog, in section 2, append to the item that starts "Persistence shown live: restart
the server during a cheap run": ` Also check what a restart does to a bot that ended blocked:
\`recoverAtBoot\` sets it idle but leaves its takeover card active, so the page shows a stale card
(found 2026-09-13 while planning the budget).`

- [ ] Run verification criterion 1 (the table below), then `pnpm preflight` with its full output
written to a file in the scratchpad.
- [ ] **Commit** `Document the operator limits and tick the daily-budget item`.

## Verification Criteria

| # | Criterion | How to verify |
| - | --------- | ------------- |
| 1 | With `DAILY_BUDGET_USD=0`, a goal typed in the page is refused: the chat shows the budget card, the run log ends with `budget`, the bot stays idle, no computer starts and no model call is made. **Human-observable.** | `mkdir -p data/budget-check && cp -r examples/job-hunt-bot data/budget-check/job-hunt-bot`. Add a configuration to `.claude/launch.json`: name `dobot-dev-budget-zero`, `runtimeExecutable` `env`, `runtimeArgs` `["-u", "PORT", "DAILY_BUDGET_USD=0", "DATA_DIR=data/budget-check", "pnpm", "dev"]`, port 5173. Start it with the preview tool; send the bot "Tell me the title of https://example.com"; see the card; read `data/budget-check/job-hunt-bot/runs/*/events.jsonl` (ends with `budget`) and the server log (no `creating the bot computer`, no `sandbox connected`, `dailyBudgetUsd: 0` on the listening line). Stop the server; remove the configuration and `data/budget-check`. Costs nothing, and the live bot folder is not touched. |
| 2 | Under the limit a run starts as before. | `runner.test.ts` "starts the run while today's spend is under the budget"; live, act two, round 2 (step 3 of the 2026-09-13 list) starts with `DAILY_BUDGET_USD=25`, and its record in the platform plan's Rehearsal notes says so. |
| 3 | A routine denser than 15 minutes is refused at save, both when the bot saves it and in the Skills tab, with a sentence the bot can act on; every 15 minutes is saved. | The store, tools and app tests of Task 1. |
| 4 | Mail inside the five minutes starts one run when they are over; mail after them starts one at once; the first mail still starts one at once. | The watcher tests of Task 4, including the existing "fires once when the unseen count rises". |
| 5 | A blocked bot's computer sleeps when the hold ends with nobody on the screen, and the card says so; the hold is extended while the page shows the screen; hand back cancels it; the page asks only while its tab is visible. | The three hold tests of Task 3; the visibility condition by inspection of `src/web/App.tsx` (the page has no tests) and `pnpm typecheck`, which covers `src/web`. |
| 6 | Nothing else changed: typecheck, every test and the site-name grep are clean. | `pnpm preflight` (254 vitest tests before this plan, the new ones on top). |
| 7 | A clean clone documents the limits. | `.env.example` lists the three settings with defaults; the README names them as operator setup and lists the two known limits. |

## Test Plan

- Each task runs its own Verify command before its commit.
- Every new test runs offline with no keys: fakes for the model and the computer, a temporary folder
  for the store, injected clocks and timers. No sleeps, no network.
- Criterion 1 needs `.env.local` with the existing keys and a free port 5173, and makes no paid call.
- At the end: `pnpm preflight` (typecheck, the vitest suite, the Python companion tests, the site-name
  grep), with the full output written to a file in the scratchpad, never cut with `tail` alone.

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Reading this plan.
2. Running `git log --oneline -8`: each task is one commit with the subject named in its last step.
3. Picking up from the first task whose commit is missing. Its tests show where it stopped.

## Backbrief

**End-state.** Four code commits and one documentation commit on `main`. The store refuses a routine
saved to run more often than every 15 minutes with a sentence the bot can act on; the runner refuses
to start a run once today's runs of all bots have cost $25, before it touches the computer or the
model; a bot that stopped for help lets its computer sleep after 30 minutes with nobody on its
screen; and mail inside five minutes of a mail-triggered run starts one run when they are over. What
a person can watch is one refused goal under `DAILY_BUDGET_USD=0`: the budget card, an idle bot,
nothing spent. **Critical constraints.** The budget check comes before `ensureRunning` and before any
model call, or a refused run costs money; no text a user or the bot reads names an environment
variable (invariant 7); the hold must never end while a visible page shows the bot's screen, which is
the defect the held keep-alive fixed; and the release at the end of the hold runs on the bot's queue,
never from the bare timer. **Latitude.** Implementation decides log wording, helper names inside the
listed files, test names and order, and the exact line wrapping of the README and TODO text; it does
not change the numbers, the card and refusal sentences, the outcome name, or which module owns each
check.
