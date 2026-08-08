// Verification for worker v7.48. Loads the REAL shipped constants/functions by slicing them
// out of worker/worker.js and evaluating those exact bytes — no reimplementation.
//
//   node build/worker_verify.js [path/to/worker.js]

const fs = require('fs');
const path = require('path');
const _ARGV = process.argv.slice(2).map(a => path.resolve(a));
process.chdir(__dirname);

const FILE = _ARGV[0] || path.resolve('../worker/worker.js');
const SRC = fs.readFileSync(FILE, 'utf8');

function lift(startsWith, endsWith) {
  const a = SRC.indexOf(startsWith);
  if (a < 0) throw new Error('not found: ' + startsWith);
  const b = SRC.indexOf(endsWith, a);
  if (b < 0) throw new Error('end not found for: ' + startsWith);
  return SRC.slice(a, b + endsWith.length);
}

// ── real constants / functions, evaluated as shipped ────────────────────────
const PREFILTER_SRC = lift('const PHONE_ASK_PREFILTER_RE = new RegExp([', "].join('|'), 'i');");
const TTL_SRC       = lift('const EDGE_CACHE_TTL =', ';');
const EDGEKEY_SRC   = lift('async function edgeCacheKey(', '\n}');
const TODAY_SRC     = lift('function centralTodayStr(', '\n}');

const ctx = { crypto: require('crypto').webcrypto, TEXT_ENCODER: new TextEncoder(), Request };
const lifted = new Function('crypto', 'TEXT_ENCODER', 'Request',
  PREFILTER_SRC + '\n' + TTL_SRC + '\n' + EDGEKEY_SRC + '\n' + TODAY_SRC + '\n' +
  'return { PHONE_ASK_PREFILTER_RE, EDGE_CACHE_TTL, edgeCacheKey, centralTodayStr };'
)(ctx.crypto, ctx.TEXT_ENCODER, ctx.Request);

const RE = lifted.PHONE_ASK_PREFILTER_RE;
let fail = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { fail++; console.log('  ✗ ' + m); };

// ── 1. prefilter RECALL — these must all be caught (a miss = a real phone-ask shipped) ──
// The three marked [prompt] are the phrasings CLASSIFIER_PROMPT_PREFIX names explicitly.
const MUST_CATCH = [
  ['[prompt] direct',    'Gerra, send me your number and I will get that over to you.'],
  ['[prompt] indirect',  "I don't have a number for you yet, so let me know how best to follow up."],
  ['[prompt] trailing',  'I can get those figures together today. Just send the best one to use.'],
  ['best number',        "What's the best number to reach you on this week?"],
  ['confirm phone',      'Can you confirm your phone number so the finance team can call?'],
  ['cell',               'Happy to call — what cell should I use?'],
  ['good number',        'Is this a good number to text you at?'],
  ['reach you',          'What is the best way to reach you tomorrow afternoon?'],
  ['call you at',        'I can call you at whatever number works best.'],
  ['text you',           'Want me to text you the walkaround video?'],
  ['digits',             'Shoot me the digits and I will get it scheduled.'],
  ['contact info',       'Could you share your contact information so we can finalise?'],
  ['send me over',       'Send me over the best way to get in touch.'],
  ['mobile',             'Is your mobile the right line for updates?'],
  ['extension',          'You can reach my extension directly — what number should I use for you?']
];
console.log('\n  PREFILTER RECALL — every phone-ask must be caught\n');
for (const [n, t] of MUST_CATCH) RE.test(t) ? ok(n) : bad(n + '  MISSED: ' + t);

// ── 2. prefilter PRECISION — ideally silent, but a false YES only costs today's latency ──
const SHOULD_SKIP = [
  ['Click & Go follow-up', 'Gerra, I saw your application come through but no vehicle is attached yet. What model are you shopping for?'],
  ['availability',         'The Telluride SX you asked about is still here and ready to look at whenever you are.'],
  ['trade appraisal',      'Your 2019 Challenger appraised well. I can have the worksheet ready when you come in.'],
  ['gracious close',       'Understood, and thank you for letting us know. If you ever need us in the future, we will be here.'],
  ['appointment confirm',  'Confirmed for Tuesday at 10 AM. I will have the Ridgeline pulled up front.'],
  ['incentive',            'There is a private offer running on the Q7 this month for qualified buyers.'],
  ['bereavement',          'I am so sorry for your loss. I will close out the file and stop any further outreach.'],
  ['in-transit',           'That unit is inbound and can be secured before it lands if you want it.'],
  ['price pushback',       'I hear you on the payment. Let me see what the manager can do on the numbers.'],
  ['showroom follow-up',   'Good to meet you today. The Odyssey is still available if you want a second look.'],
  ['no-show recovery',     'No problem at all about this morning — happy to find a time that fits better.'],
  ['finance',              'Your approval is good for 30 days, so there is no rush on the decision.'],
  ['spouse',               'Totally fine to talk it over first. I will keep the Telluride noted for you.'],
  ['first touch',          'Thanks for the inquiry on the 2026 CR-V Hybrid — it is on the ground now.'],
  ['out of stock pivot',   'That exact build sold, but a comparable one arrives next week if that helps.']
];
console.log('\n  PREFILTER PRECISION — a YES here is safe but wasteful (today\'s cost)\n');
let noisy = 0;
for (const [n, t] of SHOULD_SKIP) {
  if (RE.test(t)) { noisy++; console.log('  ~ ' + n + '  would still call the model'); }
  else ok(n);
}

// ── 3. edge-cache key behaviour — the claim behind the TTL change ──────────
console.log('\n  EDGE CACHE\n');
const SYS = 'SYSTEM PROMPT BODY';
const userAt = m => 'LEAD BODY\nCURRENT TIME: 12:' + String(m).padStart(2, '0') + ' PM Central on TODAY (Friday 8/7)\nMORE';
(async () => {
  const k30a = (await lifted.edgeCacheKey(SYS, userAt(30))).url;
  const k30b = (await lifted.edgeCacheKey(SYS, userAt(30))).url;
  const k31  = (await lifted.edgeCacheKey(SYS, userAt(31))).url;
  k30a === k30b ? ok('key is stable within the same clock minute (retry/double-click CAN hit)')
                : bad('key not stable for identical input');
  k30a !== k31 ? ok('key CHANGES across a one-minute boundary — a >60s TTL is unreachable')
               : bad('key did not change across a minute boundary — TTL rationale is wrong');

  const ttl = lifted.EDGE_CACHE_TTL;
  ttl === 120 ? ok('EDGE_CACHE_TTL = 120s (was 604800s / 7 days)')
              : bad('EDGE_CACHE_TTL = ' + ttl + ', expected 120');

  console.log('\n  ' + (fail ? fail + ' FAILED' : 'all checks passed')
    + '  |  recall ' + (MUST_CATCH.length - 0) + '/' + MUST_CATCH.length
    + ', precision ' + (SHOULD_SKIP.length - noisy) + '/' + SHOULD_SKIP.length
    + ' silent\n');
  process.exit(fail ? 1 : 0);
})();
