#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('payload-809.test.js');
// (v9.7.809) THE REST OF WHAT buildUserPrompt READS, CARRIED. The v9.7.808 coverage guard found five more fields the prompt
// reads and _lpPromptInputData never carried. Three of them change the wording:
//  - _loyaltyAcctType: a financed KFA/AFS/KMF customer got loan wording from the scenario and "We do NOT know if they leased
//    or financed" from the loyalty flag block in the same prompt (the flag block reads the field with no fallback).
//  - vehiclePendingSale: the Facebook branch said "yes it is here" on a car a note says is being sold.
//  - pdTradeCount: a trade on the deal sheet only, and a price pushback was told "No trade-in is recorded on this lead".
// isInTransit and _lpRepNotOnLot are carried so the prompt and the panel cannot disagree.
// Builds every prompt through the shipped payload literal (tests/helpers/panel-payload.js). Placeholder data only.
//
// Usage: node tests/payload-809.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: payload-809.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function ago(days, hm) {
  const d = new Date(Date.now() - days * 86400000);
  return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear() + ' ' + hm;
}
const MARK = '[' + ago(3, '8:24 PM') + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const BASE = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', phone: '(555) 010-0199',
  email: 'test@example.com', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 2, outboundSends: [], relationshipSignals: { unansweredQuestions: [] },
  history: MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + MARK + '---' }, x || {});
// The price-pushback-745 shape: our breakdown with a trade-in assistance line, and their "we are a bit off".
const BREAKDOWN = 'Hi Test, MSRP 37,100 Price Discount -3100 Available Manufacture Rebates* -$3,000.00 Value Price $31,000.00 Sales & VIT Tax $2,084.74 '
  + 'Remaining Balance $34,748.74 Trade-In-Assistance+ -$500.00 Drive Out with all Incentives $34,248.74 *Must finance +Trade in Assistance customers with Retail ready trade ins Agent Name';
const PUSH = 'We are bit off on the Drive out price, It this your final price?';
const PUSHED = (x) => BASE(Object.assign({ vehicle: '2026 Kia Sorento S', condition: 'New', dealerId: '6190', store: 'Test Kia', leadSource: 'Internet', convState: 'active-follow-up',
  leadAgeDays: 10, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, relationshipSignals: { lastInboundAgeDays: 0 }, history: '', lastInboundMsg: PUSH,
  conversationBrief: ['[' + ago(0, '4:37 PM') + '] [CUSTOMER] Email reply from prospect\n  ' + PUSH, '[' + ago(0, '4:25 PM') + '] [AGENT] Email reply to prospect\n  ' + BREAKDOWN].join('\n') }, x || {}));

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  for (const id of ['6189', '6190', '6191', '24399']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  // populate: run populateFromData on the scrape first, as the panel does (it writes _loyaltyAcctType and _lpRepNotOnLot onto it).
  const viaPanel = (lsd, o) => quiet(() => { o = o || {}; run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;');
    if (o.populate) sb.populateFromData(lsd); (o.flags || []).forEach(fl => run('activeFlags.add(' + JSON.stringify(fl) + ')'));
    const pl = panelPayload(src, sb, { lsd: lsd, context: o.populate ? run('leadContext') : '' }); return { pl: pl, p: sb.__lp.buildUserPrompt(pl) }; });

  console.log(' 1. a loyalty customer who financed:');
  const kfa = viaPanel(BASE({ vehicle: '2022 Kia Sorento LX', dealerId: '6191', store: 'Test Kia', leadSource: 'KFA Maturity - in 4 months', _hcaAccountType: 'finance', convState: 'first-touch' }),
    { populate: true, flags: ['loyalty'] });
  check('the panel hands the prompt the account type the panel resolved', () => kfa.pl._loyaltyAcctType, 'finance');
  check('...so the loyalty flag says FINANCED (loan), never "your lease", and no longer says we do not know which',
    () => [/This customer FINANCED \(loan\), not leased/.test(kfa.p), /do NOT know if they leased or financed/.test(kfa.p)], [true, false]);
  check('control: an unknown account type still stays neutral', () => /do NOT know if they leased or financed/.test(viaPanel(BASE({ vehicle: '2022 Kia Sorento LX', dealerId: '6191',
    store: 'Test Kia', leadSource: 'KMF Maturity', convState: 'first-touch' }), { populate: true, flags: ['loyalty'] }).p), true);

  console.log(' 2. a Facebook Marketplace car a note says is being sold:');
  const FB = (x) => BASE(Object.assign({ vehicle: '2023 Toyota Tacoma SR5', condition: 'Pre-Owned', stockNum: 'P1234', _lpInvConfirmedAvailable: true, dealerId: '6189', store: 'Test Toyota',
    leadSource: 'Facebook Marketplace', convState: 'first-touch', lastInboundMsg: 'Is this still available?' }, x || {}));
  check('the pending sale reaches the prompt: the Facebook branch does not say "yes it is here"',
    () => { const r = viaPanel(FB({ vehiclePendingSale: true })); return [r.pl.vehiclePendingSale, /Give them what they want: yes it is here/.test(r.p)]; }, [true, false]);
  check('control: the same car with no pending sale is still "yes it is here"', () => /Give them what they want: yes it is here/.test(viaPanel(FB()).p), true);

  console.log(' 3. a price pushback from a customer whose trade is on the deal sheet:');
  check('a trade on the deal sheet: no "No trade-in is recorded on this lead"',
    () => { const r = viaPanel(PUSHED({ pdPresent: true, pdTradeCount: 1 })); return [r.pl.pdTradeCount, /THEY PUSHED BACK ON THE PRICE WE SENT/.test(r.p), /No trade-in is recorded/.test(r.p)]; }, [1, true, false]);
  check('control: no trade anywhere still gets the line', () => /No trade-in is recorded on this lead/.test(viaPanel(PUSHED({ pdPresent: true, pdTradeCount: 0 })).p), true);

  console.log(' 4. carried so the prompt and the panel agree:');
  check('in transit and "the rep said it is not on the lot yet" are what the panel resolved',
    () => { const nol = { date: '10/19', quote: 'it is still in service and not on the lot yet' };
      const pl = quiet(() => panelPayload(src, sb, { lsd: BASE({ vehicle: '2026 Toyota RAV4 XLE', isInTransit: true, _lpRepNotOnLot: nol }), context: '' }));
      return [pl.isInTransit, pl._lpRepNotOnLot && pl._lpRepNotOnLot.date]; }, [true, '10/19']);
  check('...and when the panel never worked it out, the prompt still works it out itself (left undefined, not null)',
    () => { const pl = quiet(() => panelPayload(src, sb, { lsd: BASE({ vehicle: '2026 Toyota RAV4 XLE' }), context: '' })); return ['_lpRepNotOnLot' in pl, pl._lpRepNotOnLot === undefined]; }, [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
