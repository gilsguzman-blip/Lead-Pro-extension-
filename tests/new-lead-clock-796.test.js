#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('new-lead-clock-796.test.js');
// (v9.7.796) A RETURNING CUSTOMER'S NEW LEAD STARTS ITS OWN CLOCK. Toyota Baytown lead 2099028967 (log317, on 795): a Click &
// Go lead submitted that day, and a connected call five minutes before the grab (a trade-in, and "the rav4 is to be here
// around the end of November"). Her
// last TEXT was 236 days old, on the closed lead before this one, and three parts of the prompt ran on that clock:
//   (1) "THIS CUSTOMER LAST WROTE 236 DAYS AGO ... THIS RULE OUTRANKS ANY BLOCK BELOW" -- one job, offer an in-stock
//       alternative -- so the text pitched a RAV4 LE instead of following up the call; times withheld; and the lead read
//       as eligible for a close-out;
//   (2) a 236-day-old missed appointment switched the message to the Sales Manager voice, because the fresh-lead guard
//       stood down once the agent had called;
//   (3) the call was never read as the conversation, because her February messages counted as "a real customer reply".
// Executes the shipped _lpQuietDays, _lpReachedRecently, _lpCloseOutEligible, classifyScenario and the scraper's
// call-today block (lifted, as call-first-792 does). Placeholder data only.
//
// Usage: node tests/new-lead-clock-796.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: new-lead-clock-796.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = n => String(n).padStart(2, '0');
const D = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000);
  return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + ((d.getHours() % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); };
const CALL = (daysAgo) => '[' + D(daysAgo) + '] [CALL NOTE] Outbound phone call (Contacted)\n  By: Agent Name\n  wants to trade in her current SUV, the RAV4 arrives around the end of November\n';
const MARK = (daysAgo) => '[' + D(daysAgo) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n';
const LEAD = (x, rs) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Toyota RAV4', condition: 'New', dealerId: '6189',
  store: 'Community Toyota Baytown', leadSource: 'Gubagoo Virtual Retailing', convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: true,
  totalNoteCount: 72, phone: '(555) 010-0199', email: 'test@example.com', history: CALL(0.01) + MARK(0.02), context: '',
  relationshipSignals: Object.assign({ unansweredQuestions: [], lastInboundAgeDays: 236, consecutiveOutboundNoReply: 4, leadAgeDaysForFatigue: 0.02, totalOutboundCount: 46 }, rs || {}) }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const logs = [];
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; logs.length = 0; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const Q = (d) => quiet(() => run('_lpQuietDays')(d));

  console.log(' 1. a lead submitted today, or a call that reached them, is not a customer gone quiet:');
  check('lead 2099028967: last text 236 days ago on the closed lead, this lead submitted today -> not quiet (was 236)', () => Q(LEAD()), 0);
  check('...nor with the lead 40 days old, when a call reached them 3 days ago on this lead', () =>
    Q(LEAD({ history: CALL(3) + MARK(40) }, { leadAgeDaysForFatigue: 40 })), 0);
  check('control: a 40-day-old lead, no call on it, last text 236 days ago -> quiet, as before', () =>
    Q(LEAD({ history: '[' + D(5) + '] [AGENT] Outbound Text Message\n  Test, checking in.\n' + MARK(40) }, { leadAgeDaysForFatigue: 40 })), 236);
  check('control: a call 20 days ago does not count (outside the 14-day window); lead age unknown is not "today"', () =>
    [Q(LEAD({ history: CALL(20) + MARK(40) }, { leadAgeDaysForFatigue: 40 })), Q(LEAD({ history: MARK(40) }, { leadAgeDaysForFatigue: null }))], [236, 236]);
  check('(new helper) the reason is stated', () => quiet(() => run('_lpReachedRecently')(LEAD())), 'this lead was submitted in the last day');

  console.log(' 2. ...and is never offered a close-out:');
  const CO = (d) => quiet(() => run('_lpCloseOutEligible')(d));
  check('lead 2099028967: replied 236 days ago, but the lead was submitted today -> not eligible', () =>
    [CO(LEAD()).eligible, /but this lead was submitted in the last day/.test(CO(LEAD()).reason)], [false, true]);
  check('control: a 40-day-old lead with no call and a 236-day-old reply -> eligible, as before', () =>
    CO(LEAD({ leadAgeDays: 40, history: MARK(40) }, { leadAgeDaysForFatigue: 40 })).eligible, true);

  console.log(' 3. a missed appointment from an earlier lead does not make this a manager\'s message:');
  const persona = (x) => { quiet(() => run('classifyScenario')(LEAD(Object.assign({ hasMissedAppt: true }, x)))); return logs.some(l => /-> manager \(missed appt\)/.test(l)); };
  check('lead 2099028967: a 236-day-old miss, a lead submitted today, the agent has already called -> no manager switch', () =>
    persona({ freshestApptEventDays: 236 }), false);
  check('control: a miss on THIS lead (2 days old, lead 5 days old) still switches to the manager', () =>
    persona({ freshestApptEventDays: 2, leadAgeDays: 5 }, {}), true);

  console.log(' 4. a connected call today is the conversation unless they wrote after it:');
  const a = src.indexOf('      var _lpCallToday = false'), b = src.indexOf("        convState = 'call-followup';\n      } else ", a);
  const H = 3600000, start = new Date(); start.setHours(0, 0, 0, 0); const TODAY = Math.min(20 * 60000, Date.now() - start.getTime() - 60000);
  const note = (msAgo, dir, title, content) => { const d = new Date(Date.now() - msAgo); return { getAttribute: (k) => (k === 'data-direction' ? dir : null),
    querySelector: (sel) => /title/.test(sel) ? { innerText: title } : /content/.test(sel) ? { innerText: content }
      : /date/.test(sel) ? { innerText: pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + ((d.getHours() % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM') } : null }; };
  const state = (notes) => { const block = src.slice(a, b) + "        convState = 'call-followup';\n      }\n      return convState;\n";
    const box = { noteEls: notes, hasNewLeadToday: true, hasRealCustomerReply: true, convState: 'active-follow-up', _lpD: () => {}, Date, Math, String, RegExp };
    vm.createContext(box); return vm.runInContext('(function(){\n' + block + '})()', box); };
  const OLD = note(236 * 24 * H, 'inbound', 'Inbound Text Message', 'Received from: (555) 010-0199\nI can be there around 1');
  check('lead 2099028967: a connected call today, her only messages months old -> call-followup (was active-follow-up)', () =>
    state([note(TODAY, 'outbound', 'Outbound phone call (Contacted)', 'By: Agent Name wants to trade in her SUV'), OLD]), 'call-followup');
  check('control: she texted AFTER the call -> not call-followup (decided further down)', () =>
    state([note(Math.floor(TODAY / 2), 'inbound', 'Inbound Text Message', 'Received from: (555) 010-0199\nsounds good, thanks'),
      note(TODAY, 'outbound', 'Outbound phone call (Contacted)', 'By: Agent Name talked'), OLD]), 'active-follow-up');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
