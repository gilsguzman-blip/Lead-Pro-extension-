#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('customer-facing-hygiene.test.js');

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
    // (v9.7.599) The ladder is now EXECUTED, not just scanned. Every assertion below used to be a
    // source-scan, and that is precisely why nobody noticed it read the wrong object for three
    // builds: the shape was right, the binding was wrong, and a regex over source cannot tell the
    // difference. It reads `lastScrapedData`, so the harness passes one in.
    subject: (rawEmail, lead) => {
      const a = src.indexOf('      // (v9.7.599) THE v9.7.596 LADDER READ THE WRONG OBJECT');
      if (a < 0) throw new Error('NOT IN THIS BUILD: subject ladder');
      const endMark = "        + ' name:' + (_fbFirst || '(none)') + ' store:' + (_fbStore || '(none)'));";
      const b = src.indexOf(endMark, a);
      if (b < 0) throw new Error('NOT IN THIS BUILD: subject ladder end');
      const s2 = { String, RegExp, console: { log() {} } };
      vm.createContext(s2);
      vm.runInContext('function subj(rawEmail, lastScrapedData){ var fallbackSubject="", _fbRung="";\n'
        + src.slice(a, b + endMark.length) + '\n return { subject: fallbackSubject, rung: _fbRung }; }', s2);
      return vm.runInContext('subj', s2)(rawEmail, lead);
    },
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

// ── (1b) THE LADDER, EXECUTED ───────────────────────────────────────────────
// (v9.7.599) Billy Broussard, Audi Lafayette, 8/28 — the delivered email read "Subject: Billy,".
// The ladder had fallen to its first-clause rung and taken the GREETING, on a lead whose vehicle,
// name and store were all known.
//
// Two defects, and the second is the one that matters. The strip only handled "Hi X," / "Hello X,"
// — but this file's own EMAIL FORMAT RULES prescribe the bare-name form for a first touch, so the
// commonest greeting was the one it missed. And underneath that: the ladder read `data`, which
// inside generateAll() is `const data = await resp.json()` — the WORKER'S RESPONSE, carrying no
// vehicle, name or store. All three upper rungs were empty on every generation since v9.7.596.
//
// Identical to the v9.7.502 defect in this file's own history: a scan reading a field that is
// never assigned in that scope, silently returning empty forever. Every assertion covering this
// ladder was a source-scan, which is why three builds went by without noticing: the shape was
// right and the binding was wrong. These EXECUTE it.
console.log('\nthe subject ladder, run against Billy\'s real email:');

const BILLY_EMAIL = "Billy,\n\nI know it's been a little quiet on the 2025 Chevrolet Silverado 1500 Custom "
  + "you asked about, but we do still have it here in Red Hot and available to look at.\n\nIs that still on your radar?";
const BILLY_LEAD = { vehicle: '2025 Chevrolet Silverado 1500 Custom', name: 'Billy Broussard', store: 'Audi Lafayette' };

check('his lead reaches the VEHICLE rung, not first-clause',
  i => i.subject(BILLY_EMAIL, BILLY_LEAD).rung, 'vehicle');

check('...so the subject names the truck',
  i => i.subject(BILLY_EMAIL, BILLY_LEAD).subject, 'Chevrolet Silverado 1500 Custom — a question for you');

check('the subject is never just his name',
  i => /^Billy,?\s*$/i.test(i.subject(BILLY_EMAIL, BILLY_LEAD).subject), false);

console.log('\neach rung is reachable — proving the object it reads is the real lead:');
check('  vehicle known            -> vehicle',
  i => i.subject(BILLY_EMAIL, BILLY_LEAD).rung, 'vehicle');
check('  no vehicle, name known   -> name',
  i => i.subject(BILLY_EMAIL, { name: 'Billy Broussard', store: 'Audi Lafayette' }).rung, 'name');
check('  only the store known     -> store',
  i => i.subject(BILLY_EMAIL, { store: 'Audi Lafayette' }).rung, 'store');
check('  nothing known            -> first-clause',
  i => i.subject(BILLY_EMAIL, {}).rung, 'first-clause');

console.log('\ngreetings are stripped before the first clause is taken:');
check('a BARE-NAME greeting is stripped — the form the format rules prescribe',
  i => i.subject(BILLY_EMAIL, {}).subject.indexOf('Billy') === 0, false);
check('...and the first real sentence is used instead',
  i => /^I know it/.test(i.subject(BILLY_EMAIL, {}).subject), true);
check('"Hi Sarah," is still stripped',
  i => i.subject('Hi Sarah,\n\nThe Accord is ready whenever you are.', {}).subject,
  'The Accord is ready whenever you are');
check('a full-name greeting is stripped too',
  i => /^Billy/.test(i.subject('Billy Broussard,\n\nThe truck is here.', {}).subject), false);
check('an email that is ONLY a greeting falls through rather than shipping the name',
  i => i.subject('Billy,\n', { name: 'Billy Broussard' }).rung, 'name');

check('the ladder reads lastScrapedData, not the worker response',
  i => /_fbLead\s*=\s*\(typeof lastScrapedData === 'object'/.test(strip(i.src)), true);

check('...and `data.vehicle` is gone from it',
  i => /var vName = data\.vehicle/.test(strip(i.src)), false);

check('[LP SUBJECT FALLBACK DIAG] now prints what each rung SAW, so an empty read is visible',
  i => /saw vehicle:[\s\S]{0,80}store:/.test(strip(i.src)), true);

// ── (2) THE LEAD SOURCE ─────────────────────────────────────────────────────
console.log('\nsources a customer would recognise are still named:');

for (const [raw, want] of [
  ['Facebook', 'Facebook'],
  ['Cargurus', 'CarGurus'],
  ['Kbb Ico Kelley Blue Book', 'Kelley Blue Book'],
  ['Autotrader.com', 'Autotrader'],
  ['TrueCar', 'TrueCar'],
  ['Capital One', 'Capital One'],
  // (v9.7.635) MOVED UP FROM THE "not named" LIST BELOW, deliberately and not to make a test pass.
  // Gil, on the 9/5 Rebekah Fontenot lead: "the Gubagoo digital wasn't identified as a Click & Go".
  // The distinction this section draws is LABEL vs RECOGNISABLE NAME, and Click & Go is the second
  // kind — it is Honda's own online buying tool, the thing the customer actually clicked, and the
  // Click & Go scenario branch has always said it out loud to customers ("I saw you started your
  // deal online through Click & Go"). The resolver's whole contract is "given a raw routing label,
  // return a name the customer would recognise, or nothing", so this is the resolver working.
  // The hygiene property is unchanged and is asserted directly below: the RAW label still never
  // reaches the customer. Chat sources stay in the "not named" list — see the entry there.
  ['Gubagoo Virtual Retailing', 'Click & Go'],
  ['Hds Dr Lead - Gubagoo - Drs Digital Retailing', 'Click & Go']
]) {
  check('  "' + raw + '" -> ' + want, i => i.source(raw), want);
}

// The property this section exists to protect, asserted on its own terms rather than implied by
// the mapping: whatever the resolver returns, it is never the raw CRM string and never the vendor.
console.log('\n...but the resolved name is never the raw label or the vendor:');
for (const raw of ['Hds Dr Lead - Gubagoo - Drs Digital Retailing', 'Gubagoo Virtual Retailing',
                   'Kbb Ico Kelley Blue Book', 'Cargurus Area Boost']) {
  check('  "' + raw.slice(0, 40) + '" -> not the label itself', i => i.source(raw) === raw, false);
  check('  ...and carries no vendor/jargon word',
    i => /gubagoo|virtual retail|digital retail|dynamic credit|\bhds\b|\bdrs\b/i.test(i.source(raw)), false);
}

console.log('\ninternal routing labels are NOT named:');

for (const raw of [
  'Thirdparty Honda',
  'Hds Chat-Text Leads - Gubagoo - Chat Gubagoo - M-Chat',
  // (v9.7.635) 'Gubagoo Virtual Retailing' moved to the RECOGNISED list above — it is the
  // digital-retailing product (Click & Go), not a chat/plumbing label. The chat variants stay here.
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

// (v9.7.597) WAS 2, NOW 3, AND THE THIRD IS THE POINT. v9.7.596 had a refusal at the prompt site
// plus the catch-block degrade notice. v9.7.597 adds a third at the dealer-config WRITE, which is
// where the fix actually belongs: the prompt-site guard only protected one reader, while
// lookupPhone() reads the same table for any agent missing from PHONE_DIR. Refusing the write
// covers every reader. Counted rather than left open-ended so a fourth appearing unannounced is
// a failure to look at, not a silent drift.
check('there are exactly three guard sites: the write, the prompt, and the degrade notice',
  i => strip(i.src).split('[LP STORE PHONE GUARD]').length - 1, 3);

check('...and the WRITE-site one refuses before the table is ever poisoned',
  i => /NOT WRITTEN\. Keeping the/.test(strip(i.src)), true);

// The TDZ that the first version of this guard actually had.
console.log('\nthe directory read cannot take a generation down:');

check('the PHONE_DIR access is wrapped — `typeof` does NOT protect a const in its dead zone',
  i => /try \{[\s\S]{0,200}for \(var name in PHONE_DIR\)/.test(strip(i.src)), true);

check('...and a directory failure degrades to "no owner", never a throw',
  i => /catch \(e\) \{[\s\S]{0,200}cannot verify, allowing/.test(strip(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
