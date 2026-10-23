#!/usr/bin/env node
'use strict';
// (v9.7.624) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('neg-supersession.test.js');

/**
 * neg-supersession.test.js — v9.7.624. A NEGATIVE IS A STATE, AND STATES END.
 *
 * LIVE: Sydnie Moon (Audi Lafayette, lead 2075798859, 9/4). convState resolved to
 * 'negative-reply', which drove "[LP INCENTIVE DIAG] suppressed — adversarial state
 * (negative-reply)" and framed the whole draft as damage control on a live deal.
 *
 * Her negatives are from 9/3 — "No more than the $800 range, which I know is more than likely not
 * possible for the vehicle" and a credit-pull hesitation, both tagged Negative by VinSolutions.
 * Her 9/4 2:54 PM reply, the NEWEST note on the lead, is tagged NeutralOther and reads "Email
 * please. I have limited service currently but I do have WiFi" — a logistics request from someone
 * mid-negotiation on payment, payoff and an appraisal in flight.
 *
 * hasNegTag scanned the last 10 notes and NOTHING EVER RETIRED IT. That is the identical mechanism
 * to the v9.7.612 pause bug, and this fix deliberately mirrors it rather than inventing a second
 * shape for the same problem: a state matched anywhere in scope, standing forever.
 *
 * THE RULES, each asserted below:
 *   · superseded by DATE, never by position — DOM order is not something to rest a customer-facing
 *     state on, and every note carries its own date element
 *   · only a CUSTOMER entry supersedes; our own follow-up does not
 *   · it must be SUBSTANTIVE — a bare "ok" is not a change of posture
 *   · it must not ITSELF be negative
 *   · it must be STRICTLY later, so a tie leaves the negative standing
 *   · FAILS CLOSED everywhere else: undated negative, undated reply, unparseable date, or no later
 *     customer entry all leave the negative in place
 *
 * DETECTION IS UNCHANGED. This build narrows WHEN a negative expires, never WHAT counts as one —
 * the sentiment-tag and price-pushback patterns are byte-identical to what shipped, and are now
 * read from ONE definition by both the detector and the supersession pass, because two copies of a
 * rule drift.
 *
 * NOT TOUCHED: the pricing CONCERN block is a separate detector reading the same words, and it
 * still fires — Sydnie's prompt carried "Customer has raised a PRICING concern that is still open"
 * independently of convState. This removes the adversarial GATE, not the signal.
 *
 * Executes the SHIPPED block against her real note shapes. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: neg-supersession.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('      // (v9.7.624) Factored out of the .some()');
  const b = src.indexOf('      // Check if customer has sent a real inbound text/email reply');
  if (a < 0 || b < 0) require('./lib/fatal-guard.js').bail('neg-supersession.test.js', 'negative block not in ' + file);
  // _inboundBody / _isTrivialConfirmation sit between the detector and this anchor, so the single
  // slice already carries them; they are function declarations and hoist into the supersession
  // pass regardless of order. (First attempt searched for them AFTER the anchor, got -1, and
  // sliced an empty string — which the fatal-guard correctly reported as "asserted nothing"
  // rather than as a passing suite.)
  const code = src.slice(a, b);
  if (!/var hasNegTag = /.test(code)) {
    require('./lib/fatal-guard.js').bail('neg-supersession.test.js', 'slice missed the detector in ' + file);
  }
  return { src, code };
}

// A note in the shape the shipped scanner reads it. VinSolutions' date class carries the
// long-documented typo ('hsitory'); using the real one is the point of running shipped code.
const note = (dir, date, content, neg) => ({
  innerHTML: neg ? '<span class="sentiment negative">Negative</span>'
                 : '<span class="sentiment neutral">Neutral</span>',
  getAttribute: () => dir,
  querySelector: sel => (sel.indexOf('date') >= 0 ? { innerText: date } : { innerText: content })
});

// Sydnie's real notes, newest-first as VinSolutions renders the list.
const SYDNIE = [
  note('inbound',  '09/04/2026 2:54 PM', 'Subject: Re:Your CR-V appraisal and Armada numbers By: Kristen Willis Email please. I have limited service currently but I do have WiFi', false),
  note('outbound', '09/04/2026 1:45 PM', 'Hi Sydnie, The key piece left is a firm appraisal on your 2023 Honda CR-V Hybrid.', false),
  note('inbound',  '09/03/2026 5:57 PM', 'I am not opposed to filling one out, just would prefer it not be ran several times', true),
  note('inbound',  '09/03/2026 9:53 AM', 'No more than the $800 range, which I know is more than likely not possible for the vehicle', true),
];

for (const file of BUILDS) {
  const B = load(file);
  const run = noteEls => {
    const logs = [];
    const sb = { noteEls, Date, isNaN, _lpD: m => logs.push(String(m)), console: { log() {} } };
    vm.createContext(sb);
    vm.runInContext(B.code, sb);
    return { neg: vm.runInContext('hasNegTag', sb), logs: logs.join(' | ') };
  };

  console.log('\n' + path.relative(process.cwd(), file) + ' — a negative is a state, and states end');

  // ── THE INCIDENT ───────────────────────────────────────────────────────────
  console.log('\nSydnie — negatives on 9/3, a neutral logistics reply on 9/4:');
  const syd = run(SYDNIE);
  check('the negative no longer stands', syd.neg, false);
  check('...and it says so, with both dates', /SUPERSEDED DIAG.*09\/03\/2026 5:57 PM.*09\/04\/2026 2:54 PM/.test(syd.logs), true);
  // The half that matters downstream: convState stops being adversarial, so the incentive gate
  // and the damage-control framing stop firing on a customer who is mid-negotiation.
  check('...naming what changes downstream', /convState will NOT be negative-reply/.test(syd.logs), true);

  // ── MUST STILL FIRE ────────────────────────────────────────────────────────
  // The guard against turning this into a blanket off-switch. Detection is unchanged; only
  // expiry is new, so every genuinely-current negative must survive.
  console.log('\na genuinely current negative still stands:');
  check('negative is the newest customer word', run([
    note('outbound', '09/04/2026 1:45 PM', 'following up on the numbers', false),
    note('inbound',  '09/03/2026 9:53 AM', 'way too expensive for what it is', true),
  ]).neg, true);
  check('a bare "ok" is not a change of posture', run([
    note('inbound', '09/04/2026 9:00 AM', 'ok', false),
    note('inbound', '09/03/2026 9:53 AM', 'that is too much', true),
  ]).neg, true);
  check('our own outbound cannot retire it', run([
    note('outbound', '09/04/2026 9:00 AM', 'Just checking back in on the numbers for you', false),
    note('inbound',  '09/03/2026 9:53 AM', 'that is too much', true),
  ]).neg, true);
  check('a LATER negative does not supersede an earlier one', run([
    note('inbound', '09/04/2026 9:00 AM', 'still way too expensive', true),
    note('inbound', '09/03/2026 9:53 AM', 'that is too much', true),
  ]).neg, true);

  // ── FAIL CLOSED ────────────────────────────────────────────────────────────
  console.log('\nevery ambiguous case leaves the negative standing:');
  check('an undated later reply fails closed', run([
    note('inbound', '',                    'lets keep going with the armada please', false),
    note('inbound', '09/03/2026 9:53 AM',  'that is too much', true),
  ]).neg, true);
  check('an unparseable date fails closed', run([
    note('inbound', 'sometime yesterday',  'lets keep going with the armada please', false),
    note('inbound', '09/03/2026 9:53 AM',  'that is too much', true),
  ]).neg, true);
  check('an undated negative fails closed', run([
    note('inbound', '09/04/2026 2:54 PM',  'lets keep going with the armada please', false),
    note('inbound', '',                    'that is too much', true),
  ]).neg, true);
  check('the same timestamp is not "strictly later"', run([
    note('inbound', '09/03/2026 9:53 AM',  'actually lets keep going with the armada', false),
    note('inbound', '09/03/2026 9:53 AM',  'that is too much', true),
  ]).neg, true);
  check('no notes at all yields no negative, no throw', run([]).neg, false);

  // ── DETECTION IS UNCHANGED ─────────────────────────────────────────────────
  // Asserted rather than assumed: this build must narrow WHEN, never WHAT.
  console.log('\ndetection itself did not change:');
  check('the price-pushback pattern still fires on its own', run([
    note('inbound', '09/03/2026 9:53 AM', 'this is way too expensive', false),
  ]).neg, true);
  check('a VinSolutions negative tag still fires on its own', run([
    note('inbound', '09/03/2026 9:53 AM', 'I will think about it', true),
  ]).neg, true);
  check('a bare "stop" is an opt-out, not a concern', run([
    note('inbound', '09/03/2026 9:53 AM', 'stop', false),
  ]).neg, false);
  check('an ordinary reply is not negative', run([
    note('inbound', '09/03/2026 9:53 AM', 'sounds good, what time do you close', false),
  ]).neg, false);

  // ONE definition of the rule, read by both the detector and the supersession pass.
  console.log('\nthe rule has exactly one definition:');
  check('the detector calls the shared predicate',
    /var hasNegTag = noteEls\.slice\(0,10\)\.some\(_lpNoteIsNegative\);/.test(B.src), true);
  check('the supersession pass calls the same one',
    /if \(_lpNoteIsNegative\(item\)\)/.test(B.src), true);
  check('the pushback pattern appears exactly once',
    (B.src.match(/asking too much\|over priced\|overpriced\|sticker/g) || []).length, 1);
  // Inside inlineScraper — a console.log here prints to the PAGE console.
  check('the diagnostics use _lpD, not console.log',
    /_lpD\('\[LP NEG SUPERSEDED DIAG\]/.test(B.src) && /_lpD\('\[LP NEG STANDS DIAG\]/.test(B.src), true);
  check('...and no console.log carries those tags',
    /console\.log\('\[LP NEG (SUPERSEDED|STANDS) DIAG\]/.test(B.src), false);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds ship the same rule:');
  const cut = f => { const s = load(f); return s.code; };
  check('dev and commercial are identical', cut(BUILDS[0]) === cut(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
