#!/usr/bin/env node
'use strict';
// (v7.70) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('live-check.test.js');

/**
 * live-check.test.js — the "what is Lead Pro holding" reader, in BOTH places it ships.
 *
 * The page exists because nothing answered "what is Lead Pro holding right now?" The Data Tool's
 * summary table is a receipt for the file you just dropped — incResult is replaced on every
 * Normalize and nothing merges across runs — and dashboard/index.html had ZERO references to
 * incentives or valuefact. On 9/4 that turned a five-second question into a full day, and the data
 * had been correct the whole time.
 *
 * What the reader has to get right is the classification, because from outside the proxy these were
 * indistinguishable and the difference is what an operator acts on:
 *
 *   nothing published      -> re-publish, the store is missing entirely
 *   published, all lapsed  -> re-publish, expiry did its job and the sheet is stale
 *   published and live     -> nothing to do
 *   unreachable            -> a network/endpoint problem, not a data problem
 *
 * And one more, added because it caused the original confusion: on a proxy older than v7.70 the
 * stored count is UNKNOWN, which must not render as zero. "We don't know" and "there are none" are
 * the two states this whole thing exists to separate.
 *
 * TWO COPIES, ASSERTED EQUIVALENT (v1.4). readStore() now ships both in the standalone worker
 * (tools/leadpro-live-check.js) and in the dashboard (dashboard/index.html), because Gil already
 * deploys the dashboard by pasting an updated index file and a second worker is a second thing to
 * remember. Duplicated logic drifts, so this suite lifts BOTH copies, runs them over the same
 * fixtures, and asserts identical results — and compares them again with comments stripped, so a
 * logic edit to one and not the other fails here rather than in a rooftop's incentives.
 *
 * Runs the SHIPPED functions with a stubbed fetch. No DOM and no jsdom dependency — a suite that
 * can only skip is a suite that catches nothing. The rendered page itself was separately driven
 * under jsdom against these same fixtures while building it.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOOL_PATH = path.join(ROOT, 'tools', 'leadpro-live-check.js');
const DASH_PATH = process.argv.slice(2).find(a => /\.html$/.test(a)) ||
                  path.join(ROOT, 'dashboard', 'index.html');

const toolSrc = fs.readFileSync(TOOL_PATH, 'utf8');
const dashSrc = fs.readFileSync(DASH_PATH, 'utf8');

// THE TOOL'S PAGE LIVES INSIDE A TEMPLATE LITERAL, so its raw source is NOT what a browser runs:
// `\d` in the file is `\\d` on disk. Lifting the raw text meant testing a regex that can never
// match — the suite would have passed a page whose expiry check was dead. Evaluate the literal so
// every assertion below reads the page EXACTLY as it is served.
const PAGE_SRC = (() => {
  const i = toolSrc.indexOf('const PAGE = `');
  const j = toolSrc.indexOf('`;\n\nfunction html()');
  if (i < 0 || j < 0) require('./lib/fatal-guard.js').bail('live-check.test.js', 'PAGE template not found');
  const sb = {}; vm.createContext(sb);
  vm.runInContext(toolSrc.slice(i, j + 1) + ';', sb);
  return vm.runInContext('PAGE', sb);
})();

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// ── Lift the SHIPPED classifier out of each surface ──────────────────────────
function liftReadStore(src, whence) {
  const a = src.indexOf('async function readStore(base, did, name, today){');
  const b = src.indexOf('\n}', src.indexOf("  }catch(e){ return { did, name, state:'error'", a));
  if (a < 0 || b < 0) {
    require('./lib/fatal-guard.js').bail('live-check.test.js', 'readStore not found in ' + whence);
  }
  return src.slice(a, b + 2);
}
const READ = {
  tool: liftReadStore(PAGE_SRC, TOOL_PATH + ' (rendered)'),
  dash: liftReadStore(dashSrc, DASH_PATH),
};

const TODAY = '2026-09-04';
function runStore(which, response) {
  const sb = {
    JSON, Array, Object, String, RegExp, encodeURIComponent,
    fetch: async () => {
      if (response.throws) throw new Error(response.throws);
      if (!response.ok) return { ok: false, status: response.status };
      return { ok: true, json: async () => response.body };
    }
  };
  vm.createContext(sb);
  vm.runInContext(READ[which], sb);
  return vm.runInContext("readStore('https://p.example', '6190', 'Kia Baytown', '" + TODAY + "')", sb);
}

// The real response shapes, v7.70 and older.
const LIVE   = { ok: true, body: { ok: true, valuefact: { store: 'Kia Baytown', count: 2, storedCount: 110,
                   generated: '2026-09-04', incentives: [{ model: 'Sportage', expires: '2026-09-30' },
                                                         { model: 'Sportage', expires: '2026-09-30' }] } } };
// THE HONDA SHAPE, 9/4. The proxy serves these — it only drops a line whose `expires` is present
// AND past — while _lpExpiryFilterIncentives discards every one of them. "39 live, 0 quotable."
const UNDATED = { ok: true, body: { ok: true, valuefact: { store: 'Honda Baytown', count: 2, storedCount: 39,
                   generated: '2026-08-05', incentives: [{ model: 'Accord' }, { model: 'CR-V', expires: '' }] } } };
// Half the sheet dated, half not — the store still quotes, but not what it appears to hold.
const PARTIAL = { ok: true, body: { ok: true, valuefact: { store: 'Honda Baytown', count: 2, storedCount: 39,
                   generated: '2026-08-05', incentives: [{ model: 'Accord', expires: '2026-09-30' },
                                                         { model: 'CR-V', expires: 'soon' }] } } };
const LAPSED = { ok: true, body: { ok: true, valuefact: { store: 'Kia Baytown', count: 0, storedCount: 110,
                   generated: '2026-08-01', incentives: [] } } };
const EMPTY  = { ok: true, body: { ok: true, valuefact: null } };
// pre-v7.70: no generated/storedCount. Dated, so this fixture isolates the PROXY VERSION and does
// not also trip the undated rule — one fixture, one concern.
const OLD    = { ok: true, body: { ok: true, valuefact: { store: 'Kia Baytown', count: 1,
                   incentives: [{ model: 'Sportage', expires: '2026-09-30' }] } } };
const DOWN   = { ok: false, status: 503 };
const THREW  = { throws: 'Failed to fetch' };
const FIXTURES = { LIVE, LAPSED, EMPTY, OLD, DOWN, THREW, UNDATED, PARTIAL };

(async () => {
console.log('\nleadpro live check — the states an operator acts on');
console.log('dashboard under test: ' + path.relative(ROOT, DASH_PATH));
console.log('');

console.log('a published, live store:');
const live = await runStore('tool', LIVE);
check('classified live', live.state, 'live');
check('live line count', live.live, 2);
check('stored count from v7.70', live.stored, 110);
check('publish date', live.generated, '2026-09-04');
check('model breakdown', live.models, { Sportage: 2 });

console.log('\na store whose lines have all lapsed — NOT the same as an empty one:');
const lapsed = await runStore('tool', LAPSED);
check('classified lapsed, not empty', lapsed.state, 'lapsed');
check('...zero live', lapsed.live, 0);
check('...but it still reports what it holds, so the fix is obvious', lapsed.stored, 110);
check('...and when it was published', lapsed.generated, '2026-08-01');

console.log('\na store with nothing published:');
const empty = await runStore('tool', EMPTY);
check('classified empty', empty.state, 'empty');
check('...distinct from lapsed, which is the whole point', empty.state === lapsed.state, false);

console.log('\nan older proxy — unknown is not zero:');
const old = await runStore('tool', OLD);
check('the store still classifies as live', old.state, 'live');
check('stored count is UNKNOWN, not 0', old.stored, null);
check('...and the publish date is absent rather than invented', old.generated, null);

console.log('\nunreachable is a network problem, not a data problem:');
const down = await runStore('tool', DOWN);
check('an HTTP error classifies as error', down.state, 'error');
check('...and carries the status so it is actionable', down.detail, 'HTTP 503');
const threw = await runStore('tool', THREW);
check('a thrown fetch classifies as error too', threw.state, 'error');
check('...and never reports lines it did not read', threw.live, undefined);

// ── THE PROXY AND THE EXTENSION DISAGREE ABOUT "LIVE" ────────────────────────
// GET /valuefact drops a line only when `expires` is present AND past, so an UNDATED line passes.
// _lpExpiryFilterIncentives drops it, matching the Data Tool's publish rule. A panel reporting only
// the proxy's count would show a healthy store that quotes nothing — which is what both Honda
// rooftops looked like on 9/4, at 39 live with a month-old publish date.
console.log('\nundated lines: the proxy serves them, the extension discards them:');
const und = await runStore('tool', UNDATED);
check('a store of undated lines is NOT called live', und.state, 'undated');
check('...the proxy still reports them as live lines', und.live, 2);
check('...but nothing is quotable', und.quotable, 0);
check('...and that is a different state from lapsed', und.state === lapsed.state, false);
check('...and from empty', und.state === empty.state, false);

console.log('\na half-dated sheet quotes only the dated half:');
const part = await runStore('tool', PARTIAL);
check('the store still counts as live', part.state, 'live');
check('...the proxy reports both lines', part.live, 2);
check('...only the validly dated one is quotable', part.quotable, 1);
check('a malformed date is not quotable ("soon" sorts above a real date)',
  part.quotable < part.live, true);

console.log('\nan expires ON today still counts — the boundary, both ways:');
const onToday = await runStore('tool', { ok: true, body: { ok: true, valuefact: { store:'X', count:1,
  storedCount:1, generated:'2026-09-04', incentives:[{ model:'A', expires:'2026-09-04' }] } } });
check('expiring today is quotable', onToday.quotable, 1);
const yest = await runStore('tool', { ok: true, body: { ok: true, valuefact: { store:'X', count:1,
  storedCount:1, generated:'2026-09-04', incentives:[{ model:'A', expires:'2026-09-03' }] } } });
check('expired yesterday is not', yest.quotable, 0);
check('...and the store reads undated/none-quotable rather than healthy', yest.state, 'undated');

// ── THE TWO COPIES MAY NOT DRIFT ─────────────────────────────────────────────
// The dashboard carries its own readStore so it can be deployed as one index file. That is a
// duplicate, and duplicates drift. Every fixture above, through both copies, compared whole.
console.log('\nthe dashboard copy and the standalone copy agree on every fixture:');
for (const name of Object.keys(FIXTURES)) {
  const t = await runStore('tool', FIXTURES[name]);
  const d = await runStore('dash', FIXTURES[name]);
  check('identical verdict on ' + name, d, t);
}
// Compared again with comments stripped: the prose differs (one says "page", the other "panel"),
// the logic may not.
const bare = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace(/\s+/g, ' ').trim();
check('the two implementations are the same code', bare(READ.dash) === bare(READ.tool), true);

// ── NEITHER SURFACE MAY CARRY A CREDENTIAL ───────────────────────────────────
// The dashboard DOES hold a director key for /feedback/*. /valuefact is unauthenticated and
// returns incentive lines only, never contact data — so the key must not travel on this request.
// This is the assertion that stops someone "fixing" a 4xx by pasting `&key=` onto the URL.
console.log('\nno credential travels on the valuefact read:');
check('no license key is read anywhere in the standalone page',
  /licenseKey|X-LP-Key|\.lk\b/.test(toolSrc), false);
// Asserted over the LIFTED function bodies, not the whole file: the dashboard legitimately holds
// DIRECTOR_KEY for /feedback/*, so a file-wide search proves nothing, and an earlier version of
// this check scanned the raw text and was defeated by the quote that ends the URL literal.
for (const which of ['tool', 'dash']) {
  check(which + ' readStore reaches for no credential',
    /DIRECTOR_KEY|licenseKey|X-LP-Key|key=|Authorization/.test(READ[which]), false);
}
check('...and readStore takes no key parameter', /readStore\(base, did, name, today\)/.test(dashSrc), true);

// Scoped to the PAGE template, not the whole file — the worker's own `export default { fetch }`
// handler is a second match and counting it made this assertion wrong rather than the code.
check('the page issues exactly one network call',
  (PAGE_SRC.match(/fetch\(/g) || []).length, 1);
check('...and it is the valuefact GET',
  /fetch\(base \+ '\/valuefact\?dealer=' \+ encodeURIComponent\(did\)\)/.test(PAGE_SRC), true);
check('nothing in it can POST', /method:\s*'POST'/.test(toolSrc), false);
// Guards the harness, not the page: if the template literal stops being evaluated, the lifted
// regexes silently go dead and every expiry assertion above passes vacuously.
check('the harness reads the RENDERED page, not the escaped source',
  PAGE_SRC.indexOf('\\\\d{4}') === -1 && PAGE_SRC.indexOf('\\d{4}') > -1, true);
check('the dashboard panel cannot POST to the proxy either',
  /valuefact[\s\S]{0,200}method:\s*'POST'/.test(dashSrc), false);

// ── STALENESS IS A CENTRAL-TIME QUESTION ─────────────────────────────────────
// .toISOString() converts to UTC first. This page already shipped that bug once — Gil caught the
// dashboard rolling over to "tomorrow" at 7:55 PM Central — and here it would paint the
// afternoon's own upload amber for the last five hours of every day.
console.log('\n"today" is Central, not UTC:');
check('the standalone page formats today in America/Chicago',
  /America\/Chicago/.test(toolSrc), true);
check('...and never derives a local date from toISOString',
  /toISOString\(\)\.slice\(0,\s*10\)/.test(toolSrc), false);
check('the dashboard panel reuses the page-wide centralToday helper',
  /const today = centralToday\(0\);/.test(dashSrc), true);

// ── THE PANEL MUST SURVIVE A BROKEN FEEDBACK FETCH ───────────────────────────
// It answers a different question from a different endpoint. Rendering it inside `data && !loading`
// would hide it exactly when /feedback/* is erroring or the director key has rotated — the moment
// someone most needs to ask what is published.
console.log('\nthe dashboard panel renders independently of the feedback load:');
const appBody = dashSrc.slice(dashSrc.indexOf('function App()'));
const panelAt = appBody.indexOf('h(LiveIncentives)');
const gateAt  = appBody.indexOf("data && !loading && h(Fragment");
check('the panel is mounted in App', panelAt > -1, true);
check('...before the data gate, not inside it', panelAt > -1 && gateAt > -1 && panelAt < gateAt, true);
check('...and it fetches on mount rather than waiting to be asked',
  /useEffect\(\(\) => \{ load\(\); \}, \[\]\);/.test(dashSrc), true);
check('all five rooftops are listed', (dashSrc.match(/\n  \['\d+',\s+'[^']+'\],/g) || []).length, 5);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
