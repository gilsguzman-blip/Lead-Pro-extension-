#!/usr/bin/env node
'use strict';
// (v9.7.613) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('color-ask.test.js');

/**
 * color-ask.test.js — v9.7.613. THE COLOUR THE CUSTOMER ASKED FOR MUST BEAT THE ONE ON THE LEAD.
 *
 * LIVE, 9/3. Pranav Patel, Community Honda Baytown, lead 2055655871. The VOI panel carries a 2026
 * CR-V Hybrid Sport in METEORITE GRAY, stock TE026441, and the CRM itself flags it "no longer in
 * your active inventory". On 9/02 he wrote "Elsa I am looking for 2026 white CRV Sport trim at 35k"
 * and then "OTD 35K". The prompt carried both facts, pulling opposite ways:
 *
 *   Vehicle:  2026 Honda CR-V Hybrid Sport ← THIS IS THE VEHICLE FOR THIS LEAD.
 *             Do not substitute or reference other vehicles from the conversation history.
 *   Color:    Meteorite Gray Metallic
 *   COLOR PREFERENCE: Customer mentioned white. Match this in your message or acknowledge
 *             availability honestly.
 *
 * The VOI side asserts a colour as fact and forbids substitution; the customer's side was a soft
 * "match or acknowledge". The draft stayed anchored to the dead grey unit and backed away.
 *
 * TWO DEFECTS IN THE OLD DETECTOR, both covered here:
 *   (1) it scanned the WHOLE transcript, agent messages included, so it could report a colour WE
 *       said — on this very lead our own "we currently only have the 2026 CR-V EX in black" sits
 *       in that blob;
 *   (2) it took the FIRST match in a joined blob, which is oldest or newest depending on an
 *       ordering nothing guarantees.
 *
 * The colour LIST is unchanged character for character. This changes whose colour is read and which
 * mention wins, never what counts as a colour — asserted at the end.
 *
 * Executes the SHIPPED detector. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: color-ask.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('      var _lpColorRx = ');
  if (a < 0) throw new Error('_lpColorRx not found — v9.7.613 detector missing');
  const endMark = "acknowledge availability honestly.');\n      }";
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('colour directive end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + endMark.length) };
}

function run(impl, lines, voiColor) {
  const logs = [];
  const sb = {
    String, Date, Array, RegExp,
    concernScanLines: lines,
    // The slice necessarily includes two neighbours — the trim detector (reads allTranscriptText)
    // and, from v9.7.614, the friction directive (reads _fricQuote/_fricState). Both are supplied
    // inert so the colour code under test runs; neither is what this suite asserts on. Supplying
    // them beats narrowing the slice, which would stop the extracted region matching the shipped
    // file — the property that makes these suites worth anything.
    allTranscriptText: lines.join(' '),
    _fricQuote: '', _fricState: '',
    customerConcerns: [],
    color: voiColor,
    _lpD: (...x) => logs.push(x.join(' '))
  };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return { concerns: vm.runInContext('customerConcerns', sb), logs,
           stated: vm.runInContext('_statedColor', sb),
           mismatch: vm.runInContext('_colorMismatch', sb) };
}
const joined = r => r.concerns.join('\n');

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

// Pranav's real lines, in the transcript's own shape.
const AGENT_BLACK = '[07/22/2026 10:00 AM] [AGENT] Hi, Pranav, we currently only have the 2026 CR-V EX in black.';
const CUST_GREY   = '[07/28/2026 5:37 PM] [CUSTOMER] Is this the price for CR-V Sport Urban Pearl grey??';
const CUST_WHITE  = '[09/02/2026 3:25 PM] [CUSTOMER] Elsa I am looking for 2026 white CRV Sport trim at 35k.';
const VOI_GREY    = 'Meteorite Gray Metallic';

console.log('\nv9.7.613 — the customer\'s colour drives the message');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── PRANAV'S EXACT CASE ─────────────────────────────────────────────────────
console.log("Pranav Patel, 9/3 — he asked for white, the lead carries grey:");

const PRANAV = [AGENT_BLACK, CUST_GREY, CUST_WHITE];

check('the stated colour is WHITE — his latest, not our black and not his older grey',
  i => run(i, PRANAV, VOI_GREY).stated.toLowerCase(), 'white');

check('...and it is recognised as a mismatch against the VOI',
  i => run(i, PRANAV, VOI_GREY).mismatch, true);

check('the directive tells the model to build around the white one',
  i => /Build this message around the white one they actually want/.test(joined(run(i, PRANAV, VOI_GREY))), true);

check('...names the grey unit as the ORIGINAL, not the target',
  i => /Meteorite Gray Metallic, which is the unit they ORIGINALLY inquired about/
        .test(joined(run(i, PRANAV, VOI_GREY))), true);

check('...explicitly releases the "do not substitute" rule for a colour change',
  i => /COLOUR change on the SAME model, not a different vehicle/.test(joined(run(i, PRANAV, VOI_GREY))), true);

check('...forbids falling back to the grey unit as the offer',
  i => /never fall back to the Meteorite Gray Metallic unit as the offer/
        .test(joined(run(i, PRANAV, VOI_GREY))), true);

check('...and forbids letting the dead unit end the conversation',
  i => /do NOT let its status end the conversation/.test(joined(run(i, PRANAV, VOI_GREY))), true);

check('the soft "match or acknowledge" wording is NOT emitted on a mismatch',
  i => /Match this in your message or acknowledge availability honestly/
        .test(joined(run(i, PRANAV, VOI_GREY))), false);

check('the diagnostic reports both colours and the verdict',
  i => { const l = run(i, PRANAV, VOI_GREY).logs.join(' ');
         return /customerStated:white/.test(l) && /voiColor:Meteorite Gray Metallic/.test(l)
             && /mismatch:true/.test(l); }, true);

// ── DEFECT 1: OUR OWN WORDS ARE NOT THE CUSTOMER'S ASK ──────────────────────
console.log('\na colour WE said is never reported as the customer\'s ask:');

check('an agent-only mention yields no stated colour',
  i => run(i, [AGENT_BLACK], VOI_GREY).stated, '');
check('...and no colour concern at all',
  i => run(i, [AGENT_BLACK], VOI_GREY).concerns.length, 0);
check('the customer\'s colour wins even when an agent named a different one later',
  i => run(i, [CUST_WHITE, '[09/03/2026 9:00 AM] [AGENT] we have a red one'], VOI_GREY).stated.toLowerCase(), 'white');

// ── DEFECT 2: THE LATEST MENTION WINS, BY DATE ──────────────────────────────
console.log('\nthe latest customer mention wins, whatever order the lines arrive in:');

check('newest-first input picks white',
  i => run(i, [CUST_WHITE, CUST_GREY], VOI_GREY).stated.toLowerCase(), 'white');
check('oldest-first input picks white too',
  i => run(i, [CUST_GREY, CUST_WHITE], VOI_GREY).stated.toLowerCase(), 'white');
check('an undated customer line loses to a dated one',
  i => run(i, ['[CUSTOMER] I like red', CUST_WHITE], VOI_GREY).stated.toLowerCase(), 'white');

// ── THE MATCHING CASE MUST NOT BE ESCALATED ─────────────────────────────────
// The risk here is shouting at the model on a lead where nothing is wrong.
console.log('\nwhen the colours agree, nothing changes:');

check('a customer asking for grey on a grey lead is NOT a mismatch',
  i => run(i, ['[09/02/2026 1:00 PM] [CUSTOMER] still want the gray one'], VOI_GREY).mismatch, false);
check('...and gets the plain preference line, unchanged',
  i => /COLOR PREFERENCE: Customer mentioned gray\. Match this in your message or acknowledge availability honestly\./
        .test(joined(run(i, ['[09/02/2026 1:00 PM] [CUSTOMER] still want the gray one'], VOI_GREY))), true);
check('a lead with NO VOI colour cannot mismatch',
  i => run(i, [CUST_WHITE], '').mismatch, false);
check('...and still gets the plain preference line',
  i => /COLOR PREFERENCE: Customer mentioned white/.test(joined(run(i, [CUST_WHITE], ''))), true);

// ── ROBUSTNESS ──────────────────────────────────────────────────────────────
console.log('\nthe absent cases:');
check('no customer lines at all', i => run(i, [], VOI_GREY).concerns.length, 0);
check('a customer line with no colour', i => run(i, ['[09/02/2026] [CUSTOMER] what is the price'], VOI_GREY).stated, '');
check('an unparseable date cannot throw', i => run(i, ['[99/99/9999] [CUSTOMER] white please'], VOI_GREY).stated.toLowerCase(), 'white');
check('a non-string VOI colour is handled', i => run(i, [CUST_WHITE], undefined).mismatch, false);

// ── THE COLOUR LIST IS UNCHANGED ────────────────────────────────────────────
console.log('\nwhat counts as a colour is unchanged — only whose, and which one:');
for (const c of ['white','black','silver','gray','grey','blue','red','green','brown','beige','pearl','platinum']) {
  check('  "' + c + '" is still detected',
    i => run(i, ['[09/02/2026 1:00 PM] [CUSTOMER] I want ' + c], 'Nonesuch').stated.toLowerCase(), c);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
