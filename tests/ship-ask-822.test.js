#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('ship-ask-822.test.js');
// (v9.7.822) THE SHIPPING QUESTION, AS PHONES TYPE IT. Kia Baytown lead 2104748576 (log357): "Well I wanted to know if y’all ship the
// trucks I live abt 4-5 hours away" -- a curly apostrophe in "y’all", and "if ... ship" -- did not match LP_SHIP_ASK_RX, so the
// v9.7.806 block (they arrange the transport company, we coordinate the pickup, two shippers named) never reached the prompt and the
// draft improvised "I can help arrange shipping". Gil: "the logic we built to give referrals and help coordinate didn't fire." The
// availability question had the same straight-apostrophe-only "y'all".
// Builds the prompt through the shipped populateFromData and panel payload, and executes _lpShipAsk, LP_AVAIL_ASK_RX and
// _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/ship-ask-822.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: ship-ask-822.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const ASK = 'Well I wanted to know if y’all ship the trucks I live abt 4-5 hours away';
const LEAD = (said) => { const T0 = NOW - 2 * H; const h = E(T0 + 6 * 60000, 'CUSTOMER', 'Inbound Text Message', said)
    + E(T0 + 3 * 60000, 'AGENT', 'Outbound Text Message', 'By: Agent Name\n  Test, the 2022 Ram 2500 Longhorn is here and available to see. Agent') + MARK(T0);
  return { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2022 Ram 2500 Longhorn', condition: 'Pre-Owned',
    stockNum: 'P0001', dealerId: '6190', store: 'Test Kia', leadSource: 'Dealer Website - Confirm Availability', convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true,
    hasCustomerReply: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: said, relationshipSignals: { unansweredQuestions: [] },
    history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }; };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });

  console.log(' 1. lead 2104748576: the shipping question is read:');
  check('"if y’all ship the trucks" (curly apostrophe) is their shipping question', sure(() => sb._lpShipAsk(LEAD(ASK))), ASK);
  const p = sure(() => viaPanel(LEAD(ASK)));
  check('...and the prompt answers it: they arrange the transport company, we coordinate the pickup with the shipper',
    /THEY ASKED ABOUT GETTING THE CAR TO THEM: "Well I wanted to know if y’all ship the trucks[^\n]*they arrange the transport company, and we coordinate the pickup with the shipper/.test(p), true);
  const rf = String(quiet(() => sb._lpBuildSmsRefinePrompt('Test, we can work with you on that.\nAgent', 'Subject: Ram\n\nTest,\n\nWe can work with you on that.\n\nAgent Name', LEAD(ASK))));
  check('...and the text rewrite carries it too', /━━━ THEY ASKED ABOUT GETTING THE CAR TO THEM ━━━/.test(rf), true);
  check('"whether you ship out of state", "do you ship", "y’all deliver?" are read', ['wondering whether you ship out of state', 'do you ship', 'y’all deliver?'].map(t => !!sure(() => sb._lpShipAsk(LEAD(t)))), [true, true, true]);

  console.log(' 2. controls:');
  check('"if you could send me pics", "I hope you deliver great service", "I\'ll come pick it up Saturday" are not',
    ['if you could send me pics', 'I hope you deliver great service', 'I\'ll come pick it up Saturday'].map(t => !!sure(() => sb._lpShipAsk(LEAD(t)))), [false, false, false]);

  console.log(' 3. the availability question, as phones type it:');
  check('"what do y’all have in white" / "do y’all still have it" are availability questions', [run('LP_AVAIL_ASK_RX').test('what do y’all have in white'), run('LP_AVAIL_ASK_RX').test('do y’all still have it')], [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
