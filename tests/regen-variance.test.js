#!/usr/bin/env node
'use strict';
// (v9.7.612) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('regen-variance.test.js');

/**
 * regen-variance.test.js — v9.7.688. A REGEN THAT CANNOT SEE WHAT IT ALREADY WROTE.
 *
 * LIVE, 9/22. Christina, Community Kia Baytown, lead 2059585201. A 55-day ghost: 23 outreaches
 * across five staff, not one inbound message from her, correctly gated to PHASE 5 -- GRACEFUL
 * CLOSE-OUT by _lpCloseOutEligible. Melanie generated six messages between 12:36 and 12:38, moved
 * off five of them, and sent the sixth by hand at 12:39.
 *
 * ALL SIX ARE THE SAME MOVE:
 *   1. "should I close out your request for the 2026 Kia Carnival, or leave it open for you?"
 *   2. "I'm going to step back so I don't keep filling your inbox. Should I close out ...?"
 *   3. "I don't want to keep sending messages that aren't useful. Would you like me to close out ...?"
 *   4. "are you still interested in the 2026 Kia Carnival LX FWD, or should I close out your inquiry?"
 *   5. "I can close out your ... inquiry so I'm not filling your inbox, or keep it open ...?"
 *   6. "would you like me to close out your 2026 Kia Carnival LX FWD inquiry, or keep it open?"
 *
 * THE WORDING VARIED AND THE MOVE DID NOT. Consecutive drafts score jaccard 0.29-0.44, squarely
 * inside the range of the day's other (accepted) regen pairs -- so a lexical variance check calls
 * these healthy. They are not. Every one asks "close out or keep open?".
 *
 * TWO CAUSES, BOTH FIXED HERE, PLUS A RULE THAT WAS BEING WALKED AROUND:
 *
 * (1) A PLAIN REGEN RE-SENT THE SAME PROMPT. _leadProPriorDraft has existed since v9.7.312 and is
 *     read in exactly ONE place -- the feedback payload. Nothing ever put it into the prompt. The
 *     only regen-aware block is TONE ADJUSTMENT, gated on _lpRegenDirective, which a plain
 *     Regenerate never sets (v9.7.584's own note). So "your message must feel DIFFERENT from every
 *     previous attempt" could only ever mean the CRM outreach history -- never the drafts the agent
 *     had just rejected, because those had never been in the prompt.
 *
 * (2) PHASE 5 CARRIED ONE WORKED EXAMPLE and the model read it as a template. The enumeration trap
 *     of v9.7.552-555 with a list of one.
 *
 * (3) THE "ARE YOU STILL INTERESTED?" BAN WAS A QUOTED STRING, so draft 4 added words and walked
 *     through it. It was not alone: lead 2067774680 (Honda Lafayette, 39d, 1:30 PM) SHIPPED "Are
 *     you still looking, or should I close this out?" the same day.
 *
 * This suite EXECUTES the shipped history collector and the shipped prompt block. Source position
 * alone would be satisfied by a block that never runs, which is the v9.7.563 false-green shape.
 * Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: regen-variance.test.js <popup.js> [popup.js...]'); process.exit(2); }

// (v9.7.630) THE PROSE-MATCH HAZARD. Build headers quote the file's own code, and they accumulate
// at the top forever. Every scan below runs against the body BELOW the last header line, so a
// future header that quotes one of these anchors cannot satisfy — or break — an assertion here.
function bodyOf(src) {
  const i = src.lastIndexOf('// Lead Pro -- popup.js  v');
  if (i < 0) throw new Error('no build header found — wrong file?');
  const j = src.indexOf('\n', i);
  return src.slice(j < 0 ? i : j + 1);
}

function slice(body, startNeedle, backTo, endNeedle, what) {
  const k = body.indexOf(startNeedle);
  if (k < 0) throw new Error(what + ' not found (start)');
  const a = backTo ? body.lastIndexOf(backTo, k) : k;
  if (a < 0) throw new Error(what + ' not found (open)');
  const e = body.indexOf(endNeedle, k);
  if (e < 0) throw new Error(what + ' not found (end)');
  return body.slice(a, e + endNeedle.length);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const body = bodyOf(src);

  // The whole pair-capture IIFE from generateAll: the regen-strip gate, the v9.7.683 scrub, the
  // v9.7.688 history collector and the lead-change reset. Lifted entire so the GATING is under
  // test, not just the push.
  // The OUTER IIFE ends at the last `})();` before the regen-session flag that follows it. An
  // indent-based needle is not enough: the v9.7.688 collector is itself an IIFE nested inside this
  // one, and a plain search finds the inner close first and truncates the block.
  const cStart = body.lastIndexOf('(function(){', body.indexOf("var _rs = document.getElementById('regenStrip');"));
  const cAfter = body.indexOf('// Track if this is a regen', cStart);
  if (cStart < 0 || cAfter < 0) throw new Error('pair-capture IIFE not found');
  const cEnd = body.lastIndexOf('})();', cAfter);
  const capture = body.slice(cStart, cEnd + '})();'.length);
  if (capture.indexOf('_lpDraftHistory') < 0) throw new Error('v9.7.688 draft history missing from the capture block');

  // The prompt block. Lifted as an expression so it can be called directly.
  const promptBlk = slice(body,
    'var _dh = (typeof window', '(function(){',
    'return out;\n    })()', 'draft-history prompt block');

  // The v9.7.692 variance diag reads the same list; lifted so the containment check below can
  // tell an intended reader from a stray one.
  let variance = '';
  const vk = body.indexOf("var _rvHist = (typeof window !== 'undefined'");
  if (vk >= 0) {
    const va = body.lastIndexOf('(function () {', vk);
    const ve = body.indexOf('    })();', vk);
    if (va >= 0 && ve >= 0) variance = body.slice(va, ve + '    })();'.length);
  }

  return { name: path.basename(path.dirname(file)), src, body, capture, promptBlk, variance };
}

// ── harness ───────────────────────────────────────────────────────────────────────────────
// A NAME-AWARE scrubber, like the shipped one: it can only replace a name it is given. This is
// what proves the history inherits v9.7.683's capture-time scrub rather than re-opening it.
function runCapture(impl, { stripVisible, sms, email, vm: vmText, leadId, name, history }) {
  const logs = [];
  const els = {
    regenStrip: { classList: { contains: c => stripVisible && c === 'visible' } },
    'output-sms': { value: sms || '' },
    'output-email': { value: email || '' }
  };
  const scrub = t => (name ? String(t || '').split(name).join('[NAME]') : String(t || ''));
  const sb = {
    String, Array, RegExp, JSON,
    window: { _lpDraftHistory: history ? history.slice() : undefined },
    document: { getElementById: id => els[id] || null },
    lastScrapedData: { autoLeadId: leadId || '', name: name || '' },
    _lpScrubPII: scrub,
    _lpVmForLead: () => vmText || '',
    console: { log: (...a) => logs.push(a.join(' ')) }
  };
  vm.createContext(sb);
  vm.runInContext(impl.capture, sb);
  return { history: sb.window._lpDraftHistory, prior: sb.window._leadProPriorDraft, logs };
}

function runPrompt(impl, history, regenDirective) {
  const sb = { String, Array,
               window: { _lpDraftHistory: history, _lpRegenDirective: regenDirective || '' } };
  vm.createContext(sb);
  return vm.runInContext('(' + impl.promptBlk + ')', sb);
}

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

// Christina's real ladder, SMS only, in the order the export carries them.
const D = [
  '[NAME], should I close out your request for the 2026 Kia Carnival, or leave it open for you?',
  '[NAME], I’m going to step back so I don’t keep filling your inbox. Should I close out your 2026 Kia Carnival LX FWD inquiry?',
  '[NAME], I don’t want to keep sending messages that aren’t useful. Would you like me to close out your 2026 Kia Carnival inquiry?',
  '[NAME], are you still interested in the 2026 Kia Carnival LX FWD, or should I close out your inquiry?',
  '[NAME], I can close out your 2026 Kia Carnival inquiry so I’m not filling your inbox, or keep it open if you’re still interested. Which would you prefer?',
  '[NAME], would you like me to close out your 2026 Kia Carnival LX FWD inquiry, or keep it open?'
];

console.log('\nv9.7.688 — a regen can see the drafts the agent already rejected');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── THE COLLECTOR ─────────────────────────────────────────────────────────────────────────
console.log('the collector, driven through Christina\'s six generations:');

check('generation 1 — strip hidden, nothing recorded and prior is null',
  i => { const r = runCapture(i, { stripVisible: false, sms: '' });
         return [r.history, r.prior]; }, [[], null]);

check('generation 2 — the draft on screen becomes history entry 1',
  i => runCapture(i, { stripVisible: true, sms: D[0], history: [] }).history, [D[0]]);

check('the full six-generation ladder records the five that were replaced',
  i => { let h = [];
         for (let n = 0; n < 5; n++) h = runCapture(i, { stripVisible: true, sms: D[n], history: h }).history;
         return h; }, [D[0], D[1], D[2], D[3], D[4]]);

check('a fresh grab (strip hidden) CLEARS the history — one lead\'s drafts are never another\'s',
  i => runCapture(i, { stripVisible: false, sms: D[0], history: [D[0], D[1]] }).history, []);

check('an unchanged draft is not recorded twice — a chip can fire without the text moving',
  i => runCapture(i, { stripVisible: true, sms: D[0], history: [D[0]] }).history, [D[0]]);

check('the history is capped at 6 and drops the oldest',
  i => { let h = ['a','b','c','d','e','f'];
         return runCapture(i, { stripVisible: true, sms: 'g', history: h }).history; },
  ['b','c','d','e','f','g']);

check('an empty draft is not recorded — the v9.7.604 empty-generation shape adds no noise',
  i => runCapture(i, { stripVisible: true, sms: '   ', history: [D[0]] }).history, [D[0]]);

check('whitespace and newlines are collapsed so the list stays one line per draft',
  i => runCapture(i, { stripVisible: true, sms: 'Hello\n  there\n\nMelanie', history: [] }).history,
  ['Hello there Melanie']);

check('an over-long draft is truncated rather than dropped',
  i => { const long = 'x'.repeat(400);
         const h = runCapture(i, { stripVisible: true, sms: long, history: [] }).history;
         return [h.length, h[0].length, h[0].slice(-1)]; }, [1, 321, '…']);

// ── PII: THE HISTORY INHERITS v9.7.683, IT DOES NOT RE-OPEN IT ────────────────────────────
console.log('\n  the name is already gone by the time it is recorded (v9.7.683, v9.7.489 posture):');

check('a real first name in the on-screen draft is scrubbed before it enters the history',
  i => runCapture(i, { stripVisible: true, name: 'Christina',
                       sms: 'Christina, should I close this out?', history: [] }).history,
  ['[NAME], should I close this out?']);

check('...and the same scrubbed text is what the feedback pair stores — one capture, one scrub',
  i => { const r = runCapture(i, { stripVisible: true, name: 'Christina',
                                   sms: 'Christina, should I close this out?', history: [] });
         return r.history[0] === r.prior.sms; }, true);

check('the diagnostic reports COUNT and LENGTHS only — never the draft text',
  i => { const r = runCapture(i, { stripVisible: true, name: 'Christina',
                                   sms: 'Christina, should I close this out?', history: [] });
         const l = r.logs.join(' ');
         return [/\[LP DRAFT HISTORY DIAG\] drafts this session:1/.test(l),
                 /close this out/.test(l), /Christina/.test(l)]; }, [true, false, false]);

check('the first generation says so rather than printing an empty list',
  i => /none — first generation for this lead/.test(
         runCapture(i, { stripVisible: false, sms: '' }).logs.join(' ')), true);

// ── THE PROMPT BLOCK ──────────────────────────────────────────────────────────────────────
console.log('\n  the block that puts them in front of the model:');

check('no history → the block renders NOTHING (a first generation is unchanged)',
  i => runPrompt(i, []).length, 0);

check('five rejected drafts → all five reach the prompt, oldest first, numbered',
  i => { const out = runPrompt(i, D.slice(0, 5)).join('\n');
         return [/1\. .*leave it open for you\?/.test(out),
                 /5\. .*Which would you prefer\?/.test(out),
                 out.indexOf(D[0]) < out.indexOf(D[4])]; }, [true, true, true]);

check('it names the count and says the agent sent none of them',
  i => /You have written 5 messages for this lead in this session and the agent did not send any of them/
         .test(runPrompt(i, D.slice(0, 5)).join('\n')), true);

check('a single rejected draft reads in the singular',
  i => /You have written 1 message for this lead in this session and the agent did not send it/
         .test(runPrompt(i, [D[0]]).join('\n')), true);

check('it tells the model the move is what is being rejected, not the phrasing',
  i => /REWORDING IS NOT REGENERATING/.test(runPrompt(i, D.slice(0, 5)).join('\n')), true);

check('it forbids a paraphrase of any listed draft',
  i => /must not be a paraphrase of any line above/.test(runPrompt(i, D.slice(0, 5)).join('\n')), true);

check('it warns that [NAME] is an artefact of the list and not a format to copy',
  i => /ARTEFACT OF THIS LIST, NOT A FORMAT TO COPY/.test(runPrompt(i, D.slice(0, 5)).join('\n')), true);

// THE WHOLE POINT: this must fire on the path that has no chip.
check('it fires on a PLAIN regen — no chip, no _lpRegenDirective',
  i => runPrompt(i, D.slice(0, 5), '').length > 0, true);

check('...and on a chip regen too, alongside the TONE ADJUSTMENT block',
  i => runPrompt(i, D.slice(0, 5), 'Make it shorter.').length > 0, true);

// ── PHASE 5 NOW HAS MORE THAN ONE WAY TO BE ITSELF ────────────────────────────────────────
console.log('\n  PHASE 5 offers four moves, not one worked example:');

// (v9.7.691) Window widened from 3000 to 4400. The rung gained the one-reply test sentence and
// the tail of the v9.7.583 safety language crossed the old boundary mid-sentence — the guard was
// still present at offset 2981 and the assertion failed on the slice, not on the code.
const p5 = body => body.slice(body.indexOf("stalledPhase = 'PHASE 5 -- GRACEFUL CLOSE-OUT'"),
                              body.indexOf("stalledPhase = 'PHASE 5 -- GRACEFUL CLOSE-OUT'") + 4400);

check('the single "e.g." template that every draft landed on is GONE',
  i => /e\.g\. "I have not heard back, so I will stop filling your inbox/.test(p5(i.body)), false);

check('four lettered moves are offered',
  i => ['(A) THE RECORD', '(B) THE TIMING', '(C) THE LAST USEFUL THING', '(D) THE CHANNEL']
         .every(m => p5(i.body).indexOf(m) >= 0), true);

check('they are named as alternatives, and the model is told to pick one',
  i => /FOUR DIFFERENT MOVES DO THAT, AND THEY ARE ALTERNATIVES -- PICK ONE/.test(p5(i.body)), true);

check('it says rewording a move already used is what the agent just rejected',
  i => /rewording the same move is what the agent just rejected/.test(p5(i.body)), true);

// v9.7.583's safety language is load-bearing and must survive this edit.
check('the Andrea Pardon guard survives — assert nothing about why they went quiet',
  i => /ASSERT NOTHING about what they did or why they went quiet/.test(p5(i.body)), true);
check('...and the no-vehicle-no-outcome rule survives',
  i => /Do NOT name a vehicle, a dealership, or an outcome the customer has not stated themselves/
         .test(p5(i.body)), true);
check('...and the rung is still gated on _lpCloseOutEligible',
  i => /var _p5Elig = _lpCloseOutEligible\(data\);/.test(i.body), true);

// ── THE BAN IS A TEST NOW, NOT A STRING ───────────────────────────────────────────────────
console.log('\n  "are you still interested?" is banned by shape, not by quotation:');

check('the ban is stated as a test the model applies to its own sentence',
  i => /THE TEST IS NOT THE WORDS, IT IS THE QUESTION/.test(i.body), true);

check('the hole draft 4 went through is closed by name',
  i => /Putting the vehicle inside it does not make it a different question/.test(i.body), true);

check('the paraphrases that shipped on 9\/22 are covered',
  i => ['still looking', 'still shopping', 'still in the market'].every(s => i.body.indexOf('"' + s + '"') >= 0), true);

check('the old bare quoted-string ban is gone',
  i => /DO NOT ask "are you still interested\?" DO NOT repeat/.test(i.body), false);

check('...but "do not repeat what previous messages said" is kept',
  i => /DO NOT repeat what previous messages said/.test(i.body), true);

// PHASE 2 carries its own copy of the prohibition and is NOT in scope here.
check('PHASE 2\'s own wording is untouched',
  i => /Ask ONE low-effort question\. NOT "are you still interested\?"/.test(i.body), true);

// ── WIRING ────────────────────────────────────────────────────────────────────────────────
console.log('\n  wiring — a correct block that is never reached decides nothing (v9.7.561):');

check('the prompt block sits in the same lines.push argument list as TONE ADJUSTMENT',
  i => { const a = i.body.indexOf('TONE ADJUSTMENT (REGENERATE)');
         const b = i.body.indexOf('DRAFTS YOU ALREADY WROTE FOR THIS LEAD');
         const c = i.body.indexOf("'Return ONLY the JSON object");
         return a > 0 && b > a && c > b; }, true);

check('the history is maintained INSIDE generateAll, after the flush (v9.7.644 ordering)',
  i => { const g = i.body.indexOf('async function generateAll()');
         const r = i.body.indexOf('_lpFeedbackReset();', g);
         const h = i.body.indexOf('_lpDraftHistory', g);
         return g > 0 && r > g && h > r; }, true);

// A magic occurrence count would drift with any comment edit. What matters is CONTAINMENT: every
// mention lives inside one of the two blocks under test, so no third place can quietly read or
// write this list — the duplication shape census.test.js exists to prevent.
// (v9.7.692) A THIRD SPAN, AND IT IS A READER. The regen variance diag compares the new draft
// against this same list — it never writes it. The containment rule is what caught it when it was
// added, which is the assertion working: a new site has to be named here on purpose rather than
// appearing quietly.
check('every _lpDraftHistory mention is inside the collector, the prompt block or the variance diag',
  i => { const spans = [i.capture, i.promptBlk, i.variance];
         let n = 0, from = 0, loose = 0;
         for (;;) {
           const k = i.body.indexOf('_lpDraftHistory', from);
           if (k < 0) break;
           n++; from = k + 1;
           const line = i.body.slice(i.body.lastIndexOf('\n', k) + 1, i.body.indexOf('\n', k));
           if (!spans.some(s => s.indexOf(line.trim()) >= 0)) loose++;
         }
         return [n > 0, loose]; }, [true, 0]);

// ── NON-VACUITY ───────────────────────────────────────────────────────────────────────────
// Each neuter is a BEHAVIOURAL revert of one decision, paired with a control that must stay green.
console.log('\nnon-vacuity — reverting each decision must fail assertions by name:');

function neuter(label, mutate, probe, wantBroken, control, wantControl) {
  const results = impls.map(i => {
    let m;
    try { m = mutate(Object.assign({}, i)); } catch (e) { return 'MUTATE THREW: ' + e.message; }
    let broken, ctl;
    try { broken = JSON.stringify(probe(m)); } catch (e) { broken = 'THREW'; }
    try { ctl = JSON.stringify(control(m)); } catch (e) { ctl = 'THREW'; }
    return JSON.stringify([broken !== JSON.stringify(wantBroken), ctl === JSON.stringify(wantControl)]);
  });
  report(label, results, [true, true]);
}

neuter('A — collector never pushes → the prompt block goes silent (control: capture still works)',
  i => Object.assign(i, { capture: i.capture.replace('window._lpDraftHistory.push(_dhs);', '') }),
  i => { let h = [];
         for (let n = 0; n < 5; n++) h = runCapture(i, { stripVisible: true, sms: D[n], history: h }).history;
         return runPrompt(i, h).length > 0; }, true,
  i => runCapture(i, { stripVisible: true, sms: D[0], history: [] }).prior.sms, D[0]);

neuter('B — no reset on a fresh grab → one lead\'s drafts leak into the next (control: push still works)',
  i => Object.assign(i, { capture: i.capture.replace(/window\._lpDraftHistory = \[\];\n(\s*)\}/, '$1}') }),
  i => runCapture(i, { stripVisible: false, sms: D[0], history: [D[0], D[1]] }).history, [],
  i => runCapture(i, { stripVisible: true, sms: D[0], history: [] }).history, [D[0]]);

neuter('C — block gated on the chip directive → the PLAIN regen path gets nothing (control: chip path still fires)',
  i => Object.assign(i, { promptBlk: i.promptBlk.replace('if (!_dh.length) return [];',
                                                         'if (!_dh.length || !window._lpRegenDirective) return [];') }),
  i => runPrompt(i, D.slice(0, 5), '').length > 0, true,
  i => runPrompt(i, D.slice(0, 5), 'Make it shorter.').length > 0, true);

neuter('D — the cap removed → an all-day session floods the prompt (control: dedupe still holds)',
  i => Object.assign(i, { capture: i.capture.replace(/if \(window\._lpDraftHistory\.length > 6\) window\._lpDraftHistory\.shift\(\);/, '') }),
  i => runCapture(i, { stripVisible: true, sms: 'g', history: ['a','b','c','d','e','f'] }).history,
  ['b','c','d','e','f','g'],
  i => runCapture(i, { stripVisible: true, sms: D[0], history: [D[0]] }).history, [D[0]]);

neuter('E — scrub dropped at capture → a real name enters the history (control: the list still builds)',
  i => Object.assign(i, { capture: i.capture.replace("sms:_lpScrubPII(_g('output-sms'))", "sms:_g('output-sms')") }),
  i => runCapture(i, { stripVisible: true, name: 'Christina',
                       sms: 'Christina, should I close this out?', history: [] }).history,
  ['[NAME], should I close this out?'],
  i => runCapture(i, { stripVisible: true, sms: D[0], history: [] }).history.length, 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
