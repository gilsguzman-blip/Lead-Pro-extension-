// Verification harness for the SMS-STOP exit-signal decision.
//
// This does NOT reimplement the logic. It slices the REAL source lines out of the
// shipped popup.js (from `var rawStopSignal` through `const isSmsOptOutOnly`) and
// evaluates those exact bytes inside a `with(ctx)` scope, where ctx supplies the
// upstream scraper variables. Any change to the shipped code is reflected here
// immediately, and the region boundaries are located by content, not line number.

const fs = require('fs');

function sliceRegion(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex(l => /^\s*var rawStopSignal = /.test(l));
  const end   = lines.findIndex(l => /^\s*const isSmsOptOutOnly = /.test(l));
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('could not locate region in ' + file + ' (start=' + start + ' end=' + end + ')');
  }
  return { src: lines.slice(start, end + 1).join('\n'), start: start + 1, end: end + 1 };
}

// Minimal stand-in for a VinSolutions note element, so the internal-note scans
// (hasInternalSoldElsewhere / hasInternalNotInterested) run for real.
// `text` keeps its NEWLINES — the real .notes-and-history-item-content innerText is
// multi-line ("Received from: …\nReceived by: …\nSTOP"), proven by [LP SCHED DIAG]
// rendering it as "received from: … | received by: gil guzman | stop".
function noteEl(text, opts) {
  opts = opts || {};
  return {
    getAttribute(a) { return a === 'data-direction' ? (opts.dir || '') : null; },
    querySelector(sel) {
      if (sel === '.notes-and-history-item-content') return { innerText: text };
      if (sel === '.legacy-notes-and-history-title') return { innerText: opts.title || '' };
      if (sel === '.notes-and-hsitory-item-date') return { innerText: opts.date || '' };
      return null;
    }
  };
}

// popup.js pushes transcript entries as:
//   '[' + date + '] [' + who + '] ' + title + '\n  ' + sanitize(content)
// and sanitize() COLLAPSES NEWLINES TO SPACES, so the note body arrives on ONE line.
// Fixtures must reproduce that or they test a shape the page never produces.
function entry(date, who, title, content) {
  return '[' + date + '] [' + who + '] ' + title + '\n  ' + String(content).replace(/\s+/g, ' ').trim();
}

function makeCtx(o) {
  o = o || {};
  const transcript = o.transcript || [];
  const filteredTranscript = o.filteredTranscript || transcript;
  const notes = o.notes || [];
  const recentInbound = (o.recentInbound !== undefined)
    ? o.recentInbound
    : filteredTranscript.filter(t => t.indexOf('[CUSTOMER]') !== -1).slice(0, 5).join(' ').toLowerCase();
  const fullScanText = (o.fullScanText !== undefined)
    ? o.fullScanText
    : (transcript.join('\n') + '\n' + notes.join('\n')).toLowerCase();

  return {
    transcript,
    filteredTranscript,
    noteEls: (o.noteEls || notes.map(function(n){ return typeof n === 'string' ? noteEl(n) : noteEl(n.text, n); })),
    recentInbound,
    inboundMessageOnly: (recentInbound || '').replace(/^\s*Received (from|by)[^\n]*\n?/gim, '').trim(),
    fullScanText,
    lastInboundMsg: o.lastInboundMsg || '',
    hasSystemOptOutNote: !!o.hasSystemOptOutNote,
    isSmsOptOut: false,                       // assigned by the region under test
    hasNewLeadToday: !!o.hasNewLeadToday,
    hasRecentReoptIn: !!o.hasRecentReoptIn,
    hasRecentReactivation: !!o.hasRecentReactivation,
    leadAgeDays: o.leadAgeDays || 0,
    _leadAgeScraped: o._leadAgeScraped !== undefined ? o._leadAgeScraped : true,
    _lpD: function () {}                      // diagnostics silenced
  };
}

const OUT = ['rawStopSignal', '_freshStopOnThisLead', '_optOutPriorLead',
             'smsOptOutIsExit', 'exitRaw', 'boughtElsewhere', 'exitByRemoval',
             'hasInternalSoldElsewhere', 'hasInternalNotInterested',
             'hasBereavementSignal', 'recentCustomerActive', 'keepingTrade',
             'hasExitSignal'];

// exitRaw is defined as `smsOptOutIsExit || /<big regex>/.test(fullScanText)`, so its
// value alone cannot tell us whether the written-request path ("stop contacting me")
// stands on its own. Lift the real regex literal out of the real source line and test
// it in isolation — still the shipped bytes, just without the smsOptOutIsExit term.
function exitRawIndependentTester(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find(l => /^\s*var exitRaw = /.test(l));
  if (!line) throw new Error('exitRaw line not found in ' + file);
  const expr = line.replace(/^\s*var exitRaw = smsOptOutIsExit \|\| /, '').replace(/;\s*$/, '');
  if (/smsOptOutIsExit/.test(expr)) throw new Error('failed to strip smsOptOutIsExit from exitRaw');
  return new Function('fullScanText', 'return ' + expr + ';');
}

function buildRunner(file) {
  const { src, start, end } = sliceRegion(file);
  const exitRawAlone = exitRawIndependentTester(file);
  // Optional locals that only exist after the fix; reported when present.
  const optional = ['_bareCarrierKeywordOptOut'];
  const body =
    'with (ctx) {\n' + src + '\n' +
    'var __o = { isSmsOptOut: isSmsOptOut, isSmsOptOutOnly: isSmsOptOutOnly };\n' +
    OUT.map(n => 'try { __o[' + JSON.stringify(n) + '] = ' + n + '; } catch (e) { __o[' + JSON.stringify(n) + '] = "<undef>"; }').join('\n') + '\n' +
    optional.map(n => 'try { __o[' + JSON.stringify(n) + '] = ' + n + '; } catch (e) {}').join('\n') + '\n' +
    'return __o;\n}';
  const fn = new Function('ctx', body);
  return {
    run: opts => {
      const ctx = makeCtx(opts);
      const out = fn(ctx);
      out.exitRawIndependent = exitRawAlone(ctx.fullScanText);
      return out;
    },
    lines: start + '-' + end,
    src
  };
}

module.exports = { buildRunner, sliceRegion, noteEl, entry };
