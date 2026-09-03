#!/usr/bin/env node
'use strict';
// (v9.7.615) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('concern-scope.test.js');

/**
 * concern-scope.test.js — v9.7.615. TWO CONCERNS THAT FIRED ON TEXT THE CUSTOMER NEVER MEANT.
 *
 * Both live on Pranav Patel, Community Honda Baytown, lead 2055655871 — the same lead that produced
 * v9.7.612, .613 and .614, and the same failure shape every one of them fixed: a detector matching
 * words in a blob without asking whether the words are current, or the customer's own.
 *
 * TIMING HESITATION told the model "Customer indicated they are not ready yet." on a man who was
 * actively negotiating. THE TRIGGER WAS OUR OWN SENTENCE. Searching the shipped prompt for every
 * match of the timing pattern finds exactly three, and not one is a customer hesitation:
 *
 *   AGENT           "next month"  ::  "We're expecting one in the river blue next month"
 *   SCAFFOLD        "not ready"   ::  "If they are not ready — respect it. Leave the door open."
 *   SCAFFOLD        "after the"   ::  a rule in the prompt's own time-context block
 *
 * Elsa telling him a river-blue car arrives next month became "the customer is not ready".
 *
 * A CORRECTION TO MY OWN EARLIER REPORT, recorded rather than quietly dropped: I attributed this to
 * his month-stale 8/01 vacation note. That note does not match the pattern at all — it says "I will
 * contact you guys back in Aug 3rd week", and the regex has no "contact back" shape. The defect is
 * the customer-authored half, not the recency half. The recency rule below is still correct and
 * still ships, but it is not what was wrong on this lead.
 *
 * TRADE-IN CONCERN fired on a lead whose Trade-in Info reads "(none entered)", and told the model
 * "This is THE hook -- lead with it in BOTH the SMS and email." It matched "Community
 * Trade-In-Assistance+ -$500.00" — a LINE ITEM in the dealership's own OTD sheet, which Elsa sent
 * him on 7/28 and he pasted back on 8/27 while negotiating. Our own words, returned to us, read as
 * his statement about a car he does not own.
 *
 * THE FIXES, matching v9.7.613/614 rather than inventing new methods:
 *   TIMING — the v9.7.612 supersession rule. A hesitation the customer has spoken past is spent.
 *            Fails closed the same way: an undated hesitation cannot be proven stale and still fires.
 *   TRADE  — customer-authored only (routed through the EXISTING _lpCustomerAuthoredPart tapback /
 *            quoted-reply guard, not a third copy of it), plus a FIRST-PERSON requirement. Someone
 *            talking about their own trade always uses one; a price sheet, a rebate footer and a
 *            fee table never do. Grammar, not a blocklist of document phrases, because the next
 *            pasted document will not be a price sheet.
 *
 * The risk in both is over-suppression, so the true-fire case for each is asserted alongside.
 * Executes the SHIPPED detectors. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: concern-scope.test.js <popup.js> [popup.js...]'); process.exit(2); }

function slice(src, a, b, what) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(what + ' start not found');
  const j = src.indexOf(b, i);
  if (j < 0) throw new Error(what + ' end not found');
  return src.slice(i, j + b.length);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  // The shared helper plus the timing detector.
  const timing = slice(src, '      function _lpCustomerSaid() {',
                            "not a pressure tactic.');\n      }", 'timing block');
  // The trade detector, lifted separately — it lives ~170 lines further down.
  // The directive ends with an example opener, not with the check-in sentence — an earlier version
  // of this marker did not exist in the file, indexOf returned -1, and the slice ran to end-of-file
  // and swallowed half the build. The extractor's own guard is what turned that into 24 named
  // failures instead of silence.
  const trade  = slice(src, '      var _tradeRx  = ',
                            'just need to confirm before I send."\');\n      }', 'trade block');
  return { name: path.basename(path.dirname(file)), src, code: timing + '\n' + trade };
}

function run(impl, lines) {
  const logs = [];
  const sb = {
    String, Date, Array, RegExp,
    concernScanLines: lines,
    customerConcerns: [],
    // The real tapback / quoted-reply guard is defined far outside this slice. Supplied with the
    // shape the shipped helper expects — text plus cut metadata — and made to actually strip a
    // tapback, so the echo case is exercised rather than assumed away.
    _lpCustomerAuthoredPart: (raw) => {
      const m = String(raw).match(/\b(?:Loved|Liked|Laughed at|Emphasized|Questioned|thumbs-up to|👍 to)\s+[“"]/i);
      return m ? { text: String(raw).slice(0, m.index), cutBy: 'tapback', cutAt: m.index }
               : { text: String(raw), cutBy: '', cutAt: -1 };
    },
    _lpD: (...x) => logs.push(x.join(' '))
  };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return { concerns: vm.runInContext('customerConcerns', sb), logs };
}
const has = (r, re) => r.concerns.some(c => re.test(c));

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

const TIMING_RE = /TIMING HESITATION/;
const TRADE_RE  = /TRADE-IN CONCERN/;

// Pranav's real lines.
const VACATION = '[08/01/2026 7:46 PM] [CUSTOMER] No question now. We are about to go on vacation, so I will contact you guys back in Aug 3rd week for your inventory of CR-V.';
const WHITE    = '[09/02/2026 3:25 PM] [CUSTOMER] Elsa I am looking for 2026 white CRV Sport trim at 35k.';
// The line that actually fired TIMING HESITATION on his lead — Elsa's, not his.
const AGENT_NEXTMONTH = "[07/28/2026 5:37 PM] [AGENT] We're expecting one in the river blue next month";
// The OTD sheet he pasted back on 8/27, trimmed to the line that matched. No first-person anywhere.
const SHEET    = '[08/27/2026 6:27 PM] [CUSTOMER] MSRP 37,535 Price Discount -$3,800.00 Community Value Price $31,985.00 Sales & VIT Tax $2,154.17 Community Repeat Customer^ -$250.00 Community Trade-In-Assistance+ -$500.00 Drive Out with all Incentives $35,142.17';
// The 7/28 version, sent back as an iMessage tapback on our own outbound.
const TAPBACK  = '[07/28/2026 6:18 PM] [CUSTOMER] Received from: (727) 244-3456\n  👍 to “MSRP 37,535 Community Trade-In-Assistance+ -$500.00 Drive Out with all Incentives $35,142.17”';

console.log('\nv9.7.615 — a concern must be current, and must be the customer\'s own');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── TIMING: PRANAV'S FALSE FIRE — OUR OWN SENTENCE ──────────────────────────
console.log('TIMING HESITATION — the trigger was our own message, not his:');

check('an AGENT saying "next month" is NOT a customer hesitation',
  i => has(run(i, [AGENT_NEXTMONTH]), TIMING_RE), false);

check('...not even alongside his real messages',
  i => has(run(i, [AGENT_NEXTMONTH, VACATION, WHITE]), TIMING_RE), false);

check('and his vacation note never matched the pattern anyway — it says "contact back", not "check back"',
  i => has(run(i, [VACATION]), TIMING_RE), false);

// ── TIMING: THE RECENCY RULE, ON A HESITATION THAT REALLY IS ONE ─────────────
console.log('\na real hesitation is still read, and still expires when they speak past it:');

const HESITATE = '[08/01/2026 7:46 PM] [CUSTOMER] I am not ready right now, check back next month';

check('a genuine customer hesitation fires',
  i => has(run(i, [HESITATE]), TIMING_RE), true);

check('...and is SUPERSEDED once he comes back with a concrete ask',
  i => has(run(i, [HESITATE, WHITE]), TIMING_RE), false);

check('the diagnostic says why, with both dates',
  i => { const l = run(i, [HESITATE, WHITE]).logs.join(' ');
         return /STALE/.test(l) && /8\/1\/2026/.test(l) && /9\/2\/2026/.test(l); }, true);

check('the order the lines arrive in does not change it',
  i => has(run(i, [WHITE, HESITATE]), TIMING_RE), false);

check('a hesitation as their LATEST message still fires',
  i => has(run(i, [WHITE, '[09/03/2026 9:00 AM] [CUSTOMER] not ready right now, check back next month']), TIMING_RE), true);

check('an AGENT message after it does not make it stale — only the customer can',
  i => has(run(i, [HESITATE, '[09/02/2026 1:00 PM] [AGENT] just checking in']), TIMING_RE), true);

check('an UNDATED hesitation cannot be proven stale and still fires',
  i => has(run(i, ['[CUSTOMER] I am not ready right now', WHITE]), TIMING_RE), true);

// ── TRADE: PRANAV'S FALSE FIRE ──────────────────────────────────────────────
console.log('\nTRADE-IN CONCERN — the match is a line item in a sheet he pasted back:');

check('the pasted OTD sheet does NOT fire it',
  i => has(run(i, [SHEET]), TRADE_RE), false);

check('the diagnostic names the reason',
  i => /no first-person reference/.test(run(i, [SHEET]).logs.join(' ')), true);

check('...and reports customerStatedTrade:false',
  i => /customerStatedTrade:false/.test(run(i, [SHEET]).logs.join(' ')), true);

check('the same sheet sent back as a TAPBACK does not fire it either',
  i => has(run(i, [TAPBACK]), TRADE_RE), false);

check('an AGENT quoting the sheet does not fire it',
  i => has(run(i, ['[08/27/2026 6:13 PM] [AGENT] Community Trade-In-Assistance+ -$500.00']), TRADE_RE), false);

// ── TRADE: THE TRUE FIRE MUST SURVIVE ───────────────────────────────────────
console.log('\n...but a trade the customer actually raises still fires:');

for (const [label, line] of [
  ['I have a trade-in',     'I have a trade-in, a 2018 Audi Q5'],
  ['what is my payoff',     'what is my payoff on the current loan'],
  ['I still owe on it',     'I still owe on it, does that matter'],
  ['my trade-in value',     'can you tell me my trade-in value'],
  ['we have a trade',       'we have a trade-in worth about 12k']
]) {
  check('  "' + label + '"',
    i => has(run(i, ['[09/02/2026 3:00 PM] [CUSTOMER] ' + line]), TRADE_RE), true);
}

check('a real trade still fires even with the pasted sheet also present',
  i => has(run(i, [SHEET, '[09/02/2026 3:00 PM] [CUSTOMER] I have a trade-in, a 2018 Audi Q5']), TRADE_RE), true);

// (v9.7.615) FOUND WHILE WRITING THIS SUITE, PRE-EXISTING, AND DELIBERATELY NOT FIXED HERE.
// _tradeRx requires the literal string "trade": /trade.?(in|value|worth|get|offer)|.../ — and
// "trading" is t-r-a-d-i-n-g, so "I am trading in my Q5" has NEVER matched it, on any build. That
// is UNDER-detection, the opposite of the over-firing this build was asked to fix, and widening the
// pattern is a different change with a different risk profile. Asserted as the current behaviour so
// the gap is recorded rather than mistaken for a regression from this build.
check('KNOWN GAP, unchanged here: "trading in" has never matched — the regex needs "trade"',
  i => has(run(i, ['[09/02/2026 3:00 PM] [CUSTOMER] I am trading in my 2018 Audi Q5']), TRADE_RE), false);

// ── NEITHER FIX TOUCHES THE OTHER ───────────────────────────────────────────
console.log('\nthe two fixes are independent:');

check('a stale timing note does not suppress a real trade',
  i => has(run(i, [VACATION, WHITE, '[09/02/2026 3:00 PM] [CUSTOMER] what is my payoff on it']), TRADE_RE), true);

check('a pasted sheet does not suppress a live timing hesitation',
  i => has(run(i, [SHEET, '[09/03/2026 9:00 AM] [CUSTOMER] I am not ready right now']), TIMING_RE), true);

// ── ROBUSTNESS ──────────────────────────────────────────────────────────────
console.log('\nthe absent cases:');
check('no lines at all', i => run(i, []).concerns.length, 0);
check('a customer line with neither signal', i => run(i, ['[09/02/2026] [CUSTOMER] what time do you close']).concerns.length, 0);
check('an unparseable date cannot throw', i => has(run(i, ['[99/99/9999] [CUSTOMER] I am not ready right now']), TIMING_RE), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
