#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('opener-nickname-756.test.js');
// (v9.7.756) Kia Baytown lead 2093935768, 10/2 (Phone Up, first touch). The record's first name is not the one the
// customer goes by; the salesperson's note used her nickname and the draft opened on it. The SMS opener guard (v9.7.667)
// did not find the record name in the first sentence, so it prepended it and lower-cased the model's word -- the text
// read "<record name>, <nickname in lower case>, no need to rush...". A draft that opens on a capitalised name the lead's
// own notes use is now left alone. Executes the shipped guard. Placeholder names only.
//
// Usage: node tests/opener-nickname-756.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: opener-nickname-756.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const NOTE = '[10/02/2026 5:10 PM] [NOTE] General Note\n  By: Sales Person Kate came in today, saving for a down payment, will come back.\n';
const DRAFT = 'Kate, no need to rush while you’re saving for a down payment. Which would help more right now?';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const a = src.indexOf('    // Light-touch SMS opener check'), b = src.indexOf('\n    })();', a);
  const guard = src.slice(a, b + '\n    })();'.length);
  const run = (sms, lsd) => { const logs = []; const sb = { String, RegExp, rawSms: sms, lastScrapedData: lsd, console: { log: (...x) => logs.push(x.join(' ')) } };
    vm.createContext(sb); vm.runInContext(guard, sb); return { sms: sb.rawSms, logs: logs.join(' ') }; };
  const r = run(DRAFT, { name: 'Katherine Testbuyer', conversationBrief: NOTE });
  check('lead 2093935768 shape: opens on the nickname the note uses -> untouched (was "Katherine, kate, no need...")', r.sms, DRAFT);
  check('...and the diag says why', /opens with "Kate", a name this lead's own notes use/.test(r.logs), true);
  check('control: a nickname the notes never use -> the record name is prepended, as before',
    run(DRAFT, { name: 'Katherine Testbuyer', conversationBrief: '[10/02/2026 5:10 PM] [NOTE] General Note\n  By: Sales Person came in today.\n' }).sms.startsWith('Katherine, kate,'), true);
  check('control: an opening word that is not a name ("Thanks,") is still given the name, even if the notes say Thanks',
    run('Thanks, I can help with the next step.', { name: 'Katherine Testbuyer', conversationBrief: 'Thanks for coming in.' }).sms.startsWith('Katherine, thanks,'), true);
  check('control: the record name already first -> untouched', run('Katherine, no rush at all.', { name: 'Katherine Testbuyer', conversationBrief: NOTE }).sms, 'Katherine, no rush at all.');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
