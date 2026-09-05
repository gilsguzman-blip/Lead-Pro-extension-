#!/usr/bin/env node
'use strict';
// (v9.7.635) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('source-name.test.js');

/**
 * source-name.test.js — v9.7.635. THREE OF OUR OWN DIRECTIVES DISAGREED ABOUT WHAT TO CALL A LEAD
 * SOURCE, AND ONE OF THEM HANDED THE MODEL THE RAW CRM LABEL.
 *
 * Gil, on the 9/5 Rebekah Fontenot lead (Community Honda Lafayette, 2026 Pilot Elite):
 * "the Gubagoo digital wasn't identified as a Click & Go". Correct — and the consequence was
 * worse than a missing label. Her delivered prompt carried all three of these:
 *
 *   SOURCE ACKNOWLEDGMENT: "This lead came in through: Hds Dr Lead - Gubagoo - Drs Digital
 *                           Retailing. Naturally reference where the inquiry originated ...
 *                           e.g. 'Thanks for your inquiry on Hds Dr Lead - Gubagoo - Drs
 *                           Digital Retailing...'"
 *   HARD CONSTRAINT:       "do NOT tell the customer where their inquiry came from. The source
 *                           on this lead is an internal routing label ... CRM plumbing"
 *   CLICK & GO BRANCH:     "Never say Gubagoo, virtual retailing platform, digital retailing"
 *
 * The first tells the model to say a string the third forbids word for word, while the second
 * says not to name the source at all.
 *
 * CAUSE: TWO SEPARATE DEFINITIONS OF "IS THIS SOURCE CUSTOMER-FACING". The acknowledgment block
 * carried its own _ackable regex, which matched `gubagoo`; _lpCustomerFacingSource — which the
 * HARD CONSTRAINT consults — had no entry for the source at all and returned ''. One list said
 * yes, the other said no, in the same prompt.
 *
 * FIXED THE WAY v9.7.631 FIXED THE LAST PAIR: the directive whose JOB is to determine the fact
 * owns it. _lpCustomerFacingSource is now the single definition, the acknowledgment block reads
 * it instead of guessing, and where it has no name the acknowledgment stays silent rather than
 * contradicting the constraint. The raw label never reaches the prompt from that block again.
 *
 * AND CLICK & GO IS A REAL NAME — Honda's own online buying tool, the thing this customer
 * clicked, already spoken to customers by the scenario branch ("I saw you started your deal
 * online through Click & Go"). The forbidden list names the VENDOR and the jargon, never the
 * product.
 *
 * THE OVER-REACH THIS SUITE EXISTS TO PIN: a naive /gubagoo/ mapped "Gubagoo - M-Chat" to
 * Click & Go too — but M-Chat is the CHAT product, so that tells a chat customer they used a
 * tool they never opened, and "Gubagoo - M-Chat" is named in the HARD CONSTRAINT's own list of
 * labels that must not be spoken. It would have re-created the contradiction one source over.
 *
 * Executes the SHIPPED resolver. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: source-name.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('source-name.test.js', m);

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('var _LP_CUSTOMER_FACING_SOURCES = [');
  const b = src.indexOf('\n}', src.indexOf('function _lpCustomerFacingSource(raw) {', a));
  if (a < 0 || b < 0) bail('resolver not in ' + file);
  const sb = { String };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b + 2), sb);
  return { src, resolve: vm.runInContext('_lpCustomerFacingSource', sb) };
}

for (const file of BUILDS) {
  const B = load(file);
  // (v9.7.636) Hoisted: several assertions below measure source POSITION, and every one of them
  // must run against comment-stripped code — this file's headers quote its own directives.
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  console.log('\n' + path.relative(process.cwd(), file) + ' — one name, or no name at all');

  // ── REBEKAH'S LEAD ─────────────────────────────────────────────────────────
  console.log("\nthe source Gil reported:");
  check('Hds Dr Lead - Gubagoo - Drs Digital Retailing resolves',
    B.resolve('Hds Dr Lead - Gubagoo - Drs Digital Retailing'), 'Click & Go');
  check('...and the name carries no forbidden word',
    /gubagoo|virtual retail|digital retail|dynamic credit/i.test(B.resolve('Hds Dr Lead - Gubagoo - Drs Digital Retailing')), false);
  for (const s of ['Gubagoo - DRS', 'HDS DR Lead', 'Click & Go', 'Click and Go',
                   'Honda Digital Retailing', 'Virtual Retail Deal'])
    check('  also resolves: ' + JSON.stringify(s), B.resolve(s), 'Click & Go');

  // ── THE OVER-REACH THAT MUST NOT HAPPEN ────────────────────────────────────
  // Found by running the first draft against every real source in the captured logs.
  // (v9.7.636) The ASSERTION IS THE INTENT, not the old value. Under v9.7.635 these resolved to
  // '' because chat was suppressed entirely; under v9.7.636 they are acknowledged as what they
  // actually are. What must never change is that a CHAT customer is not told they used Click & Go
  // — a tool they never opened. That is what this block has always been about, and it is now
  // asserted directly instead of via a suppression that happened to imply it.
  console.log('\nchat is NOT Click & Go — it is a different product the customer never opened:');
  for (const s of ['Gubagoo - M-Chat', 'Gubagoo Chat', 'Hds Chat-Text Leads',
                   'Gubagoo Chat-Text', 'Gubagoo M-Chat Digital Retailing'])
    check('  not Click & Go: ' + JSON.stringify(s), B.resolve(s) === 'Click & Go', false);
  check('  ...an SMS lead is named as a text, not an online form',
    B.resolve('Gubagoo - SMS'), 'your text to us');
  check('  ...and a chat/DR hybrid label still reads as chat',
    B.resolve('Gubagoo M-Chat Digital Retailing'), 'your chat with us');
  check('the exclusion matches the classifier\'s own chat test',
    /isGubagooChat = \/chat\|\\bsms\\b\/i\.test\(ls\)/.test(B.src), true);

  // ── EVERY OTHER REAL SOURCE, UNCHANGED ─────────────────────────────────────
  // Scope discipline: this build must not have moved any source that already had a name.
  console.log('\nevery source that already had a name still has the same one:');
  for (const [s, want] of [
    ['Kbb Ico Kelley Blue Book - Mobile',              'Kelley Blue Book'],
    ['Autotrader.Com - Lead',                          'Autotrader'],
    ['Cargurus Area Boost',                            'CarGurus'],
    ['Truecar/Truecar For Intuit Credit Karma Members', 'TrueCar'],
    ['Facebook',                                       'Facebook'],
    ['Capital One',                                    'Capital One'],
    ['Cars.com',                                       'Cars.com'],
    ['Costco',                                         'the Costco Auto Program'],
    ['Dealer Website',                                 'our website'],
  ]) check('  ' + JSON.stringify(s.slice(0, 34)), B.resolve(s), want);

  // ── (v9.7.636) EVERY WEB SOURCE GETS AN ACKNOWLEDGMENT ─────────────────────────────────────
  // Gil, on v9.7.635: "losing the sources is not acceptable, that acknowledgment builds trust
  // with the customer. that's why it was built that way." He is right and my v9.7.635 read the
  // problem too narrowly: the answer to "this source has no customer-facing name" is to GIVE it
  // one. Silence and the raw CRM label were never the only two options.
  console.log('\nweb sources we cannot name specifically are still acknowledged:');
  for (const s of ['Thirdparty Honda - ', 'Audi Partner Lead - Used/Cpo', 'Kia Digital - 3rd Party Lead',
                   'Dealer E-Process - General Sales', 'Digital Advertising-Google',
                   'Some Label The CRM Invents Next'])
    check('  ' + JSON.stringify(s.trim().slice(0, 36)), B.resolve(s), 'your online inquiry');

  console.log('\n...a chat lead is acknowledged as a chat:');
  for (const s of ['Gubagoo - Chat Form', 'Hds Chat-Text Leads - Gubagoo - Chat', 'Gubagoo - Chat - Resq'])
    check('  ' + JSON.stringify(s.slice(0, 36)), B.resolve(s), 'your chat with us');

  console.log('\n...and the specific names that were missing are back:');
  check('  Toyota.Com-Payment Estimator', B.resolve('Toyota.Com-Payment Estimator'), 'Toyota.com');
  check('  Kia.com', B.resolve('Kia.com'), 'Kia.com');
  check('  Cap One Mailer — the abbreviation never matched before',
    B.resolve('Cap One Mailer'), 'Capital One');

  // ── THE GUARD ON THE CATCH-ALL, AND IT IS THE POINT OF IT ──────────────────────────────────
  // "Thanks for your online inquiry" said to a walk-in is FALSE, and saying something untrue
  // about the customer is what the rated-down "Thirdparty Honda" message actually did wrong — the
  // label was the symptom. Anyone who never filled in a form stays silent.
  console.log('\nbut a customer who never inquired online is never told they did:');
  for (const s of ['Walk In', 'Walk In - Drive By', 'Showroom', 'Service Dept', 'Phone Up',
                   'Repeat Customer', 'Identitymax', 'Amp - Buying Signals', 'AMP - Request Help',
                   'Event-Sports', 'Lead Log', 'Autosoft', 'Kmf Luv Program'])
    check('  silent: ' + JSON.stringify(s.slice(0, 34)), B.resolve(s), '');
  check('the fence is a named constant, not an inline regex',
    /var _LP_NON_WEB_ORIGIN = \//.test(code), true);
  check('...consulted before the catch-all returns',
    /if \(_LP_NON_WEB_ORIGIN\.test\(s\)\) return '';\n  return 'your online inquiry';/.test(code), true);

  // (v9.7.635's "every routing label still has none" block was REMOVED here, not weakened: four
  // of its six entries asserted exactly the silence Gil rejected — "Thirdparty Honda",
  // "Kia Digital", "Toyota.Com-Payment Estimator" now carry names, and the two that genuinely
  // never inquired online are covered by the fuller list above.)
  check('Ai Buying Signal is still silent — a marketing record, not an inquiry',
    B.resolve('Ai Buying Signal'), '');

  // ── NO RESOLVED NAME MAY CONTAIN A FORBIDDEN WORD ──────────────────────────
  // The trap this build could most easily have walked into: trading one contradiction for another.
  console.log('\nno name the resolver can return is a word another directive forbids:');
  const ALL = ['Hds Dr Lead - Gubagoo - Drs Digital Retailing', 'Kbb Ico Kelley Blue Book - Mobile',
    'Autotrader.Com - Lead', 'Cargurus', 'Facebook', 'Capital One', 'Costco', 'Cars.com',
    'Dealer Website', 'Truecar', 'Carfax', 'Edmunds', 'Click & Go'];
  check('checked ' + ALL.length + ' sources',
    ALL.map(s => B.resolve(s)).filter(n => n && /gubagoo|virtual retail|digital retail|dynamic credit/i.test(n)).length, 0);

  // ── THE ACKNOWLEDGMENT BLOCK READS THE RESOLVER ────────────────────────────
  console.log('\nthe acknowledgment block no longer keeps its own list:');
  check('the private _ackable regex is gone', /var _ackable = \//.test(code), false);
  check('...replaced by the shared resolver',
    /var _ackName = \(typeof _lpCustomerFacingSource === 'function'\) \? _lpCustomerFacingSource\(_ls\) : '';/.test(code), true);
  check('...and it returns early when there is no name', /if \(!_ackName\) return;/.test(code), true);
  check('the raw lead source is never pushed into the prompt from this block',
    /ageBlock\.push\('This lead came in through: ' \+ _ls/.test(code), false);
  check('...the emitted line uses the resolved name',
    /ageBlock\.push\('This lead came in through ' \+ _ackName/.test(code), true);
  check('...and forbids any other name for it',
    /never a CRM routing \\?'?\s*\+?\s*'?label, a vendor name, or anything you see in the notes/.test(code)
      || /never a CRM routing /.test(code), true);
  check('the decision is logged either way', /\[LP SOURCE ACK DIAG\]/.test(B.src), true);
  check('...naming the resolved name or NONE', /customer-facing name:' \+ \(_ackName \? JSON\.stringify\(_ackName\) : 'NONE'\)/.test(B.src), true);

  // ── THE THREE DIRECTIVES NOW AGREE ─────────────────────────────────────────
  console.log('\nthe HARD CONSTRAINT reads the same resolver, so the pair cannot disagree:');
  check('the constraint is driven by _lpCustomerFacingSource',
    /_lpCustomerFacingSource\(data\.leadSource\)\s*\?\s*'- HOW THIS LEAD REACHED US: you may say the customer came through '/.test(code), true);
  check('...and falls to "do not name it" only when there is no name',
    /'- HOW THIS LEAD REACHED US: do NOT tell the customer where their inquiry came from\./.test(code), true);
  // ON CODE, NOT ON PROSE. This build's own header quotes both "Never say Gubagoo, virtual
  // retailing platform, digital retailing" AND "Click & Go", so a [^']* span over raw source
  // bridges them and reports the product name as forbidden. Seventh instance this week
  // (v9.7.563, .631, .632, .633 x2, .634, here) — and I wrote "no exceptions from here on" in the
  // v9.7.634 header, then wrote this assertion against B.src anyway. Comments stripped.
  check('the Click & Go branch still forbids the vendor words',
    /Never say Gubagoo, virtual retailing platform, digital retailing/.test(code), true);
  check('...and "Click & Go" is not among them',
    /Never say Gubagoo[^']*Click ?& ?Go/i.test(code), false);
  check('the scenario branch already says Click & Go to the customer',
    /I saw you started your deal online through Click & Go/.test(code), true);

  console.log('\nit never throws:');
  check('empty', B.resolve(''), '');
  check('null', B.resolve(null), '');
  check('whitespace', B.resolve('   '), '');
}

if (BUILDS.length > 1) {
  console.log('\nboth builds resolve identically:');
  const region = (f, o, c) => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf(o), b = s.indexOf(c, a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('the source map is identical',
    region(BUILDS[0], 'var _LP_CUSTOMER_FACING_SOURCES = [', 'function _lpCustomerFacingSource')
    === region(BUILDS[1], 'var _LP_CUSTOMER_FACING_SOURCES = [', 'function _lpCustomerFacingSource'), true);
  check('the acknowledgment block is identical',
    region(BUILDS[0], 'var _ackName = (typeof _lpCustomerFacingSource', "notes or lead history.');")
    === region(BUILDS[1], 'var _ackName = (typeof _lpCustomerFacingSource', "notes or lead history.');"), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
