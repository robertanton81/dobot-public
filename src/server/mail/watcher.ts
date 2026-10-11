import { ImapFlow } from 'imapflow'
import { errorFields, log } from '../log'
import type { EventCursor } from '../store'

// The mail event source. A routine can say `event: mail-arrived` instead of a cron schedule, so
// the bot starts work when mail actually arrives instead of waking up every half hour to find an
// empty inbox. The watcher only asks the mail server how many unseen messages the inbox holds and
// which number its last message has; it never reads a message's sender, subject or text. The
// trigger is infrastructure; reading the mail is the bot's work. A bot with the bot-mailbox connector
// reads it through the platform over IMAP, and the model gets the text, never the login; a bot
// without it opens its webmail on its own screen and signs in by takeover.

export { MAIL_EVENT } from '../events'
export const DEFAULT_POLL_MS = 60_000
/**
 * After a mail event fires, a rise within this window does not fire at once: it fires one event at
 * the first reading after the window. A stream of mail then starts at most one run every five
 * minutes, and no mail is dropped.
 */
export const MAIL_DEBOUNCE_MS = 5 * 60_000

/**
 * One reading of the inbox: how many messages are unseen, and the inbox's next message number, which
 * is one above the highest message number among the messages in the inbox itself (null when a
 * mailbox gives no numbers).
 */
export type MailReading = { unseen: number; uidNext: number | null; uidValidity: string | null }

/** Everything the watcher needs from a mailbox. The IMAP client is behind it so the firing rule is testable. */
export type MailboxPort = {
  read(): Promise<MailReading>
}

/** The last next-UID seen, kept across restarts so a boot can tell that mail arrived meanwhile. */
export type Watermark = { uidValidity: string | null; uidNext: number }

export type WatermarkStore = {
  read(): Promise<Watermark | null>
  write(mark: Watermark): Promise<void>
}

export type ImapSettings = {
  host: string
  port: number
  user: string
  password: string
}

/** What one reading needs from an IMAP client; imapflow's client fits it. Injected in tests. */
export type ImapClientPort = {
  mailbox: { exists: number } | false
  on(event: 'error', listener: (error: Error) => void): unknown
  connect(): Promise<void>
  status(path: string, query: { unseen: true; uidValidity: true }): Promise<{ unseen?: number; uidValidity?: bigint }>
  getMailboxLock(path: string, options: { readOnly: true }): Promise<{ release(): void }>
  fetchOne(seq: string, query: { uid: true }): Promise<{ uid: number } | false>
  logout(): Promise<void>
  close(): void
}

/**
 * The connection settings, as a function of their own so a test can read them. The limits are
 * short on purpose: a reading is four small commands, and the next poll is armed only when this
 * one has settled, so a server that goes quiet must fail the reading, not stall the watcher for
 * the library's default of five minutes per command.
 */
export function imapOptions(settings: ImapSettings) {
  return {
    host: settings.host,
    port: settings.port,
    secure: true,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: 20_000,
    greetingTimeout: 16_000,
    socketTimeout: 30_000,
    // The client's own logger would print mailbox contents and the login exchange.
    logger: false as const,
  }
}

function imapflowClient(settings: ImapSettings): ImapClientPort {
  return new ImapFlow(imapOptions(settings))
}

/**
 * The highest message number among the messages that are in the inbox itself; 0 for an empty inbox.
 * Not the server's UIDNEXT: some servers count message numbers for the whole account, so a draft
 * the bot saves or a mail it sends raises the inbox's UIDNEXT. A watcher that reads UIDNEXT takes
 * that for new mail. The inbox is opened read-only, so no flag changes. A fetch that fails, or an
 * inbox that lost its last message between the two commands, fails the whole reading: the next
 * poll retries, and no half reading reaches the watcher.
 */
async function lastUidInInbox(client: ImapClientPort): Promise<number> {
  const lock = await client.getMailboxLock('INBOX', { readOnly: true })
  try {
    if (client.mailbox === false || client.mailbox.exists === 0) return 0
    const last = await client.fetchOne('*', { uid: true })
    if (last === false) throw new Error('the inbox did not return its last message')
    return last.uid
  } finally {
    lock.release()
  }
}

/**
 * One short IMAP connection per reading. A long-lived IDLE connection would be cheaper, but it
 * has to survive sleep, network changes and server timeouts; a minute-apart reading is what a
 * normal mail client does and it has no state to lose.
 */
export class ImapMailbox implements MailboxPort {
  constructor(
    private readonly settings: ImapSettings,
    private readonly open: (settings: ImapSettings) => ImapClientPort = imapflowClient,
  ) {}

  async read(): Promise<MailReading> {
    const client = this.open(this.settings)
    let connectionFailed = false
    // Socket errors are events, not rejected commands. Closing rejects outstanding commands.
    // Keep this listener on the discarded client so a late error cannot escape after cleanup.
    client.on('error', () => {
      connectionFailed = true
      client.close()
    })
    try {
      await client.connect()
      const status = await client.status('INBOX', { unseen: true, uidValidity: true })
      const reading = {
        unseen: status.unseen ?? 0,
        uidNext: (await lastUidInInbox(client)) + 1,
        // A BigInt in imapflow; kept as text, it is only ever compared for equality.
        uidValidity: status.uidValidity === undefined ? null : String(status.uidValidity),
      }
      await client.logout()
      if (connectionFailed) throw new Error('mailbox connection failed')
      return reading
    } catch (error) {
      client.close()
      throw connectionFailed ? new Error('mailbox connection failed') : error
    }
  }
}

export type WatcherDeps = {
  mailbox: MailboxPort
  /** Resolves true when delivery is consumed, false when it must be retried. */
  onMail(cursor?: EventCursor): Promise<boolean>
  /** Persists the next-UID across restarts; without it the first reading is only a baseline. */
  watermark?: WatermarkStore
  pollMs?: number
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
  /** Injected in tests; defaults to MAIL_DEBOUNCE_MS. */
  debounceMs?: number
  /** Injected in tests; defaults to Date.now. */
  now?(): number
}

/**
 * Fires when the unseen count rises above the previous reading.
 *
 * A rise within MAIL_DEBOUNCE_MS of the last fired event is held and fires once at the first
 * reading after that window. No reading is taken while `onMail` runs (the scheduler waits for the
 * runs it started), so a long run delays the next event; it never loses it.
 *
 * The first reading only sets the baseline, so a backlog of old unread mail does not start a run
 * at boot. With a watermark store, the first reading fires once when the inbox's next message
 * number moved past the stored one: mail arrived while the platform was down. Between readings a
 * moved number counts as new mail even when the unseen count did not rise, because the bot may
 * have read it on its screen first; a mailbox that gives no numbers falls back to the count. The
 * number comes from the inbox's own messages (`lastUidInInbox`), so what the bot stores in other
 * folders, a draft or a sent mail, never moves it. A stored watermark can be higher than the
 * inbox's own number, for example one that holds a server's account-wide UIDNEXT: the first
 * reading after a boot then sets a new baseline and fires nothing.
 */
export class MailWatcher {
  private last: MailReading | null = null
  private handle: unknown = null
  private stopped = false
  private lastFiredAt: number | null = null
  /** A rise was seen inside the debounce and has not fired yet. */
  private pending = false
  private readonly debounceMs: number
  private readonly now: () => number
  private readonly pollMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly deps: WatcherDeps) {
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS
    this.debounceMs = deps.debounceMs ?? MAIL_DEBOUNCE_MS
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref())
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout))
  }

  /** The count at the last successful reading; null before the first one. */
  get baseline(): number | null {
    return this.last?.unseen ?? null
  }

  start(): void {
    this.stopped = false
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    if (this.handle !== null) this.clearTimer(this.handle)
    this.handle = null
  }

  private schedule(): void {
    if (this.stopped) return
    this.handle = this.setTimer(() => {
      this.handle = null
      void this.tick().finally(() => this.schedule())
    }, this.pollMs)
  }

  /**
   * One reading. Never rejects: a mail server that is down must not take the process with it, and
   * a failed reading leaves the baseline alone so the next success still sees the rise.
   */
  async tick(): Promise<void> {
    let reading: MailReading
    try {
      reading = await this.deps.mailbox.read()
    } catch (e) {
      // Server error text can quote authentication or mailbox data.
      log.warn('mailbox could not be read; the next poll retries', { errorName: errorFields(e).errorName })
      return
    }
    const previous = this.last
    this.last = reading
    let rose: boolean
    if (previous === null) {
      const stored = await this.readWatermark()
      const arrivedWhileDown = stored !== null && reading.uidNext !== null && stored.uidValidity === reading.uidValidity && reading.uidNext > stored.uidNext
      if (!arrivedWhileDown) {
        // The baseline: nothing to deliver, so the mark may move to the mailbox's current number.
        await this.writeWatermark(reading)
        log.info('mail watcher baseline set', { unseen: reading.unseen })
        return
      }
      log.info('mail arrived while the platform was down', { uidNext: reading.uidNext, previous: stored.uidNext })
      rose = true
    } else {
      // By message number when both readings have one under the same UIDVALIDITY, by count otherwise.
      rose =
        reading.uidNext !== null && previous.uidNext !== null && reading.uidValidity === previous.uidValidity
          ? reading.uidNext > previous.uidNext
          : reading.unseen > previous.unseen
    }
    if (!rose && !this.pending) return
    const now = this.now()
    if (this.lastFiredAt !== null && now - this.lastFiredAt < this.debounceMs) {
      if (rose) log.info('new mail inside the debounce; it fires once the debounce is over', { unseen: reading.unseen, previous: previous?.unseen ?? null })
      this.pending = true
      return
    }
    log.info(rose ? 'new mail' : 'held mail fires now that the debounce is over', { unseen: reading.unseen, previous: previous?.unseen ?? null })
    this.pending = false
    this.lastFiredAt = now
    try {
      const cursor = reading.uidNext !== null && reading.uidValidity !== null
        ? { generation: reading.uidValidity, position: reading.uidNext } : undefined
      if (!(await this.deps.onMail(cursor))) {
        log.warn('the mail event was not handled; it fires again after the debounce')
        this.pending = true
        return
      }
    } catch (e) {
      // The mail is not handled: it fires again at the first reading after the debounce, and the
      // mark below stays behind so a restart delivers it too.
      log.error('the mail event handler failed; the mail fires again after the debounce', errorFields(e))
      this.pending = true
      return
    }
    // The mark moves only once the handler acknowledges delivery: a rise held by the debounce, a handler that
    // failed, or a crash while the runs it started were still open would otherwise sit behind a mark
    // that says the mail was handled, and a restart would not deliver it. The price is a repeat: a
    // restart during a mail-triggered run starts the routine again at boot.
    await this.writeWatermark(reading)
  }

  /** Never rejects: a watermark that cannot be read means "no watermark". */
  private async readWatermark(): Promise<Watermark | null> {
    if (!this.deps.watermark) return null
    try {
      return await this.deps.watermark.read()
    } catch (e) {
      log.warn('the mail watermark could not be read; starting from a baseline', errorFields(e))
      return null
    }
  }

  /** Never rejects; nothing to write when the server gave no numbers. */
  private async writeWatermark(reading: MailReading): Promise<void> {
    if (!this.deps.watermark || reading.uidNext === null) return
    try {
      await this.deps.watermark.write({ uidValidity: reading.uidValidity, uidNext: reading.uidNext })
    } catch (e) {
      log.warn('the mail watermark could not be written', errorFields(e))
    }
  }
}
