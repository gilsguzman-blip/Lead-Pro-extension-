#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('ship-send-824.test.js');
// (v9.7.824) "SEND" AND "BRING" ALONE ARE NOT SHIPPING. Honda Lafayette lead 2055144034 (log359, v9.7.823): after the salesperson
// sent the credit application, the customer texted "Can you send 2 application". LP_SHIP_ASK_RX took any "can you ... send" or
// "can you ... bring" as a question about getting the car to them, so the prompt carried "THEY ASKED ABOUT GETTING THE CAR TO
// THEM" and the text and email opened on transport companies ("Subject: Two applications and transport"). "Bring" or "drive" now
// needs the car and a place; "send" needs a vehicle noun and a place; ship / deliver / transport / haul are unchanged.
// Builds the prompt through the shipped populateFromData and panel payload, and executes _lpShipAsk. Placeholder data only.
//
// Usage: node tests/ship-send-824.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: ship-send-824.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const M = 60000, H = 60 * M, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LINK = 'https://www.example.test/finance-application/';
const ASK = 'Can you send 2 application';
const LEAD = (said) => { const T0 = NOW - 3 * H;
  const h = E(NOW - 24 * M, 'AGENT', 'Outbound Text Message', LINK) + E(NOW - 25 * M, 'CUSTOMER', 'Inbound Text Message', said) + E(NOW - 25 * M, 'CUSTOMER', 'Inbound Text Message', 'Ok')
    + E(NOW - 35 * M, 'AGENT', 'Outbound Text Message', 'This is the link for the credit application. Once it is completed, just let me know and I will check on it for you.')
    + E(NOW - 36 * M, 'AGENT', 'Outbound Text Message', LINK)
    + E(NOW - 60 * M, 'AGENT', 'Outbound Text Message', 'Good morning Test, this is Rep with Test Honda. What I can do to save you time is send over a credit app. Reply STOP to cancel.')
    + MARK(T0);
  return { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: '24399', store: 'Test Honda',
    leadSource: 'Phone Up', convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 8, phone: '(555) 010-0199',
    email: 'test@example.com', customerZip: '00000', lastInboundMsg: 'Ok / ' + said, lastOutboundMsg: LINK, lastSubstantiveOutboundMsg: LINK,
    relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [] },
    history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }; };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });
  const asks = (t) => !!sure(() => sb._lpShipAsk(LEAD(t)));

  console.log(' 1. lead 2055144034: a request for the application is not a shipping question:');
  check('"Can you send 2 application" is not their shipping question', asks(ASK), false);
  const p = String(sure(() => viaPanel(LEAD(ASK))));
  check('...and the prompt carries no transport block and names no shipper', [/THEY ASKED ABOUT GETTING THE CAR TO THEM/.test(p), /Sherpa|Ship That Car|uShip|Montway/.test(p)], [false, false]);
  check('other things they ask us to send or bring: pics, the link, the application to an email, "it", the paperwork',
    ['can you send me pics', 'can you send the link again', 'Can you send the application to my email', 'Can you send it to me', 'could you bring the paperwork'].map(asks),
    [false, false, false, false, false]);

  console.log(' 2. controls: the car coming to them is still read:');
  check('"bring it to my house", "send the truck out here", "drive it out here"',
    ['Can you bring it to my house?', 'Could y’all send the truck out here', 'can you guys drive it out here'].map(asks), [true, true, true]);
  check('ship / deliver / transport and the earlier shapes are unchanged',
    ['Can you ship it to Maryland', 'Do you deliver?', 'Well I wanted to know if y’all ship the trucks I live abt 4-5 hours away', 'Si lo compro podran traerlo hasta Maryland', 'do you do home delivery'].map(asks),
    [true, true, true, true, true]);
  const pc = String(sure(() => viaPanel(LEAD('Can you bring it to my house?'))));
  check('...and a real one still puts the transport block in the prompt', /THEY ASKED ABOUT GETTING THE CAR TO THEM: "Can you bring it to my house\?"/.test(pc), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
