#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dr1-876.test.js');
// (v9.7.876) AUDIT #2 DR-1, OWNER-APPROVED 11/16, in its smallest safe form. The trade-value branch of the "what the customer wants"
// detector fires only on an ask newer than our last message from a person, at most 14 days old, and never on an exited or paused lead.
// The deal-condition branch (the visit decision's DEAL CONDITION hold) is unchanged. Executes buildUserPrompt through the panel payload.
// Placeholder data only.
//
// Usage: node tests/dr1-876.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: dr1-876.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const at = (daysAgo, clock) => { const d = new Date(Date.now() - daysAgo * 86400000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + clock; };
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const ASK = 'What would you give me for my trade-in?';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const go = (brief, x) => quiet(() => { const lsd = Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Accord SE', condition: 'New',
      dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Dealer Website', convState: 'active-follow-up', leadAgeDays: 6, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 8,
      phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1 }, conversationBrief: brief, history: brief, context: brief, autoLeadId: 'TEST005E' }, x || {});
    try { vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";', sb); sb.__L = lsd; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(lsd);
      const ctx = String(vm.runInContext('leadContext', sb) || ''); return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd, context: ctx }))); } catch (e) { return 'THREW ' + e.message; } });
  const TRADE = /what their TRADE is worth/;
  const ours = (d, clock, body, by) => E(at(d, clock), 'AGENT', 'Outbound Text Message', body + '\nBy: ' + (by || 'Rep Name'));

  console.log(' trade value: only a fresh ask, on a live lead:');
  check('the customer asked yesterday and nobody has replied -> "lead with the value"', () => TRADE.test(go(E(at(1, '3:00 PM'), 'CUSTOMER', 'Inbound Text Message', ASK) + MARK(at(6, '9:00 AM')), { lastInboundMsg: ASK })), true);
  check('...we replied to it since -> not again', () => TRADE.test(go(ours(0, '9:00 AM', 'I can get you a real number when you bring it by.') + E(at(1, '3:00 PM'), 'CUSTOMER', 'Inbound Text Message', ASK) + MARK(at(6, '9:00 AM')), { lastInboundMsg: ASK })), false);
  check('control: only the automated assistant has written since -> still fires', () => TRADE.test(go(E(at(0, '9:00 AM'), 'AGENT', 'Outbound Text Message', 'Thanks for reaching out! Reply STOP to opt out.\nBy: Assistant Name Virtual Assistant Community Honda') + E(at(1, '3:00 PM'), 'CUSTOMER', 'Inbound Text Message', ASK) + MARK(at(6, '9:00 AM')), { lastInboundMsg: ASK })), true);
  check('an ask 20 days old -> no', () => TRADE.test(go(E(at(20, '3:00 PM'), 'CUSTOMER', 'Inbound Text Message', ASK) + MARK(at(25, '9:00 AM')), { lastInboundMsg: ASK, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 20 } })), false);
  check('a paused lead -> no', () => TRADE.test(go(E(at(1, '3:00 PM'), 'CUSTOMER', 'Inbound Text Message', ASK) + MARK(at(6, '9:00 AM')), { lastInboundMsg: ASK, convState: 'pause' })), false);
  check('a call note that attributes a fresh ask to them -> fires (the v9.7.362 capability)', () => TRADE.test(go(E(at(1, '3:00 PM'), 'CALL NOTE', 'Inbound phone call (Contacted)', 'By: Rep Name\n  customer wants to know his trade value on the F-150') + MARK(at(6, '9:00 AM')), { lastInboundMsg: '' })), true);

  console.log(' the deal-condition hold is unchanged:');
  const DEAL = 'If you can beat 30,000 out the door then I’m in.';
  check('a fresh "if you can beat 30,000 ... then I\'m in", even with our reply since -> the HARD RULE stands', () => /HARD RULE: do NOT offer an appointment time/.test(go(ours(0, '9:00 AM', 'Let me check with my manager.') + E(at(1, '3:00 PM'), 'CUSTOMER', 'Inbound Text Message', DEAL) + MARK(at(6, '9:00 AM')), { lastInboundMsg: DEAL })), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
