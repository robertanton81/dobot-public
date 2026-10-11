# Shortlist Mail, Apply by Reply, and the Notice Mail — Implementation Plan

**Goal:** A bot mails its human when it needs him, and Hunter mails a shortlist, takes the user's
numbers by reply mail or chat, and prepares each application up to its submit card.
**Approach:** Milestone 1 is a small platform module: the Runner calls a notifier port at the five
points where a human is needed, and an SMTP adapter sends fixed text from the bot's mailbox. No run
waits for it. Milestone 2 has no code: Claude describes the job to Hunter in chat, Hunter writes two
skills and two routine instructions, and seven live cycles prove them before the fixture is copied.
**Design spec:** `docs/specs/2026-09-18-shortlist-mail-and-notifications-design.md` (approved by
the owner 2026-09-18; its decisions are cited below as D1–D15).
**TODO items:** "2. The demo path", the item "Shortlist mail, apply by reply, and a mail when the
bot needs its human".
**Branch:** `main`, one commit per task, no pull request (every plan so far did the same). Commits
carry the co-author line of the active model (the owner's rule of 2026-09-18).
**Scope:** `src/server/mail/`, `src/server/agent/runner.ts`, `src/server/agent/takeover.ts`,
`src/server/config.ts`, `src/server/index.ts`, `.env.example`, `README.md`, `.claude/launch.json`;
then Hunter's bot folder by chat only, `examples/job-hunt-bot/`, `docs/`.
**Build estimate:** The owner's hands about 35 minutes: his address, three lines in `.env.local`,
eleven short reply mails (two each in cycles 4a, 4c, 4e and 5, one each in 4b, 4d and 6; the pairs
of cycle 4 go out inside one displayed minute), one word per act-two run and per mail Claude
sends from the dev mailbox, perhaps one takeover. Claude: about three hours for milestone 1 with
both reviews. Live cycles: about eighteen to twenty-two
runs, $17 to $23 (an estimate, raised by one to two runs for cycle 4a's second number and 4e's
replay).

## Research (source links)

Everything the spec's Research section records is reused as it stands. Added or re-checked here:

- [nodemailer stream and JSON transports](https://nodemailer.com/transports/stream) — `createTransport({ jsonTransport: true })` builds the message and sends nothing; `info.message` is a JSON string with `from: {address, name}`, `to: [{address, name}]`, `subject`, `text`. The tests use it, so the real library composes every message they check.
- [nodemailer SMTP transport](https://nodemailer.com/smtp) — `secure` for port 465; `requireTLS: true` refuses to go on without STARTTLS, so the sign-in never travels in clear on another port; `disableFileAccess` and `disableUrlAccess` stop the library reading files or addresses for content; `logger` and `debug` off.
- [nodemailer error reference](https://nodemailer.com/errors) — `code`, `command`, `responseCode` on an error object.
- [SMTP specification, section 4.5.3.2.6](https://www.rfc-editor.org/rfc/rfc5321#section-4.5.3.2.6) — a timeout while the client waits for the final 250 does not mean the mail was not delivered.
- Packaging, from the published file lists on 2026-09-18: `nodemailer` 9.1.1 is CommonJS under `lib/` with no type file; `@types/nodemailer` 8.0.2 describes the 8.0 API. The project imports its other CommonJS mail library by name (`import { ImapFlow } from 'imapflow'`, `src/server/mail/watcher.ts`), so Task 1 proves the same form for `createTransport` before any code depends on it.
- Code read for this plan on 2026-09-18: `RunContext` needs no change, because a notice carries no text (`src/server/agent/tools.ts`, `RunContext`); `Approvals.get(id)` gives the action kind (`src/server/agent/gate.ts`); the hold of a screen ends only through `dropBlockedKeepAlive` and `endIdleTakeover` (`src/server/agent/runner.ts:231-238, 280-286`, and their callers at `:221, :258, :268, :322, :414, :429`); `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`; the API answers a terminal `curl` on `localhost` that sends no `Origin` header (`src/server/http/app.ts:71-92`); `pnpm dev` restarts the server when a file under `src/` changes, so live cycles never run while `src/` is being edited, and the cycle that kills the server uses `pnpm start`.
- No setting of the notifier can end the process, as the spec says. `MAILBOX_SMTP_PORT` is therefore read as text and checked inside `noticeSettings` (Task 3), unlike `MAILBOX_PORT`, which the shared schema checks and which stops the boot when it is not a number (`src/server/config.ts`, `optionalNumber` and `loadConfig`). The first review of this plan caught the difference.
- `.claude/launch.json` gets a second entry. The spec's scope does not name that file; it is harness configuration, committed on purpose (`CLAUDE.md`, repo layout), and live cycle 5 needs a server that does not restart by itself.

## File Changes

| Action | Path | Purpose |
| ------ | ---- | ------- |
| Modify | `package.json`, `pnpm-lock.yaml` | `nodemailer` 9.1.1, `@types/nodemailer` 8.0.2, exact pins |
| Create | `src/server/mail/notifier.ts` | the port, the fixed texts, the SMTP adapter, the boot check |
| Create | `src/server/mail/notifier.test.ts` | texts, the composed message through the real library, outcomes |
| Modify | `src/server/config.ts` | three optional keys and `noticeSettings` |
| Modify | `src/server/config.test.ts` | the new default and the four `noticeSettings` cases |
| Modify | `.env.example` | the three keys with empty values and a comment |
| Modify | `src/server/agent/takeover.ts` | `onWaiting` called at the line that registers the wait |
| Modify | `src/server/agent/takeover.test.ts` | the hook fires at registration only; a throwing hook |
| Modify | `src/server/agent/runner.ts` | the `notifier` dep, `callHuman`, five hook points, one `refused` notice per hold |
| Modify | `src/server/agent/runner.test.ts` | the notices, the silences, the failure paths |
| Modify | `src/server/index.ts` | wiring and the boot check |
| Modify | `README.md` | the keys, what a notice is, its limits |
| Modify | `.claude/launch.json` | a `dobot-start` entry for the cycle that kills the server |
| Create | `docs/evidence/2026-09-18-shortlist-and-notices/README.md` | the record of the seven live cycles, the address masked |
| Create | `examples/job-hunt-bot/skills/<two new skills>.md` | copies of what Hunter wrote, after the cycles passed |
| Modify | `examples/job-hunt-bot/routines/morning-search.md`, `check-mail.md`, `memory.md` | copies of what ran; the ask-once line for the report address |
| Modify | `docs/decisions.md`, `docs/specs/2026-09-11-platform-design.md`, the private backlog | trade-offs, the demo-path amendment note, the tick and the filming-day check |

## Tasks

**The proof rule (the owner, 2026-09-18, after the fifth review round).** The reviews of this plan
checked its text. They proved nothing about the behaviour. Whoever implements a task owns its
proof, with the tests and live cycles this plan names, during implementation:

- A box is ticked only after its check ran and passed in that session, and the proof is recorded:
  the test count and the commit for milestone 1, the run ids and the memory lines in the evidence
  file for milestone 2.
- A new test must be seen to fail for the reason the plan gives before the code makes it pass.
  Test 6c must fail on the stale notice when the hook has no second look at the hold; test 6b
  must fail when the mark is cleared at the end of a hold.
- A live cycle that did not run, or ran only in part, is recorded as not run. Reading the saved
  skill's text is not a substitute for a cycle; where this plan accepts such a reading (the
  "covered" check, Task 11), the write-up names it as not proven live.
- A pass criterion that fails stops the work on that task. The failure is recorded as it
  happened, the cause is found first, and the fix is corrected by chat (milestone 2) or with a
  failing test first (milestone 1). A criterion is never reworded to fit what happened.
- If a cycle cannot produce its state (two mails do not land in one displayed minute, a site
  shows a bot check), the record says so and the criterion stays open.

### Milestone 1 — the notice mail (platform code)

### Task 1: Install the mail library [mechanical] [support]

**Files:** `package.json`, `pnpm-lock.yaml`
**Invariant:** none touched.
**Demo step:** support. Demo steps 8 and 13 show the notice on the phone; nothing can send it without an SMTP client, and SMTP written by hand is how header injection happens (spec, Alternatives).
**Verify:** `pnpm typecheck`
**Proof (2026-09-18):** commit `873f455`. Registry on install day: latest 10.0.10, no 9.x newer than 9.1.1, OSV empty for both packages; the smoke file printed `function s`; typecheck clean.

- [x] Check the versions again on install day, as the project rule says. `curl -s https://registry.npmjs.org/nodemailer | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['dist-tags']['latest'], d['time']['9.1.1'])"`. Query OSV for `nodemailer` 9.1.1 (`POST https://api.osv.dev/v1/query` with `{"package":{"name":"nodemailer","ecosystem":"npm"},"version":"9.1.1"}`); expected: no `vulns`. If 9.1.1 has an advisory, or a 9.x newer than 9.1.1 exists, stop and tell the owner with the facts; the choice of version is his (D6).
- [x] `pnpm add --save-exact nodemailer@9.1.1` and `pnpm add --save-exact -D @types/nodemailer@8.0.2`.
- [x] Prove the import form the code will use. Write `data/smoke-nodemailer.mts` (git-ignored; a file outside the project could not resolve the package) with the two lines `import { createTransport } from 'nodemailer'` and `createTransport({ jsonTransport: true }).sendMail({ from: 'a@example.test', to: 'b@example.test', subject: 's', text: 't' }).then((i) => console.log(typeof createTransport, JSON.parse(String(i.message)).subject))`, run `pnpm exec tsx data/smoke-nodemailer.mts`, expect the output `function s`, and delete the file. If the named import fails at run time, use `import nodemailer from 'nodemailer'` and `nodemailer.createTransport` in Task 2 instead, and say so in the commit. The type `Transporter` is checked by Task 2's `pnpm typecheck`; if `@types/nodemailer` 8.0.2 does not export it by that name, Task 2 uses `ReturnType<typeof createTransport>` in its place.
- [x] `pnpm typecheck` passes.
- [x] Commit: "Add nodemailer 9.1.1 for the notice mail".

### Task 2: The notice texts and the SMTP adapter [integration] [demo-path]

**Files:** Create `src/server/mail/notifier.ts`, Test `src/server/mail/notifier.test.ts`
**Invariant:** 5 — a notice holds no word from the model, no screenshot and no secret; proven by the type (no free-text field) and by the composed-message tests. 4 — a notice is not a bot action: fixed recipient, fixed text.
**Demo step:** 8 and 13 (the notice on the phone), 15 (the takeover notice).
**Verify:** `pnpm exec vitest run src/server/mail/notifier.test.ts && pnpm typecheck`
**Proof (2026-09-18):** commit `81c1fa0`. The test file failed first on the missing module; then 6 of 6 passed; preflight 514 tests.

- [x] Write the failing test file:

```ts
import { createTransport, type Transporter } from 'nodemailer'
import { describe, expect, it, vi } from 'vitest'
import { log } from '../log'
import { cleanBotName, NOTICE_CLOSING, noticeBody, noticeSubject, SmtpNotifier, type NoticeSettings } from './notifier'

const SETTINGS: NoticeSettings = { host: 'smtp.example.test', port: 465, user: 'bot@example.test', password: 'not-a-real-password', to: 'human@example.test' }
const LIMITS = { approvalMinutes: 30, answerMinutes: 45 }

/** The real library composes the message; nothing is sent. `sent` holds what would have gone out. */
function capturing(): { transport: Transporter; sent: Array<Record<string, unknown>> } {
  const json = createTransport({ jsonTransport: true })
  const sent: Array<Record<string, unknown>> = []
  const transport = {
    sendMail: async (mail: unknown) => {
      const info = await json.sendMail(mail as never)
      sent.push(JSON.parse(String(info.message)) as Record<string, unknown>)
      return info
    },
    verify: async () => true,
  } as unknown as Transporter
  return { transport, sent }
}

function failing(error: unknown): Transporter {
  return { sendMail: async () => Promise.reject(error), verify: async () => Promise.reject(error) } as unknown as Transporter
}

describe('the notice texts', () => {
  it('has one fixed body per need, with the minutes it was given and the closing line', () => {
    const body = (need: Parameters<typeof noticeBody>[0]['need'], actionKind?: 'send') => noticeBody({ botName: 'Hunter', need, ...(actionKind ? { actionKind } : {}) }, LIMITS)
    expect(body('approval', 'send')).toBe(
      `Hunter is waiting for your approval (send). Open the dobot page to see the request and to allow or deny it. A request nobody answers within 30 minutes counts as denied, and the run goes on without that step.\n\n${NOTICE_CLOSING}`,
    )
    expect(body('question')).toBe(`Hunter asked you a question in the chat. Open the dobot page to read and answer it. If nobody answers within 45 minutes, Hunter decides by itself or stops.\n\n${NOTICE_CLOSING}`)
    expect(body('takeover')).toBe(
      `Hunter needs you on its screen for a step it must not do itself: a sign-in, a code or a human check. Open the dobot page, do that step, then hand the screen back. Hunter waits until you hand back or press Stop.\n\n${NOTICE_CLOSING}`,
    )
    expect(body('blocked')).toBe(`Hunter stopped before it finished and needs you. The run has ended, so nothing is waiting for an answer. Open the dobot page to see why.\n\n${NOTICE_CLOSING}`)
    expect(body('refused')).toBe(`Hunter did not start a job. Its screen is still held for you, and it cannot take the screen back yet. Open the dobot page to see why.\n\n${NOTICE_CLOSING}`)
    // Only an approval can time out as "denied"; no other body may say so.
    for (const need of ['question', 'takeover', 'blocked', 'refused'] as const) expect(body(need)).not.toContain('denied')
    expect(body('approval')).toContain('(other)')
    expect(noticeSubject({ botName: 'Hunter', need: 'takeover' })).toBe('Hunter needs you: takeover')
  })

  it('cleans a bot name: no control characters, one line, sixty characters, never empty', () => {
    expect(cleanBotName('Hun\r\nter\u0000\u2028 Bcc: x@example.test')).toBe('Hun ter Bcc: x@example.test')
    expect(cleanBotName('x'.repeat(200))).toHaveLength(60)
    expect(cleanBotName(' \r\n ')).toBe('Your bot')
  })
})

describe('SmtpNotifier', () => {
  it('composes the fixed text for the configured recipient, from the mailbox with the bot name as display name', async () => {
    const { transport, sent } = capturing()
    const outcome = await new SmtpNotifier(SETTINGS, LIMITS, transport).notify({ botName: 'Hun\r\nter', need: 'approval', actionKind: 'send' })
    expect(outcome).toBe('confirmed')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      from: { address: 'bot@example.test', name: 'Hun ter' },
      to: [{ address: 'human@example.test', name: '' }],
      subject: 'Hun ter needs you: approval',
      text: noticeBody({ botName: 'Hun\r\nter', need: 'approval', actionKind: 'send' }, LIMITS),
    })
    expect(String(sent[0]?.subject)).not.toMatch(/[\r\n]/)
    // Nothing else travels: no html part, no attachment, no copy to anyone.
    for (const field of ['html', 'attachments', 'cc', 'bcc']) expect(sent[0]).not.toHaveProperty(field)
  })

  it('resolves unconfirmed, never rejects, and logs the SMTP fields without the message text or an address', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const error = Object.assign(new Error('Invalid login: 535 5.7.8 rejected for bot@example.test'), { code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 })
    await expect(new SmtpNotifier(SETTINGS, LIMITS, failing(error)).notify({ botName: 'Hunter', need: 'blocked' })).resolves.toBe('unconfirmed')
    expect(warn).toHaveBeenCalledWith('notice mail unconfirmed', { need: 'blocked', errorName: 'Error', code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('example.test')
    warn.mockRestore()
  })

  it('a transport that throws instead of rejecting is unconfirmed too', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const transport = { sendMail: () => { throw new Error('broken') }, verify: async () => true } as unknown as Transporter
    await expect(new SmtpNotifier(SETTINGS, LIMITS, transport).notify({ botName: 'Hunter', need: 'question' })).resolves.toBe('unconfirmed')
    warn.mockRestore()
  })

  it('the boot check never rejects: it says ok, or it warns with the SMTP fields', async () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined)
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    await expect(new SmtpNotifier(SETTINGS, LIMITS, capturing().transport).verify()).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith('notice mail: sign-in ok')
    await expect(new SmtpNotifier(SETTINGS, LIMITS, failing(Object.assign(new Error('x'), { code: 'ETIMEDOUT', command: 'CONN' }))).verify()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('notice mail: sign-in failed; every notice stays unconfirmed until the settings are right', { errorName: 'Error', code: 'ETIMEDOUT', command: 'CONN', responseCode: null })
    info.mockRestore()
    warn.mockRestore()
  })
})
```

- [x] Verify the test fails (the module does not exist).
- [x] Implement `src/server/mail/notifier.ts`:

```ts
import { createTransport, type Transporter } from 'nodemailer'
import { log } from '../log'
import type { ActionKind } from '../store'

// The platform's own channel to its human: one plain mail when a bot needs the user's action on
// its screen. Every word of it is written in this file. Nothing the model wrote — a summary, a
// label, a question, a reason — can reach the mail, because a Notice has no free-text field: text
// from the model can carry a link that a web page put there, and quoting it does not disarm it.
// The address it goes to is operator setup and no tool can change it: the channel that calls the
// human stays out of the model's reach, like the approval rules.

export type HumanNeed = 'approval' | 'question' | 'takeover' | 'blocked' | 'refused'
export type Notice = { botName: string; need: HumanNeed; actionKind?: ActionKind }
/** `unconfirmed` is not "lost": a server can accept a message and the connection can end before its answer arrives (RFC 5321, 4.5.3.2.6). */
export type NoticeOutcome = 'confirmed' | 'unconfirmed'
/** Never rejects: nothing awaits a notice, and a rejection nobody awaits would end the process. */
export type NotifierPort = { notify(notice: Notice): Promise<NoticeOutcome> }

export type NoticeSettings = { host: string; port: number; user: string; password: string; to: string }
/** The platform's own wait limits in minutes, handed in so the mail cannot go out of date when they change. */
export type NoticeLimits = { approvalMinutes: number; answerMinutes: number }

export const NOTICE_UNCONFIRMED_TEXT = 'I could not confirm that the notice mail for this step went out.'
export const NOTICE_CLOSING = 'This mail is only a notice. It never asks you to click a link or to reply.'
const NAME_MAX = 60
const FALLBACK_NAME = 'Your bot'

/** The bot's name as one clean line: it goes into the subject and the From name. The user typed it; no tool can change it. */
export function cleanBotName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim()
  return clean === '' ? FALLBACK_NAME : clean
}

export function noticeSubject(notice: Notice): string {
  return `${cleanBotName(notice.botName)} needs you: ${notice.need}`
}

export function noticeBody(notice: Notice, limits: NoticeLimits): string {
  const bot = cleanBotName(notice.botName)
  const bodies: Record<HumanNeed, string> = {
    approval: `${bot} is waiting for your approval (${notice.actionKind ?? 'other'}). Open the dobot page to see the request and to allow or deny it. A request nobody answers within ${limits.approvalMinutes} minutes counts as denied, and the run goes on without that step.`,
    question: `${bot} asked you a question in the chat. Open the dobot page to read and answer it. If nobody answers within ${limits.answerMinutes} minutes, ${bot} decides by itself or stops.`,
    takeover: `${bot} needs you on its screen for a step it must not do itself: a sign-in, a code or a human check. Open the dobot page, do that step, then hand the screen back. ${bot} waits until you hand back or press Stop.`,
    blocked: `${bot} stopped before it finished and needs you. The run has ended, so nothing is waiting for an answer. Open the dobot page to see why.`,
    refused: `${bot} did not start a job. Its screen is still held for you, and it cannot take the screen back yet. Open the dobot page to see why.`,
  }
  return `${bodies[notice.need]}\n\n${NOTICE_CLOSING}`
}

/** What the log may hold about a failed send: the error's kind, never its text, which can quote an address or the server's answer. */
function smtpErrorFields(e: unknown): { errorName: string; code: string | null; command: string | null; responseCode: number | null } {
  const fields = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; command?: unknown; responseCode?: unknown }
  return {
    errorName: e instanceof Error ? e.name : 'unknown',
    code: typeof fields.code === 'string' ? fields.code : null,
    command: typeof fields.command === 'string' ? fields.command : null,
    responseCode: typeof fields.responseCode === 'number' ? fields.responseCode : null,
  }
}

/**
 * One connection per notice, no pool and no retry: a second attempt after a lost 250 could deliver
 * the notice twice. The socket limit is the long one on purpose: nothing waits for the send, and
 * the wait for the final 250 is the one place where a short limit makes a delivered mail look
 * undelivered.
 */
export class SmtpNotifier implements NotifierPort {
  private readonly transport: Transporter

  constructor(
    private readonly settings: NoticeSettings,
    private readonly limits: NoticeLimits,
    transport?: Transporter,
  ) {
    this.transport =
      transport ??
      createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.port === 465,
        // On any other port the sign-in travels only after STARTTLS, or not at all.
        requireTLS: settings.port !== 465,
        auth: { user: settings.user, pass: settings.password },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 60_000,
        disableFileAccess: true,
        disableUrlAccess: true,
        // The library's own logger would print the login exchange and, with debug, the message.
        logger: false,
        debug: false,
      })
  }

  async notify(notice: Notice): Promise<NoticeOutcome> {
    try {
      await this.transport.sendMail({
        from: { name: cleanBotName(notice.botName), address: this.settings.user },
        to: this.settings.to,
        subject: noticeSubject(notice),
        text: noticeBody(notice, this.limits),
      })
      return 'confirmed'
    } catch (e) {
      log.warn('notice mail unconfirmed', { need: notice.need, ...smtpErrorFields(e) })
      return 'unconfirmed'
    }
  }

  /** The boot check: a wrong setting shows at start, not at the first need. Never rejects. */
  async verify(): Promise<void> {
    try {
      await this.transport.verify()
      log.info('notice mail: sign-in ok')
    } catch (e) {
      log.warn('notice mail: sign-in failed; every notice stays unconfirmed until the settings are right', smtpErrorFields(e))
    }
  }
}
```

- [x] Verify the tests pass; `pnpm typecheck`; `pnpm preflight` (the grep must stay empty: this file names no site).
- [x] Commit: "A notice mail with fixed text: the port, the texts and the SMTP adapter".

### Task 3: The three keys and `noticeSettings` [mechanical] [support]

**Files:** Modify `src/server/config.ts`, `src/server/config.test.ts`, `.env.example`
**Invariant:** 7 — the notice address is operator setup on purpose (D5); 5 — the log names keys, never values. 
**Demo step:** support. Without the keys the notifier cannot be switched on; with them empty a clean clone must run as before (delivery constraint 1).
**Verify:** `pnpm exec vitest run src/server/config.test.ts && pnpm typecheck`
**Proof (2026-09-18):** commit `b5c600e`. The four new tests failed first with "noticeSettings is not a function"; then `config.test.ts` 16 of 16; all tests 518.

- [x] Write the failing tests. The defaults test needs no change: the three new keys are optional text, and an unset key is absent from the parsed config. Add `noticeSettings` to the import from `./config`, import `vi` from `vitest` and `log` from `./log`, and append:

```ts
describe('noticeSettings', () => {
  const BASE = { E2B_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }
  const FULL = { ...BASE, NOTIFY_EMAIL: 'human@example.test', MAILBOX_SMTP_HOST: 'smtp.example.test', MAILBOX_USER: 'bot@example.test', MAILBOX_PASSWORD: 'not-a-real-password' }
  const settingsOf = (env: Record<string, string>) => {
    const parsed = parseEnv(env)
    if (!parsed.ok) throw new Error('the test environment must parse')
    return noticeSettings(parsed.config)
  }

  it('is off, and silent, when no notice address is set: a clean clone runs as before', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    expect(settingsOf({ ...BASE, NOTIFY_EMAIL: '', MAILBOX_SMTP_HOST: '', MAILBOX_SMTP_PORT: '' })).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns the settings when the address, the SMTP host, the user and the password are set', () => {
    expect(settingsOf(FULL)).toEqual({ host: 'smtp.example.test', port: 465, user: 'bot@example.test', password: 'not-a-real-password', to: 'human@example.test' })
    expect(settingsOf({ ...FULL, MAILBOX_SMTP_PORT: '' })?.port).toBe(465)
    expect(settingsOf({ ...FULL, MAILBOX_SMTP_PORT: '587' })?.port).toBe(587)
  })

  it('turns the notifier off with a warning that names keys and never values: a missing part, the bot\'s own mailbox, an address that is not plain', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const { MAILBOX_SMTP_HOST: _host, ...noHost } = FULL
    expect(settingsOf(noHost)).toBeNull()
    expect(settingsOf({ ...FULL, NOTIFY_EMAIL: 'Bot@Example.test' })).toBeNull()
    for (const bad of ['human@example.test, other@example.test', 'Human <human@example.test>', 'human@example', 'human@example.test\r\nBcc: x@example.test']) expect(settingsOf({ ...FULL, NOTIFY_EMAIL: bad })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(6)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.test|not-a-real-password/)
    warn.mockRestore()
  })

  it('a port that is not a whole number from 1 to 65535 turns the notifier off and never stops the boot', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    for (const bad of ['smtps', '0', '70000', '46.5', '465 ']) {
      const parsed = parseEnv({ ...FULL, MAILBOX_SMTP_PORT: bad })
      expect(parsed.ok).toBe(true)
      expect(settingsOf({ ...FULL, MAILBOX_SMTP_PORT: bad })).toBeNull()
    }
    expect(warn).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example\.test|not-a-real-password/)
    warn.mockRestore()
  })
})
```

- [x] Verify the tests fail.
- [x] Implement in `src/server/config.ts`. Add `import type { NoticeSettings } from './mail/notifier'` under the `ImapSettings` import. In `EnvSchema`, after `MAILBOX_POLL_MS`:

```ts
  // The notice mail (spec of 2026-09-18, part C): the address the platform calls when a bot needs
  // its human, and the sending side of the mailbox above. Operator setup on purpose: no tool can
  // change who is called, so no text on a web page can talk the model into silencing the human.
  NOTIFY_EMAIL: OPTIONAL_TEXT,
  MAILBOX_SMTP_HOST: OPTIONAL_TEXT,
  // Text on purpose: a port that is not a number turns the notifier off (noticeSettings); it must
  // not stop the boot the way a malformed MAILBOX_PORT does.
  MAILBOX_SMTP_PORT: OPTIONAL_TEXT,
```

and after `mailSettings`:

```ts
const DEFAULT_SMTP_PORT = 465
// One plain address: no display name, no list, no line break. It goes into a mail header.
const PLAIN_ADDRESS = /^[^\s@<>()[\],;:"'\\]+@[^\s@<>()[\],;:"'\\]+\.[^\s@<>()[\],;:"'\\]+$/

/**
 * Where to send a notice, or null when the notifier is off. A mistake here never ends the
 * process: like a half-filled mailbox it turns the feature off and says why, by key name only.
 */
export function noticeSettings(config: Config): NoticeSettings | null {
  const { NOTIFY_EMAIL: to, MAILBOX_SMTP_HOST: host, MAILBOX_USER: user, MAILBOX_PASSWORD: password } = config
  if (to === undefined) return null
  if (host === undefined || user === undefined || password === undefined) {
    log.warn('NOTIFY_EMAIL is set but the notice mail is off: set MAILBOX_SMTP_HOST, MAILBOX_USER and MAILBOX_PASSWORD as well')
    return null
  }
  if (!PLAIN_ADDRESS.test(to)) {
    log.warn('the notice mail is off: NOTIFY_EMAIL must be one plain mail address')
    return null
  }
  if (to.toLowerCase() === user.toLowerCase()) {
    log.warn("the notice mail is off: NOTIFY_EMAIL is the bot's own mailbox, and a notice landing there would start the mail routine")
    return null
  }
  const portText = config.MAILBOX_SMTP_PORT ?? String(DEFAULT_SMTP_PORT)
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log.warn('the notice mail is off: MAILBOX_SMTP_PORT must be a whole number from 1 to 65535')
    return null
  }
  return { host, port, user, password, to }
}
```

- [x] In `.env.example`, after the `MAILBOX_POLL_MS=` line, add:

```bash

# The notice mail. When a bot needs you on its screen (an approval, a question, a takeover, a run
# that ended blocked, a job refused because you still hold the screen), the platform mails this
# address from the bot's mailbox above, with fixed text and no link. Optional: leave NOTIFY_EMAIL
# empty and nobody is mailed. It must not be the bot's own address. MAILBOX_SMTP_HOST is the
# outgoing (SMTP) server of the same mailbox; the port defaults to 465.
NOTIFY_EMAIL=
MAILBOX_SMTP_HOST=
MAILBOX_SMTP_PORT=
```

- [x] Verify the tests pass; `pnpm typecheck`.
- [x] Commit: "Three optional keys switch the notice mail on; a mistake in any of them turns it off and never ends the process".

### Task 4: The takeover says when its wait is real [integration] [demo-path]

**Files:** Modify `src/server/agent/takeover.ts`, `src/server/agent/takeover.test.ts`
**Invariant:** 5 — the takeover itself is unchanged; the hook adds no await and cannot break the wait.
**Demo step:** 15–16 (the takeover notice).
**Verify:** `pnpm exec vitest run src/server/agent/takeover.test.ts && pnpm typecheck`
**Proof (2026-09-18):** commit `766e1b9`. Two of the three new tests failed first on the missing hook. The third ("says nothing when stopped") passes without the hook, so it was proven by mutation: with the hook before the stop check it fails. `takeover.test.ts` 15 of 15, `runner.test.ts` unchanged.

State table for this change (it touches a wait and a stop signal):

| State | Hook |
| ----- | ---- |
| The wait is registered | called once, in the same synchronous block, after `this.waiting` is set |
| Stop arrived while the card or the event was being written | not called: `begin()` takes the stopped branch and registers nothing |
| The hook throws | logged; the wait stands and ends by hand-back or Stop as before |
| Hand-back, Stop after registration, restart | unchanged: the hook has no part in how a wait ends |

- [x] Write the failing tests. In `describe('TakeoverController', …)`, give the `controller` helper two optional parameters and pass them through, `function controller(sandbox: FakeSandbox, signal: AbortSignal = new AbortController().signal, onWaiting?: (trigger: string) => void)`, with `signal,` and `...(onWaiting ? { onWaiting } : {}),` in the deps. Then add:

```ts
  it('tells its owner that the wait is real at the moment it registers it, with the trigger', async () => {
    const sandbox = new FakeSandbox()
    sandbox.companion.states = [start, changed]
    const seen: Array<{ trigger: string; active: boolean }> = []
    const { ctl } = controller(sandbox, undefined, (trigger) => seen.push({ trigger, active: ctl.active }))
    const waiting = ctl.begin('requested', 'the mailbox asks for a password')
    await vi.waitFor(() => expect(ctl.active).toBe(true))
    expect(seen).toEqual([{ trigger: 'requested', active: true }])
    expect(await ctl.handback()).toEqual({ ok: true })
    await waiting
    expect(seen).toHaveLength(1)
  })

  it('says nothing when the run was stopped before the wait is registered: begin() takes its stopped branch', async () => {
    const stop = new AbortController()
    const seen: string[] = []
    const { ctl } = controller(new FakeSandbox(), stop.signal, (trigger) => seen.push(trigger))
    stop.abort()
    expect(await ctl.begin('secret-field', 'password')).toBeNull()
    expect(seen).toEqual([])
    expect(ctl.active).toBe(false)
  })

  it('a hook that throws does not break the wait', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const sandbox = new FakeSandbox()
    sandbox.companion.states = [start, changed]
    const { ctl } = controller(sandbox, undefined, () => {
      throw new Error('hook broke')
    })
    const waiting = ctl.begin('requested', 'sign in')
    await vi.waitFor(() => expect(ctl.active).toBe(true))
    expect(await ctl.handback()).toEqual({ ok: true })
    await expect(waiting).resolves.not.toBeNull()
    expect(warn).toHaveBeenCalledWith('the takeover wait hook threw; the wait stands', expect.objectContaining({ botId: 'b' }))
    warn.mockRestore()
  })
```

  Add `vi` to the `vitest` import and `import { log } from '../log'`.
- [x] Verify the tests fail (`onWaiting` is not a known property; the first test sees no call).
- [x] Implement. In `TakeoverDeps`:

```ts
  /**
   * Called once, at the line that registers the wait, so a takeover that was stopped while its
   * card was being written announces nothing (the notice mail hangs here). It runs inside the
   * wait's own registration: a throw is logged and the wait stands.
   */
  onWaiting?: (trigger: TakeoverTrigger) => void
```

  In `begin()`, replace the executor body `this.waiting = { takeover, cardId: posted.id, reason, resolve }` with:

```ts
          this.waiting = { takeover, cardId: posted.id, reason, resolve }
          try {
            this.deps.onWaiting?.(trigger)
          } catch (e) {
            log.warn('the takeover wait hook threw; the wait stands', { botId: this.deps.botId, runId: this.deps.runId, ...errorFields(e) })
          }
```

- [x] Verify the tests pass; the whole `takeover.test.ts` and `runner.test.ts` still pass; `pnpm typecheck`.
- [x] Commit: "A takeover tells its owner when its wait is real, at the line that registers it".

### Task 5: The Runner calls the human at five points [integration] [demo-path]

**Files:** Modify `src/server/agent/runner.ts`, `src/server/agent/runner.test.ts`
**Invariant:** 4 — the model cannot choose the recipient, the text or the moment; a notice goes out only where a need is real. 5 — no model text in the mail, proven end to end through the real library. The run's waits, Stop and the approval gate are unchanged: every existing Runner test still passes.
**Demo step:** 8, 13, 15.
**Verify:** `pnpm exec vitest run src/server/agent/runner.test.ts && pnpm typecheck`
**Proof (2026-09-18):** commit `0de57f1`. 14 of the 21 new tests failed first on the missing notices. The seven "no notice" tests were proven by mutation: 6c fails without the second look at the hold; 6b and 6c fail with the mark cleared at the end of a hold and no second look; 6 fails with no mark; 7 and 8 fail with the hook before the stop check; 10 fails without the pending check; 12 fails with a notice for every trigger. `runner.test.ts` 56 of 56, preflight 542. Found on the way: with the second look in place, a mark cleared at the end of a hold passes every test too, because a late refusal sets no mark; both designs are correct now, and the approved one is kept.

State table for this change (it touches waits, a stop signal, a promise nothing awaits and state kept across runs):

| State | What happens | Covered by |
| ----- | ------------ | ---------- |
| A wait starts (approval, question, takeover by `requested` or `secret-field`) | `notify` is called in the same synchronous block as the registration | tests 1–4 |
| The run was stopped before the wait | the closures return before the hook; `begin()` never calls `onWaiting` | tests 7–9 |
| The approval was decided while its card was being written, or the rules allow it | no wait starts, no notice | tests 10, 11 |
| The user started the takeover himself | no notice | test 12 |
| A run ends `stuck` or `budget` from the loop | one `blocked` notice after `runLoop` returned | test 5 |
| The daily budget refuses the run | no notice (D13) | test 13 |
| A goal is refused because a human holds the screen | one `refused` notice per hold | test 6 |
| A hold ends while a goal's screen check is still out, and the check then refuses the goal | the late refusal sends nothing new, and the next hold starts with no mark: the mark is reset where a hold starts, never where one ends | test 6b |
| The same race with no earlier refusal in that hold: the first refusal is decided after the hold has ended | no notice, because "its screen is still held for you" would be false, and no mark; the goal is still refused, and the chat says why | test 6c |
| The notifier never resolves | the wait and the run go on | test 14 |
| The notifier resolves `unconfirmed`, or throws | one neutral status card; the run goes on | tests 15, 16 |
| The status card cannot be written | logged; no unhandled rejection | test 17 |
| Restart | holds and marks live in memory and vanish together; no notice at boot | by construction: nothing is persisted |

- [x] Write the failing tests. Change the harness so a test can hand in a notifier, the approvals registry and a store:

```ts
function runnerWith(factory: SessionFactory, model: FakeModel, tools: ToolDef[] = [], now?: () => Date, events = new BotEvents(), extra: { notifier?: NotifierPort; approvals?: Approvals; store?: Store } = {}): Runner {
  const used = extra.store ?? store
  const sandboxes = new SandboxManager(used, events, { py: '', js: '' }, LIMITS.timezone, { factory })
  return new Runner({ store: used, events, approvals: extra.approvals ?? new Approvals(), queue: new RunQueue(), sandboxes, model, modelId: 'claude-sonnet-5', tools, ...LIMITS, ...(now ? { now } : {}), ...(extra.notifier ? { notifier: extra.notifier } : {}) })
}
```

  In the describe block 'a takeover of an idle bot from the page', give its helper one optional parameter, `async function idleRunner(notifier?: NotifierPort)`, and add `...(notifier ? { notifier } : {}),` to the Runner deps it builds. Then add this test to that block (it needs the helper's injected presence timer):

```ts
  // Review of the plan, 2026-09-18: the refusal is decided after an awaited screen check, and the
  // presence timer or a hand-back can end the takeover while that check is out. A mark cleared at
  // the end of a hold was set again by the late refusal, and the next hold stayed silent.
  it('6b. a hold that ends during a goal\'s screen check leaves no mark behind: the next hold still gets its notice', async () => {
    const notices: Notice[] = []
    const notifier: NotifierPort = { notify: async (n) => (notices.push(n), 'confirmed') }
    const t = await idleRunner(notifier)
    const unsafe = { url: 'https://example.com/login', fingerprint: 'x', unsafe: true }
    const refuse = async () => expect((await t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' }))?.outcome).toBe('blocked')
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    t.sandbox.companion.states = [unsafe]
    await refuse()
    expect(notices.filter((n) => n.need === 'refused')).toHaveLength(1)

    // The next goal's screen check stays out until the test lets it answer.
    let answer!: (state: typeof unsafe) => void
    const companion = t.sandbox.companion
    const scripted = companion.pageState.bind(companion)
    let held = false
    companion.pageState = async () => (held ? scripted() : ((held = true), new Promise((resolve) => (answer = resolve))))
    const late = t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' })
    await vi.waitFor(() => expect(answer).toBeDefined())
    // Nobody has asked about hand back for over a minute: the presence timer ends the takeover now.
    t.clock.now += HOLD_PRESENCE_MS + 1
    t.presence.at(-1)?.fn()
    answer(unsafe)
    expect((await late)?.outcome).toBe('blocked')

    // A new hold. Its first refused goal must call the human.
    const before = notices.filter((n) => n.need === 'refused').length
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    await refuse()
    expect(notices.filter((n) => n.need === 'refused')).toHaveLength(before + 1)
  })
```

  And this one, in the same block:

```ts
  // Review of the plan, 2026-09-18, fourth round: test 6b starts with an earlier refusal, so the
  // mark is already set when the hold ends. Without one, the late refusal was the first of its
  // hold and announced a screen that was no longer held.
  it('6c. a first refusal decided after its hold has ended calls nobody, and the next hold still gets its notice', async () => {
    const notices: Notice[] = []
    const notifier: NotifierPort = { notify: async (n) => (notices.push(n), 'confirmed') }
    const t = await idleRunner(notifier)
    const unsafe = { url: 'https://example.com/login', fingerprint: 'x', unsafe: true }
    const refused = () => notices.filter((n) => n.need === 'refused')
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    t.sandbox.companion.states = [unsafe]

    // The first goal's screen check stays out until the test lets it answer.
    let answer!: (state: typeof unsafe) => void
    const companion = t.sandbox.companion
    const scripted = companion.pageState.bind(companion)
    let held = false
    companion.pageState = async () => (held ? scripted() : ((held = true), new Promise((resolve) => (answer = resolve))))
    const late = t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' })
    await vi.waitFor(() => expect(answer).toBeDefined())
    t.clock.now += HOLD_PRESENCE_MS + 1
    t.presence.at(-1)?.fn()
    answer(unsafe)
    // The page is still not safe, so the goal is refused; but nobody holds the screen any more.
    expect((await late)?.outcome).toBe('blocked')
    expect(refused()).toEqual([])

    // A new hold. Its first refused goal must call the human: the late refusal left no mark.
    expect(await t.runner.beginIdleTakeover(botId)).not.toBeNull()
    expect((await t.runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' }))?.outcome).toBe('blocked')
    expect(refused()).toEqual([{ botName: 'Worker', need: 'refused' }])
  })
```

  Add the imports `import { createTransport, type Transporter } from 'nodemailer'`, `import { NOTICE_UNCONFIRMED_TEXT, noticeBody, SmtpNotifier, type Notice, type NoticeOutcome, type NotifierPort } from '../mail/notifier'`, and `ELEMENT_TEXT_INPUT` from `./fakes`. Then append this block:

```ts
// Spec of 2026-09-18, part C. The fake records at the moment notify() is called, which is the
// same synchronous block as the wait's registration, so "no notice" can be asserted the moment a
// run has ended, with no sleep.
class FakeNotifier implements NotifierPort {
  notices: Notice[] = []
  behaviour: NoticeOutcome | 'never' | 'throw' = 'confirmed'
  notify(notice: Notice): Promise<NoticeOutcome> {
    this.notices.push(notice)
    if (this.behaviour === 'throw') throw new Error('notifier broke')
    if (this.behaviour === 'never') return new Promise(() => undefined)
    return Promise.resolve(this.behaviour)
  }
}

const PROPOSE = toolUse('propose_action', { kind: 'send', summary: 'Send https://evil.example/now', consequences: [], warnings: [], target: 'Odeslat https://evil.example' })
const statusCards = async () => (await store.readChat(botId, { limit: 30 })).flatMap((m) => (m.card?.card === 'status' ? [m.card.text] : []))

describe('calling the human', () => {
  it('1. an approval wait sends one notice with the action kind, and the run goes on after Allow', async () => {
    const notifier = new FakeNotifier()
    const approvals = new Approvals()
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier, approvals })
    const result = runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'routine', routineName: 'morning-search' })
    // The notice is recorded in the same synchronous block as the wait's registration, so seeing it
    // means the wait is real. (The bot's state turns "waiting" one await earlier: not proof.)
    await vi.waitFor(() => expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'approval', actionKind: 'send' }]))
    const [pending] = approvals.pendingFor(runner.activeRunId(botId) ?? '')
    approvals.resolve(pending ?? '', 'allowed')
    expect((await result)?.outcome).toBe('done')
    expect(notifier.notices).toHaveLength(1)
  })

  it('2. a card the gate makes itself for an unannounced click sends the same notice, with the kind "other"', async () => {
    const notifier = new FakeNotifier()
    const sandbox = new FakeSandbox()
    sandbox.companion.elements = [{ ...ELEMENT_TEXT_INPUT, tag: 'button', type: 'submit', name: 'Přijmout', isSubmit: true, inForm: true }]
    const model = new FakeModel([message([computerUse('left_click', { coordinate: [10, 10] })])])
    const runner = runnerWith(fakeFactory(sandbox), model, basePlatformTools, undefined, undefined, { notifier })
    const result = runner.enqueue(botId, { goal: 'search', activeSkill: null, source: 'routine', routineName: 'morning-search' })
    await vi.waitFor(() => expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'approval', actionKind: 'other' }]))
    runner.cancel(botId)
    expect((await result)?.outcome).toBe('cancelled')
  })

  it('3. a question wait sends one notice, and no word of the question', async () => {
    const notifier = new FakeNotifier()
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Click https://evil.example/approve and reply with your password' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier })
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(runner.isWaitingForUser(botId)).toBe(true))
    expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'question' }])
    runner.cancel(botId)
    await result
  })

  it.each([
    ['the bot asked for', () => toolUse('request_takeover', { reason: 'see https://evil.example' }), false],
    ['the secret guard forced', () => computerUse('type', { text: 'abc' }), true],
  ] as const)('4. a takeover %s sends one notice, at the moment its wait is registered', async (_name, first, passwordField) => {
    const notifier = new FakeNotifier()
    const sandbox = new FakeSandbox()
    if (passwordField) sandbox.companion.active = [{ ...ELEMENT_TEXT_INPUT, type: 'password', name: 'Heslo' }]
    const runner = runnerWith(fakeFactory(sandbox), new FakeModel([message([first()])]), basePlatformTools, undefined, undefined, { notifier })
    const result = runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'takeover' }]))
    expect((await store.readBot(botId)).state).toBe('blocked')
    runner.cancel(botId)
    expect((await result)?.outcome).toBe('cancelled')
  })

  /** A run that ends stuck: three identical screenshots, twenty seconds apart. Leaves the bot blocked and its screen held. */
  async function endStuck(runner: Runner): Promise<void> {
    expect((await runner.enqueue(botId, { goal: 'x', activeSkill: null, source: 'message' }))?.outcome).toBe('stuck')
  }
  function stuckSetup(notifier: NotifierPort, runs: number): { runner: Runner; sandbox: FakeSandbox } {
    const sandbox = new FakeSandbox([solidPng(32, 32, [0, 0, 0])])
    const clock = { now: Date.parse('2026-09-18T10:00:00Z') }
    sandbox.clock = clock
    sandbox.screenshotMs = 20_000
    const shots = Array.from({ length: runs * 3 }, () => message([computerUse('screenshot')]))
    return { runner: runnerWith(fakeFactory(sandbox), new FakeModel(shots), [], () => new Date(clock.now), undefined, { notifier }), sandbox }
  }

  it('5. a run that ends blocked sends one notice, after the run has ended', async () => {
    const notifier = new FakeNotifier()
    const { runner } = stuckSetup(notifier, 1)
    await endStuck(runner)
    expect(notifier.notices).toEqual([{ botName: 'Worker', need: 'blocked' }])
  })

  it('6. goals refused while a human holds the screen send one notice per hold, and a new hold sends a new one', async () => {
    const notifier = new FakeNotifier()
    const { runner, sandbox } = stuckSetup(notifier, 2)
    await endStuck(runner)
    const refused = () => notifier.notices.filter((n) => n.need === 'refused')
    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'x', unsafe: true }]
    for (const routineName of ['check-mail', 'check-mail', 'morning-search']) expect((await runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName }))?.outcome).toBe('blocked')
    expect(refused()).toEqual([{ botName: 'Worker', need: 'refused' }])
    // The human hands back and the hold ends. The next run ends stuck again: a new hold, which starts with no mark.
    sandbox.companion.states = [{ url: 'https://example.com/inbox', fingerprint: 'y', unsafe: false }]
    expect(await runner.handback(botId)).toEqual({ ok: true })
    await endStuck(runner)
    sandbox.companion.states = [{ url: 'https://example.com/login', fingerprint: 'z', unsafe: true }]
    expect((await runner.enqueue(botId, { goal: 'go', activeSkill: null, source: 'routine', routineName: 'check-mail' }))?.outcome).toBe('blocked')
    expect(refused()).toHaveLength(2)
  })

  // The three windows of review finding F1 (2026-09-17): Stop lands after the tool started and
  // before its wait is registered. The run must end cancelled, and nobody may be called.
  it('7. an approval proposed after the stop sends nothing', async () => {
    const notifier = new FakeNotifier()
    let runner!: Runner
    let stopped: boolean | null = null
    // The screenshot for the card is the tool's last await before it proposes the approval.
    class StopDuringScreenshot extends FakeSandbox {
      override async screenshot(): Promise<Uint8Array> {
        stopped = runner.cancel(botId)
        return super.screenshot()
      }
    }
    runner = runnerWith(fakeFactory(new StopDuringScreenshot()), new FakeModel([message([PROPOSE])]), basePlatformTools, undefined, undefined, { notifier })
    expect((await runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' }))?.outcome).toBe('cancelled')
    expect(stopped).toBe(true)
    expect(notifier.notices).toEqual([])
  })

  it('8. a question posted before the stop sends nothing', async () => {
    const notifier = new FakeNotifier()
    const events = new BotEvents()
    let runner!: Runner
    let stopped: boolean | null = null
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event === 'chat' && event.data.text === 'Which company?') stopped = runner.cancel(botId)
    })
    runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([message([toolUse('ask_user', { question: 'Which company?' })])]), basePlatformTools, undefined, events, { notifier })
    expect((await runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' }))?.outcome).toBe('cancelled')
    unsubscribe()
    expect(stopped).toBe(true)
    expect(notifier.notices).toEqual([])
  })

  it('9. a takeover stopped while its card was being written sends nothing', async () => {
    const notifier = new FakeNotifier()
    const events = new BotEvents()
    let runner!: Runner
    let stopped: boolean | null = null
    // The started event is the controller's last await before it registers the waiter.
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event === 'run' && event.data.type === 'takeover' && event.data.status === 'started') stopped = runner.cancel(botId)
    })
    runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([message([toolUse('request_takeover', { reason: 'sign in' })])]), basePlatformTools, undefined, events, { notifier })
    expect((await runner.enqueue(botId, { goal: 'read the mail', activeSkill: null, source: 'message' }))?.outcome).toBe('cancelled')
    unsubscribe()
    expect(stopped).toBe(true)
    expect(notifier.notices).toEqual([])
  })

  it('10. an approval decided while its card was being written starts no wait and sends nothing', async () => {
    const notifier = new FakeNotifier()
    const approvals = new Approvals()
    const events = new BotEvents()
    const unsubscribe = events.subscribe(botId, (event) => {
      const card = event.event === 'chat' ? (event.data as { card?: { card?: string; approvalId?: string; status?: string } }).card : undefined
      if (card?.card === 'approval' && card.status === 'pending' && card.approvalId) approvals.resolve(card.approvalId, 'allowed')
    })
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events, { notifier, approvals })
    expect((await runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    unsubscribe()
    expect(notifier.notices).toEqual([])
  })

  it('11. a proposal the rules allow starts no wait and sends nothing', async () => {
    await writeFile(rulesFile(dataDir, botId), JSON.stringify({ requireApproval: [], alwaysAllow: ['send'] }))
    const notifier = new FakeNotifier()
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier })
    expect((await runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' }))?.outcome).toBe('done')
    expect(notifier.notices).toEqual([])
  })

  // The first draft of this test pressed Stop at the takeover's "started" event, which comes before
  // the wait is registered: it would have passed even if a manual takeover did call the human. This
  // one lets the wait register and ends it by a hand-back, and the run log proves which way it ended.
  it('12. a takeover the user started himself sends nothing, from its registered wait to its hand-back', async () => {
    const notifier = new FakeNotifier()
    const events = new BotEvents()
    let runner!: Runner
    const unsubscribe = events.subscribe(botId, (event) => {
      if (event.event === 'run' && event.data.type === 'tool_result' && event.data.name === 'remember') runner.requestTakeover(botId)
    })
    const model = new FakeModel([message([toolUse('remember', { note: 'x' })]), message([textBlock('done')], 'end_turn')])
    runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, events, { notifier })
    const accepted = await runner.accept(botId, { goal: 'note', activeSkill: null, source: 'message' })
    // A hand-back before the wait is registered does nothing, so hand back until the run has moved on.
    await vi.waitFor(async () => {
      await runner.handback(botId)
      expect(model.calls).toHaveLength(2)
    })
    unsubscribe()
    expect((await accepted.done)?.outcome).toBe('done')
    const takeovers = (await store.readRunEvents(botId, accepted.runId)).flatMap((e) => (e.type === 'takeover' ? [`${e.status}:${e.reason}`] : []))
    expect(takeovers).toEqual(['started:manual', 'ended:handed back'])
    expect(notifier.notices).toEqual([])
  })

  it('13. the daily-budget refusal sends nothing: no action on the screen can help it', async () => {
    const notifier = new FakeNotifier()
    await seedRun(store, botId, 'run-earlier', '2026-09-18T07:00:00Z', [25.2])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), new FakeModel([]), [], () => new Date('2026-09-18T10:00:00Z'), undefined, { notifier })
    expect((await runner.enqueue(botId, { goal: 'search', activeSkill: null, source: 'routine', routineName: 'morning-search' }))?.outcome).toBe('budget')
    expect(notifier.notices).toEqual([])
  })

  it('14. a notifier that never answers delays nothing: the wait starts and Allow ends it', async () => {
    const notifier = new FakeNotifier()
    notifier.behaviour = 'never'
    const approvals = new Approvals()
    const model = new FakeModel([message([PROPOSE]), message([textBlock('done')], 'end_turn')])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier, approvals })
    const result = runner.enqueue(botId, { goal: 'send it', activeSkill: null, source: 'message' })
    // First see the hanging notifier called: an approval exists from propose() on, several awaits
    // before the wait, and an Allow that early would end the test without ever reaching the notifier.
    await vi.waitFor(() => expect(notifier.notices).toHaveLength(1))
    approvals.resolve(approvals.pendingFor(runner.activeRunId(botId) ?? '')[0] ?? '', 'allowed')
    expect((await result)?.outcome).toBe('done')
    expect(notifier.notices).toHaveLength(1)
  })

  it.each(['unconfirmed', 'throw'] as const)('15–16. a notice that is %s leaves one neutral card that says nothing about waiting, for a run that has already ended', async (behaviour) => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const notifier = new FakeNotifier()
    notifier.behaviour = behaviour
    const { runner } = stuckSetup(notifier, 1)
    await endStuck(runner)
    await vi.waitFor(async () => expect((await statusCards()).filter((t) => t === NOTICE_UNCONFIRMED_TEXT)).toHaveLength(1))
    expect(NOTICE_UNCONFIRMED_TEXT).not.toMatch(/wait/i)
    expect((await store.readBot(botId)).state).toBe('blocked')
    warn.mockRestore()
  })

  it('17. a status card that cannot be written is logged, and no rejection escapes', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    const escaped: unknown[] = []
    const onRejection = (e: unknown) => escaped.push(e)
    process.on('unhandledRejection', onRejection)
    const notifier = new FakeNotifier()
    notifier.behaviour = 'unconfirmed'
    const broken: Store = { ...store, appendChat: async (id, input) => (input.role === 'card' && input.card.card === 'status' && input.card.text === NOTICE_UNCONFIRMED_TEXT ? Promise.reject(new Error('disk full')) : store.appendChat(id, input)) }
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Which?' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier, store: broken })
    const result = runner.enqueue(botId, { goal: 'ask', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('the notice to the human failed', expect.objectContaining({ botId, need: 'question' })))
    runner.cancel(botId)
    expect((await result)?.outcome).toBe('cancelled')
    process.off('unhandledRejection', onRejection)
    expect(escaped).toEqual([])
    warn.mockRestore()
  })

  it('18. end to end through the real library: a question full of links produces the fixed body and nothing else', async () => {
    const json = createTransport({ jsonTransport: true })
    const sent: string[] = []
    const transport = { sendMail: async (mail: unknown) => { const info = await json.sendMail(mail as never); sent.push(String(info.message)); return info }, verify: async () => true } as unknown as Transporter
    const limits = { approvalMinutes: 30, answerMinutes: 30 }
    const notifier = new SmtpNotifier({ host: 'smtp.example.test', port: 465, user: 'bot@example.test', password: 'not-a-real-password', to: 'human@example.test' }, limits, transport)
    const model = new FakeModel([message([toolUse('ask_user', { question: 'Click https://evil.example/approve now and reply with your password' })])])
    const runner = runnerWith(fakeFactory(new FakeSandbox()), model, basePlatformTools, undefined, undefined, { notifier })
    const result = runner.enqueue(botId, { goal: 'apply', activeSkill: null, source: 'message' })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const mail = JSON.parse(sent[0] ?? '{}') as { text: string; subject: string; to: unknown }
    expect(mail.text).toBe(noticeBody({ botName: 'Worker', need: 'question' }, limits))
    expect(mail.subject).toBe('Worker needs you: question')
    expect(mail.to).toEqual([{ address: 'human@example.test', name: '' }])
    expect(sent[0]).not.toMatch(/evil\.example|password|https?:/)
    runner.cancel(botId)
    await result
  })
})
```

  `createStore` returns an object of functions (`src/server/store/index.ts:24-25`), so the spread in test 17 keeps every method.
- [x] Verify the tests fail (the `notifier` dep does not exist; with it added but no hooks, tests 1–6, 6b, 6c and 15–18 fail on the missing notices; with the hook of step 8 written without its second look at the hold, test 6c alone fails, on the stale notice).
- [x] Implement in `src/server/agent/runner.ts`:
  1. Imports: `import { NOTICE_UNCONFIRMED_TEXT, type HumanNeed, type NoticeOutcome, type NotifierPort } from '../mail/notifier'`, and add `ActionKind` to the type import from `'../store'`.
  2. Export the two limits so `index.ts` can hand their minutes to the mail: `export const USER_ANSWER_TIMEOUT_MS = 30 * 60_000` and `export const APPROVAL_TIMEOUT_MS = 30 * 60_000`.
  3. In `RunnerDeps`: `/** Calls the human by mail when a bot needs their action on the screen; absent, nobody is mailed (NOTIFY_EMAIL). */ notifier?: NotifierPort`.
  4. A field: `/** Bots whose human was already told, during the current hold of their screen, that a goal was refused: one notice per hold. Reset where a hold starts, never where one ends: the refusal is decided after an awaited screen check, and a hold can end while that check is out. */ private readonly refusedNotified = new Set<string>()`.
  5. Reset the mark where a hold starts, in exactly two places: in `beginIdleTakeover`, on the line before `this.idleTakeovers.set(botId, …)`, and in `run()`'s `finally`, on the line before `this.blockedKeepAlives.set(botId, keepAlive)`: `this.refusedNotified.delete(botId)`. Nothing clears it where a hold ends. A refusal never starts a hold of its own (its `keepAlive` is null, so the `finally` sets nothing), and a restart clears the holds and this set together.
  6. The method:

```ts
  /**
   * Calls the human by mail (spec of 2026-09-18, part C). notify() is invoked here and now, in the
   * caller's own synchronous block, so a notice exists exactly when the need does; nothing waits
   * for its outcome. This is called from inside a wait's registration, so it never throws, and the
   * chain ends in a catch because a rejection nobody awaits would end the process. An outcome that
   * is not confirmed leaves one neutral card: it says nothing about waiting, because a blocked or
   * refused run has ended and a wait can end before the outcome is known.
   */
  private callHuman(botId: string, botName: string, need: HumanNeed, actionKind?: ActionKind): void {
    const notifier = this.deps.notifier
    if (!notifier) return
    const { store, events } = this.deps
    let sending: Promise<NoticeOutcome>
    try {
      sending = notifier.notify({ botName, need, ...(actionKind === undefined ? {} : { actionKind }) })
    } catch (e) {
      // The error's name only: a notifier's error text can quote an address or a server's answer.
      log.warn('the notifier threw; the notice counts as unconfirmed', { botId, need, errorName: errorFields(e).errorName })
      sending = Promise.resolve('unconfirmed')
    }
    void sending
      .then(async (outcome) => {
        log.info('notice to the human', { botId, need, outcome })
        if (outcome === 'confirmed') return
        events.emitChat(await store.appendChat(botId, { role: 'card', card: { card: 'status', text: NOTICE_UNCONFIRMED_TEXT } }))
      })
      .catch((e: unknown) => log.warn('the notice to the human failed', { botId, need, errorName: errorFields(e).errorName }))
  }
```

  7. In `run()`, as the first statement inside the `try`: `const botName = (await store.readBot(botId)).name`. The hooks below run inside synchronous registrations, so the name must be in hand before them.
  8. The `refused` hook, in the `!screen.allowed` branch, before `endedBlocked = true`:

```ts
          // Looked at again here, after the awaited screen check: the hold can have ended while the
          // check was out, and "its screen is still held for you" must be true when it is sent. A
          // refusal that comes too late sends nothing and sets no mark.
          const stillHeld = humanOnScreen === 'blocked' ? this.blockedKeepAlives.has(botId) : this.idleTakeovers.has(botId)
          if (stillHeld && !this.refusedNotified.has(botId)) {
            this.refusedNotified.add(botId)
            this.callHuman(botId, botName, 'refused')
          }
```

     The refusal itself does not change: the page is not safe, so the goal does not start, whoever holds the screen. If a new hold of the same kind began while the check was out, `stillHeld` is true, its mark was reset at its start, and the notice is true for that hold.

  9. The takeover hook, in the `TakeoverController` deps: `onWaiting: (trigger) => { if (trigger === 'requested' || trigger === 'secret-field') this.callHuman(botId, botName, 'takeover') },`.
  10. `waitForUser`: inside the executor, after `this.userWaiters.set(botId, { resolve, timer })`: `this.callHuman(botId, botName, 'question')`.
  11. `waitForApproval`, after the stop branch:

```ts
          const timer = setTimeout(() => approvals.resolve(approvalId, 'denied'), APPROVAL_TIMEOUT_MS)
          // Only a wait that really starts calls the human: a decision that came in while the card
          // was being written makes waitFor resolve at once.
          const proposed = approvals.get(approvalId)
          if (proposed?.status === 'pending') this.callHuman(botId, botName, 'approval', proposed.kind)
          return approvals.waitFor(approvalId).finally(() => clearTimeout(timer))
```

  12. After `endedBlocked = result.outcome === 'stuck' || result.outcome === 'budget'`: `if (endedBlocked) this.callHuman(botId, botName, 'blocked')`. The daily-budget refusal returns before this line and the refused goal returns before it too, so one event never sends two notices.
- [x] Verify the new tests pass and every existing test in `runner.test.ts`, `run.test.ts`, `takeover.test.ts` and `tools.test.ts` still passes; `pnpm typecheck`.
- [x] Commit: "The Runner calls the human at five points, once per need and once per hold, and never waits for the mail".

### Task 6: Wiring, the boot check, the README and a start entry [mechanical] [demo-path]

**Files:** Modify `src/server/index.ts`, `README.md`, `.claude/launch.json`
**Invariant:** 5 — the boot log names no address and no password. Delivery constraint 1 — with the keys empty, boot is as before.
**Demo step:** 8, 13, 15.
**Verify:** `pnpm preflight`
**Proof (2026-09-18):** commit `fd0807a`, review follow-up `b43ed3f`. Preflight 542, then 543 after the review. A real boot with `NOTIFY_EMAIL` unset logged "no notice address configured; nobody is mailed when a bot needs a human" (started with a zero daily budget). The boot with the keys set is live cycle 1 and has not run. Review gate: spec compliance PASS; code reviewer PASS, one suggestion taken (the run id in `callHuman`'s logs); test-quality reviewer PASS, three suggestions taken (`smtpOptions` with a test for ports 465 and 587; test 18 through the real library for the summary, the label, the question and the takeover reason; a direct assertion in test 6b), one left on purpose (no automated test for the wiring in `index.ts`).

- [x] In `src/server/index.ts`: import `noticeSettings` from `./config`, `SmtpNotifier` from `./mail/notifier`, and `APPROVAL_TIMEOUT_MS, USER_ANSWER_TIMEOUT_MS` from `./agent/runner`. Before `const runner`:

```ts
// The notice mail: when a bot needs its human on the screen, the platform mails the operator from
// the bot's mailbox, with fixed text. Off unless NOTIFY_EMAIL is set.
const notice = noticeSettings(config)
const notifier = notice ? new SmtpNotifier(notice, { approvalMinutes: APPROVAL_TIMEOUT_MS / 60_000, answerMinutes: USER_ANSWER_TIMEOUT_MS / 60_000 }) : null
```

  In the Runner's deps add `...(notifier ? { notifier } : {}),`. After the mail watcher block:

```ts
if (notifier) {
  log.info('notice mail is on: the operator is mailed when a bot needs a human on its screen')
  // Nothing waits for the check, and it never rejects: it only puts a wrong setting into the boot log.
  void notifier.verify()
} else {
  log.info('no notice address configured; nobody is mailed when a bot needs a human')
}
```

- [x] In `README.md`, after the paragraph that starts "It also accepts the bot's mailbox", add a paragraph in plain language: the three keys; that a notice is sent for an approval, a question, a takeover, a run that ended blocked and a job refused because you hold the screen, once per hold; that it has fixed text and no link, and the details stay on the page; that it is operator setup on purpose and why. Under "Known limits" add: one attempt and no retry; "unconfirmed" means the platform saw no answer, not that the mail was lost; a Stop does not call a sent notice back; no notice for a used-up daily budget; a notice says that the bot needs you, not what for.
- [x] In `.claude/launch.json`, add a second configuration: `{ "name": "dobot-start", "runtimeExecutable": "env", "runtimeArgs": ["-u", "PORT", "pnpm", "start"], "port": 3000 }`. Live cycle 5 kills the server and starts it again; `pnpm dev` would also restart on a file change, which no live cycle may depend on.
- [x] `pnpm preflight` passes: typecheck, all tests, the companion tests, the grep.
- [x] Commit: "The notice mail is wired in, checked at boot and documented".
- [x] Review gate for milestone 1 (the project's rule): spec-compliance review, then the code reviewer and the test-quality reviewer on Tasks 2–6. Every blocking finding is fixed, with a failing test first, before milestone 2 starts.

### Milestone 2 — Hunter learns the job (configuration by chat; no file under `src/` changes)

Rules for every live cycle: the server runs from a clean `main`; nothing under `src/` is edited while it runs; Claude drives through the API on `localhost:3000` (`POST /api/bots/job-hunt-bot/messages` with `{"text": …}`, `POST …/approvals/<id>` with `{"decision": "allow"|"deny"}`, `POST …/stop`); Claude presses Allow only on a Send card whose recipient is the owner's address and whose text matches the shortlist card, and presses Deny on every submit card; each cycle gets a section in `docs/evidence/2026-09-18-shortlist-and-notices/README.md` with the run ids, steps, cost, the memory lines written and what failed, and the owner's address is masked everywhere in it. The owner's address appears in no file of the repository and in no commit: it lives in `.env.local`, in Hunter's memory under `data/`, and in a goal file in Claude's scratch folder that is deleted after the cycle. Before the first cycle Claude reads today's spend with the project's own `spentToday` and stops a cycle that would pass the daily budget.

### Task 7: Switch the notice on, and see it fail honestly first (live cycle 1) [integration] [demo-path]

**Files:** none in the repository; `.env.local` by the owner's hands.
**Invariant:** 5 — the owner types the three lines himself; Claude never reads `.env.local` and checks only key names with `sed -E 's/=.*/=<set>/'`.
**Demo step:** 8.
**Verify:** the boot log, the owner's inbox, the chat.
**Proof (2026-09-18):** runs `f27a7405` (wrong port: the boot warning with code `ESOCKET`, one neutral card, a working wait), `e2398a99` (right port, refused at `MAIL FROM` with 501: the defect below, fixed in commit `893b68b`) and `6c460da7` (outcome `confirmed`, no card); the owner showed the mail in his inbox with the fixed body and no link. Three runs, $0.15. Record: `docs/evidence/2026-09-18-shortlist-and-notices/README.md`. The evidence is committed with each cycle, not only with Task 14, so the record cannot be lost.

- [x] One step at a time with the owner: he adds `NOTIFY_EMAIL` (his personal address), `MAILBOX_SMTP_HOST` (the outgoing server of the bot's mailbox, from the provider's help page cited in the spec) and, first, a wrong `MAILBOX_SMTP_PORT=2465`.
- [x] Start the server. Pass: the boot log has "notice mail is on" and then the warning "notice mail: sign-in failed" with a code; it names no address.
- [x] Goal by chat: "Ask me one question with ask_user: which colour do I like? Then stop." Pass: the question appears; one status card "I could not confirm that the notice mail for this step went out."; the wait works; answer it; the run ends. About $0.05.
- [x] **Found by this cycle, 2026-09-18 (the proof rule: recorded as it happened, fixed with a failing test first).** With the right port the boot said "sign-in ok", and the first notice still came back unconfirmed: `EENVELOPE` at `MAIL FROM`, response 501. Cause: `MAILBOX_USER` in `.env.local` is a bare login name, and the notice is sent from that value. Fix in `noticeSettings` (`src/server/config.ts`): a mailbox user that is not a plain address turns the notifier off and names the key; the test failed first with the settings returned. The owner then sets `MAILBOX_USER` to the mailbox's full address, and the second half runs again. The pass criterion below is unchanged.
- [x] the owner corrects the port to 465. Restart. Pass: "notice mail: sign-in ok". The same goal again. Pass: the mail "Hunter needs you: question" is in the owner's inbox with the fixed body and no link; no status card this time.
- [x] Record the cycle. No commit yet; the evidence is committed with Task 14.

### Task 8: Teach the shortlist and send the first one (live cycle 2) [integration] [demo-path]

**Files:** Hunter's folder under `data/`, written by Hunter only.
**Invariant:** 7 — by chat; 4 — one Allow on the send; 1 — both lists on the screen; 2 — a real mail in a real inbox.
**Demo step:** 4–9.
**Verify:** the checks below.
**Proof (2026-09-18):** eleven runs, $7.36; record in `docs/evidence/2026-09-18-shortlist-and-notices/README.md`, "Cycle 2". The teaching run `bbcbfb0a` **failed** at the 150-step limit, one or two steps before the Send card (finding A). The send rules then passed on its saved draft: Deny in run `1ee6d591` (one proposal, "Not sent — not approved", nothing in the Sent folder), "Send it" and Allow in run `0a82e31a` (one click, the mailbox's confirmation, then the "sent" line; one recipient). The owner chose "teach a cheaper way by chat"; Claude restated the whole job with the cost rules, Hunter saved `shortlist-and-report` (run `ff72e259`), all eleven rules of the spec are in it, the address moved from the skill into memory, and `morning-search` names the new skill. The run from the scheduler, `0966b615`, passed with nobody typing: 109 of 150 steps, $3.51, a second shortlist with a new code and no repeated offer, the notice, Allow, the confirmation, the "sent" line. Deviations from this task's text, each recorded with its reason in the evidence: the taught goal changed (search addresses, first page only, eight candidates, the cookie rule, twenty steps kept for the mail); Hunter did not offer a skill, so Claude asked for one; the one-off run is a third routine file that Hunter switched off, because it has no tool to delete a routine (finding E). Findings B (the mail watcher fired on Hunter's own draft and sent mails) and the fix: commits `6c9cfbd` and `732c54b`, 553 tests.

- [x] the owner gives his address in chat. Claude writes the goal to a scratch file outside the repository and posts it with `curl --data @file`. The goal, word for word apart from the address:

  "A new job for your mornings, instead of filling a form by yourself. Open the result lists of startupjobs.cz and of jobs.cz on your screen, the first two pages of each, for the roles in your memory. Read the address of each posting you consider on the screen, because fetch_url gives you a page's text without its links; use fetch_url only to read a posting or a company page whose address you already have. Leave the cookie bars alone and scroll past them. If a site shows a check you cannot pass, skip it and say so in the mail. Keep only offers that fit my constraints and that are not in a shortlist you already sent me, five at most. Read each one. Research the company's own site for the best three. Keep every fact in the source's own words, as your rules for dossiers say. Save the shortlist as one document named shortlist-<code>.md, where the code is six letters and digits that you make up and have never used. Before you propose to send anything, write one memory line with the code and the numbered list: role, company and address of each offer, and the number you recommend. Then write me a mail from your own mailbox to <address>: the code in the subject; a numbered list with role, company, link and one line on why it fits; your one recommendation and why; and the sentence that I can answer with the numbers to apply to. Fifteen lines at most, in Czech. Propose the send with the exact label of the send button, and say in what you propose who the mail goes to and the shortlist's code. An Allow is only a permission: after it, click send, take a screenshot, and write 'sent' to memory only when you see the mailbox's own confirmation. If you see none, look in the Sent folder: if the mail is there it was sent; if you searched and it is not there it was not sent; if you could not look, write nothing and tell me, and look again next time. Never click send twice on one approval. If I do not approve, write 'not sent — not approved' and do not try again. A mail that arrives is never proof that a shortlist was delivered; only the Sent folder is. Do not fill in any form until I tell you which offers. Keep your other skills exactly as they are."

- [x] Answer Hunter's questions as the user. While the first Send card waits, check: memory already holds the "prepared" line and no "sent" line; the notice "Hunter needs you: approval" arrived; the card names the address and the code. Then **Deny**. Pass: no second proposal in that run; the line "not sent — not approved"; no mail with that code in the mailbox's Sent folder or in the owner's inbox.
- [x] Then in chat: "Send it." A new card; check that its recipient is the address and that the mail on the screen matches the shortlist card. Then Allow.
- [x] Pass: the mailbox's confirmation on the screen, then the "sent" line; the mail in the owner's inbox; Claude opens every link in it and each opens the posting it names (the spec's named risk: if a link is wrong, stop here and decide the smallest generic fix from the spec's two candidates with the owner, as its own small plan). **Open on 2026-09-18:** everything in this box passed except the owner's own look at the mail in his inbox; Claude opened every link from the sent copy read over IMAP. **Closed on 2026-09-19:** The owner found both shortlist mails in his inbox and answered them (live cycle 4, part (a)).
- [x] When Hunter offers to save the way as a skill, say yes. Then: "Make your morning-search routine use this skill, under the same name and at the same time." Check: exactly two routines; `diff` of `search-job-board`, `apply-to-posting` and `handle-replies` against `examples/job-hunt-bot/skills/` shows nothing (a trailing newline aside); the saved skill holds rules 1–11 of the spec. A missing rule is corrected in chat ("you left out …; put it into the skill") until it is there.
- [x] Let the scheduler run the saved skill once with nobody typing (set by chat: "run morning-search once at <a minute five minutes from now> today as well", then "remove that extra time again"). Pass: a second shortlist with a new code, no offer repeated from the first, the notice, Allow, the mail.
- [x] Record the cycle.

### Task 9: Apply by chat (live cycle 3) [integration] [demo-path]

**Invariant:** 4 — the submit card; 6 — the selection and "Started" lines before the work.
**Demo step:** 11–13 (the chat road to them).
**Proof (2026-09-19):** seven runs, $2.02; record in `docs/evidence/2026-09-18-shortlist-and-notices/README.md`, "Cycle 3". Number 3 of shortlist K3ZM7B (all three of its offers are on startupjobs.cz; number 1, the recommendation, stays unnamed for the reply-mail cycle). The first order passed in one run (`e082fdb0`, 36 computer steps, $1.11): the question which of the two sent shortlists is meant, the selection line, the "Started" line, the dossier and letter cards, the form, the CV, the notice, the card for "Odeslat zájem", Deny, "Handed to the user …", the report. Hunter did not offer a skill, so Claude asked for one; Hunter saved `apply-from-shortlist-selection`; three gaps against the spec (the report names every number of the selection, "continue" in chat, the Sent folder before a chat order on a shortlist with unknown delivery) and one wrong definition of "open" were corrected by chat, each rewrite checked with a word-level `diff`. The second order **failed** on its first attempt (`5dfbb4c6`): the card was right and quoted the earlier hand-off, but the selection line and the "Started" line were written only after the Deny (finding I). After a correction by chat (four sentences in the skill) the same order passed (`aa2323b8`): selection K3ZM7B/3, the "Started" line with the address, then the card with both earlier hand-offs as a warning, Deny. Deviations from this task's text, each with its reason in the record: the save request repeats the rules in full (a new goal carries six chat lines cut at 1,000 characters), and the skill got a clock rule, because the platform gave the model no date (finding F). Finding F was fixed in the platform the same morning on the owner's word (commit `4db979b`: the first message of a run begins with the platform's clock), checked live in three runs ($0.29), and the skill's clock rule now points at that line; with them the cycle cost ten runs and $2.31. The three old skills are unchanged.

- [x] Goal by chat, word for word: "Apply to number <n> of your last shortlist. From now on this is how you handle such an order, from the chat or from a reply mail. First find the shortlist: I may name its code or its day; if I name none and you sent exactly one shortlist in the last seven days, take that one; otherwise ask me and say what the number means in each candidate. A number that is not on the list: ask me. Then write a memory line 'Selection <code>/<count> on <date>: numbers … of shortlist <code>, from the chat' before any other work. For each number, two in one run at most: first write 'Started on <date>: number <n> of shortlist <code> (<address>), selection <code>/<count>'. Then read the posting, research the company, write the dossier, the claim checklist and the letter by the rules in your skill search-job-board; its search part and its last sentence do not apply here. Then, for a posting on startupjobs.cz, follow apply-to-posting exactly as it is. For a posting on any other site you have no skill for its form: open no form, and write 'Prepared on <date>: dossier and letter for <company> at <address>; the form on that site is not learned yet'. Before you start a number, look at memory for this selection only: a 'Started' line that names this selection and this number, with a later outcome for the same address, means it is finished, skip it; such a 'Started' line with no outcome and no 'Left' line after it means you do not know how it ended: never apply to it again by yourself. An outcome that an earlier selection left for the same address is history, not the state of this order: when I order that number again in chat it is a new attempt, so do it as asked and put the earlier outcome on the card as a warning. From a reply mail it is different, because a mail never opens a second attempt on a number: leave out every number that another selection of that shortlist already names, whatever its state there — open, started, uncertain, left or finished — name it in your report, and I can order it again in chat. And before you start a number of a selection that came from a mail, look once at the other selections of that shortlist: if any of them names the same number, do not start it; write 'Covered on <date>: number <n> of shortlist <code>, selection <code>/<count>: selection <code>/<other count> names it too', and name it in the report. An order from the chat is never covered. Look in the inbox for the site's confirmation mail, ask me once whether to try again or leave it, and if I say leave it or do not answer, write 'Left on <date>: number <n> of shortlist <code> (<address>): no record of how it ended; confirmation mail found / not found; the user said to leave it / did not answer'. If I say try again, write a new 'Started' line and put the warning 'an earlier attempt on <date> may have been submitted' on the card. End with a report that names every number: finished and how, left, covered, prepared only, or still open." Number `<n>` is an offer on startupjobs.cz.
- [x] Pass: the selection line, then the "Started" line, then the dossier and letter cards, the form filled, the CV attached, the notice, the card for "Odeslat zájem"; Deny; the line "Handed to the user …"; the report. When Hunter offers to save the way as a skill, yes.
- [x] A new chat order for the same number: "Apply to number <n> again." Pass: a new selection line with the next count; a new "Started" line; the card again, with the earlier hand-off quoted as a warning; Deny. It is not skipped as finished. Check the saved skill against the spec's `apply-from-shortlist` rules; correct by chat what is missing; `diff` the three old skills again.
- [x] Record the cycle.

### Task 10: Apply by reply mail (live cycle 4) [integration] [demo-path]

**Final verification, 2026-09-20:** the remaining state checks and both final replays passed. The report correction lives in Hunter's skill/routine; earlier failures are retained below as history. Run IDs, safe test variations and results are in `docs/evidence/2026-09-19-hunter-mail-checks/README.md`.

**Invariant:** 4 — a mail can only name numbers, and each ends at a card; a wrong sender is refused, not warned about (D8); a mail is never proof of delivery (D14).
**Demo step:** 10–13.
**Progress (2026-09-19, evening):** the teaching and its check are done: five runs, $0.72, no computer step; record in `docs/evidence/2026-09-18-shortlist-and-notices/README.md`, "Cycle 4". Both messages landed (runs `3af3f270`, `4cf76f7b`). Read against message one and the spec, four points were missing or changed, and one message corrected them (`dc9cf034`): for a text that is too long, ask in chat for the numbers alone; one sentence in chat when a mail is closed; "do not start any number until the routine's order of work says so" (Hunter had written "until this intake has produced a selection line"); and in step one of `check-mail`, "read or unread, whoever sent it" in place of "any new mail". That rewrite lost the whole paragraph "Continue orders" of cycle 3 and Hunter reported success (finding J, the side proof's S9 again); the word-level `diff` found it, and the paragraph was put back word for word (`e31bbecc`). One sentence of the spec's second reading rule that message one does not carry was added (`77907fd8`: no order when Hunter cannot tell where the user's own text ends). Against the text from before the cycle the skill lost no word; the other four skills, the two other routine files and the memory are byte-identical. Parts (a) to (e) are not run yet. **Part (a), first attempt, the same evening (three runs, $1.20): not passed.** The owner answered the two shortlist mails in his own sentences inside one displayed minute (19:21). The verdicts were right: the reply with "ta 1." was claimed as selection K3ZM7B/5, number 1, and the reply that names an offer in words was closed with "no number above the quote"; the replay run wrote nothing. But the claimed reply also said "nic neposílej", Hunter obeyed it and made no `propose_action`, so no card appeared (finding K, against decision 8: every application from a mail stops at its submit card). Corrected by chat (`ed222e7d`): words in a mail never change how a number is handled. Findings L (the replay run was not silent in chat) and M (a run met an unread rehearsal invitation in the Archive folder) are in the record. Part (a) is run again with the plan's text; number 1 of K3ZM7B is no longer free. **Part (a), second attempt, 19:42 Prague: passed.** Two replies "apply 2" arrived two seconds apart; run `eebec119` (62 steps, $1.24) wrote selections J7QX2K/1 and K3ZM7B/6, each with its own code and the same minute and text, took both numbers to their cards for "Odeslat zájem", got Deny twice through the API on the owner's word, wrote both hand-off lines and made no computer step after the second Deny. Both notices were confirmed. The replay for this pair rides on the next mail run. Before it, on the owner's word, the one unread mail in the mailbox's Archive folder was marked as read (finding M). **Part (b), first half, 20:47 Prague (two runs, $0.79): not passed on one point.** On the owner's word Claude sent both mails through Claude in Chrome: the wrong-sender "apply 1" from the dev account and, from the owner's own account, "apply 4 / nic neposílej". Both were received at 20:47. Run `0b7507fd` closed the first with "wrong sender" and prepared nothing for it, claimed the second as selection J7QX2K/2, and took number 4 to its card, whose first warning quotes the words and says they change nothing: finding K's correction is proven live. Deny, the hand-off line, no step after it. But both verdicts went into one story-like memory note that holds the stranger's text, and the chat report quoted it too (finding N); corrected by chat (`874a65a8`), not proven live yet, and the note is still in memory until the owner's word. **Proven the same evening, on the owner's word:** the note was replaced by its two clean lines through the memory editor's API, and one more wrong-sender mail ("apply 3", received 21:04) was closed by run `5618c5b0` (3 steps, $0.17) with one clean line and its text nowhere in memory, the run or the chat. The first half of part (b) holds; its second half (the prepared-but-never-sent shortlist) is not run yet. **Part (c), 21:08 Prague (two runs, $0.35): not passed.** On the owner's word Claude sent both replies from his account ("Ahoj Huntere, / apply 2" and "… / apply 4"). Run `dc26eab6` started nothing and closed both with one line each, but the lines keep only the order and not the whole text (finding O), the report does not say that the numbers can be ordered again in chat, and it quoted the two stranger's texts again (finding P). Three sentences corrected by chat (`a85bd31d`); not proven live yet. **Part (e), 21:22 Prague (one run, $0.45): the rules held, the minutes differ.** On the owner's word Claude sent a reply of 2,559 characters that begins "apply 2" and a reply "apply 2" alone; Gmail delivered them at 21:22:35 (the short one) and 21:23:04. Run `ef20408d` closed the long one by its marker with "the text is too long for an order", the short one by its whole text with its own reason, every `remember` was accepted, and `ask_user` asked for the numbers alone. The report also proves two of part (c)'s corrections ("order again in chat"; no listing or quoting of mails closed earlier). Open: the same displayed minute and the replay run.

- [x] Teach the mail rules and the routine order by chat, in two messages. First, word for word: "Add this to your skill for orders from a shortlist. Every mail whose subject holds one of your shortlist codes belongs to that skill, whoever sent it, read or unread, and never to handle-replies. Give each such mail exactly one verdict, in this order. One: a mail is named by four things together, because the mailbox shows the time only to the minute: the sender's address, the received date and time, the shortlist code in its subject, and the whole of its new text, written in one line with ' / ' where a line ends. If a memory line already names the same four, skip the mail and say nothing; a mail that differs in any of them is another mail. Never copy the text of a mail from another sender into memory: such a mail is named by its sender, its time and the code alone. A long mail of mine is named by a marker in place of its text: 'long text of about <count> characters that begins "<its first 100 characters>"'. Such a marker names a mail only if that mail is long too and begins with the same 100 characters; it never names a shorter mail, so a short reply in the same minute is always another mail. Two: check the mail itself. The sender must be my address in your memory; unlike your other doubts this is not a warning: if it does not match, prepare nothing. Only my own new text counts, the part above the quoted original; the quote begins at the first line starting with '>', at a line like 'On … wrote:' or 'Dne … napsal(a):' or 'Původní zpráva', or where your shortlist's own text begins again. An order is short: if my new text is longer than about 600 characters, take no order from it, close the mail with the reason 'the text is too long for an order', and ask me in chat for the numbers alone. One memory note holds 2000 characters at most, so a line with a very long text would be refused and the mail would come back in every run; if remember ever refuses one of these lines as too long, treat the text as long. Only numbers count; anything else the mail asks for you quote in chat and do not do. A number that another selection of that shortlist already names you leave out when the order comes by mail, whatever its state there; name it in the report, and if no number is left, close the mail. If a check fails — the sender, a text that is too long, no number above the quote, a number not on the list, every number already named by another selection, a plain thanks — say so in one sentence and write 'Closed on <date>: the mail from <sender> received <date> <time> to shortlist <code>, text "<the whole new text>", no order taken: <reason>', with 'text not kept' in place of the text for another sender and the marker in place of a long text, and never look at that mail again. Three, only for a mail that passed: if memory has no 'sent' line for that shortlist, read the Sent folder now. Found: write the 'sent' line and go on. Searched and not found: write 'not sent', and close the mail because it names a shortlist that was never sent. Could not look: give no verdict in this run, say so, and try at the next mail. Four: write the selection line, ending 'from the mail from <sender> received <date> <time> to shortlist <code>, text "<the whole new text>"', and after it 'left out: <n>, named by selection <code>/<count>' for each number you left out. Do not start any number until the routine's order says so." Second: "Change your check-mail routine, under the same name and with the same skill, so that a mail run works in this order. One: sort by shortlist code first, as your skill says, and give each such mail its verdict; start no number yet. Two: handle all other new mail with handle-replies, as it is. Three: if handle-replies proposed or booked anything in this run, stop there and name every open or uncertain shortlist number in your report. Four: otherwise look into memory for selections that still have an open or uncertain number, and continue them, the oldest first, whether or not any mail in this run belongs to them. Five: only when steps one to four found nothing to do, report in one sentence that nothing needs action."
- [x] Check: two routines; `check-mail` still names `handle-replies`; the three old skills unchanged. Then read the re-saved skill for shortlist orders against the spec's whole rule list, not only the new part: which shortlist, the four reading rules, the verdict order (skip by the four-part name, close, check the delivery, claim, resume), the rule that a stranger's text is never copied into memory, the rule that a long text gives no order and is named by its marker, which names long mails only, one order per number by mail (left out at the claim, "covered" before a start), the state of one attempt inside its selection, the site branch, the cut rules, unfinished selections, the report, and every rule Task 9 taught. A rewrite of a long skill can lose rules (side proof, finding S9), and this skill stands in front of a real submit button. A missing rule is corrected by chat until it is there.
- [x] (a) Two valid replies with the same text. The owner prepares two replies in his personal mailbox, one to each of the two shortlist mails of Task 8, both with the one line "apply <x>", where number `<x>` is named by no selection of either shortlist. He sends both inside one displayed minute. Pass: `check-mail` starts by itself; two selection lines, each with its own shortlist code, the received time and the whole text; each number is read above the quote and runs to its end (the card and Deny on startupjobs.cz, or the "Prepared" line on the other site). A run that skips the second reply as already handled is the defect this part looks for. If the two received minutes differ, the claims must still be right, and the same-minute proof is made again with the same two replies sent once more: their numbers are named by now, so both mails are closed, each with its own "Closed" line, at the cost of no application. The record quotes both times. Then a second `check-mail` run on the same inbox (Claude sends any short mail from the dev mailbox on the owner's word) prepares nothing and does not mention the reply.
- [x] (b) On the owner's word Claude sends, from the dev mailbox, a mail whose subject holds a sent shortlist's code: "apply 1". The owner sends a valid reply "apply <m>" so that both are received in the same displayed minute (if the minutes differ, this part is done again; the record quotes both times). Pass: the wrong-sender mail is closed with its sender, its time and the code in the line and none of its text; the owner's reply is still claimed and runs to its card (Deny); nothing was prepared for the wrong-sender mail; it never reaches `handle-replies`; the next mail run is silent about it. Then the prepared-but-never-sent case: a chat goal makes a new shortlist, and Claude presses Stop while its Send card waits; Claude sends the same kind of mail with that code from the dev mailbox. Pass: closed; memory gets no "sent" line; the next run of the shortlist skill reads the Sent folder and writes "not sent", so those offers are not hidden.
- [x] (c) A repeat by mail, and two replies that share their first line. The owner sends two replies to one shortlist inside one displayed minute (again if the minutes differ): "Ahoj Huntere," and below it "apply <x>"; "Ahoj Huntere," and below it "apply <y>". Both numbers are already named by a selection. Pass: nothing is started; two "Closed" lines, each with its own whole text; the report says he can order them again in chat; the next mail run is silent about both.
- [x] (d) After a shortlist was really sent, its "sent" line is removed through the page's memory editor, which leaves memory as a cut between the click and the line would; the owner replies. Pass: the reply passes its checks first; then the Sent folder is read and "sent — found in the Sent folder" is written; then the selection as usual.
- [x] (e) An oversized reply, and its replay. The owner sends two replies to one shortlist inside one displayed minute (again if the minutes differ): one of about 2,500 characters that begins "apply <x>" and goes on with any pasted text, and one that is "apply <x>" alone; `<x>` is already named by a selection, so the part costs no application. Pass: two "Closed" lines, the first with the marker (its size and its first 100 characters) and the reason "too long", the second with the whole short text and its own reason; every line Hunter wrote was accepted by `remember` (no tool error about the note's length stays unanswered in the run's events); the chat asks for the numbers alone. The defect this part looks for is a short reply skipped as the long one. Then the replay: one more mail run on the same inbox (any short mail from the dev mailbox starts it) writes no new line and mentions neither reply.
- [x] Record the cycle, with how each state was made. Follow-up evidence: `docs/evidence/2026-09-19-hunter-mail-checks/README.md`.

### Task 11: The interruption test (live cycle 5) [integration] [demo-path]

**Verified 2026-09-20:** `ebca698d` was interrupted after Started; `47eecf27` resumed and excluded the overlapping number, asked once, recorded Left and took the other number to its submit card. That card timed out to Deny; nothing was submitted. `e48e2a22` closed a later reply for the left number without restarting it. The test used the normal server code through an isolated `tsx` wrapper on port 3001 and a copied Hunter folder, rather than killing the shared port-3000 server. The production build passed separately. Report wording findings are tracked in the follow-up evidence.

**Invariant:** 6 — a selection survives a restart; 4 — an uncertain number is never applied to again by the bot alone.

- [x] Start the server with the `dobot-start` entry after `pnpm build`. The owner replies "apply <a>" (on startupjobs.cz, named by no selection yet). Claude watches `data/bots/job-hunt-bot/memory.md` for the "Started" line of `<a>` and then kills the server process (the `tsx` child, found with `lsof -ti :3000`), before the card.
- [x] While the server is down, the owner sends a second reply to the same shortlist: "apply <a>, <b>" (`<b>` also on startupjobs.cz and named by no selection). This is the overlap of the fourth review round: the second order names a number whose first attempt is uncertain. Then start the server again.
- [x] Pass: boot recovery closes the run honestly; the routine runs again by itself; step one claims the second reply with `<b>` only, and its selection line says "left out: <a>, named by selection <code>/<count>"; the run still reaches the first selection through step four of the routine's order; memory holds exactly one selection line per reply; `<a>` is asked about once and the notice "Hunter needs you: question" arrives; Claude answers "leave it" in chat; the "Left" line is written; no "Started" line for `<a>` names the second selection and no form is filled for `<a>` again; `<b>` runs to its card; Deny; the report names both. The "covered" check before a start has no live cycle of its own: the claim rule keeps two mail selections apart, so the check can only fire for a chat order that comes after a mail claim, and it is read in the saved skill (Task 10's check). What is lost: if Hunter ignores it, a number ordered by mail and then again by chat is prepared twice, and both attempts still stop at a card.
- [x] Record the cycle.

### Task 12: Act two once more, with both mails in one inbox (live cycle 6) [integration] [demo-path]

**Invariant:** 3 — the booking still finishes; 4 — one card for the booking.
**Demo step:** 15–20 (the platform spec's 10–15).
**Proof (2026-09-19, evening):** three runs, $1.17; record in `docs/evidence/2026-09-18-shortlist-and-notices/README.md`, "Cycle 6". Run ahead of cycle 5 and of the open parts of cycle 4 on the owner's word, because it is the only rehearsal of act two on the rewritten `check-mail`. Run `7151ee3b`: the reply "apply 1" claimed as selection J7QX2K/3 and not started, one `book` card, the page, the slot and the guest address checked on the bot's screenshot, **Allow once by the owner himself on the page** (the desktop app's safety check refused Claude's Allow through the API, and Claude did not go around it), the approval consumed once, "This meeting is scheduled", the run stopped and named the open number. Run `9de0f003`: the confirmation mail started it, no action for the confirmation, number 1 to its card, Deny, no step after it. The booking was cancelled as the host; run `0ec1808f` recorded the cancellation with no card. The booking lines were later pruned on the owner's explicit stop-and-cleanup instruction, as recorded in the private backlog.

- [x] On the owner's word Claude sends the fixture invitation from the dev mailbox, as on 2026-09-18, while an unclaimed reply "apply <n>" from the owner sits in the same inbox. Pass: the reply is claimed (one selection line) and none of its numbers is started; the invitation reaches one card and one booking after one Allow (pressed only after the page, the single slot and the guest address match); the run stops and its report names the open number. Then the booking's confirmation mail starts the next run by itself; it needs no action of its own, and the run takes the open number to its card; Deny.
- [x] Cancel the booking as the host. Remove the rehearsal's booking lines from memory on the owner's word, as after earlier rehearsals. (Cancellation and the authorized memory prune are complete; the private backlog records the subsequent stop-and-cleanup.)
- [x] Record the cycle.

### Task 13: The second site's form, learned by chat (live cycle 7) [integration] [support]

**Verified 2026-09-20:** run `d0bad032` filled the jobs.cz form and attached the CV. Both optional consents and the final submit card received Deny. Hunter saved `apply-to-jobs-cz` through chat and added it to shortlist selection dispatch. Review corrected the upload-label typo and required explicit submission proof before a Submitted record. Both sites’ actual submission branches remain deliberately untested. See `docs/evidence/2026-09-19-hunter-mail-checks/README.md`.

**Invariant:** 4 — the card at "Odeslat odpověď" and at each terms box; nothing is sent.
**Demo step:** support, not on the filmed path. It is the one rehearsal the job-selection spec allows for a second apply surface, and it removes the "prepared only" ending for offers from the second source.

- [x] Goal by chat with one jobs.cz posting from a shortlist: "Fill in the application form of <address> with the letter you wrote for it. No skill of yours covers this site's form, so work it out by sight. Use your own address and the facts in your memory, attach cv.pdf with attach_file, leave the cookie bar alone. Propose every box that accepts terms, and the final button, by their exact labels, and wait. I will deny the final button: then tell me everything stays filled in, and write the hand-off line."
- [x] Pass: the form filled; the CV attached; a card for each terms box (the owner decides each through Claude: Allow for a box the form cannot be completed without, since nothing is sent); the card at "Odeslat odpověď"; Deny; nothing sent; the hand-off line. Hunter offers to save the way as a skill for that site: yes. Then: "In your skill for shortlist orders, use that new skill for postings on jobs.cz." `diff` the three old skills again.
- [x] Record the cycle. If the run cannot finish (a bot check, a form that refuses), the outcome stays "prepared only" for that site, and the record and the write-up say so.

### Task 14: The fixture, the write-up and the tick [mechanical] [demo-path]

**Files:** `examples/job-hunt-bot/`, `docs/evidence/2026-09-18-shortlist-and-notices/`, `README.md`, `docs/decisions.md`, `docs/specs/2026-09-11-platform-design.md`, the private backlog
**Invariant:** 2 — the fixture is a copy of what ran; 5 — no address in any committed file.
**Verify:** `pnpm preflight`; `grep -rn -E "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}" docs/evidence/2026-09-18-shortlist-and-notices examples/job-hunt-bot` shows only the bot's own address, the mock interviewer's and masked forms.

- [x] Copy the new skills and the two routine files from `data/bots/job-hunt-bot/` into `examples/job-hunt-bot/`; add to the fixture's `memory.md` the line "The user's own address for my reports: ask the user once with ask_user, then remember it here."; copy no memory line that holds the address.
- [x] `docs/evidence/…/README.md`: the seven cycles, and `bot-files/` with the saved texts, masked. Follow-up checks and final skill snapshots are in `docs/evidence/2026-09-19-hunter-mail-checks/`.
- [x] `README.md`: rows in "What has run" for the cycles that passed, and under what has not run: the Allow branch of either site's form.
- [x] `docs/decisions.md`: the six trade-offs the spec lists, each with what is lost, when it matters and the upgrade.
- [x] Platform spec: the September 20 amendment points the demo path's steps 4–8 to the new spec's steps 4–13.
- [x] the private backlog: tick the item with the proof; add to the filming-day procedure: "no selection in memory has an open or uncertain number before act two is filmed", and the owner's open decision about the address on camera.
- [x] `pnpm preflight`; the related fixes, fixture and evidence are committed together at closeout. The final verification record is `docs/evidence/2026-09-19-hunter-mail-checks/README.md`.

## Verification Criteria

| # | Criterion | How to verify |
| - | --------- | ------------- |
| 1 | With `NOTIFY_EMAIL` empty, the server boots and runs as before | clean clone steps with the example env; the boot log says nobody is mailed; preflight |
| 2 | A wrong SMTP setting shows at boot and as one neutral card, and never stops a run | live cycle 1, first half |
| 3 | A notice reaches the operator for each need, with fixed text and no link | live cycles 1, 2, 5; Runner tests 1–6 and 18 |
| 4 | No notice when no wait starts, for a manual takeover, or for a used-up daily budget; one `refused` notice per hold, also when a hold ends during a screen check; no `refused` notice for a hold that has already ended | Runner tests 6–13, 6b and 6c |
| 5 | A notifier that hangs, fails or throws never delays or breaks a run, and no rejection escapes | Runner tests 14–17 |
| 6 | **Human-observable:** with nobody typing, Hunter reads two result lists on its live screen, and after one Allow the shortlist is in the owner's inbox with links that open | live cycle 2 |
| 7 | "sent" is written only after the mailbox's confirmation; a Deny on the Send card sends nothing, retries nothing and writes "not sent — not approved" | live cycle 2 (the Deny, then "send it" and Allow) |
| 8 | **Human-observable:** The owner answers the mail with a number, and the form fills on the live screen up to the card; Deny leaves it unsent | live cycle 4a |
| 9 | A wrong-sender mail prepares nothing, is closed once with none of its text in memory, cannot mark a shortlist as sent, and cannot hide a valid reply received in the same minute | live cycle 4b |
| 9b | Two mails received in one minute are never merged: the same text to two shortlists gives two selections, and the same first line with different text below gives two verdicts | live cycle 4a and 4c |
| 9c | A reply too long for one memory note is closed once with a bounded marker, is not met again by a later run, and cannot hide a short reply received in the same minute | live cycle 4e |
| 10 | A restart between "Started" and the card repeats nothing and loses nothing; a second reply that names the uncertain number does not start it, before or after "leave it" | live cycle 5 |
| 10b | A new chat order for a number that already has an outcome is a new attempt; the same order by mail starts nothing | live cycle 3 (second order) and 4c |
| 11 | Act two still ends in one card and one booking, and an invitation run starts no application | live cycle 6 |
| 12 | The three skills that passed on 2026-09-18 are byte-identical after all teaching | `diff` against the fixture after Tasks 8, 9, 10, 13 |
| 13 | No address of the owner's in any committed file | the grep of Task 14 |

## Test Plan

- Offline, no key needed: `pnpm exec vitest run src/server/mail/notifier.test.ts`, `src/server/config.test.ts`, `src/server/agent/takeover.test.ts`, `src/server/agent/runner.test.ts`. The mail tests run the real library with its JSON transport, which opens no connection.
- Live, with the keys, the bot's computer and money: Tasks 7–13. No test fakes SMTP delivery or the webmail; those are proven by the cycles.
- Full pre-flight before each commit of milestone 1 and at the end: `pnpm preflight`.

## Review record

Findings on this plan, each checked against the code or the text before it was accepted.

| Finding | Source | Resolution |
| ------- | ------ | ---------- |
| A mail was named by its received time alone, and the skip came before the sender check: a wrong-sender mail closed in the same displayed minute could hide a valid reply | relayed by the owner, round 1 | A mail is named by sender, received date and time, and the first line of its new text; the selection and closed lines carry all three (spec and Task 10); live cycle 4b times two mails into one minute |
| A number's state was read by address across all selections, so a new chat order for it was skipped as finished | relayed by the owner, round 1 | The state is the state of one attempt inside its selection; an earlier outcome is a warning on a new chat order and a reason to leave the number out of a mail order (spec, Task 9, Task 10); live cycle 3's second order and cycle 4c |
| No cycle pressed Deny on the Send card | relayed by the owner, round 1 | Task 8: the first Send card gets Deny, with its three checks, then "Send it" and Allow; criterion 7 |
| The `refused` mark was cleared where a hold ends; a screen check still out could set it again with no hold left, and the next hold stayed silent | relayed by the owner, round 2; checked at `runner.ts:400-403` (the awaited check), `:221` and `:257-261` (an idle takeover ends by timer or hand-back whatever the queue holds) | The mark is reset where a hold starts, in two places, and never where one ends (Task 5 steps 4 and 5; spec, "How often a notice can go out"); test 6b ends a hold during the check and fails on the first design |
| Test 12 stopped the manual takeover before its wait was registered, and test 14 allowed before the hanging notifier was called: both could pass without reaching what they test | relayed by the owner, round 2; checked at `takeover.ts:121-128` and `tools.ts` (`propose_action` awaits the card, an event and the bot state between `propose()` and the wait) | Test 12 lets the wait register, ends it by a hand-back and reads "ended:handed back" from the run log; tests 1, 2 and 14 wait for the recorded notice before they act |
| Task 10 claims every reply, so "apply 1" and "apply 1, 2" made two open selections for number 1; Task 9 read the state "for this selection only", so "leave it" for the first attempt did not stop the second | relayed by the owner, round 4 (P2); checked against the two chat texts and the spec's state table | One order per number by mail, checked twice: at the claim a number that another selection of the shortlist names is left out, whatever its state; before a start such a number is "covered" and not started; a chat order stays a new attempt (spec, Tasks 9 and 10); live cycle 5 now sends the overlapping reply while the server is down |
| Sender, minute and first line still merged different orders: "apply 1" to two shortlists in one minute, and two replies that share a greeting | relayed by the owner, round 4 (P2) | A mail is named by sender, received date and time, shortlist code and its whole new text; no stable message identifier is visible in the webmail, so none is used; a stranger's text is never copied into memory (Claude's addition: memory is read into every run); live cycle 4a sends the same text to two shortlists in one minute, 4c the same greeting with different text below |
| Task 10 put a reply's whole text into one memory note, and `remember` refuses a note over 2,000 characters, so a long reply could never be durably claimed or closed | relayed by the owner, round 5; checked at `tools.ts:244` (`z.string().min(1).max(2000)`) | An explicit rejection path with a bounded name: no order from a text over about 600 characters; the "Closed" line carries a marker (size, first 100 characters); a marker names long mails only, so "apply 1" in the same minute is always another mail; texts up to about 1,700 characters still fit, and the tool's refusal is the hard stop (spec's fourth reading rule, Task 10's text); live cycle 4e with its replay run; criterion 9c. Named residual: two long mails of the user's in one minute with the same first 100 characters are taken as one, which loses nothing because a long mail never gives an order |
| A first refusal could announce a hold that ended during the screen check; test 6b starts with an earlier refusal and misses it | relayed by the owner, round 4 (suggestion); checked at `runner.ts:400-403` | The hook sends, and sets the mark, only while the hold the goal was refused for still exists (Task 5 step 8); test 6c; criterion 4 |
| A `MAILBOX_SMTP_PORT` that is not a number stopped the boot, against the spec's own sentence | plan reviewer | The port is optional text, checked inside `noticeSettings`; a bad value turns the notifier off (Task 3 and its test) |
| Task 10 re-saves the skill for shortlist orders and did not check the result | plan reviewer | Task 10's check reads the whole re-saved skill against the spec's rule list |
| Suggestions: the recipient and the code in the proposal; `.claude/launch.json` outside the spec's scope; the `Transporter` type; message text in `callHuman`'s logs | plan reviewer | Task 8's goal text; a note under Research; Task 1's fallback; `callHuman` logs the error's name only |

The plan reviewer traced the 18 Runner tests and the 3 takeover tests against the real classes and
reported no wrong event name, signature or harness use. It did not see the hold-mark race or the
two tests that could pass early; both were confirmed in the code afterwards.

**Second pass, the same day: PASS, no blocking finding and nothing new.** The reviewer traced
test 6b by hand on both designs (it fails with the mark cleared at the end of a hold and passes
with the mark reset at its start), confirmed that test 6 still passes under the new design,
checked test 12 against `takeover.ts` (a repeated hand-back is a no-op before the wait and after
it; "handed back" is the exact text; a manual takeover may hand back on an unchanged safe page),
and re-counted Task 3's warnings (6 and 5).

## Checkpoint Recovery

If interrupted:

1. Read this plan and the spec's "Review record".
2. `git log --oneline` for the commits of Tasks 1–6; the first task without its commit is next.
3. For milestone 2, read `docs/evidence/2026-09-18-shortlist-and-notices/README.md`: the first cycle without a section is next. Hunter's state is in `data/bots/job-hunt-bot/` (skills, routines, memory); check the three old skills with `diff` before going on.
4. Never resume a live cycle while `src/` has uncommitted edits.
