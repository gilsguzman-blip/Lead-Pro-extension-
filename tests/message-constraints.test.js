#!/usr/bin/env node
'use strict';
// (v9.7.612) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('message-constraints.test.js');

/**
 * message-constraints.test.js — v9.7.694. THE AUDIT, PINNED.
 *
 * Gil, 9/23: "We've shown that the model can have constraint with the rails off of length. Audit
 * the entire code for any instances of message constraints, first reach, follow up, showroom,
 * etc...." Then: "Build it and we'll go with your suggestions for the 5."
 *
 * v9.7.689 took the word "short" out of thirteen sites and v9.7.691 took out thirteen counts and
 * both zero-contact skeletons. The audit swept every string literal in the file for size words,
 * sentence/line/paragraph counts, caps, stop-instructions, structure templates and ask counts, and
 * found what those two builds had not reached — including the two that fire on EVERY lead:
 *
 *   FORMAT RULES, every email:  "Keep it to 2-3 paragraphs max."
 *   _LP_SMS_SHAPE_RULE, every SMS: "short lines a person would actually thumb into a phone" —
 *     an adjective left inside a rule that says outright "THERE IS NO SENTENCE COUNT AND NO
 *     LENGTH TO HIT".
 *
 * This suite pins every decision the audit made, in both directions: what was removed stays
 * removed, what each line was FOR is still said, and what was deliberately KEPT is still there —
 * so a later sweep that reads only the word cannot take the bereavement rule or the opt-out path.
 *
 * Scans run on the comment-stripped body BELOW the last build header, because headers and
 * comments quote the removed phrases verbatim (v9.7.630).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: message-constraints.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const L = src.split('\n');
  const first = L.findIndex(l => !l.startsWith('// Lead Pro -- popup.js'));
  const bodyLines = L.slice(first);
  const code = bodyLines.filter(l => !/^\s*\/\//.test(l)).join('\n');

  // The shape rule, EXECUTED rather than scanned, so a string built by concatenation cannot hide.
  const shapeLine = L.find(l => l.startsWith('var _LP_SMS_SHAPE_RULE = '));
  if (!shapeLine) throw new Error('_LP_SMS_SHAPE_RULE not found');
  const sb1 = {}; vm.createContext(sb1); vm.runInContext(shapeLine, sb1);

  // The hoisted preamble, executed, and located against inlineScraper's own boundaries.
  const open = L.findIndex(l => l === '  function inlineScraper() {');
  const close = L.findIndex(l => l.trim().startsWith('} // end inlineScraper'));
  const defIdx = L.findIndex(l => /^\s*var _LP_AGENT_CONTEXT_PREAMBLE = '/.test(l));
  if (defIdx < 0) throw new Error('v9.7.694 _LP_AGENT_CONTEXT_PREAMBLE definition not found');
  const sb2 = {}; vm.createContext(sb2); vm.runInContext(L[defIdx].trim(), sb2);
  const refs = L.map((l, i) => (!/^\s*\/\//.test(l) && l.indexOf('_LP_AGENT_CONTEXT_PREAMBLE') >= 0) ? i : -1).filter(i => i >= 0);

  return { name: path.basename(path.dirname(file)), src, code,
           shape: sb1._LP_SMS_SHAPE_RULE, preamble: sb2._LP_AGENT_CONTEXT_PREAMBLE,
           scraper: { open, close }, defIdx, refs };
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
const has = (i, s) => i.code.indexOf(s) >= 0;

console.log('\nv9.7.694 — the message-constraint audit, pinned');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── EVERY LEAD ────────────────────────────────────────────────────────────────────────────
console.log('\nthe two that fired on every lead:');
check('FORMAT RULES no longer caps every email at "2-3 paragraphs max"',
  i => has(i, 'Keep it to 2-3 paragraphs max'), false);
check('...and still says how paragraphs are separated',
  i => has(i, "'- Paragraphs: one blank line between paragraphs.'"), true);
check('the SMS shape rule (executed) no longer says "short lines"',
  i => /short lines/.test(i.shape), false);
check('...still describes a text as something a person would thumb into a phone',
  i => /lines a person would actually thumb into a phone/.test(i.shape), true);
check('...and still says there is no length to hit',
  i => /THERE IS NO SENTENCE COUNT AND NO LENGTH TO HIT/.test(i.shape), true);

// ── SKELETONS ─────────────────────────────────────────────────────────────────────────────
console.log('\n  the two remaining message skeletons are gone:');
[['trade-tool "EXACT ORDER — FOUR DISTINCT PARAGRAPHS"', 'WRITE THE MESSAGE IN THIS EXACT ORDER'],
 ['trade-tool numbered paragraphs', "'PARAGRAPH 1 (OPENER)"],
 ['trade-tool "ONE LINE ONLY"', 'STANDS ALONE, ONE LINE ONLY'],
 ['velocity-response "Structure: … + ONE light qualifying question"', 'Structure: Acknowledge inquiry + ONE light']
].forEach(([l, s]) => check('removed — ' + l, i => has(i, s), false));
check('the trade-tool path still says what the message must DO, in any shape',
  i => ['WHAT THE MESSAGE HAS TO DO — IN WHATEVER SHAPE READS NATURALLY', '- OPEN ON THE TRADE:', '- THE ASK:',
        '- OPTIONAL, ONLY IF IT FITS NATURALLY: the soft on-brand mention', '- CLOSE: Time-of-day question']
        .every(s => has(i, s)), true);
check('the velocity example is labelled as an illustration, not a script (v9.7.688 template lesson)',
  i => has(i, "'- For illustration only, not a script to copy:"), true);

// ── SIZE WORDS, BY SCENARIO ───────────────────────────────────────────────────────────────
console.log('\n  size words removed, by scenario — and what each line was FOR is still said:');
const SIZE = [
  ['first reach, after phone attempts', 'Still keep it warm and brief', 'Still keep it warm'],
  ['first reach, still shopping', 'still-shopping is brief and low-pressure', 'still-shopping is low-pressure, not a close.'],
  ['first reach, bot-authored no vehicle', 'The right message here is SHORT', 'The right message here is a '],
  ['follow-up, re-engagement', 'acknowledge the gap briefly', 'Keep it light: acknowledge the gap,'],
  ['follow-up, thin reply', 'Acknowledge their reply briefly', 'Acknowledge their reply, then move'],
  ['follow-up, settled plan', 'Write ONE brief warm confirmation', 'Write a warm confirmation'],
  ['follow-up, settled plan (0.)', 'write a brief warm confirmation', 'stop and write a warm confirmation'],
  ['follow-up, past friction', 'acknowledge briefly if the most recent', 'acknowledge it if the most recent message hints at it'],
  ['follow-up, trade declined', 'no-trade in one line', 'Acknowledge it as no-trade and move'],
  ['cadence value role', 'minimal preamble', 'Fact-forward.'],
  ['showroom / appointment confirmation', 'Keep it brief and warm — they are already coming in', 'Keep it warm — they are already coming in.'],
  ['sold, customer reached out', "'- Keep it brief. Tone: friend checking in.'", "'- Tone: friend checking in.'"],
  ['sold, service visit', 'Write a brief satisfaction check', 'Write a satisfaction check'],
  ['exit / not ready', 'A respectful, brief message', 'A respectful message that gives them room'],
  ['cross-brand prior buyer', 'one welcome-back line + one question', 'welcome them back and ask what brings them in'],
  ['Audi Lafayette drive-out', 'Explain briefly that the exact drive-out', 'Explain that the exact drive-out depends'],
  ['Click & Go (credit app)', 'by name once — briefly, naturally', 'by name once, naturally.'],
  ['Click & Go (other action)', 'email — briefly and naturally', 'by name once in BOTH SMS and email, naturally.'],
  ['EXPAND chip', 'Aim for two to four sentences', 'Add real value, never filler to hit a length.']
];
SIZE.forEach(([label, gone, kept]) =>
  check(label, i => [has(i, gone), has(i, kept)], [false, true]));

// ── ASK COUNTS ────────────────────────────────────────────────────────────────────────────
// "remove the ask rules also or phrase it differently as to not imply a limit on the ask."
console.log('\n  ask counts rephrased so they do not imply a limit on the ask:');
const ASK = [
  ['first reach, no vehicle', 'Include ONE qualifying question', 'Include a qualifying question'],
  ['first reach, fresh inquiry', 'move to one concrete next step', 'move to a concrete next step'],
  ['follow-up, fresh signal', 'Close with one concrete next step', 'Close with a concrete next step'],
  ['showroom follow-up', 'one specific next step, not a generic appointment push', 'a specific next step, not a generic appointment push'],
  ['stalled PHASE 2', 'Ask ONE low-effort question', 'Ask a low-effort question'],
  ['bot, no vehicle', 'One question, easy to answer in a few words', 'A question, easy to answer in a few words'],
  ['friction apology', 'no second question', 'nothing they would have to do'],
  ['VOI family either/or', 'Name BOTH distinctly in ONE direct question', 'Name BOTH distinctly in a direct question']
];
ASK.forEach(([label, gone, kept]) =>
  check(label, i => [has(i, gone), has(i, kept)], [false, true]));

// ── THE PREAMBLE: ONE DEFINITION, INSIDE THE SERIALISED FUNCTION ──────────────────────────
console.log('\n  the AGENT CONTEXT preamble — one copy, and it travels with inlineScraper:');
check('its either/or no longer counts the question (executed)',
  i => [/Ask ONE direct question/.test(i.preamble), /Ask them directly, naming both distinctly/.test(i.preamble)], [false, true]);
check('it still opens the way both copies did',
  i => /^AGENT CONTEXT — READ THIS FIRST\./.test(i.preamble), true);
check('exactly one definition and two consumers',
  i => i.refs.length, 3);
check('the definition and both consumers sit INSIDE inlineScraper — a module constant would not travel',
  i => i.refs.every(r => r > i.scraper.open && r < i.scraper.close), true);
check('no literal copy of the preamble survives in either branch',
  i => /var notePrefix2? = 'AGENT CONTEXT/.test(i.code), false);

// ── THE FIVE DECISIONS ────────────────────────────────────────────────────────────────────
// Gil, 9/23: "we'll go with your suggestions for the 5."
console.log('\n  the five decisions, as made:');
check('Costco / Car Pro: no scenario carries the two-time CLOSE mandate any more',
  i => (i.code.match(/'- CLOSE: Two specific appointment times\.'/g) || []).length, 0);
// (v9.7.698) AUDIT M3 removed the second scenarioRules render, and with it both inert filters.
check('...and the inert appointment-suppression filters for it are gone with the duplicate render (v9.7.698 M3)',
  i => (i.code.match(/indexOf\('CLOSE: Two specific appointment times'\)/g) || []).length, 0);
check('...and TIME-OFFER VARIETY, which the mandate contradicted, is untouched',
  i => has(i, 'is ONE closing tool, not a required ending'), true);
check('same-day evening: the scripted close line is gone, the intent is kept',
  i => [has(i, '\'- Close: "Can you make it in tonight?"'), has(i, "'- Close directly on tonight — not passive")], [false, true]);
// (v9.7.699) Gil, 9/23: "drop all the length rules". The bereavement count was kept here in v9.7.694; it goes now.
check('v9.7.699 — bereavement: a sincere condolence, no sentence count',
  i => [has(i, '(2-3 sentences)'), has(i, 'Write ONLY a sincere condolence: acknowledge')], [false, true]);
check('KEPT — secondary angles: "pick AT MOST ONE" stops offers being stacked, it does not limit length',
  i => has(i, 'pick AT MOST ONE that best fits this specific touch'), true);
check('KEPT — the settled-plan voicemail size, consistent with the spared voicemail target',
  i => has(i, "'- Voicemail: 20-30 seconds, natural speech, one clear ask.'"), true);

// ── SPARED, OR NOT A CONSTRAINT ───────────────────────────────────────────────────────────
console.log('\n  spared or not a constraint — still exactly where they were:');
[['subject line 4-8 words (Gil, 9/10)', 'Short is better — 4-8 words'],
 ['appointment-day close (WHICH times, not how many words)', 'Your ONLY close is two times on the day the customer named. Nothing else.'],
 ['voicemail-only: 20-30 seconds kept, word count dropped (Gil, 9/23)', 'Natural spoken cadence, 20-30 seconds, three beats:'],
 ['SHORTEN chip (agent asks for it)', 'Shorten the message to roughly 60-70%'],
 ['ONE THOUGHT PER SENTENCE (rhythm, v9.7.673)', 'ONE THOUGHT PER SENTENCE'],
 ['register-matching, without the size instruction (v9.7.699)', 'Match the register of what they sent.'],
 ['refine: length is the model\'s call', 'LENGTH IS YOURS TO JUDGE'],
 ['anti-constraint: short is never a reason to drop an ask', 'The SMS being short is never a reason to drop one']
].forEach(([l, s]) => check('kept — ' + l, i => has(i, s), true));

// ── NON-VACUITY ───────────────────────────────────────────────────────────────────────────
console.log('\nnon-vacuity — reverting a decision must fail by name, with a control:');
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
neuter('A — preamble declared at module scope → it would not travel into the CRM frame (control: its text is still right)',
  i => Object.assign(i, { refs: [i.scraper.open - 50].concat(i.refs.slice(1)) }),
  i => i.refs.every(r => r > i.scraper.open && r < i.scraper.close), true,
  i => /Ask them directly, naming both distinctly/.test(i.preamble), true);
neuter('B — the every-email paragraph cap put back (control: the format line itself survives)',
  i => Object.assign(i, { code: i.code.split("'- Paragraphs: one blank line between paragraphs.'")
                                        .join("'- Paragraphs: one blank line between paragraphs. Keep it to 2-3 paragraphs max.'") }),
  i => has(i, 'Keep it to 2-3 paragraphs max'), false,
  i => has(i, '- Paragraphs: one blank line between paragraphs.'), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
