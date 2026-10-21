#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('fullpath-803.test.js');
// (v9.7.803) FULLPATH: THEY ACTED ON OUR OWN MARKETING. Fullpath is the stores' CDP; its audience module markets to in-market
// customers in our own database, and a lead arrives when one of them converts. Two on 10/15: Kia Baytown lead 2100329657
// converted on "2026 Kia Sorento Hybrid Lease for $409/mo for 24 months, $3,999 due at signing" and the draft pitched "$3,000
// customer cash" -- the note had been thrown away as machine fields; Honda Baytown lead 2100288374 converted on a 2019 Honda
// Pilot (VIN, $19,616) and wrote "My credit is not that good". Both prompts called it "your online inquiry". Gil, 10/15: quote
// the advertised offer prefaced with approved credit; a specific unit's price is fine; other offers wait for a later follow-up;
// the vehicle they own is a light trade/upgrade question. Executes _lpFullpath, the scraper's capture line (lifted),
// populateFromData, buildUserPrompt, _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/fullpath-803.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: fullpath-803.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const OFFER_NOTE = 'By: System Preferred Contact Method: Any CONVERTED ON: Nurture Landing Page 2026 Kia Sorento Hybrid Lease for $409/mo for 24 months, $3,999 due at signing Lead Details: Click here to view complete lead information ( dashboard.example.com%2fleads... ) Page converted on: Kia Dealer Serving Houston | Baytown Kia Dealer ( www.example.com%2f%3futm_... )';
const UNIT_NOTE = 'By: System CONVERTED ON: Nurture Landing Page 2019 Honda Pilot (VIN 5FNYF6H60TEST0001) $19,616 Customer message: My credit is not that good Lead Details: Click here to view complete lead information ( dashboard.example.com%2fleads... ) Vehicles viewed: Status: used, Make: Honda, Model: Pilot Touring 7 Passenger, Year: 2019, Page-Views: 1 Page converted on: Used 2019 Honda Pilot Touring 7 Passenger in Baytown, TX ( www.example.com%2faut... ) Show Less';
const E = (time, tag, title, body) => '[10/15/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/15/2026 10:36 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const OURS = E('11:15 AM', 'AGENT', 'Outbound Text Message', 'Test, the Sorento Hybrid EX is here in two colors. Which would you like to see?');
const OURS_OFFER = E('11:15 AM', 'AGENT', 'Outbound Text Message', 'Test, on approved credit the Sorento Hybrid lease is $409/mo for 24 months.');
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Kia Sorento Hybrid EX', condition: 'New',
  stockNum: '', vin: '', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'FullPath', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true,
  hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] },
  fullpathConversion: OFFER_NOTE, serviceVehicle: '2017 KIA SORENTO', history: OURS + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + OURS + MARK + '---' }, x || {});
const UNIT_LEAD = (x) => LEAD(Object.assign({ vehicle: '2019 Honda Pilot Touring 7-Passenger', condition: 'Used', dealerId: '6191', store: 'Community Honda Baytown',
  fullpathConversion: UNIT_NOTE, serviceVehicle: '', lastInboundMsg: 'My credit is not that good' }, x));
const SIG = '\nAgent\nCommunity Kia Baytown\n(555) 010-0100';
const EMAIL = 'Hi Test,\n\nOn approved credit, the 2026 Sorento Hybrid lease is $409/mo for 24 months with $3,999 due at signing, and we have it here to see.\n\nAgent Name\nCommunity Kia Baytown\n(555) 010-0100';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const fn = (name) => { try { return run(name); } catch (e) { return null; } };
  for (const id of ['6190', '6191']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [{ model: 'Sorento Hybrid', line: 'Sorento Hybrid — $3,000 Customer Cash' }] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  const built = (d) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); const ctx = run('leadContext');
      return { p: sb.__lp.buildUserPrompt(Object.assign({}, d, { context: ctx })), logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the conversion note, read (new helper):');
  const fp = fn('_lpFullpath');
  check('the offer: "2026 Kia Sorento Hybrid Lease for $409/mo for 24 months, $3,999 due at signing", its figure $409, the page type apart; the owned 2017 Sorento', () => {
    const r = fp(LEAD()); return r && [r.kind, r.offer, r.key, r.page, r.owned, r.presented]; },
    ['offer', '2026 Kia Sorento Hybrid Lease for $409/mo for 24 months, $3,999 due at signing', '$409', 'Nurture Landing Page', '2017 Kia Sorento', false]);
  check('the unit: 2019 Honda Pilot at $19,616 (VIN kept for matching), their message, and what they viewed', () => {
    const r = fp(UNIT_LEAD()); return r && [r.kind, r.vehicle, r.price, r.vin, r.message, r.viewed]; },
    ['unit', '2019 Honda Pilot', '$19,616', '5FNYF6H60TEST0001', 'My credit is not that good', ['used 2019 Honda Pilot Touring 7 Passenger (1 page view)']]);
  check('control: another source with the same note, and a Fullpath lead with no conversion note, are not read', () => [fp(LEAD({ leadSource: 'Dealer Website' })), fp(LEAD({ fullpathConversion: '' }))], [null, null]);
  check('already put to them: our own message on the lead carried $409', () => fp(LEAD({ history: OURS_OFFER + MARK })).presented, true);
  const cap = (content) => { const line = src.split('\n').find(l => /_lpFullpathNote = String\(content\)/.test(l)); if (!line) return '(no capture line)';
    const box = { String }; vm.createContext(box); return vm.runInContext('var _lpFullpathNote = ""; var content = ' + JSON.stringify(content) + ';\n' + line + '\n_lpFullpathNote;', box); };
  check('the scraper keeps the current lead\'s note when it says CONVERTED ON, and nothing else', () => [cap(OFFER_NOTE) === OFFER_NOTE, cap('By: System Lead from Dealer Website')], [true, '']);
  check('the note survives the frame merge, and a rejected service-record frame\'s vehicle is kept as the one they own (source)', () =>
    [/const historyFields = new Set\(\[[^\]]*'fullpathConversion'[^\]]*\]\)/.test(src), /service-record source \(not a sales lead\)[^\n]*\n[^\n]*\n\s*if \(d\.vehicle && !m\.serviceVehicle/.test(src)], [true, true]);

  console.log(' 2. the prompt leads with what they acted on:');
  const a = built(LEAD());
  check('lead 2100329657: the offer quoted on approved credit; the owned 2017 Sorento as a light trade question; other offers wait', () =>
    [/^- The offer they opened on our website: "2026 Kia Sorento Hybrid Lease for \$409\/mo for 24 months, \$3,999 due at signing"\. Lead with it in the SMS, the email and the voicemail\. Quote it as advertised, prefaced with "on approved credit"/m.test(a.p),
     /^- THEY OWN A 2017 Kia Sorento \(our service records\)\. Fish lightly for a trade or upgrade -- one easy question, e\.g\. "Are you thinking about trading in your 2017 Sorento\?"/m.test(a.p),
     /^- OTHER OFFERS WAIT:/m.test(a.p), /STORE INCENTIVE/.test(a.p), a.logs.some(l => /\[LP INCENTIVE DIAG\] suppressed — Fullpath/.test(l))], [true, true, true, false, true]);
  check('it is not an "online inquiry": HOW THIS LEAD REACHED US names what they opened on our website, and the source acknowledgement stands aside', () =>
    [/^- HOW THIS LEAD REACHED US: they acted on our own marketing -- on our website they opened our 2026 Kia Sorento Hybrid Lease/m.test(a.p),
     a.p.split('\n').filter(l => /online inquiry/i.test(l) && !/Never call it an "online inquiry"/.test(l)).length, a.logs.some(l => /SKIPPED-fullpath/.test(l))], [true, 0, true]);
  const b = built(LEAD({ history: OURS_OFFER + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + OURS_OFFER + MARK + '---' }));
  check('control: once the offer has been put to them, another offer may follow as a secondary angle -- the hold lifts', () =>
    [/already been put to them; another current offer may now be used as a secondary angle/.test(b.p), /OTHER OFFERS WAIT/.test(b.p), b.logs.some(l => /suppressed — Fullpath/.test(l))], [true, false, false]);
  const u = built(UNIT_LEAD());
  check('lead 2100288374: the 2019 Pilot at its advertised $19,616 (price allowed, VIN never quoted), their credit message answered first', () =>
    [/^- The car they opened on our website: 2019 Honda Pilot, advertised at \$19,616\. Lead with that car\. You may name that advertised price/m.test(u.p),
     /^- They also wrote: "My credit is not that good" -- answer that first/m.test(u.p), /^- What they viewed: used 2019 Honda Pilot Touring 7 Passenger \(1 page view\)\./m.test(u.p), /THEY OWN A/.test(u.p)],
    [true, true, true, false]);
  const o = built(LEAD({ leadSource: 'Dealer Website' }));
  check('control: a Dealer Website lead carrying the same note text gets none of it', () => [/WHAT THEY RESPONDED TO|THEY OWN A|OTHER OFFERS WAIT/.test(o.p), o.logs.some(l => /FULLPATH DIAG|suppressed — Fullpath/.test(l))], [false, false]);

  console.log(' 3. the text rewrite keeps it:');
  const RP = (x) => { const ol = sb.console.log; sb.console.log = () => {}; try { return run('_lpBuildSmsRefinePrompt')('Test, pass one.', EMAIL, LEAD(x)); } finally { sb.console.log = ol; } };
  check('WHAT THEY RESPONDED TO is in the rewrite prompt; not for another source', () =>
    [/━━━ WHAT THEY RESPONDED TO ━━━\nThey opened our 2026 Kia Sorento Hybrid Lease for \$409\/mo for 24 months, \$3,999 due at signing on our website\. Keep it in the text the way the first draft has it \(on approved credit, the numbers as advertised\); never call it an online inquiry; add no other offer\./.test(RP()),
     /WHAT THEY RESPONDED TO/.test(RP({ leadSource: 'Dealer Website' }))], [true, false]);
  const refine = async (pass1, reply, x) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Community Kia Baytown" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite dropped the offer they acted on \(\$409\)/.test(l))]; };
  const P1 = 'Test, on approved credit the 2026 Sorento Hybrid lease is $409/mo for 24 months with $3,999 due at signing. Would you like to see one today?' + SIG;
  await acheck('a first draft with the $409 offer, a rewrite that drops it -> the first draft ships', () => refine(P1, 'Test, the Sorento Hybrid is here and ready to see. Would you like to come by today?' + SIG), [null, true]);
  await acheck('control: a rewrite that keeps $409 ships', () => refine(P1, 'Test, on approved credit the Sorento Hybrid lease is $409/mo for 24 months, $3,999 due at signing. Want to see one today?' + SIG), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
