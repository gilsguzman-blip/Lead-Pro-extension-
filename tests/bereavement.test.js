#!/usr/bin/env node
'use strict';
/**
 * bereavement.test.js — v9.7.567.
 *
 * MARY PACELLA (Community Toyota Baytown, lead 2040382104, 8/21). LP generated, and showed an
 * agent, this:
 *
 *   SMS:   "Mary, I'm very sorry for your loss. I know this is a difficult time—please accept my
 *           condolences from all of us at Community Toyota Baytown."
 *   EMAIL: "...If you'd like, I can also close out your file and stop any further contact for you"
 *
 * There is no death anywhere in her 39-note history. log127 names the path —
 *   [LP EXIT DIAG] hasExitSignal fired via hasBereavementSignal (death notification in thread)
 * — and then says nothing about WHAT matched, which is why this took a page dump and a regex
 * bisection to find.
 *
 * ── THE REPORTED CAUSE WAS WRONG, AND THE REAL ONE IS WORSE ───────────────────────────────
 * The report attributed it to an iMessage Tapback — `Loved "…friends and family pricing."` —
 * tripping a supposed loved/family proximity check. There is no such check in the bereavement
 * detector, and that Tapback matches NONE of its rules; asserted below.
 *
 * The actual trigger is Mary's OWN inbound email of 8/4, and it is the single most engaged
 * message on the lead:
 *
 *   "My apologies to you timing is passing.. I need to know when is the best time to consider
 *    buying a vehicle ? I want to stay in the Toyota family, thank you for reaching out and not
 *    giving up on me"
 *
 * The fourth rule was /\b\w+['’]?s\s+passing\b/ — the apostrophe OPTIONAL and \w+ able to match a
 * SINGLE letter, so "**is** passing" satisfies it as \w+="i" plus a literal s. A pattern written
 * for "Robert's passing" was matching the English word "is". So a customer saying she wants to
 * keep buying was told we were sorry for her loss and offered a file closure.
 *
 * FIXED as two rules: a real possessive REQUIRES the apostrophe and 2+ letters, and
 * "his/her/their passing" — genuine grief English with no apostrophe — is named explicitly rather
 * than swept in by a wildcard.
 *
 * The Tapback guard is built anyway, because the shape is real and unhandled: the quoted half is
 * OUR OWN prior outbound echoed back by the customer's phone, and every sentiment, exit, trade and
 * schedule scan was reading that marketing prose as something the customer typed.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: bereavement.test.js <popup.js> [popup.js...]'); process.exit(2); }

// Verbatim from the VinSolutions dump of 8/21.
const MARY_EMAIL = 'Email reply from prospect Subject: Re:One reason to take another look By: Gerald '
  + 'Bailey My apologies to you timing is passing.. I need to know when is the best time to consider '
  + 'buying a vehicle ? I want to stay in the Toyota family,thank you for reaching out and not giving '
  + 'up on me ..Sent from the all new AOL app for iOS';
const MARY_TAPBACK = 'Received from: (409) 201-9035 Received by: Gerald Bailey Loved “The best time '
  + 'is now. We have some great deals and I know you. So you will always get my friends and family '
  + 'pricing.”';
// The v9.7.481 incident this guard was built for — it must still fire.
const ROBERT = 'Email reply from prospect Sorry to inform you that Robert passed away on the 14th. '
  + 'Please remove him from your list.';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in ' + file); return i; };

  const ba = at('    var hasBereavementSignal = false;');
  const bb = at('    // "we bought" / "bought it"', ba);
  const brvSrc = src.slice(ba, bb);

  const sa = at('    function _lpCustomerAuthoredPart(raw) {');
  const sb = src.indexOf('\n    function ', sa + 10);
  const stripSrc = src.slice(sa, sb);

  const ta = at('    // (v9.7.567) A TAPBACK CARRIES OUR OWN MARKETING PROSE');
  const tb = at('    const recentInbound =', ta);
  const tapSrc = src.slice(ta, tb);

  return {
    name: path.basename(path.dirname(file)), src, brvSrc,

    fire: (text) => {
      const logs = [];
      const box = { fullScanText: String(text).toLowerCase(), RegExp, String, Math, JSON,
                    _lpD: (...a) => logs.push(a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) };
      vm.createContext(box);
      vm.runInContext(brvSrc, box);
      return { fired: vm.runInContext('hasBereavementSignal', box),
               rule:  vm.runInContext('_brvRule', box),
               matched: vm.runInContext('_brvMatch', box), logs };
    },

    strip: (() => {
      const box = {}; vm.createContext(box); vm.runInContext(stripSrc, box);
      return vm.runInContext('_lpCustomerAuthoredPart', box);
    })(),

    // Run the real transcript-level Tapback pass.
    tapback: (lines) => {
      const logs = [];
      const box = { filteredTranscript: lines.slice(), String, RegExp, JSON,
                    _lpD: (...a) => logs.push(a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) };
      vm.createContext(box);
      vm.runInContext(tapSrc, box);
      return { lines: vm.runInContext('filteredTranscript', box),
               count: vm.runInContext('_tapbacks', box), logs };
    }
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
function check(name, fn, want) {
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);
}

console.log('\nv9.7.567 — "is passing" is not a bereavement');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── The incident ───────────────────────────────────────────────────────────────
console.log("Mary Pacella — her real notes, run through the real detector:");

check("her OWN 8/4 email no longer fires — this is the incident",
  i => i.fire(MARY_EMAIL).fired, false);

check('the reported suspect — the iMessage Tapback — never matched ANY rule',
  i => i.fire(MARY_TAPBACK).fired, false);

check('the OLD fourth rule DID match "is passing" — the test is not vacuous',
  i => {
    const old = /\b\w+['’]?s\s+passing\b/i;
    const m = MARY_EMAIL.toLowerCase().match(old);
    return m ? m[0] : '(no match)';
  }, 'is passing');

check('...and the old rule did NOT match the Tapback, so the report\'s mechanism is ruled out',
  i => /\b\w+['’]?s\s+passing\b/i.test(MARY_TAPBACK.toLowerCase()), false);

check('there is no loved/family proximity check anywhere in the detector',
  i => /loved/i.test(i.brvSrc.replace(/^\s*\/\/.*$/gm, '')), false);

// ── The tightened rule ─────────────────────────────────────────────────────────
console.log('\nthe possessive rule now requires a real possessive:');

const SILENT = [
  'timing is passing', 'the deal was passing', 'days passing without a reply',
  'this passing week', 'great deals passing us by', 'the offer is passing quickly',
  'as passing traffic goes', 'that ship has passing'
];
check('ordinary prose ending in "<word> passing" stays silent',
  i => SILENT.filter(t => i.fire(t).fired), []);

const POSSESSIVE = [
  ["Robert's passing", "robert's passing"],
  ['Robert’s passing (curly apostrophe)', 'robert’s passing'],
  ['his passing', 'his passing'],
  ['her passing', 'her passing'],
  ['their passing', 'their passing']
];
POSSESSIVE.forEach(([label, want]) => {
  check('a genuine possessive still fires: ' + label,
    i => i.fire(label.replace(/ \(.*\)$/, '') + ' was sudden').matched, want);
});

// ── The rest of the detector is untouched ──────────────────────────────────────
console.log('\nevery other rule is unchanged — the v9.7.481 coverage still holds:');

const GENUINE = [
  ['Robert passed away last week',                 'passed away'],
  ['my husband died in June',                      'husband died'],
  ['we had a death in the family',                 'death in the family'],
  ['the funeral is Thursday',                      'funeral'],
  ['reading the obituary now',                     'obituar'],
  ['I lost my mother last month',                  'lost my mother'],
  ['she passed unexpectedly',                      'she passed'],
  ['he is no longer with us',                      'no longer with us'],
  ['dad is deceased',                              'deceased']
];
GENUINE.forEach(([text, want]) => {
  check('fires on: "' + text + '"', i => i.fire(text).matched, want);
});

const AUTOMOTIVE = [
  'the battery died on me', 'the car died in the driveway', 'the engine died',
  'the deal died last week', 'she passed on the offer', 'he passed by the dealership',
  'we passed up the warranty', 'she passed through town', 'he passed along the info'
];
check('the automotive false-positive idioms the v9.7.481 lookahead exists for stay silent',
  i => AUTOMOTIVE.filter(t => i.fire(t).fired), []);

check('Robert’s real 7/25 death notification still fires',
  i => { const r = i.fire(ROBERT); return { fired: r.fired, rule: r.rule }; },
  { fired: true, rule: 'unambiguous vocabulary' });

// ── The diagnostic ─────────────────────────────────────────────────────────────
console.log('\nthe diagnostic — this guard writes a condolence and offers to close a file:');

check('a fire logs the matched string and which rule matched',
  i => {
    const l = i.fire(ROBERT).logs.join('\n');
    return { hasDiag: /\[LP BEREAVEMENT DIAG\]/.test(l), hasMatched: /"matched":"passed away"/.test(l),
             hasRule: /"rule":"unambiguous vocabulary"/.test(l) };
  }, { hasDiag: true, hasMatched: true, hasRule: true });

check('...and quotes the surrounding source text, so the next case is a grep',
  i => /Sorry to inform you that Robert passed away/i.test(i.fire(ROBERT).logs.join('\n')), true);

check('a NON-fire logs too — silence and "never ran" must not look identical',
  i => /"fired":false/.test(i.fire(MARY_EMAIL).logs.join('\n')), true);

check('exactly one rule is reported per fire — the first match wins and stops',
  i => (i.fire('my husband died and the funeral is Thursday').logs.join('\n')
        .match(/\[LP BEREAVEMENT DIAG\]/g) || []).length, 1);

// ── The Tapback guard ──────────────────────────────────────────────────────────
console.log('\nthe iMessage Tapback guard — not the cause here, but a real unhandled shape:');

check('a Tapback body yields NO customer-authored text',
  i => i.strip('Loved “The best time is now. We have some great deals.”').text, '');

check('...and names itself, rather than looking like an empty note',
  i => /Tapback reaction \(Loved\)/.test(i.strip('Loved “x y z”').cutBy), true);

check('every reaction verb is recognised',
  i => ['Loved', 'Liked', 'Disliked', 'Laughed at', 'Emphasized', 'Emphasised', 'Questioned']
        .map(v => i.strip(v + ' “some quoted text”').text === ''),
  [true, true, true, true, true, true, true]);

check('straight quotes and curly quotes both count',
  i => ['Loved "x"', 'Loved “x”', "Loved 'x'"].map(t => i.strip(t).text === ''),
  [true, true, true]);

check('a real message that merely STARTS with "Liked" is NOT treated as a reaction',
  i => i.strip('Liked the blue one best, can I see it Saturday?').text,
  'Liked the blue one best, can I see it Saturday?');

check('...nor is one that quotes something mid-sentence',
  i => i.strip('I really loved "the ride" when we test drove it').text,
  'I really loved "the ride" when we test drove it');

console.log('\nthe transcript-level pass — the reaction verb survives as the signal it is:');

check('the quoted payload is replaced, not the whole line',
  i => i.tapback(['[08/21/2026] [CUSTOMER] Inbound Text Message Loved “We have some great deals and I know you. So you will always get my friends and family pricing.”']).lines[0],
  '[08/21/2026] [CUSTOMER] Inbound Text Message Loved [reaction to our prior message]');

check('the marketing prose is gone from what the scanners read',
  i => /friends and family pricing/.test(i.tapback(['[CUSTOMER] Loved “you will always get my friends and family pricing.”']).lines.join(' ')), false);

check('an ordinary line is passed through byte-identical',
  i => i.tapback(['[CUSTOMER] I want to stay in the Toyota family']).lines[0],
  '[CUSTOMER] I want to stay in the Toyota family');

check('the count and the diagnostic report what was stripped',
  i => {
    const r = i.tapback(['[CUSTOMER] Loved “a”', '[CUSTOMER] plain', '[CUSTOMER] Liked “b”']);
    return { count: r.count, logged: /\[LP TAPBACK DIAG\]/.test(r.logs.join('\n')) };
  }, { count: 2, logged: true });

check('nothing is stripped when there are no reactions, and nothing is logged',
  i => {
    const r = i.tapback(['[CUSTOMER] plain one', '[CUSTOMER] plain two']);
    return { count: r.count, logs: r.logs.length };
  }, { count: 0, logs: 0 });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
