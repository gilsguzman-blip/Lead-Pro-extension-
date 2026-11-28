#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('payload-history-853.test.js');
// (v9.7.853) AUDIT M-3. The panel payload now carries history, so the fourteen helpers that read `d.history || d.context` read
// the raw transcript on the panel, the same text the rewrite and render checks read. Repeating the before/after prompt diff on
// every dump on file (94) found the one place the panel had only been right because of a duplicate: the raw transcript tags an
// "Inbound phone call" note [CUSTOMER], and leadContext also carries it as [CALL NOTE] in the agent-context header ahead of the
// fence. With the raw transcript, _lpOtdAsk called an agent's call write-up "their message" (and dropped "never quote the
// note"), and _lpCustEntries made it the customer's "newest message". A phone-call entry is now never the customer's words.
// Executes the shipped panel payload, _lpCustEntries, _lpOtdAsk, populateFromData and buildUserPrompt. Placeholder data only.
//
// Usage: node tests/payload-history-853.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: payload-history-853.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (d, time, tag, title, body) => '[' + d + '/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/13/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const CALL = E('10/13', '2:42 PM', 'CUSTOMER', 'Inbound phone call', 'interested in civic sport in white and wants drive out sent over / will be here saturday at 10');
const TXT = E('10/13', '1:10 PM', 'CUSTOMER', 'Inbound Text Message', 'Is the white Civic Sport still there?');
const OURS = E('10/13', '2:43 PM', 'AGENT', 'Outbound Text Message', 'Test, quick reminder of our appointment Saturday at 10.');
const HIST = OURS + CALL + TXT + MARK;
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Civic Sport',
  condition: 'New', stockNum: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Phone Up', convState: 'call-followup', leadAgeDays: 0,
  hasOutbound: true, hasCustomerReply: true, totalNoteCount: 5, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Is the white Civic Sport still there?',
  relationshipSignals: { unansweredQuestions: [] }, history: HIST, conversationBrief: HIST }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const payload = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd); return panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }); });

  console.log(' 1. the payload carries the raw transcript:');
  const p = payload(LSD());
  check('history on the panel payload is lastScrapedData.history', () => p.history === HIST, true);
  check('control: context is still leadContext', () => typeof p.context === 'string' && p.context.length > 0, true);

  console.log(' 2. a phone-call entry is never the customer\'s own words:');
  check('_lpCustEntries on the raw transcript: the customer\'s text, not the call write-up', () => run('_lpCustEntries')({ history: HIST }).map(x => x.title), ['Inbound Text Message']);
  check('control: an inbound text is still the customer\'s', () => run('_lpCustEntries')({ history: TXT + MARK }).length, 1);
  check('_lpOtdAsk: the out-the-door ask came on the phone call, not "in their message"', () => { const o = run('_lpOtdAsk')(p); return o && [o.how, o.date]; }, ['call', '10/13']);
  check('control: a customer who TYPED it is still "message"', () => { const o = run('_lpOtdAsk')({ history: E('10/13', '3:00 PM', 'CUSTOMER', 'Inbound Text Message', 'can you send me the out the door price?') + MARK }); return o && o.how; }, 'message');

  console.log(' 3. the prompt the panel builds:');
  const prompt = quiet(() => String(sb.__lp.buildUserPrompt(p)));
  check('the OTD line names the phone call and says never quote the note', () =>
    [/OUT-THE-DOOR PRICE — THEY ASKED FOR IT, on the 10\/13 phone call \(the call note says "interested in civic sport in white and wants drive out sent over/.test(prompt),
     /never quote the note/.test(prompt), /THEY ASKED FOR IT, in their 10\/13 message/.test(prompt)], [true, true, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
