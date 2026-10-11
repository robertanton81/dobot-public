# Grok Bot — the product

Historical research and original interpretation for this assignment. External product details
are a snapshot of the cited sources, not a current service reference. For Dobot as built, read
[decisions](decisions.md), [operation](operating-guide.md) and [verification](verification.md).

> Distilled 2026-09-10 from x.ai's own announcement + design essay, plus three independent teardowns. Sources in [05-sources.md](05-sources.md).

## One line

Grok Bot is **a roster of named, persistent AI coworkers, each with its own screen on a cloud computer you can watch and take over.**

Not a chat session. Not a workflow builder. A *teammate you message*.

## The pitch, in their words

> "your team of always-on agents"

> "It was just like bringing on a coworker. No automations to set up, no product quirks, no intricate naming."

The claimed unlock is **not model capability — it's assembly**. Every teardown converges on this: the parts (computer use, browsers, schedulers) already existed. Grok Bot hid them behind a chat window and a name.

## The five primitives

The design essay reduces the whole product to five nouns. This is the most reusable idea in the entire research pack:

| Primitive | What it is |
|---|---|
| **Bots** | Persistent agents with identity, memory, runtime, tools |
| **Chats** | The only interaction surface (1:1 and group) |
| **Prompts** | Instructions — one-time, or saved as Skills, or bound to Routines |
| **Tools** | Web, APIs, shell, computer use |
| **Artifacts** | Durable outputs — docs, code, designs |

If a POC can't be described in these five nouns, it's probably a workflow builder wearing a costume.

## The design laws worth stealing

**1. Sessions → roster.**
Chat history buries conversations; a roster keeps them. > "A Bot has a name. It has an avatar... When you come back tomorrow, you are coming back to the same Bot."

**2. The avatar carries identity *and* state.**
No separate status badges. One element answers "which bot" and "what is it doing" — idle, working, waiting, blocked, thinking, done.

**3. Progressive disclosure of execution.**
They tried animated dots (too little) and full transcripts (too much). Landed on: motion reassures, hover reveals the current action, panel shows the screen.

**4. Three levels of access to the bot's computer.**
- **Status** — title-bar indicator
- **Preview** — pinned side panel, watchable without supervising
- **Takeover** — full screen when the bot is blocked

> "It is closer to working with a coworker than operating a remote machine. You can tell that they are working, glance at their screen when you need context, and sit down when something requires your help."

**5. The computer is the bot's workspace, not yours.**
Reinforced with dynamic wallpapers that shift through the day. Deliberate spatial/temporal separation — you are a visitor on their machine.

**6. Response format is part of the answer.**
Prose for narrative, cards/widgets for data. Inline widgets so review doesn't require leaving the chat.

**7. Constraints over features.**
~50 bots per account, 6 per group chat. The governing question for every feature:
> "Did this help someone delegate, or did it give them one more thing to manage?"

**8. Interface minimization.**
They *removed* window controls, metadata displays, computer-view options.
> "As agents take on more responsibility, the interface should ask less of the person."

## Capability → autonomy ladder

Their recommended path, and a good spine for a demo narrative:

```
one-time task → make it reliable → save as Skill → bind to Routine (schedule/event)
```

Routines are the real product claim: **work that starts without a prompt.**
> "A prompt can start a session, but so can a schedule, an event, or another Bot."

Teaching by demonstration exists too: up to 10 minutes of recorded screen interaction → draft Skill.

## Jobs it's shown doing

Sales outbound research + personalized drafts · CRM hygiene · customer follow-up · demo-env verification · bug repro and ticket filing · inbox triage · expenses · recruiting ops.

Note the pattern: **cross-app, repetitive, judgment-light, approval-gated at the end.** Nobody demos "write my architecture."

## Honest weaknesses (from hands-on reviewers)

- **Vague autonomy fails fast.** "Manage my inbox" produces loop-prone, quota-burning wandering. Narrow roles are load-bearing.
- **Browser automation is brittle.** Layout changes, CAPTCHAs, cloud IPs getting blocked.
- **Bots are not security boundaries** (see [02-architecture.md](02-architecture.md)) — the single most-cited flaw.
- **No model selection**, no context compaction, no fresh-thread lever.
- **Memory is a black box** — can't inspect, correct, export, or delete individual memories.
- **Opaque usage accounting.** Users hit limits by surprise.
- Verdict from Latent Space: a "digital chief of staff that doesn't require training" — good at admin, *not* about to write your PRs.

## The strategic claim to remember

> An AI achieving "100% of the job feels categorically different from one that gets you 90% there."

The whole product is organized around closing that last 10% — which is why approvals, takeover, and persistence exist at all.
