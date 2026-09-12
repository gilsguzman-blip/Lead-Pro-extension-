#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('first-human-touch.test.js');

/**
 * first-human-touch.test.js — v9.7.658. ELEVEN GENERATIONS, ALL OPENING ON AN APR.
 *
 * LIVE, 9/12. Lead 2082376813 — 2026 Audi S5, Audi Partner Lead, Audi Lafayette, Patricia Galvan,
 * convState first-touch, leadAgeDays 0 — generated ELEVEN times between 8:21 and 8:23 AM. Ten
 * rated down. None sent. All eleven lead with "3.99% APR for 60 months", and she cycled the
 * no-appt and direct chips five times each trying to get something else.
 *
 * Gil, after sitting with her: "With the AI engaging first we changed our strategy to not repush
 * the appointment so the secondary messaging we were working with was pushing special APR's and
 * programs. She said she doesn't like doing that on what is technically our first reach out and
 * would rather focus on developing that engagement with the customer."
 *
 * The APR was there because v9.7.616 counts outreach on the lead WITHOUT asking who sent it, and
 * the store's auto-responder clears its three-message threshold within minutes of every lead. So
 * the robot unlocked the incentive and the agent's first human message opened on finance.
 *
 * Drives the SHIPPED _lpFirstHumanTouch with the SHIPPED bot detector and author extractor, then
 * the SHIPPED incentive suppression and the SHIPPED light-ask block.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: first-human-touch.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const span = (mark, what, end) => {
    const a = src.indexOf(mark);
    if (a < 0) throw new Error(what + ' not found');
    const b = src.indexOf(end, a);
    if (b < 0) throw new Error(what + ' end not found');
    return src.slice(a, b + end.length);
  };
  // The helper travels with the two it reads. _lpIsBotAuthor is the whole point — the fix is that
  // this question is asked of the existing shape detector rather than of a name list.
  const helper = span('function _lpAuthorRaw(msg) {', '_lpAuthorRaw', '\n}\n') + '\n'
    + span('var _LP_BOT_AUTHOR_RE =', '_LP_BOT_AUTHOR_RE', ';\n') + '\n'
    + span('function _lpIsBotAuthor(msg) {', '_lpIsBotAuthor', '\n}\n') + '\n'
    + span('function _lpFirstHumanTouch(d) {', '_lpFirstHumanTouch', '\n}\n');

  const gate = span('    var _incAiOnly = _lpFirstHumanTouch(d);', 'the incentive suppression', '\n    }');
  const ask  = span('                if (!_ddSuppressAppt && _lpFirstHumanTouch(data)) {', 'the light-ask block', '\n                }');
  // (v9.7.659) The bot-anchor block's closing sentence, which used to claim "first real person"
  // unconditionally. Lifted from the push that opens it to the diagnostic that now follows it.
  const anchor = span('          ageBlock.push(_lpFirstHumanTouch(data)\n', 'the anchor first-person claim',
    "_lpFirstHumanTouch(data)); } catch (eFh3) {}");
  // (v9.7.659) v9.7.415's own regex, so the asked case is driven by the shipped test rather than
  // by a string I chose. If that regex ever narrows, these assertions move with it.
  const asked = span('    var _incCustomerAsked = ', "v9.7.415's customer-asked test",
    "lastInboundMsg || '');");
  return { name: path.basename(path.dirname(file)), src, helper, gate, ask, anchor, asked };
}

// ── THE SEND SHAPES ─────────────────────────────────────────────────────────
// Bodies as the scrape carries them: the author line is inside the note text, which is why
// _lpIsBotAuthor is tested against the raw string rather than a truncated name.
const BOT_EMAIL = 'Subject: Your 2026 Audi S5 Awaits at Audi Lafayette\nBy: Vinessa Virtual Assistant Audi Lafayette\nHi, I am Vinessa, Audi Concierge at Audi Lafayette. I wanted to reach out about the 2026 Audi S5.';
const BOT_TEXT  = 'Sent by: Vinessa Virtual Assistant Audi Lafayette\nWelcome to Audi Lafayette. Reply YES to receive text messages.';
const BOT_ALT   = 'By: Community Honda Virtual Assistant\nThanks for your inquiry.';
const BOT_OTHER = 'By: Sarah AI Assistant\nJust following up on your request.';
const HUMAN     = 'Sent to: (555) 010-0199\nSent by: Patricia Galvan\nFor the 2026 Audi S5, what trim and colour are you set on?';

const send = body => ({ title: 'Outbound Text Message', ms: Date.now(), body });

function touchFor(impl, bodies, opts) {
  const sb = { String, RegExp, d: { outboundSends: (bodies || []).map(send) }, __out: null };
  vm.createContext(sb);
  vm.runInContext(opts && opts.mutate ? opts.mutate(impl.helper) : impl.helper, sb);
  vm.runInContext('__out = _lpFirstHumanTouch(d);', sb);
  return sb.__out;
}

// Runs the SHIPPED incentive suppression with the gate state supplied. `reasonBefore` is which
// override upstream had already unlocked the incentive — the whole point of (6) below.
function gateFor(impl, firstTouchBefore, aiOnly, reasonBefore, opts) {
  const logs = [];
  const sb = {
    _lpFirstHumanTouch: () => aiOnly,
    _incFirstTouch: firstTouchBefore,
    _incFirstTouchReason: reasonBefore !== undefined
      ? reasonBefore
      : (firstTouchBefore ? 'convstate' : 'prior_outreach'),
    d: {},
    console: { log: (...x) => logs.push(x.join(' ')) },
  };
  vm.createContext(sb);
  vm.runInContext(opts && opts.mutate ? opts.mutate(impl.gate) : impl.gate, sb);
  return {
    suppressed: vm.runInContext('_incFirstTouch', sb),
    reason: vm.runInContext('_incFirstTouchReason', sb),
    logs: logs.join(' '),
  };
}

// Runs the SHIPPED bot-anchor closing sentence off the shipped predicate.
function anchorFor(impl, aiOnly, opts) {
  const logs = [];
  const sb = {
    _lpFirstHumanTouch: () => aiOnly,
    data: {},
    ageBlock: [],
    console: { log: (...x) => logs.push(x.join(' ')) },
  };
  vm.createContext(sb);
  vm.runInContext(opts && opts.mutate ? opts.mutate(impl.anchor) : impl.anchor, sb);
  return { text: vm.runInContext('ageBlock', sb).join('\n'), logs: logs.join(' ') };
}

// Runs the SHIPPED light-ask block.
function askFor(impl, aiOnly, chipSuppressed) {
  const logs = [];
  const sb = {
    String,
    _ddSuppressAppt: !!chipSuppressed,
    _lpFirstHumanTouch: () => aiOnly,
    data: {},
    ageBlock: [],
    console: { log: (...x) => logs.push(x.join(' ')) },
  };
  vm.createContext(sb);
  vm.runInContext(impl.ask, sb);
  return { lines: vm.runInContext('ageBlock', sb).filter(Boolean), logs: logs.join(' ') };
}
const askText = r => r.lines.join('\n');

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

console.log('\nv9.7.658 — the auto-responder does not unlock the APR');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) WHO HAS WRITTEN ─────────────────────────────────────────────────────
console.log('\n(1) the reading itself:');

check('the auto-responder burst on the S5 lead is a first human touch',
  i => touchFor(i, [BOT_TEXT, BOT_EMAIL]), true);

check('one human send anywhere in view says a person has written',
  i => touchFor(i, [BOT_TEXT, BOT_EMAIL, HUMAN]), false);

check('...in either order',
  i => touchFor(i, [HUMAN, BOT_TEXT, BOT_EMAIL]), false);

check('a thread with only human sends is not a first human touch',
  i => touchFor(i, [HUMAN]), false);

// The shape is the point. A renamed bot must not go undetected.
check('a differently named assistant is still the assistant',
  i => [touchFor(i, [BOT_ALT]), touchFor(i, [BOT_OTHER])], [true, true]);

console.log('\n(2) it fails closed where it cannot tell:');
check('no sends at all', i => touchFor(i, []), false);
check('a send with an empty body is not counted either way', i => touchFor(i, ['']), false);
check('an empty body alongside a bot send still reads bot-only',
  i => touchFor(i, ['', BOT_EMAIL]), true);
check('a body with no author line at all is treated as human — the safer answer',
  i => touchFor(i, ['The 2026 Audi S5 is here.']), false);
check('degenerate input cannot throw',
  i => [touchFor(i, null), touchFor(i, undefined)], [false, false]);

// ── (3) THE INCENTIVE ───────────────────────────────────────────────────────
// v9.7.616 had already flipped this lead to "follow-up" on the robot's own three messages.
console.log('\n(3) the APR on the S5 lead:');

check('the v9.7.616 override is overturned on a first human touch',
  i => gateFor(i, false, true).suppressed, true);

check('...and the reason names why, so the log explains itself',
  i => gateFor(i, false, true).reason, 'ai_only_outreach');

check('the diagnostic says it plainly',
  i => /every prior outbound on this lead is from the automated assistant/.test(gateFor(i, false, true).logs), true);

check('a lead a person HAS written to keeps its incentive',
  i => gateFor(i, false, false).suppressed, false);

check('...and its v9.7.616 reason is untouched',
  i => gateFor(i, false, false).reason, 'prior_outreach');

check('an already-suppressed lead is not re-reasoned',
  i => gateFor(i, true, true).reason, 'convstate');

// ── (4) THE LIGHT ASK ───────────────────────────────────────────────────────
// Gil asked for the middle setting: not a two-option close, not no ask at all.
console.log('\n(4) the ask on the first human touch:');

const ask = i => askText(askFor(i, true, false));

check('the light ask is emitted', i => /FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES/.test(ask(i)), true);
check('it asks for the visit rather than skipping it',
  i => /Ask for the visit, and ask LIGHTLY/.test(ask(i)), true);
check('it uses the hours already in the prompt rather than restating them',
  i => /say when the store is open using the hours above/.test(ask(i)), true);
check('it wants a one-line accept or decline',
  i => /accept or decline in one line/.test(ask(i)), true);

// The four things the agent kept rejecting, named individually.
check('no specific time', i => /Do NOT name a specific time/.test(ask(i)), true);
check('no two-option close', i => /do NOT use the two-option time close/.test(ask(i)), true);
check('no duration', i => /do NOT state a visit duration/.test(ask(i)), true);
check('not the phrase she kept getting', i => /do NOT write "would X or Y work"/.test(ask(i)), true);

// A correction placed after the thing it corrects loses to it — v9.7.496, .504, .507.
check('it says out loud that the soonest-opening line does not apply here',
  i => /the soonest-opening instruction above does not apply/.test(ask(i)), true);

check('it names what the touch is for',
  i => /a reply and the start of a relationship, not a booked slot/.test(ask(i)), true);

check('the diagnostic reports the emission and the chip state',
  i => /\[LP FIRST-HUMAN-TOUCH DIAG\] light appointment ask emitted/.test(askFor(i, true, false).logs), true);

console.log('\n(5) it yields to the agent and to an ordinary lead:');

check('the drop-appointment chip outranks it',
  i => askFor(i, true, true).lines.length, 0);
check('...and nothing is logged in that case',
  i => askFor(i, true, true).logs, '');
check('a lead a person has written to gets no light ask',
  i => askFor(i, false, false).lines.length, 0);

// ── (6) THE QUESTION THE CUSTOMER ACTUALLY ASKED ────────────────────────────
// v9.7.658 shipped this suppression LAST in the chain, so it overturned v9.7.415's customer-asked
// override and went quiet on a customer who had asked about money. Gil's "non AI engaged leads
// will still behave correctly.... right?" is what sent me back through the chain.
console.log('\n(6) the customer-asked override survives (v9.7.659):');

// Driven through v9.7.415's own regex, not through a phrase I picked.
function askedBy(impl, inbound) {
  const sb = { d: { lastInboundMsg: inbound }, RegExp, __out: null };
  vm.createContext(sb);
  vm.runInContext(impl.asked + '\n__out = _incCustomerAsked;', sb);
  return sb.__out;
}

check('the shipped regex recognises the questions a customer actually sends',
  i => ["What's the payment on it?", 'any specials right now?', 'Can you send me an OTD price?']
        .map(m => askedBy(i, m)), [true, true, true]);
check('...and does not fire on an ordinary reply',
  i => askedBy(i, 'Is the S5 still available? I can come look this week.'), false);

check('a bot-only lead where the customer ASKED keeps its incentive',
  i => gateFor(i, false, true, 'asked').suppressed, false);
check('...and keeps the asked reason, so the log does not misreport why',
  i => gateFor(i, false, true, 'asked').reason, 'asked');
check('...and nothing is logged as suppressed',
  i => gateFor(i, false, true, 'asked').logs, '');

// The other two overrides are proactive mentions, which is exactly what Gil said should wait.
check('a proactive generic-VOI mention still yields on a first human touch',
  i => gateFor(i, false, true, 'generic').reason, 'ai_only_outreach');
check('an in-transit mention yields too',
  i => gateFor(i, false, true, 'in_transit').reason, 'ai_only_outreach');
check('...as does the v9.7.616 outreach override this build was written for',
  i => gateFor(i, false, true, 'prior_outreach').reason, 'ai_only_outreach');

// ── (7) THE ANCHOR SENTENCE ─────────────────────────────────────────────────
console.log('\n(7) the bot-anchor claim reads the field that owns it (v9.7.659):');

check('on a genuinely bot-only lead it says first real person',
  i => /YOU ARE THE FIRST REAL PERSON TO WRITE TO THIS CUSTOMER/.test(anchorFor(i, true).text), true);
check('when a person HAS written it says so instead',
  i => /A PERSON HAS ALREADY WRITTEN TO THIS CUSTOMER/.test(anchorFor(i, false).text), true);
check('...and it does NOT also claim first contact',
  i => /FIRST REAL PERSON/.test(anchorFor(i, false).text), false);
check('...and it tells the model not to introduce itself',
  i => /Do not introduce yourself or the store as though this were first contact/.test(anchorFor(i, false).text), true);
check('the diagnostic reports the verdict either way',
  i => [/first human touch: true/.test(anchorFor(i, true).logs),
        /first human touch: false/.test(anchorFor(i, false).logs)], [true, true]);
check('exactly one of the two sentences is emitted',
  i => [anchorFor(i, true).text.split('\n').filter(Boolean).length,
        anchorFor(i, false).text.split('\n').filter(Boolean).length], [1, 1]);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.658):');

const NO_BOT = c => c.replace('if (!_lpIsBotAuthor(body)) return false;', 'if (true) return false;');
check('neuter A actually disabled the bot test', i => NO_BOT(i.helper) !== i.helper, true);
check('A: the S5 burst stops reading as a first human touch',
  i => touchFor(i, [BOT_TEXT, BOT_EMAIL], { mutate: NO_BOT }), false);
check('A (control): the shipped helper reads it correctly',
  i => touchFor(i, [BOT_TEXT, BOT_EMAIL]), true);

check('B: with the reading false the APR comes back',
  i => gateFor(i, false, false).suppressed, false);
check('B: ...and so does the time close',
  i => askFor(i, false, false).lines.length, 0);
check('B (control): with it true both are gone',
  i => [gateFor(i, false, true).suppressed, askFor(i, true, false).lines.length > 0], [true, true]);

console.log('\nnon-vacuity (v9.7.659):');

// C: remove the asked guard and the silence v9.7.658 shipped comes straight back.
const NO_GUARD = c => c.replace(" && _incFirstTouchReason !== 'asked'", '');
check('neuter C actually removed the asked guard', i => NO_GUARD(i.gate) !== i.gate, true);
check('C: without it, a customer who asked about the payment is answered with silence',
  i => gateFor(i, false, true, 'asked', { mutate: NO_GUARD }).suppressed, true);
check('C (control): the shipped chain answers them',
  i => gateFor(i, false, true, 'asked').suppressed, false);

// D: pin the anchor predicate and the false introduction comes back.
const PIN_TRUE = c => c.replace(/_lpFirstHumanTouch\(data\)/g, 'true');
check('neuter D actually pinned the anchor predicate', i => PIN_TRUE(i.anchor) !== i.anchor, true);
check('D: pinned true, a human-worked lead is told it is first contact again',
  i => /FIRST REAL PERSON/.test(anchorFor(i, false, { mutate: PIN_TRUE }).text), true);
check('D (control): the shipped block does not',
  i => /FIRST REAL PERSON/.test(anchorFor(i, false).text), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
