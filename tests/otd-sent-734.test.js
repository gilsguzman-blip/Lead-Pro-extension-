#!/usr/bin/env node
'use strict';
// (v9.7.734) Honda Lafayette lead 2090083618, 9/28 (log256, capture 2756ab1e): on the call the customer asked for
// the line-item drive-out by text, and on 9/26 a text of ours said "36800 is the out the door price when can you
// come in ?". The store's OTD policy block still told the draft to explain why we do not quote a total, so the
// draft said "the total depends on your registration parish, eligible incentives, and whether you have a trade".
// Gil: "This message doesn't flow like a follow up from the last message sent about OTD for the unit."
// With a figure of ours already out, the policy switches to follow-up mode: no re-explaining, no new number, pick
// up from the one sent and move to the line-by-line walkthrough in person.
// Executes the shipped _lpOtdFigureSent and buildUserPrompt. Placeholder names and numbers only.
//
// Usage: node tests/otd-sent-734.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: otd-sent-734.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const OTD = '36800 is the out the door price when can you come in ?';
// newest first, the way the brief is built; entries above the marker are the current lead
const brief = (above, below) => 'CONVERSATION TRANSCRIPT (newest first):\n---\n'
  + '[09/28/2026 9:43 AM] [AGENT] Outbound phone call (Machine)\n  By: Rep Name Left message\n'
  + (above || '')
  + '[09/25/2026 4:45 PM] [CUSTOMER] Inbound Text Message\n  I need to see the numbers\n'
  + '[09/25/2026 4:36 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Agent Name Wants line item drive out sent via text\n'
  + '[09/25/2026 4:22 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n'
  + (below || '') + '---\n';
const text = (body, who) => '[09/26/2026 12:51 PM] [' + (who || 'AGENT') + '] ' + (who === 'CUSTOMER' ? 'Inbound' : 'Outbound') + ' Text Message\n  ' + body + '\n';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const sent = (b) => { const r = vm.runInContext('_lpOtdFigureSent', sb)({ conversationBrief: b, context: '' }); return r ? r.figure : null; };

  console.log(' 1. an out-the-door figure of ours on this lead:');
  check('the lead-2090083618 text: "36800 is the out the door price" -> 36800', () => sent(brief(text(OTD))), '36800');
  check('a call note of ours that records a quoted OTD counts too', () =>
    sent(brief('[09/26/2026 1:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Rep Name Gave him 29,900 OTD, he will think it over\n')), '29,900');
  check('the figure next to the phrase, not a mileage in the same sentence', () => sent(brief(text('It has 21,400 miles and the out the door is $31,500.'))), '31,500');
  check('control: the customer typing a total is not ours', () => sent(brief(text('Is it 36800 out the door?', 'CUSTOMER'))), null);
  check('control: an out-the-door promise with no figure', () => sent(brief(text('I can get you an exact out the door total when you come in.'))), null);
  check('control: a figure in a different sentence from the phrase', () => sent(brief(text('The price is $34,995. Happy to go over the out the door numbers in person.'))), null);
  check('control: a ZIP code is not a price', () => sent(brief(text('We are at 100 Main St, Lafayette, LA 70508 for the out the door numbers.'))), null);
  check('control: $1,000 off is not a total', () => sent(brief(text('The $1,000 off is part of the out the door savings.'))), null);
  check('control: a figure from an older lead (below the marker) does not count', () => sent(brief('', text(OTD))), null);

  console.log(' 2. the Honda Lafayette OTD policy in the prompt:');
  const prompt = (b, over) => {
    vm.runInContext('leadContext = ""; window._lpNoApptLeadId = "";', sb);
    return sb.__lp.buildUserPrompt(Object.assign({ name: 'Test Buyer', agent: 'Agent Name', salesRep: 'Rep Name', phone: '(555) 010-0199', email: 'test@example.com',
      vehicle: '2025 Honda Ridgeline Sport', stockNum: 'P0000001', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Cargurus',
      convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 9, relationshipSignals: {},
      conversationBrief: b, context: b, lastInboundMsg: 'I need to see the numbers' }, over || {}));
  };
  const p = prompt(brief(text(OTD)));
  const policy = (s) => (s.match(/STORE POLICY — OUT-THE-DOOR PRICING[\s\S]*?(?=\n\n)/) || [''])[0];
  const pp = policy(p);
  check('the policy says a figure already went out and quotes our message', () =>
    [/ON THIS LEAD A FIGURE HAS ALREADY GONE OUT\. Our outbound text message of 09\/26\/2026 12:51 PM said: "36800 is the out the door price/.test(pp)], [true]);
  check('...no re-explaining, no different total, pick up from it with the line-by-line breakdown in person', () =>
    [/Do NOT re-explain why we do not quote a total/.test(pp), /Do NOT state a different total/.test(pp),
     /line-by-line breakdown behind that total/.test(pp), /Your Sales Representative, Rep will walk them through it in person/.test(pp)], [true, true, true, true]);
  check('...and the no-figure steps are gone (explain the parish; close with two times)', () =>
    [/\(2\) Explain: The exact total depends on the parish/.test(pp), /\(5\) Close with two specific appointment times/.test(pp)], [false, false]);
  check('control: no figure sent -> the standard policy, unchanged', () => {
    const q = policy(prompt(brief()));
    return [/\(2\) Explain: The exact total depends on the parish/.test(q), /\(5\) Close with two specific appointment times/.test(q), /ALREADY GONE OUT/.test(q)]; }, [true, true, false]);
  check('distance buyer with a figure sent: the call-based policy stays, with the already-sent override', () => {
    const b = brief(text(OTD) + '[09/26/2026 12:40 PM] [NOTE] General Note\n  By: Agent Name Customer asked about delivery to Houston, TX\n');
    const q = policy(prompt(b));
    return [/\(DISTANCE BUYER\)/.test(q), /ALREADY GONE OUT/.test(q), /This overrides step \(2\) above/.test(q)]; }, [true, true, true]);
  check('control: a store without the OTD policy gets no policy block either way', () =>
    /STORE POLICY — OUT-THE-DOOR PRICING/.test(prompt(brief(text(OTD)), { dealerId: '6190', store: 'Community Kia Baytown', vehicle: '2025 Kia Sorento EX' })), false);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
