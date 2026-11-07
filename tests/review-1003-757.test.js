#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('review-1003-757.test.js');
// (v9.7.757) Three drafts from the 10/3 feedback export.
//  (1) Honda Baytown chat lead 2093797981, follow-up: still "I'm checking current Honda lease offers" -- the 755 offers-by-
//      body-type block never ran. The lead's VOI is the "2026 Honda Any/All" placeholder: d.vehicle is blanked for it
//      (v9.7.255) but the incentive matcher read d.vehicle || d.vehicleRaw, so the lead counted as having a model. And
//      the block read only brief lines STARTING with a customer tag, missing "[date] [CUSTOMER] ..." turns.
//  (2) Honda Baytown lead 2094222132: one person in both BD Agent and Sales Rep (no rep assigned yet) and the scraper
//      dropped the agent as "the DOM gave us the sales rep". The text signed "Coordinator" with no name and the email
//      carried two signatures -- the signer stayed empty while the system prompt and the email fell back to the user.
//      The scraper now keeps that agent, and an empty agent signs as the panel's agent field / the signed-in user.
//  (3) Honda Lafayette lead 2094092453: the Sales Rep field named the agent writing (no sales rep assigned yet, so
//      VinSolutions lists the BD agent in both), and the OTD hand-off had her name herself in the third person
//      ("<name> can have the proposal ready"). Now that reads as no Sales Rep yet: "one of our Sales Representatives".
//  (4) Kia names its conquest cash "Competitive Bonus Program" (live Kia Baytown file); PROGRAM FIT looked only for
//      the word "conquest". Gil, 10/4: "Competitive is a conquest." 
// Executes the shipped agent reader (sliced from inlineScraper), populateFromData, _lpCustomerTextOf, resolveSignerForPersona and buildUserPrompt. Placeholder data only.
//
// Usage: node tests/review-1003-757.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: review-1003-757.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const EXP = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const INC = [
  { model: 'Accord', year: '2026', line: 'Accord — $229/mo 36 mo lease ($3,499 due at signing) — applies to SE', expires: EXP },
  { model: 'Civic Sedan', year: '2026', line: 'Civic Sedan — $219/mo 36 mo lease ($3,299 due at signing) — applies to LX', expires: EXP },
  { model: 'CR-V', year: '2026', line: 'CR-V — $279/mo 39 mo lease ($4,899 due at signing) — applies to AWD LX', expires: EXP }
];
const ago = (days) => { const t = new Date(Date.now() - days * 86400000);
  return String(t.getMonth() + 1).padStart(2, '0') + '/' + String(t.getDate()).padStart(2, '0') + '/' + t.getFullYear(); };
const SUMMARY = '[CUSTOMER CHAT SUMMARY] Customer is helping a family member looking for leasing deals on a low-cost vehicle. Looking for a small sedan with 4-doors; reliability and lowest payment.';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const pfd = (extra) => {
    sb.__vf = { incentives: INC };
    vm.runInContext('_lpValueFactCache["6191"] = { vf: globalThis.__vf, inv: null, fetchedAt: Date.now(), invSettledAt: Date.now(), pending: false };', sb);
    const d = Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '', vehicleRaw: '2026 Honda Any/All (New)', dealerId: '6191', store: 'Community Honda Baytown',
      leadSource: 'Hds Chat-Text Leads - Gubagoo - Chat Gubagoo - M-Chat', convState: 'active-follow-up', leadAgeDays: 1, totalNoteCount: 16, hasOutbound: true,
      hasCustomerReply: true, relationshipSignals: {}, conversationBrief: SUMMARY, history: '', context: '', lastInboundMsg: 'Lowest payment',
      pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0 }, extra);
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
    sb.populateFromData(d);
    return vm.runInContext('leadContext', sb);
  };
  const BLOCK = /STORE OFFERS FOR WHAT THEY DESCRIBED \(no model is on file; they asked about lease offers on a sedan\)/;

  console.log(' 1. an "Any/All" VOI is no model; the offers block reads every customer turn:');
  const c1 = pfd({});
  check('lead 2093797981 shape (VOI "2026 Honda Any/All", newest text "Lowest payment", ask in the chat summary) -> the sedan lease offers',
    () => [BLOCK.test(c1), /Accord — \$229\/mo/.test(c1), /Civic Sedan — \$219\/mo/.test(c1), /CR-V — \$279/.test(c1.slice(c1.indexOf('STORE OFFERS FOR WHAT')))], [true, true, true, false]);
  check('control: a real VOI (2026 Honda Accord) -> the body-type block stays out (the model path owns it)',
    () => BLOCK.test(pfd({ vehicle: '2026 Honda Accord SE', vehicleRaw: '2026 Honda Accord SE (New)' })), false);
  const TURN = 'CONVERSATION TRANSCRIPT (newest first):\n---\n[' + ago(0) + ' 9:00 AM] [CUSTOMER] Inbound Text Message\n  ok\n'
    + '[' + ago(1) + ' 4:20 PM] [AGENT] Outbound Text Message\n  Happy to help.\n'
    + '[' + ago(1) + ' 4:10 PM] [CUSTOMER] Inbound Text Message\n  Do you have any lease deals right now?\n  Looking for a 4 door sedan.\n---\n';
  check('no VOI at all, an earlier customer text "[date] [CUSTOMER] ... lease deals ... / 4 door sedan" on its own lines -> read',
    () => BLOCK.test(pfd({ vehicleRaw: '', conversationBrief: TURN, lastInboundMsg: 'ok' })), true);
  check('control (new helper): our own text offering sedan lease deals is not the customer asking', () =>
    sb._lpCustomerTextOf('---\n[' + ago(1) + ' 4:20 PM] [AGENT] Outbound Text Message\n  We have lease deals on every sedan.\n---\n'), '');
  check('control: no offer question anywhere -> no block', () => BLOCK.test(pfd({ conversationBrief: '[CUSTOMER CHAT SUMMARY] Looking for a small sedan with 4-doors.' })), false);

  console.log(' 2a. the scraper keeps a BD agent who is also listed as the Sales Rep:');
  const src = require('fs').readFileSync(f, 'utf8');
  const ia = src.indexOf('    const agent=(function(){'), ib = src.indexOf("    _lpD('[Lead Pro] agent resolved:'", ia);
  const agentOf = (fields, text) => new Function('TEXT', 'gid', 'qs', 'firstOf', 'labelValue', src.slice(ia, ib) + '\nreturn agent;')(
    text, () => null, () => null, (arr) => arr.find(x => typeof x === 'string' && x.trim()) || '', (l) => fields[l] || '');
  const LOGS = (rows) => 'Notes & History\n' + rows.map(r => 'Lead Log\nBy: System\n' + r + '\n').join('');
  check('lead 2094222132 shape: "Agent Name" in both BD Agent and Sales Rep (no rep assigned yet) -> "Agent Name", not ""',
    () => agentOf({ 'BD Agent': 'Agent Name', 'Sales Rep': 'Agent Name' }, LOGS(['BD Agent Changed From System to Agent Name', 'Sales Rep Changed From System to Agent Name'])), 'Agent Name');
  check('...the same with no assignment log on the page', () => agentOf({ 'BD Agent': 'Agent Name', 'Sales Rep': 'Agent Name' }, 'Lead Info\n'), 'Agent Name');
  check('the field repeats the Sales Rep but the newest BD log names someone else -> that agent (v9.7.756 returned "")',
    () => agentOf({ 'BD Agent': 'Rep Name', 'Sales Rep': 'Rep Name' }, LOGS(['BD Agent Changed From Rep Name to Agent Name', 'BD Agent Changed From System to Rep Name'])), 'Agent Name');
  check('control: different BD Agent and Sales Rep -> the BD Agent', () => agentOf({ 'BD Agent': 'Agent Name', 'Sales Rep': 'Rep Name' }, ''), 'Agent Name');

  console.log(' 2b. no BD agent on the lead: one signer, everywhere:');
  const signer = (lead, prof) => {
    sb.__ld = lead; sb.__pf = prof;
    vm.runInContext('lastScrapedData = globalThis.__ld; _leadProProfile = globalThis.__pf; window._leadProPersonaOverride = null; window._leadProResolvedPersona = "bdc";', sb);
    const s = vm.runInContext('resolveSignerForPersona()', sb); return [s.name, s.firstName];
  };
  const PROF = { name: 'Profile User', firstName: 'Profile', persona: 'bdc', phone: '(555) 010-0100' };
  check('lead 2094222132 shape: agent "" and no Sales Rep -> the signed-in user, not an empty name',
    () => signer({ agent: '', salesRep: '', dealerId: '6191', store: 'Community Honda Baytown' }, PROF), ['Profile User', 'Profile']);
  check('agent "" with a Sales Rep -> the Sales Rep, the name the panel\'s agent field shows',
    () => signer({ agent: '', salesRep: 'Rep Name', dealerId: '6191', store: 'Community Honda Baytown' }, PROF), ['Rep Name', 'Rep']);
  check('control: a BD agent on the lead still signs', () => signer({ agent: 'Agent Name', salesRep: 'Rep Name', dealerId: '6191' }, PROF), ['Agent Name', 'Agent']);

  console.log(' 3. a Sales Rep field that repeats the signer is no Sales Rep yet, never a third person:');
  const prompt = (over) => {
    vm.runInContext('leadContext = ""; window._lpNoApptLeadId = ""; window._leadProResolvedSigner = null; lastScrapedData = null;', sb);
    const b = 'CONVERSATION TRANSCRIPT (newest first):\n---\n[' + ago(0) + ' 8:40 AM] [CUSTOMER] Inbound Text Message\n  Can you do 39,600 out the door?\n---\n';
    return sb.__lp.buildUserPrompt(Object.assign({ name: 'Test Buyer', agent: 'Agent Name', salesRep: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
      vehicle: '2027 Honda CR-V EX-L', stockNum: 'TEST001A', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Dealer Eprocess - Website Auto',
      convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 3, relationshipSignals: {},
      conversationBrief: b, context: b, lastInboundMsg: 'Can you do 39,600 out the door?' }, over || {}));
  };
  const p1 = prompt();
  check('lead 2094092453 shape: no "your Sales Representative, Agent"; the hand-off is to "one of our Sales Representatives"',
    () => [/your Sales Representative, Agent/i.test(p1), /When they come in, one of our Sales Representatives will have the purchase proposal ready/.test(p1)], [false, true]);
  check('...and the Sales Rep line says no separate Sales Rep is assigned yet', () => /Sales Rep:  Agent Name  ← the same person as the BD Agent: no separate Sales Rep is assigned yet/.test(p1), true);
  const p2 = prompt({ salesRep: 'Rep Name' });
  check('control: a different Sales Rep is still named for the hand-off', () =>
    [/your Sales Representative, Rep/.test(p2), /one of our Sales Representatives/.test(p2), /no separate Sales Rep is assigned yet/.test(p2)], [true, false, false]);

  console.log(' 4. Kia\'s "Competitive Bonus" is conquest cash (Gil, 10/4):');
  const DAY = 86400000, NOW = Date.now();
  const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
  const ent = (ms, tag, body) => '[' + fmt(ms) + '] [' + tag + '] ' + (tag === 'CUSTOMER' ? 'Inbound' : 'Outbound') + ' Text Message\n  ' + body + '\n';
  const T_C = NOW - 0.9 * DAY, T_A = NOW - 0.8 * DAY;
  const KBRIEF = 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + ent(T_A, 'AGENT', 'Test, send the photos whenever you are ready.')
    + ent(T_C, 'CUSTOMER', 'I can send photos of my trade in') + '[' + fmt(T_C - DAY) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n---\n';
  const KIA = (lines) => ({ incentives: lines.map(l => ({ model: 'Telluride', line: l, expires: '2099-09-30' })) });
  const fit = (trade, lines) => {
    sb.__vf = KIA(lines);
    vm.runInContext('activeFlags = new Set(); leadContext = ""; _lpValueFactCache["6190"] = { vf: globalThis.__vf };', sb);
    sb.populateFromData({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '2027 Kia Telluride S FWD', condition: 'New', dealerId: '6190', store: 'Community Kia Baytown',
      leadSource: 'Truecar', convState: 'active-follow-up', leadAgeDays: 2, totalNoteCount: 12, hasOutbound: true, hasCustomerReply: true, relationshipSignals: {},
      history: '', context: '', conversationBrief: KBRIEF, lastInboundMsg: 'I can send photos of my trade in', tradeDescription: trade, hasTrade: !!trade,
      outboundSends: [{ title: 'outbound text message', ms: T_A, body: 'Sent by: Agent Name Test, send the photos whenever you are ready.' }] });
    const m = vm.runInContext('leadContext', sb).match(/🏷 PROGRAM FIT:[^\n]*/); return m ? m[0] : '';
  };
  const LIVE = ['Telluride — $750 Competitive Bonus Program', 'Telluride — $750 Owner Loyalty Bonus'];
  check('live Kia names, a Honda trade: no loyalty; "the COMPETITIVE BONUS (conquest cash)" is the one to mention', () => {
    const t = fit('2018 Honda Pilot EX', LIVE);
    return [/do NOT offer the loyalty cash/.test(t), /The COMPETITIVE BONUS \(conquest cash\) is for owners of another brand: their Honda likely qualifies/.test(t)]; }, [true, true]);
  check('live Kia names, a Kia trade: the Competitive Bonus does not fit; loyalty does', () =>
    /The COMPETITIVE BONUS \(conquest cash\) is for owners of ANOTHER brand, so do NOT offer it to them; the OWNER LOYALTY cash is the one that fits/.test(fit('2019 Kia Sorento LX', LIVE)), true);
  check('a Kia trade with only the Competitive Bonus on file -> told not to offer it (v9.7.756 said nothing)', () =>
    /do NOT offer it to them\.$/.test(fit('2019 Kia Sorento LX', ['Telluride — $750 Competitive Bonus Program'])), true);
  check('control: "Conquest Cash" by name still reads "CONQUEST cash"', () => /CONQUEST cash is for owners of ANOTHER brand/.test(fit('2019 Kia Sorento LX', ['Telluride — $750 Conquest Cash'])), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
