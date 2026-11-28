#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('three-fixes-891.test.js');
// (v9.7.891) THREE FIXES FROM THE 11/21 EXPORT. Owner, 11/22: "yes build 891 with all three".
//  1. A competitor's model named without its make is off-franchise too (Honda Baytown 3119853179: "a black Integra, new or pre-owned";
//     the draft sent "I can check whether we have a black Integra in stock, new or pre-owned"), and "new" beside the model counts.
//  2. The first-message question leads with what agents send: "what are you driving now?" on a chosen model, "what are you comparing
//     it with?" on one car (agents regenerated "what will you use it for?" into those, 11/21).
//  3. "As your Concierge" never leads into a question (Audi 3119777981: "As your Concierge at Audi Lafayette, what would you most like
//     to know about it ...").
// Executes _lpBareCompetitorModels, buildUserPrompt through the panel payload with a placeholder inventory, _lpBuyingJourney and
// _lpHouseGuard. Placeholder data only.
//
// Usage: node tests/three-fixes-891.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: three-fixes-891.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 21, 16, 25);
const CHAT = (said) => '[11/21/2026 4:20 PM] [GUBAGOO CHAT] Chat transcript\n  [CUSTOMER] ' + said + '\n[11/21/2026 4:19 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = (h, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Hds Chat-Text Leads - Gubagoo - Chat',
  convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 2, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] },
  conversationBrief: h, history: h, context: '', autoLeadId: 'TEST015Q', outboundSends: [], noVehicleAtAll: true }, x || {});
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const run = (e) => vm.runInContext(e, sb);
  const fn = (n) => { try { return run(n); } catch (e) { return () => { throw new Error(n + ' missing'); }; } };
  run('_lpValueFactCache["6191"] = { inv: { units: [{ year: 2019, make: "Acura", model: "MDX", vehicle: "2019 Acura MDX", stock: "TEST001A" }, { year: 2021, make: "Honda", model: "Civic", vehicle: "2021 Honda Civic Sport", stock: "TEST002B" }] }, fetchedAt: Date.now(), invSettledAt: Date.now() };');
  const prompt = (d) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";'); sb.__L = d; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(run('leadContext') || '') }))); });

  console.log(' 1. a competitor\'s model named alone is off-franchise:');
  check('"a black Integra" -> acura integra; "Acura Integra" is the make reader\'s; a Civic is ours', () => [fn('_lpBareCompetitorModels')('a black Integra, new or pre-owned'), fn('_lpBareCompetitorModels')('an Acura Integra'), fn('_lpBareCompetitorModels')('a black Civic')], [['acura integra'], [], []]);
  const pI = prompt(LEAD(CHAT('Hi, I am looking for a black Integra, new or pre-owned. Do you have any in stock?')));
  check('lead 3119853179\'s chat -> OFF-FRANCHISE: a NEW ACURA INTEGRA we cannot get, and the used Acura we hold', () => [/OFF-FRANCHISE REQUEST — READ BEFORE PROMISING ANYTHING\. The customer asked about a NEW ACURA INTEGRA\. This store is a Honda franchise/.test(pI), /WHAT WE DO HAVE: 1 used Acura unit\(s\) in stock right now — 2019 Acura MDX/.test(pI)], [true, true]);
  check('control: "a black Civic, new or pre-owned" -> no off-franchise block', () => /OFF-FRANCHISE REQUEST/.test(prompt(LEAD(CHAT('Hi, I am looking for a black Civic, new or pre-owned. Do you have any in stock?')))), false);
  check('control: their own car named by model ("trading in my Integra") -> no off-franchise block', () => /OFF-FRANCHISE REQUEST/.test(prompt(LEAD(CHAT('I want a new Civic and would be trading in my Integra.'), { tradeDescription: '2018 Integra' }))), false);

  console.log(' 2. the first-message question leads with what agents send:');
  const ask = (x) => quiet(() => fn('_lpBuyingJourney')(LEAD('', x)).ask);
  check('a model chosen -> "what they are driving now" first', () => /^what they are driving now/.test(ask({ vehicle: '2026 Honda Ridgeline', noVehicleAtAll: false })), true);
  check('one car -> "what they are comparing it with" first', () => /^what they are comparing it with/.test(ask({ vehicle: '2027 Toyota Corolla SE', stockNum: 'TEST003C', noVehicleAtAll: false })), true);
  // (v9.7.897) the first reach-out closes on a light visit invitation, no longer a question: the journey chooses what it is about
  check('the journey chooses what the first reach-out\'s invitation is about (it no longer suggests a question, since v9.7.897)', () => [/Let it choose what the invitation is about: ' \+ \(LP_JOURNEY_INVITE\[j\.stage\]/.test(src), /the first one named here usually works best/.test(src)], [true, false]);

  console.log(' 3. "As your Concierge" never leads into a question:');
  const hg = (t, ch, x) => { sb.__L = Object.assign({ dealerId: '21135', store: 'Audi Lafayette', totalNoteCount: 3 }, x || {}); run('lastScrapedData = globalThis.__L;'); return quiet(() => run('_lpHouseGuard')(t, ch)); };
  check('lead 3119777981\'s email: "As your Concierge at Audi Lafayette, what would you most like to know ..." -> "What would you most like to know ..."',
    () => hg('The 2018 Honda Accord you asked about is here. As your Concierge at Audi Lafayette, what would you most like to know about it?', 'email'), 'The 2018 Honda Accord you asked about is here. What would you most like to know about it?');
  check('the text, its signature carrying the title: "As your Concierge, I\'d love to know ..." -> "I\'d love to know ..."', () => hg('Test, the Accord is here. As your Concierge, I’d love to know what caught your eye about it?', 'sms'), 'Test, the Accord is here. I’d love to know what caught your eye about it?');
  check('control: the text with 16+ notes (no title in its signature) keeps its only Concierge', () => hg('Test, the Accord is here. As your Concierge, what would you like to know?', 'sms', { totalNoteCount: 20 }), 'Test, the Accord is here. As your Concierge, what would you like to know?');
  check('control: "As your Concierge, I can have ..." is a line about what you will do, and stays', () => hg('As your Concierge, I can have the paperwork ready.', 'email'), 'As your Concierge, I can have the paperwork ready.');
  check('control: another store is untouched', () => hg('As your Concierge, what would you like to know?', 'email', { dealerId: '24399' }), 'As your Concierge, what would you like to know?');
  check('the Audi rule says where it goes, and never as the lead-in to a question', () => /Put it where it reads naturally -- your introduction[^']*NEVER as the lead-in to a question/.test(src), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
