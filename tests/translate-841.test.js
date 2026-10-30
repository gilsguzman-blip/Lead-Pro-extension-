#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('translate-841.test.js');
// (v9.7.841) A BOX THAT DID NOT TRANSLATE IS RETRIED, THEN SAID SO; A BOX ALREADY IN SPANISH IS LEFT ALONE. Toyota Baytown, 10/30
// (log383): parked on the email, the agent pressed translate; the email came back in Spanish, the text stayed in English, the
// button said "Translated!" and nothing reached the console. Each box is its own request, and one that came back as the proxy's
// fallback returned the original English silently. A second press translated the text and sent the Spanish email through again.
// Executes _lpTranslateAll and the shipped click handler (lifted from the build) with the proxy stubbed. Placeholder data only.
//
// Usage: node tests/translate-841.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: translate-841.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }

const SMS = 'Test, I am following up about the red 2026 Camry SE as another option alongside the Camry LE you asked about. Would the red SE be of interest?\nAgent\nTest Store\n(555) 010-0100';
const EMAIL = 'Hi Test,\n\nThe red 2026 Camry SE is another option alongside the Camry LE you asked about. Would you consider the red SE?\n\nAgent Name\nInternet Sales Coordinator\nTest Store\n(555) 010-0100';
const SMS_ES = 'Test, le escribo para dar seguimiento sobre el Camry SE 2026 rojo como otra opción además del Camry LE que preguntó. ¿Le interesaría el SE rojo?\nAgent\nTest Store\n(555) 010-0100';
const EMAIL_ES = 'Hola Test,\n\nEl Camry SE 2026 rojo es otra opción además del Camry LE que usted preguntó. ¿Le gustaría considerar el SE rojo?\n\nAgent Name\nCoordinador de Ventas por Internet\nTest Store\n(555) 010-0100';
const ok = (t) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translation: t }) }] } }] });
const FALLBACK = { candidates: [{ _fallback: true, content: { parts: [{ text: '{"sms":"x"}' }] } }] };

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  // The proxy, stubbed: replies are taken in order per box (SMS / email / voicemail by the label in the prompt).
  const proxy = (plan) => { const calls = []; sb.__plan = plan; sb.__calls = calls;
    run('_lpAttachLicense = function (p) { return p; }; fetch = function (u, o) { var b = JSON.parse(o.body), p = b.contents[0].parts[0].text;'
      + ' var k = /BDC SMS message/.test(p) ? "sms" : /BDC email message/.test(p) ? "email" : "voicemail"; __calls.push(k);'
      + ' var r = (__plan[k] || []).shift(); return Promise.resolve({ json: function () { return Promise.resolve(r); } }); };');
    return calls; };
  const all = async (boxes) => { const ol = sb.console.log; sb.console.log = () => {}; try { return await run('_lpTranslateAll')(boxes, { url: 'https://example.invalid/generate' }); } finally { sb.console.log = ol; } };
  const B = (sms, email) => [{ key: 'sms', label: 'Text', kind: 'SMS', text: sms }, { key: 'email', label: 'Email', kind: 'email', text: email }, { key: 'vm', label: 'Voicemail', kind: 'voicemail', text: '' }];
  const brief = (res) => res.map(r => r.key + ':' + (r.ok ? 'ok' : 'NO') + ':' + r.why + ':' + r.tries);

  console.log(' 1. a box that came back untranslated is retried:');
  let calls = proxy({ sms: [FALLBACK, ok(SMS_ES)], email: [ok(EMAIL_ES)] });
  await acheck('log383: the text request comes back as the proxy fallback -> retried once and translated; the email translated first time', async () => {
    const r = await all(B(SMS, EMAIL)); return [brief(r), r[0].text === SMS_ES, r[1].text === EMAIL_ES, calls.slice().sort()]; },
    [['sms:ok:translated:2', 'email:ok:translated:1', 'vm:ok:empty:0'], true, true, ['email', 'sms', 'sms']]);
  proxy({ sms: [FALLBACK, FALLBACK], email: [ok(EMAIL_ES)] });
  await acheck('fails twice -> not translated, the English kept, the reason named (fallback)', async () => {
    const r = await all(B(SMS, EMAIL)); return [brief(r)[0], r[0].text === SMS]; }, ['sms:NO:fallback:2', true]);
  proxy({ sms: [ok(SMS), ok(SMS)], email: [ok(EMAIL_ES)] });
  await acheck('a reply that is still English is not counted as translated ("unchanged")', async () => brief(await all(B(SMS, EMAIL)))[0], 'sms:NO:unchanged:2');

  console.log(' 2. a box already in Spanish is left alone:');
  calls = proxy({ sms: [ok(SMS_ES)], email: [ok('should not be asked')] });
  await acheck('log383\'s second press: the Spanish email is not sent again; only the text is translated', async () => {
    const r = await all(B(SMS, EMAIL_ES)); return [brief(r), r[1].text === EMAIL_ES, calls]; },
    [['sms:ok:translated:1', 'email:ok:already Spanish:0', 'vm:ok:empty:0'], true, ['sms']]);
  check('the Spanish check: the English drafts do not read as Spanish; the Spanish ones do', () => [SMS, EMAIL, SMS_ES, EMAIL_ES].map(t => run('_lpLooksSpanish')(t)), [false, false, true, true]);

  console.log(' 3. the button says what happened, and the console has a line for every press:');
  // The shipped click handler, lifted from the build and run against fake boxes and a fake button.
  const a = src.indexOf("document.getElementById('btnTranslate').addEventListener('click', async function() {");
  const e = src.indexOf('\n});\n', a);
  const handlerSrc = src.slice(a, e + 4);
  const press = async (sms, email, plan) => {
    proxy(plan); const logs = [];
    const box = (v) => ({ value: v }); sb.__els = { 'output-sms': box(sms), 'output-email': box(email), 'output-vm': box(''), btnTranslate: null };
    sb.__btn = { textContent: '🇲🇽 Español', dataset: {}, classList: { add() {}, remove() {} }, _h: null, addEventListener(t, h) { this._h = h; } };
    sb.__els.btnTranslate = sb.__btn;
    run('(function (document, getEndpoint, updateWordCount, alert, setTimeout) {' + handlerSrc + '})({ getElementById: function (id) { return __els[id]; } }, function () { return { url: "https://example.invalid/generate" }; }, function () {}, function () {}, function () {})');
    const ol = sb.console.log; sb.console.log = (...q) => logs.push(q.join(' '));
    try { await sb.__btn._h.call(sb.__btn); } finally { sb.console.log = ol; }
    return { btn: sb.__btn.textContent, sms: sb.__els['output-sms'].value, email: sb.__els['output-email'].value, diag: logs.find(l => /\[LP TRANSLATE DIAG\]/.test(l)) || '' };
  };
  await acheck('control: both translate the first time -> both boxes Spanish and "Translated!"', async () => {
    const p = await press(SMS, EMAIL, { sms: [ok(SMS_ES)], email: [ok(EMAIL_ES)] }); return [p.btn, p.sms === SMS_ES, p.email === EMAIL_ES]; }, ['Translated!', true, true]);
  await acheck('log383 retried: both boxes Spanish, "Translated!", and the diag says the text needed a retry', async () => {
    const p = await press(SMS, EMAIL, { sms: [FALLBACK, ok(SMS_ES)], email: [ok(EMAIL_ES)] });
    return [p.btn, p.sms === SMS_ES, p.email === EMAIL_ES, p.diag.replace(/^.*\] /, '')]; },
    ['Translated!', true, true, 'text:translated after a retry | email:translated | voicemail:empty']);
  await acheck('the text fails twice: the button says "Text didn’t translate — tap again", not "Translated!"; the email is still translated', async () => {
    const p = await press(SMS, EMAIL, { sms: [FALLBACK, FALLBACK], email: [ok(EMAIL_ES)] });
    return [p.btn, p.sms === SMS, p.email === EMAIL_ES, p.diag.replace(/^.*\] /, '')]; },
    ['Text didn’t translate — tap again', true, true, 'text:NOT TRANSLATED (fallback) after a retry | email:translated | voicemail:empty']);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
