#!/usr/bin/env node
'use strict';
/**
 * amp-banner.test.js — the [LP AMP DIAG] probe (v9.7.550 / v9.7.549).
 *
 * THE QUESTION: is the Customer Dashboard's AMP banner — #keyInfo-Amp-blurb / .amp-summary,
 * "This customer received an AMP marketing event" — capturable? It is plainly visible in the CRM
 * on Juan Aguirre's lead (2068821407, Amp - Buying Signals, Toyota Baytown, 8/17), and it would be
 * a far better AMP signal than the lead-source regex that is all s.isAMP has ever had.
 *
 * THE ANSWER FROM THE 8/17 CAPTURE: it is not in the scraped DOM. Not the id, not the class, not
 * the banner text, not "Equity:", not "Customer Intelligence", not the campaign copy — in a dump
 * that DOES contain CustomerDashboardTop with the customer's name, phones and address. The frame
 * was captured; the Key Information panel had not rendered into it. So a selector added today
 * could not fire and would look exactly like a working feature — the v9.7.455 / v9.7.505 /
 * v9.7.532 shape, three times over. This build ships a PROBE, not a feature.
 *
 * This suite pins three things:
 *   A. the probe reports ABSENCE correctly on the real 8/17 DOM shape,
 *   B. it reports PRESENCE correctly on the shape the screenshot shows, so a future live log is
 *      trustworthy either way,
 *   C. it is inert — inside inlineScraper, no module-scope references, and it writes nothing to
 *      the result object and touches no vehicle field, which is what makes it independent of the
 *      VOI-finder work.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: amp-banner.test.js <popup.js> [popup.js...]'); process.exit(2); }

// A DOM shim with exactly the surface the probe uses.
function makeDoc(nodes, bodyHtml) {
  const byId = {};
  const all = nodes || [];
  all.forEach(n => { if (n.id) byId[n.id] = n; });
  const matches = (n, sel) => sel.split(',').map(s => s.trim()).some(s => {
    if (s.startsWith('#')) return n.id === s.slice(1);
    if (s.startsWith('[id^=')) { const p = s.match(/\[id\^="(.*?)"\]/); return p && n.id && n.id.startsWith(p[1]); }
    if (s.startsWith('[class*=')) { const p = s.match(/\[class\*="(.*?)"\]/); return p && (n.className || '').includes(p[1]); }
    if (s.startsWith('.')) return (n.className || '').split(/\s+/).includes(s.slice(1));
    return false;
  });
  return {
    getElementById: id => byId[id] || null,
    querySelector: sel => all.find(n => matches(n, sel)) || null,
    querySelectorAll: sel => all.filter(n => matches(n, sel)),
    body: { innerHTML: bodyHtml || '' }
  };
}

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    try {\n      var _ampEl   = document.getElementById(');
  const b = src.indexOf('    } catch(_ampE) {}', a);
  if (a < 0 || b < 0) throw new Error('could not locate the AMP probe in ' + file);
  const body = src.slice(a, b) + '    } catch(_ampE) {}';

  const ctx = { JSON: JSON };
  vm.createContext(ctx);
  const run = vm.runInContext(
    '(function(document, TEXT){ var out = [];\n' +
    '  function _lpD(){ out.push(Array.prototype.join.call(arguments, " ")); }\n' +
    body + '\n  return out; })', ctx);

  // scope discipline: the probe is injected into the page, so module scope does not exist there
  const lines = src.split('\n');
  const s0 = lines.findIndex(l => l.trim().startsWith('function inlineScraper()'));
  const s1 = lines.findIndex((l, i) => i > s0 && l.trim() === '} // end inlineScraper');
  const at = lines.findIndex(l => l.includes('var _ampEl   = document.getElementById'));

  return { name: path.basename(path.dirname(file)), run, body,
           inScraper: s0 >= 0 && s1 > s0 && at > s0 && at < s1 };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, build);
let pass = 0, fail = 0;
function eq(name, fn, want) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const field = (line, key) => {
  const m = line.match(new RegExp('\\| ?' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':([^|]*)'));
  return m ? m[1].trim() : (line.match(new RegExp(key + ':([^|]*)')) || [, ''])[1].trim();
};

console.log('\nv9.7.550 — [LP AMP DIAG]: can the AMP banner be captured?');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── A. the real 8/17 shape: CustomerDashboardTop present, Key Information panel absent ────
const REAL_817 = () => makeDoc(
  [{ id: 'CustomerDashboardTop', className: '' },
   { id: 'CxComponent_rims', className: '' }],
  '<div id="CxComponent_rims"><div id="CustomerDashboardTop">Juan Aguirre 4919 Magestic Dr</div></div>'
);
// The 8/17 page text, including the GTM analytics string that is the ONLY "keyInfo" in the file.
const REAL_TEXT_817 = 'Lead Info Status: Active New Lead Source: Amp - Buying Signals ' +
  'a.target.closest("#cd-customer-profile #keyInfo-Accelerate") pxaSource:"key-information" ' +
  'Juan Aguirre 4919 Magestic Dr Baytown, TX 77523';

console.log('A. THE REAL 8/17 CAPTURE — the banner is not there:');
eq('the probe fires (the frame is a dashboard frame, so absence is worth reporting)',
  i => i.run(REAL_817(), REAL_TEXT_817).length, 1);
eq('blurbById:false', i => field(i.run(REAL_817(), REAL_TEXT_817)[0], 'blurbById'), 'false');
eq('byClass:false', i => field(i.run(REAL_817(), REAL_TEXT_817)[0], 'byClass'), 'false');
eq('bannerTextInFrame:false', i => field(i.run(REAL_817(), REAL_TEXT_817)[0], 'bannerTextInFrame'), 'false');
eq('keyInfoNodes:0 — the Key Information panel never rendered',
  i => field(i.run(REAL_817(), REAL_TEXT_817)[0], 'keyInfoNodes'), '0');
eq('the GTM "#keyInfo-Accelerate" string in analytics source does NOT count as a node',
  i => /keyInfoNodes:0/.test(i.run(REAL_817(), REAL_TEXT_817)[0]), true);

// ── B. the shape the screenshot shows ─────────────────────────────────────────────────────
const RENDERED = () => makeDoc([
  { id: 'CustomerDashboardTop', className: '' },
  { id: 'cd-customer-profile', className: 'key-information-panel' },
  { id: 'keyInfo-CustomerIntelligence', className: 'key-information-banner-summary' },
  { id: 'keyInfo-BuyingSignals', className: 'key-information-banner-summary' },
  // The real markup nests the class on a CHILD span, not on the div that carries the id:
  //   <div id="keyInfo-Amp-blurb" class="key-information-banner-summary…">
  //     <span class="amp-summary…">This customer received an AMP marketing event</span>
  //   </div>
  // Two independent routes to the same fact, which is the point of probing for both.
  { id: 'keyInfo-Amp-blurb', className: 'key-information-banner-summary',
    innerText: 'This customer received an AMP marketing event' },
  { id: '', className: 'amp-summary amp-summary-text',
    innerText: 'This customer received an AMP marketing event' },
], '<div id="CustomerDashboardTop">Juan Aguirre</div>');
const RENDERED_TEXT = 'Key Information Customer Intelligence Buying Signals ' +
  'This customer received an AMP marketing event Equity: $16,856 2023 Toyota Corolla';

console.log('\nB. THE SHAPE THE SCREENSHOT SHOWS — the probe would report it:');
eq('blurbById:true', i => field(i.run(RENDERED(), RENDERED_TEXT)[0], 'blurbById'), 'true');
eq('byClass:true (the class selector is a second route to the same element)',
  i => field(i.run(RENDERED(), RENDERED_TEXT)[0], 'byClass'), 'true');
eq('bannerTextInFrame:true', i => field(i.run(RENDERED(), RENDERED_TEXT)[0], 'bannerTextInFrame'), 'true');
eq('keyInfoNodes counts the whole panel, not just AMP',
  i => field(i.run(RENDERED(), RENDERED_TEXT)[0], 'keyInfoNodes').split(' ')[0], '3');
eq('the id route and the class route agree — either alone would have found it',
  i => { const l = i.run(RENDERED(), RENDERED_TEXT)[0];
         return [field(l, 'blurbById'), field(l, 'byClass')]; }, ['true', 'true']);
eq('the ids are listed so a renamed element is diagnosable',
  i => /keyInfo-CustomerIntelligence/.test(i.run(RENDERED(), RENDERED_TEXT)[0]), true);
eq('the banner text is captured verbatim',
  i => /This customer received an AMP marketing event/.test(i.run(RENDERED(), RENDERED_TEXT)[0]), true);

console.log('\n   partial renders are distinguishable from total absence:');
const PANEL_NO_AMP = () => makeDoc([
  { id: 'CustomerDashboardTop', className: '' },
  { id: 'keyInfo-BuyingSignals', className: 'key-information-banner-summary' },
], '<div id="CustomerDashboardTop">x</div>');
eq('panel rendered but no AMP row → nodes>0 while blurbById is false',
  i => { const l = i.run(PANEL_NO_AMP(), 'Key Information Buying Signals')[0];
         return [field(l, 'blurbById'), field(l, 'keyInfoNodes').split(' ')[0]]; },
  ['false', '1']);
eq('text present but element absent (a shadow-DOM or late-render tell)',
  i => { const l = i.run(REAL_817(), REAL_TEXT_817 + ' This customer received an AMP marketing event')[0];
         return [field(l, 'blurbById'), field(l, 'bannerTextInFrame')]; },
  ['false', 'true']);

console.log('\n   a frame with nothing dashboard-ish stays silent — no per-frame spam:');
eq('a bare shell frame emits no line', i => i.run(makeDoc([], ''), 'VinSolutions Connect').length, 0);
eq('a lead frame with no dashboard emits no line',
  i => i.run(makeDoc([{ id: 'ActiveLeadPanel1_m_VehicleInfo', className: '' }], '<div>lead</div>'),
             'Lead Info Status: Active').length, 0);

// ── C. inert by construction ──────────────────────────────────────────────────────────────
console.log('\nC. INERT — this is why it cannot interact with the VOI-finder work:');
eq('the probe lives inside inlineScraper', i => i.inScraper, true);
eq('it references no module-scope helper (the v9.7.455 trap)',
  i => ['_lpIsUSState','US_STATES','DEALER_LOCAL_ZIPS','_lpCustomerText','_lpDetectVoiConflict']
        .filter(m => i.body.includes(m)), []);
eq('it uses _lpD, not console.log — frame-side console never reaches an exported log',
  i => [i.body.includes('_lpD('), i.body.includes('console.log')], [true, false]);
eq('it assigns to no vehicle or VOI field',
  i => (i.body.match(/\b(vehicleRaw|vehicle|ownedVehicle|priorSoldVehicle|voi)\s*=[^=]/g) || []), []);
eq('it writes nothing to the scraper result object',
  i => (i.body.match(/^\s*(ampBanner|isAMP|ampEvent)\s*[:=]/gm) || []), []);
eq('every statement is inside its own try/catch',
  i => /^\s*try \{/.test(i.body) && /\} catch\(_ampE\) \{\}$/.test(i.body.trim()), true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
