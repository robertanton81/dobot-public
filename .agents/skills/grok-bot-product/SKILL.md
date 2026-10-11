---
name: grok-bot-product
description: >
  Reference on Grok Bot — the product Dobot is inspired by. Its five primitives,
  its design laws, the shared-computer architecture and where it breaks, and what
  E2B Surf does and does not give you. Use when making a product decision: what the
  coworker does, how the user delegates, what the agent shows, where approval sits,
  what to cut. Supplies the option space and its trade-offs; it does not decide.
---

# Grok Bot — product option space

**Announce:** "Loading /grok-bot-product for the option space."

Sources and full notes: `docs/01-product.md`, `docs/02-architecture.md`,
`docs/03-build-story.md`, `docs/05-sources.md`. Read the relevant file when a decision needs the
detail. This skill is the index and the decision aid.

## What the product actually is

A roster of named, persistent AI coworkers, each with its own screen on a cloud computer the user
can watch and take over. Not a chat session. Not a workflow builder. A teammate you message.

The unlock is **assembly, not capability**. Computer use, browsers and schedulers already existed.
Grok Bot hid them behind a chat window and a name.

## The five primitives

Every product decision should be expressible in these five nouns. If a proposed feature is none
of them, it is probably a workflow builder feature and probably should be cut.

| Primitive | What it is |
| --- | --- |
| **Bots** | Persistent agents with identity, memory, runtime, tools |
| **Chats** | The only interaction surface (1:1 and group) |
| **Prompts** | Instructions — one-time, saved as Skills, or bound to Routines |
| **Tools** | Web, APIs, shell, computer use |
| **Artifacts** | Durable outputs — documents, code, designs |

## The design laws

Use these when deciding what the interface does.

1. **Sessions become a roster.** A bot has a name and an avatar. Coming back tomorrow means
   coming back to the same bot, not scrolling a history list.
2. **The avatar carries identity and state at once** — idle, working, waiting, blocked, thinking,
   done. No separate status badges.
3. **Progressive disclosure of execution.** Animated dots say too little; a full transcript says
   too much. Motion reassures, hover reveals the current action, a panel shows the screen.
4. **Three levels of access to the computer:** status in the title bar, a preview panel you can
   glance at, full-screen takeover when the bot is blocked.
5. **The computer is the bot's workspace, not yours.** The user is a visitor on the bot's machine.
6. **Response format is part of the answer.** Prose for narrative, cards and widgets for data.
7. **Constraints are a feature.** Roughly 50 bots per account, 6 per group chat.
8. **The interface should ask less of the person as the agent takes on more.**

**The filter to apply to every feature:** *did this help someone delegate, or did it give them
one more thing to manage?*

## The architecture bet, and the opening it leaves

Grok Bot runs **one persistent Linux VM per user account**, shared by every bot: shared cookies,
shared `/workspace`, shared credentials. Each bot gets its own screen on that shared machine.

- **What it buys:** the user signs in once, by hand, and every bot inherits it forever. No OAuth
  app, no API keys, no integration work. This is what makes "it just works with your tools" true.
- **What it costs:** "the screens are separate work surfaces, not separate security boundaries."
  Bots cannot be used for privilege isolation. One bot's compromised credential compromises all
  of them. Deleting a bot leaves its files and sessions behind.

This is the most-cited flaw in the product and **the most obvious place for Dobot to hold a
different opinion**. A defensible difference is a reason for a team to choose Dobot; imitation
is not. If the design takes the opposite bet — isolation per bot or per task, explicit
credential scoping — say so and defend it in the spec.

## Execution paths, cheapest and most reliable first

```
structured connector → official API or CLI → cloud browser (computer use) → local computer
```

Computer use is the headline capability and the fragile one. Reviewers report browser automation
breaking on layout changes, CAPTCHAs, and cloud IPs getting blocked. Prefer an API where one
exists — *except* where the point of the demo is precisely to work without one.

## Task shape worth reusing

> **Outcome, sources, constraints, deliverable, review point.**

Good scaffold for a system prompt and for the UI that collects a job from the user.

## Approval model worth copying

Hard stops: sending, publishing, payments, deletion or overwriting, permission changes,
production modifications, accepting legal terms.

Controls: **Allow once / Deny / Always allow**. Rules come in two classes, *Require Approval* and
*Always Allow*, and the conflict rule is explicit: **if both match, Require Approval wins.** Fail
closed. Copy this.

Approvals act on the *proposed* action. They do not undo completed work.

## Sensitive input — the pattern to copy exactly

Humans must complete: passwords, passphrases, two-factor codes, CAPTCHAs, payment confirmation,
identity verification.

Flow: **take over → complete only the blocked step → hand control back.** Secret-request cards
are *"masked, excluded from the transcript, and not shown to the model"* — explicitly different
from pasting a secret into chat. Cheap to reproduce and a genuinely well-designed detail.

## The autonomy ladder

```
one-time task → make it reliable → save as Skill → bind to Routine (schedule or event)
```

Routines are the real claim: **work that starts without a prompt.** Note that this is also the
most expensive part to build, and the least visible in a short demo. Consider proving the ladder
exists rather than building every rung.

## Known failure modes — do not reproduce these

- **Vague autonomy fails fast.** "Manage my inbox" produces loop-prone, quota-burning wandering.
  Narrow roles are what make it work.
- **Brittle browser automation** on layout change, CAPTCHA, blocked IPs.
- **Bots are not security boundaries** (see above).
- **No model choice, no context compaction, no fresh-thread lever.**
- **Memory is a black box** — users cannot inspect, correct, export or delete individual memories.
- **Opaque usage accounting.** Users hit limits by surprise.

## What E2B Surf gives you, and what it does not

Surf is a Next.js app wiring an E2B Desktop Sandbox to a computer-use model, with SSE streaming,
a chat interface, and real-time screen updates. It is a sanctioned starting point.

**It does not give you:** persistent identity, memory, a roster, skills, routines and triggers,
approval gates, takeover, artifacts, or multiple bots. Surf is one ephemeral session with one
anonymous agent.

**That gap is the product.** Anything Surf already does is the floor, not the value.

## How to use this in a decision

1. State the decision as one of the five primitives.
2. Check it against the delegate-or-manage filter.
3. Check it against the eight product invariants in `AGENTS.md`.
4. If it copies Grok Bot, say why that is right here. If it differs, say why that is better here.
   Either way the reasoning goes in the spec's Decisions Log and then into `docs/decisions.md`.
5. Estimate the build cost in the author's hours on human-only steps and in live-run cycles, never in
   calendar days. The strongest answer is usually the one that proves more with fewer moving parts.
