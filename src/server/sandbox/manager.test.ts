import { SandboxNotFoundError } from '@e2b/desktop'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSandbox } from '../agent/fakes'
import { createStore, type Store } from '../store'
import type { CompanionSource, PauseResult, SandboxSession } from './e2b'
import { GRACE_MS, READY_TEXT, REBUILT_TEXT, SandboxManager, SETTING_UP_TEXT, type SessionFactory } from './manager'

// A session factory that records what the manager asked for, so the tests assert on the sequence
// (create → pause → connect) and on what was persisted, never on the fake's own return values.
class FakeFactory implements SessionFactory {
  calls: string[] = []
  pauses: string[] = []
  pauseResult: PauseResult = 'paused'
  /** Thrown by every pause. */
  pauseError: Error | null = null
  connectError: Error | null = null
  createError: Error | null = null
  /** Thrown by the next keepAlive call, once: a session whose computer E2B has paused. */
  keepAliveError: Error | null = null
  /** The zone each create and connect was given, in call order. */
  zones: string[] = []
  /** When set, every pause waits for it before it answers: a pause in progress. */
  pauseGate: Promise<void> | null = null
  /** The local folder each workspace sync was asked to copy. */
  syncedDirs: string[] = []
  /** Thrown by every workspace sync. */
  syncError: Error | null = null
  private counter = 0

  private session(id: string): SandboxSession {
    return {
      sandbox: new FakeSandbox(),
      sandboxId: id,
      streamViewUrl: 'https://stream.example/view',
      streamInteractiveUrl: 'https://stream.example/full',
      keepAlive: async () => {
        if (this.keepAliveError) {
          const e = this.keepAliveError
          this.keepAliveError = null
          throw e
        }
        this.calls.push('keepAlive:' + id)
      },
      pause: async () => {
        this.pauses.push(id)
        if (this.pauseGate) await this.pauseGate
        if (this.pauseError) throw this.pauseError
        return this.pauseResult
      },
      syncWorkspace: async (localDir) => {
        this.calls.push('sync:' + id)
        this.syncedDirs.push(localDir)
        if (this.syncError) throw this.syncError
      },
    }
  }

  async create(_botId: string, _workspaceDir: string, _companion: CompanionSource, timeZone: string): Promise<SandboxSession> {
    this.calls.push('create')
    this.zones.push(timeZone)
    if (this.createError) throw this.createError
    this.counter += 1
    return this.session('sbx-' + this.counter)
  }

  async connect(sandboxId: string, _companion: CompanionSource, timeZone: string): Promise<SandboxSession> {
    this.calls.push('connect:' + sandboxId)
    this.zones.push(timeZone)
    if (this.connectError) throw this.connectError
    return this.session(sandboxId)
  }
}

let dataDir: string
let store: Store
let botId: string
let factory: FakeFactory
let manager: SandboxManager

beforeEach(async () => {
  vi.useFakeTimers()
  dataDir = await mkdtemp(join(tmpdir(), 'dobot-manager-'))
  store = createStore(dataDir)
  botId = (await store.createBot({ name: 'Worker', persona: 'Works.' })).id
  factory = new FakeFactory()
  manager = new SandboxManager(store, null, { py: '', js: '' }, 'Europe/Prague', { factory })
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(dataDir, { recursive: true, force: true })
})

async function statusTexts(): Promise<string[]> {
  return (await store.readChat(botId, { limit: 20 })).map((m) => (m.card?.card === 'status' ? m.card.text : '')).filter(Boolean)
}

describe('SandboxManager', () => {
  it('creates the computer for a bot without one and persists the sandbox id', async () => {
    const session = await manager.ensureRunning(botId)
    expect(session.sandboxId).toBe('sbx-1')
    expect(factory.calls).toEqual(['create'])
    expect((await store.readBot(botId)).sandboxId).toBe('sbx-1')
    expect(await statusTexts()).toEqual([SETTING_UP_TEXT])
    expect(manager.get(botId)?.sandboxId).toBe('sbx-1')
  })

  it('pauses two minutes after release, not before', async () => {
    await manager.ensureRunning(botId)
    manager.release(botId)
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1000)
    expect(factory.pauses).toEqual([])
    expect(manager.get(botId)).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(factory.pauses).toEqual(['sbx-1'])
    expect(manager.get(botId)).toBeNull()
  })

  it('after a pause the next run connects to the same sandbox instead of creating one', async () => {
    await manager.ensureRunning(botId)
    manager.release(botId)
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    const session = await manager.ensureRunning(botId)
    expect(session.sandboxId).toBe('sbx-1')
    expect(factory.calls).toEqual(['create', 'connect:sbx-1', 'sync:sbx-1'])
    expect((await store.readBot(botId)).sandboxId).toBe('sbx-1')
  })

  // The types make the manager pass a zone, not the operator's zone: a hard-coded one compiles
  // too. The zone must reach both ways the computer comes up.
  it("hands the operator's zone to the factory when it creates the computer and when it resumes it", async () => {
    const zoned = new SandboxManager(store, null, { py: '', js: '' }, 'America/New_York', { factory })
    await zoned.ensureRunning(botId)
    zoned.release(botId)
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    await zoned.ensureRunning(botId)
    expect(factory.calls).toEqual(['create', 'connect:sbx-1', 'sync:sbx-1'])
    expect(factory.zones).toEqual(['America/New_York', 'America/New_York'])
  })

  // A run that ended blocked keeps its session; if the human stays away past E2B's own timeout the
  // computer is paused anyway, and the next run must resume it instead of failing on a stale session.
  it('a live session that no longer answers is brought up again instead of failing the run', async () => {
    const first = await manager.ensureRunning(botId)
    factory.keepAliveError = new Error('sandbox is paused')
    const second = await manager.ensureRunning(botId)
    expect(second).not.toBe(first)
    expect(factory.calls).toEqual(['create', 'connect:sbx-1', 'sync:sbx-1'])
    expect(manager.get(botId)).toBe(second)
  })

  it('a live session whose companion no longer answers is brought up again, which restarts the helper', async () => {
    const first = await manager.ensureRunning(botId)
    first.sandbox.companion.health = async () => ({ ok: false, cdp: false })
    const second = await manager.ensureRunning(botId)
    expect(second).not.toBe(first)
    expect(factory.calls).toEqual(['create', 'keepAlive:sbx-1', 'connect:sbx-1', 'sync:sbx-1'])
  })

  it('a new run during the grace period cancels the pause', async () => {
    await manager.ensureRunning(botId)
    manager.release(botId)
    await vi.advanceTimersByTimeAsync(60_000)
    await manager.ensureRunning(botId)
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(factory.pauses).toEqual([])
    expect(factory.calls).toEqual(['create', 'keepAlive:sbx-1', 'sync:sbx-1'])
  })

  it('rebuilds from the folder when the sandbox is gone and says so in the chat', async () => {
    await store.updateBot(botId, { sandboxId: 'old-sbx' })
    factory.connectError = new SandboxNotFoundError('gone')
    const session = await manager.ensureRunning(botId)
    expect(factory.calls).toEqual(['connect:old-sbx', 'create'])
    expect(session.sandboxId).toBe('sbx-1')
    expect((await store.readBot(botId)).sandboxId).toBe('sbx-1')
    expect(await statusTexts()).toEqual([REBUILT_TEXT, SETTING_UP_TEXT])
  })

  it('does not rebuild on other connect errors', async () => {
    await store.updateBot(botId, { sandboxId: 'old-sbx' })
    factory.connectError = new Error('network down')
    await expect(manager.ensureRunning(botId)).rejects.toThrow('network down')
    expect(factory.calls).toEqual(['connect:old-sbx'])
    expect((await store.readBot(botId)).sandboxId).toBe('old-sbx')
  })

  it('two concurrent ensureRunning calls on one bot create once', async () => {
    const [a, b] = await Promise.all([manager.ensureRunning(botId), manager.ensureRunning(botId)])
    expect(a.sandboxId).toBe(b.sandboxId)
    expect(factory.calls).toEqual(['create'])
  })

  it('a busy pause keeps the session and the idle sweep retries it', async () => {
    await manager.ensureRunning(botId)
    factory.pauseResult = 'busy'
    manager.release(botId)
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(factory.pauses).toEqual(['sbx-1'])
    expect(manager.get(botId)).not.toBeNull()
    factory.pauseResult = 'paused'
    await manager.pauseIdle()
    expect(factory.pauses).toEqual(['sbx-1', 'sbx-1'])
    expect(manager.get(botId)).toBeNull()
  })

  // Setup must hold the computer under its own name, so letting go cannot release a run's hold.
  // Otherwise setup's release pauses the computer under the bot's first run.
  describe('setUp, a new bot\'s first computer', () => {
    it('brings the computer up, says so in the chat, and lets go so the computer pauses after the grace period', async () => {
      await manager.setUp(botId)
      expect(await statusTexts()).toEqual([SETTING_UP_TEXT, READY_TEXT])
      expect(manager.get(botId)).not.toBeNull()
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(factory.pauses).toEqual(['sbx-1'])
    })

    it('does not pause a computer that the first run took while setup was still going', async () => {
      const setup = manager.setUp(botId)
      await manager.ensureRunning(botId, 'run')
      await setup
      await vi.advanceTimersByTimeAsync(GRACE_MS + 1000)
      expect(factory.pauses).toEqual([])
    })

    it('turns a failed setup into a chat card and never rejects', async () => {
      factory.createError = new Error('quota exceeded')
      await expect(manager.setUp(botId)).resolves.toBeUndefined()
      const texts = await statusTexts()
      expect(texts.at(-1)).toContain('I could not set up my computer (Error)')
      expect(texts.at(-1)).not.toContain('quota')
    })
  })

  describe('pauseUnheld, for shutdown', () => {
    it('pauses a computer inside its grace period now, and the grace timer pauses nothing later', async () => {
      await manager.ensureRunning(botId)
      manager.release(botId)
      expect(await manager.pauseUnheld()).toBe(0)
      expect(factory.pauses).toEqual(['sbx-1'])
      expect(manager.get(botId)).toBeNull()
      await vi.advanceTimersByTimeAsync(GRACE_MS + 1000)
      expect(factory.pauses).toEqual(['sbx-1'])
    })

    it('leaves a computer that a run holds, and counts it', async () => {
      const other = (await store.createBot({ name: 'Second', persona: 'p' })).id
      await manager.ensureRunning(botId)
      await manager.ensureRunning(other)
      manager.release(other)
      expect(await manager.pauseUnheld()).toBe(1)
      expect(factory.pauses).toEqual(['sbx-2'])
      expect(manager.get(botId)).not.toBeNull()
    })

    it('counts a computer whose pause did not succeed as still up', async () => {
      await manager.ensureRunning(botId)
      manager.release(botId)
      factory.pauseResult = 'busy'
      expect(await manager.pauseUnheld()).toBe(1)
    })

    it('counts a computer whose pause threw as still up, and does not reject', async () => {
      await manager.ensureRunning(botId)
      manager.release(botId)
      factory.pauseError = new Error('the provider is down')
      await expect(manager.pauseUnheld()).resolves.toBe(1)
      expect(manager.get(botId)).not.toBeNull()
    })
  })

  // Each holder is counted once, and the computer pauses only when no holder is left. Otherwise
  // setup's release pauses the computer under the bot's first run.
  describe('holders', () => {
    it("setup letting go does not pause a computer the bot's first run holds", async () => {
      const [, forRun] = await Promise.all([manager.ensureRunning(botId, 'setup'), manager.ensureRunning(botId, 'run')])
      manager.release(botId, 'setup')
      await vi.advanceTimersByTimeAsync(GRACE_MS + 1000)
      expect(factory.pauses).toEqual([])
      expect(manager.get(botId)).toBe(forRun)
      manager.release(botId, 'run')
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(factory.pauses).toEqual(['sbx-1'])
    })

    it('a run that starts while setup is still holding the computer keeps it after setup lets go', async () => {
      await manager.ensureRunning(botId, 'setup')
      await manager.ensureRunning(botId, 'run')
      manager.release(botId, 'setup')
      await vi.advanceTimersByTimeAsync(GRACE_MS + 1000)
      expect(factory.pauses).toEqual([])
      await manager.pauseIdle()
      expect(factory.pauses).toEqual([])
    })

    it('the same holder asking twice and letting go once releases the computer', async () => {
      await manager.ensureRunning(botId)
      await manager.ensureRunning(botId)
      manager.release(botId)
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(factory.pauses).toEqual(['sbx-1'])
    })
  })

  // If these operations could overlap, a pause in progress would run during a new run's bring-up,
  // and its completion would then drop the session that run has just made.
  describe('lifecycle operations run one at a time per bot', () => {
    it('a run that arrives during a pause waits for it, then resumes the computer, and keeps its session', async () => {
      await manager.ensureRunning(botId)
      manager.release(botId)
      let finishPause!: () => void
      factory.pauseGate = new Promise<void>((resolve) => (finishPause = resolve))
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(factory.pauses).toEqual(['sbx-1'])
      // The pause is in flight. A run asks for the computer now.
      let session: SandboxSession | null = null
      const running = manager.ensureRunning(botId).then((s) => (session = s))
      await vi.advanceTimersByTimeAsync(1000)
      expect(session).toBeNull()
      expect(factory.calls).toEqual(['create'])
      finishPause()
      await running
      expect(factory.calls).toEqual(['create', 'connect:sbx-1', 'sync:sbx-1'])
      expect(manager.get(botId)).toBe(session)
      // Nothing else ran under the pause, and the finished pause did not drop the new session.
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(manager.get(botId)).toBe(session)
      expect(factory.pauses).toEqual(['sbx-1'])
    })

    it('a pause whose turn comes after a run took the computer does nothing', async () => {
      await manager.ensureRunning(botId)
      manager.release(botId)
      let finishPause!: () => void
      factory.pauseGate = new Promise<void>((resolve) => (finishPause = resolve))
      // The first pause is refused as busy, so the session is still there for the second one to find.
      factory.pauseResult = 'busy'
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(factory.pauses).toEqual(['sbx-1'])
      // The idle sweep queues a second pause behind the first; a run arrives before its turn.
      const sweep = manager.pauseIdle()
      const running = manager.ensureRunning(botId)
      finishPause()
      await Promise.all([sweep, running])
      // The second pause ran, found the holder and paused nothing; the run reused the live session.
      expect(factory.pauses).toEqual(['sbx-1'])
      expect(factory.calls).toEqual(['create', 'keepAlive:sbx-1', 'sync:sbx-1'])
      expect(manager.get(botId)?.sandboxId).toBe('sbx-1')
      })
  })

  // Creating the computer uploads the workspace once. Without a sync before every later run, a file
  // placed or replaced afterwards never reaches the computer and attach_file sends a stale copy.
  describe('workspace sync', () => {
    it('copies the workspace folder onto the computer before a run on a live session and after a resume, and not again on create', async () => {
      await manager.ensureRunning(botId)
      expect(factory.calls).toEqual(['create'])
      manager.release(botId)
      await manager.ensureRunning(botId)
      expect(factory.calls).toEqual(['create', 'keepAlive:sbx-1', 'sync:sbx-1'])
      expect(factory.syncedDirs).toEqual([store.workspaceDir(botId)])
      manager.release(botId)
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await manager.ensureRunning(botId)
      expect(factory.calls.slice(-2)).toEqual(['connect:sbx-1', 'sync:sbx-1'])
    })

    it('a sync that fails fails the bring-up, so no run works with files in an unknown state', async () => {
      await manager.ensureRunning(botId)
      manager.release(botId)
      factory.syncError = new Error('upload refused')
      await expect(manager.ensureRunning(botId)).rejects.toThrow('upload refused')
    })

    // The session is tracked before the sync. Otherwise a resumed computer whose sync fails is
    // never tracked, and nothing pauses it until E2B's own timeout.
    it('a resumed computer whose sync fails is still tracked, so the release pauses it', async () => {
      await manager.ensureRunning(botId)
      manager.release(botId)
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(manager.get(botId)).toBeNull()
      factory.syncError = new Error('upload refused')
      await expect(manager.ensureRunning(botId)).rejects.toThrow('upload refused')
      expect(manager.get(botId)?.sandboxId).toBe('sbx-1')
      manager.release(botId)
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      expect(factory.pauses).toEqual(['sbx-1', 'sbx-1'])
      expect(manager.get(botId)).toBeNull()
    })
  })

  it('the idle sweep leaves a running bot and a bot in its grace period alone', async () => {
    await manager.ensureRunning(botId)
    await manager.pauseIdle()
    expect(factory.pauses).toEqual([])
    manager.release(botId)
    await manager.pauseIdle()
    expect(factory.pauses).toEqual([])
  })
})
