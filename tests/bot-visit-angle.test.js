#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('bot-visit-angle.test.js');

/**
 * bot-visit-angle.test.js — v9.7.682. THE TIMES ARE SPENT. THE VISIT IS NOT.
 *
 * Gil, 9/19, relaying Jolette on lead 2086363968 (Skip, Facebook, 2027 Honda HR-V LX):
 *
 *   "agent felt the message didn't play well with the mission to get the customer in. I know
 *    we're not pushing times as The AI already had done that but she feels that pushing a walk
 *    around video or remote walk around isn't encouraging enough. We need to change the angle to
 *    still encouraging a visit without repushing times."
 *
 * The 9/19 export carries her whole attempt: NINE generations between 8:16:41 and 8:18:02, eight
 * thumbed down, add-urgency pressed on seven of them. Every single close is a question about
 * questions, and not one asks the customer to come and see the car. They are the corpus below.
 *
 * THE CAUSE WAS A CONFLATION IN THE BOT BLOCK. Vinessa spent two named slots at 9:33 PM
 * ("Saturday at 10:00 AM or Monday at 10:00 AM"), so the block correctly reported its moves as
 * used up — and then said to ask "one easy question that is not 'when can you come in'", with
 * "change the ask to something smaller and easier to answer" underneath it. Three instructions
 * pointing away from the showroom, so the model retreated to the smallest thing available: a photo.
 *
 * NOT RE-PUSHING TIMES IS UNCHANGED AND IS ASSERTED HERE BOTH WAYS. What changed is that the
 * message may once again ask them in, with the customer choosing when.
 *
 * Executes the SHIPPED bot branch. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: bot-visit-angle.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('        if (_asBot) {');
  if (a < 0) throw new Error('the bot branch was not found');
  const b = src.indexOf('        } else if (!_asMine) {', a);
  if (b < 0) throw new Error('the bot branch end was not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b) + '        }\n' };
}

// Run the shipped branch and collect the lines it pushes into the prompt.
function lines(impl, opts) {
  opts = opts || {};
  const sb = {
    String, JSON,
    ageBlock: [],
    _asBot: true,
    data: { vehicle: opts.vehicle === undefined ? '2027 Honda HR-V LX' : opts.vehicle },
    _lpFirstHumanTouch: () => opts.firstHuman === undefined ? true : !!opts.firstHuman,
    console: { log: () => {} }
  };
  vm.createContext(sb);
  vm.runInContext((opts.mutate ? opts.mutate(impl.code) : impl.code), sb);
  return vm.runInContext('ageBlock', sb).filter(Boolean).join('\n');
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

// ── JOLETTE'S NINE, VERBATIM FROM THE 9/19 EXPORT ───────────────────────────
// Signatures trimmed; these are the closing asks as they reached her panel.
const NINE = [
  'the 2027 Honda HR-V LX in Crystal Black Pearl is here. What questions can I answer for you?',
  'is available here now, so you can see the actual vehicle before deciding. What questions can I answer before you stop by?',
  'is showing available here. Would a quick photo help?',
  'is available here. Would you like to come see it, or do you have any questions?',
  'you asked about is here if you’re still shopping. Did your search go a different direction?',
  'is here now, though inventory can change quickly. Is price the main detail you need before deciding to visit?',
  'is available this morning, but inventory can change quickly. Do you have any questions before you come by?',
  'is here now, so you can see the actual vehicle instead of relying on the Marketplace listing. Is it still on your radar?',
  'is here now, though inventory can change quickly. Would you like to come see it or have me answer any questions?'
];

console.log('\nv9.7.682 — the automated message spent the times, not the visit');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE CORPUS, MEASURED ────────────────────────────────────────────────
// Not a rule and nothing branches on it — it is the evidence that the complaint is real, kept so
// the next change to this block can be judged against the same nine drafts.
console.log('\n(1) what the old wording actually produced, on the lead Gil sent:');

const asksThemIn = t => /\b(come (see|take a look|by|in)|stop by|see it in person)\b/i.test(t);
const offersRemote = t => /\b(photo|photos|picture|video|walkaround|walk\s?around|remotely)\b/i.test(t);
const asksAboutQuestions = t => /\b(any questions|what questions|questions (can|i can|about it))\b/i.test(t);

check('nine drafts were captured for this lead', () => NINE.length, 9);
check('not one of them asks for the visit WITHOUT also offering an escape back to questions',
  () => NINE.filter(t => asksThemIn(t) && !asksAboutQuestions(t)).length, 0);
check('the majority close on a question about questions',
  () => NINE.filter(asksAboutQuestions).length >= 5, true);
check('and one retreats to a photo, which is what Gil named',
  () => NINE.filter(offersRemote).length, 1);
// None of them names a time — the bot rule was working, and it is not what is being fixed.
check('NONE of the nine re-pushed a time, so that rule was never the problem',
  () => NINE.filter(t => /\b(\d{1,2}(:\d{2})?\s*(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i.test(t)).length, 0);

// ── (2) THE SHIPPED DIRECTIVE NOW ASKS FOR THE VISIT ────────────────────────
console.log('\n(2) the block now sends the message somewhere that ends at the showroom:');

check('it says in as many words that the times are spent and the visit is not',
  i => /What the automated message spent is the TIMES IT NAMED, NOT THE VISIT ITSELF/.test(lines(i)), true);
check('it tells the draft to ask them in',
  i => /THEN ASK THEM IN/.test(lines(i)), true);
check('...and hands the timing to the customer rather than proposing one',
  i => /let THEM say when/.test(lines(i)), true);
check('it separates a remote look from a smaller ask, which is the substitution that happened',
  i => /A SMALLER ASK IS NOT A REMOTE ONE/.test(lines(i)), true);
check('...and names the three shapes that replaced the invitation on this lead',
  i => /offering photos, a video walkaround or "any questions\?" IN PLACE OF the invitation/.test(lines(i)), true);
check('the old line that forbade asking for the visit is gone',
  i => /one easy question that is not "when can you come in"/.test(lines(i)), false);
check('"smaller" no longer reads as "less committing" in the restate line either',
  i => /which means fewer words back from them, NOT a smaller commitment/.test(i.src), true);

console.log('\n    and the rule Gil said not to touch is untouched:');
check('naming a day, a time or a slot is still forbidden',
  i => /do not name a day, a time or a slot, and do not offer a menu of them/.test(lines(i)), true);
check('the automated message\'s moves are still spent',
  i => /THE AUTOMATED MESSAGE HAS ALREADY SPENT WHATEVER MOVES IT USED/.test(lines(i)), true);
check('...and a warmer rewrite of it is still named as the failure',
  i => /a warmer, better-written version of that same move is the failure here/.test(lines(i)), true);
check('the remote path is deferred to the lead\'s own facts, not banned outright',
  i => /Offer a remote look only where they asked for one, or where this lead says coming in is genuinely hard/.test(lines(i)), true);

// ── (3) THE NO-VEHICLE ARM IS UNCHANGED (v9.7.640) ──────────────────────────
// That arm exists because a bot-touched lead can carry no vehicle at all, and it must not start
// inviting people to come and see a car that is not there.
console.log('\n(3) v9.7.640 is not disturbed — no vehicle means no invitation to see one:');

check('the no-vehicle arm still refuses to invent a unit',
  i => /THERE IS NO VEHICLE ON THIS LEAD/.test(lines(i, { vehicle: '' })), true);
check('...and does NOT tell that lead to ask them in',
  i => /THEN ASK THEM IN/.test(lines(i, { vehicle: '' })), false);
check('...and still ends on asking what they are shopping for',
  i => /ask what they are shopping for/.test(lines(i, { vehicle: '' })), true);
check('the two arms are genuinely different text',
  i => lines(i) === lines(i, { vehicle: '' }), false);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.682):');

const OLD_ANGLE = c => c.replace(
  /\? 'Spend this touch on something only a person who read the file could say[\s\S]*?genuinely hard for them\.'/,
  "? 'Spend this touch on something only a person who read the file could say — one easy question that is not \"when can you come in\".'");

check('neuter A actually restored the old angle',
  i => { const m = OLD_ANGLE(i.code); return [m !== i.code, /THEN ASK THEM IN/.test(m)]; }, [true, false]);
check('A: the block goes back to forbidding the very ask Jolette wanted',
  i => /one easy question that is not "when can you come in"/.test(lines(i, { mutate: OLD_ANGLE })), true);
check('A: and says nothing about the visit surviving the spent times',
  i => /NOT THE VISIT ITSELF/.test(lines(i, { mutate: OLD_ANGLE })), false);
check('A (control): the shipped block does the opposite on both counts',
  i => [/one easy question that is not "when can you come in"/.test(lines(i)),
        /NOT THE VISIT ITSELF/.test(lines(i))], [false, true]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
