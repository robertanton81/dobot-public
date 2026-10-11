# Evidence: the mail-run loops of 2026-09-17

> Snapshot note: this record names raw logs, screenshots, generated documents or bot files that are not part of this public snapshot. The written results and the small result files in this folder remain.

Event logs copied from `data/bots/job-hunt-bot/runs/<run>/events.jsonl` (the run log: every model call's cost, every step, every gate decision, every tool call and result; screenshots by hash) and a few of their screenshots. Times in the logs are UTC; Prague was UTC+2. The measurement script at the end reproduces the table in the platform plan's "Correction" of 2026-09-17.

| File | Run |
| --- | --- |
| `3f0235c8-events.jsonl` | 09:05 the booking run on three mails, finished (the reference batch) |
| `118b2ee2-events.jsonl` | 09:28 the re-run under the first length rule: the refused slot, the retry, the cap |
| `cbd1f246-events.jsonl` | 09:34 loop 1, six mails, ended by the 100-step cap |
| `d4e20693-events.jsonl` | 11:41 loop 2, the plan's five mails, stopped |
| `f88c136c-events.jsonl` | 11:49 loop 3, stopped |
| `23092bd0-events.jsonl` | 11:57 loop 4, stopped |
| `7b72be72-events.jsonl` | 12:09 loop 5, stopped |
| `68a0fad7-events.jsonl` | 12:19 Step B, a typed request, finished |
| `d4e20693-first-inbox.png` | the inbox at the start of loop 2: two invitations, two cancellations, one confirmation (the subjects, the address bar and the status bar are painted over) |
| `cbd1f246-last.png` | the last screenshot of loop 1, a confirmation mail open again |
| `7b72be72-last.png` | the last screenshot of loop 5, a cancellation mail open again |
| `d4e20693-mail-mid75.png`, `d4e20693-mail-mid73.png` | loop 2, steps 8 and 17: two different cancellation mails in the same template, the pair the progress guard's screen rule is pinned on (`src/server/agent/progress.test.ts`). In this snapshot the address bar, the subject, the recipient and the name row are painted over; the test still passes on the painted images. |
| `replay-guard.ts` | replays the recorded runs, screenshots included, through the progress guard's old and new rules (the table in the thinking-continuity plan, "the transport, not the SDK") |

## The measurement

For each run: the longest stretch of steps with no new action signature (a click at a new place on a 16-pixel grid, new text, a new scroll direction at a place) and no platform tool call (a repeated `open_url` counts as a step); screenshots, zooms and waits never count as new.

```python
import json, glob
GRID = 16
def sig(x):
    a = x.get('action'); inp = x.get('input') or {}
    if a in ('screenshot', 'zoom', 'wait', 'cursor_position'): return None
    parts = [a]; c = inp.get('coordinate')
    if c: parts.append('@%d,%d' % (round(c[0] / GRID), round(c[1] / GRID)))
    if isinstance(inp.get('text'), str): parts.append(':' + inp['text'][:40])
    if inp.get('scroll_direction'): parts.append(':' + inp['scroll_direction'])
    return ''.join(parts)
for f in sorted(glob.glob('*-events.jsonl')):
    rows = [json.loads(l) for l in open(f, encoding='utf-8') if l.strip()]
    seen, urls, stretch, longest, steps = set(), set(), 0, 0, 0
    for x in rows:
        if x.get('type') == 'tool_call':
            url = (x.get('input') or {}).get('url') if x.get('name') == 'open_url' else None
            if url is not None and url in urls: stretch += 1
            else:
                if url is not None: urls.add(url)
                stretch = 0
            continue
        if x.get('type') != 'step': continue
        steps += 1; s = sig(x)
        if s is None or s in seen: stretch += 1
        else: seen.add(s); stretch = 0
        longest = max(longest, stretch)
    end = [e.get('outcome') for e in rows if e.get('type') == 'end']
    print(f, rows[0]['t'][11:16], end[-1] if end else 'open', 'steps', steps, 'longest stretch', longest)
```

The guard built on it: `src/server/agent/progress.ts` (commit `4da2796`).
