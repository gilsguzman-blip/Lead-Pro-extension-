#!/usr/bin/env node
'use strict';
// (v9.7.625) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('stalled-recent-reply.test.js');

/**
 * stalled-recent-reply.test.js — v9.7.625. A CUSTOMER WHO JUST REPLIED HAS NOT GONE QUIET.
 *
 * The rule's own comment, shipping directly above it, reads:
 *
 *     "Stalled = outbound sent, no customer reply, lead aging"
 *
 * It never tested for a reply. The only proxy was !isLiveConversation, which looks at the newest
 * three notes inside a very recent window — so a customer who wrote hours ago, but outside that
 * window, still resolved to STALLED.
 *
 * LIVE: Sydnie Moon (Audi Lafayette, lead 2075798859, 9/4 4:55 PM). She replied at 2:54 PM — 0.1
 * days — mid-negotiation on payment, payoff and an appraisal in flight. Her prompt opened:
 *
 *     "⚠ STALLED LEAD: This lead has been open for 5 days.
 *      - Customer engaged earlier, then went quiet."
 *
 * and carried the 🔴 STALLED block plus "Active flags for this lead: Trade-In, Stalled".
 *
 * IT WAS MASKED, NOT NEW. On the prior build her convState read 'negative-reply', which took a
 * different branch. v9.7.624 corrected that read, and this misfire — older than either build —
 * became visible. Recorded that way rather than as a regression, because the rule was always
 * wrong and the fix that exposed it was right.
 *
 * THE THRESHOLD comes from the STALLED directive's own definition of itself: "repeated outreach
 * with no reply, or 5+ days of silence". 3 days is deliberately TIGHTER than that 5, so this
 * narrows a false fire without widening what counts as stalled.
 *
 * FAILS OPEN: an unknown or absent reply date leaves the rule exactly as it shipped, so a lead
 * that has genuinely never replied is untouched — which is the population the flag exists for.
 *
 * Executes the SHIPPED expression, lifted from each build. Both must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stalled-recent-reply.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const START = '  const hasMultipleAttempts = (d.totalNoteCount || 0) >= 4;';
  const END = "      + ' own definition always required)');\n  }";
  const a = src.indexOf(START);
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) {
    require('./lib/fatal-guard.js').bail('stalled-recent-reply.test.js', 'stalled expression not found in ' + file);
  }
  const code = src.slice(a, b + END.length);
  if (!/const isStalled = /.test(code)) {
    require('./lib/fatal-guard.js').bail('stalled-recent-reply.test.js', 'slice missed isStalled in ' + file);
  }
  return { src, code };
}

for (const file of BUILDS) {
  const B = load(file);
  const run = (d, isFollowUp) => {
    const logs = [];
    const sb = { d, isFollowUp: !!isFollowUp, console: { log: (...x) => logs.push(x.join(' ')) } };
    vm.createContext(sb);
    vm.runInContext(B.code, sb);
    return { stalled: vm.runInContext('isStalled', sb), logs: logs.join(' | ') };
  };
  // Sydnie's real shape: 37 notes, 5 days old, worked hard, replied 2.4 hours ago.
  const lead = (repliedDaysAgo, over) => Object.assign({
    totalNoteCount: 37, leadAgeDays: 5, isLiveConversation: false,
    hasApptSet: false, isShowroomFollowUp: false,
    relationshipSignals: (repliedDaysAgo === null ? {} : { lastInboundAgeDays: repliedDaysAgo })
  }, over || {});

  console.log('\n' + path.relative(process.cwd(), file) + ' — a recent reply is not silence');

  console.log('\nSydnie, 9/4 — replied 2.4 hours before the grab:');
  const syd = run(lead(0.1), true);
  check('the lead is NOT stalled', syd.stalled, false);
  check('...and it says why', /replied 0\.1d ago — not stalled/.test(syd.logs), true);
  check('...naming the framing that no longer ships', /gone quiet/.test(syd.logs), true);

  console.log('\nthe boundary, both sides of it:');
  check('replied 2.9d ago — not stalled', run(lead(2.9), true).stalled, false);
  check('replied exactly 3d ago — stalled', run(lead(3), true).stalled, true);
  check('replied 3.1d ago — stalled',      run(lead(3.1), true).stalled, true);

  console.log('\nthe population the flag exists for is untouched:');
  check('replied 40d ago, worked since — still stalled', run(lead(40), true).stalled, true);
  check('NEVER replied (no date at all) — still stalled', run(lead(null), true).stalled, true);
  check('...and that case logs nothing, because nothing was suppressed',
    /STALLED SUPPRESSED/.test(run(lead(null), true).logs), false);
  check('a non-numeric reply age fails open', run(lead('recently'), true).stalled, true);

  console.log('\nevery other stalled condition still governs:');
  check('an appointment on the books is never stalled',
    run(lead(40, { hasApptSet: true }), true).stalled, false);
  check('a showroom follow-up is never stalled',
    run(lead(40, { isShowroomFollowUp: true }), true).stalled, false);
  check('a live conversation is never stalled',
    run(lead(40, { isLiveConversation: true }), true).stalled, false);
  check('a lead under 2 days old is never stalled',
    run(lead(40, { leadAgeDays: 1 }), true).stalled, false);
  check('never worked and no notes — not stalled',
    run(lead(40, { totalNoteCount: 0 }), false).stalled, false);
  check('never worked but 4+ notes — still stalled',
    run(lead(40, { totalNoteCount: 4 }), false).stalled, true);

  // The rule now tests the thing its own comment always claimed it did.
  console.log('\nthe rule reads a reply date at all, which is the whole fix:');
  check('isStalled consults the reply age', /!_stRecentReply/.test(B.src), true);
  check('...sourced from relationshipSignals', /_stSig\.lastInboundAgeDays/.test(B.src), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds ship the same rule:');
  check('dev and commercial are identical', load(BUILDS[0]).code === load(BUILDS[1]).code, true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
