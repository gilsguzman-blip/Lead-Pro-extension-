#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('optout-exit-852.test.js');
// (v9.7.852) AUDIT L-4, OWNER RULING 11/3. SMS is always drafted (the 9/23 ruling); opt-out evidence only drives the agent
// notice and [LP SMS OPT-OUT EVIDENCE DIAG]. (1) The request forms "don't text / do not text / quit texting / stop sending
// texts" become evidence (a request, not a mention; current-lead scoped). (2) "leave me alone" and "take me off your/the list"
// end the conversation, as "stop contacting me" does. Bare "not interested" deliberately does NOT: it usually declines one
// offer. (3) A prior lead's words cannot exit a new lead: exitRaw reads the customer's lines after the transcript cutoff.
// Executes the shipped scraper region (filteredTranscript through isSmsOptOutOnly) with the shipped cutoff helper against
// fake CRM notes, and the shipped notice statement. Placeholder data only.
//
// Usage: node tests/optout-exit-852.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: optout-exit-852.test.js <popup.js> [popup.js...]'); process.exit(2); }
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
const cust = (date, body) => ({ note: note(date, 'Inbound Text Message', 'Received from: ' + PHONE + '\nReceived by: Test Agent\n' + body, 'inbound'),
  line: '[' + date + '] [CUSTOMER] Inbound Text Message\n  Received from: ' + PHONE + ' Received by: Test Agent ' + body });
const ours = (date, body) => ({ note: note(date, 'Outbound Text Message', 'By: Test Agent\n' + body, 'outbound'),
  line: '[' + date + '] [AGENT] Outbound Text Message\n  By: Test Agent ' + body });
const status = (date, what) => ({ note: note(date, 'SMS Status', 'SMS status has been manually changed to: ' + what + ' by System', ''), line: null });
const MARKER_DATE = '09/10/2026 9:00 AM';
const marker = () => ({ note: note(MARKER_DATE, 'Lead Received', 'Lead received', ''), isMarker: true,
  line: '[' + MARKER_DATE + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.' });
// Entries NEWEST FIRST. The cutoff is this lead's Created date less an hour, as the scraper sets it.
function lead(entries, opts) {
  opts = opts || {};
  const hasMarker = entries.some(e => e.isMarker);
  return { noteEls: entries.map(e => e.note), transcript: entries.filter(e => e.line).map(e => e.line),
    lastInboundMsg: (entries.find(e => e.line && e.line.indexOf('[CUSTOMER]') > -1) || { line: '' }).line.replace(/^[^\n]*\n\s*/, '').replace(/Received (from|by): \S+( \S+)?\s*/g, '').trim(),
    hasNewLeadToday: !!opts.hasNewLeadToday, markerMs: hasMarker ? new Date(MARKER_DATE).getTime() : 0, markerDate: hasMarker ? MARKER_DATE : '',
    cutoffMs: hasMarker ? new Date(MARKER_DATE).getTime() - 3600000 : 0 };
}
function extract(src) {
  const a = src.indexOf('    var filteredTranscript = transcript.filter(function(line){');
  const endTok = 'const isSmsOptOutOnly = isSmsOptOut && !smsOptOutIsExit && !hasExitSignal;';
  const b = src.indexOf(endTok, a);
  const ra = src.indexOf('    var _LP_LINE_STAMP_RE = '), rb = src.indexOf('\n    var recentHistory = transcript.filter', ra);
  if (a < 0 || b < 0 || ra < 0 || rb < 0) throw new Error('scraper region not found');
  const fn = new Function('__s', 'var transcript=__s.transcript, noteEls=__s.noteEls, phone=__s.phone, _lpD=function(){},'
    + ' transcriptCutoffMs=__s.cutoffMs, hasNewLeadToday=__s.hasNewLeadToday, leadAgeDays=3, _leadAgeScraped=true,'
    + ' _lpMarkerMs=__s.markerMs, _lpMarkerDate=__s.markerDate, lastInboundMsg=__s.lastInboundMsg;\n'
    + src.slice(ra, rb) + '\n' + src.slice(a, b + endTok.length) + '\n'
    + 'return { evidence: smsOptOutEvidence, exit: !!hasExitSignal, optOutOnly: !!isSmsOptOutOnly, optOut: !!isSmsOptOut };');
  return (L) => fn(Object.assign({ phone: PHONE }, L));
}
const Q = (when) => ours(when || '09/12/2026 10:00 AM', 'Hi Test, the CR-V is here. Want us to appraise your trade?');
const one = (text) => lead([cust('09/12/2026 11:00 AM', text), Q(), marker()]);

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let run; try { run = extract(src); } catch (e) { check('extract', () => e.message, 'ok'); continue; }
  const R = (L) => { const o = run(L); return [o.evidence, o.exit]; };   // [notice evidence, exit]

  console.log(' 1. asked to stop TEXTING: the notice shows, nothing else changes (no exit):');
  check('"please stop texting me" (unchanged)', () => R(one('please stop texting me')), [true, false]);
  check('"no more texts" (unchanged)', () => R(one('no more texts')), [true, false]);
  check('"don\'t text me, email is fine" (new)', () => R(one("don't text me, email is fine")), [true, false]);
  check('"Do not text. Email only please" (new)', () => R(one('Do not text. Email only please')), [true, false]);
  check('"Please don’t text me anymore" (curly apostrophe, new)', () => R(one('Please don’t text me anymore')), [true, false]);
  check('"quit texting me" and "stop sending me texts" (new)', () => [R(one('quit texting me')), R(one('stop sending me texts'))], [[true, false], [true, false]]);
  check('control: a mention is not a request: "you don\'t text back very fast lol", "i don\'t text much, call me"', () =>
    [R(one("you don't text back very fast lol")), R(one("i don't text much, call me"))], [[false, false], [false, false]]);
  check('control: a prior lead\'s "don\'t text me" is not this lead\'s evidence', () =>
    R(lead([Q(), marker(), cust('01/05/2025 2:00 PM', "don't text me")])), [false, false]);

  console.log(' 2. asked to stop ALL contact: the conversation ends:');
  check('"stop contacting me", "please remove me from your list" (unchanged)', () => [R(one('stop contacting me'))[1], R(one('please remove me from your list'))[1]], [true, true]);
  check('"leave me alone" (new)', () => R(one('leave me alone'))[1], true);
  check('"take me off your list", "take me off the mailing list" (new)', () => [R(one('take me off your list'))[1], R(one('Take me off the mailing list'))[1]], [true, true]);
  check('control: "my wife won\'t leave me alone about the new car" does not end it', () => R(one("my wife won't leave me alone about the new car"))[1], false);

  console.log(' 3. bare "not interested" is for the model to read, not an exit:');
  check('"Want us to appraise your trade?" -> "not interested": no exit', () => R(one('not interested'))[1], false);
  check('"not interested in financing, I\'ll pay cash": no exit', () => R(one("not interested in financing, I'll pay cash"))[1], false);

  console.log(' 4. a prior lead cannot exit a new lead (the v9.7.518 rule):');
  const prior = (t) => lead([cust('09/12/2026 11:00 AM', 'Is the CR-V still available?'), Q('09/11/2026 10:00 AM'), marker(), cust('01/05/2025 2:00 PM', t)], { hasNewLeadToday: false });
  check('prior lead "take me off your list", current lead asking about the CR-V: no exit', () => R(prior('take me off your list'))[1], false);
  check('prior lead "leave me alone" and "stop contacting me": no exit', () => [R(prior('leave me alone'))[1], R(prior('stop contacting me'))[1]], [false, false]);
  check('a new lead with NO reply yet, whose last inbound is the prior lead\'s "take me off your list": no exit (was an exit: exitByRemoval read lastInboundMsg)', () =>
    R(lead([Q('09/11/2026 10:00 AM'), marker(), cust('01/05/2025 2:00 PM', 'take me off your list')]))[1], false);
  check('our own text "reply and I can take you off the list" does not end it (was an exit: exitByRemoval read our outbound)', () =>
    R(lead([cust('09/12/2026 11:00 AM', 'what color is it?'), ours('09/12/2026 10:00 AM', 'If you are not shopping anymore, reply and I can take you off the list.'), marker()]))[1], false);
  check('control: the same "take me off your list" on THIS lead exits', () => R(lead([cust('09/12/2026 11:00 AM', 'take me off your list'), Q('09/11/2026 10:00 AM'), marker()]))[1], true);

  console.log(' 5. unchanged shapes:');
  check('bare STOP: evidence, no exit', () => R(one('STOP')), [true, false]);
  check('current-lead STOP, then "is the civic still there?": evidence, no farewell', () =>
    R(lead([cust('09/15/2026 9:00 AM', 'is the civic still there?'), cust('09/14/2026 3:00 PM', 'STOP'), Q(), marker()])), [true, false]);
  check('prior-lead opt-out, new lead: no evidence, no farewell', () =>
    R(lead([Q('09/11/2026 10:00 AM'), marker(), status('01/05/2025 2:01 PM', 'Opt-Out')], { hasNewLeadToday: true })), [false, false]);
  check('STOP, then an opt-in note: restored (no evidence), no exit', () =>
    R(lead([status('09/16/2026 11:00 AM', 'Opt-In'), cust('09/15/2026 3:00 PM', 'STOP'), Q(), marker()])), [false, false]);

  console.log(' 6. SMS is always drafted:');
  const all = ['please stop texting me', "don't text me, email is fine", 'leave me alone', 'take me off your list', 'STOP', 'not interested'].map(t => run(one(t)));
  check('isSmsOptOut and isSmsOptOutOnly are false on every shape (no opt-out framing, no blank)', () => all.every(o => !o.optOut && !o.optOutOnly), true);
  const ns = src.indexOf("if (lastScrapedData && lastScrapedData.smsOptOutEvidence) _ooMsgs.push(");
  const notice = (ev) => { const msgs = []; new Function('lastScrapedData', '_ooMsgs', src.slice(ns, src.indexOf('\n', ns)))({ smsOptOutEvidence: ev }, msgs); return msgs; };
  check('the agent notice is the evidence flag, nothing more', () => [notice(true).length, /SMS drafted — this lead has opt-out evidence on record/.test(notice(true)[0] || ''), notice(false).length], [1, true, 0]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
