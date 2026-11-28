#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('concrete-initial-896.test.js');
// (v9.7.896) FOUR FIXES FROM THE 11/25 REPORT. Owner, 11/26: "build 896 with items 1-3 add the expand tweak and warmth".
// (1) The question names what it asks about: every unsent session on 11/25 ended on an open-ended question about the process
// (Toyota 3122201006, Kia 3122170874). (2) A first name that is only an initial is no name (Edmunds 3122173227 opened "T,").
// (3) "With no specific vehicle attached, ..." is the CRM talking; only the clause goes. (4) Expand adds warmth, and on a step-back
// message warmth instead of a vehicle fact (Cargurus 2105888147). Placeholder data only.
//
// Usage: node tests/concrete-initial-896.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: concrete-initial-896.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 27, 14, 0);
const E = (day, clock, tag, title, body) => '[' + day + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (day) => '[' + day + ' 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const NEW = E('11/27/2026', '1:50 PM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the CR-V EX.') + MARK('11/27/2026');
const FOLLOW = E('11/24/2026', '10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, thanks for asking about the CR-V EX. Is it still on your list?') + E('11/23/2026', '9:30 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the CR-V EX.') + MARK('11/23/2026');
const LEAD = (h, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX', condition: 'New', dealerId: '6191',
  store: 'Community Honda Baytown', leadSource: 'Honda.com', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199',
  email: 'test@example.com', customerZip: '12345', relationshipSignals: { unansweredQuestions: [] }, conversationBrief: h, history: h, context: '', autoLeadId: 'TEST017S', outboundSends: [] }, x || {});
const FOLLOW_LEAD = (x) => LEAD(FOLLOW, Object.assign({ convState: 'active-follow-up', hasOutbound: true, leadAgeDays: 4, totalNoteCount: 6 }, x || {}));
const EMAIL = 'Hi Test,\n\nThe 2027 Tundra is on its way to us, and I can send the window sticker now.\n\nAgent Name';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const prompt = (d) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";'); sb.__L = d; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(run('leadContext') || '') }))); });
  const guard = (text, ch, name) => { sb.__L = { name: name, store: 'Community Toyota Baytown', dealerId: '6189' }; run('lastScrapedData = globalThis.__L;');
    const ol = sb.console.log, logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); try { return { out: run('_lpHouseGuard')(text, ch), log: logs.join('\n') }; } finally { sb.console.log = ol; } };
  const rf = (d) => quiet(() => { sb.__L = d; run('lastScrapedData = globalThis.__L; _lpLastVisitDecision = { level: 0 };'); return String(run('_lpBuildSmsRefinePrompt')('Test, the Tundra is on its way.', EMAIL, d)); });

  console.log(' 1. the question names what it asks about:');
  const j = quiet(() => run('_lpBuyingJourney')({ leadSource: 'Gubagoo Virtual Retailing', vehicle: '2027 Toyota Tundra SR5', vin: 'TESTVIN0000000001' }));
  check('an online deal (lead 3122201006\'s shape): the stage asks one concrete piece -- a trade, cash or financing, or when they want it, and for a car on its way, once it arrives', () =>
    [j && j.stage, /whether they have a trade, whether they are paying cash or financing, or when they want it \(for a car still on its way to us, when they would like to have it once it arrives\)/.test(j && j.ask), /what is left for them to settle/.test(j && j.ask)],
    ['ALREADY BUILDING A DEAL ONLINE', true, false]);
  const p1 = prompt(LEAD(NEW));
  // (v9.7.897) the first reach-out closes on a light visit invitation, not a question, so it no longer carries the question rule
  check('the first reach-out closes on a light invitation, with no other question (the concrete-question rule is for follow-ups, since v9.7.897)', () =>
    [/FIRST REACH-OUT — LIGHT VISIT INVITE, NO TIMES/.test(p1), /The invitation is the close\. No other question/.test(p1), /Make the question concrete/.test(p1)], [true, true, false]);
  const p2 = prompt(FOLLOW_LEAD());
  check('a follow-up gets it as its own line', () => /\nCONCRETE QUESTION: Make the question concrete:/.test(p2), true);
  check('control: an exit gets no such line', () => /\nCONCRETE QUESTION:/.test(prompt(FOLLOW_LEAD({ convState: 'exit', hasExitSignal: true }))), false);
  const r = rf(FOLLOW_LEAD());
  check('the text rewrite: if the text asks a question, it is concrete, never an open-ended question about the process', () =>
    /If the text asks a question, it is concrete: it names the one thing it asks about[^']*Never an open-ended question about the process \("what is the main thing left to settle", "what part of the deal"/.test(r), true);
  const vq = (t) => /\[LP VAGUE QUESTION DIAG\]/.test(guard(t, 'sms', 'Test Buyer').log);
  check('the field\'s questions are logged: "the main thing", "what part of the online deal", "what detail ... clarify", "most helpful"', () =>
    [vq('What’s the main thing you still need to settle on it?'), vq('What part of the online deal would you like to tackle next?'), vq('What detail on the sticker would you like me to clarify?'), vq('What would be most helpful to work through first?')], [true, true, true, true]);
  check('control: a concrete question is not logged ("Will you be trading anything in?", "When would you like to have it?")', () => [vq('Will you be trading anything in?'), vq('When would you like to have it once it arrives?')], [false, false]);

  console.log(' 2. a first name that is only an initial is no name:');
  const pT = prompt(LEAD(NEW, { name: 'T Testbuyer', firstName: 'T' }));
  check('the prompt says no first name is usable, and never a letter or an initial', () =>
    [/^First name: none usable -- the name on the lead gives only an initial \("T"\)\. Open without a name[^\n]*Never address them by a letter or an initial\.$/m.test(pT), /^First name: T  ←/m.test(pT)], [true, false]);
  check('control: "Ab Testbuyer" still gets "First name: Ab"', () => /^First name: Ab  ← address them by this first name alone/m.test(prompt(LEAD(NEW, { name: 'Ab Testbuyer', firstName: 'Ab' }))), true);
  check('the text "T, I can help narrow ..." -> "I can help narrow ..."', () => guard('T, I can help narrow down the right options. What are you driving now?\nAgent', 'sms', 'T Testbuyer').out,
    'I can help narrow down the right options. What are you driving now?\nAgent');
  check('the email greeting line "T," -> "Hello,"; "Hi T." -> "Hi,"', () => [guard('Subject: Your search\n\nT,\n\nI saw your inquiry.', 'email', 'T Testbuyer').out, guard('Hi T.,\n\nI saw your inquiry.', 'email', 'T. Testbuyer').out],
    ['Subject: Your search\n\nHello,\n\nI saw your inquiry.', 'Hi,\n\nI saw your inquiry.']);
  check('the voicemail "Hi T, this is Agent" -> "Hi, this is Agent"', () => guard('Hi T, this is Agent at the store.', 'voicemail', 'T Testbuyer').out, 'Hi, this is Agent at the store.');
  check('control: a real first name is untouched ("Test," and "TJ,")', () => [guard('Test, I can help.', 'sms', 'Test Buyer').out, guard('TJ, I can help.', 'sms', 'TJ Buyer').out], ['Test, I can help.', 'TJ, I can help.']);

  console.log(' 3. CRM wording:');
  check('"With no specific vehicle attached, I can help ..." -> "I can help ..."', () =>
    guard('I saw your Edmunds inquiry. With no specific vehicle attached, I can help narrow down the right options before checking what’s available.', 'email', 'Test Buyer').out,
    'I saw your Edmunds inquiry. I can help narrow down the right options before checking what’s available.');
  check('control: "I don\'t have a vehicle noted for you yet" stays (it says it plainly, to them)', () => guard('I don’t have a vehicle noted for you yet. What are you shopping for?', 'email', 'Test Buyer').out,
    'I don’t have a vehicle noted for you yet. What are you shopping for?');

  console.log(' 4. Expand adds warmth, and a step-back message gets warmth, never a spec:');
  check('the Expand chip: substance said warmly; a step-back message is expanded with warmth; never a vehicle fact, spec or certification on it', () =>
    [/'expand':\s+'[^\n]*said warmly, the way a person who is glad to help them would say it[^\n]*If this message steps back \(giving them room, asking whether to keep in touch or how they would like to hear from us, offering to close the file\), expand it with warmth instead[^\n]*Never bolt a vehicle fact, spec or certification onto a step-back message\.[^\n]*Add real value, never filler to hit a length\.',/.test(src)], [true]);
  check('...and the text rewrite keeps the warmth Expand added', () => /'expand': 'Do not make it thinner than the first draft: keep the substance and the warmth it added\.'/.test(src), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
