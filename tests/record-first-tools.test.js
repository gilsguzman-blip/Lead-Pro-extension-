#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('record-first-tools.test.js');
// RECORD-FIRST (experiment, tools/record-first). Executes the record builder, the facts builder, the prompt builders and
// the scraper patch on placeholder notes shaped like the 28 saved VinSolutions page saves (dir / tags / title / body as
// the CRM renders them). Nothing here ships in a build yet; this keeps the replay tooling honest while it is evaluated.
//
// Usage: node tests/record-first-tools.test.js
const fs = require('fs'), path = require('path');
const RF = require('../tools/record-first/record-first.js');
const { patchScraper } = require('../tools/record-first/scraper-record.js');
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// VinSolutions lists newest first.
const NOTES = [
  { when: '10/05/2026 9:33 AM', title: 'Inbound Text Message', dir: 'inbound', tags: 'Communication-Texts', body: 'Received from: (555) 010-0199\nReceived by: Agent Name\nI’m not available to' },
  { when: '10/05/2026 9:31 AM', title: 'General Note', dir: '', tags: 'Note', body: 'By: Agent Name\nCustomer wants a $300 payment, no money down.' },
  { when: '10/05/2026 9:31 AM', title: 'Email reply to prospect', dir: 'outbound', tags: 'Email-Communication', body: 'Subject: Your Wrangler\nBy: Agent Name\nHi Test, the Wrangler is here. Would 11:30 AM or 12:15 PM today work?\nYou are receiving this email because you inquired about a vehicle. Click here to unsubscribe.' },
  { when: '10/05/2026 9:30 AM', title: 'Outbound phone call', dir: 'outbound', tags: 'Phone-Communication', body: 'By: System\nhttps://www.callmeasurement.com/review_x.cfm?cid=1&lid=2' },
  { when: '10/05/2026 9:30 AM', title: 'Outbound phone call (Machine)', dir: 'outbound', tags: 'Phone-Communication', body: 'By: Agent Name\nLeft message - Hi Test, the Wrangler is here.' },
  { when: '10/04/2026 8:20 AM', title: 'Email reply from prospect', dir: 'inbound', tags: 'Email-Communication', body: 'Subject: Re: Your Wrangler\nBy: Agent Name\nThat’s fine, text me.\nOn Mon, Oct 4, 2026 at 8:00 AM Agent Name <agent@example.com> wrote:\n> Can I text you?' },
  { when: '10/03/2026 7:32 PM', title: 'Outbound Text Message', dir: 'outbound', tags: 'Communication-Texts', body: 'Sent to: (555) 010-0199\nSent by: Vinessa Virtual Assistant Test Store\nReply YES to receive text messages.' },
  { when: '10/03/2026 7:32 PM', title: 'Marketing Campaign Email', dir: 'outbound', tags: 'Email-Communication', body: 'Subject: Fall savings event\nBy: System\nLong marketing body...' },
  { when: '10/03/2026 7:31 PM', title: 'Lead received', dir: 'inbound', tags: 'Email-Communication', body: 'By: System\nClick for Lead Info: https://dealer.example.com/l/abc\nTrade-In Vehicle: 2014 Test Sedan\nHow much were repair costs?\nDashboard warning lights\nNet Trade-in Value: $800' },
  { when: '01/12/2025 2:00 PM', title: 'Inbound Text Message', dir: 'inbound', tags: 'Communication-Texts', body: 'Received from: (555) 010-0199\nDo you have a 2023 in red?' },
];
const START = new Date('10/03/2026 7:31 PM').getTime();

console.log(' 1. the record:');
const rec = RF.rfBuildRecord(NOTES, START);
const lines = rec.text.split('\n');
check('every note but the bare call-recording link is kept', () => rec.count, NOTES.length - 1);
check('oldest first: the 2025 text, then the lead form, then the newest customer text last', () =>
  [lines.findIndex(l => /Do you have a 2023/.test(l)) < lines.findIndex(l => /LEAD FORM/.test(l)), /I’m not available to$/.test(lines[lines.length - 1])], [true, true]);
check('the current-lead marker sits between the earlier history and the lead form', () => {
  const m = lines.findIndex(l => /THE CURRENT LEAD STARTS HERE/.test(l));
  return [m > lines.findIndex(l => /Do you have a 2023/.test(l)), m < lines.findIndex(l => /LEAD FORM/.test(l)), /EARLIER HISTORY/.test(lines[0])]; }, [true, true, true]);
check('labels: customer, automated assistant, staff by name, lead form, automated email', () =>
  [/\] CUSTOMER — text: I’m not available to/.test(rec.text), /AUTOMATED ASSISTANT \(Vinessa Virtual Assistant Test Store\) — text to customer/.test(rec.text),
   /AGENT NAME \(staff\) — General Note/.test(rec.text), /LEAD FORM — what came in with the lead/.test(rec.text),
   /AUTOMATED EMAIL — Marketing Campaign Email sent to the customer: subject "Fall savings event" \(body omitted/.test(rec.text)], [true, true, true, true, true]);
check('a staff note is kept whole (the facts an agent wrote down reach the model)', () => /Customer wants a \$300 payment, no money down\./.test(rec.text), true);
check('legal footer cut, quoted reply cut, links replaced, routing header lines dropped', () =>
  [/receiving this email/.test(rec.text), /Can I text you/.test(rec.text), /callmeasurement|dealer\.example/.test(rec.text), /Received from|Sent to/.test(rec.text), /\[link\]/.test(rec.text)],
  [false, false, false, false, true]);
check('the form question stays in the form, labelled as the form (the model is told form fields are not questions)', () =>
  /LEAD FORM[\s\S]*How much were repair costs\?/.test(rec.text), true);
check('no lead start found: the record says so instead of guessing', () => /could not be found/.test(RF.rfBuildRecord(NOTES, 0).text), true);

console.log(' 2. the facts:');
const INV = { generated: '2026-10-06', units: [
  { stock: 'P1001', vin: 'VIN0000000000001', vehicle: '2018 Jeep Wrangler Unlimited Sport', make: 'Jeep', model: 'Wrangler Unlimited', condition: 'used', certified: false, color: 'Black', odometer: 78000, daysOnLot: 62 },
  { stock: 'P1002', vin: 'VIN0000000000002', vehicle: '2016 Jeep Wrangler Rubicon', make: 'Jeep', model: 'Wrangler', condition: 'used', certified: false, color: 'Black' } ] };
const INC = [{ model: 'Wrangler', year: '2026', line: 'Wrangler — $1,000 bonus', expires: '2026-11-01' }, { model: 'Wrangler', year: '2026', line: 'Wrangler — old offer', expires: '2026-09-01' }];
const HOURS = { name: 'Test Store', weekday: '9 AM - 7 PM', saturday: '9 AM - 6 PM', sunday: 'CLOSED' };
const SIGNER = { name: 'Agent Name', title: 'Internet Sales Coordinator', store: 'Test Store', phone: '(555) 010-0100', salesRep: 'Rep Name' };
const NOW = Date.parse('2026-10-06T18:58:00Z');   // Tuesday 1:58 PM Central
const facts = (d, extra) => RF.rfBuildFacts(Object.assign({ name: 'Test Buyer', phone: '(555) 010-0199', email: 'test@example.com', vehicle: '2018 Jeep Wrangler Unlimited Sport', stockNum: 'P1001', leadSource: 'Internet', leadAgeDays: 3 }, d),
  Object.assign({ now: NOW, hours: HOURS, signer: SIGNER, inv: INV, incentives: INC, closeOut: { eligible: false, reason: 'replied 1d ago' } }, extra));
const f = facts({});
check('the clock is Central and the store is open, with a start window that leaves an hour', () =>
  [/NOW: Tuesday 10\/6\/2026, 1:58 PM Central\./.test(f), /RIGHT NOW: open until 7 PM\. A visit today can start between 3 PM and 6 PM\./.test(f)], [true, true]);
check('closed days are marked in the week ahead', () => /Sunday 10\/11 \(CLOSED\)/.test(f), true);
check('the lead\'s unit is IN STOCK with its details; the other Wrangler is listed as an alternative', () =>
  [/IN STOCK \(inventory feed dated 2026-10-06\): 2018 Jeep Wrangler Unlimited Sport, Black, used, 78,000 miles, 62 days on the lot\./.test(f), /OTHER WRANGLER UNITS IN STOCK \(1\):\n    - 2016 Jeep Wrangler Rubicon/.test(f)], [true, true]);
check('a unit missing from the feed is reported as not confirmable, never as available', () =>
  /NOT IN THE CURRENT INVENTORY FEED[^\n]*do not tell the customer it is available/.test(facts({ stockNum: 'GONE1' })), true);
check('incentives: expired lines dropped, and flagged as not applying to a used unit', () =>
  [/\$1,000 bonus \(ends 2026-11-01\)/.test(f), /old offer/.test(f), /do NOT apply to the used unit/.test(f)], [true, false, true]);
check('visit and appraisal lengths are the store\'s (30-40 / 10-15)', () => /a visit is about 30-40 minutes; a trade-in appraisal on its own takes 10-15 minutes/.test(f), true);
check('close-out eligibility is a fact with its reason', () => /CLOSING THE FILE: not allowed on this lead \(replied 1d ago\)/.test(f), true);
check('channel facts only when they apply: an opt-out empties the text, a bounce warns about the inbox', () =>
  [/TEXTING/.test(f), /TEXTING: the customer opted out[^\n]*empty string/.test(facts({ isSmsOptOutOnly: true })), /EMAIL: their address is bouncing/.test(facts({ emailBounce: { at: 'x' } }))], [false, true, true]);

console.log(' 3. the prompts and the scraper patch:');
const sys = RF.rfSystemPrompt(SIGNER), sysNR = RF.rfSystemPrompt(SIGNER, { noRead: true });
check('system prompt: the hard rules that replace the old directives are present', () =>
  [/FACTS block is the store\\?'s systems/.test(sys), /AUTOMATED ASSISTANT were not written by you/.test(sys), /Do not re-offer times the customer turned down/.test(sys),
   /form fields, not the customer asking you/.test(sys), /no stock numbers, VINs/.test(sys), /has sold, its numbers are finished/.test(sys), /English only/.test(sys)], [true, true, true, true, true, true, true]);
check('with the read: asks for it first; without: the JSON has no read and the steps renumber', () =>
  [/"read":\{/.test(sys), /"read"/.test(sysNR), /2\. Then write the drafts\./.test(sysNR)], [true, false, true]);
check('user prompt: facts, then the whole record, then the ask', () => { const u = RF.rfUserPrompt(f, rec);
  return [u.indexOf('━━━ FACTS') < u.indexOf('━━━ THE RECORD — 9 notes'), u.indexOf(rec.text) > 0]; }, [true, true]);
const dev = fs.readFileSync(path.join(__dirname, '..', 'builds', 'dev', 'popup.js'), 'utf8');
check('the scraper patch lands inside inlineScraper, once, and the patched build still parses', () => {
  const p = patchScraper(dev), a = p.indexOf('  function inlineScraper() {'), b = p.indexOf('  } // end inlineScraper', a), i = p.indexOf('recordNotes: (function');
  new (require('vm').Script)(p);
  return [i > a && i < b, p.split('recordNotes: (function').length - 1, patchScraper(p) === p]; }, [true, 1, true]);
check('the shipped build is untouched (the experiment is not in it yet)', () => /recordNotes:/.test(dev), false);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
