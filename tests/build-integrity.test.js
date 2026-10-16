#!/usr/bin/env node
'use strict';
// (v9.7.603) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('build-integrity.test.js');

/**
 * build-integrity.test.js — v9.7.603. DOES THE BUILD SAY WHICH BUILD IT IS?
 *
 * Gil unzipped v9.7.602, refreshed, and chrome://extensions read "Lead Pro 9.7.600-dev". That
 * looks exactly like a load that silently failed — and he reported it as one. The load was fine.
 *
 * Chrome puts version_name on that row when it is present, falling back to version only when it
 * is not. Both manifests carry a version_name. The v9.7.601 and v9.7.602 bumps rewrote "version"
 * and never touched it, so the shipped label sat two builds behind the shipped code.
 *
 * WHY THIS IS WORTH A SUITE rather than a careful habit. The failure is not that a cosmetic field
 * went stale; it is that the ONE surface Gil uses to confirm a build landed was reporting a
 * different build than the one running. The next step after "the build didn't advance" is a bug
 * report filed against code that is not loaded, or a second unzip of the same file — both were on
 * the table here. Nothing in the 54 existing suites read either manifest: the "both manifests
 * parse" line in recent build headers came from an ad-hoc check run by hand, not from the harness.
 *
 * Version identity now lives in three places that must agree — manifest.version,
 * manifest.version_name, and the header on line 1 of the popup.js that ships beside it — and this
 * suite asserts all three against each other in both builds.
 *
 * Takes the two BUILD DIRECTORIES, not popup.js paths, because a manifest is half of what it checks.
 */
const fs = require('fs');
const path = require('path');

const DIRS = process.argv.slice(2).filter(a => fs.existsSync(path.join(a, 'manifest.json')));
if (!DIRS.length) { console.error('usage: build-integrity.test.js <build-dir> [build-dir...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got));
  }
}

const builds = DIRS.map(d => {
  const mf = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
  const popup = fs.readFileSync(path.join(d, 'popup.js'), 'utf8');
  const line1 = popup.slice(0, popup.indexOf('\n'));
  const m = line1.match(/v(\d+\.\d+\.\d+(?:-dev)?)/);
  return { dir: d, name: path.basename(d), mf, popup, headerVersion: m ? m[1] : null };
});

console.log('\nv9.7.603 — the build must say which build it is');
console.log('builds under test: ' + builds.map(b => b.name).join(', '));
console.log('');

for (const b of builds) {
  console.log(b.name + ':');

  // Chrome accepts 1-4 dot-separated integers here and nothing else. A "-dev" suffix in this
  // field would make the extension fail to load outright — which is exactly why version_name
  // exists, and exactly why the two drift apart if only one is bumped.
  check('  manifest.version is a valid Chrome version',
    /^\d+(\.\d+){0,3}$/.test(String(b.mf.version)) &&
    String(b.mf.version).split('.').every(n => +n >= 0 && +n <= 65535), true);

  // The field Chrome actually displays. Its absence is not an error for Chrome, but it IS an
  // error here: dropping it would silently change what the extensions page shows.
  check('  manifest.version_name is present', typeof b.mf.version_name === 'string' && !!b.mf.version_name, true);

  // THE ASSERTION THAT WOULD HAVE CAUGHT v9.7.601. The label's numeric part must be the version.
  check('  version_name agrees with version — the v9.7.601/602 drift',
    String(b.mf.version_name).replace(/-dev$/, ''), String(b.mf.version));

  // The dev build must be identifiable as dev on the extensions row, and commercial must not be.
  check('  the ' + (b.name === 'dev' ? '-dev suffix is present' : 'label carries no -dev suffix'),
    /-dev$/.test(String(b.mf.version_name)), b.name === 'dev');

  // The popup.js header is where every build's changelog is written, and it is the thing I read
  // when reconstructing what shipped. If it disagrees with the manifest, one of them is lying
  // about what the user is running.
  check('  popup.js line 1 declares a version', b.headerVersion !== null, true);
  check('  ...and it matches the manifest label',
    b.headerVersion, String(b.mf.version_name));
}

// ── THE TWO BUILDS SHIP AS ONE RELEASE ───────────────────────────────────────
if (builds.length > 1) {
  console.log('\nboth channels:');
  check('dev and commercial carry the same version',
    builds.map(b => String(b.mf.version)), builds.map(() => String(builds[0].mf.version)));
  check('...and the same manifest_version, name and permissions',
    builds.map(b => JSON.stringify([b.mf.manifest_version, b.mf.name, b.mf.permissions])),
    builds.map(() => JSON.stringify([builds[0].mf.manifest_version, builds[0].mf.name, builds[0].mf.permissions])));
}

// ── THE RUNTIME BANNER ───────────────────────────────────────────────────────
// The other half of the fix: the console reports the loaded build, so "did it load?" has an
// answer that does not depend on a row that can disagree with the code. Executed, not scanned —
// including the case that matters most, a context where chrome.runtime is not available at all,
// since a banner that throws on startup would be far worse than the problem it solves.
console.log('\nthe [LP BUILD] banner:');
for (const b of builds) {
  const a = b.popup.indexOf('  var _lpMf = (typeof chrome !== ');
  const start = b.popup.lastIndexOf('try {', a);
  const end = b.popup.indexOf('} catch (e) {}', a);
  check(b.name + ' — the banner is present', a > 0 && start > 0 && end > start, true);
  if (a > 0 && start > 0 && end > start) {
    const snippet = b.popup.slice(start, end + '} catch (e) {}'.length);
    const logged = [];
    const vm = require('vm');
    // No `chrome` binding at all — the strictest case.
    const sb1 = { console: { log: (...x) => logged.push(x.join(' ')) }, Date };
    vm.createContext(sb1);
    check(b.name + ' — it does not throw when chrome is unavailable',
      (() => { try { vm.runInContext(snippet, sb1); return 'no throw'; } catch (e) { return 'THREW: ' + e.message; } })(),
      'no throw');
    check(b.name + ' — ...and stays silent rather than logging a fake version',
      logged.length, 0);

    // With a real manifest, it must print the SHIPPED numbers — not a hardcoded string that
    // would drift exactly the way version_name just did.
    const logged2 = [];
    const sb2 = {
      console: { log: (...x) => logged2.push(x.join(' ')) }, Date,
      chrome: { runtime: { getManifest: () => b.mf } }
    };
    vm.createContext(sb2);
    vm.runInContext(snippet, sb2);
    check(b.name + ' — it reports the manifest\'s real version and label',
      logged2.length === 1 &&
      logged2[0].indexOf(String(b.mf.version)) >= 0 &&
      logged2[0].indexOf(String(b.mf.version_name)) >= 0, true);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
