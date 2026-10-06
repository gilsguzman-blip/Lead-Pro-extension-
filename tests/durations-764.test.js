#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('durations-764.test.js');
// (v9.7.764) VISIT AND APPRAISAL DURATIONS. Honda Lafayette KBB lead 2094975987, 10/5: the first draft said the appraisal
// "and conversation typically take 30-45 minutes"; the regenerate said "about 10 minutes". The prompt carried the visit
// length ("Duration to state before times: 30-45 minutes") as the only duration beside the times, and the model gave it
// to the appraisal. Gil, 10/6: "the appraisal time should be 10-15 minutes. Non appraisal is always 30-40 minutes."
// Executes the shipped classifyScenario and buildUserPrompt (whole popup.js in a vm), then scans the prompt-building
// strings (comments stripped) for any duration left over. Placeholder data only.
//
// Usage: node tests/durations-764.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: durations-764.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const entry = (m, d, t, kind, title, body) => '[' + pad(m) + '/' + pad(d) + '/2026 ' + t + '] [' + kind + '] ' + title + '\n  ' + body + '\n';
const CTX = entry(9, 23, '9:05 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: (555) 010-0199\n  Is it still available? I could come look at it and bring my trade.')
  + entry(9, 23, '8:40 AM', 'AGENT', 'Outbound Text Message', 'Hi Test, thanks for reaching out.')
  + '=== CURRENT LEAD SUBMITTED HERE ===\n' + entry(9, 22, '9:00 AM', 'NOTE', 'Lead Received', 'Internet lead');
const lead = (store, dealerId, vehicle) => ({ name: 'Test Buyer', firstName: 'Test', vehicle, leadSource: 'Internet', dealerId, store,
  agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', context: CTX, leadAgeDays: 0, convState: 'active-follow-up',
  hasCustomerReply: true, hasOutbound: true, lastInboundMsg: 'Is it still available? I could come look at it and bring my trade.',
  relationshipSignals: { totalOutboundCount: 1, leadOutboundCount: 1, totalInboundCount: 1 } });
const STORES = [['Community Honda Lafayette', '24399', '2026 Honda CR-V EX-L'], ['Community Audi Lafayette', '21135', '2026 Audi Q5 Premium']];
// Old durations, as they were written into prompt strings before this build.
const OLD = /30\s*[–-]\s*45 min|\b45 minutes|\babout 10 minutes|\b10 minutes and we|20-minute visit|worth 20 minutes|takes about 30 minutes|can do in about 20 minutes/;

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  for (const [store, id, veh] of STORES) {
    const d = lead(store, id, veh);
    vm.runInContext('leadContext = ' + JSON.stringify(CTX) + ';', sb);
    check(store + ': the visit length is 30-40 minutes', () => vm.runInContext('classifyScenario', sb)(d).duration, '30-40 minutes');
    const p = sb.__lp.buildUserPrompt(d);
    check(store + ': times are offered with the visit length labelled as the whole visit',
      () => /Duration to state before times: 30-40 minutes \(the whole visit\)\./.test(p), true);
    check(store + ': ...and the appraisal stated beside it as 10-15 minutes, never swapped with the visit',
      () => /A trade-in appraisal on its own takes 10-15 minutes\. Never give the visit length as the appraisal time/.test(p), true);
    check(store + ': no old duration anywhere in the prompt', () => (p.match(OLD) || [null])[0], null);
  }
  // Every prompt string, not only the branches the two leads above reach. Comments are stripped first so version
  // notes that quote the old figures do not count.
  const src = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('no prompt string in the file still carries an old duration', () => (src.match(OLD) || [null])[0], null);
  check('the appraisal examples say 10-15 minutes (KBB visit framing and the TRADE PRESENT example)',
    () => [/quick appraisal when you come in — usually takes about 10-15 minutes/.test(src), /It only takes about 10-15 minutes and we will have everything ready/.test(src)], [true, true]);
  check('the visit framings say 30-40 minutes (credit app x2, monthly-payment close, OTD transition)',
    () => [/coming in takes about 30-40 minutes'/, /coming in typically takes about 30-40 minutes to finalize/, /Frame the visit as taking about 30-40 minutes/, /exact numbers is a visit of about 30-40 minutes/, /can do in a visit of about 30-40 minutes/].map(r => r.test(src)), [true, true, true, true, true]);
  // TradePending: the trade flag and TRADE-IN RULES come from the lead source, so the appraisal line must reach it too.
  const TP_CTX = entry(9, 23, '9:05 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: (555) 010-0199\n  What would you give me for it? I could bring it by.')
    + '=== CURRENT LEAD SUBMITTED HERE ===\n' + entry(9, 22, '9:00 AM', 'NOTE', 'Lead Received', 'Internet lead');
  for (const [veh, label] of [['', 'TradePending, trade only'], ['2026 Honda CR-V EX-L', 'TradePending, trade plus a vehicle']]) {
    const d = Object.assign(lead('Community Honda Lafayette', '24399', veh), { leadSource: 'TradePending', hasTrade: true, history: '',
      tradeDescription: '2018 Ford Explorer XLT 61,000 mi', context: TP_CTX, lastInboundMsg: 'What would you give me for it? I could bring it by.' });
    let all = '';
    check(label + ': classified as TradePending', () => vm.runInContext('classifyScenario', sb)(d).isTradePending, true);
    check(label + ': the lead builds', () => { vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.populateFromData(d);
      const lc = vm.runInContext('leadContext', sb); all = lc + '\n' + sb.__lp.buildUserPrompt(Object.assign({}, d, { context: lc })); return all.length > 1000; }, true);
    check(label + ': the appraisal is framed as about 10-15 minutes', () => /quick appraisal when you come in \u2014 usually takes about 10-15 minutes/.test(all), true);
    check(label + ': the visit is 30-40 minutes and the two are kept apart', () => [/Duration to state before times: 30-40 minutes \(the whole visit\)/.test(all), /A trade-in appraisal on its own takes 10-15 minutes/.test(all)], [true, true]);
    check(label + ': no old duration', () => (all.match(OLD) || [null])[0], null);
  }
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
