#!/usr/bin/env node
'use strict';
/**
 * reply-vs-inquiry.test.js — v9.7.593. A CRM BOOKKEEPING ROW IS NOT A CUSTOMER MESSAGE.
 *
 * Troy Noel, lead 2073356549, Community Honda Baytown, 8/27.
 *
 * ── WHAT THE PROMPT SAID ──────────────────────────────────────────────────────────────────
 * Troy has never sent us anything. Three blocks of one delivered prompt disagreed about that:
 *
 *     line 234  NO CUSTOMER REPLY YET
 *     line 255  Customer last replied 2 day(s) ago.
 *     line 427  Last customer reply was 1.9 days ago; 7 outbound since then with no answer.
 *
 * and the log for that generation read hasCustomerReply:false.
 *
 * ── THE v9.7.592 FIX WAS A DEAD GUARD, AND I ADDED IT ─────────────────────────────────────
 * v9.7.592 blamed the "Lead received" note and excluded it. That note carries NO data-direction
 * and its title fails the /^(inbound|received)/ test, so it never reached the inbound branch in
 * the first place. Running the SHIPPED tally against the 8/27 dump gives byte-identical output on
 * v9.7.591 and v9.7.592 — the fix changed nothing, and this suite is the check that would have
 * caught it before it shipped.
 *
 * The row that actually produces the 1 inbound and the 1.9-day clock is note 12: a LEAD LOG audit
 * entry, "By: System | Sales Rep Changed From System to Samantha Lopez", dated 08/25 6:54 PM,
 * which VinSolutions stamps data-direction="Inbound". A bookkeeping row recording that the CRM
 * reassigned the lead is not a customer message in any direction.
 *
 * This is the fourth guard this week found waiting for a shape production does not produce, after
 * the on-premise check, the value-fact resolver and the tapback anchor. It is the first I wrote.
 *
 * ── THE FIXTURE ───────────────────────────────────────────────────────────────────────────
 * tests/fixtures/troy-2073356549-notes.json is extracted from the real 8/27 DOM dump: every note's
 * data-direction, type, body and date as the shipped selectors return them. It reproduces the
 * shipped log exactly on v9.7.591 — exchange 1 inbound, sinceReply 1.9d — which is what makes it
 * evidence rather than a restatement of my own assumptions.
 *
 * The titles in the fixture carry trailing body text (the dump's markup does not close the element
 * where innerText would). That makes the fixture HARSHER than production, not softer: the guards
 * are prefix-anchored, so passing here means passing on the clean titles the live DOM yields.
 *
 * Driven against the SHIPPED tally loop. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: reply-vs-inquiry.test.js <popup.js> [popup.js...]'); process.exit(2); }

const TROY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'troy-2073356549-notes.json'), 'utf8'));

// Minimal DOM stand-in exposing exactly the selectors the shipped loop reads.
function mkNotes(notes) {
  return notes.map(n => ({
    getAttribute: a => (a === 'data-direction' ? n.dir : ''),
    querySelector: sel => {
      if (sel.indexOf('legacy-notes-and-history-title') >= 0) return { innerText: n.title };
      if (sel.indexOf('notes-and-history-item-content') >= 0) return { innerText: n.body };
      if (sel.indexOf('notes-and-hsitory-item-date') >= 0)   return { innerText: n.date };
      return null;
    }
  }));
}

// Lift the shipped tally out of the scraper and RUN it. The loop is not a standalone function, so
// the slice is taken between two stable landmarks and the cut-into for-block is closed.
function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('      // Walk newest-first (VinSolutions DOM order is newest-first)');
  if (start < 0) throw new Error('tally loop start not found in ' + file);
  const end = src.indexOf('        // Friction: appointment history', start);
  if (end < 0) throw new Error('tally loop end not found in ' + file);
  const body = src.slice(start, end) + '\n      }\n';

  const sb = { String, RegExp, Date, Math, parseInt, parseFloat };
  vm.createContext(sb);
  vm.runInContext(
    'function _tally(noteEls, nowMs) {\n' +
    '  var sig = { totalInboundCount: 0, totalOutboundCount: 0, consecutiveOutboundNoReply: 0, lastInboundAgeDays: null };\n' +
    '  function parseNoteDate(s){ var t = new Date(s).getTime(); return t > 0 ? t : null; }\n' +
    body +
    '  if (lastInboundTs) sig.lastInboundAgeDays = Math.round((nowMs - lastInboundTs) / 86400000 * 10) / 10;\n' +
    '  return sig;\n' +
    '}', sb);

  return {
    name: path.basename(path.dirname(file)),
    src,
    tally: (notes, nowMs) => vm.runInContext('_tally', sb)(mkNotes(notes), nowMs)
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

// The scrape ran 08/27/2026 4:14 PM. That is what produced sinceReply:1.9d in the shipped log.
const NOW = new Date('08/27/2026 4:14 PM').getTime();
const clone = () => JSON.parse(JSON.stringify(TROY));

console.log('\nv9.7.593 — a CRM bookkeeping row is not a customer message');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE FIXTURE IS FAITHFUL ─────────────────────────────────────────────────
// Asserted first: if these drift, every result below is measuring the wrong thing.
console.log('the fixture is the real 8/27 record, not a paraphrase:');

check('14 notes, as the log reported',
  i => TROY.length, 14);

check('exactly ONE note is stamped Inbound — and it is a Lead Log audit row',
  i => TROY.filter(n => n.dir === 'Inbound').map(n => n.title.replace(/\s+/g, ' ').trim()), ['Lead Log']);

check('...whose body is the CRM reassigning the lead, not a customer speaking',
  i => /Sales Rep Changed From/.test(TROY.filter(n => n.dir === 'Inbound')[0].body), true);

check('the "Lead received" note carries NO direction — v9.7.592 excluded a note that never counted',
  i => TROY.filter(n => /^Lead received/.test(n.title)).map(n => n.dir), ['']);

// ── TROY ────────────────────────────────────────────────────────────────────
console.log('\nTroy has never sent us anything:');

check('the audit row no longer counts as an inbound customer message',
  i => i.tally(TROY, NOW).totalInboundCount, 0);

check('...so the reply clock is UNSET, not the 1.9 days the log showed',
  i => i.tally(TROY, NOW).lastInboundAgeDays, null);

check('the outbound tally is untouched',
  i => i.tally(TROY, NOW).totalOutboundCount, 9);

check('consecutive-outbound-no-reply is untouched',
  i => i.tally(TROY, NOW).consecutiveOutboundNoReply, 9);

check('both halves agree, so the arc block can say "never replied" truthfully',
  i => {
    const s = i.tally(TROY, NOW);
    return { inbound: s.totalInboundCount, clock: s.lastInboundAgeDays };
  }, { inbound: 0, clock: null });

// ── EVERY AUDIT ROW, NOT JUST THE ONE THAT BIT ──────────────────────────────
console.log('\nany Lead Log stamped Inbound is excluded, not just note 12:');

check('all five Lead Log rows marked Inbound still yield zero inbound',
  i => {
    const n = clone(); n.forEach(x => { if (/^Lead Log/.test(x.title)) x.dir = 'Inbound'; });
    return i.tally(n, NOW).totalInboundCount;
  }, 0);

check('...and none of them starts the reply clock',
  i => {
    const n = clone(); n.forEach(x => { if (/^Lead Log/.test(x.title)) x.dir = 'Inbound'; });
    return i.tally(n, NOW).lastInboundAgeDays;
  }, null);

// ── THE LEAD FORM ───────────────────────────────────────────────────────────
console.log('\nthe lead form, if it ever IS stamped inbound:');

check('an empty form counts as nothing',
  i => {
    const n = clone(); n[13].dir = 'Inbound';
    return i.tally(n, NOW).totalInboundCount;
  }, 0);

check('a form WITH real customer words counts toward the exchange',
  i => {
    const n = clone(); n[13].dir = 'Inbound';
    n[13].body = 'Interested in the 2026 Accord Hybrid Sport-L. Please call me after 5, I work days.';
    return i.tally(n, NOW).totalInboundCount;
  }, 1);

check('...but still does not start the reply clock — an inquiry is not a reply',
  i => {
    const n = clone(); n[13].dir = 'Inbound';
    n[13].body = 'Interested in the Accord. Call me after 5.';
    return i.tally(n, NOW).lastInboundAgeDays;
  }, null);

// ── A REAL CUSTOMER REPLY IS UNAFFECTED ─────────────────────────────────────
// The whole risk of this change is over-suppression: silencing a customer who did speak.
console.log('\na genuine customer reply still counts and still sets the clock:');

const withReply = () => [{ dir: 'Inbound', title: 'Inbound Text Message',
  body: 'Received from: (409) 250-0120 yes still interested', date: '08/27/2026 10:00 AM' }].concat(clone());

check('the inbound text is counted',
  i => i.tally(withReply(), NOW).totalInboundCount, 1);

check('...and it DOES set the reply clock',
  i => i.tally(withReply(), NOW).lastInboundAgeDays, 0.3);

check('consecutive-outbound stops at the real reply',
  i => i.tally(withReply(), NOW).consecutiveOutboundNoReply, 0);

check('an inbound EMAIL is counted too — this is not text-only',
  i => i.tally([{ dir: 'Inbound', title: 'Email reply from prospect',
      body: 'Received from: troy01bc@gmail.com sounds good', date: '08/27/2026 10:00 AM' }].concat(clone()), NOW)
      .totalInboundCount, 1);

check('an inbound PHONE CALL is counted too',
  i => i.tally([{ dir: 'Inbound', title: 'Inbound phone call',
      body: 'By: Kaylee Guzman customer called back', date: '08/27/2026 10:00 AM' }].concat(clone()), NOW)
      .totalInboundCount, 1);

check('a real reply BELOW an audit row is still found — the row does not shadow it',
  i => {
    const n = clone();
    n.splice(13, 0, { dir: 'Inbound', title: 'Inbound Text Message',
      body: 'Received from: (409) 250-0120 still looking', date: '08/25/2026 6:55 PM' });
    const s = i.tally(n, NOW);
    return { inbound: s.totalInboundCount, clockSet: s.lastInboundAgeDays !== null };
  }, { inbound: 1, clockSet: true });

// ── THE DIRECTIVE COUNTS ────────────────────────────────────────────────────
console.log('\nthe directives count outreaches, not CRM rows:');

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

check('the real outbound tally is read off relationshipSignals',
  i => /_rsOutN = data\.relationshipSignals && data\.relationshipSignals\.totalOutboundCount/.test(stripComments(i.src)), true);

check('BOTH gates moved onto the real number',
  i => [/if \(_outreachN >= 5\)/.test(stripComments(i.src)),
        /if \(!_hasReplyForDirectives && _outreachN >= 8\)/.test(stripComments(i.src))], [true, true]);

check('no gate still reads the note count',
  i => /if \([^)]*_ncForDirectives >= \d/.test(stripComments(i.src)), false);

check('the SITUATION line stopped using the double-counted sbTotal',
  i => /out of ' \+ sbTotal \+ ' outreach/.test(stripComments(i.src)), false);

check('...and reads the real outbound tally instead',
  i => /sbAttempts = \(typeof _coOutN === 'number' && _coOutN > 0\) \? _coOutN : sbTotal/.test(stripComments(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
