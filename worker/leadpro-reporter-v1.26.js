/**
 * v1.26: AUDIT #2, BATCH A -- MEASUREMENT ONLY (AUDIT_2026-11-10_PERFORMANCE_LOGIC.md, MS-1). Extension 9.7.868 and proxy v7.92 ship
 * beside it; it reads only what they write, and an older extension or proxy simply leaves the new tables empty, so any deploy order
 * works.
 *
 *   MS-1.1 EVERY REQUEST HAS A NAME. 4,550 of 11/9's 5,454 requests were "Unknown (no START line)": routes that never write a START
 *   line (inventory, incentives, feedback, commit-comprehension, click path, license checks). Logpush carries each request's URL, so
 *   a request with no START line is now labeled by its path ("Route /inventory"), and those rows sort after the draft contracts.
 *   MS-1.2 WHICH DIRECTIVES FIRE. Extension 9.7.868 sends the labels each prompt carried (meta.directives). A Directives table counts,
 *   per label, the sessions whose prompt carried it and what happened to their drafts: shipped, and regenerated-or-abandoned. Top 40.
 *   MS-1.3 PROMPT LENGTH. meta.promptChars: median, P95, max, and how many were over 60,000 characters.
 *   MS-1.4 THE NOTE-TYPE TABLE. A comprehension row carries a note type only when the pattern reader fired, so on 11/9 the table was
 *   256 rows of "unknown". It is shown when at least a tenth of the rows have a type; otherwise one line says why it is not.
 *   MS-1.5 KEY INFORMATION AND THE CLASSIFIER. meta.keyInfoRows: how many sessions kept key-information rows; and the proxy's
 *   classifyMs (v7.92, on its FINAL line): median, P95, max over the drafts it classified.
 *
 *   Covered by tests/reporter-v126.test.js. v1.25 fails it. Builds on v1.25.
 */
/**
 * v1.25: AUDIT PHASE 2, BATCH 3 -- MEASUREMENT ONLY (AUDIT_2026-11-03_FULL_SYSTEM.md, M-4 and M-9 step 2). Proxy v7.91 and the
 * extension unchanged; this reads what they already write, so either can deploy first.
 *
 *   M-4 (1) RECOVERED IS NOT A FAILURE. "Failures (N)" counted every request with a failed tier, and "Completion Rate" was
 *   taken against it, so a primary timeout that the fallback answered counted the same as a request that served the canned
 *   safe fallback. On 11/2 both "failures" were recovered. Now: Recovered (a later tier answered), Served safe fallback (the
 *   proxy's SAFE_FALLBACK line: every tier failed on a draft) and Nothing served (TIERS EXHAUSTED: every tier failed on a
 *   non-draft call). Completion counts only the last two against it. The "by reason" line is labeled as tier events.
 *   (2) PER CONTRACT, FULL DRAFTS FIRST. "Total Requests" and the 147 ms median mixed drafts, rewrites, fact probes,
 *   translations and edge-cache hits. The START line carries the request id, cacheKey and contract; each cacheKey is one
 *   prompt family, so a few perf rows (perf:<ts>:<requestId>, fullDraft / smsRefine / contract) label each key: Full draft,
 *   SMS rewrite, Other draft-contract call, Fact probe; [EDGE-CACHE] HIT lines are edge hits. Sampling keeps the KV reads to
 *   a handful per key, inside the per-run limit, instead of one per request. A key with no perf row is shown as unlabeled.
 *   (3) "Regen Rate" was the proxy's own classifier regen, not an agent regenerating: it is now "Classifier regen".
 *   (4) The comprehension footnote was static ("Observer only -- no comprehension verdict has ever changed a
 *   customer-facing message") while the authoritative switches were on. It is now computed from the Changed column
 *   (sourceUsed === 'comprehension') and the rows' own authoritative flag.
 *   M-9 STEP 2: per cache key, per minute: full drafts per minute against the warm-hit rate, bucketed by load, plus each
 *   key's peak minute. Measure only; nothing is partitioned.
 *
 *   Covered by tests/reporter-v125.test.js, driving the shipped parseLogs, buildReport and the perf-label reader. v1.24
 *   fails it. Builds on v1.24.
 */
/**
 * v1.24: EVERY FAILURE SAYS WHY. Worker v7.87 ships beside it; extension unchanged.
 *
 *   Gil, 10/8: "Today's performance seems like more fallbacks today" -- and the Failures table could only say tier and
 *   latency, so a provider rate limit, a 5xx, our own timeout and a malformed reply all looked alike. The proxy's FAIL
 *   line has carried the model, `status=NNN` (since v7.39) and the error text after the arrow all along; RE_FAIL kept
 *   only the tier and the milliseconds. It now keeps the model, the status and a reason (_lpFailKind, the same function
 *   as the proxy's v7.87 copy -- rate_limit, server_5xx, bad_request, auth_model, http_other, timeout, degenerate, empty,
 *   truncated, unparseable, network, unknown). The Failures table gains Model, Status and Reason columns, and a line above it
 *   counts the reasons. A log line without a status or an arrow still parses (status blank, reason from the text).
 *
 *   Covered by tests/reporter-fail-reasons.test.js, driving the shipped parser and buildReport. v1.23 fails it.
 *
 *   Builds on v1.23.
 */
/**
 * v1.23: THE FAILURES TABLE WAS THE ONE PLACE STILL IN UTC.
 *
 *   Gil, 9/29: "On the reporter the Failures are listed with the UTC time. Can we switch that to
 *   Central time like the rest of the dashboard?" Every other time on the page -- the window, the
 *   hourly table, Rejected Sessions, Disagreements -- is Central. The failures table printed
 *   d.final.ts.slice(0,19)+'Z', so "2026-09-29T13:36:36Z" had to be converted by hand to line it up
 *   with the 08:xx CT row it belonged to.
 *
 *   Now: "Time (CT)" as HH:MM:SS, 24-hour, the same form as the other CT columns plus seconds --
 *   a primary/fallback/emergency chain lands in one second, and seconds are what group it. The
 *   plain-text email's Failures lines and its Window line move to Central the same way. DST-safe
 *   through the same Intl formatter as ctParts (v1.4).
 *
 *   Covered by tests/reporter-ct-failures.test.js, driving the shipped buildReport. v1.22 prints
 *   the UTC form and fails it.
 *
 *   Reporter-only build: no extension or proxy change. Builds on v1.22.
 */
/**
 * v1.22: ONE LEAD REGENERATED EIGHT TIMES MOVED A FLEET METRIC.
 *
 *   9/1: all EIGHT DISAGREE-REGEX-ONLY rows that day were ONE lead — 2056662795 —
 *   regenerated eight times between 13:29 and 17:11. One call note, one false "will be" match,
 *   counted eight times. That single lead took the day's agreement rate from 97.0% to 94.5% and
 *   invented a "Facebook 39.1% disagreement rate" in the by-source table. Neither is comprehension
 *   behaving differently; both are an agent pressing Generate.
 *
 *   It mattered because these numbers are what Phase 4 was decided on. A metric that a single
 *   agent can move by regenerating is not a fleet metric.
 *
 *   THE FIX: the headline agreement/disagreement rate now counts LEAD + DETECTOR pairs. The
 *   per-VERDICT rate is kept and shown beside it, labelled "Per generation" — it is the right
 *   denominator for probe cost and telemetry volume and the wrong one for "how often do the two
 *   readers disagree about a lead". A new "Repeat-generated" tile puts the size of the effect on
 *   the page (on 9/1: 1 pair, run 8×) instead of leaving it to be inferred.
 *
 *   COLLAPSE RULE, stated because it is a judgement: a pair counts as disagreeing if ANY of its
 *   comparable rows disagreed — not the majority, not the last. This table produces the review
 *   list, so it must not hide a disagreement behind seven agreements. The opposite bias is the
 *   accepted cost and is named rather than left implicit. Rows carrying no autoLeadId cannot be
 *   collapsed and are keyed individually, so they still count once each.
 *
 *   BACKWARD COMPATIBLE: a pre-v1.22 commitData payload carries none of the lead fields, and the
 *   report degrades to the per-verdict numbers rather than rendering zeroes — an old snapshot must
 *   not read as a collapse.
 *
 *   Covered by tests/per-lead-denominator.test.js, 14 assertions, driving the SHIPPED collapse
 *   against that lead's exact 9/1 shape. v1.21 cannot load it at all, which the harness reports as a
 *   failure rather than as silence.
 *
 *   No extension or proxy change. Builds on v1.21.
 */
/**
 * leadpro-reporter v1.21 — THE DETECTOR TABLE WAS UNREADABLE, AND NOTHING SAID SO.
 *
 * 8/24 read: day-lock 1 · off-franchise 2 · verbal-commit 374. 8/23 read 36 · 29 · 32 on the same
 * code. That is the table that decides which authoritative flag gets flipped first, and nothing in
 * the report could say whether the swing was real.
 *
 * TRACED END TO END, AND THERE IS NO DEFECT. The extension row sets `detector: id`; the sender
 * forwards `detector: String(result.detector || 'verbal-commit')`; the proxy clamps against
 * CC_DETECTORS; the reporter clamps the same way. Every link preserves it, and log137 confirms the
 * extension labels all three correctly at send time.
 *
 * THE LIKELY CAUSE IS FLEET VERSION SKEW. A build before extension v9.7.566 runs the OLD
 * single-row observer and posts ONE verbal-commit row per generation; v9.7.566+ posts THREE, one
 * per detector. A fleet on mixed builds produces exactly this lopsided split with nothing wrong
 * anywhere. 374 : 1 : 2 is the shape of "most machines are on an older build".
 *
 * THE REPORT COULD NOT CONFIRM THAT, because it never showed extensionVersion — which the proxy
 * has stored on every row since v7.55. Same shape as the cache ceiling in v1.20: the proxy knew,
 * the report did not say. A BY EXTENSION VERSION table now shows rows per build and which
 * detectors each one produced, so the next swing is answerable instead of arguable.
 *
 * AND THE SILENT DEFAULT IS NOW COUNTED. A row with no recognised detector became verbal-commit
 * with no trace. That default is CORRECT for its purpose — pre-v9.7.566 rows are verbal-commit by
 * construction — but it is invisible, and it defaults toward the detector that already has the
 * most evidence, which is the worst possible direction for this table. A 'Defaulted' column now
 * reports how many of a detector's rows were filed there by fallback rather than produced by it,
 * amber when non-zero. Same lesson as v1.18's exclusion-list-versus-positive-list.
 *
 * TWO OF MY OWN CHANGES WERE MISSING AND THE NEW ASSERTIONS CAUGHT BOTH: byVersion was collected
 * but never threaded through to the renderer, so the version table would have rendered NOTHING
 * behind its own `|| {}` guard — a new feature silently absent; and the Defaulted column never
 * landed at all. An earlier edit aborted on a bad anchor before writing, and the two changes it
 * carried were lost without a trace. Assert the render, not just the collection.
 *
 * Reporter-only build: no proxy or extension change. Builds on v1.20.
 */

// (v1.4) DST-safe Central Time. Previously CT_OFFSET = -5 was hardcoded (CDT); correct in
// summer but wrong Nov–Mar (CST = -6), drifting the hourly buckets one hour and — near midnight —
// rolling the default report date to the wrong day. Intl with timeZone 'America/Chicago' tracks
// DST automatically (Cloudflare Workers ship full ICU).
const _CT_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
function ctParts(date) {
  const o = {};
  for (const p of _CT_FMT.formatToParts(date)) o[p.type] = p.value;
  return o; // { year, month, day, hour }
}
// (v1.23) HH:MM:SS in Central, for the failures table: a fail chain lands within one second.
const _CT_FMT_S = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function ctHMS(ts) {
  const o = {};
  for (const p of _CT_FMT_S.formatToParts(new Date(ts))) o[p.type] = p.value;
  return `${o.hour}:${o.minute}:${o.second}`;
}
// YYYY-MM-DD in Central
function ctDateLabel(date) {
  const p = ctParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
// Yesterday's Central date label (anchored at noon UTC to stay clear of DST/midnight edges)
function ctYesterdayLabel() {
  const today = ctDateLabel(new Date());
  const anchor = new Date(today + 'T12:00:00Z');
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}
// HH:MM in Central (for the report window label, which can span UTC midnight)
function ctHM(ts) {
  const p = ctParts(new Date(ts));
  return `${p.hour}:${p.minute}`;
}

// (v1.12) VinSolutions deep link for a feedback row. Both IDs are internal CRM record locators —
// they identify nobody outside a system the dealer group already owns, which is why the capture
// site chose them over phone/email. The vinconnect SPA form is preferred: it routes through the
// shell the app itself uses, so session and nav survive the jump. GlobalCustomerID is appended
// only when present; AutoLeadID alone still lands on the lead.
const VIN_BASE = 'https://vinsolutions.app.coxautoinc.com/vinconnect/#/CarDashboard/Pages/LeadManagement/logcall.aspx';
function vinLeadUrl(autoLeadId, customerId) {
  if (!autoLeadId) return '';
  return VIN_BASE + '?AutoLeadID=' + encodeURIComponent(autoLeadId)
    + (customerId ? '&GlobalCustomerID=' + encodeURIComponent(customerId) : '');
}

// Module-scope singletons
const decoder = new TextDecoder();

// Pre-compiled regexes (avoid per-call re-creation)
const RE_PRIMARY   = /PRIMARY OK\s+(\S+)\s+(\d+)ms/;
const RE_FALLBACK  = /FALLBACK OK\s+(\S+)\s+(\d+)ms/;
const RE_EMERGENCY = /EMERGENCY OK\s+(\S+)\s+(\d+)ms/;
const RE_REGEN     = /REGEN OK\s+(\S+)\s+(\d+)ms total=(\d+)/;
const RE_FINAL     = /FINAL total=(\d+)ms regenerated=(true|false)/;
const RE_CLS_MS    = /\bclassifyMs=(\d+)/;   // (v1.26) proxy v7.92
const RE_CLASSIFY  = /CLASSIFY sms=(\w+) email=(\w+) phoneOnFile=(\w+)/;
// (v1.20) ceiling and cachedOfSys are now captured. The proxy has emitted them since v7.45 —
// its own header says they exist to "distinguish 'the per-lead prompt just dominates' (expected,
// unfixable) from 'the prefix is not being cached'" — and the report has been ignoring them and
// grading cached/total against a threshold that cannot be reached. Both groups are optional so a
// log line without the split still parses.
const RE_CACHE     = /CACHE primary cached=(\d+)\/(\d+)(?:[\s\S]*?ceiling=([\d.]+)%\s+cachedOfSys=(\d+)%)?/;
// (v1.25) M-4 / M-9: which request, which prompt family, which contract; what the proxy served when every tier failed.
const RE_START     = /\[([0-9a-f-]{8,})\] START\b[^\n]*?\bcacheKey=(\S+)\s+contract=(\w+)(?:\s+ext=(\S+))?/;
const RE_EDGE_HIT  = /\[EDGE-CACHE\] HIT\b/;
const RE_SAFE_FB   = /\] SAFE_FALLBACK after \d+ms/;
const RE_EXHAUSTED = /\] TIERS EXHAUSTED \(contract=(\w+)/;
const RE_FAIL      = /(PRIMARY|FALLBACK|EMERGENCY)\s+(FAIL|ERROR)\s+(\S+)\s+(\d+)ms(?:\s+status=(\d+))?(?:\s*(?:\u2192|->)\s*(.*))?/;   // (v1.24) model, status, error

// (v1.24) Why a tier failed, as one word -- a copy of the proxy's v7.87 _lpFailKind; tests/reporter-fail-reasons.test.js
// holds the two to the same answers.
function _lpFailKind(status, error) {
  const st = Number(status) || 0, e = String(error || '');
  if (st === 429) return 'rate_limit';
  if (st >= 500) return 'server_5xx';
  if (st === 400) return 'bad_request';
  if (st === 401 || st === 403 || st === 404) return 'auth_model';
  if (st) return 'http_other';
  if (/^Timeout\b/i.test(e)) return 'timeout';
  if (/Degenerate field/i.test(e)) return 'degenerate';
  if (/Empty response/i.test(e)) return 'empty';
  if (/truncated|token budget too low/i.test(e)) return 'truncated';
  if (/Unparseable JSON|Non-JSON/i.test(e)) return 'unparseable';
  if (!e.trim()) return 'unknown';   // a FAIL line with no status and no message
  return 'network';
}

// ── R2 helpers ────────────────────────────────────────────────────────────

async function listObjects(bucket, prefix) {
  let objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    objects = objects.concat(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return objects;
}

async function readObject(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return [];

  let text;

  if (key.endsWith('.gz')) {
    const compressed = await obj.arrayBuffer();
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((a, b) => a + b.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    text = decoder.decode(merged);
  } else {
    text = await obj.text();
  }

  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// ── Log parsing — native Logpush format ──────────────────────────────────

function parseLogs(entries) {
  const requests = [];

  for (const entry of entries) {
    if (!entry.Logs && !entry.logs) continue;

    const logs        = entry.Logs ?? entry.logs ?? [];
    const wallMs      = entry.WallTimeMs ?? entry.wallTimeMs ?? 0;
    const cpuMs       = entry.CPUTimeMs ?? entry.cpuTimeMs ?? 0;
    const outcome     = entry.Outcome ?? entry.outcome ?? '';
    const scriptName  = entry.ScriptName ?? entry.scriptName ?? '';
    const scriptVersion = entry.ScriptVersion?.ID ?? entry.scriptVersion?.id ?? '';
    const colo        = entry.Event?.Request?.cf?.colo ?? entry.event?.request?.cf?.colo ?? '';
    const tsMs        = entry.EventTimestampMs ?? entry.eventTimestampMs ?? 0;
    const ts          = tsMs ? new Date(tsMs).toISOString() : '';

    const req = { ts, wallMs, cpuMs, outcome, scriptName, scriptVersion, colo };
    // (v1.26) MS-1.1: the request's path, for the requests that never write a START line
    try { const u = entry.Event?.Request?.URL ?? entry.event?.request?.url ?? ''; if (u) req.path = new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { /* no URL */ }

    for (const log of logs) {
      const msg   = Array.isArray(log.Message) ? log.Message.join(' ') : (log.message ?? '');
      const logTs = log.TimestampMs ? new Date(log.TimestampMs).toISOString() : ts;
      let x;

      if ((x = msg.match(RE_START))) {   // (v1.25)
        req.requestId = x[1]; req.cacheKey = x[2]; req.contract = x[3]; if (x[4]) req.ext = x[4];
      } else if (RE_EDGE_HIT.test(msg)) req.edgeHit = true;
      else if (RE_SAFE_FB.test(msg)) req.safeFallback = true;
      else if ((x = msg.match(RE_EXHAUSTED))) { req.exhausted = true; req.contract = req.contract || x[1]; }
      else if ((x = msg.match(RE_PRIMARY)))
        req.primary = { ts: logTs, model: x[1], ms: +x[2] };
      else if ((x = msg.match(RE_FALLBACK)))
        req.fallback = { ts: logTs, model: x[1], ms: +x[2] };
      else if ((x = msg.match(RE_EMERGENCY)))
        req.emergency = { ts: logTs, model: x[1], ms: +x[2] };
      else if ((x = msg.match(RE_REGEN)))
        req.regen = { ts: logTs, model: x[1], ms: +x[2], total: +x[3] };
      else if ((x = msg.match(RE_FINAL))) {
        req.final = { ts: logTs, total: +x[1], regen: x[2] === 'true' };
        const cm = msg.match(RE_CLS_MS); if (cm) req.classifyMs = +cm[1];   // (v1.26)
      }
      else if ((x = msg.match(RE_CLASSIFY)))
        req.classify = { sms: x[1], email: x[2], phone: x[3] };
      else if ((x = msg.match(RE_CACHE))) {
        const tot = +x[2];
        req.cachePct = tot ? +(100 * +x[1] / tot).toFixed(1) : 0;
        // (v1.20) cachedOfSys answers the question the old tile could not: of the part that CAN
        // be cached, how much actually was. cacheWarm separates "the prefix missed" from "the
        // prompt is mostly per-lead content", which cachePct alone conflates.
        if (x[3] !== undefined) req.cacheCeiling = +x[3];
        if (x[4] !== undefined) req.cacheOfSys   = +x[4];
        req.cacheWarm = +x[1] > 0;
      } else if ((x = msg.match(RE_FAIL)))
        (req.fails = req.fails ?? []).push({ tier: x[1], model: x[3], ms: +x[4], status: x[5] ? +x[5] : null,
          kind: _lpFailKind(x[5], x[6]) });
    }

    if (!req.final && wallMs) {
      req.final = { ts, total: wallMs, regen: false };
    }

    if (req.final) requests.push(req);
  }

  return requests;
}

// ── Stats helpers ─────────────────────────────────────────────────────────

const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
const safeMax = arr => arr.length ? arr.reduce((a, b) => (b > a ? b : a), -Infinity) : 0;

// Sort once, return multiple percentiles in one call
function percentiles(arr, ...ps) {
  if (!arr.length) return ps.map(() => 0);
  const s = [...arr].sort((a, b) => a - b);
  return ps.map(p => s[Math.min(Math.floor(s.length * p / 100), s.length - 1)]);
}

const ctHour = ts => {
  try { return parseInt(ctParts(new Date(ts)).hour, 10) % 24; }
  catch { return -1; }
};

const colorFor = (val, good, warn) =>
  val <= good ? '#34d399' : val <= warn ? '#fbbf24' : '#f87171';

// ── Report builder ────────────────────────────────────────────────────────

// (v1.24) "rate_limit 12 · timeout 3 · ..." across every tier failure in the window, most first.
function _failReasonLine(failReqs) {
  const c = {};
  for (const d of failReqs) for (const f of (d.fails || [])) { const k = f.kind || 'unknown'; c[k] = (c[k] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(' \u00b7 ') || '—';
}

// (v1.25) M-4: the contract a request belongs to. perfLabels maps a cacheKey to the label its sampled perf rows agree on.
const CONTRACT_ORDER = ['Full draft', 'SMS rewrite', 'Other draft-contract call', 'Fact probe', 'Edge cache hit', 'Draft contract (key unlabeled)', 'Unknown (no START line)'];
function _contractOf(r, perfLabels) {
  if (r.edgeHit) return 'Edge cache hit';
  const lab = r.cacheKey && perfLabels && perfLabels[r.cacheKey];
  if (lab && lab.label) return lab.label;
  if (r.contract === 'fact') return 'Fact probe';
  if (r.contract) return 'Draft contract (key unlabeled)';
  if (r.path) return 'Route ' + (r.path === '/' ? '/ (generate)' : r.path);   // (v1.26) MS-1.1
  return 'Unknown (no START line)';
}
// (v1.26) MS-1.2, 1.3, 1.5 from the feedback rows: which directives each prompt carried and what became of those drafts, the prompt
// length, and key-information rows. Rows from before extension 9.7.868 carry none of these and are skipped for each measure.
function _feedbackMeasures(entries) {
  const _dir = {}, _pc = [], _ki = { n: 0, withRows: 0 };
  let directiveRows = 0;
  for (const e of entries || []) {
    const m = (e && e.meta) || {};
    if (Array.isArray(m.directives) && m.directives.length) {
      directiveRows++;
      const used = e.rating === 'up' || e.rating === 'weak_up' || e.rating === 'neutral';
      for (const k of new Set(m.directives.map(x => String(x).slice(0, 48)))) {
        const b = _dir[k] = _dir[k] || { n: 0, shipped: 0, down: 0 };
        b.n++; if (used) b.shipped++; if (e.rating === 'down') b.down++;
      }
    }
    if (typeof m.promptChars === 'number' && m.promptChars > 0) _pc.push(m.promptChars);
    if (typeof m.keyInfoRows === 'number') { _ki.n++; if (m.keyInfoRows > 0) _ki.withRows++; }
  }
  const p = _pc.length ? percentiles(_pc, 50, 95) : [0, 0];
  return {
    directives: Object.keys(_dir).map(k => ({ k, n: _dir[k].n, shipped: _dir[k].shipped, down: _dir[k].down })).sort((a, b) => b.n - a.n || (a.k < b.k ? -1 : 1)).slice(0, 40),
    directiveRows,
    promptChars: _pc.length ? { n: _pc.length, med: p[0], p95: p[1], max: safeMax(_pc), over60k: _pc.filter(v => v > 60000).length } : null,
    keyInfo: _ki.n ? _ki : null
  };
}
// (v1.26) Contracts in their fixed order; any route label sorts after them and before Unknown.
function _contractRank(c) { const i = CONTRACT_ORDER.indexOf(c); return i >= 0 ? i : CONTRACT_ORDER.length - 1.5; }
// A perf row's own label, by the fields the proxy has written since v7.80/7.81.
function _perfLabel(row) {
  if (!row) return '';
  if (row.fullDraft === true) return 'Full draft';
  if (row.smsRefine === true) return 'SMS rewrite';
  if (row.contract === 'fact') return 'Fact probe';
  return 'Other draft-contract call';
}
// Label every cacheKey seen in the logs from at most `perKey` of its own perf rows. listKeys(prefix) returns KV key names;
// getRow(name) returns a parsed row. Both injected, so the logic is testable and the KV calls stay bounded.
async function _labelCacheKeys(reqs, prefixes, listKeys, getRow, perKey = 3) {
  const byId = {};
  for (const p of prefixes) {
    for (const name of await listKeys(p)) { const id = String(name).split(':').pop(); if (id) byId[id] = name; }
  }
  const ids = {};
  for (const r of reqs) if (r.cacheKey && r.requestId && byId[r.requestId]) (ids[r.cacheKey] = ids[r.cacheKey] || []).push(r.requestId);
  const out = {};
  for (const k of Object.keys(ids)) {
    const votes = {};
    let sampled = 0;
    for (const id of ids[k].slice(0, perKey)) {
      const row = await getRow(byId[id]);
      const l = _perfLabel(row);
      if (l) { votes[l] = (votes[l] || 0) + 1; sampled++; }
    }
    const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    if (best) out[k] = { label: best, sampled, agree: votes[best] === sampled };
  }
  return out;
}

// (v1.25) M-9 step 2: per cache key, per CT minute, full drafts against warm hits. Measure only.
const LOAD_BUCKETS = [[1, 1], [2, 3], [4, 6], [7, 10], [11, 15], [16, Infinity]];
function _cacheLoad(reqs, perfLabels) {
  const keys = {};
  for (const r of reqs) {
    if (!r.cacheKey || r.edgeHit) continue;
    const t = (r.final && r.final.ts) || r.ts; if (!t) continue;
    const k = keys[r.cacheKey] = keys[r.cacheKey] || { label: _contractOf(r, perfLabels), reqs: 0, minutes: {} };
    k.reqs++;
    const m = ctHM(t);
    const mm = k.minutes[m] = k.minutes[m] || { n: 0, logged: 0, warm: 0, pctSum: 0 };
    mm.n++;
    if (r.cachePct !== undefined) { mm.logged++; mm.pctSum += r.cachePct; if (r.cacheWarm) mm.warm++; }
  }
  const out = [];
  for (const key of Object.keys(keys)) {
    const k = keys[key];
    const buckets = LOAD_BUCKETS.map(([lo, hi]) => ({ lo, hi, minutes: 0, reqs: 0, logged: 0, warm: 0, pctSum: 0 }));
    let peak = { m: '', n: 0, warm: 0, logged: 0 };
    for (const m of Object.keys(k.minutes)) {
      const mm = k.minutes[m];
      const b = buckets.find(x => mm.n >= x.lo && mm.n <= x.hi);
      b.minutes++; b.reqs += mm.n; b.logged += mm.logged; b.warm += mm.warm; b.pctSum += mm.pctSum;
      if (mm.n > peak.n) peak = { m, n: mm.n, warm: mm.warm, logged: mm.logged };
    }
    const tot = buckets.reduce((a, b) => ({ logged: a.logged + b.logged, warm: a.warm + b.warm }), { logged: 0, warm: 0 });
    out.push({ key, label: k.label, reqs: k.reqs, minutes: Object.keys(k.minutes).length, peak, buckets,
               warmPct: tot.logged ? Math.round(100 * tot.warm / tot.logged) : null });
  }
  return out.sort((a, b) => (CONTRACT_ORDER.indexOf(a.label) - CONTRACT_ORDER.indexOf(b.label)) || (b.reqs - a.reqs));
}

function buildReport(reqs, dateLabel, feedbackData = null, commitData = null, perfLabels = null) {
  const n = reqs.length;
  if (!n) return {
    text: 'No completed requests found.',
    html: `<p style="font-family:monospace;color:#999">No data for ${dateLabel}.</p>`
  };

  // Single-pass classification instead of 6 separate .filter() calls
  const regenReqs = [], noRegenReqs = [], failReqs = [], fbReqs = [], emReqs = [];
  // (v1.25) M-4: a tier failure that a later tier answered is RECOVERED; only a request that served the canned safe fallback
  // (draft) or nothing at all (a non-draft call, TIERS EXHAUSTED) counts against completion.
  const recoveredReqs = [], servedFbReqs = [], exhaustedReqs = [];
  for (const r of reqs) {
    (r.final.regen ? regenReqs : noRegenReqs).push(r);
    if (r.fails?.length) failReqs.push(r);
    if (r.fallback)      fbReqs.push(r);
    if (r.emergency)     emReqs.push(r);
    if (r.safeFallback) servedFbReqs.push(r);
    else if (r.exhausted) exhaustedReqs.push(r);
    else if (r.fails?.length) recoveredReqs.push(r);
  }
  // (v1.25) Per contract, full drafts first.
  const byContract = {};
  for (const r of reqs) {
    const c = _contractOf(r, perfLabels);
    const b = byContract[c] = byContract[c] || { n: 0, totals: [], recovered: 0, servedFb: 0, exhausted: 0 };
    b.n++; b.totals.push(r.final.total);
    if (r.safeFallback) b.servedFb++; else if (r.exhausted) b.exhausted++; else if (r.fails?.length) b.recovered++;
  }
  const contractRows = Object.keys(byContract).sort((a, b) => (_contractRank(a) - _contractRank(b)) || (byContract[b].n - byContract[a].n)).map(c => {
    const b = byContract[c]; const [med, p95] = percentiles(b.totals, 50, 95);
    return { c, n: b.n, med, p95, max: safeMax(b.totals), recovered: b.recovered, servedFb: b.servedFb, exhausted: b.exhausted };
  });
  const cacheLoad = _cacheLoad(reqs, perfLabels);
  const labeledKeys = perfLabels ? Object.keys(perfLabels).length : 0;

  const tsList = reqs.map(d => d.final.ts).sort();

  const allTotals     = reqs.map(d => d.final.total);
  const noRegenTots   = noRegenReqs.map(d => d.final.total);
  const withRegenTots = regenReqs.map(d => d.final.total);
  const primaryMs     = reqs.filter(d => d.primary).map(d => d.primary.ms);
  const regenMs       = reqs.filter(d => d.regen).map(d => d.regen.ms);
  const fbMs          = fbReqs.map(d => d.fallback.ms);

  // Each array sorted once, all needed percentiles extracted together
  const [allMed, allP95, allP99] = percentiles(allTotals, 50, 95, 99);
  const [nrMed,  nrP95,  nrP99]  = percentiles(noRegenTots, 50, 95, 99);
  const [wrMed,  wrP95]           = percentiles(withRegenTots, 50, 95);
  const [prMed,  prP95,  prP99]  = percentiles(primaryMs, 50, 95, 99);
  const [rgMed,  rgP95]           = percentiles(regenMs, 50, 95);

  const maxAll  = safeMax(allTotals);
  const maxNr   = safeMax(noRegenTots);
  const maxWr   = safeMax(withRegenTots);
  const maxPr   = safeMax(primaryMs);
  const maxRg   = safeMax(regenMs);

  const cacheVals = reqs.filter(d => d.cachePct !== undefined).map(d => d.cachePct);
  const avgCache  = cacheVals.length
    ? (cacheVals.reduce((a, b) => a + b, 0) / cacheVals.length).toFixed(1)
    : 'N/A';
  const coldCount = cacheVals.filter(v => v === 0).length;
  // ── (v1.20) THE OLD TILES GRADED A HEALTHY CACHE AS A FAILING ONE ──────────────────────────
  // 'Hot ≥80%' counted requests whose cached tokens were ≥80% of the WHOLE prompt. Roughly 75% of
  // an LP prompt is per-lead user content that is not cacheable by construction, so the ceiling
  // is ~25% and that tile could never light up on any day, however well caching worked. It read 0
  // on 8/23 and would read 0 forever. Removed rather than re-thresholded — a metric that cannot
  // move is worse than no metric, because it invites work on a problem that does not exist.
  // Measured 8/23: ceiling 24.5%, warm requests serving 84% of the cacheable prefix from cache,
  // 33% of requests starting cold. The cache was working; the denominator was wrong.
  const ofSysWarm  = reqs.filter(d => d.cacheOfSys !== undefined && d.cacheWarm).map(d => d.cacheOfSys);
  const ceilVals   = reqs.filter(d => d.cacheCeiling !== undefined).map(d => d.cacheCeiling);
  const avgOfSys   = ofSysWarm.length ? (ofSysWarm.reduce((a,b)=>a+b,0) / ofSysWarm.length).toFixed(0) : null;
  const avgCeiling = ceilVals.length  ? (ceilVals.reduce((a,b)=>a+b,0) / ceilVals.length).toFixed(1) : null;
  // What share of the achievable benefit was actually realised — one number for cache health.
  const ofCeiling  = (avgCeiling && +avgCeiling > 0 && avgCache !== 'N/A')
    ? ((+avgCache / +avgCeiling) * 100).toFixed(0) : null;
  const coldPct    = cacheVals.length ? ((coldCount / cacheVals.length) * 100).toFixed(0) : '0';

  const clsCounts = {};
  for (const d of reqs) {
    if (!d.classify) continue;
    const k = `sms=${d.classify.sms} email=${d.classify.email}`;
    clsCounts[k] = (clsCounts[k] ?? 0) + 1;
  }
  const clsTotal = Object.values(clsCounts).reduce((a, b) => a + b, 0);
  // (v1.26) MS-1.5: how long the inline phone-ask classifier held each draft (proxy v7.92 writes classifyMs on FINAL)
  const clsMs = reqs.map(r => r.classifyMs).filter(v => typeof v === 'number');
  const [clsMed, clsP95] = clsMs.length ? percentiles(clsMs, 50, 95) : [0, 0];
  const clsTime = clsMs.length ? { n: clsMs.length, med: clsMed, p95: clsP95, max: safeMax(clsMs) } : null;

  const hourly = {};
  for (const d of reqs) {
    const h = ctHour(d.final.ts);
    (hourly[h] = hourly[h] ?? []).push(d);
  }

  const models = {};
  for (const d of reqs) {
    if (d.primary?.model) models[d.primary.model] = (models[d.primary.model] ?? 0) + 1;
  }

  const regenPct = (100 * regenReqs.length / n).toFixed(1);
  const compRate = (100 * (n - servedFbReqs.length - exhaustedReqs.length) / n).toFixed(1);   // (v1.25) recovered requests completed
  const winStart = tsList[0] ? ctHM(tsList[0]) : '—';
  const winEnd   = tsList[tsList.length - 1] ? ctHM(tsList[tsList.length - 1]) : '—';

  // ── Plain text ─────────────────────────────────────────────
  const lines = [
    `LeadPro Performance Report — ${dateLabel}`,
    `Window: ${winStart} – ${winEnd} CT`,
    `Requests: ${n}`,
    '',
    '── RELIABILITY ──',
    `  Completion : ${compRate}%  (served safe fallback ${servedFbReqs.length}, nothing served ${exhaustedReqs.length})`,
    `  Tier failures recovered by a later tier: ${recoveredReqs.length}`,
    `  Classifier regen : ${regenPct}%  (${regenReqs.length}/${n})  (the proxy's own regen, not an agent regenerating)`,
    `  Fallbacks  : ${fbReqs.length}    Emergencies: ${emReqs.length}`,
    '',
    '── BY CONTRACT (full drafts first) ──',
    ...contractRows.map(r => `  ${r.c}: ${r.n} req  med=${r.med}ms  p95=${r.p95}ms  max=${r.max}ms`
      + (r.recovered ? `  recovered=${r.recovered}` : '') + (r.servedFb ? `  served-safe-fallback=${r.servedFb}` : '') + (r.exhausted ? `  nothing-served=${r.exhausted}` : '')),
    ...(perfLabels ? [] : ['  (no perf rows read: draft-contract calls are not split into full drafts, rewrites and the rest)']),
    '',
    '── LATENCY (all contracts) ──',
    `  All     avg=${avg(allTotals)}ms  med=${allMed}ms  p95=${allP95}ms  p99=${allP99}ms  max=${maxAll}ms`,
    `  No classifier regen avg=${avg(noRegenTots)}ms  p95=${nrP95}ms`,
    `  W/ classifier regen avg=${avg(withRegenTots)}ms  p95=${wrP95}ms`,
    `  PRIMARY  avg=${avg(primaryMs)}ms  p95=${prP95}ms  max=${maxPr}ms`,
    ...(regenMs.length ? [`  CLASSIFIER REGEN avg=${avg(regenMs)}ms  p95=${rgP95}ms`] : []),
    ...(fbMs.length    ? [`  FALLBACK avg=${avg(fbMs)}ms`] : []),
    '',
    '── PROMPT CACHE ──',
    // (v1.20) The plain-text summary carried the same unreachable Hot(>=80%) figure. Removing
    // hotCount's definition without this line left a ReferenceError that CRASHED the whole
    // report — caught by commit-persistence, which RUNS buildReport, while the new
    // cache-ceiling suite sat at 17/17 green because it only scans source text. Same lesson
    // as the v7.64 proxy crash: a regex proves a string is in a file, not that the file runs.
    `  Of achievable: ${ofCeiling ? ofCeiling + '%' : 'N/A'}    Prefix cached (warm): `
      + `${avgOfSys ? avgOfSys + '%' : 'N/A'}    Ceiling: ${avgCeiling ? avgCeiling + '%' : 'N/A'}`,
    `  Raw (cached/total): ${avgCache}%    Cold starts: ${coldCount} (${coldPct}%)`,
    '',
    ...(clsTotal ? [
      `── CLASSIFY (${clsTotal}) ──`,
      ...Object.entries(clsCounts).sort((a,b)=>b[1]-a[1])
        .map(([k,v]) => `  ${k}: ${v}${k.includes('YES') ? ' → REGEN' : ''}`),
      ''
    ] : []),
    '── HOURLY (CT) ──',
    ...Object.keys(hourly).map(Number).sort((a,b)=>a-b).map(h => {
      const hrs  = hourly[h];
      const tots = hrs.map(d => d.final.total);
      const rg   = hrs.filter(d => d.final.regen).length;
      const fb   = hrs.filter(d => d.fallback).length;
      const [hp95] = percentiles(tots, 95);
      return `  ${String(h).padStart(2,'0')}:xx  ${hrs.length} req  avg=${avg(tots)}ms  p95=${hp95}ms  classifier-regen=${rg}(${Math.round(100*rg/hrs.length)}%)${fb?`  fb=${fb}`:''}`;
    }),
    '',
    '── CACHE LOAD PER KEY (measure only) ──',
    ...cacheLoad.slice(0, 6).map(k => `  ${String(k.key).slice(0, 14)} ${k.label}: ${k.reqs} req over ${k.minutes} min, peak ${k.peak.n}/min at ${k.peak.m}, warm ${k.warmPct === null ? 'n/a' : k.warmPct + '%'}  | `
      + k.buckets.filter(b => b.minutes).map(b => `${b.lo}${b.hi === Infinity ? '+' : b.hi === b.lo ? '' : '-' + b.hi}/min: ${b.minutes} min, warm ${b.logged ? Math.round(100 * b.warm / b.logged) + '%' : 'n/a'}`).join('; ')),
    '',
    '── MODELS ──',
    ...Object.entries(models).map(([m, c]) => `  ${m}: ${c}`),
    ...(failReqs.length ? [
      '',
      `── FAILURES (${failReqs.length} requests with a failed tier: ${recoveredReqs.length} recovered, ${servedFbReqs.length} served safe fallback, ${exhaustedReqs.length} nothing served) ──`,
      `  by reason: ${_failReasonLine(failReqs)}`,
      `  (tier events, not requests: one request can fail on two tiers)`,
      ...failReqs.flatMap(d => d.fails.map(f => `  ${ctHMS(d.final.ts)} CT  ${f.tier} @ ${f.ms}ms${f.model ? '  ' + f.model : ''}${f.status ? '  status=' + f.status : ''}${f.kind ? '  ' + f.kind : ''}`))
    ] : []),
  ];
  const text = lines.join('\n');

  // ── HTML email ─────────────────────────────────────────────
  const stat = (label, value, color = '#f0f9ff') =>
    `<div style="background:#0d1117;border-radius:4px;padding:12px">
       <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">${label}</div>
       <div style="font-size:22px;font-weight:bold;color:${color};margin-top:3px">${value}</div>
     </div>`;

  const tr = (cells, header = false) =>
    `<tr>${cells.map(c =>
      `<t${header?'h':'d'} style="padding:7px 10px;border-bottom:1px solid #1f2937;${header?'color:#60a5fa;font-size:10px;text-transform:uppercase;letter-spacing:1px':''}">${c}</t${header?'h':'d'}>`
    ).join('')}</tr>`;

  const section = (title, body) =>
    `<div style="background:#111827;border:1px solid #1f2937;border-radius:6px;padding:18px;margin-bottom:14px">
       <h2 style="margin:0 0 14px;font-size:11px;color:#60a5fa;letter-spacing:3px;text-transform:uppercase;border-bottom:1px solid #1f2937;padding-bottom:8px">${title}</h2>
       ${body}
     </div>`;

  const grid = (...items) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${items.join('')}</div>`;

  const table = (headers, rows) =>
    `<table style="width:100%;border-collapse:collapse;font-size:12px">
       ${tr(headers, true)}
       ${rows.join('')}
     </table>`;

  // ── Feedback section ──────────────────────────────────────────
  const feedbackHtml = (() => {
    if (!feedbackData || feedbackData.total === 0) {
      return section('Response Quality (Feedback)', '<div style="color:#4b5563;font-size:12px;text-align:center;padding:12px">No feedback signals recorded for this date. Deploy v9.7.135+ to start collecting.</div>');
    }
    const fd = feedbackData;
    // v1.3: headline is the SHIPPED rate (up+weak_up+neutral)/total — copied-after-regen
    // DID ship. Color by first-try lag instead of an absolute threshold, since shipped is
    // almost always high; a low first-try (lots of regens before send) is the real signal.
    const shipped  = fd.shippedRate  != null ? fd.shippedRate  : fd.posRate;
    const firstTry = fd.firstTryRate != null ? fd.firstTryRate : fd.posRate;
    const posColor = shipped >= 90 ? '#34d399' : shipped >= 75 ? '#fbbf24' : '#f87171';

    // Chip frequency top 5
    const topChips = Object.entries(fd.chipFreq || {})
      .sort((a,b) => b[1]-a[1]).slice(0,5)
      .map(([chip, count]) => tr([chip, count, '']))
      .join('');

    // By store — v1.3: shipped rate (up+weak_up+neutral)/total, first-try shown alongside.
    const storeRows = Object.entries(fd.byStore || {})
      .sort((a,b) => b[1].total - a[1].total)
      .map(([store, s]) => {
        // (v1.8) engaged denominator, mirroring the headline — abandoned rows are volume, not failure
        const sEngaged  = (s.total || 0) - (s.abandoned || 0) - (s.incomplete || 0);
        const sShipped  = sEngaged ? Math.round(100 * ((s.up||0)+(s.weak_up||0)+(s.neutral||0)) / sEngaged) : 0;
        const sFirstTry = sEngaged ? Math.round(100 * ((s.up||0)+(s.weak_up||0)) / sEngaged) : 0;
        const col = sShipped >= 90 ? '#34d399' : sShipped >= 75 ? '#fbbf24' : '#f87171';
        const ftCol = sFirstTry < sShipped ? '#94a3b8' : col;
        // (v1.9) Zero engaged sessions means nothing to measure — "0%" read as total failure.
        const dash = '<span style="color:#4b5563">—</span>';
        return tr([
          store.replace('Community ',''),
          s.total,
          sEngaged ? `<span style="color:${col}">${sShipped}%</span>` : dash,
          sEngaged ? `<span style="color:${ftCol}">${sFirstTry}%</span>` : dash,
          // (v1.10) explicit thumb clicks and implicit no-copy are different signals — an agent
          // pressing 👎 is not the same event as a draft being regenerated and left unsent.
          `<span style="color:${(s.explicitDown || 0) > 0 ? '#f87171' : '#4b5563'}">${s.explicitDown || 0}</span>`,
          `<span style="color:${(s.implicitDown || 0) > 0 ? '#fbbf24' : '#4b5563'}">${s.implicitDown || 0}</span>`
        ]);
      }).join('');

    // Signal breakdown
    const sigRows = Object.entries(fd.signals || {})
      .filter(([,v]) => v > 0)
      .sort((a,b) => b[1]-a[1])
      .map(([sig, cnt]) => tr([sig.replace(/_/g,' '), cnt, ''])).join('');

    // 👎 sessions — individual down-rated generations (v1.6). No message content in the
    // payload (by design), but store + leadSource + scenario + convState + time is enough to
    // bucket each 👎 by category and check it against when a fix shipped.
    const downRows = (fd.downSessions || [])
      .slice().sort((a,b) => (a.ts||'').localeCompare(b.ts||''))
      .map(d => tr([
        d.ts ? ctHM(d.ts) : '—',
        d.store,
        (d.leadSource || '').replace(/^Hds\s+/i,''),
        d.scenario,
        d.convState || '—',
        d.regenCount,
        (d.signal || '').replace(/_/g,' '),
        // (v1.12) The point of the column: click straight through to the lead. Falls back to a
        // bare ID if only the lead id survived, and to an em-dash for rows written before
        // v9.7.489 shipped the record locator — a dead link is worse than an honest blank.
        (function(){
          const u = vinLeadUrl(d.autoLeadId, d.customerId);
          if (u) return `<a href="${u}" style="color:#60a5fa;text-decoration:none" target="_blank" rel="noopener">${d.autoLeadId}</a>`;
          return d.autoLeadId ? d.autoLeadId : '<span style="color:#4b5563">—</span>';
        })()
      ])).join('');

    return section('Response Quality (Feedback)', `
      ${grid(
        stat('Shipped Rate', shipped + '%', posColor),
        stat('First-Try Rate', firstTry + '%', firstTry >= 75 ? '#34d399' : firstTry >= 50 ? '#fbbf24' : '#94a3b8'),
        stat('Explicit 👍', fd.explicitUp != null ? fd.explicitUp : (fd.ratings?.up || 0), '#34d399'),
        stat('Explicit 👎', fd.explicitDown != null ? fd.explicitDown : (fd.ratings?.down || 0), (fd.explicitDown || 0) > 5 ? '#f87171' : '#94a3b8')
      )}
      <div style="font-size:10px;color:#4b5563;margin-top:6px">Shipped = copied &amp; sent (incl. after a regen). First-try = sent with no regen. Both are of ${fd.engaged != null ? fd.engaged : fd.total} engaged sessions.</div>
      <div style="font-size:10px;color:#4b5563;margin-top:4px">
        👍/👎 above are explicit thumb clicks only. Implicit: ${fd.implicitUp || 0} copied as-is, ${fd.implicitDown || 0} regenerated or chipped then abandoned${(fd.abandoned || 0) ? `, ${fd.abandoned} produced and never used` : ''}.${(fd.produced != null && (fd.abandoned || 0)) ? ` Used rate across the ${fd.produced} drafts produced: ${fd.usedRate}%.` : ''}
      </div>${(fd.incomplete || 0) ? `<div style="font-size:10px;color:#fbbf24;margin-top:4px">${fd.incomplete} session${fd.incomplete === 1 ? '' : 's'} never rendered a draft (failed or aborted generate) and ${fd.incomplete === 1 ? 'is' : 'are'} excluded from every rate above.</div>` : ''}
      <div style="margin-top:12px">
        ${table(['Signal Type', 'Count', ''], [sigRows])}
      </div>
      ${topChips ? `<div style="margin-top:12px">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Top Chips Used</div>
        ${table(['Chip', 'Uses', ''], [topChips])}
      </div>` : ''}
      ${storeRows ? `<div style="margin-top:12px">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">By Store</div>
        ${table(['Store', 'Signals', 'Shipped', '1st-Try', 'Explicit 👎', 'No-Copy'], [storeRows])}
      </div>` : ''}
      ${(fd.directives && fd.directives.length) ? `<div style="margin-top:12px">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Directives in the prompt (${fd.directiveRows} sessions from 9.7.868+, top ${fd.directives.length})</div>
        ${table(['Directive', 'Sessions', 'Shipped', 'Regen or chip, unsent'], fd.directives.map(d => tr([d.k, d.n, d.n ? Math.round(100 * d.shipped / d.n) + '%' : '—', d.down ? d.down + ' (' + Math.round(100 * d.down / d.n) + '%)' : '—'])))}
      </div>` : ''}
      ${(fd.promptChars || fd.keyInfo) ? `<div style="font-size:10px;color:#6b7280;margin-top:8px">${fd.promptChars ? `Prompt length (user prompt, characters): median ${fd.promptChars.med} · P95 ${fd.promptChars.p95} · max ${fd.promptChars.max} · over 60,000: ${fd.promptChars.over60k} of ${fd.promptChars.n}` : ''}${fd.promptChars && fd.keyInfo ? ' &nbsp;·&nbsp; ' : ''}${fd.keyInfo ? `Key-information rows kept: ${fd.keyInfo.withRows} of ${fd.keyInfo.n} sessions` : ''}</div>` : ''}
      ${downRows ? `<div style="margin-top:12px">
        <div style="font-size:10px;color:#f87171;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Rejected Sessions (${fd.downSessions.length}) &nbsp;<span style="color:#4b5563;text-transform:none;letter-spacing:0">${fd.explicitDown || 0} explicit 👎 &middot; ${fd.implicitDown || 0} regenerated or chipped then left unsent &mdash; see Signal column</span></div>
        ${table(['Time CT','Store','Lead Source','Scenario','State','Regens','Signal','Lead'], [downRows])}
      </div>` : ''}
      <div style="font-size:10px;color:#4b5563;margin-top:8px">
        Avg regens per session: ${fd.avgRegens} &nbsp;·&nbsp; Avg chips per session: ${fd.avgChips}
        &nbsp;·&nbsp; Weak positive (chip helped): ${fd.ratings?.weak_up || 0}
        &nbsp;·&nbsp; Neutral / shipped-after-regen: ${fd.ratings?.neutral || 0}
      </div>
    `);
  })();

  // ── (v1.13) Commit comprehension section ──────────────────────
  // The Phase 2 observer (extension v9.7.558/559) reads the same call notes the verbal-commit
  // REGEX reads and answers the same question independently. This section exists to answer one
  // thing off live traffic: how often do the two verdicts differ, and in which direction. It
  // reports on an OBSERVER — no comprehension verdict has ever changed a customer-facing
  // message, and these numbers are what would justify promoting it, or not.
  const commitHtml = (() => {
    if (!commitData || commitData.total === 0) {
      return section('Commit Comprehension (observer)',
        '<div style="color:#4b5563;font-size:12px;text-align:center;padding:12px">No comprehension verdicts recorded for this date. Deploy proxy v7.58 + extension v9.7.564 (proxy first) to start collecting usable ones.</div>');
    }
    const cd = commitData;
    const ccPct = (x) => cd.total ? ((x / cd.total) * 100).toFixed(1) + '%' : '—';
    const tile = (label, value, sub, color) =>
      '<div style="background:#0b1220;border:1px solid #1f2937;border-radius:5px;padding:12px">'
      + '<div style="font-size:10px;color:#4b5563;text-transform:uppercase;letter-spacing:1px">' + label + '</div>'
      + '<div style="font-size:20px;color:' + color + ';margin-top:4px">' + value + '</div>'
      + '<div style="font-size:10px;color:#6b7280;margin-top:2px">' + sub + '</div></div>';

    // (v1.16) EVERY RATE READS verifiedDeltas — rows whose probe actually answered. `deltas`
    // (all rows that arrived) still feeds the breakdown table, so nothing is hidden; it is just
    // no longer allowed to move a rate. `unverified` is rows carrying no probeOk at all, which
    // is the entire series collected while the proxy's 150-char draft floor was rejecting the
    // probe's correct 40-char answer and returning a canned draft the observer read as
    // "no commitment found". Counting those as agreement is the error this build undoes.
    const vd         = cd.verifiedDeltas || cd.deltas;
    const agree      = vd['AGREE-COMMITMENT'] + vd['AGREE-NONE'] + (vd['AGREE-FIRED'] || 0);
    const disagree   = vd['DISAGREE-REGEX-ONLY'] + vd['DISAGREE-COMPREHENSION-ONLY'];
    const fabricated = vd['QUOTE-FABRICATED'];
    const noRegex    = vd['NO-REGEX-VERDICT'] || 0;
    const probeFail  = (cd.deltas['PROBE-FAILED'] || 0);
    // (v1.19) Counted separately from `unverified` so a common, correct lead state can never
    // be read as a probe defect again.
    const vacuous    = (cd.deltas['NO-CUSTOMER-TEXT'] || 0);
    const unverified = cd.unverifiedProbe || 0;
    // Comparable rows are counted, not derived by subtraction — the exclusions overlap.
    const comparable = cd.comparable !== undefined ? cd.comparable : Math.max(0, cd.total - noRegex);
    const cmpPct = (x) => comparable ? ((x / comparable) * 100).toFixed(1) + '%' : '—';
    // ── (v1.22) THE HEADLINE MOVES TO LEADS ────────────────────────────────────────────────────
    // One lead regenerated eight times used to count eight times. On 9/1 that single lead took the
    // agreement rate from 97.0% to 94.5% and invented a "Facebook 39.1% disagreement rate". A pre-
    // v1.22 payload carries none of these fields, so the report degrades to the per-verdict numbers
    // rather than rendering zeroes — an old snapshot must not read as a collapse.
    const hasLead        = cd.leadComparable !== undefined;
    const leadComparable = hasLead ? cd.leadComparable : comparable;
    const leadDisagree   = hasLead ? cd.leadDisagree   : disagree;
    const leadFabricated = hasLead ? cd.leadFabricated : fabricated;
    const leadRepeats    = hasLead ? (cd.leadRepeats || 0) : 0;
    const leadMaxRows    = hasLead ? (cd.leadMaxRows || 0) : 0;
    const leadAgree      = Math.max(0, leadComparable - leadDisagree - leadFabricated);
    const leadPct = (x) => leadComparable ? ((x / leadComparable) * 100).toFixed(1) + '%' : '—';

    const rows = [
      ['AGREE-COMMITMENT',            cd.deltas['AGREE-COMMITMENT'],            'both read a commitment',                 '#4ade80'],
      ['AGREE-NONE',                  cd.deltas['AGREE-NONE'],                  'both read none',                         '#4ade80'],
      ['DISAGREE-REGEX-ONLY',         cd.deltas['DISAGREE-REGEX-ONLY'],         'regex fired, comprehension saw nothing', '#fbbf24'],
      ['DISAGREE-COMPREHENSION-ONLY', cd.deltas['DISAGREE-COMPREHENSION-ONLY'], 'comprehension saw one the regex missed', '#fbbf24'],
      ['QUOTE-FABRICATED',            cd.deltas['QUOTE-FABRICATED'],            'quote was not literally in any note',    '#f87171'],
      ['NO-REGEX-VERDICT',            cd.deltas['NO-REGEX-VERDICT'] || 0,       'regex gated off — not a comparison',     '#6b7280'],
      ['PROBE-FAILED',                probeFail,                                'the probe call returned no answer',      '#f87171'],
      ['AGREE-FIRED',                 vd['AGREE-FIRED'] || 0,                   'both readers found the fact',            '#4ade80'],
      ['NO-COMPREHENSION-VERDICT',    cd.deltas['NO-COMPREHENSION-VERDICT'] || 0, 'the probe was asked and did not answer', '#f87171'],
      // (v1.19) Split out of NO-COMPREHENSION-VERDICT. On 8/23 this row was 42 of 97 and the
      // report called it "probe never answered", which reads as 42 defects. Not one was a
      // defect: the customer had never written anything, so the probe reached a determinate
      // "none" without spending a call. Zero-customer-response is one of the most common lead
      // states in a BDC queue. Neutral colour, because nothing is wrong.
      ['NO-CUSTOMER-TEXT',            cd.deltas['NO-CUSTOMER-TEXT'] || 0,       'nothing for the probe to read — a determinate none', '#6b7280'],
    ].map(function (r) {
      return tr(['<span style="color:' + r[3] + '">' + r[0] + '</span>', String(r[1]), ccPct(r[1]),
                 '<span style="color:#6b7280">' + r[2] + '</span>']);
    });

    const srcRows = Object.keys(cd.bySource).map(function (k) { return [k, cd.bySource[k]]; })
      .sort(function (a, b) { return b[1].total - a[1].total; })
      .slice(0, 8)
      .map(function (e) {
        const b = e[1];
        const bad = b.disagree + b.fabricated;
        return tr([e[0] || 'unknown', String(b.total), String(b.disagree), String(b.fabricated),
                   b.total ? ((bad / b.total) * 100).toFixed(1) + '%' : '—']);
      });

    // (v1.14) By note type — rows from before v9.7.560 carry no type and show as 'unknown'.
    // (v1.26) MS-1.4: a row has a note type only when the pattern reader fired. Shown when at least a tenth of the rows have one.
    const _ntAll = Object.keys(cd.byNoteType || {}).reduce(function (a, k) { return a + (cd.byNoteType[k].total || 0); }, 0);
    const _ntKnown = _ntAll - ((cd.byNoteType || {}).unknown ? cd.byNoteType.unknown.total || 0 : 0);
    const _ntShow = _ntAll > 0 && _ntKnown / _ntAll >= 0.1;
    const typeRows = Object.keys(_ntShow ? (cd.byNoteType || {}) : {})
      .sort(function (a, b) { return cd.byNoteType[b].total - cd.byNoteType[a].total; })
      .map(function (k) {
        const b = cd.byNoteType[k];
        const bad = b.disagree + b.fabricated;
        return tr([k === '[CALL NOTE]' ? 'call note' : k === '[NOTE]' ? 'general note' : k,
                   String(b.total), String(b.disagree), String(b.fabricated),
                   b.total ? ((bad / b.total) * 100).toFixed(1) + '%' : '—']);
      });

    const disRows = cd.disagreements.slice(0, 25).map(function (d) {
      return tr([
        d.ts ? ctHM(d.ts) : '—',
        '<span style="color:' + (d.delta === 'QUOTE-FABRICATED' ? '#f87171' : '#fbbf24') + '">' + d.delta + '</span>',
        d.noteType === '[CALL NOTE]' ? 'call' : d.noteType === '[NOTE]' ? 'general' : (d.noteType || '—'),
        (d.store || 'unknown').replace('Community ', ''),
        d.leadSource || 'unknown',
        d.autoLeadId ? '<a href="' + vinLeadUrl(d.autoLeadId, d.customerId) + '" style="color:#60a5fa" target="_blank">' + d.autoLeadId + '</a>' : '—'
      ]);
    });

    return section('Commit Comprehension (observer) — ' + cd.total + ' verdict' + (cd.total === 1 ? '' : 's'),
      (comparable === 0
        ? '<div style="background:#1f1416;border:1px solid #7f1d1d;border-radius:5px;padding:12px;'
          + 'color:#fca5a5;font-size:12px;line-height:1.6">'
          + '<b>No usable comprehension verdicts for this date.</b> All ' + cd.total + ' row'
          + (cd.total === 1 ? '' : 's') + ' came from a probe call that never returned an answer, so there '
          + 'is no agreement rate to show. Rows collected before extension v9.7.564 are all in this '
          + 'category: the proxy judged the probe against MIN_CONTENT_CHARS=150, a floor written for a '
          + 'three-field customer draft, and the probe\'s correct answer is 40 characters — so every probe '
          + 'failed and the canned SAFE_FALLBACK draft returned in its place was read as "no commitment '
          + 'found". Needs proxy v7.58 + extension v9.7.564 deployed, proxy first.'
          + '</div>'
        : grid(tile('Agreement rate', leadPct(leadAgree), leadAgree + ' of ' + leadComparable + ' leads', '#4ade80'),
               tile('Disagreement rate', leadPct(leadDisagree), leadDisagree + ' of ' + leadComparable + ' leads', leadDisagree ? '#fbbf24' : '#4b5563'))
          // (v1.22) The per-VERDICT rate is kept, demoted, and labelled — it is the right
          // denominator for probe cost and telemetry volume, and the wrong one for "how often do
          // the two readers disagree about a lead". Showing both means a future gap between them
          // is visible as the regeneration artefact it is, instead of moving the headline.
          + '<div style="height:10px"></div>' + grid(
              tile('Per generation', cmpPct(disagree), disagree + ' of ' + comparable + ' verdicts disagree', '#4b5563'),
              tile('Repeat-generated', String(leadRepeats),
                   leadRepeats ? 'lead+detector pairs run more than once — up to ' + leadMaxRows + '×'
                               : 'every lead generated once', leadRepeats ? '#fbbf24' : '#4b5563')))
      // (v1.19) 'Probe never answered' was one tile covering two unrelated things, and the common
      // one was the benign one. Split: a probe that was ASKED and did not answer is a defect and
      // stays red; a lead where the customer never wrote anything is a LEAD STATE and is grey.
      // On 8/23 the single tile read 42 and every one of the 42 was the benign case.
      + ((noRegex || unverified || vacuous) ? '<div style="height:10px"></div>' + grid(
          tile('Probe never answered', String(unverified),
               unverified ? 'asked, no answer — a defect' : 'none', unverified ? '#f87171' : '#4b5563'),
          tile('No customer text', String(vacuous),
               'nothing to read — correct "none", excluded from both rates', '#6b7280'),
          tile('Not comparable', String(noRegex), 'regex gated off on these leads', '#6b7280')) : '')
      + ((noRegex || unverified) ? '<div style="height:10px"></div>' + grid(
          tile('Rows collected', String(cd.total), comparable + ' usable for a rate', '#60a5fa'),
          tile('Usable verdicts', String(comparable),
               comparable ? 'both readers produced a reading' : 'none yet',
               comparable ? '#60a5fa' : '#f87171')) : '')
      + '<div style="height:10px"></div>'
      + grid(tile('Fabricated quotes', String(fabricated),
                  fabricated ? 'model quoted text not in any note' : 'none — every quote verified',
                  fabricated ? '#f87171' : '#4b5563'),
             tile('Regex fired', String(cd.regexFired),
                  'comprehension read a commitment on ' + cd.compFired, '#60a5fa'))
      + '<div style="height:14px"></div>'
      // (v1.17) Per detector. CHANGED is the number that carries risk — it counts rows where
      // comprehension actually replaced the shipped directive rather than merely disagreeing with
      // it. With all three authoritative flags off it must be 0; anything else means a flag is
      // live that should not be.
      + (cd.byDetector && Object.keys(cd.byDetector).length
          ? '<div style="font-size:11px;color:#6b7280;margin-bottom:6px">BY DETECTOR — '
            + '"changed" counts rows where comprehension actually replaced the shipped directive</div>'
            + table(['Detector', 'Rows', 'Defaulted', 'Probe OK', 'Agree', 'Disagree', 'Fabricated', 'Changed'],
                Object.keys(cd.byDetector).sort().map(function (k) {
                  const b = cd.byDetector[k];
                  return tr([k, String(b.total),
                             // (v1.21) Rows filed here because they carried NO recognised detector,
                             // not because this detector produced them. A large number means the row
                             // is mostly inference — read the version table below before trusting it.
                             '<span style="color:' + (b.defaulted ? '#fbbf24' : '#4b5563') + '">'
                               + String(b.defaulted || 0) + '</span>',
                             String(b.usable), String(b.agree), String(b.disagree),
                             String(b.fabricated),
                             '<span style="color:' + (b.changedDirective ? '#fbbf24' : '#4b5563') + '">'
                               + b.changedDirective + '</span>']);
                }))
            + '<div style="height:14px"></div>'
          : '')
      + table(['Delta', 'Count', 'Share', 'Meaning'], rows)
      // ── (v1.21) BY EXTENSION VERSION ─────────────────────────────────────────────────────
      // The proxy has stored extensionVersion on every row since v7.55 and this report has never
      // shown it. A build before v9.7.566 runs the OLD single-row observer and posts ONE
      // verbal-commit row per generation; v9.7.566+ posts THREE, one per detector. A fleet on
      // mixed builds therefore skews the detector table with no defect anywhere — which is the
      // most likely reading of 8/24's day-lock 1 · off-franchise 2 · verbal-commit 374, and
      // nothing in the report could confirm or refute it. Now it can.
      + (Object.keys(cd.byVersion || {}).length
          ? '<div style="height:14px"></div><div style="font-size:10px;color:#60a5fa;'
            + 'text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">By extension version</div>'
            + '<div style="font-size:10px;color:#6b7280;margin-bottom:6px">Builds before v9.7.566 post ONE '
            + 'verbal-commit row per generation; v9.7.566+ posts THREE, one per detector. Mixed builds skew '
            + 'the detector table above without any defect.</div>'
            + table(['Extension', 'Rows', 'Detectors seen'],
                Object.keys(cd.byVersion).sort().map(function (v) {
                  const b = cd.byVersion[v];
                  return tr([v, String(b.total),
                             Object.keys(b.detectors).sort().map(function (d) {
                               return d + ':' + b.detectors[d];
                             }).join('&nbsp; ')]);
                }))
          : '')
      + (srcRows.length
          ? '<div style="height:14px"></div><div style="font-size:10px;color:#60a5fa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">By lead source</div>'
            + table(['Source', 'Verdicts', 'Disagree', 'Fabricated', 'Disagree rate'], srcRows)
          : '')
      + (typeRows.length
          ? '<div style="height:14px"></div><div style="font-size:10px;color:#60a5fa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">By note type</div>'
            + table(['Note type', 'Verdicts', 'Disagree', 'Fabricated', 'Disagree rate'], typeRows)
          : (_ntAll ? '<div style="font-size:10px;color:#4b5563;margin-top:8px">By note type is not shown: a row carries a note type only when the pattern reader fired, and '
              + _ntKnown + ' of ' + _ntAll + ' rows had one.</div>' : ''))
      + (disRows.length
          ? '<div style="height:14px"></div><div style="font-size:10px;color:#fbbf24;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Disagreements (' + cd.disagreements.length + ') — open the lead to read the notes</div>'
            + table(['Time (CT)', 'Delta', 'Note', 'Store', 'Source', 'Lead'], disRows)
          : '')
      // (v1.25) M-4: computed, not asserted. Changed = rows whose shipped directive came from comprehension.
      + (function () {
          const dets = cd.byDetector || {};
          const changed = Object.keys(dets).reduce((a, k) => a + (dets[k].changedDirective || 0), 0);
          const authRows = cd.authoritativeRows;
          const authNote = (typeof authRows === 'number')
            ? ' The authoritative switch was on for ' + authRows + ' of ' + cd.total + ' rows.' : '';
          return '<div style="font-size:10px;color:' + (changed ? '#fbbf24' : '#4b5563') + ';margin-top:12px">'
            + (changed ? 'Comprehension changed ' + changed + ' shipped directive' + (changed === 1 ? '' : 's') + ' on this day (see Changed above).'
                       : 'No comprehension verdict changed a shipped directive on this day (Changed is 0 on every detector).')
            + authNote + '</div>';
        })());
  })();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Courier New',monospace;background:#0a0e1a;color:#e2e8f0;margin:0;padding:24px">
<div style="max-width:680px;margin:0 auto">

  <div style="background:linear-gradient(135deg,#1e3a5f,#0f2744);border:1px solid #2d5a8e;border-radius:8px;padding:24px;margin-bottom:20px">
    <div style="font-size:22px;color:#60a5fa;letter-spacing:2px;text-transform:uppercase">LeadPro Daily Report</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:6px">${dateLabel} &nbsp;·&nbsp; ${winStart} – ${winEnd} CT</div>
  </div>

  ${section('Reliability', grid(
    stat('Total Requests (all contracts)', n),
    stat('Completion Rate', compRate + '%', colorFor(100 - +compRate, 1, 3)),
    stat('Recovered', recoveredReqs.length, recoveredReqs.length ? '#fbbf24' : '#34d399'),
    stat('Served safe fallback', servedFbReqs.length, servedFbReqs.length ? '#f87171' : '#34d399'),
    stat('Nothing served (non-draft)', exhaustedReqs.length, exhaustedReqs.length ? '#f87171' : '#34d399'),
    stat('Classifier regen', regenPct + '%', colorFor(+regenPct, 15, 25)),
    stat('Fallback tier answered', fbReqs.length, fbReqs.length === 0 ? '#34d399' : '#fbbf24')
  ))}
  <div style="color:#6b7280;font-size:11px;margin:-6px 0 14px 2px">
    <b>Recovered</b>: a tier failed and a later tier answered, so the agent got a draft. <b>Served safe fallback</b>: every tier
    failed on a draft and the canned message went out. <b>Nothing served</b>: every tier failed on a fact probe or other
    non-draft call. Only the last two count against completion. <b>Classifier regen</b> is the proxy's own regenerate after its
    classifier flagged a draft, not an agent pressing Regenerate.
  </div>

  ${section('By Contract (full drafts first)', table(
    ['Contract', 'Requests', 'Median', 'P95', 'Max', 'Recovered', 'Safe fallback', 'Nothing served'],
    contractRows.map(r => tr([r.c, r.n, r.med + 'ms', r.p95 + 'ms', r.max + 'ms', r.recovered || '—', r.servedFb || '—', r.exhausted || '—']))
  ) + `<div style="color:#6b7280;font-size:11px;margin-top:8px">${perfLabels
      ? `Each cache key is one prompt family, labeled from up to 3 of its own perf rows (${labeledKeys} key${labeledKeys === 1 ? '' : 's'} labeled).`
      : 'No perf rows were read, so draft-contract calls are not split into full drafts, rewrites and the rest.'}</div>`)}

  ${section('Latency (all contracts)', table(
    ['Segment', 'Avg', 'Median', 'P95', 'P99', 'Max'],
    [
      tr(['All requests', avg(allTotals)+'ms', allMed+'ms', allP95+'ms', allP99+'ms', maxAll+'ms']),
      tr(['No classifier regen',   avg(noRegenTots)+'ms', nrMed+'ms', nrP95+'ms', nrP99+'ms', maxNr+'ms']),
      tr(['With classifier regen', avg(withRegenTots)+'ms', wrMed+'ms', wrP95+'ms', '—', maxWr+'ms']),
      tr(['PRIMARY call', avg(primaryMs)+'ms', prMed+'ms', prP95+'ms', prP99+'ms', maxPr+'ms']),
      ...(regenMs.length ? [tr(['Classifier regen call', avg(regenMs)+'ms', rgMed+'ms', rgP95+'ms', '—', maxRg+'ms'])] : []),
    ]
  ))}

  ${section('Prompt Cache (primary tier)', grid(
    // Graded against the ceiling, not against 100%. 76% of achievable is a good day; 76% of the
    // whole prompt is impossible.
    stat('Of achievable', ofCeiling ? ofCeiling + '%' : 'N/A',
         ofCeiling ? colorFor(100 - +ofCeiling, 40, 70) : '#94a3b8'),
    stat('Prefix cached (warm)', avgOfSys ? avgOfSys + '%' : 'N/A', '#34d399'),
    stat('Ceiling', avgCeiling ? avgCeiling + '%' : 'N/A', '#94a3b8'),
    stat('Cold starts', coldCount + ' (' + coldPct + '%)', coldCount > 10 ? '#fbbf24' : '#94a3b8'),
    stat('Total Logged', cacheVals.length)
  ))}
  <div style="color:#6b7280;font-size:11px;margin:-6px 0 14px 2px">
    Ceiling = system tokens as a share of the whole prompt; the rest is per-lead content that cannot be
    cached. <b>Of achievable</b> is hit rate against that ceiling — it is the number to watch.
    <b>Prefix cached (warm)</b> is how much of the cacheable prefix came back from cache on requests
    that hit at all, so a low figure there means the prefix boundary moved, not that the prompt is big.
  </div>

  ${clsTotal > 0 ? section(`Classify (${clsTotal} logged)`, table(
    ['Type', 'Count', 'Flag'],
    Object.entries(clsCounts).sort((a,b)=>b[1]-a[1]).map(([k, v]) =>
      tr([k, v, k.includes('YES') ? '<span style="color:#fbbf24">→ REGEN</span>' : '—'])
    )
  ) + (clsTime ? `<div style="font-size:10px;color:#6b7280;margin-top:6px">Classifier time per draft (the draft waits for it): median ${clsTime.med}ms · P95 ${clsTime.p95}ms · max ${clsTime.max}ms over ${clsTime.n} drafts</div>`
              : '<div style="font-size:10px;color:#4b5563;margin-top:6px">Classifier time: not logged (proxy before v7.92).</div>')) : ''}

  ${section('Hourly Breakdown (CT)', table(
    ['Hour', 'Reqs', 'Avg', 'P95', 'Classifier regen', 'Cache', 'Cold', 'Fallback'],
    Object.keys(hourly).map(Number).sort((a,b)=>a-b).map(h => {
      const hrs  = hourly[h];
      const tots = hrs.map(d => d.final.total);
      const rg   = hrs.filter(d => d.final.regen).length;
      const fb   = hrs.filter(d => d.fallback).length;
      const rgPct = Math.round(100*rg/hrs.length);
      const [hp95] = percentiles(tots, 95);
      const cvals = hrs.filter(d => d.cachePct !== undefined).map(d => d.cachePct);
      const cold  = cvals.filter(v => v === 0).length;
      const avgC  = cvals.length ? Math.round(cvals.reduce((a,b)=>a+b,0)/cvals.length) : null;
      const coldPct = cvals.length ? Math.round(100*cold/cvals.length) : 0;
      return tr([
        `${String(h).padStart(2,'0')}:xx CT`,
        hrs.length,
        avg(tots)+'ms',
        hp95+'ms',
        `<span style="color:${rgPct>25?'#fbbf24':'#34d399'}">${rg} (${rgPct}%)</span>`,
        avgC===null ? '<span style="color:#4b5563">—</span>' : `<span style="color:${avgC>=50?'#34d399':avgC>=25?'#fbbf24':'#f87171'}">${avgC}%</span>`,
        `<span style="color:${cvals.length===0?'#4b5563':coldPct>=50?'#f87171':coldPct>0?'#fbbf24':'#34d399'}">${cvals.length?cold:'—'}</span>`,
        `<span style="color:${fb>0?'#fbbf24':'#4b5563'}">${fb||'—'}</span>`,
      ]);
    })
  ))}

  ${cacheLoad.length ? section('Cache Load per Key (measure only)', cacheLoad.slice(0, 4).map(k =>
      `<div style="font-size:12px;color:#e2e8f0;margin:6px 0 4px">${String(k.key).slice(0, 14)} · ${k.label} · ${k.reqs} requests · peak ${k.peak.n}/min at ${k.peak.m} CT · warm ${k.warmPct === null ? 'n/a' : k.warmPct + '%'}</div>`
      + table(['Requests per minute on this key', 'Minutes', 'Requests', 'Warm hits'],
          k.buckets.filter(b => b.minutes).map(b => tr([`${b.lo}${b.hi === Infinity ? '+' : b.hi === b.lo ? '' : '–' + b.hi}`, b.minutes, b.reqs,
            b.logged ? Math.round(100 * b.warm / b.logged) + '%' : '—'])))).join('')
    + '<div style="color:#6b7280;font-size:11px;margin-top:8px">Warm = the primary tier read any cached tokens. If warm hits fall as requests per minute rise on the full-draft key, the one fleet-wide key is overflowing (audit M-9); partition only then.</div>') : ''}

  ${failReqs.length ? section(`Failures (${failReqs.length}) · requests with a failed tier: ${recoveredReqs.length} recovered, ${servedFbReqs.length} served safe fallback, ${exhaustedReqs.length} nothing served`, `<div style="color:#9ca3af;font-size:12px;margin:0 0 6px">By reason: ${_failReasonLine(failReqs)}</div><div style="color:#6b7280;font-size:11px;margin:0 0 6px">counted in tier events, not requests: one request can fail on two tiers</div>` + table(
    ['Time (CT)', 'Tier', 'Latency', 'Model', 'Status', 'Reason'],
    failReqs.flatMap(d => d.fails.map(f =>
      tr([`<span style="color:#f87171">${ctHMS(d.final.ts)}</span>`, f.tier, f.ms+'ms', f.model || '—', f.status || '—', f.kind || '—'])
    ))
  )) : ''}

  ${feedbackHtml}

  ${commitHtml}

  <div style="text-align:center;color:#374151;font-size:11px;margin-top:20px">
    LeadPro · Community Auto Group · leadpro-reporter Worker
  </div>
</div>
</body></html>`;

  return { text, html };
}

// ── Email via Resend ───────────────────────────────────────────────────────

async function sendEmail(env, to, subject, text, html) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'LeadPro Reporter <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
      html,
    }),
  });
}

// ── Entry point ───────────────────────────────────────────────────────────

export default {

  async scheduled(event, env, ctx) {
    // Morning email = the prior complete day, in Central.
    const dateLabel = ctYesterdayLabel();
    await runReport(env, dateLabel);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date');
    const send = url.searchParams.get('send') === '1';

    // (v1.4) Bare URL (no ?date=) now shows TODAY's live, in-progress report — so the link can be
    // bookmarked like the dashboard instead of hand-editing the date each time. An explicit ?date=
    // still pins a specific day; the cron email still covers yesterday.
    const dateLabel = dateParam ?? ctDateLabel(new Date());

    const { text, html, count } = await runReport(env, dateLabel, send);
    if (!count) return new Response(`No data for ${dateLabel}`, { status: 404 });

    const accept = request.headers.get('Accept') ?? '';
    return new Response(accept.includes('text/plain') ? text : html, {
      headers: { 'Content-Type': accept.includes('text/plain') ? 'text/plain' : 'text/html' }
    });
  }
};

async function runReport(env, dateLabel, sendMail = true) {
  const datePart = dateLabel.replace(/-/g, '');
  // (v1.5) Logs are partitioned by UTC date, but a report is for a CENTRAL calendar day, which
  // straddles the UTC-midnight boundary. CT day D's entries live in TWO UTC partitions: the target
  // UTC date (CT morning/afternoon) and the NEXT UTC date (CT evening, after ~7pm CT). Reading only
  // logs/{D}/ smeared the report across midnight — it carried the PREVIOUS CT evening (UTC D
  // 00:00–05:00) and dropped the CURRENT CT evening (which sits in UTC D+1). Read both partitions
  // and filter to entries whose CT date == D for a clean, complete day. (The feedback read below
  // already crosses midnight the same way.)
  const nextDateLabel = new Date(new Date(dateLabel + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const nextPart      = nextDateLabel.replace(/-/g, '');
  const [keysA, keysB] = await Promise.all([
    listObjects(env.LOGS, `logs/${datePart}/`),
    listObjects(env.LOGS, `logs/${nextPart}/`),
  ]);
  const keys = [...keysA, ...keysB];

  if (!keys.length) {
    console.log(`No files for ${dateLabel} (prefixes: logs/${datePart}/ + logs/${nextPart}/)`);
    return { count: 0 };
  }

  // Parallel R2 reads — all files fetched concurrently instead of sequentially
  const chunks    = await Promise.all(keys.map(k => readObject(env.LOGS, k)));
  const allEntries = chunks.flat();
  console.log(`${allEntries.length} raw entries from ${keys.length} files (2 UTC partitions)`);

  // Keep only requests whose CENTRAL date matches the report day — drops the prior CT evening that
  // shares the UTC-D partition and includes the current CT evening pulled from UTC D+1.
  let reqs = parseLogs(allEntries).filter(r => {
    const t = (r.final && r.final.ts) || r.ts;
    return t && ctDateLabel(new Date(t)) === dateLabel;
  });
  const count = reqs.length;
  console.log(`${count} completed requests parsed`);

  // Fetch feedback directly from KV — avoids worker-to-worker routing issues.
  // Requires LEADPRO_LICENSES KV bound to this worker (same namespace as proxy).
  let feedbackData = null;
  try {
    if (env.LEADPRO_LICENSES) {
      const aggregate = async (datePrefix) => {
        let cursor;
        const entries = [];
        do {
          const page = await env.LEADPRO_LICENSES.list({ prefix: `feedback:${datePrefix}`, limit: 1000, ...(cursor ? { cursor } : {}) });
          for (const key of page.keys) {
            const val = await env.LEADPRO_LICENSES.get(key.name);
            if (val) { try { entries.push(JSON.parse(val)); } catch {} }
          }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
        return entries;
      };

      const nextDate = new Date(new Date(dateLabel).getTime() + 24*60*60*1000).toISOString().slice(0,10);
      console.log(`[FEEDBACK] querying KV direct for ${dateLabel} and ${nextDate}`);
      const [e1, e2] = await Promise.all([aggregate(dateLabel), aggregate(nextDate)]);
      const beforeFilter = e1.length + e2.length;
      // (v1.7) mirrors the reqs.filter() above — reading two UTC-adjacent KV prefixes isn't
      // enough, each entry needs its own true CT calendar day checked before being counted.
      // Without this, a rating recorded near CT midnight (UTC-dated the next day) shows up in
      // BOTH days' reports. Entries with no timestamp are kept as-is (fail open) rather than
      // dropped, since we can't verify their date either way.
      // (v1.11/v7.52) RETROACTIVE NORMALISATION. Extension v9.7.541 is what labels a session
// that never rendered a draft as 'incomplete'; rows written by v9.7.540 -- which is what ran on
// 8/11 -- recorded the same thing as 'abandoned'. Re-rendering an old day cannot change what the
// extension already wrote, so those rows would keep inflating the used-rate denominator forever.
// They are identifiable without guessing: _lpFeedbackCaptureMeta runs only after a generation
// succeeds, so an EMPTY meta is positive evidence no draft was ever produced. Normalise here and
// every historical day re-renders correctly. Rows from v9.7.541 onward already carry the right
// rating and pass through untouched.
      const entries = [...e1, ...e2]
        .filter(e => !e.ts || ctDateLabel(new Date(e.ts)) === dateLabel)
        .map(e => (e.rating === 'abandoned' && !(e.meta && Object.keys(e.meta).length))
          ? Object.assign({}, e, { rating: 'incomplete' })
          : e);
      console.log(`[FEEDBACK] ${beforeFilter} raw entries -> ${entries.length} after CT-date filter`);

      if (entries.length > 0) {
        // (v1.8) 'abandoned' = extension v9.7.540, a generate the agent never used. Without it
        // here the row counts toward `total` but no rating bucket, deflating every rate.
        const ratings  = { up:0, weak_up:0, neutral:0, down:0, abandoned:0, incomplete:0 };
        // (v1.8) `rating` cannot distinguish an explicit thumb from an implicit copy/rejection —
        // only `signal` can. Track the split explicitly so the tiles can say what they mean.
        let explicitUp = 0, explicitDown = 0, implicitUp = 0, implicitDown = 0;
        const signals  = { explicit:0, implicit_copy:0, implicit_chip_copy:0, implicit_regen_copy:0, implicit_regen_no_copy:0, implicit_chip_no_copy:0, no_interaction:0 };
        const chipFreq = {}, byStore = {}, byPersona = {}, byLeadSource = {}, byScenario = {};
        const downSessions = [];
        let totalRegens = 0, totalChips = 0;
        const _fbTally = (map, key, e) => {
          if (!map[key]) map[key] = { up:0, weak_up:0, neutral:0, down:0, abandoned:0, incomplete:0,
                                      explicitUp:0, explicitDown:0, implicitDown:0, total:0 };
          const b = map[key];
          b.total++;
          if (e.rating) b[e.rating] = (b[e.rating] || 0) + 1;
          if (e.signal === 'explicit') {
            if (e.rating === 'down') b.explicitDown++;
            else if (e.rating === 'up' || e.rating === 'weak_up') b.explicitUp++;
          } else if (e.rating === 'down') b.implicitDown++;
        };
        for (const e of entries) {
          if (ratings[e.rating]  !== undefined) ratings[e.rating]++;
          if (e.rating === 'down') downSessions.push({
            ts: e.ts || '', signal: e.signal || '', regenCount: e.regenCount || 0,
            store: (e.meta?.store || 'unknown').replace('Community ',''),
            leadSource: e.meta?.leadSource || 'unknown',
            scenario: e.meta?.scenario || 'standard',
            convState: e.meta?.convState || '', persona: e.meta?.persona || '',
            // (v1.12) Record locators, read from the SAME entry that produced this row — bound by
            // construction, never joined from a lookup, so a row cannot inherit another lead's ID.
            autoLeadId: e.meta?.autoLeadId || '', customerId: e.meta?.customerId || '',
            stockNum: e.meta?.stockNum || ''
          });
          if (signals[e.signal]  !== undefined) signals[e.signal]++;
          if (e.signal === 'explicit') {
            if (e.rating === 'down') explicitDown++;
            else if (e.rating === 'up' || e.rating === 'weak_up') explicitUp++;
          } else if (e.rating === 'up') implicitUp++;
          else if (e.rating === 'down') implicitDown++;
          totalRegens += e.regenCount || 0;
          totalChips  += e.chipCount  || 0;
          (e.chipsUsed || []).forEach(c => { chipFreq[c] = (chipFreq[c]||0)+1; });
          // (v1.10) One tally for all four breakdowns. Keying on `rating` alone merged an
          // explicit thumbs-down with a regen/chip-then-abandoned session, so every per-bucket
          // 👎 column overstated real rejection. `signal` is the only field that separates them.
          _fbTally(byStore,      e.meta?.store      || 'unknown', e);
          _fbTally(byPersona,    e.meta?.persona    || 'unknown', e);
          _fbTally(byLeadSource, e.meta?.leadSource || 'unknown', e);
          _fbTally(byScenario,   e.meta?.scenario   || 'unknown', e);
        }
        const total = entries.length;
        // (v1.26) MS-1.2, 1.3, 1.5: what each prompt carried (extension 9.7.868+ only), its length, and key-information rows
        const { directives, directiveRows: _dirRows, promptChars, keyInfo: _kiM } = (typeof _feedbackMeasures === 'function') ? _feedbackMeasures(entries) : {};   // (lifted alone by reporter-feedback)
        // v1.3: SHIPPED rate (up+weak_up+neutral)/total is the headline — matches
        // proxy worker v7.22 and the dashboard. A copied-after-regen message ('neutral')
        // DID ship; counting only up+weak_up made flags like distance/stalled read as a
        // fake 0-4% even though the output was used. firstTryRate exposes the real
        // "needed a regen before sending" signal.
        const shipped  = ratings.up + ratings.weak_up + ratings.neutral;
        const firstTry = ratings.up + ratings.weak_up;
        // (v1.8) ENGAGED excludes abandoned rows. Shipped/First-Try stay on this denominator so
        // the existing series is unbroken by v9.7.540; usedRate carries the all-generates view
        // ("of everything generated, what fraction was actually used"), which is the honest
        // product number now that the denominator finally contains the unused drafts.
        // (v1.9) PRODUCED = sessions that actually rendered a draft. 'incomplete' sessions never
        // did, so they belong in no quality denominator — they are a generate-reliability number.
        const produced = total - ratings.incomplete;
        const engaged  = produced - ratings.abandoned;
        feedbackData = {
          date: dateLabel, total, engaged, produced,
          shippedRate:  engaged ? Math.round(100*shipped/engaged)  : 0,
          firstTryRate: engaged ? Math.round(100*firstTry/engaged) : 0,
          usedRate:     produced ? Math.round(100*shipped/produced) : 0,
          downRate:     engaged ? Math.round(100*ratings.down/engaged) : 0,
          // posRate kept as alias of shippedRate for any downstream consumer.
          posRate:      engaged ? Math.round(100*shipped/engaged)  : 0,
          explicitUp, explicitDown, implicitUp, implicitDown,
          abandoned: ratings.abandoned, incomplete: ratings.incomplete,
          ratings, signals, chipFreq, byStore, byPersona, byLeadSource, byScenario,
          downSessions,
          directives, directiveRows: _dirRows, promptChars, keyInfo: _kiM,   // (v1.26)
          avgRegens: total ? +(totalRegens/total).toFixed(2) : 0,
          avgChips:  total ? +(totalChips/total).toFixed(2)  : 0
        };
      }
    } else {
      console.log('[FEEDBACK] LEADPRO_LICENSES not bound to reporter — add KV binding');
    }
  } catch(e) {
    console.log('Feedback query failed:', e.message);
  }

  // ── (v1.13) Commit-comprehension verdicts, same KV, same shape as the feedback read above ──
  // Deliberately a separate try/catch: this is instrumentation about an observer, and a failure
  // reading it must never cost the report its actual operational content.
  let commitData = null;
  try {
    if (env.LEADPRO_LICENSES) {
      const ccAggregate = async (datePrefix) => {
        let cursor;
        const entries = [];
        do {
          const page = await env.LEADPRO_LICENSES.list({ prefix: `commit:${datePrefix}`, limit: 1000, ...(cursor ? { cursor } : {}) });
          const vals = await Promise.all(page.keys.map(k => env.LEADPRO_LICENSES.get(k.name)));
          for (const val of vals) { if (val) { try { entries.push(JSON.parse(val)); } catch {} } }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
        return entries;
      };
      const ccNext = new Date(new Date(dateLabel).getTime() + 24*60*60*1000).toISOString().slice(0,10);
      const [c1, c2] = await Promise.all([ccAggregate(dateLabel), ccAggregate(ccNext)]);
      // Same CT-day filter as the feedback read — keys are UTC-dated, the report is a Central
      // day, so two UTC prefixes are read and each entry's own CT date decides. Without this a
      // verdict recorded near CT midnight would appear in both days' reports.
      const ccEntries = [...c1, ...c2].filter(e => !e.ts || ctDateLabel(new Date(e.ts)) === dateLabel);
      console.log(`[COMMIT-COMP] ${c1.length + c2.length} raw -> ${ccEntries.length} after CT-date filter`);

      if (ccEntries.length > 0) {
        // (v1.15) NO-REGEX-VERDICT is a row where the regex never ran (showroom follow-up, or a
        // lead with no call-note content). It is not agreement and not disagreement, so it is
        // counted separately and excluded from BOTH rates — otherwise it silently inflates
        // whichever one it is folded into.
        // (v1.16) PROBE-FAILED and, far more consequentially, probeOk. Extension v9.7.564 found
        // that the proxy's MIN_CONTENT_CHARS=150 floor rejected the observer probe's correct
        // answer at every tier — {"kind":"none","note":null,"quote":null} is 40 characters — and
        // that the SAFE_FALLBACK the proxy returned instead is valid JSON with no "kind" key, so
        // the observer read kind:'none' off a canned customer draft and persisted it as
        // agreement. The floor predates the observer, so EVERY row collected before v9.7.564 was
        // produced by a probe that could not succeed.
        //   `probeOk === true` is the shape test for a row worth counting. Absence is not a
        // missing optional field here — it is the signature of the whole fabricated series, and
        // testing the shape beats comparing version strings.
        const _newDeltas = () => ({ 'AGREE-COMMITMENT':0, 'AGREE-NONE':0, 'DISAGREE-REGEX-ONLY':0,
                                    'DISAGREE-COMPREHENSION-ONLY':0, 'QUOTE-FABRICATED':0,
                                    'NO-REGEX-VERDICT':0, 'PROBE-FAILED':0,
                                    // (v1.17) Phase 3
                                    'AGREE-FIRED':0, 'NO-COMPREHENSION-VERDICT':0,
                                    // (v1.19) Without this key the loop's
                                    // `if (deltas[e.delta] === undefined) continue;` guard
                                    // would silently drop every NO-CUSTOMER-TEXT row.
                                    'NO-CUSTOMER-TEXT':0 });
        // `deltas` is EVERY row that arrived, so the breakdown table still shows what was
        // collected. `verifiedDeltas` is only rows whose probe actually answered, and every RATE
        // is computed from it. Subtracting exclusions out of the raw total would double-count:
        // a NO-REGEX-VERDICT row can also be an unverified-probe row, and on the pre-v9.7.564
        // series most of them are both.
        const deltas = _newDeltas();
        const verifiedDeltas = _newDeltas();
        const bySource = {};
        const disagreements = [];
        let regexFired = 0, compFired = 0, unverifiedProbe = 0, comparable = 0;
        let authoritativeRows = 0;   // (v1.25) rows whose authoritative switch was on when written
        // ── (v1.22) PER-LEAD TALLY — ONE AGENT REGENERATING MUST NOT MOVE A FLEET METRIC ────────
        // 9/1: all EIGHT DISAGREE-REGEX-ONLY rows that day were ONE lead (2056662795) regenerated
        // eight times between 13:29 and 17:11. One note, one false "will be" match, counted eight
        // times. That single lead took the day's agreement rate from 97.0% to 94.5% and produced a
        // "Facebook 39.1% disagreement rate" in the by-source table — both artefacts of an agent
        // pressing Generate, not of comprehension behaving differently.
        //
        // The per-VERDICT rate is still correct and is still shown: it answers "how often do the
        // two readers differ per generation", which is the right denominator for probe cost and
        // for telemetry volume. It is the wrong denominator for "how often do they actually
        // disagree about a lead", and that is the number this programme is deciding on.
        //
        // COLLAPSE RULE, stated because it is a judgement and not an obvious one: the unit is
        // LEAD + DETECTOR, and a pair counts as disagreeing if ANY of its comparable rows
        // disagreed. Not the majority, not the last one. A lead whose two readers differed on even
        // one generation is a lead worth opening, and this table's job is to produce the review
        // list — so it must not be able to hide a disagreement behind seven agreements. The cost
        // of that choice is the opposite bias, and it is named here rather than left implicit.
        // Rows carrying no autoLeadId cannot be collapsed and are keyed by row so they still count
        // once each, which is the honest treatment of a row we cannot attribute.
        const byLead = Object.create(null);
        let _leadRowSeq = 0;
        // (v1.14) Extension v9.7.560 widened both readers to [CALL NOTE] + [NOTE]. Breaking the
        // deltas down by the note type that SOURCED the verdict is the whole reason that build
        // carries the type through — "these disagree" is far less actionable than "these
        // disagree on general notes specifically".
        const byNoteType = {};
        // (v1.17) Per-detector rollup. Merging three different questions into one rate would make
        // every one of them uninterpretable. `changedDirective` counts rows where comprehension
        // ACTUALLY replaced the shipped directive — distinct from rows where it merely disagreed.
        const byDetector = {};
        const byVersion  = {};
        for (const e of ccEntries) {
          // ── (v1.21) THE DEFAULT IS KEPT, AND NOW IT IS COUNTED ─────────────────────────────
          // A row with no recognised detector silently became verbal-commit. That default is
          // CORRECT for its stated purpose — every row written before extension v9.7.566 is
          // verbal-commit by construction — but it is invisible, and it defaults toward the
          // detector that already has the most evidence, which is the worst direction for a
          // table that decides which authoritative flag to flip first.
          // On 8/24 this table read day-lock 1 · off-franchise 2 · verbal-commit 374 against
          // 8/23's 36 · 29 · 32. Nothing in the report could say whether that was a real change
          // in detector behaviour or 374 rows being defaulted. Now it can.
          const _known = ['verbal-commit','day-lock','off-franchise'].indexOf(e.detector) >= 0;
          const _det = _known ? e.detector : 'verbal-commit';
          if (!byDetector[_det]) byDetector[_det] = { total:0, usable:0, agree:0, disagree:0,
                                                      fabricated:0, probeFailed:0, changedDirective:0,
                                                      defaulted:0 };
          const _b = byDetector[_det];
          _b.total++;
          if (!_known) _b.defaulted++;
          // (v1.21) Which extension build wrote this row. The proxy has stored it since v7.55 and
          // the report has never shown it. A pre-v9.7.566 build runs the OLD single-row observer
          // and posts ONE verbal-commit row per generation; v9.7.566+ posts THREE, one per
          // detector. So a fleet on mixed builds produces exactly the lopsided split seen on 8/24,
          // with no defect anywhere — and until now nothing in the report could distinguish that
          // from a real regression. Same shape as the cache ceiling: the proxy knew, the report
          // did not say.
          const _ver = String(e.extensionVersion || '').trim() || '(not recorded)';
          if (!byVersion[_ver]) byVersion[_ver] = { total:0, detectors:{} };
          byVersion[_ver].total++;
          byVersion[_ver].detectors[_known ? e.detector : '(defaulted)'] =
            (byVersion[_ver].detectors[_known ? e.detector : '(defaulted)'] || 0) + 1;
          if (e.probeOk === true) _b.usable++;
          if (e.sourceUsed === 'comprehension') _b.changedDirective++;
          if (e.authoritative === true) authoritativeRows++;   // (v1.25)
          if (e.delta === 'QUOTE-FABRICATED') _b.fabricated++;
          else if (e.delta === 'PROBE-FAILED') _b.probeFailed++;
          else if (String(e.delta || '').indexOf('DISAGREE') === 0) _b.disagree++;
          else if (String(e.delta || '').indexOf('AGREE') === 0 && e.probeOk === true) _b.agree++;
          if (deltas[e.delta] === undefined) continue;   // unknown delta: counted nowhere, never crashes
          deltas[e.delta]++;
          // (v1.16) Counted, and then excluded from every rate and every breakdown below. A row
          // whose probe never answered says nothing about whether the two readers agree.
          // (v1.19) A vacuous row also carries probeOk:false, so without this it would be
          // counted BOTH as NO-CUSTOMER-TEXT and as an unanswered probe — the same 42 rows
          // shown twice, in a red tile and a grey one. Structural flag first, delta as the
          // fallback. Rows written before extension v9.7.574 carry NEITHER, so they stay in
          // unverifiedProbe: they cannot be reclassified after the fact and are not guessed at.
          const _vac = (e.vacuous === true) || e.delta === 'NO-CUSTOMER-TEXT';
          if (e.probeOk !== true) { if (!_vac) unverifiedProbe++; continue; }
          verifiedDeltas[e.delta]++;
          if (e.delta !== 'NO-REGEX-VERDICT' && e.delta !== 'PROBE-FAILED') {
            comparable++;
            // (v1.22) Same exclusions as the per-verdict `comparable` above — a row that is not a
            // comparison cannot make a lead comparable either.
            const _lid = (e.meta && e.meta.autoLeadId) || '';
            const _key = (_lid || ('(unattributed-' + (++_leadRowSeq) + ')')) + '|' + (_known ? e.detector : '(defaulted)');
            if (!byLead[_key]) byLead[_key] = { disagree: false, fabricated: false, rows: 0 };
            const _lb = byLead[_key];
            _lb.rows++;
            if (e.delta === 'QUOTE-FABRICATED') _lb.fabricated = true;
            else if (String(e.delta || '').indexOf('DISAGREE') === 0) _lb.disagree = true;
          }
          if (e.regexFired) regexFired++;
          if (e.compKind === 'firm' || e.compKind === 'soft') compFired++;
          const src = (e.meta && e.meta.leadSource) || 'unknown';
          if (!bySource[src]) bySource[src] = { total:0, agree:0, disagree:0, fabricated:0 };
          const b = bySource[src];
          b.total++;
          if (e.delta === 'QUOTE-FABRICATED') b.fabricated++;
          else if (e.delta.indexOf('DISAGREE') === 0) b.disagree++;
          else b.agree++;
          // Attribute a row to whichever side actually sourced a verdict. Rows from v9.7.559
          // and earlier carry no type at all and land under 'unknown' rather than being
          // dropped or silently counted as call notes.
          const nt = e.regexNoteType || e.compNoteType || 'unknown';
          if (!byNoteType[nt]) byNoteType[nt] = { total: 0, agree: 0, disagree: 0, fabricated: 0 };
          const nb = byNoteType[nt];
          nb.total++;
          if (e.delta === 'QUOTE-FABRICATED') nb.fabricated++;
          else if (e.delta.indexOf('DISAGREE') === 0) nb.disagree++;
          else nb.agree++;
          // (v1.18) POSITIVE list. An exclusion list silently absorbs every delta added later —
          // that is exactly how AGREE-FIRED ended up under a DISAGREEMENTS heading.
          if (['DISAGREE-REGEX-ONLY', 'DISAGREE-COMPREHENSION-ONLY', 'QUOTE-FABRICATED'].indexOf(e.delta) >= 0) {
            disagreements.push({
              ts: e.ts || '', delta: e.delta,
              store: (e.meta && e.meta.store) || '', leadSource: src,
              noteType: nt,
              autoLeadId: (e.meta && e.meta.autoLeadId) || '',
              customerId: (e.meta && e.meta.customerId) || ''
            });
          }
        }
        disagreements.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
        // (v1.22) Collapse to lead+detector pairs. `leadRepeats` is the number of pairs that were
        // generated more than once — the size of the effect this whole change exists to remove.
        const _leadKeys      = Object.keys(byLead);
        const leadComparable = _leadKeys.length;
        const leadDisagree   = _leadKeys.filter(k => byLead[k].disagree).length;
        const leadFabricated = _leadKeys.filter(k => byLead[k].fabricated).length;
        const leadRepeats    = _leadKeys.filter(k => byLead[k].rows > 1).length;
        const leadMaxRows    = _leadKeys.reduce((m, k) => Math.max(m, byLead[k].rows), 0);
        commitData = { date: dateLabel, total: ccEntries.length, deltas, verifiedDeltas, bySource, authoritativeRows,
                       byNoteType, byDetector, byVersion, disagreements, regexFired, compFired,
                       unverifiedProbe, comparable,
                       leadComparable, leadDisagree, leadFabricated, leadRepeats, leadMaxRows };
      }
    } else {
      console.log('[COMMIT-COMP] LEADPRO_LICENSES not bound to reporter — add KV binding');
    }
  } catch (e) {
    console.log('Commit-comprehension query failed:', e.message);
  }

  // (v1.25) M-4 / M-9: label each cache key from a few of its own perf rows (perf:<ISO ts>:<requestId>, 14-day TTL, same KV).
  // The listing is by UTC date, so the CT day's two UTC dates are read, as the log partitions are. Bounded: one list per
  // 1,000 keys and at most 3 reads per cache key. A failure leaves the report as it was, with draft calls unlabeled.
  let perfLabels = null;
  try {
    if (env.LEADPRO_LICENSES) {
      const kv = env.LEADPRO_LICENSES;
      const listKeys = async (prefix) => { const names = []; let cursor;
        do { const page = await kv.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
             for (const k of page.keys) names.push(k.name); cursor = page.list_complete ? null : page.cursor; } while (cursor);
        return names; };
      const getRow = async (name) => { try { const v = await kv.get(name); return v ? JSON.parse(v) : null; } catch { return null; } };
      perfLabels = await _labelCacheKeys(reqs, [`perf:${dateLabel}`, `perf:${nextDateLabel}`], listKeys, getRow, 3);
      console.log(`[PERF LABELS] ${Object.keys(perfLabels).length} cache keys labeled`);
    }
  } catch (e) { console.log('Perf label read failed:', e.message); perfLabels = null; }

  const { text, html } = buildReport(reqs, dateLabel, feedbackData, commitData, perfLabels);
  const subject = `LeadPro Report — ${dateLabel} (${count} requests)`;

  if (sendMail && env.REPORT_TO && env.RESEND_API_KEY) {
    const res = await sendEmail(env, env.REPORT_TO, subject, text, html);
    console.log(`Email: ${res.status}`);
  }

  return { text, html, count };
}
