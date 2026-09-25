#!/usr/bin/env node
'use strict';
// (v9.7.634) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('routing-header.test.js');

/**
 * routing-header.test.js — v9.7.634. THE CRM'S SMS ROUTING HEADER WAS BEING READ AS SPEECH.
 *
 * MEASURED: 1,795 of these across 68 prompt captures — roughly 26 per prompt — in exactly one
 * phone format. They reach the model INSIDE the customer's and the agent's own quoted words:
 *
 *   [09/04/2026 9:55 AM] [CUSTOMER] Inbound Text Message
 *     Received from: (832) 724-6322 Received by: Tania Gonzalez STOP
 *
 * WHERE IT ACTUALLY HURT — the self-consistency block quotes our prior outbound at a 120-character
 * cap under the heading "these are commitments on the record". Carlos (Kia Baytown, 2026 K5
 * GT-Line, 9/5):
 *
 *   WE SAID IT SOLD: "Sent to: (346) 579-4102 Sent by: Jocelyne Martinez Carlos that car has
 *                     sold, but I have another white one premium pkg wi"
 *
 * 120/120 characters, truncated, and the half that survived is 51 characters of routing metadata.
 * The block exists to stop us contradicting what we told the customer, and it severed the part
 * that says what we offered him instead of the sold car.
 *
 * TWO CAUSES, AND I INITIALLY BLAMED ONLY THE FIRST:
 *   (1) the routing header eating the 120-char budget, and
 *   (2) the claim patterns' OWN {0,40}/{0,50} tails — a second, tighter bound that severed
 *       "with black interior" regardless of the header. Stripping the metadata alone left the
 *       quote ending at "premium p". Both are fixed; the tail is widened to 90 so the 120-char
 *       slice is the single stated bound.
 *
 * WHOLE-LINE, DECIDED BY THE DOM RATHER THAN GUESSED. VinSolutions renders the header in its own
 * child elements —
 *     <div class="legacy-notes-and-history-item-extra-buttons">Sent to: (727) 244-3456</div>
 *     <div>Sent by: Elsa McHaney</div>Hi this is Elsa with Community Honda - ...
 * — so innerText yields two clean lines ahead of the body, and the strip is whole-line with no
 * name-boundary guessing. Flattened, "Jocelyne Martinez Carlos that car..." has no recoverable
 * boundary and guessing would delete the CUSTOMER'S OWN NAME from the message; the flattened form
 * is therefore left alone, asserted.
 *
 * Executes the SHIPPED helpers and the SHIPPED claim matcher. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: routing-header.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('routing-header.test.js', m);

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    function _lpIsRoutingLine(line) {');
  const b = src.indexOf('    function _lpStripNoteMeta(str) {', a);
  if (a < 0 || b < 0) bail('routing helpers not in ' + file);
  const sb = { String, RegExp };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b), sb);
  // The full note-meta function too, so the inbound path is exercised as shipped.
  const c = src.indexOf("      return s.replace(/^\\s*Subject:\\s*Re\\s*:[^\\n]*?(?=\\bBy:)/i, '')", b);
  const d = src.indexOf('\n    }', c);
  if (c < 0 || d < 0) bail('note-meta tail not in ' + file);
  vm.runInContext(src.slice(b, d + 6), sb);
  return {
    src,
    isRouting: vm.runInContext('_lpIsRoutingLine', sb),
    stripRouting: vm.runInContext('_lpStripRouting', sb),
    stripMeta: vm.runInContext('_lpStripNoteMeta', sb),
  };
}

// The DOM shape, verified against a real VinSolutions dump.
const CARLOS = 'Sent to: (346) 579-4102\nSent by: Jocelyne Martinez\n'
  + 'Carlos that car has sold, but I have another white one premium pkg with black interior.';
const ISAAC = 'Received from: (832) 724-6322\nReceived by: Tania Gonzalez\nSTOP';

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — routing metadata is not speech');

  // ── THE CLASSIFIER ─────────────────────────────────────────────────────────
  console.log('\nwhat counts as a routing line:');
  for (const l of ['Sent to: (346) 579-4102', 'Received from: (832) 724-6322',
                   'Sent by: Jocelyne Martinez', 'Received by: Tania Gonzalez',
                   'Sent to: (727) 244-3456  ', 'Sent By: Elsa McHaney'])
    check('  routing: ' + JSON.stringify(l.trim().slice(0, 34)), B.isRouting(l), true);

  // The false-positive traps. A customer really can open a message with these words.
  console.log('\n...and what is a customer sentence that merely starts the same way:');
  for (const l of ['Sent to: my wife for approval, she said go ahead and we will come Saturday',
                   'Received from: the bank, my approval came through this morning',
                   'Sent by carrier pigeon apparently, still waiting on that quote',
                   'Received by 3pm would be great if you can manage it',
                   'Sent to: him already',
                   'Received from: my trade appraisal came back low'])
    check('  content: ' + JSON.stringify(l.slice(0, 34)), B.isRouting(l), false);

  // ── THE STRIP ──────────────────────────────────────────────────────────────
  console.log('\nCarlos, in the shape the DOM actually produces:');
  const cs = B.stripRouting(CARLOS);
  check('the phone number is gone', /\(346\) 579-4102/.test(cs), false);
  check('the agent name is gone', /Jocelyne Martinez/.test(cs), false);
  check("the customer's own name survives", /^Carlos/.test(cs), true);
  check('...and so does the whole message', cs,
    'Carlos that car has sold, but I have another white one premium pkg with black interior.');

  console.log('\nIsaac — a one-word message buried in 55 characters of metadata:');
  check('the STOP survives alone', B.stripRouting(ISAAC), 'STOP');
  check('...and through the inbound path too', B.stripMeta(ISAAC), 'STOP');

  // ── WHAT MUST NOT BE TOUCHED ───────────────────────────────────────────────
  console.log('\nthe flattened form is deliberately left alone:');
  const flat = 'Sent to: (346) 579-4102 Sent by: Jocelyne Martinez Carlos that car has sold';
  check('no newline, no strip', B.stripRouting(flat), flat);
  check('...because the name/body boundary is unknowable there',
    /flattened: the name\/body boundary is unknowable/.test(B.src), true);

  console.log('\nv9.7.623 is not reopened — outbound keeps its subject:');
  const outb = 'Sent to: (346) 579-4102\nSent by: Elsa McHaney\nSubject: Re:Your Pilot inquiry\nHi there';
  const os = B.stripRouting(outb);
  check('routing goes', /579-4102/.test(os), false);
  check('...but the subject stays', /Subject: Re:Your Pilot inquiry/.test(os), true);
  check('...and the body stays', /Hi there/.test(os), true);
  // The inbound path still removes the subject, as v9.7.623 decided.
  check('inbound still loses Subject: Re:', /Subject:/.test(B.stripMeta(outb)), false);
  check('the transcript wires them separately',
    /\(dir === 'inbound'\) \? _lpStripNoteMeta\(content\) : _lpStripRouting\(content\)/.test(B.src), true);

  console.log('\nother metadata handling is unchanged:');
  check('By: still goes on the inbound path',
    /By:/.test(B.stripMeta('By: Tania Gonzalez\nwhat is the price')), false);
  check('...and _lpStripRouting leaves By: alone — it is not routing',
    /By:/.test(B.stripRouting('By: Tania Gonzalez\nwhat is the price')), true);
  check('only the leading block is scanned — a later line is never touched',
    /Sent by: someone/.test(B.stripRouting('a\nb\nc\nSent by: someone')), true);

  console.log('\nit never throws:');
  check('empty', B.stripRouting(''), '');
  check('null', B.stripRouting(null), '');
  check('a header with no body', B.stripRouting('Sent to: (346) 579-4102\nSent by: Elsa McHaney'), '');

  // ── THE SECOND TRUNCATION ──────────────────────────────────────────────────
  console.log('\nthe claim tails no longer sever the offer:');
  const SOLD = /[^.!?]{0,70}\b(?:has sold|is sold|already sold|has been sold|no longer available|sold already)\b[^.!?]{0,90}/i;
  const q = t => { const m = t.match(SOLD); return m ? String(m[0]).replace(/\s+/g, ' ').trim().slice(0, 120) : ''; };
  const after = q(B.stripRouting(CARLOS));
  check('the commitment is complete', after,
    'Carlos that car has sold, but I have another white one premium pkg with black interior');
  check('...and no longer hits the 120 cap', after.length < 120, true);
  check('what we offered instead survives', /black interior/.test(after), true);
  check('all three claim patterns share the widened tail',
    (B.src.match(/\[\^\.!\?\]\{0,90\}/g) || []).length, 3);
  check('the old 40-char tail is gone', /sold already\)\\b\[\^\.!\?\]\{0,40\}/.test(B.src), false);
  check('the matchers read the stripped content, not the raw note',
    (B.src.match(/_scM = _scContent\.match/g) || []).length, 3);
  check('...and none still reads `content` directly', /_scM = content\.match/.test(B.src), false);
  // THE ANCHOR MUST EXIST BEFORE ITS POSITION MEANS ANYTHING. indexOf returns -1 when the string
  // is absent, and -1 < <any positive> is TRUE — so an ordering check written as a bare comparison
  // PASSES when the thing it is ordering has been deleted. Found by the neuter that replaces
  // `_scContent = _lpStripRouting(content)` with `_scContent = content`: the suite went 42/42
  // green with the strip gone. Existence is asserted separately now, which is the assertion that
  // actually fails on that neuter.
  const iStrip = B.src.indexOf('var _scContent = _lpStripRouting(content);');
  check('the content really is stripped before the matchers run', iStrip > -1, true);
  check('...and the strip precedes them', iStrip > -1 && iStrip < B.src.indexOf('_scM = _scContent.match'), true);

  // ── ONE DEFINITION ─────────────────────────────────────────────────────────
  console.log('\none definition of "this line is routing metadata":');
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('the classifier is defined once', (code.match(/function _lpIsRoutingLine/g) || []).length, 1);
  check('...and both strippers route through it',
    (code.match(/_lpIsRoutingLine\(/g) || []).length >= 3, true);
  // ON CODE. Several build headers quote the string "'} // end inlineScraper' marker", so a raw
  // indexOf finds a COMMENT at the top of the file and the position test is meaningless. Sixth
  // time this week (v9.7.563, .631, .632, .633 ×2, here) — in a file whose headers quote its own
  // code, every source-position assertion has to strip comments first. No exceptions from now on.
  check('the helpers sit inside inlineScraper, where their callers are',
    code.indexOf('function _lpIsRoutingLine') < code.indexOf('} // end inlineScraper'), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds strip identically:');
  const region = (f) => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf('    function _lpIsRoutingLine(line) {');
    const b = s.indexOf("        return kept.concat(lines.slice(3)).join('\\n');", a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('dev and commercial are identical', region(BUILDS[0]) === region(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
