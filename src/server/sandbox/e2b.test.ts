import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromeEnv, clockCommand, maximizeChromeCommand, SandboxNotFoundError, setUpAfterConnect, SIGKILL_NOTE, stopProcessesCommand, typingChunks, uploadDirectory } from './e2b'

// The SDK reports a short proxy error (429, 502, 503, 504) on a command as "sandbox not found". After a
// successful connect that answer does not mean the computer is gone, and the manager must not forget it.
describe('setUpAfterConnect', () => {
  it('turns a "not found" from a step after the connect into a plain error that keeps the cause', async () => {
    const gone = new SandboxNotFoundError('Sandbox is probably not running anymore')
    const failed = await setUpAfterConnect('sbx-1', () => Promise.reject(gone)).catch((e: unknown) => e)
    expect(failed).toBeInstanceOf(Error)
    expect(failed).not.toBeInstanceOf(SandboxNotFoundError)
    expect((failed as Error).cause).toBe(gone)
  })

  it('passes a result and any other error through', async () => {
    await expect(setUpAfterConnect('sbx-1', () => Promise.resolve('session'))).resolves.toBe('session')
    const other = new Error('timeout')
    await expect(setUpAfterConnect('sbx-1', () => Promise.reject(other))).rejects.toBe(other)
  })
})

describe('typingChunks', () => {
  it('splits by whole code points, never inside a character', () => {
    expect(typingChunks('abc', 2)).toEqual(['ab', 'c'])
    // Diacritics and an emoji (a surrogate pair in UTF-16) stay whole.
    expect(typingChunks('žluťoučký🙂kůň', 5)).toEqual(['žluťo', 'učký🙂', 'kůň'])
    expect(typingChunks('', 5)).toEqual([])
  })

  it('keeps newlines inside the text, so a typed paragraph break reaches the page', () => {
    expect(typingChunks('one\ntwo', 25)).toEqual(['one\ntwo'])
  })
})

// The zone reaches every page through the browser process's environment (Chrome 150 reports the
// Intl time zone Europe/Prague when it starts with TZ=Europe/Prague). The computer's own clock is
// set through /etc/localtime, so the panel clock on the screen agrees.
describe('the computer clock', () => {
  it('starts the browser with the display and the zone', () => {
    expect(chromeEnv('Europe/Prague')).toEqual({ DISPLAY: ':0', TZ: 'Europe/Prague' })
  })

  it('sets the clock through the zoneinfo symlink and /etc/timezone, with the zone quoted', () => {
    const cmd = clockCommand('Europe/Prague')
    expect(cmd).toContain("ln -sf /usr/share/zoneinfo/'Europe/Prague' /etc/localtime")
    expect(cmd).toContain("echo 'Europe/Prague' | sudo tee /etc/timezone")
    expect(cmd).not.toContain('timedatectl')
    // A hostile name stays one inert argument (config validates the zone, this is the second wall).
    expect(clockCommand("x'; rm -rf /")).toContain("zoneinfo/'x'\\''; rm -rf /'")
  })
})

// While the browser starts it creates and destroys short-lived windows. `xdotool search` can die on
// one of them with an X BadWindow error, and the window id then stays empty. A one-shot command
// would end with exit 1 and leave a window of 1050 on the 1280 screen. It does not happen on every
// start. The real shell command runs here against a stand-in xdotool on PATH (no sandbox, no mock
// of the command): it fails its first searches the same way, and Alt+F10 toggles the width after a
// delay, as the window manager does.
describe('maximising the browser window', () => {
  const run = promisify(execFile)
  let dir = ''

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  const FAKE_XDOTOOL = `#!/bin/sh
case "$1" in
  search)
    n=$(cat "$FAKE_DIR/search_failures")
    if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$FAKE_DIR/search_failures"; echo "X Error of failed request:  BadWindow (invalid Window parameter)" >&2; exit 1; fi
    echo 4242 ;;
  getwindowgeometry)
    [ "$3" = 4242 ] || exit 1
    g=$(cat "$FAKE_DIR/geometry_failures")
    if [ "$g" -gt 0 ]; then echo $((g - 1)) > "$FAKE_DIR/geometry_failures"; exit 1; fi
    echo "WINDOW=4242"; echo "WIDTH=$(cat "$FAKE_DIR/width")" ;;
  windowactivate)
    [ "$3" = 4242 ] || exit 1
    echo $(( $(cat "$FAKE_DIR/keys") + 1 )) > "$FAKE_DIR/keys"
    ( sleep "$(cat "$FAKE_DIR/apply_delay")"; if [ "$(cat "$FAKE_DIR/width")" = 1050 ]; then echo 1288 > "$FAKE_DIR/width"; else echo 1050 > "$FAKE_DIR/width"; fi ) > /dev/null 2>&1 & ;;
esac
`

  /** A desktop with one browser window: how many searches die first, its width, and how long Alt+F10 takes to apply. */
  async function desktop(state: { searchFailures: number; geometryFailures?: number; width: number; applyDelay: number }): Promise<{ env: NodeJS.ProcessEnv; keys(): Promise<number>; width(): Promise<number> }> {
    dir = await mkdtemp(join(tmpdir(), 'dobot-maximise-'))
    await writeFile(join(dir, 'xdotool'), FAKE_XDOTOOL)
    await chmod(join(dir, 'xdotool'), 0o755)
    await writeFile(join(dir, 'search_failures'), String(state.searchFailures))
    await writeFile(join(dir, 'geometry_failures'), String(state.geometryFailures ?? 0))
    await writeFile(join(dir, 'width'), String(state.width))
    await writeFile(join(dir, 'apply_delay'), String(state.applyDelay))
    await writeFile(join(dir, 'keys'), '0')
    const read = async (name: string): Promise<number> => Number((await readFile(join(dir, name), 'utf8')).trim())
    return { env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, FAKE_DIR: dir }, keys: () => read('keys'), width: () => read('width') }
  }

  it('tries again when the search dies while the browser starts, and presses the key once', async () => {
    const d = await desktop({ searchFailures: 2, width: 1050, applyDelay: 0 })
    await expect(run('sh', ['-c', maximizeChromeCommand(8)], { env: d.env })).resolves.toBeDefined()
    expect(await d.width()).toBe(1288)
    expect(await d.keys()).toBe(1)
  })

  // Alt+F10 is a toggle: a second press while the first is still being applied would undo it.
  it('waits for a slow window manager instead of pressing the toggle a second time', async () => {
    const d = await desktop({ searchFailures: 0, width: 1050, applyDelay: 1.2 })
    await expect(run('sh', ['-c', maximizeChromeCommand(8)], { env: d.env })).resolves.toBeDefined()
    expect(await d.width()).toBe(1288)
    expect(await d.keys()).toBe(1)
  })

  // A window that is found and gone before its width can be read is not a narrow window: no key
  // goes to it. Here the window is wide, so a press on the failed reading would make it narrow.
  it('presses nothing when a window is found but its width cannot be read, and looks again', async () => {
    const d = await desktop({ searchFailures: 0, geometryFailures: 1, width: 1288, applyDelay: 0 })
    await expect(run('sh', ['-c', maximizeChromeCommand(8)], { env: d.env })).resolves.toBeDefined()
    expect(await d.keys()).toBe(0)
    expect(await d.width()).toBe(1288)
  })

  it('leaves a window that is already wide alone', async () => {
    const d = await desktop({ searchFailures: 0, width: 1288, applyDelay: 0 })
    await expect(run('sh', ['-c', maximizeChromeCommand(8)], { env: d.env })).resolves.toBeDefined()
    expect(await d.keys()).toBe(0)
  })

  it('gives up with a failure inside its budget when no window ever appears', async () => {
    const d = await desktop({ searchFailures: 1_000_000, width: 1050, applyDelay: 0 })
    const started = Date.now()
    await expect(run('sh', ['-c', maximizeChromeCommand(1)], { env: d.env })).rejects.toMatchObject({ code: 1 })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(await d.keys()).toBe(0)
  })
})

// A browser started while the old one still runs on the same profile only hands its arguments to
// the old one and exits. The old browser would then keep its zone while the zone marker says
// otherwise, so the stop returns only once the old processes are gone. The real shell command runs
// here against local stand-in processes (no sandbox, no mock); each stand-in carries a random name,
// so nothing else on the machine can match it.
describe('stopping old processes before a restart', () => {
  const run = promisify(execFile)
  const children: ChildProcess[] = []

  afterEach(() => {
    for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })

  /** A stand-in process running `script`: its name, the pattern that matches it, and the signal that ended it. */
  function standIn(script: string): { name: string; pattern: string; ended: Promise<NodeJS.Signals | null> } {
    const name = `dobot-stop-test-${randomBytes(6).toString('hex')}`
    const child = spawn('sh', ['-c', script, name], { stdio: 'ignore' })
    children.push(child)
    const ended = new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)))
    // The bracket keeps the pattern from matching the shell that runs pkill and pgrep.
    return { name, pattern: `[${name.slice(0, 1)}]${name.slice(1)}`, ended }
  }

  async function stillRunning(name: string): Promise<boolean> {
    try {
      await run('pgrep', ['-f', name])
      return true
    } catch (e) {
      // pgrep exits 1 when nothing matches; anything else is a broken test machine, not an answer.
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === 1) return false
      throw e
    }
  }

  it('ends a process that stops on SIGTERM with SIGTERM, and returns once it is gone', async () => {
    const p = standIn('while :; do sleep 0.1; done')
    const { stdout } = await run('sh', ['-c', stopProcessesCommand(p.pattern, 1)])
    expect(await stillRunning(p.name)).toBe(false)
    expect(await p.ended).toBe('SIGTERM')
    expect(stdout).not.toContain(SIGKILL_NOTE)
  })

  it('kills a process that ignores SIGTERM once the grace is over, says so, and returns once it is gone', async () => {
    const p = standIn('trap "" TERM; while :; do sleep 0.1; done')
    const { stdout } = await run('sh', ['-c', stopProcessesCommand(p.pattern, 1)])
    expect(await stillRunning(p.name)).toBe(false)
    expect(await p.ended).toBe('SIGKILL')
    // The note is what makes the server log say that SIGTERM was not enough.
    expect(stdout).toContain(SIGKILL_NOTE)
  })

  // The stream stop matches x11vnc and the noVNC proxy with one alternation: an x11vnc restored
  // from a pause can outlive the SDK's own stop, and the stream then does not start.
  it('stops processes matching either side of an alternation in one command', async () => {
    const polite = standIn('while :; do sleep 0.1; done')
    const stubborn = standIn('trap "" TERM; while :; do sleep 0.1; done')
    await run('sh', ['-c', stopProcessesCommand(`${polite.pattern}|${stubborn.pattern}`, 1)])
    expect(await stillRunning(polite.name)).toBe(false)
    expect(await stillRunning(stubborn.name)).toBe(false)
    expect([await polite.ended, await stubborn.ended]).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('returns with success when nothing matches', async () => {
    await expect(run('sh', ['-c', stopProcessesCommand(`[d]obot-stop-test-none-${randomBytes(6).toString('hex')}`, 1)])).resolves.toBeDefined()
  })
})

// Only a folder that is not there at all means "no workspace folder". If every ENOENT passed as
// that, a subfolder gone mid-walk would pass too, and a run would go on with stale files.
describe('uploadDirectory', () => {
  type Fake = { files: { makeDir(path: string): Promise<void>; write(path: string, data: unknown): Promise<void> }; sandboxId: string; calls: string[] }
  function fakeRaw(): Fake {
    const calls: string[] = []
    return {
      sandboxId: 'sbx',
      calls,
      files: {
        makeDir: async (path) => {
          calls.push('mkdir ' + path)
        },
        write: async (path) => {
          calls.push('write ' + path)
        },
      },
    }
  }

  it('uploads every file, making the remote folders it needs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dobot-upload-'))
    try {
      await writeFile(join(dir, 'cv.pdf'), 'x')
      await mkdir(join(dir, 'letters'))
      await writeFile(join(dir, 'letters', 'acme.md'), 'y')
      const raw = fakeRaw()
      await uploadDirectory(raw as never, dir, '/home/user/workspace')
      expect(raw.calls.sort()).toEqual(['mkdir /home/user/workspace/letters', 'write /home/user/workspace/cv.pdf', 'write /home/user/workspace/letters/acme.md'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a missing folder is nothing to upload', async () => {
    const raw = fakeRaw()
    await uploadDirectory(raw as never, join(tmpdir(), 'dobot-no-such-folder-' + Date.now()), '/home/user/workspace')
    expect(raw.calls).toEqual([])
  })

  it('a dangling link in place of the folder is a failure, not an empty upload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dobot-upload-'))
    try {
      const link = join(dir, 'workspace')
      await symlink(join(dir, 'gone'), link)
      await expect(uploadDirectory(fakeRaw() as never, link, '/home/user/workspace')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
