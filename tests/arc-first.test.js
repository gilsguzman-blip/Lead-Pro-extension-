#!/usr/bin/env node
'use strict';
// (v9.7.627) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('arc-first.test.js');

/**
 * arc-first.test.js — v9.7.627. THE CONVERSATION GOES FIRST, AND IT OUTRANKS WHAT WE DERIVED.
 *
 * Gil, reading a prompt on 9/4: "why is the model not able to read the entire arc to determine the
 * response rather than pieces? ... That's my biggest hang up, not giving the model all the info so
 * it can do its job."
 *
 * MEASURED RATHER THAN ASSUMED, on his own prompt capture (Sydnie Moon, 2075798859):
 *
 *   directives before any conversation        26,511 chars   31%
 *   ARC excerpts + more directives            32,766         39%
 *   chronological arc, TRUNCATED at 120/msg    8,151         10%
 *   full transcript, complete, newest-first   16,750         20%
 *
 * So the model DID have the whole thread — but it sat at 80% depth under ~59,000 characters of
 * instructions that had already drawn conclusions from it, and the ONE chronological rendering,
 * the one the prompt tells it to "read top-to-bottom to follow the story", was cut to 120
 * characters per message. 18 of 27 entries truncated, 3,477 characters of conversation dropped,
 * and in four of her nine messages the half that went missing was the operative half:
 *
 *     "...I usually finance for 60-72 months"                    the term she wants
 *     "...what your offer on my trade in would be"               her trade question
 *     "...any better deal to consider Id be happy to consider it" her openness to alternatives
 *     "...on new vehicle"                                        completes her question
 *
 * TWO CHANGES, and the second is why every 9/4 bug reached a customer.
 *
 * (1) THE SPINE STOPS TRUNCATING. Restoring the full body costs 4.1% of prompt size. A 1200-char
 *     cap remains only as a runaway guard; nothing real reaches it.
 *
 * (2) THE CONVERSATION IS HOISTED ABOVE THE DERIVED DIRECTIVES, with a precedence rule between
 *     them. In every 9/4 failure a derived line contradicted the transcript sitting lower in the
 *     SAME prompt and won, because it is emphatic, specific, imperative and early:
 *       "CROSS-BRAND PIVOT: Customer is now interested in a Cr-v"  vs "TRADE-IN: 2023 Honda CR-V"
 *       "STALLED LEAD ... then went quiet"                         vs a reply 2 hours old
 *       "they asked for BLACK ... never fall back to the Aspen White" vs the trade line it came from
 *     The model was obeying, not misreading. v9.7.622-626 fixed those five detectors; this fixes
 *     the shape that let a wrong detector outrank the truth.
 *
 * THE RULE DRAWS A LINE THE CODEBASE DID NOT HAVE: derived readings about the CUSTOMER lose to the
 * thread; facts from OUTSIDE the thread — store hours, live inventory, incentives, phone/email on
 * file, distance — do not, and the thread cannot overrule them.
 *
 * Executes the SHIPPED spine builder and the SHIPPED reorder. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: arc-first.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

const SPINE_HDR = '━━━ CONVERSATION ARC (oldest → newest — read top-to-bottom to follow the story, then use the full transcript below for exact wording and detail) ━━━';

function load(file) {
  const src = fs.readFileSync(file, 'utf8');

  // the shipped chronological spine builder
  const a = src.indexOf('function _lpBuildArcSpine(ctx) {');
  const b = src.indexOf('\n}', src.indexOf("return turns.map(function (t, idx) {", a));
  if (a < 0 || b < 0) require('./lib/fatal-guard.js').bail('arc-first.test.js', 'spine builder not in ' + file);
  const sbSpine = { String, Number };
  vm.createContext(sbSpine);
  vm.runInContext(src.slice(a, b + 2), sbSpine);

  // the shipped return-site reorder, wrapped so it can be handed a lines[] array
  const ra = src.indexOf('  var _out = lines.filter(function(l){ return l !== undefined; });');
  const rb = src.indexOf("  return _out.join('\\n');", ra);
  if (ra < 0 || rb < 0) require('./lib/fatal-guard.js').bail('arc-first.test.js', 'reorder not in ' + file);
  const body = src.slice(ra, rb) + "  return _out;";
  const sbOrd = { String, Array };
  vm.createContext(sbOrd);
  vm.runInContext('function _reorder(lines){\n' + body + '\n}', sbOrd);

  return { src, spine: vm.runInContext('_lpBuildArcSpine', sbSpine), reorder: vm.runInContext('_reorder', sbOrd) };
}

// Sydnie's real messages, in the transcript shape the spine parses (newest-first).
const HER_LONGEST = 'Hi! I was wondering if the listed price is out the door. Also if that price reflects '
  + 'the 22k miles in the odometer picture or the 10k miles listed on the listing. Also would like '
  + 'to see what your offer on my trade in would be';
const HER_TERMS = 'My mileage was off yesterday. Its 84,400 and my pay off is 22,029. I could probably '
  + 'put down 1-2k extra off needed and I usually finance for 60-72 months';
const CTX = '[09/01/2026 9:22 AM] [CUSTOMER] Email reply from prospect\n  ' + HER_TERMS + '\n'
          + '[08/31/2026 11:18 AM] [CUSTOMER] Email reply from prospect\n  ' + HER_LONGEST + '\n';

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — the whole arc, before the conclusions drawn from it');

  // ── (1) NOTHING IS CUT ─────────────────────────────────────────────────────
  console.log('\nthe chronological arc carries the whole message:');
  const spine = B.spine(CTX);
  check('her financing term survives', spine.indexOf('I usually finance for 60-72 months') > -1, true);
  check('her trade question survives', spine.indexOf('what your offer on my trade in would be') > -1, true);
  check('nothing is truncated', spine.indexOf('…'), -1);
  check('...and it is still oldest → newest', spine.indexOf('11:18 AM') < spine.indexOf('9:22 AM'), true);
  // The exact cut point that caused this. 120 was the old cap; both messages exceed it.
  check('both messages are longer than the old 120-char cap',
    HER_TERMS.length > 120 && HER_LONGEST.length > 120, true);
  check('the 120-char cap is gone from the source', /body\.slice\(0, 120\)/.test(B.src), false);
  // A runaway guard remains — a cap is not the enemy, a 120-char one was.
  check('a 1200-char runaway guard remains', /if \(body\.length > 1200\)/.test(B.src), true);

  // ── (2) THE CONVERSATION IS HOISTED ────────────────────────────────────────
  // A lines[] array in the order the builder produces it today: scenario, then directives, then
  // the conversation last.
  const LINES = [
    'DATE: Friday, September 4 2026',
    '━━━ SCENARIO ━━━',
    'TASK: CarGurus lead with PRIOR OUTREACH already made.',
    '⚠ CROSS-BRAND PIVOT: Customer is now interested in a Cr-v (Honda).',
    '',
    SPINE_HDR,
    '1. [08/31] CUSTOMER: ' + HER_LONGEST,
    '',
    '━━━ CONTEXT & HISTORY ━━━',
    'CONVERSATION TRANSCRIPT (newest first):\n---\nthe whole thread\n---',
  ];
  const out = B.reorder(LINES.slice());
  const at = s => out.findIndex(l => String(l).indexOf(s) === 0 || String(l) === s);

  console.log('\nthe conversation now precedes everything derived from it:');
  check('the transcript is above the SCENARIO block',
    at('━━━ CONTEXT & HISTORY ━━━') < at('━━━ SCENARIO ━━━'), true);
  check('...and so is the chronological arc', at(SPINE_HDR) < at('━━━ SCENARIO ━━━'), true);
  check('...and both are above the pivot directive that used to outrank them',
    at('━━━ CONTEXT & HISTORY ━━━') < out.findIndex(l => /CROSS-BRAND PIVOT/.test(String(l))), true);
  check('the date frame still comes first — dates in the arc need it',
    at('DATE: Friday, September 4 2026'), 0);
  check('nothing was lost in the move', out.length >= LINES.length, true);
  check('the transcript still appears exactly once',
    out.filter(l => /CONVERSATION TRANSCRIPT/.test(String(l))).length, 1);

  console.log('\nthe precedence rule sits between them:');
  const joined = out.join('\n');
  check('the rule is present', /THE CONVERSATION ABOVE IS THE RECORD/.test(joined), true);
  check('...below the transcript', joined.indexOf('CONTEXT & HISTORY') < joined.indexOf('THE CONVERSATION ABOVE IS THE RECORD'), true);
  check('...and above the derived directives',
    joined.indexOf('THE CONVERSATION ABOVE IS THE RECORD') < joined.indexOf('CROSS-BRAND PIVOT'), true);
  check('it says the messages win', /THE MESSAGES WIN/.test(joined), true);
  // The distinction that keeps this from disarming the facts the model genuinely cannot see.
  check('...for readings about the CUSTOMER', /what they want, what they said, what they are/.test(joined), true);
  check('...but NOT for store hours and live inventory',
    /does NOT govern facts you cannot see in the thread/.test(joined), true);
  check('...naming them explicitly', /store hours, live inventory/.test(joined), true);
  check('...and stating the thread cannot overrule them', /cannot\s+overrule them/.test(joined), true);

  // ── FAILS OPEN ─────────────────────────────────────────────────────────────
  // Order is a preference. It must never be a reason a generation fails.
  console.log('\nit fails open, every time:');
  const noScen = ['a', '━━━ CONTEXT & HISTORY ━━━', 'ctx'];
  check('no SCENARIO anchor — array returned untouched', B.reorder(noScen.slice()), noScen);
  const noCtx = ['a', '━━━ SCENARIO ━━━', 'b'];
  check('no conversation — array returned untouched', B.reorder(noCtx.slice()), noCtx);
  check('already in the right order — left alone',
    B.reorder(['━━━ CONTEXT & HISTORY ━━━', 'ctx', '━━━ SCENARIO ━━━']).join('|'),
    ['━━━ CONTEXT & HISTORY ━━━', 'ctx', '━━━ SCENARIO ━━━'].join('|'));
  check('an empty array does not throw', B.reorder([]).length, 0);
  check('the reorder is wrapped in try/catch', /catch \(e\) \{ \/\* order is a preference/.test(B.src), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds order identically:');
  const cut = f => {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('  var _out = lines.filter(function(l){ return l !== undefined; });');
    return s.slice(i, s.indexOf("  return _out.join('\\n');", i));
  };
  check('dev and commercial are identical', cut(BUILDS[0]) === cut(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
