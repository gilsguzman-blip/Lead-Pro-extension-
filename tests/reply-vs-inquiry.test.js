#!/usr/bin/env node
'use strict';
/**
 * reply-vs-inquiry.test.js — v9.7.592. A LEAD SUBMISSION IS NOT A REPLY, AND A CRM ROW IS NOT AN OUTREACH.
 *
 * Both defects are on Troy Noel, lead 2073356549, Community Honda Baytown, 8/27. Both are the
 * manufactured-directive shape: a layer counts the wrong thing, and the model faithfully obeys it.
 *
 * ── (1) THE LEAD FORM COUNTED AS A CUSTOMER REPLY ─────────────────────────────────────────
 * Troy has never sent us anything. His record contains zero inbound customer messages. The
 * delivered prompt nevertheless carried, in three different blocks:
 *
 *     line 234  NO CUSTOMER REPLY YET
 *     line 255  Customer last replied 2 day(s) ago.
 *     line 427  Last customer reply was 1.9 days ago; 7 outbound since then with no answer.
 *
 * and the log line for the same generation read hasCustomerReply:false.
 *
 * The source is one note: "Lead received | By: System | Lead received with no comments." The
 * tally's isMessage test matches /received/, so the form was counted as an inbound message and
 * its timestamp became lastInboundTs -> lastInboundAgeDays 1.9 -> "last replied 1.9 days ago".
 * Confirmed in the 8/27 log: exchange:1in/7out | sinceReply:1.9d.
 *
 * ── WHY THIS IS A SPLIT AND NOT AN EXCLUSION ──────────────────────────────────────────────
 * A lead form CAN carry real customer words — "interested in the Accord, call me" — and dropping
 * those outright would delete the only thing the customer ever said, which is the same class of
 * harm as the empty transcript v9.7.589 fixed. So: the form counts toward the EXCHANGE when it
 * carries comments, and NEVER sets the reply clock. Every consumer of lastInboundAgeDays words it
 * as "replied", and an inquiry is not a reply no matter what it contains.
 *
 * ── (2) SYSTEM ROWS COUNTED AS OUTREACHES ─────────────────────────────────────────────────
 * Two directives reported data.totalNoteCount — every CRM entry, Lead Logs and manager changes
 * and System rows included. Troy's 14 entries contain 7 real outreaches, so the prompt said
 * "you have already sent 14+ messages" and "customer has not replied to 14+ prior outreaches"
 * while the arc block in the SAME prompt read "1 inbound / 7 outbound".
 *
 * The gates move onto the real number too. A threshold crossed only because system rows were
 * counted fires a directive whose own text is then false — that is the defect, not a side effect.
 *
 * Driven against the SHIPPED counting loop, with Troy's notes rebuilt from the 8/27 DOM dump.
 * Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: reply-vs-inquiry.test.js <popup.js> [popup.js...]'); process.exit(2); }

// ── Troy's 14 notes, types/authors/bodies verbatim from the 8/27 dump ────────
// Newest-first, exactly as VinSolutions renders them.
const TROY_NOTES = [
  { d: 'Outbound phone call (No Contact)', dir: 'outbound', ts: '08/27/2026 2:52 PM', b: 'By: Kaylee Guzman hung up during screening' },
  { d: 'Lead Log',                         dir: '',         ts: '08/27/2026 12:17 PM', b: 'By: Kristen Willis Manager Changed From System to BJ Wilson' },
  { d: 'Email reply to prospect',          dir: 'outbound', ts: '08/27/2026 9:42 AM',  b: 'By: Yvonne Ortega Troy, did you know that Community Group proudly supports' },
  { d: 'Email reply to prospect',          dir: 'outbound', ts: '08/25/2026 7:22 PM',  b: 'By: Nyriel Benton Hi there Troy' },
  { d: 'Outbound Text Message',            dir: 'outbound', ts: '08/25/2026 7:22 PM',  b: 'Sent by: Nyriel Benton Hi there Troy' },
  { d: 'Outbound phone call (Machine)',    dir: 'outbound', ts: '08/25/2026 7:18 PM',  b: 'By: Nyriel Benton no answer.' },
  { d: 'Outbound phone call',              dir: 'outbound', ts: '08/25/2026 7:18 PM',  b: 'By: System callmeasurement review link' },
  { d: 'General Note',                     dir: '',         ts: '08/25/2026 6:57 PM',  b: 'By: Samantha  Lopez KAYLEE DUPE Troy Noel' },
  { d: 'Outbound phone call (No Contact)', dir: 'outbound', ts: '08/25/2026 6:57 PM',  b: 'By: Samantha  Lopez SC' },
  { d: 'Lead Log',                         dir: '',         ts: '08/25/2026 6:57 PM',  b: 'By: Samantha  Lopez BD Agent Changed' },
  { d: 'Lead Log',                         dir: '',         ts: '08/25/2026 6:57 PM',  b: 'By: Samantha  Lopez Sales Rep Changed' },
  { d: 'Lead Log',                         dir: '',         ts: '08/25/2026 6:54 PM',  b: 'By: System BD Agent Changed' },
  { d: 'Lead Log',                         dir: '',         ts: '08/25/2026 6:54 PM',  b: 'By: System Sales Rep Changed' },
  // THE NOTE THAT CAUSED IT. data-direction="Inbound", title matches /received/.
  { d: 'Lead received',                    dir: 'inbound',  ts: '08/25/2026 6:53 PM',  b: 'Lead received with no comments.' }
];

// Minimal DOM stand-in exposing exactly the three selectors the shipped loop reads.
function mkNotes(notes) {
  return notes.map(n => ({
    getAttribute: a => (a === 'data-direction' ? n.dir : ''),
    querySelector: sel => {
      if (sel.indexOf('legacy-notes-and-history-title') >= 0) return { innerText: n.d };
      if (sel.indexOf('notes-and-history-item-content') >= 0) return { innerText: n.b };
      if (sel.indexOf('notes-and-hsitory-item-date') >= 0)   return { innerText: n.ts };
      return null;
    }
  }));
}

// Lift the shipped tally out of the scraper and run it. The loop is not a standalone function,
// so the slice is taken between two stable landmarks and wrapped — the point is that the code
// EXECUTING here is the code that ships, not a paraphrase of it.
function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('      // Walk newest-first (VinSolutions DOM order is newest-first)');
  if (start < 0) throw new Error('tally loop start not found in ' + file);
  const endMark = '        // Friction: appointment history';
  const end = src.indexOf(endMark, start);
  if (end < 0) throw new Error('tally loop end not found in ' + file);
  // The slice stops mid-loop, so close the for-block we cut into.
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

const impls = BUILDS.map(extract);
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

// The scrape ran 08/27/2026 4:14 PM. That is what produced sinceReply:1.9d.
const NOW = new Date('08/27/2026 4:14 PM').getTime();

console.log('\nv9.7.592 — a lead submission is not a reply; a CRM row is not an outreach');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── (1) TROY ────────────────────────────────────────────────────────────────
console.log("Troy's 14 notes — he has never sent us anything:");

check('the lead form no longer counts as an inbound customer message',
  i => i.tally(TROY_NOTES, NOW).totalInboundCount, 0);

check('...so the reply clock is UNSET, not 1.9 days',
  i => i.tally(TROY_NOTES, NOW).lastInboundAgeDays, null);

check('the outbound tally is untouched — still the 7 the arc block reported',
  i => i.tally(TROY_NOTES, NOW).totalOutboundCount, 7);

check('consecutive-outbound-no-reply is untouched at 7',
  i => i.tally(TROY_NOTES, NOW).consecutiveOutboundNoReply, 7);

// The whole point: the three blocks that contradicted each other now agree.
check('all three prompt blocks now agree that he has not replied',
  i => {
    const s = i.tally(TROY_NOTES, NOW);
    return { noReplyYet: true, lastRepliedLineRenders: s.lastInboundAgeDays !== null, inbound: s.totalInboundCount };
  }, { noReplyYet: true, lastRepliedLineRenders: false, inbound: 0 });

// ── A LEAD FORM THAT CARRIES REAL CUSTOMER WORDS ────────────────────────────
console.log('\na form WITH comments is the only thing some customers ever say — it must survive:');

const WITH_COMMENTS = TROY_NOTES.slice(0, 13).concat([
  { d: 'Lead received', dir: 'inbound', ts: '08/25/2026 6:53 PM',
    b: 'Interested in the 2026 Accord Hybrid Sport-L. Please call me after 5, I work days.' }
]);

check('it DOES count toward the exchange',
  i => i.tally(WITH_COMMENTS, NOW).totalInboundCount, 1);

check('...but it still does NOT start the reply clock — an inquiry is not a reply',
  i => i.tally(WITH_COMMENTS, NOW).lastInboundAgeDays, null);

// ── A CUSTOMER WHO GENUINELY REPLIED ────────────────────────────────────────
console.log('\na real customer reply is completely unaffected:');

const REPLIED = [
  { d: 'Inbound Text Message', dir: 'inbound', ts: '08/27/2026 10:00 AM', b: 'Received from: (409) 250-0120 yes still interested' },
  { d: 'Outbound Text Message', dir: 'outbound', ts: '08/26/2026 9:00 AM', b: 'Sent by: Kaylee Guzman checking in' },
  { d: 'Lead received', dir: 'inbound', ts: '08/25/2026 6:53 PM', b: 'Lead received with no comments.' }
];

check('the inbound text is counted',
  i => i.tally(REPLIED, NOW).totalInboundCount, 1);

check('...and it DOES set the reply clock',
  i => i.tally(REPLIED, NOW).lastInboundAgeDays !== null, true);

check('...to the text\'s own timestamp, not the form\'s',
  i => i.tally(REPLIED, NOW).lastInboundAgeDays, 0.3);

check('consecutive-outbound stops at the real reply, as it always did',
  i => i.tally(REPLIED, NOW).consecutiveOutboundNoReply, 0);

check('a form with comments AND a later real reply keeps both',
  i => {
    const s = i.tally([REPLIED[0], REPLIED[1],
      { d: 'Lead received', dir: 'inbound', ts: '08/25/2026 6:53 PM', b: 'call me after 5' }], NOW);
    return { inbound: s.totalInboundCount, clockSet: s.lastInboundAgeDays !== null };
  }, { inbound: 2, clockSet: true });

// ── EMPTY-FORM WORDINGS ─────────────────────────────────────────────────────
console.log('\nthe empty-form body is recognised however VinSolutions cases it:');

for (const b of ['Lead received with no comments.', 'lead received with no comments',
                 '  Lead Received With No Comments. ', 'Lead received with no comments. Customer ID: 1443131191']) {
  check('  ' + JSON.stringify(b.slice(0, 34)),
    i => i.tally([{ d: 'Lead received', dir: 'inbound', ts: '08/25/2026 6:53 PM', b: b }], NOW).totalInboundCount, 0);
}

check('an EMPTY body is treated as no comments, not as customer speech',
  i => i.tally([{ d: 'Lead received', dir: 'inbound', ts: '08/25/2026 6:53 PM', b: '' }], NOW).totalInboundCount, 0);

// ── (2) THE OUTREACH COUNT ──────────────────────────────────────────────────
// Source-read with comments stripped, so a post-mortem comment quoting the old string cannot
// satisfy an assertion about the code.
console.log('\nthe directives count outreaches, not CRM rows:');

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

check('"you have already sent N+ messages" from the note count is gone',
  i => /already sent ' \+ _ncForDirectives/.test(stripComments(i.src)), false);

check('"not replied to N+ prior outreaches" from the note count is gone',
  i => /not replied to ' \+ _ncForDirectives/.test(stripComments(i.src)), false);

check('the real outbound tally is read off relationshipSignals',
  i => /_rsOutN = data\.relationshipSignals && data\.relationshipSignals\.totalOutboundCount/.test(stripComments(i.src)), true);

check('the note count survives only as a fallback when the tally is absent',
  i => /_outreachN = \(typeof _rsOutN === 'number' && _rsOutN > 0\) \? _rsOutN : _ncForDirectives/.test(stripComments(i.src)), true);

check('BOTH gates moved onto the real number, not just the wording',
  i => [/if \(_outreachN >= 5\)/.test(stripComments(i.src)),
        /if \(!_hasReplyForDirectives && _outreachN >= 8\)/.test(stripComments(i.src))], [true, true]);

check('no gate still reads the note count',
  i => /if \([^)]*_ncForDirectives >= \d/.test(stripComments(i.src)), false);

check('[LP OUTREACH COUNT DIAG] reports the number, its source, and both gates',
  i => /\[LP OUTREACH COUNT DIAG\][\s\S]{0,320}oneSided/.test(stripComments(i.src)), true);

// What Troy's numbers do to the two gates, stated explicitly — this is a behaviour change and
// it should be visible in the suite rather than discovered in production.
console.log('\nwhat that does on Troy specifically (7 real outreaches, 14 CRM rows):');

const gate = (n) => ({ varyAngle: n >= 5, oneSided: n >= 8 });
check('  on the OLD number (14): both fired',  () => gate(14), { varyAngle: true, oneSided: true });
check('  on the REAL number (7): vary-angle still fires', () => gate(7).varyAngle, true);
check('  on the REAL number (7): one-sided no longer fires — he was told "14+" for 7',
  () => gate(7).oneSided, false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
