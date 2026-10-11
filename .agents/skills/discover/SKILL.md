---
name: discover
description: >
  Find and stress-test the job the AI coworker will do. Two modes: discovery
  (generate and score candidate jobs against a rubric) and challenger (attack a
  candidate you already like until it survives or dies). Use before /design-spec,
  whenever the use case is not chosen or not yet defended. Outputs a decision
  record to docs/specs/.
---

# Job Discovery and Challenger

**Announce:** "Using /discover to find and stress-test the job."

## Why this skill exists

Dobot is a commercial product: a hosted Grok Bot alternative for EU teams. How the job is framed
matters as much as how it is built. The choice of job decides everything downstream: what the user
sees, which invariants have
somewhere to live, and whether the visible remote computer is the point or just decoration.

A wrong job cannot be rescued by good engineering. This skill is here to make the choice
deliberately and to attack it before a week is spent on it.

**This skill does not decide.** It generates, scores, challenges and records. The user chooses.

## Phase 1: Load Context

1. Read the user's input: $ARGUMENTS
2. Read:
   - `AGENTS.md` — the eight product invariants, the delivery constraints (the fourth is on time)
   - `docs/decisions.md` — the product decisions already recorded
   - the project backlog — what is already decided
   - `docs/specs/` — any prior decision that narrows the field
3. Run `/grok-bot-product` for the option space: the five primitives, the design laws, the
   approval and takeover patterns, and what E2B Surf already does.

## Phase 2: Pick the Mode

- **Discovery mode** — no candidate yet, or the user has a vague direction. Go to Phase 3.
- **Challenger mode** — the user already has a candidate. Skip to Phase 5 and attack it.

If the user arrives with a candidate but has not tested it, say so and run challenger mode. Do not
generate alternatives they did not ask for until the candidate has actually failed.

## Phase 3: Generate Candidates (discovery mode)

Generate **five to seven** candidate jobs. Go wide before going deep. Cheap and varied beats
polished and narrow at this stage.

For each candidate, one line: *who* delegates it, *what* the coworker does, *where* it happens,
*what exists* at the end.

### Where good candidates come from

This is priming, not a recommendation list. Generate beyond it.

- **Admin interfaces with no usable API** — legacy CRMs, hosting control panels, supplier and
  reseller portals, booking back-ends, invoicing portals.
- **Cross-surface reconciliation** — compare a spreadsheet against a dashboard, a price list
  against a live site, a CMS against what is actually published.
- **Verification of your own product** — walk the signup flow, check a staging environment, find
  what broke after a deploy. Grok Bot demos this one itself.
- **Monitoring a surface that refuses automation** — a competitor's pricing page, a marketplace
  listing, a tender or grant portal.
- **Form-heavy filing** — an expense portal, an insurance claim, a registration form, a job posting
  pushed to several boards.
- **Inbox or ticket triage inside a tool with no API** — read, find the relevant document, draft a
  reply, stop before sending.

### Candidates that look good and are not

Flag and drop these early. Each has a specific reason.

| Candidate | Why it fails |
| --- | --- |
| "Manage my inbox" / "help with anything" | Vague autonomy is the documented failure mode of this product category — loop-prone and quota-burning. Narrow roles are what make it work. |
| Book a flight, order food, buy something | Payment, terms of service, and no user will let a bot spend money on their behalf without a very strong gate. |
| Write code, open a pull request | Excellent APIs exist, so the remote computer is decoration. Reviewers also rate this the product's weakest area. |
| Research a topic and summarise it | No computer needed, no irreversible moment, and dull to watch. |
| Post to social media | Terms of service plus aggressive bot detection. It will break while a user relies on it. |
| Anything behind a CAPTCHA-heavy login | Takeover becomes the whole run instead of a moment in it. |
| Anything that needs an account you do not have | Discovered after the build, and then the job cannot run. |

## Phase 4: Score the Candidates

Score every candidate against the rubric. Be harsh. A generous score here costs a week.

### Hard gates — a zero on any of these eliminates the candidate

| # | Gate | The question |
| - | ---- | ------------ |
| G1 | **Needs a computer, not an API** | Would a competent engineer just call an API instead? If yes, the visible remote computer is a costume and the whole premise collapses. This is the filter that matters most and the one most often got wrong. |
| G2 | **Has a natural irreversible moment** | Is there a real send, publish, submit, pay or delete at the end? Without one, the approval gate has nowhere to live and invariant 4 becomes a demo of a dialog box. |
| G3 | **Buildable and demoable within the real constraints** | Can you get every account, does the target tolerate a datacenter IP, is the flow stable? Count the author's hours on human-only steps and the live-run cycles the flow needs, never calendar days (AGENTS.md, delivery constraint 4). |
| G4 | **Safe and legal to do and to hand over** | Driving an agent into a third-party service you do not own can breach its terms. The risk lives in the shipped product, and customers carry it with us. Prefer your own accounts, your own data, or a target whose terms permit automation. |

### Scored criteria — 0, 1 or 2 each

| # | Criterion | 2 points means |
| - | --------- | -------------- |
| S1 | **Watchable** | The screen shows recognisable progress the whole time. No three-minute spinner. |
| S2 | **Verifiable outcome** | An artifact exists in a real system afterwards and you can point a camera at it. |
| S3 | **Natural blocked moment** | A login, a second factor or a verification step appears on its own, so takeover is real rather than staged. |
| S4 | **Repeats** | A person would genuinely run this weekly, so persistence, memory and routines have a reason to exist. |
| S5 | **Legible in sixty seconds** | A user in the first-user group (an EU team) understands the job from the first screen, without an explanation. |
| S6 | **Beyond Surf** | Completing it requires something E2B Surf cannot already do — identity, memory, approval, takeover, a durable artifact. |

Present the scores as a table. Then shortlist the **top three** and say plainly which one you would
pick and why.

## Phase 5: Challenge the Leading Candidate

This is the part that earns the skill its name. Attack the candidate. Assume it is wrong.

### Ask the user, one question per message

Follow the project's questioning rules: one question at a time, multiple choice where the options
can be enumerated, your recommendation and reasoning included, stop when it is decided.

Work through these in order. Stop early if the candidate dies — that is a success, not a failure.

1. **Why a computer and not an API?** If the honest answer is "it would be easier with an API",
   the candidate is already dead. Say so.
2. **Describe minute two of the run on screen.** Shot by shot, what the user sees. If you cannot, the job is
   not watchable and S1 was scored too generously.
3. **The target changes its layout overnight, before the morning routine. What happens?** There
   must be an answer that is not "run it again and hope".
4. **Where exactly is the irreversible moment, and would a real user want approval there?** If the
   gate is bolted on to satisfy an invariant rather than because a human would want it, it will read
   as bolted on.
5. **What does this prove that Surf does not already prove?** The sharpest question in the set.
   Anything Surf does is the floor, not the deliverable.
6. **Is this a demo or a product?** Would anyone run it a second time? If not, persistence and
   memory are decoration and the product story is thin.
7. **What is the smallest version that still convinces?** Then: why not build only that? The
   delivery constraint is the smallest convincing scope, and this is where it gets enforced.
8. **One sentence: why this job?** If a customer asks and there is no crisp answer, the framing is
   not finished.

### Then get an independent verdict

Launch a **job-challenger** subagent (`subagent_type: "job-challenger"`, `model: "sonnet"`). Pass
it the candidate, the rubric scores, and the answers from the questions above.

It has fresh context and no investment in the idea. Address every `FATAL` finding. A candidate
with an unresolved `FATAL` does not proceed to `/design-spec` — take the next one on the shortlist
and run Phase 5 again.

Maximum **two** candidates challenged per session. If both die, stop and widen the generation in
Phase 3 rather than grinding.

## Phase 6: Write the Decision Record

Write to `docs/specs/YYYY-MM-DD-job-selection.md`.

```markdown
# Job Selection

**Date:** YYYY-MM-DD
**Status:** Decided
**Chosen job:** [one sentence — who delegates what, where, and what exists at the end]

## Why this job

[Three to five sentences. The one-sentence answer from question 8, then the reasoning.]

## Candidates considered

| Candidate | G1 | G2 | G3 | G4 | S1 | S2 | S3 | S4 | S5 | S6 | Total | Outcome |
| --------- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | ----- | ------- |
| ...       | ✓  | ✓  | ✓  | ✓  | 2  | 2  | 1  | 2  | 2  | 2  | 11    | chosen  |

## Challenge log

| # | Question | Answer | Survived? |
| - | -------- | ------ | --------- |
| 1 | Why a computer and not an API? | ... | yes |

## Independent verdict

[The job-challenger's findings and how each was resolved.]

## What this job gives each invariant

| # | Invariant | Where it lives in this job |
| - | --------- | -------------------------- |
| 1 | Visible remote computer | ... |

## Rejected candidates worth recording in `docs/decisions.md`

[Two or three, with the one-line reason. A trade-off that is not written down does not exist, and
showing what was considered and dropped is cheap evidence of judgment.]

## Risks carried into the build

[What is still dangerous about this choice, and the fallback for each. These feed the spec's
"Failure modes on the day" section.]
```

## Phase 7: Handoff & Session Hygiene

Print this block exactly:

```
**Output:** `docs/specs/<date>-job-selection.md`

**Next step:** `/design-spec` — input doc: `docs/specs/<date>-job-selection.md`

**Session hygiene:** ✅ Safe to clear session — the decision and the reasoning are on disk.
```

Tick the the project backlog item for choosing the job, and leave the edit **unstaged** so the user controls
when it lands. Move rejected directions into the `Parked` section with their reason.
