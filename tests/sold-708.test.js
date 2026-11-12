#!/usr/bin/env node
'use strict';
// (v9.7.708) log242, Toyota Baytown (capture bc558f2f, dump ed87d87f). A customer who bought a RAV4 on
// 11/18/23 answered a 9/23/2026 lease-end text ("What are the options?") and the prompt said
// "SOLD/DELIVERED ... Warm congratulations only" with a "post-sale service concern" scenario.
//  1. The scraper's Sale Info path read "Deal #: 66721 | Sold: 11/18/23", declined a 1,040-day-old
//     sale, and the Lead Info "Status: Sold" fallback set isSoldDelivered anyway. A Sale Info sold date
//     older than 30 days now stands every fallback down.
//  2. hasPostSaleService scanned the first 800 chars of leadContext, which OPEN with our own sold block
//     ("...follow-up service/ownership experience"), so it was true on every sold lead. It now starts
//     at the first dated note.
// Executes the shipped sold-detection block (lifted verbatim) and buildUserPrompt (whole popup.js).
//
// Usage: node tests/sold-708.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sold-708.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const mdy = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000);
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2); };
// The page text, shaped like the dump: Lead Info first, then Sale Info.
const page = ({ status, created, saleSold, deal, delivered }) =>
  'Lead Info\nStatus:\tStatus: ' + status + '\nSales Rep:\tRep Name\nBD Agent:\tAgent Name\nCreated:\t' + created + ' 1:15p\nSource:\tShowroom (Walk-in)\n'
  + 'Engagement Strength N/A\n'
  + (saleSold || deal ? 'Sale Info\n2024 Toyota RAV4\nStatus:  ' + (delivered ? 'Delivered' : 'Sold') + '\n' + (deal ? 'Deal #:  66721\n' : '') + (saleSold ? 'Sold:  ' + saleSold + '\n' : '') + 'By:  Name\n' : '')
  + 'Trade-in Info\n(none entered)\n';

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const a = src.indexOf('    var isSoldDelivered = false;'), b = src.indexOf('    // Scrape past showroom visits', a);
  const block = src.slice(a, b);
  const sold = (text, currentStatus, leadSource) => { const logs = [];
    const r = new Function('TEXT', 'currentStatus', 'leadSource', '_lpD', block + '\nreturn isSoldDelivered;')(text, currentStatus || '', leadSource || 'Showroom (Walk-in)', (x) => logs.push(x));
    return { r, log: logs.join(' ') }; };

  console.log(' 1. who is sold/delivered:');
  const LOG242 = page({ status: 'Sold', created: '11/18/23', saleSold: '11/18/23', deal: true, delivered: true });
  check('the log242 page (Status: Sold, Sale Info Deal # and Sold: 11/18/23) is NOT sold/delivered', () => sold(LOG242).r, false);
  check('...and the diag says it is a past customer', () => / \| sale is \d+ days old: a past customer, not a delivery to congratulate/.test(sold(LOG242).log), true);
  check('an old Sale Info date with no Deal # also stands the Status: Sold label down',
    () => sold(page({ status: 'Sold', created: '11/18/23', saleSold: '11/18/23', deal: false })).r, false);
  check('an old Sale Info date stands the status DROPDOWN down too', () => sold(page({ status: 'Sold', created: '11/18/23', saleSold: '11/18/23', deal: true }), 'Sold').r, false);
  check('control: a sale 10 days ago with a Deal # is sold/delivered', () => sold(page({ status: 'Sold', created: mdy(12), saleSold: mdy(10), deal: true })).r, true);
  check('control: Status: Sold with no Sale Info date at all still is (the fallback, unchanged)',
    () => sold(page({ status: 'Sold', created: mdy(5) })).r, true);
  check('control: an active lead is not', () => sold(page({ status: 'Active', created: mdy(5), saleSold: mdy(3), deal: true })).r, false);

  console.log(' 2. what a sold lead is asked to write:');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  // The sold block exactly as populateFromData writes it, read from this build.
  const soldBlock = (src.match(/extras\.push\('🎉 SOLD\/DELIVERED[^\n]*\n[^\n]*\n[^\n]*/) || [''])[0]
    .split('\n').map(l => (l.match(/extras\.push\('(.*)'\);/) || [])[1]).filter(Boolean).join('\n');
  const task = (notes, lastInbound) => {
    const ctx = soldBlock + '\n\n' + notes;
    const d = { agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', name: 'Test Buyer', vehicle: '2026 Toyota RAV4',
      leadSource: 'Showroom', dealerId: '6189', store: 'Community Toyota Baytown', convState: 'active-follow-up', hasOutbound: true,
      hasCustomerReply: true, isSoldDelivered: true, lastInboundMsg: lastInbound, relationshipSignals: {}, context: ctx };
    vm.runInContext('leadContext = ' + JSON.stringify(ctx) + ';', sb);
    const p = sb.__lp.buildUserPrompt(d);
    return /TASK: Sold customer has a post-sale service concern/.test(p) ? 'service'
      : /TASK: This customer has PURCHASED and taken DELIVERY/.test(p) ? 'congratulations'
      : /TASK: Sold customer sent you a message/.test(p) ? 'warm-reply' : 'other';
  };
  const DELIVERY = '[09/14/2026 1:47 PM] [NOTE] Sold (Delivered)\n  By: Manager\n';
  check('control: the sold block is read from this build (the test is not vacuous)', () => /service\/ownership/.test(soldBlock), true);
  check('a sold customer with no service anywhere in the notes or their message is NOT a "service concern"',
    () => task(DELIVERY, 'Thank you so much, we love the new RAV4 already!'), 'congratulations');
  check('control: a real service note in the recent notes still is',
    () => task('[09/20/2026 10:00 AM] [CALL NOTE] Outbound phone call\n  Customer says the tire pressure light is on, booked service\n' + DELIVERY,
      'Can you check on my tire pressure light question?'), 'service');
  check('control: the customer naming a problem in their own message still is', () => task(DELIVERY, 'There is a strange noise from the rear since Friday'), 'service');
  check('control: a short "Hi" still gets the warm reply', () => task(DELIVERY, 'Hi'), 'warm-reply');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
