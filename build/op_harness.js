// Extracts the REAL _onPremise detector block out of a shipped popup.js and evaluates
// those exact bytes. Not a reimplementation — same discipline as harness.js.

const fs = require('fs');

function sliceOp(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('      var _opNorm = String(content');
  const b = src.indexOf('      // (v9.7.492/487', a);   // must be the occurrence AFTER the block
  if (a < 0 || b < 0 || b <= a) throw new Error('on-premise block not found in ' + file);
  return src.slice(a, b);
}

function buildOp(file) {
  const body = 'var _onPremise = null;\n' + sliceOp(file) + '\nreturn _onPremise;';
  const fn = new Function('content', 'date', body);
  // date is only used for the timestamp; any valid date works for fire/no-fire testing.
  return { fires: content => fn(content, '08/07/2026 12:00 PM') !== null, src: sliceOp(file) };
}

module.exports = { buildOp, sliceOp };
