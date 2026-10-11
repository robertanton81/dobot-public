---
name: implement
description: >
  Execute an approved implementation plan task by task — inline or with an
  isolated subagent per task — with two-stage review (spec compliance, then
  code quality + test quality) and atomic commits. Use after /plan produces
  an approved plan.
---

# Implementation Workflow

**Announce:** "Using /implement to execute the approved plan."

## Golden Rule

Never assume. If a plan step is unclear, an API behaves differently than expected, or a test
fails for an unexpected reason — ask the user.

## Phase 1: Load Plan

1. Read the approved plan file. If no path was provided via $ARGUMENTS, ask the user.
2. Read project context:
   - `CLAUDE.md` — the eight product invariants, delivery constraints, Stack, Commands, conventions
   - the project backlog — which step this plan executes
   - The design spec the plan cites, in particular its **Demo path** and **Invariant coverage** tables
3. **Build project snapshot** (reused by all subagents in Phase 2):
   ```bash
   git branch --show-current
   git log --oneline -3
   ```
   Collect: current branch, last 3 commit summaries, the areas affected by this plan, key file
   paths from the plan's File Changes table. Store as a `<project_snapshot>` text block — do not
   re-derive per subagent.
4. Review the plan critically before starting. Raise issues with the user.
5. Count tasks. Determine execution mode:
   - **1-2 tasks:** Inline mode (execute in main context)
   - **3+ tasks:** Per-task decision (see Phase 2)
6. **Seed the todo list.** If the harness offers a task/todo tool, create one item per plan task
   using the plan's task title. This gives the user live progress visibility alongside the plan
   file. Skip silently if no such tool exists or the plan has one task.

### Confirm Constraints

- **Branch:** Correct branch? Check with `git branch --show-current`.
- **Scope:** Which areas? Do NOT touch files outside the boundary.
- **Dependencies:** All required packages installed? Use the install command from `CLAUDE.md`.
- **Keys and services:** Tasks that touch a live sandbox or a model API need their keys present
  in `.env.local`. Check before the first such task, and never print a key value.

## Phase 2: Execute Tasks

### Per-task: dispatch subagent OR inline?

This decision is **per-task**, not per-plan. A 16-task plan where every task is a 5-line edit
should NOT spawn 16 subagents — subagent overhead (prompt + tool result + summary) routinely
costs more tokens than the work saves, and the overhead lands in the main session's context window.

**Do the work inline** (in the main session) when ANY of these holds:

- Hand-edited surface is < ~30 lines AND lives in a single file
- Plan tag is `[mechanical]` AND the content is provided verbatim in the plan body (copy-paste
  with placeholder substitution)
- Task is purely verification (grep, ls, file inspection, a script run)
- Task is a config add, single-section append, or one-line replacement
- Same file was just edited a few turns ago and the relevant context is already cached

**Dispatch a subagent** ONLY when:

- Task changes ≥ 30 lines of hand-written content (not counting copy-paste from the plan), OR
- Task spans multiple unrelated files where staging discipline matters across boundaries, OR
- Task needs a fresh context (review against a large plan/spec, big-codebase introspection), OR
- Task blocks on a slow operation the main session should not sit through (a multi-minute run
  against a live sandbox), OR
- Plan tag is `[integration]` AND the task involves real judgment (not just copy-paste)

When in doubt, default inline. Re-dispatch only when the inline pass actually surfaces a need
for isolation.

**When doing inline, you still respect** every contract a subagent would:

- Mark the task in progress before starting; completed after the commit lands.
- Stage explicitly named files only — never `git add -A` or `git add .`.
- Same scoped verify command as the plan specifies.
- Atomic commit per task with an imperative subject and no assistant attribution.

### Subagent Mode (when dispatch is justified by the rule above)

For each task that justifies a subagent:

1. Mark the task in progress before dispatching the subagent.
2. Dispatch a fresh implementation subagent (see below).
3. After the atomic commit lands and both review stages pass, mark the task completed.

Dispatch shape:

```
Agent(
  subagent_type: "general-purpose",
  model: "[haiku for mechanical, sonnet for integration]",
  prompt: [task text + context below]
)
```

**What to include in the subagent prompt:**

- The `<project_snapshot>` block from Phase 1 step 3 (verbatim — do not re-derive)
- Full task text from the plan (the subagent never reads the plan file)
- Relevant file paths and current content summaries
- Project conventions (reference `CLAUDE.md`)
- Project rules (verbatim, every dispatch):
  - The product invariants from `CLAUDE.md` that this task touches — quote them, with the
    mechanism the spec prescribes (where the approval check sits, how secrets are kept out of the
    transcript and the model context, where durable state lives)
  - The package manager and commands from `CLAUDE.md` "Commands" — no other package manager
  - Strict typing — no `any`, no suppression comments, types inferred from the validation schema
    where one exists
  - A structured logger, never raw `console.*` in server code; no secret value in any log line
  - Every network, sandbox, and model call has a timeout; malformed input is rejected and logged,
    never crashes the process
  - Tests where a regression is likely and invisible: the approval gate, secret handling,
    persistence, pure logic. Do not mock the sandbox and assert the mock.
  - Commit message: imperative, no Conventional Commits prefix, no assistant attribution — no
    `Co-Authored-By` footer and no mention of Claude or any AI tool
- The scoped verify command from `CLAUDE.md` "Commands"
- Instruction to commit atomically when done and to report `DONE` / `DONE_WITH_CONCERNS` /
  `NEEDS_CONTEXT` / `BLOCKED`

**What NOT to include:**

- Other tasks' details
- Session history
- The full plan file
- Any secret value. A subagent that needs a key reads it from the environment; the key never
  travels in a prompt.

**Model selection per task:**

- `[mechanical]` tag → Haiku (1-2 files, clear spec, checklist-following)
- `[integration]` tag → Sonnet (multi-file, judgment needed)
- If no tag, default to Sonnet
- **Do NOT pass `model: "opus"` as a blanket override.** Reserve it for subagents that genuinely
  need a very large context (for example a reviewer reading a long plan + spec + many files at
  once) and justify it inline in the dispatch prompt so the cost is visible.

**Subagent status handling:**

- **DONE:** Proceed to review
- **DONE_WITH_CONCERNS:** Read concerns. If correctness/scope, address before review. If
  observations, note and proceed.
- **NEEDS_CONTEXT:** Provide missing context, re-dispatch
- **BLOCKED:** Assess: context problem → re-dispatch with more context. Task too complex →
  re-dispatch with Sonnet. Plan wrong → ask the user.

### Inline Mode

Execute sequentially in the main context. For each task:

1. Mark the task in progress (skip if the todo list was not seeded).
2. Follow the plan's steps exactly.
3. Follow `CLAUDE.md` conventions and the project rules listed above.
4. Write the tests the plan specifies — approval gate, secret handling, persistence, pure logic.
5. Run the scoped verification command from `CLAUDE.md` "Commands".
6. Create an atomic commit (imperative subject, no assistant attribution).
7. Mark the task completed.

### Debugging Protocol

If a test fails for a non-obvious reason:

1. **Read** the full error output and stack trace.
2. **Trace** the execution path from entry point to failure.
3. **Identify** the EXACT line/condition causing the failure.
4. **Explain** your root cause analysis before proposing a fix.
5. **Regression test:** Write a test that reproduces the exact bug. Verify it fails. When the
   bug touches an await on external I/O, a timer, a stop signal, a retry, a stream, a queue, or
   state that survives a restart, write the state table first (`CLAUDE.md`, "KISS wins") and
   a test per row that the current code fails.
6. **Smallest complete fix:** the smallest change that restores the contract for every caller and
   every state in the table. Fewer lines is not the goal; fewer unhandled states is.
7. **Verify:** Regression test passes, full suite has no regressions.
8. **If other tests break:** classify first: a regression, a changed contract, a pre-existing
   defect, or a test problem. Revert only for a regression; the other three are named in the record.
9. **If a second fix on the same behaviour is needed:** stop patching. Write the state table for
   the whole operation and fix against it. Ask the user only for a product trade-off.

A flaky failure against a live sandbox is not an exception to this protocol. Find out whether it
is a race, a timeout that is too short, or a changed page, and say which. "Ran it again and it
passed" is not a diagnosis, and on demo day it will not pass.

## Phase 3: Two-Stage Review (per task)

**Skip review** if the task changed fewer than 30 lines (`git diff --stat`) AND touched no
outbound side effect, secret handling, sandbox lifecycle, persisted state, human wait, timer,
cancellation, retry, or stream. Those areas are always reviewed, however small the diff: the first
four are where the product invariants live, the last five are where a local patch leaves the
contract broken (review rounds of 2026-09-17).

Otherwise, run two sequential reviews:

### Stage 1: Spec Compliance (fast, cheap)

Launch a **spec-compliance-reviewer** subagent (`subagent_type: "spec-compliance-reviewer"`,
`model: "haiku"`).

Prompt includes: plan task text + list of changed files + `git diff`.

This reviewer answers ONE question: does the code match what the plan specified? Nothing extra,
nothing missing. Binary pass/fail.

- If FAIL: fix the gaps, re-run Stage 1.
- If PASS: proceed to Stage 2.

### Stage 2: Code Quality + Test Quality (parallel)

Launch **two reviewer subagents in parallel** in a single message (separate `Agent` tool calls
in the same response):

1. **code-reviewer** (`subagent_type: "code-reviewer"`, `model: "sonnet"`) — conventions,
   resilience, product invariants, security, error handling, test _existence_, everything except
   plan adherence (already verified in Stage 1) and test _meaningfulness_ (delegated below).

2. **test-quality-reviewer** (`subagent_type: "test-quality-reviewer"`, `model: "sonnet"`) —
   runs whenever the diff touches any test file **or** when logic was added or modified in one of
   the four invariant areas without a paired test. This reviewer rejects tautology tests,
   mock-only tests, framework tests, sleep-driven tests, and any other form that always passes
   regardless of what the code does.

Each prompt includes: changed files + `git diff` + (for the test-quality-reviewer) the list of
source files in the diff so it can cross-check coverage of new logic.

Merge the two reports. Address every `BLOCKING` finding from either reviewer, re-run scoped
verification, then re-dispatch **only the reviewer that flagged the issue** (do not re-run the
other). A `needs docs: <library>` finding is resolved with `/find-docs` before re-dispatch.

- **Maximum 2 iterations per reviewer per task.** If still not clean: present to the user.

If the diff has zero test-file changes AND added no logic in the four invariant areas (for
example a docs-only or config-only task), skip the test-quality-reviewer.

## Phase 4: Finalize

After all tasks are implemented, reviewed, and committed:

1. Run the full pre-flight from `CLAUDE.md` "Commands".
2. Fix any issues found.
3. **Walk the demo path once, by hand**, exactly as the spec's Demo path table describes it.
   A plan is not finished because its tasks are. Invariant 3 says the job completes end to end;
   this is where that is checked before `/verify` makes it formal.

## Phase 5: Present to User

Summary:

- Tasks completed (with check marks)
- Files created/modified
- Commits made (list with hashes)
- Test count and pass status
- Review iterations and what was caught
- Result of the manual demo-path walk in Phase 4
- Any deviations from the plan with justification
- Any remaining `SUGGESTION` findings

Do not push unless the user asks.

## Phase 6: Cleanup

After the user confirms the implementation is complete:

1. **Tick the the project backlog items** this plan completed. Only items that are done and verified;
   partial items stay unchecked. Move anything deliberately dropped into the `Parked` section
   with its reason.

2. **Add a `STATUS: SHIPPED` header to the plan file.** Plans are NOT moved to an `archived/`
   subdirectory; they stay in `docs/plans/` with a top-of-file blockquote that warns future
   readers not to re-execute and documents plan-vs-reality drift. Required structure:

   ```markdown
   > **STATUS: SHIPPED <YYYY-MM-DD>.** Landed as <N> commits ending at `<sha>`. The unchecked
   > `- [ ]` boxes below are historical — work is done. **Do not re-execute this plan.** If you
   > are modifying <area>, work directly in <code paths>.
   >
   > **Plan-vs-reality corrections discovered during execution:**
   >
   > **Library/version drift:** (pinned versions vs. installed, missing deps that had to be added)
   >
   > **Plan code prescriptions that needed adjustment:** (code samples in the plan that did not
   > compile or run as written, with the fix that shipped)
   >
   > **Corrections applied during review (commit `<sha>`):** (every BLOCKING finding from Stage 2
   > and how it was fixed)
   >
   > **Deferrals worth tracking:** (SUGGESTION findings that did not ship; what to do, where,
   > when — these feed the "known limits" and "what comes next" sections of `docs/decisions.md`
   > and the project backlog)
   >
   > **Plan history below is preserved as-written for context. Treat the live code as authoritative.**
   ```

   The drift bullets are the load-bearing payload for this project specifically: the product
   record (`docs/decisions.md`) holds decisions, trade-offs and what comes next. These bullets are
   where that content comes from. Writing them well now saves a day of reconstruction later.
   Be specific (file paths, exact symbols) — vague entries like "fixed a typecheck issue" rot fast.

3. **Commit both updates in a single commit** with subject `Mark <plan-name> shipped and update TODO`.

4. **Do NOT** move or rename the plan file. The path stays stable so references in commit
   messages remain valid.

## Phase 7: Handoff & Session Hygiene

Purpose: tell the user the relative path of the next step's input document and either confirm
session-clear safety or block clearing until the in-session context (Phase 6 drift bullets) has
been captured.

### Between Phase 5 and Phase 6

Phase 6 needs this session's review findings to write good drift bullets. Print:

```
**Output:** commits `<first-sha>..<last-sha>` on `<branch>`.

**Next step:** `/verify` — input doc: `docs/plans/<plan-file>.md`. (Or run Phase 6 cleanup first, then `/verify`.)

**Session hygiene:** ⏳ NOT safe to clear yet — Phase 6 (TODO tick + STATUS: SHIPPED header) needs the in-session review findings for the drift bullets. Run Phase 6 before clearing.
```

### After Phase 6

Print:

```
**Output:**
- Commits `<first-sha>..<last-sha>` on `<branch>`
- TODO tick + STATUS: SHIPPED header — committed in `<sha>`

**Next step:** `/verify` — input doc: `docs/plans/<plan-file>.md`. (Or the next unchecked item in the project backlog.)

**Session hygiene:** ✅ Safe to clear session — the project backlog and the plan header reflect the shipped state.
```
