// Does x11vnc in E2B's desktop template discard VNC input after `x11vnc -R viewonly`, for new
// clients and for a client that is already connected? And does `-R noviewonly` give input back?
//
//   pnpm exec tsx docs/evidence/2026-09-25-screen-ownership/probe.mts
//
// Creates a throwaway desktop sandbox, starts the stream as the SDK does (`requireAuth: true`),
// installs a VNC client (vncdotool) inside it, and moves the mouse through VNC. The pointer position
// that xdotool reads is the proof that input arrived. The sandbox is killed at the end, also on
// failure. Reads E2B_API_KEY and E2B_DOMAIN from .env.local; prints no key and no stream password.
process.loadEnvFile('.env.local')
import { Sandbox } from '@e2b/desktop'

const sandbox = await Sandbox.create({ timeoutMs: 10 * 60_000 })
const results: Record<string, unknown> = { sandbox: 'created' }
try {
  await sandbox.stream.start({ requireAuth: true })
  const envs = { VNC_PW: sandbox.stream.getAuthKey(), DISPLAY: sandbox.display }
  const sh = async (cmd: string, timeoutMs = 60_000) => (await sandbox.commands.run(cmd, { envs, timeoutMs })).stdout.trim()
  const vnc = (actions: string) => `vncdo -s 127.0.0.1::5900 -p "$VNC_PW" ${actions}`
  const pointer = () => sh('xdotool getmouselocation --shell | head -2 | tr "\\n" " "')
  const remote = (cmd: string) => sh(`x11vnc -display "$DISPLAY" -sync -R ${cmd} 2>/dev/null; x11vnc -display "$DISPLAY" -query viewonly 2>/dev/null`)

  results.x11vncVersion = await sh('x11vnc -version 2>/dev/null | head -1')
  await sh('pip install --quiet --user vncdotool 2>&1 | tail -1; ln -sf ~/.local/bin/vncdo /tmp/vncdo', 240_000)
  const path = 'PATH=$HOME/.local/bin:$PATH'

  await sh(`${path} ${vnc('move 100 100')}`)
  results['1 input on, new client moves to 100,100'] = await pointer()

  results['2 -R viewonly answers'] = await remote('viewonly')
  await sh(`${path} ${vnc('move 300 300')}`)
  results['2 input off, new client tries 300,300'] = await pointer()

  results['3 -R noviewonly answers'] = await remote('noviewonly')
  // One client stays connected across the switch: it moves, waits, and moves again.
  await sh(`${path} nohup sh -c '${vnc('move 150 150 pause 8 move 400 400')}' >/tmp/held.log 2>&1 &`)
  await sh('sleep 3')
  results['3 connected client moved to 150,150 while input on'] = await pointer()
  results['3 -R viewonly while that client is connected'] = await remote('viewonly')
  await sh('sleep 9')
  results['3 connected client tried 400,400 after the switch'] = await pointer()

  results['4 -R noviewonly answers'] = await remote('noviewonly')
  await sh(`${path} ${vnc('move 500 500')}`)
  results['4 input on again, new client moves to 500,500'] = await pointer()
} catch (e) {
  results.error = e instanceof Error ? `${e.name}: ${e.message.slice(0, 300)}` : String(e)
} finally {
  await sandbox.kill()
  results.sandbox = 'killed'
}
console.log(JSON.stringify(results, null, 2))
