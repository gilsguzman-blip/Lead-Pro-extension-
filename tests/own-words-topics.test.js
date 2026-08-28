#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('own-words-topics.test.js');

/**
 * own-words-topics.test.js — v9.7.594. WE WERE QUOTING OUR OWN EMAILS BACK AS THE CUSTOMER'S TOPICS.
 *
 * Troy Noel, lead 2073356549, Community Honda Baytown, 8/27, on v9.7.593.
 *
 * ── WHAT THE PROMPT SAID ──────────────────────────────────────────────────────────────────
 *   RECURRING TOPICS IN THIS RELATIONSHIP:
 *     - Other vehicles or dealerships has come up 3 time(s):
 *         "Subject: Did you know Community Honda" (08/27/2026 9:42 AM)
 *         "Hi there Troy, It's Nyriel from Community Honda" (08/25/2026 7:22 PM)
 *     - Vehicle configuration has come up 2 time(s):
 *         "I notice your interest in the 2026 Honda Accord Hybrid"
 *
 *   INTERPRETATION FOR THIS RESPONSE:
 *     - "competitor" has been a recurring thread (3 mentions). If this topic has not been
 *       resolved, it may be the silent reason for any stall. Addressing it directly often
 *       unsticks the conversation.
 *
 * Every quoted example is OUR OWN outbound. The same prompt says twice that Troy has never
 * replied — "Exchange so far: 0 inbound / 7 outbound" and "The customer has never replied to
 * anything on this lead." A lead with zero customer messages cannot have a customer raising
 * competitors three times.
 *
 * ── TWO INDEPENDENT CAUSES ────────────────────────────────────────────────────────────────
 * (a) DIRECTION. The v9.7.81 scan counts "both directions" by design, and the render then
 *     presents the result as "categories the customer has come back to" while the interpretation
 *     tells the model to raise the topic with them. Half that design is still right: an AGENT
 *     NOTE recording what a customer said ("wants to trade his 2018 Q5") is real evidence. A
 *     message WE composed and sent is not. The exclusion is therefore narrow — outbound texts
 *     and emails only. Call notes, general notes and all inbound still count.
 *
 * (b) OUR OWN MARQUE. The competitor pattern lists every franchise brand, "honda" included, so at
 *     Honda Baytown any note naming the store or the car scored a competitor mention — and the
 *     same holds at Toyota, Kia and Audi Baytown/Lafayette for their own marques. Fixing (a) alone
 *     leaves a call note reading "wants the Honda Accord" still scoring a competitor at a Honda
 *     store, so both are fixed.
 *
 * ── THE INTERPRETATION BLOCK PICKS ITS OWN TOP TOPIC ──────────────────────────────────────
 * It scans s.topicMentions independently and never saw the filter, so the "addressing it directly
 * unsticks the conversation" directive fired even once the listing above it was corrected. That is
 * the one that reaches the model as an instruction, so it is asserted separately.
 *
 * Same shape as the tapback bug: a scan mistaking our text for the customer's, then handing the
 * model a directive built on it.
 *
 * Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: own-words-topics.test.js <popup.js> [popup.js...]'); process.exit(2); }

const TROY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'troy-2073356549-notes.json'), 'utf8'));

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

// Run the SHIPPED scan. Same landmarks as reply-vs-inquiry, extended past the topic block.
function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('      // Walk newest-first (VinSolutions DOM order is newest-first)');
  if (start < 0) throw new Error('scan start not found in ' + file);
  const end = src.indexOf('        // (v9.7.81) FORWARD - CUSTOMER COMMITMENTS', start);
  if (end < 0) throw new Error('scan end not found in ' + file);
  const body = src.slice(start, end) + '\n      }\n';

  const sb = { String, RegExp, Date, Math, parseInt, parseFloat };
  vm.createContext(sb);
  vm.runInContext(
    'function _scan(noteEls) {\n' +
    '  var sig = { totalInboundCount: 0, totalOutboundCount: 0, consecutiveOutboundNoReply: 0,\n' +
    '    lastInboundAgeDays: null, priorPricingObjections: [], hasNoShowHistory: false,\n' +
    '    hasFrustrationHistory: false, appointmentHistory: [],\n' +
    '    topicMentions: { trade:{count:0,mentions:[]}, financing:{count:0,mentions:[]},\n' +
    '      configuration:{count:0,mentions:[]}, distance:{count:0,mentions:[]},\n' +
    '      useCase:{count:0,mentions:[]}, competitor:{count:0,mentions:[]} } };\n' +
    '  function parseNoteDate(s){ var t = new Date(s).getTime(); return t > 0 ? t : null; }\n' +
    body +
    '  return sig;\n' +
    '}', sb);

  return {
    name: path.basename(path.dirname(file)),
    src,
    scan: notes => vm.runInContext('_scan', sb)(mkNotes(notes))
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

const clone = () => JSON.parse(JSON.stringify(TROY));
const counts = (i, notes) => {
  const t = i.scan(notes).topicMentions;
  return Object.keys(t).filter(k => t[k].count > 0).reduce((o, k) => (o[k] = t[k].count, o), {});
};

console.log('\nv9.7.594 — our own emails are not the customer raising a topic');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── TROY ────────────────────────────────────────────────────────────────────
console.log("Troy's real record — he has sent us nothing at all:");

check('a lead with zero customer messages now has ZERO recurring topics',
  i => counts(i, TROY), {});

check('...specifically, no competitor thread',
  i => i.scan(TROY).topicMentions.competitor.count, 0);

check('...and no configuration thread from our own "I notice your interest in" email',
  i => i.scan(TROY).topicMentions.configuration.count, 0);

check('hasRecurringTopic is therefore false, so the whole section stays out',
  i => {
    const t = i.scan(TROY).topicMentions;
    return Object.keys(t).some(k => t[k].count >= 2);
  }, false);

// ── (a) DIRECTION ───────────────────────────────────────────────────────────
console.log('\nour own sends do not count; notes recording the customer still do:');

const outText  = { dir: 'Outbound', title: 'Outbound Text Message',
  body: 'Sent to: (409) 250-0120 Sent by: Nyriel Benton I can get you a trade-in appraisal and financing options',
  date: '08/27/2026 1:00 PM' };
const outEmail = { dir: 'Outbound', title: 'Email reply to prospect',
  body: 'Subject: Your trade By: Yvonne Ortega we will appraise your trade-in and talk financing',
  date: '08/27/2026 1:05 PM' };
const agentNote = { dir: '', title: 'General Note',
  body: 'By: Samantha Lopez customer wants a trade-in value on his payoff before coming in',
  date: '08/27/2026 1:10 PM' };
const inbound = { dir: 'Inbound', title: 'Inbound Text Message',
  body: 'Received from: (409) 250-0120 what would my trade-in be worth, I still have a payoff',
  date: '08/27/2026 1:15 PM' };

check('an outbound TEXT of ours contributes nothing',
  i => counts(i, [outText]), {});

check('an outbound EMAIL of ours contributes nothing',
  i => counts(i, [outEmail]), {});

check('an AGENT NOTE recording what the customer wants still counts',
  i => i.scan([agentNote]).topicMentions.trade.count, 1);

check('an INBOUND customer message still counts',
  i => i.scan([inbound]).topicMentions.trade.count, 1);

check('two of ours plus one real note yields ONE mention, not three',
  i => i.scan([outText, outEmail, agentNote]).topicMentions.trade.count, 1);

check('a real recurring topic still reaches the 2+ threshold',
  i => i.scan([agentNote, inbound]).topicMentions.trade.count, 2);

check('the "Sent to:/Sent by:" body prefix is caught even if the title is odd',
  i => counts(i, [{ dir: 'Outbound', title: 'Note',
    body: 'Sent by: Kaylee Guzman we have financing options and can appraise your trade',
    date: '08/27/2026 1:20 PM' }]), {});

// ── (b) OUR OWN MARQUE ──────────────────────────────────────────────────────
// The scan still records the raw mention; the RENDER decides whether it is a real competitor.
// These assert the render's rule, since that is what reaches the model.
console.log('\nthe store\'s own marque is not a competitor:');

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

check('the render compares the matched brand against the lead vehicle',
  i => /_lpLeadMarque = String\(\(data && \(data\.vehicle \|\| data\.vehicleRaw\)\) \|\| ''\)/.test(strip(i.src)), true);

check('an explicit cross-shop phrase still counts as a real competitor',
  i => /other dealer\\w\*\|another dealership\|shopping around\|comparing\|cross\.\?shop/.test(strip(i.src)), true);

check('the competitor topic is dropped when no captured mention names a foreign marque',
  i => /_lpTopicDropped\.competitor = true;/.test(strip(i.src)), true);

check('[LP TOPIC FILTER DIAG] reports the drop and the raw count',
  i => /\[LP TOPIC FILTER DIAG\] competitor DROPPED/.test(strip(i.src)), true);

// The marque comparison itself, pinned as arithmetic so the rule is not merely described.
const realCompetitor = (sentence, leadVehicle) => {
  if (/\b(other dealer\w*|another dealership|shopping around|comparing|cross.?shop)\b/i.test(sentence)) return true;
  const hits = sentence.match(/\b(toyota|honda|ford|chevy|chevrolet|nissan|hyundai|kia|mazda|subaru|jeep|ram|gmc|dodge|buick|cadillac|lincoln|acura|infiniti|lexus|bmw|mercedes|audi|volkswagen|vw|tesla|volvo|porsche)\b/gi);
  if (!hits) return false;
  return hits.some(h => leadVehicle.toLowerCase().indexOf(h.toLowerCase()) < 0);
};
const HONDA = '2026 Honda Accord Hybrid Sport-L';
console.log('\nthe marque rule, at each of the five rooftops and the real cross-shop case:');
check('  "wants the Honda Accord" at a HONDA store is NOT a competitor',
  () => realCompetitor('customer wants the Honda Accord', HONDA), false);
check('  "looking at a Toyota Camry too" at a Honda store IS',
  () => realCompetitor('also looking at a Toyota Camry', HONDA), true);
check('  "the Kia is cheaper" at Kia Baytown is NOT',
  () => realCompetitor('says the Kia is cheaper', '2026 Kia K5'), false);
check('  "Audi quote from another store" at Audi Lafayette IS — cross-shop wins',
  () => realCompetitor('has an Audi quote from another dealership', '2026 Audi Q5'), true);
check('  "shopping around" with no brand at all IS',
  () => realCompetitor('he is shopping around', HONDA), true);
check('  a sentence with no brand and no cross-shop phrase is NOT',
  () => realCompetitor('wants to come in Saturday', HONDA), false);

// ── THE DIRECTIVE ───────────────────────────────────────────────────────────
console.log('\nthe interpretation block honours the same filter:');

check('it skips a dropped topic when choosing what to tell the model to raise',
  i => /if \(_lpTopicDropped\[tk2\]\) continue;/.test(strip(i.src)), true);

check('...and that guard sits INSIDE the top-topic loop, before the count comparison',
  i => {
    const s = strip(i.src);
    const guard = s.indexOf('if (_lpTopicDropped[tk2]) continue;');
    const cmp   = s.indexOf('if (s.topicMentions[tk2].count > topCount)');
    return guard > 0 && cmp > guard;
  }, true);

// ── ATTEMPT DENSITY ─────────────────────────────────────────────────────────
console.log('\nattempt density counts outreaches, not CRM rows:');

check('the density buckets read the real outreach count',
  i => [/} else if \(_outreachN >= 15\)/.test(strip(i.src)),
        /} else if \(_outreachN >= 8\)/.test(strip(i.src)),
        /} else if \(_outreachN >= 3\)/.test(strip(i.src))], [true, true, true]);

check('no bucket still reads the note count',
  i => /} else if \(_nc >= \d/.test(strip(i.src)), false);

check('the label says "outreaches", matching what it now counts',
  i => /_attemptDensity = 'sustained \(' \+ _outreachN \+ ' outreaches\)'/.test(strip(i.src)), true);

check('_outreachN is defined BEFORE the density block that uses it',
  i => {
    const s = i.src;
    return s.indexOf('var _outreachN =') > 0 && s.indexOf('var _outreachN =') < s.indexOf('var _attemptDensity;');
  }, true);

// The bucket arithmetic, so Troy's reclassification is pinned rather than described.
const bucket = n => n >= 15 ? 'heavy' : n >= 8 ? 'sustained' : n >= 3 ? 'normal' : 'light';
console.log('\nwhat that does to Troy (7 real outreaches, 14 CRM rows):');
check('  on the OLD number (14 rows): sustained',      () => bucket(14), 'sustained');
check('  on the REAL number (7 outreaches): normal',   () => bucket(7),  'normal');
check('  the boundaries themselves are unchanged',
  () => [bucket(2), bucket(3), bucket(7), bucket(8), bucket(14), bucket(15)],
  ['light', 'normal', 'normal', 'sustained', 'sustained', 'heavy']);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
