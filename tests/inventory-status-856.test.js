#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('inventory-status-856.test.js');
// (v9.7.856) AUDIT M-2, OWNER RULING 11/3. The inventory feed can lag a recent sale or deposit, so it never outranks a person.
// CASE A: a deposit / pending / hold note on THIS lead (any note type but a message; the newest wins, so "deal fell through"
// makes it available again). The prompt states the facts and quotes the note, says a deposit note is most often the customer's
// own deal, and tells the model to read the thread: their deal -> move it forward; another buyer's -> do not offer it to see;
// either way never available inventory and never sold; unclear -> say nothing about availability. "Customer is buying" is not
// a pattern. CASE B: our own message on this lead said it sold, and it counts for the vehicle on the lead when (a) it names
// the model with no conflicting color / year / trim and any stock or VIN matches, or (b) it names no vehicle and the same
// message names no other unit; an unknown attribute never conflicts. [LP SOLD SIGNAL DIAG] logs the branch. The prose sold
// regex is retired (a prior lead's "that car has sold", "the 4:00 slot is no longer available"). The Audi all-available policy
// and the customer's own vehicle are unchanged; sold notes keep outranking the feed. Executes _lpSoldClaimForVoi,
// populateFromData, the panel payload, buildUserPrompt / classifyScenario, the shipped scraper note scan and the shipped claim
// capture pattern. Placeholder data only.
//
// Usage: node tests/inventory-status-856.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: inventory-status-856.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[11/01/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const H = E('11/03/2026 9:00 AM', 'CUSTOMER', 'Inbound Text Message', 'Is the CR-V still there?') + E('11/02/2026 10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, the CR-V is here.') + MARK;
const BLUE = 'Canyon River Blue Metallic';
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Honda CR-V LX', color: BLUE,
  condition: 'Used', stockNum: 'TEST0H1', _pdUnitStock: 'TEST0H1', _pdStatus: 'A', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Dealers WebSite',
  convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com',
  lastInboundMsg: 'Is the CR-V still there?', relationshipSignals: { unansweredQuestions: [] }, history: H, conversationBrief: H }, x || {});
const SOLD = (text, msg, ms) => ({ selfClaims: { sold: { ms: ms || new Date('11/03/2026 8:00 AM').getTime(), date: '11/03', text, msg: msg || text } } });
const PEND = (quote) => ({ vehiclePendingSale: true, _pendingNote: { kind: 'pending', scope: 'current', date: '11/03 10:14 AM', by: 'Rep Name', quote } });

// ── the shipped scraper note scan (filteredTranscript .. isSmsOptOutOnly, which holds the 855 scope helper) ──
function note(date, title, content) {
  const map = { '.notes-and-hsitory-item-date': { innerText: date }, '.legacy-notes-and-history-title': { innerText: title },
    '.notes-and-history-item-content': { innerText: content, textContent: content } };
  return { getAttribute: () => null, querySelector: (s) => map[s] || null };
}
const MARKER_DATE = '11/01/2026 9:00 AM';
function extractScan(src) {
  const a = src.indexOf('    var filteredTranscript = transcript.filter(function(line){');
  const endTok = 'const isSmsOptOutOnly = isSmsOptOut && !smsOptOutIsExit && !hasExitSignal;';
  const b = src.indexOf(endTok, a);
  const ra = src.indexOf('    var _LP_LINE_STAMP_RE = '), rb = src.indexOf('\n    var recentHistory = transcript.filter', ra);
  if (a < 0 || b < 0 || ra < 0 || rb < 0) throw new Error('scraper region not found');
  const fn = new Function('__s', 'var transcript=[], noteEls=__s.noteEls, phone="(555) 010-0199", _lpD=function(){}, vehiclePendingSale=false,'
    + ' transcriptCutoffMs=__s.markerMs ? __s.markerMs - 3600000 : 0, hasNewLeadToday=false, leadAgeDays=2, _leadAgeScraped=!!__s.markerMs, leadCreatedMs=0,'
    + ' _lpMarkerMs=__s.markerMs, _lpMarkerDate="", lastInboundMsg="";\n'
    + src.slice(ra, rb) + '\n' + src.slice(a, b + endTok.length) + '\n'
    + 'return { pending: !!vehiclePendingSale, note: (typeof _pendingNote === "undefined" ? undefined : _pendingNote) };');
  return (notes, noMarker) => fn({ noteEls: notes, markerMs: noMarker ? 0 : new Date(MARKER_DATE).getTime() });
}
// ── the shipped claim-capture pattern for a sold claim ──
function soldPattern(src) {
  const line = src.split('\n').find(l => /_scAdd\('sold'/.test(l) && /_scContent\.match\(/.test(l));
  if (!line) throw new Error('sold capture line not found');
  return vm.runInNewContext(line.slice(line.indexOf('.match(') + 7, line.indexOf('))) _scAdd')));
}

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const go = (lsd) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      const p = panelPayload(src, sb, { lsd: lsd, context: ctx });
      return { ctx, prompt: String(sb.__lp.buildUserPrompt(p)), logs: logs.join('\n') }; }
    catch (e) { return { ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const SOLD_SCEN = /The specific vehicle of interest has been sold/;
  const SAYS_HERE = /— confirmed in stock\.|Vehicle is confirmed in stock|Confirming it is here is fine|Confirm it is available/;
  const helper = (text, msg, x) => { const h = run('typeof _lpSoldClaimForVoi === "function" ? _lpSoldClaimForVoi : null'); if (!h) return 'no helper';
    const o = h(Object.assign(LSD(SOLD(text, msg)), x || {})); return o ? [o.counts, o.branch] : null; };

  console.log(' 1. does "we said it sold" count for the vehicle on the lead (owner fixtures):');
  check('"the one you asked about sold this morning" -> counts, branch (b)', () => helper('Test, the one you asked about sold this morning'), [true, 'b']);
  check('"that one sold, but the blue CR-V is here" (blue on the lead) -> does not count', () => helper('Test, that one sold, but the blue CR-V is here'), [false, '']);
  check('"the red CR-V sold, but the blue one is here" (blue on the lead) -> does not count', () => helper('Test, the red CR-V sold, but the blue one is here'), [false, '']);
  check('"the CR-V sold" (color on the lead unknown) -> counts, branch (a)', () => helper('Test, the CR-V sold', null, { color: '' }), [true, 'a']);
  check('an unknown attribute never conflicts: "the red CR-V sold" with no color on the lead -> counts (a)', () => helper('the red CR-V sold', null, { color: '' }), [true, 'a']);
  check('conflicts: another year, another trim, another model, another stock number -> none count', () =>
    [helper('the 2023 CR-V sold'), helper('the CR-V EX-L sold'), helper('the Civic sold'), helper('the CR-V, stock #ZZZ999, sold')], [[false, ''], [false, ''], [false, ''], [false, '']]);
  check('controls: the same year, trim and stock count (a)', () => [helper('the 2024 CR-V LX sold'), helper('the CR-V, stock #TEST0H1, sold')], [[true, 'a'], [true, 'a']]);
  check('(b) with a generic offer in the same message still counts ("it\'s been sold. I can send you similar ones.")', () =>
    helper("it's been sold", "Hi Test, it's been sold. I can send you similar ones."), [true, 'b']);
  check('(b) with another unit named in the same message does not ("...sold this morning. The 2025 is here.")', () =>
    helper('the one you asked about sold this morning', 'Test, the one you asked about sold this morning. The 2025 is here if you want it.'), [false, '']);
  check('a newer message of ours saying it is available outranks the older sold claim', () =>
    helper('the CR-V sold', null, { selfClaims: { sold: { ms: 1, date: '11/01', text: 'the CR-V sold' }, available: { ms: 2, date: '11/02', text: 'the CR-V is here' } } }), [false, '']);
  check('Case F: "the 4:00 slot is no longer available" is not about a vehicle', () => helper('the 4:00 slot is no longer available', 'the 4:00 slot is no longer available. How about 5?'), [false, '']);

  console.log(' 2. CASE B -- we told them it sold, the feed still lists it:');
  const b = go(LSD(SOLD('the CR-V you asked about sold this morning, but I have two similar ones', 'Test, the CR-V you asked about sold this morning, but I have two similar ones.')));
  check('the approved Case B block, in order', () => {
    const i = b.ctx.indexOf('🔴 INVENTORY STATUS — WE ALREADY TOLD THIS CUSTOMER THIS CR-V SOLD, AND THAT OUTRANKS THE FEED:'); if (i < 0) return 'no header';
    const blk = b.ctx.slice(i).split('\n').slice(1, 4);
    return [blk[0] === '  • [11/03] WE SAID IT SOLD: "the CR-V you asked about sold this morning, but I have two similar ones"',
      blk[1] === '  • The inventory feed still lists it as available. The feed can lag a recent sale, so it does not override what we told them about this unit.',
      blk[2] === '  • Do not re-announce the sale (they were told) and do not write as though it is available. Continue from what we offered instead.'];
  }, [true, true, true]);
  check('the vehicle line says SOLD per our own message, not "confirmed in stock"', () =>
    [/VEHICLE ON LEAD: 2024 Honda CR-V LX — SOLD per our own message on this lead \(see INVENTORY STATUS\)/.test(b.ctx), SAYS_HERE.test(b.prompt)], [true, false]);
  check('the sold scenario fires (it did not: the feed-confirm override vetoed every sold path)', () => SOLD_SCEN.test(b.prompt), true);
  check('[LP SOLD SIGNAL DIAG] names the branch', () => /\[LP SOLD SIGNAL DIAG\] we said it sold \(11\/03\): COUNTS for the vehicle on this lead, branch \(a\)/.test(b.logs), true);
  const b2 = go(LSD(SOLD('Test, the one you asked about sold this morning', 'Test, the one you asked about sold this morning.')));
  check('branch (b) is logged as (b)', () => /COUNTS for the vehicle on this lead, branch \(b\)/.test(b2.logs), true);
  const d1 = go(LSD(SOLD('Test, the red CR-V sold, but the blue one is here')));
  check('a different unit: the history line says so, nothing says this vehicle sold', () =>
    [d1.ctx.indexOf('  • [11/03] WE SAID: "Test, the red CR-V sold, but the blue one is here" — this is about a different unit, so it does not decide this vehicle\'s availability.') >= 0,
     /INVENTORY STATUS/.test(d1.ctx), SOLD_SCEN.test(d1.prompt), /does NOT count -- it names this model with a different color \(red\)/.test(d1.logs)], [true, false, false, true]);

  console.log(' 3. CASE A -- a deposit / pending / hold note on this lead:');
  const own = go(LSD(PEND('Test put $500 down, funding Thursday')));
  check('the approved Case A block, in order', () => {
    const i = own.ctx.indexOf('🟠 INVENTORY STATUS — THE FEED AND A NOTE ON THIS LEAD DISAGREE:'); if (i < 0) return 'no header';
    return own.ctx.slice(i).split('\n').slice(1, 8).join('\n');
  }, ['  • The inventory feed lists this unit as available.',
      '  • 11/03 10:14 AM, Rep Name wrote on this lead: "Test put $500 down, funding Thursday".',
      '  • A deposit, pending or hold note on a lead is most often that customer\'s own deal. Read the thread to tell whether this is this customer\'s deal or another buyer\'s before you say anything about availability.',
      '  • If it is their deal: move it forward (the next step in their paperwork, funding or delivery). Do not offer it to them as if they were still shopping.',
      '  • If it is another buyer\'s: do not offer it to see and do not offer times for it; lead with what we do have.',
      '  • Either way: never present it as available inventory, and never call it sold.',
      '  • If the thread doesn\'t make clear whose deal it is, say nothing about this unit\'s availability.'].join('\n'));
  check('our customer\'s own deposit: no "held for another customer" / "being sold" / "create urgency"; the deal-progress line is there', () =>
    [/another customer|held for|process of being sold|Create urgency/i.test(own.ctx), /If it is their deal: move it forward/.test(own.ctx)], [false, true]);
  check('nothing says it is here or available, and it is not called sold', () => [SAYS_HERE.test(own.prompt), SOLD_SCEN.test(own.prompt)], [false, false]);
  const oth = go(LSD(PEND('another customer put a deposit on this one')));
  check('another buyer\'s deposit: not offered to see (no presence line, the do-not-offer rule is in the block)', () =>
    [SAYS_HERE.test(oth.prompt), /do not offer it to see and do not offer times for it/.test(oth.ctx), /"another customer put a deposit on this one"/.test(oth.ctx)], [false, true, true]);
  check('[LP SOLD SIGNAL DIAG] logs the note', () => /newest deposit\/pending\/hold note on this lead: pending \| 11\/03 10:14 AM \| by Rep Name \| scope: current/.test(own.logs), true);
  const sn = go(Object.assign(LSD(PEND('Test put $500 down, funding Thursday')), { inventoryWarningFromNotes: true, inventoryWarning: true }));
  check('a sold note still outranks the feed and the deposit note (sold scenario, no Case A block)', () => [SOLD_SCEN.test(sn.prompt), /INVENTORY STATUS/.test(sn.ctx)], [true, false]);
  const au = go(LSD(Object.assign({ dealerId: '21135', store: 'Audi Lafayette', vehicle: '2025 Audi Q5 Premium' }, SOLD('the Q5 sold', 'Test, the Q5 sold.'), PEND('Test put $500 down'))));
  check('Audi Lafayette all-available policy unchanged: no INVENTORY STATUS block, not sold', () => [/INVENTORY STATUS/.test(au.ctx), SOLD_SCEN.test(au.prompt)], [false, false]);
  check('the customer\'s own vehicle and Audi gate both blocks (source)', () =>
    /var _m2Sold = \(!_audiAllAvail && !_lpOwnBySale\) \? _lpSoldClaimForVoi\(d\) : null;\n\s+var _m2Pend = \(!_audiAllAvail && !_lpOwnBySale\) \? _lpPendingNote\(d\) : null;/.test(src), true);
  const ctl = go(LSD({}));
  check('control: no note, no claim -> confirmed in stock as before', () => [SAYS_HERE.test(ctl.prompt), /INVENTORY STATUS/.test(ctl.ctx)], [true, false]);

  console.log(' 4. the prose regex is retired (Cases E/F):');
  const HE = E('11/03/2026 9:00 AM', 'CUSTOMER', 'Inbound Text Message', 'Is the CR-V still there?') + MARK
    + E('01/05/2025 2:00 PM', 'AGENT', 'Outbound Text Message', 'Test, sorry, that car has sold.');
  check('Case E: a prior lead\'s "that car has sold" in the transcript -> not sold', () => SOLD_SCEN.test(go(LSD({ history: HE, conversationBrief: HE, stockNum: '', _pdUnitStock: '' })).prompt), false);
  const HF = E('11/03/2026 9:10 AM', 'AGENT', 'Outbound Text Message', 'Test, unfortunately the 4:00 slot is no longer available. How about 5?') + H;
  check('Case F: "the 4:00 slot is no longer available" -> not sold', () =>
    SOLD_SCEN.test(go(LSD(Object.assign({ history: HF, conversationBrief: HF, stockNum: '', _pdUnitStock: '' }, SOLD('Test, unfortunately the 4:00 slot is no longer available', 'Test, unfortunately the 4:00 slot is no longer available. How about 5?')))).prompt), false);

  console.log(' 5. the scraper: which note decides, and on which lead:');
  let scan; try { scan = extractScan(src); } catch (e) { check('extract', () => e.message, 'ok'); continue; }
  const S = (notes, noMarker) => { const o = scan(notes, noMarker); return [o.pending, o.note ? o.note.kind : null]; };
  const gen = (d, t) => note(d, 'General Note', 'By: Rep Name\n' + t), call = (d, t) => note(d, 'Outbound phone call (Contacted)', 'By: Rep Name\n' + t);
  const mk = note(MARKER_DATE, 'Lead Received', 'Lead received');
  check('"Test put $500 down, funding Thursday" on this lead -> pending, quoted with its author', () => {
    const o = scan([gen('11/03/2026 10:14 AM', 'Test put $500 down, funding Thursday'), mk]); return [o.pending, o.note && o.note.quote, o.note && o.note.by, o.note && o.note.date]; },
    [true, 'Test put $500 down, funding Thursday', 'Rep Name', '11/03 10:14 AM']);
  check('a call note counts ("took a deposit on the CR-V")', () => S([call('11/03/2026 10:00 AM', 'took a deposit on the CR-V'), mk]), [true, 'pending']);
  check('"customer is buying" is not a pattern', () => S([gen('11/03/2026 10:00 AM', 'customer is buying'), mk]), [false, null]);
  check('a future deposit is not one ("wants to put $2000 down")', () => S([gen('11/03/2026 10:00 AM', 'cust wants to put $2000 down'), mk]), [false, null]);
  check('"deal fell through" after the deposit -> available again', () =>
    S([gen('11/03/2026 3:00 PM', 'deal fell through, back on the lot'), gen('11/03/2026 10:14 AM', 'Test put $500 down, funding Thursday'), mk]), [false, 'back']);
  check('a prior lead\'s deposit note does not count', () => S([mk, gen('01/05/2025 2:00 PM', 'deposit taken, pending funding')]), [false, null]);
  check('a message is not a note ("your deposit is in" in our text)', () => S([note('11/03/2026 10:00 AM', 'Outbound Text Message', 'By: Rep Name\nTest, I put a deposit hold on it for you'), mk]), [false, null]);
  check('the start unknown: kept, and its scope says so', () => { const o = scan([gen('11/03/2026 10:14 AM', 'spoken for'), mk], true); return [o.pending, o.note && o.note.scope]; }, [true, 'unknown start']);

  console.log(' 6. the scraper: the sold claim is captured by the bare verb, and not by other "sold":');
  let rx; try { rx = soldPattern(src); } catch (e) { check('pattern', () => e.message, 'ok'); continue; }
  const cap = (t) => !!rx.test(t);
  check('"the CR-V sold", "the one you asked about sold this morning", "it\'s been sold", "no longer available" -> captured', () =>
    ['Test, the CR-V sold', 'the one you asked about sold this morning', "it's been sold", 'it is no longer available'].map(cap), [true, true, true, true]);
  check('"we sold you your Accord", "we have sold over 100 CR-Vs", "Sold-out event" -> not captured', () =>
    ['we sold you your Accord in 2022', 'we have sold over 100 CR-Vs this month', 'Sold-out event this weekend'].map(cap), [false, false, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
