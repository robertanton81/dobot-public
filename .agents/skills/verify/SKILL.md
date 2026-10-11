---
name: verify
description: >
  Post-implementation verification against the plan's acceptance criteria and
  the project's standing product invariants. Runs each verification criterion,
  reports pass/fail with evidence, and diagnoses failures. Use after
  /implement completes.
---

# Verification Workflow

**Announce:** "Using /verify to check the implementation against acceptance criteria."

## Purpose

Tests passing is not the same as "done". This skill checks whether what was built actually
satisfies the plan's requirements and the project's product invariants from the user's
perspective — and, on this project, whether it will still work in front of an audience.

## Phase 1: Load Criteria

1. Read the plan file. If no path via $ARGUMENTS, ask the user.
2. Extract the **Verification Criteria** table from the plan.
3. If the plan has no verification criteria section, build one from the plan's tasks and the
   design spec's requirements. Present it to the user for confirmation before proceeding.
4. **Add the standing criteria** that apply to the plan's scope (see below). They are verified on
   every plan that touches the relevant area, whether or not the plan listed them.

### Standing criteria

Derived from the eight product invariants and the delivery constraints in `AGENTS.md`.

| Applies when the plan touches | Criterion | How to verify |
| --- | --- | --- |
| the sandbox or the UI | The agent's remote screen is visible and live while it works | start a session, watch it act, confirm the screen updates as the action happens |
| any agent action | The work is real: the artifact exists in the target system afterwards, not only in the transcript | complete the job, then inspect the target system directly |
| the chosen job | The job runs start to finish without a human doing a step the product claims to do | run it once, unassisted except at the gates, and record where it stopped |
| any outbound side effect | The action stops at the approval gate; Approve proceeds, Deny abandons it and leaves no partial effect | run to the gate, press Deny, inspect the target system for partial writes |
| approval rules | When an allow rule and a require-approval rule both match, approval still wins (fail closed) | construct the overlap, observe which one fires |
| takeover / credentials | A credential entered during takeover appears in no transcript, no log file, and no model prompt | grep the transcript store and the logs for a marker value entered during takeover |
| memory, workspace, session | State written before a restart is present after it | write, restart the process and reload the page, read back |
| the sandbox lifecycle | A sandbox that timed out or was torn down does not lose the artifact | force the timeout, then re-open the session |
| any change at all | A clean clone runs with only the documented steps and the documented keys | clone into a temp dir, follow the README literally, note every undocumented step needed |
| any change at all | The full pre-flight passes from a clean install | the pre-flight command from `AGENTS.md` "Commands" |

## Phase 2: Run Checks

For each criterion:

1. **Execute** the verification command or inspection step.
2. **Capture** the output as evidence.
3. **Classify:** PASS (evidence confirms criterion) or FAIL (evidence contradicts).
4. Record in the verification report.

Rules:

- No claims without evidence. If you cannot run the check, say so and mark it NOT RUN, never PASS.
- Run checks in the current codebase state — do not modify code during verification.
- If a check needs a live sandbox or an API key, start what you need yourself and tear down what
  you started. If a key is missing, mark the check NOT RUN and say which key it needs. Never
  print a key value.
- The clean-clone check is run in a temporary directory, never in the working repo. Follow the
  README literally, including its stated prerequisites. Every step you had to improvise is a
  finding against delivery constraint 1.

## Phase 3: Diagnose Failures

For each FAIL:

1. **Root cause:** Trace why the criterion is not met. Read relevant code, test output, and logs.
2. **Minimal fix:** Describe the smallest change that would satisfy the criterion.
3. **Classify:** Missing implementation, bug, or spec mismatch.

## Phase 4: Report

```markdown
## Verification Report

**Plan:** [plan file path]
**Date:** YYYY-MM-DD
**Result:** [N/M criteria passed, K not run]

### Results

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 1   | ...       | PASS   | [output] |
| 2   | ...       | FAIL   | [output] |

### Failures

#### F1 — [Criterion]

**Evidence:** [What was observed]
**Root cause:** [Why it fails]
**Fix:** [Minimal change needed]
**Classification:** [Missing impl | Bug | Spec mismatch]
```

## Phase 5: Next Steps

- **All PASS:** "All verification criteria met." Suggest ticking the corresponding the project backlog
  items if `/implement` Phase 6 has not run yet.
- **Some FAIL:** "N criteria failed. Want me to fix them?" Do NOT fix automatically — let the
  user decide. Fixes go through the Debugging Protocol in `/implement` (root cause first).
- **Spec mismatch:** Flag that the plan or the spec may need updating, not just the code.
- **Known limits surfaced:** anything that passed only with a caveat goes to the "known limits
  and conscious compromises" list in `docs/decisions.md`. Do not silently upgrade a caveat to a
  pass — users and operators rely on that list, and a named limit is safer than a hidden one.

## Phase 6: Handoff & Session Hygiene

Purpose: tell the user the relative path of the next step's input document and either confirm
session-clear safety or block clearing until the in-session failure context has been captured.

### All PASS

No new project state — verify confirms what code + plan already say. Print:

```
**Output:** verification report above — pass evidence captured inline.

**Next step:** the next unchecked item in the project backlog (or `/implement` Phase 6 cleanup if it hasn't run).

**Session hygiene:** ✅ Safe to clear session — the project backlog is accurate; the report above is preserved in the transcript.
```

### Some FAIL

Failure diagnoses live only in this session — clearing would lose the root-cause analysis. Print:

```
**Output:** verification report above — <N> failures with root cause + minimal fix per failure.

**Next step:** decide between fixing in-session or capturing failures into a follow-up plan first.

**Session hygiene:** ❌ NOT safe to clear yet — failure diagnoses live in this session only. Either fix in-session, or write the failure list to `docs/plans/<date>-<topic>-followup.md` before clearing.
```
