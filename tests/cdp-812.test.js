#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('cdp-812.test.js');
// (v9.7.812) THE CDP SUMMARY IS THE READ ON THE CUSTOMER. Kia Baytown lead 2103558746 (KMF Customer Intent Capture, 10/21): the
// Key Information panel's Fullpath CDP summary ("[Customer] leased one vehicle and has many service visits with the dealership")
// sat beside a Buying Signals row, "Browsing. Interests: Expedition, Silverado 1500, New.", and v9.7.807's fill-in turned that row
// into "BUYING SIGNAL DATA: ... use these interests to make the message feel personally relevant". Gil: the intelligence "tends
// to lead the model down the wrong path"; "drop the interests on AI Buying Signals leads too -- we'll run with the CDP info when
// available. Only the Baytown store will have it for now. Lafayette stores will not have it so it can gather info as before."
// Builds every prompt through the shipped panel payload after the shipped populateFromData. Placeholder data only.
//
// Usage: node tests/cdp-812.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: cdp-812.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CDP = { key: 'CustomerSummary', label: 'Fullpath CDP Summary', date: '', blurb: '[Customer] leased one vehicle and has many service visits with the dealership.' };
const ENR = { key: 'CustomerEnrichment', label: 'Customer Intelligence', date: '', blurb: 'Outdoor enthusiast; likely household of four.' };
const BSR = { key: 'BuyingSignals', label: 'Buying Signals', date: '09/29/2026', blurb: 'Browsing. Interests: Expedition, Silverado 1500, New.' };
const AMP = { key: 'Amp', label: 'AMP', date: '10/3/2026', blurb: 'This customer received an AMP marketing event' };
const MARK = '[10/21/2026 8:24 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Kia EV9 GT-Line',
  condition: 'New', dealerId: '6190', store: 'Test Kia', leadSource: 'KMF Customer Intent Capture', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false,
  hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] }, outboundSends: [],
  history: MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + MARK + '---' }, x || {});
const AIBS = (x) => LEAD(Object.assign({ leadSource: 'AI Buying Signals - Previously Sold Customer', vehicle: '' }, x || {}));
const WANDER = /Expedition|Silverado/;

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  for (const id of ['6189', '6190', '6191', '24399']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    const pl = panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }); return { pl: pl, p: sb.__lp.buildUserPrompt(pl) }; });

  console.log(' 1. Baytown: the CDP summary is on the panel:');
  const kmf = viaPanel(LEAD({ keyInfo: [CDP, ENR, BSR, AMP] }));
  check('lead 2103558746: the summary leads the block and is named the best read; the interests and the lifestyle row are gone; the AMP row stays',
    () => [/THE CRM'S OWN SUMMARY OF THIS CUSTOMER[^\n]*\n- Fullpath CDP summary: "\[Customer\] leased one vehicle/.test(kmf.p), /The summary is the best read on this customer/.test(kmf.p),
      WANDER.test(kmf.p), /Outdoor enthusiast/.test(kmf.p), /- AMP: one of our marketing emails went to them \(10\/3\/2026\)/.test(kmf.p)], [true, true, false, false, true]);
  check('...no "use these interests to make the message feel personally relevant", even with the interests already on the scrape',
    () => /BUYING SIGNAL DATA/.test(viaPanel(LEAD({ keyInfo: [CDP, BSR], buyingSignals: BSR.blurb })).p), false);
  const ai = viaPanel(AIBS({ keyInfo: [CDP, BSR], buyingSignals: BSR.blurb }));
  check('an AI Buying Signals lead: written from the summary -- no browsing interests, no "SHOPPING SIGNALS", no guessing at what they looked at',
    () => [WANDER.test(ai.p), /SHOPPING SIGNALS/.test(ai.p), /WHAT WE KNOW OF THEM is the CRM summary/.test(ai.p), /Their browsing interests are not used: do not name, guess at or hint at a vehicle/.test(ai.p)], [false, false, true, true]);
  check('...and the panel hands the prompt no interests, only the panel rows', () => [ai.pl.buyingSignals, (ai.pl.keyInfo || []).length], ['', 2]);

  console.log(' 2. Lafayette: no CDP summary -- the interests work as before:');
  const laf = viaPanel(AIBS({ dealerId: '24399', store: 'Test Honda', keyInfo: [BSR], buyingSignals: BSR.blurb }));
  check('control: an AI Buying Signals lead without the summary still reads its shopping signals', () => [/SHOPPING SIGNALS/.test(laf.p), WANDER.test(laf.p)], [true, true]);
  check('control: any other lead without the summary still gets the panel row filled in and "BUYING SIGNAL DATA"',
    () => { const r = viaPanel(LEAD({ dealerId: '24399', store: 'Test Honda', keyInfo: [BSR] })); return [/BUYING SIGNAL DATA: Browsing\. Interests: Expedition/.test(r.p), /- Buying signals: "Browsing/.test(r.p)]; }, [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
