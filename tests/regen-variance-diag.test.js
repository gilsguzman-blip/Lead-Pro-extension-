#!/usr/bin/env node
'use strict';
// (v9.7.612) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('regen-variance-diag.test.js');

/**
 * regen-variance-diag.test.js — v9.7.692. THE HISTORY ASKS; THIS MEASURES.
 *
 * Gil, 9/22: "are there any restraints on the regen?" Almost none. Nothing caps how many times it
 * can be pressed, every press reaches the model (v9.7.584), and the ONLY content constraint is
 * v9.7.688's draft history — which puts the rejected drafts in front of the model and says
 * rewording is not regenerating. Nothing has ever checked whether the new draft actually differs.
 *
 * WHY WORD OVERLAP WOULD NOT HAVE CAUGHT IT, which is the whole design of this row. Christina's
 * six collapsed drafts (lead 2059585201, 12:36-12:38) scored jaccard 0.29-0.44 against each other
 * — squarely inside the range of that same day's ACCEPTED regen pairs. The words moved every time.
 * The move never did, and the move lives in the QUESTION.
 *
 * So the measure compares the ask with the constants stripped, and this suite drives the SHIPPED
 * comparison against both real arcs:
 *
 *   KNOWN BAD  — Christina's six close-out paraphrases, the incident v9.7.688 was built for.
 *   KNOWN GOOD — the same lead the same evening, twice, after v9.7.688/.691 were in the field:
 *                generation 1 made the CHANNEL move, generation 2 made the TIMING move, and the
 *                agent kept them.
 *
 * A threshold that cannot separate those two sets is decoration, so both are asserted here by
 * score, not by verdict word alone.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: regen-variance-diag.test.js <popup.js> [popup.js...]'); process.exit(2); }

function bodyOf(src) {
  const i = src.lastIndexOf('// Lead Pro -- popup.js  v');
  if (i < 0) throw new Error('no build header found');
  const j = src.indexOf('\n', i);
  return src.slice(j < 0 ? i : j + 1);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const body = bodyOf(src);
  const k = body.indexOf("var _rvHist = (typeof window !== 'undefined'");
  if (k < 0) throw new Error('v9.7.692 regen variance block not found');
  const a = body.lastIndexOf('(function () {', k);
  const endMark = '    })();';
  const e = body.indexOf(endMark, k);
  if (a < 0 || e < 0) throw new Error('regen variance block bounds not found');
  const code = body.slice(a, e + endMark.length);
  return { name: path.basename(path.dirname(file)), src, body,
           code: code,
           stripped: body.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n') };
}

// Runs the SHIPPED block with rawSms and the history supplied, and returns the row it printed.
function run(impl, rawSms, history, lead) {
  const logs = [];
  const sb = {
    String, Array, RegExp, Math, Number,
    rawSms: rawSms,
    lastScrapedData: { vehicle: (lead && lead.vehicle) || '', name: (lead && lead.name) || '' },
    window: { _lpDraftHistory: history,
              _leadProResolvedSigner: { firstName: (lead && lead.signer) || '' },
              _leadProResolvedContext: { storeName: (lead && lead.store) || '' } },
    console: { log: (...a) => logs.push(a.join(' ')) }
  };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  const row = logs.find(l => l.indexOf('[LP REGEN VARIANCE DIAG]') === 0) || '';
  const m = row.match(/ask-overlap:([0-9.]+)/);
  return { row, score: m ? parseFloat(m[1]) : null,
           verdict: /SAME MOVE/.test(row) ? 'same' : /OVERLAPPING/.test(row) ? 'overlap'
                    : /DIFFERENT MOVE/.test(row) ? 'different' : (row ? '?' : 'silent') };
}

// (v9.7.693) THE FIXTURE NOW MATCHES THE CRM, NOT THE IMPLEMENTATION. v9.7.692 set name to
// 'Christina' — the FIRST name — and every draft below carried the FULL '2026 Kia Carnival LX
// FWD'. Both are the reverse of what the field supplies, so the whole-string strip matched in the
// suite and never once matched in production. [LP PHONE DIAG] on the real capture reads
// customerName: "Christina Gonzalez", and the model wrote "the 2026 Kia Carnival".
const LEAD = { vehicle: '2026 Kia Carnival LX FWD', name: 'Christina Gonzalez',
               signer: 'Melanie', store: 'Community Kia Baytown' };
const SIG = ' Melanie Community Kia Baytown 281-837-3373';

// Christina's real six, in export order, as the collector stores them (whitespace-collapsed).
const BAD = [
  'should I close out your request for the 2026 Kia Carnival, or leave it open for you?',
  'I’m going to step back so I don’t keep filling your inbox. Should I close out your 2026 Kia Carnival LX FWD inquiry?',
  'I don’t want to keep sending messages that aren’t useful. Would you like me to close out your 2026 Kia Carnival inquiry?',
  'are you still interested in the 2026 Kia Carnival LX FWD, or should I close out your inquiry?',
  'I can close out your 2026 Kia Carnival inquiry so I’m not filling your inbox, or keep it open if you’re still interested. Which would you prefer?',
  'would you like me to close out your 2026 Kia Carnival LX FWD inquiry, or keep it open?'
].map(t => '[NAME], ' + t + SIG);

// The two arcs the agent KEPT, both on this lead, after v9.7.688 shipped. Channel, then timing.
const GOOD_2222 = [
  '[NAME], I want to handle your 2026 Kia Carnival LX FWD inquiry the way that works best for you. Should I keep future updates to text, email, or stop reaching out?' + SIG,
  'Christina, would you prefer I check back later about the 2026 Kia Carnival LX FWD, or stop here?' + SIG
];
const GOOD_2133 = [
  '[NAME], I’m stepping back after this message about the 2026 Kia Carnival LX FWD so I don’t keep adding noise to your inbox. If you ever want to reconnect, would you prefer text, email, or no further messages?' + SIG,
  'Christina, I can check back later about the 2026 Kia Carnival LX FWD, or I can stop reaching out. Which would you prefer?' + SIG
];

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

console.log('\nv9.7.692 — a regen that only rewords is now countable');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── SILENT WHEN THERE IS NOTHING TO COMPARE ───────────────────────────────────────────────
console.log('it says nothing on a first generation:');

check('no history → no row at all',
  i => run(i, BAD[0], [], LEAD).verdict, 'silent');
check('history absent entirely → no row, no throw',
  i => run(i, BAD[0], undefined, LEAD).verdict, 'silent');

// ── THE INCIDENT IT WAS BUILT FOR ─────────────────────────────────────────────────────────
console.log('\n  Christina\'s six, scored against everything written before each one:');

for (let n = 1; n < BAD.length; n++) {
  check('draft ' + (n + 1) + ' is called a REWORD of an earlier one',
    i => run(i, BAD[n], BAD.slice(0, n), LEAD).verdict, 'same');
}

check('...and every one of them scores at or above the 0.60 threshold',
  i => BAD.slice(1).every((t, n) => run(i, t, BAD.slice(0, n + 1), LEAD).score >= 0.60), true);

check('the row names WHICH earlier draft it is repeating',
  i => /this is draft #\d+ reworded/.test(run(i, BAD[5], BAD.slice(0, 5), LEAD).row), true);

// Draft 5's question is "Which would you prefer?" — no content words at all. Question-only
// scoring gave it 0.00, the single false negative in the set, and the whole-message fallback is
// what fixed it. Pinned so the fallback cannot be removed as redundant.
check('draft 5 — a bare "Which would you prefer?" is still caught by the fallback',
  i => { const r = run(i, BAD[4], BAD.slice(0, 4), LEAD); return [r.verdict, r.score >= 0.60]; },
  ['same', true]);

// ── AND THE ARCS THE AGENT KEPT ───────────────────────────────────────────────────────────
// A threshold that flags these too would be worse than no row at all.
console.log('\n  the two real arcs the agent KEPT must NOT be flagged:');

check('22:22 — channel then timing reads as a different move',
  i => run(i, GOOD_2222[1], [GOOD_2222[0]], LEAD).verdict, 'different');
check('...and scores well clear of the threshold',
  i => run(i, GOOD_2222[1], [GOOD_2222[0]], LEAD).score < 0.35, true);

check('21:33 — the same pair of moves, different wording, also different',
  i => run(i, GOOD_2133[1], [GOOD_2133[0]], LEAD).verdict, 'different');
check('...and also scores clear',
  i => run(i, GOOD_2133[1], [GOOD_2133[0]], LEAD).score < 0.35, true);

check('the gap between the worst GOOD and the best BAD is real, not marginal',
  i => { const g = Math.max(run(i, GOOD_2222[1], [GOOD_2222[0]], LEAD).score,
                            run(i, GOOD_2133[1], [GOOD_2133[0]], LEAD).score);
         const b = Math.min.apply(null, BAD.slice(1).map((t, n) => run(i, t, BAD.slice(0, n + 1), LEAD).score));
         return b - g >= 0.30; }, true);

// ── THE CONSTANTS ARE WHAT MAKE IT WORK ───────────────────────────────────────────────────
console.log('\n  the vehicle, name, signer and store are stripped before comparing:');

// THE CASE THAT PROVES THE STRIPPING EARNS ITS PLACE. Two SHORT, genuinely different asks that
// both name the vehicle: without stripping they share "kia carnival fwd" and score 0.60 — a false
// SAME MOVE. With it, 0.00. Christina's own arcs do not need the stripping (measured: they still
// separate 0.67-1.00 vs 0.13 without it), so this is the case that does.
check('two short, different asks that both name the vehicle are not flagged',
  i => run(i, 'Christina, is the 2026 Kia Carnival LX FWD still right for you?' + SIG,
              ['[NAME], should I hold the 2026 Kia Carnival LX FWD?' + SIG], LEAD).verdict, 'different');

check('two genuinely different asks about the same vehicle are not flagged',
  i => run(i, 'Christina, what colour were you hoping for on the 2026 Kia Carnival LX FWD?' + SIG,
              ['[NAME], should I close out your 2026 Kia Carnival LX FWD inquiry?' + SIG], LEAD).verdict, 'different');

check('the signature alone never makes two drafts look alike',
  i => run(i, 'Christina, what colour were you hoping for?' + SIG,
              ['[NAME], did your timeline change?' + SIG], LEAD).score < 0.35, true);

check('the scrubbed [NAME] in history does not match the real name in the new draft',
  i => run(i, 'Christina, did your timeline change?' + SIG,
              ['[NAME], what colour were you hoping for?' + SIG], LEAD).score < 0.35, true);

// ── THE REAL CAPTURE, IN THE SHAPES THE CRM ACTUALLY SUPPLIES ────────────────────────────
// log231, 9/22 17:36, the first live run of the v9.7.692 row. It printed the correct verdict and
// this: "ask terms:[christina prefer check back later kia carnival stop reaching out]" — the two
// things the strip exists to remove, both still present. Driven here verbatim so the strip is
// asserted on its OUTPUT rather than on the fact that a strip exists.
console.log('\n  the real 9/22 capture — full scraped name, short vehicle form in the draft:');

const LIVE_PRIOR = 'Christina, I’ll reach out about the 2026 Kia Carnival in whatever way works best for you. Would you prefer text, email, or no further messages?' + SIG;
const LIVE_NEW   = 'Christina, would you prefer I check back later about the 2026 Kia Carnival, or stop reaching out?' + SIG;
const liveTerms = i => ((run(i, LIVE_NEW, [LIVE_PRIOR], LEAD).row.match(/ask terms:\[([^\]]*)\]/) || ['', ''])[1]);

check('the customer\'s first name is stripped even though the CRM stored the full name',
  i => / christina |^christina | christina$|^christina$/.test(' ' + liveTerms(i) + ' '), false);

check('the vehicle is stripped even though the draft used a SHORTER form than the VOI',
  i => /kia|carnival/.test(liveTerms(i)), false);

check('...and what is left is the ask itself',
  i => liveTerms(i), 'prefer check back later stop reaching out');

check('the verdict on that capture is still the one the log printed',
  i => run(i, LIVE_NEW, [LIVE_PRIOR], LEAD).verdict, 'different');

check('the signer and store are stripped from the signature too',
  i => /melanie|community|baytown/.test(liveTerms(i)), false);

// ── THE ROW SAYS WHAT IT IS ───────────────────────────────────────────────────────────────
console.log('\n  the row is honest about what it can and cannot tell you (diag-honesty):');

check('it says outright that nothing branches on it',
  i => /observational only, nothing branches on this row and the draft ships either way/
         .test(run(i, BAD[1], [BAD[0]], LEAD).row), true);
check('...and records WHY word overlap is not the measure, with the numbers',
  i => /jaccard 0\.29-0\.44, the same as that day’s ACCEPTED pairs/
         .test(run(i, BAD[1], [BAD[0]], LEAD).row), true);
check('...and prints the ask terms it actually compared',
  i => /ask terms:\[[a-z ]+\]/.test(run(i, BAD[1], [BAD[0]], LEAD).row), true);
check('it reports how many prior drafts it looked at',
  i => /vs 5 prior draft\(s\)/.test(run(i, BAD[5], BAD.slice(0, 5), LEAD).row), true);

// ── THE CHIP LABEL ────────────────────────────────────────────────────────────────────────
// Every plain Regenerate printed "chip:true" with no chip pressed, because the Generate button
// sets the same flag the chips use. The bypass was right; the attribution was not.
console.log('\n  [LP EDGE BYPASS DIAG] no longer calls a plain regen a chip press:');

check('the mislabelled "chip:" field is gone',
  i => /\+ ' chip:' \+ !!window\._lpBypassEdgeCache/.test(i.stripped), false);
check('...replaced by what the flag actually is',
  i => /explicitRefresh:' \+ !!window\._lpBypassEdgeCache/.test(i.stripped), true);
check('...and the real chip signal is reported beside it',
  i => /chipDirective:' \+ \(window\._lpRegenDirective \? 'yes' : 'none'\)/.test(i.stripped), true);
check('the Generate button still sets the flag — the BYPASS behaviour is unchanged (v9.7.584)',
  i => /window\._lpBypassEdgeCache = _regenStripVisible;/.test(i.stripped), true);
check('...and the bypass condition itself is untouched',
  i => /if \(window\._lpBypassEdgeCache \|\| _stateBypass \|\| _isRegenSession\) payload\.noEdgeCache = true;/
         .test(i.stripped), true);

// ── NON-VACUITY ───────────────────────────────────────────────────────────────────────────
console.log('\nnon-vacuity — reverting each decision must fail assertions by name:');

function neuter(label, mutate, probe, wantBroken, control, wantControl) {
  const results = impls.map(i => {
    let m;
    try { m = Object.assign({}, i, { code: mutate(i.code) }); } catch (e) { return 'MUTATE THREW: ' + e.message; }
    let broken, ctl;
    try { broken = JSON.stringify(probe(m)); } catch (e) { broken = 'THREW'; }
    try { ctl = JSON.stringify(control(m)); } catch (e) { ctl = 'THREW'; }
    return JSON.stringify([broken !== JSON.stringify(wantBroken), ctl === JSON.stringify(wantControl)]);
  });
  report(label, results, [true, true]);
}

neuter('A — no thin-question fallback → draft 5 goes unflagged (control: draft 6 still caught)',
  c => c.replace('return q.length >= 3 ? q : _rvWords(s);', 'return q;'),
  i => run(i, BAD[4], BAD.slice(0, 4), LEAD).verdict, 'same',
  i => run(i, BAD[5], BAD.slice(0, 5), LEAD).verdict, 'same');

// MEASURED FIRST, THEN ASSERTED. My first draft of this neuter claimed removing the stripping
// would make Christina's KEPT arcs look alike. It does not — they score 0.13 either way, and the
// six still score 0.67-1.00. Claiming it would have been a neuter that passes for the wrong
// reason. What the stripping actually protects is the SHORT-ask case, so that is what is asserted.
neuter('B — constants left in → two short different asks read as a repeat (control: the six still flag)',
  c => c.replace("var _rvNoise = [_rvSd.vehicle, _rvSd.name, _rvSg.firstName, _rvCx.storeName,\n                        _rvSd.storeName, '[name]', '[phone]'];",
                 'var _rvNoise = [];'),
  i => run(i, 'Christina, is the 2026 Kia Carnival LX FWD still right for you?' + SIG,
              ['[NAME], should I hold the 2026 Kia Carnival LX FWD?' + SIG], LEAD).verdict, 'different',
  i => run(i, BAD[5], BAD.slice(0, 5), LEAD).verdict, 'same');

// Under jaccard the six score 0.25, 0.50, 0.60, 0.38, 0.50 — FOUR OF FIVE fall below the
// threshold and the incident goes unflagged. Draft 4 lands exactly on 0.60 and still reports,
// which is what makes it the control: the measure is not broken everywhere, just where it counts.
neuter('C — jaccard instead of containment → 4 of the 6 go unflagged (control: draft 4 still flags)',
  c => c.replace('return hit / Math.max(1, Math.min(uA, uB));', 'return hit / Math.max(1, uA + uB - hit);'),
  i => run(i, BAD[1], [BAD[0]], LEAD).verdict, 'same',
  i => run(i, BAD[3], BAD.slice(0, 3), LEAD).verdict, 'same');

// The mutation is a LITERAL replacement of the inner loop, not a regex. My first attempt used
// `[^}]*}` and it swallowed the closing brace of _rvStrip, so the "neutered" build did not parse
// and the control threw — a neuter that fails for a reason unrelated to the thing it reverts.
const TOKENISED = [
  "            var _rvP = String(_rvNoise[n] || '').toLowerCase().trim().split(/\\s+/);",
  "            for (var _rvQ = 0; _rvQ < _rvP.length; _rvQ++) {",
  "              if (_rvP[_rvQ].length > 2) s = s.split(_rvP[_rvQ]).join(' ');",
  "            }"
].join('\n');
const WHOLE_STRING = [
  "            var w = String(_rvNoise[n] || '').toLowerCase().trim();",
  "            if (w.length > 2) s = s.split(w).join(' ');"
].join('\n');

neuter('D — the v9.7.692 whole-string strip → the live capture leaks name and vehicle again (control: verdict still right)',
  c => { if (c.indexOf(TOKENISED) < 0) throw new Error('tokenised strip not found — cannot neuter it');
         return c.split(TOKENISED).join(WHOLE_STRING); },
  i => liveTerms(i), 'prefer check back later stop reaching out',
  i => run(i, LIVE_NEW, [LIVE_PRIOR], LEAD).verdict, 'different');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
