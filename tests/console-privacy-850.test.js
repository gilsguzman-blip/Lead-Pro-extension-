#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('console-privacy-850.test.js');
// (v9.7.850) AUDIT PHASE 2, BATCH 1. (M-7) The console logs are shared, so a customer's phone and email and a license key are
// masked: ***-0200, d***@domain, and the last 3 characters of a key. Covers [LP PHONE DIAG] (the scraped phone and the context
// sample), [LP EMAIL DIAG], [LP RAW DIAG] and the auth.js Provision line. (L-2) The invite scraper's [LP INVITE CANARY] lands in
// the CRM page's console, which nobody opens; it now comes back in the result and the popup logs it. (L-5) Two prompt lines that
// asserted what we cannot know: "has read every message you sent and chosen not to respond", and a 30-60+ minute drive the
// distance tier has not measured since 847 (it is outside the local ZIP list and within 75 miles).
// Executes populateFromData, the [LP RAW DIAG] statement, the auth.js Provision statement, _lpInviteScrapeAppts against a fake
// grid, lpInviteRescrape, and buildUserPrompt through the shipped panel payload. Placeholder data only.
//
// Usage: node tests/console-privacy-850.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: console-privacy-850.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const E = (time, tag, title, body) => '[11/02/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[11/02/2026 6:17 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const IN = E('8:40 AM', 'CUSTOMER', 'Inbound Text Message', 'Call me at (555) 010-0199 or email test@example.com');
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Kia Telluride S',
  condition: 'New', stockNum: 'TEST0K1', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Cargurus', convState: 'first-touch', leadAgeDays: 0,
  hasOutbound: false, hasCustomerReply: true, totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Call me at (555) 010-0199',
  customerState: 'TX', customerZip: '77521', relationshipSignals: { unansweredQuestions: [] }, history: IN + MARK, conversationBrief: IN + MARK,
  context: 'Test Buyer (555) 010-0199 test@example.com\n' + IN + MARK }, x || {});
const FULL = /555\D{0,2}010\D{0,2}0199|test@example\.com/;

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src, auth; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); auth = fs.readFileSync(path.join(path.dirname(f), 'auth.js'), 'utf8'); }
  catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const capture = (g) => { const ol = sb.console.log, ow = sb.console.warn; const logs = []; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = (...q) => logs.push(q.join(' '));
    try { const r = g(); return { r, logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the masks:');
  check('phone -> ***-0199; email -> t***@example.com; a key -> its last 3 characters', () =>
    [run('_lpMaskPhone("(555) 010-0199")'), run('_lpMaskEmail("test@example.com")'), run('_lpMaskKey("ABCDEFGH123")'), run('_lpMaskEmail("")'), run('_lpMaskKey("")')],
    ['***-0199', 't***@example.com', '…123', '(empty)', '(empty)']);
  check('free text: every phone and email in it masked, the rest left as written', () =>
    run('_lpMaskContacts("Test Buyer | (555) 010-0199 | 555.010.0100 | +1 555-010-0199 | test@example.com | 2027 Kia Telluride S stock TEST0K1")'),
    'Test Buyer | ***-0199 | ***-0100 | ***-0199 | t***@example.com | 2027 Kia Telluride S stock TEST0K1');

  console.log(' 2. what the console prints during a grab:');
  const pop = capture(() => { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(LSD()); });
  const phoneDiag = pop.logs.find(l => /^\[LP PHONE DIAG\] \{/.test(l)) || '', emailDiag = pop.logs.find(l => /^\[LP EMAIL DIAG\]/.test(l)) || '';
  check('[LP PHONE DIAG]: the scraped phone and the context sample carry no full phone or email', () =>
    [phoneDiag.length > 0, FULL.test(phoneDiag), /"scrapedPhone":"\*\*\*-0199"/.test(phoneDiag), /"contextSample":"[^"]*\*\*\*-0199[^"]*t\*\*\*@example\.com/.test(phoneDiag)], [true, false, true, true]);
  check('[LP EMAIL DIAG]: "t***@example.com", the domain still visible', () =>
    [emailDiag.length > 0, FULL.test(emailDiag), /"email":"t\*\*\*@example\.com"/.test(emailDiag), /"emailDomain"/.test(emailDiag)], [true, false, true, true]);
  check('control: populateFromData still found the phone (the flag logic reads the real value, not the mask)', () => /"overrideFired":"scrapedPhone"/.test(phoneDiag), true);
  const ra = src.indexOf("      console.log('[LP RAW DIAG] phoneOnFile:'"), rb = src.indexOf(';', src.indexOf("'| phone value:'", ra)) + 1;
  const raw = capture(() => { sb.__raw = src.slice(ra, rb); run('lastScrapedData = { phone: "(555) 010-0199" }; eval(globalThis.__raw);'); });
  check('[LP RAW DIAG] phone value -> ***-0199, phoneOnFile still true', () => [ra > 0, raw.logs.join('\n')], [true, '[LP RAW DIAG] phoneOnFile: true | phone value: ***-0199']);
  const pa = auth.indexOf("console.log('[Lead Pro] Provision"), pb = auth.indexOf('\n', pa);
  const prov = (key) => { const logs = []; const box = { String, directorKey: key, console: { log: (...q) => logs.push(q.join(' ')) } }; vm.createContext(box);
    vm.runInContext(auth.slice(pa, pb).replace(/\s*\/\/[^\n]*$/, ''), box); return logs[0]; };
  check('auth.js Provision: an 11-character key prints as its last 3 characters, not 12 (the whole key)', () =>
    [pa > 0, prov('ABCDEFGH123'), prov('')], [true, '[Lead Pro] Provision — directorKey: …123', '[Lead Pro] Provision — directorKey: (empty)']);

  console.log(' 3. the invite canary reaches the popup log:');
  const grid = (primary) => { const row = { children: [{}, {}, { querySelector: (q) => q === 'a' ? { textContent: 'Tomorrow, 2:30p' } : null }, {},
      { querySelector: (q) => q === 'a' ? { textContent: '2027 Kia Telluride S' } : q === 'strong' ? { textContent: 'test drive' } : null }],
    querySelector: () => ({ href: 'https://example.invalid/x?alid=12345' }) };
    return { querySelectorAll: (q) => (/^#ctl00_/.test(q) ? (primary ? [row] : []) : /\[id\$=/.test(q) ? [row] : []) }; };
  const scrape = (primary) => { const logs = []; const box = { document: grid(primary), String, console: { warn: (...q) => logs.push(q.join(' ')) } }; vm.createContext(box);
    vm.runInContext('var __f = ' + run('_lpInviteScrapeAppts.toString()') + ';', box); const r = vm.runInContext('__f("12345")', box); return { r, logs }; };
  const fb = scrape(false), pr = scrape(true);
  check('the primary selector missed and the suffix fallback matched: the result carries the canary, and still finds the appointment', () =>
    [fb.r.found, /^primary Appts-grid selector missed but suffix fallback matched/.test(fb.r.canary || ''), fb.r.whenText], [true, true, 'Tomorrow, 2:30p']);
  check('the primary selector hit -> the canary field is empty', () => [pr.r.found, pr.r.canary], [true, '']);
  const relay = async (results) => { const logs = [];
    sb.chrome = { tabs: { query: async () => [{ id: 1 }] }, runtime: { lastError: null }, scripting: { executeScript: (o, cb) => cb(results) } };
    run('_lpInviteActiveLeadId = function () { return "12345"; }; lpRenderInviteTab = function () {};');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = (...q) => logs.push(q.join(' '));
    try { await run('lpInviteRescrape()'); } finally { sb.console.log = ol; sb.console.warn = ow; } return logs.filter(l => /LP INVITE CANARY/.test(l)); };
  await acheck('lpInviteRescrape logs [LP INVITE CANARY] popup-side, naming the frame', async () => {
    const l = await relay([{ frameId: 0, result: { found: false, canary: '' } }, { frameId: 7, result: fb.r }]);
    return [l.length, /^\[LP INVITE CANARY\] primary Appts-grid selector missed .* \| frame: 7 \| matched: true$/.test(l[0] || '')]; }, [1, true]);
  await acheck('control: no canary from any frame -> nothing logged', async () => (await relay([{ frameId: 0, result: pr.r }])).length, 0);

  console.log(' 4. two prompt lines that said more than we know:');
  const sys = src.slice(src.indexOf("'ONE-SIDED CONVERSATIONS:"), src.indexOf("\n", src.indexOf("'ONE-SIDED CONVERSATIONS:")));
  check('ONE-SIDED: "The customer has not replied to any of them." -- not that they read every message and chose not to respond', () =>
    [/The customer has not replied to any of them\. Do not send another optimistic check-in/.test(sys), /read every message|chosen not to respond/.test(sys)], [true, false]);
  const built = (lsd) => capture(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0; window._lpAddApptLeadId = ""; window._lpNoApptLeadId = "";');
    sb.populateFromData(lsd); return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); }).r;
  run('ZIP3_CENTROIDS["999"] = { lat: 30.0, lng: -94.0 };');   // a placeholder ZIP3 about 60 miles from Baytown, across a state line
  const OUT = E('8:51 AM', 'AGENT', 'Outbound Text Message', 'Test, the 2027 Kia Telluride S is here and showing available. Agent');
  const near = built(LSD({ customerState: 'LA', customerZip: '99901', hasOutbound: true, hasCustomerReply: false, lastInboundMsg: '', history: OUT + MARK, conversationBrief: OUT + MARK, context: OUT + MARK }));
  check('the distance tier says what it is: outside the local area, within 75 miles -- no drive time', () =>
    [/^🔴 DISTANCE BUYER: Customer lives outside the store's local area but within 75 miles \(INTERNAL fact — shapes the offer, never the wording\)\./m.test(near), /30-60\+? minutes/.test(near)], [true, false]);
  check('control: a local ZIP -> no distance block', () => /DISTANCE BUYER/.test(built(LSD({ hasOutbound: true, hasCustomerReply: false, lastInboundMsg: '', history: OUT + MARK, conversationBrief: OUT + MARK, context: OUT + MARK }))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
