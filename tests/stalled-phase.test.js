#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('stalled-phase.test.js');

/**
 * stalled-phase.test.js — v9.7.583. THE PROMPT TOLD THE MODEL TO ASSERT SOMETHING IT COULD NOT SEE.
 *
 * ── THE INCIDENT ──────────────────────────────────────────────────────────────────────────
 * Andrea Pardon, Community Kia Baytown, lead 2071842343, 8/26 12:51 PM. The delivered voicemail:
 *
 *   "I'm glad you found your 2025 Toyota Camry. We're a Kia store, but our sister store,
 *    Community Toyota Baytown, may be able to help with anything you need."
 *
 * Her entire arc is a 2019 Jeep Cherokee trade appraisal and a Kia Sorento. She has never replied
 * to anything. There is no Toyota anywhere in her record.
 *
 * ── IT WAS NOT FRAME BLEED, AND THAT MATTERED ─────────────────────────────────────────────
 * The obvious suspect was cross-lead contamination — the Julian/Juan phantom-Corolla shape. It was
 * eliminated against the captured artifacts rather than argued away:
 *   • The delivered prompt: 'camry' 0, 'toyota' 0, 'sister' 0, 'referral' 0 across all 66,627
 *     chars. Only 'Sorento', 12 times.
 *   • [LP PIVOT SCOPE DIAG] scopeCandidates:[] — the pivot detector saw no model name at all;
 *     the one token in the whole context was 'Sorento', correctly excluded as non-customer speech.
 *   • [LP LEAD-GRID DIAG] leads on this customer record: 1 — no donor lead exists.
 * The vehicle was invented. Nothing upstream supplied it.
 *
 * ── BUT IT WAS NOT INVENTED UNPROMPTED, AND THAT IS THE ACTUAL BUG ────────────────────────
 * PHASE 5 read: 'Gently assume they moved on: "I am guessing you found something already -- did
 * you end up going with something similar?"' That instructs the model to state an outcome the
 * system cannot observe, and leaves the object of the sentence blank.
 *
 * A re-grab of the SAME lead hours later rendered the SAME directive safely — "did you end up
 * finding something already?". Both runs obeyed. Only one put a car in the blank. A directive whose
 * safety depends on the model declining to be specific is not a safe directive, especially in a
 * prompt that says "Specific beats generic every time" and names abstraction as "the trap".
 *
 * ── THE PROMPT ALREADY BANNED THIS, ~270 LINES ABOVE ──────────────────────────────────────
 * The STALLED flag block ships in the same prompt and reads: "Do NOT guess at their personal
 * circumstances or motivations -- 'you found another offer,' 'something changed on your end,'
 * 'timing,' 'still comparing,' a life event, or any menu of such guesses to pick from are all
 * presumptuous." Phase 5 instructed precisely the guess its own flag text forbids. This suite pins
 * the contradiction closed, in the direction of the rule.
 *
 * ── WHAT IS ASSERTED ──────────────────────────────────────────────────────────────────────
 * The ladder is EXECUTED — the shipped block is sliced out and run — because this repo has twice
 * shipped a live outage past assertions that only proved a string was present in a file.
 *   • No rung instructs an assumption about what the customer did or why.
 *   • Phase 5 asserts nothing, still concedes, still offers the out, and forbids naming a vehicle.
 *   • The PHASE NAME is checked too: it is pushed into the prompt verbatim, so 'ASSUMPTION CLOSE'
 *     was itself an instruction to the model, not a label for us.
 *   • Rungs 1-4 are UNCHANGED — this is a one-rung fix, not a rewrite of stalled messaging.
 *   • The young-lead disagreement is reported and does NOT change the phase.
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stalled-phase.test.js <popup.js> [popup.js...]'); process.exit(2); }

const START = '    var stalledMarkerIdx = ';
const END   = "    lines.push('Read the transcript. Your message must feel DIFFERENT";

// Comment lines removed before any "does this still exist" scan. The post-mortem above NAMES the
// banned phrasing verbatim, so scanning raw source finds the explanation and reports the bug as
// still present. This repo has been bitten by self-matching assertions repeatedly.
const stripComments = t => t.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('stalled ladder not found in ' + file);
  const block = src.slice(a, b);
  // The block reads ctx_raw, ageDays_final and `lines`, and writes stalledPhase/stalledApproach.
  // The slice starts at stalledMarkerIdx, NOT at stalledTexts: ctx_stalled is derived two lines
  // above the counter, and a slice that began below it ran with ctx_stalled undefined — the same
  // out-of-scope class this fix is a post-mortem for, reproduced in its own harness.
  // Wrap it with exactly those so the SHIPPED bytes run.
  // (v9.7.595) The ladder now asks _lpCloseOutEligible before it may reach rung 5, so the SHIPPED
  // resolver is lifted in alongside the block and a `data` object is passed. Without this the
  // slice throws "_lpCloseOutEligible is not defined" on every case — which is exactly the
  // out-of-scope harness failure this suite's own header is a post-mortem for, hit a second time.
  const eh = src.indexOf('function _lpCloseOutEligible(');
  if (eh < 0) throw new Error('_lpCloseOutEligible not found in ' + file);
  let ed = 0, estarted = false, eend = -1;
  for (let i = eh; i < src.length; i++) {
    if (src[i] === '{') { ed++; estarted = true; }
    else if (src[i] === '}') { ed--; if (estarted && ed === 0) { eend = i + 1; break; } }
  }
  const resolver = src.slice(eh, eend);

  const fn = new vm.Script(
    '(function(ctx_raw, ageDays_final, data){\n var lines = []; var logs = [];\n' +
    'var console = { log: function(){ logs.push(Array.prototype.join.call(arguments, " ")); } };\n' +
    resolver + '\n' +
    block +
    '\nreturn { phase: stalledPhase, approach: stalledApproach, touches: stalledTouches,' +
    ' lines: lines, logs: logs }; })'
  ).runInNewContext({ String: String, RegExp: RegExp, parseFloat: parseFloat, isNaN: isNaN });
  return { name: path.basename(path.dirname(file)), run: fn, code: stripComments(src) };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
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

// A context carrying n unanswered outbound touches, in the real shape the counter matches.
const ctx = n => Array.from({ length: n }, (_, k) =>
  k % 2 ? '[08/2' + (2 + (k % 6)) + '/2026 8:26 AM] Email reply to prospect\n  body'
        : '[08/2' + (2 + (k % 6)) + '/2026 8:26 AM] Outbound Text Message\n  body').join('\n');

// (v9.7.595) The ladder now consults _lpCloseOutEligible before rung 5, so every case needs the
// `data` the resolver reads. Two shapes are used below and the difference between them IS the
// change this build made.
//
//   ANDREA_DATA — her real shape: 4 days old, 5 outreaches, never replied. NOT eligible.
//   ELIGIBLE_DATA — 40 days, 8 outreaches, never replied. Eligible.
//
// v9.7.583 wrote an assertion pinning Andrea to the top rung, saying the trigger was deliberately
// left alone until there was data. There is now data (the 8/27 feedback export), Gil set the rule
// ("a combo of days and lack of response"), and that assertion is deliberately inverted below.
// The Phase 5 WORDING assertions from v9.7.583 are all still here and still matter — they simply
// need a lead that has actually earned the rung in order to reach it.
const ANDREA = ctx(5), ANDREA_AGE = 4;
const ANDREA_DATA = { leadAgeDays: 4, hasCustomerReply: false, convState: 'active-follow-up',
                      relationshipSignals: { totalOutboundCount: 5, lastInboundAgeDays: null } };
const ELIGIBLE_DATA = { leadAgeDays: 40, hasCustomerReply: false, convState: 'active-follow-up',
                        relationshipSignals: { totalOutboundCount: 8, lastInboundAgeDays: null } };

console.log('\nv9.7.583 — the stalled ladder concedes without asserting');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── The rung Andrea landed on ─────────────────────────────────────────────────
console.log("Andrea's exact shape — 5 unanswered touches on a 4-day-old lead:");

check('the touch count still reads 5 — the COUNTER is unchanged',
  i => i.run(ANDREA, ANDREA_AGE, ANDREA_DATA).touches, 5);

// (v9.7.595) THIS ASSERTION IS DELIBERATELY INVERTED. v9.7.583 pinned Andrea to the top rung and
// said so explicitly: the trigger was left alone because re-thresholding the fleet needed data
// first. The 8/27 feedback export supplied it — 8 of 21 rated drafts offered a close-out, the two
// wrong ones at 2 and 9 days — and Gil set the rule. Four days with five touches is our cadence
// running, not a customer gone cold, so the ladder now stops one rung short.
check('she NO LONGER reaches the close-out rung — 4 days is our cadence, not her silence',
  i => i.run(ANDREA, ANDREA_AGE, ANDREA_DATA).phase, 'PHASE 4 -- PATTERN INTERRUPT');

check('...and that rung explicitly refuses to offer the exit',
  i => /Do NOT offer to close the file, stop contact, or ask whether to keep it open/
        .test(i.run(ANDREA, ANDREA_AGE, ANDREA_DATA).approach), true);

check('...while naming why, so the agent can see the gate rather than guess',
  i => /never replied, 4d old with 5 outreach/.test(i.run(ANDREA, ANDREA_AGE, ANDREA_DATA).approach), true);

check('a lead that HAS earned it still reaches the close-out rung',
  i => i.run(ctx(5), 40, ELIGIBLE_DATA).phase, 'PHASE 5 -- GRACEFUL CLOSE-OUT');

check('the directive no longer tells the model to assume they moved on',
  i => /assume they moved on|guessing you found something/i.test(i.run(ctx(5), 40, ELIGIBLE_DATA).approach), false);

check('...and it names the failure it is prone to, so the rule sits where the risk is',
  i => {
    const a = i.run(ctx(5), 40, ELIGIBLE_DATA).approach;
    return { assertsNothing: /ASSERT NOTHING/.test(a), noVehicle: /Do NOT name a vehicle/.test(a) };
  }, { assertsNothing: true, noVehicle: true });

check('it still CONCEDES — the softest rung is still soft, this is not a re-pitch',
  i => {
    const a = i.run(ctx(5), 40, ELIGIBLE_DATA).approach;
    return { concedes: /concede|stop filling your inbox|close it out/i.test(a),
             noPitch:  /no pitch/i.test(a),
             oneAsk:   /ONE question/.test(a) };
  }, { concedes: true, noPitch: true, oneAsk: true });

// ── THE INCIDENT SENTENCE ─────────────────────────────────────────────────────
console.log('\nthe shipped sentence can no longer be read off any rung:');

// Every phrasing that licenses "I'm glad you found your <vehicle>".
const BANNED = /assume they moved on|you found something already|did you end up going with something|already bought|found something else/i;

// THE SELF-MATCHING TRAP, IN A NEW PLACE. The fixed directive necessarily QUOTES the phrasing it
// bans — "never say or imply they already bought, found something, went with someone else" — so a
// flat scan for those words matched the prohibition and reported the bug as still present. Same
// shape as the comment-scanning mistakes this repo keeps making, except here it is live prompt text
// that ships to the model, not commentary, so stripComments cannot reach it.
//
// Drop PROHIBITION sentences before scanning. What must not survive is the phrasing as an
// INSTRUCTION; the same words inside "never say X" are the fix doing its job.
const stripProhibitions = t => String(t).split(/(?<=[.?!])\s+/)
  .filter(sn => !/\b(never|do not|don't|ASSERT NOTHING|do NOT)\b/i.test(sn))
  .join(' ');

check('NO rung — 0 through 20 touches — instructs an assumption about what the customer did',
  i => {
    const hits = [];
    for (let n = 0; n <= 20; n++) {
      const r = i.run(ctx(n), 40, ELIGIBLE_DATA);
      const appr = stripProhibitions(r.approach);
      const body = stripProhibitions(r.lines.join(' '));
      if (BANNED.test(appr) || BANNED.test(body)) hits.push(n + ':' + r.phase);
    }
    return hits;
  }, []);

check('...and no rung name contains the word ASSUMPTION',
  i => {
    const names = new Set();
    for (let n = 0; n <= 20; n++) names.add(i.run(ctx(n), 40, ELIGIBLE_DATA).phase);
    return Array.from(names).filter(p => /ASSUMPTION/i.test(p));
  }, []);

// ── Rungs 1-4 are untouched ───────────────────────────────────────────────────
console.log('\nrungs 1-4 are UNCHANGED — one rung was wrong, not the ladder:');

check('the five rungs are still the five rungs, in order',
  i => [0, 2, 3, 4, 9].map(n => i.run(ctx(n), 40, ELIGIBLE_DATA).phase),
  ['PHASE 1 -- VALUE / OPTIONS', 'PHASE 2 -- MICRO QUESTION', 'PHASE 3 -- TIMING CHECK',
   'PHASE 4 -- PATTERN INTERRUPT', 'PHASE 5 -- GRACEFUL CLOSE-OUT']);

check('phase 4 still offers the pattern interrupt verbatim',
  i => i.run(ctx(4), 40, ELIGIBLE_DATA).approach,
  'Break the script. Try: "Quick one -- did you already pick something up or still weighing options?"'
  + ' or "Should I keep this on my radar or close it out?"');

check('the boundary is still 4→5 at the fifth touch, not moved',
  i => [i.run(ctx(4), 40, ELIGIBLE_DATA).phase.slice(0, 7), i.run(ctx(5), 40, ELIGIBLE_DATA).phase.slice(0, 7)],
  ['PHASE 4', 'PHASE 5']);

// ── The block's other lines still ship ────────────────────────────────────────
console.log('\nthe surrounding block is intact:');

check('the phase name and touch count still reach the prompt',
  i => {
    const L = i.run(ctx(5), 40, ELIGIBLE_DATA).lines.join('\n');
    return { name: /STALLED LEAD RE-ENGAGEMENT -- PHASE 5 -- GRACEFUL CLOSE-OUT/.test(L),
             count: /has not responded to 5 message\(s\)/.test(L),
             noAppt: /DO NOT offer appointment times/.test(L) };
  }, { name: true, count: true, noAppt: true });

// (v9.7.595) The gated case reaches the prompt the same way — the rung changed, the plumbing did
// not. Asserted so a future gate that silently emitted nothing would be caught.
check('...and a GATED lead reaches it too, carrying PHASE 4 instead',
  i => {
    const L = i.run(ANDREA, ANDREA_AGE, ANDREA_DATA).lines.join('\n');
    return { name: /STALLED LEAD RE-ENGAGEMENT -- PHASE 4 -- PATTERN INTERRUPT/.test(L),
             count: /has not responded to 5 message\(s\)/.test(L),
             noPhase5: !/GRACEFUL CLOSE-OUT/.test(L) };
  }, { name: true, count: true, noPhase5: true });

// ── The young-lead diagnostic: reports, does not act ──────────────────────────
console.log('\nthe young-lead disagreement is REPORTED and changes nothing:');

check("Andrea's shape raises the flag — 5 touches in 4 days",
  i => /TOP RUNG ON A YOUNG LEAD/.test(i.run(ANDREA, ANDREA_AGE).logs.join('\n')), true);

check('...and the phase is IDENTICAL with and without the flag — observation only',
  i => i.run(ANDREA, 4).phase === i.run(ANDREA, 90).phase, true);

check('an ordinary long-dormant lead does NOT raise it — the flag is not always-on',
  i => /TOP RUNG ON A YOUNG LEAD/.test(i.run(ctx(8), 75).logs.join('\n')), false);

check('unknown age is reported as unknown rather than guessed at',
  i => /leadAge:unknown/.test(i.run(ANDREA, 0).logs.join('\n')), true);

check('the diag always names the phase, the split and the age',
  i => {
    const l = i.run(ctx(3), 30).logs.join('\n');
    return /\[LP STALLED PHASE DIAG\] PHASE 3 -- TIMING CHECK \| touches:3 \(texts:2 emails:1\) \| leadAge:30d/.test(l);
  }, true);

// ── The contradiction it resolves ─────────────────────────────────────────────
console.log('\nthe rule this rung used to contradict is still shipping:');

check('the STALLED flag still bans guessing the reason for silence',
  i => /Do NOT guess at their personal circumstances or motivations/.test(i.code)
    && /you found another offer/.test(i.code), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
