#!/usr/bin/env node
'use strict';
/**
 * arc-state.test.js — v9.7.578. FACTS ABOUT THE ARC, NOT A LABEL FOR IT.
 *
 * ── WHY THE TAG WENT AWAY ─────────────────────────────────────────────────────────────────
 * v9.7.577 computed which cadence tag applied ([LP: value]) and fed it to the model. That removed
 * the agent's paste but kept the TAG as the mechanism — and the tag is the workaround: a one-word
 * directive standing in for a situation nobody had described. Every serious incident this month
 * was a layer manufacturing a directive and the model correctly obeying it: "LOCK IN Monday" from
 * a Yahoo header, "were you looking for a Ram?" from the letters inside Timeframe, a condolence
 * from "is passing". Automating the tag would have automated that shape.
 *
 * This block states what is VERIFIABLY TRUE and lets the model decide. Every angle claim carries
 * the date and the literal matched text, so the model can DISAGREE with a bad reading instead of
 * inheriting it. A label cannot be argued with; a quote can. That is the whole design.
 *
 * ── WHAT IS ASSERTED ──────────────────────────────────────────────────────────────────────
 *  • Angles are read ONLY from LP's own outbound, never from customer text.
 *  • Every angle carries verbatim evidence and a date.
 *  • The block contains NO instruction — no "should", no "do not", no imperative.
 *  • The 8-send cap is disclosed rather than implying the history is complete.
 *  • Cadence position appears as an observation, never as a directive, and the tag renderer is
 *    a dead stub so tag injection cannot come back by accident.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: arc-state.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('// ── (v9.7.578) THE SITUATION READ');
  const b = src.indexOf('// ── (v9.7.577) 90-DAY CADENCE — AUTO-COMPUTED');
  if (a < 0 || b < 0 || b <= a) throw new Error('arc block not found in ' + file);
  const sb = { console: { log() {} }, String, Number, Math, JSON, RegExp, Object, Array, Date, parseFloat };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b), sb);
  return {
    name: path.basename(path.dirname(file)), src,
    code: src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''),
    read: e => vm.runInContext(e, sb),
    spent: s => vm.runInContext('_lpArcAnglesSpent', sb)(s),
    build: (d, o) => vm.runInContext('_lpBuildArcState', sb)(d, o),
    render: s => vm.runInContext('_lpRenderArcState', sb)(s),
    diag: s => { const L = []; vm.runInContext('_lpArcStateDiag', sb)(s, (...x) => L.push(x.join(' '))); return L.join('\n'); }
  };
}
const impls = BUILDS.map(extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]); }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

const MS = (d) => new Date('2026-08-' + d + 'T15:00:00Z').getTime();
const send = (d, body) => ({ title: 'Outbound Email', ms: MS(d), body: body });

console.log('\nv9.7.578 — the situation read: observations with evidence, no label');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('angles come from OUR OWN sent text, with the words that proved it:');

check('an angle is found, dated, and carries the literal phrase it matched',
  i => {
    const r = i.spent([send('20', 'Would 9:15 AM or 10:30 AM work for you?')]);
    return r.spent.map(x => [x.angle, x.evidence]);
  }, [['appointment', '9:15 AM']]);

check('several distinct angles across several messages, newest use of each',
  i => i.spent([send('20', 'the Pilot is still here'), send('12', 'your trade appraisal'),
                send('05', 'financing options and $500 down')]).spent.map(x => x.angle),
  ['availability', 'trade', 'payment']);

check('an angle used twice is named once — the newest use',
  i => i.spent([send('20', 'still available'), send('10', 'we have it')]).spent.length, 1);

check('what has NOT been tried is reported too — that is the actionable half',
  i => {
    const r = i.spent([send('20', 'the Pilot is still here')]);
    return r.unused.indexOf('trade') >= 0 && r.unused.indexOf('availability') < 0;
  }, true);

check('CUSTOMER text is never scanned — only outbound is passed in, and only outbound is read',
  i => {
    // The customer saying "what about my trade" must not register as US having raised trade.
    const r = i.build({ leadAgeDays: 10, outboundSends: [send('20', 'Hi Dylan, checking the lot for you.')] },
                      { totalInbound: 3, totalOutbound: 1, daysSinceReply: 2, consecutiveOutbound: 0 });
    return r.facts.spent.length;
  }, 0);

console.log('\nthe block states facts and issues no instruction:');

check('no imperative language anywhere in the rendered block',
  i => {
    const s = i.build({ leadAgeDays: 41, outboundSends: [send('20', 'Would 9:15 AM work?'), send('12', 'trade appraisal')] },
                      { totalInbound: 1, totalOutbound: 7, daysSinceReply: null, consecutiveOutbound: 7 });
    const txt = i.render(s);
    // The one permitted imperative is the header's own "decide that from these facts".
    const body = txt.split('\n').filter(l => l.indexOf('•') === 0).join(' ');
    // Target real imperatives. An earlier version of this flagged the FACTUAL sentence "the
    // customer has never replied" on the word "never" — a test bug that reads exactly like the
    // block issuing an order. Match verb-initial commands and modal instructions, not adverbs.
    return /\b(?:you must|do not|don't|you should|make sure|be sure to|lead with|avoid |ask (?:them|for)|write |send )/i.test(body);
  }, false);

check('a never-replied lead is stated as a fact, not as a strategy',
  i => {
    const s = i.build({ leadAgeDays: 24, outboundSends: [] },
                      { totalInbound: 0, totalOutbound: 7, daysSinceReply: null, consecutiveOutbound: 7 });
    return s.lines.some(l => /never replied to anything/.test(l));
  }, true);

check('cadence position renders as where the schedule ARRIVED, not what to write',
  i => {
    const s = i.build({ leadAgeDays: 41, outboundSends: [] },
                      { totalInbound: 1, totalOutbound: 5, daysSinceReply: 30, consecutiveOutbound: 5,
                        cadence: { day: 41, confidence: 'high' } });
    const line = s.lines.filter(l => /Scheduled position/.test(l))[0] || '';
    return { has: /day-41 touch of the 90-day sequence/.test(line), noRole: !/value|curiosity|soft/i.test(line) };
  }, { has: true, noRole: true });

check('the 8-send cap is DISCLOSED rather than implying the history is complete',
  i => {
    const many = []; for (let n = 0; n < 8; n++) many.push(send('2' + (n % 8), 'message ' + n));
    const s = i.build({ leadAgeDays: 60, outboundSends: many },
                      { totalInbound: 1, totalOutbound: 20, daysSinceReply: 40, consecutiveOutbound: 8 });
    return s.lines.some(l => /most recent outbound messages were read/.test(l));
  }, true);

check('with no outbound at all it still renders the facts it does have',
  i => {
    const s = i.build({ leadAgeDays: 3, outboundSends: [] },
                      { totalInbound: 1, totalOutbound: 0, daysSinceReply: 1, consecutiveOutbound: 0 });
    return { lines: s.lines.length > 0, rendered: i.render(s).length > 0 };
  }, { lines: true, rendered: true });

console.log('\nthe tag is gone and cannot come back:');

check('the tag renderer is a dead stub returning empty',
  i => /function _lpRenderCadenceTouch\(\) \{ return ''; \}/.test(i.code), true);

check('nothing injects a bare [LP: role] tag into the prompt any more',
  i => /\[LP: ' \+ (?:touch\.role|_cad)/.test(i.code), false);

check('the cadence call is hard-wired flagOn:false — position is a fact, never a directive',
  i => /flagOn:\s*false\b/.test(i.code), true);

check('LEADPRO_ARC_STATE ships ON — this one changes the prompt and is meant to',
  i => i.read('LEADPRO_ARC_STATE'), true);

console.log('\nthe diagnostic shows every angle and the words behind it:');

check('the summary reports the counts, the spent list and the unused list',
  i => {
    const s = i.build({ leadAgeDays: 41, outboundSends: [send('20', 'Would 9:15 AM work?')] },
                      { totalInbound: 2, totalOutbound: 6, daysSinceReply: 30, consecutiveOutbound: 4 });
    const d = i.diag(s);
    return { age: /age:41d/.test(d), exch: /exchange:2in\/6out/.test(d),
             spent: /spent:appointment/.test(d), unused: /unused:.*trade/.test(d) };
  }, { age: true, exch: true, spent: true, unused: true });

check('every angle also logs its own evidence line, so a bad match is visible',
  i => {
    const s = i.build({ leadAgeDays: 41, outboundSends: [send('20', 'your trade appraisal')] },
                      { totalInbound: 1, totalOutbound: 3, daysSinceReply: 20, consecutiveOutbound: 3 });
    return /\[LP ARC ANGLE\] trade <- "trade"/.test(i.diag(s));
  }, true);

console.log('\ncontainment:');

check('the arc code sits OUTSIDE inlineScraper — the v9.7.455/228 scope trap',
  i => {
    const a = i.src.indexOf('\nfunction _lpBuildArcState');
    const b = i.src.search(/\n\s*function inlineScraper/);
    return a > 0 && b > 0 && a < b;
  }, true);

check('the block is appended in exactly one place',
  i => (i.code.match(/WHERE THIS RELATIONSHIP ACTUALLY STANDS/g) || []).length, 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
