#!/usr/bin/env node
'use strict';
/**
 * leadpro.test.js — Lead Pro v7.50 unit tests
 * Run with: node leadpro.test.js
 *
 * Tests 12 scenarios via classifyScenario(), buildUserPrompt(), and
 * buildSystemPrompt() loaded directly from popup.js using Node vm.
 */

const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Browser environment shims — enough for popup.js to evaluate cleanly in Node
// ─────────────────────────────────────────────────────────────────────────────
const noop = () => {};

// A minimal fake DOM element — gives every getElementById call something safe
const fakeEl = {
  addEventListener: noop,
  removeEventListener: noop,
  getAttribute: () => '',
  setAttribute: noop,
  classList:    { add: noop, remove: noop, contains: () => false, toggle: noop },
  value:        '',
  innerText:    '',
  textContent:  '',
  innerHTML:    '',
  style:        {},
  disabled:     false,
  checked:      false,
  querySelector:    () => fakeEl,
  querySelectorAll: () => [],
  appendChild: noop,
  click:       noop,
};

const fakeDoc = {
  addEventListener:    noop,
  getElementById:      () => fakeEl,
  querySelector:       () => fakeEl,
  querySelectorAll:    () => [],
  body: {
    innerText:  '',
    textContent:'',
    classList:  { add: noop, remove: noop, contains: () => false },
  },
  title: '',
};

const fakeWindow = {
  location:       { href: '' },
  addEventListener: noop,
  removeEventListener: noop,
  outerWidth:     0,
  matchMedia:     () => ({ matches: false }),
  close:          noop,
  parent:         null,
};

const popupCtx = vm.createContext({
  // Standard globals
  console,
  Date:       global.Date,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval,
  Promise:    global.Promise,
  JSON:       global.JSON,
  Math:       global.Math,
  parseInt:   global.parseInt,
  parseFloat: global.parseFloat,
  Array:      global.Array,
  Object:     global.Object,
  RegExp:     global.RegExp,
  String:     global.String,
  Boolean:    global.Boolean,
  Number:     global.Number,
  Error:      global.Error,
  Map:        global.Map,
  Set:        global.Set,
  isNaN:      global.isNaN,
  isFinite:   global.isFinite,
  decodeURIComponent: global.decodeURIComponent,
  encodeURIComponent: global.encodeURIComponent,
  // Browser/extension APIs
  document: fakeDoc,
  window:   fakeWindow,
  navigator: { userAgent: '' },
  alert:    noop,
  fetch:    () => Promise.resolve({ json: () => Promise.resolve({}) }),
  chrome: {
    storage:    { sync: { get: (k, cb) => cb && cb({}), set: noop } },
    scripting:  { executeScript: noop },
    runtime:    { lastError: null },
    tabs:       { query: (q, cb) => cb && cb([]) },
    sidePanel:  { open: () => Promise.resolve() },
  },
});

// Load popup.js — DOM-interaction code at the bottom runs but is harmless
const popupSrc = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');
try {
  vm.runInContext(popupSrc, popupCtx);
} catch (e) {
  // If functions are loaded, non-fatal DOM errors at the tail are acceptable
  if (!popupCtx.classifyScenario || !popupCtx.buildUserPrompt) {
    console.error('FATAL: popup.js did not load correctly:', e.message);
    process.exit(1);
  }
}

const { classifyScenario, computeAppointmentTimes, buildSystemPrompt, buildUserPrompt } = popupCtx;

// ─────────────────────────────────────────────────────────────────────────────
// Minimal test runner
// ─────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const RESULTS = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    RESULTS.push({ ok: true, name });
  } catch (e) {
    fail++;
    RESULTS.push({ ok: false, name, msg: e.message });
  }
}

// Assertions
function ok(val, msg) {
  if (!val) throw new Error(msg || `Expected truthy, got ${JSON.stringify(val)}`);
}
function notOk(val, msg) {
  if (val) throw new Error(msg || `Expected falsy, got ${JSON.stringify(val)}`);
}
function contains(str, sub, msg) {
  const s = String(str || '');
  if (!s.toLowerCase().includes(sub.toLowerCase()))
    throw new Error(msg || `Expected string to contain "${sub}"\n  Got: "${s.substring(0, 300)}"`);
}
function notContains(str, sub, msg) {
  const s = String(str || '');
  if (s.toLowerCase().includes(sub.toLowerCase()))
    throw new Error(msg || `Expected string NOT to contain "${sub}"\n  Got: "${s.substring(0, 300)}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test data factories
// ─────────────────────────────────────────────────────────────────────────────
function firstTouchBase(overrides) {
  return Object.assign({
    name:             'Maria Gonzalez',
    agent:            'Kristen Willis',
    salesRep:         'John Smith',
    store:            'Community Toyota Baytown',
    vehicle:          '2024 Toyota Camry',
    leadSource:       'Internet Lead',
    context:          '',
    convState:        'first-touch',
    hasOutbound:      false,
    contactedAgeDays: 0,
    isLiveConversation: false,
    activeFlags:      [],
  }, overrides || {});
}

function followUpBase(overrides) {
  return Object.assign(firstTouchBase(), {
    convState:        'active-follow-up',
    hasOutbound:      true,
    context:
      'FOLLOW-UP: read the full transcript and write a response that directly continues THIS conversation.\n' +
      'Total CRM entries: 5\n' +
      'CONVERSATION TRANSCRIPT (newest first):\n---\n' +
      '[3/10/25] [AGENT] Hi Maria, Kristen here — wanted to check in on the Camry. Would 2 PM or 4:30 PM today work?\n' +
      '[3/8/25] [CUSTOMER] Hey, I\'m interested! Can you tell me more?\n---',
  }, overrides || {});
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — Click & Go: fresh lead, no prior outbound, Gubagoo Virtual Retailing
// ─────────────────────────────────────────────────────────────────────────────
test('S1 — Gubagoo Virtual Retailing fires isClickAndGo (not isStandard)', () => {
  const sc = classifyScenario(firstTouchBase({ leadSource: 'Gubagoo Virtual Retailing' }));
  ok(sc.isClickAndGo,  'isClickAndGo should be true');
  notOk(sc.isStandard, 'isStandard should be false');
});

test('S1 — HDS DR source also fires isClickAndGo', () => {
  const sc = classifyScenario(firstTouchBase({ leadSource: 'HDS DR - Digital Retailing' }));
  ok(sc.isClickAndGo, 'HDS DR should be isClickAndGo');
});

test('S1 — Gubagoo Chat is excluded from Click & Go (isChatLead instead)', () => {
  const sc = classifyScenario(firstTouchBase({ leadSource: 'Gubagoo Chat Lead' }));
  notOk(sc.isClickAndGo, 'Gubagoo Chat should NOT be isClickAndGo');
  ok(sc.isChatLead,      'Gubagoo Chat should be isChatLead');
});

test('S1 — Stale Gubagoo lead with real outbound suppresses isClickAndGo', () => {
  const sc = classifyScenario(firstTouchBase({
    leadSource:       'Gubagoo Virtual Retailing',
    hasOutbound:      true,
    contactedAgeDays: 20,
  }));
  notOk(sc.isClickAndGo, 'Stale Click & Go with real outbound should not fire');
});

test('S1 — Click & Go prompt acknowledges customer started deal online', () => {
  const prompt = buildUserPrompt(firstTouchBase({ leadSource: 'Gubagoo Virtual Retailing' }));
  contains(prompt, 'click & go',          'Prompt should reference Click & Go');
  contains(prompt, 'started your deal online', 'Prompt should acknowledge the online action');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — Stalled lead: contacted 20 days ago, no inbound reply
// ─────────────────────────────────────────────────────────────────────────────
test('S2 — isStalled fires when context contains "stalled lead"', () => {
  const sc = classifyScenario(followUpBase({
    contactedAgeDays: 20,
    context:
      '⚠ STALLED LEAD: This lead has been open for 20 days with no confirmed contact.\n\n' +
      'FOLLOW-UP: read the full transcript and write a response.',
  }));
  ok(sc.isStalled,  'isStalled should be true');
  ok(sc.isFollowUp, 'isFollowUp should also be true');
});

test('S2 — isStalled is false when "stalled lead" is absent from context', () => {
  const sc = classifyScenario(followUpBase({ contactedAgeDays: 20 }));
  notOk(sc.isStalled, 'isStalled should be false without keyword');
});

test('S2 — Stalled prompt contains re-engagement instruction', () => {
  const prompt = buildUserPrompt(followUpBase({
    contactedAgeDays: 20,
    context:
      '⚠ STALLED LEAD: This lead has been open for 20 days with no confirmed contact.\n\n' +
      'FOLLOW-UP: read the full transcript.',
  }));
  contains(prompt, 're-engagement', 'Stalled prompt should contain re-engagement directive');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3 — Live conversation: inbound message within 2 hours
// ─────────────────────────────────────────────────────────────────────────────
test('S3 — Live conversation is isFollowUp but NOT isStalled', () => {
  const sc = classifyScenario(followUpBase({
    isLiveConversation: true,
    contactedAgeDays:   0.05,
    context:
      'FOLLOW-UP: read the full transcript and write a response.\n' +
      '🔥 LIVE CONVERSATION: Customer replied within the last few hours.',
  }));
  ok(sc.isFollowUp, 'isFollowUp should be true');
  notOk(sc.isStalled, 'isStalled should be false for live conversation');
});

test('S3 — Live conversation prompt preserves the LIVE CONVERSATION signal', () => {
  const prompt = buildUserPrompt(followUpBase({
    isLiveConversation: true,
    context:
      'FOLLOW-UP: read the full transcript.\n\n' +
      '🔥 LIVE CONVERSATION: Customer replied within the last few hours and is actively engaged.\n\n' +
      'MOST RECENT CUSTOMER MESSAGE: "Can you check if the silver Camry is still available?"',
  }));
  contains(prompt, 'live conversation', 'Prompt should contain live conversation context');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4 — Sold/delivered with post-sale service issue ("just left" + oil alert)
// ─────────────────────────────────────────────────────────────────────────────
test('S4 — isSoldDelivered fires when context contains "sold/delivered"', () => {
  const sc = classifyScenario(followUpBase({
    context:
      'sold/delivered\n\nCONVERSATION TRANSCRIPT (newest first):\n---\n' +
      '[CUSTOMER] I just left and the oil alert came on right after.\n' +
      '[AGENT] Congratulations on your new Camry!\n---',
  }));
  ok(sc.isSoldDelivered, 'isSoldDelivered should be true');
});

test('S4 — "just left" + oil alert routes to satisfaction-check directive, not congratulations', () => {
  const prompt = buildUserPrompt(followUpBase({
    context:
      'sold/delivered\n\nCONVERSATION TRANSCRIPT:\n---\n' +
      '[CUSTOMER] just left, oil alert came on right after\n---',
    lastInboundMsg: 'just left, oil alert came on right after leaving',
  }));
  contains(prompt,    'just left after a service',      'Should use service-issue directive');
  notContains(prompt, 'PURCHASED and taken DELIVERY',   'Should NOT use generic congratulations directive');
});

test('S4 — Clean sale (no service issue) routes to congratulations directive', () => {
  const prompt = buildUserPrompt(followUpBase({
    context:
      'sold/delivered\n\nCONVERSATION TRANSCRIPT:\n---\n' +
      '[CUSTOMER] Got the keys! Love it!\n---',
    lastInboundMsg: 'Got the keys! Love it!',
  }));
  contains(prompt, 'PURCHASED and taken DELIVERY', 'Clean sale should use congratulations directive');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5 — Phone-up: lead source is Phone Up, call notes in transcript
// ─────────────────────────────────────────────────────────────────────────────
test('S5 — isPhoneUp fires for "Phone Up" lead source', () => {
  const sc = classifyScenario(firstTouchBase({ leadSource: 'Phone Up' }));
  ok(sc.isPhoneUp,     'isPhoneUp should be true');
  notOk(sc.isStandard, 'isStandard should be false');
});

test('S5 — isPhoneUp fires for "Inbound Call Center" source', () => {
  const sc = classifyScenario(firstTouchBase({ leadSource: 'Inbound Call Center' }));
  ok(sc.isPhoneUp, 'isPhoneUp should be true for Inbound Call Center');
});

test('S5 — isPhoneUp suppressed when follow-up state has real outbound history', () => {
  const sc = classifyScenario(followUpBase({ leadSource: 'Phone Up', hasOutbound: true }));
  notOk(sc.isPhoneUp, 'isPhoneUp should be suppressed by follow-up with real outbound');
  ok(sc.isFollowUp,   'isFollowUp should be true instead');
});

test('S5 — Phone-up prompt references call transcript', () => {
  const prompt = buildUserPrompt(firstTouchBase({
    leadSource: 'Phone Up',
    context:
      'PHONE-UP TRANSCRIPT:\n---\n' +
      '[AGENT] Thanks for calling! What vehicle are you interested in?\n' +
      '[CUSTOMER] Looking for a RAV4, maybe a used one.\n---',
  }));
  contains(prompt, 'phone', 'Phone-up prompt should reference phone/call');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 6 — Schedule constraint: customer said "I work in the morning"
// ─────────────────────────────────────────────────────────────────────────────
test('S6 — notToday flag fires when context contains "not today"', () => {
  const sc = classifyScenario(followUpBase({
    context: 'FOLLOW-UP: active follow-up.\n🚫 NOT TODAY: Customer explicitly said they cannot come in today.',
  }));
  ok(sc.notToday, 'notToday should be true');
});

test('S6 — SHIFT_WORKER constraint suppresses standard appointment-times block', () => {
  const prompt = buildUserPrompt(followUpBase({
    customerScheduleConstraint:
      'SHIFT_WORKER: I work in the morning, work morning',
    context:
      'FOLLOW-UP: read the full transcript.\n\n' +
      '🏭 SHIFT WORKER / REFINERY SCHEDULE: Customer works shift schedule. Context: "I work in the morning"\n' +
      'SHIFT WORKER RULES:\n' +
      '- Do NOT offer specific appointment times.\n' +
      '- Instead ASK: "What does your schedule look like this week?" or "When are you off next?"',
  }));
  contains(prompt,    'shift worker',                    'Prompt should contain shift worker timing block');
  notContains(prompt, 'appointment times (use exactly',  'Standard appointment block should be suppressed');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 7 — Out of town: customer said "out of town until Wednesday"
// ─────────────────────────────────────────────────────────────────────────────
test('S7 — notToday fires for out-of-town customers too', () => {
  const sc = classifyScenario(followUpBase({
    context:
      'FOLLOW-UP: active follow-up.\n' +
      '🚫 NOT TODAY: Customer explicitly said they cannot come in today.\n' +
      '✈️ CUSTOMER IS OUT OF TOWN: Returns Wednesday.',
  }));
  ok(sc.notToday, 'notToday should be true for out-of-town customer');
});

test('S7 — OUT_OF_TOWN constraint suppresses standard appointment-times block', () => {
  const prompt = buildUserPrompt(followUpBase({
    customerScheduleConstraint:
      'OUT_OF_TOWN: Customer is out of town and returns Wednesday. Do NOT offer any times before their return.',
    context:
      'FOLLOW-UP: active follow-up.\n\n' +
      '✈️ CUSTOMER IS OUT OF TOWN: Customer is out of town and returns Wednesday. ' +
      'Do NOT offer today or tomorrow as appointment options.',
  }));
  contains(prompt,    'out of town',                    'Prompt should contain out of town timing block');
  notContains(prompt, 'appointment times (use exactly', 'Standard appointment block should be suppressed');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 8 — Credit auto-detect: customer said "don't have good credit"
// The detection regex lives in populateFromData; test it directly here.
// ─────────────────────────────────────────────────────────────────────────────
const CREDIT_RE = /don.t have (good|great|perfect|the best)? credit|bad credit|no credit|poor credit|credit (is|isn.t|aint|ain.t)|low credit|credit score|credit challenge|working on (my |our )?credit|been denied|got denied|bankruptcy|repo|repossession|collections|it is what it is.*credit|credit.*it is what it is/i;

test('S8 — Credit regex: "don\'t have good credit"', () => {
  ok(CREDIT_RE.test("I don't have good credit"), 'Should match');
});

test('S8 — Credit regex: "bad credit"', () => {
  ok(CREDIT_RE.test('I know I have bad credit'), 'Should match');
});

test('S8 — Credit regex: "been denied before"', () => {
  ok(CREDIT_RE.test("I've been denied before"), 'Should match');
});

test('S8 — Credit regex: "it is what it is with my credit"', () => {
  ok(CREDIT_RE.test('My credit — it is what it is'), 'Should match');
});

test('S8 — Credit regex does NOT false-positive on "credit card" question', () => {
  notOk(CREDIT_RE.test('Can I use a credit card for the down payment?'), 'Should NOT match "credit card"');
});

test('S8 — Credit flag active → prompt contains CREDIT SENSITIVITY block and guardrails', () => {
  const prompt = buildUserPrompt(firstTouchBase({ activeFlags: ['credit'] }));
  contains(prompt, 'credit sensitivity flag', 'Prompt should contain credit sensitivity rules');
  contains(prompt, 'never say',               'Prompt should contain specific guardrails');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 9 — Missed appointment: neutral timing, no today/yesterday ref
// ─────────────────────────────────────────────────────────────────────────────
test('S9 — isMissedAppt fires when context contains "missed appointment"', () => {
  const sc = classifyScenario(followUpBase({
    context:
      'missed appointment\n\nCONVERSATION TRANSCRIPT (newest first):\n---\n' +
      '[AGENT] Sorry we missed you! Can we reschedule?\n' +
      '[CUSTOMER] Yeah something came up with work.\n---',
  }));
  ok(sc.isMissedAppt,       'isMissedAppt should be true');
  notOk(sc.isApptConfirmation, 'isApptConfirmation should be false');
});

test('S9 — Missed appt prompt tells AI to acknowledge customer\'s specific reason', () => {
  const prompt = buildUserPrompt(followUpBase({
    context:
      'missed appointment\n\nCONVERSATION TRANSCRIPT:\n---\n' +
      '[CUSTOMER] Yeah something came up with work, can we try again next week?\n---',
  }));
  contains(prompt, 'missed their appointment', 'Prompt should reference missed appointment');
  contains(prompt, 'specific reason',          'Prompt should reference the customer\'s specific reason');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 10 — Distance buyer with trade-in: both flags active
// ─────────────────────────────────────────────────────────────────────────────
test('S10 — isTradePending fires for TradePending lead source', () => {
  const sc = classifyScenario(firstTouchBase({ leadSource: 'TradePending' }));
  ok(sc.isTradePending, 'isTradePending should be true for TradePending source');
});

test('S10 — Distance flag injects DISTANCE BUYER block into prompt', () => {
  const prompt = buildUserPrompt(firstTouchBase({
    activeFlags: ['distance'],
    leadSource:  'AutoTrader',
  }));
  contains(prompt, 'distance buyer', 'Prompt should contain distance buyer block');
  contains(prompt, '30',             'Prompt should reference drive distance');
});

test('S10 — Distance + credit flags both active → combined framing in prompt', () => {
  const prompt = buildUserPrompt(firstTouchBase({
    activeFlags: ['distance', 'credit'],
    leadSource:  'AutoTrader',
  }));
  contains(prompt, 'distance buyer',        'Prompt should contain distance buyer block');
  contains(prompt, 'credit sensitivity',    'Prompt should contain credit sensitivity block');
  contains(prompt, 'distance buyer',        'Combined: distance buyer reference present');
});

test('S10 — System prompt always contains TRADE-IN handling instructions', () => {
  const sys = buildSystemPrompt();
  contains(sys, 'trade-in', 'System prompt should include trade-in rules');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 11 — Loyalty first touch: KMF source, no prior outbound
// ─────────────────────────────────────────────────────────────────────────────
test('S11 — isLoyalty fires for KMF source', () => {
  const sc = classifyScenario(firstTouchBase({ leadSource: 'KMF Loyalty Program' }));
  ok(sc.isLoyalty,     'isLoyalty should be true');
  notOk(sc.isStandard, 'isStandard should be false');
});

test('S11 — isLoyalty fires for AFS (Audi) source and isAudi also set', () => {
  const sc = classifyScenario(firstTouchBase({
    leadSource: 'AFS Loyalty',
    store:      'Audi Lafayette',
  }));
  ok(sc.isLoyalty, 'isLoyalty should be true for AFS');
  ok(sc.isAudi,    'isAudi should be true for Audi Lafayette');
});

test('S11 — Loyalty first-touch prompt contains FIRST TOUCH framing (not FOLLOW-UP)', () => {
  const prompt = buildUserPrompt(firstTouchBase({
    leadSource:  'KMF Loyalty Program',
    store:       'Community Kia Baytown',
    vehicle:     '2023 Kia Telluride',
    hasOutbound: false,
  }));
  contains(prompt,    'first touch',  'Prompt should contain FIRST TOUCH rules');
  contains(prompt,    'no-pressure',  'Prompt should use no-pressure framing');
  notContains(prompt, 'FOLLOW-UP: Customer is already engaged', 'Should not use follow-up framing');
});

test('S11 — Loyalty vehicle context tag preserved in prompt (warns AI not to check inventory)', () => {
  const prompt = buildUserPrompt(firstTouchBase({
    leadSource:  'KMF Loyalty Program',
    store:       'Community Kia Baytown',
    vehicle:     '2023 Kia Telluride',
    context:
      '🔑 LOYALTY VEHICLE: "2023 Kia Telluride" is the customer\'s CURRENT OWNED VEHICLE — ' +
      'NOT dealership inventory. Never say it sold, is available, or check its inventory status.',
  }));
  contains(prompt, 'loyalty vehicle', 'Prompt should preserve loyalty vehicle context flag');
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 12 — Loyalty follow-up: KMF source, has prior outbound
// ─────────────────────────────────────────────────────────────────────────────
test('S12 — Loyalty follow-up: isLoyalty AND isFollowUp both true', () => {
  const sc = classifyScenario(followUpBase({
    leadSource: 'KMF Loyalty Program',
    store:      'Community Kia Baytown',
    hasOutbound: true,
  }));
  ok(sc.isLoyalty,  'isLoyalty should be true');
  ok(sc.isFollowUp, 'isFollowUp should be true');
});

test('S12 — Loyalty follow-up prompt contains FOLLOW-UP framing (not first touch)', () => {
  const prompt = buildUserPrompt(followUpBase({
    leadSource:  'KMF Loyalty Program',
    store:       'Community Kia Baytown',
    hasOutbound: true,
  }));
  contains(prompt,    'follow-up: customer is already engaged', 'Should use follow-up framing');
  notContains(prompt, 'FIRST TOUCH: Keep it warm',             'Should NOT use first-touch framing');
});

test('S12 — First-touch vs follow-up loyalty: different directives generated', () => {
  const ftPrompt = buildUserPrompt(firstTouchBase({
    leadSource:  'KMF Loyalty Program',
    store:       'Community Kia Baytown',
    hasOutbound: false,
  }));
  const fuPrompt = buildUserPrompt(followUpBase({
    leadSource:  'KMF Loyalty Program',
    store:       'Community Kia Baytown',
    hasOutbound: true,
  }));
  contains(ftPrompt, 'first touch',                            'First-touch should say FIRST TOUCH');
  contains(fuPrompt, 'follow-up: customer is already engaged', 'Follow-up should say FOLLOW-UP');
  notOk(ftPrompt === fuPrompt, 'First-touch and follow-up prompts should be different');
});

// ─────────────────────────────────────────────────────────────────────────────
// BONUS — Infrastructure sanity checks
// ─────────────────────────────────────────────────────────────────────────────
test('BONUS — computeAppointmentTimes returns two valid time strings', () => {
  const appt = computeAppointmentTimes('Community Toyota Baytown');
  ok(appt.time1,                      'time1 should exist');
  ok(appt.time2,                      'time2 should exist');
  ok(/\d{1,2}:\d{2}/.test(appt.time1) || appt.time1.length > 4, 'time1 should be a time-like string');
});

test('BONUS — buildSystemPrompt contains required output-format fields', () => {
  const sys = buildSystemPrompt();
  contains(sys, '"sms"',          'System prompt should include sms field');
  contains(sys, '"email"',        'System prompt should include email field');
  contains(sys, '"voicemail"',    'System prompt should include voicemail field');
  contains(sys, 'universal rules','System prompt should contain universal rules section');
});

test('BONUS — Audi store uses Concierge persona in prompt', () => {
  const prompt = buildUserPrompt(firstTouchBase({
    store:      'Audi Lafayette',
    agent:      'Noelia Diaz',
    vehicle:    '2024 Audi Q5',
    leadSource: 'Website Lead',
  }));
  contains(prompt, 'audi concierge', 'Audi prompt should use Concierge persona');
});

test('BONUS — Unknown agent falls back to "(see directory)" phone lookup', () => {
  const prompt = buildUserPrompt(firstTouchBase({ agent: 'Unknown Agent XYZ' }));
  contains(prompt, '(see directory)', 'Unknown agent should get directory fallback');
});

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────
const W    = 64;
const line = '═'.repeat(W);
const GRN  = '\x1b[32m';
const RED  = '\x1b[31m';
const YLW  = '\x1b[33m';
const DIM  = '\x1b[2m';
const RST  = '\x1b[0m';

console.log('\n' + line);
console.log('  Lead Pro v7.50 — Test Results');
console.log(line);

let lastGroup = '';
RESULTS.forEach(r => {
  // Print scenario header when the group changes
  const group = r.name.match(/^(S\d+|BONUS)/)?.[0] || '';
  if (group && group !== lastGroup) {
    lastGroup = group;
    console.log('');
  }
  const icon  = r.ok ? `${GRN}  ✓${RST}` : `${RED}  ✗${RST}`;
  console.log(`${icon}  ${r.name}`);
  if (!r.ok) {
    const lines = r.msg.split('\n');
    lines.forEach(l => console.log(`${YLW}       ↳ ${l}${RST}`));
  }
});

const total = pass + fail;
console.log('\n' + line);
console.log(`\n  ${DIM}${total} tests${RST}  |  ${GRN}${pass} passed${RST}  |  ${fail > 0 ? RED : GRN}${fail} failed${RST}\n`);

process.exit(fail > 0 ? 1 : 0);
