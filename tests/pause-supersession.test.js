#!/usr/bin/env node
'use strict';
// (v9.7.612) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('pause-supersession.test.js');

/**
 * pause-supersession.test.js — v9.7.612. A PAUSE IS A STATE, AND THE CUSTOMER CAN END IT.
 *
 * LIVE, 9/3. Pranav Patel, Community Honda Baytown, lead 2055655871, CRM engagement HIGH.
 *
 * 8/01 he wrote: "We are about to go on vacation, so I will contact you guys back in Aug 3rd week
 * for your inventory of CR-V." A correct pause, correctly detected — "will contact" is exactly
 * what this regex exists for.
 *
 * He then came back. 8/27 he reopened and negotiated an OTD sheet line by line. 8/28 he confirmed
 * an appointment, drove out, and found no car — "I have already drove all the way there and there
 * was No car to see or drive or make a deal on." And on 9/02 he sent the most actionable message on
 * the entire lead: "Elsa I am looking for 2026 white CRV Sport trim at 35k", then "OTD 35K".
 *
 * convState still resolved to `pause`, a month and eleven customer messages later, and the draft
 * told him: "I'll give you space." The log holds both facts on one line —
 *
 *   [LP PAUSE DIAG] call-note pause matched: "will contact"
 *   m.convState: pause | m.lastInboundMsg: "...OTD 35K"
 *
 * v9.7.412 scoped this detector to the CURRENT LEAD, which fixed cross-lead bleed. Within a lead it
 * was never bounded: the phrase matched anywhere in the in-scope history and nothing retired it.
 * The missing rule is the one the prompt already states for every other stated position — it stands
 * "unless they explicitly walked it back themselves", and replying at length about what you want to
 * buy is walking it back.
 *
 * Superseded BY DATE, never by position in a joined blob. Fails CLOSED in every ambiguous case.
 * Drives the SHIPPED detector. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: pause-supersession.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const stamp = src.match(/var _LP_LINE_STAMP_RE = [^\n]+/);
  if (!stamp) throw new Error('_LP_LINE_STAMP_RE not found');
  const a = src.indexOf('    var _pauseRx = ');
  if (a < 0) throw new Error('_pauseRx not found');
  const endMark = "' | still standing')); } catch(e) {} }";
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('pause diagnostic end not found — v9.7.612 supersession missing');
  return { name: path.basename(path.dirname(file)), src,
           code: stamp[0] + '\n' + src.slice(a, b + endMark.length) };
}

function decide(impl, recentHistory) {
  const logs = [];
  const sb = { String, RegExp, Date, Math, recentHistory,
               _lpD: (...x) => logs.push(x.join(' ')) };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return { paused: vm.runInContext('hasCallNotePause', sb),
           superseded: vm.runInContext('_pauseSuperseded', sb),
           logs };
}

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
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
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

// Pranav's real thread, in the transcript's own line shape.
const PAUSE_801  = '[08/01/2026 7:46 PM] [CUSTOMER]\n  No question now. We are about to go on vacation, so I will contact you guys back in Aug 3rd week for your inventory of CR-V.';
const REPLY_902  = '[09/02/2026 3:25 PM] [CUSTOMER]\n  Elsa I am looking for 2026 white CRV Sport trim at 35k.';
const AGENT_903  = '[09/03/2026 9:00 AM] [AGENT]\n  Checking on that for you.';

console.log('\nv9.7.612 — a pause the customer has ended is spent');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── PRANAV'S EXACT THREAD ───────────────────────────────────────────────────
console.log("Pranav Patel, 9/3 — the pause is a month old and he came back:");

check('the pause phrase still MATCHES — the detector is not being weakened',
  i => /call-note pause matched: "will contact"/.test(decide(i, [REPLY_902, PAUSE_801].join('\n')).logs.join(' ')), true);

check('...but it is SUPERSEDED by his 9/02 reply',
  i => decide(i, [REPLY_902, PAUSE_801].join('\n')).superseded, true);

check('...so convState does NOT come out pause',
  i => decide(i, [REPLY_902, PAUSE_801].join('\n')).paused, false);

check('the diagnostic names both dates and says it is spent',
  i => { const l = decide(i, [REPLY_902, PAUSE_801].join('\n')).logs.join(' ');
         return /SUPERSEDED/.test(l) && /8\/1\/2026/.test(l) && /9\/2\/2026/.test(l); }, true);

check('the order the entries appear in does not matter — it is decided by date',
  i => decide(i, [PAUSE_801, REPLY_902].join('\n')).superseded, true);

// ── A PAUSE THAT IS STILL LIVE MUST STAND ───────────────────────────────────
// The risk of this change is retiring a pause the customer never ended.
console.log('\na pause the customer has NOT ended still stands:');

check('pause with no customer reply after it → still paused',
  i => decide(i, [AGENT_903, PAUSE_801].join('\n')).paused, true);

check('an AGENT message after the pause does not end it — only the customer can',
  i => decide(i, [AGENT_903, PAUSE_801].join('\n')).superseded, false);

check('a customer reply BEFORE the pause does not end it',
  i => decide(i, [PAUSE_801, '[07/30/2026 6:09 PM] [CUSTOMER]\n  Yes, we are on our way.'].join('\n')).paused, true);

check('a same-day customer reply does not end it — supersession needs to be strictly later',
  i => decide(i, [PAUSE_801, '[08/01/2026 7:46 PM] [CUSTOMER]\n  ok'].join('\n')).paused, true);

check('no pause phrase at all is still no pause',
  i => decide(i, REPLY_902).paused, false);

// ── FAILS CLOSED ON ANYTHING AMBIGUOUS ──────────────────────────────────────
console.log('\nevery ambiguous case leaves the pause standing:');

check('an UNDATED pause line cannot be superseded',
  i => decide(i, [REPLY_902, '[CALL NOTE] customer said he will contact us later'].join('\n')).paused, true);

check('an UNDATED customer reply cannot supersede',
  i => decide(i, ['[CUSTOMER] I want the white one', PAUSE_801].join('\n')).paused, true);

check('a pause with no customer entries anywhere stands',
  i => decide(i, PAUSE_801).paused, true);

check('an unparseable date leaves it standing',
  i => decide(i, ['[99/99/9999] [CUSTOMER]\n  hello', PAUSE_801].join('\n')).paused, true);

check('empty history cannot throw',
  i => decide(i, '').paused, false);

// ── THE PHRASES v9.7.412 ADDED ARE UNTOUCHED ────────────────────────────────
// This build must not narrow what counts as a pause — only when it expires.
console.log('\nevery pause phrasing still fires when nothing supersedes it:');
for (const phrase of [
  'he will call back when he is ready',
  'she said she will reach out',
  'will get in touch when she is ready',
  'customer is still deciding on a couple of things',
  'he will let you know next week'
]) {
  check('  "' + phrase.slice(0, 34) + '…"',
    i => decide(i, '[08/01/2026 1:00 PM] [CALL NOTE]\n  ' + phrase).paused, true);
}

// ── (v9.7.687) A PROMISE WE MADE IS NOT A PAUSE THE CUSTOMER ASKED FOR ──────────────────────
// Kevin Washington (Community Toyota Baytown, lead 2086810111, 9/21). He asked "Is this the awd
// hybrid, cost?" at 9:35 AM and "Cost?" at 9:37. The automated assistant answered him with a
// handoff promise, and convState came out `pause` — so the prompt carried "PAUSE SIGNAL: customer
// needs more time. Empathetic check-in only." and the drafts went vague: "I'll give you some space
// for now", "Which vehicle would you like me to price?" Gil: "Seems like only the VM works."
//
// The phrase was OURS. "will reach out" sits in _pauseRx beside "will contact", "will get in
// touch", "will be in touch" and "will touch base" — every one of them a sentence a dealership
// writes TO a customer as a commitment. The scan had no speaker test, so our own promise to follow
// up about pricing read as the customer asking to be left alone.
console.log('\nv9.7.687 — the pause must come from an entry we did not send:');

const KEVIN_BOT_PROMISE =
  '[09/21/2026 9:37 AM] [CUSTOMER] Inbound Text Message\n  Cost?\n' +
  '[09/21/2026 9:37 AM] [AGENT] Outbound Text Message\n' +
  '  I’d be happy to connect you with our team for accurate pricing on that 2026 Camry SE hybrid.' +
  ' Someone will reach out to you shortly to help with pricing and answer any other questions you have!';

check('Kevin — our own bot promising a callback is NOT a pause',
  i => decide(i, KEVIN_BOT_PROMISE).paused, false);
check('  ...and the reason is the speaker, not the date — nothing here is superseded',
  i => decide(i, KEVIN_BOT_PROMISE).superseded, false);

// The detector must not be weakened: the SAME words in a note about the customer still pause.
check('the same phrase in a CALL NOTE still pauses',
  i => decide(i, '[09/21/2026 9:37 AM] [CALL NOTE] Outbound phone call\n  Customer will reach out when ready').paused, true);
check('...and in a general NOTE',
  i => decide(i, '[09/21/2026 9:37 AM] [NOTE]\n  Spoke with him, he will get in touch next week').paused, true);
// Written "I will" rather than "I'll" deliberately: _pauseRx matches the literal "will reach
// out", so the contraction does not match it at all. That is a pre-existing hole in the phrase
// list, unrelated to this build and not widened here — noted so the fixture is not mistaken for
// a claim that contractions are covered.
check('...and in the CUSTOMER\'s own words',
  i => decide(i, '[09/21/2026 9:37 AM] [CUSTOMER] Inbound Text Message\n  I will reach out when I am ready').paused, true);

// A real pause in a note must survive our own outbound carrying the same words elsewhere.
check('an AGENT promise does not bury a real pause recorded in a note',
  i => decide(i,
    '[09/21/2026 9:37 AM] [AGENT] Outbound Text Message\n  Someone will reach out to you shortly!\n' +
    '[09/20/2026 2:00 PM] [CALL NOTE] Outbound phone call\n  He said he will call back if interested').paused, true);

console.log('\n  the diagnostic says which entry it came from, and which scan ran:');
check('a scoped scan names the tag it matched inside',
  i => /\| from:\[CALL NOTE\]/.test(decide(i, '[09/21/2026 9:37 AM] [CALL NOTE] Outbound phone call\n  Customer will reach out when ready').logs.join(' ')), true);
check('...and says the scan was entry-scoped',
  i => /scan:entry-scoped, our own \[AGENT\] sends excluded/.test(decide(i, '[09/21/2026 9:37 AM] [CALL NOTE] x\n  he will call back').logs.join(' ')), true);

// FAILS OPEN on a shape that does not split into bracketed entries — today's behaviour, kept.
console.log('\n  an unexpected history shape degrades to the old behaviour, not to silence:');
check('a blob with no bracketed entries still matches as before',
  i => decide(i, 'customer said he will call back if interested').paused, true);
check('...and the diagnostic says the fallback ran',
  i => /scan:UNSCOPED fallback/.test(decide(i, 'customer said he will call back if interested').logs.join(' ')), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
