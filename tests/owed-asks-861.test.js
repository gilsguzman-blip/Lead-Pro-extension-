#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('owed-asks-861.test.js');
// (v9.7.861) OWNER-APPROVED 11/4, from four leads the agents gave up on (logs 395-398):
//  (1) Audi Lafayette lead 2104763932: on the 10/23 call the customer asked for the buyer's order; nothing shows it went, and the
//      drafts offered a video walkaround and "verify the specific Elantra" instead. The ask is now the reason for the message,
//      and the sales rep sends it (Gil: "use rep will send buyer's order wording"). On the same prompt the Audi store policy said
//      "present it as AVAILABLE" while three other lines said "do not say it is here", "NOT confirmed by today's feed" and "VIN
//      but NO stock number" (there was one): they now defer to the policy, and a stock number the feed does not hold gets its own
//      note. The distance header said "within 75 miles" beside "more than 75 miles".
//  (2) Honda Baytown lead 2107967819: a FullPath text reply was "nobody on our team has answered them yet" after the agent's
//      text, email and voicemail about it; and "Current note is $0 per month" was quoted back. A reply our people have taken up
//      is background; a $0 payment is a car that is paid off.
//  (3) Kia Baytown lead 2101893543: "it's hard for me to just go sit at a dealership just to talk numbers" survives the 14-day
//      quiet rule (Gil: "Keep customer's stated way to do business").
//  (4) Kia Baytown lead 2088871268: our messages said "I can check which Sorento Hybrid configurations match" and never did,
//      with one on the lot. That promise is the availability question; what we have answers it, with the call's needs.
// Executes the helpers, populateFromData, buildUserPrompt through the panel payload, and _lpBuildSmsRefinePrompt, with the
// clock on the leads' own local times. Placeholder data only.
//
// Usage: node tests/owed-asks-861.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: owed-asks-861.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (when) => '[' + when + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const BOT = '   [SYSTEM: This message was sent by the store’s AUTOMATED ASSISTANT, not by a person and not by you.]';
const U_ = (stock, vehicle, model, color, interior, cond, year) => ({ stock, vin: '', vehicle, year: year || 2026, make: vehicle.split(' ')[1], model, condition: cond || 'new',
  certified: false, class: 'SUV', body: '4D Sport Utility', color, interior, odometer: 10, daysOnLot: 30, price: 40000, stockNum: stock });

// (1) the Elantra
const BO_CALL = E('10/23/2026 3:29 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name she asked for the buyers order to be sent over to her');
const BO_H = E('11/02/2026 10:11 AM', 'AGENT', 'Outbound Text Message', 'Test, this is Rep at Audi Lafayette. Just keeping the door open on the Elantra.')
  + E('10/29/2026 12:25 PM', 'AGENT', 'Outbound phone call (No Contact)', 'By: Rep Name NUMBER JUST RINGS')
  + E('10/23/2026 5:36 PM', 'CUSTOMER', 'Inbound Text Message', 'Yes ma\'am') + BO_CALL + MARK('10/23/2026 3:08 PM');
const BO = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2023 Hyundai Elantra SEL',
  condition: 'Pre-Owned', stockNum: 'TEST0E1', vin: '1HGTEST0000000001', _pdUnitStock: 'TEST0E1', _pdStatus: 'I', inventoryWarning: true, _rgxInventoryWarning: true,
  _pdInventoryWarning: true, dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Cargurus', convState: 'active-follow-up', leadAgeDays: 11, hasOutbound: true,
  hasCustomerReply: true, totalNoteCount: 30, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Yes ma\'am',
  relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [], lastInboundAgeDays: 11.7, consecutiveOutboundNoReply: 18 },
  history: BO_H, conversationBrief: BO_H }, x || {});
// (2) the Civic
const CIVIC_NOTE = 'By: System CONVERTED ON: SMS Lead Details: Click here to view complete lead information ( dashboard.fullpath.com%2fshopp... ) Conversation: role: delivery content: Hi Test, it\'s Ella. Some exciting Honda inventory here at Community Honda Baytown. Browse: alst.me%2fs%2fTESTLINK03 Reply STOP to opt out. role: user content: Can you get the payment lower than my current note? role: bot content: Lease and finance offers depend on personal info. role: user content: Trade in value on 1996 Honda Civic EX role: user content: Current note is $0 per month note: Conversation may have continued after this message. For full conversation click dashboard.fullpath.com%2fshopp... Show Less';
const CV_ANS = E('10/30/2026 4:43 PM', 'AGENT', 'Outbound Text Message', 'Test, I can get you a solid trade range on your 1996 Civic EX first, then confirm the exact value with a quick appraisal. What are you shopping for? Agent');
const CV_ASK = E('10/30/2026 4:43 PM', 'AGENT', 'Outbound Text Message', 'Test, what are you shopping for? I can help narrow down the options. Agent');
const CV_BOT = E('10/31/2026 4:33 PM', 'AGENT', 'Outbound Text Message', 'Hi Test, it\'s our Internet Sales team. Bring your trade-in along and we\'ll get you its value!' + BOT);
const CV = (h, x) => { const hh = h + MARK('10/30/2026 4:37 PM'); return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name',
  salesRep: 'Rep Name', vehicle: '', condition: 'New', stockNum: '', vin: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'FullPath',
  convState: 'active-follow-up', leadAgeDays: 5, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 12, phone: '(555) 010-0199', email: 'test@example.com',
  lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [] }, pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0,
  tradeDescription: '1996 Honda Civic EX', fullpathConversion: CIVIC_NOTE, history: hh, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + hh + '---' }, x || {}); };
// (3) the K5
const NURSE = 'Hello. I am a nurse and it’s hard for me to just go sit at a dealership just to talk numbers. I got off late last night.';
const K5_H = (last) => E('10/30/2026 9:52 AM', 'AGENT', 'Outbound Text Message', 'Test, checking in on the K5. Agent')
  + E('10/21/2026 12:07 PM', 'AGENT', 'Email reply to prospect', 'Subject: The Wolf Gray K5 By: Agent Name Hi Test, the 2026 Kia K5 GT-Line in Wolf Gray is still here.')
  + E('10/20/2026 3:06 PM', 'CUSTOMER', 'Inbound Text Message', last)
  + E('10/17/2026 2:56 PM', 'CUSTOMER', 'Email reply from prospect', 'Thanks, I have the application done.') + MARK('10/17/2026 2:30 PM');
const K5 = (last) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia K5 GT-Line',
  condition: 'New', stockNum: 'TEST0K5', _pdUnitStock: 'TEST0K5', _pdStatus: 'A', color: 'Wolf Gray', dealerId: '6190', store: 'Community Kia Baytown',
  leadSource: 'Dealertrack - Gubagoo Inc.', convState: 'active-follow-up', leadAgeDays: 18, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 30,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: last,
  relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [], lastInboundAgeDays: 15, consecutiveOutboundNoReply: 8 },
  history: K5_H(last), conversationBrief: K5_H(last) });
// (4) the Sorento
const PROMISE = E('10/27/2026 11:09 AM', 'AGENT', 'Email reply to prospect', 'Subject: Sorento Hybrid offer By: Agent Name Hi Test, the customer cash offer on the Sorento Hybrid is for qualified buyers. I can check which Sorento Hybrid configurations match that, including whether the offer applies.');
const NEEDS = E('09/25/2026 11:30 AM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name No trade in, an suv, needs better gas mileage, heated seats, darker interior and exterior.');
const SR_H = (top) => (top || '') + PROMISE + NEEDS + E('09/24/2026 6:50 AM', 'CUSTOMER', 'Inbound Text Message', 'Stop') + MARK('09/24/2026 6:49 AM');
const SR = (top, promise) => { const h = promise === undefined ? SR_H(top) : (top || '') + promise + NEEDS + E('09/24/2026 6:50 AM', 'CUSTOMER', 'Inbound Text Message', 'Stop') + MARK('09/24/2026 6:49 AM');
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia Sorento Hybrid',
  condition: 'New', stockNum: '', vin: '', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Kia Digital - 3rd Party Lead', convState: 'active-follow-up',
  leadAgeDays: 41, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 40, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Stop',
  relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [] }, history: h, conversationBrief: h }); };
const SR_UNITS = [U_('TEST0S1', '2026 Kia Sorento Hybrid EX', 'Sorento Hybrid EX', 'Cityscape Green', 'Black Leather'),
  U_('TEST0S2', '2026 Kia Sorento LX', 'Sorento LX', 'Glacial White Pearl', 'Black Cloth'), U_('TEST0S3', '2026 Kia Sorento S', 'Sorento S', 'Wolf Gray', 'Black')];
const K5_UNITS = [U_('TEST0K5', '2026 Kia K5 GT-Line', 'K5 GT-Line', 'Wolf Gray', 'Black')];

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const clock = (ms) => run('(function(){ var RD = globalThis.__RD || Date; globalThis.__RD = RD; var FIX = ' + ms + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()');
  const setUnits = (dl, u) => { sb.__U = u; run('_lpValueFactCache["' + dl + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  const go = (lsd) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))), logs: logs.join('\n') }; }
    catch (e) { return { ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const refine = (p1, em, d) => { const r = fn('_lpBuildSmsRefinePrompt'); try { return r ? String(r(p1, em, d)) : ''; } catch (e) { return 'THREW ' + e.message; } };

  console.log(' 1. the buyer\'s order they asked for (Audi):');
  clock(new Date(2026, 10, 4, 9, 56).getTime());
  setUnits('21135', [U_('TEST0A1', '2025 Audi Q5 Premium', 'Q5 Premium', 'White', 'Black')]);
  const b = go(BO());
  check('the ask is the reason for the message, and the sales rep sends it', () => [
    /THEY ASKED FOR THE BUYER'S ORDER, AND IT HAS NOT GONE OUT\. On the 10\/23 call they asked for it/.test(b.prompt),
    /Say plainly, near the start, that Rep \(Rep Name, their sales rep\) will send the buyer's order over\./.test(b.prompt),
    /Do not offer a video walkaround, photos, a visit or a check on the unit in its place/.test(b.prompt)], [true, true, true]);
  check('the Audi policy owns the status: no line says "not here", "not confirmed by the feed" or "NO stock number"', () => [
    /NO LONGER IN ACTIVE INVENTORY/.test(b.prompt), /NO stock number on the lead/.test(b.prompt), /NOT confirmed by today's inventory feed/.test(b.prompt),
    /VEHICLE STATUS \(store policy\) above decides how this vehicle is presented: as available/.test(b.prompt)], [false, false, false, true]);
  const bSent = go(BO({ history: E('10/24/2026 9:00 AM', 'AGENT', 'Email reply to prospect', 'Subject: Your buyer\'s order By: Rep Name Hi Test, here is the buyer\'s order you asked for, attached.') + BO_H }));
  check('control: our later email with the buyer\'s order attached -> nothing owed, no block', () => [/THEY ASKED FOR THE BUYER'S ORDER/.test(bSent.prompt), (fn('_lpOwedBuyersOrder') || (() => 'no helper'))(BO({ history: E('10/24/2026 9:00 AM', 'AGENT', 'Email reply to prospect', 'Hi Test, here is the buyer\'s order you asked for, attached.') + BO_H }))], [false, null]);
  check('control: the agent is the sales rep -> "you will send it"', () => /Say plainly, near the start, that you will send the buyer's order over\./.test(go(BO({ salesRep: 'Agent Name' })).prompt), true);
  const bHon = go(BO({ dealerId: '6191', store: 'Community Honda Baytown' }));
  check('control: another store, the same flagged unit -> no block (its status is in question), and its own wording stands', () => [
    /THEY ASKED FOR THE BUYER'S ORDER/.test(bHon.prompt), /block not issued: the vehicle's status is in question/.test(bHon.logs), /NO LONGER IN ACTIVE INVENTORY/.test(bHon.prompt)], [false, true, true]);
  check('a stock number the feed does not hold is not "NO stock number on the lead" (prior model year, VIN on the lead)', () => [
    /NO stock number on the lead/.test(bHon.prompt), /A stock number is on the lead, but today's live inventory feed does not show that unit as this vehicle/.test(bHon.prompt)], [false, true]);
  check('the SMS rewrite keeps it: a first draft that names the buyer\'s order gets THE BUYER\'S ORDER rule; one that does not, nothing', () => [
    /THE BUYER'S ORDER ━━━/.test(refine('Test, Rep will send over the buyer\'s order for the Elantra today. Agent', 'Hi Test,\n\nRep will send the buyer\'s order over today.', BO())),
    /THE BUYER'S ORDER ━━━/.test(refine('Test, checking in on the Elantra. Agent', 'Hi Test,\n\nChecking in.', BO()))], [true, false]);
  check('the distance header says "more than 75 miles" on a special trip (the shipped line branches on _lpSpecialTrip)', () => {
    const i = src.indexOf("lines.push('🔴 DISTANCE BUYER: Customer lives '"); return i > 0 && /_lpSpecialTrip \? 'more than ' \+ LP_VISIT_RADIUS_MILES \+ ' miles from the store'/.test(src.slice(i, i + 300)); }, true);

  console.log(' 2. the FullPath reply our team took up, and a $0 payment:');
  clock(new Date(2026, 10, 4, 9, 59).getTime());
  setUnits('6191', [U_('TEST0C1', '2026 Honda Civic Sport', 'Civic Sport', 'Black', 'Black')]);
  const c = go(CV(CV_ANS));
  check('the agent answered the trade question on 10/30 -> background, and no "nobody has answered" / "owe you"', () => [
    /a person on our team has answered it since \(first on 10\/30\)/.test(c.prompt), /nobody on our team has answered them yet/.test(c.prompt), /HOW THIS CONVERSATION STARTED/.test(c.prompt)], [true, false, true]);
  check('"Current note is $0 per month" -> THEIR CAR IS PAID OFF, never "$0" or "your current note"', () => [
    /THEIR CAR IS PAID OFF: they said "Current note is \$0 per month"/.test(c.prompt), /Do not write "\$0", "your current note" or "your current payment"/.test(c.prompt)], [true, true]);
  check('control: our only message ignored it ("what are you shopping for?") -> still unanswered', () => /nobody on our team has answered them yet/.test(go(CV(CV_ASK)).prompt), true);
  check('control: the automated assistant mentioning a trade is not a person answering', () => /nobody on our team has answered them yet/.test(go(CV(CV_BOT + CV_ASK)).prompt), true);
  const po = fn('_lpPaidOff'), cs = (t) => po ? (po({ history: E('10/30/2026 5:00 PM', 'CUSTOMER', 'Inbound Text Message', t) + MARK('10/30/2026 4:37 PM') }) || {}).quote || null : 'no helper';
  check('the $0 reading: "my payment is $0" yes; "$0 down", "$450 a month", "0 payments for 90 days" no', () => [cs('My payment is $0, it is paid off'), cs('Can I do $0 down?'), cs('My payment is $450 a month'), cs('Is it 0 payments for 90 days?')],
    ['My payment is $0, it is paid off', null, null, null]);

  console.log(' 3. how the quiet customer said they want to buy:');
  clock(new Date(2026, 10, 4, 10, 5).getTime());
  setUnits('6190', K5_UNITS);
  const k = go(K5(NURSE));
  check('it survives the quiet rule, quoted, with the numbers by text or email and no times', () => [
    /ONE THING FROM BEFORE STILL HOLDS -- HOW THEY WANT TO DO THIS: on 10\/20 they said "I am a nurse and it’s hard for me to just go sit at a dealership just to talk numbers"\. That is not background/.test(k.prompt),
    /offer to work through the numbers with them by text or email, so the only trip in is to sign and pick it up/.test(k.prompt),
    /no appointment times: the visit is for signing, once the numbers are settled\./.test(k.prompt),
    /the QUIET CUSTOMER's own way to buy/.test(k.prompt)], [true, true, true, true]);
  const k0 = go(K5('Is the gray one still there?'));
  check('control: a quiet customer who said nothing of the kind -> the check-in as before, times allowed', () => [
    /ONE THING FROM BEFORE STILL HOLDS/.test(k0.prompt), /THIS MESSAGE HAS ONE JOB:[^\n]*answer in a word\./.test(k0.prompt)], [false, true]);
  check('the SMS rewrite keeps the exception', () => [/ONE EXCEPTION: how they said they want to do this \(10\/20/.test(refine('Test, I can go over the numbers on the K5 by text. Agent', 'Hi Test,\n\nI can go over the numbers by email.', K5(NURSE))),
    /ONE EXCEPTION/.test(refine('Test, still on your list? Agent', 'Hi Test,\n\nStill on your list?', K5('Is the gray one still there?')))], [true, false]);
  const way = fn('_lpWayToBuy'), wq = (t) => way ? (way({ history: E('10/20/2026 3:06 PM', 'CUSTOMER', 'Inbound Text Message', t) + MARK('10/17/2026 2:30 PM') }) || {}).quote || null : 'no helper';
  check('the reading: "Id rather do it online", "I dont wanna waste my time sitting at the dealership" yes; "I\'d rather come in Saturday" no', () =>
    [wq('Id rather do it online.'), wq('Honestly I dont wanna waste my time sitting at the dealership just to hear no.'), wq('I\'d rather come in Saturday.')],
    ['Id rather do it online', 'Honestly I dont wanna waste my time sitting at the dealership just to hear no', null]);

  console.log(' 4. the stock check we promised and never made:');
  clock(new Date(2026, 10, 4, 10, 8).getTime());
  setUnits('6190', SR_UNITS);
  const s = go(SR());
  // (v9.7.866) A Kia's interior is no longer listed: the feed says black or gray whatever the car has (owner, 11/10). The paint stays.
  check('what we have answers it: the one Sorento Hybrid, with its paint (a Kia\'s interior is not listed -- we will check)', () => [/IN STOCK -- 2026 Sorento Hybrid EX \(Cityscape Green\)\./.test(s.prompt),
    /KIA INTERIORS: Kia's inventory records list the interior as black or gray/.test(s.prompt)], [true, true]);
  check('...as the answer to our own promise, with what the call said they need', () => [
    /On 10\/27 our own message said "I can check which Sorento Hybrid configurations match that, including whether the offer applies", and no message of ours has answered it since/.test(s.prompt),
    /What they told us on the 09\/25 call: "No trade in, an suv, needs better gas mileage, heated seats, darker interior and exterior" \(the call note -- never quote it\)/.test(s.prompt),
    /No specific unit confirmed \(no stock number or VIN\)/.test(s.prompt)], [true, true, false]);
  const sAns = go(SR(E('10/28/2026 9:00 AM', 'AGENT', 'Email reply to prospect', 'Subject: Sorento Hybrid By: Agent Name Hi Test, we have a 2026 Sorento Hybrid EX here in Cityscape Green.')));
  check('control: a later message of ours already said we have one -> nothing owed (the "not confirmed" note as before)', () => [/our own message said/.test(sAns.prompt), /No specific unit confirmed/.test(sAns.prompt)], [false, true]);
  check('control: "I can confirm the exact unit before you come in" is not a promise to check stock', () =>
    /our own message said/.test(go(SR('', E('10/27/2026 11:09 AM', 'AGENT', 'Email reply to prospect', 'Subject: Sorento By: Agent Name Hi Test, I can confirm the exact unit before you come in.'))).prompt), false);
  check('control: the same promise from the automated assistant is not ours to answer', () =>
    /our own message said/.test(go(SR('', E('10/27/2026 11:09 AM', 'AGENT', 'Email reply to prospect', 'Subject: Sorento Hi Test, I can check which Sorento Hybrid configurations match that.' + BOT))).prompt), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
