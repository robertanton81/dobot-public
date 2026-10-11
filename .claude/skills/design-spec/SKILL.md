---
name: design-spec
description: >
  Explore a problem space through collaborative questioning, propose approaches
  with trade-offs, and produce a design spec. Use when the approach is not yet
  decided. Outputs to docs/specs/.
---

# Design Workflow

**Announce:** "Using /design-spec to explore the problem and produce a spec."

## Scope

This skill is for work where the right approach has not been decided. If the approach is already
clear and the user just needs a plan, skip to `/plan`.

Dobot is a commercial product: a hosted Grok Bot alternative for EU teams. Product judgment
matters as much as code. A spec that picks a technical approach without saying which job the
coworker does, what the user sees, and what was cut is incomplete.

## Phase 1: Understand the Problem

1. Read the user's request: $ARGUMENTS
2. Read project context:
   - `CLAUDE.md` — the product, the eight product invariants, the delivery constraints, conventions
   - the project backlog — which step this design serves and what is already done
   - `docs/decisions.md` — the product decisions and trade-offs already recorded
   - `docs/01-product.md` and `docs/02-architecture.md` — what Grok Bot is and how it works
   - `docs/specs/` — prior specs; once a spec records the chosen job or the stack, it binds every later design
3. Run `/grok-bot-product` whenever the design makes a **product** decision (what the coworker
   does, how the user delegates, what the agent shows, where approval sits). It supplies the
   option space and the known failure modes. It does not decide.
4. Search the codebase for related code, existing patterns, and prior decisions.
5. **Scope check:** If the request spans several independent pieces (for example the sandbox
   layer AND the approval model), flag this immediately. Propose splitting it into separate
   design cycles. Each piece gets its own spec → plan → implement cycle.
6. **TODO mapping:** Name the the project backlog section and items this design covers. If it fits none,
   flag it and ask whether it is in scope.

## Phase 2: Surface Gray Areas

Before proposing anything, identify what you do not know.

1. List every assumption you would need to make to design a solution.
2. Check which are already answered by `CLAUDE.md`, `docs/decisions.md`, the research pack, existing code,
   or prior specs.
3. For each remaining gray area — **ask the user**. Rules:
   - **One question per message.** Do not batch.
   - **Multiple-choice preferred.** Present 2–4 options with your recommendation marked.
     Open-ended only when options cannot be enumerated.
   - **Include your recommendation and reasoning** with each question.
   - **Stop when you have enough clarity** to propose approaches. Do not interrogate.
4. Record each decision as you go — these become the **Decisions Log** in the spec.

## Phase 3: Research

Never design against a library from memory.

1. For every library, SDK, or external service the design depends on, run `/find-docs`
   (Ref → context7 → web) for the version you intend to pin. Confirm the exact API the design
   relies on — for example how a desktop sandbox is created, how long it lives, whether it can
   be paused and resumed, how its screen is streamed, and what it costs per hour.
2. Record each verified fact with its version and source link — they become the spec's Research
   section.
3. If docs are unavailable or contradictory — ask the user rather than guessing.

Every technical claim in the design MUST cite a source link.

**Sandbox lifetime and cost are load-bearing for this project.** Invariant 6 requires the agent's
workspace to survive a restart. A design that assumes a sandbox can be resumed, or that ignores
what an idle sandbox costs, is wrong in a way that surfaces in a user's first run. Verify both.

## Phase 4: Propose Approaches

Present **2–3 concrete approaches**. For each:

- **What:** Brief description
- **Trade-offs:** What you gain and lose — build time, reliability on the day, how much of the
  product model it demonstrates, cost, how well it survives a page reload
- **Fits with:** How it aligns with the eight invariants in `CLAUDE.md` and with the user's job path
- **Risk:** What could go wrong — a brittle browser flow, a sandbox that will not resume, a
  CAPTCHA or login wall, a model that loops, an action that cannot be made reversible
- **Build cost:** An honest estimate in the author's hours on human-only steps and in live-run
  cycles (CLAUDE.md, delivery constraint 4), never in calendar days
- **Source:** Documentation links

End with a clear recommendation and reasoning.

### Pushback Rules

- If the request conflicts with an invariant — push back, with the invariant named.
- If there is a simpler way — propose it, even if the user described a specific approach.
- If a piece of scope proves nothing the user's job needs or adds a failure mode to the job path — say
  so and propose cutting it, with that reason. Cutting is the default answer on this project, and
  time is never the reason given.
- If the design copies Grok Bot without an opinion — say so. A defensible difference is a
  reason to choose Dobot; imitation is not.
- After pushing back, if the user insists with reasoning — accept and document the deviation.

## Phase 5: Write the Design Spec

Write to `docs/specs/YYYY-MM-DD-<topic>-design.md`.

### Spec Structure

```markdown
# [Feature Name] Design Spec

**Date:** YYYY-MM-DD
**Status:** Draft
**TODO items:** [section and items from the project backlog]
**Scope:** [Which areas this affects]

## Problem

[What problem does this solve? Why now?]

## Decisions Log

| #   | Question | Decision | Reasoning |
| --- | -------- | -------- | --------- |
| 1   | ...      | ...      | ...       |

## Chosen Approach

[Description of the selected approach]

**Why this over alternatives:** [Brief justification]

## Research (source links)

- [Decision 1](source-url) — library@version, what was verified

## Design

### [Component/Area 1]

[Details — enough for /plan to produce a plan without guessing]

## Demo path

[Required. The exact sequence a user runs, step by step, with what the user sees on
screen at each step and what is happening underneath. Name the moment the agent hits the
approval gate, the moment the human takes over, and the artifact that exists at the end. If a
step cannot be described here, it is not built yet. Delete no rows — cut the feature instead.]

| # | What the user sees | What happens underneath |
| - | ------------------ | ----------------------- |
| 1 | ...                  | ...                     |

## Invariant coverage

[Required. Walk all eight invariants from CLAUDE.md. For each: the mechanism that upholds it, or an
explicit statement that this design does not touch it. "Partly" is not an answer.]

| # | Invariant | Mechanism, or "not touched" |
| - | --------- | --------------------------- |
| 1 | Visible remote computer | ... |

## Failure modes in use

[What breaks during a live run, and the fallback. At minimum: the sandbox will not start or
resume, the target site changed its layout, a login expired, a CAPTCHA appeared, the model loops
or stalls, the network is slow. For each: how it is detected and what the operator does.]

## Scope budget

[What is in, what is parked and why, and the honest build estimate in the author's hours on
human-only steps and in live-run cycles. Parked items move to the `Parked` section of the project backlog with the reason, and the trade-off
goes into `docs/decisions.md`.]

## Alternatives Considered

### [Alternative 1]

[What it was, why it was rejected]

## Open Questions

[Any unresolved items — if none, delete this section]
```

### Spec Rules

- Every technical claim must have a source link.
- No placeholders: no TBD, TODO, or "to be decided".
- The design must be detailed enough for `/plan` without guessing.
- The **Demo path**, **Invariant coverage**, **Failure modes in use** and **Scope budget**
  sections are mandatory. They are what makes this a product spec rather than a task list.
- The eight invariants in `CLAUDE.md` are addressed by name.

## Phase 6: Self-Review

Before dispatching the reviewer, scan the spec yourself:

1. **Placeholder scan:** Any TBD, TODO, incomplete sections? Fix them.
2. **Internal consistency:** Do sections contradict each other?
3. **Scope check:** Is this focused enough for one implementation plan, and does every part of it prove something the user's job needs?
4. **Ambiguity check:** Could any requirement be interpreted two ways? Pick one.
5. **Demo check:** Can you narrate the Demo path table out loud, end to end, without "and then somehow"?
6. **Invariant check:** Is every one of the eight invariants either upheld by a named mechanism or
   explicitly out of scope?

Fix issues inline. No need to loop — just fix and move on.

## Phase 7: Review Loop

Launch a **design-reviewer** subagent (`subagent_type: "design-reviewer"`, `model: "sonnet"`) to
critically evaluate the spec.

1. Address every `BLOCKING` finding. A `needs docs: <library>` finding is resolved by running
   `/find-docs` and adding the source link. Update the spec.
2. Re-run the reviewer on the updated spec.
3. **Maximum 2 iterations.** If still not clean: present the spec to the user WITH remaining issues.

## Phase 8: Backbrief

Before handing off to the user, write a **Backbrief** synthesizing the spec in your own words.
This is borrowed from Auftragstaktik (mission-type tactics): the goal is to make the delegation
visible — what is locked, what is negotiable, what `/plan` and `/implement` will decide on their own.

The backbrief is three to five sentences, structured as three elements:

1. **End-state.** What the spec describes in one or two sentences. What the finished work looks
   like in the codebase and what the user will be able to watch happen.
2. **Critical constraints.** The two or three things that must not be wrong. These are the
   parameters where a mistake means a redesign, not a revision (for example "the approval gate
   sits in front of every outbound side effect, not just the one on the job path", "the workspace
   lives outside the sandbox so a restart does not lose it", "no secret ever reaches the model").
3. **Latitude.** Where `/plan` and `/implement` will exercise judgment without coming back to
   ask. Name these explicitly so the user can reclaim control on specific dimensions before the
   plan is written (for example "component decomposition in the UI", "test file naming",
   "log field names", "the copy shown in the approval card").

**Rules:**

- Synthesize in your own words. If the backbrief reads like the spec rearranged, it has not
  demonstrated understanding — it is a transcript.
- Three to five sentences total. Longer means the spec is doing the synthesis poorly.
- Do not introduce new requirements. Backbrief is read-only on the spec.

## Phase 9: Present to User

> "Spec written to `docs/specs/<path>`. Backbrief follows. Please review the backbrief — if any
> of the _critical constraints_ are wrong or any _latitude_ item should be locked down, say so
> before we move to `/plan`."

Then print the backbrief inline. Wait for approval. If changes are requested, update and re-run
review (Phase 7).

## Phase 10: Handoff & Session Hygiene

Fires after Phase 9 approval. Purpose: tell the user the relative path of the next step's input
document and confirm the session can be cleared without losing resume context.

Print this block exactly:

```
**Output:** `docs/specs/<file>.md`

**Next step:** `/plan` — input doc: `docs/specs/<file>.md`

**Session hygiene:** ✅ Safe to clear session — the spec is on disk and the project backlog points at the next step.
```

If the spec completed any the project backlog item outright (typically a decision step), tick those boxes
in the project backlog and leave the edit **unstaged** so the user controls when it lands; say so in the
block. Move anything the spec parked into the `Parked` section of the project backlog with its reason.
Never tick an item the spec only partially covers.
