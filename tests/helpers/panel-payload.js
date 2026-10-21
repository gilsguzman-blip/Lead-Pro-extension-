'use strict';
// (v9.7.808) What the panel actually hands buildUserPrompt. The generation builds _lpPromptInputData from the scrape
// (lastScrapedData) and a few of its own locals; tests that hand buildUserPrompt the scrape itself see fields the live
// panel never passes (the v9.7.710 and v9.7.803 trap). This lifts the shipped object literal out of a build and evaluates
// it in that build's sandbox, with the locals it reads supplied by the caller.
//   panelPayload(src, sb, { lsd, context, name, agent, salesRep, store, vehicle, leadSource, convState })
const vm = require('vm');
const HEAD = '    var _lpPromptInputData = ';
module.exports = function panelPayload(src, sb, v) {
  const a = src.indexOf(HEAD + '{');
  if (a < 0) throw new Error('_lpPromptInputData not found in this build');
  const e = src.indexOf('\n    };', a);
  const lit = src.slice(a + HEAD.length, e + 6);
  const lsd = v.lsd || {};
  sb.__lpPanelVars = {
    lsd, context: v.context || '', name: v.name || lsd.name || '', agent: v.agent || lsd.agent || '', salesRep: v.salesRep || lsd.salesRep || '',
    store: v.store || lsd.store || '', vehicle: v.vehicle !== undefined ? v.vehicle : (lsd.vehicle || ''), leadSource: v.leadSource || lsd.leadSource || '',
    convState: v.convState || lsd.convState || '',
  };
  return vm.runInContext('(function (v) { var name = v.name, agent = v.agent, leadSalesRep = v.salesRep, salesRep = v.salesRep, store = v.store, '
    + 'vehicleForPrompt = v.vehicle, vehicle = v.vehicle, leadSource = v.leadSource, leadContext = v.context, leadConvState = v.convState, '
    + 'lastScrapedData = v.lsd; return ' + lit + '; })(__lpPanelVars)', sb);
};
// (v9.7.808) Which fields buildUserPrompt, and the _lp helpers it hands data to, read that the payload literal does not
// carry. Returns { reader: [field, ...] }; fields in `known` are allowed.
function coverage(src, known) {
  const bu = src.indexOf('function buildUserPrompt(data) {'), bend = src.indexOf('\nfunction ', bu + 10), body = src.slice(bu, bend);
  const pa = src.indexOf('    var _lpPromptInputData = {'), pe = src.indexOf('\n    };', pa), lit = src.slice(pa, pe);
  const keys = new Set();   // "name, agent, salesRep: leadSalesRep," -- shorthand and keyed, several to a line
  lit.split('\n').forEach(l => { const rx = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=:|,|$)/g; let m; l = l.split('//')[0]; while ((m = rx.exec(l))) keys.add(m[1]); });
  const fbody = (name) => { const m = new RegExp('\\nfunction ' + name.replace(/\$/g, '\\$') + '\\((\\w+)[^)]*\\)\\s*\\{').exec(src); if (!m) return null;
    let i = m.index + m[0].length, depth = 1; while (depth && i < src.length) { const c = src[i++]; if (c === '{') depth++; else if (c === '}') depth--; } return { p: m[1], b: src.slice(m.index + m[0].length, i) }; };
  const missing = {};
  const add = (who, f) => { if (keys.has(f) || (known || []).includes(f)) return; const l = missing[who] = missing[who] || []; if (!l.includes(f)) l.push(f); };
  new Set(body.match(/\b_lp[A-Za-z0-9_]+(?=\(data\b)/g) || []).forEach(fn => { const fb = fbody(fn); if (!fb) return;
    (fb.b.match(new RegExp('\\b' + fb.p + '\\.([A-Za-z_$][\\w$]*)', 'g')) || []).forEach(x => add(fn, x.split('.')[1])); });
  (body.match(/\bdata\.([A-Za-z_$][\w$]*)/g) || []).forEach(x => add('buildUserPrompt', x.split('.')[1]));
  return missing;
}
module.exports.coverage = coverage;
