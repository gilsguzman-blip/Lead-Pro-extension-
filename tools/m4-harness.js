#!/usr/bin/env node
'use strict';
// (v9.7.700) M4 PAIRED HARNESS — run on a machine that can reach the proxy.
//
// For each captured full prompt (the leadpro_full_prompt_*.txt the panel exports) it builds two
// requests that differ ONLY in where the standing rules sit:
//   BEFORE — the capture exactly as it was sent
//   AFTER  — the same capture with each of its own standing-rule lines moved, verbatim, into the
//            system prompt above ⟦LP_CACHE_BREAKPOINT⟧, laid out as v9.7.700's _LP_STANDING_RULES
// Each pair is sent REPS times per side, alternating which side goes first, with the edge cache
// bypassed. Latency, prompt tokens, the model tier that answered and the drafts are written to --out.
// The results file holds real customer drafts: keep it local, never commit it.
//
// Usage (from the repo root, Node 18+):
//   LP_LICENSE_KEY=<director key> node tools/m4-harness.js --out m4-results.json [--reps 2] capture1.txt capture2.txt ...
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const loadPopup = require('../tests/helpers/load-popup.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const OUT = opt('--out', 'm4-results.json');
const REPS = parseInt(opt('--reps', '2'), 10);
const URL = opt('--url', 'https://leadpro-proxy.gilsguzman.workers.dev/');
const KEY = process.env.LP_LICENSE_KEY || '';
const files = args.filter(a => /\.txt$/.test(a));
if (!files.length) { console.error('usage: LP_LICENSE_KEY=... node tools/m4-harness.js --out results.json capture.txt ...'); process.exit(2); }

const sb = loadPopup(path.join(__dirname, '..', 'builds', 'dev', 'popup.js'), { withAuth: true });
const standing = vm.runInContext('_LP_STANDING_RULES', sb).split('\n');
const isRule = (l) => l.length > 40 && !/^━━━|^These apply to every message/.test(l);
const POINTER = '- Every STANDING RULE in your system prompt applies to this message. The constraints below are specific to this lead.';

function split(file) {
  const t = fs.readFileSync(file, 'utf8');
  const a = t.indexOf('=== SYSTEM PROMPT'), b = t.indexOf('=== USER PROMPT');
  if (a < 0 || b < 0) throw new Error(file + ': not a full-prompt export');
  return { sys: t.slice(t.indexOf('\n', a) + 1, b).replace(/\n+$/, ''), user: t.slice(t.indexOf('\n', b) + 1).replace(/\n+$/, '') };
}
function moveStanding(sys, user) {
  const U = user.split('\n'), moved = [], missing = [];
  for (const r of standing.filter(isRule)) {
    const i = U.findIndex(l => l.slice(0, 40) === r.slice(0, 40));
    if (i < 0) { missing.push(r.slice(0, 40)); continue; }
    moved.push(U[i]); U.splice(i, 1);
  }
  const hc = U.indexOf('━━━ HARD CONSTRAINTS ━━━'); if (hc >= 0) U.splice(hc + 1, 0, POINTER);
  const block = standing.map(l => isRule(l) ? moved.find(m => m.slice(0, 40) === l.slice(0, 40)) : l).filter(l => l !== undefined);
  const si = sys.indexOf('⟦LP_CACHE_BREAKPOINT⟧'); if (si < 0) throw new Error('no cache breakpoint in system prompt');
  return { sys: sys.slice(0, si) + block.join('\n') + '\n\n' + sys.slice(si), user: U.join('\n'), moved: moved.length, missing };
}
async function call(sys, user) {
  const body = JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 2500, topP: 0.9, responseMimeType: 'application/json' },
    licenseKey: KEY || undefined, noEdgeCache: true });
  const t0 = Date.now();
  try {
    const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const j = await r.json();
    let text = ''; try { text = j.candidates[0].content.parts[0].text; } catch (e) {}
    let draft = null; try { draft = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); } catch (e) {}
    return { status: r.status, ms: Date.now() - t0, model: j._model || null, workerLatency: j._latency || null,
      promptTokens: j.usageMetadata ? j.usageMetadata.promptTokenCount : null, fallback: !!(j._fallback || (j.candidates && j.candidates[0] && j.candidates[0]._fallback)), draft, raw: draft ? undefined : text.slice(0, 500) };
  } catch (e) { return { status: 0, ms: Date.now() - t0, error: String(e) }; }
}
const med = (a) => { const s = a.filter(x => typeof x === 'number').sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
(async () => {
  const results = [];
  for (const f of files) {
    const before = split(f), after = moveStanding(before.sys, before.user);
    const row = { file: path.basename(f), moved: after.moved, missing: after.missing,
      chars: { beforeUser: before.user.length, afterUser: after.user.length, beforeSys: before.sys.length, afterSys: after.sys.length }, before: [], after: [] };
    for (let r = 0; r < REPS; r++) {
      const order = r % 2 ? ['after', 'before'] : ['before', 'after'];
      for (const side of order) { const p = side === 'before' ? before : after; row[side].push(await call(p.sys, p.user)); }
    }
    results.push(row);
    console.log(row.file.slice(0, 8) + '  moved ' + row.moved + (row.missing.length ? ' (missing ' + row.missing.length + ')' : '')
      + '  user ' + row.chars.beforeUser + '→' + row.chars.afterUser
      + '  median ms before ' + med(row.before.map(x => x.ms)) + ' / after ' + med(row.after.map(x => x.ms))
      + '  tiers ' + row.before.map(x => x.model).join(',') + ' | ' + row.after.map(x => x.model).join(','));
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const errs = [].concat(...results.map(r => r.before.concat(r.after))).filter(x => x.status !== 200 || x.fallback || !x.draft);
  if (errs.length) console.log('\n⚠ ' + errs.length + ' call(s) did not return a usable draft (network error, non-200, fallback or unparseable) — first: '
    + (errs[0].error || ('status ' + errs[0].status + (errs[0].fallback ? ' SAFE_FALLBACK' : ''))).slice(0, 120) + '. Those runs are not comparable.');
  const all = (side, k) => med([].concat(...results.map(r => r[side].map(x => x[k]))));
  console.log('\nALL: median ms before ' + all('before', 'ms') + ' / after ' + all('after', 'ms')
    + ' | median prompt tokens before ' + all('before', 'promptTokens') + ' / after ' + all('after', 'promptTokens')
    + '\nwrote ' + OUT + ' — upload it to the session; it contains real drafts, keep it out of git.');
})();
