#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('concierge-refine-738.test.js');
// (v9.7.738) Audi Lafayette lead 2049511947, 9/29 (log261). The first-pass text said "As your Audi Concierge, I can
// check on the...", the SMS rewrite dropped the title, and the rewrite shipped -- while the Audi persona block says
// "Concierge" must appear in every format. Gil: "let's add Concierge protection." The rewrite prompt now says the
// title is required, and if the rewrite drops it anyway the first pass ships (the source-name guard's shape).
// Executes the shipped _lpBuildSmsRefinePrompt and _lpRefineSms with the worker call stubbed. Placeholders only.
//
// Usage: node tests/concierge-refine-738.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: concierge-refine-738.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const P1 = 'Test, if you are still looking at Corollas, we also have a 2025 Toyota Corolla SE in Blueprint in stock. As your Audi Concierge, I can check on it for you. Worth a look?';
const EMAIL = 'Subject: Another Corolla SE option\n\nHi Test,\n\nIf a Corolla is still on your list, a 2025 Toyota Corolla SE in Blueprint is in stock.\n\nAgent Name\nAudi Concierge';
const DROPPED = 'Test, the 2025 Corolla SE in Blueprint is in stock and could be another option. Would the Blueprint one be worth considering?';
const KEPT = 'Test, the 2025 Corolla SE in Blueprint is in stock. As your Concierge, I can check on it for you. Worth considering?';

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const span = (mark) => { const a = src.indexOf(mark); if (a < 0) throw new Error(mark + ' not found'); return src.slice(a, src.indexOf('\n}\n', a) + 2); };
    const rule = (src.match(/^var _LP_SMS_SHAPE_RULE = '[^\n]*';$/m) || [''])[0];
    const code = rule + '\n' + span('function buildSystemPromptSmsRefine(') + '\n' + span('function _lpBuildSmsRefinePrompt(') + '\n' + span('async function _lpRefineSms(');
    const run = (pass1, reply) => {
      const logs = [];
      const sb = { String, JSON, Date, RegExp, Array, Math, Error, setTimeout, clearTimeout, AbortController,
        console: { log: (...x) => logs.push(x.join(' ')) },
        window: { _leadProResolvedSigner: { firstName: 'Agent', phone: '(555) 010-0100' }, _leadProResolvedContext: { storeName: 'Audi Lafayette' } },
        getEndpoint: () => ({ url: 'https://example.invalid/generate' }), _lpAttachLicense: p => p,
        fetch: () => { const r = { json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: reply }) }] } }] }) };
          return Object.assign(Promise.resolve(r), { finally: fn => Promise.resolve(r).then(v => { fn(); return v; }) }); } };
      vm.createContext(sb); vm.runInContext(code, sb);
      sb.__d = { lastInboundMsg: '', storeName: 'Audi Lafayette', relationshipSignals: { unansweredQuestions: [] } };
      return { prompt: vm.runInContext('_lpBuildSmsRefinePrompt(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', __d)', sb),
               out: vm.runInContext('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', __d)', sb), logs };
    };

    console.log(' 1. the rewrite is told the title is required:');
    check('pass 1 carries "Concierge": the rewrite prompt says to keep it, as their own role', /It is required in this text: keep the word "Concierge", as YOUR own role/.test(run(P1, KEPT).prompt), true);
    check('control: no "Concierge" in pass 1, no such line', /keep the word "Concierge"/.test(run(P1.replace('As your Audi Concierge, I', 'I'), KEPT).prompt), false);

    console.log(' 2. a rewrite that drops it does not ship:');
    const r1 = run(P1, DROPPED); const o1 = await r1.out;
    check('the log261 shape: pass 1 had it, the rewrite lost it -> the first pass ships (null), logged', [o1, r1.logs.some(l => /kept the first pass — it carried the Concierge title and the rewrite dropped it/.test(l))], [null, true]);
    check('control: a rewrite that keeps it ships', await run(P1, KEPT).out, KEPT);
    check('control: pass 1 without the title, a rewrite without it ships', await run(P1.replace('As your Audi Concierge, I', 'I'), DROPPED).out, DROPPED);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
