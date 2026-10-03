#!/usr/bin/env node
'use strict';
// (v9.7.707) log242, Toyota Baytown (capture bc558f2f, dump ed87d87f). The draft told a customer "Our
// email bounced" on the strength of ONE Email Failure from 08/29/2025: Gmail's "421 4.7.0 ... very low
// reputation of the sending domain", a temporary refusal of the STORE's bulk mail, followed by 20+
// emails to the same address through 9/22/2026 with no failure. Two rules: a 4xx-only failure is not
// counted, and a failure followed by a later outbound email with no failure is superseded.
// Executes the shipped scan, lifted verbatim from popup.js, over fake note elements shaped like the
// two real dumps (the 421 lead, and the Kia lead with five 554 5.2.2 mailbox-full failures).
//
// Usage: node tests/bounce-707.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs');
const path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: bounce-707.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function note(date, title, content, dir) {
  const map = { '.notes-and-hsitory-item-date': { innerText: date }, '.legacy-notes-and-history-title': { innerText: title },
                '.notes-and-history-item-content': { innerText: content, textContent: content } };
  return { getAttribute: (k) => (k === 'data-direction' ? (dir || '') : null), querySelector: (s) => map[s] || null };
}
// The two real failure texts, verbatim up to the point that identifies nothing.
const GMAIL_421 = 'Subject: Hot Summer Deals By: System 421 4.7.0 [167.89.32.221 19] Gmail has detected that this message is suspicious due to the very low reputation of the sending domain. To best protect our users from spam, the message has been blocked.';
const MS_554 = 'Subject: Your approval By: System 554 5.2.2 mailbox full; STOREDRV.Deliver.Exception:QuotaExceededException; Failed to process message due to a permanent exception';
const campaign = (d) => note(d, 'Marketing Campaign Email', 'Subject: Your lease is almost up By: System', 'outbound');

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const a = src.indexOf('    var emailBounce = null;'), b = src.indexOf('} catch (eEb) { emailBounce = null; }', a);
  const body = src.slice(a, b + '} catch (eEb) { emailBounce = null; }'.length);
  const scan = (notes, markerMs) => { const logs = [];
    const r = new Function('noteEls', '_lpMarkerMs', '_lpD', body + '\nreturn emailBounce;')(notes, markerMs || 0, (x) => logs.push(x));
    return { r, log: logs.join(' ') }; };

  console.log(' the log242 lead:');
  const LOG242 = [ // newest first, as the page lists them
    note('09/23/2026 8:19 PM', 'Inbound Text Message', 'What are the options?', 'inbound'),
    campaign('09/22/2026 7:00 AM'),
    note('09/21/2026 1:52 PM', 'Email auto response', 'Subject: Service reminder By: System', 'outbound'),
    campaign('09/03/2026 4:20 PM'),
    campaign('09/01/2025 4:04 PM'),
    note('08/29/2025 11:17 PM', 'Email Failure', GMAIL_421, 'outbound'),
    campaign('08/29/2025 11:17 PM'),
  ];
  check('a 13-month-old Gmail 421 followed by a year of emails is NOT a bounce', () => scan(LOG242).r, null);
  check('...and the diag says why, twice over', () => { const l = scan(LOG242).log;
    return [/bounces on this lead:0/.test(l), /temporary 4xx \(not counted\):1/.test(l)]; }, [true, true]);
  check('a 421 on its own, with nothing sent after it, is still not a bounce (it is about the sender)',
    () => scan([note('09/23/2026 9:00 AM', 'Email Failure', GMAIL_421, 'outbound'), campaign('09/23/2026 9:00 AM')]).r, null);

  console.log(' permanent failures still count:');
  const KIA = [];
  for (const d of ['09/16', '09/15', '09/14', '09/13']) {
    KIA.push(note(d + '/2026 8:58 AM', 'Email Failure', MS_554, 'outbound'));
    KIA.push(note(d + '/2026 8:57 AM', 'Email reply to prospect', 'Subject: Your approval By: System', 'outbound'));
  }
  KIA.push(note('09/11/2026 9:17 AM', 'Email Failure', MS_554, 'outbound'));
  check('control: the Kia lead, five 554 5.2.2 mailbox-full failures each a minute after its send, is bouncing',
    () => scan(KIA).r, { count: 5, lastDate: '09/16/2026 8:58 AM' });
  check('control: the 9/23 Audi lead ("Bounced Address", no code) is bouncing',
    () => scan([note('09/23/2026 8:57 AM', 'Email Failure', 'Subject: x By: System Bounced Address', 'outbound'),
                note('09/22/2026 9:03 AM', 'Email Failure', 'Subject: y By: System Bounced Address', 'outbound')]).r, { count: 2, lastDate: '09/23/2026 8:57 AM' });
  check('control: a failure with a 4xx AND a 5xx counts (the permanent code wins)',
    () => (scan([note('09/20/2026 9:00 AM', 'Email Failure', '421 4.4.2 retry; then 550 5.1.1 user unknown', 'outbound')]).r || {}).count, 1);
  check('a mix: only the permanent one is counted',
    () => scan([note('09/20/2026 9:00 AM', 'Email Failure', MS_554, 'outbound'), note('09/19/2026 9:00 AM', 'Email Failure', GMAIL_421, 'outbound')]).r,
    { count: 1, lastDate: '09/20/2026 9:00 AM' });

  console.log(' superseded:');
  check('a permanent failure followed by a later email with no failure behind it is history',
    () => scan([campaign('09/20/2026 7:00 AM'), note('09/01/2026 9:00 AM', 'Email Failure', MS_554, 'outbound')]).r, null);
  check('...and the diag names the email that superseded it',
    () => /SUPERSEDED: 1 failure\(s\), but an email went out 09\/20\/2026 7:00 AM with none after it/.test(
      scan([campaign('09/20/2026 7:00 AM'), note('09/01/2026 9:00 AM', 'Email Failure', MS_554, 'outbound')]).log), true);
  check('control: an INBOUND email after the failure does not supersede it (it says nothing about our sends)',
    () => (scan([note('09/20/2026 7:00 AM', 'Email from prospect', 'Subject: hi', 'inbound'),
                 note('09/01/2026 9:00 AM', 'Email Failure', MS_554, 'outbound')]).r || {}).count, 1);
  check('control: a text after the failure does not supersede it either', () => (scan([note('09/20/2026 7:00 AM', 'Outbound Text Message', 'hi', 'outbound'),
                 note('09/01/2026 9:00 AM', 'Email Failure', MS_554, 'outbound')]).r || {}).count, 1);
  check('control: a prior lead\'s bounce is still not counted (the marker rule, unchanged)',
    () => scan([note('01/02/2025 9:00 AM', 'Email Failure', 'Bounced Address', 'outbound')], new Date('09/21/2026 10:00 PM').getTime()).r, null);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
