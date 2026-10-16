#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('payment-target-759.test.js');
// (v9.7.759) Kia Baytown, 10/5 (log277). On a call the customer told the sales rep he wanted a $300 lease payment with
// no money down; the rep's General Note said so. His texts then asked "Lease only, seeking low payment 24, 36, 48-months,
// 12k mileage" about a "Sportage or Seltos, SX Prestige Plug In Hybrid". The store's lowest Sportage Plug-in Hybrid
// lease was $349/mo with $3,999 due. Three gaps: (1) the customer-asked override missed that lease/payment talk, so the
// waiting-on-us rule held the offers back; (2) nothing read the staff note's target; (3) both drafts repeated
// "Seltos ... Plug-In Hybrid", a car that does not exist. Executes the shipped _lpPaymentTarget, _lpLeaseFloor and
// populateFromData. Placeholder names and figures only.
//
// Usage: node tests/payment-target-759.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: payment-target-759.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const DAY = 86400000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const ent = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const T_SEND = NOW - 0.2 * DAY, T_NOTE = NOW - 0.1 * DAY, T_C1 = NOW - 0.05 * DAY, T_C2 = T_C1 + 60000, T_C3 = T_C1 + 180000;
const NOTE = 'By: Rep Name wants a 300$ payment on a lease, doesn’t want to put any money down, was being very unrealistic with his goal';
const LEASE_TXT = 'Lease only,  seeking low payment 24, 36, 48-months, 12k mileage';
const MODELS_TXT = 'Possible Sportage or Seltos, SX Prestige Plug  In Hybrid';
const brief = (noteBody, extra) => 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + (extra || '')
  + ent(T_C3, 'CUSTOMER', 'Inbound Text Message', LEASE_TXT) + ent(T_C2, 'CUSTOMER', 'Inbound Text Message', MODELS_TXT)
  + ent(T_C1, 'CUSTOMER', 'Inbound Text Message', 'I’m looking')
  + (noteBody ? ent(T_NOTE, 'NOTE', 'General Note', noteBody) : '')
  + ent(T_SEND, 'AGENT', 'Outbound Text Message', 'Hi Test, what are you looking for?')
  + '[' + fmt(T_SEND - DAY) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n---\n';
const EXP = new Date(NOW + 30 * DAY).toISOString().slice(0, 10);
const INC = [
  ['Sportage', 'Sportage — $259/mo 24 mo lease ($3,999 due at signing) — applies to LX FWD'],
  ['Sportage Hybrid', 'Sportage Hybrid — $279/mo 24 mo lease ($3,999 due at signing) — applies to LX FWD'],
  ['Sportage Plug-in Hybrid', 'Sportage Plug-in Hybrid — $349/mo 24 mo lease ($3,999 due at signing) — applies to X-Line AWD'],
  ['Sportage Plug-in Hybrid', 'Sportage Plug-in Hybrid — $379/mo 36 mo lease ($3,999 due at signing) — applies to X-Line AWD'],
  ['Sportage Plug-in Hybrid', 'Sportage Plug-in Hybrid — 0% APR for 48 mos'],
  ['Sorento', 'Sorento — $329/mo 36 mo lease ($3,999 due at signing) — applies to LX FWD'],
].map(([model, line]) => ({ model, year: '2026', line, expires: EXP }));
const SENDS = [{ title: 'outbound text message', ms: T_SEND, body: 'Sent by: Agent Name Hi Test, what are you looking for?' }];

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const has = (n) => typeof sb[n] === 'function';

  console.log(' 1. the payment target, read from a staff note or the customer:');
  const tgt = (b) => has('_lpPaymentTarget') ? (r => r && [r.payment, r.zeroDown, r.from, r.by])(sb._lpPaymentTarget({ conversationBrief: b })) : 'no helper';
  check('log277 note: "wants a 300$ payment on a lease, doesn’t want to put any money down" -> $300, no money down, from the note',
    () => tgt(brief(NOTE)), [300, true, 'note', 'Rep Name']);
  check('the customer\'s own words: "I need to stay under $350 a month" -> $350 from the customer (new helper)',
    () => tgt(brief('', ent(T_C3 + 60000, 'CUSTOMER', 'Inbound Text Message', 'I need to stay under $350 a month'))), [350, false, 'customer', '']);
  check('control (new helper): a note recording OUR offer ("offered $299 a month with $2,000 down") is not their target',
    () => tgt(brief('By: Rep Name offered $299 a month with $2,000 down')), null);
  check('control (new helper): our own text naming a payment is not their target',
    () => tgt(brief('', ent(T_C3 + 60000, 'AGENT', 'Outbound Text Message', 'The lease is $299 a month'))), null);
  check('control (new helper): a target recorded on an OLDER lead (below the marker) is not read',
    () => tgt(brief('') + ent(T_SEND - 2 * DAY, 'NOTE', 'General Note', NOTE)), null);

  console.log(' 2. the prompt on the log277 shape:');
  const run = (extra) => {
    sb.__vf = { incentives: INC };
    vm.runInContext('activeFlags = new Set(); leadContext = ""; _lpValueFactCache["6190"] = { vf: globalThis.__vf, inv: null, fetchedAt: Date.now(), invSettledAt: Date.now(), pending: false };', sb);
    sb.populateFromData(Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '2026 Kia Sportage Plug-In Hybrid', condition: 'New', dealerId: '6190',
      store: 'Community Kia Baytown', leadSource: 'Truecar/Ticketsatwork', convState: 'active-follow-up', leadAgeDays: 1, totalNoteCount: 39, hasOutbound: true,
      hasCustomerReply: true, relationshipSignals: {}, history: '', context: '', conversationBrief: brief(NOTE), outboundSends: SENDS,
      lastInboundMsg: 'I’m looking / ' + MODELS_TXT + ' / ' + LEASE_TXT }, extra || {}));
    return vm.runInContext('leadContext', sb);
  };
  const c = run();
  const blk = (c.match(/💲 THEIR PAYMENT TARGET vs THE STORE'S REAL LEASE OFFERS:[^\n]*/) || [''])[0];
  check('the store\'s lease lines now reach the prompt: "lease only, low payment, 24/36/48 months" counts as asking',
    () => /💲 STORE INCENTIVE[^\n]*Sportage Plug-in Hybrid/.test(c), true);
  check('the target block: $300 with no money down, from a call, against the $349 Plug-in Hybrid lease',
    () => [/want about \$300\/month on a lease with no money down \(recorded in a staff note\)/.test(blk), /lowest current lease on what they asked about is Sportage Plug-in Hybrid — \$349\/mo/.test(blk)], [true, true]);
  check('...closer options in the family: Sportage $259 and Sportage Hybrid $279 (not the Sorento)',
    () => [/Sportage — \$259\/mo/.test(blk), /Sportage Hybrid — \$279\/mo/.test(blk), /Sorento/.test(blk)], [true, true, false]);
  check('...and what to do: real number, ask which to move, never promise it, never "unrealistic", never the note',
    () => [/ask which they would rather move on -- the trim or model, the amount due at signing, or the term/.test(blk), /Do NOT promise or imply their target can be met/.test(blk),
      /Do NOT call their goal unrealistic, and do NOT mention the note or who wrote it/.test(blk)], [true, true, true]);
  check('control: a $400 target with money down allowed -> no block (the offers are within reach)',
    () => /THEIR PAYMENT TARGET/.test(run({ conversationBrief: brief('By: Rep Name wants a $400 payment on a lease') })), false);
  check('control: no target anywhere -> no block', () => /THEIR PAYMENT TARGET/.test(run({ conversationBrief: brief('') })), false);
  check('control: a used vehicle of interest -> no block (new-car programs do not apply)', () => /THEIR PAYMENT TARGET/.test(run({ condition: 'Used' })), false);

  console.log(' 3. no plug-in hybrid Seltos:');
  check('"Sportage or Seltos ... Plug In Hybrid" -> the reference line says there is no plug-in Seltos',
    () => /there is no plug-in hybrid Seltos[^\n]*never pair "Seltos" with "Plug-In Hybrid"/.test(c), true);
  check('control: Seltos with no plug-in talk -> no such line',
    () => /plug-in hybrid Seltos/.test(run({ vehicle: '2026 Kia Seltos SX', conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + ent(T_C1, 'CUSTOMER', 'Inbound Text Message', 'Is the Seltos still there?') + '---\n', lastInboundMsg: 'Is the Seltos still there?' })), false);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
