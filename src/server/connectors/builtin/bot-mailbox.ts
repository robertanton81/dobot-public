import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow'
import { createTransport, type Transporter } from 'nodemailer'
import { htmlToText } from '../../agent/tools'
import { errorFields, log } from '../../log'
import { smtpOptions } from '../../mail/notifier'
import { imapOptions, type ImapSettings } from '../../mail/watcher'
import { ConnectorError, type BuiltinConnector, type ConnectorEnv, type ConnectorTool, type MailboxClient, type MailHeader } from '../types'
import { z } from 'zod'

// The bot's own mailbox, read and written by the platform: headers and text over IMAP, a plain mail
// over SMTP. The login is the platform's (MAILBOX_*); the model gets headers and text, never the
// login. Only the one bot the operator named may use it, because the process has one mailbox.

const LIST_MAX = 50
const BODY_MAX_BYTES = 200_000

// ---- The tools ----

const listSchema = z.object({
  folder: z.string().regex(/^[\p{L}\p{N} ._/-]{1,100}$/u).optional().describe('the folder; INBOX when left out'),
  sinceDays: z.number().int().min(1).max(60).optional().describe('how many days back; 7 when left out'),
})

function headerLine(h: MailHeader): string {
  return `uid ${h.uid} · ${h.date} · ${h.from} · ${h.subject}`
}

function mailboxOf(env: ConnectorEnv): MailboxClient {
  if (env.mailbox === null) throw new ConnectorError('this server has no mailbox')
  return env.mailbox
}

const list: ConnectorTool = {
  name: 'list',
  class: 'read',
  description: `List the newest mails in your mailbox (at most ${LIST_MAX}): uid, date, sender, subject. Read one with bot-mailbox__read. Nothing is marked as read.`,
  schema: listSchema,
  run: async ({ folder, sinceDays }: z.infer<typeof listSchema>, env: ConnectorEnv, signal: AbortSignal) => {
    const since = new Date(Date.now() - (sinceDays ?? 7) * 86_400_000)
    const headers = await mailboxOf(env).list(folder ?? 'INBOX', since, signal)
    return headers.length === 0 ? 'no mail in that time' : headers.map(headerLine).join('\n')
  },
}

const readSchema = z.object({ uid: z.number().int().positive().describe('the uid from bot-mailbox__list') })

const read: ConnectorTool = {
  name: 'read',
  class: 'read',
  description: 'Read one mail from your mailbox as text: sender, subject, date and body. Attachments are named, not read. Nothing is marked as read.',
  schema: readSchema,
  run: async ({ uid }: z.infer<typeof readSchema>, env: ConnectorEnv, signal: AbortSignal) => {
    const { header, text } = await mailboxOf(env).read(uid, signal)
    return `from: ${header.from}\nsubject: ${header.subject}\ndate: ${header.date}\n\n${text}`
  },
}

const sendSchema = z.object({
  to: z.email().describe('one recipient address'),
  subject: z.string().min(1).max(200).regex(/^[^\r\n]*$/, 'one line').describe('the subject, one line'),
  // Below the card's display limit, so the whole text fits on the approval card with its JSON around it.
  body: z.string().min(1).max(15_000).describe('the plain text of the mail'),
})
type SendInput = z.infer<typeof sendSchema>

const send: ConnectorTool = {
  name: 'send',
  class: 'write',
  kind: 'send',
  description: 'Send one plain-text mail from your mailbox to one recipient. The user sees the recipient, the subject and the whole text on the card.',
  schema: sendSchema,
  consequence: (input: SendInput) => `sends a mail to ${input.to} with the subject "${input.subject}"`,
  run: async ({ to, subject, body }: SendInput, env: ConnectorEnv, signal: AbortSignal) => {
    const mailbox = mailboxOf(env)
    // A mail to itself would land in its own inbox and start its own mail routine.
    if (to.toLowerCase() === mailbox.address.toLowerCase()) throw new ConnectorError('you cannot send a mail to your own mailbox')
    await mailbox.send({ to, subject, body }, signal)
    return `sent to ${to}`
  },
}

export const botMailbox: BuiltinConnector = {
  id: 'bot-mailbox',
  title: 'Your mailbox',
  what: 'read your own mail as text and send a mail after the user approves it, without webmail on your computer',
  onByDefault: false,
  unavailable: (botId, env) => {
    if (env.mailbox === null) return 'the mailbox is not configured'
    if (env.mailboxBotId !== botId) return 'the mailbox belongs to another bot (MAILBOX_BOT_ID)'
    return null
  },
  tools: [list, read, send],
}

// ---- The mailbox behind the tools ----

/** What the connector needs of an IMAP client; imapflow's client fits it. Injected in tests. */
export type MailImap = Pick<ImapFlow, 'connect' | 'getMailboxLock' | 'search' | 'fetchAll' | 'fetchOne' | 'download' | 'logout' | 'close' | 'on'>
/** What the connector needs of an SMTP transport; nodemailer's fits it. Injected in tests. */
export type MailSmtp = Pick<Transporter, 'sendMail' | 'close'>
export type SmtpSettings = { host: string; port: number }

/** The outgoing connection of the mailbox connector: the notice mail's settings, with TLS required on every port. */
export function mailboxSmtpOptions(settings: SmtpSettings, login: ImapSettings) {
  return smtpOptions({ host: settings.host, port: settings.port, user: login.user, password: login.password })
}

function address(value: { name?: string; address?: string }[] | undefined): string {
  const first = value?.[0]
  if (!first) return '(unknown)'
  return first.name ? `${first.name} <${first.address ?? ''}>` : (first.address ?? '(unknown)')
}

function toHeader(m: FetchMessageObject): MailHeader {
  const date = m.envelope?.date ?? m.internalDate
  return {
    uid: m.uid,
    from: address(m.envelope?.from),
    subject: m.envelope?.subject ?? '(no subject)',
    date: date instanceof Date ? date.toISOString() : String(date ?? '(unknown)'),
  }
}

type Parts = { text: MessageStructureObject | null; html: MessageStructureObject | null; attachments: string[] }

const MAX_DEPTH = 20

/** The first plain-text part, the first HTML part, and the names of the attachments. A mail nested deeper than any real one is not walked further. */
export function partsOf(node: MessageStructureObject, found: Parts = { text: null, html: null, attachments: [] }, depth = 0): Parts {
  if (node.childNodes && node.childNodes.length > 0) {
    if (depth < MAX_DEPTH) for (const child of node.childNodes) partsOf(child, found, depth + 1)
    return found
  }
  const isAttachment = node.disposition === 'attachment'
  if (isAttachment) {
    found.attachments.push(node.dispositionParameters?.filename ?? node.parameters?.name ?? node.type)
  } else if (node.type === 'text/plain' && found.text === null) {
    found.text = node
  } else if (node.type === 'text/html' && found.html === null) {
    found.html = node
  }
  return found
}

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * The real mailbox. One short connection per call: calls are rare, and nothing is held open between
 * runs. The folder is opened read-only, so no flag changes and no mail is marked as read. On Stop or
 * the time limit the client is closed, which rejects the command in progress at once.
 */
export function imapMailboxClient(
  imap: ImapSettings,
  smtp: SmtpSettings | null,
  open: { imap: (settings: ImapSettings) => MailImap; smtp: (settings: SmtpSettings, imap: ImapSettings) => MailSmtp } = {
    imap: (settings) => new ImapFlow(imapOptions(settings)),
    smtp: (settings, login) => createTransport(mailboxSmtpOptions(settings, login)),
  },
): MailboxClient {
  async function withFolder<T>(folder: string, signal: AbortSignal, work: (client: MailImap) => Promise<T>): Promise<T> {
    const client = open.imap(imap)
    // A socket error is an event, not a rejected command; closing rejects what is outstanding.
    client.on('error', (e: Error) => {
      log.warn('the mailbox connection failed', errorFields(e))
      client.close()
    })
    const onAbort = () => client.close()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await client.connect()
      const lock = await client.getMailboxLock(folder, { readOnly: true })
      try {
        return await work(client)
      } finally {
        lock.release()
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) client.close()
      else await client.logout().catch(() => client.close())
    }
  }

  return {
    address: imap.user,
    list: (folder, since, signal) =>
      withFolder(folder, signal, async (client) => {
        const uids = await client.search({ since }, { uid: true })
        if (uids === false || uids.length === 0) return []
        const newest = uids.slice(-LIST_MAX)
        const messages = await client.fetchAll(newest, { envelope: true, internalDate: true }, { uid: true })
        return messages.map(toHeader).reverse()
      }),
    read: (uid, signal) =>
      withFolder('INBOX', signal, async (client) => {
        const message = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, internalDate: true }, { uid: true })
        if (message === false) throw new ConnectorError(`there is no mail with uid ${uid} in the inbox`)
        const parts = message.bodyStructure ? partsOf(message.bodyStructure) : { text: null, html: null, attachments: [] }
        const part = parts.text ?? parts.html
        let text = '(this mail has no text)'
        if (part !== null) {
          const download = await client.download(String(uid), part.part ?? '1', { uid: true, maxBytes: BODY_MAX_BYTES })
          const onAbort = () => download.content.destroy()
          signal.addEventListener('abort', onAbort, { once: true })
          try {
            const raw = await streamText(download.content)
            text = part === parts.text ? raw.trim() : htmlToText(raw)
          } finally {
            signal.removeEventListener('abort', onAbort)
          }
        }
        const named = parts.attachments.map((name) => `[attachment: ${name}]`).join('\n')
        return { header: toHeader(message), text: named === '' ? text : `${text}\n\n${named}` }
      }),
    send: async (mail, signal) => {
      if (smtp === null) throw new ConnectorError('this mailbox cannot send mail: the operator has not set its outgoing server')
      const transport = open.smtp(smtp, imap)
      const onAbort = () => transport.close()
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        await transport.sendMail({ from: imap.user, to: mail.to, subject: mail.subject, text: mail.body })
      } finally {
        signal.removeEventListener('abort', onAbort)
        transport.close()
      }
    },
  }
}
