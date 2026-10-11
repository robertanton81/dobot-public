import { Readable } from 'node:stream'
import type { MessageStructureObject } from 'imapflow'
import { describe, expect, it } from 'vitest'
import { ConnectorError, type MailboxClient, type MailHeader } from '../types'
import { botMailbox, imapMailboxClient, mailboxSmtpOptions, partsOf, type MailImap, type MailSmtp } from './bot-mailbox'
import { envWith } from './fakes'

const signal = new AbortController().signal
const tool = (name: string) => botMailbox.tools.find((t) => t.name === name)!
const HEADER: MailHeader = { uid: 7, from: 'Interviewer XY <xy@example.com>', subject: 'Invitation', date: '2026-09-24T08:00:00.000Z' }

function fakeMailbox() {
  const sent: { to: string; subject: string; body: string }[] = []
  const mailbox: MailboxClient = {
    address: 'bot@example.com',
    list: async () => [HEADER, { ...HEADER, uid: 6, subject: 'Older' }],
    read: async () => ({ header: HEADER, text: 'Pick a time on https://cal.com/xy/30min' }),
    send: async (mail) => {
      sent.push(mail)
    },
  }
  return { mailbox, sent }
}

describe('the bot mailbox connector', () => {
  it('is offered only to the bot the operator named, and only when a mailbox is set', () => {
    const { mailbox } = fakeMailbox()
    expect(botMailbox.unavailable('hunter', envWith(fetch, { mailbox, mailboxBotId: 'hunter' }))).toBeNull()
    expect(botMailbox.unavailable('homer', envWith(fetch, { mailbox, mailboxBotId: 'hunter' }))).toMatch(/another bot/)
    expect(botMailbox.unavailable('hunter', envWith(fetch, { mailbox: null, mailboxBotId: 'hunter' }))).toMatch(/not configured/)
    expect(botMailbox.unavailable('hunter', envWith(fetch, { mailbox, mailboxBotId: null }))).toMatch(/another bot/)
  })

  it('has two reads and one write of kind send', () => {
    expect(botMailbox.tools.map((t) => [t.name, t.class, t.kind])).toEqual([['list', 'read', undefined], ['read', 'read', undefined], ['send', 'write', 'send']])
  })

  it('lists headers one per line and reads one mail as text', async () => {
    const env = envWith(fetch, fakeMailbox())
    expect(await tool('list').run({} as never, env, signal)).toBe(
      'uid 7 · 2026-09-24T08:00:00.000Z · Interviewer XY <xy@example.com> · Invitation\nuid 6 · 2026-09-24T08:00:00.000Z · Interviewer XY <xy@example.com> · Older',
    )
    expect(await tool('read').run({ uid: 7 } as never, env, signal)).toBe(
      'from: Interviewer XY <xy@example.com>\nsubject: Invitation\ndate: 2026-09-24T08:00:00.000Z\n\nPick a time on https://cal.com/xy/30min',
    )
  })

  it('sends a mail and says what the card shows, and refuses its own address before any sending', async () => {
    const { mailbox, sent } = fakeMailbox()
    const env = envWith(fetch, { mailbox })
    const input = { to: 'xy@example.com', subject: 'Re: Invitation', body: 'Thank you.' }
    expect(tool('send').consequence?.(input as never)).toBe('sends a mail to xy@example.com with the subject "Re: Invitation"')
    expect(await tool('send').run(input as never, env, signal)).toBe('sent to xy@example.com')
    await expect(tool('send').run({ ...input, to: 'BOT@example.com' } as never, env, signal)).rejects.toThrow(new ConnectorError('you cannot send a mail to your own mailbox'))
    expect(sent).toEqual([input])
  })

  it('refuses a subject of more than one line, so no header can be added through it', () => {
    expect(tool('send').schema.safeParse({ to: 'a@example.com', subject: 'Hi\r\nBcc: x@example.com', body: 'b' }).success).toBe(false)
  })
})

// ---- The IMAP and SMTP client ----

const TEXT: MessageStructureObject = { type: 'text/plain', part: '1' }
const HTML: MessageStructureObject = { type: 'text/html', part: '2' }
const FILE: MessageStructureObject = { type: 'application/pdf', part: '3', disposition: 'attachment', dispositionParameters: { filename: 'cv.pdf' } }

function fakeImap(opts: { structure?: MessageStructureObject; bodies?: Record<string, string>; failFetch?: boolean; hangFetch?: boolean } = {}) {
  const calls: string[] = []
  // Like imapflow, close() rejects the command in progress at once.
  let rejectPending: ((e: Error) => void) | null = null
  const client = {
    on: () => client,
    connect: async () => void calls.push('connect'),
    getMailboxLock: async (path: string, options: { readOnly: boolean }) => {
      calls.push(`lock ${path} readOnly=${options.readOnly}`)
      return { path, release: () => void calls.push('release') }
    },
    search: async () => [5, 6, 7],
    fetchAll: async (uids: number[]) =>
      uids.map((uid) => ({ uid, seq: uid, envelope: { subject: `mail ${uid}`, from: [{ name: 'X', address: 'x@example.com' }], date: new Date('2026-09-24T08:00:00Z') } })),
    fetchOne: async (uid: string) => {
      calls.push(`fetchOne ${uid}`)
      if (opts.failFetch) throw new Error('server said no')
      if (opts.hangFetch) return new Promise((_, reject) => (rejectPending = reject))
      return { uid: Number(uid), seq: 1, envelope: { subject: 'Invitation', from: [{ address: 'xy@example.com' }], date: new Date('2026-09-24T08:00:00Z') }, bodyStructure: opts.structure ?? TEXT }
    },
    download: async (_uid: string, part: string) => {
      calls.push(`download ${part}`)
      return { meta: { expectedSize: 0, contentType: 'text/plain' }, content: Readable.from([Buffer.from(opts.bodies?.[part] ?? '')]) }
    },
    logout: async () => void calls.push('logout'),
    close: () => {
      calls.push('close')
      rejectPending?.(Object.assign(new Error('Connection not available'), { code: 'NoConnection' }))
      rejectPending = null
    },
  }
  return { client: client as unknown as MailImap, calls }
}

const IMAP = { host: 'imap.example.com', port: 993, user: 'bot@example.com', password: 'pw' }

describe('the mailbox client', () => {
  it('opens the folder read-only, lists the newest first, and logs out', async () => {
    const { client, calls } = fakeImap()
    const headers = await imapMailboxClient(IMAP, null, { imap: () => client, smtp: () => { throw new Error('unused') } }).list('INBOX', new Date(), signal)
    expect(headers.map((h) => h.uid)).toEqual([7, 6, 5])
    expect(headers[0]).toEqual({ uid: 7, from: 'X <x@example.com>', subject: 'mail 7', date: '2026-09-24T08:00:00.000Z' })
    expect(calls).toEqual(['connect', 'lock INBOX readOnly=true', 'release', 'logout'])
  })

  it('reads the plain-text part before the HTML one, and names attachments without reading them', async () => {
    const structure: MessageStructureObject = { type: 'multipart/mixed', childNodes: [{ type: 'multipart/alternative', childNodes: [HTML, TEXT] }, FILE] }
    const { client, calls } = fakeImap({ structure, bodies: { '1': 'Plain words.\n', '2': '<p>Html words</p>' } })
    const mail = await imapMailboxClient(IMAP, null, { imap: () => client, smtp: () => { throw new Error('unused') } }).read(7, signal)
    expect(mail.text).toBe('Plain words.\n\n[attachment: cv.pdf]')
    expect(calls.filter((c) => c.startsWith('download'))).toEqual(['download 1'])
  })

  it('turns an HTML-only mail into text', async () => {
    const { client } = fakeImap({ structure: HTML, bodies: { '2': '<html><body><p>Hello</p><p>World</p></body></html>' } })
    const mail = await imapMailboxClient(IMAP, null, { imap: () => client, smtp: () => { throw new Error('unused') } }).read(7, signal)
    expect(mail.text).toBe('Hello\nWorld')
  })

  it('releases the folder and logs out after a failed command too', async () => {
    const { client, calls } = fakeImap({ failFetch: true })
    await expect(imapMailboxClient(IMAP, null, { imap: () => client, smtp: () => { throw new Error('unused') } }).read(7, signal)).rejects.toThrow('server said no')
    expect(calls.slice(-2)).toEqual(['release', 'logout'])
  })

  it('closes the connection when the call is stopped, ends the waiting command, and does not log out', async () => {
    const { client, calls } = fakeImap({ hangFetch: true })
    const controller = new AbortController()
    const reading = imapMailboxClient(IMAP, null, { imap: () => client, smtp: () => { throw new Error('unused') } }).read(7, controller.signal)
    for (let i = 0; !calls.includes('fetchOne 7'); i++) {
      if (i > 1000) throw new Error('the read never reached its fetch')
      await new Promise((resolve) => setImmediate(resolve))
    }
    controller.abort()
    await expect(reading).rejects.toThrow('Connection not available')
    expect(calls).toContain('close')
    expect(calls).toContain('release')
    expect(calls).not.toContain('logout')
  })

  it('sends from the mailbox address and closes the transport, and says so when no outgoing server is set', async () => {
    const mails: unknown[] = []
    let closed = 0
    const transport = { sendMail: async (m: unknown) => void mails.push(m), close: () => void (closed += 1) } as unknown as MailSmtp
    const client = imapMailboxClient(IMAP, { host: 'smtp.example.com', port: 465 }, { imap: () => { throw new Error('unused') }, smtp: () => transport })
    await client.send({ to: 'xy@example.com', subject: 'Hi', body: 'Text' }, signal)
    expect(mails).toEqual([{ from: 'bot@example.com', to: 'xy@example.com', subject: 'Hi', text: 'Text' }])
    expect(closed).toBe(1)
    await expect(imapMailboxClient(IMAP, null).send({ to: 'a@example.com', subject: 's', body: 'b' }, signal)).rejects.toThrow(/has not set its outgoing server/)
  })

  it('sends with the platform\'s hardened mail settings: TLS required on any port but 465, no logger, the mailbox login', () => {
    expect(mailboxSmtpOptions({ host: 'smtp.example.com', port: 587 }, IMAP)).toMatchObject({
      host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, auth: { user: 'bot@example.com', pass: 'pw' }, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    })
    expect(mailboxSmtpOptions({ host: 'smtp.example.com', port: 465 }, IMAP)).toMatchObject({ secure: true, requireTLS: false })
  })

  it('does not walk a mail nested deeper than any real one', () => {
    let node: MessageStructureObject = { type: 'text/plain', part: 'deep' }
    for (let i = 0; i < 10_000; i++) node = { type: 'multipart/mixed', childNodes: [node] }
    expect(partsOf(node)).toEqual({ text: null, html: null, attachments: [] })
  })

  it('finds the parts of a single-part mail', () => {
    expect(partsOf({ type: 'text/plain' })).toEqual({ text: { type: 'text/plain' }, html: null, attachments: [] })
  })
})
