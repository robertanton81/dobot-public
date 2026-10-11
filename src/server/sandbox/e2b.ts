import { CommandExitError, Sandbox, SandboxNotFoundError, ServiceBusyError } from '@e2b/desktop'
import { randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import { CompanionClient } from '../companion/client'
import { cleanedExcerpt, errorFields, hideInLogs, log } from '../log'
import { RESOLUTION, SandboxActionError, type CompanionPort, type Point, type SandboxPort } from './port'
import { shellQuote } from './shell'

// One E2B desktop sandbox per bot. The sandbox is paused when idle and resumed by
// `Sandbox.connect`; it is a cache of the bot folder, never the system of record (invariant 6).
// Nothing here logs the companion token or the stream auth key (invariant 5), and both are registered
// with the logger, so an error text that carries one is cleaned as well.

export { SandboxNotFoundError }

export const RUN_TIMEOUT_MS = 20 * 60_000

/** Whether Chrome needs --no-sandbox inside the container. `scripts/day-one.ts` checks it on a real sandbox. */
export const CHROME_NEEDS_NO_SANDBOX = false

const DISPLAY = ':0'
export const COMPANION_PORT = 8765
const CDP_PORT = 9222
const WORKSPACE_DIR = '/home/user/workspace'
const COMPANION_DIR = '/home/user/companion'
const CHROME_PROFILE_DIR = '/home/user/chrome-profile'
const WEBSOCKET_CLIENT = 'websocket-client==1.9.2'

// The zone the browser was last started with, kept on the computer so a connect can tell whether the
// operator's TZ changed (or was never applied, on a computer that has no marker file) and restart
// the browser once. Written after Chrome starts, read before the companion starts.
const ZONE_MARKER = '/home/user/.dobot-tz'

// Timeouts. The value given to Sandbox.create / Sandbox.connect becomes the connection default
// for every request the SDK makes through that sandbox (e2b's ConnectionConfig.requestTimeoutMs),
// so the desktop passthroughs below (screenshot, clicks, write, press, the stream) are bounded by
// API_TIMEOUT_MS even though they take no per-call option; commands they run are bounded by the
// SDK's 60 s process timeout as well. Calls that accept a per-request value pass REQUEST_TIMEOUT_MS.
const API_TIMEOUT_MS = 60_000 // create and connect, and the connection default
const REQUEST_TIMEOUT_MS = 30_000 // every request that takes its own value
const PAUSE_TIMEOUT_MS = 120_000 // a memory snapshot takes seconds per GiB
const COMMAND_TIMEOUT_MS = 15_000 // xdotool and similar commands
const PIP_TIMEOUT_MS = 180_000
const COMPANION_READY_MS = 20_000
const COMPANION_POLL_MS = 500
const PAUSE_RETRY_MS = 5_000
const MAX_HOLD_SECONDS = 10
// The stream holds nothing worth a graceful exit: its key is new on every start.
const STREAM_STOP_GRACE_SECONDS = 2

// --remote-allow-origins covers the Origin header websocket-client sends by default; the port is
// bound to localhost, so only processes inside the sandbox can reach it.
const CHROME_FLAGS = [
  `--remote-debugging-port=${CDP_PORT}`,
  `--remote-allow-origins=http://127.0.0.1:${CDP_PORT},http://localhost:${CDP_PORT}`,
  `--user-data-dir=${CHROME_PROFILE_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--window-position=0,0',
  '--disable-features=Translate',
]

// Chrome ignores --start-maximized on this desktop (it opens a 1050×753 window on the 1280×800
// screen), and the template's xdotool has no `windowstate`. Alt+F10 is the window manager's own
// maximise key. It is a toggle, so it is sent only while the window is narrower than the screen.
//
// While the browser starts it creates and destroys short-lived windows. `xdotool search` can die on
// one of them with an X BadWindow error. This happens on some starts only. The window id then stays
// empty, and a one-shot command would end with exit 1 and the window would stay small. So the
// command tries again until its budget is over. The states it covers:
//   success            the window is wide: exit 0, no key.
//   no window yet, or the search died   wait half a second and look again.
//   the key was sent   Alt+F10 is a toggle, so the width is polled for 3 s before another press;
//                      a slow window manager does not get a second press that would undo the first.
//                      The 3 s are a margin over what was measured (under 2.2 s), not a proven bound.
//   the key was lost   still narrow after those 3 s: the next round presses again.
//   budget over        exit 1; the caller logs a warning and the run goes on with a small window.
//   timeout            the budget (8 s), one last poll (3 s) and the clock's rounding stay under
//                      COMMAND_TIMEOUT_MS, which still bounds an xdotool that hangs; the caller
//                      treats that timeout like exit 1.
//   Stop               not tied to a run's stop signal: the whole start of a computer cannot be
//                      cancelled yet, and this is one bounded command inside it.
// Not covered: a window left small stays small until the browser starts again, because only the
// browser's start runs this. The upgrade is the same check on every connect.
export function maximizeChromeCommand(budgetSeconds = 8): string {
  const wide = RESOLUTION[0]
  return [
    `END=$(( $(date +%s) + ${budgetSeconds} ))`,
    'width() { xdotool getwindowgeometry --shell "$1" 2>/dev/null | sed -n "s/^WIDTH=//p"; }',
    'while [ "$(date +%s)" -lt "$END" ]; do',
    '  W=$(xdotool search --onlyvisible --class chrome 2>/dev/null | head -1)',
    '  WIDTH=$(width "$W")',
    `  if [ "\${WIDTH:-0}" -ge ${wide} ]; then exit 0; fi`,
    '  if [ -n "$W" ] && [ -n "$WIDTH" ]; then',
    '    xdotool windowactivate --sync "$W" key alt+F10 2>/dev/null',
    `    for i in 1 2 3 4 5 6; do sleep 0.5; NOW=$(width "$W"); if [ "\${NOW:-0}" -ge ${wide} ]; then exit 0; fi; done`,
    '  else',
    '    sleep 0.5',
    '  fi',
    'done',
    'exit 1',
  ].join('\n')
}

// The SDK's write() runs `xdotool type` in the C locale, where any character with a diacritic
// fails ("Invalid multi-byte sequence encountered"), so a text in a language that has them can
// never be typed that way. The sandbox has the C.utf8 locale, so the text is typed here under it,
// in short chunks so no single command outlives its timeout.
const TYPE_CHUNK_CHARS = 25
const TYPE_DELAY_MS = 40
const TYPING_ENV = { LC_ALL: 'C.UTF-8' }

/** Splits text into chunks of whole code points, so a chunk never ends inside one character. */
export function typingChunks(text: string, size = TYPE_CHUNK_CHARS): string[] {
  const chars = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(''))
  return chunks
}

/** The environment of the browser process: the display, and the zone every page will see. */
export function chromeEnv(timeZone: string): Record<string, string> {
  return { DISPLAY, TZ: timeZone }
}

/**
 * Sets the computer's own clock: the panel clock, `date`, and every process started later. The
 * symlink and /etc/timezone are what Debian and Ubuntu read; timedatectl needs systemd's service,
 * which this container does not run. The zone is an IANA name (config.ts validates it) and is
 * quoted anyway.
 */
export function clockCommand(timeZone: string): string {
  const zone = shellQuote(timeZone)
  return `sudo ln -sf /usr/share/zoneinfo/${zone} /etc/localtime && echo ${zone} | sudo tee /etc/timezone > /dev/null && date`
}

/** What stopProcessesCommand prints when SIGTERM was not enough and it sent SIGKILL. */
export const SIGKILL_NOTE = 'escalated to SIGKILL'

/**
 * Stops every process whose command line matches `pattern`, and returns only once they are gone:
 * SIGTERM first, which lets Chrome close and write its cookies, then SIGKILL once `graceSeconds` are
 * over, with SIGKILL_NOTE on stdout. A browser started while the old one still runs on the same
 * profile only hands its arguments to the old one and exits, so the old browser would keep its
 * zone. Exits 1 when something outlives SIGKILL too. Every alternative of the
 * pattern starts with a bracket expression, so pkill and pgrep never match the shell running this.
 */
export function stopProcessesCommand(pattern: string, graceSeconds = 5): string {
  const quoted = shellQuote(pattern)
  const waitGone = (ticks: number): string => `for i in $(seq ${ticks}); do pgrep -f ${quoted} > /dev/null || exit 0; sleep 0.2; done`
  return `pkill -f ${quoted}; ${waitGone(Math.max(1, Math.round(graceSeconds * 5)))}; echo '${SIGKILL_NOTE}'; pkill -9 -f ${quoted}; ${waitGone(10)}; exit 1`
}

export type CompanionSource = { py: string; js: string }

export type PauseResult = 'paused' | 'already-paused' | 'busy' | 'failed'

export type SandboxSession = {
  sandbox: SandboxPort
  sandboxId: string
  /** noVNC page, view only. Carries the auth key: shown to the operator, never logged. */
  streamViewUrl: string
  /** noVNC page with keyboard and mouse: only during takeover. */
  streamInteractiveUrl: string
  /** Extends the sandbox timeout to a full run length; called at the start of every run. */
  keepAlive(): Promise<void>
  /** Pauses the sandbox; the filesystem, the Chrome profile and its logins survive. */
  pause(): Promise<PauseResult>
  /** Copies the bot's workspace folder onto the computer, replacing files of the same name; called before every run. */
  syncWorkspace(localDir: string): Promise<void>
}

const KEY_NAME = /^(?:[A-Za-z][A-Za-z0-9_]*|[0-9])$/

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A non-zero exit of the command behind an action becomes a SandboxActionError; anything else is the computer failing. */
async function asAction<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (e) {
    if (e instanceof CommandExitError) throw new SandboxActionError(`the command failed on the computer (exit ${e.exitCode}): ${cleanedExcerpt(e.stderr, 200)}`)
    throw e
  }
}

export class E2bSandbox implements SandboxPort {
  constructor(
    readonly raw: Sandbox,
    readonly companion: CompanionPort,
  ) {}

  get sandboxId(): string {
    return this.raw.sandboxId
  }

  private async run(cmd: string, timeoutMs = COMMAND_TIMEOUT_MS, envs: Record<string, string> = {}): Promise<void> {
    await asAction(() => this.raw.commands.run(cmd, { timeoutMs, requestTimeoutMs: REQUEST_TIMEOUT_MS, envs: { DISPLAY, ...envs } }))
  }

  screenshot(): Promise<Uint8Array> {
    return asAction(() => this.raw.screenshot())
  }

  async moveMouse(p: Point): Promise<void> {
    await asAction(() => this.raw.moveMouse(p[0], p[1]))
  }

  // The SDK's click methods only move the mouse when both coordinates are truthy, so the move is
  // done here explicitly and the click is sent at the cursor.
  private async clickAt(p: Point | undefined, click: () => Promise<void>): Promise<void> {
    if (p) await this.moveMouse(p)
    await asAction(click)
  }

  leftClick(p?: Point): Promise<void> {
    return this.clickAt(p, () => this.raw.leftClick())
  }

  rightClick(p?: Point): Promise<void> {
    return this.clickAt(p, () => this.raw.rightClick())
  }

  middleClick(p?: Point): Promise<void> {
    return this.clickAt(p, () => this.raw.middleClick())
  }

  doubleClick(p?: Point): Promise<void> {
    return this.clickAt(p, () => this.raw.doubleClick())
  }

  /** One xdotool invocation, so the three clicks land inside the browser's multi-click interval. */
  async tripleClick(p?: Point): Promise<void> {
    const move = p ? `mousemove --sync ${p[0]} ${p[1]} ` : ''
    await this.run(`xdotool ${move}click --repeat 3 --delay 80 1`)
  }

  async mouseDown(): Promise<void> {
    await asAction(() => this.raw.mousePress('left'))
  }

  async mouseUp(): Promise<void> {
    await asAction(() => this.raw.mouseRelease('left'))
  }

  async drag(from: Point, to: Point): Promise<void> {
    await asAction(() => this.raw.drag(from, to))
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number, at?: Point): Promise<void> {
    if (at) await this.moveMouse(at)
    if (direction === 'up' || direction === 'down') {
      await asAction(() => this.raw.scroll(direction, amount))
      return
    }
    // Buttons 6 and 7 are the X11 horizontal wheel; `scripts/day-one.ts` checks that they work on this template.
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new SandboxActionError('invalid scroll amount')
    const button = direction === 'left' ? 6 : 7
    await this.run(`xdotool click --repeat ${amount} --delay 50 ${button}`)
  }

  async type(text: string): Promise<void> {
    for (const chunk of typingChunks(text)) {
      await this.run(`xdotool type --delay ${TYPE_DELAY_MS} -- ${shellQuote(chunk)}`, COMMAND_TIMEOUT_MS, TYPING_ENV)
    }
  }

  async press(keys: string[]): Promise<void> {
    for (const key of keys) {
      if (!KEY_NAME.test(key)) throw new SandboxActionError('invalid key name')
    }
    await asAction(() => this.raw.press(keys))
  }

  async holdKey(key: string, seconds: number): Promise<void> {
    if (!KEY_NAME.test(key)) throw new SandboxActionError('invalid key name')
    if (!Number.isFinite(seconds)) throw new SandboxActionError('invalid hold duration')
    const s = Math.min(Math.max(seconds, 0), MAX_HOLD_SECONDS)
    await this.run(`xdotool keydown ${key}; sleep ${s}; xdotool keyup ${key}`, s * 1000 + COMMAND_TIMEOUT_MS)
  }

  async cursorPosition(): Promise<Point> {
    const { x, y } = await asAction(() => this.raw.getCursorPosition())
    return [x, y]
  }

  async wait(ms: number): Promise<void> {
    await this.raw.wait(ms)
  }

  /** Opens a page in the running Chrome (same profile, so it lands as a new tab). */
  async openUrl(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new SandboxActionError('only http and https URLs can be opened')
    const handle = await this.raw.commands.run(
      `google-chrome --user-data-dir=${CHROME_PROFILE_DIR} ${shellQuote(parsed.toString())} > /dev/null 2>&1`,
      { background: true, timeoutMs: 0, envs: { DISPLAY }, requestTimeoutMs: REQUEST_TIMEOUT_MS },
    )
    await handle.disconnect()
  }
}

/** Creates the bot's computer: workspace files, the companion, the clock, Chrome, the stream. */
export async function createSandbox(botId: string, workspaceDir: string, companionSrc: CompanionSource, timeZone: string): Promise<SandboxSession> {
  const raw = await Sandbox.create({
    resolution: RESOLUTION,
    timeoutMs: RUN_TIMEOUT_MS,
    lifecycle: { onTimeout: 'pause' },
    metadata: { botId },
    requestTimeoutMs: API_TIMEOUT_MS,
  })
  log.info('sandbox created', { botId, sandboxId: raw.sandboxId })
  try {
    await raw.files.makeDir(WORKSPACE_DIR, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
    await raw.files.makeDir(COMPANION_DIR, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
    await uploadDirectory(raw, workspaceDir, WORKSPACE_DIR)
    await writeCompanion(raw, companionSrc)
    await raw.commands.run(`pip install ${WEBSOCKET_CLIENT}`, { timeoutMs: PIP_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
    await setClock(raw, timeZone)
    await startChrome(raw, { timeZone })
    return await startSession(raw, timeZone)
  } catch (e) {
    log.error('sandbox setup failed; killing the half-built sandbox', { botId, sandboxId: raw.sandboxId, ...errorFields(e) })
    await raw.kill().catch(() => undefined)
    throw e
  }
}

/**
 * Resumes a paused sandbox (or attaches to a running one), restarts the stream with a fresh auth
 * key and the companion with a fresh token. A browser started with another zone than the operator's
 * TZ — or with none, on a computer that has no marker file — is restarted once with the right one;
 * the profile and its logins are on disk and survive. Throws SandboxNotFoundError when the sandbox
 * is gone, and only then: the connect call alone decides that.
 */
export async function connectSandbox(sandboxId: string, companionSrc: CompanionSource, timeZone: string): Promise<SandboxSession> {
  const raw = await Sandbox.connect(sandboxId, { requestTimeoutMs: API_TIMEOUT_MS })
  return setUpAfterConnect(sandboxId, async () => {
    await raw.setTimeout(RUN_TIMEOUT_MS, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
    log.info('sandbox connected', { sandboxId })
    // The companion is restarted anyway, so a newer companion source reaches an existing sandbox.
    await writeCompanion(raw, companionSrc)
    await stopStream(raw)
    const recorded = await recordedZone(raw)
    if (recorded !== timeZone) {
      log.info('browser zone differs from TZ; setting the clock and restarting the browser once', { sandboxId, recorded, timeZone })
      await setClock(raw, timeZone)
      await restartChrome(raw, { timeZone })
    }
    return startSession(raw, timeZone)
  })
}

/**
 * Runs the steps that follow a successful connect. The SDK reports a short proxy error on a command
 * (429, 502, 503, 504) as SandboxNotFoundError. The sandbox answered the connect a moment ago, so
 * here that error is a failed step, not a lost computer: it leaves as a plain error with the
 * original as its cause, and the caller keeps the sandbox id with every login on it.
 */
export async function setUpAfterConnect<T>(sandboxId: string, steps: () => Promise<T>): Promise<T> {
  try {
    return await steps()
  } catch (e) {
    if (!(e instanceof SandboxNotFoundError)) throw e
    log.warn('a step after the connect answered "sandbox not found"; the sandbox id is kept', { sandboxId, ...errorFields(e) })
    throw new Error('the computer did not answer during its start-up; try again in a moment', { cause: e })
  }
}

/** Pauses the sandbox: retries once when the service is busy, reports failure instead of throwing. */
export async function pauseSandbox(raw: Sandbox): Promise<PauseResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const paused = await raw.pause({ requestTimeoutMs: PAUSE_TIMEOUT_MS })
      log.info('sandbox paused', { sandboxId: raw.sandboxId, alreadyPaused: !paused })
      return paused ? 'paused' : 'already-paused'
    } catch (e) {
      if (e instanceof ServiceBusyError) {
        if (attempt === 0) {
          await sleep(PAUSE_RETRY_MS)
          continue
        }
        log.warn('sandbox pause refused twice: service busy', { sandboxId: raw.sandboxId })
        return 'busy'
      }
      log.error('sandbox pause failed', { sandboxId: raw.sandboxId, ...errorFields(e) })
      return 'failed'
    }
  }
  return 'busy'
}

async function startSession(raw: Sandbox, timeZone: string): Promise<SandboxSession> {
  const token = randomBytes(24).toString('hex')
  hideInLogs([token])
  const companion = new CompanionClient('https://' + raw.getHost(COMPANION_PORT), token)
  await startCompanion(raw, token)
  if (!(await waitForCompanion(companion))) {
    log.warn('companion not healthy; restarting Chrome and the companion once', { sandboxId: raw.sandboxId })
    await restartChrome(raw, { timeZone })
    await startCompanion(raw, token)
    if (!(await waitForCompanion(companion))) throw new Error('companion unreachable')
  }
  const urls = await startStream(raw)
  return {
    sandbox: new E2bSandbox(raw, companion),
    sandboxId: raw.sandboxId,
    ...urls,
    keepAlive: () => raw.setTimeout(RUN_TIMEOUT_MS, { requestTimeoutMs: REQUEST_TIMEOUT_MS }),
    pause: () => pauseSandbox(raw),
    syncWorkspace: (localDir) => uploadDirectory(raw, localDir, WORKSPACE_DIR),
  }
}

async function writeCompanion(raw: Sandbox, src: CompanionSource): Promise<void> {
  await raw.files.write(posix.join(COMPANION_DIR, 'companion.py'), src.py, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
  await raw.files.write(posix.join(COMPANION_DIR, 'page-script.js'), src.js, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
}

/**
 * Uploads every file under `localDir` to `remoteDir`, overwriting a file of the same name. A file
 * deleted locally stays on the computer until it is rebuilt. A missing local folder is nothing to
 * upload, not an error.
 */
export async function uploadDirectory(raw: Sandbox, localDir: string, remoteDir: string): Promise<void> {
  if (!(await folderExists(localDir))) {
    log.warn('no workspace folder to upload', { sandboxId: raw.sandboxId, localDir })
    return
  }
  // From here every failure is real (a subfolder gone mid-walk, a file that cannot be read) and fails the sync.
  const entries: Dirent[] = await readdir(localDir, { withFileTypes: true, recursive: true })
  const madeDirs = new Set<string>([remoteDir])
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const localPath = join(entry.parentPath, entry.name)
    const remotePath = posix.join(remoteDir, ...relative(localDir, localPath).split(sep))
    const parent = posix.dirname(remotePath)
    if (!madeDirs.has(parent)) {
      await raw.files.makeDir(parent, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
      madeDirs.add(parent)
    }
    const bytes = await readFile(localPath)
    await raw.files.write(remotePath, new Blob([bytes]), { requestTimeoutMs: REQUEST_TIMEOUT_MS })
  }
}

/** False only when nothing is at the path. A link to nothing is a broken folder, not a missing one, and throws. */
async function folderExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    const linked = await lstat(path).then(() => true, () => false)
    if (linked) throw e
    return false
  }
}

/** Exported for `scripts/day-one.ts`, which checks whether --no-sandbox is needed in this container. */
export async function startChrome(raw: Sandbox, opts: { timeZone: string; noSandbox?: boolean }): Promise<void> {
  const flags = (opts.noSandbox ?? CHROME_NEEDS_NO_SANDBOX) ? [...CHROME_FLAGS, '--no-sandbox'] : CHROME_FLAGS
  const handle = await raw.commands.run(`google-chrome ${flags.join(' ')} about:blank > /tmp/chrome.log 2>&1`, {
    background: true,
    timeoutMs: 0,
    envs: chromeEnv(opts.timeZone),
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  })
  await handle.disconnect()
  await raw.files.write(ZONE_MARKER, opts.timeZone, { requestTimeoutMs: REQUEST_TIMEOUT_MS })
  await maximizeChrome(raw)
}

/** The zone the browser on this computer was last started with; null when the computer has no marker file. */
async function recordedZone(raw: Sandbox): Promise<string | null> {
  const result = await raw.commands.run(`cat ${ZONE_MARKER} 2>/dev/null || true`, { timeoutMs: COMMAND_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
  const zone = result.stdout.trim()
  return zone === '' ? null : zone
}

/** Best effort: a panel clock that stays on UTC costs nothing but a puzzled viewer; the browser's zone does not depend on it. */
async function setClock(raw: Sandbox, timeZone: string): Promise<void> {
  try {
    await raw.commands.run(clockCommand(timeZone), { timeoutMs: COMMAND_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
  } catch (e) {
    log.warn('could not set the computer clock', { sandboxId: raw.sandboxId, timeZone, ...errorFields(e) })
  }
}

/** Best effort: a window that stays small costs the model steps, never the run. */
async function maximizeChrome(raw: Sandbox): Promise<void> {
  try {
    await raw.commands.run(maximizeChromeCommand(), { timeoutMs: COMMAND_TIMEOUT_MS, envs: { DISPLAY }, requestTimeoutMs: REQUEST_TIMEOUT_MS })
  } catch (e) {
    log.warn('could not maximise the browser window', { sandboxId: raw.sandboxId, ...errorFields(e) })
  }
}

/** Runs stopProcessesCommand on the computer, and says in the log when SIGTERM was not enough or the stop failed. */
async function stopProcesses(raw: Sandbox, pattern: string, what: string, graceSeconds?: number): Promise<void> {
  let stdout: string
  try {
    stdout = (await raw.commands.run(stopProcessesCommand(pattern, graceSeconds), { timeoutMs: COMMAND_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })).stdout
  } catch (e) {
    // Exit 1 means something outlived SIGKILL; a timeout or a lost connection lands here too, and the
    // logged error name says which. The connect fails on it either way; the log says which stop.
    log.error(`could not stop ${what}`, { sandboxId: raw.sandboxId, ...errorFields(e) })
    throw e
  }
  if (stdout.includes(SIGKILL_NOTE)) log.warn(`${what} outlived SIGTERM and was killed`, { sandboxId: raw.sandboxId })
}

/** Stops the browser, waits until it is gone, and starts it again with the zone. Exported for `scripts/day-one.ts`. */
export async function restartChrome(raw: Sandbox, opts: { timeZone: string; noSandbox?: boolean }): Promise<void> {
  await stopProcesses(raw, '[c]hrome-profile', 'the old browser')
  await startChrome(raw, opts)
}

async function startCompanion(raw: Sandbox, token: string): Promise<void> {
  await raw.commands.run("pkill -f '[c]ompanion.py' || true", { timeoutMs: COMMAND_TIMEOUT_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS })
  const handle = await raw.commands.run(`python3 ${COMPANION_DIR}/companion.py > /tmp/companion.log 2>&1`, {
    background: true,
    timeoutMs: 0,
    envs: { COMPANION_TOKEN: token, COMPANION_PORT: String(COMPANION_PORT), DISPLAY },
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  })
  await handle.disconnect()
}

async function waitForCompanion(companion: CompanionPort): Promise<boolean> {
  const deadline = Date.now() + COMPANION_READY_MS
  while (Date.now() < deadline) {
    const health = await companion.health()
    if (health.ok && health.cdp) return true
    await sleep(COMPANION_POLL_MS)
  }
  return false
}

async function startStream(raw: Sandbox): Promise<{ streamViewUrl: string; streamInteractiveUrl: string }> {
  await raw.stream.start({ requireAuth: true })
  const authKey = raw.stream.getAuthKey()
  hideInLogs([authKey])
  return {
    streamViewUrl: raw.stream.getUrl({ authKey, viewOnly: true, resize: 'scale' }),
    streamInteractiveUrl: raw.stream.getUrl({ authKey, resize: 'scale' }),
  }
}

// After a resume the old stream still runs with the old key: x11vnc on :5900, and noVNC's proxy script
// with the websockify it starts, which holds :6080. The SDK's stop() sends x11vnc one SIGTERM without
// waiting, and kills a proxy only through a handle kept in its own memory, which a fresh connect never
// has. The call stays anyway, in case a later SDK version does more there. An x11vnc restored from a
// pause can outlive that stop by at least ten seconds, and the SDK's start() then refuses with
// "Stream is already running". So the old stream is stopped here and waited for.
// websockify is matched by name too: a proxy script killed before its cleanup would leave the old
// listener on :6080, and the SDK's start() waits only for that port to be open.
async function stopStream(raw: Sandbox): Promise<void> {
  try {
    await raw.stream.stop()
  } catch (e) {
    log.warn('stream stop failed; continuing', { sandboxId: raw.sandboxId, ...errorFields(e) })
  }
  await stopProcesses(raw, '[x]11vnc|[n]ovnc_proxy|[w]ebsockify', 'the old stream', STREAM_STOP_GRACE_SECONDS)
}
