#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dump-all-740.test.js');
// (v9.7.740) Gil, 9/29: "yes add the rewrite capture to the dump ... Can I combine all these commands into one
// prompt?" _lpDumpPrompt() now writes one file carrying the prompts, the model's raw response, the SMS rewrite step
// end to end, what Lead Pro read off the page, the dealer's inventory/incentive snapshot and the fact-check
// verdicts. Executes the shipped _lpDumpPrompt (with a stubbed Blob/download) and the shipped _lpRefineSms (with the
// worker call stubbed). Placeholder data only.
//
// Usage: node tests/dump-all-740.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: dump-all-740.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const a = src.indexOf('      window._lpDumpPrompt = function() {');
    const b = src.indexOf('\n      };', a);
    const dumpFn = src.slice(a, b + '\n      };'.length);

    console.log(' 1. one file, every section:');
    let written = '';
    const sb = { JSON, Date, String, setTimeout: () => {},
      Blob: function (parts) { written = parts.join(''); },
      URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
      document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
      window: { _lpLastSystemPrompt: 'SYS TEXT', _lpLastUserPrompt: 'USER TEXT', _lpLastRawResponse: '{"sms":"RAW REPLY"}',
        _lpLastRefine: { pass1: 'FIRST PASS', shipped: 'SHIPPED TEXT', raw: '{"sms":"REWRITE RAW"}', system: 'REWRITE SYS', user: 'REWRITE USER', result: 'pass 2 shipped' },
        _lpFactVerdicts: { 'off-franchise': { fired: true } } },
      lastScrapedData: { autoLeadId: '2000000099', dealerId: '6189', name: 'Test Buyer' },
      _lpValueFactCache: { '6189': { inv: { units: [{ stock: 'TEST001A' }] } } } };
    vm.createContext(sb);
    vm.runInContext('var lastScrapedData = this.lastScrapedData; var _lpValueFactCache = this._lpValueFactCache;\n' + dumpFn + '\nwindow._lpDumpPrompt();', sb);
    check('the file opens with the lead and dealer, then the two prompts as before', [/^=== LEAD 2000000099 \| dealer 6189 \| dumped /.test(written),
      /=== SYSTEM PROMPT \(8 chars\) ===\n\nSYS TEXT/.test(written), /=== USER PROMPT \(9 chars\) ===\n\nUSER TEXT/.test(written)], [true, true, true]);
    check('it carries the raw response and the rewrite step: result, both texts, raw reply, both prompts', [
      /=== MODEL RAW RESPONSE ===\n\n\{"sms":"RAW REPLY"\}/.test(written),
      /=== SMS REWRITE STEP ===\n\nRESULT: pass 2 shipped/.test(written), /--- first-pass text ---\nFIRST PASS/.test(written),
      /--- text that shipped ---\nSHIPPED TEXT/.test(written), /--- rewrite reply \(raw\) ---\n\{"sms":"REWRITE RAW"\}/.test(written),
      /--- rewrite system prompt ---\nREWRITE SYS/.test(written), /--- rewrite user prompt ---\nREWRITE USER/.test(written)], [true, true, true, true, true, true, true]);
    check('...and the page data, this dealer\'s inventory, and the fact verdicts', [
      /=== WHAT LEAD PRO READ OFF THE PAGE \(lastScrapedData\) ===\n\n\{\n  "autoLeadId": "2000000099"/.test(written),
      /=== INVENTORY AND INCENTIVES FOR THIS DEALER, AS HELD AT DUMP TIME ===[\s\S]*"stock": "TEST001A"/.test(written),
      /=== FACT CHECK VERDICTS ===[\s\S]*"off-franchise"/.test(written)], [true, true, true]);

    console.log(' 2. the rewrite step records itself:');
    const span = (mark) => { const i = src.indexOf(mark); return src.slice(i, src.indexOf('\n}\n', i) + 2); };
    const rule = (src.match(/^var _LP_SMS_SHAPE_RULE = '[^\n]*';$/m) || [''])[0];
    const rsb = { String, JSON, Date, RegExp, Array, Math, Error, setTimeout, clearTimeout, AbortController, console: { log() {} },
      window: { _leadProResolvedSigner: { firstName: 'Agent', phone: '(555) 010-0100' }, _leadProResolvedContext: { storeName: 'Test Store' } },
      getEndpoint: () => ({ url: 'https://example.invalid/generate' }), _lpAttachLicense: p => p,
      fetch: () => { const r = { json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"sms":"Test, the rewrite."}' }] } }] }) };
        return Object.assign(Promise.resolve(r), { finally: fn => Promise.resolve(r).then(v => { fn(); return v; }) }); } };
    vm.createContext(rsb);
    vm.runInContext(rule + '\n' + span('function buildSystemPromptSmsRefine(') + '\n' + span('function _lpBuildSmsRefinePrompt(') + '\n' + span('async function _lpRefineSms('), rsb);
    rsb.__d = { lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] } };
    await vm.runInContext('_lpRefineSms("Test, the first draft.", "Subject: x\\n\\nHi Test,\\n\\nAn email body long enough to be used by the rewrite step here.\\n\\nAgent", __d)', rsb);
    const lr = rsb.window._lpLastRefine || {};
    check('first pass, both prompts and the raw reply are kept on window._lpLastRefine', [lr.pass1, /Test, the first draft\./.test(lr.user || ''), (lr.system || '').length > 100, lr.raw], ['Test, the first draft.', true, true, '{"sms":"Test, the rewrite."}']);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
