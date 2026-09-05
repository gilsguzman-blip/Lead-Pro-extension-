#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('feedback-export-join.test.js');

/**
 * feedback-export-join.test.js — v7.71. THE EXPORT COULD NOT NAME THE GENERATION IT DESCRIBED.
 *
 * Gil's 9/5 pairs export carries a Community Kia Baytown row (Facebook, lead 2078978836, 8:26 AM)
 * whose sms, email and voicemail are ALL EMPTY with prior:null — the v9.7.604 empty-draft
 * signature, recurring on a different agent at a different store than the one that build recorded.
 * The question that would settle it is "what did the model actually return for that generation",
 * and the id that answers it — workerRequestId — has been persisted by POST /feedback since v7.58
 * and dropped by GET /feedback/drafts, which is what every consumer of the export reads.
 *
 * THIS SUITE RUNS THE SHIPPED HANDLER. The worker is loaded as a module and GET /feedback/drafts
 * is actually called against a stubbed KV; the rows asserted are the rows the endpoint returns. A
 * regex over source text is precisely what stayed green through two live outages — see the
 * opening of worker-smoke.test.js, where an assertion matched a ReferenceError verbatim and
 * confirmed it was present.
 *
 * THE SHAPE GUARANTEE IS ASSERTED AS HARD AS THE FEATURE. The field is spread conditionally, so a
 * pre-v9.7.564 row must come back byte-identical to what it is today — not with an empty string,
 * not with a null. "workerRequestId present" is itself the marker that a row is correlatable, and
 * a row that is not correlatable must not pretend to be.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: feedback-export-join.test.js <cloudflare-worker.js>'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('feedback-export-join.test.js', m);

const src = fs.readFileSync(PROXY, 'utf8');
if (src.indexOf("url.pathname.endsWith('/feedback/drafts')") < 0) {
  bail('the /feedback/drafts handler is not in ' + PROXY + ' — THE SUITE DID NOT LOAD');
}

// ── The rows, as the extension actually writes them ───────────────────────────
// Noon Central on 9/5 is 17:00Z, comfortably inside the Central-day window the handler computes.
const RID = '9f1c0b52-7a4e-4d2b-9c31-2e6a5f0d8b74';   // opaque, proxy-minted, no lead data
const TS  = '2026-09-05T17:00:00.000Z';
const DRAFTS = { final: { sms: 'a draft', email: 'a draft', voicemail: '' }, prior: null };

const KV_ROWS = {
  // The incident row: a generation that produced NOTHING. This is the one the change exists for.
  ['feedback:' + TS + ':gen_empty']: {
    id: 'gen_empty', ts: TS, rating: 'down', signal: 'implicit_regen_no_copy', trigger: 'superseded',
    regenCount: 1, chipCount: 0, chipsUsed: [], workerRequestId: RID,
    meta: { store: 'Community Kia Baytown', autoLeadId: '2078978836', leadSource: 'Facebook' },
    drafts: { final: { sms: '', email: '', voicemail: '' }, prior: null }
  },
  // An ordinary correlatable row.
  ['feedback:' + TS + ':gen_ok']: {
    id: 'gen_ok', ts: TS, rating: 'neutral', signal: 'implicit_regen_copy', trigger: 'copy_sms',
    regenCount: 1, chipCount: 0, chipsUsed: ['add-urgency'], workerRequestId: RID,
    meta: { store: 'Community Kia Baytown', autoLeadId: '2079186130' }, drafts: DRAFTS
  },
  // A pre-v9.7.564 row: the extension never sent an id, so the key does not exist.
  ['feedback:' + TS + ':gen_legacy']: {
    id: 'gen_legacy', ts: TS, rating: 'down', signal: 'implicit_regen_no_copy', trigger: 'superseded',
    regenCount: 1, chipCount: 0, chipsUsed: [],
    meta: { store: 'Community Honda Baytown', autoLeadId: '2079214180' }, drafts: DRAFTS
  },
  // No drafts at all — must stay excluded. Pre-existing behaviour, asserted so the new spread
  // cannot quietly widen what the endpoint returns.
  ['feedback:' + TS + ':gen_nodrafts']: {
    id: 'gen_nodrafts', ts: TS, rating: 'up', signal: 'implicit_copy', trigger: 'copy_sms',
    regenCount: 0, chipCount: 0, chipsUsed: [], workerRequestId: RID, meta: {}
  }
};

// Loads the shipped worker for real. Module syntax is rewritten to an assignment; nothing else
// about the file is touched. (Same approach as worker-smoke.test.js.)
function load() {
  const box = {
    console: { log() {}, warn() {}, error() {} },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error,
    setTimeout, clearTimeout, crypto,
    fetch: () => Promise.resolve(new Response('{}', { status: 200 })),
    caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } }
  };
  box.globalThis = box; box.self = box;
  vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  if (!box.__WORKER || typeof box.__WORKER.fetch !== 'function') bail('worker exposes no fetch handler');
  return box.__WORKER;
}

// A KV stub that honours the prefix, because the handler pages by UTC-date prefix and a stub that
// ignored it would return every row once per prefix and quietly double the export.
const KV = {
  list: ({ prefix }) => Promise.resolve({
    keys: Object.keys(KV_ROWS).filter(k => k.startsWith(prefix)).map(name => ({ name })),
    list_complete: true
  }),
  get: (name) => Promise.resolve(KV_ROWS[name] ? JSON.stringify(KV_ROWS[name]) : null)
};
// A fixture director key — this export is director-gated and the suite must come through the
// same door a real caller does. Nothing here is a real key; DIRECTOR_KEYS is an env allowlist.
const DIRECTOR = 'TESTDIRECTORKEY';
const ENV = { LEADPRO_LICENSES: KV, REQUIRE_LICENSE: 'false', DIRECTOR_KEYS: DIRECTOR };
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} };

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — GET /feedback/drafts, run for real');

  // The export carries drafts and lead ids, so the gate in front of it is load-bearing. Adding a
  // field to the projection is exactly the kind of change that should not quietly open the door.
  console.log('\nthe export is still director-gated:');
  const noKey = await load().fetch(
    new Request('https://leadpro-proxy.test/feedback/drafts?date=2026-09-05'), ENV, CTX);
  check('  no key is refused', noKey.status, 403);
  const wrongKey = await load().fetch(
    new Request('https://leadpro-proxy.test/feedback/drafts?date=2026-09-05&key=NOTADIRECTOR'), ENV, CTX);
  check('  a non-director key is refused', wrongKey.status, 403);

  const res = await load().fetch(
    new Request('https://leadpro-proxy.test/feedback/drafts?date=2026-09-05&key=' + DIRECTOR), ENV, CTX);
  check('the endpoint responds 200 to a director', res.status, 200);
  const body = await res.json();
  const rows = body.rows || [];
  const by = (id) => rows.filter(r => r.id === id)[0];

  console.log('\nthe rows it returns:');
  check('  three rows — the one without drafts is still excluded', rows.length, 3);
  check('  ...and it is gen_nodrafts that is missing', !by('gen_nodrafts'), true);
  check('  each row appears exactly once (the prefix paging does not double them)',
    rows.map(r => r.id).sort(), ['gen_empty', 'gen_legacy', 'gen_ok']);

  console.log('\nthe id that makes a row correlatable:');
  check('  the EMPTY-DRAFT row carries its workerRequestId', by('gen_empty') && by('gen_empty').workerRequestId, RID);
  check('  ...and it really is the empty draft (sms, email and voicemail all blank)',
    by('gen_empty') && [by('gen_empty').drafts.final.sms, by('gen_empty').drafts.final.email,
                        by('gen_empty').drafts.final.voicemail], ['', '', '']);
  check('  an ordinary row carries it too', by('gen_ok') && by('gen_ok').workerRequestId, RID);

  console.log('\nand a row that has no id does not pretend to have one:');
  const legacy = by('gen_legacy');
  check('  the key is ABSENT, not empty and not null', legacy && ('workerRequestId' in legacy), false);
  check('  ...so a pre-v9.7.564 row keeps exactly the shape it has today',
    legacy && Object.keys(legacy).sort(),
    ['chipsUsed', 'drafts', 'id', 'meta', 'rating', 'regenCount', 'signal', 'trigger', 'ts']);

  console.log('\nthe rest of the projection is untouched:');
  check('  meta still travels', by('gen_ok') && by('gen_ok').meta.autoLeadId, '2079186130');
  check('  chipsUsed still travels', by('gen_ok') && by('gen_ok').chipsUsed, ['add-urgency']);
  check('  rating and signal still travel',
    by('gen_ok') && [by('gen_ok').rating, by('gen_ok').signal], ['neutral', 'implicit_regen_copy']);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { bail('the suite threw: ' + (e && e.message)); });
