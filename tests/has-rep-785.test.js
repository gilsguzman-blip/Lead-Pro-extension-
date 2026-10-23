#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('has-rep-785.test.js');
// (v9.7.785) Honda Lafayette lead 2096116717 (AMP lease end, 10/9): the salesperson logged "Sold"; an hour later a BDC text
// asked how soon she wanted to buy; she answered "I already have a sales rep". Nothing read that reply -- not an exit, not a
// pause, not a question -- so the next draft would have kept selling over the person she is working with. Now the message is
// a short, gracious step-back naming the lead's salesperson, with no pitch, question or visit (a level-3 visit hold), the text
// rewrite is told the same, and two visit pushes that survived every level-3 hold are neutralised: the lease-end "Frame the
// visit as an options review" and the LIVE CONVERSATION line's "getting them in soon is the goal" (also on the out-of-state
// buyer of lead 2097428117). Executes the shipped buildUserPrompt, _lpApplyVisitDecision and _lpBuildSmsRefinePrompt.
// Placeholder data only; dates are relative to now.
//
// Usage: node tests/has-rep-785.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: has-rep-785.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = n => String(n).padStart(2, '0');
const D = (daysAgo, h) => { const d = new Date(Date.now() - daysAgo * 86400000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + (h || '10:00 AM'); };
const HIST = (reply, sold) => ['[' + D(0.01, '3:31 PM') + '] [CUSTOMER] Inbound Text Message\n  ' + reply,
  '[' + D(0.04, '2:48 PM') + '] [AGENT] Outbound Text Message\n  Test, thank you for talking with me. How soon are you wanting to buy something?',
  sold ? '[' + D(0.08, '1:48 PM') + '] [NOTE] General Note\n  By: Rep Name Sold' : '[' + D(0.08, '1:48 PM') + '] [NOTE] General Note\n  By: Rep Name left a message',
  '[' + D(0.12, '12:36 PM') + '] [AGENT] Outbound Text Message\n  Test, we can help your mother go over options for her next vehicle.',
  '[' + D(2, '2:53 PM') + '] [NOTE] General Note\n  By: Rep Name Car is for her elder mother waiting on a call back',
  '[' + D(2, '2:53 PM') + '] [=== CURRENT LEAD SUBMITTED HERE ===]'].join('\n') + '\n';
const LEAD = (x) => { const reply = (x && x.reply) || 'I already have a sales rep', h = HIST(reply, !(x && x.noSold));
  return Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: '24399', store: 'Community Honda Lafayette',
    leadSource: 'AMP - Discuss Lease End', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true, isContacted: true, totalNoteCount: 9,
    phone: '(555) 010-0199', email: '', lastInboundMsg: reply, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, context: h, history: h, activeFlags: ['loyalty'] }, x || {}); };
const LIVE = '🔥 LIVE CONVERSATION: Customer replied within the last few hours and is actively engaged. This is a HOT lead — momentum matters, so do not let it cool. Write a response that directly continues the live conversation thread, references exactly what the customer said, and moves toward a concrete next step. Move on the timing the CUSTOMER is actually discussing — if they (or a pending agent message they are responding to) named a day or window, work within that day; do NOT default to a same-day appointment when the conversation is about another day. If no day is on the table yet, getting them in soon is the goal.';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const logs = [];
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('activeFlags = new Set();', sb);
  const up = (d) => quiet(() => sb.__lp.buildUserPrompt(d));

  console.log(' 1. the step-back:');
  const p = up(LEAD());
  check('lead 2096116717 shape: THEY ALREADY HAVE A SALES REP, naming the lead\'s salesperson, quoting what they said', () =>
    /🤝 THEY ALREADY HAVE A SALES REP: their newest message says so \("I already have a sales rep"\)\. This message is a short, gracious step-back that leaves them with that person -- on this lead that is Rep Name, our salesperson: say Rep is taking care of them\./.test(p), true);
  check('no pitch, no vehicle, no offer, no appointment, NO QUESTION; and the staff "Sold" note is named', () =>
    [/No pitch, no vehicle, no offer, no appointment, and NO QUESTION of any kind/.test(p), /A staff note on this lead reads "Sold": do not sell to them in any form\./.test(p)], [true, true]);
  check('it owns the visit decision (level 3), and the lease-end "options review" visit framing is gone', () =>
    [/VISIT DECISION FOR THIS MESSAGE: no visit ask and no appointment times in this message -- the ALREADY HAVE A SALES REP block owns this\./.test(p), /Frame the visit as an "options review"/.test(p)], [true, false]);
  check('controls: no salesperson (or the salesperson is the writer) -> no name; no "Sold" note -> no Sold sentence', () => [
      /on this lead that is/.test(up(LEAD({ salesRep: '' }))), /on this lead that is/.test(up(LEAD({ salesRep: 'Agent Name' }))), /reads "Sold"/.test(up(LEAD({ noSold: true })))], [false, false, false]);
  check('control: an ordinary reply ("Yes that would be great!") -> no block, and the lease-end framing stays', () => {
    const q = up(LEAD({ reply: 'Yes that would be great!' })); return [/THEY ALREADY HAVE A SALES REP/.test(q), /Frame the visit as an "options review"/.test(q)]; }, [false, true]);
  const RX = vm.runInContext("typeof LP_HAS_REP_RX !== 'undefined' ? LP_HAS_REP_RX : /(?!)/", sb);
  check('(new helper) what counts: "already have a sales rep", "already working with [name]", "have a salesperson already" -- not "do you have a rep?", "working with you"', () =>
    ['I already have a sales rep', 'We’re already working with Pat', 'I have a salesperson already', 'I\'m working with someone there already', 'Do you have a sales rep?', 'I don\'t have a rep yet', 'I\'m already working with you on the paperwork', 'I have a trade']
      .map(t => RX.test(t)), [true, true, true, true, false, false, false, false]);

  console.log(' 2. the text rewrite steps back too:');
  check('the rewrite prompt carries THEY ALREADY HAVE A SALES REP, with the salesperson\'s first name', () =>
    /━━━ THEY ALREADY HAVE A SALES REP ━━━\nKeep the email's step-back: thank them, say Rep is taking care of them, and say you are here if they need anything\. No pitch, no offer, no visit, and NO question\./.test(
      quiet(() => vm.runInContext('_lpBuildSmsRefinePrompt', sb)('Test, thank you. Rep is taking care of you.\nAgent', 'Subject: Thank you\n\nHi Test,\n\nThank you. Rep is taking care of you.\n\nAgent Name', LEAD()))), true);

  console.log(' 3. the live-conversation visit push, under any level-3 hold:');
  const A = vm.runInContext('_lpApplyVisitDecision', sb);
  const r3 = quiet(() => A([LIVE, '🤝 THEY ALREADY HAVE A SALES REP: their newest message says so ("I already have a sales rep").'].join('\n')));
  check('the LIVE CONVERSATION line keeps "continue the thread", loses "getting them in soon is the goal"', () =>
    [r3.level, /references exactly what the customer said\. This message makes no visit ask and offers no times \(see the VISIT DECISION\)\./.test(r3.text), /getting them in soon is the goal/.test(r3.text)], [3, true, false]);
  check('control: with no hold the LIVE CONVERSATION line is untouched', () => { const r = quiet(() => A(LIVE)); return /getting them in soon is the goal/.test(r.text); }, true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
