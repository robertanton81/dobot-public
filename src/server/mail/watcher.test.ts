import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { log } from '../log'
import { imapOptions, ImapMailbox, MAIL_DEBOUNCE_MS, MailWatcher, type ImapClientPort, type MailboxPort, type MailReading, type Watermark, type WatermarkStore } from './watcher'

class FakeMailbox implements MailboxPort {
  reads = 0
  /** Scripted readings; a number is an unseen count with no UIDs, an Error is thrown. The last entry repeats. */
  constructor(private readonly readings: (MailReading | number | Error)[]) {}

  async read(): Promise<MailReading> {
    const value = this.readings.length > 1 ? this.readings.shift() : this.readings[0]
    this.reads += 1
    if (value === undefined) throw new Error('no scripted reading')
    if (value instanceof Error) throw value
    return typeof value === 'number' ? { unseen: value, uidNext: null, uidValidity: null } : value
  }
}

class FakeWatermark implements WatermarkStore {
  writes: Watermark[] = []
  constructor(private stored: Watermark | null) {}
  async read(): Promise<Watermark | null> {
    return this.stored
  }
  async write(mark: Watermark): Promise<void> {
    this.stored = mark
    this.writes.push(mark)
  }
}

function watcherOver(readings: (MailReading | number | Error)[], clock?: () => number, watermark?: WatermarkStore): { watcher: MailWatcher; fired: () => number } {
  let fires = 0
  const watcher = new MailWatcher({
    mailbox: new FakeMailbox(readings),
    onMail: async () => {
      fires += 1
      return true
    },
    ...(watermark ? { watermark } : {}),
    // Without a clock a test is about the readings alone; the debounce has its own tests below.
    ...(clock ? { now: clock } : { debounceMs: 0 }),
  })
  return { watcher, fired: () => fires }
}

describe('MailWatcher', () => {
  it('reports a failed reading without logging the server error text', async () => {
    const warning = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    try {
      const { watcher } = watcherOver([new Error('SYNTHETIC_PRIVATE_MAIL_CONTENT')])
      await watcher.tick()
      expect(warning).toHaveBeenCalledWith('mailbox could not be read; the next poll retries', { errorName: 'Error' })
      expect(JSON.stringify(warning.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_MAIL_CONTENT')
      expect(watcher.baseline).toBeNull()
    } finally {
      warning.mockRestore()
    }
  })

  it('does not fire on the first reading, whatever the inbox already holds', async () => {
    const { watcher, fired } = watcherOver([7])
    await watcher.tick()
    expect(fired()).toBe(0)
    expect(watcher.baseline).toBe(7)
  })

  it('fires once when the unseen count rises', async () => {
    const { watcher, fired } = watcherOver([2, 3])
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('does not fire again while the count stays up', async () => {
    const { watcher, fired } = watcherOver([0, 1, 1, 1])
    for (let i = 0; i < 4; i++) await watcher.tick()
    expect(fired()).toBe(1)
  })

  // The user reads the mail, then a new one arrives: the drop must re-arm the trigger.
  it('fires again after the count drops and rises', async () => {
    const { watcher, fired } = watcherOver([1, 2, 0, 1])
    for (let i = 0; i < 4; i++) await watcher.tick()
    expect(fired()).toBe(2)
  })

  it('never fires on a drop alone', async () => {
    const { watcher, fired } = watcherOver([5, 1])
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(0)
  })

  // Without the stored watermark, mail that arrives while the platform is down goes unnoticed until
  // the next new message.
  it('fires once at boot when the stored next UID is below the mailbox next UID, and moves the watermark', async () => {
    const mark = new FakeWatermark({ uidValidity: '1', uidNext: 10 })
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 12, uidValidity: '1' }], undefined, mark)
    await watcher.tick()
    expect(fired()).toBe(1)
    expect(mark.writes).toEqual([{ uidValidity: '1', uidNext: 12 }])
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('sets the baseline without firing when no watermark is stored or it matches, and writes it', async () => {
    const none = new FakeWatermark(null)
    const a = watcherOver([{ unseen: 3, uidNext: 12, uidValidity: '1' }], undefined, none)
    await a.watcher.tick()
    expect(a.fired()).toBe(0)
    expect(none.writes).toEqual([{ uidValidity: '1', uidNext: 12 }])
    const same = new FakeWatermark({ uidValidity: '1', uidNext: 12 })
    const b = watcherOver([{ unseen: 3, uidNext: 12, uidValidity: '1' }], undefined, same)
    await b.watcher.tick()
    expect(b.fired()).toBe(0)
  })

  // A watermark written by an older version, which stored the server's UIDNEXT, can hold the
  // account-wide counter, which is higher than the inbox's own number. The first boot must not
  // fire, and must not miss later mail either: it re-baselines, and the next real mail fires.
  it('a stored number above the inbox\'s own number re-baselines at boot, and the next mail still fires', async () => {
    const mark = new FakeWatermark({ uidValidity: 'v', uidNext: 109 })
    const { watcher, fired } = watcherOver([{ unseen: 0, uidNext: 99, uidValidity: 'v' }, { unseen: 0, uidNext: 99, uidValidity: 'v' }, { unseen: 1, uidNext: 111, uidValidity: 'v' }], undefined, mark)
    await watcher.tick()
    expect(fired()).toBe(0)
    expect(mark.writes).toEqual([{ uidValidity: 'v', uidNext: 99 }])
    await watcher.tick()
    expect(fired()).toBe(0)
    await watcher.tick()
    expect(fired()).toBe(1)
    expect(mark.writes.at(-1)).toEqual({ uidValidity: 'v', uidNext: 111 })
  })

  // The number comes from the inbox's own last message, so it drops when that message is archived
  // or deleted. A drop is not mail; the next real mail gets a number above every number the inbox
  // ever held, so it still rises past the dropped value.
  it('a drop in the next message number does not fire, and the mail after it does', async () => {
    const { watcher, fired } = watcherOver([
      { unseen: 0, uidNext: 99, uidValidity: 'v' },
      { unseen: 0, uidNext: 97, uidValidity: 'v' },
      { unseen: 0, uidNext: 97, uidValidity: 'v' },
      { unseen: 1, uidNext: 121, uidValidity: 'v' },
    ])
    await watcher.tick()
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(0)
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('a changed UIDVALIDITY re-baselines instead of firing', async () => {
    const mark = new FakeWatermark({ uidValidity: '1', uidNext: 10 })
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 3, uidValidity: '2' }], undefined, mark)
    await watcher.tick()
    expect(fired()).toBe(0)
    expect(mark.writes).toEqual([{ uidValidity: '2', uidNext: 3 }])
  })

  it('between readings a higher next UID fires even when the unseen count did not rise', async () => {
    // The bot read the new mail on its screen before the watcher's next reading: the count stayed, the UID moved.
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 5, uidValidity: '1' }, { unseen: 1, uidNext: 6, uidValidity: '1' }])
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('a watermark store whose read fails is logged and the watcher goes on with the counts', async () => {
    const broken: WatermarkStore = {
      read: async () => {
        throw new Error('disk')
      },
      write: async () => {
        throw new Error('disk')
      },
    }
    const { watcher, fired } = watcherOver([2, 3], undefined, broken)
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  // The write runs only when the reading carries a number: a failing write must not reject the
  // tick, which would take the process down on an unhandled rejection, and the event still fires.
  it('a watermark store whose write fails is logged, and the rise still fires', async () => {
    const broken: WatermarkStore = {
      read: async () => null,
      write: async () => {
        throw new Error('disk')
      },
    }
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 5, uidValidity: '1' }, { unseen: 1, uidNext: 6, uidValidity: '1' }], undefined, broken)
    await expect(watcher.tick()).resolves.toBeUndefined() // the baseline write throws inside
    await expect(watcher.tick()).resolves.toBeUndefined() // the write at fire time throws inside
    expect(fired()).toBe(1)
  })

  // The message number decides when both readings carry one: a count that rises on its own is an
  // old message flagged unread again, not new mail, and must not start a paid run.
  it('a count rise alone does not fire when both readings carry the same next UID', async () => {
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 5, uidValidity: '1' }, { unseen: 2, uidNext: 5, uidValidity: '1' }])
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(0)
  })

  it('falls back to the count when one of two readings has no message number', async () => {
    const { watcher, fired } = watcherOver([{ unseen: 1, uidNext: 5, uidValidity: '1' }, { unseen: 2, uidNext: null, uidValidity: null }])
    await watcher.tick()
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  // A rise held by the debounce is not delivered yet: the watermark must not move past it, or a
  // crash during the hold would leave that mail behind a mark that says it was handled.
  it('moves the watermark only when the event fires, so a restart during a debounce hold still catches the held mail', async () => {
    let clock = 0
    const mark = new FakeWatermark(null)
    const first = watcherOver([{ unseen: 0, uidNext: 5, uidValidity: '1' }, { unseen: 1, uidNext: 6, uidValidity: '1' }, { unseen: 2, uidNext: 7, uidValidity: '1' }], () => clock, mark)
    await first.watcher.tick() // baseline 5
    clock = 60_000
    await first.watcher.tick() // 6: fires at once
    clock = 120_000
    await first.watcher.tick() // 7: inside the five minutes, held
    expect(first.fired()).toBe(1)
    expect(mark.writes).toEqual([{ uidValidity: '1', uidNext: 5 }, { uidValidity: '1', uidNext: 6 }])
    // The process dies here. The next boot reads the mailbox at 7 against the stored 6.
    const next = watcherOver([{ unseen: 2, uidNext: 7, uidValidity: '1' }], () => 200_000, mark)
    await next.watcher.tick()
    expect(next.fired()).toBe(1)
    expect(mark.writes.at(-1)).toEqual({ uidValidity: '1', uidNext: 7 })
  })

  it('the held mail moves the watermark when it fires after the five minutes', async () => {
    let clock = 0
    const mark = new FakeWatermark(null)
    const { watcher, fired } = watcherOver([{ unseen: 0, uidNext: 5, uidValidity: '1' }, { unseen: 1, uidNext: 6, uidValidity: '1' }, { unseen: 2, uidNext: 7, uidValidity: '1' }], () => clock, mark)
    await watcher.tick()
    clock = 60_000
    await watcher.tick()
    clock = 120_000
    await watcher.tick()
    clock = 60_000 + MAIL_DEBOUNCE_MS
    await watcher.tick() // still 7: the held mail fires now
    expect(fired()).toBe(2)
    expect(mark.writes.at(-1)).toEqual({ uidValidity: '1', uidNext: 7 })
  })

  // A mail server that is down must not take the process with it, and must not lose the rise.
  it('swallows a read failure, keeps the old baseline, and still sees the rise afterwards', async () => {
    const { watcher, fired } = watcherOver([1, new Error('ECONNRESET'), 2])
    await watcher.tick()
    await watcher.tick()
    expect(watcher.baseline).toBe(1)
    expect(fired()).toBe(0)
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('swallows a failing handler so the watcher keeps polling, and fires the mail again at the next reading after the debounce', async () => {
    const mailbox = new FakeMailbox([0, 1, 1])
    let calls = 0
    let clock = 0
    const watcher = new MailWatcher({
      mailbox,
      now: () => clock,
      onMail: async () => {
        calls += 1
        if (calls === 1) throw new Error('the run could not start')
        return true
      },
    })
    await watcher.tick()
    clock = 60_000
    await expect(watcher.tick()).resolves.toBeUndefined() // fires, the handler fails
    clock = 120_000
    await expect(watcher.tick()).resolves.toBeUndefined() // inside the debounce: held
    expect(calls).toBe(1)
    clock = 60_000 + MAIL_DEBOUNCE_MS
    await watcher.tick() // the same reading again: the held mail fires
    expect(calls).toBe(2)
    expect(mailbox.reads).toBe(4)
  })

  // The mark moves only after the handler has returned. Otherwise a crash inside the handler, or a
  // handler that fails, leaves mail behind a mark that says it was handled.
  it('moves the watermark only after the handler has returned, so a handler that failed leaves the mail for the next boot', async () => {
    const mark = new FakeWatermark(null)
    const writesWhenCalled: number[] = []
    let fail = true
    const watcher = new MailWatcher({
      mailbox: new FakeMailbox([{ unseen: 0, uidNext: 5, uidValidity: '1' }, { unseen: 1, uidNext: 6, uidValidity: '1' }, { unseen: 2, uidNext: 7, uidValidity: '1' }]),
      watermark: mark,
      debounceMs: 0,
      onMail: async () => {
        writesWhenCalled.push(mark.writes.length)
        if (fail) throw new Error('the run could not start')
        return true
      },
    })
    await watcher.tick() // baseline 5
    await watcher.tick() // 6: fires, the handler fails, the mark stays at 5
    expect(mark.writes).toEqual([{ uidValidity: '1', uidNext: 5 }])
    fail = false
    await watcher.tick() // 7: fires, the handler returns, then the mark moves
    expect(writesWhenCalled).toEqual([1, 1])
    expect(mark.writes).toEqual([{ uidValidity: '1', uidNext: 5 }, { uidValidity: '1', uidNext: 7 }])
  })

  it('a handler that failed just before a restart is delivered again at boot', async () => {
    const mark = new FakeWatermark(null)
    const failing = new MailWatcher({
      mailbox: new FakeMailbox([{ unseen: 0, uidNext: 5, uidValidity: '1' }, { unseen: 1, uidNext: 6, uidValidity: '1' }]),
      watermark: mark,
      debounceMs: 0,
      onMail: async () => {
        throw new Error('the run could not start')
      },
    })
    await failing.tick()
    await failing.tick()
    expect(mark.writes.at(-1)).toEqual({ uidValidity: '1', uidNext: 5 })
    // The process dies here. The next boot reads the mailbox at 6 against the stored 5.
    const next = watcherOver([{ unseen: 1, uidNext: 6, uidValidity: '1' }], undefined, mark)
    await next.watcher.tick()
    expect(next.fired()).toBe(1)
    expect(mark.writes.at(-1)).toEqual({ uidValidity: '1', uidNext: 6 })
  })

  it('polls on the timer until it is stopped', async () => {
    const timers: (() => void)[] = []
    let cleared = 0
    const mailbox = new FakeMailbox([0, 1])
    const watcher = new MailWatcher({
      mailbox,
      onMail: async () => true,
      setTimer: (fn) => {
        timers.push(fn)
        return timers.length
      },
      clearTimer: () => {
        cleared += 1
      },
    })
    watcher.start()
    expect(timers).toHaveLength(1)
    timers[0]?.()
    await new Promise((r) => setImmediate(r))
    expect(mailbox.reads).toBe(1)
    expect(timers).toHaveLength(2)
    watcher.stop()
    expect(cleared).toBe(1)
    // Even a timer that still fires after stop() (a real clearTimeout would have cancelled it)
    // must not arm another one: nothing is scheduled after the watcher is stopped.
    timers[1]?.()
    await new Promise((r) => setImmediate(r))
    expect(mailbox.reads).toBe(2)
    expect(timers).toHaveLength(2)
  })
})

// Anyone can email the bot. The debounce keeps a stream of mail from starting a run a minute, and it
// must not lose the mail it holds back: that mail may land after the bot has read its inbox.
describe('the mail debounce', () => {
  it('holds a rise inside the five minutes and fires it once at the first reading after them', async () => {
    let clock = 0
    const { watcher, fired } = watcherOver([0, 1, 2, 2, 2, 2], () => clock)
    await watcher.tick() // baseline 0
    clock = 60_000
    await watcher.tick() // 1: fires at once
    expect(fired()).toBe(1)
    clock = 180_000
    await watcher.tick() // 2: inside the five minutes, held
    expect(fired()).toBe(1)
    clock = 60_000 + MAIL_DEBOUNCE_MS
    await watcher.tick() // still 2: the held mail fires now
    expect(fired()).toBe(2)
    clock += 60_000
    await watcher.tick() // still 2: nothing new, nothing held
    expect(fired()).toBe(2)
    clock = 60_000 + 2 * MAIL_DEBOUNCE_MS + 1
    await watcher.tick() // still 2, long after the last fire: a held flag left set would fire here
    expect(fired()).toBe(2)
  })

  // The held mail may already be read by the time the window ends; the drop must not cancel the
  // event, because the mail that caused it landed after the bot last opened its inbox.
  it('fires a held rise even when the count has dropped again by the end of the five minutes', async () => {
    let clock = 0
    const { watcher, fired } = watcherOver([0, 1, 2, 0, 0], () => clock)
    await watcher.tick()
    clock = 60_000
    await watcher.tick() // 1: fires
    clock = 120_000
    await watcher.tick() // 2: held
    clock = 180_000
    await watcher.tick() // 0: read by someone; the hold stays
    expect(fired()).toBe(1)
    clock = 60_000 + MAIL_DEBOUNCE_MS
    await watcher.tick() // still 0: the held mail fires
    expect(fired()).toBe(2)
  })

  it('fires at once for a rise exactly at the five-minute boundary', async () => {
    let clock = 0
    const { watcher, fired } = watcherOver([0, 1, 2], () => clock)
    await watcher.tick()
    clock = 60_000
    await watcher.tick()
    clock = 60_000 + MAIL_DEBOUNCE_MS
    await watcher.tick()
    expect(fired()).toBe(2)
  })
})

// Some mail servers count message numbers for the whole account, so every folder reports the same
// UIDNEXT. A draft the bot saves or a mail it sends then raises the inbox's UIDNEXT. A watcher that
// read UIDNEXT would take that for new mail and start the mail routine for nothing.
describe('ImapMailbox', () => {
  type Server = { unseen: number; accountCounter: number; inbox: number[]; failFetch?: boolean; failLock?: boolean; lastMessageVanishes?: boolean; selectsNothing?: boolean }

  /** One connection to a scripted server. `accountCounter` is what STATUS reports as UIDNEXT; `inbox` holds the message numbers that are in the inbox itself. */
  class FakeImapClient extends EventEmitter implements ImapClientPort {
    mailbox: { exists: number } | false = false
    constructor(
      private readonly server: Server,
      private readonly calls: string[],
    ) { super() }
    async connect(): Promise<void> {
      this.calls.push('connect')
    }
    // A real server also reports UIDNEXT here, the account-wide counter; the reading must not use it.
    async status(): Promise<{ unseen?: number; uidNext?: number; uidValidity?: bigint }> {
      this.calls.push('status')
      return { unseen: this.server.unseen, uidNext: this.server.accountCounter, uidValidity: 7n }
    }
    async getMailboxLock(path: string, options: { readOnly: true }): Promise<{ release(): void }> {
      this.calls.push(`lock ${path} readOnly=${String(options.readOnly)}`)
      if (this.server.failLock) throw new Error('the inbox cannot be opened')
      this.mailbox = this.server.selectsNothing ? false : { exists: this.server.inbox.length }
      return { release: () => void this.calls.push('release') }
    }
    async fetchOne(seq: string): Promise<{ uid: number } | false> {
      this.calls.push(`fetchOne ${seq}`)
      if (this.server.failFetch) throw new Error('connection lost')
      // imapflow answers `false` when the FETCH comes back empty: the message left the inbox
      // between the two commands (imap-flow.js, fetchOne).
      if (this.server.lastMessageVanishes) return false
      const last = this.server.inbox.at(-1)
      return last === undefined ? false : { uid: last }
    }
    async logout(): Promise<void> {
      this.calls.push('logout')
    }
    close(): void {
      this.calls.push('close')
    }
  }

  const SETTINGS = { host: 'imap.example.test', port: 993, user: 'bot@example.test', password: 'not-a-real-password' }

  function watching(server: Server): { watcher: MailWatcher; fired: () => number; calls: string[] } {
    const calls: string[] = []
    let fires = 0
    const watcher = new MailWatcher({
      mailbox: new ImapMailbox(SETTINGS, () => new FakeImapClient(server, calls)),
      onMail: async () => {
        fires += 1
        return true
      },
      debounceMs: 0,
    })
    return { watcher, fired: () => fires, calls }
  }

  it('a draft the bot saved or a mail it sent raises the account-wide counter and is not new mail; a message in the inbox is', async () => {
    const server: Server = { unseen: 0, accountCounter: 108, inbox: [94, 96, 98] }
    const { watcher, fired } = watching(server)
    await watcher.tick()
    // The bot saves a draft: message 108 goes to the drafts folder, and every folder's UIDNEXT becomes 109.
    server.accountCounter = 109
    await watcher.tick()
    // The bot sends it: a copy goes to the sent folder.
    server.accountCounter = 110
    await watcher.tick()
    expect(fired()).toBe(0)
    // A reply arrives, and the bot's own browser has already opened it: no unseen mail, one more message in the inbox.
    server.inbox.push(110)
    server.accountCounter = 111
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('reads an empty inbox as next message number 1, and the first message as one above its own number', async () => {
    const server: Server = { unseen: 0, accountCounter: 40, inbox: [] }
    const calls: string[] = []
    const mailbox = new ImapMailbox(SETTINGS, () => new FakeImapClient(server, calls))
    expect(await mailbox.read()).toEqual({ unseen: 0, uidNext: 1, uidValidity: '7' })
    // Nothing to fetch from an empty inbox.
    expect(calls).not.toContain('fetchOne *')
    server.inbox.push(40)
    expect((await mailbox.read()).uidNext).toBe(41)
  })

  it('opens the inbox read-only, and releases the lock and closes when the fetch fails: no half reading', async () => {
    const server: Server = { unseen: 2, accountCounter: 12, inbox: [5, 9] }
    const calls: string[] = []
    const mailbox = new ImapMailbox(SETTINGS, () => new FakeImapClient(server, calls))
    expect(await mailbox.read()).toEqual({ unseen: 2, uidNext: 10, uidValidity: '7' })
    expect(calls).toEqual(['connect', 'status', 'lock INBOX readOnly=true', 'fetchOne *', 'release', 'logout'])
    calls.length = 0
    server.failFetch = true
    await expect(mailbox.read()).rejects.toThrow('connection lost')
    expect(calls).toEqual(['connect', 'status', 'lock INBOX readOnly=true', 'fetchOne *', 'release', 'close'])
  })

  it('the newest message leaves the inbox: the number drops and nothing fires; the next mail fires', async () => {
    const server: Server = { unseen: 0, accountCounter: 108, inbox: [94, 96, 98] }
    const { watcher, fired } = watching(server)
    await watcher.tick()
    // The bot archives message 98; the archive copy takes the account's next number.
    server.inbox.pop()
    server.accountCounter = 109
    await watcher.tick()
    expect(fired()).toBe(0)
    server.inbox.push(109)
    server.accountCounter = 110
    await watcher.tick()
    expect(fired()).toBe(1)
  })

  it('a last message that vanishes between the two commands fails the whole reading, and still releases and closes the connection', async () => {
    const server: Server = { unseen: 0, accountCounter: 12, inbox: [5, 9], lastMessageVanishes: true }
    const calls: string[] = []
    const mailbox = new ImapMailbox(SETTINGS, () => new FakeImapClient(server, calls))
    await expect(mailbox.read()).rejects.toThrow('the inbox did not return its last message')
    expect(calls).toEqual(['connect', 'status', 'lock INBOX readOnly=true', 'fetchOne *', 'release', 'close'])
  })

  it('an inbox that cannot be opened fails the reading and closes; a lock that selected nothing reads as empty', async () => {
    const calls: string[] = []
    const closed = new ImapMailbox(SETTINGS, () => new FakeImapClient({ unseen: 0, accountCounter: 12, inbox: [5], failLock: true }, calls))
    await expect(closed.read()).rejects.toThrow('the inbox cannot be opened')
    expect(calls).toEqual(['connect', 'status', 'lock INBOX readOnly=true', 'close'])
    calls.length = 0
    const nothing = new ImapMailbox(SETTINGS, () => new FakeImapClient({ unseen: 0, accountCounter: 12, inbox: [5], selectsNothing: true }, calls))
    expect((await nothing.read()).uidNext).toBe(1)
    expect(calls).not.toContain('fetchOne *')
  })

  it('bounds every wait on the mail server, and keeps the library from logging the exchange', () => {
    expect(imapOptions(SETTINGS)).toMatchObject({ host: 'imap.example.test', port: 993, secure: true, connectionTimeout: 20_000, greetingTimeout: 16_000, socketTimeout: 30_000, logger: false })
  })
})
