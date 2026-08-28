#!/usr/bin/env node
'use strict';
/**
 * customer-facing-hygiene.test.js — v9.7.596. THREE THINGS THAT REACHED A CUSTOMER.
 *
 * All three from the 8/27 feedback export (leadprofeedback_20260827, 21 rated, 0 up).
 *
 * ── (1) WE WROTE THE SUBJECT OUR OWN PROMPT BANS ──────────────────────────────────────────
 * "Subject: A quick note about your inquiry" shipped three times — twice on a KBB ICO trade lead
 * (2058487787) and once on a 41-day Facebook lead. It is not the model's phrasing: it was the
 * final else of LP's own subject fallback, under a comment reading "Never fall back to a generic
 * phrase."
 *
 * The same file bans that exact string by name in its equity-scenario rules — "Never use 'A quick
 * note about your inquiry' — they did not inquire" — and it is a near-miss on the SUBJECT LINE
 * RULES list ("Re: your inquiry", "Quick question", "I wanted to reach out").
 *
 * It also asserts something we may not know: "your inquiry" tells the customer they inquired.
 *
 * Identifiable as the fallback because the SAME lead produced "Your CR-V appraisal today" on the
 * generations where the model supplied its own subject, and the generic string on the ones where
 * it did not.
 *
 * ── (2) A ROUTING LABEL SPOKEN TO A CUSTOMER ──────────────────────────────────────────────
 * "I saw your inquiry through Thirdparty Honda on the 2026 Honda Accord." Rated down. That is a
 * VinSolutions routing label, not a website.
 *
 * A blanket ban would be wrong: the same export carries "thanks for reaching out on Facebook",
 * which is true and reads well. The line is not internal-vs-external, it is whether the CUSTOMER
 * would recognise the name as where they filled something in. So the rule is a WHITELIST — a
 * blocklist would have to anticipate the next label the CRM invents, and this file has been bitten
 * three builds running by enumerating shapes it happened to have seen.
 *
 * ── (3) A PERSONAL EXTENSION SERVED AS A STORE LINE ───────────────────────────────────────
 * The dealer-config panel serves 281-837-3382 as Honda Baytown's store phone. Run against the
 * SHIPPED PHONE_DIR, that number resolves to "gil guzman" — evidence, not an inference from a
 * comment. Nothing reaches it today (store config is third in precedence), but this exact shape
 * caused v9.7.469 and v9.7.486, both found only after a wrong number had gone out.
 *
 * The config is chrome.storage.sync data edited in the admin panel, so code cannot correct it.
 * It can refuse to use it and say so.
 *
 * Driven against the SHIPPED helpers. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: customer-facing-hygiene.test.js <popup.js> [popup.js...]'); process.exit(2); }

function block(src, kw, name) {
  const h = src.indexOf(kw + ' ' + name);
  if (h < 0) throw new Error(name + ' not found');
  let d = 0, st = false, e = -1;
  for (let i = h; i < src.length; i++) {
    if (src[i] === '{') { d++; st = true; }
    else if (src[i] === '}') { d--; if (st && d === 0) { e = i + 1; break; } }
  }
  return src.slice(h, e);
}

// A SUITE THAT THROWS ON LOAD PRINTS NOTHING, AND NOTHING READS EXACTLY LIKE "CATCHES NOTHING".
// That trap has cost four wrong non-vacuity readings this week: run against a build that predates
// the helpers, extract() threw and the whole file died before a single assertion ran. The fix is
// not another bespoke harness per build — it is for extraction failure to become a REPORTED
// FAILURE like any other. Every accessor below throws a labelled error when its helper is absent,
// and `check` already catches per-assertion, so a pre-fix build now yields a full run of loud
// failures instead of a silent exit.
function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sb = { String, RegExp, console: { log() {} } };
  vm.createContext(sb);
  const missing = [];
  const tryRun = (label, code) => {
    if (code === null) { missing.push(label); return; }
    try { vm.runInContext(code, sb); } catch (e) { missing.push(label + ' (' + e.message + ')'); }
  };
  const safeBlock = (kw, name) => { try { return block(src, kw, name); } catch (e) { return null; } };

  const th = src.indexOf('var _LP_CUSTOMER_FACING_SOURCES');
  tryRun('_LP_CUSTOMER_FACING_SOURCES',
         th < 0 ? null : src.slice(th, src.indexOf('];', th) + 2));
  tryRun('_lpCustomerFacingSource', safeBlock('function', '_lpCustomerFacingSource(raw)'));
  // PHONE_DIR must be initialised BEFORE the helper runs — see the TDZ note in the helper itself.
  tryRun('PHONE_DIR',            (b => b === null ? null : b + ';')(safeBlock('const', 'PHONE_DIR')));
  tryRun('STORE_PHONE_FALLBACK', (b => b === null ? null : b + ';')(safeBlock('var', 'STORE_PHONE_FALLBACK')));
  tryRun('_lpPersonalNumberOwner', safeBlock('function', '_lpPersonalNumberOwner(phone)'));

  const need = what => { throw new Error('NOT IN THIS BUILD: ' + what); };
  const has = n => { try { vm.runInContext('typeof ' + n, sb) !== 'undefined'; return vm.runInContext('typeof ' + n, sb) !== 'undefined'; } catch (e) { return false; } };
  return {
    name: path.basename(path.dirname(file)),
    src, missing,
    source: r  => has('_lpCustomerFacingSource') ? vm.runInContext('_lpCustomerFacingSource', sb)(r) : need('_lpCustomerFacingSource'),
    owner:  ph => has('_lpPersonalNumberOwner')  ? vm.runInContext('_lpPersonalNumberOwner', sb)(ph) : need('_lpPersonalNumberOwner'),
    storeFallback: id => has('STORE_PHONE_FALLBACK') ? vm.runInContext('STORE_PHONE_FALLBACK', sb)[id] : need('STORE_PHONE_FALLBACK')
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
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

console.log('\nv9.7.596 — three things that reached a customer on 8/27');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
impls.forEach(i => { if (i.missing.length) {
  console.log('  NOTE  ' + i.name + ' is missing: ' + i.missing.join(', ')
    + '  — every assertion that needs them will FAIL below rather than the suite dying silently');
} });
console.log('');

// ── (1) THE SUBJECT FALLBACK ────────────────────────────────────────────────
console.log('the subject fallback no longer writes the string this file bans:');

check('"A quick note about your inquiry" is gone from the fallback',
  i => /'A quick note about your inquiry'/.test(strip(i.src)), false);

check('...and the prohibition that names it is still shipping',
  i => /Never use "A quick note about your inquiry"/.test(i.src), true);

check('the ladder ends at the store, which is always known when a signature can be built',
  i => /_fbStore\)\s*\{ fallbackSubject = 'A note from ' \+ _fbStore/.test(strip(i.src)), true);

check('...and below that at the email\'s own first clause — specific by construction',
  i => /_fbRung = _fbBody \? 'first-clause' : 'last-resort'/.test(strip(i.src)), true);

check('the vehicle and name rungs are unchanged',
  i => [/vName \+ ' — a question for you'/.test(strip(i.src)),
        /'A quick note for you, ' \+ _fbFirst/.test(strip(i.src))], [true, true]);

check('[LP SUBJECT FALLBACK DIAG] names which rung produced the subject',
  i => /\[LP SUBJECT FALLBACK DIAG\][\s\S]{0,120}_fbRung/.test(strip(i.src)), true);

// The ladder's arithmetic, run rather than described.
const rung = (veh, name, store, body) => {
  if (veh) return 'vehicle';
  if (name) return 'name';
  if (store) return 'store';
  return body ? 'first-clause' : 'last-resort';
};
console.log('\nwhat the ladder picks for the 8/27 leads that hit it:');
check('  KBB trade lead: no vehicle, no name, store known -> store',
  () => rung('', '', 'Community Honda Baytown', 'Perfect, about 10 today works'), 'store');
check('  a normal lead with a vehicle -> vehicle',
  () => rung('CR-V EX-L', 'Sarah', 'Community Honda Baytown', 'x'), 'vehicle');
check('  no vehicle but a name -> name',
  () => rung('', 'Sarah', 'Community Honda Baytown', 'x'), 'name');
check('  nothing but the body -> first-clause',
  () => rung('', '', '', 'Perfect, about 10 today works'), 'first-clause');

// ── (2) THE LEAD SOURCE ─────────────────────────────────────────────────────
console.log('\nsources a customer would recognise are still named:');

for (const [raw, want] of [
  ['Facebook', 'Facebook'],
  ['Cargurus', 'CarGurus'],
  ['Kbb Ico Kelley Blue Book', 'Kelley Blue Book'],
  ['Autotrader.com', 'Autotrader'],
  ['TrueCar', 'TrueCar'],
  ['Capital One', 'Capital One']
]) {
  check('  "' + raw + '" -> ' + want, i => i.source(raw), want);
}

console.log('\ninternal routing labels are NOT named:');

for (const raw of [
  'Thirdparty Honda',
  'Hds Chat-Text Leads - Gubagoo - Chat Gubagoo - M-Chat',
  'Gubagoo Virtual Retailing',
  'Lead Log',
  'Autosoft',
  'Phone Up',
  'Showroom',
  'Audi Partner Lead - Audi Partner Lead'
]) {
  check('  "' + raw.slice(0, 42) + '"', i => i.source(raw), '');
}

check('an empty or missing source names nothing',
  i => [i.source(''), i.source(null), i.source(undefined)], ['', '', '']);

check('the whitelist still matches when the label is buried in a longer string',
  i => i.source('Internet - Facebook Marketplace - Baytown'), 'Facebook');

console.log('\nthe two prompt lines that printed the raw string are sanitised:');

check('neither site interpolates data.leadSource verbatim any more',
  i => /LEAD \(source: ' \+ data\.leadSource/.test(strip(i.src)), false);

check('both ask the sanitiser instead',
  i => (strip(i.src).match(/LEAD \(source: ' \+ \(_lpCustomerFacingSource\(data\.leadSource\)/g) || []).length, 2);

check('a hard constraint covers the transcript path too — the likelier one on this lead',
  i => /HOW THIS LEAD REACHED US: do NOT tell the customer where their inquiry came from/.test(strip(i.src)), true);

check('...and it still permits the recognised name when there is one',
  i => /you may say the customer came through ' \+ _lpCustomerFacingSource/.test(strip(i.src)), true);

// ── (3) THE STORE PHONE ─────────────────────────────────────────────────────
// This runs against the SHIPPED directory. If someone's number changes, this changes with it.
console.log("\nthe number the admin panel serves for Honda Baytown, checked against the real directory:");

check('281-837-3382 resolves to a person, not a store line',
  i => i.owner('281-837-3382'), 'gil guzman');

check('...and the real 6191 store fallback resolves to nobody',
  i => i.owner(i.storeFallback('6191')), '');

check('every configured store fallback is free of personal numbers',
  i => ['6189', '6190', '6191', '24399', '21135'].map(id => i.owner(i.storeFallback(id))),
  ['', '', '', '', '']);

check("a signing agent's own number is correctly identified as personal",
  i => i.owner('281-837-3381'), 'kaylee guzman');

check('formatting does not matter — digits are compared',
  i => [i.owner('(281) 837-3382'), i.owner('2818373382'), i.owner('281.837.3382')],
  ['gil guzman', 'gil guzman', 'gil guzman']);

check('a number belonging to nobody passes',
  i => i.owner('555-555-1234'), '');

check('malformed input is refused rather than guessed at',
  i => [i.owner(''), i.owner(null), i.owner('12345'), i.owner('not a phone')], ['', '', '', '']);

console.log('\nthe guard refuses it and says so, rather than silently working around it:');

check('the store-config read consults the guard',
  i => /var _psOwner = _lpPersonalNumberOwner\(_pds\.phone\);/.test(strip(i.src)), true);

check('...substitutes the real store line',
  i => /_promptStorePhone = _psReal;/.test(strip(i.src)), true);

// There are TWO [LP STORE PHONE GUARD] lines — the refusal and the catch-block's degrade notice.
// A single .match() returns whichever comes first in the file, which is the catch one; asserting
// against that reported the refusal as missing. Check every occurrence and require one to carry
// all three parts.
check('[LP STORE PHONE GUARD] names the owner, the dealer and the remedy',
  i => {
    const all = strip(i.src).split('[LP STORE PHONE GUARD]').slice(1).map(t => t.slice(0, 400));
    return all.some(t => /_psOwner/.test(t) && /dealerId/.test(t) && /FIX THE ADMIN PANEL/.test(t));
  }, true);

check('...and the other occurrence is the degrade notice, not a second refusal',
  i => strip(i.src).split('[LP STORE PHONE GUARD]').length - 1, 2);

// The TDZ that the first version of this guard actually had.
console.log('\nthe directory read cannot take a generation down:');

check('the PHONE_DIR access is wrapped — `typeof` does NOT protect a const in its dead zone',
  i => /try \{[\s\S]{0,200}for \(var name in PHONE_DIR\)/.test(strip(i.src)), true);

check('...and a directory failure degrades to "no owner", never a throw',
  i => /catch \(e\) \{[\s\S]{0,200}cannot verify, allowing/.test(strip(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
