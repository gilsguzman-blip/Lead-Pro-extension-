'use strict';
/**
 * guarded-impls.js — a suite that throws on load prints NOTHING, and nothing reads exactly like
 * "this suite catches nothing".
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────
 * Every suite in this directory extracts code out of the shipped popup.js and runs it. When a
 * helper is absent — which is exactly the case in the non-vacuity check, where the suite is
 * pointed at the build BEFORE the fix — extract() throws, the file dies before its first
 * assertion, and stdout is empty.
 *
 * An empty run is indistinguishable at a glance from a suite whose assertions all passed
 * quietly, or from one that tests nothing. That misreading has cost four wrong non-vacuity
 * readings in a single week (v9.7.583, v9.7.592, v9.7.595 twice), each time reported as "the
 * suite doesn't catch the bug" when the suite had simply never run.
 *
 * Measured across the directory: 48 of 52 suites died this way.
 *
 * ── WHAT IT DOES ──────────────────────────────────────────────────────────────────────────
 * Extraction failure becomes a REPORTED failure instead of a fatal one. Each build is extracted
 * inside a try; on failure the suite still gets an object carrying `name` (so headers print) and
 * `src` (so source-scan assertions still run and still mean something), while any OTHER property
 * access throws a labelled error. The per-assertion try/catch every suite already has turns that
 * into a normal FAIL line naming what was missing.
 *
 * The result: pointing a suite at a pre-fix build yields a full run of loud failures rather than
 * silence, which is what the non-vacuity check was always supposed to produce.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────
 * It does not swallow anything on a HEALTHY build. If extract() succeeds, the real object is
 * returned untouched and this file is invisible. A suite that starts failing after this change
 * is failing for a real reason.
 */
const fs = require('fs');
const path = require('path');

module.exports = function guardedImpls(builds, extract) {
  return builds.map(function (file) {
    try {
      return extract(file);
    } catch (e) {
      var why = e && e.message ? e.message : String(e);
      var base = { name: path.basename(path.dirname(file)), __missing: why };
      try { base.src = fs.readFileSync(file, 'utf8'); } catch (_) { base.src = ''; }
      try { base.code = base.src; } catch (_) {}
      return new Proxy(base, {
        get: function (target, key) {
          if (key in target) return target[key];
          if (typeof key === 'symbol') return undefined;
          throw new Error('NOT IN THIS BUILD — ' + why);
        }
      });
    }
  });
};

// Report what could not be extracted, once, before the assertions run. Without this line a
// pre-fix run is a wall of failures with no stated cause.
module.exports.note = function (impls) {
  impls.forEach(function (i) {
    if (i && i.__missing) {
      console.log('  NOTE  ' + i.name + ' — extraction failed: ' + i.__missing);
      console.log('        assertions needing the extracted code will FAIL below, by design.');
    }
  });
};
