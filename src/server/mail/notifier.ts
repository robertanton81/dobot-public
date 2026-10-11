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
 * The connection settings, as a function of their own so a test can read them: no test opens a real
 * connection. Every mail the platform sends from the bot's mailbox uses them.
 */
export function smtpOptions(settings: Pick<NoticeSettings, 'host' | 'port' | 'user' | 'password'>) {
  return {
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
    this.transport = transport ?? createTransport(smtpOptions(settings))
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
