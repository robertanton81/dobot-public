# How this project is built with Claude Code

This directory is part of the repository on purpose. It shows how we work with AI tools.
Dobot is a product prototype, built by the author with Claude Code and Codex, and every decision
must be explainable. The harness below is set up so that this holds: a plan before code, a review before a commit, libraries
verified against current documentation rather than the model's memory.

## Principle

Every step has an input document, an output document, and an adversarial review. Nothing runs
by itself: I invoke the skills by hand, and the skills spawn the review agents. Findings are
either **BLOCKING** (must be fixed, at most two iterations) or **SUGGESTION**.

## Contents

| Path | What it is |
| --- | --- |
| `../CLAUDE.md` | Project context for Claude: the product, invariants, delivery constraints, conventions, workflow. |
| `../docs/` | The research pack on Grok Bot, plus `specs/` and `plans/` produced by the skills. |
| `../.codex/`, `../.agents/skills/` | The same review agents (`.codex/agents/*.toml`), skills and session hook for Codex. The two sets are kept in step on purpose. |
| `skills/discover` | Find and stress-test the job the coworker does: generate candidates, score them against a rubric of hard gates, then attack the leading one. |
| `skills/design-spec` | Explore the problem, 2–3 approaches with trade-offs, spec into `docs/specs/`. |
| `skills/plan` | Reviewed implementation plan into `docs/plans/`: tasks, verify commands, verification criteria. |
| `skills/implement` | Execute the plan task by task, two-stage review (plan compliance → code and test quality), atomic commits. |
| `skills/verify` | Check the finished implementation against the plan's criteria and the standing invariants, with evidence. |
| `skills/grok-bot-product` | The Grok Bot research as a loadable reference. Supplies the option space for a product decision; it does not decide. |
| `agents/*-reviewer.md`, `agents/job-challenger.md` | Read-only review agents. `test-quality-reviewer` rejects tautology, mock-only and sleep-driven tests. |
| `hooks/session-orient.sh` | On session start, prints where to start reading and warns about uncommitted changes. |
| `settings.json` | Command allowlist and hook registration. |

## Where it comes from

The skills and agents are adapted from an earlier project of the author and stripped of everything
that belonged to that domain. I deliberately left out the self-modifying parts (an experience
wiki, automatic suggestions to change the skills): the harness should stay readable and stable
for the whole task.

The one addition specific to this project is `skills/grok-bot-product`. Dobot is a hosted Grok
Bot alternative for EU teams, and product judgment decides whether it is worth using. So the
research on what Grok Bot is and where it breaks needs to be loadable at decision time, not
buried in a document nobody opens.

## Adapted for this project

The earlier project was a correctness problem — message ordering, idempotency, no lost
writes. Adversarial review of invariants was exactly right there. This one is a product problem:
a user watches a bot do a real job, so the risks are different and the reviewers check different
things:

- Does each feature serve a job the user runs, without adding an unnecessary failure mode?
- Does the whole job path still run end to end, or only the part that was just changed?
- Would a stranger be able to clone this repository and run it?
- Does the work still honour the eight product invariants in `CLAUDE.md` — above all the visible
  remote computer, real work rather than simulation, and the approval gate?

## Flow

```
backlog item  →  /discover (the job)  →  /design-spec (spec)  →  /plan (plan)  →  /implement (code + review + commits)  →  /verify (evidence)
```

Run the loop per milestone, not per small task. A milestone is a piece of the product that can be shown
working on its own; the full ceremony on every small step buys nothing the user sees.

Commit history is ordinary team history: small commits with an imperative subject. The commit
message describes the change and nothing else. A commit Claude authored carries a `Co-Authored-By` line, and that is the only footer.
