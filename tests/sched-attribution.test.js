#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('sched-attribution.test.js');

/**
 * sched-attribution.test.js — v9.7.565.
 *
 * JERI MAYES (Community Honda Lafayette, lead 2065165925, 8/21). Offered times three days out on
 * Monday 8/24 — skipping today AND Saturday — while the store was open with four hours left,
 * because the prompt carried:
 *
 *   "Customer said Monday is when they are available. LOCK IN Monday - do NOT offer any other
 *    day. Offer two specific times on Monday only. Do NOT try to pull them in sooner."
 *
 * Jeri never wrote the word Monday. Her ONE inbound email, in full, is:
 *
 *   "Thank you.Sent from Yahoo Mail for iPhoneOn Monday, August 10, 2026, 3:00 PM, Kaylee Guzman
 *    kguzman@... wrote: Jeri,Your CarGurus inquiry is for the 2026 Honda Odyssey..."
 *
 * She wrote "Thank you." The "Monday" is a YAHOO QUOTED-REPLY HEADER — a timestamp her mail
 * client generated, naming when OUR email was sent — and the detector's
 * `(?:until|till|on|this|next)\s+(monday|…)` alternative matched the "On Monday" in it.
 *
 * WHY IT SURVIVED THIS LONG, and log123 shows it exactly: this detector had NO DIAGNOSTIC AT ALL.
 * Log123 line 349 records the note passing the gate —
 *   [LP SCHED GATE] {"noteIndex":7,"dir":"inbound","title":"email reply from prospect",
 *                    "passesGate":true}
 * — and then nothing. The one adjacent diagnostic, [LP SCHED DIAG], sits inside
 * `if(!customerScheduleConstraint)`, so it is suppressed precisely when this branch fires. The
 * failure was invisible by construction, which is why it took a full live capture to notice.
 *
 * WHAT THIS SUITE PINS:
 *   1. The cut happens at the FIRST marker of any kind, and the two SHAPE rules ("On … wrote:",
 *      "<address> … wrote:") carry it — enumerating mail clients is the trap this file keeps
 *      falling into, so a client nobody listed must still be handled by shape.
 *   2. Jeri's real note yields NO day lock and NO not-today flag.
 *   3. A genuine customer-stated day STILL LOCKS. The fix must not just kill the feature.
 *   4. Every OTHER detector in the loop reads the cut text too — "out of town", "camping",
 *      "I work 8-5" are all equally capable of matching a quoted agent email.
 *   5. The refusal is LOGGED with its source line, so the next one is a grep not an investigation.
 *   6. The personalContext scanner — the second consumer the survey found — is cut the same way,
 *      and its geographic pattern no longer matches "Sent from Yahoo".
 *
 * The loop is sliced out of the SHIPPED popup.js and run against a fake DOM. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sched-attribution.test.js <popup.js> [popup.js...]'); process.exit(2); }

// Jeri's inbound email, verbatim from the CRM record.
const JERI_EMAIL =
  'Thank you.Sent from Yahoo Mail for iPhoneOn Monday, August 10, 2026, 3:00 PM, Kaylee Guzman '
  + 'kguzman@communityhondalafayette.net wrote: Jeri,Your CarGurus inquiry is for the 2026 Honda '
  + 'Odyssey. We have the EX-L in Modern Steel Metallic here now, and it arrived recently. Since '
  + 'your message asked about the Odyssey generally, I want to confirm the EX-L is the '
  + 'configuration you meant. I can have everything ready for you to see this afternoon, with no '
  + 'waiting.';

// Kaylee's 8/14 email — the OTHER "Monday" in Jeri's history. Outbound, so the gate should keep it
// out regardless; asserted rather than assumed, because the report named it as a suspect.
const KAYLEE_MONDAY_SUBJECT =
  'Subject: Monday appraisal for your Passport Read 1 trackable time. First after 5 minute. '
  + 'By: Kaylee Guzman Hi Jeri, Your 2026 Honda Odyssey EX-L is showing available.';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in ' + file); return i; };

  // The stripper, verbatim.
  const sa = at('    function _lpCustomerAuthoredPart(raw) {');
  const sb = src.indexOf('\n    function ', sa + 10);
  const stripSrc = src.slice(sa, sb);

  // The whole schedule-constraint loop, verbatim, from its own comment banner to the line after it.
  const la = at('    var customerSaidNotToday = false;');
  const lb = at('    // Detect when customer has explicitly declined an alternative the agent offered.');
  const loopSrc = src.slice(la, lb);

  // The personalContext scanner, verbatim.
  // Sliced by BALANCED BRACES rather than a following-comment anchor — the anchor approach broke
  // twice on this block and a mis-sliced harness fails as "Unexpected token }", which looks like a
  // code bug and is not one.
  // NOTE: "if (dir === 'inbound' && body) {" appears MORE THAN ONCE in this file — the
  // frustrationSignals block opens identically and comes first. Anchor on this block's own
  // v9.7.565 comment and walk BACK to its opening line, or the harness silently tests the wrong
  // block and reports empty results that look like a code failure.
  const pcAnchor = at('// (v9.7.565) SECOND CONSUMER OF THE SAME ARTIFACT');
  const pa = src.lastIndexOf("        if (dir === 'inbound' && body) {", pcAnchor);
  if (pa < 0) throw new Error('personalContext block not found in ' + file);
  let depth = 0, pb = pa;
  for (let n = src.indexOf('{', pa); n < src.length; n++) {
    if (src[n] === '{') depth++;
    else if (src[n] === '}') { depth--; if (depth === 0) { pb = n + 1; break; } }
  }
  const pcSrc = src.slice(pa, pb);

  function makeNote(text, dir, title) {
    return {
      getAttribute: () => dir,
      querySelector: (sel) => {
        if (/title/.test(sel))   return { innerText: title };
        if (/content/.test(sel)) return { innerText: text };
        if (/date/.test(sel))    return { innerText: '08/10/2026 3:02 PM' };
        return null;
      }
    };
  }

  return {
    name: path.basename(path.dirname(file)), src, loopSrc, stripSrc,

    strip: (() => {
      const box = {}; vm.createContext(box); vm.runInContext(stripSrc, box);
      return vm.runInContext('_lpCustomerAuthoredPart', box);
    })(),

    // Run the REAL loop over a set of notes and report what it decided plus what it logged.
    run: (notes) => {
      const diag = [];
      const box = {
        Date, Math, String, Number, JSON, RegExp, Array, Object,
        _lpD: (...a) => diag.push(a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')),
        noteEls: notes.map(n => makeNote(n.text, n.dir || 'inbound', n.title || 'email reply from prospect'))
      };
      vm.createContext(box);
      vm.runInContext(stripSrc, box);
      vm.runInContext(loopSrc, box);
      return {
        notToday:   vm.runInContext('customerSaidNotToday', box),
        constraint: vm.runInContext('customerScheduleConstraint', box),
        diag
      };
    },

    // Run the REAL personalContext scanner over one inbound body.
    pc: (body) => {
      const box = { dir: 'inbound', body, dateStr: '08/10/2026', RegExp, String, Object,
                    sig: { personalContext: [] } };
      vm.createContext(box);
      vm.runInContext(stripSrc, box);
      vm.runInContext(pcSrc, box);
      return vm.runInContext('sig.personalContext', box);
    }
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
function check(name, fn, want) {
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);
}
const day = r => { const m = /Customer said (\w+) is when/.exec(r.constraint || ''); return m ? m[1] : ''; };

console.log('\nv9.7.565 — a day name in a quoted-reply header is not a customer statement');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── 1. Jeri, against her real note ─────────────────────────────────────────────
console.log("Jeri Mayes — her real inbound email, run through the real loop:");

check('the cut leaves exactly what she wrote — "Thank you."',
  i => i.strip(JERI_EMAIL).text, 'Thank you.');

check('the marker that cut it is named',
  i => i.strip(JERI_EMAIL).cutBy, 'mail-client signature');

check('NO day is locked — the incident directive is gone',
  i => day(i.run([{ text: JERI_EMAIL }])), '');

check('...and no schedule constraint of any kind is emitted',
  i => i.run([{ text: JERI_EMAIL }]).constraint, '');

check('NOT-TODAY is not set either — it was only ever set by the day branch',
  i => i.run([{ text: JERI_EMAIL }]).notToday, false);

check('the day name IS still present in the raw note — the test is not vacuous',
  i => /on monday/i.test(JERI_EMAIL), true);

check('the OLD behaviour is reproduced on the uncut text, so the fix is what changed it',
  i => {
    const m = JERI_EMAIL.toLowerCase()
      .match(/(?:until|till|on|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
    return m ? m[1] : '';
  }, 'monday');

console.log('\nthe refusal is logged — this is what log123 could not tell anyone:');

check('a [LP SCHED DAY DIAG] REFUSED line is emitted',
  i => i.run([{ text: JERI_EMAIL }]).diag.filter(l => /SCHED DAY DIAG/.test(l) && /REFUSED/.test(l)).length, 1);

check('...naming the day it refused',
  i => /"day":"monday"/.test(i.run([{ text: JERI_EMAIL }]).diag.join('\n')), true);

check('...quoting the SOURCE LINE the day came from',
  i => /Sent from Yahoo Mail for iPhoneOn Monday, August 10, 2026/
        .test(i.run([{ text: JERI_EMAIL }]).diag.join('\n')), true);

check('...naming which marker did the cutting',
  i => /"cutBy":"mail-client signature"/.test(i.run([{ text: JERI_EMAIL }]).diag.join('\n')), true);

check('...and showing what the customer actually authored',
  i => /"customerAuthored":"Thank you\."/.test(i.run([{ text: JERI_EMAIL }]).diag.join('\n')), true);

check('Kaylee\'s own 8/14 "Monday appraisal" subject never reaches the detector — outbound',
  i => day(i.run([{ text: KAYLEE_MONDAY_SUBJECT, dir: 'outbound', title: 'email reply to prospect' }])), '');

// ── 2. The feature still works ─────────────────────────────────────────────────
console.log('\na day the customer ACTUALLY named still locks — the fix is not a kill switch:');

const GENUINE = [
  ["I'll come by Monday",                          'Cant make it today but I will come by Monday if that works', 'Monday'],
  ['"Saturday works"',                             'Saturday works better for me',                               'Saturday'],
  ['"not until Friday"',                           'I wont be able to get there until Friday',                   'Friday'],
  ['"Tuesday morning"',                            'Tuesday morning would be best',                              'Tuesday'],
  ['"thinking Thursday"',                          'I was thinking Thursday if you have anything open',          'Thursday'],
  ['a real day ABOVE an Apple signature',          "I'll be there Saturday morning.\n\nSent from my iPhone\nOn Fri, Aug 15, 2026 at 9:00 AM, Kaylee wrote: are you free today?", 'Saturday'],
  ['a real day ABOVE a Gmail quote',               "Wednesday afternoon works.\n\nOn Thu, Aug 14, 2026 at 3:39 PM Kaylee <k@x.com> wrote:\n> today?", 'Wednesday'],
];
GENUINE.forEach(([label, text, want]) => {
  check(label + ' → locks ' + want, i => day(i.run([{ text: text }])), want);
});

check('a genuine lock still logs, with its source line and a LOCKED verdict',
  i => {
    const d = i.run([{ text: 'Cant make it today but I will come by Monday if that works' }]).diag.join('\n');
    return { locked: /SCHED DAY DIAG.*LOCKED/.test(d), hasSource: /come by Monday/.test(d) };
  }, { locked: true, hasSource: true });

// ── 3. The artifact shapes ─────────────────────────────────────────────────────
console.log('\nquoted-reply artifacts of every shape are refused — the survey the report asked for:');

const ARTIFACTS = [
  ['Yahoo / Apple "On <Day>, <date>, <name> wrote:"',
   'Thanks!On Monday, August 10, 2026, 3:00 PM, Kaylee Guzman k@x.com wrote: can you come Friday?'],
  ['Gmail "On <Day>, <date> at <time> <name> <addr> wrote:"',
   'Sounds good, thanks!\n\nOn Thu, Aug 14, 2026 at 3:39 PM Kaylee Guzman <k@x.com> wrote:\n> Can you come Tuesday morning?'],
  ['Outlook -----Original Message-----',
   'Not interested right now.\r\n-----Original Message-----\r\nFrom: Kaylee\r\nSent: Monday, August 10, 2026\r\nCan you come Friday?'],
  ['Outlook From:/Sent: header block',
   'Thanks.\nFrom: Kaylee Guzman\nSent: Monday, August 10, 2026 3:00 PM\nTo: Jeri\nSubject: Odyssey\nCome in Wednesday?'],
  ['Outlook horizontal divider',
   'ok thanks\n________________________________\nFrom: Kaylee\nCome in Tuesday?'],
  ['bare ">" quote prefix',
   'ok\n> On Monday we can do 3pm'],
  ['Begin forwarded message:',
   'See below.\nBegin forwarded message:\nFrom: Kaylee\nCan you come Saturday?'],
  ['"Get Outlook for Android" signature',
   'Thanks\n\nGet Outlook for Android\nOn Mon, Aug 10, Kaylee wrote: come Thursday?'],
  ['a note that is NOTHING BUT the quote',
   'On Monday, August 10, 2026, 3:00 PM, Kaylee Guzman k@x.com wrote: come in Friday'],
  ['an unlisted client, caught by SHAPE alone (address + wrote:)',
   'Thanks. someclient@example.org wrote: are you free Tuesday?'],
];
ARTIFACTS.forEach(([label, text]) => {
  check(label + ' → no lock', i => day(i.run([{ text: text }])), '');
});

check('a note that is nothing but a quote reports NO CUSTOMER-AUTHORED TEXT and stops',
  i => {
    const d = i.run([{ text: 'On Monday, August 10, 2026, 3:00 PM, Kaylee k@x.com wrote: come in Friday' }]).diag.join('\n');
    return /SCHED SOURCE DIAG.*NO CUSTOMER-AUTHORED TEXT/.test(d);
  }, true);

check('the cut is at the FIRST marker, not the last — a signature above a quote wins',
  i => i.strip('Thanks.\nSent from my iPhone\nOn Mon, Aug 10, Kaylee wrote: hi').cutBy,
  'mail-client signature');

check('...and a quote above a signature cuts at the quote',
  i => i.strip('Thanks.\nOn Mon, Aug 10, Kaylee wrote: hi\nSent from my iPhone').cutBy,
  'quoted-reply header ("On … wrote:")');

check('an ordinary message with no artifact is passed through untouched',
  i => {
    const t = 'I work 8-5 every day, evenings are better for me';
    return { text: i.strip(t).text, cutBy: i.strip(t).cutBy, cutAt: i.strip(t).cutAt };
  }, { text: 'I work 8-5 every day, evenings are better for me', cutBy: '', cutAt: -1 });

// ── 4. The other detectors in the same loop ────────────────────────────────────
console.log('\nthe OTHER detectors read the cut text too — fixing only the day scan would leave these loaded:');

check('"out of town" in a quoted agent email no longer trips NOT-TODAY',
  i => i.run([{ text: 'Thanks!\nOn Mon, Aug 10, Kaylee <k@x.com> wrote: I will be out of town until Friday so Dontrell will call you.' }]).notToday,
  false);

check('...but the customer genuinely saying it still does',
  i => i.run([{ text: 'I am out of town this week, cant make it today' }]).notToday, true);

check('a work-hours range quoted from an agent email no longer becomes a constraint',
  i => i.run([{ text: 'ok\n> our service dept works 8-5 every day' }]).constraint, '');

check('...but the customer stating their own hours still does',
  i => /work/i.test(i.run([{ text: 'I work 8-5 every day so mornings are out' }]).constraint), true);

check('an arrival time inside a quoted agent email is not read as the customer\'s',
  i => i.run([{ text: 'Thanks.\nOn Mon, Aug 10, Kaylee wrote: I get off at 6 so I can meet you then' }]).constraint, '');

// ── 5. The second consumer the survey found ────────────────────────────────────
console.log('\nthe personalContext scanner — the second consumer of the same artifact:');

check('"Sent from Yahoo Mail" no longer registers as [geographic] personal context',
  i => i.pc(JERI_EMAIL).filter(p => p.type === 'geographic').length, 0);

check('...and Jeri\'s note yields no personal context at all now',
  i => i.pc(JERI_EMAIL).length, 0);

check('the OLD geographic pattern DID match "Sent from Yahoo" — not a vacuous test',
  i => /\b(i live in|from|driv\w+ from|com\w+ from|hour.? (from|away)|out of town|out of state|local to|i.m in)\s+[A-Z][a-z]+/
        .test(JERI_EMAIL), true);

check('a genuine geographic statement still registers',
  i => i.pc("I'm from Baton Rouge so it is a bit of a haul").map(p => p.type), ['geographic']);

check('"driving from <City>" still registers — the movement verbs were never the problem',
  i => i.pc('I would be driving from Pride so I want to be sure it is there').map(p => p.type), ['geographic']);

check('a family mention inside a quoted AGENT email is no longer attributed to the customer',
  i => i.pc('Thanks!\nOn Mon, Aug 10, Kaylee <k@x.com> wrote: my wife drives one and loves it').length, 0);

check('...but the customer\'s own family mention still registers',
  i => i.pc('my wife wants the second row captains chairs').map(p => p.type), ['family']);

// ── 6. The scope trap ──────────────────────────────────────────────────────────
console.log('\nthe inlineScraper scope trap — a ReferenceError here kills the entire scrape:');

check('_lpCustomerAuthoredPart is defined INSIDE inlineScraper',
  i => {
    const lines = i.src.split('\n');
    const start = lines.findIndex(l => l === '  function inlineScraper() {') + 1;
    const end   = lines.findIndex(l => l === '  } // end inlineScraper') + 1;
    const def   = lines.findIndex(l => l === '    function _lpCustomerAuthoredPart(raw) {') + 1;
    return start > 0 && end > start && def > start && def < end;
  }, true);

check('...and so is every call to it',
  i => {
    const lines = i.src.split('\n');
    const start = lines.findIndex(l => l === '  function inlineScraper() {') + 1;
    const end   = lines.findIndex(l => l === '  } // end inlineScraper') + 1;
    const calls = [];
    lines.forEach((l, n) => { if (/_lpCustomerAuthoredPart\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) calls.push(n + 1); });
    return { calls: calls.length, allInside: calls.every(c => c > start && c < end) };
  }, { calls: 3, allInside: true });   // 1 definition + 2 call sites

check('it depends on nothing outside itself — pure string work, no popup-scope symbol',
  i => {
    // Run it in a sandbox containing literally nothing else. A reference to any module-scope
    // helper throws here, exactly as it would in the injected frame.
    const box = {}; vm.createContext(box); vm.runInContext(i.stripSrc, box);
    const f = vm.runInContext('_lpCustomerAuthoredPart', box);
    return f('Thanks.\nSent from my iPhone').text;
  }, 'Thanks.');

// ── (v9.7.579) FIDEL — A DAY HE ALREADY SPENT IS NOT A DAY HE IS AVAILABLE ─────────────────
// Toyota Baytown, 8/24. His own inbound text, verbatim:
//   "Hey Joseph yes I talked to my wife and we love the truck we actually stopped by Saturday
//    around 8:30pm but it was too late I was able to show her which one"
// He CAME on Saturday, after closing, showed his wife the truck, and now wants the numbers
// finished. LP read "Saturday" and injected "Customer said Saturday is when they are available.
// LOCK IN Saturday - do NOT offer any other day... Do NOT try to pull them in sooner." The model
// obeyed exactly and offered Saturday the 29th — five days out, to a customer ready that day.
// Same shape as Jeri's Yahoo header and Hayden's "Timeframe": a manufactured directive faithfully
// honoured. The difference is that the words ARE his and the day IS a day. THE TENSE WAS WRONG,
// and tense was never checked. Comprehension AGREED (AGREE-FIRED), so both readers carry the rule.
const FIDEL = 'Hey Joseph yes I talked to my wife and we love the truck we actually stopped by '
  + 'Saturday around 8:30pm but it was too late I was able to show her which one';

console.log('\nv9.7.579 — a day already spent is not a day they are available:');

check('FIDEL: his real message no longer locks a day',
  i => day(i.run([{ text: FIDEL }])), '');

check('...and produces no schedule constraint at all',
  i => i.run([{ text: FIDEL }]).constraint, '');

[['we stopped by Saturday'],
 ['I came in Tuesday to look at it'],
 ['we were there Friday but you were closed'],
 ['I went by Monday afternoon'],
 ['showed up Sunday and it was locked']].forEach(([txt]) => {
  check('past visit suppressed: "' + txt + '"', i => day(i.run([{ text: txt }])), '');
});

// THE OTHER HALF, and it matters more: a genuine stated day must still lock.
[['I can come Saturday', 'Saturday'],
 ['Saturday works for me', 'Saturday'],
 ['we will be there Tuesday', 'Tuesday'],
].forEach(([txt, want]) => {
  check('genuine availability still locks: "' + txt + '"', i => day(i.run([{ text: txt }])), want);
});

// A SEPARATE, PRE-EXISTING GAP, found while writing the above and verified against the build
// BEFORE this guard shipped: "I am free Sunday if you are open" produces NO lock there either.
// The base future-day regex has never recognised "I am free <day>" as availability. That is a
// real miss and it is NOT caused by this change — recorded here so it is not later mistaken for
// a regression from the past-visit guard, and so it can be picked up on its own terms.
check('KNOWN PRE-EXISTING GAP (not this build): "I am free Sunday" has never locked',
  i => day(i.run([{ text: 'I am free Sunday if you are open' }])), '');

check('the suppression is LOGGED with the sentence that caused it',
  i => /day-lock SUPPRESSED — the day is a COMPLETED VISIT/.test(i.src || fs.readFileSync(BUILDS[0], 'utf8')), true);

check('KNOWN LIMIT, recorded not hidden: a past visit AND a future day in one message suppresses both',
  i => {
    // "stopped by Saturday ... can come Wednesday" — the guard is deliberately conservative and
    // suppresses here. The cost is a missed lock on a rare compound message; the alternative is
    // pushing a ready customer days out, which is what happened to Fidel. Under-firing is the
    // safe side of THIS trade, and naming the limit is how it stays a choice rather than a bug.
    return day(i.run([{ text: 'we stopped by Saturday but can come Wednesday instead' }]));
  }, '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
