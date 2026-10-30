#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('call-first-792.test.js');
// (v9.7.792) Gil, 10/13: "Our process is call first" ... "a lot of times the AI is getting the stop before we actually try and do
// our first reach. I don't want the email and VM to read as follow ups when we got the stop."
//  1. A CONNECTED call today on a lead created today (Outbound phone call (Contacted), or the customer calling in) makes the
//     state 'call-followup' -- the existing state ("the call already happened. Text/email is the follow-up to the call") that the
//     fresh-today rule made unreachable -- with its own label. A voicemail or no answer stays first-touch: first-reach messages.
//  2. A STOP is a text-channel preference, never the customer talking to us (the 9/23 ruling): 791's STOP hold is removed, a STOP
//     does not count as contact for the first-touch inventory trigger, and it does not hide an earlier "not looking" call.
// Executes the shipped scraper block (lifted, as appt-booked-727 does) against stub notes, and buildUserPrompt. Placeholder data.
//
// Usage: node tests/call-first-792.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: call-first-792.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const note = (msAgo, dir, title, content) => ({ getAttribute: (k) => (k === 'data-direction' ? dir : null),
  querySelector: (sel) => ({ innerText: /title/.test(sel) ? title : /content/.test(sel) ? content : /date/.test(sel) ? fmt(NOW - msAgo) : '' }) });
const startOfToday = new Date(NOW); startOfToday.setHours(0, 0, 0, 0);
const TODAY = Math.min(20 * 60000, NOW - startOfToday.getTime() - 60000);   // a few minutes ago, but still today
const U = (stock, trim, color, price) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: '2026 Honda Pilot ' + trim, year: 2026, make: 'Honda',
  model: 'Pilot ' + trim, condition: 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color, odometer: 5, daysOnLot: 10, price });

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));

  console.log(' 1. call first -- the state after the call:');
  const a = src.indexOf('      var _lpCallToday = false'), b = src.indexOf("        convState = 'call-followup';\n      } else ", a);
  const runState = (notes, x) => {
    if (a < 0 || b < 0) return '(no call-today block)';
    const block = src.slice(a, b) + "        convState = 'call-followup';\n      }\n      return convState;\n";
    const sb = Object.assign({ noteEls: notes, hasNewLeadToday: true, hasRealCustomerReply: false, convState: 'first-touch', _lpD: () => {}, Date, Math, String, RegExp }, x || {});
    vm.createContext(sb); return vm.runInContext('(function(){\n' + block + '})()', sb);
  };
  check('a connected call today ("Outbound phone call (Contacted)") -> call-followup', () =>
    runState([note(TODAY, 'outbound', 'Outbound phone call (Contacted)', "By: Agent Name talked about the Pilot, wants details")]), 'call-followup');
  check('the customer called in today ("Inbound phone call") -> call-followup', () => runState([note(TODAY, 'inbound', 'Inbound phone call', 'By: Agent Name customer called about the Pilot')]), 'call-followup');
  check('control: a voicemail ("Outbound phone call (Machine)") or no answer ("(No Contact)") stays first-touch -- first-reach messages', () =>
    [runState([note(TODAY, 'outbound', 'Outbound phone call (Machine)', 'By: Agent Name Left message')]), runState([note(TODAY, 'outbound', 'Outbound phone call (No Contact)', 'By: Agent Name rings')])], ['first-touch', 'first-touch']);
  // (v9.7.796) What blocks it is the customer writing AFTER the call, not ever having written: a reply from before the call
  // (lead 2099028967: 24 messages on the closed lead before this one) no longer hides today's call.
  check('control: a connected call from a previous day does not count; a customer text AFTER the call is decided further down', () =>
    [runState([note(30 * H, 'outbound', 'Outbound phone call (Contacted)', 'By: Agent Name talked')]),
     runState([note(Math.floor(TODAY / 2), 'inbound', 'Inbound Text Message', 'Received from: (555) 010-0199 sounds good, see you then'), note(TODAY, 'outbound', 'Outbound phone call (Contacted)', 'talked')], { hasRealCustomerReply: true })], ['first-touch', 'first-touch']);
  check('(v9.7.796) an older customer reply (before the call) no longer blocks it', () =>
    runState([note(TODAY, 'outbound', 'Outbound phone call (Contacted)', 'talked')], { hasRealCustomerReply: true }), 'call-followup');
  check('the call-followup state has its own label: follow the conversation, no first introduction, never quote the call note', () =>
    /'call-followup':\s+'FOLLOW-UP TO A PHONE CALL: we already spoke with this customer by phone \(see the call note\)\. This text and email follow that conversation -- pick up from what was said on the call\. Do NOT write it as a first introduction or thank them for an inquiry as if it just arrived\. Never quote the call note or mention notes\.'/.test(src), true);

  console.log(' 2. a STOP is a text preference, not a conversation:');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const logs = [];
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; logs.length = 0; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('_lpValueFactCache', sb)['24399'] = { inv: { units: [U('T007', 'Black Edition', 'Platinum White Pearl', 56024), U('T001', 'EX-L', 'Sonic Gray Pearl', 44169)] }, vf: { incentives: [] },
    fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  vm.runInContext('activeFlags = new Set(); window._lpGrabStartedAt = 0;', sb);
  const hist = ['[10/13/2026 10:47 AM] [CUSTOMER] Inbound Text Message\n  Stop', '[10/13/2026 10:46 AM] [AGENT] Outbound Text Message\n  Hi Test, this is the virtual assistant! Would you come in today at 2:00 PM?',
    '[10/13/2026 10:45 AM] [=== CURRENT LEAD SUBMITTED HERE ===]'].join('\n') + '\n';
  const LEAD = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Pilot AWD Black Edition 4dr SUV', condition: 'New', stockNum: '', vin: '',
    dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, totalNoteCount: 4,
    phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Stop', relationshipSignals: { unansweredQuestions: [] }, context: hist, history: hist };
  const p = quiet(() => sb.__lp.buildUserPrompt(LEAD));
  const own = ((logs.find(l => /\[LP VISIT DECISION DIAG\]/.test(l)) || '').match(/owner: ([^|]*)/) || [, ''])[1].trim();
  check('a STOP to the virtual assistant before our first reach: no STOP block, and it does not hold the visit', () => [/THEY TEXTED STOP/.test(p), /STOP block/.test(own)], [false, false]);
  check('the STOP is not contact: the first-touch inventory answer still fires (the email stays a first reach on what they asked about)', () =>
    /INVENTORY: 📦 WHAT WE HAVE IN THE 2026 PILOT RIGHT NOW[\s\S]*- The 2026 Pilot Black Edition: IN STOCK/.test(p), true);
  check('(new helper) _lpLeadHasContact: a STOP alone is not contact; a real message is', () => {
    const fn = vm.runInContext('_lpLeadHasContact', sb);
    return [fn({ history: hist }), fn({ history: hist.replace('  Stop', '  Is it still available?') })]; }, [false, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
