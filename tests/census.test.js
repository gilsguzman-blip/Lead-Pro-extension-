#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('census.test.js');

/**
 * census.test.js — v9.7.638. THE SUITE THAT EXISTS BECAUSE WE KEEP FINDING THE SAME TWO BUGS.
 *
 * Gil, 9/5: "Everytime we've built we've found yet another problem. What can we do about that?"
 *
 * The honest answer is that we have not been finding NEW problems. We have been finding the SAME
 * TWO problems in new locations, one location at a time, because nothing in the build could see
 * the pattern — only a human reading a delivered prompt could.
 *
 *   FAMILY A — ONE QUESTION, ANSWERED IN N PLACES.
 *     v9.7.629  where does the transcript begin and end        (two answers)
 *     v9.7.630  what counts as the bounded region              (two answers)
 *     v9.7.634  what is a CRM routing header                   (two answers)
 *     v9.7.635  what may we call this lead source              (two answers)
 *     v9.7.637  is this text the customer's own words          (two answers)
 *     v9.7.638  is this text the customer's own words          (a THIRD answer, found next day)
 *     v9.7.638  is this text something we sent them            (two answers)
 *
 *   FAMILY B — A DERIVED LINE ASSERTING SOMETHING THE CUSTOMER'S OWN WORDS CONTRADICT.
 *     v9.7.491 trade  · v9.7.555 off-franchise · v9.7.581 spouse · v9.7.594 competitor
 *     v9.7.616 budget · v9.7.628 variant       · v9.7.637 equity · v9.7.638 pivot, price, topics
 *
 * This suite makes FAMILY A mechanically detectable. For each question the codebase has to answer,
 * it asserts that exactly ONE implementation exists and that the known consumers delegate to it
 * rather than carrying a private copy. A future engineer who solves one of these questions a
 * second time gets a red build naming the question, instead of a live incident eight days later.
 *
 * It cannot catch Family B — that needs the customer's words at runtime, which is what the
 * per-detector suites do. What it CAN do is stop the duplication that keeps re-opening Family B
 * in a path the last fix did not reach.
 *
 * DELIBERATELY NOT A STYLE CHECK. Every entry below is a question that has already cost a live
 * incident. Nothing is added here on suspicion.
 */
const fs = require('fs');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: census.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// Each question: the single owner, the incident that proved it needs one, and the consumers that
// must call it rather than re-deriving. `forbidden` are shapes that mean somebody answered it
// again locally.
const QUESTIONS = [
  {
    question: 'is this text machine-generated record fields rather than the customer\'s words',
    owner: 'function _lpIsToolFieldBlob(',
    incident: 'v9.7.637 Rebekah Fontenot (negative equity quoted back) / v9.7.638 Rebecca Caplan (dealer prices as her words)',
    consumers: ['if (extractedCustQ && _lpIsToolFieldBlob(extractedCustQ))', 'if (_lpIsToolFieldBlob(_lir))']
  },
  {
    question: 'is this text a message WE composed and sent them',
    owner: 'function _lpIsOurOwnSend(',
    incident: 'v9.7.594 Troy Noel (our emails as his topics) / v9.7.638 Rebecca Caplan (our "budget range" as her price concern)',
    consumers: ['!_lpIsOurOwnSend(line)', '_lpIsOurOwnSend(title)']
  },
  {
    question: 'is this line a CRM routing header rather than speech',
    owner: 'function _lpIsRoutingLine(',
    incident: 'v9.7.634 Carlos (routing metadata ate a commitment quote) / v9.7.638 Rebecca Caplan (header counted as 7 competitor mentions)',
    consumers: ['!_lpIsRoutingLine(l)']
  },
  {
    question: 'what may we call this lead source to the customer',
    owner: 'function _lpSourceAckPhrase(',
    incident: 'v9.7.635 Rebekah Fontenot (three directives disagreed; one handed the model the raw CRM label)',
    consumers: ['_lpSourceAckPhrase(_ls)', '_lpSourceAckPhrase(data.leadSource)']
  },
  {
    question: 'where is the author line in a note',
    owner: 'function _lpAuthorRaw(',
    incident: 'v9.7.639 — a second consumer appeared (the bot test), and this is the extraction being factored out AT that moment instead of eight days after the copy drifts',
    consumers: ['var rest = _lpAuthorRaw(msg);', '_LP_BOT_AUTHOR_RE.test(_lpAuthorRaw(msg))']
  },
  {
    question: 'did a machine write this message rather than a person',
    owner: 'function _lpIsBotAuthor(',
    incident: 'v9.7.639 Angelique Morgan — the store\'s AI auto-responder touched the lead 0 minutes after creation and LP framed it as a colleague\'s message',
    consumers: ['_lpIsBotAuthor(data.lastSubstantiveOutboundMsg)']
  },
  {
    question: 'where does the bounded conversation transcript begin and end',
    owner: 'function _lpBoundedTranscript(',
    incident: 'v9.7.629 / v9.7.630 (the arc digest and the fence disagreed about the region)',
    consumers: ['_lpBoundedTranscript(ctx)']
  }
];

for (const file of BUILDS) {
  const src = fs.readFileSync(file, 'utf8');
  // Comment-stripped: this file's build headers quote its own code verbatim, which has produced
  // seven false greens since v9.7.563.
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  console.log('\n' + path.relative(process.cwd(), file) + ' — one question, one owner');

  for (const q of QUESTIONS) {
    console.log('\n  Q: ' + q.question);
    console.log('     (' + q.incident + ')');
    const owners = (code.split(q.owner).length - 1);
    check('    exactly one implementation', owners, 1);
    for (const c of q.consumers) {
      check('    consumer delegates: ' + JSON.stringify(c.slice(0, 52)), code.indexOf(c) >= 0, true);
    }
  }

  // ── THE SPECIFIC DUPLICATES THAT CAUSED INCIDENTS MUST NOT COME BACK ────────
  // Each of these is a private re-answer that shipped, was found in production, and was removed.
  // Named literally so the build says which incident is being re-created.
  console.log('\n  private re-answers that each cost a live incident:');
  const RETIRED = [
    ['var _ackable = /',                            'v9.7.635 — the acknowledgment block\'s own source list'],
    ['/^\\s*(?:sent\\s+to|sent\\s+by)\\s*:/i.test(String(body || \'\'))',
                                                    'v9.7.638 — the topic scan\'s own our-own-send test'],
    ['concernScanLines.join(\' \').replace(_lpSrcNoise',
                                                    'v9.7.638 — the concern scanner reading our own outbound']
  ];
  for (const [shape, why] of RETIRED) {
    check('    gone: ' + why, code.indexOf(shape) >= 0, false);
  }

  // ── UNBOUNDED WILDCARDS IN CUSTOMER-TEXT DETECTORS ─────────────────────────
  // Family B's most reliable mechanism. `over.*budget` matched 600 characters across four messages
  // and two speakers; `ram` matched inside `Timeframe` (v9.7.555); `poi` inside `appointment`
  // (v9.7.554). A `.*` inside a pattern run against joined transcript text is the shape.
  console.log('\n  no unbounded wildcard in the joined-transcript detectors:');
  const priceLine = (code.match(/if\(\/too \(much\|high\|expensive\)[^\n]*\)\{/) || [''])[0];
  check('    the price/payment detector was found', priceLine.length > 0, true);
  check('    ...and contains no unbounded .*', /\.\*/.test(priceLine), false);
  check('    ...its wildcards are sentence-bounded', /\[\^\.!\?\\n\]\{0,\d+\}/.test(priceLine), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds answer each question the same way:');
  for (const q of QUESTIONS) {
    const counts = BUILDS.map(f => {
      const c = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      return c.split(q.owner).length - 1;
    });
    check('  ' + q.owner.replace('function ', '').replace('(', '') + ' — same count in both',
      counts.every(n => n === counts[0]), true);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
