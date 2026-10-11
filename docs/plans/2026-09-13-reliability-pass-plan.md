> **STATUS: SHIPPED 2026-09-13.** Landed as 13 commits from `19bcc74` to `cf44ed1` (the commit list
> is in the private backlog, section 3). The unchecked `- [ ]` boxes below are historical — work is done.
> **Do not re-execute this plan.** If you are modifying the run lifecycle, boot recovery, Stop, the
> scheduler or the mail watcher, work directly in `src/server/agent/{runner,run,recovery,takeover,
> tools,context}.ts`, `src/server/scheduler/scheduler.ts` and `src/server/mail/{watcher,watermark}.ts`.
>
> **Plan-vs-reality corrections discovered during execution:**
>
> - Tasks 5, 7 and 8 did not get their own commits: `ab5bc29` ("Enhance mail handling and editor
>   functionality…") was a tool's auto-commit on the owner's machine (confirmed by the owner), made and
>   pushed under his git identity at 16:33 while the implementing session held the three tasks'
>   work uncommitted, before their reviews. Pushed history was not rewritten; the three tasks were
>   reviewed against that commit afterwards.
> - Task 1's anchor for the runner test was self-contradictory ("the end of the first describe block
>   (after the test 'a new goal on a blocked bot…')", a test in the third block); the test sits at the
>   end of the first block, where Task 2 also adds its test.
> - Task 6 lists `src/server/agent/tools.test.ts` as a test file, but none of its steps edits it.
> - Verification criteria 1, 2, 7 and 8 need the server or the page and were left to the act-two
>   round-2 session on the owner's instruction (no server in the implementing session).
>
> **Library/version drift:** none; no dependency added or changed.
>
> **Plan code prescriptions that needed adjustment:**
>
> - Task 2: `Runner.enqueue` became asynchronous (two file writes inside `accept` before the job enters
>   the queue), so the existing test "a goal that goes first leaves nothing for the hold to end" fired
>   its hold timer ahead of the goal; it now admits the goal with `await accept(...)` (`562df40`).
> - Task 7: `const byUid = …; rose = byUid ? … : …` did not typecheck (TS18047: `reading` is a `let`, so
>   the aliased condition does not narrow it); rewritten as one inline conditional (`ab5bc29`).
> - Task 7: the plan wrote the watermark when a rise was detected, before the debounce, so a rise held
>   by the debounce and lost to a crash sat behind a mark that said it was handled. The mark now moves
>   when the event fires, or on a first reading with nothing to deliver (`df1fd61`).
>
> **Corrections applied during review:**
>
> - `d1e1376` (Task 2, test quality, blocking): the `gate consume` branch of the recovery "approved"
>   check had no test of its own; added, with the null-target and long-goal wordings pinned.
> - `c758553` (Task 4, test quality, two blocking): the platform-tool Stop refusal and the clearing of
>   the stop request for the bot's next run were untested; added, with Stop before the first model call,
>   Stop over the stuck detector, no screenshot after a stopped takeover, and `isBusy` on a real runner.
> - `44a936b` (Task 7): the watermark file store, persisted state, had no test; added.
> - `df1fd61` (Task 7, code review, blocking): the watermark timing fix above, with two regression tests.
> - `4107769` (Task 7, test quality, two blocking): the store's write-failure path and the "same UID,
>   higher count" direction of the rise rule were untested; added, with the fallback to the count.
> - `9bc0d31` (Task 6, test quality, suggestions taken): the prompt rules behind finding R5 and the
>   `read_artifact` name refusal are pinned.
>
> **Deferrals worth tracking** (review suggestions that did not ship; for the write-up's known limits):
>
> - `isBusy` counts the blocked-hold release job, so a message typed in that short window gets the
>   "Queued… press Stop" note while Stop would answer "nothing is running" (Task 4 code review).
> - A takeover ended by Stop skips the unsafe-field check. Unreachable today because the page hides
>   Stop during a takeover; the check, or a comment, belongs in `TakeoverController.cancel()` before
>   any page change exposes it. `request_takeover` still writes "the human handed the screen back"
>   into the run log when the takeover ended by Stop (Task 4 code review).
> - The `max_tokens` retry is once per run, not once per occurrence, and the comment reads as the
>   latter; a later unrelated cut ends the run (Task 5 code review).
> - A routine run gets the last six chat lines as context although its goal never appears in the
>   chat; a secret typed into the chat by mistake now rides along for a few runs instead of one; the
>   `readChat` limit of 40 is an inline literal; the 1,000-character per-line cut, the 20,000-character
>   artifact cut and "there are no artifacts yet" are untested (Task 6 reviews).
> - The IMAP connect and status calls carry no explicit timeout (pre-existing; `needs docs: imapflow`
>   for 1.7.8's defaults); a single-segment `DATA_DIR` override puts the watermark file in the working
>   directory; a UIDVALIDITY change during downtime re-baselines and loses that downtime's mail (Task 7
>   code review).
> - Skills tab: the "saving…" note is keyed off the state, so a keystroke during a save hides it; a
>   failed save with a newer draft needs one keystroke to re-enable Save; the tab is not keyed by bot
>   (Task 8 code review).
> - `writeBot` bypasses the clip and the schema (pre-existing); `clipStatus` slices by UTF-16 unit; some
>   tests hardcode 200 instead of `STATUS_LINE_MAX` (Task 1 reviews). Several never-started closing
>   lines print in folder-name order, not send order; the message route answers 500 when `accept`
>   throws, untested (Task 2 code review). `readSkill` returns null for an unparseable skill file, which
>   the routine refusal calls "missing"; `record()` and `reload()` do unsynchronised read-modify-writes
>   of bot.json; the refusal message is duplicated in `routines.ts` and `tools.ts` (Task 3 reviews).
> - `unknownText(null)` reads "after you approved the action you approved" (the plan's wording;
>   unreachable today).
> - `data/mail-probe.mts`, the owner's git-ignored probe, still calls `unseenCount()`, renamed to `read()`.
>
> **Plan history below is preserved as-written for context. Treat the live code as authoritative.**

# Reliability Pass: Interrupted Work, Truthful Outcomes, Continuity — Implementation Plan

**Goal:** A run the platform accepted is never lost or misreported, a person can stop the bot at
any moment, mail that arrived while the platform was down still starts its routine, and a follow-up
message reaches the bot with the lines it answers.

**Approach:** Every fix goes into the module that already owns the decision, with one persisted
record per run from the moment a goal is accepted (`runs/<id>/events.jsonl`, starting with a
`queued` event). Boot recovery reads that record and says how far the run got. Two new outcomes,
`cancelled` and `unknown`, name what the old outcomes could not. A scheduled routine consumes its
occurrence when it starts, not when it ends. No new dependency, no database, no agent framework:
the files that exist carry the lifecycle. The two code reviews of 2026-09-13 and their verdicts are
recorded below, so this plan is self-contained.

**Design spec:** `docs/specs/2026-09-11-platform-design.md` (decision 5: one process, runs
serialised per bot; "Interrupted run" under the sandbox lifecycle). The owner took the consolidated list
on his word on 2026-09-13 ("all"), so the build runs ahead of the spec text: Task 9 adds the dated
amendment to the spec's Amendments section after the fixes.
**TODO items:** section 3, Delivery → "Reliability pass on interrupted work, truthful outcomes and
continuity" (added by Task 9; it did not exist before this plan).
**Branch:** `main`, one commit per task.
**Scope:** `src/server/store/{status,types,bot,index,routines}.ts`, `src/server/agent/{runner,run,
recovery,takeover,tools,gate,context,fakes}.ts`, `src/server/scheduler/scheduler.ts`,
`src/server/mail/{watcher,watermark}.ts`, `src/server/http/app.ts`, `src/server/index.ts`, their
tests (`src/server/store/store.test.ts` included), `src/web/{api.ts,App.tsx,components/Preview.tsx,components/SkillsTab.tsx}`,
`README.md`, the private backlog, `docs/specs/2026-09-11-platform-design.md`.
**Build estimate:** The owner's hours on human-only steps: none for the build; about ten minutes at the
keyboard for the two live criteria (a Stop press and a mail sent while the server is down), both
inside the act-two round-2 server session. Live-run cycles: one, that session. Every other criterion
is proven offline by tests.

## Findings and verdicts (the two reviews of 2026-09-13, checked against the code)

| # | Finding | Verdict | Task |
| --- | --- | --- | --- |
| R1 | A takeover reason up to 300 chars plus a 61-char suffix is written as `statusLine`, whose schema allows 200; the write throws, the tool error lets the model go on without handing over. The scheduler's status line overflows the same way, and its failed write also drops `nextRunAt`. | Confirmed (`tools.ts:358`, `takeover.ts:97`, `types.ts:26`, `scheduler.ts:143`) | 1 |
| R2 | A message typed during a run is queued as a new goal; nothing can stop a run. | Confirmed, by design (`app.ts:129`); the gap is the missing stop | 4 |
| R3 | A queued goal lives only in a promise chain; its run folder is created when it starts; a restart loses it silently. | Confirmed (`queue.ts`, `runner.ts:228`) | 2 |
| R4 | Recovery marks every open run `failed` and says "send it again"; a crash mid-run leaves the routine's planned time in `bot.json`, so the next boot fires it again as missed. | Confirmed (`recovery.ts:19`, `scheduler.ts:57`, `scheduler.ts:142`) | 2, 3 |
| R5 | Any final text is `done`, a question included. | Confirmed as behaviour; the final text is shown verbatim, so the harm is the question case | 6 (prompt) |
| R6 | A run starts with the goal only; "yes" and "make that letter shorter" have no context; nothing reads an artifact back. | Confirmed, deliberate until now (`run.ts:117`, `prompt.ts:32`) | 6 |
| R7 | A `max_tokens` cut inside a tool call is appended and continued; the docs say retry with a higher limit, and a tool call without a result is invalid. | Confirmed by the docs (Research) | 5 |
| R8 | A routine whose skill is missing runs anyway with one line of instructions; the Skills tab saves such a routine. | Confirmed (`scheduler.ts:134`, `routines.ts:123`) | 3 |
| R9 | `FileEditor` marks a draft typed during the save request as saved. | Confirmed (`SkillsTab.tsx:12`) | 8 |
| C1 | Mail that arrives while the platform is down starts nothing (README known limit; a `UIDNEXT` watermark is the named fix). | Confirmed (`watcher.ts:79`) | 7 |
| C2 | One unreadable bot folder stops boot recovery for every bot. | Confirmed (`recovery.ts:17`) | 2 |

## Where the plan differs from the reviews, and why

| # | Difference | Why |
| --- | --- | --- |
| D1 | Stop ends the active run only; goals queued behind it keep their turn, and the chat says a goal is queued. The reviewer asked to define amend, cancel and create: create is the default for a message, cancel is the Stop button, amend is Stop followed by a new goal. | No parsing of the user's words; nothing is dropped that the user did not name. |
| D2 | `unknown` is decided from the run's own events: an approval allowed or an approved action consumed. No new "irreversible-action intent" record. | The events already carry it; a second record could drift from the first. |
| D3 | No idempotency key on the message route. | The page sends once (the composer clears the draft and the request wrapper never retries); a double click is the only duplicate, and a queued goal is visible in the chat. Named in the write-up as the upgrade. |
| D4 | R5 is met by the prompt, not by a completion-evidence scheme: a question that needs an answer goes through `ask_user`, the skill offer included, so a final text is a report. `done` keeps meaning "the model ended the run". | The user reads the final text verbatim; keyword matching over prose was ruled out by the reviewer too. |
| D5 | Continuity is a bounded window: the last six chat lines before the goal, cards left out, at most 4,000 characters, plus a `read_artifact` tool. No persisted pending-question store. | Small, and it covers the reviewer's two examples. |
| D6 | The routine's occurrence is consumed when the run starts (`nextRunAt` written before `enqueueRun`). | Same effect as an occurrence identity, in the field that exists. |
| D7 | The boot-expired card gets no run-log event (my own earlier item). | The run's `end` event already says the run was cut short. |

## Assumptions made while planning

| # | Assumption | Why | Cost to change |
| --- | --- | --- | --- |
| A1 | `Runner.enqueue` keeps its signature; `Runner.accept` is the new entry that returns the run id, used by the message route. | Ten test call sites use `enqueue`; the scheduler keeps using it. | none |
| A2 | The mail watermark lives at `<dirname(DATA_DIR)>/mail-watermark.json`, `data/mail-watermark.json` by default, outside the bot folders. | One mailbox per platform; the bot listing reads `DATA_DIR` and must not see it. | 5 min |
| A3 | The Stop button is enabled while the bot is `working` or `waiting`. A `blocked` bot's run, if one is active behind a takeover, is stopped by the route (the button is disabled: the page cannot tell a takeover mid-run from a run that ended blocked). | The page has no run id; a 409 on every blocked bot would read as an error. | 15 min |
| A4 | A response cut inside a tool call is retried once with `max_tokens` doubled to 8192; a second cut ends the run `failed`. | Bounded, and the docs' rule. | none |
| A5 | The first user message keeps its old shape (the goal alone) when there is no earlier chat line, so every existing test keeps passing. | — | none |
| A6 | `data/mail-probe.mts`, the owner's git-ignored scratch probe, calls `unseenCount()`, which Task 7 renames to `read()`. Not part of the plan. | It is not in `src/`. | 1 min |

## Research (source links)

- [Anthropic, "How to implement tool use" → "Handling the `max_tokens` stop reason"](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use) — read 2026-09-13: "if the truncated response contains an incomplete tool use block, you'll need to retry the request with a higher `max_tokens` value"; and "Tool result blocks must immediately follow their corresponding tool use blocks in the message history". `@anthropic-ai/sdk` 0.125.0 types (`Anthropic.Messages.StopReason` includes `max_tokens`) are already in use in `run.ts`.
- imapflow 1.7.8, `status(path, query)` with `query.uidNext`, `query.uidValidity` and `query.unseen`; the result's `uidNext` is a `Number` and `uidValidity` a `BigInt` — verified 2026-09-13 in the installed package's own JSDoc, `node_modules/.pnpm/imapflow@1.7.8/node_modules/imapflow/lib/imap-flow.js` lines 3067–3100 (the project's docs page at imapflow.com moved; the README at <https://github.com/postalsys/imapflow> is the entry). `unseen` is what the watcher reads today.
- croner 10.0.1 `job.nextRun()` — already used by the scheduler (platform plan, Research).
- zod 4.6.2 `z.enum`, `z.object`, `z.discriminatedUnion` — already used in `types.ts`.
- React 19 `useRef` — already used in `App.tsx`.

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Create | `src/server/store/status.ts` | `STATUS_LINE_MAX`, `clipStatus` |
| Create | `src/server/store/status.test.ts` | the clip |
| Modify | `src/server/store/types.ts` | `statusLine` max from the constant; `RunOutcome` + `cancelled`, `unknown`; `queued` run event |
| Modify | `src/server/store/bot.ts` | `updateBot` clips `statusLine` |
| Modify | `src/server/store/index.ts` | export the clip |
| Modify | `src/server/store/routines.ts` | a routine's skill must exist at save |
| Modify | `src/server/agent/runner.ts` | `accept`, `isBusy`, `cancel`, `stopRequests`, `run(botId, runId, input)` |
| Modify | `src/server/agent/run.ts` | stop checks, `max_tokens` retry, recent context, `maxTokens` |
| Create | `src/server/agent/context.ts` | `recentConversation`, `firstUserMessage` |
| Create | `src/server/agent/context.test.ts` | the window's bounds |
| Modify | `src/server/agent/recovery.ts` | not started / interrupted / unknown; per-bot isolation |
| Modify | `src/server/agent/takeover.ts` | `cancel()`, `STOPPED_HOW` |
| Modify | `src/server/agent/gate.ts` | `Approvals.pendingFor` |
| Modify | `src/server/agent/tools.ts` | `cancelRequested` on `RunContext`, `read_artifact`, `remember` wording, `STOPPED_ANSWER` |
| Modify | `src/server/agent/prompt.ts` | memory rule, question rule, skill offer through `ask_user` |
| Modify | `src/server/agent/fakes.ts` | `stop` flag in `makeContext` |
| Modify | `src/server/scheduler/scheduler.ts` | occurrence consumed at start; missing skill refused; `record()` |
| Modify | `src/server/mail/watcher.ts` | `read()` with `uidNext`; watermark; boot catch-up |
| Create | `src/server/mail/watermark.ts` | the JSON file store |
| Modify | `src/server/http/app.ts` | `accept` + `runId`, queued note, `POST /api/bots/:id/stop`, `RunnerPort` |
| Modify | `src/server/index.ts` | the watermark file |
| Modify | `src/web/api.ts` | `stop`, `runId` in the message answer |
| Modify | `src/web/App.tsx` | `stop`, `canStop` |
| Modify | `src/web/components/Preview.tsx` | the Stop button |
| Modify | `src/web/components/SkillsTab.tsx` | the save race |
| Modify | `README.md`, the private backlog | known limits, Stop, the recovery wording, the item |
| Modify | `docs/specs/2026-09-11-platform-design.md` | a dated addendum under Amendments: three closing states, Stop, continuity, the watermark |
| Test | `src/server/agent/{runner,run,recovery,tools}.test.ts`, `src/server/scheduler/scheduler.test.ts`, `src/server/mail/watcher.test.ts`, `src/server/http/app.test.ts`, `src/server/store/store.test.ts` | one failing reproduction per finding, then the fix |

## Tasks

### Task 1: Status text never blocks a transition [integration] [support]

**Files:** Create `src/server/store/status.ts`, `src/server/store/status.test.ts`; Modify
`src/server/store/types.ts`, `src/server/store/bot.ts`, `src/server/store/index.ts`; Test
`src/server/agent/runner.test.ts`, `src/server/scheduler/scheduler.test.ts`.
**Invariant:** 5 — a takeover must happen whenever the model asks for one; a display string cannot
be the reason it does not. 6 — the routine's state is written whatever its summary looks like.
**Demo step:** support: act two's mailbox sign-in is a `request_takeover`; a long reason today ends
with the model typing on without a hand-over.
**Verify:** `pnpm exec vitest run src/server/store src/server/agent/runner.test.ts src/server/scheduler/scheduler.test.ts && pnpm typecheck`

- [ ] Create `src/server/store/status.ts`:

```ts
/** The longest status line bot.json holds: one line under the bot's name in the roster. */
export const STATUS_LINE_MAX = 200

/**
 * Display text never blocks a state change. A takeover reason or a run summary longer than the
 * line is folded to one line and cut with an ellipsis before it reaches the schema. Review finding
 * of 2026-09-13: a valid 300-character takeover reason failed the write, the tool error went back
 * to the model, and the run went on without handing the screen over.
 */
export function clipStatus(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= STATUS_LINE_MAX) return oneLine
  return oneLine.slice(0, STATUS_LINE_MAX - 1) + '…'
}
```

- [ ] Create `src/server/store/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clipStatus, STATUS_LINE_MAX } from './status'

describe('clipStatus', () => {
  it('keeps a short line as it is and cuts a long one to the limit with an ellipsis', () => {
    expect(clipStatus('working')).toBe('working')
    const long = 'x'.repeat(STATUS_LINE_MAX + 50)
    expect(clipStatus(long)).toHaveLength(STATUS_LINE_MAX)
    expect(clipStatus(long).endsWith('…')).toBe(true)
  })

  it('folds line breaks into spaces, because the line sits under the bot name', () => {
    expect(clipStatus('a\n  b')).toBe('a b')
  })
})
```

- [ ] In `src/server/agent/runner.test.ts`, change the imports: add `type ToolDef` and
`basePlatformTools` from `'./tools'`, and `toolUse` to the list imported from `'./fakes'`. Replace
the helper `function runnerWith(factory: SessionFactory, model: FakeModel): Runner {` with
`function runnerWith(factory: SessionFactory, model: FakeModel, tools: ToolDef[] = []): Runner {`
and inside it replace `tools: [],` with `tools,`. Then add, at the end of the first `describe`
block (after the test "a new goal on a blocked bot drops the held keep-alive and ends the open
takeover card"):

```ts
  // Review finding of 2026-09-13: the reason is allowed 300 characters, the status line 200, and
  // the failed write turned a valid takeover into a tool error the model talked over.
  it('a takeover with the longest allowed reason still hands the screen over, and the card keeps the full text', async () => {
    const reason = 'r'.repeat(300)
    const sandbox = new FakeSandbox()
    sandbox.companion.states = [
      { url: 'https://example.com/login', fingerprint: 'a', unsafe: false },
      { url: 'https://example.com/inbox', fingerprint: 'b', unsafe: false },
    ]
    const model = new FakeModel([message([toolUse('request_takeover', { reason })]), message([textBlock('signed in')], 'end_turn')])
    const runner = runnerWith(fakeFactory(sandbox), model, basePlatformTools)

    const result = runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' })
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('blocked'))
    expect((await store.readBot(botId)).statusLine).toHaveLength(200)
    expect(await runner.handback(botId)).toEqual({ ok: true })
    expect((await result)?.outcome).toBe('done')

    const card = (await store.readChat(botId, { limit: 20 })).find((m) => m.card?.card === 'takeover')?.card
    expect(card).toMatchObject({ status: 'ended', reason: expect.stringContaining(reason) })
  })
```

- [ ] In `src/server/scheduler/scheduler.test.ts`, add a module-level `let summary = ''` under
`let holdRun: ...`, set `summary = 'checked 1 source, 1 new\nmore detail'` as the first line of the
`beforeEach` body, and in the `scheduler()` helper replace
`return { outcome: 'done', summary: 'checked 1 source, 1 new\nmore detail' }` with
`return { outcome: 'done', summary }`. Then add after the test "records the result and the status
line after a fired run completes":

```ts
  // Review finding of 2026-09-13: the status line is the summary behind a prefix; over 200
  // characters the whole update failed, lastRunAt and nextRunAt included.
  it('records the run even when its summary fills the whole status line', async () => {
    summary = 's'.repeat(200)
    await store.writeRoutine(botId, morning)
    const s = scheduler(new Date('2026-09-11T04:59:59.000Z'))
    await s.reload(botId)
    clock = new Date('2026-09-11T05:00:01.000Z')
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.lastRunAt).toBe('2026-09-11T05:00:01.000Z'))
    const bot = await store.readBot(botId)
    expect(bot.statusLine.length).toBeLessThanOrEqual(200)
    expect(bot.statusLine.startsWith('routine: morning — sss')).toBe(true)
    await s.stop()
  })
```

- [ ] **Verify the new tests fail:** run the Verify command. The clip test cannot import
`./status`; the runner test times out waiting for `blocked` (the write threw and the model went
on); the scheduler test times out waiting for `lastRunAt`.
- [ ] In `src/server/store/types.ts`, add `import { STATUS_LINE_MAX } from './status'` as the
second import and replace `statusLine: z.string().max(200),` with
`statusLine: z.string().max(STATUS_LINE_MAX),`.
- [ ] In `src/server/store/bot.ts`, add `import { clipStatus } from './status'` after the
`./paths` import and replace the body of `updateBot` with:

```ts
export async function updateBot(dataDir: string, botId: string, patch: Partial<Omit<Bot, 'id'>>): Promise<Bot> {
  const current = await readBot(dataDir, botId)
  // The status line is display text: clipped here, once, so no caller can fail a state change with it.
  const clipped = patch.statusLine === undefined ? patch : { ...patch, statusLine: clipStatus(patch.statusLine) }
  const next = Bot.parse({ ...current, ...clipped, id: current.id })
  await writeBot(dataDir, next)
  return next
}
```

- [ ] In `src/server/store/index.ts`, add `export { clipStatus, STATUS_LINE_MAX } from './status'`
after the `assertArtifactName` export line.
- [ ] **Verify the tests pass:** run the Verify command.
- [ ] **Commit** `Clip the status line so display text cannot block a takeover or a routine record`.

### Task 2: The run record exists from acceptance, and recovery says how far a run got [integration] [support]

**Files:** Modify `src/server/store/types.ts`, `src/server/agent/runner.ts`,
`src/server/agent/recovery.ts`, `src/server/http/app.ts`; Test `src/server/agent/recovery.test.ts`,
`src/server/agent/runner.test.ts`, `src/server/http/app.test.ts`.
**Invariant:** 6 — a goal the platform accepted survives a restart as a record with an honest
closing line, never as silence. 2 and 4 — after a restart that followed an approved action the bot
says the outcome is unknown instead of "send it again", so a duplicate booking is the user's
informed choice, not the platform's default.
**Demo step:** support: the persistence check of 2026-09-13 is the demo's restart story; its
closing line must be true for every way a run can be cut.
**Verify:** `pnpm exec vitest run src/server/agent/recovery.test.ts src/server/agent/runner.test.ts src/server/http/app.test.ts src/server/store && pnpm typecheck`

- [ ] In `src/server/agent/recovery.test.ts`, change the import line to
`import { NOT_STARTED_SUMMARY, notStartedText, recoverAtBoot, RESTARTED_SUMMARY, RESTARTED_TAKEOVER_REASON, RESTARTED_TEXT, UNKNOWN_SUMMARY, unknownText } from './recovery'`
and add `import { writeFile } from 'node:fs/promises'` to the `node:fs/promises` import (`cp, mkdtemp, rm, writeFile`).
Add at the end of the `describe` block:

```ts
  // Review finding of 2026-09-13: a goal accepted behind a long run lived only in memory, so a
  // restart lost it with the user's message still in the chat and no answer ever.
  it('closes a goal that was accepted but never started as not started, and names it in the chat', async () => {
    const bot = await store.createBot({ name: 'Worker', persona: 'Works.' })
    await store.startRun(bot.id, 'run-queued')
    await store.appendRunEvent({ t: 'x', runId: 'run-queued', botId: bot.id, type: 'queued', goal: 'Prepare an application for Acme', source: 'message' })
    await store.startRun(bot.id, 'run-routine')
    await store.appendRunEvent({ t: 'x', runId: 'run-routine', botId: bot.id, type: 'queued', goal: 'Check the board.', source: 'routine', routineName: 'morning-search' })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 2, endedCards: 0 })

    expect((await store.readRunEvents(bot.id, 'run-queued')).at(-1)).toMatchObject({ type: 'end', outcome: 'failed', summary: NOT_STARTED_SUMMARY })
    expect((await store.readChat(bot.id, { limit: 5 })).map((m) => m.text)).toEqual([
      notStartedText({ goal: 'Prepare an application for Acme', source: 'message' }),
      notStartedText({ goal: 'Check the board.', source: 'routine', routineName: 'morning-search' }),
    ])
    expect(notStartedText({ goal: 'Prepare an application for Acme', source: 'message' })).toBe(
      'The server restarted before I started on "Prepare an application for Acme", so nothing was done. Send it again if you still want it.',
    )
    expect(notStartedText({ goal: 'Check the board.', source: 'routine', routineName: 'morning-search' })).toBe(
      'The server restarted before my routine morning-search started, so it did not run this time.',
    )
  })

  // A crash after an approved action but before the success line: the platform cannot know
  // whether the booking went through, and "send it again" would invite a second one.
  it('closes a run interrupted after an approved action as unknown, and names the approved control', async () => {
    const bot = await store.createBot({ name: 'Booker', persona: 'Books.' })
    await store.startRun(bot.id, 'run-booking')
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'queued', goal: 'book it', source: 'message' })
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'status', text: 'working', botState: 'working' })
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'approval', approvalId: 'a1', status: 'pending' })
    await store.appendRunEvent({ t: 'x', runId: 'run-booking', botId: bot.id, type: 'approval', approvalId: 'a1', status: 'allowed' })
    await store.appendChat(bot.id, {
      role: 'card',
      card: { card: 'approval', approvalId: 'a1', runId: 'run-booking', actionKind: 'book', summary: 'Book Monday 9:00', consequences: [], warnings: [], target: 'Schedule Event', url: 'https://example.com/book', shot: null, status: 'allowed', announced: true },
    })
    await store.updateBot(bot.id, { state: 'working', statusLine: 'working' })

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 1, endedCards: 0 })

    expect((await store.readRunEvents(bot.id, 'run-booking')).at(-1)).toMatchObject({ type: 'end', outcome: 'unknown', summary: UNKNOWN_SUMMARY })
    expect((await store.readChat(bot.id, { limit: 5 })).at(-1)?.text).toBe(unknownText('Schedule Event'))
    expect(unknownText('Schedule Event')).toBe(
      'The server restarted while I was working, after you approved "Schedule Event". I cannot tell whether it went through: check before you send the goal again.',
    )
    expect((await store.readBot(bot.id)).state).toBe('idle')
  })

  it('one bot folder that cannot be read does not stop recovery for the others', async () => {
    const broken = await store.createBot({ name: 'Alpha', persona: 'Breaks.' })
    const fine = await store.createBot({ name: 'Zulu', persona: 'Works.' })
    await store.startRun(fine.id, 'run-open')
    await store.appendRunEvent({ t: 'x', runId: 'run-open', botId: fine.id, type: 'step', step: 1, action: 'screenshot', input: {} })
    // runs/ is a file, not a folder: listing it throws something that is not "not found".
    await rm(join(store.botDir(broken.id), 'runs'), { recursive: true, force: true })
    await writeFile(join(store.botDir(broken.id), 'runs'), 'not a folder')

    expect(await recoverAtBoot(store)).toEqual({ closedRuns: 1, endedCards: 0 })

    expect(await store.listOpenRuns(fine.id)).toEqual([])
  })
```

- [ ] In `src/server/agent/runner.test.ts`, add at the end of the first `describe` block:

```ts
  // Review finding of 2026-09-13: the run folder appeared when the run started, so a goal waiting
  // behind another run had no record a restart could find.
  it('the run record exists as soon as a goal is accepted, before its turn on the queue', async () => {
    const model = new FakeModel([
      message([toolUse('ask_user', { question: 'Which company?' })]),
      message([textBlock('first done')], 'end_turn'),
      message([textBlock('second done')], 'end_turn'),
    ])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)

    const first = runner.enqueue(botId, { goal: 'first', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))
    const second = await runner.accept(botId, { goal: 'second', activeSkill: null, source: 'message' })

    expect(await store.readRunEvents(botId, second.runId)).toEqual([expect.objectContaining({ type: 'queued', goal: 'second', source: 'message' })])
    expect(await store.listOpenRuns(botId)).toContain(second.runId)
    expect(runner.answerUser(botId, 'Acme')).toBe(true)
    expect((await first)?.outcome).toBe('done')
    expect((await second.done)?.outcome).toBe('done')
  })
```

- [ ] In `src/server/http/app.test.ts`, replace the stand-in's `enqueue` with `accept`: in the
`runner` literal of `beforeEach`, replace

```ts
    enqueue: async (_id, input) => {
      runner.enqueued.push(input)
    },
```

with

```ts
    accept: async (_id, input) => {
      runner.enqueued.push(input)
      return { runId: 'run-test', done: Promise.resolve(undefined) }
    },
```

and in the test "starts a run with the text as the goal when nothing is waiting" replace
`expect(await res.json()).toMatchObject({ answered: false })` with
`expect(await res.json()).toMatchObject({ answered: false, runId: 'run-test' })`.

- [ ] **Verify the new tests fail:** run the Verify command. The recovery tests cannot import
`notStartedText`; the `queued` event fails the schema; `runner.accept` is not a function; the app
test's stand-in does not satisfy `RunnerPort`.
- [ ] In `src/server/store/types.ts`, replace the `RunOutcome` comment, constant and type (three items) with:

```ts
/**
 * `budget` is a run stopped by a cap: the per-run step or call cap, after which the computer is
 * held for a takeover, or the daily budget, which refuses the run before it starts and holds
 * nothing. `cancelled`: the user pressed Stop. `unknown`: the server restarted after the user
 * approved an action, and the platform cannot tell whether it happened. The run's chat card and
 * its end summary say which.
 */
export const RunOutcome = z.enum(['done', 'failed', 'blocked', 'budget', 'stuck', 'denied', 'cancelled', 'unknown'])
export type RunOutcome = z.infer<typeof RunOutcome>
```

and add, as the first member of the `RunEvent` union (before the `step` object):

```ts
  // Written when the goal is accepted, before its turn on the queue: the record a restart finds.
  z.object({ ...envelope, type: z.literal('queued'), goal: z.string(), source: z.enum(['message', 'routine']), routineName: z.string().optional() }),
```

- [ ] In `src/server/agent/runner.ts`, replace the `enqueue` method with:

```ts
  /**
   * Accepts a goal: the run record exists, with a `queued` event, before this resolves, so a
   * restart closes a goal that never started instead of losing it. `done` resolves when the run
   * has ended; runs on one bot never overlap.
   */
  async accept(botId: string, input: RunInput): Promise<{ runId: string; done: Promise<RunResult | undefined> }> {
    const runId = randomUUID()
    await this.deps.store.startRun(botId, runId)
    const queued = { t: new Date().toISOString(), runId, botId, type: 'queued' as const, goal: input.goal, source: input.source, ...(input.routineName === undefined ? {} : { routineName: input.routineName }) }
    await this.deps.store.appendRunEvent(queued)
    this.deps.events.emitRun(queued)
    const done = this.deps.queue.enqueue(botId, () => this.run(botId, runId, input))
    return { runId, done }
  }

  /** Queues a run on the bot and resolves with its result when it has ended. */
  async enqueue(botId: string, input: RunInput): Promise<RunResult | undefined> {
    return (await this.accept(botId, input)).done
  }
```

Then replace `private async run(botId: string, input: RunInput): Promise<RunResult | undefined> {`
with `private async run(botId: string, runId: string, input: RunInput): Promise<RunResult | undefined> {`
and delete the two lines `const runId = randomUUID()` and `await store.startRun(botId, runId)`
that followed `const { store, events, approvals, sandboxes } = this.deps`.

- [ ] Replace the whole of `src/server/agent/recovery.ts` with:

```ts
import { errorFields, log } from '../log'
import type { Card, RunEvent, Store } from '../store'

export const RESTARTED_SUMMARY = 'the server restarted during this run'
export const RESTARTED_TEXT = 'The server restarted while I was working, so I stopped. Send the goal again to retry.'
export const NOT_STARTED_SUMMARY = 'the server restarted before this run started'
export const UNKNOWN_SUMMARY = 'the server restarted after an approved action; whether it happened is unknown'
/** Replaces the text of a takeover card the previous process left active: nobody is waiting behind it any more. */
export const RESTARTED_TAKEOVER_REASON = 'The server restarted, so I am no longer waiting for you on my screen. Send me the next goal.'

const GOAL_PREVIEW = 120

type Queued = Extract<RunEvent, { type: 'queued' }>

/** The chat line for a goal the previous process accepted but never started. */
export function notStartedText(queued: Pick<Queued, 'goal' | 'source' | 'routineName'>): string {
  if (queued.source === 'routine') return `The server restarted before my routine ${queued.routineName ?? ''} started, so it did not run this time.`
  const goal = queued.goal.replace(/\s+/g, ' ').trim()
  const preview = goal.length > GOAL_PREVIEW ? goal.slice(0, GOAL_PREVIEW - 1) + '…' : goal
  return `The server restarted before I started on "${preview}", so nothing was done. Send it again if you still want it.`
}

/** The chat line for a run cut after the user approved an action: the platform cannot know whether it happened. */
export function unknownText(target: string | null): string {
  const what = target === null ? 'the action you approved' : `"${target}"`
  return `The server restarted while I was working, after you approved ${what}. I cannot tell whether it went through: check before you send the goal again.`
}

/**
 * Closes every run the previous process left open, puts every bot back to idle, and ends the cards
 * only that process could have answered: a takeover it was waiting on, an approval its in-memory
 * registry held. What the closing line says depends on how far the run got: never started (a
 * `queued` event and nothing after it), interrupted, or interrupted after an approved action, whose
 * outcome is unknown. One bot folder that fails is logged and the others still recover. Sandboxes
 * are not touched: they are paused, or will be resumed on demand.
 */
export async function recoverAtBoot(store: Store): Promise<{ closedRuns: number; endedCards: number }> {
  let closedRuns = 0
  let endedCards = 0
  for (const bot of await store.listBots()) {
    try {
      for (const runId of await store.listOpenRuns(bot.id)) {
        const closing = await closingFor(store, bot.id, runId, await store.readRunEvents(bot.id, runId))
        await store.appendRunEvent({ t: new Date().toISOString(), runId, botId: bot.id, type: 'end', outcome: closing.outcome, summary: closing.summary })
        await store.appendChat(bot.id, { role: 'bot', text: closing.text })
        closedRuns += 1
        log.warn('closed a run interrupted by the restart', { botId: bot.id, runId, outcome: closing.outcome })
      }
      if (bot.state !== 'idle') await store.updateBot(bot.id, { state: 'idle', statusLine: 'restarted' })
      endedCards += await endOpenCards(store, bot.id)
    } catch (e) {
      log.error('recovery failed for one bot; the others continue', { botId: bot.id, ...errorFields(e) })
    }
  }
  return { closedRuns, endedCards }
}

type Closing = { outcome: 'failed' | 'unknown'; summary: string; text: string }

async function closingFor(store: Store, botId: string, runId: string, events: RunEvent[]): Promise<Closing> {
  const queued = events.find((e): e is Queued => e.type === 'queued')
  const started = events.some((e) => e.type === 'status')
  if (queued && !started) return { outcome: 'failed', summary: NOT_STARTED_SUMMARY, text: notStartedText(queued) }
  const approved = events.some((e) => (e.type === 'approval' && e.status === 'allowed') || (e.type === 'gate' && e.decision === 'consume'))
  if (!approved) return { outcome: 'failed', summary: RESTARTED_SUMMARY, text: RESTARTED_TEXT }
  const chat = await store.readChat(botId, { limit: Number.MAX_SAFE_INTEGER })
  const allowed = [...chat].reverse().find((m) => m.card?.card === 'approval' && m.card.runId === runId && m.card.status === 'allowed')
  const target = allowed?.card?.card === 'approval' ? allowed.card.target : null
  return { outcome: 'unknown', summary: UNKNOWN_SUMMARY, text: unknownText(target) }
}

/**
 * A card left open by the previous process has nothing behind it: the takeover controller and the
 * approval registry live in memory. Left as it is, the page would ask for a Take over button that
 * is not there, or answer Allow with "unknown approval" forever (seen live on 2026-09-13).
 */
async function endOpenCards(store: Store, botId: string): Promise<number> {
  let ended = 0
  for (const message of await store.readChat(botId, { limit: Number.MAX_SAFE_INTEGER })) {
    const closed = closedCard(message.card)
    if (closed === null) continue
    await store.updateChatCard(botId, message.id, closed)
    log.warn('ended a card left open by the restart', { botId, messageId: message.id, card: closed.card })
    ended += 1
  }
  return ended
}

function closedCard(card: Card | undefined): Card | null {
  if (!card) return null
  if (card.card === 'takeover' && card.status === 'active') return { ...card, status: 'ended', reason: RESTARTED_TAKEOVER_REASON }
  if (card.card === 'approval' && card.status === 'pending') return { ...card, status: 'expired' }
  return null
}
```

- [ ] In `src/server/http/app.ts`, replace the `RunnerPort` line with
`export type RunnerPort = Pick<Runner, 'answerUser' | 'accept' | 'requestTakeover' | 'handbackState' | 'handback'>`
and in the messages route replace

```ts
    void runner.enqueue(loaded.bot.id, { goal: parsed.body.text, activeSkill: null, source: 'message' })
    return c.json({ message, answered: false })
```

with

```ts
    const { runId } = await runner.accept(loaded.bot.id, { goal: parsed.body.text, activeSkill: null, source: 'message' })
    return c.json({ message, answered: false, runId })
```

- [ ] **Verify the tests pass:** run the Verify command. The existing recovery test "closes runs
left open by the previous process" still expects `RESTARTED_TEXT`: its run has a `step` event and
no `queued` one, so it is an interrupted run.
- [ ] **Commit** `Create the run record when a goal is accepted and let recovery say how far it got`.

### Task 3: A scheduled occurrence is consumed when it starts; a routine without its skill does not run [integration] [support]

**Files:** Modify `src/server/scheduler/scheduler.ts`, `src/server/store/routines.ts`; Test
`src/server/scheduler/scheduler.test.ts`, `src/server/http/app.test.ts`, `src/server/store/store.test.ts`.
**Invariant:** 4 and 6 — a restart never starts a paid run by itself for an occurrence that already
started; a routine never runs without the instructions it was saved for.
**Demo step:** support: the morning search is a scheduled routine; a restart during it would fire it
again at boot with nobody asking.
**Verify:** `pnpm exec vitest run src/server/scheduler src/server/store src/server/http/app.test.ts src/server/agent/tools.test.ts && pnpm typecheck`

- [ ] In `src/server/scheduler/scheduler.test.ts`, replace the test "runs a routine whose skill file
is missing without the skill, and the process stays up" with:

```ts
  // Review finding of 2026-09-13: a routine is its skill's schedule; without the skill it was a paid
  // run with one line of instructions.
  it('does not run a routine whose skill is missing, and says so in its state and the status line', async () => {
    await store.writeRoutine(botId, morning)
    await rm(join(store.botDir(botId), 'skills', 'search-board.md'))
    const s = scheduler(FRIDAY_0600)
    await s.reload(botId)
    await store.updateBot(botId, { routines: { morning: { nextRunAt: '2026-09-11T03:00:00.000Z', lastRunAt: null, lastResult: null } } })
    await s.reload(botId) // one hour late → the missed run would start
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.lastResult).toBe('skill search-board is missing; the routine did not run'))
    expect(runs).toHaveLength(0)
    expect((await store.readBot(botId)).statusLine).toBe('routine: morning — skill search-board is missing; the routine did not run')
    await s.stop()
  })

  // Review finding of 2026-09-13: nextRunAt moved only after the run, so a crash mid-run left the
  // planned time behind and the next boot fired the routine again as "missed".
  it('consumes the occurrence when the run starts: a restart mid-run does not fire it again as missed', async () => {
    await store.writeRoutine(botId, morning)
    holdRun = { resolve: () => undefined }
    const s = scheduler(new Date('2026-09-11T04:59:59.000Z'))
    await s.reload(botId)
    clock = new Date('2026-09-11T05:00:01.000Z')
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    // The run is in flight and the process dies here: what bot.json holds is what the next boot sees.
    await vi.waitFor(async () => expect((await store.readBot(botId)).routines.morning?.nextRunAt).toBe(MONDAY_0700_ISO))
    const next = scheduler(new Date('2026-09-11T05:10:00.000Z'))
    await next.reload(botId)
    await vi.advanceTimersByTimeAsync(50)
    expect(runs).toHaveLength(1)
    holdRun?.resolve()
    holdRun = null
    await s.stop()
    await next.stop()
  })
```

- [ ] In `src/server/http/app.test.ts`, in the test "lists the files and rejects a routine with a
bad schedule on save", add before the `const ok = ...` line:

```ts
    const ghost = await app.request(`/api/bots/${botId}/routines/morning`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '---\nskill: ghost\nschedule: 0 7 * * 1-5\n---\nRun.' }) })
    expect(ghost.status).toBe(400)
    expect(await ghost.json()).toEqual({ error: 'there is no skill named ghost; save the skill first' })
```

- [ ] In `src/server/store/store.test.ts`, three `writeRoutine` calls save a routine for a skill the
test never creates, which the skill check below turns into an error. After `const bot = await newBot()`
add one line in each: in "writeRoutine accepts a cron expression and round-trips enabled as a boolean"
and in "writeRoutine refuses a schedule that runs more often than every 15 minutes and saves one that
runs every 15", `await store.writeSkill(bot.id, { name: 'search-board', description: 'Search', body: 'Open the board.\n' })`;
in "writeRoutine requires exactly one of schedule and event", `await store.writeSkill(bot.id, { name: 's', description: 'S', body: 'Do.\n' })`.
These lines are harmless before the check lands and required after it.
- [ ] **Verify the new tests fail:** run the Verify command. The missing-skill test sees one run
and no `lastResult`; the occurrence test times out waiting for Monday; the route answers 204.
- [ ] In `src/server/store/routines.ts`, add `import { readSkill } from './skills'` next to the
other imports and replace the first line of `writeRoutine`'s body, `const valid = validateRoutine(routine, limits)`, with:

```ts
  const valid = validateRoutine(routine, limits)
  // A routine is a schedule for a skill. Saved for a skill that does not exist, it would arm a run
  // with one line of instructions; the bot's own tool checks the same before it saves.
  if ((await readSkill(dataDir, botId, valid.skill)) === null) throw new Error(`there is no skill named ${valid.skill}; save the skill first`)
```

- [ ] In `src/server/scheduler/scheduler.ts`, replace the whole `runRoutine` method with:

```ts
  private async runRoutine(botId: string, routineName: string): Promise<void> {
    const { store } = this.deps
    let routine: Routine | null
    try {
      routine = await store.readRoutine(botId, routineName)
    } catch (e) {
      log.error('routine could not be read when it fired', { botId, routine: routineName, ...errorFields(e) })
      return
    }
    if (!routine || !routine.enabled) return
    const job = this.jobs.get(botId)?.get(routineName)
    let skill = null
    try {
      skill = await store.readSkill(botId, routine.skill)
    } catch (e) {
      log.warn('the routine skill could not be read', { botId, routine: routineName, skill: routine.skill, ...errorFields(e) })
    }
    if (!skill) {
      // A routine is its skill's schedule: without the skill it would be a paid run with one line.
      log.warn('routine not run: its skill is missing', { botId, routine: routineName, skill: routine.skill })
      await this.record(botId, routineName, job, { lastResult: `skill ${routine.skill} is missing; the routine did not run` })
      return
    }
    // The occurrence is consumed when the run starts: a run cut by a restart is not "missed" and is
    // not started again at the next boot. The result is recorded when the run ends.
    await this.record(botId, routineName, job, {})
    log.info('routine fired', { botId, routine: routineName })
    const result = await this.deps.enqueueRun(botId, { goal: routine.body, activeSkill: skill, source: 'routine', routineName })
    const lastResult = (result?.summary ?? 'could not run').split('\n')[0]?.slice(0, 200) ?? ''
    await this.record(botId, routineName, job, { lastRunAt: this.deps.now().toISOString(), lastResult })
  }

  /** Writes the routine's state, and the status line when there is a result. Never rejects: a failed write is logged. */
  private async record(botId: string, routineName: string, job: Cron | undefined, patch: Partial<RoutineState>): Promise<void> {
    const { store } = this.deps
    try {
      const bot = await store.readBot(botId)
      const previous = bot.routines[routineName] ?? { nextRunAt: null, lastRunAt: null, lastResult: null }
      const state: RoutineState = { ...previous, ...patch, nextRunAt: job?.nextRun()?.toISOString() ?? previous.nextRunAt }
      const statusLine = patch.lastResult === undefined ? {} : { statusLine: `routine: ${routineName} — ${patch.lastResult}` }
      const updated = await store.updateBot(botId, { routines: { ...bot.routines, [routineName]: state }, ...statusLine })
      this.deps.onBotUpdated?.(updated)
    } catch (e) {
      log.error('could not record the routine state', { botId, routine: routineName, ...errorFields(e) })
    }
  }
```

Also update the file's header comment: replace "a run less than 12 hours late is started once at
boot, an older one is skipped and logged." with "a run less than 12 hours late is started once at
boot, an older one is skipped and logged; a run that had started before the restart is not late,
because its occurrence was consumed when it started."

- [ ] **Verify the tests pass:** run the Verify command. The tests "records the result and the
status line after a fired run completes", "stop() waits for a run in flight" and "a reload while
the routine is running does not fire it a second time" keep passing: the pre-run record writes
`nextRunAt` only, and the post-run record writes the rest.
- [ ] **Commit** `Consume a routine's occurrence when its run starts and refuse a routine without its skill`.

### Task 4: Stop is explicit [integration] [demo-path]

**Files:** Modify `src/server/agent/gate.ts`, `src/server/agent/takeover.ts`,
`src/server/agent/tools.ts`, `src/server/agent/run.ts`, `src/server/agent/runner.ts`,
`src/server/agent/fakes.ts`, `src/server/http/app.ts`, `src/web/api.ts`, `src/web/App.tsx`,
`src/web/components/Preview.tsx`; Test `src/server/agent/run.test.ts`,
`src/server/agent/runner.test.ts`, `src/server/http/app.test.ts`.
**Invariant:** 4 — a person can end the bot's work at any moment, and a pending approval is
denied by the stop, never allowed. 1 — the page shows the stop as a chat line and the bot going idle.
**Demo step:** act one: "Stop, this is the wrong company" while the bot fills the form.
**Verify:** `pnpm exec vitest run src/server/agent src/server/http/app.test.ts && pnpm typecheck`

- [ ] In `src/server/agent/fakes.ts`, add `stop: { requested: boolean }` to `TestContext` (with the
comment `/** The user's Stop button. */`), declare `const stop = { requested: false }` next to
`manualTakeover` in `makeContext`, add `cancelRequested: () => stop.requested,` after
`takeoverRequested`, and add `stop` to the returned object.

- [ ] In `src/server/agent/run.test.ts`, add `STOPPED_TEXT` to the import from `'./run'` and add a
new `describe` block at the end of the file:

```ts
// Review finding of 2026-09-13: nothing could end a run; a correction typed in the chat became the
// next goal behind the work it meant to stop.
describe('Stop', () => {
  it('a stop request ends the run before its next action, with outcome cancelled and an honest chat line', async () => {
    const model = new FakeModel([message([computerUse('screenshot'), computerUse('left_click', { coordinate: [10, 20] })])])
    const sandbox = new FakeSandbox()
    const t = makeContext({ store, botId, model, sandbox })
    const emit = t.ctx.emit
    t.ctx.emit = async (body) => {
      // The user presses Stop while the screenshot is being logged: the click after it must not run.
      if (body.type === 'tool_result' && body.name === 'screenshot') t.stop.requested = true
      await emit(body)
    }

    const result = await runLoop(t.ctx, goal)

    expect(result).toEqual({ outcome: 'cancelled', summary: 'stopped by the user' })
    expect(sandbox.methods()).toEqual(['screenshot'])
    expect(model.calls).toHaveLength(1)
    expect(t.chat.map((m) => m.text)).toEqual([STOPPED_TEXT])
    expect(t.states.at(-1)).toBe('idle')
    expect(t.events.at(-1)).toMatchObject({ type: 'end', outcome: 'cancelled' })
  })
})
```

- [ ] In `src/server/agent/runner.test.ts`, add a new `describe` block at the end of the file:

```ts
// Stop must reach a run wherever it waits: on the human's screen, on an approval, on a question.
describe('Stop', () => {
  it('during a takeover wakes the run, ends it cancelled and ends the card', async () => {
    const model = new FakeModel([message([toolUse('request_takeover', { reason: 'the mailbox asks for a password' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)
    const result = runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' })
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('blocked'))

    expect(runner.cancel(botId)).toBe(true)

    expect((await result)?.outcome).toBe('cancelled')
    expect(await store.readBot(botId)).toMatchObject({ state: 'idle', statusLine: 'stopped by you' })
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'takeover').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'ended' })])
    expect(runner.cancel(botId)).toBe(false)
  })

  it('while the run waits for an approval denies it and ends the run', async () => {
    const model = new FakeModel([message([toolUse('propose_action', { kind: 'submit', summary: 'Send the form', consequences: [], warnings: [], target: 'Send' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(async () => expect((await store.readBot(botId)).state).toBe('waiting'))

    expect(runner.cancel(botId)).toBe(true)

    expect((await result)?.outcome).toBe('cancelled')
    const cards = (await store.readChat(botId, { limit: 20 })).filter((m) => m.card?.card === 'approval').map((m) => m.card)
    expect(cards).toEqual([expect.objectContaining({ status: 'denied' })])
  })

  it('while the run waits for an answer wakes it and ends the run', async () => {
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Which company?' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools)
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))

    expect(runner.cancel(botId)).toBe(true)

    expect((await result)?.outcome).toBe('cancelled')
    expect(runner.isWaitingForUser(botId)).toBe(false)
  })
})
```

- [ ] In `src/server/http/app.test.ts`, extend the stand-in: change its type to
`RunnerPort & { enqueued: RunInput[]; answers: boolean[]; busy: boolean; cancels: boolean[] }`, add
`busy: false,`, `cancels: [],`, `isBusy: () => runner.busy,` and `cancel: () => runner.cancels.shift() ?? false,`
to the literal, and add a `describe` block at the end of the file:

```ts
describe('Stop and the queue', () => {
  it('the stop route answers 204 when a run is active and 409 when nothing runs', async () => {
    runner.cancels.push(true)
    expect((await app.request(`/api/bots/${botId}/stop`, json({}))).status).toBe(204)
    const idle = await app.request(`/api/bots/${botId}/stop`, json({}))
    expect(idle.status).toBe(409)
    expect(await idle.json()).toEqual({ error: 'nothing is running' })
  })

  it('a message during a run is accepted, queued behind it, and the chat says so', async () => {
    runner.busy = true
    const res = await app.request(`/api/bots/${botId}/messages`, json({ text: 'stop, wrong company' }))
    expect(await res.json()).toMatchObject({ answered: false, runId: 'run-test' })
    expect(runner.enqueued).toEqual([{ goal: 'stop, wrong company', activeSkill: null, source: 'message' }])
    const chat = await store.readChat(botId, { limit: 5 })
    expect(chat.map((m) => m.role)).toEqual(['user', 'card'])
    expect(chat[1]?.card).toEqual({ card: 'status', text: 'Queued: I will start this after the current job. Press Stop to end the current job first.' })
  })
})
```

- [ ] **Verify the new tests fail:** run the Verify command. `cancelRequested` is not on
`RunContext`; `runner.cancel` is not a function; the stop route answers 404; no status card is posted.
- [ ] In `src/server/agent/gate.ts`, add to the `Approvals` class after `get(id)`:

```ts
  /** The run's approvals nobody has decided yet: Stop denies them so the run can end. */
  pendingFor(runId: string): string[] {
    return [...this.byId.values()].filter((a) => a.runId === runId && a.status === 'pending').map((a) => a.id)
  }
```

- [ ] In `src/server/agent/takeover.ts`, add `export const STOPPED_HOW = 'stopped by the user'`
after `UNANSWERED_REASON`, add to `TakeoverController` after `handback`:

```ts
  /** The user pressed Stop while they had the screen: the loop wakes and ends; nothing is checked. */
  cancel(): void {
    const waiting = this.waiting
    if (!waiting) return
    this.waiting = null
    waiting.resolve(STOPPED_HOW)
  }
```

and in `begin()` replace `await setBotState('working', 'working')` and the `try { return await this.deps.sandbox.screenshot() ...` block with:

```ts
    await setBotState('working', 'working')
    if (how === STOPPED_HOW) return null
    try {
      return await this.deps.sandbox.screenshot()
    } catch (e) {
      log.warn('screenshot after hand-back failed', { botId: this.deps.botId, ...errorFields(e) })
      return null
    }
```

- [ ] In `src/server/agent/tools.ts`, add to `RunContext` after `takeoverRequested(): boolean`:

```ts
  /** True once the user pressed Stop; the loop ends before its next model call or action. */
  cancelRequested(): boolean
```

and add `export const STOPPED_ANSWER = '(the user stopped this run)'` after `HUMAN_STEP_TEXT`.

- [ ] In `src/server/agent/run.ts`:
  - add after `export { HUMAN_STEP_TEXT }`:

```ts
export const STOPPED_TEXT = 'Stopped at your request. Send me the next goal when you are ready.'
const STOPPED_RESULT = 'the user stopped this run; do nothing more'
```

  - add after the `blockedEnd` function:

```ts
  const stoppedEnd = async (): Promise<RunResult> => {
    await ctx.postChat({ role: 'bot', text: STOPPED_TEXT })
    await ctx.setBotState('idle', 'stopped by you')
    return end('cancelled', 'stopped by the user')
  }
```

  - in `handleComputer`, after the block `if (!('execute' in verdict)) { ... }`, add:

```ts
    if (ctx.cancelRequested()) {
      await ctx.emit({ type: 'tool_result', step, name: parsed.name, ok: false, summary: STOPPED_RESULT, shot: null })
      return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: STOPPED_RESULT }, stuck: false }
    }
```

  - in `handlePlatform`, after `lastAction = \`the ${block.name} tool\``, add:

```ts
    if (ctx.cancelRequested()) {
      await ctx.emit({ type: 'tool_result', step, name: block.name, ok: false, summary: STOPPED_RESULT, shot: null })
      return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: STOPPED_RESULT }
    }
```

  - in the main loop, add `if (ctx.cancelRequested()) return await stoppedEnd()` as the first line
    inside `while (true)`, before the two budget checks, so Stop wins over a cap that lands on the
    same turn; and add
    `if (ctx.cancelRequested()) return await stoppedEnd()` right before `messages.push({ role: 'user', content: results })`.

- [ ] In `src/server/agent/runner.ts`:
  - import `STOPPED_ANSWER` from `'./tools'` (the file already imports types from it: make it `import { STOPPED_ANSWER, type RunContext, type ToolDef } from './tools'`);
  - add the field `private readonly stopRequests = new Set<string>()` after `manualRequests`;
  - add after `requestTakeover`:

```ts
  /** Whether a run is active or waiting its turn on this bot. */
  isBusy(botId: string): boolean {
    return this.activeRuns.has(botId) || this.deps.queue.size(botId) > 0
  }

  /**
   * The user pressed Stop. The active run ends before its next model call or action; a wait it is
   * in ends now: an open question is answered with a stop, a pending approval is denied, a takeover
   * is ended. A goal queued behind the run keeps its turn. False when no run is active.
   */
  cancel(botId: string): boolean {
    const runId = this.activeRuns.get(botId)
    if (runId === undefined) return false
    this.stopRequests.add(botId)
    this.answerUser(botId, STOPPED_ANSWER)
    for (const id of this.deps.approvals.pendingFor(runId)) this.deps.approvals.resolve(id, 'denied')
    this.takeovers.get(botId)?.cancel()
    log.info('stop requested by the user', { botId, runId })
    return true
  }
```

  - in `run()`, add `cancelRequested: () => this.stopRequests.has(botId),` to the `ctx` literal after `takeoverRequested`;
  - in the `finally` block, add `this.stopRequests.delete(botId)` after `this.manualRequests.delete(botId)`.

- [ ] In `src/server/http/app.ts`, replace the `RunnerPort` line with
`export type RunnerPort = Pick<Runner, 'answerUser' | 'accept' | 'isBusy' | 'cancel' | 'requestTakeover' | 'handbackState' | 'handback'>`,
add `export const QUEUED_TEXT = 'Queued: I will start this after the current job. Press Stop to end the current job first.'`
after `const MAX_BODY_BYTES = 262_144`, and in the messages route replace the two lines added by
Task 2 with:

```ts
    // Accepted before the note, so the record exists whatever the note does; the note is for a
    // person who typed while the bot works and would otherwise wonder why nothing happens.
    const busy = runner.isBusy(loaded.bot.id)
    const { runId } = await runner.accept(loaded.bot.id, { goal: parsed.body.text, activeSkill: null, source: 'message' })
    if (busy) {
      const note = await store.appendChat(loaded.bot.id, { role: 'card', card: { card: 'status', text: QUEUED_TEXT } })
      events.emitChat(note)
    }
    return c.json({ message, answered: false, runId })
```

  Then add after the approvals route:

```ts
  // Stop: the active run ends before its next action. It denies a pending approval and never allows one.
  app.post('/api/bots/:id/stop', async (c) => {
    const loaded = await loadBot(c)
    if ('res' in loaded) return loaded.res
    if (!runner.cancel(loaded.bot.id)) return c.json({ error: 'nothing is running' }, 409)
    log.info('stop requested through the page', { botId: loaded.bot.id })
    return c.body(null, 204)
  })
```

- [ ] In `src/web/api.ts`, change `sendMessage`'s result type to
`{ message: ChatMessage; answered: boolean; runId?: string }` and add after `requestTakeover`:
`stop: (id: string) => request<void>(\`/api/bots/${id}/stop\`, { method: 'POST', body: '{}' }),`.
- [ ] In `src/web/components/Preview.tsx`, add the props `canStop: boolean` (documented
`/** A run is working or waiting: Stop ends it before its next action. */`) and `onStop: () => void`
to the props type and the destructuring, and replace the `Take over` button block with:

```tsx
        {!takingOver ? (
          <>
            <button onClick={onStop} disabled={!canStop} title="ends the current job before its next action">
              Stop
            </button>
            <button className={takeoverActive ? 'primary' : ''} onClick={onTakeOver} disabled={!canTakeOver}>
              Take over
            </button>
          </>
        ) : (
```

- [ ] In `src/web/App.tsx`, add after the `decide` function:

```tsx
  // `stop` is taken: the SSE effect above names its unsubscribe function so.
  const stopRun = async () => {
    if (!selected) return
    try {
      await api.stop(selected)
    } catch (e) {
      setError(String(e))
    }
  }
```

  and pass to `<Preview ...>`: `canStop={!!bot && (bot.state === 'working' || bot.state === 'waiting')}` and `onStop={() => void stopRun()}`.
- [ ] **Verify the tests pass:** run the Verify command.
- [ ] **Commit** `Add Stop: the active run ends before its next action, and a message typed meanwhile is shown as queued`.

### Task 5: A response cut by `max_tokens` inside a tool call is retried, never continued [integration] [support]

**Files:** Modify `src/server/agent/run.ts`; Test `src/server/agent/run.test.ts`.
**Invariant:** 2 — a tool call whose input the model never finished is never executed; the run
follows the API's own rule instead of sending an invalid conversation and failing as "the model
stopped answering".
**Demo step:** support: a long letter in `write_artifact` is the likeliest cut on the demo path.
**Verify:** `pnpm exec vitest run src/server/agent/run.test.ts && pnpm typecheck`

- [ ] In `src/server/agent/run.test.ts`, add `CUT_OFF_TEXT` to the import from `'./run'` and a
`describe` block at the end of the file:

```ts
// Review finding of 2026-09-13, and the docs' rule: a response cut inside a tool call is retried
// with a higher limit; appended and "continued", it left a tool call without a result.
describe('max_tokens', () => {
  it('a cut inside a tool call is retried with a higher limit, and the cut call never runs', async () => {
    const model = new FakeModel([message([toolUse('remember', { note: 'half a no' })], 'max_tokens'), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'done' })

    expect(model.calls.map((c) => c.max_tokens)).toEqual([4096, 8192])
    // The cut response was not added: the retry carries the goal alone, no tool call without a result.
    expect(model.calls[1]?.messages).toHaveLength(1)
    expect(await store.readMemory(botId)).toBe('')
  })

  it('a second cut inside a tool call ends the run honestly', async () => {
    const model = new FakeModel([message([toolUse('remember', { note: 'x' })], 'max_tokens'), message([toolUse('remember', { note: 'x' })], 'max_tokens')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox(), tools: basePlatformTools })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'failed', summary: 'the model answer was cut off inside a tool call twice' })

    expect(t.chat.map((m) => m.text)).toEqual([CUT_OFF_TEXT])
    expect(await store.readMemory(botId)).toBe('')
  })

  it('a cut in plain text is continued, as before', async () => {
    const model = new FakeModel([message([textBlock('part one')], 'max_tokens'), message([textBlock('done')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    expect(await runLoop(t.ctx, goal)).toEqual({ outcome: 'done', summary: 'done' })

    expect(model.calls[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(model.calls.map((c) => c.max_tokens)).toEqual([4096, 4096])
  })
})
```

- [ ] **Verify the new tests fail:** run the Verify command. The first test sees `[4096, 4096]`
and three messages; the second sees a `done` run and a memory note; `CUT_OFF_TEXT` does not exist.
- [ ] In `src/server/agent/run.ts`:
  - after `const MAX_TOKENS = 4096` add:

```ts
// The docs' rule for a response cut inside a tool call: retry with a higher limit, once.
const MAX_TOKENS_RAISED = 2 * MAX_TOKENS
export const CUT_OFF_TEXT = 'My answer was cut off inside a tool call twice, so I stopped. Send the goal again to retry.'
const CUT_OFF_SUMMARY = 'the model answer was cut off inside a tool call twice'
```

  - after `let turns = 0` add `let maxTokens = MAX_TOKENS`;
  - replace the four lines from `const res = await ctx.model.create({ model: ctx.modelId, max_tokens: MAX_TOKENS, system, tools, messages })`
    to `messages.push({ role: 'assistant', content: toParams(res.content) })` with:

```ts
      const res = await ctx.model.create({ model: ctx.modelId, max_tokens: maxTokens, system, tools, messages })
      const usage = usageOf(res.usage)
      await ctx.emit({ type: 'cost', ...usage, usd: costUsd(ctx.modelId, usage) })
      if (res.stop_reason === 'max_tokens' && res.content.some((b) => b.type === 'tool_use')) {
        // A response cut inside a tool call is not added to the conversation, where a tool call
        // without a result is invalid, and its partial input never runs: the request is sent again
        // with a higher limit (Research: Anthropic, "Handling the max_tokens stop reason").
        if (maxTokens === MAX_TOKENS_RAISED) {
          await ctx.postChat({ role: 'bot', text: CUT_OFF_TEXT })
          return await end('failed', CUT_OFF_SUMMARY)
        }
        log.warn('model answer cut off inside a tool call; retrying with a higher max_tokens', { botId: ctx.botId, runId: ctx.runId, step })
        maxTokens = MAX_TOKENS_RAISED
        continue
      }
      messages.push({ role: 'assistant', content: toParams(res.content) })
```

  The `case 'max_tokens':` branch of the switch stays as it is: it is now reached only for a cut
  with no tool call in it.
- [ ] **Verify the tests pass:** run the Verify command.
- [ ] **Commit** `Retry a response cut by max_tokens inside a tool call instead of continuing it`.

### Task 6: Continuity, bounded: recent chat lines, questions through ask_user, read_artifact [integration] [demo-path]

**Files:** Create `src/server/agent/context.ts`, `src/server/agent/context.test.ts`; Modify
`src/server/agent/run.ts`, `src/server/agent/prompt.ts`, `src/server/agent/tools.ts`; Test
`src/server/agent/run.test.ts`, `src/server/agent/tools.test.ts`.
**Invariant:** 6 in its conversational sense — "yes" after the skill offer and "make that letter
shorter" reach the model with the lines they answer; 7 — the skill offer is answered inside the run
that made it, so the bot writes its own skill without the user learning a second goal.
**Demo step:** act one: a follow-up on the letter; the skill offer at the end of a new job.
**Verify:** `pnpm exec vitest run src/server/agent && pnpm typecheck`

- [ ] Create `src/server/agent/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../store'
import { firstUserMessage, RECENT_CHARS, RECENT_LINES, recentConversation } from './context'

let n = 0
function line(role: 'user' | 'bot', text: string): ChatMessage {
  n += 1
  return { id: `m${n}`, t: `2026-09-13T10:00:${String(n).padStart(2, '0')}.000Z`, botId: 'b', role, text }
}
const card: ChatMessage = { id: 'c1', t: '2026-09-13T10:00:00.000Z', botId: 'b', role: 'card', card: { card: 'status', text: 'my computer is ready' } }

describe('recentConversation', () => {
  it('gives the last lines before the goal, cards left out, the goal itself left out, newest last', () => {
    const chat = [line('user', 'Prepare a letter for Acme'), card, line('bot', 'I saved letter-acme.md. Do you want it shorter?'), line('user', 'make that letter shorter')]
    expect(recentConversation(chat, 'make that letter shorter', 'Hunter')).toBe('user: Prepare a letter for Acme\nHunter: I saved letter-acme.md. Do you want it shorter?')
  })

  it('is empty for a fresh chat and for a chat that holds only the goal', () => {
    expect(recentConversation([], 'go', 'Hunter')).toBe('')
    expect(recentConversation([line('user', 'go')], 'go', 'Hunter')).toBe('')
  })

  it('keeps at most the last RECENT_LINES lines and at most RECENT_CHARS characters', () => {
    const many = Array.from({ length: RECENT_LINES + 3 }, (_, i) => line(i % 2 === 0 ? 'user' : 'bot', `line ${i}`))
    expect(recentConversation(many, 'new goal', 'Hunter').split('\n')).toHaveLength(RECENT_LINES)
    const long = [line('bot', 'a'.repeat(900)), line('bot', 'b'.repeat(900)), line('bot', 'c'.repeat(900)), line('bot', 'd'.repeat(900)), line('bot', 'e'.repeat(900))]
    const text = recentConversation(long, 'new goal', 'Hunter')
    expect(text.length).toBeLessThanOrEqual(RECENT_CHARS)
    expect(text.endsWith('e'.repeat(900))).toBe(true)
  })

  it('leaves out only the newest copy of the goal, and folds line breaks', () => {
    const chat = [line('user', 'again'), line('bot', 'first\nanswer'), line('user', 'again')]
    expect(recentConversation(chat, 'again', 'Hunter')).toBe('user: again\nHunter: first answer')
  })
})

describe('firstUserMessage', () => {
  it('is the goal alone without context, and the context above the goal with it', () => {
    expect(firstUserMessage('', 'do it')).toBe('do it')
    expect(firstUserMessage('user: hi', 'do it')).toBe('Recent conversation, newest last (context only):\nuser: hi\n\nGoal: do it')
  })
})
```

- [ ] In `src/server/agent/run.test.ts`, add `readArtifact` to the import from `'./tools'`
(alongside `basePlatformTools, runPlatformTool`). In the test "no platform tool writes
approval-rules.json, whatever it is called with", add `read_artifact: { name: 'approval-rules.md' },`
to the `minimal` record after the `write_artifact` line: that test enumerates every tool name and
fails on a missing one. Then add a `describe` block at the end of the file:

```ts
// Review finding of 2026-09-13: a run started with the goal alone, so "yes" after the skill offer
// and "make that letter shorter" reached the model without the lines they answered.
describe('continuity', () => {
  function firstUserText(model: FakeModel): string {
    const content = model.calls[0]?.messages[0]?.content
    if (typeof content === 'string') return content
    const block = Array.isArray(content) ? content[0] : undefined
    return block && block.type === 'text' ? block.text : ''
  }

  it('the last chat lines before the goal reach the model, cards left out, the goal sent once', async () => {
    await store.appendChat(botId, { role: 'user', text: 'Prepare a letter for Acme' })
    await store.appendChat(botId, { role: 'card', card: { card: 'artifact', name: 'letter-acme.md', preview: 'Dear', path: 'x' } })
    await store.appendChat(botId, { role: 'bot', text: 'I saved letter-acme.md. Do you want it shorter?' })
    await store.appendChat(botId, { role: 'user', text: 'make that letter shorter' })
    const model = new FakeModel([message([textBlock('Shortened.')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })

    await runLoop(t.ctx, { goal: 'make that letter shorter', activeSkill: null, source: 'message' })

    expect(firstUserText(model)).toBe(
      'Recent conversation, newest last (context only):\nuser: Prepare a letter for Acme\nTester: I saved letter-acme.md. Do you want it shorter?\n\nGoal: make that letter shorter',
    )
  })

  it('a fresh chat sends the goal alone', async () => {
    const model = new FakeModel([message([textBlock('ok')], 'end_turn')])
    const t = makeContext({ store, botId, model, sandbox: new FakeSandbox() })
    await runLoop(t.ctx, goal)
    expect(firstUserText(model)).toBe('do the thing')
  })

  it('read_artifact returns a saved artifact and names the artifacts when the name is unknown', async () => {
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox() })
    await store.writeArtifact(botId, 'letter-acme.md', 'Dear Acme,\n\nI write to you.')

    expect(await readArtifact.run({ name: 'letter-acme.md' }, t.ctx)).toBe('Dear Acme,\n\nI write to you.')
    expect(await runPlatformTool(readArtifact, { name: 'letter-nope.md' }, t.ctx)).toEqual({ text: 'there is no artifact named letter-nope.md; the artifacts are: letter-acme.md', isError: true })
    expect(await runPlatformTool(readArtifact, { name: '../secret.md' }, t.ctx)).toMatchObject({ isError: true })
  })
})
```

- [ ] **Verify the new tests fail:** run the Verify command. `./context` does not exist; the first
message is the goal alone; `readArtifact` is not exported.
- [ ] Create `src/server/agent/context.ts`:

```ts
import type { ChatMessage } from '../store'

// The few chat lines a goal answers. The whole transcript never reaches the model: memory is for
// what must last, and this window is for "yes", "that one" and "make it shorter".

export const RECENT_LINES = 6
export const RECENT_CHARS = 4_000
const LINE_CHARS = 1_000

/**
 * The last lines before the goal, newest last, as `user: …` and `<bot name>: …`. Cards are left
 * out (they are the platform's, not the conversation's); the newest copy of the goal is left out,
 * because it is sent on its own under the context. Bounded by lines and by characters, newest first.
 */
export function recentConversation(chat: ChatMessage[], goal: string, botName: string): string {
  const texts = chat.filter((m) => m.role !== 'card' && typeof m.text === 'string')
  const goalIndex = texts.map((m) => m.role === 'user' && m.text === goal).lastIndexOf(true)
  const before = goalIndex === -1 ? texts : [...texts.slice(0, goalIndex), ...texts.slice(goalIndex + 1)]
  const lines: string[] = []
  let chars = 0
  for (const m of before.slice(-RECENT_LINES).reverse()) {
    const text = (m.text ?? '').replace(/\s+/g, ' ').trim()
    const line = `${m.role === 'user' ? 'user' : botName}: ${text.length > LINE_CHARS ? text.slice(0, LINE_CHARS - 1) + '…' : text}`
    if (chars + line.length > RECENT_CHARS) break
    chars += line.length
    lines.unshift(line)
  }
  return lines.join('\n')
}

/** The first user message of a run: the goal alone, or the recent lines above it. */
export function firstUserMessage(recent: string, goal: string): string {
  return recent === '' ? goal : `Recent conversation, newest last (context only):\n${recent}\n\nGoal: ${goal}`
}
```

- [ ] In `src/server/agent/run.ts`, add `import { firstUserMessage, recentConversation } from './context'`
after the `./actions` import, and replace
`const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: input.goal }]` with:

```ts
  const recent = recentConversation(await ctx.store.readChat(ctx.botId, { limit: 40 }), input.goal, bot.name)
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: firstUserMessage(recent, input.goal) }]
```

- [ ] In `src/server/agent/prompt.ts`:
  - replace the memory rule (`'Memory: write anything you must not forget with remember. Memory notes survive restarts; the chat does not reach your next run.',`) with:

```ts
    'Memory: write anything you must not forget with remember. Memory notes survive restarts. Of the chat, only the last few lines come with each goal; anything older reaches you through memory alone.',
    'Questions: when you need the user\'s answer to go on, ask with ask_user and wait for it. Never end your turn with a question, because a new message starts a new run.',
```

  - replace the skill offer rule with:

```ts
      'Skill offer rule: when you finish a job that no skill covered, ask with ask_user whether the user wants you to do it on a schedule; if yes, write the skill with save_skill and the routine with save_routine in this same run.',
```

- [ ] In `src/server/agent/tools.ts`:
  - replace the `remember` description with
    `'Append one note to your memory. Memory survives restarts; the chat does not, except the last few lines that come with each goal.'`;
  - hoist the artifact name rule: add before `writeArtifact`
    `const ARTIFACT_NAME = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?\.(md|txt)$/` and use it in
    `writeArtifact`'s schema (`.regex(ARTIFACT_NAME, 'lower-case letters, digits and dashes, ending in .md or .txt')`);
  - add after `writeArtifact`:

```ts
const ARTIFACT_MAX_CHARS = 20_000

export const readArtifact = defineTool({
  name: 'read_artifact',
  description: 'Read back a document you saved with write_artifact (a dossier, a letter), for example to shorten or rewrite it. Names end in .md or .txt.',
  schema: z.object({ name: z.string().regex(ARTIFACT_NAME, 'lower-case letters, digits and dashes, ending in .md or .txt') }),
  run: async ({ name }, ctx) => {
    const content = await ctx.store.readArtifact(ctx.botId, name)
    if (content === null) {
      const names = await ctx.store.listArtifacts(ctx.botId)
      throw new ToolError(names.length === 0 ? 'there are no artifacts yet' : `there is no artifact named ${name}; the artifacts are: ${names.join(', ')}`)
    }
    if (content.length <= ARTIFACT_MAX_CHARS) return content
    return `${content.slice(0, ARTIFACT_MAX_CHARS)}\n\n[truncated: the artifact has ${content.length} characters; only the first ${ARTIFACT_MAX_CHARS} are shown]`
  },
})
```

  - add `readArtifact` to `basePlatformTools` after `writeArtifact`.
- [ ] **Verify the tests pass:** run the Verify command. The test "no platform tool writes
approval-rules.json, whatever it is called with" now covers `read_artifact` through the `minimal`
entry added above.
- [ ] **Commit** `Send the last chat lines with each goal, ask questions through ask_user, and add read_artifact`.

### Task 7: Mail that arrived while the platform was down starts its routine at boot [integration] [demo-path]

**Files:** Modify `src/server/mail/watcher.ts`, `src/server/index.ts`; Create
`src/server/mail/watermark.ts`; Test `src/server/mail/watcher.test.ts`.
**Invariant:** 6 in its unprompted sense — a routine waiting for mail catches the mail that came
while nobody was running the platform; the watermark is persisted state and survives a restart.
5 untouched: the watcher still reads counts and numbers, never a message.
**Demo step:** act two: the invitation that arrives before the server is up.
**Verify:** `pnpm exec vitest run src/server/mail && pnpm typecheck`

- [ ] In `src/server/mail/watcher.test.ts`, replace the `FakeMailbox` class and the `watcherOver`
helper with:

```ts
class FakeMailbox implements MailboxPort {
  reads = 0
  /** Scripted readings; a number is an unseen count with no UIDs, an Error is thrown. The last entry repeats. */
  constructor(private readonly readings: (MailReading | number | Error)[]) {}

  async read(): Promise<MailReading> {
    const value = this.readings.length > 1 ? this.readings.shift() : this.readings[0]
    this.reads += 1
    if (value === undefined) throw new Error('no scripted reading')
    if (value instanceof Error) throw value
    return typeof value === 'number' ? { unseen: value, uidNext: null, uidValidity: null } : value
  }
}

class FakeWatermark implements WatermarkStore {
  writes: Watermark[] = []
  constructor(private stored: Watermark | null) {}
  async read(): Promise<Watermark | null> {
    return this.stored
  }
  async write(mark: Watermark): Promise<void> {
    this.stored = mark
    this.writes.push(mark)
  }
}

function watcherOver(readings: (MailReading | number | Error)[], clock?: () => number, watermark?: WatermarkStore): { watcher: MailWatcher; fired: () => number } {
  let fires = 0
  const watcher = new MailWatcher({
    mailbox: new FakeMailbox(readings),
    onMail: async () => {
      fires += 1
    },
    ...(watermark ? { watermark } : {}),
    // Without a clock a test is about the readings alone; the debounce has its own tests below.
    ...(clock ? { now: clock } : { debounceMs: 0 }),
  })
  return { watcher, fired: () => fires }
}
```

and change the import to
`import { MAIL_DEBOUNCE_MS, MailWatcher, type MailboxPort, type MailReading, type Watermark, type WatermarkStore } from './watcher'`.
Then add, after the test "never fires on a drop alone":

```ts
  // Review item of 2026-09-13 (README known limit): mail that arrived while the platform was down
  // was not noticed until the next new message.
  it('fires once at boot when the stored next UID is below the mailbox next UID, and moves the watermark', async () => {
    const mark = new FakeWatermark({ uidValidity: '1', uidNext: 10 })
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 12, uidValidity: '1' }], undefined, mark)
    await watcher.tick()
    expect(fired()).toBe(1)
    expect(mark.writes).toEqual([{ uidValidity: '1', uidNext: 12 }])
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('sets the baseline without firing when no watermark is stored or it matches, and writes it', async () => {
    const none = new FakeWatermark(null)
    const a = watcherOver([{ unseen: 3, uidNext: 12, uidValidity: '1' }], undefined, none)
    await a.watcher.tick()
    expect(a.fired()).toBe(0)
    expect(none.writes).toEqual([{ uidValidity: '1', uidNext: 12 }])
    const same = new FakeWatermark({ uidValidity: '1', uidNext: 12 })
    const b = watcherOver([{ unseen: 3, uidNext: 12, uidValidity: '1' }], undefined, same)
    await b.watcher.tick()
    expect(b.fired()).toBe(0)
  })

  it('a changed UIDVALIDITY re-baselines instead of firing', async () => {
    const mark = new FakeWatermark({ uidValidity: '1', uidNext: 10 })
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 3, uidValidity: '2' }], undefined, mark)
    await watcher.tick()
    expect(fired()).toBe(0)
    expect(mark.writes).toEqual([{ uidValidity: '2', uidNext: 3 }])
  })

  it('between readings a higher next UID fires even when the unseen count did not rise', async () => {
    // The bot read the new mail on its screen before the watcher's next reading: the count stayed, the UID moved.
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 5, uidValidity: '1' }, { unseen: 1, uidNext: 6, uidValidity: '1' }])
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('a watermark store that fails is logged and the watcher goes on with the counts', async () => {
    const broken: WatermarkStore = {
      read: async () => {
        throw new Error('disk')
      },
      write: async () => {
        throw new Error('disk')
      },
    }
    const { watcher, fired } = watcherOver([2, 3], undefined, broken)
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(1)
  })
```

- [ ] **Verify the new tests fail:** run the Verify command. `MailReading`, `Watermark` and
`WatermarkStore` do not exist; `read()` is not on `MailboxPort`.
- [ ] In `src/server/mail/watcher.ts`:
  - replace the `MailboxPort` type with:

```ts
/** One reading of the inbox: how many messages are unseen, and the mailbox's next message number when the server gives it. */
export type MailReading = { unseen: number; uidNext: number | null; uidValidity: string | null }

/** Everything the watcher needs from a mailbox. The IMAP client is behind it so the firing rule is testable. */
export type MailboxPort = {
  read(): Promise<MailReading>
}

/** The last next-UID seen, kept across restarts so a boot can tell that mail arrived meanwhile. */
export type Watermark = { uidValidity: string | null; uidNext: number }

export type WatermarkStore = {
  read(): Promise<Watermark | null>
  write(mark: Watermark): Promise<void>
}
```

  - in `ImapMailbox`, replace `async unseenCount(): Promise<number> {` with `async read(): Promise<MailReading> {`
    and replace the two lines `const status = await client.status('INBOX', { unseen: true })` and
    `return status.unseen ?? 0` with:

```ts
      const status = await client.status('INBOX', { unseen: true, uidNext: true, uidValidity: true })
      return {
        unseen: status.unseen ?? 0,
        uidNext: typeof status.uidNext === 'number' ? status.uidNext : null,
        // A BigInt in imapflow; kept as text, it is only ever compared for equality.
        uidValidity: status.uidValidity === undefined ? null : String(status.uidValidity),
      }
```

  - in `WatcherDeps`, add after `onMail(): Promise<void>`:
    `/** Persists the next-UID across restarts; without it the first reading is only a baseline. */ watermark?: WatermarkStore`;
  - in the class doc comment, replace the sentence that starts "**Known limit:** mail that arrives"
    to the end of the comment with: "With a watermark store, the first reading fires once when the
    mailbox's next message number moved past the stored one: mail arrived while the platform was
    down. Between readings a moved number counts as new mail even when the unseen count did not rise,
    because the bot may have read it on its screen first; a server that gives no numbers falls back
    to the count.";
  - replace `private lastCount: number | null = null` with `private last: MailReading | null = null`,
    the `baseline` getter body with `return this.last?.unseen ?? null`, and the whole `tick()`
    method with:

```ts
  async tick(): Promise<void> {
    let reading: MailReading
    try {
      reading = await this.deps.mailbox.read()
    } catch (e) {
      log.warn('mailbox could not be read; the next poll retries', errorFields(e))
      return
    }
    const previous = this.last
    this.last = reading
    let rose: boolean
    if (previous === null) {
      const stored = await this.readWatermark()
      await this.writeWatermark(reading)
      const arrivedWhileDown = stored !== null && reading.uidNext !== null && stored.uidValidity === reading.uidValidity && reading.uidNext > stored.uidNext
      if (!arrivedWhileDown) {
        log.info('mail watcher baseline set', { unseen: reading.unseen })
        return
      }
      log.info('mail arrived while the platform was down', { uidNext: reading.uidNext, previous: stored.uidNext })
      rose = true
    } else {
      const byUid = reading.uidNext !== null && previous.uidNext !== null && reading.uidValidity === previous.uidValidity
      rose = byUid ? reading.uidNext > previous.uidNext : reading.unseen > previous.unseen
      if (rose) await this.writeWatermark(reading)
    }
    if (!rose && !this.pending) return
    const now = this.now()
    if (this.lastFiredAt !== null && now - this.lastFiredAt < this.debounceMs) {
      if (rose) log.info('new mail inside the debounce; it fires once the debounce is over', { unseen: reading.unseen, previous: previous?.unseen ?? null })
      this.pending = true
      return
    }
    log.info(rose ? 'new mail' : 'held mail fires now that the debounce is over', { unseen: reading.unseen, previous: previous?.unseen ?? null })
    this.pending = false
    this.lastFiredAt = now
    try {
      await this.deps.onMail()
    } catch (e) {
      log.error('the mail event handler failed', errorFields(e))
    }
  }

  /** Never rejects: a watermark that cannot be read means "no watermark". */
  private async readWatermark(): Promise<Watermark | null> {
    if (!this.deps.watermark) return null
    try {
      return await this.deps.watermark.read()
    } catch (e) {
      log.warn('the mail watermark could not be read; starting from a baseline', errorFields(e))
      return null
    }
  }

  /** Never rejects; nothing to write when the server gave no numbers. */
  private async writeWatermark(reading: MailReading): Promise<void> {
    if (!this.deps.watermark || reading.uidNext === null) return
    try {
      await this.deps.watermark.write({ uidValidity: reading.uidValidity, uidNext: reading.uidNext })
    } catch (e) {
      log.warn('the mail watermark could not be written', errorFields(e))
    }
  }
```

- [ ] Create `src/server/mail/watermark.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { log } from '../log'
import { isNotFound, writeFileAtomic } from '../store/paths'
import type { Watermark, WatermarkStore } from './watcher'

const Mark = z.object({ uidValidity: z.string().nullable(), uidNext: z.number().int().nonnegative() })

/**
 * The watermark as a small JSON file next to the bot folders (`data/mail-watermark.json` by
 * default). A missing or unreadable file means "no watermark"; the watcher then starts from a
 * baseline, as it did before the file existed.
 */
export function fileWatermark(path: string): WatermarkStore {
  return {
    async read() {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
      try {
        const parsed = Mark.safeParse(JSON.parse(raw))
        if (parsed.success) return parsed.data
      } catch {
        // fall through: a corrupt file is the same as none
      }
      log.warn('the mail watermark file is not readable; starting from a baseline', { path })
      return null
    },
    async write(mark) {
      await writeFileAtomic(path, JSON.stringify(mark) + '\n')
    },
  }
}
```

- [ ] In `src/server/index.ts`, add `import { dirname, join } from 'node:path'` and
`import { fileWatermark } from './mail/watermark'`, and replace the `new MailWatcher({ ... }).start()`
call with:

```ts
  new MailWatcher({
    mailbox: new ImapMailbox(mail),
    onMail: () => scheduler.fireEvent(MAIL_EVENT),
    pollMs: config.MAILBOX_POLL_MS,
    // Next to the bot folders, not inside one: there is one mailbox for the platform.
    watermark: fileWatermark(join(dirname(config.DATA_DIR), 'mail-watermark.json')),
  }).start()
```

  and replace the comment line "The platform only reads how many" … "unseen messages the inbox holds:"
  with "The platform only reads how many unseen messages the inbox holds and its next message number:".
- [ ] **Verify the tests pass:** run the Verify command. The existing count tests pass unchanged:
a number in the script is a reading with no UIDs, and the count rule applies.
- [ ] **Commit** `Keep the mailbox next-UID across restarts so mail that arrived while down starts its routine`.

### Task 8: The Skills tab marks a draft saved only when the saved text still matches [mechanical] [support]

**Files:** Modify `src/web/components/SkillsTab.tsx`.
**Invariant:** 7 — the user corrects a skill in the page; a correction typed during the save
request must not be shown as saved and then be impossible to save.
**Demo step:** support: the Skills tab is where a user corrects the bot's own skill; the page has no
tests, so the fix is proven by `pnpm typecheck` and by hand (verification criterion 8).
**Verify:** `pnpm typecheck`

- [ ] In `src/web/components/SkillsTab.tsx`, change the React import to
`import { useEffect, useRef, useState } from 'react'` and replace the `FileEditor` function up to
and including its `save` function with:

```tsx
function FileEditor({ title, text, onSave, note }: { title: string; text: string; onSave: (text: string) => Promise<void>; note?: string }) {
  const [draft, setDraft] = useState(text)
  const [state, setState] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'error'>('clean')
  const [message, setMessage] = useState('')
  // One request at a time: Save is disabled while one is in flight.
  const [saving, setSaving] = useState(false)
  // What the textarea holds right now, for the moment the save request comes back: a draft typed
  // meanwhile was never sent, so it stays dirty and Save stays enabled (review finding of 2026-09-13).
  const latest = useRef(text)
  useEffect(() => {
    setDraft(text)
    latest.current = text
    setState('clean')
  }, [text])
  const save = async () => {
    const submitted = draft
    setSaving(true)
    setState('saving')
    try {
      await onSave(submitted)
      setMessage('')
      setState(latest.current === submitted ? 'saved' : 'dirty')
    } catch (e) {
      setState('error')
      setMessage(String(e))
    } finally {
      setSaving(false)
    }
  }
```

  and in the textarea's `onChange`, add `latest.current = e.target.value` before `setDraft(e.target.value)`.
  Replace the button's `disabled={state !== 'dirty'}` with `disabled={state !== 'dirty' || saving}`: a
  second save cannot start while one is in flight, and a draft typed meanwhile re-enables Save once
  the request is back.
- [ ] Run `pnpm typecheck`.
- [ ] **Commit** `Mark a Skills-tab draft saved only when the saved text still matches`.

### Task 9: The limits, the outcomes and Stop are documented; the TODO item is ticked [mechanical] [support]

**Files:** Modify `README.md`, the private backlog, `docs/specs/2026-09-11-platform-design.md`.
**Invariant:** none touched (documentation). Delivery constraint 1: a reviewer's clone describes
what the platform does after a restart and what Stop does.
**Demo step:** none. Support: the README is a graded deliverable.
**Verify:** `pnpm preflight` (full output to a file in the scratchpad)

- [ ] In `README.md`, section "What you see", replace "action above it and the **Take over** button."
with "action above it, the **Stop** button and the **Take over** button. Stop ends the current job
before its next action; a goal typed while the bot works waits its turn, and the chat says so."
- [ ] In `README.md`, section "Known limits", replace the bullet that starts "- The mail trigger
compares unseen counts" (two lines) with:

```markdown
- The mail trigger keeps the mailbox's next message number in `data/mail-watermark.json`, so mail
  that arrived while the platform was down starts the routine once at the next boot. A mail server
  that gives no message numbers falls back to comparing unseen counts, where such mail is noticed
  only with the next new message.
```

  and replace the bullet that starts "- After a restart the platform does not reconnect" (four
  lines) with:

```markdown
- After a restart the platform does not reconnect to a computer that was still up: the computer
  stays up for at most 20 minutes and then pauses itself, and the page shows no live screen until
  the next goal. Every run the old process left open is closed at boot with a line that says how far
  it got: never started, interrupted, or interrupted after an approved action, whose outcome the
  platform cannot know and says so. The takeover and approval cards it left open are closed too,
  because the hand-over and the approval registry lived in that process.
- Stop ends the active run only, before its next action; a pending approval counts as denied. A
  goal queued behind the run keeps its turn. The Stop button is enabled while the bot is working or
  waiting; during a takeover, hand back first. It takes effect once the computer call in flight
  returns, a few seconds at most.
- The run log records one of these outcomes: `done` (the model ended the run), `failed`, `stuck`,
  `budget`, `denied`, `cancelled` (Stop) and `unknown` (a restart after an approved action).
```

- [ ] In `docs/specs/2026-09-11-platform-design.md`, at the end of the file (the "Amendments"
section), add:

```markdown

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
```

- [ ] In the private backlog, section 3 "Delivery", add before the item that starts "- [ ] README with setup
instructions":

```text
- [x] Reliability pass on interrupted work, truthful outcomes and continuity — done 2026-09-13 from
      two code reviews (Codex, code inspection; verdicts in the plan): status text clipped so a
      takeover cannot fail on it; the run record created when a goal is accepted and boot recovery
      saying never started / interrupted / outcome unknown; a routine's occurrence consumed when its
      run starts and no run without its skill; a Stop button; the max_tokens rule from the docs; the
      last chat lines with each goal, questions through ask_user, read_artifact; the mailbox next-UID
      kept across restarts; the Skills-tab save race. Plan: `docs/plans/2026-09-13-reliability-pass-plan.md`,
      commits <sha1>–<sha9>, preflight green at <n> tests. Live: criteria 1 and 2 in the plan are
      checked in the next server session (act two, round 2) and recorded there.
```

  Fill `<sha1>`–`<sha9>` from `git log --oneline -10` and `<n>` from the preflight output.
- [ ] Run `pnpm preflight` with its full output written to a file in the scratchpad.
- [ ] **Commit** `Document Stop, the recovery outcomes and the mail watermark, and tick the reliability pass`.

## Verification Criteria

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | Stop ends a live run before its next action: the chat shows "Stopped at your request…", the bot goes idle, the run log ends `cancelled`, and no computer action follows the press. **Human-observable.** | In the next server session (act two, round 2), before the round: send the demo bot "Open https://example.com, then take three screenshots ten seconds apart" and press Stop after the first screenshot appears in the preview. Read the run's `events.jsonl`: the last `step` precedes the `end` with `outcome: cancelled`. About $0.05. |
| 2 | Mail that arrived while the server was down starts the routine once at boot. **Human-observable.** | Same session: with the server stopped, the owner sends any mail to the bot's inbox; start the server; the log says `mail arrived while the platform was down` and `check-mail` runs once (it reads the mail on the bot's screen). About $0.20. The act-two round can use this path for the seeded invitation instead of a rise while up; either is recorded. |
| 3 | A run closed at boot says how far it got: never started, interrupted, or unknown after an approved action, with the approved control named. | The three recovery tests of Task 2. The interrupted case was also seen live on 2026-09-13 (persistence check). |
| 4 | A takeover with the longest allowed reason hands over; a routine whose summary fills the status line is recorded with its next time. | The runner and scheduler tests of Task 1. |
| 5 | An interrupted scheduled run is not fired again at the next boot; a routine without its skill does not run and says so; the Skills tab refuses a routine naming a missing skill. | The scheduler and app tests of Task 3; the tab by hand: save a routine with `skill: ghost`, read the message. |
| 6 | A response cut inside a tool call is retried once with a higher limit and never executed; a second cut ends the run honestly. | The three tests of Task 5. Not forced live: the cut cannot be provoked on purpose. |
| 7 | A follow-up answers with the previous lines in hand. **Human-observable.** | Same session, after the Stop check: send "Say what you did in one sentence." The answer names the example.com run. About $0.05. |
| 8 | The Skills tab keeps a draft typed during a save as unsaved, and Save stays usable. | By hand in the tab: edit memory, press Save, type at once; the note must not say "saved" and Save must be enabled. |
| 9 | Nothing else changed: typecheck, every test and the site-name grep are clean. | `pnpm preflight` (277 tests before this plan, the new ones on top). |
| 10 | A clean clone reads the new behaviour in the README. | Task 9's text in "What you see" and "Known limits". |

## Test Plan

- Task 1: `pnpm exec vitest run src/server/store src/server/agent/runner.test.ts src/server/scheduler/scheduler.test.ts`
- Task 2: `pnpm exec vitest run src/server/agent/recovery.test.ts src/server/agent/runner.test.ts src/server/http/app.test.ts src/server/store`
- Task 3: `pnpm exec vitest run src/server/scheduler src/server/store src/server/http/app.test.ts src/server/agent/tools.test.ts`
- Task 4: `pnpm exec vitest run src/server/agent src/server/http/app.test.ts`
- Task 5 and 6: `pnpm exec vitest run src/server/agent`
- Task 7: `pnpm exec vitest run src/server/mail`
- Task 8: `pnpm typecheck` (the page has no tests)
- Every test runs offline against a temp folder, a fake model and a fake sandbox; none needs a key.
  The two live criteria (1 and 2) need the E2B and Anthropic keys and the owner at the keyboard, in
  the act-two round-2 session.
- End: `pnpm preflight` with the full output written to a file in the scratchpad.

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan.
2. `git log --oneline -12`: the commits are titled as in the tasks' **Commit** lines, in task order.
3. Pick up from the first task whose commit is missing; run its Verify command first to see which
   of its steps already landed.

## Backbrief

**End-state.** Nine commits on `main` after which every accepted goal has a run record from the
moment it is accepted, a restart closes each open run with a true line (never started, interrupted,
or unknown after an approved action) and never re-fires a scheduled run that had started, a person
can press Stop and watch the bot go idle before its next action, mail that came while the platform
was down starts its routine at boot, and a follow-up like "make that letter shorter" reaches the
model with the lines it answers and a tool to read the letter back.

**Critical constraints.** The stop denies a pending approval and never allows one, and the loop
checks the stop before every model call and before every action, not after. A response cut inside a
tool call is never appended to the conversation and its partial input never runs. The `queued`
event is written before the message route answers, and `nextRunAt` is written before a routine's
run is enqueued. The watcher still reads counts and numbers only, never a message (invariant 5).

**Latitude.** `/implement` decides the exact placement of new helpers inside the listed files, log
field names, the wording of code comments, and whether a task's tests land in the same commit as
its code (one commit per task is the rule; a test-only preparatory commit is allowed). It does not
add tools, routes, outcomes or events beyond the ones named here.
