# x11vnc input switch on E2B's desktop template

Probe run on 2026-09-25 for the [screen ownership spec](../../specs/2026-09-25-screen-ownership-design.md).
A throwaway sandbox from the default `desktop` template, stream started as the SDK does
(`@e2b/desktop` 2.4.0, `requireAuth: true`), input sent by a VNC client (vncdotool) inside the
sandbox, pointer position read with `xdotool`. The sandbox was killed at the end. No model call.

```sh
pnpm exec tsx docs/evidence/2026-09-25-screen-ownership/probe.mts
```

| Step | Result |
| --- | --- |
| x11vnc version | 0.9.16, lastmod 2019-01-05 |
| Input on, a new client moves to 100,100 | pointer at 100,100 |
| `x11vnc -sync -R viewonly`, then `-query viewonly` | `ack=1`, `ans=viewonly:1` |
| Input off, a new client tries 300,300 | pointer stays at 100,100 |
| `-R noviewonly`; a client connects and moves to 150,150 | `ans=viewonly:0`, pointer at 150,150 |
| `-R viewonly` while that client stays connected; it then tries 400,400 | `ans=viewonly:1`, pointer stays at 150,150 |
| `-R noviewonly`; a new client moves to 500,500 | `ans=viewonly:0`, pointer at 500,500 |

Conclusion: the global view-only switch is enforced by the server, for new clients and for a
client that is already connected, and it can be turned back on and off at runtime.
