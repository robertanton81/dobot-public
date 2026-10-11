// The day-one checks of the platform plan (Task 4): the five things the spec makes conditional.
//
//   pnpm day-one create <scheduling-page-url> <application-form-url> <path-to-cv.pdf>
//   pnpm day-one resume <sandboxId> [<scheduling-page-url>]
//
// `create` builds a sandbox exactly as the platform does, prints the stream URLs and walks the
// operator through the checks on real pages; it ends by pausing the sandbox. `resume` connects to
// the paused sandbox the next day and checks that the stream, the companion and the open page come
// back, then lets the operator sign in to the mailbox and make a test booking by hand through the
// interactive stream. The script never types a password. Results go into the plan's
// "Day-one results" section by hand.
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { loadConfig } from '../src/server/config'
import { matchRule } from '../src/server/agent/gate'
import { meanAbsDiff } from '../src/server/agent/images'
import { COMPANION_PORT, connectSandbox, createSandbox, E2bSandbox, restartChrome, type SandboxSession } from '../src/server/sandbox/e2b'
import { loadCompanionSource } from '../src/server/sandbox/manager'
import type { Point } from '../src/server/sandbox/port'

const rl = createInterface({ input: stdin, output: stdout })
const outDir = join(tmpdir(), 'dobot-day-one')

function verdict(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

function raw(session: SandboxSession): E2bSandbox {
  if (!(session.sandbox instanceof E2bSandbox)) throw new Error('not an E2B session')
  return session.sandbox
}

async function shot(session: SandboxSession, name: string): Promise<Uint8Array> {
  const png = await session.sandbox.screenshot()
  const path = join(outDir, name + '.png')
  await writeFile(path, png)
  console.log(`screenshot saved: ${path}`)
  return png
}

function parsePoint(text: string): Point | null {
  const [x, y] = text.trim().split(/\s+/).map(Number)
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return null
  return [x, y]
}

async function askPoint(question: string): Promise<Point | null> {
  const answer = (await rl.question(`${question} (x y, or empty to skip): `)).trim()
  if (!answer) return null
  return parsePoint(answer) ?? askPoint(question)
}

// The operator types "x y" to describe the element under a screen point, or "click x y" to click
// there first (a cookie banner covering the page, for example) and get a fresh screenshot. A click
// is described before it lands, and when the gate's own rules call the element a send control
// (`submit-control` or `verb-name`) the operator has to type "yes": these are real pages.
// "type <text>" types into the focused field and "key <name>" presses one key (Tab, Return), so a
// form can be filled through the platform's own actions instead of the interactive stream; the
// script never types a password, so a sign-in stays with the human on the stream.
async function inspectPoints(session: SandboxSession, page: string): Promise<void> {
  const slug = page.replace(/\s+/g, '-').toLowerCase()
  let clicks = 0
  for (;;) {
    const answer = (await rl.question(`${page}: a point to inspect, "click x y", "type <text>", "key <name>", or empty to continue: `)).trim()
    if (!answer) return
    if (answer.startsWith('type ') || answer.startsWith('key ')) {
      const text = answer.slice(answer.indexOf(' ') + 1)
      if (answer.startsWith('type ')) await session.sandbox.type(text)
      else await session.sandbox.press([text])
      clicks += 1
      await session.sandbox.wait(1000)
      await shot(session, `${slug}-after-input-${clicks}`)
      continue
    }
    const click = answer.startsWith('click ')
    const point = parsePoint(click ? answer.slice('click '.length) : answer)
    if (!point) continue
    if (click) {
      const info = await session.sandbox.companion.elementAt(point)
      console.log(JSON.stringify(info, null, 2))
      const rule = matchRule('click', info)
      if (rule === 'submit-control' || rule === 'verb-name') {
        const sure = (await rl.question(`that is a send control (${rule}); type "yes" to click it anyway: `)).trim()
        if (sure !== 'yes') {
          console.log('click skipped')
          continue
        }
      }
      clicks += 1
      await session.sandbox.leftClick(point)
      await session.sandbox.wait(1500)
      await shot(session, `${slug}-after-click-${clicks}`)
      continue
    }
    console.log(JSON.stringify(await session.sandbox.companion.elementAt(point), null, 2))
  }
}

async function create(urlA: string, urlB: string, cvPath: string, timeZone: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const workspace = await mkdtemp(join(tmpdir(), 'dobot-day-one-ws-'))
  const cvName = basename(cvPath)
  await copyFile(cvPath, join(workspace, cvName))
  console.log('creating the sandbox …')
  const session = await createSandbox('day-one', workspace, loadCompanionSource(), timeZone)
  const sandbox = raw(session)
  console.log(`sandbox id: ${session.sandboxId}`)
  console.log(`view-only stream:   ${session.streamViewUrl}`)
  console.log(`interactive stream: ${session.streamInteractiveUrl}`)

  // 1 + 3: the companion is up and Chrome accepts CDP
  let health = await session.sandbox.companion.health()
  verdict('1. companion health', health.ok && health.cdp, JSON.stringify(health))
  if (!health.cdp) {
    console.log('Chrome refused CDP or died; restarting it with --no-sandbox …')
    await restartChrome(sandbox.raw, { noSandbox: true, timeZone })
    await new Promise((r) => setTimeout(r, 4000))
    health = await session.sandbox.companion.health()
    verdict('3. Chrome with --no-sandbox accepts CDP (set CHROME_NEEDS_NO_SANDBOX = true)', health.cdp, JSON.stringify(health))
  } else {
    verdict('3. Chrome accepts CDP with the default flags (CHROME_NEEDS_NO_SANDBOX stays false)', true)
  }

  // 2: the token protects the public port
  const bare = await fetch(`https://${sandbox.raw.getHost(COMPANION_PORT)}/health`, { signal: AbortSignal.timeout(10_000) }).catch((e: unknown) => e)
  const status = bare instanceof Response ? bare.status : `error: ${String(bare)}`
  verdict('2. a request without the token is refused', bare instanceof Response && bare.status === 401, `status ${status}`)

  // 3b: xdotool and the horizontal wheel
  const which = await sandbox.raw.commands.run('which xdotool', { timeoutMs: 15_000 }).catch(() => null)
  verdict('3b. xdotool present', which !== null && which.exitCode === 0, which?.stdout.trim() ?? 'not found')

  // 4: elementFromPoint on the two real pages
  await sandbox.openUrl(urlA)
  await sandbox.wait(5000)
  const before = await shot(session, 'page-a')
  await session.sandbox.scroll('right', 5)
  await sandbox.wait(1000)
  const after = await shot(session, 'page-a-after-scroll-right')
  console.log(`INFO horizontal scroll: mean pixel difference ${meanAbsDiff(before, after).toFixed(2)} (a scrollable page moves; compare the two screenshots)`)
  console.log('4a. open page-a.png, find the control you want to check and type its coordinates.')
  await inspectPoints(session, 'page A')

  await sandbox.openUrl(urlB)
  await sandbox.wait(5000)
  await shot(session, 'page-b')
  console.log('4b. page B: inspect the submit control (expect isSubmit true and its name) and the upload control.')
  await inspectPoints(session, 'page B')

  // 5: file upload through the file-input API. The platform decides whether the companion may
  // click the control, so the script makes the same decision the agent's attach_file makes: the
  // element is described, a send control is never clicked, and an unresolvable one gets no click.
  const upload = await askPoint('5. the upload control on page B')
  if (upload) {
    const info = await session.sandbox.companion.elementAt(upload)
    console.log(JSON.stringify(info, null, 2))
    const rule = matchRule('click', info)
    if (rule === 'submit-control' || rule === 'verb-name') {
      verdict('5. setFiles', false, `the gate calls that a send control (${rule}); attach_file would refuse it`)
    } else {
      const click = rule === null
      if (!click) console.log('the companion cannot resolve that element, so it will not click it: DOM lookup only')
      try {
        await session.sandbox.companion.setFiles(upload, `/home/user/workspace/${cvName}`, { click })
        await sandbox.wait(1500)
        await shot(session, 'page-b-after-upload')
        verdict(`5. setFiles accepted the file (click ${click ? 'allowed' : 'withheld'}); check the screenshot for the file name`, true)
      } catch (e) {
        verdict('5. setFiles', false, String(e))
      }
    }
  }

  // 6: pause
  const paused = await session.pause()
  verdict('6. pause', paused === 'paused' || paused === 'already-paused', paused)
  console.log(`resume tomorrow with: pnpm day-one resume ${session.sandboxId}`)
}

// `urlA` is optional: when the scheduling page changed after `create`, pass the new address to
// inspect its controls on the resumed sandbox before the manual steps.
async function resume(sandboxId: string, urlA: string | null, timeZone: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  console.log('connecting …')
  const session = await connectSandbox(sandboxId, loadCompanionSource(), timeZone)
  const sandbox = raw(session)
  console.log(`view-only stream:   ${session.streamViewUrl}`)
  console.log(`interactive stream: ${session.streamInteractiveUrl}`)
  const health = await session.sandbox.companion.health()
  verdict('resume: companion back', health.ok && health.cdp, JSON.stringify(health))
  const version = await sandbox.raw.commands.run('google-chrome --version', { timeoutMs: 15_000 }).catch(() => null)
  console.log(`INFO Chrome version: ${version?.stdout.trim() || 'unknown'}`)
  await shot(session, 'resumed')
  console.log('check the screenshot: is the page from yesterday still open (the Chrome profile survived)?')
  if (urlA) {
    await sandbox.openUrl(urlA)
    await sandbox.wait(5000)
    await shot(session, 'resumed-page-a')
    console.log('resume: page A is open; inspect a day button and a time button (the descriptor should name them).')
    await inspectPoints(session, 'resumed page A')
  }
  console.log('Now, through the INTERACTIVE stream in your browser: sign in to the mailbox, then make one test booking on the scheduling page from the sandbox IP and cancel it afterwards. Never type a password anywhere but on the remote screen.')
  await rl.question('press Enter when done …')
  const state = await session.sandbox.companion.pageState().catch((e: unknown) => ({ error: String(e) }))
  console.log(`page state now: ${JSON.stringify(state)}`)
  const paused = await session.pause()
  verdict('pause again', paused === 'paused' || paused === 'already-paused', paused)
}

async function main(): Promise<void> {
  const config = loadConfig() // loads .env.local; the SDK reads E2B_API_KEY from the environment
  const [command, ...args] = process.argv.slice(2)
  if (command === 'create' && args.length === 3) await create(args[0] ?? '', args[1] ?? '', args[2] ?? '', config.TZ)
  else if (command === 'resume' && (args.length === 1 || args.length === 2)) await resume(args[0] ?? '', args[1] ?? null, config.TZ)
  else {
    console.log('usage: pnpm day-one create <scheduling-page-url> <application-form-url> <path-to-cv.pdf>')
    console.log('       pnpm day-one resume <sandboxId> [<scheduling-page-url>]')
    process.exitCode = 2
  }
  rl.close()
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
