#!/usr/bin/env node
'use strict';
// (v9.7.704) PHASE 2 EXAMPLES ROTATE WITH THE LEAD. Gil, 9/23: "add more examples and have them rotate as
// needed in context". v9.7.703 offered two fixed examples and 7 of 11 paired drafts copied the first one.
// _lpRung2Examples now offers three from a pool of eight: only those that FIT the lead, minus topics our
// own outbound or a rejected draft already asked (named back to the model as covered), rotated by touch
// and regenerate. Runs the shipped function and buildUserPrompt out of the whole popup.js.
//
// Usage: node tests/rung2-examples-704.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: rung2-examples-704.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const entry = (m, d, t, k, ti, b) => '[' + pad(m) + '/' + pad(d) + '/2026 ' + t + '] [' + k + '] ' + ti + '\n  ' + b + '\n';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const ex = (o) => sb._lpRung2Examples(Object.assign({ vehicle: '2026 Toyota RAV4 XLE', hasUnit: false, ourOutbound: '', rejected: [], touches: 6, regens: 0 }, o));

  // A never-replied stalled lead on rung 2 (4 days old), with the given bodies as our outbound texts.
  const lead = (bodies, extra, history) => {
    const e = bodies.map((b, i) => entry(9, 22 - i, '10:0' + (i % 10) + ' AM', 'AGENT', 'Outbound Text Message', 'Sent to: (555) 010-0199\n  ' + b));
    const c = e.join('') + '=== CURRENT LEAD SUBMITTED HERE ===\n' + entry(9, 19, '9:00 AM', 'NOTE', 'Lead Received', 'Internet lead');
    const d = Object.assign({ agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', name: 'Test Buyer',
      vehicle: '2026 Toyota RAV4 XLE', leadSource: 'Cars.com', dealerId: '6189', store: 'Community Toyota Baytown', leadAgeDays: 4,
      convState: 'active-follow-up', hasCustomerReply: false, hasOutbound: true, _isStalled: true, _neverReplied: true,
      relationshipSignals: { totalOutboundCount: bodies.length, consecutiveOutboundNoReply: bodies.length, lastInboundAgeDays: null } }, extra || {});
    d.context = c; vm.runInContext('leadContext = ' + JSON.stringify(c) + ';', sb);
    sb.window._lpDraftHistory = history || []; sb.__logs.length = 0;
    const p = sb.__lp.buildUserPrompt(d);
    return { p, approach: (p.split('\n').find(l => l.startsWith('YOUR APPROACH:')) || ''),
             diag: sb.__logs.filter(l => /^\[LP RUNG2 EXAMPLES DIAG\]/.test(l)) };
  };
  const SIX = ['Checking in on the RAV4.', 'Following up on your RAV4 inquiry.', 'Hi, any update on the RAV4?',
               'Just making sure my messages reach you.', 'Here whenever you are ready.', 'Thanks again for reaching out.'];

  console.log(' the pool:');
  check('eight examples, and every one is safe on this rung — no timing, no still-interested, no numbers, no trade',
    () => { const P = sb.LP_RUNG2_EXAMPLES, c = { hasTrim: true, hasUnit: true }, c2 = { hasTrim: true, hasUnit: false };
            const all = P.map(e => e.text(c) + ' ' + e.text(c2)).join(' ');
            return [P.length, /timeline|timing|still interested|\$|\bpayment|\bprice|\btrade/i.test(all)]; }, [8, false]);
  check('three are offered at a time', () => ex({}).examples.length, 3);

  console.log(' FIT — an example that cannot apply to this lead is never offered:');
  check('no trim on the lead ("2026 Honda CR-V") → no trim question (6 fit: no trim, no unit)', () => ex({ vehicle: '2026 Honda CR-V' }).fitCount === 6
    && [0, 1, 2, 3, 4, 5, 6].every(t => ex({ vehicle: '2026 Honda CR-V', touches: t }).ids.indexOf('trim') < 0), true);
  check('a specific stock unit / VIN on the lead → no color question (it is fixed), and the check-this-one question can appear',
    () => { const ids = new Set(); for (let t = 0; t < 7; t++) ex({ hasUnit: true, touches: t }).ids.forEach(i => ids.add(i));
            return [ids.has('color'), ids.has('detail')]; }, [false, true]);
  check('no unit → no check-this-one question', () => { const ids = new Set(); for (let t = 0; t < 7; t++) ex({ touches: t }).ids.forEach(i => ids.add(i)); return ids.has('detail'); }, false);
  check('photos wording follows the unit: "this one" only when there is one',
    () => [sb.LP_RUNG2_EXAMPLES.find(e => e.id === 'photos').text({ hasUnit: true }), sb.LP_RUNG2_EXAMPLES.find(e => e.id === 'photos').text({ hasUnit: false })],
    ['"Want a quick walkaround video of this one?"', '"Would a few photos help?"']);

  console.log(' COVERED — what we already asked is dropped and named:');
  check('our outbound asked about color and sent photos → neither is offered, both are named as covered',
    () => { const r = ex({ ourOutbound: 'What color are you after? Want me to send photos?' });
            return [r.ids.some(i => i === 'color' || i === 'photos'), r.covered]; }, [false, ['color', 'photos / video']]);
  check('a rejected draft (Regenerate) asked about trim → the next draft is not offered the trim question',
    () => { const r = ex({ rejected: ['Are you set on the XLE, or open to other RAV4 trims?'], regens: 1 }); return [r.ids.indexOf('trim'), r.covered]; }, [-1, ['trim']]);
  check('every fitting topic asked → still offers three, and flags it rather than going silent',
    () => { const r = ex({ ourOutbound: 'trim color photos feature pre-owned daily driving size' }); return [r.examples.length, r.exhausted]; }, [3, true]);

  console.log(' ROTATION — consecutive touches and regenerates see different examples:');
  check('touches 5, 6, 7 and 8 each get a different set', () => {
    const sets = [5, 6, 7, 8].map(t => ex({ touches: t }).ids.slice().sort().join(','));
    return new Set(sets).size; }, 4);
  check('the same touch after a regenerate gets a different set', () => ex({ touches: 6, regens: 0 }).ids.join() !== ex({ touches: 6, regens: 1 }).ids.join(), true);
  check('over four touches, every fitting example gets offered at least once', () => {
    const ids = new Set(); [5, 6, 7, 8].forEach(t => ex({ touches: t }).ids.forEach(i => ids.add(i))); return ids.size; }, 7);
  check('it is deterministic — the same lead state gives the same examples', () => JSON.stringify(ex({ touches: 7 })) === JSON.stringify(ex({ touches: 7 })), true);

  console.log(' in the prompt (buildUserPrompt):');
  check('PHASE 2 renders three rotated examples joined with "or", and lets the model pick or write its own',
    () => { const a = lead(SIX).approach; return [(a.match(/" or "/g) || []).length, /pick whichever fits best or write your own like them/.test(a)]; }, [2, true]);
  check('our own outbound on the lead decides what is covered', () => {
    const a = lead(SIX.slice(0, 5).concat(['Is there a color you want on the RAV4?'])).approach;
    return [/Already asked on this lead, so do not ask it again: color\./.test(a), /heart set on/.test(a)]; }, [true, false]);
  check('...and so does a draft that asked it in the example\'s own shape ("set on the XLE?") without the word trim',
    () => ex({ rejected: ['Jordan, are you set on the XLE?'], regens: 1 }).covered, ['trim']);
  check('a Regenerate after a trim-question draft drops the trim example and names it',
    () => { const a = lead(SIX, null, ['Are you set on the XLE, or open to other RAV4 trims?']).approach;
            return [/\[trim\]/.test(a), /do not ask it again: trim\./.test(a)]; }, [false, true]);
  check('a stock number on the lead switches photos to "this one" and drops color', () => {
    const outs = [0, 1, 2].map(k => lead(SIX.concat(Array(k).fill('Checking in.')), { stockNum: 'T1234' }).approach).join(' ');
    return [/heart set on/.test(outs), /this one\?"/.test(outs)]; }, [false, true]);
  check('control: the timeline ban and the uncounted ask are kept (v9.7.703)', () => {
    const a = lead(SIX).approach;
    return [/Do NOT ask whether their timeline, timing or plans changed/.test(a), /^YOUR APPROACH: Ask a low-effort question\. NOT "are you still interested\?"/.test(a), /Ask one|Ask ONE/.test(a)]; }, [true, true, false]);
  check('[LP RUNG2 EXAMPLES DIAG] logs what was offered, what was covered and why, once per prompt', () => {
    const d = lead(SIX, null, ['Are you set on the XLE?']).diag;
    return [d.length, /^\[LP RUNG2 EXAMPLES DIAG\] offered:\w+,\w+,\w+ \| covered:trim \| fit:7 fresh:6 offset:\d+ \| touches:6 rejectedDrafts:1$/.test(d[0])]; }, [1, true]);
  check('control: PHASE 3 is untouched — no pool, no diag', () => {
    vm.runInContext('leadContext = "";', sb);
    const r = lead(SIX.concat(SIX), { leadAgeDays: 9 });
    return [/Did your timeline shift or just been busy\?/.test(r.approach), r.diag.length]; }, [true, 0]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
