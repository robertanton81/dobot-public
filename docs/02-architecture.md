# Grok Bot — how it actually works

Historical research and original interpretation for this assignment. External product details
are a snapshot of the cited sources, not a current service reference. For Dobot as built, read
[decisions](decisions.md), [operation](operating-guide.md) and [verification](verification.md).

> Mechanism-level notes. Where sources disagree or are inferred rather than documented, it says so.

## The core architectural bet: one shared computer

**Not** a sandbox per bot. **Not** a sandbox per task.

> "Every Bot on your account uses the same computer. Browser cookies and signed-in sessions are shared. Files are visible to every Bot."

The metaphor they use: *one workshop in the cloud.* Every teammate shares the drawers (files), the already-signed-in browser, and the keys on the wall.

Topology:
- One persistent Linux VM, scoped to the **user account**
- Shared `/workspace` — the only durable directory
- Persistent browser profile (cookies, sessions) shared across all bots
- Shared CLI credentials
- Each bot gets **its own screen** on that shared machine

### Why this is the interesting decision

It buys the single biggest UX win: **you sign in once, by hand, and every bot inherits it forever.** No OAuth app, no API keys, no integration work. That's what makes "it just works with your tools" true.

It costs the single biggest flaw:

> "The screens are separate work surfaces, not separate security boundaries."

Consequences, spelled out by the teardowns:
- Bots **cannot** be used for privilege isolation
- One bot's compromised credential compromises all of them
- Deleting a bot does **not** remove shared files or sessions
- Creating a second bot does not isolate it from credentials the first one left behind

**This is the most fertile tension in the whole product.** A POC that takes the opposite bet (isolation per bot/task, explicit credential scoping) has a real, defensible product argument — not just a different implementation.

## Execution paths (in preference order)

Reviewers independently recommend this hierarchy — cheaper and more reliable, left to right:

```
structured connector/plugin → official API or CLI → cloud browser (computer use) → local computer
```

- **Plugins/connectors** — attached with `@` in chat, managed account-wide. Built-ins: Gmail, Google Calendar, Drive, OneDrive, Outlook Mail/Calendar, Teams, SharePoint, Salesforce. Plus MCP tools (custom servers must be publicly reachable or tunneled).
- **Computer use** — the fallback when no connector exists. Browser + desktop automation. This is the headline capability *and* the fragile one.
- **Local execution** — macOS/Windows, off by default ("Ask every time"), controlled separately from cloud access.

Concurrency: one computer-use task per bot screen at a time; multiple bots can use *tools* in parallel.

## Task shape

The documented framing for a well-formed task:

> **Outcome, sources, constraints, deliverable, review point.**

Worth lifting verbatim as a system-prompt scaffold.

## Approval model

The bot runs until it hits a blocking condition. Approvals fire on the **proposed action** — they do not undo completed work.

Hard stops:
- sending / external messaging
- publishing
- payments and transfers
- deletion or overwriting
- permission changes
- production modifications
- accepting legal terms

Controls: desktop offers **Allow once / Deny / Always allow**; iPhone offers **Approve once / Deny**.

**Auto Review** adds model-based rules in two classes — *Require Approval* and *Always Allow*. Conflict resolution is stated explicitly: **"If both kinds of rule match, Require Approval wins."** Fail-closed. Copy this.

### Sensitive input handling — the good pattern

Human must intervene for: passwords, passphrases, 2FA, CAPTCHAs, payment confirmation, identity verification.

Flow: **take over → complete only the blocked step → return control.**

Secret-request cards for supported connectors are *"masked, excluded from the transcript, and not shown to the model"* — explicitly distinguished from pasting a secret into chat. That distinction is a genuinely well-designed detail and cheap to reproduce.

## Memory and state

**Durable:** memory, `/workspace` files, browser sessions, preferences. Context compounds; it does not reset per task.

**Replaceable:** temp directories, manually installed packages, uncommitted app state.

Recovery cascade, least to most destructive:
```
retry/reopen → restart app → Recover Agent Computer → Update Agent Computer → Reset (lossy)
```

The practitioner warning that matters: **only `/workspace` survives recovery.** Real artifacts must flow out to a repo, doc store, CRM, or tracker. The bot's memory is not a system of record.

Known gap: users cannot inspect, correct, export, or delete individual memories.

## Skills and routines

- A **Skill** = reusable instruction set (account-level, shared across bots)
- A **Routine** = Skill + schedule or event trigger (bot-level)
- Up to 50 routines per bot; last 20 run records retained; deleting a routine has no undo
- Event triggers (Slack, GitHub) are separate from plugin connectors
- Schedule/instruction editing is **desktop-only**; mobile can pause/resume

Deliberate split: **tools and skills are account-level; memory and routines belong to the individual bot.** That's what lets a legal bot and a finance bot share capabilities without drowning in each other's context.

## Sharing

Public share links copy **configuration** (identity, description, skills, routines) but never the workshop, logins, or chat history. Duplication copies profile and settings, not conversation history or learned memory.

## Platform reality

Desktop: macOS + Windows only, no Linux. Mobile: iPhone, iOS 18+ (no iPad, no Android). Availability: SuperGrok all tiers, Cursor Pro all tiers, Cursor Teams (Standard/Premium), as of 26 Aug 2026. Usage metered separately from Grok/Cursor plans. Enterprise via waitlist. Model locked to xAI's — no switching.

---

## E2B Surf — the suggested starting point

The assignment names [e2b-dev/surf](https://github.com/e2b-dev/surf) as inspiration. What it actually is:

- **Next.js app** wiring **E2B Desktop Sandbox** (Linux VM) to a computer-use model
- Layers: Next.js frontend (desktop view + chat) → SSE streaming API → E2B sandbox → model loop
- Loop: user instruction → model emits actions → actions execute on the VM → screen streams back → repeat
- Deps: Next.js, `@e2b/desktop`, OpenAI client, Tailwind, Framer Motion
- Setup: clone, `npm install`, `.env.local` with `E2B_API_KEY` + `OPENAI_API_KEY`, `npm run dev`
- Ships with: real-time streaming, action feedback, example prompts, dark/light, auto-extending sandbox timeouts

**What Surf gives you free:** the visible remote computer — the exact thing the assignment says they care about most.

**What Surf does *not* give you — i.e. the entire product delta:** persistent identity, memory, roster, skills, routines/triggers, approval gates, takeover, artifacts, multi-bot. Surf is one ephemeral session with one anonymous agent.

That gap *is* the assignment.
