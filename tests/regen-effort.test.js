#!/usr/bin/env node
'use strict';
/**
 * regen-effort.test.js — v9.7.575 + proxy v7.66. THE ESCALATION IS GONE; THE RAILS REMAIN.
 *
 * ── WHAT THIS SUITE USED TO PIN, AND WHY IT CHANGED ───────────────────────────────────────
 * v9.7.573 raised a regen's draft to reasoningEffort:'high', on the reasoning that a regen is the
 * one signal on this surface that is a HUMAN DECISION rather than a heuristic — a person read the
 * draft and judged the first read wrong. That reasoning still holds. The COST did not survive
 * contact with real numbers.
 *
 * MEASURED on this prompt shape (~62k chars) against gpt-5.6-luna:
 *   'low'   ≈ 6.4s to a finished draft
 *   'high'  13.9s / 14.4s / 15.1s / 17.1s successful, plus timeouts at the 18000ms ceiling
 *
 * So the escalation roughly TRIPLED the wait on the one interaction where the agent is already
 * unhappy, and 18000ms was not a comfortable ceiling — it sat in the middle of the tail, which is
 * why raising the budget again was refused rather than repeated.
 *
 * And no quality signal ever arrived to pay for it. Every escalated sample captured was a FORCED
 * test rather than natural agent behaviour, so the feedback pipeline never produced a comparison.
 * The operator's read is that Luna is good enough at 'low' and that medium/high make little
 * difference to output quality here — consistent with the absence of any measured gain. Eleven
 * extra seconds for an unmeasurable difference is the wrong trade, so the experiment is dropped.
 *
 * The constants are REMOVED rather than switched off: a dormant flag invites someone to flip it
 * without re-reading the numbers above.
 *
 * ── WHAT THIS SUITE PINS NOW, AND IT IS THE IMPORTANT HALF ────────────────────────────────
 * The PROXY RAILS STAY ARMED. v7.63's tier guard and v7.64's escalated budget are NOT experiment
 * scaffolding — they protect ANY caller from re-creating the v9.7.219 failure:
 *
 *   "medium reasoning blew through the entire cascade — PRIMARY timing out at 10000ms, FALLBACK
 *    also timing out, leads landing on SAFE_FALLBACK after 23s."
 *
 * That happened because the elevated effort applied to EVERY tier, so the recovery tiers were
 * reasoning hard too and could not cover the hole the primary left. With nothing escalating today
 * the rails simply go quiet — and a quiet rail is exactly the kind that rots unnoticed, so every
 * one of them is still asserted here. If a future caller sends an above-baseline effort, it must
 * still reach the primary tier ONLY.
 *
 * The probes' 'none' must still reach every tier, because it makes recovery FASTER, not slower.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const args   = process.argv.slice(2);
const BUILDS = args.filter(a => /popup\.js$/.test(a));
const PROXY  = args.find(a => /cloudflare-worker/.test(a));
if (!BUILDS.length || !PROXY) {
  console.error('usage: regen-effort.test.js <popup.js> [popup.js...] <cloudflare-worker.js>');
  process.exit(2);
}

const proxySrc = fs.readFileSync(PROXY, 'utf8');

// The proxy's effort machinery, run for real.
const W = (() => {
  const at = n => { const i = proxySrc.indexOf(n); if (i < 0) throw new Error('missing ' + n); return i; };
  const span = proxySrc.slice(at("const REASONING_EFFORT = 'low';"), at('const MODEL_CASCADE = ['));
  const sb = { String, Object, Array, Math, JSON };
  vm.createContext(sb);
  vm.runInContext(span, sb);
  return {
    effort: vm.runInContext('resolveEffort', sb),
    isEsc:  vm.runInContext('typeof isEscalation === "function" ? isEscalation : null', sb),
    BASE:   vm.runInContext('REASONING_EFFORT', sb)
  };
})();

// Comment lines removed. Assertions in this repo have repeatedly matched their OWN
// explanatory prose — a scan for `reasoningEffort` hits the paragraph explaining why
// reasoningEffort was removed. Scan CODE, never the commentary about it.
const stripComments = (t) => t.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
const impls = BUILDS.map(f => ({ name: path.basename(path.dirname(f)), src: fs.readFileSync(f, 'utf8'), code: stripComments(fs.readFileSync(f, 'utf8')) }));

let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
function check(name, fn, want) {
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);
}
function pOne(name, fn, want) {
  let got; try { got = JSON.stringify(fn()); } catch (e) { got = 'THREW: ' + e.message; }
  if (got === JSON.stringify(want)) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want) + '\n        got      ' + got); }
}

console.log('\nv9.7.575 + v7.66 — the escalation is gone; the rails that made it safe remain');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── The extension side: it must send NOTHING ──────────────────────────────────
console.log('the extension: a regen is now byte-identical to a first-pass draft');

check('the escalation constants are GONE, not merely switched off', i => ({
  escalate: /var LEADPRO_REGEN_ESCALATE\s*=/.test(i.src),
  effort:   /var LEADPRO_REGEN_EFFORT\s*=/.test(i.src)
}), { escalate: false, effort: false });

check('NOTHING sets reasoningEffort on the draft payload any more',
  i => (i.code.match(/payload\.generationConfig\.reasoningEffort/g) || []).length, 0);

check('the draft payload carries no effort field at all — the worker default governs',
  i => {
    // The generationConfig literal the draft is built from must not mention the field.
    const a = i.code.indexOf('maxOutputTokens:  2500,');
    return a > 0 && /reasoningEffort/.test(i.code.slice(a - 400, a + 400));
  }, false);

check('the removal is DOCUMENTED with the numbers, so it is not re-litigated from scratch',
  i => ({
    cites:   /'high'\s+13\.9s, 14\.4s, 15\.1s, 17\.1s successful|13\.9s, 14\.4s, 15\.1s, 17\.1s/.test(i.src),
    saysWhy: /LEADPRO_REGEN_ESCALATE and LEADPRO_REGEN_EFFORT are gone rather than left/.test(i.src)
  }), { cites: true, saysWhy: true });

check('the probes are UNTOUCHED — they still ask for none',
  i => (i.code.match(/reasoningEffort: 'none'/g) || []).length, 2);

check('the probe payloads are the ONLY place the extension names an effort',
  i => (i.code.match(/reasoningEffort:/g) || []).length, 2);

// ── The proxy side: the v9.7.219 guard ────────────────────────────────────────
console.log('\nthe proxy rails — dormant now, and asserted still armed:');

pOne('the baseline it escalates from is "low", set by the worker',
  () => W.BASE, 'low');

pOne('isEscalation is a real comparison against the baseline, not a hardcoded list',
  () => ['none', 'low', 'medium', 'high', 'xhigh', 'max'].map(e => !!W.isEsc(e)),
  [false, false, true, true, true, true]);

pOne('THE ASK: a regen at "high" reaches the primary tier intact',
  () => W.effort('gpt-5.6-luna', 'high', 'primary').effort, 'high');

pOne('THE GUARD: that same "high" does NOT reach the fallback tier',
  () => {
    const r = W.effort('gpt-5.4-nano-2026-03-17', 'high', 'fallback');
    return { effort: r.effort, explains: /primary-tier only/.test(r.note), cites: /v9\.7\.219/.test(r.note) };
  }, { effort: 'low', explains: true, cites: true });

pOne('...nor the emergency tier, which is not a reasoning model anyway',
  () => W.effort('gpt-4.1-nano', 'high', 'emergency').effort, null);

pOne('the v9.7.219 failure is unreachable: no tier below primary can be slowed by a caller',
  () => ['medium', 'high', 'xhigh', 'max'].map(e => W.effort('gpt-5.4-nano-2026-03-17', e, 'fallback').effort),
  ['low', 'low', 'low', 'low']);

// ── The probes must not be caught by the guard ────────────────────────────────
console.log('\nand the guard must not catch the probes, which ask DOWNWARD:');

pOne('"none" is not an escalation, so it still applies to the fallback tier',
  () => W.effort('gpt-5.4-nano-2026-03-17', 'none', 'fallback').effort, 'none');

pOne('"none" reaches the primary tier too',
  () => W.effort('gpt-5.6-luna', 'none', 'primary').effort, 'none');

pOne('the baseline itself is not an escalation — it passes through every tier unremarked',
  () => ['primary', 'fallback'].map(t =>
    W.effort(t === 'primary' ? 'gpt-5.6-luna' : 'gpt-5.4-nano-2026-03-17', 'low', t).note), ['', '']);

pOne('a call with no tier argument still resolves — nothing else in the proxy breaks',
  () => W.effort('gpt-5.6-luna', 'high').effort, 'high');

// ── Not vacuous ───────────────────────────────────────────────────────────────
console.log('\nthe tests are not vacuous:');

pOne('BEFORE v7.63 the escalation would have reached the fallback tier — reproduced',
  () => {
    // v7.62's resolver had no tier argument: 'high' is in the 5.4 list, so it passed straight
    // through. This is exactly the v9.7.219 shape.
    const TIERS = { 'gpt-5.4-nano-2026-03-17': ['none', 'low', 'medium', 'high'] };
    const old = (m, w) => TIERS[m].indexOf(w) >= 0 ? w : 'low';
    return old('gpt-5.4-nano-2026-03-17', 'high');
  }, 'high');

pOne('the guard is in the shipped proxy, not just in this test',
  () => /ESCALATION "' \+ want \+ '" is primary-tier only/.test(proxySrc), true);

// ── (v7.64) THE 8/23 OUTAGE — the recovery ladder must actually be able to run ────
console.log('\ncache fields per tier — the bug that took the whole ladder down:');

pOne('THE INCIDENT: no non-breakpoint tier is handed prompt_cache_options',
  () => {
    // v7.61's else-branch set prompt_cache_options on exactly the tiers where cacheBreakpoints is
    // false — the two older models — and both returned
    //   400 "prompt_cache_options is not supported on this model"
    // So from v7.61 until v7.64 there was NO working recovery ladder, invisible because the
    // primary answers almost everything. Assert the else-branch now sends the legacy field.
    const m = proxySrc.match(/if \(spec\.cacheBreakpoints\) \{\s*payload\.prompt_cache_options[\s\S]{0,200}?\} else \{\s*payload\.(\w+)/);
    return m ? m[1] : '(no else-branch found)';
  }, 'prompt_cache_retention');

pOne('the classifier is gpt-4.1-nano and gets the field IT accepts',
  () => {
    const i = proxySrc.indexOf('CACHE_KEY_PREFIX}_classifier');
    const near = proxySrc.slice(i, i + 700);
    return { legacy: /prompt_cache_retention:/.test(near), fiveSix: /prompt_cache_options:/.test(near) };
  }, { legacy: true, fiveSix: false });

pOne('prompt_cache_options appears ONLY under a cacheBreakpoints guard',
  () => {
    // Shape test, not a count: every assignment of the 5.6-only field must be gated. This is the
    // check that would have caught v7.61 — a count would have looked fine.
    // COMMENTS STRIPPED FIRST. The first version of this scanned raw source and flagged its own
    // explanatory comment quoting the v7.61 line — the same self-matching error this suite has
    // made before. Only real code counts.
    const code = proxySrc.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    const bad = [];
    const re = /^[^\n]*payload\.prompt_cache_options\s*=/gm;
    let m;
    while ((m = re.exec(code))) {
      const before = code.slice(Math.max(0, m.index - 400), m.index);
      if (!/spec\.cacheBreakpoints|_bpApplied/.test(before)) bad.push(m[0].trim().slice(0, 60));
    }
    return bad;
  }, []);

pOne('only ONE tier carries cacheBreakpoints, so "gated" means Luna alone',
  () => (proxySrc.match(/cacheBreakpoints: true/g) || []).length, 1);

console.log('\nthe escalated primary budget:');

pOne('an escalated request gets a bigger primary slice than 12000ms',
  () => {
    const v = (proxySrc.match(/const ESCALATED_PRIMARY_TIMEOUT_MS = (\d+);/) || [])[1];
    return { ms: Number(v), biggerThanSpec: Number(v) > 12000 };
  }, { ms: 18000, biggerThanSpec: true });

// (v7.65) THIS ASSERTION SHIPPED THE OUTAGE. It used to match the line verbatim, INCLUDING the
// identifier `reasoningEffort` — a name that does not exist in the tier loop's scope. The regex
// confirmed the typo was present and went green while the worker threw a ReferenceError on every
// request. A regex proves a string is in a file; it cannot prove the file runs. The runtime
// behaviour now lives in worker-smoke.test.js, which loads the worker and calls its handler.
// What stays here is the SHAPE — primary-only, escalation-only — with the variable name left out
// deliberately, because pinning the name is what pinned the bug.
pOne('...and it applies to the PRIMARY tier only, and only on an escalation',
  () => {
    const m = proxySrc.match(/const _escalated = spec\.tier === 'primary' && isEscalation\((\w+)\);/);
    if (!m) return '(shape not found)';
    // The identifier must be one the tier loop actually declares — checked, not assumed.
    const loop = proxySrc.slice(proxySrc.indexOf('for (let i = 0; i < MODEL_CASCADE.length; i++)') - 4000,
                                proxySrc.indexOf('const _escalated'));
    return new RegExp('(const|let|var)\\s+' + m[1] + '\\s*=').test(loop)
      ? 'declared-in-scope' : 'UNDECLARED: ' + m[1];
  }, 'declared-in-scope');

pOne('the total budget is NOT raised — the trade is the emergency tier, deliberately',
  () => (proxySrc.match(/const TOTAL_BUDGET_MS\s*=\s*(\d+);/) || [])[1], '24000');

pOne('an escalated primary still leaves the fallback tier a usable window',
  () => {
    const total = 24000, esc = 18000, slack = 300;
    const left = total - esc;                 // what remains when the escalated primary times out
    return { remaining: left, admitsFallback: left >= 2500 + slack };
  }, { remaining: 6000, admitsFallback: true });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
