#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('internal-exit-855.test.js');
// (v9.7.855) OWNER DECISIONS 11/3. (1) hasInternalNotInterested and hasInternalSoldElsewhere read THIS lead only (notes at or
// after the current-lead marker, else the Created date, else the read age): a prior lead's "not interested anymore" or "bought
// elsewhere" no longer ends a fresh inquiry. When the lead's start cannot be found, neither can end the conversation on its
// own; the match is logged in [LP EXIT SIGNAL DIAG] with the note and its date. (2) A request relayed in a call note
// ("customer asked to be taken off the list", "customer said stop contacting her") reaches the exit check under a call-note
// rule. (3) v9.7.853 took inbound call notes out of _lpCustEntries (not the customer's own words); the helpers that need a
// FACT read _lpCustSignals, which keeps them flagged viaCall, so a shipping ask, a trip, a second applicant or a price asked
// for on the phone is seen again, and the prompt says it came from a call. Executes the shipped scraper region, the shipped
// popup-side diag, and the shipped helpers. Placeholder data only.
//
// Usage: node tests/internal-exit-855.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: internal-exit-855.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const PHONE = '(555) 010-0199';
function note(date, title, content, dir) {
  const map = { '.notes-and-hsitory-item-date': { innerText: date }, '.legacy-notes-and-history-title': { innerText: title },
    '.notes-and-history-item-content': { innerText: content, textContent: content } };
  return { getAttribute: (k) => (k === 'data-direction' ? (dir || '') : null), querySelector: (s) => map[s] || null };
}
const ours = (date, body) => ({ note: note(date, 'Outbound Text Message', 'By: Rep Name\n' + body, 'outbound'), line: '[' + date + '] [AGENT] Outbound Text Message\n  By: Rep Name ' + body });
const general = (date, body) => ({ note: note(date, 'General Note', 'By: Rep Name\n' + body, ''), line: '[' + date + '] [NOTE] General Note\n  By: Rep Name ' + body });
const callOut = (date, body) => ({ note: note(date, 'Outbound phone call (Contacted)', 'By: Rep Name\n' + body, 'outbound'), line: '[' + date + '] [AGENT] Outbound phone call (Contacted)\n  By: Rep Name ' + body });
const callIn = (date, body) => ({ note: note(date, 'Inbound phone call', 'By: Rep Name\n' + body, 'inbound'), line: '[' + date + '] [CUSTOMER] Inbound phone call\n  ' + body });
const MARKER_DATE = '09/10/2026 9:00 AM';
const marker = () => ({ note: note(MARKER_DATE, 'Lead Received', 'Lead received', ''), isMarker: true,
  line: '[' + MARKER_DATE + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.' });
function lead(entries, opts) {
  opts = opts || {};
  const hasMarker = entries.some(e => e.isMarker) && !opts.noMarker;
  return { noteEls: entries.map(e => e.note), transcript: entries.filter(e => e.line && !(opts.noMarker && e.isMarker)).map(e => e.line), lastInboundMsg: '',
    markerMs: hasMarker ? new Date(MARKER_DATE).getTime() : 0, markerDate: hasMarker ? MARKER_DATE : '', cutoffMs: hasMarker ? new Date(MARKER_DATE).getTime() - 3600000 : 0,
    createdMs: opts.createdMs || 0, ageScraped: opts.ageScraped !== undefined ? opts.ageScraped : hasMarker, age: opts.age !== undefined ? opts.age : 0 };
}
function extract(src) {
  const a = src.indexOf('    var filteredTranscript = transcript.filter(function(line){');
  const endTok = 'const isSmsOptOutOnly = isSmsOptOut && !smsOptOutIsExit && !hasExitSignal;';
  const b = src.indexOf(endTok, a);
  const ra = src.indexOf('    var _LP_LINE_STAMP_RE = '), rb = src.indexOf('\n    var recentHistory = transcript.filter', ra);
  if (a < 0 || b < 0 || ra < 0 || rb < 0) throw new Error('scraper region not found');
  const fn = new Function('__s', 'var transcript=__s.transcript, noteEls=__s.noteEls, phone="' + PHONE + '", _lpD=function(){},'
    + ' transcriptCutoffMs=__s.cutoffMs, hasNewLeadToday=false, leadAgeDays=__s.age, _leadAgeScraped=__s.ageScraped, leadCreatedMs=__s.createdMs,'
    + ' _lpMarkerMs=__s.markerMs, _lpMarkerDate=__s.markerDate, lastInboundMsg=__s.lastInboundMsg;\n'
    + src.slice(ra, rb) + '\n' + src.slice(a, b + endTok.length) + '\n'
    + 'return { exit: !!hasExitSignal, diag: (typeof _internalExitDiag === "undefined" ? null : _internalExitDiag) };');
  return fn;
}
const Q = ours('09/12/2026 10:00 AM', 'Test, the CR-V is here. When works to see it?');

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let run; try { run = extract(src); } catch (e) { check('extract', () => e.message, 'ok'); continue; }
  const X = (L) => { const o = run(L); return o.exit; };
  const D = (L) => (run(L).diag || []).map(x => x.scan + ':' + x.scope);

  console.log(' 1. a prior lead\'s note does not end a fresh lead:');
  check('prior-lead "Customer is not interested anymore" (2025), fresh lead with our text only: no exit', () =>
    X(lead([Q, marker(), general('01/05/2025 2:00 PM', 'Customer is not interested anymore.')])), false);
  check('prior-lead "customer bought elsewhere" (2025): no exit', () => X(lead([Q, marker(), general('01/06/2025 2:00 PM', 'customer bought elsewhere')])), false);
  check('the diag names both as prior', () =>
    [D(lead([Q, marker(), general('01/05/2025 2:00 PM', 'Customer is not interested anymore.')]))[0], D(lead([Q, marker(), general('01/06/2025 2:00 PM', 'customer bought elsewhere')]))[0]],
    ['not interested (agent-recorded decline):prior', 'sold elsewhere:prior']);
  check('control: the same two notes on THIS lead end it (unchanged)', () =>
    [X(lead([general('09/13/2026 2:00 PM', 'Customer is not interested anymore.'), Q, marker()])), X(lead([general('09/13/2026 2:00 PM', 'customer bought elsewhere'), Q, marker()]))], [true, true]);

  console.log(' 2. when the lead\'s start cannot be found:');
  const unk = (n) => lead([n, Q, marker()], { noMarker: true, ageScraped: false, createdMs: 0 });
  check('no marker, no Created, no age: "not interested anymore" and "bought elsewhere" are logged, not an exit on their own', () =>
    [X(unk(general('09/13/2026 2:00 PM', 'Customer is not interested anymore.'))), X(unk(general('09/13/2026 2:00 PM', 'customer bought elsewhere'))),
     D(unk(general('09/13/2026 2:00 PM', 'customer bought elsewhere')))[0]], [false, false, 'sold elsewhere:unknown start']);
  check('the Created date alone is enough to place the note on this lead', () =>
    X(lead([general('09/13/2026 2:00 PM', 'customer bought elsewhere'), Q, marker()], { noMarker: true, ageScraped: false, createdMs: new Date('09/10/2026').getTime() })), true);

  console.log(' 3. a request relayed in a call note reaches the exit check:');
  check('outbound call note "customer asked to be taken off the list": exit, by the call-note rule', () => {
    const L = lead([callOut('09/13/2026 2:00 PM', 'Customer asked to be taken off the list.'), Q, marker()]); return [X(L), D(L)[0]]; }, [true, 'not interested (call-note relay):current']);
  check('outbound call note "customer said stop contacting her": exit, by the call-note rule', () => {
    const L = lead([callOut('09/13/2026 2:00 PM', 'Spoke with customer, she said stop contacting her.'), Q, marker()]); return [X(L), D(L)[0]]; }, [true, 'not interested (call-note relay):current']);
  check('the same in an INBOUND call note: exit (the call-note rule names it)', () => {
    const L = lead([callIn('09/13/2026 2:00 PM', 'customer said stop contacting her'), Q, marker()]); return [X(L), D(L)[0]]; }, [true, 'not interested (call-note relay):current']);
  check('a prior lead\'s call note "customer asked to be taken off the list": no exit', () =>
    X(lead([Q, marker(), callOut('01/05/2025 2:00 PM', 'Customer asked to be taken off the list.')])), false);
  check('control: our own TEXT "reply and I can take you off the list" is not a relayed request', () =>
    X(lead([ours('09/13/2026 2:00 PM', 'If you are not shopping anymore, reply and I can take you off the list.'), Q, marker()])), false);

  console.log(' 4. the popup log says what the frame found:');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { check('load', () => e.message, 'ok'); continue; }
  const lines = (() => { const out = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => out.push(q.join(' ')); sb.console.warn = () => {};
    try { vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.populateFromData({ autoLeadId: 'TEST001A', name: 'Test Buyer', vehicle: '2026 Honda CR-V EX', store: 'Community Honda Baytown', dealerId: '6191',
      leadSource: 'Dealers WebSite', convState: 'active-follow-up', leadAgeDays: 4, history: '', relationshipSignals: {},
      _internalExitDiag: [{ scan: 'sold elsewhere', scope: 'prior', date: '01/06/2025 2:00 PM', note: 'customer bought elsewhere' },
                          { scan: 'not interested (agent-recorded decline)', scope: 'unknown start', date: '09/13/2026 2:00 PM', note: 'customer is not interested anymore' }] });
    } catch (e) {} finally { sb.console.log = ol; sb.console.warn = ow; } return out.filter(l => /\[LP EXIT SIGNAL DIAG\] internal note/.test(l)); })();
  check('[LP EXIT SIGNAL DIAG] lists each matched note with its date and the verdict', () =>
    [lines.length, /internal note \(sold elsewhere\) dated 01\/06\/2025 2:00 PM -> a PRIOR lead: not an exit \| "customer bought elsewhere"/.test(lines[0] || ''),
     /dated 09\/13\/2026 2:00 PM -> this lead's start is unknown \(no marker, no age\): logged, not an exit on its own/.test(lines[1] || '')], [2, true, true]);

  console.log(' 5. a fact said on a call is seen again, and named as a call:');
  const run2 = (e) => vm.runInContext(e, sb);
  const H = (entries) => entries.join('') + '[09/10/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
  const IC = (date, body) => '[' + date + '] [CUSTOMER] Inbound phone call\n  ' + body + '\n';
  const IT = (date, body) => '[' + date + '] [CUSTOMER] Inbound Text Message\n  ' + body + '\n';
  const shipCall = { history: H([IC('09/13/2026 2:00 PM', 'Customer asked if we can ship it to Louisiana')]) };
  check('a shipping ask on an inbound call is seen (853 lost it), flagged viaCall', () => { const x = run2('_lpShipAskEntry')(shipCall); return [!!x, x && x.viaCall]; }, [true, true]);
  check('the prompt line says it came from a call and not to quote the note', () =>
    run2('_lpSaidHow')(run2('_lpShipAskEntry')(shipCall), 'Customer asked if we can ship it to Louisiana'),
    'on the phone (the call note says "Customer asked if we can ship it to Louisiana"; never quote the note)');
  check('a shipping ask they TYPED is quoted as theirs', () => run2('_lpSaidHow')(run2('_lpShipAskEntry')({ history: H([IT('09/13/2026 2:00 PM', 'Can you ship it to Louisiana?')]) }), 'Can you ship it to Louisiana?'),
    '"Can you ship it to Louisiana?"');
  const TODAY = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });   // the helper looks back 14 days
  check('a second applicant mentioned on a call is seen, viaCall', () => { const x = run2('_lpSecondApplicant')({ history: H([IC(TODAY + ' 2:00 PM', 'said her husband will be a co-buyer'),
    '[09/12/2026 10:00 AM] [AGENT] Outbound Text Message\n  Here is the application: https://example.invalid/credit-app\n']) }); return x && [x.viaCall, /co-buyer/.test(x.said)]; }, [true, true]);
  check('"they are talking to us": an inbound call within 3 days counts', () => !!run2('_lpCustomerTalking')({ history: H([IC(new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) + ' 9:00 AM', 'called about the CR-V'),
    '[09/12/2026 10:00 AM] [AGENT] Outbound Text Message\n  Test, the CR-V is here.\n']) }), true);
  check('an empty call stub ("System") is not a signal', () => run2('_lpCustSignals')({ history: H([IC('09/13/2026 2:00 PM', 'System')]) }).length, 0);
  check('control: _lpCustEntries (the customer\'s own words) still leaves the call out', () => run2('_lpCustEntries')(shipCall).length, 0);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
