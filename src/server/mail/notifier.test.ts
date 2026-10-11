import { createTransport, type Transporter } from 'nodemailer'
import { describe, expect, it, vi } from 'vitest'
import { log } from '../log'
import { cleanBotName, NOTICE_CLOSING, noticeBody, noticeSubject, SmtpNotifier, smtpOptions, type NoticeSettings } from './notifier'

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
  // Every other test hands in a transport, so nothing else would notice a swapped port comparison
  // in these settings, and it would leave every real notice unconfirmed.
  it('signs in over TLS from the first byte on port 465, and only after STARTTLS on any other port', () => {
    expect(smtpOptions(SETTINGS)).toMatchObject({ host: 'smtp.example.test', port: 465, secure: true, requireTLS: false, auth: { user: 'bot@example.test', pass: 'not-a-real-password' } })
    expect(smtpOptions({ ...SETTINGS, port: 587 })).toMatchObject({ port: 587, secure: false, requireTLS: true })
    // The library's own logger would print the login exchange; it may read no file and no address for content.
    expect(smtpOptions(SETTINGS)).toMatchObject({ logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true })
  })

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
