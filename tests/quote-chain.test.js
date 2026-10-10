#!/usr/bin/env node
'use strict';
// (v9.7.626) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('quote-chain.test.js');

/**
 * quote-chain.test.js — v9.7.626. sanitize(), THE FUNCTION THAT HAS EATEN CUSTOMER SPEECH FOUR TIMES.
 *
 * Until this suite it had NO COVERAGE AT ALL, despite being the last thing that touches a
 * customer's words before every downstream detector reads them. Four incidents are documented in
 * its own comments — Megan Mckennie, Daniel Boyd, the unanchored ">" strip, and the "Get"/"forget"
 * word-boundary bug — each verified once by hand at the time and never pinned. This suite pins all
 * of them, plus the two found on 9/4.
 *
 * WHAT THE FUNCTION IS FOR: removing the quote chain an email client appends — "On <date>, <name>
 * wrote:", "Sent from my iPhone", "------ Original Message ------", "> quoted lines" — so the
 * agent's own prior message is not read back as something the customer said.
 *
 * THE TWO FOUND ON 9/4, both on Sydnie Moon (Audi Lafayette, 2075798859):
 *
 * (1) IT WAS DELETING HER OWN WORDS. The catch-all pattern opened `\bOn` then `[^,]{1,80}` —
 *     anything up to the next comma. Her 8/31 reply reads
 *         "...what your offer|on my trade in would be On Aug 31, 2026, at 9:37AM, ... wrote:"
 *     The leftmost \bon wins, so the match began at HER "on my trade in" and 23 characters of her
 *     actual question went with the quote chain. Reproduced against the shipped function before
 *     anything was changed. A reply header always carries a DATE, and requiring one immediately
 *     after "On" is what separates the header from the preposition.
 *
 * (2) A RUN-TOGETHER HEADER ESCAPED ENTIRELY. VinSolutions renders some replies with the body and
 *     the header joined — "...happy to consider it|On Sep 2, 2026, ... wrote:" — so there is no
 *     word boundary and every \bOn pattern misses it. That \b is the Daniel Boyd fix and must
 *     stay, so the run-together shape gets its own pattern, requiring a preceding letter, a full
 *     date, and a terminating "wrote:" — three conditions that cannot coincide inside a word.
 *
 * Executes the SHIPPED sanitize(). Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: quote-chain.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    // (v9.7.626) The date shape an email reply header always carries.');
  if (a < 0) require('./lib/fatal-guard.js').bail('quote-chain.test.js', '_LP_QDATE not in ' + file);
  const mark = "      .replace(/[^\\x20-\\x7E\\u2018-\\u201D]/g, '').trim();";
  const b = src.indexOf(mark, a);
  const end = src.indexOf('\n    }', b) + 6;
  if (b < 0 || end < 6) require('./lib/fatal-guard.js').bail('quote-chain.test.js', 'sanitize tail not found in ' + file);
  const logs = [];
  const sb = { String, RegExp, _lpD: m => logs.push(String(m)) };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, end), sb);
  return { src, logs, san: vm.runInContext('sanitize', sb) };
}

// sanitize curls quotes and apostrophes on the way out; expectations carry that.
const curl = s => s.replace(/"/g, '“').replace(/'/g, '’');

for (const file of BUILDS) {
  const B = load(file);
  const san = B.san;
  const unchanged = (name, s) => check(name, san(s), curl(s));

  console.log('\n' + path.relative(process.cwd(), file) + ' — sanitize() keeps the customer, drops the chain');

  // ── THE TWO FOUND ON 9/4 ───────────────────────────────────────────────────
  console.log('\nSydnie, 9/4 — both real strings:');
  check('her "on my trade in" survives; the header goes',
    san('Hi! I was wondering if the listed price is out the door. Also would like to see what your '
      + 'offer on my trade in would be On Aug 31, 2026, at 9:37AM, Kristen Willis kwillis@audilafayette.net wrote: Hi Sydnie'),
    curl('Hi! I was wondering if the listed price is out the door. Also would like to see what your '
      + 'offer on my trade in would be'));
  check('the run-together "itOn" header is stripped, her word kept',
    san('If theres any better deal to consider Id be happy to consider itOn Sep 2, 2026, at 11:03AM, '
      + 'Patrick Ogbeide pogbeide@audilafayette.net wrote: Hi Sydnie, What did you have in mind'),
    curl('If theres any better deal to consider Id be happy to consider it'));

  // ── THE FOUR DOCUMENTED INCIDENTS, PINNED AT LAST ──────────────────────────
  console.log('\nMegan Mckennie (5/8) — "on Saturday" is a question, not a chain:');
  unchanged('  "Are you open on Saturday?"', 'Are you open on Saturday?');

  console.log('\nDaniel Boyd (8/5) — "opti|on " must never open a chain:');
  unchanged('  the subject that cost his requirements',
    'Subject: Re:A Telluride Hybrid option. Pre-owned vehicles preferably');

  console.log('\nthe unanchored ">" strip (v9.7.530) — an arrow is not a quote:');
  unchanged('  "this week -> next week"',
    'Timeline: this week -> next week at the latest. Pre-owned only, under 25k, must have AWD.');
  unchanged('  "Trade > payoff"', 'Trade > payoff');
  unchanged('  "Comparing Accord > Camry"', 'Comparing Accord > Camry');

  console.log('\nthe "Get"/"forget" word-boundary bug (v9.7.530):');
  unchanged('  "I forget my iPhone at home most days"',
    'Please text me, I forget my iPhone at home most days. My budget is 32k and I need a 3rd row.');
  unchanged('  "My budget Outlook for next month"',
    'My budget Outlook for next month is better, can we revisit then?');
  unchanged('  "Can you get Gmail to send me the quote?"', 'Can you get Gmail to send me the quote?');

  // ── WHAT MUST STILL STRIP ──────────────────────────────────────────────────
  // The guard against turning a fix for over-reach into a fix that does nothing.
  console.log('\nevery genuine chain still strips:');
  check('day-name header', san('Sounds good. On Friday, July 3, 2026, Kristen wrote: hello'), curl('Sounds good.'));
  check('numeric header',  san('Sounds good. On 9/2/2026 Kristen wrote: hello'), curl('Sounds good.'));
  check('month-first header with a time',
    san('Yes please. On Sep 2, 2026, at 11:03AM, Kristen wrote: hi'), curl('Yes please.'));
  check('day-first header',
    san('Yes please. On 2 Sep 2026 at 11:03, Kristen wrote: hi'), curl('Yes please.'));
  check('Outlook separator', san('Thanks. ------ Original Message ------ the whole pitch'), curl('Thanks.'));
  check('iPhone footer', san('Sounds good. Sent from my iPhone'), curl('Sounds good.'));
  check('Get Outlook footer', san('Sounds good. Get Outlook for Android'), curl('Sounds good.'));
  check('a newline-anchored "> quoted" block',
    san('My answer is yes.\n> the original message\n> second line'), curl('My answer is yes.'));

  // ── THE SHAPE THAT MADE (1) POSSIBLE MUST BE GONE ──────────────────────────
  // A header needs a date. Without one there is nothing to strip, however many commas follow.
  console.log('\na bare "On ..., ... wrote:" with no date is not a header:');
  unchanged('  "we agreed on terms, and Pat wrote: see notes"',
    'we agreed on terms, and Pat wrote: see notes');

  console.log('\nit never throws:');
  check('empty', san(''), '');
  check('null',  san(null), '');
  check('a lone "On"', san('On'), 'On');

  // ── OBSERVABILITY ──────────────────────────────────────────────────────────
  // Inside inlineScraper: a console.log here prints to the PAGE console and has hidden four
  // diagnostics before now.
  console.log('\nthe strip is observable, via _lpD:');
  B.logs.length = 0;
  san('Yes please. On Sep 2, 2026, at 11:03AM, Kristen wrote: hi');
  check('a removed chain is reported', /QUOTE-CHAIN DIAG/.test(B.logs.join(' ')), true);
  B.logs.length = 0;
  san('Are you open on Saturday?');
  check('...and a clean note is silent', B.logs.length, 0);
  check('the diagnostic uses _lpD', /_lpD\('\[LP QUOTE-CHAIN DIAG\]/.test(B.src), true);
  check('...and never console.log', /console\.log\('\[LP QUOTE-CHAIN DIAG\]/.test(B.src), false);

  // ONE definition of "this is a date", shared by both new patterns.
  check('the date shape has a single definition',
    (B.src.match(/var _LP_QDATE = /g) || []).length, 1);
  check('...used by the bounded catch-all', /'\\\\s\*\\\\bOn\\\\s\+' \+ _LP_QDATE/.test(B.src), true);
  check('...and by the run-together pattern', /'\(\[A-Za-z\]\)On\\\\s\+' \+ _LP_QDATE/.test(B.src), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds sanitize identically:');
  const cut = f => {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('    // (v9.7.626) The date shape an email reply header always carries.');
    return s.slice(i, s.indexOf('\n    }', s.indexOf('.trim();', i)) + 6);
  };
  // Compared with COMMENTS STRIPPED. The two builds carry divergent historical provenance in this
  // block — dev's Daniel Boyd note reads "(v9.7.528/?" and commercial's "(v9.7.526/? ... mirrors
  // DEV" — which is a true record of how each got the fix and should not be rewritten to make an
  // assertion pass. What must not diverge is the code.
  const bare = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace(/\s+/g, ' ').trim();
  check('dev and commercial run the same code', bare(cut(BUILDS[0])) === bare(cut(BUILDS[1])), true);
  check('...and the divergence is comments only', cut(BUILDS[0]) === cut(BUILDS[1]), false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
