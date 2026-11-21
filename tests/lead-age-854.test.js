#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('lead-age-854.test.js');
// (v9.7.854) AUDIT M-1, OWNER RULING 11/3. An unread lead age is UNKNOWN, not "submitted today". The scraper carries null when
// neither the Created cell nor PageData's LeadCreatedUTC was read; the panel payload and the feedback row carry null; local
// arithmetic uses NaN so no comparison treats unknown as fresh (`null <= 1` is true in JS). The five copies of "derive the age
// from text" become one, _lpLeadAgeFallback: the Created (Nd) cell first, else the oldest dated note ABOVE the current-lead
// marker (this lead's own first note), else null. A returning customer with a two-year-old prior lead and a three-day-old
// current lead is 3, not ~730. Executes _lpLeadAgeFallback, _lpAgeNum, populateFromData, the panel payload, buildUserPrompt,
// classifyScenario (through the prompt's console), _lpComputeCadenceTouch and _lpStalledCalendarRung. Placeholder data only.
//
// Usage: node tests/lead-age-854.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: lead-age-854.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const NOW = '2026-11-03T12:00:00-06:00';
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
// Returning customer: this lead came in 10/31 (3 days before 11/03); the prior lead is from 2024.
const RETURNING = E('11/02/2026 10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, the CR-V is here.')
  + E('10/31/2026 4:00 PM', 'AGENT', 'Outbound Text Message', 'Test, thanks for reaching out.')
  + MARK('10/31/2026 3:30 PM')
  + E('11/05/2024 2:00 PM', 'CUSTOMER', 'Inbound Text Message', 'Thanks, we bought a car.')
  + E('11/01/2024 9:00 AM', 'AGENT', 'Outbound Text Message', 'Test, following up on the Accord.');
const NO_MARK = E('11/02/2026 10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, the CR-V is here.') + E('11/01/2024 9:00 AM', 'AGENT', 'Outbound Text Message', 'Old note.');
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX',
  condition: 'New', stockNum: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Dealers WebSite', convState: 'active-follow-up',
  hasOutbound: true, hasCustomerReply: false, totalNoteCount: 9, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [] }, history: NO_MARK, conversationBrief: NO_MARK }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const at = (fn) => { const restore = run('(function(){ var RD = Date; var FIX = new RD("' + NOW + '").getTime();'
      + ' function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); }'
      + ' FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; var prev = Date; Date = FD; return function(){ Date = prev; }; })()');
    try { return fn(); } finally { if (restore) restore(); } };
  const nowMs = new Date(NOW).getTime();
  const FB = (d) => { const fb = run('typeof _lpLeadAgeFallback === "function" ? _lpLeadAgeFallback : null'); return fb ? fb(d, nowMs).days : 'no helper'; };

  console.log(' 1. the one fallback:');
  check('a returning customer: two-year-old prior lead, current lead from 10/31 -> 3 days, not ~730', () => FB({ history: RETURNING }), 3);
  check('the Created (Nd) cell comes first', () => FB({ context: 'Created: 10/30/2026 (4d)', history: RETURNING }), 4);
  check('no Created cell and no current-lead marker -> unknown (null)', () => FB({ history: NO_MARK }), null);
  check('control: the old rule ("oldest dated line anywhere") would have said ~732', () => Math.floor((nowMs - new Date('11/01/2024').getTime()) / 86400000) > 700, true);

  console.log(' 2. unknown stays unknown, end to end:');
  const built = (lsd) => at(() => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      const p = panelPayload(src, sb, { lsd: lsd, context: run('leadContext') });
      return { lsdAge: lsd.leadAgeDays, payAge: p.leadAgeDays, prompt: String(sb.__lp.buildUserPrompt(p)), logs: logs.join('\n') }; } finally { sb.console.log = ol; sb.console.warn = ow; } });
  const u = built(LSD({ leadAgeDays: null }));
  check('populateFromData leaves it null and says why; the payload carries null', () =>
    [u.lsdAge, u.payAge, /\[LP AGE DIAG\] leadAgeDays at populate: UNKNOWN \(null\) — not read off the page; no Created \(Nd\) and no current-lead marker/.test(u.logs)], [null, null, true]);
  check('the prompt says nothing about when it was submitted (no "LEAD AGE:", no "submitted today")', () => [/LEAD AGE:/.test(u.prompt), /submitted today/.test(u.prompt)], [false, false]);
  const g = built(LSD({ leadAgeDays: null, hasOutbound: false, totalNoteCount: 9, history: '', conversationBrief: '' }));
  check('the fresh-lead guards do not fire on an unknown age (no outreach, 9 historical notes: they did, reading unknown as 0)', () =>
    [/Fresh-lead guard ACTIVE/.test(g.logs), /TOUCH POSITION: fresh-lead guard active/.test(g.logs)], [false, false]);
  check('the touch position says the age is not available', () => /lead age not available -- go by the dated messages below/.test(u.prompt), true);
  const r = built(LSD({ leadAgeDays: null, history: RETURNING, conversationBrief: RETURNING }));
  check('a returning customer with no Created read: derived as 3 from this lead\'s first note, and the prompt says 3 days', () =>
    [r.lsdAge, /LEAD AGE: submitted 3 days ago/.test(r.prompt)], [3, true]);
  const z = built(LSD({ leadAgeDays: 0, hasOutbound: false, totalNoteCount: 2, convState: 'first-touch' }));
  check('a READ 0 is still today ("submitted today") and is not re-derived (853 re-derived it from the oldest line: ~732 days)', () => [z.lsdAge, /LEAD AGE: submitted today/.test(z.prompt)], [0, true]);
  const k = built(LSD({ leadAgeDays: 12 }));
  check('control: a read 12 is 12', () => /LEAD AGE: submitted 12 days ago/.test(k.prompt), true);

  console.log(' 3. the readers that were already safe stay safe:');
  check('_lpComputeCadenceTouch(null) -> lead age unknown', () => (run('_lpComputeCadenceTouch')(null, null) || {}).reason, 'lead age unknown — no touch');
  check('_lpStalledCalendarRung(null) -> rung 1', () => run('_lpStalledCalendarRung')(null), 1);
  check('_lpAgeNum: null / undefined / "" / "abc" -> null; 0 -> 0', () => { const a = run('typeof _lpAgeNum === "function" ? _lpAgeNum : null'); return a ? [a(null), a(undefined), a(''), a('abc'), a(0), a('3')] : 'no helper'; }, [null, null, null, null, 0, 3]);

  console.log(' 4. where unknown starts, and the frame merge:');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('the scraper returns null when it did not read the age', () => /leadAgeDays:\(_leadAgeScraped \? leadAgeDays : null\)/.test(code), true);
  check('both merge passes take a read age (0 included) over an unknown one', () =>
    (code.match(/k === 'leadAgeDays'\) \{[^\n]*\n\s*if \(typeof d\[k\] === 'number' && isFinite\(d\[k\]\) && typeof m\[k\] !== 'number'\) m\[k\] = d\[k\];/g) || []).length, 2);
  check('one fallback: no reader derives the age from the oldest dated line anywhere any more', () => /dateMatches\.length - 1\]|_ladD0\.length - 1\]|_incDateMatches\.length - 1\]|_dateMatches\.length - 1\]/.test(code), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
