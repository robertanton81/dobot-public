import { readFileSync } from 'node:fs'
import type { BotEvents } from '../bot-events'
import { errorFields, log } from '../log'
import type { Store } from '../store'
import { connectSandbox, createSandbox, SandboxNotFoundError, type CompanionSource, type SandboxSession } from './e2b'

// Per-bot sandbox lifecycle (invariant 6): the bot folder is the system of record and the
// sandbox is a cache of it. A run brings the computer up (create, or resume from pause), syncs the
// workspace files onto it and extends its timeout; two minutes after the last holder lets go the
// computer is paused; a lost sandbox is rebuilt from the folder with a status card that says
// logins are gone. Bringing a computer up and pausing it run one at a time per bot, so a pause in
// progress can neither be resumed under nor drop a session a newer operation made.

export const GRACE_MS = 2 * 60_000
export const IDLE_SWEEP_MS = 5 * 60_000

export const REBUILT_TEXT = 'My computer was rebuilt. Files are back; logins are gone, I will ask you to sign in again.'
export const SETTING_UP_TEXT = 'setting up my computer'
export const READY_TEXT = 'my computer is ready'

/**
 * Who holds the computer up: a run, the background setup of a new bot, or a human who took the
 * screen of an idle bot from the page. Each holder is counted once, and the computer is released
 * to the pause only when no holder is left. Otherwise setup letting go would pause the computer
 * under the bot's first run, and the idle pause would fire while a human uses the screen.
 */
export type SandboxHolder = 'run' | 'setup' | 'takeover'

export function loadCompanionSource(): CompanionSource {
  return {
    py: readFileSync(new URL('../companion/companion.py', import.meta.url), 'utf8'),
    js: readFileSync(new URL('../companion/page-script.js', import.meta.url), 'utf8'),
  }
}

export type SessionFactory = {
  create(botId: string, workspaceDir: string, companion: CompanionSource, timeZone: string): Promise<SandboxSession>
  connect(sandboxId: string, companion: CompanionSource, timeZone: string): Promise<SandboxSession>
}

export const e2bSessionFactory: SessionFactory = { create: createSandbox, connect: connectSandbox }

export type ManagerDeps = {
  factory: SessionFactory
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

const defaultDeps: ManagerDeps = {
  factory: e2bSessionFactory,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

export class SandboxManager {
  private readonly sessions = new Map<string, SandboxSession>()
  private readonly inFlight = new Map<string, Promise<SandboxSession>>()
  private readonly graceTimers = new Map<string, unknown>()
  /**
   * A set, not a count: runs on one bot never overlap (RunQueue), so 'run' is held once at a time,
   * and a run that ended blocked hands its hold to the next run, which asks again and releases once.
   * 'setup' happens once per bot. A count would leak a hold on that hand-over.
   */
  private readonly holders = new Map<string, Set<SandboxHolder>>()
  /** One chain of lifecycle operations per bot: bring up and pause never overlap. */
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly deps: ManagerDeps

  constructor(
    private readonly store: Store,
    private readonly events: BotEvents | null,
    private readonly companion: CompanionSource,
    /** The operator's TZ: the computer's clock and the browser's zone follow it (config.ts validates it). */
    private readonly timeZone: string,
    deps: Partial<ManagerDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps }
  }

  /** The live session, if the bot's computer is running right now. */
  get(botId: string): SandboxSession | null {
    return this.sessions.get(botId) ?? null
  }

  /** Whether anyone holds the bot's computer up right now. */
  private held(botId: string): boolean {
    return (this.holders.get(botId)?.size ?? 0) > 0
  }

  /**
   * Brings the bot's computer up for `holder` and syncs the workspace files onto it. Concurrent
   * calls for one bot share one attempt; a pause in progress finishes first, and the computer is
   * then resumed.
   */
  ensureRunning(botId: string, holder: SandboxHolder = 'run'): Promise<SandboxSession> {
    this.cancelGrace(botId)
    const holders = this.holders.get(botId) ?? new Set<SandboxHolder>()
    holders.add(holder)
    this.holders.set(botId, holders)
    const pending = this.inFlight.get(botId)
    if (pending) return pending
    const attempt = this.serialized(botId, () => this.reuseOrStart(botId)).finally(() => this.inFlight.delete(botId))
    this.inFlight.set(botId, attempt)
    return attempt
  }

  /** Runs one lifecycle operation after every earlier one on this bot has settled. */
  private serialized<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(botId) ?? Promise.resolve()
    const next = previous.then(() => work(), () => work())
    this.chains.set(botId, next)
    return next.finally(() => {
      if (this.chains.get(botId) === next) this.chains.delete(botId)
    })
  }

  /**
   * The live session when it still answers. When it does not — E2B paused the computer on its own
   * clock while the session was kept, say after a run ended blocked — the session is dropped and
   * the computer brought up again, which is a resume; the run must not fail on stale bookkeeping.
   */
  private async reuseOrStart(botId: string): Promise<SandboxSession> {
    const live = this.sessions.get(botId)
    if (live) {
      try {
        await live.keepAlive()
        // The API answering says the computer is up; the companion answering says it can be used.
        if (!(await live.sandbox.companion.health()).ok) throw new Error('companion unreachable')
      } catch (e) {
        log.warn('the bot computer did not answer; bringing it up again', { botId, sandboxId: live.sandboxId, ...errorFields(e) })
        this.sessions.delete(botId)
        return this.start(botId)
      }
      await this.syncWorkspace(botId, live)
      return live
    }
    return this.start(botId)
  }

  private async start(botId: string): Promise<SandboxSession> {
    const bot = await this.store.readBot(botId)
    let session: SandboxSession
    if (bot.sandboxId === null) {
      session = await this.create(botId)
    } else {
      try {
        session = await this.deps.factory.connect(bot.sandboxId, this.companion, this.timeZone)
      } catch (e) {
        if (!(e instanceof SandboxNotFoundError)) throw e
        log.warn('sandbox not found; rebuilding from the bot folder', { botId, sandboxId: bot.sandboxId })
        await this.store.updateBot(botId, { sandboxId: null })
        await this.status(botId, REBUILT_TEXT)
        session = await this.create(botId)
        this.sessions.set(botId, session)
        return session
      }
      // Tracked before the sync: a resumed computer whose sync fails is then released and paused
      // like any other, instead of running untracked until E2B's own timeout.
      this.sessions.set(botId, session)
      await this.syncWorkspace(botId, session)
      return session
    }
    this.sessions.set(botId, session)
    return session
  }

  /**
   * A new bot's first computer, brought up in the background so the page can show the bot at once.
   * Held as 'setup', apart from any run: letting go here must never pause a computer the bot's first
   * run has taken in the meantime. Never rejects: nothing awaits it, and a failure becomes a chat card.
   */
  async setUp(botId: string): Promise<void> {
    try {
      await this.ensureRunning(botId, 'setup') // posts SETTING_UP_TEXT itself
      await this.status(botId, READY_TEXT)
      this.events?.emitBot(await this.store.readBot(botId))
    } catch (e) {
      log.error('computer setup failed', { botId, ...errorFields(e) })
      await this.status(botId, `I could not set up my computer (${errorFields(e).errorName}). Send me a message to try again.`).catch(() => undefined)
    } finally {
      this.release(botId, 'setup')
    }
  }

  /** The workspace folder is uploaded when the computer is created; this call covers every later run. */
  private async create(botId: string): Promise<SandboxSession> {
    await this.status(botId, SETTING_UP_TEXT)
    log.info('creating the bot computer', { botId })
    const session = await this.deps.factory.create(botId, this.store.workspaceDir(botId), this.companion, this.timeZone)
    await this.store.updateBot(botId, { sandboxId: session.sandboxId })
    return session
  }

  /**
   * Copies the bot's workspace folder onto the computer before a run: a file the user placed or
   * replaced after the computer was created (a newer version of a document) reaches it, so
   * attach_file never sends a stale copy. A failed sync fails the start: a run must not go on with
   * files whose state is unknown.
   */
  private async syncWorkspace(botId: string, session: SandboxSession): Promise<void> {
    await session.syncWorkspace(this.store.workspaceDir(botId))
  }

  /** Called when a holder is done: once no holder is left, after a grace period with no new one, the computer is paused. */
  release(botId: string, holder: SandboxHolder = 'run'): void {
    const holders = this.holders.get(botId)
    holders?.delete(holder)
    if (holders && holders.size > 0) return
    this.holders.delete(botId)
    if (!this.sessions.has(botId)) return
    this.cancelGrace(botId)
    const handle = this.deps.setTimer(() => {
      this.graceTimers.delete(botId)
      if (this.held(botId)) return
      void this.pauseBot(botId)
    }, GRACE_MS)
    this.graceTimers.set(botId, handle)
  }

  /** The retry path for a failed pause: every session with no holder and no grace timer is paused. */
  async pauseIdle(): Promise<void> {
    for (const botId of [...this.sessions.keys()]) {
      if (this.held(botId) || this.graceTimers.has(botId)) continue
      await this.pauseBot(botId)
    }
  }

  /**
   * For shutdown: every computer that nobody holds is paused now, also one inside its grace period,
   * because the timer that would pause it ends with the process. A held computer stays up: a run or a
   * human is using it, and the sandbox's own timeout pauses it later. Resolves with how many stay up.
   */
  async pauseUnheld(): Promise<number> {
    const unheld = [...this.sessions.keys()].filter((botId) => !this.held(botId))
    for (const botId of unheld) this.cancelGrace(botId)
    await Promise.all(unheld.map((botId) => this.pauseBot(botId)))
    return this.sessions.size
  }

  private pauseBot(botId: string): Promise<void> {
    return this.serialized(botId, async () => {
      const session = this.sessions.get(botId)
      if (!session) return
      // A holder that arrived while this waited its turn has the computer: nothing to pause.
      if (this.held(botId)) return
      try {
        const result = await session.pause()
        if (result === 'paused' || result === 'already-paused') {
          if (this.sessions.get(botId) === session) this.sessions.delete(botId)
          return
        }
        log.warn('sandbox pause did not succeed; the idle sweep will retry', { botId, result })
      } catch (e) {
        log.error('sandbox pause threw; the idle sweep will retry', { botId, ...errorFields(e) })
      }
    })
  }

  private cancelGrace(botId: string): void {
    const handle = this.graceTimers.get(botId)
    if (handle !== undefined) {
      this.deps.clearTimer(handle)
      this.graceTimers.delete(botId)
    }
  }

  private async status(botId: string, text: string): Promise<void> {
    const message = await this.store.appendChat(botId, { role: 'card', card: { card: 'status', text } })
    this.events?.emitChat(message)
  }
}
