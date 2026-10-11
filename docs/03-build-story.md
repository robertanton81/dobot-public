# How they built it in 7 weeks — and what's stealable

Historical research and original interpretation for this assignment. External product details
are a snapshot of the cited sources, not a current service reference. For Dobot as built, read
[decisions](decisions.md), [operation](operating-guide.md) and [verification](verification.md).

> Source: Lenny's Podcast, "How we built Grok Bot in a month" — Roman Ugarte (SpaceXAI), published 2026-09-08.
>
> **Sourcing caveat:** the full transcript is paywalled. What follows comes from the free preview, a syndicated mirror, and cross-references in secondary coverage. Everything below is corroborated by at least one source, but the fine-grained engineering detail is thinner than the product/strategy detail. If the owner wants the deep version, the episode audio is free on Apple Podcasts/YouTube.

## The timeline

| Weeks | Milestone |
|---|---|
| 1–4 | First line of code → working **internal** product |
| 5–7 | Internal → **public launch** |

Hence both framings: "in a month" (to internal) and "7 weeks" (to public). Same story.

Team: **small and deliberately isolated.** Exact headcount not published.

## Who built it

**Roman Ugarte.** Previously led Growth at **Cursor**, scaling it from ~15 to 1,000+ people before SpaceX acquired it. Now at SpaceXAI. So: a growth/product leader incubating a product, not a research team shipping a model.

## The decisions that mattered

**1. Build separately, don't bolt onto Cursor.**
> "Key decision to build it from scratch instead of adding it to Cursor."

They call it the **fresh-start advantage**. Grok Bot needed a different mental model (teammate, not tool) and a different surface (roster chat, not an IDE). Extending Cursor would have inherited the wrong metaphors.

**2. Go "colleague-pilled."**
Commit fully to the coworker frame — naming, avatars, messaging, group chats — instead of "agent configuration." Every UX decision downstream falls out of this one.

**3. Unship and simplify.**
Explicit practice of *removing* features. Reinforced by the design essay's filter: *did this help someone delegate, or give them one more thing to manage?* Company values quoted as **"deleting the product"** and **"just do the thing."**

**4. Manual onboarding at launch scale.**
They **personally onboarded nearly 300 early users.** For a product whose failure mode is "vague autonomy wanders," hand-holding the first cohort is how you learn what a good task looks like.

## Ideas from the interview

**The computer as an abstraction layer.** The VM isn't infrastructure detail — it's the abstraction that makes every un-API'd tool addressable. This is the technical thesis of the product.

**The Bot as the atomic unit of a program.** You compose systems out of *bots* — specialized roles, distinct tools, wired together — rather than out of functions or workflow nodes.

**Always-on infovore / chief of staff.** The positioning target: something that continuously ingests and triages, not something you invoke.

**"Grok Bot can now…"** — capability marketing framed as actions taken, not features shipped.

**Moats are discovered, not planned.** His read on how Cursor kept winning a brutally competitive market.

**The first 90% vs. the last 10%.**
> An AI achieving "100% of the job feels categorically different from one that gets you 90% there."

## What this means for a 1-week take-home

The lesson isn't "ship fast." It's **what they were willing to not build.** In 7 weeks with a real team they still shipped a product describable in five nouns.

Directly applicable:

1. **Pick one job and finish it 100%.** A narrow workflow that genuinely completes beats three that get to 90%. This is their own stated thesis — using it as the organizing principle for the POC is both good product judgment *and* a visible demonstration that the research was actually absorbed.
2. **Commit to the coworker metaphor in the UI.** Name, avatar, state, roster. It's cheap and it's the whole product feeling.
3. **Constraints are a feature.** Shipping one bot with one skill and one trigger, deliberately, reads as judgment. Shipping a half-working builder reads as scope panic.
4. **Demo the thing that only this architecture can do.** Watch it work → it hits a gate → take over → hand back → it finishes. That loop is unfakeable and it's exactly what the brief says they care about.
5. **Make the last 10% visible.** Approvals, takeover, and artifact-out-to-a-real-system *are* the last 10%. Skipping them yields a Surf clone.
