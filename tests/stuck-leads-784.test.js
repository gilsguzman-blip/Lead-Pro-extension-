#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('stuck-leads-784.test.js');
// (v9.7.784) The 10/9 feedback export's rejected sessions, read against the VinSolutions notes for each lead:
//  1. Honda Lafayette 2096116717 (AMP lease end, no vehicle, nothing naming a brand): every draft said "her Kia agreement" --
//     the lease-or-finance rule's example was hard-coded "as your current Kia agreement comes due" -- and the email told the
//     customer "without assuming whether she leased or financed".
//  2. Honda Baytown 2073356549 (Facebook, 45d, never replied): our messages had asked the close-out question four times
//     (9/21, 9/22, 10/5 email + voicemail); rung 5 asked it a fifth, and three rewordings were rejected.
//  3. Kia Baytown 2096861231: an out-of-state PO Box on the record made the drafts "remote", while the TrueCar lead on the
//     same customer said "Search ZIP was 77520, 9 miles from your dealership".
//  4. Same lead: minutes old, so a first touch -- but the BDC agent had spoken with her the day before and the salesperson
//     texted "We just got off the phone" that afternoon, on her other lead.
// Executes the shipped buildUserPrompt, buildSystemPrompt and the new helpers. Placeholder data only; dates are relative to now.
//
// Usage: node tests/stuck-leads-784.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stuck-leads-784.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = n => String(n).padStart(2, '0');
const D = (daysAgo, h) => { const d = new Date(Date.now() - daysAgo * 86400000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + (h || '10:00 AM'); };
const BASE = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [] }, context: '' };

// 1. lease end, account type unknown, Honda store
const L1 = Object.assign({}, BASE, { vehicle: '', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Lease Finance Maturity', convState: 'first-touch', leadAgeDays: 1, hasOutbound: false, totalNoteCount: 3 });
// 2. stalled, never replied, close-out asked five times
const SENDS = [[0.2, 'Outbound Text Message', 'Test, how would you prefer I stay in touch: text, email, or no more messages?'],
  [2, 'Email reply to prospect', 'Test, something changed that could make this worth another look.'],
  [4, 'Email reply to prospect', 'How would you prefer we handle future contact: text, email, or no more messages from us?'],
  [4, 'Outbound phone call (Machine)', 'Left message - text, email, or no more messages? No pressure either way.'],
  [17, 'Email reply to prospect', 'Should I close this out for now, or keep it open?'],
  [18, 'Outbound Text Message', 'Should I keep this open or close it out for now?'],
  [35, 'Outbound Text Message', 'Test, the Crystal Black Pearl Accord Hybrid Sport-L you asked about has sold.'],
  [38, 'Email reply to prospect', 'Hi Test, what can I do to help?'], [40, 'Outbound Text Message', 'Hi Test, what can I do to help?']];
const hist = (sends) => sends.map(([d, t, b]) => '[' + D(d) + '] [AGENT] ' + t + '\n  ' + b).join('\n') + '\n[' + D(45, '6:53 PM') + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n';
const L2 = (sends) => Object.assign({}, BASE, { vehicle: '2026 Honda Accord Hybrid Sport-L', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Facebook',
  convState: 'active-follow-up', leadAgeDays: 45, hasOutbound: true, hasCustomerReply: false, isContacted: false, _isStalled: true, _neverReplied: true, totalNoteCount: 42,
  relationshipSignals: { unansweredQuestions: [], totalOutboundCount: 9 }, context: hist(sends), history: hist(sends) });
const NO_CO = SENDS.map(([d, t, b]) => [d, t, /text, email|close|keep (?:it|this) open/i.test(b) ? 'Test, the Accord Hybrid is still a good fit. What matters most to you?' : b]);
const ONE_CO = NO_CO.map((x, i) => i === 0 ? SENDS[0] : x);
// 3. TrueCar search ZIP vs an out-of-state mailing address
const SZ = (zip, mi) => '[' + D(1, '3:46 PM') + '] [SYSTEM] Lead received\n  *** SEARCH ZIP ***\nSearch ZIP is ' + zip + ' which is different than the Address ZIP. Search ZIP was ' + zip + ', ' + mi + ' miles from your dealership.\n';
const L3 = (ctx) => Object.assign({}, BASE, { vehicle: '2026 Kia K4 GT-Line', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Truecar', convState: 'first-touch',
  leadAgeDays: 0, hasOutbound: false, totalNoteCount: 2, customerState: 'CA', customerZip: '90001', context: ctx });
// 4. a new lead on a customer already in conversation on another lead
const MARK = '[' + D(0.01, '7:45 PM') + '] [=== CURRENT LEAD SUBMITTED HERE ===]';
const PRIOR = (days) => ['[' + D(days, '1:42 PM') + '] [AGENT] Outbound Text Message\n  Hey Test, this is Rep Name with Community Kia. We just got off the phone. You can reach me here if you have any questions',
  '[' + D(days + 1, '4:07 PM') + '] [AGENT] Outbound phone call (Contacted)\n  invited her in. will think about it', '[' + D(days + 1, '3:46 PM') + '] [SYSTEM] Lead received\n  BUILD: 2026 Kia K4 GT-Line'].join('\n');
const L4 = (ctx) => Object.assign({}, BASE, { vehicle: '2027 Kia K5 GT-Line AWD', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Kia Digital - 3rd Party Lead',
  convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, totalNoteCount: 12, customerState: 'TX', customerZip: '77520', context: ctx });

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('activeFlags = new Set();', sb);
  const up = (d) => quiet(() => sb.__lp.buildUserPrompt(d));
  const fn = (n) => vm.runInContext('typeof ' + n + ' === "function" ? ' + n + ' : null', sb);

  console.log(' 1. lease end, lease or loan unknown:');
  const p1 = up(L1);
  check('lead 2096116717 shape: the example names no make ("as your current agreement comes due"), and no "Kia agreement" on a Honda store', () =>
    [/Use neutral framing — "as your current agreement comes due" \(name the make only if the lead or the notes name it\)/.test(p1), /Kia agreement/.test(p1)], [true, false]);
  check('the rule says to stay silent about it: "without assuming whether you leased or financed" is the rule leaking', () =>
    /never tell the customer you do not know which it is or are not assuming it \("without assuming whether you leased or financed" is this rule leaking\)/.test(p1), true);
  check('the loyalty flag line says it too', () => /Never tell them you do not know or are not assuming it \(v9\.7\.784\): just use the neutral words\./.test(up(Object.assign({}, L1, { leadSource: 'Internet', activeFlags: ['loyalty'] }))), true);
  check('control: an off-loan lead still gets the loan framing, not the neutral line', () => {
    const p = up(Object.assign({}, L1, { leadSource: 'Off-Loan in 3 months' })); return [/They OWN this on a loan/.test(p), /We do NOT know whether this customer leased or financed/.test(p)]; }, [true, false]);

  console.log(' 2. the close-out question, already asked:');
  const coA = fn('_lpCloseOutAsked');
  check('(new helper) lead 2073356549 shape: 5 unanswered asks -- channel x3, file x2', () => { const r = coA(hist(SENDS)); return [r.n, r.moves.channel.length, r.moves.record.length]; }, [5, 3, 2]);
  check('(new helper) a customer reply resets it: only our asks after their last message count', () =>
    coA('[' + D(3, '9:00 AM') + '] [CUSTOMER] Inbound Text Message\n  still looking\n' + hist(SENDS)).n, 1);
  const p2 = up(L2(SENDS));
  check('rung 5 stops asking: "CLOSE-OUT ALREADY ASKED, NOW ONE NEW REASON", lists what was asked, bans every form of it', () =>
    [/STALLED LEAD RE-ENGAGEMENT -- PHASE 5 -- CLOSE-OUT ALREADY ASKED, NOW ONE NEW REASON/.test(p2), /THE CLOSE-OUT QUESTION HAS ALREADY GONE UNANSWERED 5 TIMES ON THIS LEAD: how they want to hear from us \(text, email, or no more\) \([^)]*\); whether to keep the file open or close it out/.test(p2),
     /Do NOT ask it again in any form -- not the channel, not the file, not the timing/.test(p2), /\(A\) THE CHANNEL -- THE DEFAULT/.test(p2)], [true, true, true, false]);
  check('the stall-recovery voice no longer asks for "a clean, easy out" on that lead -- it says the exit was already offered', () => {
    sb.__L2 = L2(SENDS); vm.runInContext('lastScrapedData = globalThis.__L2', sb); const s = quiet(() => sb.__lp.buildSystemPrompt('internet_director'));
    return [/Give them a clean, easy out/.test(s), /The exit has ALREADY been offered on this lead and went unanswered \(5 times\): do not offer it again/.test(s)]; }, [false, true]);
  check('control: no close-out asked yet -> rung 5 as before, the channel ask first; the voice keeps its easy out', () => {
    const p = up(L2(NO_CO)); sb.__L2 = L2(NO_CO); vm.runInContext('lastScrapedData = globalThis.__L2', sb); const s = quiet(() => sb.__lp.buildSystemPrompt('internet_director'));
    return [/PHASE 5 -- GRACEFUL CLOSE-OUT/.test(p), /\(A\) THE CHANNEL -- THE DEFAULT/.test(p), /ALREADY ASKED ON THIS LEAD|ALREADY GONE UNANSWERED/.test(p), /Give them a clean, easy out/.test(s)]; }, [true, true, false, true]);
  check('one unanswered ask -> rung 5 stays, told not to repeat that move', () => {
    const p = up(L2(ONE_CO)); return [/PHASE 5 -- GRACEFUL CLOSE-OUT/.test(p), /ALREADY ASKED ON THIS LEAD, NO ANSWER: how they want to hear from us \(text, email, or no more\) \([^)]*\)\. Do NOT ask that again; if you offer an out, use a different move\./.test(p)]; }, [true, true]);
  check('the arc counts our close-out words as the stepback angle ("close it out", "keep it open", "no more messages")', () =>
    ['Should I keep this open or close it out for now?', 'text, email, or no more messages?', 'What matters most to you?']
      .map(b => vm.runInContext('_lpArcAnglesSpent', sb)([{ body: b, ms: 1 }]).spent.some(s => s.angle === 'stepback')), [true, true, false]);

  console.log(' 3. the lead source\'s search ZIP over a mailing address:');
  check('lead 2096861231 shape: CA PO Box address, "Search ZIP was 77520, 9 miles from your dealership" -> no REMOTE block', () =>
    /REMOTE \/ OUT-OF-STATE BUYER: Customer is NOT local/.test(up(L3(SZ('77520', 9)))), false);
  check('control: the same address with no search ZIP -> REMOTE, as before', () => /REMOTE \/ OUT-OF-STATE BUYER: Customer is NOT local/.test(up(L3(''))), true);
  check('control: a search ZIP 420 miles away and outside the local set -> still REMOTE', () => /REMOTE \/ OUT-OF-STATE BUYER: Customer is NOT local/.test(up(L3(SZ('10001', 420)))), true);
  check('(new helper) the parse: zip, miles, local', () => { const r = fn('_lpSearchZipLocal')({ dealerId: '6190', context: SZ('77520', 9) }); return r && [r.zip, r.miles, r.local]; }, ['77520', 9, true]);

  console.log(' 4. a new lead on a customer already in conversation:');
  const p4 = up(L4(MARK + '\n' + PRIOR(0.25) + '\n'));
  check('lead 2096861231 shape: "SAME CUSTOMER, ALREADY IN CONVERSATION" -- not a first introduction, no "Your online inquiry is for..."', () =>
    /⚠ SAME CUSTOMER, ALREADY IN CONVERSATION: this lead is new, but the customer is not\. Before it arrived, on their other inquiry, our message says we spoke with them \([^)]*Outbound Text Message\)\. Do NOT write this as a first introduction, and do not announce their inquiry back to them as news \("Your online inquiry is for\.\.\."\)/.test(p4), true);
  check('control: contact on the other lead 10 days ago, or we already wrote on this lead, or no lead marker -> no block', () => [
      /SAME CUSTOMER, ALREADY IN CONVERSATION/.test(up(L4(MARK + '\n' + PRIOR(10) + '\n'))),
      /SAME CUSTOMER, ALREADY IN CONVERSATION/.test(up(L4('[' + D(0.005, '7:50 PM') + '] [AGENT] Outbound Text Message\n  Test, thanks for the request.\n' + MARK + '\n' + PRIOR(0.25) + '\n'))),
      /SAME CUSTOMER, ALREADY IN CONVERSATION/.test(up(L4(PRIOR(0.25) + '\n')))], [false, false, false]);
  check('(new helper) the newest live contact wins, and a bot text is not contact', () => {
    const r = fn('_lpSisterLeadContact')(MARK + '\n[' + D(0.1, '5:00 PM') + '] [AGENT] Outbound Text Message\n  Hi Test, this is the virtual assistant! Would you come in today at 7:00 PM?\n' + PRIOR(0.25) + '\n');
    return r && r.what; }, 'our message says we spoke with them');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
