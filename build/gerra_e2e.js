// End-to-end trace of Gerra's lead (Community Kia Baytown, 2061540346, 5 days, 8/7)
// through the real scraper region and on into the real prompt-directive selection.
//
// The model call itself needs the live worker + the VinSolutions page, so what is
// shown here is everything the extension deterministically decides BEFORE the model
// sees anything: the flags, convState, and the verbatim directive text the prompt
// builder emits. That is what changed — the model was never the problem; it was
// faithfully following a farewell instruction.

const fs = require('fs');
const { buildRunner } = require('./harness.js');

const GERRA = {
  leadAgeDays: 5,
  lastInboundMsg: 'STOP',
  transcript: [
    '[CUSTOMER] STOP',
    "[AGENT] I saw you completed your application through Click & Go, but no vehicle is attached yet. What model are you shopping for?",
    '[SYSTEM] CURRENT LEAD SUBMITTED HERE',
    '[SYSTEM] Click & Go credit application completed'
  ],
  notes: ['Click & Go application received - no vehicle attached']
};

// Lead facts that drive the downstream branch selection, from the incident report.
const LEAD = { hasOutbound: true, isContacted: true, leadSource: 'Click & Go', totalNoteCount: 7, agentLPCommands: [] };

function convStateOf(out) {
  // popup.js: if (hasExitSignal && !agentLPCommands.length) convState='exit';
  //           else if (pause…) 'pause'; else if (hasOutbound || isContacted) → worked-lead branch
  if (out.hasExitSignal && !LEAD.agentLPCommands.length) return 'exit';
  if (LEAD.hasOutbound || LEAD.isContacted) return 'active-follow-up (worked lead)';
  return 'first-touch';
}

function directive(out) {
  // popup.js: `if (data.isSmsOptOutOnly) { … }` selects one of three EMAIL branches.
  if (!out.isSmsOptOutOnly) {
    return out.hasExitSignal
      ? 'EXIT / farewell close — convState=exit routes to the gracious-close directive: acknowledge, ' +
        'leave the door open, no appointment push, no vehicle re-pitch. THIS IS WHAT PRODUCED ' +
        '"We\'ll respect your request and won\'t send further messages."'
      : '(no SMS opt-out directive emitted)';
  }
  const src = fs.readFileSync('dev/popup.js', 'utf8');
  const optOutIsAISignal = /ai buying signal/i.test(LEAD.leadSource);
  const workedLead = !optOutIsAISignal && (LEAD.totalNoteCount >= 6 || LEAD.hasOutbound);
  const marker = workedLead
    ? "'2. EMAIL = DO NOT mention the opt-out at all (not subject, body, or closing one-liner)."
    : "'2. EMAIL = DO NOT mention the opt-out at all. Not in the subject";
  const i = src.indexOf(marker);
  const line = i < 0 ? '(directive text not located)' : src.slice(i + 1, src.indexOf("',", i)).replace(/\\'/g, "'");
  return 'SMS OPT-OUT directive, ' + (workedLead ? 'WORKED-LEAD' : 'FRESH') + ' email branch:\n\n      ' +
         line.replace(/(.{100}?) /g, '$1\n      ');
}

for (const [label, file] of [['BEFORE  (v9.7.533 / v9.7.531, shipped)', 'orig/dev/popup.js'],
                             ['AFTER   (v9.7.534-dev / v9.7.532)', 'dev/popup.js']]) {
  const out = buildRunner(file).run(GERRA);
  console.log('\n' + '═'.repeat(78) + '\n  ' + label + '\n' + '═'.repeat(78));
  console.log('  rawStopSignal      : ' + out.rawStopSignal);
  console.log('  isSmsOptOut        : ' + out.isSmsOptOut + '   (unchanged by this build — the STOP is still honoured)');
  if (out._bareCarrierKeywordOptOut !== undefined)
    console.log('  bareCarrierKeyword : ' + out._bareCarrierKeywordOptOut + '   (new)');
  console.log('  smsOptOutIsExit    : ' + out.smsOptOutIsExit);
  console.log('  hasExitSignal      : ' + out.hasExitSignal);
  console.log('  isSmsOptOutOnly    : ' + out.isSmsOptOutOnly);
  console.log('  convState          : ' + convStateOf(out));
  console.log('  SMS CHANNEL        : ' +
    ((out.isSmsOptOutOnly || /^stop[\s.!]*$/i.test(GERRA.lastInboundMsg)) ? 'SUPPRESSED (parsed.sms = "" at render)' : 'NOT SUPPRESSED'));
  console.log('\n  EMAIL the model is instructed to write:\n      ' + directive(out));
}
console.log('');
