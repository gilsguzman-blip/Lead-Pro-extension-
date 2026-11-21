#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('zip-not-price-886.test.js');
// (v9.7.886) A ZIP CODE IS NOT A PRICE, AND "BEST PRICE INCLUDING ALL FEES" IS AN OUT-THE-DOOR ASK. Owner, 11/19: "picked up a general
// note and assumed the number was a price when it's a zip code for the customer. There was no Drive out pricing in the messages." Kia
// Baytown lead 3117232759 (log425): the agent's "no dupes" note (name, email, ZIP) became "Our general note ... gave them a price of
// $12345", and the text shipped "The $12,345 figure is the drive-out number we have for it"; the customer's "Can you email me your best
// price including all fees?" read as no out-the-door ask. Executes _lpPricePushback and _lpOtdAsk on a fixed Central clock, and
// buildUserPrompt through the panel payload. Placeholder data only.
//
// Usage: node tests/zip-not-price-886.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: zip-not-price-886.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 19, 11, 5);
const ASK = 'I prefer to communicate through email. I have already driven the Sorento so a test drive isnt necessary at this time. Can you email me your best price including all fees? Thanks';
const THREAD = (note) => '[11/19/2026 9:30 AM] [CUSTOMER] Email reply from prospect\n  ' + ASK + '\n'
  + '[11/18/2026 7:08 PM] [NOTE] General Note\n  By: Agent Name ' + note + '\n'
  + '[11/18/2026 7:00 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = (note) => { const h = THREAD(note); return { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia Sorento S', condition: 'New', dealerId: '6190',
  store: 'Community Kia Baytown', leadSource: 'Dealers WebSite', convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 6, phone: '(555) 010-0199',
  email: 'test@example.com', lastInboundMsg: ASK, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, conversationBrief: h, history: h, context: '', autoLeadId: 'TEST012M' }; };
const ZIP_NOTE = 'Test Buyer (Individual) test@example.com 12345 no dupes';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const pb = (note) => quiet(() => { const r = vm.runInContext('_lpPricePushback', sb)(LEAD(note)); return r ? r.figure : null; });
  const otd = (d) => quiet(() => { const r = vm.runInContext('_lpOtdAsk', sb)(d); return r ? r.how : null; });

  console.log(' a ZIP code is not a price:');
  check('lead 3117232759: the "no dupes" note (name, email, 12345) gives no figure -> no pushback', () => pb(ZIP_NOTE), null);
  check('control: a note that quotes "$34,500 drive out" is still our figure', () => pb('quoted $34,500 drive out on the Sorento S'), '$34,500');
  check('control: a bare "34500" in a note about price is still our figure', () => pb('gave him a price of 34500 on the Sorento S'), '$34500');

  console.log(' "best price including all fees" is an out-the-door ask:');
  check('the customer\'s "Can you email me your best price including all fees?" -> asked in a message', () => otd(LEAD(ZIP_NOTE)), 'message');
  check('...and "all-in price" and "with taxes and fees" too', () => [otd(Object.assign(LEAD(ZIP_NOTE), { history: THREAD(ZIP_NOTE).replace(ASK, 'What is your all-in price on it?') })),
    otd(Object.assign(LEAD(ZIP_NOTE), { history: THREAD(ZIP_NOTE).replace(ASK, 'What would it be with taxes and fees?') }))], ['message', 'message']);
  check('control: "what is your best price?" alone is not an out-the-door ask', () => otd(Object.assign(LEAD(ZIP_NOTE), { history: THREAD(ZIP_NOTE).replace(ASK, 'What is your best price?') })), null);

  console.log(' the prompt:');
  const p = quiet(() => { const d = LEAD(ZIP_NOTE); vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";', sb); sb.__L = d; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(vm.runInContext('leadContext', sb) || '') }))); });
  check('no "gave them a price of $12345", and the out-the-door ask block instead', () => [/\$77,?423/.test(p), /THEY PUSHED BACK ON THE PRICE WE SENT/.test(p), /OUT-THE-DOOR PRICE — THEY ASKED FOR IT/.test(p)], [false, false, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
