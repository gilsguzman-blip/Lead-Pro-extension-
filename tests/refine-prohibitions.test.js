#!/usr/bin/env node
'use strict';
// (v9.7.612) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('refine-prohibitions.test.js');

/**
 * refine-prohibitions.test.js — v9.7.689. A RULE ENFORCED AT ONE STAGE OF A TWO-STAGE PIPELINE
 * IS ENFORCED ON THE DRAFT NOBODY SEES.
 *
 * LIVE, 9/22, lead 2059585201, the SECOND generation of the session — the first run of v9.7.688
 * that actually exercised the draft history. It worked: generation 1 made the CHANNEL move,
 * generation 2 made a different one, and pass1 came back clean —
 *
 *   pass1: "Christina, I know the 2026 Kia Carnival LX FWD inquiry has gone quiet.
 *           Should I check back later, or leave this alone?"
 *
 * Then the SMS refine pass rewrote it, and THIS is what shipped:
 *
 *   pass2: "Christina, if you're still interested in the 2026 Kia Carnival LX FWD, I can check
 *           in with you and make sure we're aligned on the next step. Would you like me to check
 *           back now, or is it better to leave this alone for now?"
 *
 * "if you're still interested in the 2026 Kia Carnival LX FWD" is the exact construction v9.7.688
 * banned, with the vehicle inserted — which is the precise hole v9.7.688 closed BY NAME. The email
 * on the same generation is clean, because the email does not go through this pass.
 *
 * IT WAS NOT DISOBEDIENCE. _lpBuildSmsRefinePrompt carries the email, the customer's last message,
 * their open questions and pass1. It carries NOTHING about which rung is active or what it forbids.
 * The ban lived only in the main generation.
 *
 * This suite EXECUTES the shipped collector and the shipped refine-prompt builder, and pins the
 * v9.7.689 length-language removal — including, by name, the three paths that were deliberately
 * SPARED, so a later sweep cannot quietly take them too.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: refine-prohibitions.test.js <popup.js> [popup.js...]'); process.exit(2); }

const START = '    var stalledMarkerIdx = ';
const END   = " rule(s) carried into the SMS refine pass | phase:' + stalledPhase);";

function bodyOf(src) {
  const i = src.lastIndexOf('// Lead Pro -- popup.js  v');
  if (i < 0) throw new Error('no build header found');
  const j = src.indexOf('\n', i);
  return src.slice(j < 0 ? i : j + 1);
}
const stripComments = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const body = bodyOf(src);

  // The ladder, lifted past the v9.7.689 collector — stalled-phase.test.js stops one line short of
  // it on purpose, so this suite takes the longer slice rather than widening that one's.
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('stalled ladder + prohibition collector not found');
  const block = src.slice(a, b + END.length);
  if (block.indexOf('_lpActiveProhibitions') < 0) throw new Error('v9.7.689 collector missing from the ladder');

  const eh = src.indexOf('function _lpCloseOutEligible(');
  if (eh < 0) throw new Error('_lpCloseOutEligible not found');
  let ed = 0, started = false, eend = -1;
  for (let i = eh; i < src.length; i++) {
    if (src[i] === '{') { ed++; started = true; }
    else if (src[i] === '}') { ed--; if (started && ed === 0) { eend = i + 1; break; } }
  }

  const ladder = new vm.Script(
    '(function(ctx_raw, ageDays_final, data, window){\n var lines = []; var logs = [];\n' +
    'var console = { log: function(){ logs.push(Array.prototype.join.call(arguments, " ")); } };\n' +
    src.slice(eh, eend) + '\n' + block +
    '\nreturn { phase: stalledPhase, lines: lines, logs: logs,' +
    ' carried: (window && window._lpActiveProhibitions) || null }; })'
  ).runInNewContext({ String, RegExp, Array, parseFloat, isNaN });

  // The refine user-prompt builder, lifted whole and executed.
  const rh = body.indexOf('function _lpBuildSmsRefinePrompt(');
  if (rh < 0) throw new Error('_lpBuildSmsRefinePrompt not found');
  let rd = 0, rstarted = false, rend = -1;
  for (let i = rh; i < body.length; i++) {
    if (body[i] === '{') { rd++; rstarted = true; }
    else if (body[i] === '}') { rd--; if (rstarted && rd === 0) { rend = i + 1; break; } }
  }
  const refineSrc = body.slice(rh, rend);
  if (refineSrc.indexOf('_lpActiveProhibitions') < 0) throw new Error('v9.7.689 refine injection missing');

  return { name: path.basename(path.dirname(file)), src, body, code: stripComments(body),
           ladder, refineSrc };
}

function runRefine(impl, prohibitions, extra) {
  const sb = { String, Array, JSON,
               window: { _lpActiveProhibitions: prohibitions } };
  vm.createContext(sb);
  vm.runInContext(impl.refineSrc, sb);
  sb.__d = Object.assign({ lastInboundMsg: '' }, extra || {});
  return vm.runInContext(
    '_lpBuildSmsRefinePrompt("Christina, I know the 2026 Kia Carnival LX FWD inquiry has gone quiet. ' +
    'Should I check back later, or leave this alone?", ' +
    'JSON.stringify(0) + "Hi Christina, I know we have not connected about the Carnival, and I do not want ' +
    'to keep adding messages if now is not the right time. Should I check back later, or leave this alone? Melanie", ' +
    '__d)', sb);
}

// Christina's arc: 9 outbound touches, never replied, 55 days.
const ctx = n => Array.from({ length: n }, () => 'Outbound Text Message').join('\n');
const GHOST = { leadAgeDays: 55, hasCustomerReply: false, convState: 'active-follow-up',
                relationshipSignals: { totalOutboundCount: 23, lastInboundAgeDays: null } };

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

const ladder = (impl, n, data) => { const w = {}; return impl.ladder(ctx(n), 55, data || GHOST, w); };

console.log('\nv9.7.689 — the rewrite is bound by the rules the first draft was written under');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── THE COLLECTOR ─────────────────────────────────────────────────────────────────────────
console.log('the stalled block records what it forbade:');

check('a close-out lead carries prohibitions forward',
  i => ladder(i, 9).carried.length > 0, true);

check('the still-interested test is one of them, verbatim',
  i => ladder(i, 9).carried.some(p => /THE TEST IS NOT THE WORDS, IT IS THE QUESTION/.test(p)), true);

check('...and so is the appointment ban',
  i => ladder(i, 9).carried.some(p => /DO NOT offer appointment times/.test(p)), true);

check('the close-out rung adds its assert-nothing rule — the one a rewrite would "improve"',
  i => ladder(i, 9).carried.some(p => /ASSERT NOTHING about what they did or why they went quiet/.test(p)), true);

check('a lower rung carries the shared bans but NOT the close-out-only one',
  i => { const c = ladder(i, 2).carried;
         return [c.length > 0,
                 c.some(p => /THE TEST IS NOT THE WORDS/.test(p)),
                 c.some(p => /ASSERT NOTHING/.test(p))]; }, [true, true, false]);

check('every carried rule is also PUSHED into the main prompt — one wording, not two',
  i => { const r = ladder(i, 9);
         const joined = r.lines.join('\n');
         return r.carried.filter(p => !/ASSERT NOTHING/.test(p)).every(p => joined.indexOf(p) >= 0); }, true);

check('the diagnostic names the count and the phase',
  i => /\[LP ACTIVE PROHIBITIONS DIAG\] 3 rule\(s\) carried into the SMS refine pass \| phase:PHASE 5/
         .test(ladder(i, 9).logs.join(' ')), true);

// ── THE REFINE PROMPT ─────────────────────────────────────────────────────────────────────
console.log('\n  and the refine pass is told them:');

check('no active prohibitions → the refine prompt is unchanged (every ordinary lead)',
  i => /RULES THE FIRST DRAFT WAS WRITTEN UNDER/.test(runRefine(i, [])), false);

check('...also when the list is absent entirely',
  i => /RULES THE FIRST DRAFT WAS WRITTEN UNDER/.test(runRefine(i, undefined)), false);

check('a close-out lead\'s rules DO reach the refine prompt',
  i => /RULES THE FIRST DRAFT WAS WRITTEN UNDER/.test(runRefine(i, ladder(i, 9).carried)), true);

check('the still-interested test arrives verbatim, not paraphrased',
  i => runRefine(i, ladder(i, 9).carried)
         .indexOf('if the only sensible answers to what you wrote are "yes, still interested"') >= 0, true);

check('all three rules render',
  i => (runRefine(i, ladder(i, 9).carried).match(/^ {2}• /gm) || []).length, 3);

check('it says a rewrite is still bound by them',
  i => /A REWRITE IS STILL BOUND BY THEM/.test(runRefine(i, ladder(i, 9).carried)), true);

check('...and tells it to keep the first draft\'s wording rather than reintroduce what they forbid',
  i => /keep the first draft’s wording for that part rather than reintroducing what these forbid/
         .test(runRefine(i, ladder(i, 9).carried)), true);

check('the section sits AFTER the first draft, so it is read as a constraint on the rewrite',
  i => { const o = runRefine(i, ladder(i, 9).carried);
         return o.indexOf('THIS IS WHAT YOU ARE REPLACING') < o.indexOf('RULES THE FIRST DRAFT WAS WRITTEN UNDER'); }, true);

// The pass that produced the violation must not be able to produce it again unseen.
check('the shipped pass2 text would now contradict a rule present in its own prompt',
  i => { const o = runRefine(i, ladder(i, 9).carried);
         return /still interested/.test(o) && /DO NOT ask whether they are still interested/.test(o); }, true);

// ── THE RESET ─────────────────────────────────────────────────────────────────────────────
console.log('\n  cleared every generation, so a close-out lead\'s rules cannot reach the next lead:');

check('generateAll clears the list before the prompt is built',
  i => { const g = i.code.indexOf('async function generateAll()');
         const c = i.code.indexOf('window._lpActiveProhibitions = []', g);
         const r = i.code.indexOf('_lpFeedbackReset();', g);
         return g > 0 && c > g && c > r; }, true);

check('only the stalled block ever populates it',
  i => (i.code.match(/_lpActiveProhibitions = _stalledProhibitions/g) || []).length, 1);

// ── THE LENGTH LANGUAGE IS GONE ───────────────────────────────────────────────────────────
// Gil, 9/22: "I'd rather not have any reference to 'short' as it builds constraints. Let the
// model do its thing." Scanned on the comment-stripped body: the v9.7.689 note NAMES the two
// lines it removed, which is the v9.7.630 prose-match shape if scanned raw.
console.log('\n  the size instructions are gone from the SMS and email body (Gil, 9/22):');

const GONE = [
  ["the close-out rung's own size word", 'Short, warm, no pitch'],
  ['SMS: Short.', "SMS: Short."],
  ['EMAIL: Two short paragraphs max', 'Two short paragraphs max'],
  ['EMAIL: Two short paragraphs (first-touch)', 'EMAIL: Two short paragraphs. Warm reference'],
  ['showroom "keep it short and warm"', 'Keep it short and warm'],
  ['showroom "Short and genuine"', 'Short and genuine.'],
  ['post-visit "keep it short"', 'Keep it short and pick the next step'],
  ['Facebook "Short sentences."', 'Short sentences. Contractions.'],
  ['declined "a short, gracious close"', 'Write a short, gracious close'],
  ['the clarify line\'s "one short line"', 'one short line'],
  ['the live-at-store size cap', 'one or two short sentences'],
  ['the email skeleton\'s "Short warm opener"', 'Sentence 1: Short warm opener'],
  ['the no-phone "short note"', 'write a short note asking']
];
GONE.forEach(([label, needle]) =>
  check('removed — ' + label, i => i.code.indexOf(needle) >= 0, false));

// (v9.7.691) These two lines lost their COUNTS as well as their size word. "One observation or
// question" and "one simple question" cap the message just as "Short." did, and the second one
// also reads as a limit on the ask, which Gil ruled out. What they were for — a text that reads
// like a person, an email that ends somewhere easy to answer — is what is asserted now.
check('what those lines were FOR survives on the close-out rung',
  i => { const r = ladder(i, 9).lines.join('\n');
         return [/SMS: Reads like a real person wrote it, not a memo\./.test(r),
                 /EMAIL: End on something they can answer without effort\. No close\./.test(r)]; }, [true, true]);

// ── AND THE SPARED PATHS ARE STILL SPARED ─────────────────────────────────────────────────
// Gil chose "SMS + email body, spare the 3 special paths". Pinned by name so a later sweep
// cannot quietly take them: two exist for reasons other than length, one he settled on 9/10.
console.log('\n  the three spared paths, and the lines that REMOVE constraints, are untouched:');

const KEPT = [
  ['the voicemail word target — it is spoken, not read', 'about 60-80 words, three short beats'],
  ['the 4-8 word subject rule — Gil settled it 9/10', 'Short is better — 4-8 words'],
  ['the SHORTEN chip — the agent asks for it by hand', 'Shorten the message to roughly 60-70%'],
  ['"being short is not a reason to drop an ask"', 'Being short is not'],
  ['"the SMS being short is never a reason to drop one"', 'The SMS being short is never a reason'],
  ['"a format being short is never a reason"', 'a format being short is never a reason'],
  ['depth-matching — conditioned on what THEY sent', 'Short reply → short response'],
  ['sentence-rhythm guidance, which is not a cap', 'A short sentence after a long one creates impact']
];
KEPT.forEach(([label, needle]) =>
  check('kept — ' + label, i => i.code.indexOf(needle) >= 0, true));

// ── (v9.7.691) THE COUNTS GO TOO ─────────────────────────────────────────────────────────
// Gil, 9/22, reading a v9.7.690 prompt: "Isn't that 'one Sentence' building length constraint
// also though?" He was right, and the one left behind was worse than the word removed. v9.7.689
// took the ADJECTIVE and left the COUNTS, and a count is the harder constraint — "short" is vague
// enough to be ignored, "Para 2 (1 sentence)" is not. The zero-contact block was the worst of it:
// a sentence-by-sentence SMS skeleton and a paragraph-by-paragraph email skeleton, both headed
// "write exactly this structure".
console.log('\n  the count-based caps are gone too (Gil, 9/22 — "one Sentence" is a length constraint):');

const CAPS = [
  ['the zero-contact SMS skeleton\'s sentence numbering', 'Sentence 1:'],
  ['...and its second sentence cap with "End there."',  'Sentence 2:'],
  ['the email skeleton\'s paragraph sentence counts',    'Para 1 (2-3 sentences)'],
  ['...and its one-sentence second paragraph',          'Para 2 (1 sentence)'],
  ['"STOP THERE"',                                      'STOP THERE'],
  ['both "write exactly this structure" headers',       'write exactly this structure'],
  ['the cadence curiosity role\'s "One line"',          'One line, low-pressure'],
  ['the first-touch email\'s "Nothing else."',          'End with ONE easy question about their search or interest. Nothing else.'],
  ['the first-touch SMS three-slot template',           'one specific observation about the vehicle'],
  ['the shape rule\'s "costs one short sentence"',      'costs one short sentence'],
  ['...its "ONE SHORT SENTENCE answering it"',          'ONE SHORT SENTENCE answering it'],
  ['...and its "it is one line, and it is cheap"',      'it is one line, and it is cheap'],
  ['v9.7.689\'s own "One observation or question"',     'SMS: One observation or question']
];
CAPS.forEach(([label, needle]) => check('removed — ' + label, i => i.code.indexOf(needle) >= 0, false));

// ── AND THE ASK RULES NO LONGER COUNT THE ASK ────────────────────────────────────────────
// "remove the ask rules also or phrase it differently as to not imply a limit on the ask."
// Rephrased rather than removed, because what they are FOR is real: v9.7.679 already settled
// that the test is whether ONE REPLY CAN ANSWER IT, explicitly NOT how many things you mentioned.
// They now point at that test instead of counting questions.
console.log('\n  the ask rules point at the reply test instead of counting questions:');

check('the close-out rung no longer says "ask ONE question"',
  i => i.code.indexOf('ask ONE question that lets THEM') >= 0, false);

check('...it asks where they stand, and names the reply test as THE test',
  i => { const a = ladder(i, 9).lines.join('\n');
         return [/ask them where this stands/.test(a),
                 /The test is whether one reply can answer you/.test(a)]; }, [true, true]);

check('...and says outright that it is not a limit on questions or words',
  i => /NOT how many questions you asked or how few words you used/.test(ladder(i, 9).lines.join('\n')), true);

check('the stalled email line no longer says "one simple question"',
  i => i.code.indexOf('End with one simple question') >= 0, false);

check('the exit rule keeps "do not fuse them" without the sentence count',
  i => [i.code.indexOf('not both fused into one sentence') >= 0,
        i.code.indexOf('not both fused together') >= 0], [false, true]);

// ── WHAT SURVIVES, AND WHY ───────────────────────────────────────────────────────────────
// Not every "one X" is a length cap. These four are pinned so a later sweep reading only the
// word cannot take them: two are content rules, one is the spared compliance path, and one is
// the anti-cramming mechanism v9.7.673 kept deliberately when the delete-list came out.
console.log('\n  the "one X" lines that are NOT length caps survive:');

const NOT_CAPS = [
  ['the appointment-day rule — a content rule about WHICH times', 'Your ONLY close is two times on the day the customer named. Nothing else.'],
  // (v9.7.698) AUDIT M5 removed the block that carried "GOAL: Get their first reply. Nothing else." -- it
  // contradicted PHASE 5 on the same leads. It left with its block, not as a length cap.
  ['ONE THOUGHT PER SENTENCE — rhythm, kept by v9.7.673',         'ONE THOUGHT PER SENTENCE'],
  ['the signature format rule',                                   'End with the stacked signature']
];
NOT_CAPS.forEach(([label, needle]) => check('kept — ' + label, i => i.code.indexOf(needle) >= 0, true));

// The warmth clause was ARGUING that warmth is cheap. The argument must survive losing its
// measurements, or this edit traded a length cap for the defect v9.7.676 was built to fix.
check('the warmth argument survives without its measurements',
  i => [/a PERSON answers that first, and it costs almost nothing to do/.test(i.code),
        /answer it before anything else/.test(i.code),
        /It comes BEFORE it, and it is cheap/.test(i.code)], [true, true, true]);

// ── NON-VACUITY ───────────────────────────────────────────────────────────────────────────
console.log('\nnon-vacuity — reverting each decision must fail assertions by name:');

function neuter(label, mutate, probe, wantBroken, control, wantControl) {
  const results = impls.map(i => {
    let m;
    try { m = mutate(Object.assign({}, i)); } catch (e) { return 'MUTATE THREW: ' + e.message; }
    let broken, ctl;
    try { broken = JSON.stringify(probe(m)); } catch (e) { broken = 'THREW'; }
    try { ctl = JSON.stringify(control(m)); } catch (e) { ctl = 'THREW'; }
    return JSON.stringify([broken !== JSON.stringify(wantBroken), ctl === JSON.stringify(wantControl)]);
  });
  report(label, results, [true, true]);
}

neuter('A — refine never renders the rules → the 9/22 pass2 is free again (control: pass1 still shown)',
  i => Object.assign(i, { refineSrc: i.refineSrc.replace('if (_rfProh.length) {', 'if (false) {') }),
  i => /RULES THE FIRST DRAFT WAS WRITTEN UNDER/.test(runRefine(i, ladder(i, 9).carried)), true,
  i => /THIS IS WHAT YOU ARE REPLACING/.test(runRefine(i, ladder(i, 9).carried)), true);

neuter('B — the rules are paraphrased instead of carried verbatim (control: section still renders)',
  i => Object.assign(i, { refineSrc: i.refineSrc.replace(
        "_rfProh.forEach(function (p) { out.push('  \\u2022 ' + String(p || '').trim()); });",
        "out.push('  \\u2022 Do not ask if they are still interested.');") }),
  i => runRefine(i, ladder(i, 9).carried)
         .indexOf('if the only sensible answers to what you wrote are "yes, still interested"') >= 0, true,
  i => /RULES THE FIRST DRAFT WAS WRITTEN UNDER/.test(runRefine(i, ladder(i, 9).carried)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
