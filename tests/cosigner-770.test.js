#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('cosigner-770.test.js');
// (v9.7.770) log292, lead 2082889754 regenerated on 769. "I plan on coming with 2,000 down and a cosigner" was sent the night
// before the showroom visit; she came in, the payment did not work, and she then wrote that she has to keep looking. CO-SIGNER
// NEEDED still scripted "We will need both of you here to finalize everything" and the draft said it. FINANCING CONCERN still
// said the visit is the easiest way to get real numbers. When every line that triggers either one predates the newest showroom
// visit, a post-visit line replaces it; a mention after the visit, or with no visit at all, keeps the original. The showroom
// close and the text rewrite are also told to state the offer once (the draft promised a call, then asked if she wanted one).
// Executes the shipped concern code (lifted from inlineScraper, DOM stubbed) and the shipped showroom/refine prompt builders.
// Placeholder data only.
//
// Usage: node tests/cosigner-770.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: cosigner-770.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const note = (title, date) => ({ querySelector: sel => sel === '.legacy-notes-and-history-title' ? { innerText: title }
  : sel === '.notes-and-hsitory-item-date' ? { innerText: date } : null });
const VISIT = note('Showroom Visit', '10/06/2026 4:04 PM');
const PRE_CO = '[10/05/2026 8:31 PM] [CUSTOMER] Inbound Text Message — I plan on coming with 2,000 down and a cosigner';
const PRE_FIN = '[09/14/2026 12:02 PM] [CUSTOMER] Inbound Text Message — did i get pre approved';
const VISIT_LINE = '[10/06/2026 4:04 PM] [SHOWROOM VISIT] PAYMENT DIDNT FIT, NO MORE MONEY DOWN';
const AFTER = '[10/07/2026 8:15 AM] [CUSTOMER] Inbound Text Message — It was great service I just have to keep looking';
const POST_CO = '[10/07/2026 9:00 AM] [CUSTOMER] Inbound Text Message — I can bring my cosigner Saturday';
const POST_FIN = '[10/07/2026 9:00 AM] [CUSTOMER] Inbound Text Message — what if I put more down payment';

for (const f of BUILDS) {
  console.log('\n== ' + f);
  const src = fs.readFileSync(f, 'utf8');
  // The concern code, lifted verbatim. 770: the visit helper, the financing block and the co-signer block.
  // Older builds have no helper; their financing..co-signer span runs as it shipped, so they fail here by name.
  const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); return a < 0 || b < 0 ? '' : src.slice(a, b); };
  const helperBody = (() => { const a = src.indexOf('      var _lpConcernVisitMs = 0;'); if (a < 0) return '';
    const b = src.indexOf('        return hit && !after;\n      }\n', a); return b < 0 ? '' : src.slice(a, b + '        return hit && !after;\n      }\n'.length); })();
  const span = cut('      var _finRx = ', '      // -- Friction type: Spouse') || cut('      if(/\\bcredit\\b|financing|pre.?approv', '      // -- Friction type: Spouse');
  const concerns = (lines, notes) => {
    const out = [];
    new Function('noteEls', 'concernScanLines', '_lpConcernLines', '_lpSrcNoise', '_lpD', 'customerConcerns', 'allTranscriptText', 'customerOnlyText',
      helperBody + span)(notes, lines, lines, /\bPartner\s+Lead\b/gi, () => {}, out, lines.join(' '),
      lines.filter(l => l.indexOf('[CUSTOMER]') !== -1).join(' '));
    return out.map(c => c.split(':')[0]);
  };
  check('the shipped financing..co-signer span was found', () => span.length > 0, true);

  console.log(' 1. mentioned before the visit:');
  check('the night-before co-signer text no longer scripts "both of you here to finalize" (lead 2082889754)',
    () => concerns([PRE_CO, VISIT_LINE, AFTER], [VISIT]).filter(c => /CO-SIGNER/.test(c)), ['CO-SIGNER (mentioned before the visit)']);
  check('...and the pre-visit financing mentions get the post-visit line, not "the visit is the easiest way"',
    () => concerns([PRE_FIN, PRE_CO, VISIT_LINE, AFTER], [VISIT]).filter(c => /FINANCING/.test(c)), ['FINANCING (raised before the visit)']);
  check('the replacement lines carry no finalize script and no visit pitch (new helper)', () => {
    const t = src.slice(src.indexOf("'CO-SIGNER (mentioned before the visit)"), src.indexOf("'CO-SIGNER (mentioned before the visit)") + 600)
      + src.slice(src.indexOf("'FINANCING (raised before the visit)"), src.indexOf("'FINANCING (raised before the visit)") + 600);
    return [/CO-SIGNER \(mentioned before/.test(t), /Do NOT tell them both people need to be here to finalize/.test(t),
      /Do NOT tell them a visit is the way to get real numbers/.test(t), /Never state a credit result/.test(t)]; }, [true, true, true, true]);

  console.log(' 2. controls -- the original stays:');
  check('no showroom visit: both originals', () => concerns([PRE_FIN, PRE_CO], []), ['FINANCING CONCERN', 'CO-SIGNER NEEDED']);
  check('co-signer raised AFTER the visit: CO-SIGNER NEEDED stays', () => concerns([PRE_CO, VISIT_LINE, POST_CO], [VISIT]).filter(c => /CO-SIGNER/.test(c)), ['CO-SIGNER NEEDED']);
  check('financing raised AFTER the visit: FINANCING CONCERN stays', () => concerns([PRE_FIN, VISIT_LINE, POST_FIN], [VISIT]).filter(c => /FINANCING/.test(c)), ['FINANCING CONCERN']);
  check('an undated mention counts as current: CO-SIGNER NEEDED stays',
    () => concerns(['[CUSTOMER] my cosigner is coming', VISIT_LINE], [VISIT]).filter(c => /CO-SIGNER/.test(c)), ['CO-SIGNER NEEDED']);
  check('no financing or co-signer language: neither fires', () => concerns([VISIT_LINE, AFTER], [VISIT]), []);

  console.log(' 3. state the offer once (executed populateFromData and _lpBuildSmsRefinePrompt):');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (expr) => vm.runInContext(expr, sb);
  const lead = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Honda Pilot', dealerId: '24399',
    store: 'Test Store', leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 1, isShowroomFollowUp: true,
    showroomDetails: 'PAYMENT DIDNT FIT', hasOutbound: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com',
    lastInboundMsg: 'It was great service I just have to keep looking', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } }, x || {});
  const ctx = (d) => { run('activeFlags = new Set(); leadContext = "";'); const ol = sb.console.log; sb.console.log = () => {};
    try { sb.populateFromData(d); } finally { sb.console.log = ol; } return run('leadContext'); };
  check('the showroom close says to state the offer once', () => /State the offer once, as that question -- do not promise it in one sentence and then ask it again in the next\./.test(ctx(lead())), true);
  check('control: not a showroom follow-up, no such line', () => /State the offer once/.test(ctx(lead({ isShowroomFollowUp: false }))), false);
  const EMAIL = 'Subject: Your visit\n\nTest,\n\nRep Name can rework the numbers.\n\nAgent Name';
  check('the text rewrite is told to cut a promise the question repeats', () =>
    /Say the offer once: if an earlier sentence already promises what the question offers, cut the promise\./.test(run('_lpBuildSmsRefinePrompt')('Test, I will ask Rep Name to call you. Want me to ask him to call you?', EMAIL, lead())), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
