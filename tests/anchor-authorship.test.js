#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('anchor-authorship.test.js');

/**
 * anchor-authorship.test.js — v9.7.591. TWO FABRICATIONS ON TROY NOEL'S LEAD.
 *
 * Lead 2073356549, Community Honda Baytown, 8/27, rescanned on v9.7.589.
 *
 * ── (1) THE HANG-UP COUNT ─────────────────────────────────────────────────────────────────
 * The close-override shipped: "Customer has hung up on 11 calls. Phone is not working."
 * Troy's record — read straight out of the 8/27 DOM dump — carries exactly ONE hang-up note:
 *
 *     08/27/2026 2:52 PM | Outbound phone call (No Contact) | By: Kaylee Guzman | hung up during screening
 *
 * Logged by OUR agent during dialer screening. Not the customer, and not eleven times.
 *
 * The 11 came from sbTotal — texts + calls + emails, i.e. every outreach attempt. sbHungUp was
 * only ever a BOOLEAN (.test(): does the phrase appear anywhere) and sbTotal was silently standing
 * in for a count nobody computed. The two were never the same quantity.
 *
 * It also scaled with our own progress: the SAME lead read "6" on v9.7.585 and "11" on v9.7.589,
 * because the v9.7.589 transcript fix handed the tally more text to count. Every future context
 * improvement inflated the fabrication further — which is the reason this could not wait.
 *
 * And "Phone is not working" was asserted flat. A hang-up says somebody ended a call. It does not
 * say the line is broken, and nothing in Troy's record does either.
 *
 * ── (2) THE OWNERSHIP CLAIM ───────────────────────────────────────────────────────────────
 * "YOUR LAST SUBSTANTIVE MESSAGE TO THIS CUSTOMER" was titled that unconditionally. On this lead
 * it quoted Yvonne Ortega's 8/27 email while Kaylee Guzman was the signing agent — 34 lines above
 * the rule that says do not claim ownership of messages you did not send.
 *
 * Not an edge case. Troy's lead passed System -> Samantha Lopez -> Kaylee Guzman inside three
 * minutes, so at Community rooftops the newest substantive outbound very often is not the signer's.
 *
 * VinSolutions already carries the author IN the note body — "By: <name>" on calls/emails/notes,
 * "Sent by: <name>" on texts — so this needs no new scrape plumbing.
 *
 * ── THE FABRICATION THAT WOULD POINT THE OTHER WAY ────────────────────────────────────────
 * If the author cannot be recovered, claiming "someone else wrote this" is the same invention
 * wearing the opposite sign. _lpSameAgent returns TRUE on an unknown author or an unknown signer,
 * so the wording falls back to the old heading rather than manufacturing a second author.
 *
 * Driven against the SHIPPED helpers. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: anchor-authorship.test.js <popup.js> [popup.js...]'); process.exit(2); }

// Pull the three shipped module-scope helpers out and RUN them. Source-scanning proves a string
// exists in a file; this class of bug has shipped past that check twice this week.
function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sb = { String, RegExp };
  vm.createContext(sb);
  // (v9.7.639) _lpIsBotAuthor closes over a module-scope regex. The loop below lifts function
  // declarations only, so without this the helper loads fine and throws ReferenceError the moment
  // it is CALLED — a suite that passes until the first assertion that matters.
  const bre = src.match(/^var _LP_BOT_AUTHOR_RE = .*$/m);
  if (!bre) throw new Error('_LP_BOT_AUTHOR_RE not found in ' + file);
  vm.runInContext(bre[0], sb);
  for (const name of ['_lpHangUpCount', '_lpAuthorRaw', '_lpIsBotAuthor', '_lpOutboundAuthor', '_lpSameAgent']) {
    const h = src.indexOf('function ' + name + '(');
    if (h < 0) throw new Error(name + ' not found in ' + file);
    let d = 0, started = false, end = -1;
    for (let i = h; i < src.length; i++) {
      if (src[i] === '{') { d++; started = true; }
      else if (src[i] === '}') { d--; if (started && d === 0) { end = i + 1; break; } }
    }
    vm.runInContext(src.slice(h, end), sb);
  }
  return {
    name: path.basename(path.dirname(file)),
    src,
    count:  t => vm.runInContext('_lpHangUpCount', sb)(t),
    author: (t, signer) => vm.runInContext('_lpOutboundAuthor', sb)(t, signer),
    same:   (a, b) => vm.runInContext('_lpSameAgent', sb)(a, b),
    raw:    t => vm.runInContext('_lpAuthorRaw', sb)(t),
    isBot:  t => vm.runInContext('_lpIsBotAuthor', sb)(t)
  };
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

// Troy's 14 notes as the context blob reaches the situation brief — one note per line, verbatim
// types and authors from the 8/27 dump. Exactly one line carries a hang-up.
const TROY_CTX = [
  '[08/27/2026 2:52 PM] Outbound phone call (No Contact) By: Kaylee Guzman hung up during screening',
  '[08/27/2026 12:17 PM] Lead Log By: Kristen Willis Manager Changed From System to BJ Wilson',
  '[08/27/2026 9:42 AM] Email reply to prospect By: Yvonne Ortega Troy, did you know that Community Group proudly supports Baytown Chamber of Commerce',
  '[08/25/2026 7:22 PM] Email reply to prospect By: Nyriel Benton Hi there Troy, It’s Nyriel from Community Honda.',
  '[08/25/2026 7:22 PM] Outbound Text Message Sent by: Nyriel Benton Hi there Troy, it’s Nyriel from Community Honda.',
  '[08/25/2026 7:18 PM] Outbound phone call (Machine) By: Nyriel Benton no answer.',
  '[08/25/2026 7:18 PM] Outbound phone call By: System callmeasurement review link',
  '[08/25/2026 6:57 PM] General Note By: Samantha  Lopez KAYLEE DUPE Troy Noel (Individual)',
  '[08/25/2026 6:57 PM] Outbound phone call (No Contact) By: Samantha  Lopez SC',
  '[08/25/2026 6:57 PM] Lead Log By: Samantha  Lopez BD Agent Changed From Samantha Lopez to Kaylee Guzman',
  '[08/25/2026 6:57 PM] Lead Log By: Samantha  Lopez Sales Rep Changed From Samantha Lopez to Nyriel Benton',
  '[08/25/2026 6:54 PM] Lead Log By: System BD Agent Changed From System to Samantha Lopez',
  '[08/25/2026 6:54 PM] Lead Log By: System Sales Rep Changed From System to Samantha Lopez',
  '[08/25/2026 6:53 PM] Lead received By: System Lead received with no comments.'
].join('\n');

// The anti-restate anchor exactly as it reached the model in the 8/27 prompt (line 204).
const YVONNE_ANCHOR = 'Subject: Did you know Community Honda..... By: Yvonne Ortega Troy, did you know '
  + 'that Community Group proudly supports: Bay Area Homeless Services Baytown Chamber of Commerce '
  + 'Rotary Club of Baytown Trinity Valley Exposition';

console.log('\nv9.7.591 — count the hang-ups; name whose message it is');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── (1) THE HANG-UP COUNT ────────────────────────────────────────────────────
console.log("Troy's 14 notes — the record that produced \"hung up on 11 calls\":");

check('exactly ONE hang-up is counted, not 11',
  i => i.count(TROY_CTX), 1);

check('...and it is not the total note count either',
  i => i.count(TROY_CTX) === TROY_CTX.split('\n').length, false);

check('a record with no hang-up at all counts zero',
  i => i.count('[08/25/2026] Outbound Text Message Sent by: Nyriel Benton Hi Troy'), 0);

check('two genuine hang-up notes count as two',
  i => i.count('call one, customer hung up\nunrelated note\nsecond call, hung up again'), 2);

check('every phrase the old boolean recognised still counts',
  i => ['he hung up', 'she hangs up', 'hung immediately', 'hung the phone up']
        .map(p => i.count(p)), [1, 1, 1, 1]);

check('two hang-up phrases on ONE line count once — it is one note',
  i => i.count('customer hung up, then hung up again on the callback'), 1);

check('empty and null input do not throw or invent a count',
  i => [i.count(''), i.count(null), i.count(undefined)], [0, 0, 0]);

// ── THE v9.7.591 COUNT WAS STILL WRONG, AND THE 592 RESCAN SHOWED IT ────────
// v9.7.591 turned "11" into "2". The truth was 1. The comment on _lpHangUpCount said "one line
// per note in this blob" — it is not. The context carries every note TWICE, once under
// AGENT CONTEXT / CALL NOTE and again in the CONVERSATION TRANSCRIPT, and the two renderings
// differ only in their prefix. Verbatim from the delivered 8/27 prompt, lines 342-344 and 362-363.
console.log('\nthe same note appears twice in the context blob — it is still ONE hang-up:');

const TROY_BOTH_SECTIONS = [
  '[08/27/2026 2:52 PM] [CALL NOTE] Outbound phone call (No Contact)',
  '  By: Kaylee Guzman',
  '  hung up during screening',
  '[08/25/2026 7:18 PM] [CALL NOTE] Outbound phone call (Machine)',
  '  By: Nyriel Benton',
  '  no answer.',
  'CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):',
  '[08/27/2026 2:52 PM] [AGENT] Outbound phone call (No Contact)',
  '  By: Kaylee Guzman hung up during screening'
].join('\n');

check('the note rendered in BOTH sections counts once, not twice',
  i => i.count(TROY_BOTH_SECTIONS), 1);

check('...which is what the v9.7.592 prompt got wrong when it said 2',
  i => i.count(TROY_BOTH_SECTIONS) === 2, false);

check('two DIFFERENT hang-up notes still count as two',
  i => i.count('  By: Kaylee Guzman hung up during screening\n'
             + '  By: Nyriel Benton hung up before I could speak'), 2);

check('...and each of those two, echoed into a second section, still counts two',
  i => i.count('  hung up during screening\n'
             + '  hung up before I could speak\n'
             + '  By: Kaylee Guzman hung up during screening\n'
             + '  By: Nyriel Benton hung up before I could speak'), 2);

check('a differing timestamp prefix does not defeat the dedupe',
  i => i.count('[08/27/2026 2:52 PM] By: Kaylee Guzman hung up during screening\n'
             + '[8/27 2:52p] Kaylee Guzman hung up during screening'), 1);

// The boolean must keep its exact old truth value — sbHungUp gates the SITUATION BRIEF and the
// close-override, and a changed truth value here would be a behaviour change nobody asked for.
console.log('\nthe derived boolean is truth-identical to the .test() it replaced:');
const OLD_BOOL = t => /hung up|hangs up|hung immediately|hung the phone/i.test(String(t || ''));
for (const [label, txt] of [
  ["Troy's record",        TROY_CTX],
  ['no hang-up anywhere',  'Outbound Text Message Sent by: Nyriel Benton Hi Troy'],
  ['empty',                ''],
  ['phrase only',          'hung up'],
  ['uppercase',            'CUSTOMER HUNG UP']
]) {
  check('  ' + label, i => (i.count(txt) > 0) === OLD_BOOL(txt), true);
}

// ── (2) THE AUTHOR ───────────────────────────────────────────────────────────
console.log('\nthe anchor Kaylee was handed as her own:');

check('Yvonne is recovered as the author of that email',
  i => i.author(YVONNE_ANCHOR), 'Yvonne Ortega');

check('...and she is NOT the same agent as the signer, Kaylee Guzman',
  i => i.same(i.author(YVONNE_ANCHOR), 'Kaylee Guzman'), false);

check('a text note uses "Sent by:" and resolves the same way',
  i => i.author('Sent to: (409) 250-0120 Sent by: Nyriel Benton Hi there Troy, it’s Nyriel'), 'Nyriel Benton');

check('when the signer DID write it, the message is still hers',
  i => i.same(i.author('By: Kaylee Guzman hung up during screening', 'Kaylee Guzman'), 'Kaylee Guzman'), true);

// The token cap is a guess about where a flattened name ends. Checking the signer's FULL name
// first means that guess can never truncate a three-part signer into a stranger and produce the
// mirror-image fabrication: "somebody else wrote this" about a message they did send.
check('a THREE-part signer name is not truncated into a stranger',
  i => i.author('By: Mary Jo Whitfield Troy, following up on the Accord', 'Mary Jo Whitfield'),
  'Mary Jo Whitfield');

check('...and is therefore still recognised as the signer’s own',
  i => i.same(i.author('By: Mary Jo Whitfield Troy, following up', 'Mary Jo Whitfield'), 'Mary Jo Whitfield'),
  true);

check('a foreign author is still foreign when the signer has a long name',
  i => i.same(i.author('By: Yvonne Ortega Troy, did you know', 'Mary Jo Whitfield'), 'Mary Jo Whitfield'),
  false);

check('a double-spaced CRM name still matches itself',
  i => i.same('Samantha  Lopez', 'Samantha Lopez'), true);

check('case and punctuation do not split one agent in two',
  i => i.same('kaylee guzman', 'Kaylee  GUZMAN'), true);

check('a middle name does not split one agent in two',
  i => i.same('Kaylee A Guzman', 'Kaylee Guzman'), true);

check('two genuinely different agents do not collapse',
  i => i.same('Yvonne Ortega', 'Nyriel Benton'), false);

// ── THE OPPOSITE FABRICATION ─────────────────────────────────────────────────
console.log('\nan unrecoverable author must NOT become a manufactured second author:');

check('"System" is not a person and yields no author',
  i => i.author('By: System Lead received with no comments.'), '');

check('a body with no By:/Sent by: at all yields no author',
  i => i.author('Troy, wanted to make sure you saw we have the Accord in stock.'), '');

check('...and an unknown author is treated as the signer’s own — no "someone else" claim',
  i => i.same('', 'Kaylee Guzman'), true);

check('an unknown SIGNER also falls back rather than accusing',
  i => i.same('Yvonne Ortega', ''), true);

check('both unknown falls back too',
  i => i.same('', ''), true);

// ── THE WIRING ───────────────────────────────────────────────────────────────
// The helpers being correct is half of it; the prompt has to actually use them. These read the
// shipped source with its comments stripped, so a post-mortem comment quoting the old string
// cannot satisfy an assertion about the code.
console.log('\nthe prompt builder actually uses them:');

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

check('the fabricated hang-up count is gone from the shipped code',
  i => /Customer has hung up on '\s*\+\s*sbTotal/.test(stripComments(i.src)), false);

check('"Phone is not working" is no longer asserted',
  i => /Phone is not working/.test(stripComments(i.src)), false);

check('the override reports the real count instead',
  i => /closeOverride[\s\S]{0,120}sbHungUpN/.test(stripComments(i.src)), true);

check('...and forbids diagnosing the customer’s phone',
  i => /Do NOT tell the customer their phone is broken/.test(stripComments(i.src)), true);

check('sbHungUp is derived from the count, not from a bare .test()',
  i => /var sbHungUp\s*=\s*sbHungUpN > 0;/.test(stripComments(i.src)), true);

check('the unconditional "YOUR LAST SUBSTANTIVE MESSAGE" heading is gone',
  i => /ageBlock\.push\('━━━ YOUR LAST SUBSTANTIVE MESSAGE/.test(stripComments(i.src)), false);

check('the heading is now chosen by authorship',
  i => /_asMine[\s\S]{0,200}SENT BY ' \+ _asAuthor/.test(stripComments(i.src)), true);

check('a foreign author gets an explicit do-not-claim-it instruction',
  i => /You did not send that message/.test(stripComments(i.src)), true);

check('[LP ANCHOR AUTHOR DIAG] reports author, signer and verdict',
  i => /\[LP ANCHOR AUTHOR DIAG\][\s\S]{0,220}attributed to signer/.test(stripComments(i.src)), true);

// ── (v9.7.639) THE STORE'S AUTOMATED ASSISTANT IS NOT A COLLEAGUE ─────────────────────────
// Angelique Morgan (Community Honda Baytown, 9/5): lead created, assigned and emailed inside the
// same minute by "Vinessa Virtual Assistant Community Honda". LP framed that as a colleague's
// message — "You may reference it as something the team or the store sent".
//
// Gil named the signal: "Her messaging read virtual assistant so that's the key LP needs to pick
// up on when scanning." It is a SHAPE, not a name. Matching "Vinessa" is the enumeration trap
// (v9.7.552/553/554/555/638) — the bot gets renamed and the detector goes quiet with no sign.
console.log('\nthe automated assistant is detected by shape, not by name:');
const VINESSA_SMS   = 'Sent to: (210) 885-8585\nSent by: Vinessa Virtual Assistant Community Honda\nWelcome to Community Honda. Reply YES to receive text messages.';
const VINESSA_EMAIL = 'Subject: Your 2023 Chevrolet Traverse Awaits\nBy: Vinessa Virtual Assistant Community Honda\nHi Angelique, I am Vinessa, the Internet Sales Coordinator at Community Honda.';
check('Angelique\'s text is bot-authored',  i => i.isBot(VINESSA_SMS), true);
check('Angelique\'s email is bot-authored', i => i.isBot(VINESSA_EMAIL), true);

// THE TRUNCATION IS WHY THIS IS TESTED ON THE RAW STRING. _lpOutboundAuthor keeps the two tokens a
// CRM user name has, so the signal survives in "Vinessa Virtual" only by luck — and is destroyed
// outright in the other two orderings below.
console.log('\n  ...on the RAW author, because the two-token name would destroy the signal:');
check('"Vinessa Virtual Assistant Community Honda" truncates to a name that keeps it by luck',
  i => i.author(VINESSA_SMS, 'Noelia Diaz'), 'Vinessa Virtual');
const NAME_LAST = 'Sent by: Community Honda Virtual Assistant\nhello';
check('  "Community Honda Virtual Assistant" truncates to "Community Honda"...',
  i => i.author(NAME_LAST, 'Noelia Diaz'), 'Community Honda');
check('  ...which carries no signal at all, yet it is still detected',
  i => [/virtual|assistant/i.test(i.author(NAME_LAST, 'Noelia Diaz')), i.isBot(NAME_LAST)], [false, true]);
const AI_FIRST = 'Sent by: Sarah AI Assistant\nhello';
check('  "Sarah AI Assistant" truncates to "Sarah AI" and is still detected',
  i => [i.author(AI_FIRST, 'Noelia Diaz'), i.isBot(AI_FIRST)], ['Sarah AI', true]);

console.log('\n  ...and the next vendor\'s bot is caught with no list to update:');
for (const [s, label] of [['Sent by: Digital Concierge\nhi', 'Digital Concierge'],
                          ['By: Automated Agent\nhi', 'Automated Agent'],
                          ['Sent by: AutoResponder\nhi', 'AutoResponder'],
                          ['By: Dealer Chatbot\nhi', 'Dealer Chatbot'],
                          ['Sent by: Robo Advisor\nhi', 'Robo Advisor']])
  check('    ' + label, i => i.isBot(s), true);

// A REAL PERSON MUST NEVER BE CALLED A BOT. This is the direction that would do damage: telling
// the model a colleague's message was a machine invites it to disown something a customer was
// really sent.
console.log('\na real person is never mistaken for the assistant:');
for (const [s, label] of [['Sent by: Noelia Diaz\nHi Angelique, I pulled the Traverse file', 'Noelia Diaz'],
                          ['By: Kaylee Guzman\nchecking in on your Pilot', 'Kaylee Guzman'],
                          ['Sent by: Yvonne Ortega\nthe numbers you asked for', 'Yvonne Ortega'],
                          ['By: Halie Bott\nfollowing up', 'Halie Bott — "Bott" must not match \\bbot\\b'],
                          ['Sent by: Abbot Reyes\nhello', 'Abbot Reyes — nor "Abbot"']])
  check('  ' + label, i => i.isBot(s), false);
check('a message with no author line is not a bot',
  i => [i.raw('no author line here'), i.isBot('no author line here')], ['', false]);

console.log('\nthe prompt says what it actually was:');
check('the heading names the automated assistant, not a person',
  i => /THE LAST MESSAGE ON THIS LEAD CAME FROM THE STORE\\'S AUTOMATED ASSISTANT, NOT FROM A PERSON/.test(stripComments(i.src)), true);
// (v9.7.639) These two phrases span string-concatenation boundaries in the source, so they exist
// in the DELIVERED prompt but not in any single line of the file. Matching the raw source would
// fail on text that is demonstrably shipping — the prose-match hazard this repo has hit seven
// times since v9.7.563, pointing the other way. Concatenations are joined before matching.
const joined = i => stripComments(i.src).replace(/'\s*\n\s*\+\s*'/g, '');
// The apostrophe survives the join as a backslash escape (colleague\\'s), so the fragment matched
// deliberately stops short of it rather than trying to model the escaping.
check('  ...and does not call it something the team sent',
  i => /It is NOT a colleague/.test(joined(i)), true);
check('  ...the colleague wording is still there for a real human author',
  i => /You did not send that message/.test(stripComments(i.src)), true);
check('the generic ask is named as already spent',
  i => /HAS ALREADY SPENT WHATEVER MOVES IT USED/.test(stripComments(i.src)), true);
check('  ...and the agent is told they are the first real person',
  i => /YOU ARE THE FIRST REAL PERSON TO WRITE TO THIS CUSTOMER/.test(joined(i)), true);
// "Acknowledge the silence" is nonsense when the silence is a template that fired hours ago. On
// Wendy Love's 9/4 lead the bot emailed at 10:51 PM and that instruction reached the model at
// 11:33 PM — forty-two minutes of "silence" it was told to name out loud.
check('a fresh bot-touched lead is told NOT to acknowledge a gap',
  i => /That is not silence to remark on/.test(stripComments(i.src)), true);
check('  ...gated on the lead being fresh, so a genuinely stale bot lead keeps the old wording',
  i => /\(_asBot && _asFresh\)/.test(stripComments(i.src)), true);
check('the bot verdict is computed from the shared detector, not hardcoded',
  i => /var _asBot    = _lpIsBotAuthor\(data\.lastSubstantiveOutboundMsg\);/.test(stripComments(i.src)), true);
check('a bot can never be resolved to the signing agent',
  i => /if \(_asBot\) _asMine = false;/.test(stripComments(i.src)), true);
check('[LP ANCHOR AUTHOR DIAG] now reports the raw author and the bot verdict',
  i => /\[LP ANCHOR AUTHOR DIAG\][\s\S]{0,320}\| bot:/.test(stripComments(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
