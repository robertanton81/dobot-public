---
name: plan
description: >
  Create a reviewed implementation plan for a feature or task. Proactively
  surfaces assumptions and asks before proceeding. Takes a design spec
  (from /design-spec) or a clear user request as input. Outputs to docs/plans/.
---

# Planning Workflow

**Announce:** "Using /plan to create a reviewed implementation plan."

## Golden Rule

Never assume. If requirements are ambiguous, API behaviour is unclear, or there are several
reasonable approaches — ask the user before proceeding.

## Phase 1: Understand

1. Read the user's request: $ARGUMENTS
2. If a design spec exists in `docs/specs/`, read it — it is the primary input. Its **Demo path**
   and **Invariant coverage** sections bind every task in the plan.
3. Read project context:
   - `CLAUDE.md` — the product, the eight product invariants, delivery constraints, Stack, Commands
   - the project backlog — which step this plan executes and what is already done
   - The codebase — scan structure for what ships today
4. Search the codebase for related code, existing patterns, and reusable functions.
5. **TODO mapping:** Name the the project backlog section and items this plan executes. Existing plans in
   `docs/plans/` are the naming reference.
6. **Stack check:** If `CLAUDE.md` **Stack** or **Commands** still says "undecided", stop. A plan
   cannot prescribe a command that nobody has chosen. Say so and ask the user to run
   `/design-spec` for the stack decision first.

## Phase 2: Surface Assumptions

Before drafting, proactively identify what you are about to assume.

1. List every assumption needed to write this plan (branch, scope, boundaries, dependencies,
   integration points, which services must be running, which API keys must be present).
2. Check which are already answered by the design spec, `CLAUDE.md`, or the codebase.
3. For remaining assumptions — **ask the user**. Rules:
   - **One question per message.** Do not batch.
   - **Multiple-choice preferred** with your recommendation marked.
   - **Propose, do not just ask.** Instead of "What branch?" say: "I would commit to `main`
     directly — small atomic commits, no pull-request overhead for a solo repo. Sound right?"
   - **Stop when constraints are locked.** Do not over-question.

## Phase 3: Research

For every library, SDK, or API the plan will reference:

1. Reuse the source links the design spec already records. Trust a pattern that has a link and a version.
2. For anything the spec did not cover, run `/find-docs` for the pinned version and record
   version + source link in the plan's Research section. Never write a code step against an API
   from memory.
3. If docs are unavailable or contradictory — ask the user.

## Phase 4: Draft

Write the plan to `docs/plans/YYYY-MM-DD-<topic>-plan.md`.

### Planner Persona

You are a non-biased technical planner. Your job is to find the best approach, not to please the
user. Push back with sources when needed. On this project you also push back on scope: every
feature must earn its place with the first user (CLAUDE.md, delivery constraint 2).

### Plan Document Structure

```markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence]
**Approach:** [2-3 sentences about the chosen approach and why]
**Design spec:** [Link to docs/specs/ if one exists, or "N/A"]
**TODO items:** [section and items from the project backlog]
**Branch:** [Target branch]
**Scope:** [Which areas are affected]
**Build estimate:** [The author's hours on human-only steps, and the live-run cycles needed; never calendar days — CLAUDE.md delivery constraint 4]

## Research (source links)

- [API/library decision 1](source-url) — library@version, what was verified

## File Changes

| Action | Path                     | Purpose              |
| ------ | ------------------------ | -------------------- |
| Create | `exact/path/file.ts`     | What it does         |
| Modify | `exact/path/existing.ts` | What changes and why |

## Tasks

### Task 1: [Component Name] [mechanical|integration] [demo-path|support]

**Files:** Create `path/to/file.ts`, Test `path/to/file.test.ts`
**Invariant:** [which CLAUDE.md product invariant this task upholds and how it is proven — or "none touched"]
**Demo step:** [which row of the spec's Demo path table this serves — or why a support task is needed anyway]
**Verify:** [the scoped verify command from CLAUDE.md "Commands"]

- [ ] Write failing test for [behavior]
- [ ] Verify test fails
- [ ] Implement minimal code to pass
- [ ] Verify test passes
- [ ] Commit — imperative subject, no assistant attribution

### Task N: ...

## Verification Criteria

For each requirement, define what "done" looks like beyond "tests pass". At least one criterion
must be a human-observable step from the spec's Demo path.

| #   | Criterion                                                                 | How to verify                                  |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | The agent's screen is visible in the browser within N seconds of starting  | start a session, watch, measure                |
| 2   | The irreversible action stops and waits for approval; Deny abandons it     | run the job to the gate, press Deny, inspect   |
| 3   | The workspace survives a restart: the artifact is still there after reload | create it, restart, re-open                    |
| 4   | A clean clone runs with only the documented steps and the documented keys  | fresh clone in a temp dir, follow README only  |

## Test Plan

- Scoped test commands per task
- Which tests need a live sandbox or an API key, and which can run offline
- Full pre-flight at the end: the command from `CLAUDE.md` "Commands"

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan
2. Check git log for completed commits
3. Pick up from the first uncompleted task
```

### Plan Rules

- Exact file paths always — never "somewhere in src/"
- Complete code in steps — no "implement the logic here"
- No placeholders: no TBD, TODO, "similar to Task N"
- Every step actionable by an engineer with zero context
- Each task tagged `[mechanical]` or `[integration]` for model selection
- Each task tagged `[demo-path]` or `[support]`. A `[support]` task needs a one-line reason why
  the demo cannot work without it. If there is no such reason, cut the task.
- Each task has a scoped verify command taken from `CLAUDE.md` "Commands"
- Each task ends with an atomic commit (imperative subject, no Conventional Commits prefix, no
  assistant attribution)
- Bite-sized steps: write test → verify fail → implement → verify pass → commit
- Every task that touches an outbound side effect, the sandbox lifecycle, persisted state, or
  secret handling names the product invariant it upholds and how it is proven
- Never commit a secret. Keys go in `.env.local` (git-ignored) with empty placeholders in `.env.example`

### What tests are worth writing on this project

This project does not build a full test pyramid for its own sake; a test earns its place by catching what nothing else would. Write
tests where a regression is both likely and invisible:

- The approval gate: an action that should stop does stop, and Deny abandons it. Test this.
  It is invariant 4, and a user trusts the product only if it holds.
- Secret handling: a taken-over credential never appears in the transcript, the logs, or the
  model's context. Test this. It is invariant 5.
- Persistence: state written before a restart is readable after it. Test this. It is invariant 6.
- Pure logic: action parsing, state transitions, anything with branches.

Do not write tests that mock the sandbox and then assert the mock. A sandbox integration is
verified by running it, and that evidence belongs in `/verify`, not in a fake unit test.

## Phase 5: Self-Review

Before dispatching the reviewer, scan the plan:

1. **Spec coverage:** Skim each requirement. Can you point to a task? List gaps.
2. **Placeholder scan:** Any TBD, TODO, vague steps? Fix them.
3. **Type consistency:** Do names used in later tasks match earlier definitions?
4. **Verification criteria:** Does every requirement have a criterion, and is at least one of
   them a human-observable demo step?
5. **Invariants:** Does every task that touches side effects, the sandbox, state, or secrets name
   its invariant?
6. **Scope:** Is every task either on the demo path or justified as support? Is the build estimate
   in the right units (the author's hours on human-only steps, live-run cycles), not calendar days?

Fix inline. No need to loop.

## Phase 6: Review Loop

Launch a **plan-reviewer** subagent (`subagent_type: "plan-reviewer"`, `model: "sonnet"`). Pass
the plan file path and the design spec path (if it exists).

1. Address every `BLOCKING` finding. A `needs docs: <library>` finding is resolved by running
   `/find-docs` and adding the source link. Update the plan.
2. Re-run the reviewer.
3. **Maximum 2 iterations.** If still not clean: present to the user WITH remaining issues.

## Phase 7: Backbrief

Before handing off, write a **Backbrief** synthesizing the plan in your own words. This is
borrowed from Auftragstaktik (mission-type tactics): the goal is to make the delegation to
`/implement` visible — what is locked, what is negotiable, what the implementation subagents
will decide on their own.

The backbrief is three to five sentences, structured as three elements:

1. **End-state.** What the plan delivers in one or two sentences — both what gets committed and
   what a user can watch working after the last commit.
2. **Critical constraints.** The two or three things that must not be wrong during
   implementation. These are the parameters where a mistake means scrapping the branch, not
   amending a commit (for example "the approval check runs before the action, never after",
   "no key is read outside the config module", "the workspace path is outside the sandbox").
3. **Latitude.** Where `/implement` subagents will exercise judgment without coming back to ask.
   Name these explicitly so the user can reclaim control before implementation begins (for
   example "exact test file naming", "internal helper decomposition inside the listed task
   files", "log field names", "how to split a task into one or two commits").

**Rules:**

- Synthesize in your own words. A backbrief that paraphrases the Goal/Approach lines is a
  restatement, not a synthesis.
- Three to five sentences total. Longer means the plan structure is doing the synthesis poorly —
  fix the plan, not the backbrief.
- Do not introduce new requirements. The backbrief is read-only on the plan.

## Phase 8: Present to User

After zero BLOCKING findings (or max iterations hit):

1. Summary: what it builds, key decisions, review iterations, remaining suggestions.
2. Print the **Backbrief** inline (from Phase 7).
3. Wait for explicit approval before `/implement`. If the user wants changes — update and re-run review.

## Phase 9: Handoff & Session Hygiene

Fires after Phase 8 approval. Purpose: tell the user the relative path of the next step's input
document and confirm the session can be cleared.

Print this block exactly:

```
**Output:** `docs/plans/<file>.md`

**Next step:** `/implement` — input doc: `docs/plans/<file>.md`

**Session hygiene:** ✅ Safe to clear session — the plan is on disk and its Checkpoint Recovery section makes it resumable.
```
