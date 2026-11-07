#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('click-path-836.test.js');
// (v9.7.836) A LATER WEBSITE VISIT IS NEVER NAMED, AND "STILL ON THE LOT?" GETS A PLAIN YES. Honda Lafayette lead 2106212974 on
// v9.7.835 (log378): the click path worked -- the prompt named the new Accord Sedan search page and 61 in stock -- but the block also
// said the customer was back on 10/29 looking at the new CR-V and that it was "fine to cover both". The draft asked "Accord or a CR-V
// now?" and "If your search has shifted to the CR-V", a car he never mentioned to us: it tells him we watched his browsing. And with
// 61 in stock the text hedged "I'll check on a specific one before confirming availability". Gil: build 836 with the plainer
// in-stock answer too. Executes populateFromData and buildUserPrompt. Placeholder data only.
//
// Usage: node tests/click-path-836.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: click-path-836.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// (v9.7.838) The later session is browse-only here (no lead submitted); a later inquiry is named outright -- see click-path-838.
const SESSIONS = { ok: true, lead: '100000002', sessions: [
  { date: 'Tuesday, October 27, 2026', leads: ['100000002'], current: true, pages: [], vehicles: [{ kind: 'model', name: 'New Honda Accord Sedan', dwell: '3m 14s' }] },
  { date: 'Thursday, October 29, 2026', leads: [], current: false, pages: [], vehicles: [{ kind: 'model', name: 'New Honda CR-V', dwell: '2m 45s' }] }] };
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/27/2026 11:08 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const OURS = E('10/29/2026', '11:20 AM', 'AGENT', 'Email reply to prospect', 'Test, could you send me the model or a link to the listing? Agent Name');
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', condition: 'Pre-Owned',
  dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Lafayette - Contact Us', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true,
  hasCustomerReply: false, totalNoteCount: 14, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'still on the lot?',
  pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0, relationshipSignals: { unansweredQuestions: [] },
  history: OURS + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + OURS + MARK + '---' }, x || {});
const U = (v, c, s, cond) => ({ vehicle: v, color: c, stock: s, stockNum: s, condition: cond, type: cond === 'new' ? 'New' : 'Used' });
const INV = { units: [U('2026 Honda Accord SE', 'Crystal Black Pearl', 'TEST0A1', 'new'), U('2026 Honda Accord SE', 'Platinum White Pearl', 'TEST0A2', 'new'),
  U('2026 Honda CR-V EX', 'Meteorite Gray Metallic', 'TEST0C1', 'new')] };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  run('_lpValueFactCache')['24399'] = { inv: INV, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 };
  const built = (d) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); const ctx = run('leadContext');
      return String(sb.__lp.buildUserPrompt(Object.assign({}, d, { context: ctx }))); } catch (e) { return 'THREW ' + e.message; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const p = built(LEAD({ clickPath: SESSIONS }));
  const block = (p.split('\ud83d\udd0e WHAT THEY WERE LOOKING AT ON OUR WEBSITE WHEN THEY SENT THIS')[1] || '').split('\n\n')[0];

  console.log(' 1. the later visit is never named:');
  // (v9.7.837) The later visit may now be offered as OUR suggestion (see click-path-837); what v9.7.836 fixed still holds: the prompt
  // never says they looked at it and never says it is fine to cover both.
  check('lead 2106212974: the prompt never says they were back looking at the CR-V, and nothing says it is fine to cover both', () =>
    [/back on our site looking at/.test(p), /fine to cover both/.test(p)], [false, false]);
  check('the later visit is never presented as something they looked at: it is "our suggestion" or a general offer, with the browsing rule', () =>
    /^- THEY MAY BE OPEN TO (?:ANOTHER MODEL|OTHER OPTIONS)\..*NEVER say or imply they looked at it|^- THEY MAY BE OPEN TO OTHER OPTIONS\..*never say or imply their search moved/m.test(block), true);
  const p1 = built(LEAD({ clickPath: { ok: true, sessions: [SESSIONS.sessions[0]] } }));
  check('control: with no later visit there is no later-visit line', () => /THEY MAY BE OPEN TO/.test(p1), false);

  console.log(' 2. a plain yes when it is in stock:');
  check('2 new Accord Sedans in stock -> "The answer to their question is YES" with the wording, and no hedging about checking one car', () =>
    [/The answer to their question is YES: say it plainly \("yes, we have new Accord Sedans here right now"\)\./.test(block), /do not hedge about checking a specific one/.test(block),
     /a search page, not one car/.test(block)], [true, true, false]);
  const p0 = built(LEAD({ clickPath: SESSIONS, dealerId: '24399' }));
  run('_lpValueFactCache')['24399'] = { inv: { units: [U('2026 Honda Civic Sport', 'Rallye Red', 'TEST0V1', 'new')] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 };
  const pNone = built(LEAD({ clickPath: SESSIONS }));
  check('control: none in stock -> no yes; "do not say we have one"', () => [/answer to their question is YES/.test(pNone), /none in our current inventory feed -- do not say we have one/.test(pNone), p0.length > 0], [false, true, true]);
  check('a vehicle details page in stock gets the same plain yes', () => {
    run('_lpValueFactCache')['24399'] = { inv: { units: [U('2027 Honda HR-V Sport', 'Urban Gray Pearl', 'TEST001A', 'new')] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 };
    const l = run('_lpClickPathLines')(LEAD({ clickPath: { ok: true, sessions: [{ date: 'Today', current: true, leads: ['1'], vehicles: [{ kind: 'unit', name: 'New 2027 Honda HR-V', stock: 'TEST001A' }] }] } })).join('\n');
    return /in our current inventory \(2027 Honda HR-V Sport in Urban Gray Pearl\)\. The answer to their question is YES, it is here: say so plainly\./.test(l); }, true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
