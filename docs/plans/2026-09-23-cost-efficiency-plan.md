> **STATUS: PAUSED 2026-09-23 at Task 7.** Tasks 1–6 are done on branch `cost-levers`
> (6e315db..1dffd32). The benchmark was stopped by the author after three baseline Goal R runs
> showed 3.5x variance per job; see `data/cost-bench/NOTES.md` and the private backlog section 4. Do not merge
> the branch until the author decides how the levers are measured.

# Cost efficiency: context hygiene Implementation Plan

**Goal:** Build four cost levers behind switches, prove each on a live A/B benchmark, keep only the ones that cut cost per finished job by at least 15% without losing a job, and leave plain code behind.
**Approach:** The levers are switched through a `Levers` value on the run context, set once at boot from `COST_LEVERS`, so the benchmark changes variants by restarting the server, never by editing `src/`. Tests pass levers explicitly, so every existing test keeps running with all levers off (today's behaviour). After the benchmark, accepted levers become unconditional and the switch code is removed.
**Design spec:** [docs/specs/2026-09-23-cost-efficiency-design.md](../specs/2026-09-23-cost-efficiency-design.md)
**TODO items:** section "4. Product: hosted Grok Bot alternative for EU teams", item "Cost efficiency (invariant 8)"
**Branch:** `cost-levers`, in the worktree `.claude/worktrees/cost-levers`; merged into `main` after Task 8 (the author pushes)
**Scope:** `src/server/agent/` (`levers.ts` new, `run.ts`, `run-context.ts`, `runner.ts`, `actions.ts`, `images.ts`, `prompt.ts`, `tools.ts`, `fakes.ts`), `src/server/sandbox/port.ts`, `src/server/store/types.ts`, `src/server/config.ts`, `src/server/index.ts`, `.env.example`, `data/cost-bench/` (git-ignored), `docs/evidence/`, `docs/decisions.md`, `docs/build-history.md`, `docs/operating-guide.md`
**Build estimate:** The author's hours: judging is done by Claude against the written checks and reviewed by the author afterwards from the evidence page (about 1 hour); the author sends nothing (changed 2026-09-23: Claude sends each Goal M invitation through Claude in Chrome from the author's Gmail, on his word). Live-run cycles: 30 benchmark runs in five variants (about $15–25 of model spend, about 5 hours of sandbox time), plus one regression run after Task 8.

## Research (source links)

All API facts come from the design spec's Research section; nothing new is needed.

- Effort: `output_config: { effort: 'medium' }`, GA; `@anthropic-ai/sdk` 0.125.0 types `output_config?: OutputConfig` with `effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null` (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`, read 2026-09-23); [effort docs](https://platform.claude.com/docs/en/build-with-claude/effort).
- Grouped actions and the "Not executed" text: [computer use tool, batch actions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#batch-actions).
- Image tokens `⌈w/28⌉ × ⌈h/28⌉` and coordinate scaling: [vision](https://platform.claude.com/docs/en/build-with-claude/vision#evaluate-image-size), [coordinate scaling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#handle-coordinate-scaling-for-higher-resolutions).
- `pngjs` 7.0.0 (pinned): `PNG.sync.read` / `PNG.sync.write`, already used in `images.ts`.

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Create | `src/server/agent/levers.ts` | `Levers` type, `NO_LEVERS`, `parseLevers()` |
| Create | `src/server/agent/levers.test.ts` | Parsing tests |
| Modify | `src/server/config.ts` | `COST_LEVERS` optional text |
| Modify | `src/server/index.ts` | Parse levers at boot, pass to the runner, log them |
| Modify | `src/server/agent/run-context.ts` | `levers: Levers` on `RunContext` |
| Modify | `src/server/agent/runner.ts` | `levers` in deps; into the context and the `queued` event |
| Modify | `src/server/store/types.ts` | Optional `levers` on the `queued` event |
| Modify | `src/server/agent/fakes.ts` | `makeContext` takes `levers`, default `NO_LEVERS` |
| Modify | `src/server/agent/run.ts` | Levers 1–4 |
| Modify | `src/server/agent/prompt.ts` | Rule variants per lever |
| Modify | `src/server/agent/actions.ts` | Bounds per screen, `toScreen()` |
| Modify | `src/server/agent/images.ts` | `scaleTo()` area-average downscale |
| Modify | `src/server/agent/tools.ts` | `attach_file` scales its coordinate under lever 4 |
| Modify | `src/server/sandbox/port.ts` | `MODEL_SCREEN` |
| Modify | tests: `run.test.ts`, `runner.test.ts`, `actions.test.ts`, `images.test.ts`, `prompt.test.ts`, `tools.test.ts` | New tests per lever |
| Modify | `.env.example` | `COST_LEVERS=` with a comment |
| Create | `data/cost-bench/goals.md`, `snapshot.mjs`, `reset.mjs`, `run-goal.mjs`, `analyse.mjs` | Benchmark (git-ignored) |
| Create | `docs/evidence/<date>-cost-levers/README.md` | Results |
| Modify | `docs/decisions.md`, `docs/build-history.md`, `docs/operating-guide.md` | Outcome, and removal of `COST_LEVERS` |

## Before Task 1

```bash
cd <repository root>
git status -sb
git worktree add .claude/worktrees/cost-levers -b cost-levers
cd .claude/worktrees/cost-levers
pnpm install
cp ../../../.env.local .env.local
pnpm typecheck && pnpm test
```

`cp` copies the key file without printing it. The baseline test count is recorded in the first commit message of Task 1.

## Tasks

### Task 1: Lever switches [mechanical] [support]

**Files:** Create `src/server/agent/levers.ts`, `src/server/agent/levers.test.ts`; modify `config.ts`, `index.ts`, `run-context.ts`, `runner.ts`, `store/types.ts`, `fakes.ts`, `runner.test.ts`, `.env.example`
**Invariant:** 8 — the benchmark needs every run to record which levers it ran with, or variants cannot be compared. Proven by the runner test below.
**Demo step:** row 1 ("the `queued` event records which")
**Verify:** `pnpm typecheck && pnpm test`

- [ ] Write `levers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NO_LEVERS, parseLevers } from './levers'

describe('parseLevers', () => {
  it('turns nothing on for an empty or missing value', () => {
    expect(parseLevers(undefined)).toEqual(NO_LEVERS)
    expect(parseLevers('')).toEqual(NO_LEVERS)
  })
  it('turns on the named levers, with spaces allowed', () => {
    expect(parseLevers('prune-text, effort-medium')).toEqual({ ...NO_LEVERS, pruneText: true, effortMedium: true })
    expect(parseLevers('grouped-actions,model-scaling')).toEqual({ ...NO_LEVERS, groupedActions: true, modelScaling: true })
  })
  it('refuses an unknown name, so a typo cannot run the wrong variant', () => {
    expect(() => parseLevers('prune-texts')).toThrow(/unknown cost lever "prune-texts"/)
  })
})
```

- [ ] Verify it fails (`pnpm test src/server/agent/levers.test.ts`).
- [ ] Create `levers.ts`:

```ts
// Switches for the cost levers while the benchmark measures them (docs/specs/2026-09-23-cost-efficiency-design.md).
// Set once at boot from COST_LEVERS, which is operator setup and never a user setting.

export type Levers = { pruneText: boolean; effortMedium: boolean; groupedActions: boolean; modelScaling: boolean }

export const NO_LEVERS: Levers = { pruneText: false, effortMedium: false, groupedActions: false, modelScaling: false }

const NAMES = {
  'prune-text': 'pruneText',
  'effort-medium': 'effortMedium',
  'grouped-actions': 'groupedActions',
  'model-scaling': 'modelScaling',
} as const satisfies Record<string, keyof Levers>

export function parseLevers(text: string | undefined): Levers {
  const levers: Levers = { ...NO_LEVERS }
  for (const raw of (text ?? '').split(',')) {
    const name = raw.trim()
    if (name === '') continue
    if (!Object.hasOwn(NAMES, name)) throw new Error(`unknown cost lever "${name}"; known: ${Object.keys(NAMES).join(', ')}`)
    levers[NAMES[name as keyof typeof NAMES]] = true
  }
  return levers
}
```

- [ ] `config.ts`: add `COST_LEVERS: OPTIONAL_TEXT,` to `EnvSchema` after `BLOCKED_HOLD_MINUTES`.
- [ ] `index.ts`: `const levers = parseLevers(config.COST_LEVERS ?? undefined)` before the runner is built (a throw stops the boot with the message); pass `levers` in the runner's deps; add `costLevers: levers` to the `server listening` log line.
- [ ] `run-context.ts`: add `levers: Levers` to `RunContext` (import type from `./levers`).
- [ ] `runner.ts`: add `levers: Levers` to `RunnerDeps`; set `levers: this.deps.levers` in the `RunContext` literal; in `accept()`, add `levers: this.deps.levers` to the `queued` object.
- [ ] `store/types.ts`: the `queued` member gains `levers: z.object({ pruneText: z.boolean(), effortMedium: z.boolean(), groupedActions: z.boolean(), modelScaling: z.boolean() }).optional()`.
- [ ] `fakes.ts`: `makeContext` options gain `levers?: Levers`; the context sets `levers: opts.levers ?? NO_LEVERS`. Every test that builds `RunnerDeps` gets `levers: NO_LEVERS` (compiler-driven).
- [ ] Add to `runner.test.ts` next to the existing `queued` assertions:

```ts
it('records the cost levers of the process on the queued event', async () => {
  const levers = { ...NO_LEVERS, pruneText: true }
  // build the runner as the neighbouring tests do, with `levers` in its deps
  const { runId } = await runner.accept(botId, { goal: 'g', activeSkill: null, source: 'message' })
  expect((await store.readRunEvents(botId, runId))[0]).toEqual(expect.objectContaining({ type: 'queued', levers }))
})
```

  The runner is built with the same helper the other `queued` tests use in `runner.test.ts` (around line 185), with `levers` added to its deps.
- [ ] `.env.example`: after the operator limits, add
  `# Cost levers under measurement (benchmark only; removed after it): prune-text, effort-medium, grouped-actions, model-scaling`
  and `COST_LEVERS=`.
- [ ] `prompt.ts`: correct the screenshot sentence of `NOTES_RULE` for every run, so the baseline
  and every variant use the same true sentence (spec amendment): replace
  `Notes: of your screenshots only the last three stay in your context; older ones are replaced by a one-line note.`
  with
  `Notes: of your screenshots only the last few stay in your context; older ones are replaced by a one-line note.`
  Update any `prompt.test.ts` assertion that quotes the old sentence.
- [ ] Verify all tests pass.
- [ ] Commit: `Switch the cost levers from one operator setting and record them on each run`

### Task 2: Lever 1 — long page text leaves the history [integration] [demo-path]

**Files:** Modify `run.ts`, `prompt.ts`, `run.test.ts`, `prompt.test.ts`
**Invariant:** 4 — an approval or unknown-outcome warning riding on a result is never pruned (only `fetch_url` and `read_artifact` results that are not errors are listed). 6 — the run log keeps the full text; only the in-memory model history changes. Proven by the tests below.
**Demo step:** row 2
**Verify:** `pnpm typecheck && pnpm test src/server/agent/run.test.ts src/server/agent/prompt.test.ts`

- [ ] Write tests in `run.test.ts`, new `describe('removing old page text from the conversation')`. Use a fake `fetch_url` tool (a `ToolDef` named `fetch_url` whose `run` returns `'P'.repeat(5000) + ' page N'` for input `{ url }`), `makeContext({ ..., tools: [fakeFetch], levers: { ...NO_LEVERS, pruneText: true } })`, and a model script of six `toolUse('fetch_url', { url: 'https://example.com/N' })` turns then `end_turn`:
  1. `holds up to four long page results, then keeps the newest one whole and cuts the older ones to their first lines in one pass`: request 5 (0-based, after four results) holds four full texts; request 6 (after the fifth) holds one full text, the fifth, and four pruned ones, each beginning with the first 300 characters of its text and ending with `[the rest of this page (fetch_url https://example.com/N, step 0, 5007 characters) was removed to save context; use your notes, or fetch it again if you need it]`.
  2. `leaves short results and error results alone`: a `fetch_url` that returns 100 characters, and one that throws a `ToolError`, are never changed across a pass.
  3. `removes old screenshots in the same pass when page text starts it`: two screenshots, then five long page results; after the pass, only the newest 3 screenshots remain (both are kept here: there are only two) and the earlier-messages prefix check (as in the existing test "sends the earlier messages unchanged…") holds on both sides of the one pass.
  4. `changes nothing about page text while the lever is off`: the same script with `NO_LEVERS`; all six texts arrive whole in the last request.
- [ ] Verify they fail.
- [ ] Implement in `run.ts`:

```ts
// Long page text leaves the conversation in the same batched pass as old screenshots (lever 1).
const TEXT_PRUNE_MIN_CHARS = 2000
const TEXTS_PRUNE_LIMIT = 4
const TEXTS_KEPT = 1
const TEXT_HEAD_CHARS = 300
const PRUNABLE_TEXT_TOOLS = new Set(['fetch_url', 'read_artifact'])

type TextRef = { block: Anthropic.Messages.ToolResultBlockParam; step: number; tool: string; source: string; text: string; tail: string }

function sourceOf(input: unknown, key: 'url' | 'name'): string {
  if (typeof input === 'object' && input !== null && key in input) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  return 'unknown'
}

function prunedText(ref: TextRef): string {
  const what = ref.tool === 'fetch_url' ? `this page (fetch_url ${ref.source}, step ${ref.step}, ${ref.text.length} characters)` : `the artifact ${ref.source} (read_artifact at step ${ref.step}, ${ref.text.length} characters)`
  const again = ref.tool === 'fetch_url' ? 'fetch it again' : 'read it again'
  return `${ref.text.slice(0, TEXT_HEAD_CHARS)}\n\n[the rest of ${what} was removed to save context; use your notes, or ${again} if you need it]${ref.tail}`
}
```

  Inside `runLoop`: add `const texts: TextRef[] = []` next to `shots`. `handlePlatform` ends like this (the lines before `const result` are unchanged); the notice is added first, then the text is listed, so `tail` holds exactly the notice:

```ts
    const outcome = await runPlatformTool(tool, block.input, ctx)
    await ctx.emit({ type: 'tool_result', step, name: block.name, ok: !outcome.isError, summary: firstLine(outcome.text), shot: null })
    const result: Anthropic.Messages.ToolResultBlockParam = { type: 'tool_result', tool_use_id: block.id, content: outcome.text }
    if (outcome.isError) result.is_error = true
    const moved = progress.noteTool(block.name, block.input, !outcome.isError)
    const tail = moved !== null && 'notice' in moved ? `\n\n${moved.notice}` : ''
    if (tail !== '') result.content = `${outcome.text}${tail}`
    if (ctx.levers.pruneText && !outcome.isError && PRUNABLE_TEXT_TOOLS.has(block.name) && outcome.text.length > TEXT_PRUNE_MIN_CHARS) {
      texts.push({ block: result, step, tool: block.name, source: sourceOf(block.input, block.name === 'fetch_url' ? 'url' : 'name'), text: outcome.text, tail })
    }
    return { result, stuck: moved !== null && 'stuck' in moved ? NO_PROGRESS_STUCK_TEXT : null }
```

  Rename `pruneImages` to `pruneContext`:

```ts
const pruneContext = (): void => {
  const imagesOver = shots.length > IMAGE_PRUNE_LIMIT
  const textsOver = texts.length > TEXTS_PRUNE_LIMIT
  if (!imagesOver && !textsOver) return
  while (shots.length > IMAGES_KEPT) {
    // (the existing body of the old pruneImages loop, unchanged)
  }
  while (texts.length > TEXTS_KEPT) {
    const old = texts.shift()
    if (old) old.block.content = prunedText(old)
  }
}
```

  and call `pruneContext()` where `pruneImages()` was called.
- [ ] `prompt.ts`: add (the screenshot sentence already reads "the last few" since Task 1)

```ts
export const NOTES_RULE_WITH_TEXT =
  'Notes: of your screenshots only the last few stay in your context; older ones are replaced by a one-line note. Long page text from fetch_url and read_artifact is removed the same way, except its first lines. When a screenshot or a page shows something you will need later — a mail\'s sender, subject, received time and what it says, a date or a time, a page\'s answer — write those facts in your reply before you move on, and rely on your own notes instead of opening the same thing again. Never open a mail or a page a second time when your notes already say what it holds.'
```

  `PromptInput` gains `levers: Levers`; the rules list uses `input.levers.pruneText ? NOTES_RULE_WITH_TEXT : NOTES_RULE`. `run.ts` passes `levers: ctx.levers` to `buildSystemPrompt`. Every other caller of `buildSystemPrompt` (tests, `prompt.test.ts`) passes `levers: NO_LEVERS`.
- [ ] `prompt.test.ts`: one test that the lever swaps exactly the notes rule and nothing else (the two prompts differ only in that rule's text).
- [ ] Verify tests pass; `pnpm preflight` finds nothing.
- [ ] Commit: `Remove long page text from the model's history in the screenshot pass, behind a lever`

### Task 3: Lever 2 — effort medium [mechanical] [demo-path]

**Files:** Modify `run.ts`, `run.test.ts`
**Invariant:** 8 — none of the others touched. Proven by the request test.
**Demo step:** row 1 (a measured variant)
**Verify:** `pnpm typecheck && pnpm test src/server/agent/run.test.ts`

- [ ] Test: `sends effort medium on every call of a run when the lever is on, and no effort setting when it is off` — a three-call script; `model.calls.map((c) => c.output_config)` equals `[{ effort: 'medium' }, { effort: 'medium' }, { effort: 'medium' }]`, and with `NO_LEVERS` every entry is `undefined`.
- [ ] Verify it fails.
- [ ] In the `ctx.model.create(...)` call add `...(ctx.levers.effortMedium ? { output_config: { effort: 'medium' as const } } : {})` to the request object.
- [ ] Verify it passes.
- [ ] Commit: `Send effort medium on every model call of a run, behind a lever`

### Task 4: Lever 3 — grouped actions [integration] [demo-path]

**Files:** Modify `run.ts`, `prompt.ts`, `run.test.ts`, `prompt.test.ts`
**Invariant:** 4 — no computer action that the model planned before a human decision (an approval card, a takeover) or after a failed action runs. Proven by tests 1–3.
**Demo step:** rows 3 and 4
**Verify:** `pnpm typecheck && pnpm test src/server/agent/run.test.ts src/server/agent/prompt.test.ts`

- [ ] Tests in `run.test.ts`, `describe('grouped computer actions')`, levers `{ ...NO_LEVERS, groupedActions: true }`:
  1. `does not run the rest of a group after an action fails`: one response `[computerUse('left_click', { coordinate: [10, 10] }), computerUse('type', { text: 'x' }), computerUse('screenshot')]` with `sandbox.clickError` set to a `SandboxActionError`; the sandbox call log holds `leftClick` and no `type` or `screenshot`; the next request's results for blocks 2 and 3 are `is_error` with `Not executed: an earlier computer action in this turn failed.`; two `tool_result` events with that summary and `ok: false`; `step` events: one.
  2. `does not run the rest of a group after an approval card, even when it was allowed`: the click hits a submit control (companion answers an element that `matchRule` gates, as in the existing gate tests), the user allows; `leftClick` ran once, `type` and `screenshot` did not; their results say `Not executed: a human decision came in between; take a screenshot and plan again.`
  3. `does not run the rest of a group after a denied card`: same with deny; nothing ran; the rest says the human-decision text.
  4. `still runs a platform tool that follows in the same reply`: `[failing click, toolUse('remember', {...})]` — the remember tool ran.
  5. `runs every action of a reply while the lever is off`: test 1 with `NO_LEVERS` — `type` and `screenshot` ran, as today.
  6. One assertion per remaining return point of the table, each added to the existing `run.test.ts` test that already reaches that point (secret-field takeover, typed space on a control, file-input control, repeated activation, allow rule, consumed `propose_action` approval, control changed after Allow): the existing response gets one more `computerUse('screenshot')` after the action under test, the test runs with `groupedActions: true`, and asserts which text the extra action got — the "decision" text for lines 213 and 291, the "failed" text for 218, 232 and 239, and that it ran (no "Not executed") for 221, 244 and 247.
- [ ] Verify they fail.
- [ ] Implement in `run.ts`:

```ts
const NOT_EXECUTED_AFTER_FAILURE = 'Not executed: an earlier computer action in this turn failed.'
const NOT_EXECUTED_AFTER_DECISION = 'Not executed: a human decision came in between; take a screenshot and plan again.'
```

  - `GateVerdict` becomes
    `type GateVerdict = { execute: true; carded: boolean; consume: { approvalId: string; rule: RuleName; announced: boolean } | null } | { refused: string; carded: boolean }`.
    Each of the ten returns of `gate()` gets the value of the spec amendment's table (line numbers of 2026-09-23):

    | Line | New return |
    | --- | --- |
    | 213 | `return { refused: \`${HUMAN_STEP_TEXT}: the human handed the screen back; take a screenshot to see the result\`, carded: true }` |
    | 218 | `return { refused: typeOnControlText(focused.target === 'element' ? focused.name : ''), carded: false }` |
    | 221 | `if (kind === null) return { execute: true, carded: false, consume: null }` |
    | 232 | `return { refused: 'this is a file upload control; do not activate it, call attach_file with its coordinate instead', carded: false }` |
    | 239 | `return { refused: repeated, carded: false }` |
    | 244 | `return { execute: true, carded: false, consume: null }` |
    | 247 | `return { execute: true, carded: false, consume: { approvalId: result.approval.id, rule: result.rule, announced: true } }` |
    | 282 | `if (decision === 'denied') return { refused: DENIED_TEXT, carded: true }` |
    | 291 | `return { refused: changedTargetText(name, again), carded: true }` |
    | 293 | `return { execute: true, carded: true, consume: { approvalId: approval.id, rule: result.rule, announced: false } }` |

  - `handleComputer`'s return type becomes `Promise<{ result: Anthropic.Messages.ToolResultBlockParam; stuck: string | null; ends: string | null }>`, and its seven returns change as follows (everything else in the function is unchanged):

    | Line | Case | Added field |
    | --- | --- | --- |
    | 301 | unparseable action | `ends: NOT_EXECUTED_AFTER_FAILURE` |
    | 313 | refused by the gate | `ends: verdict.carded ? NOT_EXECUTED_AFTER_DECISION : NOT_EXECUTED_AFTER_FAILURE` |
    | 317 | Stop requested | `ends: null` (the loop ends on the next check) |
    | 338 | failed on the computer (`SandboxActionError`) | `ends: NOT_EXECUTED_AFTER_FAILURE` |
    | 389 | the computer did not answer | `ends: NOT_EXECUTED_AFTER_FAILURE` |
    | 428 | ran, with a screenshot | `ends: verdict.carded ? NOT_EXECUTED_AFTER_DECISION : null` |
    | 432 | ran, with text | `ends: verdict.carded ? NOT_EXECUTED_AFTER_DECISION : null` |

    For example line 313 becomes
    `return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: verdict.refused }, stuck: null, ends: verdict.carded ? NOT_EXECUTED_AFTER_DECISION : NOT_EXECUTED_AFTER_FAILURE }`.
  - The loop over `res.content`:

```ts
let groupEnded: string | null = null
for (const block of res.content) {
  if (block.type !== 'tool_use') continue
  if (block.toolset_name === 'computer') {
    if (groupEnded !== null) {
      await ctx.emit({ type: 'tool_result', step, name: block.name, ok: false, summary: groupEnded, shot: null })
      results.push({ type: 'tool_result', tool_use_id: block.id, toolset_name: 'computer', is_error: true, content: groupEnded })
      continue
    }
    const handled = await handleComputer(block)
    results.push(handled.result)
    isStuck = isStuck ?? handled.stuck
    if (ctx.levers.groupedActions && handled.ends !== null) groupEnded = handled.ends
  } else {
    const handled = await handlePlatform(block)
    results.push(handled.result)
    isStuck = isStuck ?? handled.stuck
  }
}
```

- [ ] `prompt.ts`: `export const GROUPING_RULE = 'You may send several computer actions in one reply when you know what the screen will show; end each group with a screenshot so you can check the result before you continue.'`; added after the cheap-path rule when `input.levers.groupedActions`. `prompt.test.ts`: the rule appears only with the lever.
- [ ] Verify tests pass, including the existing gate tests.
- [ ] Commit: `End a group of computer actions at a failure or a human decision, behind a lever`

### Task 5: Lever 4 — screenshots at 1024x640 [integration] [demo-path]

**Files:** Modify `sandbox/port.ts`, `images.ts`, `actions.ts`, `run.ts`, `tools.ts`, `prompt.ts`; tests `images.test.ts`, `actions.test.ts`, `run.test.ts`, `tools.test.ts`, `prompt.test.ts`
**Invariant:** 4 — the gate and the companion see real screen positions: the scaled action replaces `parsed` right after parsing, before the gate. 1 — the live stream and the stored screenshots stay 1280x800. Proven by tests 3 and 4.
**Demo step:** row 1 (a measured variant)
**Verify:** `pnpm typecheck && pnpm test src/server/agent`

- [ ] Tests:
  1. `images.test.ts`: `scaleTo` of a 1280x800 image gives a 1024x640 PNG; a 1280x800 image with a 5-pixel black border on grey keeps a dark edge (area average, not dropped rows).
  2. `actions.test.ts`: `parseAction('left_click', { coordinate: [1000, 600] }, 'model')` passes; `[1100, 600]` fails; `toScreen` maps `[1024, 640]` to `[1280, 800]`, `[10, 10]` to `[13, 13]` (12.5 rounds to 13), maps `start_coordinate`, and maps a zoom region's two corners.
  3. `run.test.ts`, levers `{ ...NO_LEVERS, modelScaling: true }`: `left_click` at `[800, 400]` — the companion's `elementAt` gets `[1000, 500]` and the sandbox's `leftClick` gets `[1000, 500]`; the `step` event's input holds `[1000, 500]`.
  4. `run.test.ts`: a `screenshot` action — the image in the next request decodes to 1024x640; the stored shot (`store.writeShot` argument) is the 1280x800 original.
  5. `tools.test.ts`: `attach_file` with the lever on hands `[1000, 500]` to the companion for input `[800, 400]`.
  6. `prompt.test.ts`: the prompt says `1024 by 640` with the lever, `1280 by 800` without.
  7. `run.test.ts`: a `zoom` with a wide region `[0, 0, 512, 128]` (model screen) under the lever returns an image whose width:height is 4:1 (the crop's own ratio, fitted into 1024x640), not 1024x640.
- [ ] Verify they fail.
- [ ] `sandbox/port.ts`: `export const MODEL_SCREEN: Point = [1024, 640]`.
- [ ] `images.ts`:

```ts
/** Scales the image down to `size` by averaging the source pixels each target pixel covers, so thin lines and small text survive. */
export function scaleTo(png: Uint8Array, size: [number, number]): Uint8Array {
  const src = decode(png)
  const [w, h] = size
  const out = new PNG({ width: w, height: h })
  const fx = src.width / w
  const fy = src.height / h
  for (let y = 0; y < h; y++) {
    const y0 = y * fy
    const y1 = y0 + fy
    for (let x = 0; x < w; x++) {
      const x0 = x * fx
      const x1 = x0 + fx
      const sum = [0, 0, 0, 0]
      let area = 0
      for (let sy = Math.floor(y0); sy < Math.min(src.height, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy)
        for (let sx = Math.floor(x0); sx < Math.min(src.width, Math.ceil(x1)); sx++) {
          const weight = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * wy
          const i = (sy * src.width + sx) * 4
          for (let c = 0; c < 4; c++) sum[c] = (sum[c] ?? 0) + (src.data[i + c] ?? 0) * weight
          area += weight
        }
      }
      const o = (y * w + x) * 4
      for (let c = 0; c < 4; c++) out.data[o + c] = Math.round((sum[c] ?? 0) / area)
    }
  }
  return new Uint8Array(PNG.sync.write(out))
}
```

- [ ] `actions.ts`: the schemas are built by `schemasFor(bounds: [number, number])`; `Coordinate` uses `bounds`; `Region` becomes `z.tuple([x, y, x, y])` with `x = z.number().int().min(0).max(bounds[0])` and `y = … .max(bounds[1])`. Two tables: `SCREEN_SCHEMAS = schemasFor(RESOLUTION)`, `MODEL_SCHEMAS = schemasFor(MODEL_SCREEN)`. The screen is chosen by name, not by comparing arrays:

```ts
export function parseAction(name: string, input: unknown, screen: 'real' | 'model' = 'real'): ComputerAction | { error: string } {
  const schemas = screen === 'model' ? MODEL_SCHEMAS : SCREEN_SCHEMAS
  if (!isActionName(name)) return { error: `unknown computer action "${name}"` }
  const parsed = schemas[name].safeParse(input ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    return { error: `invalid input for ${name}: ${issues}` }
  }
  return { name, ...parsed.data } as ComputerAction
}
```

  Every existing two-argument call (`run.ts`, `gate.test.ts`, `actions.test.ts`) keeps validating against the real screen, as today. `executeAction` gains a fourth parameter `zoomFit: Point = RESOLUTION` and its `zoom` case returns `cropAndScale(shot, action.region, zoomFit)`. Add:

```ts
/** One position scaled from the model's screen to the real one, rounded to whole pixels and kept on the screen. */
export function toScreenPoint(c: readonly [number, number], from: Point = MODEL_SCREEN, to: Point = RESOLUTION): Point {
  return [Math.min(to[0], Math.round((c[0] * to[0]) / from[0])), Math.min(to[1], Math.round((c[1] * to[1]) / from[1]))]
}

/** The same action with every position scaled from the model's screen to the real one. */
export function toScreen(action: ComputerAction, from: Point = MODEL_SCREEN, to: Point = RESOLUTION): ComputerAction {
  const point = (c: readonly [number, number]): Point => toScreenPoint(c, from, to)
  const out: Record<string, unknown> = { ...action }
  if ('coordinate' in action && action.coordinate) out.coordinate = point(action.coordinate)
  if ('start_coordinate' in action) out.start_coordinate = point(action.start_coordinate)
  if (action.name === 'zoom') out.region = [...point([action.region[0], action.region[1]]), ...point([action.region[2], action.region[3]])]
  return out as ComputerAction
}
```

- [ ] `run.ts`, at the top of `handleComputer`:

```ts
    const scaling = ctx.levers.modelScaling
    const read = parseAction(block.name, block.input, scaling ? 'model' : 'real')
    if ('error' in read) {
      // (the existing parse-error body, unchanged, with `ends: NOT_EXECUTED_AFTER_FAILURE` from Task 4)
    }
    // From here on, every reader sees real screen positions: the gate, the companion, the mouse, the log.
    const parsed = scaling ? toScreen(read) : read
```

  The call becomes `executeAction(parsed, ctx.sandbox, lastShot, scaling ? MODEL_SCREEN : RESOLUTION)`, so a `zoom` crop is fitted into the model screen with its own aspect ratio. Add `const forModel = (png: Uint8Array): Uint8Array => (scaling ? scaleTo(png, MODEL_SCREEN) : png)`. It wraps only the base64 image data sent to the model, in exactly two places; every other use of the same buffer stays full size:

  - The "computer did not answer" branch (today around line 368): `lastShot = png`, `ctx.store.writeShot(ctx.botId, ctx.runId, png)` stay as they are; only the image block changes to
    `{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(forModel(png)).toString('base64') } }`.
  - The outcome-with-image branch (today around line 413): `lastShot = outcome.png`, `stuck.note(…, outcome.png)`, `progress.noteAction(…, outcome.png)` and `ctx.store.writeShot(…, outcome.png)` stay as they are; only the image block changes to
    `{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(parsed.name === 'zoom' ? outcome.png : forModel(outcome.png)).toString('base64') } }`
    (a `zoom` outcome is already fitted into the model screen by `executeAction`).

  Add test 8 to Task 5: under the lever, a `screenshot` followed by a `zoom` of the model-screen region `[0, 0, 512, 320]` — the zoom's crop is taken from the full-size screenshot (the zoom image equals `cropAndScale(fullSizeShot, [0, 0, 640, 400], MODEL_SCREEN)`), which proves `lastShot` stayed 1280x800.
- [ ] `tools.ts`, `attach_file`: `const point = ctx.levers.modelScaling ? toScreenPoint(coordinate) : coordinate`, where `toScreenPoint` is exported from `actions.ts` (the `point` helper above, exported); the companion calls and the returned text use `point`.
- [ ] `prompt.ts`: the cheap-path rule's last sentence is `The screen is ${w} by ${h} pixels.` with `MODEL_SCREEN` under the lever, `RESOLUTION` otherwise.
- [ ] Verify tests pass; run `pnpm preflight`.
- [ ] Commit: `Show the model 1024x640 screenshots and scale its positions to the real screen, behind a lever`

### Task 6: Benchmark scripts [mechanical] [support]

**Files:** Create `data/cost-bench/goals.md`, `snapshot.mjs`, `reset.mjs`, `run-goal.mjs`, `analyse.mjs` (git-ignored; no commit)
**Invariant:** 3 and 8 — the acceptance rule counts finished jobs next to cost. Support: without these scripts no variant can be run the same way twice.
**Demo step:** row 5
**Verify:** `node data/cost-bench/analyse.mjs --baseline` prints the table for the existing run logs

- [ ] `goals.md`:
  - **Goal R** (bot `homer-0f7d`, sent as a chat goal): `Research the town Beroun for the house search: check it against the town criteria in your skill house-search-prague, with sources, and write one artifact town-beroun.md. Do not send any mail and do not save or change skills or routines.` Finished when: the run ends `done`, `town-beroun.md` exists, and every town criterion in the skill has an answer with a source URL.
  - **Goal M** (bot `job-hunt-bot`, routine `check-mail`): an interview invitation from the "Interviewer XY" fixture to the bot's mailbox, sent by Claude through Claude in Chrome from the author's Gmail using the act-two fixture text (`.local/born-hunter.md`); the routine starts by itself. Finished when: the booking approval card appears for a slot the invitation offers, on the Cal.com page, and Claude presses Deny.
- [ ] `snapshot.mjs <botId>`: copies `memory.md`, `chat.jsonl` and `artifacts/` of the bot to `data/cost-bench/snapshots/<botId>/`.
- [ ] `reset.mjs <botId>`: restores those three from the snapshot, so every run starts from the same memory, chat and artifacts. Run logs are not touched.
- [ ] `run-goal.mjs <botId> <goal-file>`: `POST /api/bots/<botId>/messages` with the goal text, reads the returned `runId`, polls `GET /api/bots/<botId>/runs/<runId>` every 10 s until an `end` event, prints `runId` and outcome, and appends `{ variant, goal, runId }` to `data/cost-bench/results.jsonl`. The variant name comes from `--variant`.
- [ ] `analyse.mjs`: reads `results.jsonl` and each run's `events.jsonl`; per run: cost at Sonnet 5 prices ($2 input, $0.20 cache read, $2.50 cache write, $10 output per 1M), steps, model calls, cache-read tokens per call, outcome, and the `finished` mark from `results.jsonl` (set by hand with `--mark <runId> finished|not`). Per variant and goal: mean cost per finished job, finished count, and the change against the accepted previous variant. `--baseline` prints the table of the design spec's Problem section from all existing run logs.
- [ ] Before the first run: `node data/cost-bench/snapshot.mjs homer-0f7d` and `node data/cost-bench/snapshot.mjs job-hunt-bot`.

### Task 7: Run the benchmark [integration] [demo-path]

**Files:** none in `src/`; `data/cost-bench/results.jsonl`
**Invariant:** 2, 3, 4, 8 — real runs on real sites; the acceptance rule; every booking card is denied (no real booking); the measurement itself. Proven by the evidence page.
**Demo step:** rows 1–5
**Verify:** `node data/cost-bench/analyse.mjs` after each variant

For each variant in order — `baseline` (`COST_LEVERS=`), `v1` (`prune-text`), `v2` (+`effort-medium`), `v3` (+`grouped-actions`), `v4` (+`model-scaling`), each built on the levers accepted so far:

- [ ] Stop any running server; start the branch server: from the worktree, `env -u PORT COST_LEVERS=<list> DATA_DIR=<repository root>/data/bots pnpm start` (a temporary launch entry `dobot-bench` in `.claude/launch.json` of the main tree runs this line; removed in Task 8). Check `git status -sb` in both trees first.
- [ ] Three times: `node data/cost-bench/reset.mjs homer-0f7d`, then `node data/cost-bench/run-goal.mjs homer-0f7d goal-r.txt --variant <v>`; judge and `--mark` it.
- [ ] Three times: `node data/cost-bench/reset.mjs job-hunt-bot`; Claude sends the invitation through Claude in Chrome; wait for the `check-mail` run; at the booking card check slot and page, press Deny; judge and `--mark`.
- [ ] `node data/cost-bench/analyse.mjs`: accept the lever when cost per finished job falls by at least 15% on the sum of both goals and the finished count does not fall; otherwise the next variant runs without it.
- [ ] After the last variant: stop the server, and wait for "sandbox paused" on both bots (the rule for leaving nothing that costs money running).

### Task 8: Keep the accepted levers as plain code, record the result [integration] [support]

**Files:** Modify `run.ts`, `prompt.ts`, `actions.ts`, `tools.ts`, `runner.ts`, `run-context.ts`, `index.ts`, `config.ts`, `fakes.ts`, tests; delete `levers.ts` and `levers.test.ts`; `.env.example`; `.claude/launch.json`; create `docs/evidence/<date>-cost-levers/README.md`; modify `docs/decisions.md`, `docs/build-history.md`, `docs/operating-guide.md`
**Invariant:** 8 — the accepted levers are on for every run; the switch code is gone. Support: a switch left in code is a second behaviour nobody runs.
**Demo step:** row 5
**Verify:** `pnpm preflight`, then one regression run of Goal R

- [ ] Evidence page: the baseline table, each variant's table from `analyse.mjs`, the decision per lever with its numbers, the total model spend of the benchmark, and a line that the author reviewed the finished/not marks.
- [ ] For each accepted lever: remove its `ctx.levers.<x>` condition, so the lever's path is the only path; delete the other path's code and its lever-off test, keeping the lever-on test. For each rejected lever: delete its code and tests.
- [ ] Remove `Levers` from `RunContext`, `RunnerDeps`, `makeContext`, `index.ts`, `config.ts` (`COST_LEVERS`), `.env.example`, and the `dobot-bench` launch entry. The `levers` field stays optional in the `queued` schema (the benchmark's logs still parse); `runner.ts` no longer writes it.
- [ ] `docs/decisions.md`: a short entry "Cost levers, measured" with the accepted levers and the link to the evidence; `docs/build-history.md`: the dated record; `docs/operating-guide.md`: nothing about `COST_LEVERS` remains.
- [ ] `pnpm preflight`; one regression run of Goal R on the merged code; its cost appears in the evidence page as the "after" line.
- [ ] Commit: `Keep the measured cost levers and record the benchmark`
- [ ] Merge `cost-levers` into `main` (fast-forward or merge commit, per the author's habit); the author pushes. Remove the worktree: `git worktree remove .claude/worktrees/cost-levers`.

## Verification Criteria

| # | Criterion | How to verify |
| - | --------- | ------------- |
| 1 | Every benchmark run records the levers it ran with | `queued` event of each run in `results.jsonl` holds the variant's `levers` |
| 2 | A pruning pass leaves the newest long page whole, shortens the older ones, and changes the earlier messages only in that one pass | Task 2 tests; the Runs tab trace of a Goal R run still shows full page text |
| 3 | After a failed action or an approval card, no later action of the same group runs | Task 4 tests; in a live run, the Runs tab shows `Not executed` results after a card |
| 4 | Under scaling, the gate and the mouse use real screen positions | Task 5 test 3; live: the approval card's control is the one clicked |
| 5 | Each accepted lever cut cost per finished job by at least 15% without fewer finished jobs | Evidence page tables |
| 6 | No booking was made during the benchmark | Every Goal M run shows a denied approval; the Cal.com page lists no new booking |
| 7 | After Task 8, no switch remains | `grep -rn "COST_LEVERS\|ctx.levers" src/` finds nothing; `pnpm preflight` passes |

## Test Plan

- Tasks 1–5: offline, `pnpm test` with the scoped files above; no key and no sandbox needed.
- Task 6: offline against the existing run logs (`--baseline`).
- Task 7: live; needs `.env.local` keys, the E2B EU sandbox of both bots, the mailbox settings, and Claude in Chrome connected to the author's browser.
- Task 8: `pnpm preflight` (typecheck, tests, greps), then one live regression run.

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan and `data/cost-bench/results.jsonl` (which variants have run).
2. `git -C .claude/worktrees/cost-levers log --oneline main..` for completed tasks.
3. Pick up from the first uncompleted task; in Task 7, from the first variant with fewer than three runs per goal.
