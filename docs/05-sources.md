# Sources

Gathered 2026-09-10. Rated by how much they're worth re-reading during the build.

## Primary (x.ai / SpaceXAI)

| ★ | Source | Good for |
|---|---|---|
| ★★★ | [Designing Grok Bot for a world of persistent agents](https://x.ai/news/designing-grok-bot) | **The best single document.** Five primitives, roster vs sessions, avatar-as-state, three levels of computer access, the delegate-vs-manage filter. Re-read before designing any UI. |
| ★★ | [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot) | Positioning, the coworker frame, use-case list, availability. Short. |

## The build interview

| ★ | Source | Good for |
|---|---|---|
| ★★ | [How we built Grok Bot in a month — Roman Ugarte, Lenny's Podcast](https://www.lennysnewsletter.com/p/how-we-built-grok-bot-in-a-month) | Timeline, build-separately decision, colleague-pilled, unshipping, 300 manual onboardings. **Transcript paywalled** — audio free on Apple Podcasts / YouTube. |
| ★ | [Syndicated mirror](https://startup.whatfinger.com/2026/09/08/how-we-built-grok-bot-in-a-month-roman-ugarte-spacexai/) | Free partial of the above; where most of the interview detail here came from. |

## Independent teardowns

| ★ | Source | Good for |
|---|---|---|
| ★★★ | [Grok Bot Architecture — The Architecture DeepDive](https://thearchitecturedeepdive.blog/articles/grok-bot-architecture.html) | **Most technical.** Shared-VM topology, screens-aren't-security-boundaries, approval taxonomy, Auto Review conflict rule, recovery cascade, sharing semantics. |
| ★★ | [A deep dive into Grok Bot — Flavio Copes](https://flaviocopes.com/grok-bot/) | Practitioner view: concrete workflows, the execution-path hierarchy, `/workspace` discipline, honest failure modes. |
| ★★ | [OpenClaw Power, MacBook Simplicity: Five Days With Grok Bot — Latent Space](https://www.latent.space/p/grok-bot) | Hands-on verdict, plugin-catalog friction, missing control levers, competitive framing. |
| ★ | [Official Grok Bot Breakdown — Vellum](https://www.vellum.ai/blog/official-grok-bot-breakdown) | Connector list, MCP notes, memory-opacity gap. |
| — | [Grok Bot in depth — Roan Monteiro, Medium](https://medium.com/@roanmonteiro/grok-bot-in-depth-how-every-feature-works-and-where-the-shared-computer-breaks-547c733601c8) | Title promises the shared-computer critique; **403 on fetch**, not retrieved. Try in a browser. |

## Build inputs

| ★ | Source | Good for |
|---|---|---|
| ★★★ | [e2b-dev/surf](https://github.com/e2b-dev/surf) | Sanctioned starting point. Next.js + `@e2b/desktop` + computer-use model + SSE streaming. |
| ★★ | [E2B docs](https://e2b.dev) | Desktop Sandbox SDK, sandbox lifecycle, persistence, timeouts. Read properly before committing to the architecture. |

## Gaps not yet closed

- Full Lenny transcript — the "two early product decisions" are named but not detailed anywhere free.
- The Medium teardown (403).
- E2B Desktop SDK specifics: sandbox persistence/reconnect semantics, pause/resume, cost model. **Needed before choosing the architecture** — resolve via Ref/Context7 rather than assuming.
