#!/usr/bin/env node
'use strict';
// (v9.7.719) Gil, 9/24: "The toyotas are 2026 and up for the Camry and Rav4 and Sienna as Hybrid only
// vehicles. I just want the model to know when it comes up and to be able to distinguish in a convo" --
// and then: "I don't need it to throw out a random fact 'this vehicle is a hybrid' I just want it to know
// for when and if it comes up."
//  1. Camry and Sienna now start at 2026 like the RAV4 (v9.7.717 had 2025 / 2021).
//  2. v9.7.717's "THIS VEHICLE IS A HYBRID" directive is gone.
//  3. A BACKGROUND powertrain reference -- "do NOT bring this up on your own" -- is carried only when one of
//     these models is named on the lead (its vehicle, the customer's words or ours), never otherwise.
// Executes the shipped _lpPowertrainOf and populateFromData.
//
// Usage: node tests/model-facts-719.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: model-facts-719.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const ent = (tag, body) => '[09/24/2026 10:11 AM] [' + tag + '] Inbound Text Message\n  ' + body + '\n';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const pt = (s) => vm.runInContext('_lpPowertrainOf', sb)(s);
  const ctx = (vehicle, brief, store) => {
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
    sb.populateFromData({ name: 'Test Buyer', agent: 'Agent Name', vehicle, dealerId: store === 'honda' ? '6191' : '6190',
      store: store === 'honda' ? 'Community Honda Baytown' : 'Community Toyota Baytown', leadSource: 'Website', convState: 'active-follow-up',
      leadAgeDays: 1, totalNoteCount: 4, hasOutbound: true, hasCustomerReply: true, relationshipSignals: {}, history: '', context: '',
      conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + brief + '---\n' });
    return vm.runInContext('leadContext', sb);
  };
  const bg = (c) => { const m = c.match(/BACKGROUND — powertrain reference[^\n]*/); return m ? m[0] : ''; };

  console.log(' 1. the Toyota start year is 2026 for all three:');
  check('2025 Camry LE and 2025 Sienna XLE read by their marker (Gas); 2026 reads Hybrid',
    () => [pt('2025 Toyota Camry LE'), pt('2025 Toyota Sienna XLE'), pt('2026 Toyota Sienna XLE'), pt('2026 Toyota Camry LE')], ['Gas', 'Gas', 'Hybrid', 'Hybrid']);

  console.log(' 2. background only, never a talking point:');
  check('the lead\'s own 2026 Camry SE gets no "THIS VEHICLE IS A HYBRID" line', () => /THIS VEHICLE IS A HYBRID/.test(ctx('2026 Toyota Camry SE', ent('CUSTOMER', 'is it still there'))), false);
  check('...it gets the background reference, framed as not to be volunteered',
    () => /^BACKGROUND — powertrain reference \(new vehicles\)\. Do NOT bring this up on your own; use it only if gas vs hybrid or trims come up/.test(bg(ctx('2026 Toyota Camry SE', ent('CUSTOMER', 'is it still there')))), true);

  console.log(' 3. carried wherever the model comes up, and nowhere else:');
  check('the customer asks about a Camry on a Corolla lead',
    () => /Toyota Camry 2026 and newer are hybrid-only in every trim/.test(bg(ctx('2026 Toyota Corolla LE', ent('CUSTOMER', 'is the new camry a hybrid?')))), true);
  check('RAV4 and Sienna named in the conversation are listed together',
    () => /Toyota RAV4, Sienna 2026 and newer are hybrid-only/.test(bg(ctx('2026 Toyota Corolla LE', ent('CUSTOMER', 'deciding between a rav4 and a sienna')))), true);
  check('an Accord comes up -> the Accord trim split',
    () => /New Honda Accord: LX and SE are gas; Sport, EX-L, Sport-L and Touring are hybrid/.test(bg(ctx('2026 Honda CR-V EX', ent('CUSTOMER', 'what about an accord sport'), 'honda'))), true);
  check('a Civic comes up -> the Civic split',
    () => /New Honda Civic Sedan: LX and Sport are gas; Sport Hybrid and Sport Touring Hybrid are hybrid/.test(bg(ctx('2026 Honda Civic Sport', ent('CUSTOMER', 'is this one a hybrid'), 'honda'))), true);
  check('control: a lead that names none of these models carries nothing',
    () => bg(ctx('2026 Honda Pilot Touring', ent('CUSTOMER', 'is the pilot still available'), 'honda')), '');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
