# Duplicate-Invitation Fix Implementation Plan

**Live verification status, 2026-09-17:** Steps A and B passed earlier in round 4. Step C passed
at 15:55 Prague after the thinking-continuity repair and API credit restoration. The same five
saved mails produced two cancellation writes, one proposal for the new invitation, Deny and
`done`; the final reply correctly accounts for the old invitation and cancelled confirmation.
Evidence: `docs/evidence/2026-09-17-thinking-replay-funded/README.md`. Reschedule variants remain
unverified. This result proves the recorded case once, not general batch reliability.

**Goal:** After a booking, the run that the confirmation mail starts ends with one sentence and no card; a mail about a booking already in memory is reported and remembered, never re-booked on the bot's own initiative; and every other new mail in the same run is still handled.
**Approach:** Two text changes, one platform-wide and one in the bot's own skill. The prompt's doubt rule gets the exit it lacks: when memory shows this exact work is done, the bot says so in one sentence, records what changed before it proposes anything, and goes on with the rest of the job — it never stops early, never asks, and never blocks a repeat the user asked for. The mail skill says what "already handled" looks like for this job and how to tell two invitations apart: a confirmation matches a booking by its slot; an invitation matches by its subject and received time, which the booking note now records, and once acted on it stays handled for good — a cancellation or a change updates the booking's state in memory and never makes the invitation new again, and a confirmation is reported by that latest state, "confirmed", "cancelled" or "moved"; only a distinct invitation or a request from the user starts new booking work; an uncertain match is open work and goes to the card with a warning. No code path changes; the proof is live runs.
**Design spec:** N/A — the finding and the owner's decisions are in `docs/plans/2026-09-11-platform-plan.md`, "Act two, round 3" and "The follow-up run — the criterion passed, and it exposed a defect" (2026-09-16), and in the session of 2026-09-16: fix approach (short plan first), live proof (a cancellation run and one full cycle), and the owner's three reviews of the drafts (seven findings, below).
**TODO items:** section 2, "The demo path" — "Fix the duplicate-invitation defect, found in act two, round 3 (2026-09-16)".
**Branch:** `main`, direct commits, one per task.
**Scope:** `src/server/agent/prompt.ts` and its test; `examples/job-hunt-bot/skills/handle-replies.md` (a new paragraph, the card summary's format and the booking note's format) and the live bot's copy under `data/`; `README.md` step 6; the private backlog; this plan's status; the round-4 record in `docs/plans/2026-09-11-platform-plan.md`.
**Build estimate:** Claude: about an hour and a half of edits, tests and records. The owner: about 30 minutes at the keyboard — the inbox cleanup, two fixture mails, one Allow, possibly one reCAPTCHA, two cancellations, two mails marked unread, two Deny presses, one typed goal. Live runs before the change is believed: four (the booking, its confirmation run, the typed request, the five-mail run at boot), about $1.00–1.50 at round-3 prices.

## What round 3 showed, in one paragraph

At 14:44:16 UTC the booking run ended "You are scheduled!" and wrote memory line 12: "Booked on 2026-09-16: interview with "Interviewer XY" … on Thu 2026-09-17 09:30-10:00 CET, from the invitation received 2026-09-16". At 14:45:16 the calendar invitation reached the mailbox — subject "Pozvánka: Test Owner and Interviewer XY - čt 17. zář 2026 9:30AM - 10AM (SELČ)", body "Event Name / 30 Minute Interview", a Cancel and a Reschedule link on calendly.com, "Powered by Calendly.com" — and the watcher started `check-mail`. The bot read that mail and the still-unread fixture invitation as "another interview-invitation email … with its own fresh Calendly link", went back to the booking page, picked the next free slot (10:00–10:30, the 09:30 one now taken by its own booking), filled the form and proposed it. Its fourth warning: "Recommend confirming with the user whether this is meant to replace the earlier Sept 17 09:30 booking or is a duplicate/test before proceeding, but per the skill's doubt rule I am still presenting this slot for your decision." Denied; 39 steps, $0.558. Memory held the answer the whole time; nothing told the model that a match means stop.

## What the author's review of the first draft changed

The owner's review (2026-09-16) found three defects in the first draft's rule texts. Each is met in the texts below, and each has a live check in Task 4.

1. **"Stop" ended the mail run too early.** The first draft said to stop when one message matched a completed booking. A new invitation later in the same batch would have gone unhandled, and the watcher never comes back for it: it takes no reading while a run is going and fires only when the mailbox's next message number moves (`src/server/mail/watcher.ts`, the class comment), so unread mail the bot skipped starts no second run. Now a handled message is skipped and the rest of the new mail is read; the one-sentence ending comes only when nothing else needs action. Checked in Task 4, Step C: two cancellations and a new invitation in one run.
2. **The match could not tell a new invitation from the old one.** "Same company or interviewer, received today" fits two different mails on the same day — the rehearsal itself resends the fixture that day — and `remember` only appends (`src/server/agent/tools.ts` has `remember` and no tool that removes a line), so the old "Booked on" line stays next to a later cancellation. Now the booking note records the invitation's subject and received date and time; an invitation counts as already acted on only when a "Booked on" line names that same subject and time; a confirmation matches a booking by its slot; a cancellation or change line names the slot it applies to, and the rule says the latest line about a slot wins. An uncertain match — a line without those details — is treated as open work, and what memory shows goes on the card as a warning: a card the user can deny is safer than a silent "already handled". Checked in Task 4, Step A (line 12 has no received time, so the resent fixture must reach a card, with the earlier booking as a warning) and Step C (a new invitation after the cancellations proposes; the cancelled slots do not).
3. **The platform rule could block an explicit request.** "Memory shows the job is done — do not propose it again" applied to typed goals too, so "book me another slot" could have been refused. Now the exit is limited to work the bot would repeat on its own, from a mail or a scheduled run; a repeat or a change the user asks for is a new job, done as asked and through the usual approval. Checked in Task 4, Step B: a typed request for one more slot while a booking is in memory must reach a card.

The owner's second review (2026-09-16, of the rewrite) found three more, also met below.

4. **A cancellation made the original invitation actionable again.** The rewrite excluded an acted-on invitation from the exit only "with nothing later in memory cancelling or changing that booking", and said a cancelled or changed booking "is open again". After a cancellation the still-unread original invitation would have booked again, and a rescheduled booking — which still exists at its new time — would have done the same. Now an invitation once acted on stays handled for good; a cancellation or a change updates the booking's state in memory, and never makes the mail it came from new again. Only a distinct invitation or a request from the user starts new booking work. Checked in Task 4, Step C: after the cancellation, the original invitation is marked unread and read again, and must produce no card.
5. **Step C needed an order the skill did not specify.** The skill let the bot act on each message as it read it, so a new invitation read first would have produced a card, and Deny ends the run before any cancellation is recorded. Now the skill says: read all the new mail first, record every booking update with `remember`, and only then act on what is still open; the prompt says to write what changed, if anything did, before proposing anything else. And the check on Step C's card is whether it belongs to the new invitation — the card summary now names the invitation it acts on — not which slot it picks: a slot freed by a cancellation may be booked like any other. Checked in Task 4, Step C: the `remember` results precede the card in the run log.
6. **One card is two approval events.** `propose_action` emits `pending` and then `allowed` or `denied` with the same `approvalId` (`src/server/agent/tools.ts`, the `emit` after the card is posted; round 3's log shows both pairs). The criteria said "exactly one approval event". Now they ask for one unique `approvalId` with one `pending` and one decision event; zero events stays the criterion for a confirmation-only run.

The owner's third review (2026-09-16) found one more, met below.

7. **The confirmation rule ignored later booking updates.** A confirmation matched only a "Booked on" slot and always reported "confirmed": an old confirmation read after a cancellation would have called a cancelled booking confirmed, and the confirmation of a rescheduled slot — which matches no "Booked on" line even when a "Changed on" line records the new time — would have looked like a new invitation and produced a proposal. Now a confirmation matches any slot memory knows — a "Booked on" slot or the new slot of a "Changed on" line, including one written earlier in the same run — never leads to a proposal, and is reported by the booking's latest state, including a cancellation or change recorded earlier in the same run (the system prompt's memory section is built once per run, `src/server/agent/run.ts`, so a same-run write is known only from the conversation): confirmed, cancelled on a date, or moved to a new slot. The report sentences name the mail by its received time, as the card summary does, so each sentence in `chat.jsonl` can be tied to its mail. Checked in Task 4, Step C: the old confirmation is marked unread and read again after the cancellation, and must report the booking as cancelled with no card. The reschedule case stays explicitly unverified until it is exercised live.

## Why two places

The doubt rule lives in the prompt because round 2 showed a skill sentence alone does not hold (the bot asked in chat against its skill; fix 4 then went into the prompt for every skill). Its exit belongs there for the same reason, and it must stay site-neutral: `scripts/preflight.sh` greps `src/` for site names. What a confirmation, a duplicate or a cancellation looks like for *this* job — a calendar invitation with Calendly links, the "Booked on" memory line — is site knowledge, and site knowledge lives in `examples/job-hunt-bot/`, never in `src/` (CLAUDE.md, Repo layout). The live bot's skill is kept identical to the fixture, as after rounds 1 and 2.

**What this gives up.** A rule keyed on memory refuses only what memory identifies with certainty; every uncertain case costs a card, not silence. A cancellation ends in a report and a memory line, never in a new booking on the bot's own initiative; the user sends a goal if they want one, and a company that cancels and wants a new slot sends a new invitation. The sender doubt is untouched: a personal address still proposes with a warning. Old booking notes written before this change (round 3's line 12) carry no subject or received time, so they can only ever produce a card with a warning, never a silent skip — the rehearsal uses exactly that. Two cases are covered by the same sentences but not run live: the pair "a confirmation plus a new invitation in one run", which needs the server stopped inside the minute between a booking and its confirmation and would replace the filmed-timing run that the TODO item names as the belief criterion; and a reschedule by the host ("Changed on …"), which the "stays handled for good" sentence and the confirmation-by-latest-state sentence cover the same way as a cancellation — including the confirmation of the new slot, which must produce no proposal. Both are written down in Task 4 as variants for a later session, and the reschedule case is explicitly unverified until then.

## Research (source links)

- No new library, service or API. The changes are prompt text (`src/server/agent/prompt.ts`) and skill text (`examples/job-hunt-bot/skills/handle-replies.md`); the model is called exactly as before.
- The mail trigger, which makes the confirmation run part of the filmed path and makes finding 1 matter: `src/server/mail/watcher.ts`, the `MailWatcher` class comment — no reading while a run is going; a moved next-message number counts as new mail even when the unseen count did not rise. Seen live at 14:45:16 UTC: `new mail, unseen: 2, previous: 2`, then `routine fired: check-mail`.
- Memory is append-only: `src/server/agent/tools.ts` defines `remember` and no tool that edits or removes a line; the prompt tells the model "Memory notes survive restarts". Hence "the latest line about the same thing tells its current state" is a rule for the reader, not a mechanism.
- The booking note the rule keys on is the one the skill dictates; Task 2 extends it with the subject and the received date and time. Round 3's line 12 has the old shape.

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Modify | `src/server/agent/prompt.ts` | `DOUBT_RULE` gets the "already done" exit: one sentence, record changes before proposing, go on with the job, a cancelled booking never reopens its mail, uncertain means open, an explicit request is a new job |
| Modify | `src/server/agent/prompt.test.ts` | The existing doubt-rule test pins the new sentences too |
| Modify | `examples/job-hunt-bot/skills/handle-replies.md` | A paragraph on reading all mail first, what "already handled" means, confirmations reported by the booking's latest state, and how to tell invitations apart; the "looks like a reply" and several-invitations sentences reconciled; the card summary names the invitation; the booking note records subject and received time |
| Copy | `data/bots/job-hunt-bot/skills/handle-replies.md` | The live bot's copy, kept identical to the fixture (git-ignored; a command, not a commit) |
| Modify | `README.md` | Step 6 of "What you see": the confirmation mail starts one more run, which reports and goes on |
| Modify | the private backlog, `docs/plans/2026-09-11-platform-plan.md`, this plan | Tick the item; the round-4 record; the status banner |

## Tasks

### Task 1: The doubt rule gets its exit [mechanical] [demo-path]

**Files:** Modify `src/server/agent/prompt.ts`; Test `src/server/agent/prompt.test.ts`.
**Invariant:** 4 — the user decides on the card, and only work that is still open reaches a card; work memory records as done is reported, not proposed again on the bot's own initiative, and a request from the user is still a job that goes through approval. Proven by the pinned sentences (nothing in code enforces them, as with the rule itself) and by the live runs of Task 4.
**Demo step:** spec Demo path row 14 — "The bot's chat shows the confirmation and a memory line linking it to the application". Round 3 showed a row the spec did not list: the confirmation mail starts one more run about a minute later. This task makes that run end in the sentence row 14 describes instead of a second card.
**Verify:** `pnpm exec vitest run src/server/agent/prompt.test.ts && pnpm typecheck`

- [ ] In `src/server/agent/prompt.test.ts`, replace the test `'says that a doubt is a warning on the card, never a reason to stop or to ask first'` with:

```ts
  // Act two, round 2 (2026-09-13): three signs of a fake at once made the model ask in chat instead
  // of proposing, against its skill. The rule now stands in the prompt for every skill.
  // Round 3 (2026-09-16): the same rule made the model propose a second booking it suspected was a
  // duplicate, "per the skill's doubt rule". The rule now has the exit it lacked — work memory
  // shows as done is reported, not proposed again — without ending the job early, with changes
  // recorded before any proposal, without a cancellation reopening the mail it came from, without
  // blocking a repeat the user asks for, and with an uncertain match treated as open work.
  it('says that a doubt is a warning on the card, and that work memory shows as done is reported, not proposed', () => {
    const prompt = buildSystemPrompt({ bot, memory: '', skills: [search], activeSkill: null })
    expect(prompt).toContain(DOUBT_RULE)
    expect(DOUBT_RULE).toContain('never a reason to stop or to ask first')
    expect(DOUBT_RULE).toContain('the user decides on the card')
    expect(DOUBT_RULE).toContain('do not propose it again on your own')
    expect(DOUBT_RULE).toContain('if something changed, write it with remember before you propose anything else')
    expect(DOUBT_RULE).toContain('go on with the rest of the job')
    expect(DOUBT_RULE).toContain('does not make the mail it came from new again')
    expect(DOUBT_RULE).toContain('treat the work as open and put what memory shows on the card as a warning')
    expect(DOUBT_RULE).toContain('when the user asks for a repeat or a change, that is a new job')
  })
```

- [ ] Run `pnpm exec vitest run src/server/agent/prompt.test.ts`; it fails on the six new `toContain` lines.
- [ ] In `src/server/agent/prompt.ts`, replace the `DOUBT_RULE` constant with:

```ts
export const DOUBT_RULE =
  'Doubt rule: a doubt about a sender, a page or a link — a personal address, a job you never applied to, a strange link, even all of them at once — is a warning on the approval card, never a reason to stop or to ask first. Propose the action with every doubt listed as a warning; the user decides on the card. A doubt about whether an action is needed at all is different. When memory shows this exact work is already done — a mail that confirms a booking you already made, an invitation you already acted on — do not propose it again on your own; when a mail cancels or changes something in memory, record the change and do nothing new because of it. In both cases say in one sentence what memory shows; if something changed, write it with remember before you propose anything else; then go on with the rest of the job, and end with one sentence only when nothing else needs action. Memory is a log: the latest line about the same thing tells its current state, and a booking that was cancelled or changed does not make the mail it came from new again — only a new mail, or a request from the user, starts new work. When a match is uncertain — the memory line does not identify the mail or the booking well enough to be sure — treat the work as open and put what memory shows on the card as a warning. This exit is for work you would repeat on your own, from a mail or a scheduled run; when the user asks for a repeat or a change, that is a new job: do it as asked, through the usual approval.'
```

  The rule keeps its place in the `rules` array (right after the approval rule). No site name appears in the sentence: `scripts/preflight.sh` greps `src/` for `startupjobs|calendly|linkedin|jobs\.cz|seznam|gmail`.
- [ ] Run `pnpm exec vitest run src/server/agent/prompt.test.ts && pnpm typecheck`; green.
- [ ] **Commit** `Give the doubt rule an exit: work memory shows as done is reported, not proposed again`.

### Task 2: The mail skill reads everything first, says what "already handled" looks like, and tells two invitations apart [mechanical] [demo-path]

**Files:** Modify `examples/job-hunt-bot/skills/handle-replies.md`; copy it to `data/bots/job-hunt-bot/skills/handle-replies.md`.
**Invariant:** 4 and 7 — the bot proposes only open work, and the knowledge of what a confirmation looks like stays in the bot's own skill text, readable and correctable by the user in the Skills tab, never in `src/`. Proven by the live runs of Task 4 and by `pnpm preflight`'s grep staying clean.
**Demo step:** spec Demo path row 14, the same run as Task 1 — the skill is the text the model follows on that run; the prompt rule is the platform saying it for every skill.
**Verify:** `pnpm exec vitest run src/server/agent/recovery.test.ts` (the test that boots on a copy of the example folder still passes: the frontmatter is unchanged) and `diff -r examples/job-hunt-bot/skills data/bots/job-hunt-bot/skills` printing nothing.

- [ ] In `examples/job-hunt-bot/skills/handle-replies.md`, after the paragraph that begins `Read the new mail since your last run` and before the paragraph that begins `Check the sender:`, insert this paragraph:

```text
Before you act on anything, read all the new mail and check each message against memory; one handled message never ends the run. First record what changed: a cancellation or a change to a booking in memory gets one sentence in chat and one memory line that names the slot ("Cancelled on <date>: the booking on <slot> with <company>" or "Changed on <date>: the booking on <slot> with <company> is now <new slot>") — never book a new slot on your own because of it. A mail that confirms a booking — a calendar invitation or a scheduling-page confirmation, usually with a link to cancel or reschedule, whose date and time equal a slot memory knows: the slot of a "Booked on" line, or the new slot of a "Changed on" line, including one you wrote earlier in this run — is the confirmation of that booking, not a new invitation, and it never leads to a proposal: do not open its links. A fresh invitation names no date and time of its own, only a link to pick one, so this test only ever matches a mail about a booking that already exists; a mail that names a time and is not clearly about an existing booking is open work — propose, with what memory shows as a warning. Report a confirmation by the booking's latest state in memory — including a cancellation or a change you recorded earlier in this same run — in one sentence that names the mail: "the calendar invitation received <date> <time>: the booking on <slot> is confirmed", or "… was cancelled on <date>", or "… was moved to <new slot>". An invitation you already acted on — a "Booked on" line names the same subject and the same received date and time — stays handled for good, even if the mail is unread and even if that booking was cancelled or changed since: say so in one sentence that names the mail ("the invitation received <date> <time> is the one I booked from on <date>") and never book from it again. Only then act on what is still open: an invitation that memory does not identify as a handled mail — another subject, another received time, or a "Booked on" line without those details — is a new invitation: propose a slot as below, with any earlier booking for this interview on the card as a warning ("a booking for this interview already exists on <slot>", or "the booking on <slot> was cancelled on <date>"), and let the user decide; a slot freed by a cancellation may be picked like any other. When the user asks in chat for a new slot or a change, that is a new job: do it as asked, through approval. End with one sentence only when nothing else needs action.
```

- [ ] In the same file, in the paragraph that begins `Read the new mail since your last run`, replace

```text
For a mail about an application, find the hand-off line in memory that names the same company. Say in chat: "This looks like a reply to the application I prepared on <date>; I did not submit it, you may have."
```

  with

```text
For a new reply or invitation about an application — not a confirmation, and not an invitation already handled under the paragraph below — find the hand-off line in memory that names the same company. Say in chat: "This looks like a reply to the application I prepared on <date>; I did not submit it, you may have."
```

  Without this, the sentence would fire on the confirmation and on a re-read invitation too, and the one-sentence runs of Task 4 would get a second, misleading sentence (the plan reviewer's finding, pass 5).
- [ ] In the same file, in the paragraph that begins `Check the sender:`, replace the sentence

```text
If the inbox holds several invitations for the same job, act on the newest one and name the older ones on the card.
```

  with

```text
If the inbox holds several still-open invitations for the same job, act on the newest one and name the older ones on the card; an invitation already handled under the rule above is never one of them, on the card or off it.
```

  This sentence came from round 2's fix 4, before "already handled" existed; without the change it would put a handled invitation on the card and contradict the new paragraph (the plan reviewer's finding, pass 4).
- [ ] In the same file, in the paragraph that begins `Then call propose_action with kind "book"`, replace

```text
a summary like "Book <weekday> <date> <time>–<time> for the interview with <company>"
```

  with

```text
a summary like "Book <weekday> <date> <time>–<time> for the interview with <company>, from the invitation received <date> <time>"
```

  so that every card says which mail it acts on.
- [ ] In the same file, in the paragraph that begins `A "Confirm you're human" check may follow`, replace the booking note

```text
"Booked on <date>: interview with <company> on <slot>, from the invitation received <date>; linked to the application I prepared on <date>."
```

  with

```text
"Booked on <date>: interview with <company> on <slot>, from the invitation received <date> <time> with the subject "<subject>"; linked to the application I prepared on <date>." — the received time and the subject are what tell this invitation from another one from the same sender on the same day, so copy them from the mail's header.
```

- [ ] Read the whole file once more: the paragraph order is open the mailbox → read the new mail → read everything and check memory first (new) → check the sender → the scheduling link → propose, naming the invitation → after approval → the human check and the booking note → nothing new. The frontmatter (`name`, `description`) is unchanged, the last line "If nothing new needs action, say so in one sentence and stop." still agrees with the new paragraph, and no other sentence in the file tells the bot to act on, to name on a card, or to say anything else in chat about, a mail the new paragraph calls a confirmation or handled.
- [ ] Run `pnpm exec vitest run src/server/agent/recovery.test.ts`; green.
- [ ] **Commit** `Say in the reply skill what a confirmation, a duplicate and a cancellation look like`.
- [ ] With the server down (never edit the live bot during a run), copy the fixture to the live bot and check they are identical:

```bash
cp examples/job-hunt-bot/skills/handle-replies.md data/bots/job-hunt-bot/skills/handle-replies.md && diff -r examples/job-hunt-bot/skills data/bots/job-hunt-bot/skills && echo identical
```

  `data/` is git-ignored: this step is a command on the operator's machine, not a commit.

### Task 3: The README says what the viewer will see after the booking [mechanical] [support]

**Files:** Modify `README.md`.
**Invariant:** none touched.
**Demo step:** support — delivery constraint 1 (a clean clone reads the behaviour it will get); without this line a reader of step 6 is surprised by the extra run and its one-line report.
**Verify:** `pnpm preflight` (the grep does not cover `README.md`; the step is a read-through).

- [ ] In `README.md`, step 6 of "What you see", after the sentence `A real calendar event exists afterwards.`, add:

```text
   The calendar invitation then lands in the bot's mailbox and starts one more mail run; the bot
   sees in memory that this is the booking it just made, says so in one sentence, and goes on with
   any other new mail. A cancellation or a change to that booking is reported and remembered, and
   the invitation it came from stays handled: only a new invitation, or a slot you ask for in chat,
   starts a new booking, and both go through approval like any other.
```

- [ ] **Commit** `Say in the README that the confirmation mail starts a run that reports and goes on`.

### Task 4: Live proof — the filmed path, a typed request, and five mails in one run [integration] [demo-path]

**Files:** no source files; the run's record lands in the private backlog, this plan's status banner and `docs/plans/2026-09-11-platform-plan.md` under "Act two, round 4".
**Invariant:** 3 and 4 — the job still finishes (a real booking) and the extra runs end without a card, while a typed request and a genuinely new invitation still reach a card; proven by the run logs (`events.jsonl`: outcomes, `approval` events, `open_url` targets) and the chat.
**Demo step:** spec Demo path rows 12–14, the filmed path, run once more end to end with the fix in place.
**Verify:** the criteria table below; the evidence is read from `data/bots/job-hunt-bot/runs/<id>/events.jsonl`, `chat.jsonl` and `memory.md`, never from memory.

**Setup, before the server starts.** Tasks 1–3 committed; the live skill copied (Task 2); preflight green. Memory lines 12 (round 3's booking, Thu 2026-09-17 09:30–10:00, "from the invitation received 2026-09-16" with no time and no subject) and 13 (the denied duplicate) stay: line 12 is the uncertain-match case on purpose. **The owner empties the bot's inbox of the old test mails first** — the two "Pozvánka: …" mails of 13 and 14 September, the "Canceled" mail of 15 September, today's fixture mail and today's calendar invitation — so that each run below reads exactly the mail the step names. The order matters: round 3 showed the fixture mail stays unread after the booking. The server starts through the launch entry (`env -u PORT pnpm dev`) with the owner at <http://localhost:5173>. It is after 05:00 UTC, so the missed `morning-search` may fire at boot again: stop it at once with `POST /api/bots/job-hunt-bot/stop` (as in round 3) before any mail is sent — or start the server before 07:00 Prague.

**Step A — the filmed path, on a memory that already holds a booking** (the owner, about ten minutes):

- [ ] the owner sends the fixture mail from the dev address (the text in the job-selection record, "The fixture as sent", subject in the subject field). It arrives at a new time. The watcher starts `check-mail`.
- [ ] The booking run: one card at "Schedule Event" with the doubts as warnings — the sender, and "a booking for this interview already exists on Thu 2026-09-17 09:30" (line 12 identifies neither subject nor received time, so the mail is open work) — and no question in chat. The owner presses Allow once; if a reCAPTCHA appears, Take over, solve it, click once on an empty part of the page, Hand back. "You are scheduled!" for the next free slot. The new memory line carries the received time and the subject.
- [ ] If the booking run reports the fixture as already handled instead of proposing: the exit over-triggered on an uncertain match. The setup was meant to be uncertain, so this is the rule text, not the setup — go back to the "uncertain means open" sentences with the run's summary as evidence, not to a new mechanism.
- [ ] The confirmation run, alone — the proof of the filmed path: the calendar invitation starts `check-mail` by itself about a minute later; the run ends `done` with one sentence ("the booking … is confirmed" or the same in the bot's words), **no `approval` event**, no `open_url` to the booking page, no new memory line (nothing changed). Record steps, model calls and cost.
- [ ] If the confirmation run proposes a booking: The owner presses Deny; the fix did not hold — go back to the confirmation sentences with the run's summary and card as evidence, not to a new mechanism.

**Step B — a typed request while a booking is in memory** (the owner, about two minutes):

- [ ] the owner types in chat: `Book one more slot for the Company A interview, tomorrow after 14:00.` Expected: the run opens the booking page and proposes a card for a slot after 14:00 with the existing booking on the card as a warning; it does not refuse the goal as already done and asks nothing first. The owner presses Deny; the run ends with no retry. Record steps and cost. (One card is two `approval` events, `pending` then `denied`, with the same `approvalId`.)
- [ ] If the run refuses the goal as already done: the exit's last sentence did not hold — go back to it with the run's summary as evidence.

**Step C — five mails in one run: two cancellations, the original invitation and its old confirmation read again, and a new invitation** (the owner, about five minutes):

- [ ] Claude stops the server. The owner, in the bot's webmail, marks two mails as unread ("Označit" → unread): Step A's fixture mail — the original invitation — and Step A's calendar invitation — the old confirmation; both are read again after their booking is cancelled. The owner then cancels **both** bookings as the host — round 3's Thu 09:30 and Step A's slot — which sends two "Aktualizovaná pozvánka: Canceled: …" mails, and sends the fixture mail once more (a third received time). Claude starts the server; if the missed `morning-search` fires first, Claude stops it at once; the boot delivers the five new mails in one `check-mail` run.
- [ ] Expected, in this order in the run log: the run reads the new mail and first records the two cancellations — one sentence each and one memory line per booking naming its slot ("Cancelled on 2026-09-16: the booking on <slot> with …") — before any card; the old confirmation, unread again, produces one sentence that names it by its received time and reports the booking as **cancelled** (its latest state, from the line written moments earlier in this run), not as confirmed, and no card and no `open_url` to its links; the original invitation, unread again, produces one sentence that names it by its received time as the mail already booked from, and no card, because a "Booked on" line names its subject and received time and a cancellation never reopens it; the new invitation is proposed — one card whose summary names the new mail's received time, with the cancelled bookings as warnings; which slot it picks does not matter, a freed one included. The owner presses Deny; the run ends `done` with no retry. Record steps, model calls and cost.
- [ ] If the run ends after the cancellations with no card: the "one handled message never ends the run" sentence did not hold. If the card comes before the cancellation lines: the "read everything first" sentence did not hold. If a card names the original invitation's received time: the "stays handled for good" sentence did not hold. If the old confirmation is reported as "confirmed", or produces a card: the "latest state" sentence did not hold. In every case: Deny, and go back to that sentence with the run's summary as evidence, not to a new mechanism.
- [ ] Variants, not run in this plan: the literal pair "a confirmation plus a new invitation in one run" needs the server stopped within the minute between "You are scheduled!" and the confirmation mail, then the fixture sent, then a boot that delivers both — it replaces the filmed-timing run, so it belongs in a later session after Step A has been believed; and a reschedule by the host ("Changed on …", the booking still exists at its new time, and its new confirmation must match the "Changed on" slot and produce no proposal) is covered by the "stays handled for good" and "latest state" sentences and can be staged the same way as a cancellation — explicitly unverified until it is exercised live.

- [ ] Claude records Steps A–C in `docs/plans/2026-09-11-platform-plan.md` as "Act two, round 4" (the table style of round 3), ticks the TODO item, and writes this plan's status banner.
- [ ] **Commit** `Record act two, round 4: the confirmation, a typed request and five mails in one run`.

## Verification Criteria

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | The prompt carries the exit and its guards: "do not propose it again on your own", "if something changed, write it with remember before you propose anything else", "go on with the rest of the job", "does not make the mail it came from new again", "treat the work as open and put what memory shows on the card as a warning", "when the user asks for a repeat or a change, that is a new job"; the old sentences stay. | The test of Task 1; `pnpm exec vitest run src/server/agent/prompt.test.ts`. |
| 2 | A resent invitation that an old booking note cannot identify reaches a card with the earlier booking as a warning, the sender warning stays, and nothing is asked in chat. **Human-observable.** | Step A's booking run: `propose_action` input carries both warnings and its summary names the invitation's received time; `chat.jsonl` holds no `ask_user` question before the card; one unique `approvalId` with one `pending` and one `allowed` event; the run ends "You are scheduled!"; the new memory line names the received time and the subject. |
| 3 | After a real booking, the confirmation mail's run ends in a one-sentence report with no second card. **Human-observable — the filmed path and the TODO item's belief criterion.** | Step A's confirmation run: outcome `done`, zero `approval` events, no `open_url` to the booking page, no new memory line. |
| 4 | A repeat the user asks for is a new job: it reaches a card and is not refused as already done. **Human-observable.** | Step B: one unique `approvalId` with one `pending` and one `denied` event; the card's summary names a slot after 14:00; `chat.jsonl` holds no refusal before it. |
| 5 | Several mails in one run are all handled in the right order: cancellations recorded first, the old confirmation reported as cancelled, the original invitation read again stays handled, then the new invitation is proposed; no early end. **Human-observable.** | Step C: two new "Cancelled on …" memory lines naming the slots, whose `remember` results precede the `pending` event in `events.jsonl`; one bot sentence naming the old confirmation by its received time and saying "cancelled", no `open_url` to its links; one bot sentence naming the original invitation by its received time as already booked from; one unique `approvalId` with one `pending` and one `denied` event, whose summary names the new mail's received time and not the original's; outcome `done` after Deny. |
| 6 | Nothing else changed: typecheck, every test and the site-name grep are clean; the live skill equals the fixture. | `pnpm preflight` (419 tests before this plan; the same count after, since Task 1 edits an existing test); `diff -r examples/job-hunt-bot/skills data/bots/job-hunt-bot/skills` prints nothing. |
| 7 | A clean clone reads the new behaviour. | README step 6 (Task 3); the example skill carries the paragraph and the new booking note (Task 2), and the README setup copies `examples/` into `data/`. |

## Test Plan

- Task 1: `pnpm exec vitest run src/server/agent/prompt.test.ts` — offline, pins the sentences; the pattern of the after-round-2 plan's Task 3 ("nothing in the code enforces it, so the sentence itself is what the test pins").
- Task 2: `pnpm exec vitest run src/server/agent/recovery.test.ts` — offline; the boot on a copy of the example folder still passes. No test asserts the skill's wording: the skill is data the bot may rewrite, and a test on its text would pass whatever the model does with it. The live runs are its proof.
- Task 3: read-through.
- Task 4: needs the live sandbox, both API keys, the mail credentials the platform holds, and the owner at the keyboard. Evidence from `events.jsonl`, `chat.jsonl` and `memory.md`, quoted in the record.
- Full pre-flight before the live runs and before the final commit: `pnpm preflight`.

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan.
2. `git log --oneline -8` — the three subjects above tell which tasks landed.
3. `diff -r examples/job-hunt-bot/skills data/bots/job-hunt-bot/skills` — empty means the live copy is current; otherwise redo the copy step of Task 2 with the server down.
4. Pick up from the first uncompleted task; Task 4 needs the owner and a live server, so stop and ask before starting it. Inside Task 4, `memory.md` and the newest run folders under `data/bots/job-hunt-bot/runs/` tell which step was reached.
