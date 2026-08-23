#!/usr/bin/env node
'use strict';
/**
 * delivery-match.test.js — v9.7.570, DRAFTED vs DELIVERED, PHASE A ONLY.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────
 * Lead Pro scores itself on what it PRODUCED. The agent then edits in VinSolutions and sends.
 * Nothing has ever compared the two — so on 8/22 a wrong store name in eight email signatures
 * read as an 89% positive rate and a 95% shipped rate, because every one of those was copied and
 * then quietly corrected before it went out. The copy button measures intent to use, not quality.
 *
 * ── WHY PHASE A IS ONLY THE MATCHER ───────────────────────────────────────────────────────
 * Pairing a sent message to the draft that produced it is the entire risk in this idea. An agent
 * may send something hand-written, send nothing, send hours later, or send from another tool. A
 * WRONG PAIRING PRODUCES CONFIDENTLY WRONG EDIT DATA — it would report that an agent rewrote a
 * draft they never saw. That is materially worse than no data, and it is the same shape as the
 * v9.7.564 fabricated-agreement series, which looked like a healthy corpus for four builds.
 *
 * So the rule is REFUSE RATHER THAN GUESS, and this suite is mostly about the refusals. Three of
 * the four outcomes are refusals; that ratio is the design, not a shortfall.
 *
 * Phase B (classify the delta) and Phase C (verbatim-send rate) are deliberately NOT built and
 * must not be until this matcher's false-match rate is known on real traffic.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: delivery-match.test.js <popup.js> [popup.js...]'); process.exit(2); }

// A real LP SMS, shape and all — canonical stacked signature included.
const DRAFT_SMS = 'Destini, the 2024 Accord you asked about is here and I can have everything '
  + 'ready so you are not waiting. What day works best for you this week?\nRotaxlyn\n'
  + 'Community Honda Lafayette\n337-205-8301';
const DRAFT_EMAIL = 'Subject: The 2024 Accord you asked about\n\nHi Destini,\n\nThe 2024 Accord '
  + 'you asked about is here, and I can have everything ready so you are not waiting.\n\n'
  + 'What day works best for you this week?\n\nRotaxlyn Hudson\nInternet Sales Coordinator\n'
  + 'Community Honda Lafayette\n337-205-8301';

const T0 = 1787000000000;
const N = (title, body, offsetMin) => ({ title, body, ms: T0 + offsetMin * 60000 });

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in ' + file); return i; };
  const a = at('// ── (v9.7.570) DRAFTED vs DELIVERED — PHASE A');
  const b = at('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');
  const blockSrc = src.slice(a, b);

  function box() {
    const logs = [];
    const sb = { console: { log: (...x) => logs.push(x.join(' ')) }, JSON, String, Number, Object, Array, RegExp, Math };
    vm.createContext(sb);
    vm.runInContext(blockSrc, sb);
    sb.__logs = logs;
    return sb;
  }

  return {
    name: path.basename(path.dirname(file)), src, blockSrc,
    match: (draft, notes, opts) => {
      const sb = box();
      return vm.runInContext('(function(d,n,o){ return _lpMatchDelivered(d,n,o); })', sb)(draft, notes, opts || { generatedAtMs: T0 });
    },
    observe: (draft, notes, opts, flagOn) => {
      const sb = box();
      if (flagOn) vm.runInContext('LEADPRO_DELIVERY_MATCH = true;', sb);
      const logs = [];
      const r = vm.runInContext('(function(d,n,o){ return _lpRunDeliveryMatch(d,n,o); })', sb)(
        draft, notes, Object.assign({ generatedAtMs: T0, log: (...x) => logs.push(x.join(' ')) }, opts || {}));
      return { r, logs };
    },
    read: (expr) => vm.runInContext(expr, box()),
    fn: (name) => vm.runInContext(name, box())
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

console.log('\nv9.7.570 Phase A — the matcher, and only the matcher');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── It is off, and it is only an observer ─────────────────────────────────────
console.log('containment — Phase A observes and nothing else:');

check('the flag ships OFF', i => i.read('LEADPRO_DELIVERY_MATCH'), false);

check('with the flag off it produces nothing at all',
  i => { const o = i.observe({ sms: DRAFT_SMS }, [N('outbound text message', DRAFT_SMS, 2)]); return { r: o.r, logs: o.logs.length }; },
  { r: null, logs: 0 });

check('the block contains no fetch and no persistence — it is console-only',
  i => (i.blockSrc.match(/\bfetch\(|_lpSendCommitComprehension|localStorage|chrome\.storage/g) || []).length, 0);

check('nothing outside the block calls the matcher',
  i => {
    const a = i.src.indexOf('// ── (v9.7.570) DRAFTED vs DELIVERED — PHASE A');
    const b = i.src.indexOf('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');
    const outside = i.src.slice(0, a) + i.src.slice(b);
    return (outside.match(/_lpMatchDelivered\(|_lpRunDeliveryMatch\(/g) || []).length;
  }, 0);

check('the containment check is not vacuous — the block really is there',
  i => i.blockSrc.length > 4000, true);

// ── The one match it should make ──────────────────────────────────────────────
console.log('\nthe MATCHED case — and it must be the only one that matches:');

check('a verbatim send matches, and is reported as verbatim',
  i => {
    const r = i.match({ sms: DRAFT_SMS }, [N('outbound text message', DRAFT_SMS, 2)]).sms;
    return { verdict: r.verdict, identical: r.identical };
  }, { verdict: 'MATCHED', identical: true });

check('an EDITED send still matches, and is reported as edited',
  i => {
    const edited = DRAFT_SMS.replace('Community Honda Lafayette', 'Community Honda Baytown');
    const r = i.match({ sms: DRAFT_SMS }, [N('outbound text message', edited, 3)]).sms;
    return { verdict: r.verdict, identical: r.identical };
  }, { verdict: 'MATCHED', identical: false });

check('the signature is normalised away, so a signature-only edit still reads as the same message',
  i => {
    // This is the 8/22 case: body identical, store name corrected by hand. It must MATCH —
    // otherwise the very defect this feature exists to measure would read as "rewrote it".
    const edited = DRAFT_SMS.replace('Community Honda Lafayette', 'Community Honda Baytown')
                            .replace('337-205-8301', '281-837-3384');
    return i.match({ sms: DRAFT_SMS }, [N('outbound text message', edited, 1)]).sms.verdict;
  }, 'MATCHED');

check('email matches on its own channel',
  i => i.match({ email: DRAFT_EMAIL }, [N('email reply to prospect', DRAFT_EMAIL, 5)]).email.verdict, 'MATCHED');

// ── The refusals, which are most of the design ────────────────────────────────
console.log('\nthe REFUSALS — three of four outcomes, deliberately:');

check('no outbound at all → NO-SEND, not a match and not a failure',
  i => i.match({ sms: DRAFT_SMS }, []).sms.verdict, 'NO-SEND');

check('a send that PREDATES the generation is never credited',
  i => i.match({ sms: DRAFT_SMS }, [N('outbound text message', DRAFT_SMS, -5)]).sms.verdict, 'NO-SEND');

check('a send outside the window is not credited',
  i => i.match({ sms: DRAFT_SMS }, [N('outbound text message', DRAFT_SMS, 120)]).sms.verdict, 'NO-SEND');

check('TWO plausible sends → AMBIGUOUS, refused rather than picking the closer one',
  i => {
    const r = i.match({ sms: DRAFT_SMS }, [
      N('outbound text message', DRAFT_SMS, 2),
      N('outbound text message', DRAFT_SMS.replace('this week', 'today'), 4)
    ]).sms;
    return { verdict: r.verdict, candidates: r.candidates };
  }, { verdict: 'AMBIGUOUS', candidates: 2 });

check('a completely different message → NO-MATCH, with the best score reported',
  i => {
    const r = i.match({ sms: DRAFT_SMS }, [N('outbound text message',
      'Reminder: your service appointment is confirmed for Thursday morning at the Baytown location', 3)]).sms;
    return { verdict: r.verdict, hasBest: typeof r.best === 'number' };
  }, { verdict: 'NO-MATCH', hasBest: true });

check('a channel LP produced nothing on is NO-DRAFT, not NO-SEND',
  i => i.match({ sms: DRAFT_SMS }, [N('outbound text message', DRAFT_SMS, 2)]).email.verdict, 'NO-DRAFT');

check('a voicemail/call log is never treated as a send',
  i => i.match({ sms: DRAFT_SMS }, [N('outbound phone call (machine)', DRAFT_SMS, 2)]).sms.verdict, 'NO-SEND');

check('an SMS draft is never matched against an EMAIL note',
  i => i.match({ sms: DRAFT_SMS }, [N('email reply to prospect', DRAFT_SMS, 2)]).sms.verdict, 'NO-SEND');

check('every refusal carries a reason a human can read',
  i => {
    const cases = [
      i.match({ sms: DRAFT_SMS }, []).sms,
      i.match({ sms: DRAFT_SMS }, [N('outbound text message', 'totally unrelated service reminder text here', 3)]).sms,
      i.match({ sms: DRAFT_SMS }, [N('outbound text message', DRAFT_SMS, 2), N('outbound text message', DRAFT_SMS, 4)]).sms
    ];
    return cases.map(c => !!(c.reason && c.reason.length > 15));
  }, [true, true, true]);

// ── The scoring, which has to be explainable ──────────────────────────────────
console.log('\nthe overlap score — explainable, and not inflated by function words:');

check('two DIFFERENT dealership messages do not score as the same message',
  i => {
    const ov = i.fn('_lpDeliveryOverlap')(
      'Thanks for reaching out about the Accord. Would you like to come see it this week?',
      'Thanks for reaching out about the Telluride. Are you still shopping for a minivan?');
    return ov.score < 0.55;
  }, true);

check('short function words are excluded, so a shared preamble cannot carry a match',
  i => {
    const ov = i.fn('_lpDeliveryOverlap')('the and for you are with that this have from',
                                          'the and for you are with that this have from');
    return { score: ov.score, anchors: ov.anchors };
  }, { score: 0, anchors: 0 });

// The two inputs must differ ONLY in the URL and the phone. An earlier version of this changed a
// real word too ("or call" vs "call") and failed — which looked like a normaliser bug and was a
// fixture bug: the normaliser had correctly preserved a genuine difference.
check('URLs and phone numbers are normalised out — LP rewrites those itself',
  i => {
    const norm = i.fn('_lpDeliveryNorm');
    return norm('See https://x.com/a?b=1 or call (337) 205-8301 today')
        === norm('See https://y.com/zz-different or call 281-837-3384 today');
  }, true);

check('...but a real word difference is NOT normalised away',
  i => {
    const norm = i.fn('_lpDeliveryNorm');
    return norm('See or call today') === norm('See call today');
  }, false);

check('the compliance footer LP appends is normalised out too',
  i => {
    const norm = i.fn('_lpDeliveryNorm');
    return norm('Come see us today.\n\nReply STOP to cancel.') === norm('Come see us today.');
  }, true);

check('empty or missing text never throws and never scores',
  i => [null, undefined, '', '   '].map(t => i.fn('_lpDeliveryOverlap')(t, DRAFT_SMS).score), [0, 0, 0, 0]);

// ── The log, which is how the refusal rate becomes visible ────────────────────
console.log('\nthe log — a refusal must be as loud as a match:');

check('a MATCHED line names verbatim-vs-edited and the shared anchors',
  i => {
    const o = i.observe({ sms: DRAFT_SMS }, [N('outbound text message', DRAFT_SMS, 2)], {}, true);
    const l = o.logs.join('\n');
    return { matched: /sms → MATCHED/.test(l), verbatim: /SENT VERBATIM/.test(l), shared: /shared:\[/.test(l) };
  }, { matched: true, verbatim: true, shared: true });

check('an EDITED match reports both lengths, so the size of the edit is visible',
  i => {
    const edited = DRAFT_SMS.replace('this week', 'tomorrow afternoon if that suits you better');
    const o = i.observe({ sms: DRAFT_SMS }, [N('outbound text message', edited, 2)], {}, true);
    return /EDITED \(draft \d+ chars, sent \d+\)/.test(o.logs.join('\n'));
  }, true);

check('a refusal logs its reason rather than going quiet',
  i => {
    const o = i.observe({ sms: DRAFT_SMS }, [], {}, true);
    return /sms → NO-SEND \| no outbound sms on this lead within 45 min/.test(o.logs.join('\n'));
  }, true);

check('BOTH channels report every run — silence on one would hide half the rate',
  i => {
    const o = i.observe({ sms: DRAFT_SMS, email: DRAFT_EMAIL }, [], {}, true);
    return o.logs.filter(l => /\[LP DELIVERY MATCH\]/.test(l)).length;
  }, 2);

check('the observer never throws on malformed notes',
  i => {
    const o = i.observe({ sms: DRAFT_SMS }, [null, {}, { title: null, body: null, ms: 'x' }], {}, true);
    return o.logs.filter(l => /\[LP DELIVERY MATCH\]/.test(l)).length;
  }, 2);

// ── The scraper carrier ───────────────────────────────────────────────────────
console.log('\nthe carrier — the matcher reads real sends, not a 300-char truncation:');

check('the scraper collects outboundSends with title, ms and body',
  i => /outboundSends\.push\(\{ title: niOutTitle\.substring\(0,80\), ms: niDateMs,/.test(i.src), true);

check('call logs and voicemails are excluded at the carrier, not downstream',
  i => /if\(!niOutIsCallLog && niOutBody && outboundSends\.length < 8\)\{/.test(i.src), true);

check('it is returned by the scraper',
  i => {
    const a = i.src.indexOf('conversationBrief, customerSaidNotToday');
    return /outboundSends/.test(i.src.slice(a, a + 240));
  }, true);

check('it is capped, so a long history cannot bloat the scrape payload',
  i => /outboundSends\.length < 8/.test(i.src) && /niOutBody\.substring\(0,2000\)/.test(i.src), true);

// ── (v9.7.570) THE SIGNATURE FIX THAT CAME OUT OF THE SAME INVESTIGATION ─────
console.log('\nthe email signature — the store must come from the LEAD, never the agent:');

// LIVE 8/22: eight emails on Honda Baytown and Kia Baytown leads signed "Community Toyota-
// Baytown". PHONE_DIR had Patricia right; all 22 delivered prompts carried the right store in the
// EMAIL SIGNATURE block. The defect was in enforceEmailPhone's store chain, whose last fallback
// was _leadProProfile.store — the AGENT'S HOME STORE — so a resolution miss signed Patricia's
// own rooftop onto whatever lead she was working.
check('the email path resolves the store from DEALER_ID_MAP, keyed on THIS lead',
  i => {
    const a = i.src.indexOf('function enforceEmailPhone(');
    const b = i.src.indexOf('\n  function ', a + 10);
    return /_did && typeof DEALER_ID_MAP === 'object' && DEALER_ID_MAP\[_did\]/.test(i.src.slice(a, b));
  }, true);

check('the agent-profile fallback is GONE from the email signature path, not merely demoted',
  i => {
    const a = i.src.indexOf('function enforceEmailPhone(');
    const b = i.src.indexOf('\n  function ', a + 10);
    const body = i.src.slice(a, b).replace(/^\s*\/\/.*$/gm, '');
    // It may still be READ for the diagnostic comparison; it must never be ASSIGNED to the store.
    return /_storeName\s*=\s*[^;]*_leadProProfile/.test(body);
  }, false);

check('...and the diagnostic reports when the agent home store differs from the lead store',
  i => /agent home store differs from lead store/.test(i.src), true);

check('DEALER_ID_MAP still holds the five canonical rooftops, hard-coded',
  i => {
    const m = i.src.match(/const DEALER_ID_MAP = \{[\s\S]*?\};/);
    return (m ? (m[0].match(/'[^']+':\s*'Community [^']+'|'[^']+':\s*'Audi [^']+'/g) || []).length : 0);
  }, 5);

check('the SMS path is untouched — it was already correct and is the reference implementation',
  i => {
    const a = i.src.indexOf('function enforceSmsSig(');
    const b = i.src.indexOf('\n  function ', a + 10);
    return /if \(dealerId && DEALER_ID_MAP\[dealerId\]\) \{\s*\n\s*storeName = DEALER_ID_MAP\[dealerId\];/.test(i.src.slice(a, b));
  }, true);

check('the system prompt store also prefers the hard-coded map now',
  i => /_sysDid && typeof DEALER_ID_MAP === 'object' && DEALER_ID_MAP\[_sysDid\]/.test(i.src), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
