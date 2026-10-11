# Product Framing and Use-Case Selection

**Date:** 2026-09-10
**Status:** Decided (use case, product framing, one bot, bot-written skills, apply surface).
Revised 2026-09-11. R1 is run and R2 is dissolved — see "Decision: startupjobs.cz is the demo
surface, LinkedIn is dropped". The act-two scheduling page is Calendly; the last check before
`/design-spec` is that a browser agent can drive it (R6).
Open questions for it are collected near the end.
**Product:** a persistent AI coworker platform — bots with identity and memory, skills, routines, a
visible remote computer, approval gates and takeover. Every job-specific behaviour is configuration.
**Demo use case:** A job seeker delegates the application grind to a persistent bot. On a schedule the
bot watches a **configurable list of job sources** for new postings that match a profile, builds a
company dossier, drafts a tailored cover letter, fills in the application form on a
visible remote computer, attaches a CV built once from the user's own profile export, and then
hands the user the real page with everything pre-filled and a ready-to-press apply button. A
closing beat follows: an interview invitation lands in a dedicated mailbox, the bot notices it
unprompted, proposes a slot, waits for approval, and books it for real.
**Demo configuration:** one source and one apply surface, both on startupjobs.cz. The repository
contains no code specific to that site.

## Product and use case

**The job hunt is a use case, not the product.** This record was first written as "choose the job",
and that framing hid a distinction the author raised on 2026-09-11. Grok Bot is a platform: named,
persistent bots with memory, skills, routines and a computer. The job hunt is the configuration used
to prove the platform works. The brief asks for both — a product "inspired by Grok Bot", and "a
useful job or workflow" to show it.

**The rule that follows, and it binds `/design-spec`:** every job-specific behaviour is
configuration, not code. The bot does not know what a job, a CV or a recruiter is until it is
configured. **And the user never writes that configuration** — they describe the goal in plain
language and the bot writes it (see "Decision: users never write skills").

**Where the line between code and skill sits:** would a bot doing a completely different job also
need this? Yes → platform code (computer tool, mailbox tool, memory, scheduler, approval gate,
takeover, a render-to-PDF tool). No → a skill (dossier, cover letter, CV from the LinkedIn export,
searching startupjobs.cz, noticing an invitation, booking a slot).

| Part of the job hunt | Grok Bot primitive | Lives in |
| --- | --- | --- |
| Watching job sources on a schedule | **Routine** (skill + schedule trigger) | bot configuration |
| Noticing the interview invitation | **Routine** (skill + event trigger) | bot configuration |
| Dossier, CV, cover letter | **Skills** producing **Artifacts** | skill files |
| Filling the application form, booking the slot | The bot using its **computer** tool, stopped by an **approval gate** | platform |
| Profile, what was applied to, which reply belongs to which application | Bot **memory** | platform storage |
| Job sources | **Skills** ("search startupjobs.cz with these filters", "read job-alert emails") using platform tools | skills the bot writes |

**The test for "product, not script":** replacing the job-hunt skills and routines with another use
case's — cancelling subscriptions, say — needs no code change. If it would, the job hunt has leaked
into the platform and that is a review finding.

**Audience, stated as a deliberate difference.** Grok Bot is aimed at work: it is sold through
SuperGrok and Cursor Pro/Teams with Enterprise on a waitlist, and every job it demonstrates is
office work (see `docs/02-architecture.md` and `docs/01-product.md`). The author wants a product for
ordinary people's lives. The job hunt sits between the two — one person's admin, but work-shaped —
which is part of why it was chosen. The write-up states this difference and argues it rather than
leaving it implicit.

## Why this job

The pattern is: **watch a surface nobody will give you an API for, prepare the work, file it, and
stop before the irreversible step.** Job applications are the instance, not the point. It was
chosen because it is a common inefficiency, and because it is the rare case
where the irreversible moment is not manufactured to satisfy an invariant — a real person genuinely
cares whether software submits a job application under their name. That makes the approval gate the
reason the product exists rather than a dialog box bolted on for the demo.

There is also a purpose argument. A job search can take months and is built out of
ghosting, repetition and rejection. Automating the tedious half of that is a materially different
act from automating commercial lead hunting for profit: the beneficiary is the person doing the
work, not someone extracting value from strangers. That distinction is what justifies the terms
decision recorded under R3 below.

The job also gives every one of the six invariants a natural home (see the table below), and it
scores 11 of 12 on the discovery rubric with no fatal finding from an independent challenger.

## Candidates considered

| Candidate | G1 | G2 | G3 | G4 | S1 | S2 | S3 | S4 | S5 | S6 | Total | Outcome |
| --------- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | ----- | ------- |
| Always-awake mail/calendar assistant that proposes actions on upcoming events | ✗ | ✓ | ⚠ | ✓ | 0 | — | — | 2 | 2 | 2 | — | **eliminated on G1** |
| Job-hunt coworker: watch → dossier → cover letter → form → approve → submit | ✓* | ✓ | ✓* | ✓ | 1 | 2 | 2 | 2 | 2 | 2 | **11** | **chosen** |
| Hosting or domain panel operator | ✓ | ✓ | ? | ✓ | 2 | 2 | 2 | 1 | 2 | 2 | 11 | shortlisted; author wants a product for ordinary people, not admin work |
| E-shop price and stock reconciliation | ✓ | ✓ | ⚠ | ✓ | 2 | 2 | 1 | 2 | 2 | 2 | 11 | shortlisted; no shop admin account |
| Recruiting-side applicant triage | ⚠ | ✓ | ⚠ | ✓ | 2 | 2 | 1 | 2 | 2 | 2 | 11 | needs invented applicants — a closed loop |
| Conference CFP submission | ✓ | ✓ | ⚠ | ⚠ | 2 | 2 | 2 | 1 | 1 | 2 | 10 | occasional, weak S4 |
| Expense or claim filing | ✓ | ✓ | ✗ | ✓ | 2 | 2 | 1 | 2 | 2 | 2 | — | **eliminated on G3**, no portal account |
| Deploy-and-verify walker | ✗ | ⚠ | ✓ | ✓ | 2 | 1 | 0 | 2 | 1 | 1 | — | **eliminated on G1**, a Playwright test does it |
| Subscription cancellation coworker | ✓ | ✓ | ✓ | ✓ | 2 | 2 | 2 | 1 | 2 | 2 | 11 | an errand, not a job — each service is cancelled once |
| Slot hunter (inspection, clinic, test, office appointment) | ✓ | ✓ | ⚠ | ⚠ | 2 | 2 | 2 | 2 | 2 | 2 | 12 | highest score; no real booking needed this week, and taking scarce public slots needs an ethical line |
| Claim and complaint filer | ✓ | ✓ | ⚠ | ⚠ | 2 | 2 | 1 | 1 | 2 | 2 | 10 | occasional, real legal filing |
| Contract renewal watchdog | ✓ | ✓ | ⚠ | ✓ | 2 | 2 | 1 | 0 | 2 | 2 | 9 | yearly |
| Price-drop refund chaser | ✓ | ✓ | ⚠ | ✓ | 1 | 2 | 1 | 2 | 1 | 2 | 9 | niche outside some markets |
| Parking fine appeal | ✓ | ✓ | ✗ | ⚠ | 1 | 2 | 0 | 0 | 2 | 1 | — | **eliminated on G3** |
| Cinema ticket booking | ⚠ | ✓ | ⚠ | ⚠ | 2 | 2 | 1 | 1 | 2 | 1 | 9 | irreversible moment is a payment |
| Travel planner (destination, hotel, route) | ✗ | ✓ | ⚠ | ⚠ | 1 | 1 | 1 | 0 | 2 | 1 | — | **eliminated on G1**: mostly research, and booking is a payment |

`✓*` = conditional on the day-one target checks below.

**How the list was produced.** The first two rows came from the author and went straight to
challenger mode, so the option space was not opened at first. On 2026-09-11 the generation phase
was run properly: first across business sources, then again for ordinary people's everyday life at
the author's request. The job hunt was kept. The main finding: **mass consumer tasks are mostly
occasional** — you cancel a subscription once and file a claim once a year — and something used
twice a year needs a button, not a persistent coworker. Only the slot hunter and the job hunt are
ongoing, and the job hunt is the one with every account already in hand.

**G1 note.** The mail/calendar candidate died because Gmail and Google Calendar have first-class
APIs with push notifications. Reading them through a browser is slower, more fragile, and reads as
a costume. The job-hunt candidate passes G1 only on the application form, and only conditionally —
see the carried risks. **Update after R1:** on any single fixed form G1 fails, because a script
with fixed selectors would do the job. G1 holds at the level of the product, not the site. See
"Decision: startupjobs.cz is the demo surface, LinkedIn is dropped".

**S1 was scored down from 2 to 1.** The "always watching" phase happens over a cheap poll, not on
the remote computer, so it is not visually demoable. Only the form filling and the approval are
genuinely watchable. The fix under consideration is an on-screen ticker of postings being checked,
so the always-awake claim has something to point at.

## Challenge log

| # | Question | Answer | Survived? |
| - | -------- | ------ | --------- |
| 1 | Why a computer and not an API? | Two places earn it. LinkedIn has no API for job search at all, so the browser is the only route. The employer's application form has no key a job seeker can obtain. Between them, the cheap sources (job-board endpoints, alert emails) and the cover letter are read or generated by whatever is cheapest. Cheapest path first is deliberate and written down rather than hidden. **Superseded 2026-09-11** by the startupjobs.cz decision: the answer is now "because application forms differ from site to site, and the bot has no code for any of them". | yes, conditionally |
| 2 | Describe the demo segment shot by shot | Roster idle → status flips to working with no prompt → preview panel shows the careers page and the dossier → cover letter as a card in chat → form fields fill one by one → CV attached from the workspace → bot stops, avatar goes to waiting, approval card → approve → ATS confirmation page → reload the browser and the bot still knows what it applied to. | yes, but S1 dropped to 1 |
| 3 | The form changes the night before. What happens? | Stuck detection puts the bot into a blocked state and hands the screen to the human, which is invariant 5 doing double duty. Hard-coded selectors were considered and rejected: they would make it a scraper with a screen attached and collapse G1. The owned ATS instance was considered as a reliable fallback path and dropped — see the rejected-candidates section. | yes |
| 4 | Where is the irreversible moment, and would a real user want approval there? | Pressing submit on a job application. Nobody wants software applying for jobs in their name unsupervised. This is the strongest gate available among the candidates considered. | yes |
| 5 | What does this prove that Surf does not? | Surf is one ephemeral session with one anonymous agent. This needs work that starts without a prompt, an identity and memory that survive a restart, a state of "what I already applied to" so it does not apply twice, an approval gate, and takeover. All five are outside Surf. | yes |
| 6 | Demo or product? | Job hunting is temporary and personal, while every Grok Bot reference job is a recurring business workflow. Resolved by framing: the general shape is watch → prepare → file → stop, which applies to procurement requests, expense filing and permit applications. The write-up must name the generalization out loud rather than leaving the reader to notice. | yes, with a framing obligation |
| 7 | What is the smallest version that still convinces? | Watch → dossier → tailored cover letter → form → approve → submit, with a CV PDF built once at setup and then fixed in the workspace. Cut: per-application CV generation, dossier generation (reused), a UI for managing sources. | yes |
| 8 | One sentence: why this job? | "A coworker that watches a surface nobody will give you an API for, prepares the work, and files it — stopping before the irreversible step. I picked job applications because it is a common inefficiency, and the one where the last 10% is the whole job." | yes |

## Independent verdict

The `job-challenger` subagent returned **0 fatal, 7 serious, 2 notes — proceed with conditions.**

| Finding | Resolution |
| ------- | ---------- |
| G1 may collapse: public apply forms are often unauthenticated HTML forms that a five-line script can post to, file upload included | **Accepted as the sharpest finding.** The main session had reasoned about API keys, not about the form endpoint. Partly mitigated by documentation: Greenhouse's documented submit endpoint requires the employer's API key over HTTP Basic Auth, and its embedded form is described as having built-in spam protection. Still unproven for the live public form. Carried as risk R1 with a day-one test. |
| No ATS vendor named; datacenter-IP blocking and self-serve account access untested | **Dissolved.** With LinkedIn's own apply form as the target there is no vendor to name and no recruiter account to acquire. The datacenter-IP half survives against LinkedIn and is carried as R2. |
| Terms-of-service scrutiny stopped at LinkedIn and never reached the ATS | **Dissolved on the ATS side** — there is no third-party ATS left in the design. LinkedIn's own terms are an accepted, argued exposure — see R3. |
| The filmed run submits to an instance that can be reset, so the approval gate guards a reversible action | **Resolved by removing the cause.** The owned instance was dropped entirely. Every run, filmed or not, submits a real application to a real employer, so the approval gate guards something that genuinely cannot be undone. |
| Invariant 5 may have no natural home, because most public apply forms need no login | **Resolved without depending on the ATS.** The bot opens the author's mailbox to confirm the application landed. That needs a password, which is a genuine takeover moment under any vendor. Account creation with email verification and a CAPTCHA on submit remain as additional natural homes if the chosen target has them. |
| Scope is larger than the real build capacity; nothing cut from the remaining list | Partly accepted. **Its suggested cut was rejected:** replacing the scheduler with a manual trigger would break invariant 2 on the demo path and discard the one capability Surf does not have. A persisted interval is hours of work, not days. Cuts will be taken elsewhere during `/design-spec`. |
| Native file-picker upload is the highest-probability failure and is unprototyped | **Accepted.** Prototyped in isolation on day one, before any other feature work. Drag-and-drop upload is the fallback where the target offers it, because it is more reliable for computer use than a native OS dialog. |
| Note: personal tool versus the business-coworker category Grok Bot demonstrates | Addressed by the framing obligation in challenge question 6. |
| Note: S1 scored too generously | Accepted. S1 recorded as 1. |

## What this job gives each invariant

| # | Invariant | Where it lives in this job |
| - | --------- | -------------------------- |
| 1 | Visible remote computer | The employer's application form is filled in on a real remote browser the user can watch live. |
| 2 | Real work, not simulation | A real posting, a real application form, real tailored documents, a real booking. The only fixture is the seeded invitation, which is input rather than outcome, and it is narrated on video. |
| 3 | One job, finished | Act two finishes: the bot books a real interview slot and a real calendar event exists afterwards. Act one deliberately stops at the user's click, and the write-up argues why. |
| 4 | Approval before irreversible side effects | The booking in act two, which is genuinely irreversible and guarded by the approval card. The submit button in act one is the same gate rendered as the real page, with the user's own click as the approval. |
| 5 | Takeover without secrets in the transcript | Signing in to the mailbox on the sandbox screen, to confirm the application landed and later to read the invitation. The human takes over, types the password and clears any two-factor step, and hands control back. The agent never handles the credential. (The LinkedIn sign-in was the first home; it left with LinkedIn. The startupjobs.cz form needs no login.) |
| 6 | Persistence across sessions | The profile, the CV, the watchlist and the record of what has already been applied to all survive a reload and a restart. Without it the bot applies twice. Act two depends on it: the bot must still know, days later, which application a reply belongs to. The invitation names the act-one company, and the bot records act one as handed to the user, so it links the invitation to that application (see "Decision: the seeded email is a fixture"). |

## Rejected candidates worth mentioning in the write-up

- **Always-awake mail and calendar assistant.** Died on G1. Gmail and Google Calendar have
  first-class APIs, so driving them through a browser is slower, more fragile and purely decorative.
  Worth citing because it is the most obvious-looking idea in this space and the one that fails the
  gate that matters most.
- **Dropping LinkedIn on terms grounds.** Considered seriously and rejected after three rounds of
  argument, because LinkedIn is a primary job-search surface for many people. **Reversed on
  2026-09-11, for different reasons:** its apply flow varies (Easy Apply or a redirect to the
  employer), and a datacenter IP against a logged-in personal account risks a lockout that takes the
  author's own account with it. The terms
  gain is a side effect, not the reason. See "Decision: startupjobs.cz is the demo surface".
- **The sanctioned-only LinkedIn route** — job-alert emails as the source and the data export as
  the CV input, with no automated access. Rejected as the primary path because alert emails only
  surface what LinkedIn chose to send. Retained as a **fallback source skill**, now as a fallback
  for startupjobs.cz as the source (see R4).
- **Czech public administration portals** (Datová schránka, MOJE daně, ČSSZ ePortál). Genuinely no
  API and maximally realistic, rejected because the side effects are real legal filings.
- **An owned ATS instance to apply to** (Zoho Recruit free plan, Recruitee trial). It would have
  let the bot complete a submission harmlessly and so demonstrate invariant 3 inside act one.
  Rejected twice: an approval gate in front of a submission you can reset guards a reversible
  action, and a fake posting risks real job seekers finding it and applying to a job that does not
  exist. Act two carries invariant 3 instead, at lower cost and with no fake vacancy in the world.
- **Self-hosted legacy CRM.** Guaranteed access and no terms risk, rejected because it ships with an
  API, so "no API" would be a rule imposed rather than a fact — a reviewer can call that a costume.

## Decision: one bot, no cooperation between bots

The author left this choice open. **Decided: the POC ships and demonstrates one bot.** The platform
stores bots as configuration, so a roster of several is structurally possible, but no second bot is
built and bots do not hand work to each other.

The job hunt was first described as seven cooperating bots — CV builder, job searcher, cover letter
builder, dossier, email watcher, job applier, interview prep. In Grok Bot's model a **bot is a role,
not a step**: skills are account-level and shared across bots, while memory and routines belong to
one bot (`docs/02-architecture.md`, "Skills and routines"). Their own example of two bots is a legal
bot and a finance bot. Six of the seven are skills or routines of one bot (see the table above).

Reasons for one:

- **Delegate or manage.** Seven teammates for one job is seven things to manage. It is a workflow
  builder that looks like a roster.
- **No isolation to gain.** In Grok Bot all bots share one computer and one set of logins, so
  splitting buys no security boundary.
- **Cooperation is expensive and shows no new invariant.** A hand-off mechanism between bots adds
  moving parts and demonstrates nothing the invariants ask for. Multi-bot chats are already parked.
- **Grok Bot's own lesson.** One bot, one skill, one trigger reads as judgment; a half-working
  builder reads as scope panic (`docs/03-build-story.md`).

**Trade-off, written down.** The roster — Grok Bot's first design law — is not visible with one bot.
It is argued rather than shown. **Upgrade path:** the interview coach is the one genuine second
role (different persona, its own memory), and it is the first item under "What comes after this
POC". If bots are configuration, adding it costs a configuration file, which is itself the proof of
the product claim.

## Decision: users never write skills — the bot does, after a run that worked

The people this product is for know nothing about skills, prompts or how AI works. They must be able
to describe a goal in plain language and have the rest happen. This matches Grok Bot's own position:
"No automations to set up, no product quirks, no intricate naming" (`docs/01-product.md`), and their
choice of the coworker frame "instead of agent configuration" (`docs/03-build-story.md`). Raised by
the author on 2026-09-11.

**The flow:**

1. The user describes the goal in plain language.
2. The bot asks questions until it has Grok Bot's task shape: **outcome, sources, constraints,
   deliverable, review point.** This interview is where most of the quality comes from, and it is
   cheap to build — a prompt built around the task shape.
3. The bot does the job once, visibly.
4. When the run worked, the bot offers to repeat it — *"Want me to do this every morning?"*
5. On yes, the bot writes the skill and the routine itself and saves them.

**Three rules that come with it:**

- **The skill is written after a run that worked, never from the description alone.** A skill
  written from one sentence before anything has run is a guess, and "vague autonomy fails fast" is
  the documented failure of this product category. Grok Bot's ladder puts saving last for the same
  reason: one-time task → make it reliable → save as skill → bind to a routine.
- **Skill writing is a capability of every bot, not a separate bot.** One built-in skill ("turn what
  just worked into a skill and a routine") plus a tool that saves them. A dedicated skill-writer bot
  was considered and rejected: it means two bots to manage and a hand-off between them, which is the
  cooperation already rejected above. Internal subagents are allowed where a task needs them, because
  the user never sees them; generating new *bots* on demand is not.
- **A generated skill can never grant itself permissions.** Approval rules live outside anything the
  bot writes and are changed only by the user. A skill that says "always allow submit" has no effect.
  Fail closed, as invariant 4 requires.

**A deliberate improvement on Grok Bot.** Their memory is a black box — users cannot inspect or
correct it. Generated skills here read as plain sentences ("every morning at 7 I search startupjobs.cz for
backend roles in Prague and send you anything new"). The user never has to write one, but can always
read and correct it.

**Rejected:** the bot writing the skill straight from the description, before any run. It feels more
magical, but the skill is untested until it runs and the demo would depend on generation being right
the first time.

**For the demo:** the opening can start from a blank platform — the user describes the job hunt in a
few sentences, the bot asks its questions, runs once, and saves its own skills and routine. That
shows "configuration, not code" and "no setup" in one sequence. Whether it opens the video is a
`/design-spec` decision.

## Decision: who presses submit

**Act one ends with the user's click, deliberately.** The bot finds a real posting, researches it,
tailors the cover letter, fills the real application form and attaches the real documents. It then
leaves the user in front of the real page with everything ready and does not press submit.

The argument for this is not squeamishness. You would not expect a human assistant to submit
applications in your name unasked, and the product's own framing is "like bringing on a coworker".
Application forms also carry an *I certify this information is true* attestation, and a machine
certifying on a person's behalf is worse than a machine sending an email.

**Bot-submit remains the capability, not the demonstrated default.** Controls follow Grok Bot's
model — Allow once / Deny / Always allow — with require-approval winning whenever an allow rule and
an approval rule both match. The hand-off is one setting of that engine, so the top rung of the
autonomy ladder still exists in the product even though the demo does not climb it for job
applications.

**Where the attestation lands.** In bot-submit mode the approval card shows the certification text
and the filled values, so approving *is* the user's attestation and the bot's click executes a
decision already made. This is the POC's clearest product opinion and it belongs in the write-up.

**A correction from earlier in this session:** the claim that hand-off breaks invariant 6 was wrong.
The bot still starts work with no prompt; it simply does not finish act one. What hand-off actually
costs is invariant 3, and that cost is paid back in act two — see below.

**Revised 2026-09-12: act one now proposes instead of unconditionally stopping.** The apply skill
was changed to call `propose_action` on the send button and act on the answer, exactly the
bot-submit mode this section already named as "the capability, not the demonstrated default". The
reason is invariant 4's only demonstration living in act two, the more fragile act: if a mailbox
challenge or a Calendly problem cuts act two, the approval-card mechanism was never shown gating a
real action anywhere in the demo. On Deny, nothing changes from the behaviour above — the real page
is still there for the user to press by hand. On Allow, the bot's click submits for real, and the
attestation paragraph above stops being a hypothetical. Filmed with Deny on the rehearsal posting;
whether the filmed posting is Allowed is the author's call at filming time, not decided here.

## Decision: act two closes the loop, and carries invariants 3 and 4

Act one is real but stops short by design, so nothing in it completes an irreversible action. Act
two supplies that, on a surface where it costs nobody anything.

1. A seeded email arrives in a **dedicated mailbox created for the POC** — an interview invitation
   carrying a link to a **scheduling page the author owns**.
2. The bot notices it **unprompted**, evaluates it, and proposes the next step.
3. It stops for approval on the proposed slot.
4. On approval it books for real. A real calendar event exists in a real system afterwards.

**What this buys.** Invariant 3 is demonstrated rather than argued — a job finishes. Invariant 4
gets a real mechanism guarding a genuinely irreversible action, instead of a page the user happens
to be looking at. G1 survives, because the chosen scheduling page (Calendly, below) has no API a
candidate can call. This is not true of every scheduling tool — Cal.com has one. And act one keeps
its honest ending.

**Constraint that is not optional.** If act two's action were "send a reply email" instead of a
booking, the visible computer would contribute nothing at that step — the exact G1 failure that
eliminated the first candidate of this session. Booking on a no-API page is what makes the beat
worth building. If a real booking surface cannot be made to work, cut act two entirely rather than
shipping the email-only version.

**Scope.** Act one is built to depth. Act two is one beat, and it is cut only if its booking surface
cannot be made to work — at the cost of invariant 3, which then has to be argued in the write-up instead.

### The scheduling page: Calendly

Decided 2026-09-11. The author picked it as the most widely used tool, so the invitation looks like
the ones real recruiters send.

**Set-up.** The author creates a Calendly account (Free plan) with the author's own development
email address. That account plays the interviewer. Its display name is neutral and never the real
company's name — see "Decision: the seeded email is a fixture". The same address sends the seeded
invitation, which satisfies R5 ("a
real address on a real mail server"). It must be a different address from the bot's dedicated
mailbox, which receives the invitation and is used for nothing else. The interviewer account
connects one calendar, so every booking creates a real event there. Calendly also sends a
calendar invitation to the bot's mailbox, which is the proof that act two finished (invariant 3).

**Checked on 2026-09-11:**

| Check | Result |
| ----- | ------ |
| Booking API a candidate can call (G1) | None. Calendly's booking endpoint, `POST /invitees`, needs the host's OAuth or personal access token and a paid plan. The invitee cannot call it. |
| Free plan | "Always free". One event type and one calendar connection, which is enough for one interview slot type. Custom invitee questions do not appear in the Free plan list. |
| Bot protection | Invisible reCAPTCHA v3 on every booking. A visible challenge appears when a booking is flagged as spam, or after two or three bookings from the same IP within an hour (reported by the community forum, not by official docs). |
| Terms | Calendly's Acceptable Use Policy forbids robots that send more requests than a human could with a normal browser. A human-paced agent making one booking stays inside that. The page belongs to the author, so the author is the customer who agrees to it. |

**Consequences for the build.**

- A reCAPTCHA challenge on a sandbox IP is likely at some point. It is handled as a takeover: the
  human solves it on the screen, and the agent never tries to solve it (invariant 5).
- Rehearsals must be spread out, and test bookings cancelled, so that repeated bookings from one
  IP do not trigger the challenge on the filmed run.
- **R6, first half — passed on 2026-09-11.** The page exists at
  <https://calendly.com/owner-name/30min> (renamed later the same day to
  <https://calendly.com/what-a-fake-company/30min> when the account took its neutral display name,
  and on 2026-09-13 to <https://calendly.com/interviewer-xy/30min> with the host name
  "Interviewer XY", because the bot read the old slug as a placeholder in act two, round 1; the old
  slug returned 404 when checked that day). A browser agent (the in-app browser, from a home
  IP) walked the whole flow without help: a month calendar, pick a day, a list of time buttons,
  pick a time, **Next**, then a form with Name, Email, an optional "Please share anything that
  will help prepare for our meeting" box, and **Schedule Event**. No visible CAPTCHA appeared up
  to that point. **Schedule Event** was not pressed.
- **R6, second half — booking made on 2026-09-11, with the author's permission.** The in-app
  browser filled Name (`Dobot Test`) and Email and pressed **Schedule Event** for Tuesday
  15 September, 14:00–14:30 CET. Calendly showed "You are scheduled!" and "A calendar invitation
  has been sent to your email address". No reCAPTCHA challenge appeared from a home IP.
  The author confirmed both results: the event appeared in the dev calendar, and the calendar
  invitation arrived in the invitee's inbox. The test booking was then cancelled. **R6 passed from
  a home IP.** The same booking from an E2B sandbox IP, where reCAPTCHA may challenge, is checked
  on the first sandbox prototype.
- **Product point for the approval card.** The form says that proceeding means agreeing to
  Calendly's Participant Terms. So pressing **Schedule Event** accepts terms on the user's behalf.
  The approval card must say so, the same way act one's card shows the application's attestation.
- The optional notes box is a natural place for the bot to show memory: it can refer to the
  application it sent days before.

**Rejected: Cal.com.** Its documented `POST /v2/bookings` endpoint marks authentication as
optional. Anyone can book a public Cal.com page with one API call and no key, so the remote
computer would be a costume there. This is worth one line in the write-up: the scheduling tool was
chosen by the G1 test, not by habit.

**Not chosen: Google Calendar appointment schedules.** It has no public booking API, so it would
pass G1. Calendly won on realism. Google's booking page is the fallback if Calendly's reCAPTCHA
blocks the sandbox too often. Its free-plan limits were not checked.

**Decision 2026-09-16, evening: Cal.com replaces Calendly as the booking surface.** Calendly's
spam filter now refuses every booking from the bot's computer — "This booking cannot be completed.
For security reasons, we are not able to finalize this booking from your current session" — for the
bot, for the author by hand on the same computer, and from an incognito window; the codes and the
timeline are in "Act two, round 4" at the end of `docs/plans/2026-09-11-platform-plan.md`. The
address is a datacenter address shared with other sandboxes, the filter counts bookings per address,
and round 3's reCAPTCHA five hours earlier was the same filter in its softer form. The
"Consequences for the build" above (spread the rehearsals out) were followed and were not enough,
and a filmed path that depends on a filter resetting overnight is not a filmed path. Cal.com's
hosted booking page keeps the whole beat unchanged: the same interviewer account (the development
Google account), the same connected Google calendar, so a booking still creates a real event and
the calendar invitation still reaches the bot's mailbox; only the bot's skill text changes (a
searchable time-zone picker where "Prague" is found, a day and then a time, a form with "Your name"
and "Email address", a **Confirm** button instead of **Schedule Event**) and the fixture mail
carries the new link. **Trade-off, accepted:** Cal.com has a public booking API, which the G1 check
above counted against it. The bot never touches an API — it is configured in plain language and
works the screen the user watches, which is the product's approach and not a proof that no script
could do one task — so the demo shows the same thing on either page; a reviewer who holds the
stricter reading of G1 finds it named here. **Fallbacks, in order:** a self-hosted Cal.com if the
hosted page also refuses the computer's address; and if that fails too, act two is cut under the
"Constraint that is not optional" above, with invariant 3 argued in the write-up on rounds 1–3's
three real bookings. **The lesson for the write-up:** a bot's computer on a shared datacenter
address meets anti-abuse filters on any consumer service with an irreversible action; the upgrade
path is a dedicated outgoing address per bot.

## Decision: the seeded email is a fixture; it names the act-one company, with a visibly mock sender

*Revised 2026-09-11. The first version made the company fictional; see "Revised by the author"
below. The paragraphs up to there are the original reasoning, kept for the write-up.*

The author is not applying to real jobs during the build, so no employer will reply. The invitation
is seeded by the author.

**Why this is not simulation.** The email is *input*, not outcome — the same way demoing a ticket
bot needs a ticket. The agent really receives a real message in a real mailbox, really reads it,
really books a real slot. Invariant 2 bans a mocked *outcome* on the demo path, and there is none.

**The company in the seeded email is deliberately fictional and deliberately does not match the
company applied to.** This was the author's call and it is the right one. Seeding a message that
appears to come from a real, named company means fabricating a communication attributed to a real
organisation, and then showing it in a video. That is a larger problem than a visible seam. An
earlier objection in this session — that the mismatch weakens the story — was the weaker argument
and is overruled here.

**Considered and rejected:** generating the seeded email on the fly from the real application page,
so that it matches. It would remove the seam by reintroducing exactly the problem above.

**Revised by the author on 2026-09-11 — superseded in part.** The author asked why the company from
act one cannot appear in the email, since the bot captures it anyway. Four objections were raised:

1. A Calendly page carrying the real company's name is a live, public impersonation, which
   Calendly's Acceptable Use Policy forbids ("impersonating any person or entity", "falsely
   stat[ing] … your affiliation with a person, organization or entity").
2. A real company's name sent from an unrelated address is a phishing pattern, and a coworker
   trusted with a mailbox must flag it.
3. Act one never submits, so the bot's memory holds no sent application. **This objection was
   overstated:** the bot records act one as handed to the user, and it cannot know whether the user
   pressed submit. An invitation is then a plausible reply, and the bot can say so.
4. The audience is small and connected; a clip can travel without its narration.

The author answered 1 by keeping the booking page neutral, and 4 by making the sender visibly mock.
What remains, 2, is a product point rather than an ethics point, and it is turned into a feature
below.

**The rule now:**

- **The company is real; the hiring process is not.** The act-one company must be a real company,
  because the dossier researches it and every step before the invitation is real work on it
  (invariant 2). Only the interview invitation is mock. Stated by the author on 2026-09-11 as a
  fixed constraint for the design.
- **The email body names the real company from act one** as the hiring company, and mirrors the
  role title, the dates and the tone. The hiring itself is
  public — the posting exists.
- **The sender is visibly mock:** an interviewer named like "Interviewer XY", sent from the
  author's development address. No real person's name, no logo, no branding, no domain of the real
  company.
- **The Calendly page carries a neutral name**, never the real company's. The author owns this
  choice.
- **The bot checks the sender.** The address is not on the company's domain, so the bot flags it
  on the approval card ("sender not verified — not an @company address") and the user approves
  anyway. This puts the mock on screen inside the product, and it shows the judgement a trusted
  coworker needs. Whether the check is a platform rule or part of the skill is a `/design-spec`
  question.

**The only false statement** is the invitation itself. It is marked as mock by the sender's name,
flagged by the bot, and narrated in the video.

**The fixture as sent.** The author sends it as plain text from the development address, sender
name "Interviewer XY", to the bot's mailbox. This is the text given for act two, round 1
(2026-09-12); on 2026-09-13 only the page address changed, to the renamed Calendly page, and on
2026-09-17 to the Cal.com page under the same host name, after the decision of 2026-09-16 below:

```text
Subject: Pozvánka na pohovor – Senior Node.js Developer (Company A)

Dobrý den, pane Nováku,

děkujeme za Váš zájem o pozici Senior Node.js Developer v týmu Company A. Váš průvodní dopis nás zaujal.

Rádi bychom Vás pozvali na úvodní 30minutový online pohovor. Termín si prosím vyberte zde:
https://cal.com/interviewer-xy/30min

Těšíme se na setkání.

Interviewer XY
```

**What would remove even that:** a real sender — a real reply to a real application, or a company
that knowingly agrees to send the invitation. If a genuine invitation arrives before the build
freeze, act two uses it instead of the fixture.

**Obligations that come with this.**

- The seam is narrated at the moment it appears in the video, never hidden.
- The mailbox is created for the POC and used for nothing else.
- Never borrow the real company's branding, domain, logo or employees' names. Its name appears
  only in the email body.
- The author will not be a real candidate at the filmed company (confirmed 2026-09-11), so the
  mock invitation never sits inside a real hiring process. The filmed run therefore ends at the
  hand-off, and the author does not press submit on that application.

## Decision: sources are configurable

The watch reads a **list of sources**, not one hardwired portal. A job-hunt coworker tied to a single
job board is a script.

**Revised on 2026-09-11: sources are skills, not code adapters.** The first version of this decision
said "two adapters behind one interface". Adapters are code, and job sources are specific to the job
hunt, so that would have put the use case into the platform. Under the code-or-skill rule above,
each source is a skill — "search startupjobs.cz with these filters", "read job-alert emails from
the mailbox" — and the only code is the generic tools they use (the computer, the mailbox). Adding a
source means the bot writing one more skill, not a developer writing one more adapter.

**Explicitly cut:** a user interface for adding and managing sources. That is workflow-builder
scope, it does not appear in the demo, and the delegate-or-manage filter rejects it.

## Decision: startupjobs.cz is the demo surface, LinkedIn is dropped

Decided 2026-09-11, after R1.

**Why the change.** The author found LinkedIn's apply flow unpredictable: sometimes Easy Apply,
sometimes a redirect to the employer's own page. startupjobs.cz, a Czech job board, uses one
application form for every posting. Predictability buys a reliable filmed run and fewer live-run cycles, and
this is a proof of concept, not a full product build.

**What R1 found on startupjobs.cz** (inspected 2026-09-11 on posting 100004, nothing submitted):

| Check | Result |
| ----- | ------ |
| Login needed to apply | No. The terms say job seekers may apply without registering. |
| Form fields | Name, LinkedIn URL (optional), email, phone, cover letter (rich text), one file upload, submit button "Odeslat zájem". |
| CAPTCHA | None found. No CAPTCHA library in the 212 JavaScript files the page loads. |
| How the page submits | The site's own frontend calls `POST /api/offers/{offer}/candidates/guest` with a JSON body. The endpoint is private and undocumented; no public API docs exist (`/api/docs` returns 404). |
| Not verified | Whether that endpoint accepts a request from outside the browser, and how the file travels with it. No request was sent. |
| Terms for job seekers (`/vop`, B2C part) | No rule against bots, scripts or scraping. |
| `robots.txt` | Allows everything except `/admin/` and `/superadmin/`. |

**Verdict: on this site alone, G1 fails.** A script could apply through the guest endpoint, and a
Playwright script with fixed selectors could fill in the form without any reverse engineering. The
same property the author wanted — the form never changes — is what makes a script good enough.

**Why the remote computer still earns its place.** G1 holds at the level of the product, not the
site. A job seeker's applications go to many different forms: job boards, LinkedIn, employers'
own career pages. A script needs one adapter per site. This bot needs none. The remote computer
also gives what no script gives: the user watches the real page (invariant 1), can take over
(invariant 5), and approves on the real submit button (invariant 4).

**Two hard rules that make the claim checkable rather than argued.** They bind `/design-spec`,
`/plan` and code review.

1. **No site-specific code in the repository.** No startupjobs.cz selectors, URLs, field names or
   API calls. A reviewer can confirm this with one `grep`. Anything the bot knows about the site
   lives in a skill the bot wrote.
2. **The bot meets the form for the first time on camera.** It works out the form, fills it in,
   and after a run that worked it writes its own skill — the flow already decided in "Decision:
   users never write skills". The guest endpoint is never called.

**Trade-off, written down.** The demo shows one predictable site. Nothing in the code is specific
to it, so other sites are expected to work, but they are **untested**. The honest statement is
"generality is designed but not proven", not "it will break on other sites": a product that is
known to break on other sites would be a script, and G1 would fail by our own admission. On other
sites, forms with several steps, a login or a CAPTCHA will hit stuck detection and takeover more
often. **When it starts to matter:** the first real user whose jobs are on a second site.
**Upgrade path:** a second apply surface, then a small evaluation set of real sites with a success
rate per site.

**What leaves with LinkedIn.** R2 (datacenter IP, account restriction) and R3 (LinkedIn's terms)
no longer apply, because nothing in the demo or the repository automates LinkedIn. The CV is
still built once from the author's own LinkedIn data export, which is a manual download and not
automation. Invariant 5's home moves to the mailbox sign-in. LinkedIn as a source moves to "What
comes after this POC".

**Rejected 2026-09-11, reconsidered 2026-09-12:** option B, a second apply surface inside the build.
The reason first given was time, which is not a reason. The position now: it is the one thing that
turns "generality is designed" into evidence, so it is worth one rehearsal — after act one and act
two have each run clean, after the second site's final control has been inspected by eye so the
known gate gap cannot send an application, and with every rule requiring approval so the worst case
is "blocked". A rehearsal nobody filmed is evidence to the author, not to the grader: if it works,
film the clip.

## Risks carried into the build

**R1 — run on 2026-09-11. Result: the apply surface is scriptable, and the design answers it
with two hard rules rather than with a different site.**

| # | Risk | The check | Result |
| - | ---- | --------- | ------ |
| R1 | The apply form is postable by a plain script, so G1 collapses and the remote computer is decoration | First written for LinkedIn Easy Apply: replay the submit from a script. Not run on LinkedIn — the apply surface moved to startupjobs.cz first. Run there by inspection only, with nothing submitted. | Postable: a no-login guest endpoint and no CAPTCHA. G1 fails for one site and holds for the product. Answered by the "no site-specific code" and "first visit on camera" rules. See "Decision: startupjobs.cz is the demo surface". |

**Why inspection, not replay.** A replay made with copied session cookies works on almost any site
and proves nothing about G1. On LinkedIn it would also have been reverse engineering (User
Agreement 8.2, Don't #9) on the author's real account. On startupjobs.cz, reading the page's own
public JavaScript was enough to answer the question.

**R2 — datacenter IP and account restriction. Dissolved on 2026-09-11.** It applied only to
LinkedIn. startupjobs.cz needs no login, so there is no account to restrict. A datacenter-IP block
on startupjobs.cz is still possible and is checked on the first E2B run, not as a separate gate.

**R3 — LinkedIn's terms. Retired on 2026-09-11,** because nothing in the demo or the repository
automates LinkedIn any more. The original reasoning is kept below, because it returns if LinkedIn
comes back as a source after this POC.

LinkedIn's User Agreement section 8.2 forbids
this. Don't #13: *"Use bots or other unauthorized automated methods to access the Services…"*.
Don't #2: *"Develop, support or use software, devices, scripts, robots or any other means or
processes … to scrape or copy the Services"* — which covers the code in this repository, not only
the running agent. This was raised three times and overruled deliberately, for these reasons:

- LinkedIn is a primary job-search surface for many people. A coworker that ignores it is not the
  product.
- The tool is personal, not commercial. It helps one person through their own job search; it does
  not extract value from other members. Automating commercial lead hunting for profit is a
  different act and is not what is being built.
- The alternative — months of ghosting, repetition and rejection — is a real cost borne by real
  people, and reducing it is a legitimate purpose.

**Limits accepted with it, and they are part of the decision:** the agent reads only the author's
own search results and own profile, never other members' data or connections; the login is done by
the human via takeover, so the agent never handles the credential; pacing is human-speed with a hard
step budget and no bulk enumeration. The write-up states the clause, the decision and these limits
openly. Not noticing would be worse than deciding.

**R4 — concentration risk, moved from LinkedIn to startupjobs.cz.** startupjobs.cz is now the
source and the apply surface for act one. A site redesign or a block before filming takes act
one with it, and act two alone is not the product. The fallback is the product claim itself: point
the same bot at another job board or an employer's own careers page. If the "no site-specific code"
rule holds, that costs a new skill, not new code. The job-alert-email source skill remains a
second fallback for the source side.

**R5 — the demo has two visible seams and both must be narrated, not hidden.** First, act one stops
at the user's click, so no application is actually sent. Second, the interview invitation is seeded
by the author: it names the act-one company but comes from a visibly mock interviewer, not from
that company. Both are honest choices with reasons, and both are stated on video at the moment they
appear. A viewer who spots either one unannounced will discount everything around it. The second
seam is also shown inside the product: the bot flags the sender as unverified on the approval card.
It is sent from a real address on a real mail server, so nothing about the message is fake except
who decided to send it.

**R6 — act two is the only place invariant 3 is demonstrated.** If the booking beat is cut for time,
nothing in the demo completes an irreversible action and invariant 3 becomes an argument in the
write-up rather than something on screen. Treat act two as load-bearing for the grading, not as a
nice ending, and protect its build time accordingly.

**Carried beyond the gate:**

- Native file-picker upload under computer use. Prototyped day one, in isolation. Drag-and-drop is
  the fallback.
- The watching phase is invisible on screen (S1 = 1). Consider an on-screen ticker so the
  always-awake claim has something to show.
- Act two must be cut whole rather than shipped with an email-only action, which would collapse
  G1 — but see R6: cutting it costs invariant 3 its only demonstration.
- The scheduling page for act two (Calendly) must exist and be automatable by a browser agent.
  Check it early, including from an E2B sandbox IP because of reCAPTCHA.
- Two round trips per opening (dossier, then apply) may be one thing too many to manage. Open for
  `/design-spec`.
- Scope is larger than the demo needs. Cuts to be taken on what each part proves, in
  `/design-spec`, not by weakening the scheduler.
- The framing obligation: the write-up must name the general pattern and explain why a personal
  instance was chosen to demonstrate a business-coworker shape.

## Open questions for `/design-spec`

Collected from across this record so the next session does not have to hunt for them.

| # | Question | Where it came from |
| - | -------- | ------------------ |
| 1 | Ask twice per opening (offer the dossier, then offer to apply), or put the dossier in the first notification so there is one decision? | Grok Bot's delegate-or-manage filter; "Decision: act two" |
| 2 | Keep the dossier stretch on screen, or compress it into a chat card? It is the least watchable part and the reason S1 is 1. | Challenge log, question 2 |
| 3 | Show the always-awake watch with an on-screen ticker of sources being checked? | S1 note under "Candidates considered" |
| 4 | Skill and routine file format, and the exact interview questions the bot asks to reach the task shape. | "Decision: users never write skills" |
| 5 | Does the video open on a blank platform where the bot writes its own skills? | "Decision: users never write skills" |
| 6 | ~~Which scheduling page act two books on~~ — decided: Calendly. Still open: can a browser agent drive it from a sandbox IP? It is load-bearing for invariant 3. | R6; "The scheduling page: Calendly" |
| 7 | The stack. Nothing in this record assumes one. | the private backlog, section 0 |
| 8 | How the "no site-specific code" rule is enforced — a review checklist line, a `grep` in pre-flight, or both? | "Decision: startupjobs.cz is the demo surface" |
| 9 | Which posting the filmed run uses. It must be a real company (the dossier needs it). The author will not be a real candidate there, so the filmed run ends at the hand-off and nothing is submitted. Any run the author does approve sends a real application, so only approve postings the author really wants. | "Decision: startupjobs.cz is the demo surface" |
| 10 | **Sender check and hand-off state for act two.** Decided on 2026-09-11: the email names the act-one company, the sender is a visibly mock interviewer, and the Calendly page is neutral (author's choice of name). Still open: (a) is "sender not on the company's domain" a platform rule or part of the skill, and how does the approval card show it? (b) What does the bot record at the end of act one — "handed to the user" — and how does it word its link between the invitation and that application without claiming the application was sent? (c) Earlier options (the author's own business, rejected because the bot would recognise its own user and ARES lists two people with the author's name; an invented company, rejected because natural-sounding names collided with real ones) are superseded. | "Decision: the seeded email is a fixture"; R5 |

## What comes after this POC

Material for the graded "what I would build next" deliverable. Not scope. Each item says why it
follows from what was built, so the list reads as reasoning rather than a feature wish-list.

**Act three: interview preparation.** A mock-interview skill with drill sets, memory cards and
company primers, run against the role the bot already applied to. It completes the lifecycle —
apply, handle the reply, prepare — and that is the strongest answer to "is this a demo or a
product", because a coworker who carries a person through all three stages is not a script.

It also makes persistence load-bearing rather than decorative. The prep only works if the bot still
knows which company, which role, what the cover letter claimed and what the user fumbled in the
last drill. Invariant 6 stops being a page-reload trick and becomes the reason the feature works.

**Framing correction that must be stated with it.** Mock interviews and flashcards need no
computer: no remote screen, no irreversible action, no approval gate. Presented as the natural next
step of *this* pattern, it would read as abandoning the product's core premise. It is a **new skill
for the same bot**, which is exactly right in Grok Bot's own vocabulary — Bots, Chats, Prompts,
Tools, Artifacts. A saved prompt producing artifacts. Not every skill uses the computer-use tool.

**Optional upgrade that keeps the premise.** Run the drill inside the real interview platform the
recruiter sent, so the user rehearses against the actual interface, camera and screen-share
included. That needs the visible computer and no chat product can do it.

**Reuse to name in the write-up.** The `learning-tools` skill already covers spaced repetition,
quizzes and study guides with cognitive-science grounding. Cite it as a reused component rather
than rebuilding it.

**Others worth one line each in the write-up.** A second apply surface (an employer's own careers
page, or LinkedIn Easy Apply), which is what proves the watch-prepare-file-stop shape is not a
startupjobs.cz script. LinkedIn as a source, with the terms reasoning kept under R3 and the account
risk kept under R2. Bot-submit with Always allow,
once trust is earned. Application tracking across weeks — what was sent, what was ghosted, what
needs a follow-up — which is the part of a real job hunt this POC does not touch at all.

## Sources

- Greenhouse Job Board API, "Submit an application" — the documented endpoint requires the
  employer's API key over HTTP Basic Auth, and the embedded form is described as having built-in
  spam protection. <https://github.com/grnhse/greenhouse-api-docs/blob/master/source/includes/job-board/_applications.md>
- Zoho Recruit pricing and a free-ATS overview covering Recruitee — consulted for the owned-instance
  option that was ultimately rejected. <https://www.zoho.com/recruit/pricing.html> ·
  <https://softwarefinder.com/resources/best-free-applicant-tracking-system-for-employers>
- LinkedIn User Agreement, section 8.2 "Don'ts" #2 and #13 — prohibits software, scripts and bots
  that access or copy the Services, including developing or supporting them.
  <https://www.linkedin.com/legal/user-agreement>
- startupjobs.cz terms (Obchodní podmínky, B2C part for job seekers) — allow applying without
  registration and contain no rule against automated access. Read 2026-09-11.
  <https://www.startupjobs.cz/vop> · <https://www.startupjobs.cz/robots.txt>
- Cal.com API v2, "Create a booking" — `Authorization` header marked `required: false`.
  <https://cal.com/docs/api-reference/v2/bookings/create-a-booking>
- Calendly, "Schedule events with AI agents" — `POST /invitees` needs the host's OAuth app or
  personal access token, and a paid plan. <https://developer.calendly.com/schedule-events-with-ai-agents>
- Calendly pricing, Free plan ("Always free", one event type, one calendar connection).
  <https://calendly.com/pricing>
- Calendly Acceptable Use Policy — robots limited to what a human could send with a normal
  browser. <https://calendly.com/legal/acceptable-use-policy>
- Calendly community, reCAPTCHA on booking pages (forum source, not official docs).
  <https://community.calendly.com/how-do-i-40/endless-recaptcha-for-block-bookings-4154>
- Google Calendar Help, "Verify emails for appointments" — email verification is optional, off by
  default, and needs an eligible Workspace plan. <https://support.google.com/calendar/answer/11902347>
- startupjobs.cz posting used for the R1 inspection (2026-09-11).
  <https://www.startupjobs.cz/nabidka/100004/example-posting-d>
