// Live check of the maximise fix (2026-09-18): on newly created throwaway computers, run the
// platform's own startChrome (which runs maximizeChromeCommand) and read the window's width.
// Each trial's sandbox is killed at the end.   pnpm exec tsx data/maximize-verify.mts [trials]
process.loadEnvFile('.env.local')
const { Sandbox } = await import('@e2b/desktop')
const { startChrome } = await import('../src/server/sandbox/e2b')
const trials = Number(process.argv[2] ?? 3)
for (let t = 1; t <= trials; t++) {
  const t0 = Date.now()
  const sbx = await Sandbox.create({ resolution: [1280, 800], timeoutMs: 5 * 60_000, metadata: { botId: 'maximize-verify' }, domain: process.env.E2B_DOMAIN || undefined })
  try {
    await sbx.commands.run('pip install websocket-client', { timeoutMs: 180_000 })
    const s0 = Date.now()
    await startChrome(sbx, { timeZone: 'Europe/Prague' })
    const took = ((Date.now() - s0) / 1000).toFixed(1)
    const r = await sbx.commands.run('W=$(xdotool search --onlyvisible --class chrome | head -1); xdotool getwindowgeometry --shell "$W" | sed -n "s/^WIDTH=//p"', { envs: { DISPLAY: ':0' }, timeoutMs: 15_000 })
    console.log(`trial ${t}: startChrome took ${took}s, window width afterwards = ${r.stdout.trim()} (created ${((s0 - t0) / 1000).toFixed(1)}s before the browser start)`)
  } finally {
    await sbx.kill().catch(() => undefined)
  }
}
