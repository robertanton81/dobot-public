# Learning any job through conversation — implementation plan

> **STATUS: SHIPPED 2026-09-15.** Landed as five commits on `worktree-learning-gap`, `2316220` to
> `29db07f`, plus the record commit that adds this header; verified live the same evening (the
> "Evidence" and "Verification Report" sections at the end). The unchecked `- [ ]` boxes below are
> historical — the work is done. **Do not re-execute this plan.** If you are changing how the bot
> learns a job, work directly in `src/server/agent/prompt.ts` (the four rules) and
> `src/server/agent/tools.ts` (`save_skill`, `save_routine`).
>
> **Plan-vs-reality corrections discovered during execution:**
>
> **Library/version drift:** none — no dependency was added or moved.
>
> **Plan code prescriptions that needed adjustment:** every snippet ran as written. Two wording
> additions came from the reviews before and after: `CAPABILITY_RULE` gained "no secret of any
> kind … the user's own logins never come to you at all" (plan review) and "no API beyond the
> public pages fetch_url reads" in place of "no API call" (code review: `fetch_url` accepts
> `application/json`). The routine-header test also pins that `CORRECTION_RULE` is absent and
> `CAPABILITY_RULE` present on a routine run.
>
> **Corrections applied during review (commit `29db07f`):** the `save_skill` comment reworded; the
> correction test pins the two clauses that carry the behaviour instead of the words `save_skill`
> and `remember`; the tool test pins the full "Saving under an existing name replaces …" sentences;
> the new-name "saved" check is its own test. No BLOCKING finding from any of the three reviewers.
>
> **Deferrals worth tracking:** (1) the long chain test in `run.test.ts` ("learning a job through
> conversation") stays one test on purpose — the chain is what it proves — but the test reviewer
> would split it into "conversation → skill" and "restart → correction", seeding the second from the
> store; (2) the skill offer went out as a trailing chat line in run 1 of the evidence and through
> `ask_user` in run 10 — a wording candidate for `SKILL_RULE` is "offer with ask_user, never as the
> last line of an answer", to be tried in the next live cycle, not blind; (3) the last answer of an
> interview is written to memory only when a question follows it (evidence run 10) — the candidate
> is "write every answer, the last one too, before you start the work"; (4) `fetch_url` and the
> capability rule: a public JSON address is readable, which the rule now says; nothing to build.
>
> **Plan history below is preserved as-written for context. Treat the live code as authoritative.**

**Goal:** A bot with skills clarifies an unfamiliar goal, asks only for what is missing, saves a
skill when the user asks (with no schedule attached), keeps a correction under the same skill
name, and says which step of a goal the platform cannot do instead of saving a skill that claims
it — and a fresh bot is seen learning a real job through chat and repeating it after a restart.
**Approach:** The interview, the skill offer, the correction path and the capability boundary
are rules in the system prompt, as the platform spec decided ("the interview is a prompt, not
code"); the code changes are two tool descriptions and two tool results, so the model knows that
saving under an existing name is a rewrite. One plumbing test proves that what a scripted model
saves in one run is what the next run receives after a restart; one live run with a fresh bot
proves the model follows the rules. Nothing job-specific enters `src/`.
**Design spec:** `docs/specs/2026-09-11-platform-design.md` (the "Agent loop" section, step 5, its
platform-tools table, and the line "the interview is a prompt, not code"); amended in Task 4 with a
dated entry, and its Demo path row 3 (one question for skill and schedule) is superseded there.
**TODO items:** section 1 "Skill writing" (built 2026-09-11, extended here) and section 2
"Evidence that the bot writes its own skills (invariant 7)". This plan takes priority over "Act two,
round 3" on the author's word of 2026-09-15.
**Branch:** `worktree-learning-gap`, pushed; the owner merges it into `main` (the background job may
not push to `main`).
**Scope:** `src/server/agent/prompt.ts`, `src/server/agent/tools.ts`, their tests, one run-loop
test, the spec amendment, `docs/decisions.md`, `README.md`, the private backlog.
**Build estimate:** The owner's hands: none expected on the evidence run (public pages, no login, no
irreversible step; a CAPTCHA would be the one takeover). Live-run cycles: one cycle of five to
seven short runs on a fresh bot (about $1 at the measured $0.03–0.30 per short run); a second cycle
only if the model ignores a rule and its wording must change.

## Gap assessment (code-grounded, 2026-09-15)

The product goal, in the author's words: a user describes a job in ordinary language; the agent
asks for missing information, does the job with the platform's tools, saves reusable skills and
memory, and creates a routine when asked; the user writes no skill, edits no file, learns no
internal name. What the code does today, against each gap named:

| # | Gap | Where it is in the code | Verdict |
| --- | --- | --- | --- |
| 1 | The interview applies only to a bot with no skills | `src/server/agent/prompt.ts:57` — `if (skills.length === 0) rules.push(INTERVIEW_RULE)`; the rule itself says "this is your first job and you have no skill yet … ask for the five items one at a time" (`prompt.ts:15`) | **Real.** A bot with the three demo skills gets no rule to clarify a goal none of them covers. And the rule asks for all five items even when the goal already states them, against "ask only for what is missing". Answers do survive an interruption: the rule says to write each one with `remember`, memory is a file (`store/memory.ts`), and `recentConversation` (`agent/context.ts`) carries the last six chat lines into the next run. |
| 2 | Saving a skill is tied to accepting a schedule | `prompt.ts:52–56`, the "Skill offer rule": "ask … whether the user wants you to do it on a schedule; if yes, write the skill with save_skill and the routine with save_routine". Nothing in `tools.ts` ties `save_skill` to `save_routine` (`save_routine` needs the skill; not the reverse) | **Real, prompt-only.** A user who says "save this so you can do it again" and "no schedule" gets no skill, by the prompt's own words. |
| 3 | The live demonstrations use hand-written skills | `examples/job-hunt-bot/skills/*.md` are hand-written (decided 2026-09-12, a fixture the demo can rely on); the rehearsal notes in `docs/plans/2026-09-11-platform-plan.md` record no live `save_skill` call; the private backlog line 197 is the unchecked evidence item | **Real.** `save_skill` and `save_routine` are unit-tested (`run.test.ts:705`, `tools.test.ts:139`) but no run has ever produced a skill from a conversation. Verification criterion 1–4 below is that evidence. |
| 4 | Can the user correct learned instructions, and do corrections persist? | Two paths. By hand: the Skills tab (`src/web/components/SkillsTab.tsx`, `PUT /api/bots/:id/skills/:name` in `http/app.ts`), which invariant 7 allows ("the user only reads or corrects them"). By chat: `writeSkill` (`store/skills.ts:46`) overwrites the file under the same name, and a routine reads its skill from disk at every fire (`scheduler/scheduler.ts`, `runRoutine`), so a rewritten skill is what the next run uses — but no prompt rule says a correction is a rewrite under the same name, and `save_skill`'s description says "a job you just finished", so a model may save a second skill under a new name and leave the routine on the old one | **Partly real.** Persistence is there; the in-chat path is not named. Task 1 names it, Task 2 makes the tool say "updated". |
| 5 | Missing instructions vs. missing capabilities | The prompt lists the rules of the tools it has, never what the platform cannot do; `save_skill` accepts any body (`tools.ts`, `saveSkill`), so a skill can describe a step no tool performs. The one boundary in code: `save_routine` refuses an event that is not in `src/server/events.ts` (`tools.test.ts:169`) | **Real, prompt-only.** The capability boundary is a fixed list derived from the tools (Task 1); a test pins that every tool the rule names exists. |

What the platform's tools can support today, and what stays unsupported (this is the list the
capability rule states to the model and the write-up states to the reader):

- **Supported:** reading public pages (`fetch_url`); any website in the bot's own browser on its
  own computer, forms and logins included — a human types every secret by takeover; attaching a
  file the user placed in the workspace; writing documents as artifacts; memory; questions in chat;
  skills; routines on a cron schedule or on the `mail-arrived` event; turning a routine off and on.
- **Unsupported:** anything outside a browser on the bot's computer — running code, calling an
  API, sending an SMS or a push notification, reading the user's own computer or files, phone calls;
  events other than mail; the user's own credentials (never enter the platform); a schedule denser
  than `ROUTINE_MIN_INTERVAL_MINUTES`. A skill records instructions; it never adds a capability.

**The four safety defects named in the request** were verified independently on 2026-09-15
before this plan: the review's script (`/private/tmp/dobot-review-repro.mts`, adapted for the
renamed `pageOf`) was run one repro at a time against `4ca1946`; every one of the four fails at its
"defect present" assertion, so none reproduces. Each fix is in `main` with a test that failed on
the old code: `11c7ab2` (`runner.ts:310–323`, `runner.test.ts` "a goal on a blocked bot starts only
when the screen passes the hand-back check"), `6238000` (`run.ts:316–326` the second read of the
control after Allow, `gate.ts:44–56` `pageOf` with the origin; `gate.test.ts`, `run.test.ts`),
`29fa76b` (`watcher.ts` the mark moves after `onMail` returned; `watcher.test.ts` "moves the
watermark only after the handler has returned"). Two residuals stay as documented limits, not as
defects of this plan: the blocked-screen check runs only while the bot's computer is held awake
(after a restart `blockedKeepAlives` is empty, README "Known limits"); and a mail run that ended
`failed` counts as delivered — `fire()` never rejects — so the mail is not re-fired, which is the
choice against a five-minute retry storm on a persistent failure; the skill reads the unread mail
at the next run anyway. No change to these four files in this plan.

## Research (source links)

No new library, SDK or API. The system prompt and the tool definitions keep the shapes the
platform plan verified (`docs/plans/2026-09-11-platform-plan.md`, Research: Anthropic Messages
API, `computer_toolset_20260801`, zod 4 `toJSONSchema`).

## File Changes

| Action | Path | Purpose |
| --- | --- | --- |
| Modify | `src/server/agent/prompt.ts` | Replace `INTERVIEW_RULE` (bots with no skills) by `TASK_SHAPE_RULE` for every message run; replace the skill offer rule by `SKILL_RULE`; add `CORRECTION_RULE` and `CAPABILITY_RULE`; extend the routine rule with "change it by saving it again" |
| Modify | `src/server/agent/prompt.test.ts` | The rules are present for a bot with and without skills, absent on a routine run; the wording that matters is pinned; every tool the capability rule names exists |
| Modify | `src/server/agent/tools.ts` | `save_skill` and `save_routine`: the description says that an existing name is replaced; the result says `updated` instead of `saved` when it was |
| Modify | `src/server/agent/tools.test.ts` | `save_skill` under an existing name replaces the body and leaves the routine that names it untouched; `save_routine` under an existing name replaces the schedule |
| Modify | `src/server/agent/run.test.ts` | One plumbing test: a fresh bot's scripted conversation saves a skill; a new store on the same folder (a restart) gives the next run that skill in its prompt; a correction under the same name replaces it |
| Modify | `docs/specs/2026-09-11-platform-design.md` | Dated amendment: learning any job through conversation |
| Modify | `docs/decisions.md` | "Users never write skills" section: the four rules, the capability boundary, the trade-off (prompt rules, not code), the evidence pointer |
| Modify | `README.md` | The paragraph on the interview (lines 144–146) says what the bot does now |
| Modify | the private backlog | This plan's item; the evidence item ticked after the live run |

## Tasks

### Task 1: The four rules in the system prompt [integration] [demo-path]

**Files:** Modify `src/server/agent/prompt.ts`, Modify `src/server/agent/prompt.test.ts`
**Invariant:** 7 — the user configures by chat; the bot writes and rewrites its own skills; a
skill never claims a capability the platform lacks. Proven by the prompt tests (the wording) and by
verification criteria 1–7 (the model follows it live).
**Demo step:** Demo path rows 1 and 3 of the spec (the interview in the chat history; the skill and
routine cards) and the evidence item in the private backlog.
**Verify:** `pnpm exec vitest run src/server/agent/prompt.test.ts`

- [ ] In `prompt.test.ts`, replace the test `includes the interview rule only for a bot without skills` with:

```ts
  // Review of 2026-09-15: the interview rule applied only to a bot with no skills, so a bot with
  // three skills got no rule to clarify a goal none of them covered, and the rule asked for all
  // five items even when the goal already stated them.
  it('gives the task-shape rule to a bot with skills and to a bot without, on a message run only', () => {
    expect(buildSystemPrompt({ bot, memory: '', skills: [], activeSkill: null })).toContain(TASK_SHAPE_RULE)
    expect(buildSystemPrompt({ bot, memory: '', skills: [search], activeSkill: null })).toContain(TASK_SHAPE_RULE)
    const routine = { name: 'morning-search', skill: 'search-board', instruction: 'Check the board.' }
    expect(buildSystemPrompt({ bot, memory: '', skills: [search], activeSkill: search, routine })).not.toContain(TASK_SHAPE_RULE)
    expect(TASK_SHAPE_RULE).toContain('only for a part that is still missing')
    expect(TASK_SHAPE_RULE).toContain('write each answer to memory with remember before the next question')
    expect(TASK_SHAPE_RULE).toContain('A goal a skill covers needs no questions')
  })

  // The skill offer was "do it on a schedule?", and the skill was written only on a yes: a user who
  // wanted the job repeatable on request, with no schedule, got no skill.
  it('saves a skill on request with no schedule, only after the job finished, and asks about a schedule apart', () => {
    const prompt = buildSystemPrompt({ bot, memory: '', skills: [search], activeSkill: null })
    expect(prompt).toContain(SKILL_RULE)
    expect(SKILL_RULE).toContain('a skill needs no schedule')
    expect(SKILL_RULE).toContain('Never save a skill for a job that did not finish')
    expect(SKILL_RULE).toContain('Ask about a schedule apart from that')
    expect(prompt).not.toContain('Skill offer rule')
  })

  it('says that a correction is a rewrite of the skill under the same name', () => {
    const prompt = buildSystemPrompt({ bot, memory: '', skills: [search], activeSkill: null })
    expect(prompt).toContain(CORRECTION_RULE)
    expect(CORRECTION_RULE).toContain('under the same name')
    expect(CORRECTION_RULE).toContain('save_skill')
    expect(CORRECTION_RULE).toContain('remember')
  })

  // A skill is instructions, never a capability: the rule names what the platform cannot do, and
  // every tool it names must exist, so a renamed tool fails here and not in a live run.
  it('names what the bot cannot do, that saving a skill adds no capability, and only tools that exist', () => {
    const prompt = buildSystemPrompt({ bot, memory: '', skills: [], activeSkill: null })
    expect(prompt).toContain(CAPABILITY_RULE)
    expect(CAPABILITY_RULE).toContain('saving a skill never adds a capability')
    expect(CAPABILITY_RULE).toContain('say which step and why before you start')
    const named = CAPABILITY_RULE.match(/\b[a-z]+_[a-z_]+\b/g) ?? []
    expect(named.length).toBeGreaterThan(0)
    const tools = basePlatformTools.map((t) => t.name)
    for (const name of named) expect(tools).toContain(name)
  })
```

- [ ] Update the imports of `prompt.test.ts`: `import { ACTIVE_MARK, buildSystemPrompt, CAPABILITY_RULE, CORRECTION_RULE, DOUBT_RULE, routineHeader, SKILL_RULE, TASK_SHAPE_RULE } from './prompt'` and `import { basePlatformTools } from './tools'`.
- [ ] In the test `says that questions go through ask_user…`, replace the two lines that pin the old skill offer (`'Skill offer rule: when you finish a job that no skill covered, ask with ask_user'` and `'in this same run'`) with `expect(prompt).toContain('change it by saving it again under the same name with save_routine')`.
- [ ] In the test `prepends the routine header…`, replace both `'Skill offer rule'` expectations with `SKILL_RULE`: absent on the routine run, present on the message run.
- [ ] Run the file: the new tests fail (`TASK_SHAPE_RULE` is not exported).
- [ ] In `prompt.ts`, replace `INTERVIEW_RULE` with the four exported rules:

```ts
export const TASK_SHAPE_RULE =
  'Unfamiliar job: when no skill covers the goal, work out its task shape first — the outcome, the sources, the constraints, the deliverable and the review point — from the goal, your memory and your skills. Ask with ask_user only for a part that is still missing, one question at a time, and write each answer to memory with remember before the next question, so an interrupted conversation loses nothing. Never ask for what the user already said. A goal a skill covers needs no questions: follow the skill.'

export const SKILL_RULE =
  'Skills: a skill is the way you did a job, written after the job ran to the end once, so you can do it again the same way, on request or on a schedule. When you finish a job that no skill covered, offer with ask_user to save the way you did it as a skill; when the user says yes, or asks you at any time to save or remember how to do something, write it with save_skill — a skill needs no schedule. Never save a skill for a job that did not finish: say what is still missing instead. Ask about a schedule apart from that, and only then write the routine with save_routine.'

export const CORRECTION_RULE =
  'Corrections: when the user corrects how a job is done and a skill covers that job, rewrite the skill with save_skill under the same name, the whole body with the correction in place, and say what changed. A fact — a name, a number, a preference — goes to memory with remember instead. A correction to when a job runs is a new save_routine under the routine\'s own name.'

export const CAPABILITY_RULE =
  'What you can do: read public pages with fetch_url; use your own computer and its browser for any site, form or login, with a human typing every secret by takeover; attach a file from your workspace with attach_file; write documents with write_artifact; keep memory with remember; ask the user with ask_user; save skills with save_skill and routines with save_routine, on a schedule or on the events save_routine lists. Nothing else: no other computer and no file but the ones in your workspace, no code, no API call, no phone, no text message, no message to anyone except through a web page on your screen, no event that is not listed, and no secret of any kind — a password, a code or a CAPTCHA is typed by a human on your screen, and the user\'s own logins never come to you at all. When a goal needs a step you cannot do, say which step and why before you start, and offer the nearest thing you can do. A skill records only steps you have done: saving a skill never adds a capability.'
```

- [ ] In `buildSystemPrompt`, replace the `Routines:` rule text with: `'Routines: when the user asks you to stop or pause a scheduled job, turn its routine off with set_routine_enabled; turn it on again the same way. Never replace a routine with one that runs and does nothing. When the user wants a routine at another time or with another instruction, change it by saving it again under the same name with save_routine.'`
- [ ] Replace the block `if (!routine && !activeSkill) { rules.push('Skill offer rule: …') }` and `if (skills.length === 0) rules.push(INTERVIEW_RULE)` with:

```ts
  // Message runs learn; routine runs execute. The interview, the skill offer and the correction
  // path make no sense inside a routine's own run (no user is in the loop but through ask_user),
  // and a routine run must not rewrite the skill it is running.
  if (!routine) rules.push(TASK_SHAPE_RULE, SKILL_RULE, CORRECTION_RULE)
  rules.push(CAPABILITY_RULE)
```

- [ ] Update the file's header comment: "The interview is a prompt, not code: every message run works out the task shape of a goal no skill covers and asks only for what is missing."
- [ ] `pnpm exec vitest run src/server/agent/prompt.test.ts` passes; `pnpm typecheck` passes (no other file imports `INTERVIEW_RULE`: `grep -rn INTERVIEW_RULE src/` returns nothing).
- [ ] Commit: `Clarify any goal no skill covers, save a skill without a schedule, keep corrections, name the capability boundary`

### Task 2: `save_skill` and `save_routine` say when they replaced [mechanical] [support]

**Files:** Modify `src/server/agent/tools.ts`, Modify `src/server/agent/tools.test.ts`
**Invariant:** 7 — a correction reaches the skill through the bot's own tool, not a hand-edited
file; 6 — the rewritten skill is the one on disk that the next run and the routine read. Proven by
the tests below.
**Demo step:** Support for the evidence item in the private backlog: without it the model has no way to know
that a correction is a rewrite under the same name, and a renamed copy would leave the routine on
the old skill.
**Verify:** `pnpm exec vitest run src/server/agent/tools.test.ts`

- [ ] Add to `tools.test.ts`, after the `save_routine and events` block:

```ts
// Review of 2026-09-15: a correction is a rewrite of the skill under the same name; the tool must
// say that an existing name is replaced, or the model saves a copy under a new name and the
// routine keeps running the old one.
describe('save_skill and save_routine over an existing name', () => {
  async function botWithRoutine(): Promise<{ ctx: RunContext; botId: string; dataDir: string; store: ReturnType<typeof createStore>; t: ReturnType<typeof makeContext> }> {
    const dataDir = await mkdtemp(join(tmpdir(), 'dobot-tools-'))
    const store = createStore(dataDir)
    const botId = (await store.createBot({ name: 'Hunter', persona: 'Hunts.' })).id
    await store.writeSkill(botId, { name: 'search-board', description: 'Searches', body: 'Open the board.\n' })
    await store.writeRoutine(botId, { name: 'morning', skill: 'search-board', schedule: '0 7 * * 1-5', event: null, enabled: true, body: 'Search.\n' })
    const t = makeContext({ store, botId, model: new FakeModel([]), sandbox: new FakeSandbox() })
    return { ctx: t.ctx, botId, dataDir, store, t }
  }

  it('tells the bot that an existing name is replaced', () => {
    const [skill, routine] = toolDefinitions([saveSkill, saveRoutine])
    expect(skill?.description).toContain('replaces')
    expect(routine?.description).toContain('replaces')
  })

  it('save_skill under an existing name replaces the body, says so, and leaves the routine on that skill', async () => {
    const { ctx, botId, dataDir, store, t } = await botWithRoutine()
    try {
      const text = await saveSkill.run({ name: 'search-board', description: 'Searches, newest first', body: 'Open the board and sort by date.\n' }, ctx)
      expect(text).toBe('updated skill search-board')
      expect(await store.readSkill(botId, 'search-board')).toEqual({ name: 'search-board', description: 'Searches, newest first', body: 'Open the board and sort by date.\n' })
      expect((await store.listSkills(botId)).map((s) => s.name)).toEqual(['search-board'])
      expect(await store.readRoutine(botId, 'morning')).toMatchObject({ skill: 'search-board', schedule: '0 7 * * 1-5', enabled: true })
      expect(t.chat.at(-1)?.card).toMatchObject({ card: 'skill', name: 'search-board', body: 'Open the board and sort by date.\n' })
      expect(await saveSkill.run({ name: 'read-mail', description: 'Reads mail', body: 'Open the mailbox.\n' }, ctx)).toBe('saved skill read-mail')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('save_routine under an existing name replaces the schedule and the instruction, and says so', async () => {
    const { ctx, botId, dataDir, store, t } = await botWithRoutine()
    try {
      const text = await saveRoutine.run({ name: 'morning', skill: 'search-board', schedule: '0 8 * * 1-5', instruction: 'Search, newest first.' }, ctx)
      expect(text).toBe('updated routine morning: it runs search-board on the schedule 0 8 * * 1-5')
      expect(await store.readRoutine(botId, 'morning')).toMatchObject({ skill: 'search-board', schedule: '0 8 * * 1-5', event: null, enabled: true, body: 'Search, newest first.' })
      expect(t.reloads).toEqual([botId])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] Add `saveSkill` to the import from `./tools`.
- [ ] Run the file: the three tests fail (the description lacks "replaces"; the result says `saved`).
- [ ] In `tools.ts`, `saveSkill`: description becomes `'Write a skill: plain sentences that describe how to do a job you finished, so you can do it again the same way. Say what to open, what to look for, what to write, where to stop and what to remember. Saving under an existing name replaces that skill: that is how a correction is kept. Never put a password in a skill.'`; in `run`, read first: `const existed = (await ctx.store.readSkill(ctx.botId, name)) !== null` before `writeSkill`, and return `` `${existed ? 'updated' : 'saved'} skill ${name}` ``.
- [ ] `saveRoutine`: append to the description `' Saving under an existing name replaces that routine: use it to change its time or its instruction.'`; in `run`, `const existed = (await ctx.store.readRoutine(ctx.botId, name)) !== null` before `writeRoutine`; the two return strings start with `` `${existed ? 'updated' : 'saved'} routine ${name}` ``.
- [ ] `pnpm exec vitest run src/server/agent/tools.test.ts src/server/agent/run.test.ts` passes (the `no platform tool writes approval-rules.json` test calls both tools and reads no result text).
- [ ] Commit: `Say when save_skill and save_routine replaced an existing one`

### Task 3: A fresh bot learns a skill through conversation and keeps it across a restart [integration] [support]

**Files:** Modify `src/server/agent/run.test.ts`
**Invariant:** 6 — what the bot saved in one run is what the next run receives after a restart; 7
— the skill comes from the conversation, not from a file anyone edited. Proven by the test.
**Demo step:** Support for the evidence item: the plumbing (tools → store → prompt) is proven
offline, so the live run has only the model's behaviour left to prove.
**Verify:** `pnpm exec vitest run src/server/agent/run.test.ts -t "learning"`

- [ ] Add to `run.test.ts`, before `describe('continuity'`:

```ts
// Review of 2026-09-15: no run had ever produced a skill from a conversation. This is the
// plumbing of that path with a scripted model: the interview answer lands in memory, the job
// runs, the skill is saved on the user's yes with no routine, a new store on the same folder (a
// restart) hands the skill to the next run, and a correction replaces it under the same name.
describe('learning a job through conversation', () => {
  const skill = { name: 'node-blog-note', description: 'A note on what is new on the Node.js blog', body: 'Read https://nodejs.org/en/blog with fetch_url. Write the three newest posts as an artifact named node-blog-note.md.\n' }

  function systemText(model: FakeModel, call: number): string {
    const system = model.calls[call]?.system
    return Array.isArray(system) ? system.map((b) => b.text).join('\n') : String(system ?? '')
  }

  it('saves the skill the conversation produced, gives it to the next run after a restart, and keeps a correction under the same name', async () => {
    const first = new FakeModel([
      message([toolUse('ask_user', { question: 'Where should the note go: in the chat, or as a document?' })]),
      message([toolUse('remember', { note: 'Deliverable: the note as an artifact named node-blog-note.md' })]),
      message([toolUse('write_artifact', { name: 'node-blog-note.md', content: 'Three posts.' })]),
      message([toolUse('ask_user', { question: 'Do you want me to save the way I did this, so you can ask for it again?' })]),
      message([toolUse('save_skill', skill)]),
      message([textBlock('Saved.')], 'end_turn'),
    ])
    const t = makeContext({ store, botId, model: first, sandbox: new FakeSandbox(), tools: basePlatformTools })
    t.userAnswers.push('as a document', 'yes')

    expect(await runLoop(t.ctx, { goal: 'Tell me what is new on the Node.js blog.', activeSkill: null, source: 'message' })).toEqual({ outcome: 'done', summary: 'Saved.' })

    expect(systemText(first, 0)).toContain('(none yet)')
    expect(await readFile(join(dataDir, botId, 'memory.md'), 'utf8')).toMatch(/Deliverable: the note as an artifact named node-blog-note.md\n$/)
    expect(await store.readSkill(botId, 'node-blog-note')).toEqual(skill)
    expect(await store.listRoutines(botId)).toEqual([])
    expect(t.chat.filter((m) => m.card?.card === 'skill')).toHaveLength(1)
    // The user's answers were answered in order: the deliverable question first, then the offer.
    expect(t.chat.filter((m) => m.role === 'bot').map((m) => m.text)).toEqual([
      'Where should the note go: in the chat, or as a document?',
      'Do you want me to save the way I did this, so you can ask for it again?',
      'Saved.',
    ])

    // A restart: a new store over the same folder, and nothing in memory carried over.
    const restarted = createStore(dataDir)
    await restarted.startRun(botId, 'run-2')
    const second = new FakeModel([message([toolUse('write_artifact', { name: 'node-blog-note.md', content: 'Three newer posts.' })]), message([textBlock('Done again.')], 'end_turn')])
    const again = makeContext({ store: restarted, botId, model: second, sandbox: new FakeSandbox(), tools: basePlatformTools, runId: 'run-2' })

    expect(await runLoop(again.ctx, { goal: 'Do the Node.js blog note again.', activeSkill: null, source: 'message' })).toEqual({ outcome: 'done', summary: 'Done again.' })

    const prompt = systemText(second, 0)
    expect(prompt).toContain('### node-blog-note\n')
    expect(prompt).toContain(skill.body.trim())
    expect(prompt).toContain('Deliverable: the note as an artifact named node-blog-note.md')
    expect(prompt).not.toContain('(none yet)')
    expect(await restarted.readArtifact(botId, 'node-blog-note.md')).toBe('Three newer posts.')

    // A correction: the same name, a changed body; the old body is gone from the next prompt.
    await restarted.startRun(botId, 'run-3')
    const corrected = { ...skill, body: skill.body.replace('three newest posts', 'three newest posts, each with its link,') }
    const third = new FakeModel([message([toolUse('save_skill', corrected)]), message([textBlock('Changed: each post now carries its link.')], 'end_turn')])
    const fix = makeContext({ store: restarted, botId, model: third, sandbox: new FakeSandbox(), tools: basePlatformTools, runId: 'run-3' })
    expect((await runLoop(fix.ctx, { goal: 'Next time include the link to each post.', activeSkill: null, source: 'message' })).outcome).toBe('done')
    expect(lastUserContent(third, 1)[0]).toMatchObject({ type: 'tool_result', content: 'updated skill node-blog-note' })
    expect(await restarted.readSkill(botId, 'node-blog-note')).toEqual(corrected)
    expect((await restarted.listSkills(botId)).map((s) => s.name)).toEqual(['node-blog-note'])

    await restarted.startRun(botId, 'run-4')
    const fourth = new FakeModel([message([textBlock('ok')], 'end_turn')])
    const after = makeContext({ store: restarted, botId, model: fourth, sandbox: new FakeSandbox(), tools: basePlatformTools, runId: 'run-4' })
    await runLoop(after.ctx, { goal: 'Do it again.', activeSkill: null, source: 'message' })
    expect(systemText(fourth, 0)).toContain('each with its link')
    expect(systemText(fourth, 0)).not.toContain(skill.body.trim())
  })
})
```

- [ ] Task 2 lands first, so this test passes when it is written; its value is the chain it pins (tool → file → prompt of the next run, across a new store), not a red-green cycle. To see it catch a break, run it once with the `if (activeSkill && …)` skill section in `prompt.ts` temporarily emptied: the `### node-blog-note` assertion fails. Restore before committing.
- [ ] `pnpm exec vitest run src/server/agent/run.test.ts` passes.
- [ ] Commit: `Prove that a skill learned in one run reaches the next run after a restart`

### Task 4: The record — spec amendment, decisions, README, TODO [mechanical] [support]

**Files:** Modify `docs/specs/2026-09-11-platform-design.md`, `docs/decisions.md`, `README.md`, the private backlog
**Invariant:** none touched; the write-up is a graded deliverable and the foundation rule says a
behaviour change is a dated spec amendment first.
**Demo step:** The write-up's "Decisions" and "trade-offs" (graded).
**Verify:** `pnpm preflight`

- [ ] Spec: under "Amendments", add `### 2026-09-15 — Learning any job through conversation (review of the product goal against the code)` with: the task-shape rule for every goal no skill covers (was: bots with no skills only); a skill is saved on request, a schedule is a separate question (was: skill only on a yes to a schedule) — this supersedes Demo path row 3's one question "Want me to check every weekday morning?", which becomes two: save the skill, then the schedule; a correction rewrites the skill under the same name through the bot's own tool; the capability boundary as the list in the gap assessment, including that the user's own logins never enter the platform; unchanged: the interview is a prompt, not code, and no tool writes `approval-rules.json`. Trade-off: rules in a prompt bind the model only as far as it follows them; the evidence run is the check, and a rule the model ignored gets a wording fix and another run.
- [ ] `docs/decisions.md`, section "Users never write skills; the bot does, after a run that worked": rewrite to the behaviour after Task 1 (any uncovered goal is clarified, only the missing parts asked; save on request without a schedule; a correction is a rewrite under the same name, also from the Skills tab; the capability boundary, supported and unsupported lists; "a skill is instructions, never a capability"), a **Trade-off** paragraph (prompt rules, not code; what the model does is checked live, not proven by tests; the Skills tab remains a by-hand path), and an **Evidence** pointer to this plan's "Evidence" section once the live run is recorded.
- [ ] `README.md` lines 144–146: replace with "To start a run by hand, type a goal in the composer. For a goal no skill covers, the bot works out what it needs from the goal and its memory, asks only for what is missing, one question at a time, and does the job; when the job finished it offers to save the way it did it as a skill, and asks apart whether to run it on a schedule. 'Next time do X' rewrites the skill; 'stop the morning search' turns the routine off. A step the platform cannot do — anything outside a browser on the bot's own computer — the bot names before it starts, instead of saving a skill that claims it."
- [ ] the private backlog: under section 1 add `- [x] Learning any job through conversation — done 2026-09-15 from docs/plans/2026-09-15-learning-gap-plan.md …` with the commits and the test count once known; the evidence item under section 2 is ticked by `/verify` with the pointer to the plan's "Evidence" section.
- [ ] `pnpm preflight` green.
- [ ] Commit: `Record the learning gap review: spec amendment, decisions, README`

## Verification Criteria

Criteria 1–7 are live, on a fresh bot, with the server started from this branch; they are
performed by `/verify` and recorded under "Evidence" at the end of this plan, with cost per run.
Nothing on the evidence path is irreversible, so no Allow is expected; a CAPTCHA would be a
takeover for the owner. Criterion 8 is automated.

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | A fresh bot given a goal that states the outcome and the source asks only for what is missing (at most two questions), and each answer is in `memory.md` before the next question | create a bot through the API; goal "Tell me what is new on the Node.js blog, https://nodejs.org/en/blog"; read the chat and `memory.md` after each answer |
| 2 | The job runs for real: a real page is read and an artifact with today's posts appears as a card | open the artifact; compare with the live page |
| 3 | "Save this so you can do it again" produces a skill card and `skills/<name>.md`; no routine file exists | `ls data/bots/<id>/routines/` is empty; the Skills tab shows the skill |
| 4 | After a server restart, "do it again" runs the saved skill: no interview question, a fresh artifact, the run's events show no `ask_user` | stop and start the server; send the goal; read the run's `events.jsonl` |
| 5 | "Do it every weekday at 8:00" writes a routine that names the skill; "pause it" turns it off; "start it again" turns it on — all through chat | the routine card, then the status cards; `routines/<name>.md` shows `enabled` false then true |
| 6 | A correction ("next time, include the link to each post") rewrites the skill under the same name; the routine still names it; the next run's artifact has links | `skills/<name>.md` changed, one skill file; run once more |
| 7 | An unsupported requirement ("and send me a text message when it is done") is named as a step the bot cannot do, before it starts, and no skill claims it | the chat line; the skill body after the run |
| 8 | Preflight green; the prompt, tool and run tests of Tasks 1–3 pass | `pnpm preflight` |

## Test Plan

- Task 1: `pnpm exec vitest run src/server/agent/prompt.test.ts` (offline)
- Task 2: `pnpm exec vitest run src/server/agent/tools.test.ts` (offline)
- Task 3: `pnpm exec vitest run src/server/agent/run.test.ts` (offline; a scripted model and a fake sandbox, assertions on files and on the prompt)
- Live (criteria 1–7): `E2B_API_KEY`, `ANTHROPIC_API_KEY` in `.env.local`; the server from this branch; a fresh bot, its own computer on the configured cluster; about $1
- End: `pnpm preflight`

## Checkpoint Recovery

If interrupted mid-implementation, resume by:

1. Read this plan
2. `git log --oneline` on `worktree-learning-gap` for the commits above
3. Pick up from the first uncompleted task; the evidence section at the end of this file says how far the live run got

## Evidence — the fresh bot "Scout", 2026-09-15 (live, labelled)

**Setup.** The server from this branch at `29db07f` (`pnpm start`, the built UI), the EU
cluster, the worktree's own empty `data/bots`, so the demo bot was never touched. The bot was
created through the API and every line below was typed through `POST /api/bots/scout-12db/messages`;
the chat, the files and the costs were read through the API and from the bot folder. Nothing on
the path was irreversible, so no approval card and no takeover appeared. The bot's computer:
`i9zfdql79e5555qcrki7i`, created 18:35:39 UTC, "my computer is ready" 15 s later. Times are UTC.

| Run | Typed | What happened | Tools | Cost |
| --- | --- | --- | --- | --- |
| 1 | 18:35:50 "Tell me what is new on the Node.js blog at https://nodejs.org/en/blog." | No question: the bot judged the goal complete (outcome and source stated, "tell me" as a chat answer). It read the real blog and answered with the posts of the day (26.8.2 of 9 Sep, 24.21.0 LTS of 8 Sep, the Interactive 2026 recap). It ended with a trailing chat question offering a note, a routine or an artifact — not through `ask_user`. | 6 × `fetch_url`, 1 × `open_url` | $0.21, 44 s |
| 2 | 18:37:00 "Yes: write it as a document I can keep, with the three newest posts and one line each. Then save the way you did this so I can ask for it again. No schedule for now." | Artifact card `nodejs-blog-latest.md`; skill card `nodejs-blog-summary`; **no routine file**; memory empty (nothing had been asked). The three titles match the live page's first three entries. | `write_artifact`, `save_skill` | $0.05, 23 s |
| — | 18:38 | The server killed (the tsx child by PID) and started again 18:39:26; boot: `routines armed` `[]` for the bot. | | |
| 3 | 18:39:40 "Do the Node.js blog note again." | "I refreshed the Node.js blog note using the saved `nodejs-blog-summary` skill"; the artifact rewritten; **no `ask_user`** in the run's events. | 4 × `fetch_url`, `write_artifact` | $0.09, 17 s |
| 4 | 18:40:17 "Do this every weekday at 8:00 in the morning." | Routine card `nodejs-blog-weekday`: `0 8 * * 1-5`, skill `nodejs-blog-summary`; the scheduler re-armed. | `save_routine` | $0.01 |
| 5 | 18:40:25 "Pause it for now." | Status card "routine nodejs-blog-weekday is now off"; the file says `enabled: false`. | `set_routine_enabled` | $0.02 |
| 6 | 18:40:37 "Start it again." | "now on"; `enabled: true`. | `set_routine_enabled` | $0.01 |
| 7 | 18:41:03 "Next time, include the link to each post in the note." | Skill card `nodejs-blog-summary` again: **the same name, one skill file**, steps 2 and 4 rewritten with the link rule; the routine untouched and still naming it; "No other changes were made". | `save_skill` (result `updated skill …`) | $0.02 |
| 8 | 18:41:15 "Do it again now." | The artifact now carries a link on each of the three posts. | 4 × `fetch_url`, `write_artifact` | $0.10, 20 s |
| 9 | 18:41:35 "Also send me a text message on my phone each time the note is ready." | No tool call. "Sending a text message to your phone isn't something I'm able to do … no phone/SMS capability and no access to any messaging API", then the nearest things it can do: keep the routine as it is; a web mail service on its screen to an email-to-SMS address, one approval per send; a web page it can drive. **No skill changed.** | — | $0.01 |
| 10 | 18:42:34 "Keep an eye on the weather for me." | `ask_user` "which location?" → "Prague." → `remember` **before the next question** (memory: "User wants weather monitoring for Prague …") → `ask_user` with two questions in one message (recurring or one-time; what matters) → the answer → a two-line forecast for 16 Sep from a public weather site, in the chat → `ask_user` "save this as a repeatable skill?" → "no" → done. | `ask_user`, `remember`, `ask_user`, 5 × `fetch_url`, `ask_user` | $0.06, 81 s |

Ten runs, all `done`, **$0.57** in total. The final files, verbatim:

`skills/nodejs-blog-summary.md`

```
---
name: nodejs-blog-summary
description: Use when asked to summarize what's new on the Node.js blog, especially the three newest posts, as a keepable document.
---
1. Fetch https://nodejs.org/en/blog with fetch_url. The page lists posts in reverse-chronological order (title, category, author initials/name, date). Take the first three entries as the three newest posts.
2. For each of the three newest posts, identify its full URL on nodejs.org. Release post URLs follow the pattern https://nodejs.org/en/blog/release/vX.Y.Z (e.g. https://nodejs.org/en/blog/release/v26.8.1). For non-release posts (announcements, events, vulnerabilities), find the link on the blog listing page (fetch it again and look for the post's slug/link if needed). If more detail is needed for a one-line summary, fetch the individual post page too.
3. Write a one-line summary for each post capturing its title, date, and the key notable change(s) (e.g. version bumps, security fixes, new features, deprecations, or event recaps).
4. Save the result with write_artifact as a markdown file (e.g. nodejs-blog-latest.md) with a title header, and a numbered list of the three posts. Each list item must include: the bold title as a markdown link to the post's own URL, the date, and the one-line summary — e.g. "1. **[Node.js v26.8.1](https://nodejs.org/en/blog/release/v26.8.1)** — 2024-06-01: fixes a security vulnerability in ...". Always include the direct link to each individual post, not just the general blog link.
5. End with a source line linking to https://nodejs.org/en/blog.
6. Do not schedule a routine unless the user explicitly asks for one on a recurring basis; if they say "no schedule for now", just deliver the document and offer to save the skill (which was done here already).
```

`routines/nodejs-blog-weekday.md`

```
---
name: nodejs-blog-weekday
skill: nodejs-blog-summary
schedule: 0 8 * * 1-5
enabled: true
---
Refresh the Node.js blog note: fetch https://nodejs.org/en/blog, identify the three newest posts, write a one-line summary for each, and save/overwrite the result as nodejs-blog-latest.md using write_artifact.
```

`memory.md`

```
- 2026-09-15: User wants weather monitoring for Prague (city: Prague, no further region/country specified — assume Prague, Czech Republic).
```

`artifacts/nodejs-blog-latest.md` (after run 8)

```
# Node.js Blog — Latest Posts

1. **[Node.js 26.8.2 (Current)](https://nodejs.org/en/blog/release/v26.8.2)** — 2026-09-09: deprecates `Server.prototype._listen2` in `node:net`, refines the security vulnerability posture for experimental features, and updates Undici to 8.10.2 and OpenSSL to 3.5.8.
2. **[Node.js 24.21.0 (LTS)](https://nodejs.org/en/blog/release/v24.21.0)** — 2026-09-08: 'Krypton' LTS release adding support for loading private keys through STORE loaders, improved histogram implementation and `net.BlockList` performance, a non-throwing `MIMEType.parse`, plus root certificate, OpenSSL, and Undici updates.
3. **[Node.js 26.8.1 (Current)](https://nodejs.org/en/blog/release/v26.8.1)** — 2026-08-26: out-of-band release fixing `node --version` incorrectly reporting an alpha version.

Source: [Node.js Blog](https://nodejs.org/en/blog)
```

**What the run showed that the rules do not guarantee** (for the write-up's known limits):

- The skill offer is not always a question the run waits on: in run 1 it came as a trailing
  chat line and the run ended; in run 10 it came through `ask_user`. The next message reaches the
  bot through the recent-conversation lines either way, so nothing was lost, but "in this same
  run" is not guaranteed.
- "One question at a time" bent once: run 10's second message carried two questions.
- The last answer of an interview is written to memory only when a question follows it: in run
  10 the location reached memory before the second question, the deliverable did not (no question
  followed). The chat still holds it, and it was used.
- Run 1 opened the page on its computer as well as fetching it: cheap path first, mostly.
- Step 6 of the bot's skill carries a sentence about itself ("which was done here already");
  harmless, and the user can cut it in the Skills tab.
- The evidence job writes its artifact into the bot folder, not into an outside system; the demo
  job (act one and act two) is where invariants 2 and 3 are carried.
- The bot's computer `i9zfdql79e5555qcrki7i` on the EU project pauses on its own; the owner decides
  whether to kill it and the bot folder (`data/bots/scout-12db`, git-ignored, kept for now).

## Verification Report

**Plan:** `docs/plans/2026-09-15-learning-gap-plan.md`
**Date:** 2026-09-15
**Result:** 8/8 plan criteria passed; standing criteria: 4 passed, 5 not run (outside this plan's scope, unchanged code, said so below)

### Results

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | A fresh bot asks only for what is missing (at most two questions); each answer is in memory before the next question | PASS, with a caveat | Run 1: zero questions for a goal that stated outcome and source. Run 10: the location asked and written to memory before the second question; the second message held two questions; the last answer stayed in the chat only (known limits above) |
| 2 | The job runs for real: a real page read, an artifact with today's posts | PASS | Runs 1, 2, 3, 8 read `https://nodejs.org/en/blog` with `fetch_url`; the artifact's three titles equal the live page's first three entries, checked with `curl` at 18:38 |
| 3 | "Save this so you can do it again" gives a skill card and a skill file; no routine | PASS | Run 2: skill card, `skills/nodejs-blog-summary.md`; `routines/` empty; memory empty |
| 4 | After a server restart, "do it again" runs the saved skill with no interview | PASS | The tsx child killed by PID (exit 143), server up again 18:39:26; run 3 events: four `fetch_url`, `write_artifact`, no `ask_user`; the bot names the skill it used |
| 5 | Create, pause and resume a routine by chat | PASS | Runs 4–6: routine card, `enabled: false`, `enabled: true`; the scheduler logged `routines armed` after each save |
| 6 | A correction rewrites the skill under the same name; the routine still names it; the next artifact has links | PASS | Run 7: `updated skill nodejs-blog-summary`, one skill file, routine unchanged; run 8's artifact links each post |
| 7 | An unsupported requirement is named before the bot starts; no skill claims it | PASS | Run 9: no tool call, "isn't something I'm able to do", three nearest things it can do; the skill file unchanged |
| 8 | Preflight green; the tests of Tasks 1–3 pass | PASS | `pnpm preflight` at `29db07f`: 419 tests, the companion's 16, the grep empty |
| S1 | Standing: the remote screen is visible and live while the bot works | NOT RUN | The plan touches neither the sandbox nor the UI; last seen live 2026-09-14 (the EU warm-up) |
| S2 | Standing: the work is real, the artifact exists afterwards | PASS | `data/bots/scout-12db/artifacts/nodejs-blog-latest.md` on disk, content above |
| S3 | Standing: the job runs start to finish unassisted | PASS | Ten runs, all `done`, no takeover, no human step |
| S4 | Standing: the approval gate stops an outbound action; Deny abandons it | NOT RUN live | No irreversible step on the evidence path; the gate is untouched and its tests pass (`gate.test.ts`, `run.test.ts` in the 419) |
| S5 | Standing: require-approval beats allow (fail closed) | NOT RUN live | Unchanged code; `gate.test.ts` covers it |
| S6 | Standing: a takeover credential appears in no transcript, log or prompt | NOT RUN | No takeover happened; the secret guard and the takeover are untouched |
| S7 | Standing: state written before a restart is there after it | PASS | The skill, the artifact and the chat survived the restart (run 3); the Task 3 test does the same with a new store over the same folder |
| S8 | Standing: a torn-down sandbox does not lose the artifact | NOT RUN | The lifecycle is untouched; the artifact lives in the bot folder, not in the sandbox |
| S9 | Standing: a clean clone runs with the documented steps; preflight from a clean install | PASS (preflight) | `git clone -b worktree-learning-gap` into a temp folder, `pnpm install --frozen-lockfile`, `pnpm preflight`: 419 tests green. The README's setup steps are unchanged by this plan; the full clean-machine walk stays the owner's TODO item |

### Failures

None.
