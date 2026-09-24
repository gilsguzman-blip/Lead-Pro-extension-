#!/usr/bin/env node
'use strict';
// (v9.7.720) Lead 2089026834, Community Honda Lafayette, 9/24 -- regenerated 14 times in 3 minutes.
//  1. The IdentityMax lead-received note carries the offer the customer claimed on the lines AFTER
//     "Customer claimed IdentityMax offer:". The generic "Customer ...: <text>" match kept only the label,
//     so the inquiry read "claimed IdentityMax offer:" -- the vendor's name and no offer.
//  2. "No appointment" was one-shot: the next chip rebuilt without it and the times came back. It now
//     holds for the lead it was pressed on until a different lead is grabbed.
// Executes the shipped extraction slice, buildUserPrompt, and the shipped chip-handler line.
//
// Usage: node tests/imx-noappt-720.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: imx-noappt-720.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const NOTE = 'By: System\nClick for full IdentityMax customer Profile:\ne.atrc.link%2fu%2fXXXX...\nCustomer claimed IdentityMax offer:\n'
  + 'Pre-owned and Certified Vehicles under $25,000!\nPre-owned and Certified Vehicles under $25,000!\nAn exclusive offer for you!\n'
  + 'Customer ID: 1000000001\nLeadID: 2000000001\nDealerID: 24399';
for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));

  console.log(' 1. the IdentityMax offer reaches the prompt, without the vendor name:');
  const imx = (content, prior) => {
    const a = src.indexOf('        // ── (v9.7.720) IDENTITYMAX'), b = src.indexOf('        } catch (eImx) {}', a);
    if (a < 0 || b < 0) throw new Error('extraction slice not found');
    const logs = [];
    const sb = { String, RegExp, content, extractedCustQ: prior || '', _lpD: (...x) => logs.push(x.join(' ')) };
    vm.createContext(sb);
    vm.runInContext(src.slice(a, b) + '        } catch (eImx) {}', sb);
    return { q: sb.extractedCustQ, logs };
  };
  check('line-structured note: the offer, deduped, as the inquiry', () => imx(NOTE, 'claimed IdentityMax offer:').q,
    'claimed the website offer "Pre-owned and Certified Vehicles under $25,000! An exclusive offer for you!"');
  check('flattened note (no line breaks) gives the same offer', () => imx(NOTE.replace(/\n/g, ' '), 'claimed IdentityMax offer:').q,
    'claimed the website offer "Pre-owned and Certified Vehicles under $25,000! An exclusive offer for you!"');
  check('the vendor name and the profile link never reach the inquiry', () => /identitymax|atrc\.link/i.test(imx(NOTE).q), false);
  check('...and the diag names the offer', () => imx(NOTE).logs.some(l => /^\[LP IDENTITYMAX DIAG\] offer claimed: "Pre-owned and Certified/.test(l)), true);
  check('a label with nothing after it gives no inquiry rather than the label', () => imx('Customer claimed IdentityMax offer:\nCustomer ID: 1000000001', 'claimed IdentityMax offer:').q, '');
  check('control: a non-IdentityMax note is left to the existing parser', () => imx('Customer Comment: Is the Accord still available?', 'Is the Accord still available?').q, 'Is the Accord still available?');

  console.log(' 2. "no appointment" holds for the lead:');
  const sb = loadPopup(f, { withAuth: true });
  const lead = (id) => ({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', vehicle: '2025 Honda Accord Sedan SE',
    stockNum: 'P0000001', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Identitymax', convState: 'first-touch', leadAgeDays: 0,
    hasOutbound: true, hasCustomerReply: false, totalNoteCount: 3, relationshipSignals: {}, autoLeadId: id, context: '', lastInboundMsg: '' });
  const prompt = (id, sticky) => {
    vm.runInContext('leadContext = ""; window._lpSuppressApptChip = false; window._lpNoApptLeadId = ' + JSON.stringify(sticky || '') + ';', sb);
    const p = sb.__lp.buildUserPrompt(lead(id));
    return [/AGENT OVERRIDE — NO APPOINTMENT ASK/.test(p), /SUGGESTED APPOINTMENT TIMES/.test(p)];
  };
  check('after "no appointment" on this lead, a later regen (any chip) still carries the override and no times', () => prompt('2000000001', '2000000001'), [true, false]);
  check('control: a different lead is unaffected', () => prompt('2000000002', '2000000001'), [false, true]);
  check('control: without the chip, times are offered as before', () => prompt('2000000001', ''), [false, true]);
  check('the chip handler records the lead it was pressed on', () =>
    /if \(key === 'no-appt'\) \{\s*try \{ window\._lpNoApptLeadId = String\(\(lastScrapedData && lastScrapedData\.autoLeadId\) \|\| window\._activeLeadId \|\| ''\); \}/.test(src), true);

  console.log(' 3. the IdentityMax first-touch rules point at the claimed offer:');
  check('"Lead with THAT offer in its own words, and add no amount, term, model or eligibility it does not state"', () =>
    /THE OFFER THEY CLAIMED is quoted in the inquiry line[^']*Lead with THAT offer in its own words, and add no amount, term, model or eligibility it does not state/.test(src), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
