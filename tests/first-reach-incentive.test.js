#!/usr/bin/env node
'use strict';
// (v9.7.696) THE FIRST-REACH INCENTIVE RAIL IS CLOSED.
//
// Gil, 9/23: "an incentive offer was sent on first reach. We had put a rail against that on first
// reach. Check if that broke." It had not broken — it was never total. v9.7.415/425's 'generic'
// override (fresh, model-level lead: no VIN, no stock, not an aggregator source) and its
// 'in_transit' sibling both released the incentive on first reach by design. Live on 9/23 that put
// a $209/36-month Accord lease on Marlene Cadena's first message (Honda Baytown) and $750 Conquest /
// Owner Loyalty cash on Bryston Taylor's (Kia Baytown). Both overrides are removed.
//
// Drives the SHIPPED override chain — from `var _incGenericSourceExcluded =` up to the AI-only
// suppression — with the first-touch flag already set, and reads what it leaves.
const fs = require('fs');
const path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: first-reach-incentive.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

function chain(src) {
  const a = src.indexOf('    var _incGenericSourceExcluded = ');
  const b = src.indexOf('    var _incAiOnly = _lpFirstHumanTouch(d);', a);
  if (a < 0 || b < 0) throw new Error('incentive first-touch chain NOT FOUND — extraction failed');
  const body = src.slice(a, b);
  return (d, outreachN) => new Function('d', '_lpOutreachOnThisLead',
    'var _incFirstTouch = true, _incFirstTouchReason = "";\n' + body + '\nreturn { firstTouch: _incFirstTouch, reason: _incFirstTouchReason };')(
    d, () => ({ src: 'lead-bounded-outbound', n: outreachN }));
}

const FRESH_GENERIC = { leadAgeDays: 0, leadSource: 'Thirdparty Honda - ', vin: '', stockNum: '' };   // Marlene's shape
const FRESH_KIA     = { leadAgeDays: 0, leadSource: 'Kia Digital - 3rd Party Lead', vin: '', stockNum: '' };   // Bryston's shape
const IN_TRANSIT    = { leadAgeDays: 0, leadSource: 'Toyota.com', vin: '5TDXXXXXXXXXXXXXX', stockNum: '', isInTransit: true };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let run; try { run = chain(src); } catch (e) { ok(false, e.message); continue; }
  ok(run(FRESH_GENERIC, 0).firstTouch === true, "a fresh model-level lead with no outreach stays first-touch → no incentive (Marlene's shape)");
  ok(run(FRESH_KIA, 0).firstTouch === true, "…the same on a Kia 3rd-party lead (Bryston's shape)");
  ok(run(IN_TRANSIT, 0).firstTouch === true, 'an in-transit unit on first reach stays first-touch → no incentive');
  ok(run(FRESH_GENERIC, 2).firstTouch === true, 'two outreaches on the lead is still first exposure');
  const r3 = run(FRESH_GENERIC, 3);
  ok(r3.firstTouch === false && r3.reason === 'prior_outreach', 'control: 3+ outreaches on the lead still releases it (v9.7.616, unchanged)');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(!/_incFirstTouchReason = 'generic'/.test(code) && !/_incFirstTouchReason = 'in_transit'/.test(code),
     "no code path sets the 'generic' or 'in_transit' first-touch reason any more");
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
