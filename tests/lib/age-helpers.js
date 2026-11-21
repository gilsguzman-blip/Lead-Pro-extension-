'use strict';
// (v9.7.854) AUDIT M-1. Suites that slice a region out of popup.js and run it alone need the lead-age helpers the region now
// calls (_lpAgeNum, _lpLeadAgeFallback). This returns their source from the SAME build, or '' on a build that predates them,
// so a sliced suite keeps running against older builds for non-vacuity checks.
module.exports = function ageHelpers(src) {
  const out = [];
  for (const name of ['_lpAgeNum', '_lpLeadAgeFallback']) {
    const i = src.indexOf('\nfunction ' + name + '(');
    if (i < 0) continue;
    let j = src.indexOf('{', i), depth = 0;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    out.push(src.slice(i + 1, j + 1));
  }
  return out.join('\n') + '\n';
};
