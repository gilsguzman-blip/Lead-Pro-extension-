#!/usr/bin/env node
'use strict';
// (v9.7.711) The trigger inventory's defects, each run through the SHIPPED code. Items 2, 5, 8 and 4
// are asserted in lead-boundary, open-thread-resolver, own-words-topics and variant-token, next to
// the suites that already own those scans. This suite covers the other four:
//   1. the customer's latest message was quoted with the CRM routing header ("Received from:
//      (phone) Received by: <agent>" / "Subject: Re:... By: <agent>") -- 10 of 13 replied leads;
//   3. "TRIM/CONFIG PREFERENCE: Customer referenced EX-L" read our text and notes, not the customer;
//   6. "VEHICLE ON LEAD ... sold, pending, or in transit" beside "VEHICLE STATUS: SOLD";
//   7. "VISIT OVERRIDE: the customer has already visited" from a showroom visit years old (log242).
// Slices are lifted from popup.js by their code anchors and executed; helpers they call are lifted
// by brace-matching from the same file, never re-written here. Placeholder data only.
//
// Usage: node tests/inventory-711.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: inventory-711.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// Ends at the closing brace on the function's own indentation. Brace-counting is not used: the
// commercial build's sanitize() carries a comment with an unbalanced brace in prose.
function lift(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' not found');
  const indent = src.slice(src.lastIndexOf('\n', at) + 1, at);
  const end = src.indexOf('\n' + indent + '}\n', at);
  if (end < 0) throw new Error(name + ' unclosed');
  return src.slice(at, end + indent.length + 2);
}
function between(src, a, b) {
  const i = src.indexOf(a); if (i < 0) throw new Error('anchor not found: ' + a.slice(0, 60));
  const j = src.indexOf(b, i); if (j < 0) throw new Error('end not found: ' + b.slice(0, 60));
  return src.slice(i, j);
}
function mkNotes(notes) {
  return notes.map(n => ({
    getAttribute: a => (a === 'data-direction' ? n.dir : ''),
    querySelector: sel => sel.indexOf('legacy-notes-and-history-title') >= 0 ? { innerText: n.title }
      : sel.indexOf('notes-and-history-item-content') >= 0 ? { innerText: n.body }
      : sel.indexOf('notes-and-hsitory-item-date') >= 0 ? { innerText: n.date } : null
  }));
}

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  // sanitize() reads _LP_QDATE, a statement defined just above it; that statement is lifted too.
  const qd = src.indexOf('    var _LP_QDATE = ');
  const qdate = src.slice(qd, src.indexOf(';\n', qd) + 2);
  const helpers = lift(src, '_lpIsRoutingLine') + '\n' + lift(src, '_lpStripNoteMeta') + '\n' + qdate + lift(src, 'sanitize') + '\n';

  console.log(' 1. the latest-message quote carries the message, not the CRM routing:');
  const latestCode = between(src, "      var keySignal = '';\n", '        var isStaleReply') + '\n      }\n';
  const latest = (notes) => {
    const sb = { String, RegExp, Date, Math, noteEls: mkNotes(notes), transcriptCutoffMs: 0 };
    vm.createContext(sb);
    vm.runInContext(helpers + '\nfunction __run(){\n' + latestCode + '  return typeof mostRecentInbound === "string" ? mostRecentInbound : null; }', sb);
    return vm.runInContext('__run()', sb);
  };
  const TXT = (date, body) => ({ dir: 'inbound', title: 'Inbound Text Message', date,
    body: 'Received from: (555) 010-0199\nReceived by: Vinessa Virtual Assistant Community Kia\n' + body });
  check('a text: the quote is the customer\'s words only', () => latest([TXT('09/23/2026 8:19 PM', 'What are the options?')]), 'What are the options?');
  check('...no phone number and no assistant name anywhere in it', () => {
    const q = latest([TXT('09/16/2026 10:21 AM', 'Nice I love it'), TXT('09/16/2026 10:20 AM', 'Can I see the inside')]);
    return [/\(555\)|Received|Vinessa/.test(q), q]; },
    [false, '(newest) Nice I love it  ||  (then) Can I see the inside']);
  check('an email reply: the "Subject: Re:... / By: <agent>" header is gone', () => latest([{ dir: 'inbound', title: 'Email reply from prospect',
    date: '09/16/2026 9:54 PM', body: 'Subject: Re:Subject:A different K5 financing path\nBy: Agent Name\nThank you, sorry I am late getting back to you.' }]),
    'Thank you, sorry I am late getting back to you.');
  check('control: a note with no header is quoted unchanged', () => latest([{ dir: 'inbound', title: 'Inbound Text Message',
    date: '09/23/2026 8:19 PM', body: 'Is it still available?' }]), 'Is it still available?');
  check('a note that is ONLY a routing header is not quoted as a message', () => latest([{ dir: 'inbound', title: 'Inbound Text Message',
    date: '09/23/2026 8:19 PM', body: 'Received from: (555) 010-0199\nReceived by: Agent Name' }]), null);

  console.log(' 3. TRIM/CONFIG PREFERENCE reads the customer, not us:');
  // Slices are taken lazily, inside each check, so a build without the code fails by name.
  const trimSlice = () => between(src, "      var _lpTrimSrc = '';", '      // (v9.7.614) UNSHIFTED');
  const trim = (custLines, all) => { const trimCode = trimSlice();
    const logs = [];
    const sb = { String, RegExp, _lpD: (...x) => logs.push(x.join(' ')), allTranscriptText: all, customerOnlyText: custLines.join(' '),
      _lpCustomerSaid: () => custLines.map(t => ({ text: t, ms: 0 })) };
    vm.createContext(sb);
    vm.runInContext('function __run(){\n' + trimCode + '\n return trimMatch ? trimMatch[0] : null; }', sb);
    return { m: vm.runInContext('__run()', sb), logs };
  };
  const OURS = '[09/20/2026 10:00 AM] [NOTE] General Note Customer interested in the 2025 Honda CR-V EX-L we have in stock';
  check('"CR-V EX-L" in our note, never in the customer\'s words: no trim preference', () => trim(['Is it still available?'], OURS + ' Is it still available?').m, null);
  check('...and the diag says why', () => trim(['Is it still available?'], OURS).logs.some(l => /^\[LP TRIM SCOPE DIAG\] "EX-L" appears only in our text/.test(l)), true);
  check('control: the customer writing "EX-L" still fires', () => trim(['do you have an EX-L in white?'], OURS + ' do you have an EX-L in white?').m, 'EX-L');
  check('control: fallback to customer-only text if the helper is unavailable', () => { const trimCode = trimSlice();
    const sb = { String, RegExp, _lpD() {}, allTranscriptText: OURS, customerOnlyText: '[CUSTOMER] the touring one' };
    vm.createContext(sb);
    vm.runInContext('function __run(){\n' + trimCode + '\n return trimMatch ? trimMatch[0] : null; }', sb);
    return vm.runInContext('__run()', sb); }, 'touring');

  console.log(' 6. one availability answer, not "SOLD" beside "sold, pending, or in transit":');
  const sb = loadPopup(f, { withAuth: true });
  const pfd = (extra) => {
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
    sb.populateFromData(Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '2022 Honda Civic Sport', stockNum: 'TA000002A', dealerId: '6191',
      store: 'Community Honda Baytown', leadSource: 'Website', convState: 'active-follow-up', leadAgeDays: 3, totalNoteCount: 6, hasOutbound: true,
      hasCustomerReply: true, relationshipSignals: {}, lastInboundMsg: 'Is it still there?', history: '', context: '' }, extra || {}));
    return vm.runInContext('leadContext', sb);
  };
  check('inventory warning: VEHICLE ON LEAD names the flag and defers to VEHICLE STATUS', () => {
    const c = pfd({ inventoryWarning: true });
    return [/VEHICLE ON LEAD:[^\n]*NO LONGER IN ACTIVE INVENTORY/.test(c), /VEHICLE ON LEAD:[^\n]*sold, pending, or in transit/.test(c), /VEHICLE STATUS: SOLD/.test(c)]; },
    [true, false, true]);
  check('control: no warning, unit not confirmed by the feed -> the generic hedge is kept', () => {
    const c = pfd({});
    return [/VEHICLE ON LEAD:[^\n]*sold, pending, or in transit/.test(c), /NO LONGER IN ACTIVE INVENTORY/.test(c)]; }, [true, false]);
  check('control: pending sale keeps the generic hedge (it IS "may be pending")', () =>
    /VEHICLE ON LEAD:[^\n]*sold, pending, or in transit/.test(pfd({ inventoryWarning: true, vehiclePendingSale: true })), true);

  console.log(' 7. a showroom visit from years ago is not "the visit happened":');
  const visit = (date) => {
    const visitCode = between(src, '    // 3. Showroom Visit notes', '      var notePrefix = _LP_AGENT_CONTEXT_PREAMBLE') + '\n    }\n';
    const logs = [];
    const s2 = { String, RegExp, Date, Math, noteEls: mkNotes([{ dir: '', title: 'Showroom Visit', date, body: 'Salesperson: Agent Name. Test drive completed.' }]),
      contextNoteLines: [], _hasPostVisitNote: false, _hasReturnVisitNote: false, _lpVisitNewestMs: 0,
      _isShowroomVisitDeleted: () => false, decodeShowroomVisit: () => ({ plain: true }), _lpD: (...x) => logs.push(x.join(' ')) };
    vm.createContext(s2);
    vm.runInContext('function __run(){ var contextNoteLines = [], _hasPostVisitNote = false, _hasReturnVisitNote = false, _lpVisitNewestMs = 0;\n'
      + visitCode + '\n return _overrideWarning0; }', s2);
    return { w: vm.runInContext('__run()', s2), logs };
  };
  const daysAgo = n => { const d = new Date(Date.now() - n * 86400000); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ' 3:10 PM'; };
  check('a 2023 visit: no VISIT OVERRIDE; a dated PRIOR VISIT line instead', () => {
    const w = visit('05/12/2023 3:10 PM').w;
    return [/VISIT OVERRIDE/.test(w), /PRIOR VISIT ON RECORD: the newest showroom-visit record is from 5\/12\/2023/.test(w), /NOT recent/.test(w)]; }, [false, true, true]);
  check('...and the diag reports the age', () => visit('05/12/2023 3:10 PM').logs.some(l => /^\[LP VISIT AGE DIAG\] newest visit record \d+ days old -- older than 30 days/.test(l)), true);
  check('control: a visit 3 days ago still raises the VISIT OVERRIDE', () => /⚠ VISIT OVERRIDE:/.test(visit(daysAgo(3)).w), true);
  check('control: exactly 30 days is still inside the window', () => /⚠ VISIT OVERRIDE:/.test(visit(daysAgo(30)).w), true);
  check('control: an undated record keeps the override', () => /⚠ VISIT OVERRIDE:/.test(visit('').w), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
