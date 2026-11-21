#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('english-draft-888.test.js');
// (v9.7.888) THE DRAFT IS WRITTEN IN ENGLISH EVEN WHEN THE THREAD IS IN SPANISH. Owner, 11/19: "Grabbed and genned and responses came out
// in Spanish. Rule is supposed to make the message in English and then allow for the translate chip to be used to convert." Toyota
// Baytown lead 3117052433 (log427, dump): the customer writes Spanish and our sends went out through the Translate button, so the thread
// was all Spanish, and both generations (and the rewrite) came back in Spanish. Executes _lpThreadInSpanish, buildUserPrompt through the
// panel payload, and _lpEnglishGuard with a stubbed endpoint. Placeholder data only.
//
// Usage: node tests/english-draft-888.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: english-draft-888.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 19, 17, 6);
const ES_THREAD = '[11/19/2026 5:04 PM] [CUSTOMER] Inbound Text Message\n  Ya llegue a mi casa, pero le comento nada mas mi valor residual es de 32 K, en esa parte llevo perdido mas los meses que me faltan del Lease\n'
  + '[11/19/2026 5:02 PM] [AGENT] Outbound Text Message\n  Test, entiendo que el valor te parece muy bajo; no necesitas comprar otro carro para que revisemos la tasacion. Puedo volver a revisar el numero contigo en persona. Puedes venir antes de cerrar?\n'
  + '[11/19/2026 4:58 PM] [CUSTOMER] Inbound Text Message\n  Esta muy bajo el precio\n'
  + '[11/19/2026 4:55 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Agent Name Spanish speaker\n'
  + '[11/18/2026 5:00 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const EN_THREAD = '[11/19/2026 5:04 PM] [CUSTOMER] Inbound Text Message\n  I just got home, but my residual is 32K and I would lose that plus the months left on the lease\n'
  + '[11/19/2026 5:02 PM] [AGENT] Outbound Text Message\n  Test, I understand the value seems low. I can go over the number with you in person.\n'
  + '[11/18/2026 5:00 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = (h) => ({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2024 Toyota Tacoma SR5', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Tradepending',
  convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com',
  lastInboundMsg: h.split('\n')[1].trim(), relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, conversationBrief: h, history: h, context: '', autoLeadId: 'TEST013N' });
const ES_SMS = 'Test, no necesariamente llevas perdido el saldo completo: hay que comparar la tasación con el saldo y los pagos que te quedan. Puedo revisarlo contigo sin que tengas que comprar otro carro. ¿Cuántos meses te quedan del lease?';
const ES_EMAIL = 'Subject: Tacoma lease balance and appraisal\n\nHi Test,\n\nEntiendo que el saldo residual es de $32,000 y que todavía tienes pagos pendientes del lease. Para evaluar si la oferta realmente te deja perdiendo, habría que comparar el valor de tasación con el saldo.\n\nAgent Name\nInternet Sales Coordinator';
const EN_SMS = 'Test, you may not be losing the whole balance: we compare the appraisal with the payoff and the payments left. How many months are left on the lease?';
const EN_EMAIL = 'Subject: Tacoma lease balance and appraisal\n\nHi Test,\n\nI understand the residual is $32,000 and you still have payments left on the lease. We would compare the appraisal with the payoff.\n\nAgent Name\nInternet Sales Coordinator';
(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  const logs = [];
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const fn = (n) => { try { return vm.runInContext(n, sb); } catch (e) { return () => { throw new Error(n + ' missing'); }; } };

  console.log(' the thread is read as Spanish:');
  check('lead 3117052433\'s shape: customer and our sends in Spanish', () => fn('_lpThreadInSpanish')(LEAD(ES_THREAD)), { customer: 2, ours: 1 });
  check('control: an English thread is not', () => fn('_lpThreadInSpanish')(LEAD(EN_THREAD)), null);

  console.log(' the prompt says to write in English, beside the thread:');
  const prompt = (h) => quiet(() => { const d = LEAD(h); vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";', sb); sb.__L = d; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(vm.runInContext('leadContext', sb) || '') }))); });
  check('Spanish thread -> "THIS CONVERSATION IS IN SPANISH, AND YOUR TEXT, EMAIL AND VOICEMAIL ARE IN ENGLISH ... Translate button"',
    () => /LANGUAGE -- THIS CONVERSATION IS IN SPANISH, AND YOUR TEXT, EMAIL AND VOICEMAIL ARE IN ENGLISH\. The customer writes in Spanish, and our messages in it were written in English and put into Spanish with the Translate button/.test(prompt(ES_THREAD)), true);
  check('control: an English thread -> no such line', () => /THIS CONVERSATION IS IN SPANISH/.test(prompt(EN_THREAD)), false);

  console.log(' a draft that still comes back Spanish is put into English before render:');
  const calls = [];
  const stub = (reply) => { calls.length = 0; sb.fetch = async (u, o) => { calls.push(JSON.parse(o.body)); const t = calls[calls.length - 1].contents[0].parts[0].text; const orig = t.slice(t.indexOf('ORIGINAL TEXT:\n') + 15);
    return { json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translation: reply(orig) }) }] } }] }) }; }; };
  const guard = (s, e) => { const ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' ')); return fn('_lpEnglishGuard')(s, e, { url: 'https://example.invalid/' }).finally(() => { sb.console.log = ol; }); };
  stub((o) => /^Subject:/.test(o) ? EN_EMAIL : EN_SMS);
  await acheck('the Spanish text and the half-Spanish email (English subject and greeting, Spanish body) both come back English', async () => { const r = await guard(ES_SMS, ES_EMAIL); return [r.fired, r.sms === EN_SMS, r.email === EN_EMAIL, calls.length]; }, [true, true, true, 2]);
  check('...logged as [LP ENGLISH GUARD]', () => logs.some(l => /\[LP ENGLISH GUARD\] the draft came back in Spanish -- text: put into English \| email: put into English/.test(l)), true);
  stub(() => EN_SMS);
  await acheck('control: an English draft makes no call and is unchanged', async () => { const r = await guard(EN_SMS, EN_EMAIL); return [r.fired, r.sms === EN_SMS, r.email === EN_EMAIL, calls.length]; }, [false, true, true, 0]);
  stub((o) => o);
  await acheck('control: a translation that does not come back English leaves the draft as it was (one retry, never blanked)', async () => { const r = await guard(ES_SMS, EN_EMAIL); return [r.sms === ES_SMS, r.email === EN_EMAIL, calls.length]; }, [true, true, 2]);

  console.log(' wiring:');
  check('the guard runs before the text rewrite, and a Spanish rewrite over an English first pass does not ship', () => {
    const g = src.indexOf('var _eg = await _lpEnglishGuard(rawSms, rawEmail, getEndpoint());'), r = src.indexOf('var _rfSms = await _lpRefineSms(rawSms, rawEmail, lastScrapedData);');
    return [g > 0 && r > g, /if \(_rfSms && _lpLooksSpanish\(_rfSms\) && !_lpLooksSpanish\(rawSms\)\)/.test(src)]; }, [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
