#!/usr/bin/env node
'use strict';
// (v9.7.647) PIN THE ZONE BEFORE ANY Date EXISTS. The shipped code calls setHours(0,0,0,0), which
// resolves midnight in the LOCAL zone — correct in production, where every rooftop and every agent
// is US Central. This suite therefore only means anything in Central: run under UTC and the
// overnight boundary moves, and 6:47 PM Sunday Central becomes 11:47 PM Sunday UTC, which lands on
// a different side of some of the pairs below. Found the honest way — the assertions passed on a
// hand-set TZ and failed under run-all.sh, which runs UTC. Set here rather than in the runner so
// the suite cannot silently mean something different depending on who invokes it.
process.env.TZ = 'America/Chicago';

// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('msg-age-label.test.js');

/**
 * msg-age-label.test.js — v9.7.647. A CALENDAR CLAIM WAS COMPUTED FROM ELAPSED HOURS.
 *
 * Stacey Ceasar (Audi Lafayette, 9/7, 2018 Audi A4 Premium Plus). At 6:47 PM on SUNDAY 9/6 she
 * texted: "Ok. I have an event to go to can I call or text about that tomorrow if yall or open?
 * Or Tuesday". Grabbed at 9:52 AM MONDAY 9/7, the prompt told the model:
 *
 *     MOST RECENT CUSTOMER MESSAGES ... [sent TODAY]
 *
 * Fifteen hours had elapsed, so Math.floor(15/24) was 0 and the label said TODAY. From a Monday
 * frame her "tomorrow" reads as Tuesday, and the draft came back "Audi Lafayette is open Tuesday,
 * September 8 ... you can text me tomorrow or Tuesday" — the same day named twice, while the day
 * she actually asked about (Monday, TODAY, and the store was open 9-7) went unanswered.
 *
 * THE LABEL LOGIC WAS NEVER WRONG. msDiff===1 already emits 'any "tomorrow" in this message means
 * TODAY', which is exactly what this lead needed. Only the arithmetic feeding it was wrong, and it
 * is wrong precisely in the OVERNIGHT WINDOW — an evening inbound worked the next morning, which is
 * the core BDC pattern rather than an edge case. That is what this suite pins: not one fixture, but
 * every hour of an overnight pair.
 *
 * Executes the SHIPPED computation with Date controlled. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: msg-age-label.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('msg-age-label.test.js', m);

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  // Anchor on the CODE lines — several build headers quote these markers as prose.
  const a = src.indexOf('\n                var _mdSent = new Date(msMs);');
  if (a < 0) bail('the calendar-day computation is not in ' + file + ' — THE SUITE DID NOT LOAD');
  const tail = src.indexOf("else msgAgeLabel = ' [sent '", a);
  if (tail < 0) bail('the label ladder was not found in ' + file);
  const end = src.indexOf('\n', src.indexOf(';', src.indexOf("days ago]';", tail)));
  const region = src.slice(a, end);
  if (!/msDiff === 1/.test(region)) bail('the YESTERDAY branch is not in the lifted region of ' + file);

  // The computation must stay INSIDE inlineScraper, which is serialised into VinSolutions frames.
  // A popup-scope helper here throws ReferenceError and aborts the entire scrape (v9.7.450).
  const s = src.indexOf('\n  function inlineScraper() {');
  const e = src.indexOf('\n  } // end inlineScraper');
  if (!(s >= 0 && e > s && src.indexOf('var _mdSent') > s && src.indexOf('var _mdSent') < e)) {
    bail('the computation is not inside inlineScraper in ' + file);
  }
  return { src, region };
}

// Runs the SHIPPED lines with "now" pinned. Returns the label the prompt would carry.
function labelFor(region, nowIso, sentIso) {
  const Real = Date;
  const sb = { console: { log() {} }, Math, String };
  sb.Date = class extends Real {
    constructor(...a) { if (a.length === 0) super(nowIso); else super(...a); }
    static now() { return new Real(nowIso).getTime(); }
  };
  vm.createContext(sb);
  vm.runInContext(
    'var msgAgeLabel = "", msMs = ' + new Real(sentIso).getTime() + ';\n' + region + '\n;globalThis.__l = msgAgeLabel;',
    sb, { filename: 'msg-age' });
  return String(sb.__l || '');
}

const YESTERDAY = ' [sent YESTERDAY -- any "tomorrow" in this message means TODAY]';
const TODAY = ' [sent TODAY]';

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — the label counts calendar days');

  // ── THE INCIDENT, TO THE MINUTE ────────────────────────────────────────────
  console.log('\nStacey Ceasar — sent Sunday 6:47 PM, grabbed Monday 9:52 AM:');
  check('the label is YESTERDAY, not TODAY',
    labelFor(B.region, '2026-09-07T09:52:00-05:00', '2026-09-06T18:47:00-05:00'), YESTERDAY);
  check('  ...so the model is told her "tomorrow" means TODAY',
    /any "tomorrow" in this message means TODAY/.test(
      labelFor(B.region, '2026-09-07T09:52:00-05:00', '2026-09-06T18:47:00-05:00')), true);

  // ── THE WHOLE OVERNIGHT WINDOW, NOT ONE FIXTURE ────────────────────────────
  // The defect is a boundary, so a single timestamp proves little. Every evening hour paired with
  // every next-morning hour must read YESTERDAY — that is the entire pattern this label serves.
  console.log('\nevery evening-to-next-morning pair reads YESTERDAY:');
  const wrong = [];
  for (let sentH = 12; sentH <= 23; sentH++) {
    for (let nowH = 0; nowH <= 11; nowH++) {
      const sent = '2026-09-06T' + String(sentH).padStart(2, '0') + ':30:00-05:00';
      const now = '2026-09-07T' + String(nowH).padStart(2, '0') + ':30:00-05:00';
      if (labelFor(B.region, now, sent) !== YESTERDAY) wrong.push(sentH + '->' + nowH);
    }
  }
  check('  144 overnight pairs, none mislabelled', wrong, []);

  // ── THE HALF THAT WAS ALWAYS RIGHT ─────────────────────────────────────────
  console.log('\nsame-day messages still read TODAY:');
  check('  sent this morning, read this afternoon',
    labelFor(B.region, '2026-09-07T16:00:00-05:00', '2026-09-07T08:00:00-05:00'), TODAY);
  check('  sent one minute ago',
    labelFor(B.region, '2026-09-07T09:52:00-05:00', '2026-09-07T09:51:00-05:00'), TODAY);
  check('  sent just after midnight, read the same morning',
    labelFor(B.region, '2026-09-07T09:00:00-05:00', '2026-09-07T00:05:00-05:00'), TODAY);

  console.log('\nolder messages still age correctly, and say how far their "tomorrow" has slipped:');
  check('  two calendar days back',
    labelFor(B.region, '2026-09-07T09:00:00-05:00', '2026-09-05T18:00:00-05:00'),
    ' [sent 2 days ago -- any "tomorrow" in this message is now 1 days ago]');
  check('  a week back',
    labelFor(B.region, '2026-09-07T09:00:00-05:00', '2026-08-31T09:00:00-05:00'),
    ' [sent 7 days ago -- any "tomorrow" in this message is now 6 days ago]');

  // ── WHAT THE OLD ARITHMETIC GOT RIGHT BY ACCIDENT MUST STILL BE RIGHT ──────
  // A message sent more than 24h ago AND on the previous calendar day agreed under both
  // computations. It must not have moved.
  console.log('\nthe cases both computations agreed on have not moved:');
  check('  sent 9 AM yesterday, read 6 PM today (33h — yesterday either way)',
    labelFor(B.region, '2026-09-07T18:00:00-05:00', '2026-09-06T09:00:00-05:00'), YESTERDAY);

  // ── DST, BECAUSE Math.round IS THERE FOR A REASON ──────────────────────────
  // US Central springs forward 3/8/2026. A 23-hour calendar day must still read as one day, and a
  // 25-hour one in November likewise — floor() on the raw difference would call one of them 0.
  console.log('\na short and a long calendar day both still count as one day:');
  check('  spring forward (23-hour day)',
    labelFor(B.region, '2026-03-08T10:00:00-05:00', '2026-03-07T10:00:00-06:00'), YESTERDAY);
  check('  fall back (25-hour day)',
    labelFor(B.region, '2026-11-01T10:00:00-06:00', '2026-10-31T10:00:00-05:00'), YESTERDAY);
}

if (BUILDS.length > 1) {
  console.log('\ndev === comm:');
  const regions = BUILDS.map(f => load(f).region);
  check('  the computation is byte-identical in both builds',
    regions.every(r => r === regions[0]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
