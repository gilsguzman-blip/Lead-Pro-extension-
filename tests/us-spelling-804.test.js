#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('us-spelling-804.test.js');
// (v9.7.804) AMERICAN SPELLING, ALWAYS. Honda Baytown lead 2097505088 (log330): the draft asked "What year range or colour
// should I watch for?" and the email's subject read "A used Land Cruiser in the right colour" -- the model took the British
// spelling from Lead Pro's own instruction. Gil, 10/16: "we should always use American spellings of all words." The LANGUAGE
// rules in the main prompt and the text rewrite now say so, the instructions the model reads are written that way, and every
// draft passes through _lpAmericanSpelling before it renders. Executes _lpAmericanSpelling, buildSystemPrompt, buildUserPrompt
// and _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/us-spelling-804.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: us-spelling-804.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const BRIT = /\b(?:colou?rs?\b(?<=colours?)|favourite|centre|apologis\w*|recognis(?:e|ed)\b|organis\w*|cancelled|labelled|acknowledgement|enquir\w*|licence|tyres?\b)/i;
const E = (when, tag, title, body) => '[' + when + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/09/2026 5:16 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const HIST = E('10/12/2026 2:00 PM', 'AGENT', 'Outbound phone call (Contacted)', "By: Rep Name Wife wants a used landcruiser, told them about the one at Toyota but they don't want black") + MARK;
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Honda CR-V Hybrid TrailSport',
  condition: 'New', stockNum: '', vin: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Facebook', convState: 'active-follow-up', leadAgeDays: 6,
  hasOutbound: true, hasCustomerReply: false, totalNoteCount: 9, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] },
  history: HIST, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + HIST + '---' }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const fn = (name) => { try { return run(name); } catch (e) { return null; } };
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  for (const id of ['6189', '6190', '6191']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };

  console.log(' 1. the backstop on every draft (new helper):');
  const us = fn('_lpAmericanSpelling');
  check('lead 2097505088: "What year range or colour should I watch for?" -> color; "A used Land Cruiser in the right colour" -> color', () =>
    quiet(() => [us('Test, what year range or colour should I watch for?'), us('Subject: A used Land Cruiser in the right colour')]),
    ['Test, what year range or color should I watch for?', 'Subject: A used Land Cruiser in the right color']);
  check('the common ones, with the case kept: Favourite, COLOURS, apologise, organised, cancelled, travelling, enquiry, licence, tyres, centre, acknowledgement', () =>
    quiet(() => us('Favourite COLOURS: apologise, organised, cancelled, travelling, enquiry, licence, tyres, centre, acknowledgement.')),
    'Favorite COLORS: apologize, organized, canceled, traveling, inquiry, license, tires, center, acknowledgment.');
  check('control: words that are the same in American English are untouched -- our, hour, your, four, tour, advertise, promise, exercise, cancellation, controlled', () =>
    quiet(() => us('our hour your four tour advertise promise exercise cancellation controlled')), 'our hour your four tour advertise promise exercise cancellation controlled');
  check('control: a factory paint name keeps its own spelling ("Magnetic Grey Metallic")', () => quiet(() => us('the Magnetic Grey Metallic one')), 'the Magnetic Grey Metallic one');
  check('every draft passes through it before it renders: text, email and voicemail (source)', () =>
    // (v9.7.842) _lpHouseGuard may sit between the finance guard and the spelling pass.
    [/_lpFinanceGuard\((?:_lpHouseGuard\()?\(\(typeof _lpAmericanSpelling === 'function'\) \? _lpAmericanSpelling\(cleanOutput\(rawSms, true\)\)/.test(src),
     /_lpFinanceGuard\((?:_lpHouseGuard\()?\(\(typeof _lpAmericanSpelling === 'function'\) \? _lpAmericanSpelling\(cleanOutput\(rawEmail, false\)\)/.test(src),
     /_lpFinanceGuard\((?:_lpHouseGuard\()?\(\(typeof _lpAmericanSpelling === 'function'\) \? _lpAmericanSpelling\(vmText\)/.test(src)], [true, true, true]);

  console.log(' 2. the prompts ask for it, and are written that way:');
  const sys = quiet(() => sb.__lp.buildSystemPrompt(LEAD()));
  check('the main LANGUAGE rule: AMERICAN ENGLISH SPELLING, ALWAYS -- color, favorite, center ... never colour, favourite, centre ...', () =>
    /AMERICAN ENGLISH SPELLING, ALWAYS: color, favorite, center, apologize, recognize, organize, canceled, labeled, acknowledgment, inquiry, license -- never colour, favourite, centre/.test(sys), true);
  check('the text rewrite\'s LANGUAGE rule says it too', () =>
    /Spell it the American way: color, favorite, center, apologize, canceled -- never colour/.test(quiet(() => run('buildSystemPromptSmsRefine')('Agent', 'Community Honda Baytown', '(555) 010-0100'))), true);
  check('lead 2097505088\'s prompt asks "year range or color" -- the British spelling the draft copied is gone', () => {
    const p = quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); const d = LEAD(); sb.populateFromData(d); return sb.__lp.buildUserPrompt(Object.assign({}, d, { context: run('leadContext') })); });
    return [/Ask what year range or color they would like/.test(p), /year range or colour/.test(p)]; }, [true, false]);
  check('no British spelling left in a model-facing string of the source (diagnostic log lines aside)', () => {
    const bad = []; src.split('\n').forEach((l, i) => { if (i < 400 || /^\s*\/\//.test(l) || /console\.(?:log|warn)|_lpD\(|_ackLog\(|\[LP [A-Z0-9 -]+DIAG\]|LP_US_SPELLING|never colour|'asked-about-colour'|'colour not recorded'|SKIPPED a colour|colour drives|raised colour\.'|The colour is NOT settled|a colour was asked for|no colour in the feed|no unit colour/.test(l)) return;
      if (/'[^']*\b(?:colour|favourite|apologise|recognise|cancelled|labelled|acknowledgement)\b[^']*'/i.test(l)) bad.push(i + 1); });
    return bad; }, []);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
