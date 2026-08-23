#!/usr/bin/env node
'use strict';
/**
 * regen-effort.test.js — v9.7.573 + proxy v7.63. REGEN ESCALATES THE DRAFT'S REASONING EFFORT.
 *
 * ── WHY A REGEN IS THE RIGHT TRIGGER, AND A DIFFICULTY SCORE IS NOT ───────────────────────
 * A regen is not an inference about difficulty. It is direct evidence: a human read the draft and
 * judged the first reading wrong. It is the only signal on this surface that is a human decision
 * rather than a heuristic — which is why it ships, and why a flag-count "lead difficulty score"
 * does not. That would be a heuristic standing in for judgment upstream of the model, the same
 * shape as every manufactured-directive bug this month, and its failures would be INVISIBLE:
 * an under-reasoned hard lead produces a slightly worse draft that an agent edits and sends,
 * which the feedback pipeline records as a success.
 *
 * ── THE HISTORY THIS SUITE EXISTS TO PREVENT REPEATING ────────────────────────────────────
 * v9.7.219 removed a complexity reasoning router:
 *
 *   "Live logs showed medium reasoning blew through the entire cascade — PRIMARY timing out at
 *    10000ms, FALLBACK also timing out, leads landing on SAFE_FALLBACK after 23s."
 *
 * So 'medium' is not an untried middle rung. It has been run on this exact task and it exhausted
 * all three tiers. But the root cause was not that medium is too slow for the primary tier — it
 * was that the elevated effort applied to EVERY tier, so the recovery tiers were reasoning hard
 * too and could not cover the hole the primary left.
 *
 * Proxy v7.63 makes that structurally unreachable: an effort ABOVE the baseline is primary-tier
 * only. A regen gets one high-effort attempt on the full primary budget; if it times out the
 * fallback answers at 'low' and the agent gets a real draft. A slow escalation now costs latency,
 * never a SAFE_FALLBACK. THAT is what this suite pins.
 *
 * An effort AT OR BELOW the baseline — the probes' 'none' — must still apply to every tier,
 * because it makes the recovery tiers faster rather than slower. Asserted separately.
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

const impls = BUILDS.map(f => ({ name: path.basename(path.dirname(f)), src: fs.readFileSync(f, 'utf8') }));

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

console.log('\nv9.7.573 + v7.63 — a regen thinks harder, and only the primary tier does');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── The extension side ────────────────────────────────────────────────────────
console.log('the extension: the trigger is a human decision, not a guess');

check('the escalation ships ON, at "high"', i => ({
  on:    /var LEADPRO_REGEN_ESCALATE = true;/.test(i.src),
  level: (i.src.match(/var LEADPRO_REGEN_EFFORT\s*=\s*'([a-z]+)'/) || [])[1]
}), { on: true, level: 'high' });

check('it is gated on _isRegenSession — the human signal, nothing else',
  i => /if \(LEADPRO_REGEN_ESCALATE && _isRegenSession\) \{/.test(i.src), true);

check('the effort lands INSIDE the draft payload\'s generationConfig',
  i => /payload\.generationConfig\.reasoningEffort = LEADPRO_REGEN_EFFORT;/.test(i.src), true);

check('a NON-regen sends no effort field at all — the baseline path is untouched',
  i => {
    // The only assignment of reasoningEffort onto the draft payload must be inside the regen gate.
    const gate = i.src.indexOf('if (LEADPRO_REGEN_ESCALATE && _isRegenSession) {');
    const asg  = i.src.indexOf('payload.generationConfig.reasoningEffort');
    return { inside: asg > gate, only: (i.src.match(/payload\.generationConfig\.reasoningEffort/g) || []).length };
  }, { inside: true, only: 1 });

check('the escalation is logged every time it happens',
  i => /\[LP REGEN EFFORT\] regen detected — draft asks for reasoningEffort:/.test(i.src), true);

check('...and a regen with the switch OFF says so rather than going silent',
  i => /regen detected but LEADPRO_REGEN_ESCALATE is OFF/.test(i.src), true);

check('the probes are NOT touched — they still ask for none',
  i => (i.src.match(/reasoningEffort: 'none'/g) || []).length, 2);

// ── The proxy side: the v9.7.219 guard ────────────────────────────────────────
console.log('\nthe proxy: an escalation reaches the primary tier and NO other');

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

pOne('...and it applies to the PRIMARY tier only, and only on an escalation',
  () => /const _escalated = spec\.tier === 'primary' && isEscalation\(reasoningEffort\);/.test(proxySrc), true);

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
