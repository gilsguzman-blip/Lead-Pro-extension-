#!/usr/bin/env node
'use strict';
// (v9.7.720) Lead 2089026834, Community Honda Lafayette, 9/24 -- regenerated 14 times in 3 minutes.
//  1. The IdentityMax lead-received note carries the offer the customer claimed on the lines AFTER
//     "Customer claimed IdentityMax offer:". The generic "Customer ...: <text>" match kept only the label,
//     so the inquiry read "claimed IdentityMax offer:" -- the vendor's name and no offer.
//  2. "No appointment" was one-shot: the next chip rebuilt without it and the times came back. It now
//     holds for the lead it was pressed on until a different lead is grabbed.
// (v9.7.721) Gil: "this is the other IdentityMax offer for new cars vs the pre-owned offer. Does the model know
//     to tell the difference." The new-car offer is a discount on new vehicles only (never attached to a
//     pre-owned car on the lead); the pre-owned one is a PRICE RANGE, and the customer "more than likely
//     picked one out of that range", so we offer to find the vehicles that fit it.
// Executes the shipped extraction slice, _lpImxOfferGuidance, buildUserPrompt, and the shipped chip-handler line.
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

  // (v9.7.721) The new-car offer's note repeats a line with and without "!" -- one copy only.
  const NEW_NOTE = 'By: System\nClick for full IdentityMax customer Profile:\ne.atrc.link%2fu%2fYYYY...\nCustomer claimed IdentityMax offer:\n'
    + '$1,000 OFF MSRP on All New Hondas!\nLimited Time Savings on All New Inventory\nLimited Time Savings on All New Inventory!\nCustomer ID: 1000000002';
  check('v9.7.721: a repeated line differing only in punctuation is kept once', () => imx(NEW_NOTE).q,
    'claimed the website offer "$1,000 OFF MSRP on All New Hondas! Limited Time Savings on All New Inventory"');

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

  console.log(' 2b. v9.7.721 -- the two offers are different things:');
  const g = (offer, cond, veh) => vm.runInContext('_lpImxOfferGuidance', sb)('claimed the website offer "' + offer + '"', cond, veh);
  const PRE = 'Pre-owned and Certified Vehicles under $25,000! An exclusive offer for you!', NEW = '$1,000 OFF MSRP on All New Hondas! Limited Time Savings on All New Inventory';
  check('pre-owned: a price range, not a discount, and "work on finding vehicles that fit", starting with the lead\'s car', () => {
    const t = g(PRE, 'Pre-Owned', '2025 Honda Accord Sedan SE');
    return [/PRICE RANGE for pre-owned and certified vehicles, not a discount on one car/.test(t), /under \$25,000/.test(t),
      /you can work on finding the ones that fit what they want, starting with the 2025 Honda Accord Sedan SE/.test(t), /Do NOT invent a discount/.test(t)]; }, [true, true, true, true]);
  check('new-car offer on a NEW lead vehicle: applies to it, eligibility in person, no invented end date', () => {
    const t = g(NEW, 'New', '2026 Honda Civic Sport');
    return [/discount on NEW vehicles only/.test(t), /applies to new models like the 2026 Honda Civic Sport/.test(t), /do NOT invent an end date/.test(t)]; }, [true, true, true]);
  check('new-car offer on a PRE-OWNED lead vehicle: does NOT apply to it, ask which new model', () => {
    const t = g(NEW, 'Pre-Owned', '2025 Honda Accord Sedan SE');
    return [/is PRE-OWNED, so the offer does NOT apply to it/.test(t), /ask which new one they have in mind/.test(t)]; }, [true, true]);
  check('control: no claimed offer on the lead -> no offer guidance', () => vm.runInContext('_lpImxOfferGuidance', sb)('no inquiry here', 'New', '2026 Honda Civic'), '');
  const imxPrompt = (hasOutbound, offer, src) => {
    vm.runInContext('leadContext = ""; window._lpNoApptLeadId = "";', sb);
    const d = Object.assign(lead('2000000003'), { hasOutbound, convState: hasOutbound ? 'active-follow-up' : 'first-touch', leadSource: src || 'Identitymax',
      context: '[09/24/2026 12:36 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n[CUSTOMER REQUEST FROM INQUIRY] claimed the website offer "' + offer + '"\n',
      condition: 'Pre-Owned' });
    return sb.__lp.buildUserPrompt(d);
  };
  check('the offer guidance reaches the prompt on a first touch', () => /THE OFFER THEY CLAIMED: "Pre-owned and Certified Vehicles under \$25,000/.test(imxPrompt(false, PRE)), true);
  check('...and on a follow-up, framed as how the lead began', () => /HOW THIS LEAD BEGAN \(background for a follow-up[^\n]*\n- THE OFFER THEY CLAIMED/.test(imxPrompt(true, PRE)), true);
  check('control: a non-IdentityMax lead gets no IdentityMax offer guidance', () => /THE OFFER THEY CLAIMED|HOW THIS LEAD BEGAN/.test(imxPrompt(false, PRE, 'Cars.com')), false);

  console.log(' 3. the IdentityMax first-touch rules point at the claimed offer:');
  check('"Lead with THAT offer in its own words, and add no amount, term, model or eligibility it does not state"', () =>
    /THE OFFER THEY CLAIMED is quoted in the inquiry line[^']*Lead with THAT offer in its own words, and add no amount, term, model or eligibility it does not state/.test(src), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
