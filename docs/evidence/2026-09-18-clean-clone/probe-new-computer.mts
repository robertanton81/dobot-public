// Reproduction on a NEWLY CREATED computer, where the clean-clone check saw the maximise fail.
// Per trial: create a desktop sandbox as the platform does, pip install, start the browser with the
// platform's flags (read from the browser of an existing throwaway computer), then run the maximise
// sequence at once, piece by piece, and again every 2 s. The trial's sandbox is killed at the end.
//   pnpm exec tsx data/maximize-fresh.mts <existingSandboxId> [trials]
process.loadEnvFile('.env.local')
const { Sandbox } = await import('@e2b/desktop')
const domain = process.env.E2B_DOMAIN || undefined
const src = await Sandbox.connect(process.argv[2]!, { domain })
const flags = (await src.commands.run(String.raw`for q in $(pgrep -f '[r]emote-debugging-port=9222'); do if [ "$(ps -o comm= -p $q)" = chrome ]; then tr '\0' '\n' < /proc/$q/cmdline | grep '^--' | tr '\n' ' '; break; fi; done`, { envs: { DISPLAY: ':0' } })).stdout.trim()
console.log(`flags found: ${flags.split(' ').filter(Boolean).length}`)
const trials = Number(process.argv[3] ?? 2)
const envs = { DISPLAY: ':0', TZ: 'Europe/Prague' }
const VERBOSE = [
  'W=$(xdotool search --sync --onlyvisible --class chrome | head -1); echo "search: W=$W all=$(xdotool search --onlyvisible --class chrome | tr "\\n" ",")"',
  'G=$(xdotool getwindowgeometry --shell "$W" 2>&1); WIDTH=$(echo "$G" | sed -n "s/^WIDTH=//p"); echo "WIDTH=$WIDTH"',
  'echo "wm: $(xprop -root _NET_SUPPORTING_WM_CHECK 2>&1 | cut -c1-60) | active-window support: $(xprop -root _NET_SUPPORTED 2>/dev/null | grep -c _NET_ACTIVE_WINDOW)"',
  'if [ "${WIDTH:-0}" -lt 1280 ]; then xdotool windowactivate --sync "$W" key alt+F10 2>&1; echo "activate+key exit=$?"; fi',
].join('; ')
for (let t = 1; t <= trials; t++) {
  const t0 = Date.now()
  const sbx = await Sandbox.create({ resolution: [1280, 800], timeoutMs: 5 * 60_000, metadata: { botId: 'maximize-probe' } })
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
  try {
    console.log(`trial ${t}: created at ${at()}`)
    await sbx.commands.run('pip install websocket-client', { timeoutMs: 180_000 })
    const h = await sbx.commands.run(`google-chrome ${flags} about:blank > /tmp/chrome.log 2>&1`, { background: true, timeoutMs: 0, envs })
    await h.disconnect()
    await sbx.files.write('/home/user/.marker', 'x')
    for (let k = 0; k < 4; k++) {
      let out: string
      try {
        const r = await sbx.commands.run(VERBOSE, { timeoutMs: 20_000, envs })
        out = `exit=${r.exitCode} ${JSON.stringify((r.stdout + (r.stderr ? ' STDERR: ' + r.stderr : '')).trim().slice(0, 600))}`
      } catch (e: any) {
        out = `THROWN exit=${e?.exitCode} ${JSON.stringify((String(e?.stdout ?? '') + ' STDERR: ' + String(e?.stderr ?? '')).trim().slice(0, 600))}`
      }
      console.log(`trial ${t} attempt ${k + 1} at ${at()}: ${out}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  } finally {
    await sbx.kill().catch(() => undefined)
    console.log(`trial ${t}: throwaway sandbox killed`)
  }
}
