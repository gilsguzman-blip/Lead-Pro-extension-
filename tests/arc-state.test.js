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

// ── (v9.7.580) THE WIRING, NOT THE PIECES ────────────────────────────────────────────────
// Both halves of this feature worked in isolation from the day they shipped — log140 shows
// "[LP ARC STATE DIAG] ... rendered:3 fact(s)" — and the block STILL never reached a prompt,
// because the WIRING threw twice in a row:
//   v9.7.578  "m is not defined"                 — I referenced two fields that do not exist
//   v9.7.579  "Assignment to constant variable"  — userPrompt was `const` and this appends to it
// The second was invisible until the first was cleared. This suite passed 18/18 through both,
// because every assertion in it exercised _lpBuildArcState and _lpRenderArcState directly and
// nothing exercised the SITE THAT CALLS THEM. Same lesson as the v7.64 proxy crash and the v1.20
// reporter orphan: prove it RUNS, not that the parts exist.
console.log('\nthe wiring — the part that was broken while the pieces worked:');

check('the prompt binding the block appends to is MUTABLE',
  i => {
    const at = i.src.indexOf('userPrompt += _arcBlock');
    if (at < 0) return 'append site not found';
    // Walk back to the declaration that governs it.
    const decl = i.src.lastIndexOf('userPrompt = buildUserPrompt({', at);
    if (decl < 0) return 'declaration not found';
    const kw = i.src.slice(Math.max(0, decl - 12), decl).trim().split(/\s+/).pop();
    return kw;
  }, 'let');

check('...and the OTHER userPrompt (voicemail) is untouched — it is appended to by nothing',
  i => {
    const vm2 = i.src.indexOf('userPrompt = buildUserPrompt(_vmPromptData)');
    const kw = i.src.slice(Math.max(0, vm2 - 12), vm2).trim().split(/\s+/).pop();
    return kw;
  }, 'const');

check('the append is guarded so an empty block never appends a bare header',
  i => /if \(_arcBlock\) userPrompt \+= _arcBlock;/.test(i.code), true);

// (v9.7.586) THIS ASSERTION PINNED THE BUG AS CORRECT. It required the call site to read
// `lastScrapedData.consecutiveOutboundNoReply` — and that field, like lastInboundAgeDays beside it,
// lives on data.relationshipSignals and is NEVER set on the merged scrape. So the assertion
// confirmed the wiring was reading two fields that are always undefined, and stayed green for eight
// builds while the block asserted "never replied" on every lead. v9.7.578 invented two field names;
// the fix for that reached for two more that exist elsewhere. Reading a REAL name off the WRONG
// OBJECT is the same defect wearing better clothes, and a source scan cannot tell them apart —
// which is why the behavioural assertions below (unknown vs known-zero) are the ones that matter.
check('the wiring reads fields off the object that actually carries them',
  i => ({
    invented:  /m\.inboundCount|m\.outboundCount/.test(i.code),
    wrongObj:  /lastScrapedData\.(?:consecutiveOutboundNoReply|lastInboundAgeDays)/.test(i.code),
    rightObj:  /relationshipSignals/.test(i.code) && /_arcSig\.consecutiveOutboundNoReply/.test(i.code)
  }), { invented: false, wrongObj: false, rightObj: true });

console.log('\ncontainment:');

check('the arc code sits OUTSIDE inlineScraper — the v9.7.455/228 scope trap',
  i => {
    const a = i.src.indexOf('\nfunction _lpBuildArcState');
    const b = i.src.search(/\n\s*function inlineScraper/);
    return a > 0 && b > 0 && a < b;
  }, true);

check('the block is appended in exactly one place',
  i => (i.code.match(/WHERE THIS RELATIONSHIP ACTUALLY STANDS/g) || []).length, 1);


// ── (v9.7.586) "NEVER REPLIED" WAS ASSERTED ON EVERY LEAD, INCLUDING ONES THAT HAD REPLIED ──
// Keisha Burgess (lead 2074168344, 8/27) sent 10 inbound messages. The SAME prompt carried
// "Customer replied today. Total exchange: 10 inbound / 8 outbound" from the relationship reading,
// and "The customer has never replied to anything on this lead." from this block, 150 lines apart.
//
// TWO CAUSES, and the first is why it went unnoticed for eight builds. The call site read
// lastScrapedData.lastInboundAgeDays; that field lives on data.relationshipSignals and is NEVER set
// on the merged scrape, so daysSinceReply was null on EVERY generation since v9.7.578. The line then
// fired on `since === null` alone — turning an unavailable field into a positive claim about the
// customer. Andrea Pardon's prompt carried the same false line the day before and nobody caught it,
// because for her it happened to be true.
//
// NULL IS UNKNOWN. The claim now needs positive evidence: a known inbound count of zero.
console.log('\nunknown is not "never" — the line needs evidence, not an absent field:');

const _lines = (i, o) => ((i.build({}, o) || {}).lines || []).join('\n');
const _never = /never replied to anything on this lead/;

check('a lead with a KNOWN zero inbound count still says it — the true case is preserved',
  i => _never.test(_lines(i, { daysSinceReply: null, totalInbound: 0 })), true);

check('a lead whose inbound count is UNKNOWN says nothing at all',
  i => _never.test(_lines(i, { daysSinceReply: null })), false);

check('...and Keisha\'s shape — replied today, 10 inbound — never says it',
  i => _never.test(_lines(i, { daysSinceReply: 0, totalInbound: 10 })), false);

check('a genuinely dormant lead that HAS replied does not say it either',
  i => _never.test(_lines(i, { daysSinceReply: 45, totalInbound: 3 })), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
