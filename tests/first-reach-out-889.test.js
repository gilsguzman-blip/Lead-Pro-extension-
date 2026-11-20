#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('first-reach-out-889.test.js');
// (v9.7.889) THE FIRST REACH-OUT BUILDS ENGAGEMENT; IT DOES NOT ASK FOR THE APPOINTMENT. Owner, 11/20, from the VinSolutions performance
// manager: the appointment on the first reach-out "is like asking for a first kiss on the first date" -- ask an engaging question that
// picks up where the customer is in the buying journey. All scenarios, all stores. Rulings: a customer who asked to come in still gets
// times; from our second message on, the usual rules; a returning customer's new lead counts. Executes _lpFirstReachOut,
// _lpAskedToComeIn, _lpBuyingJourney and buildUserPrompt through the panel payload on a fixed Central clock. Placeholder data only.
//
// Usage: node tests/first-reach-out-889.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: first-reach-out-889.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 20, 10, 30);
const E = (clock, tag, title, body) => '[11/20/2026 ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (clock, day) => '[' + (day || '11/20/2026') + ' ' + clock + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const BOT = 'Subject: Let us find the right vehicle By: Test Virtual Assistant Community Honda Hi Test, I am the virtual assistant. What are you looking for?';
const LEAD = (h, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX', condition: 'New', dealerId: '6191',
  store: 'Community Honda Baytown', leadSource: 'Honda.com', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199',
  email: 'test@example.com', customerZip: '12345', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: null }, conversationBrief: h, history: h, context: '', autoLeadId: 'TEST014P', outboundSends: [] }, x || {});
const NEW = E('10:05 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the CR-V EX.') + MARK('10:04 AM');
const HUMAN_TEXT = (h) => E('10:20 AM', 'AGENT', 'Outbound Text Message', 'Test, thanks for asking about the CR-V EX.') + h;
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const fn = (n) => { try { return vm.runInContext(n, sb); } catch (e) { return () => { throw new Error(n + ' missing'); }; } };
  const fro = (d) => quiet(() => fn('_lpFirstReachOut')(d));
  const asked = (d) => quiet(() => { const r = fn('_lpAskedToComeIn')(d); return r ? 'asked' : null; });
  const stage = (d) => quiet(() => fn('_lpBuyingJourney')(d).stage);
  const prompt = (d, chip) => quiet(() => { vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "' + (chip ? d.autoLeadId : '') + '"; window._activeLeadId = "' + d.autoLeadId + '"; window._lpAddApptAt = 0;', sb);
    sb.__L = d; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(vm.runInContext('leadContext', sb) || '') }))); });
  const FRV = /VISIT DECISION FOR THIS MESSAGE: no visit ask and no appointment times in this message -- the FIRST REACH-OUT/;

  console.log(' which message is the first reach-out:');
  check('a new lead, nothing sent -> first reach-out', () => fro(LEAD(NEW)), true);
  check('only the virtual assistant has written -> still the first reach-out', () => fro(LEAD(E('10:06 AM', 'AGENT', 'Email reply to prospect', BOT) + NEW, { outboundSends: [{ title: 'email reply to prospect', ms: CT(2026, 11, 20, 10, 6), body: BOT }] })), true);
  check('control: a person already texted on this lead -> not the first reach-out (the usual rules)', () => fro(LEAD(HUMAN_TEXT(NEW), { outboundSends: [{ title: 'outbound text message', ms: CT(2026, 11, 20, 10, 20), body: 'Sent to: (555) 010-0199\nSent by: Agent Name\nTest, thanks for asking about the CR-V EX.' }] })), false);
  check('control: a connected call on this lead -> not the first reach-out', () => fro(LEAD(E('10:15 AM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name talked about the CR-V') + NEW)), false);
  check('a returning customer: our texts on the OLD lead do not count -> the new lead\'s first reach-out', () => fro(LEAD(NEW + '[03/02/2026 1:00 PM] [AGENT] Outbound Text Message\n  Test, the Civic is here.\n', { outboundSends: [{ title: 'outbound text message', ms: CT(2026, 3, 2, 13, 0), body: 'Sent by: Agent Name\nTest, the Civic is here.' }] })), true);
  check('control: a showroom lead (they met us) -> not the first reach-out', () => fro(LEAD(NEW, { leadSource: 'Showroom' })), false);

  console.log(' a customer who asked to come in still gets times:');
  check('"Can I come see it today?" -> asked', () => asked(LEAD(E('10:05 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'Can I come see it today?') + MARK('10:04 AM'))), 'asked');
  check('"I would like to schedule a test drive" -> asked', () => asked(LEAD(E('10:05 AM', 'CUSTOMER', 'Inbound Text Message', 'I would like to schedule a test drive.') + MARK('10:04 AM'))), 'asked');
  check('control: "a test drive isnt necessary" -> not asked', () => asked(LEAD(E('10:05 AM', 'CUSTOMER', 'Inbound Text Message', 'I already drove one so a test drive isnt necessary. Email me your best price.') + MARK('10:04 AM'))), null);
  check('a day they named ("Tuesday works for me") -> asked', () => asked(LEAD(NEW, { customerScheduleConstraint: 'CUSTOMER SPECIFIED DAY: Customer said Tuesday is when they are available.' })), 'asked');

  console.log(' where they are in the buying journey:');
  check('KBB / Click & Go / a pre-approval / a quote request / one unit / a model / nothing named', () => [
    stage(LEAD(NEW, { leadSource: 'Kbb Ico Kelley Blue Book - Mobile' })), stage(LEAD(NEW, { leadSource: 'Gubagoo - Click & Go' })), stage(LEAD(NEW, { leadSource: 'Capital One Pre-Approval' })),
    stage(LEAD(NEW, { leadSource: 'Rct-Request A Quote' })), stage(LEAD(NEW, { stockNum: 'TEST001A' })), stage(LEAD(NEW)), stage(LEAD(NEW, { vehicle: '' }))],
    ['VALUING OR SELLING THEIR CAR', 'ALREADY BUILDING A DEAL ONLINE', 'WORKING OUT THE MONEY FIRST', 'ASKED FOR PRICING', 'NARROWED TO ONE CAR', 'COMPARING, MODEL CHOSEN', 'EARLY: STILL LOOKING']);

  console.log(' the prompt:');
  const p1 = prompt(LEAD(NEW));
  check('first reach-out: the block with the journey, and the visit decision "no visit ask" owned by it', () => [/🤝 FIRST REACH-OUT — BUILD ENGAGEMENT, NO VISIT ASK:/.test(p1), /WHERE THEY ARE IN THE BUYING JOURNEY: COMPARING, MODEL CHOSEN/.test(p1), FRV.test(p1)], [true, true, true]);
  check('...and no slot block, no two-times close', () => [/SUGGESTED APPOINTMENT TIMES \(fallback/.test(p1), /close with two specific appointment times/.test(p1)], [false, false]);
  check('...and the text rewrite is told: no visit ask, and the text ends on the one engaging question', () => quiet(() => { const r = String(fn('_lpBuildSmsRefinePrompt')('Test, what drew you to the CR-V EX?', 'Hi Test,\n\nWhat drew you to the CR-V EX?', LEAD(NEW)));
    return [/This message makes NO visit ask and offers NO time \(the FIRST REACH-OUT/.test(r), /This is our first reach-out on the lead: its point is the one engaging question/.test(r)]; }), [true, true]);
  check('control: they asked to come in -> no block, the visit is not held by it', () => { const p = prompt(LEAD(E('10:05 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'Can I come see it today?') + MARK('10:04 AM'))); return [/FIRST REACH-OUT —/.test(p), FRV.test(p)]; }, [false, false]);
  check('control: the agent pressed Add Appt -> no block, two times', () => { const p = prompt(LEAD(NEW), true); return [/FIRST REACH-OUT —/.test(p), /close with two specific appointment times/.test(p)]; }, [false, true]);
  check('control: our second message (a person already texted) -> no block', () => /FIRST REACH-OUT —/.test(prompt(LEAD(HUMAN_TEXT(NEW), { convState: 'active-follow-up', hasOutbound: true }))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
