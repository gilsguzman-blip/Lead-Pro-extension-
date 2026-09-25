#!/usr/bin/env node
'use strict';
// (v9.7.728) Agent log LOGG222, 9/25: the BD agent generated for customer A (Kia Baytown, lead 2089661224)
// -- "Sorry we missed your call, [name] ... What are you shopping for?" -- then customer B's lead (Audi
// Lafayette, 2090015912) loaded from the storage beacon, not the Grab button, so clearFields never ran. The
// voicemail was cleared by its v9.7.604 lead stamp; the SMS and email had no stamp and stayed on screen, and
// customer A's email went out on customer B's lead at 1:45 PM as her first message.
// Now every SMS/email draft is stamped with its lead in setOutput, and populateFromData clears a draft stamped
// for another lead (or unstamped) -- the voicemail's rule. Executes the shipped block against stub fields.
//
// Usage: node tests/draft-scope-728.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: draft-scope-728.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const PREV = '2000000001', NEXT = '2000000002';
for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const a = src.indexOf('  // ── (v9.7.728) THE SMS AND EMAIL GET THE SAME GUARD.'), b = src.indexOf('  } catch (eOd) {}', a);
  const run = (fields, leadId) => {
    if (a < 0 || b < 0) throw new Error('draft-scope block not found');
    const els = {}, tabs = {}, logs = [];
    for (const k of Object.keys(fields)) {
      const [value, stamp] = fields[k];
      els['output-' + k] = { value, dataset: stamp === null ? {} : { lpLeadId: stamp } };
      tabs[k] = { cls: new Set(['ready-' + k]), classList: { remove(c) { tabs[k].cls.delete(c); } } };
    }
    const sb = { String, d: { autoLeadId: leadId }, _tabBtnMap: tabs, updateWordCount() {},
      document: { getElementById: (id) => els[id] || null }, console: { warn: (...x) => logs.push(x.join(' ')), log() {} } };
    vm.createContext(sb);
    vm.runInContext(src.slice(a, b) + '  } catch (eOd) {}', sb);
    return { sms: els['output-sms'] && els['output-sms'].value, email: els['output-email'] && els['output-email'].value,
      ready: Object.keys(tabs).filter(k => tabs[k].cls.has('ready-' + k)), logs };
  };
  const SMS = 'Test, sorry we missed your call.', EMAIL = 'Subject: Sorry we missed your call, Test';

  console.log(' 1. drafts written for another lead do not survive a lead change:');
  let r1; try { r1 = run({ sms: [SMS, PREV], email: [EMAIL, PREV] }, NEXT); } catch (e) { r1 = { sms: 'THREW: ' + e.message, email: '', ready: [], logs: [] }; }
  check('LOGG222: the previous customer\'s SMS and email are cleared when the next lead loads', () => [r1.sms, r1.email, r1.ready], ['', '', []]);
  check('...and the diag names both leads', () => r1.logs.some(l => /^\[LP DRAFT SCOPE\] clearing the EMAIL draft written for lead 2000000001 -- now on lead 2000000002/.test(l)), true);
  check('an unstamped draft (from before this build) is cleared too, as the voicemail rule does', () => { const r = run({ sms: [SMS, null], email: [EMAIL, ''] }, NEXT); return [r.sms, r.email]; }, ['', '']);

  console.log(' 2. and nothing else is touched:');
  check('control: the same lead reloading keeps its drafts', () => { const r = run({ sms: [SMS, NEXT], email: [EMAIL, NEXT] }, NEXT); return [r.sms, r.email, r.ready]; }, [SMS, EMAIL, ['sms', 'email']]);
  check('control: an unknown current lead leaves a stamped draft alone', () => { const r = run({ sms: [SMS, PREV], email: [EMAIL, PREV] }, ''); return [r.sms, r.email]; }, [SMS, EMAIL]);
  check('control: empty fields stay empty and log nothing', () => { const r = run({ sms: ['', PREV], email: ['  ', null] }, NEXT); return [r.logs.length]; }, [0]);

  console.log(' 3. the writer stamps what it writes:');
  check('setOutput stamps the field with the lead it was generated for', () =>
    /function setOutput\(key, text\) \{\s*const f = document\.getElementById\('output-' \+ key\);\s*if \(f\) \{\s*f\.value = text;[\s\S]{0,200}?f\.dataset\.lpLeadId = String\(\(lastScrapedData && lastScrapedData\.autoLeadId\) \|\| ''\)/.test(src), true);
  check('the guard runs inside populateFromData, right after the voicemail guard', () => {
    const p = src.indexOf('function populateFromData(d) {'), vmg = src.indexOf('} catch (eVm) {}', p);
    return p > 0 && vmg > p && a > vmg && a - vmg < 200; }, true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
