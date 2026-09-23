#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('bot-authorship.test.js');

/**
 * bot-authorship.test.js — v9.7.663. "THE SPORTAGE OPTION I SENT." NOBODY AT THE STORE SENT IT.
 *
 * LIVE, 9/16. Aimee Williams, Community Kia Baytown, lead 2081769045, on v9.7.662-dev. She is
 * thoroughly engaged — 25 inbound across the lead. At 10:19 AM the store's automated assistant
 * offered her a certified 2026 Sportage. One minute later the agent grabbed the lead and the draft
 * came back:
 *
 *   "I can have finance review your application and get a real number on your 2022 Seltos while
 *    you look at the Sportage option I sent."
 *
 * Gil: "it implies that we sent VOI options when it was actually the AI ... we want to keep the
 * flow especially when she's thoroughly engaged but our messaging needs to compliment and be
 * truthful at the same time."
 *
 * Two causes. v9.7.634 stripped the routing header off outbound transcript entries and took the
 * AUTHOR with it, so the Sportage message reached the model as an unattributed [AGENT] line. And
 * the one block that knows about the assistant is nested inside the anti-restate gate, which
 * requires no reply or a thin one — she replied, so it was unreachable.
 *
 * Executes BOTH copies of the detector, the shipped annotation, the shipped state line and the
 * shipped directive.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: bot-authorship.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const span = (mark, what, end) => {
    const a = src.indexOf(mark);
    if (a < 0) throw new Error(what + ' not found');
    const b = src.indexOf(end, a);
    if (b < 0) throw new Error(what + ' end not found');
    return src.slice(a, b + end.length);
  };
  // The POPUP copy — the original, from v9.7.639.
  const popup = span('function _lpAuthorRaw(msg) {', '_lpAuthorRaw', '\n}\n') + '\n'
    + span('var _LP_BOT_AUTHOR_RE =', '_LP_BOT_AUTHOR_RE', ';\n') + '\n'
    + span('function _lpIsBotAuthor(msg) {', '_lpIsBotAuthor', '\n}\n');
  // The SCRAPER copy — forced, because inlineScraper is injected and only its own body travels.
  const scraper = span('var _LP_SCRAPER_BOT_RE =', 'the scraper detector',
    '  } catch (e) { return false; }\n}');
  // The in-place annotation.
  const mark = span('      var _lpBotNote = false;', 'the transcript annotation', '\n      }');
  // The directive.
  // Ends at the RECENT OUTBOUND line that follows it; that trailing fragment is dropped so the
  // slice closes cleanly.
  const directive = span('  // ── (v9.7.663) THE STORE SENT IT. YOU DID NOT.', 'the authorship directive',
    '\n  if (d.isRecentOutbound').replace(/\n  if \(d\.isRecentOutbound$/, '');
  return { name: path.basename(path.dirname(file)), src, popup, scraper, mark, directive };
}

// ── REAL SHAPES, as the CRM writes them ─────────────────────────────────────
const BOT_SPORTAGE = 'Sent to: (936) 776-1049\nSent by: Vinessa Virtual Assistant Community Kia\nGreat news! We have a 2026 Kia Sportage LX in Glacial White Pearl with 4,360 miles - it’s certified pre-owned! Want to schedule a test drive?';
const BOT_NOTFIND  = 'Sent to: (936) 776-1049\nSent by: Vinessa Virtual Assistant Community Kia\nI’m not finding exactly what you’re looking for in our current inventory.';
const BOT_EMAIL    = 'Subject: Let’s Get You Behind the Wheel at Community Kia By: Vinessa Virtual Assistant Community Kia Hi Aimee, I’m Vinessa, Internet Sales Coordinator at Community Kia.';
const HUMAN_CHRIS  = 'Sent to: (936) 776-1049\nSent by: Christopher Linscomb\nOk, with the negative equity you will need around 5k down.';
const HUMAN_EVER   = 'Sent to: (936) 776-1049\nSent by: Ever Pereira\nAimee, this is Ever, Sales Manager at Community Kia.';
const NO_AUTHOR    = 'Great news! We have a 2026 Kia Sportage LX.';

function detectors(impl, opts) {
  const sb = { String, RegExp };
  vm.createContext(sb);
  const body = (opts && opts.mutate) ? opts.mutate(impl.scraper) : impl.scraper;
  vm.runInContext(impl.popup + '\n' + body, sb);
  return sb;
}
function both(impl, msg) {
  const sb = detectors(impl);
  sb.__m = msg;
  return [vm.runInContext('_lpScraperBotAuthor(__m)', sb), vm.runInContext('_lpIsBotAuthor(__m)', sb)];
}

// Runs the SHIPPED in-place annotation.
function annotate(impl, dir, content, opts) {
  const sb = {
    String, dir: dir, content: content,
    _lpStripNoteMeta: s => s,
    // The real strip removes the routing header — which is exactly why the flag is computed first.
    _lpStripRouting: s => String(s).replace(/(?:^|\n)\s*(?:Sent to:|Sent by:)\s*[^\n]*/gi, '').trim(),
  };
  vm.createContext(sb);
  const scr = (opts && opts.mutate) ? opts.mutate(impl.scraper) : impl.scraper;
  const blk = (opts && opts.mutateMark) ? opts.mutateMark(impl.mark) : impl.mark;
  vm.runInContext(scr + '\n' + blk, sb);
  return vm.runInContext('_annotatedContent', sb);
}

// Runs the SHIPPED directive.
function directive(impl, bodies, opts) {
  const logs = [];
  const sb = {
    String,
    d: { outboundSends: (bodies || []).map(b => ({ body: b })) },
    vehicleExtras: [],
    console: { log: (...x) => logs.push(x.join(' ')) },
  };
  vm.createContext(sb);
  vm.runInContext(impl.popup + '\n' + ((opts && opts.mutate) ? opts.mutate(impl.directive) : impl.directive), sb);
  const lines = vm.runInContext('vehicleExtras', sb);
  return { lines: lines, text: lines.join('\n'), logs: logs.join(' ') };
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

console.log('\nv9.7.663 — the store sent it, you did not');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE TWO COPIES MUST NOT DRIFT ───────────────────────────────────────
// inlineScraper is serialised and injected, so only its own body travels and it cannot call the
// popup's detector. The duplication is forced; this section is the whole defence against drift.
console.log('\n(1) the forced duplicate is byte-identical:');

check('the regex source matches character for character',
  i => { const sb = detectors(i); return vm.runInContext('_LP_SCRAPER_BOT_RE.source === _LP_BOT_AUTHOR_RE.source', sb); }, true);
check('...and so do the flags',
  i => { const sb = detectors(i); return vm.runInContext('_LP_SCRAPER_BOT_RE.flags === _LP_BOT_AUTHOR_RE.flags', sb); }, true);
check('the author extractor matches too',
  i => { const sb = detectors(i);
         const a = vm.runInContext('_lpAuthorRaw.toString().match(/match\\((\\/.*?\\/i)\\)/)[1]', sb);
         const b = vm.runInContext('_lpScraperBotAuthor.toString().match(/match\\((\\/.*?\\/i)\\)/)[1]', sb);
         return a === b; }, true);
check('the scraper copy really is inside inlineScraper',
  i => { const a = i.src.indexOf('\n  function inlineScraper() {');
         const b = i.src.indexOf('\n  } // end inlineScraper');
         const d = i.src.indexOf('function _lpScraperBotAuthor(msg) {');
         return a < d && d < b; }, true);
check('...and the popup copy really is outside it',
  i => { const a = i.src.indexOf('\n  function inlineScraper() {');
         const b = i.src.indexOf('\n  } // end inlineScraper');
         const d = i.src.indexOf('function _lpIsBotAuthor(msg) {');
         return !(a < d && d < b); }, true);

console.log('\n(2) both copies read the real shapes the same way:');
check('the Sportage text that caused this', i => both(i, BOT_SPORTAGE), [true, true]);
check('the assistant\'s earlier text', i => both(i, BOT_NOTFIND), [true, true]);
check('an assistant EMAIL, whose author sits in the body not the header', i => both(i, BOT_EMAIL), [true, true]);
check('the salesperson', i => both(i, HUMAN_CHRIS), [false, false]);
check('the sales manager', i => both(i, HUMAN_EVER), [false, false]);
check('a body with no author line at all', i => both(i, NO_AUTHOR), [false, false]);
check('degenerate input cannot throw', i => [both(i, ''), both(i, null)], [[false, false], [false, false]]);

// ── (3) THE MESSAGE CARRIES ITS OWN AUTHOR ──────────────────────────────────
console.log('\n(3) every bot send is marked where the model reads it:');

const MARKED = /AUTOMATED ASSISTANT, not by a person and not by you/;
check('the Sportage message is marked',
  i => MARKED.test(annotate(i, 'outbound', BOT_SPORTAGE)), true);
check('the routing header is still stripped, so the marker is the only author signal',
  i => /Sent by:/.test(annotate(i, 'outbound', BOT_SPORTAGE)), false);
check('the message text survives',
  i => /2026 Kia Sportage LX/.test(annotate(i, 'outbound', BOT_SPORTAGE)), true);
check('it says the content is still usable',
  i => /what it said is real and usable/.test(annotate(i, 'outbound', BOT_SPORTAGE)), true);
check('a human send is NOT marked',
  i => MARKED.test(annotate(i, 'outbound', HUMAN_CHRIS)), false);
check('an inbound message is never marked, whoever it was received by',
  i => MARKED.test(annotate(i, 'inbound', 'Received by: Vinessa Virtual Assistant Community Kia\nYes or sportage')), false);

// ── (4) THE DIRECTIVE ───────────────────────────────────────────────────────
console.log('\n(4) how to reference it truthfully:');

const A = i => directive(i, [BOT_SPORTAGE, BOT_NOTFIND, HUMAN_CHRIS]);

check('it fires when any visible send is the assistant\'s',
  i => [A(i).lines.length, /CAME FROM THE STORE.S AUTOMATED ASSISTANT/.test(A(i).text)], [1, true]);

// Gil's brief rules out disowning the thread.
check('it tells the model to build on them freely',
  i => /BUILD ON THEM FREELY/.test(A(i).text), true);
check('...and says why, in his terms',
  i => /pretending they did not happen would break a live conversation/.test(A(i).text), true);

// The one thing that was false.
check('it forbids the first person singular',
  i => /anything else in the FIRST PERSON SINGULAR about a message marked as the assistant/.test(A(i).text), true);
check('it names the exact phrase that shipped',
  i => /"the option I sent"/.test(A(i).text), true);
check('it gives the true phrasings instead',
  i => /"the one we sent over", "the option that came through this morning", "what you were just sent"/.test(A(i).text), true);
check('it states the rule in one line',
  i => /The STORE sent it, so "we" is honest; "I" is not/.test(A(i).text), true);

// A generic directive must not carry one lead's vehicle name — the model can copy it verbatim.
check('no vehicle name leaks into the generic directive',
  i => /Sportage|Seltos|Accord|Prelude/.test(A(i).text), false);

check('the diagnostic counts the sends',
  i => /bot-authored sends in the visible window: 2 of 3 \| directive emitted: true/.test(A(i).logs), true);

console.log('\n(5) silent on a lead no robot has touched:');
check('all-human sends emit nothing',
  i => directive(i, [HUMAN_CHRIS, HUMAN_EVER]).lines.length, 0);
check('...and say so in the log',
  i => /: 0 of 2 \| directive emitted: false/.test(directive(i, [HUMAN_CHRIS, HUMAN_EVER]).logs), true);
check('no sends at all cannot throw',
  i => [directive(i, []).lines.length, directive(i, null).lines.length], [0, 0]);

// ── (6) THE STATE LINE ──────────────────────────────────────────────────────
// It said "You ALREADY replied to it" about a reply the robot wrote.
//
// (v9.7.664) THIS SECTION USED TO READ THE SOURCE AND IT PROVED NOTHING. v9.7.663 asserted that
// the true branch's words were present and that the human branch was unchanged, and every one of
// those assertions passed against a branch that COULD NOT EXECUTE: it tested a variable declared
// ~520 lines further down, so it was hoisted-but-undefined and always false. Aimee's 9/16 capture
// shipped "You ALREADY replied to it" with sixteen assistant markers three hundred lines below it.
// Asserting a string is present is not asserting it can ship. This now EXECUTES the shipped loop
// and the shipped line together and asserts which branch comes out.
console.log('\n(6) the state line stops claiming the robot\'s reply (v9.7.664):');

function stateLine(impl, notes, opts) {
  // A minimal stand-in for the CRM note DOM: newest first, each with a direction, a title and a
  // content element. Only what the shipped loop actually reads.
  const el = n => ({
    getAttribute: () => n.dir,
    querySelector: sel => /title/.test(sel) ? { innerText: n.title }
                        : /item-date/.test(sel) ? { innerText: n.date || '' }
                        : { innerText: n.body || '' },
  });
  const a = impl.src.indexOf('        var _alreadyReplied = false;');
  const b = impl.src.indexOf('          keySignal = _alreadyReplied', a);
  // The assignment is one long concatenation; end it at its own terminating quote-semicolon.
  const c = impl.src.indexOf("React to the complete picture, not just one message.';", b);
  if (a < 0 || b < 0 || c < 0) throw new Error('the state-line region could not be sliced');
  // The region opens inside `if(!isStaleReply && !keySignalSuppressed){` and the slice ends before
  // that block's closing brace, so it is supplied here. Both guards are inputs to the harness.
  let body = impl.src.slice(a, impl.src.indexOf('\n', c)) + '\n}';
  if (opts && opts.mutate) body = opts.mutate(body);
  const sb = {
    String, Date, Math, RegExp,
    noteEls: notes.map(el),
    mostRecentInbound: 'Nice I love it',
    msgAgeLabel: ' [sent TODAY]',
    _multiBurst: false,
    keySignal: '',
    isStaleReply: false,
    keySignalSuppressed: false,
    // v9.7.663's dead read named this; it is hoisted-but-undefined at that point in the real file,
    // and the harness reproduces exactly that.
    lastOutboundMsg: undefined,
  };
  vm.createContext(sb);
  vm.runInContext(impl.scraper + '\n' + body, sb);
  return vm.runInContext('keySignal', sb);
}

const BOT_NOTE   = { dir: 'outbound', title: 'Outbound Text Message', body: BOT_SPORTAGE };
const HUMAN_NOTE = { dir: 'outbound', title: 'Outbound Text Message', body: HUMAN_CHRIS };
// (v9.7.696) The date was a literal 09/16/2026, and the shipped loop ages notes against Date.now(),
// so this suite started failing on its own on 9/23 — a clock time bomb, not a regression. It is now
// "one hour ago" in the CRM's own date format, so it is fresh on whatever day the suite runs.
const _inboundDate = (function () {
  const t = new Date(Date.now() - 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const h = t.getHours() % 12 || 12;
  return p(t.getMonth() + 1) + '/' + p(t.getDate()) + '/' + t.getFullYear() + ' ' + h + ':' + p(t.getMinutes()) + ' ' + (t.getHours() < 12 ? 'AM' : 'PM');
})();
const INBOUND    = { dir: 'inbound',  title: 'Inbound Text Message',  body: 'Nice I love it', date: _inboundDate };

check('Aimee\'s shape: the reply since her message was the assistant\'s',
  i => /YOU have not replied to this yet/.test(stateLine(i, [BOT_NOTE, INBOUND])), true);
check('...so it no longer claims she was answered',
  i => /You ALREADY replied to it/.test(stateLine(i, [BOT_NOTE, INBOUND])), false);
check('...and still allows building on what was sent',
  i => /Build on what the assistant said if it helps, but never as something you wrote/
        .test(stateLine(i, [BOT_NOTE, INBOUND])), true);

check('a HUMAN reply keeps the original wording, word for word',
  i => /You ALREADY replied to it \(see your most recent outbound in the transcript\);/
        .test(stateLine(i, [HUMAN_NOTE, INBOUND])), true);
check('...and does not get the assistant branch',
  i => /YOU have not replied to this yet/.test(stateLine(i, [HUMAN_NOTE, INBOUND])), false);

// Newest-first: the most recent outbound is the one that answers for the reply.
check('a human send NEWER than a bot send wins',
  i => /You ALREADY replied to it/.test(stateLine(i, [HUMAN_NOTE, BOT_NOTE, INBOUND])), true);
check('a bot send NEWER than a human send wins',
  i => /YOU have not replied to this yet/.test(stateLine(i, [BOT_NOTE, HUMAN_NOTE, INBOUND])), true);

// A phone-call attempt is not a written reply and must not set the flag either way (v9.7.300).
check('a voicemail attempt is not a reply at all',
  i => stateLine(i, [{ dir: 'outbound', title: 'Outbound phone call (Machine)', body: 'left message' }, INBOUND])
        .indexOf('CONVERSATION STATE') === -1, true);

// Call sites only — the v9.7.664 comment quotes the old dead call twice, which is prose.
check('exactly three call sites, no fourth copy of the detector',
  i => (i.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
          .match(/_lpScraperBotAuthor\(/g) || []).length, 3);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.663):');

// A: pin the scraper detector false and the Sportage message goes back to unattributed.
const NO_DETECT = c => c.replace('if (!m) return false;', 'if (m) return false;');
check('neuter A actually disabled the scraper detector', i => NO_DETECT(i.scraper) !== i.scraper, true);
check('A: the Sportage message loses its author entirely',
  i => { const t = annotate(i, 'outbound', BOT_SPORTAGE, { mutate: NO_DETECT });
         return [MARKED.test(t), /Sent by:/.test(t)]; }, [false, false]);
check('A (control): the shipped detector marks it',
  i => MARKED.test(annotate(i, 'outbound', BOT_SPORTAGE)), true);

// B: remove the annotation and the strip alone leaves nothing behind.
const NO_MARK = c => c.replace('if (_lpBotNote) {', 'if (false) {');
check('neuter B actually removed the annotation', i => NO_MARK(i.mark) !== i.mark, true);
check('B: this is exactly what v9.7.662 shipped — an unattributed agent message',
  i => { const t = annotate(i, 'outbound', BOT_SPORTAGE, { mutateMark: NO_MARK });
         return [MARKED.test(t), /Sent by:/.test(t), /2026 Kia Sportage LX/.test(t)]; },
  [false, false, true]);

// C: pin the count to zero and the directive disappears.
const NO_COUNT = c => c.replace('if (_lpBotSendCount > 0) {', 'if (false) {');
check('neuter C actually removed the directive', i => NO_COUNT(i.directive) !== i.directive, true);
check('C: nothing tells the model who wrote what',
  i => directive(i, [BOT_SPORTAGE, HUMAN_CHRIS], { mutate: NO_COUNT }).lines.length, 0);
check('C (control): the shipped block speaks',
  i => directive(i, [BOT_SPORTAGE, HUMAN_CHRIS]).lines.length, 1);

// D (v9.7.664): put the dead read back. lastOutboundMsg is hoisted-but-undefined at this point in
// the real file, and the harness supplies exactly that, so this reproduces the branch that could
// never fire — and this section, unlike the source scan it replaced, catches it.
const DEAD_READ = c => c.replace('(_lpReplyWasBot ?', '(_lpScraperBotAuthor(lastOutboundMsg) ?');
check('neuter D actually restored the v9.7.663 read',
  i => DEAD_READ(i.src.slice(i.src.indexOf("' + (_lpReplyWasBot ? '") - 5)).indexOf('_lpScraperBotAuthor(lastOutboundMsg)') >= 0, true);
check('D: the dead branch ships "You ALREADY replied to it" on Aimee\'s shape',
  i => /You ALREADY replied to it/.test(stateLine(i, [BOT_NOTE, INBOUND], { mutate: DEAD_READ })), true);
check('D: ...and never reaches the assistant branch at all',
  i => /YOU have not replied to this yet/.test(stateLine(i, [BOT_NOTE, INBOUND], { mutate: DEAD_READ })), false);
check('D (control): the shipped read gets it right',
  i => /YOU have not replied to this yet/.test(stateLine(i, [BOT_NOTE, INBOUND])), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
