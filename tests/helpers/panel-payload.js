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
