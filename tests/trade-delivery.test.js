#!/usr/bin/env node
'use strict';
/**
 * trade-delivery.test.js — regression tests for the v9.7.538 fixes.
 *
 *   1a  TRADE CONFLATION GUARD must not fire on a NEGATIVE trade assertion
 *       ("Has trade-in: No", "Trade-in Info (none entered)").
 *   1b  The DEAL/INFO triggers must not read Lead Pro's OWN injected
 *       "VEHICLE/LEAD DETAILS:" directive block back as lead evidence.
 *   2   A delivery request must carry the approved transport verbiage.
 *
 * Detectors are sliced out of each shipped popup.js and evaluated, so the tests
 * exercise the bytes that ship. Every case runs against BOTH builds and must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: trade-delivery.test.js <popup.js> [popup.js...]'); process.exit(2); }

// Pull a single source line verbatim by a unique substring, so the test binds to
// shipped bytes rather than a reimplementation.
function lineWith(src, needle, file) {
  const hits = src.split('\n').filter(l => l.indexOf(needle) >= 0);
  if (hits.length !== 1) throw new Error('need exactly 1 line with ' + JSON.stringify(needle) + ' in ' + file + ', got ' + hits.length);
  return hits[0];
}

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const negLine  = lineWith(src, 'var _tvArcNet =', file);
  const negLine2 = lineWith(src, '.replace(/\\btrade\\s*:?\\s*\\(none entered\\)/g', file);
  const menLine  = lineWith(src, 'var _tvMentioned =', file);
  const mkLine   = lineWith(src, "var _ddCtxMk  =", file);
  const ctxLine  = lineWith(src, 'var _ddCtxArc =', file);
  const rxLine   = lineWith(src, 'var _ddTradeRx =', file);
  const delLine  = lineWith(src, 'if (/delivery\\s*requested\\s*:?\\s*yes/i.test(', file);

  const ctx = { console: { log() {} } };
  vm.createContext(ctx);

  // 1a — trade-mention detector, as shipped
  const tradeMentioned = vm.runInContext(
    '(function(arc){ var _tvArc = String(arc).toLowerCase(); ' + negLine + negLine2 + menLine + ' return _tvMentioned; })', ctx);

  // 1b — arc assembly + the trade-value regex, as shipped
  const tradeTrigger = vm.runInContext(
    '(function(data){ ' + mkLine.replace('var _ddCtxMk  =', 'var _ddCtxRaw = String((data && data.context) || ""); var _ddCtxMk  =') +
    ctxLine +
    ' var _ddRecent = String((data && data.lastInboundMsg) || "") + " \\n " + String((data && data.conversationBrief) || "") + " \\n " + _ddCtxArc; ' +
    rxLine +
    ' var m = _ddRecent.match(_ddTradeRx); return m ? m[0] : null; })', ctx);

  // 2 — delivery-requested detector, as shipped
  const deliveryFires = vm.runInContext('(function(ddJoined){ var _dd = [ddJoined]; var out = false; ' +
    delLine.replace(/\{\s*$/, '{ out = true;') + ' } return out; })', ctx);

  return { name: path.basename(path.dirname(file)), tradeMentioned, tradeTrigger, deliveryFires };
}

const impls = BUILDS.map(build);
let pass = 0, fail = 0;

function check(name, fn, expect) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(expect);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(expect) + ', got ' + results[0]);
  }
}

console.log('\nv9.7.538 — trade de-pollution + delivery verbiage');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── 1a — negative trade assertions ─────────────────────────────────────────────
console.log('trade-mention detector — must stay SILENT on a negative:');
check('Woodfork: CarGurus "Has trade-in: No"',
  i => i.tradeMentioned('Delivery requested: YES | Placed deposit: No | Has trade-in: No | F&I products added: No'), false);
check('CRM panel "Trade-in Info (none entered)"',
  i => i.tradeMentioned('Trade-in Info (none entered) Buyer and Co-buyer Information'), false);
check('both negatives together',
  i => i.tradeMentioned('Has trade-in: No\nTrade-in Info (none entered)'), false);

console.log('\ntrade-mention detector — must still FIRE on a real trade:');
check('deal builder "Has trade-in: Yes"', i => i.tradeMentioned('Has trade-in: Yes | Offer Received: No'), true);
check('customer asks what their trade is worth', i => i.tradeMentioned('[CUSTOMER] what is my trade worth'), true);
check('agent note mentions an appraisal', i => i.tradeMentioned('[NOTE] customer wants an appraisal on his truck'), true);
check('real ask alongside a negative field in one arc',
  i => i.tradeMentioned('Has trade-in: No\n[CUSTOMER] actually what would you give me for my trade'), true);

// ── 1b — LP's own directive block must not feed the trigger ────────────────────
console.log('\ndeal/info trade trigger — must ignore LP\'s own injected block:');
const WOODFORK_ARC = 'Financing: ERROR via Hard Pull Delivery requested: YES Has trade-in: No (CarGurus IMV: $35,045)\n' +
  '[08/10/2026 11:07 AM] [CALL NOTE] Left message-Hi Manzel, I saw the CarGurus deal you built for the 2024 BMW 4 Series 430i';
const LP_BLOCK = '\n\nVEHICLE/LEAD DETAILS:\n' +
  '⚠ TRADE DISCUSSED, BUT NO TRADE VEHICLE IS IN THE STRUCTURED CRM RECORD. No trade vehicle has been named anywhere in ' +
  'this conversation either, so if they are asking for a trade number, ask what they are trading (year, make, model, mileage) ' +
  'or offer the appraisal — never name a vehicle we do not have on file.';

check('Woodfork arc + LP trade-guard directive appended',
  i => i.tradeTrigger({ lastInboundMsg: 'Financing: ERROR via Hard Pull', conversationBrief: '', context: WOODFORK_ARC + LP_BLOCK }), null);
check('LP block is the ONLY trade text anywhere',
  i => i.tradeTrigger({ lastInboundMsg: '', conversationBrief: '', context: 'nothing relevant here' + LP_BLOCK }), null);

console.log('\ndeal/info trade trigger — must still fire on real evidence:');
check('customer asks in their inbound',
  i => i.tradeTrigger({ lastInboundMsg: 'what is my trade worth', conversationBrief: '', context: '' }), 'what is my trade worth');
check('trade ask recorded in a call note, LP block also present',
  i => i.tradeTrigger({ lastInboundMsg: '', conversationBrief: '',
    context: '[CALL NOTE] he asked for a trade value on his F-150' + LP_BLOCK }), 'trade value');

// ── 2 — delivery verbiage ──────────────────────────────────────────────────────
console.log('\ndelivery-requested detector:');
check('Woodfork deal-builder line', i => i.deliveryFires('Financing: ERROR · Delivery requested: YES · Placed deposit: No'), true);
check('delivery explicitly NOT requested', i => i.deliveryFires('Delivery requested: NO · Placed deposit: No'), false);
check('no delivery field at all', i => i.deliveryFires('Placed deposit: No · Credit App: No'), false);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
