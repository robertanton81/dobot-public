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
