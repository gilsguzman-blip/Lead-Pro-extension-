#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('same-model-834.test.js');
// (v9.7.834) "THE SAME MODEL" IS THE SAME MODEL, AND A PAINT THAT NAMES ANOTHER COLOR IS NOT THE ONE THEY ASKED FOR. Toyota Baytown
// lead 2082278892, regrabbed on v9.7.833: with the comparables narrowed to the models the customer named, the ALTERNATE CONDITION
// list offered "the same model is also on our lot as used: 2024 Toyota Highlander LE (Midnight Black Metallic); 2018 Toyota
// Highlander LE (Celestial Silver Metallic)" on a Grand Highlander lead -- the strict score shares the word "Highlander" -- and the
// draft offered the Midnight Black one to a customer who asked for white, past the v9.7.833 color clause. Executes populateFromData.
// Placeholder data only.
//
// Usage: node tests/same-model-834.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: same-model-834.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[09/11/2026 5:00 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const OURS = E('10/27/2026', '2:37 PM', 'AGENT', 'Outbound Text Message', 'Test, the Grand Highlander offer is 4.99% APR for 48 months for qualified buyers.');
const ASKED = E('10/09/2026', '4:09 PM', 'CUSTOMER', 'Inbound Text Message', 'Is the Grand Highlander still available?');
const U = (v, color, stock, cond) => ({ vehicle: v, color: color, stock: stock, stockNum: stock, condition: cond, certified: false, price: 40000, type: cond === 'new' ? 'New' : 'Used' });
// Stock as on the lead: no used Grand Highlander outscores the used Highlanders, so the strict score's top ties include them.
const INV_TIE = { units: [U('2024 Toyota Highlander LE', 'Midnight Black Metallic', 'TEST11', 'used'), U('2018 Toyota Highlander LE', 'Celestial Silver Metallic', 'TEST12', 'used'),
  U('2025 Toyota Grand Highlander XLE', 'Wind Chill Pearl', 'TEST13', 'used')] };
// A better-scoring Grand Highlander in the wrong color, beside one with a paint name that carries no color word.
const INV_COLOR = { units: [U('2025 Toyota Grand Highlander XLE', 'Wind Chill Pearl', 'TEST13', 'used'), U('2025 Toyota Grand Highlander Limited', 'Midnight Black Metallic', 'TEST14', 'used')] };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const stock = (inv) => { run('_lpValueFactCache')['6189'] = { inv: inv, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 }; };
  const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Toyota Grand Highlander LE AWD Sport Utility 4D',
    condition: 'New', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Toyota.Com-Kbb Trade-In', convState: 'active-follow-up', leadAgeDays: 46, hasOutbound: true,
    hasCustomerReply: true, totalNoteCount: 60, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] },
    history: OURS + ASKED + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + OURS + ASKED + MARK + '---' }, x || {});
  const alt = (d) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); return (String(run('leadContext')).split('\n').find(l => /ALTERNATE CONDITION AVAILABLE/.test(l)) || ''); }
    catch (e) { return 'THREW ' + e.message; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the same model:');
  stock(INV_TIE); const plain = alt(LEAD());
  check('a Grand Highlander lead\'s "same model" alternates are Grand Highlanders, never the used Highlanders that tie on the shared word', () =>
    [/Grand Highlander XLE/.test(plain), /\b20(?:24|18) Toyota Highlander\b/.test(plain)], [true, false]);

  console.log(' 2. the color they asked for:');
  stock(INV_COLOR); const white = alt(LEAD({ customerStatedColor: 'white', customerStatedColorPhrase: 'white' }));
  check('control: with no color asked, the better trim match (the Limited) is the one offered', () => /Grand Highlander Limited/.test(alt(LEAD())), true);
  check('lead 2082278892: they asked for white -> the Midnight Black Limited is dropped before scoring, so the Wind Chill Pearl XLE (no color word, for the model to judge) is offered', () =>
    [/Wind Chill Pearl/.test(white), /Midnight Black/.test(white), /THEY ASKED FOR WHITE/.test(white)], [true, false, true]);
  check('the paint test: black is not white, a paint with no color word cannot be judged here, white pearl is white, no ask -> anything', () => {
    const t = run('_lpPaintFitsAsked'); if (typeof t !== 'function') return 'no _lpPaintFitsAsked';
    return [t({ customerStatedColor: 'white' }, 'Midnight Black Metallic'), t({ customerStatedColor: 'white' }, 'Blueprint'), t({ customerStatedColor: 'white' }, 'Super White'), t({}, 'Midnight Black Metallic')]; },
    [false, true, true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
