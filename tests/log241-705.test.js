#!/usr/bin/env node
'use strict';
// (v9.7.705) log241, Honda Lafayette (dump 22fef1da, capture 3b3913a7). Two defects on one lead:
//  1. The customer texted on 9/15 that they are deaf and cannot speak or hear, and a rep's call note says
//     "Only text. Is deaf". Neither reached the prompt, which still demanded a voicemail with the number
//     said twice. _lpHearingLimit reads the whole record; populate states it as a hard fact.
//  2. We pivoted from the sold unit on 9/14 with "$349/month ... $4,899 due at signing"; on 9/23 the
//     SOLD -> INCENTIVE PIVOT block told the model to LEAD with the same offer again, and the email
//     re-quoted it to a customer asking for zero down near $200. _lpOfferAlreadyInThread demotes it.
// Runs the shipped helpers and populateFromData out of the whole popup.js. Fixtures are synthetic.
//
// Usage: node tests/log241-705.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: log241-705.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const ent = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const CUST_DEAF = ent('09/15/2026 9:12 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: (555) 010-0199\n  Hello I did call text no answer (555) 010-0199 but I’m deaf can’t speak and hear');
const NOTE_DEAF = ent('09/16/2026 9:31 AM', 'CALL NOTE', 'Outbound phone call (No Contact)', 'By: Agent Name\n  Only text. Is deaf');
const PLAIN = ent('09/23/2026 2:16 PM', 'CUSTOMER', 'Inbound Text Message', 'Ok what else do you have');

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const hl = (ctx) => sb._lpHearingLimit(ctx);
  const off = (ctx, line, model) => sb._lpOfferAlreadyInThread(ctx, line, model);

  // populate with a sold vehicle, a current CR-V incentive and one new comparable in inventory.
  const populate = (history, extra) => {
    const now = Date.now();
    const vf = { vf: { store: 'x', count: 2, incentives: [
        { model: 'CR-V', year: '2027', line: 'CR-V — $349/mo 36 mo lease ($4,899 due at signing)', expires: '2026-12-31' },
        { model: 'CR-V', year: '2027', line: 'CR-V — $339/mo 36 mo lease ($4,199 due at signing)', expires: '2026-12-31' }] },
      inv: { store: 'x', count: 1, units: [{ stock: 'VH1', vin: '2HKRS3H7XVH000001', vehicle: '2027 Honda CR-V EX-L', year: 2027, make: 'Honda',
        model: 'CR-V EX-L', condition: 'new', certified: false, color: 'Radiant Red Metallic', daysOnLot: 3, stockNum: 'VH1' }] },
      fetchedAt: now, invSettledAt: now, _settled: true, pending: false };
    vm.runInContext('_lpValueFactCache["24399"] = ' + JSON.stringify(vf) + '; activeFlags = new Set(); leadContext = "";', sb);
    sb.__logs.length = 0;
    sb.populateFromData(Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '2021 Honda CR-V EX-L', stockNum: '16746A', dealerId: '24399',
      store: 'Community Honda Lafayette', leadSource: 'Internet', convState: 'active-follow-up', leadAgeDays: 9, totalNoteCount: 4, hasOutbound: true,
      hasCustomerReply: true, lastInboundMsg: 'Ok what else do you have', inventoryWarning: true, _rgxInventoryWarning: true, relationshipSignals: {},
      history: history + '=== CURRENT LEAD SUBMITTED HERE ===\n' + ent('09/14/2026 9:00 AM', 'NOTE', 'Lead Received', 'Internet lead') }, extra || {}));
    const ctx = vm.runInContext('leadContext', sb);
    return { ctx, logs: sb.__logs.slice(), lines: ctx.split('\n') };
  };
  const SOLD_PLAIN = ent('09/14/2026 9:59 AM', 'AGENT', 'Outbound Text Message', 'Sent to: (555) 010-0199\n  The 2021 CR-V EX-L you asked about has sold, but I can line up a comparable 2027 CR-V EX-L.');
  const SOLD_QUOTED = ent('09/14/2026 9:59 AM', 'AGENT', 'Outbound Text Message', 'Sent to: (555) 010-0199\n  The 2021 CR-V EX-L you asked about has sold, but a 2027 CR-V EX-L has a qualified lease offer of $349/month for 36 months with $4,899 due at signing.');
  const SOLD_OTHER_LINE = ent('09/14/2026 9:59 AM', 'AGENT', 'Email reply to prospect', 'Subject: CR-V\n  The 2021 CR-V EX-L has sold. A 2027 CR-V EX-L is $329/month for 36 months for qualified buyers.');

  console.log(' _lpHearingLimit — who cannot hear:');
  check("the customer's own words, from a 9/15 text deep in the thread", () => hl(PLAIN + PLAIN + CUST_DEAF),
    { source: 'customer', quote: 'but I’m deaf can’t speak and hear' });
  check('...with their phone number never copied into the quote', () => /\d{3}/.test(hl(CUST_DEAF).quote), false);
  check("a rep's call note (\"Only text. Is deaf\") when the customer never said it", () => hl(PLAIN + NOTE_DEAF), { source: 'note', quote: 'Only text. Is deaf' });
  check("the customer's own words win over a note", () => hl(NOTE_DEAF + CUST_DEAF).source, 'customer');
  check('"hard of hearing" and "hearing impaired" count', () => [
    hl(ent('09/15/2026 9:12 AM', 'CUSTOMER', 'Inbound Text Message', 'I am hard of hearing so text me')).source,
    hl(ent('09/15/2026 9:12 AM', 'CUSTOMER', 'Inbound Text Message', 'hearing-impaired, texts please')).source], ['customer', 'customer']);
  check('"tone-deaf" is not deafness', () => hl(ent('09/15/2026 9:12 AM', 'CUSTOMER', 'Inbound Text Message', 'that last offer was tone-deaf')), null);
  check('"can\'t talk right now" is not deafness', () => hl(ent('09/15/2026 9:12 AM', 'CUSTOMER', 'Inbound Text Message', "can't talk right now, at work")), null);
  check('our own outbound saying it is not evidence', () => hl(ent('09/15/2026 9:15 AM', 'AGENT', 'Outbound Text Message', "I understand you're deaf, we'll text")), null);
  check('nothing in an ordinary thread, or an empty one', () => [hl(PLAIN), hl(''), hl(null)], [null, null, null]);

  console.log(' _lpOfferAlreadyInThread — has the pivot already happened?');
  check('the same figures already in the thread → already offered', () => off(SOLD_QUOTED, 'CR-V — $349/mo 36 mo lease ($4,899 due at signing)', 'CR-V').already, true);
  check('a DIFFERENT line on the same model after we quoted a monthly figure → still already offered', () =>
    off(SOLD_QUOTED, 'CR-V — $339/mo 36 mo lease ($4,199 due at signing)', 'CR-V'), { already: true, why: 'our 09/14/2026 message already quoted $349/month on the CR-V' });
  check('...by email too', () => off(SOLD_OTHER_LINE, 'CR-V — $349/mo 36 mo lease ($4,899 due at signing)', 'CR-V').already, true);
  check("the customer's own \"$200 a month\" is their ask, not our offer", () =>
    off(ent('09/16/2026 9:25 AM', 'CUSTOMER', 'Inbound Text Message', 'I want zero down and $200 a month on the CR-V'), 'CR-V — $349/mo 36 mo lease ($4,899 due at signing)', 'CR-V').already, false);
  check('a monthly figure on a DIFFERENT model is not this offer', () =>
    off(ent('09/14/2026 9:59 AM', 'AGENT', 'Outbound Text Message', 'The Pilot is $499/month for qualified buyers.'), 'CR-V — $349/mo 36 mo lease ($4,899 due at signing)', 'CR-V').already, false);
  check('"CRV" written without the hyphen still matches the CR-V', () =>
    off(ent('09/14/2026 9:59 AM', 'AGENT', 'Outbound Text Message', 'The CRV is $349/month right now.'), 'CR-V — $339/mo 36 mo lease', 'CR-V').already, true);
  check('a sold note with no offer in it → not yet offered', () => off(SOLD_PLAIN, 'CR-V — $349/mo 36 mo lease ($4,899 due at signing)', 'CR-V').already, false);

  console.log(' populateFromData — what reaches the prompt:');
  check('a deaf customer gets the CANNOT HEAR line, quoting their words, and no call or voicemail', () => {
    const r = populate(PLAIN + CUST_DEAF + SOLD_PLAIN);
    const l = r.lines.find(x => /THIS CUSTOMER CANNOT HEAR/.test(x)) || '';
    return [/their own words: "but I’m deaf can’t speak and hear"/.test(l), /Never ask them to call/.test(l), /never mention a voicemail/.test(l),
            r.logs.some(x => /^\[LP HEARING DIAG\] FOUND in the customer's own words/.test(x))]; }, [true, true, true, true]);
  check('...and an ordinary lead gets no such line (the diag says so)', () => {
    const r = populate(PLAIN + SOLD_PLAIN);
    return [r.lines.some(x => /CANNOT HEAR/.test(x)), r.logs.some(x => /^\[LP HEARING DIAG\] no statement/.test(x))]; }, [false, true]);
  check('the log241 shape: sold AND the offer already sent → "ALREADY OFFERED", not "Lead the pivot with THIS"', () => {
    const r = populate(PLAIN + SOLD_QUOTED);
    return [r.lines.some(x => /^💲 ALREADY OFFERED — NOT NEWS/.test(x)), r.ctx.includes('Lead the pivot with THIS'),
            r.logs.some(x => /\[LP SOLD PIVOT DIAG\] ALREADY OFFERED/.test(x))]; }, [true, false, true]);
  check('control: ...and the general STORE INCENTIVE block does not re-pitch it instead (the v9.7.418 latch, unchanged)', () => /STORE INCENTIVE/.test(populate(PLAIN + SOLD_QUOTED).ctx), false);
  check('control: sold, but no offer sent yet → the pivot still leads with the incentive', () => {
    const r = populate(PLAIN + SOLD_PLAIN);
    return [r.ctx.includes('Lead the pivot with THIS'), r.lines.some(x => /ALREADY OFFERED/.test(x))]; }, [true, false]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
