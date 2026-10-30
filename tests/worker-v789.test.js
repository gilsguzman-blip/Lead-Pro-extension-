#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v789.test.js');
/**
 * worker-v789.test.js — proxy v7.89: the phone-ask classifier moves to gpt-4.1-mini. The 10/24 worker log: "CLASSIFY FAILED
 * sms=HTTP 404 email=HTTP 404" on 40 of 41 drafts -- OpenAI no longer serves gpt-4.1-nano on this account, and a failure is
 * treated as no flag, so every draft shipped unchecked. Runs the SHIPPED classifyPhoneAsk with the model API stubbed the way
 * the account now answers: gpt-4.1-nano -> 404, gpt-4.1-mini -> a verdict. [new] fails on v7.88. Placeholder data only.
 *
 *   usage: worker-v789.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v789.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function load(answer) {
  const bodies = [];
  const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl, AbortController, Promise, Date, Math, JSON,
    String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout, caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } } };
  box.fetch = (url, o) => {
    const p = o && o.body ? JSON.parse(o.body) : {}; bodies.push(p);
    if (p.model === 'gpt-4.1-nano') return Promise.resolve(new Response(JSON.stringify({ error: { message: 'The model `gpt-4.1-nano` does not exist', code: 'model_not_found' } }), { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }), { status: 200 }));
  };
  box.globalThis = box; vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  return { box, bodies };
}
(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.89');
  const yes = load('YES');
  const r = await yes.box.classifyPhoneAsk('Test, what is the best number to reach you?', 'Bearer test');
  check('[new] "what is the best number to reach you?" is classified (gpt-4.1-nano now answers 404)', [r.state, yes.bodies[0] && yes.bodies[0].model], ['yes', 'gpt-4.1-mini']);
  const p = yes.bodies[0] || {};
  check('[control] the same non-reasoning call shape: temperature 0, 4 completion tokens, prompt_cache_retention, no reasoning_effort',
    [p.temperature, p.max_completion_tokens, typeof p.prompt_cache_retention, 'reasoning_effort' in p], [0, 4, 'string', false]);
  const no = load('NO');
  check('[new] a draft that does not ask is a "no", not a failure', (await no.box.classifyPhoneAsk('Test, the Civic is here. Want to see it Saturday?', 'Bearer test')).state, 'no');
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
