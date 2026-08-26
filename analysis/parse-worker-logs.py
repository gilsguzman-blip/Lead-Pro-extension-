#!/usr/bin/env python3
"""Parse a Cloudflare Workers log export for the leadpro-proxy post-deploy review.

Usage: python3 analysis/parse-worker-logs.py <logs.json>

Reports, per script version: request counts, hard errors by path, prompt-cache
prefix stability, cold-start classification by tier, and prefilter shadow accuracy.
"""
import json, re, sys, statistics
from collections import Counter, defaultdict

path_arg = sys.argv[1] if len(sys.argv) > 1 else None
if not path_arg:
    sys.exit(__doc__)
entries = json.load(open(path_arg))

def msg(e):  return (e.get('source') or {}).get('message', '')
def meta(e): return e.get('$metadata') or {}
def wk(e):   return e.get('$workers') or {}
def ver(e):  return (wk(e).get('scriptVersion') or {}).get('id', '?')[:8]
def route(e): return (((wk(e).get('event') or {}).get('request')) or {}).get('path', '?')

print(f'entries={len(entries)}')

# --- deploy windows -------------------------------------------------------
windows = defaultdict(list)
for e in entries:
    if ver(e) != '?':
        windows[ver(e)].append(e['timestamp'])
print('\n== script versions ==')
for v, ts in sorted(windows.items(), key=lambda kv: min(kv[1])):
    print(f'  {v}  n={len(ts):<5} {min(ts)} .. {max(ts)}')

# --- hard errors, grouped into real requests ------------------------------
requests = defaultdict(list)
for e in entries:
    if meta(e).get('requestId'):
        requests[meta(e)['requestId']].append(e)
print(f'\n== requests == distinct={len(requests)}')

failures = defaultdict(lambda: Counter())
for rid, evs in requests.items():
    # Both the request line and the exception line carry level=error; prefer the
    # exception, whose message names the actual fault rather than the POST URL.
    errs = [meta(e).get('error') for e in evs if meta(e).get('level') == 'error']
    err = next((x for x in errs if x and not x.startswith(('GET ', 'POST '))), None) \
        or next((x for x in errs if x), None)
    v = next((ver(e) for e in evs if ver(e) != '?'), '?')
    r = next((route(e) for e in evs if route(e) != '?'), '?')
    failures[(v, r)]['total'] += 1
    if err:
        failures[(v, r)]['failed'] += 1
        failures[(v, r)][err[:60]] += 1
print('\n== failures by version + route ==')
for (v, r), c in sorted(failures.items()):
    if c['failed']:
        detail = ', '.join(f'{k}={n}' for k, n in c.items() if k not in ('total', 'failed'))
        print(f'  {v} {r:<24} {c["failed"]}/{c["total"]} failed  [{detail}]')

# --- prompt cache ---------------------------------------------------------
CACHE_RE = re.compile(
    r'CACHE (\w+) cached=(\d+)/(\d+) \(([\d.]+)%\) written=(\d+) \| '
    r'sysChars=(\d+) userChars=(\d+) sysTokEst=(\d+) ceiling=([\d.]+)% '
    r'cachedOfSys=(\d+)% key=(\S+)')
rows = []
for e in entries:
    m = CACHE_RE.search(msg(e))
    if m:
        g = m.groups()
        rows.append(dict(tier=g[0], cached=int(g[1]), written=int(g[4]),
                         sys_chars=int(g[5]), sys_tok=int(g[7]), key=g[10]))
print(f'\n== prompt cache == rows={len(rows)} written>0={sum(1 for r in rows if r["written"])}')
by_key = defaultdict(list)
for r in rows:
    by_key[r['key']].append(r)
for k, rs in by_key.items():
    chars = sorted(r['sys_chars'] for r in rs)
    print(f'  {k}: n={len(rs):<3} sysChars {chars[0]}..{chars[-1]} '
          f'({len(set(chars))} distinct)  cached={sorted(set(r["cached"] for r in rs))}')

# A prompt below the provider's minimum cacheable prefix can never report a hit;
# counting those as cold starts overstates the miss rate.
MIN_CACHEABLE_TOKENS = 1024
cacheable = [r for r in rows if r['sys_tok'] >= MIN_CACHEABLE_TOKENS]
too_small = [r for r in rows if r['sys_tok'] < MIN_CACHEABLE_TOKENS]
print(f'  below cacheable floor: {len(too_small)}/{len(rows)} (always cached=0)')
if cacheable:
    waste = [r['sys_tok'] - r['cached'] for r in cacheable]
    print(f'  cacheable rows: {len(cacheable)}, cold={sum(1 for r in cacheable if not r["cached"])}')
    print(f'  uncached system tokens/req: min={min(waste)} avg={round(statistics.mean(waste))} max={max(waste)}')

# --- prefilter shadow -----------------------------------------------------
PF_RE = re.compile(r'PREFILTER shadow wouldSkip=(\w+) pf\(sms=(\w+) email=(\w+)\) '
                   r'model\(sms=(\w+) email=(\w+)\) miss=(\w+)')
pf = [PF_RE.search(msg(e)).groups() for e in entries if PF_RE.search(msg(e))]
if pf:
    skips = [p for p in pf if p[0] == 'true']
    lost = [p for p in skips if 'true' in (p[3], p[4])]
    print(f'\n== prefilter shadow == n={len(pf)} misses={sum(1 for p in pf if p[5] == "true")}')
    print(f'  wouldSkip={len(skips)} ({len(skips)/len(pf):.0%} of classify calls avoidable), '
          f'flagged leads lost by skipping={len(lost)}')

# --- generate path --------------------------------------------------------
totals = [int(m.group(1)) for e in entries if (m := re.search(r'FINAL total=(\d+)ms', msg(e)))]
if totals:
    print(f'\n== generate == completed={len(totals)} median={statistics.median(totals):.0f}ms '
          f'mean={statistics.mean(totals):.0f}ms max={max(totals)}ms')
    flagged = sum(1 for e in entries if 'flagged=true' in msg(e))
    cls_failed = sum(1 for e in entries if 'classifyFailed=true' in msg(e))
    fallback = sum(1 for e in entries if '] FALLBACK' in msg(e))
    print(f'  flagged={flagged} classifyFailed={cls_failed} fallback={fallback}')
