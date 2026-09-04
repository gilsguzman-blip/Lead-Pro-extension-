#!/usr/bin/env node
'use strict';
// (v7.70) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('live-check.test.js');

/**
 * live-check.test.js — tools/leadpro-live-check.js. THREE STATES THAT USED TO LOOK IDENTICAL.
 *
 * The page exists because nothing answered "what is Lead Pro holding right now?" The Data Tool's
 * summary table is a receipt for the file you just dropped — incResult is replaced on every
 * Normalize and nothing merges across runs — and dashboard/index.html has ZERO references to
 * incentives or valuefact. On 9/4 that turned a five-second question into a full day, and the data
 * had been correct the whole time.
 *
 * What the page has to get right is the classification, because from outside the proxy these were
 * indistinguishable and the difference is what an operator acts on:
 *
 *   nothing published      -> re-publish, the store is missing entirely
 *   published, all lapsed  -> re-publish, expiry did its job and the sheet is stale
 *   published and live     -> nothing to do
 *   unreachable            -> a network/endpoint problem, not a data problem
 *
 * And one more, added because it caused the original confusion: on a proxy older than v7.70 the
 * stored count is UNKNOWN, which must not render as zero. "We don't know" and "there are none" are
 * the two states this whole page exists to separate.
 *
 * Runs the SHIPPED readStore() out of the worker's page script with a stubbed fetch. No DOM and no
 * jsdom dependency — a suite that can only skip is a suite that catches nothing. The rendered page
 * itself was separately driven under jsdom against these same fixtures while building it.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'tools', 'leadpro-live-check.js');
const src = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// Lift the SHIPPED classifier out of the page script.
const a = src.indexOf('async function readStore(base, did, name){');
const b = src.indexOf('\n}', src.indexOf('  }catch(e){ return { did, name, state:\'error\'', a));
if (a < 0 || b < 0) { console.error('readStore not found in ' + SRC); process.exit(1); }
const readStoreSrc = src.slice(a, b + 2);

function runStore(response) {
  const sb = {
    JSON, Array, Object, String, encodeURIComponent,
    fetch: async () => {
      if (response.throws) throw new Error(response.throws);
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, json: async () => response.body };
    }
  };
  vm.createContext(sb);
  vm.runInContext(readStoreSrc, sb);
  return vm.runInContext("readStore('https://p.example', '6190', 'Kia Baytown')", sb);
}

// The real response shapes, v7.70 and older.
const LIVE   = { ok: true, body: { ok: true, valuefact: { store: 'Kia Baytown', count: 2, storedCount: 110,
                   generated: '2026-09-04', incentives: [{ model: 'Sportage' }, { model: 'Sportage' }] } } };
const LAPSED = { ok: true, body: { ok: true, valuefact: { store: 'Kia Baytown', count: 0, storedCount: 110,
                   generated: '2026-08-01', incentives: [] } } };
const EMPTY  = { ok: true, body: { ok: true, valuefact: null } };
const OLD    = { ok: true, body: { ok: true, valuefact: { store: 'Kia Baytown', count: 1,
                   incentives: [{ model: 'Sportage' }] } } };          // pre-v7.70: no generated/storedCount
const DOWN   = { ok: false, status: 503 };
const THREW  = { throws: 'Failed to fetch' };

(async () => {
console.log('\ntools/leadpro-live-check — the states an operator acts on');
console.log('');

console.log('a published, live store:');
const live = await runStore(LIVE);
check('classified live', live.state, 'live');
check('live line count', live.live, 2);
check('stored count from v7.70', live.stored, 110);
check('publish date', live.generated, '2026-09-04');
check('model breakdown', live.models, { Sportage: 2 });

console.log('\na store whose lines have all lapsed — NOT the same as an empty one:');
const lapsed = await runStore(LAPSED);
check('classified lapsed, not empty', lapsed.state, 'lapsed');
check('...zero live', lapsed.live, 0);
check('...but it still reports what it holds, so the fix is obvious', lapsed.stored, 110);
check('...and when it was published', lapsed.generated, '2026-08-01');

console.log('\na store with nothing published:');
const empty = await runStore(EMPTY);
check('classified empty', empty.state, 'empty');
check('...distinct from lapsed, which is the whole point', empty.state === lapsed.state, false);

console.log('\nan older proxy — unknown is not zero:');
const old = await runStore(OLD);
check('the store still classifies as live', old.state, 'live');
check('stored count is UNKNOWN, not 0', old.stored, null);
check('...and the publish date is absent rather than invented', old.generated, null);

console.log('\nunreachable is a network problem, not a data problem:');
const down = await runStore(DOWN);
check('an HTTP error classifies as error', down.state, 'error');
check('...and carries the status so it is actionable', down.detail, 'HTTP 503');
const threw = await runStore(THREW);
check('a thrown fetch classifies as error too', threw.state, 'error');
check('...and never reports lines it did not read', threw.live, undefined);

console.log('\nthe page holds no credential:');
check('no license key is read anywhere in the page script',
  /licenseKey|X-LP-Key|\.lk\b/.test(src), false);
// Scoped to the PAGE template, not the whole file — the worker's own `export default { fetch }`
// handler is a second match and counting it made this assertion wrong rather than the code.
const PAGE_SRC = src.slice(src.indexOf('const PAGE = `'), src.indexOf('`;\n\nfunction html()'));
check('the page issues exactly one network call',
  (PAGE_SRC.match(/fetch\(/g) || []).length, 1);
check('...and it is the valuefact GET',
  /fetch\(base \+ '\/valuefact\?dealer=' \+ encodeURIComponent\(did\)\)/.test(PAGE_SRC), true);
check('nothing in it can POST', /method:\s*'POST'/.test(src), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
