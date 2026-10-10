'use strict';
// RECORD-FIRST (experiment). Gil, 10/6: "we're constantly fighting sales notes, customer messages, BD agent notes being
// truncated or missed. Why can't the model look at everything relevant to the conversation arc of the active lead?"
//
// The current prompt is about a quarter conversation and three quarters rules, many of them written by pattern-matchers
// that decide what is true ("customer declined", "open question", "locked to Monday") and then tell the model what to do.
// When one misreads, its directive overrides what the model would have read correctly, and the fix is another pattern.
//
// This builds the other shape:
//   THE RECORD  -- every note on the customer, oldest first, untruncated, each labelled by who wrote it.
//   THE FACTS   -- only what the store's systems know and the model cannot: the clock and store hours, whether the unit is
//                  in stock and what else is, published incentives, who is writing, channel status, close-out eligibility.
//   HARD RULES  -- a short list in the system prompt, the things that must never go wrong.
// and asks for a READ of the situation before the drafts, in the same call, so the agent can see what the model understood
// and the text is written from the record rather than rewritten blind from the email.
//
// Plain functions, no dependencies, ES5-safe inside, so the block can move into popup.js unchanged if it is adopted.

// ── THE RECORD ──────────────────────────────────────────────────────────────────────────────────────────────────────
var RF_BOT_RE = /\b(?:virtual|automated|auto|ai|digital|robo)[\s-]*(?:assistant|agent|coordinator|concierge|advisor|responder)\b|\bchat\s?bot\b|\bauto[\s-]?responder\b|\bbot\b/i;
var RF_FOOTER_RE = /You are receiving this email because|If you prefer not to receive|click here to unsubscribe|This email was (?:sent|delivered) to|To contact us please visit|All Prices \+ Registration|By submitting my (?:cell )?phone number/i;
var RF_QUOTE_RE = /(?:^|[^A-Za-z])On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\/)[^\n]{0,200}?\bwrote:|-{2,}\s*Original Message\s*-{2,}|\nFrom:\s[^\n]*\n\s*(?:Sent|Date):|Sent from (?:my iPhone|my Android|Yahoo Mail|Mail for Windows|Outlook)/i;

function rfAuthor(body) {
  var m = String(body || '').match(/(?:^|\n)\s*(?:Sent by|By)\s*:[ \t]*([^\n]{1,80})/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function rfClean(body, isCustomer) {
  var t = String(body || '').replace(/\r/g, '').replace(/ /g, ' ');
  t = t.split('\n').filter(function (l) { return !/^\s*(?:sent to|sent by|received from|received by|by)\s*:/i.test(l); }).join('\n');
  var f = t.search(RF_FOOTER_RE);
  if (f > 40) t = t.slice(0, f);
  if (isCustomer) { var q = t.search(RF_QUOTE_RE); if (q > 0) t = t.slice(0, q); }
  t = t.replace(/\bhttps?:\/\/\S+|\bwww\.\S+|\S*%2[fF]\S*/g, '[link]');
  t = t.split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function rfSubject(text) {
  var m = String(text || '').match(/^\s*Subject\s*:\s*([^\n]*)\n?/i);
  return m ? { subject: m[1].trim(), rest: text.slice(m[0].length).trim() } : { subject: '', rest: text };
}

// One note -> one labelled line. Returns null for a note that carries nothing (a bare call-recording link).
function rfEntry(n) {
  var title = String(n.title || ''), dir = String(n.dir || ''), raw = String(n.body || '');
  var author = rfAuthor(raw), isBot = !!author && RF_BOT_RE.test(author);
  var staff = author ? (isBot ? 'AUTOMATED ASSISTANT (' + author + ')' : author.toUpperCase() + ' (staff)') : 'STAFF';
  var T = title.toLowerCase(), who, what, text;
  if (dir === 'inbound' && /lead received/.test(T)) {
    who = 'LEAD FORM'; what = 'what came in with the lead (the customer\'s submission and the tool\'s data)'; text = rfClean(raw, false);
  } else if (dir === 'inbound' && /phone call/.test(T)) {
    who = 'CALL'; what = 'customer called in' + (author ? ', logged by ' + author : ''); text = rfClean(raw, false);
  } else if (dir === 'inbound') {
    who = 'CUSTOMER'; what = /email/.test(T) ? 'email' : /text/.test(T) ? 'text' : title || 'message'; text = rfClean(raw, true);
  } else if (/marketing campaign|auto response|price change/.test(T)) {
    var s1 = rfSubject(rfClean(raw, false));
    who = 'AUTOMATED EMAIL'; what = title + ' sent to the customer'; text = s1.subject ? 'subject "' + s1.subject + '" (body omitted: mass/automatic send)' : '(body omitted: mass/automatic send)';
  } else if (/email failure/.test(T)) {
    who = 'SYSTEM'; what = 'EMAIL BOUNCED'; text = rfClean(raw, false).split('\n').slice(0, 2).join(' ');
  } else if (dir === 'outbound' && /phone call/.test(T)) {
    var res = (title.match(/\(([^)]+)\)/) || [])[1];
    text = rfClean(raw, false);
    if (/^\[link\]$/.test(text) || !text) return null;
    who = isBot ? staff : (author ? author.toUpperCase() + ' (staff)' : 'STAFF'); what = 'phone call' + (res ? ' — ' + res : '');
  } else if (dir === 'outbound') {
    who = staff; what = /email/.test(T) ? 'email to customer' : /text/.test(T) ? 'text to customer' : title; text = rfClean(raw, false);
  } else {
    who = author ? (author.toLowerCase() === 'system' ? 'SYSTEM' : author.toUpperCase() + ' (staff)') : 'SYSTEM';
    what = title || 'note'; text = rfClean(raw, false);
  }
  if (!text) text = '(empty)';
  return { who: who, what: what, text: text };
}

function rfParseWhen(w) { var t = new Date(String(w || '').replace(/\s+/g, ' ').trim()).getTime(); return isFinite(t) ? t : 0; }

// notes: the scraper's recordNotes (newest first, as VinSolutions lists them). leadStartMs: the scraper's current-lead
// boundary (0 when it could not find one). Returns { text, count, chars }.
function rfBuildRecord(notes, leadStartMs) {
  var rows = [];
  (notes || []).forEach(function (n, i) {
    var e = rfEntry(n);
    if (!e) return;
    rows.push({ ms: rfParseWhen(n.when), when: String(n.when || '').trim(), order: i, e: e });
  });
  rows.sort(function (a, b) { return (a.ms - b.ms) || (b.order - a.order); });   // oldest first; same minute keeps page order reversed
  var out = [], marked = !leadStartMs;
  if (!leadStartMs) out.push('(The start of the current lead could not be found on the page: read the dates.)');
  else if (rows.length && rows[0].ms >= leadStartMs) { out.push('━━ THE CURRENT LEAD STARTS HERE ━━'); marked = true; }
  else out.push('━━ EARLIER HISTORY WITH THIS CUSTOMER — background, before the current lead ━━');
  rows.forEach(function (r) {
    if (!marked && r.ms >= leadStartMs) {
      out.push('', '━━ THE CURRENT LEAD STARTS HERE — everything below is the active conversation ━━'); marked = true;
    }
    var body = r.e.text.indexOf('\n') >= 0 ? '\n    ' + r.e.text.replace(/\n/g, '\n    ') : ' ' + r.e.text;
    out.push('[' + r.when + '] ' + r.e.who + ' — ' + r.e.what + ':' + body);
  });
  var text = out.join('\n');
  return { text: text, count: rows.length, chars: text.length };
}

// ── THE FACTS ───────────────────────────────────────────────────────────────────────────────────────────────────────
var RF_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function rfCentral(now) { return new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/Chicago' })); }
function rfFmtTime(d) { var h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM'); }
function rfHoursFor(hours, d) { return !hours ? '' : d.getDay() === 0 ? hours.sunday : d.getDay() === 6 ? hours.saturday : hours.weekday; }
function rfParseHours(s) {   // "9 AM - 7 PM" -> {open: 9, close: 19} in hours
  var m = String(s || '').match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  var h = function (x, mm, ap) { x = parseInt(x, 10) % 12; if (/pm/i.test(ap)) x += 12; return x + (mm ? parseInt(mm, 10) / 60 : 0); };
  return { open: h(m[1], m[2], m[3]), close: h(m[4], m[5], m[6]) };
}
function rfFmtHour(x) { var h = Math.floor(x), m = Math.round((x - h) * 60); return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h < 12 ? 'AM' : 'PM'); }

function rfVehicleFacts(data, inv, incentives, today) {
  var lines = [], units = (inv && inv.units) || [];
  var veh = String(data.vehicle || data.vehicleRaw || '').trim(), stock = String(data.stockNum || '').trim().toUpperCase(), vin = String(data.vin || '').trim().toUpperCase();
  lines.push('VEHICLE ON THE LEAD: ' + (veh || '(none named)') + (stock ? ' — stock ' + stock : '') + (vin ? ', VIN ' + vin : ''));
  var unit = null;
  for (var i = 0; i < units.length && !unit; i++) {
    var u = units[i];
    if ((stock && String(u.stock || u.stockNum || '').toUpperCase() === stock) || (vin && String(u.vin || '').toUpperCase() === vin)) unit = u;
  }
  var feed = inv && inv.generated ? ' (inventory feed dated ' + inv.generated + ')' : '';
  if (unit) {
    lines.push('  IN STOCK' + feed + ': ' + unit.vehicle + (unit.color ? ', ' + unit.color : '') + ', ' + (unit.certified ? 'certified pre-owned' : unit.condition)
      + (typeof unit.odometer === 'number' && unit.condition !== 'new' ? ', ' + unit.odometer.toLocaleString('en-US') + ' miles' : '')
      + (typeof unit.daysOnLot === 'number' ? ', ' + unit.daysOnLot + ' days on the lot' : '') + '.');
  } else if (stock || vin) {
    lines.push('  NOT IN THE CURRENT INVENTORY FEED' + feed + '. It may have sold or moved: do not tell the customer it is available. Check the record for what staff said about it.');
  } else if (units.length) {
    lines.push('  No stock number or VIN on the lead, so no specific unit is confirmed.');
  } else {
    lines.push('  Inventory feed not available for this check: do not confirm availability.');
  }
  // what else of that model is on the lot
  var model = unit ? String(unit.model || '') : '';
  if (!model && veh) {
    for (var k = 0; k < units.length && !model; k++) {
      var um = String(units[k].model || '').split(/\s+/)[0];
      if (um && units[k].make && new RegExp('\\b' + units[k].make + '\\b', 'i').test(veh) && new RegExp('\\b' + um.replace(/[^A-Za-z0-9-]/g, '') + '\\b', 'i').test(veh)) model = um;
    }
  }
  if (model) {
    var key = model.split(/\s+/)[0].toLowerCase();
    var alts = units.filter(function (u) { return u !== unit && String(u.model || '').toLowerCase().split(/\s+/)[0] === key; });
    if (alts.length) {
      lines.push('  OTHER ' + model.split(/\s+/)[0].toUpperCase() + ' UNITS IN STOCK (' + alts.length + '):');
      alts.slice(0, 8).forEach(function (u) {
        lines.push('    - ' + u.vehicle + (u.color ? ', ' + u.color : '') + ', ' + (u.certified ? 'certified' : u.condition) + ' (stock ' + (u.stock || u.stockNum) + ')');
      });
      if (alts.length > 8) lines.push('    - and ' + (alts.length - 8) + ' more');
    } else lines.push('  No other ' + model.split(/\s+/)[0] + ' units in stock.');
  }
  // incentives: published, unexpired, for the lead's model; new vehicles only
  var live = (incentives || []).filter(function (x) { return x && x.line && (!x.expires || String(x.expires) >= today); });
  var key2 = model ? model.split(/\s+/)[0].toLowerCase() : '';
  var mine = key2 ? live.filter(function (x) { return String(x.model || '').toLowerCase().split(/\s+/)[0] === key2; }) : [];
  if (mine.length) {
    lines.push('  PUBLISHED INCENTIVES FOR THE ' + model.split(/\s+/)[0].toUpperCase() + ' (new vehicles only, for qualified buyers, unexpired):');
    mine.forEach(function (x) { lines.push('    - ' + x.line + (x.expires ? ' (ends ' + x.expires + ')' : '')); });
    if (unit && unit.condition !== 'new') lines.push('  These do NOT apply to the used unit on this lead.');
  } else if (live.length && !key2) {
    lines.push('  No model on the lead. The store\'s published incentives (new vehicles, unexpired) are below if the customer asks about offers:');
    live.slice(0, 60).forEach(function (x) { lines.push('    - ' + x.line + (x.expires ? ' (ends ' + x.expires + ')' : '')); });
  } else {
    lines.push('  No published incentives for this vehicle.');
  }
  return lines;
}

// ctx: { now, hours: STORE_HOURS entry, signer: {name, title, phone, store, salesRep}, inv, incentives, closeOut: {eligible, reason} }
function rfBuildFacts(data, ctx) {
  data = data || {}; ctx = ctx || {};
  var now = rfCentral(ctx.now || Date.now()), L = [];
  var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  L.push('NOW: ' + RF_DAYS[now.getDay()] + ' ' + (now.getMonth() + 1) + '/' + now.getDate() + '/' + now.getFullYear() + ', ' + rfFmtTime(now) + ' Central.');
  var hrs = ctx.hours;
  if (hrs) {
    L.push('STORE HOURS (' + hrs.name + '): Monday–Friday ' + hrs.weekday + '; Saturday ' + hrs.saturday + '; Sunday ' + hrs.sunday + '.');
    var ph = rfParseHours(rfHoursFor(hrs, now)), nowH = now.getHours() + now.getMinutes() / 60;
    if (!ph) L.push('RIGHT NOW: the store is CLOSED today.');
    else if (nowH < ph.open) L.push('RIGHT NOW: not open yet; opens at ' + rfFmtHour(ph.open) + ' today.');
    else if (nowH >= ph.close) L.push('RIGHT NOW: closed for the day.');
    else {
      var latest = ph.close - 1, earliest = Math.ceil((nowH + 1) * 4) / 4;
      L.push('RIGHT NOW: open until ' + rfFmtHour(ph.close) + '.' + (earliest <= latest ? ' A visit today can start between ' + rfFmtHour(earliest) + ' and ' + rfFmtHour(latest) + '.' : ' Too late to start a visit today.'));
    }
    var days = [];
    for (var i = 1; i <= 7; i++) {
      var d = new Date(now); d.setDate(now.getDate() + i);
      var hd = rfHoursFor(hrs, d);
      days.push((i === 1 ? 'tomorrow ' : '') + RF_DAYS[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + (/closed/i.test(hd) ? ' (CLOSED)' : ' (' + hd + ')'));
    }
    L.push('NEXT 7 DAYS: ' + days.join(' · '));
  }
  var sg = ctx.signer || {};
  L.push('YOU ARE: ' + [sg.name, sg.title, sg.store].filter(Boolean).join(', ') + (sg.phone ? '. Your direct number: ' + sg.phone : '') + '.');
  if (sg.salesRep && sg.salesRep !== sg.name) L.push('SALES REP ON THIS LEAD: ' + sg.salesRep + ' (the person who would handle the visit).');
  L.push('CUSTOMER: ' + (data.name || '(name not on file)') + '. Phone on file: ' + (data.phone ? 'yes' : 'NO') + '. Email on file: ' + (data.email && !data.isMaskedEmail ? 'yes' : 'NO') + '.');
  var chan = [];
  if (data.isSmsOptOutOnly) chan.push('TEXTING: the customer opted out of texts. Leave "sms" as an empty string.');
  if (data.emailBounce) chan.push('EMAIL: their address is bouncing; the email will not reach them. Do not mention their inbox.');
  if (chan.length) L.push.apply(L, chan);
  L.push('LEAD: source "' + (data.leadSource || 'unknown') + '"' + (typeof data.leadAgeDays === 'number' ? ', ' + data.leadAgeDays + ' day(s) old' : '') + (data.leadStatusText ? ', status ' + data.leadStatusText : '') + '.');
  if (data.tradeDescription && !/none entered/i.test(data.tradeDescription)) L.push('TRADE ON FILE: ' + String(data.tradeDescription).replace(/\s+/g, ' ').trim() + '.');
  L.push.apply(L, rfVehicleFacts(data, ctx.inv, ctx.incentives, today));
  L.push('VISIT LENGTH: a visit is about 30-40 minutes; a trade-in appraisal on its own takes 10-15 minutes.');
  if (ctx.closeOut) L.push(ctx.closeOut.eligible
    ? 'CLOSING THE FILE: this lead is old and worked enough that offering to close it out or step back is allowed, if the record calls for it.'
    : 'CLOSING THE FILE: not allowed on this lead (' + ctx.closeOut.reason + '). Do not offer to stop, step back or close it out unless the customer asked to stop.');
  return L.join('\n');
}

// ── THE PROMPTS ─────────────────────────────────────────────────────────────────────────────────────────────────────
function rfSystemPrompt(sg, opts) {
  sg = sg || {}; opts = opts || {};
  return [
    'You are ' + (sg.name || 'the agent') + ', ' + (sg.title || 'Internet Sales Coordinator') + ' at ' + (sg.store || 'the dealership') + '. You write the next message to a car-dealership customer: a text, an email and a voicemail script, all saying the same thing.',
    '',
    'HOW TO WORK',
    '1. Read the whole RECORD, oldest to newest. It is every note on this customer: their messages, ours, the automated assistant\'s, calls, staff notes, the lead form. Staff notes are often the most current truth (a visit, a call, a sold car, a promise made).',
    '2. Write your READ of the situation first (the "read" field): one or two concrete sentences per field, quoting the record where it matters.',
    '3. Then write the drafts from that read. The message must respond to where the conversation actually is: answer what they last said or asked, follow through on anything we promised, and move one step forward.',
    '',
    'HARD RULES',
    '- The FACTS block is the store\'s systems and outranks anything in the record about inventory, incentives, hours and the date. Never state a vehicle is available unless the facts say IN STOCK.',
    '- Never invent anything: no prices, payments, rates, approvals, trade values, fees, features or availability that are not in the facts or already sent to the customer in the record. If they asked for something you cannot give from here, say what you will do to get it.',
    '- Messages from the AUTOMATED ASSISTANT were not written by you. Never say "I sent" or "as I mentioned" about them.',
    '- Times: only inside store hours, never a closed day, never a time already past. Do not re-offer times the customer turned down, and do not keep pushing pairs of times at someone who has not taken them: ask when works for them instead.',
    '- Do not repeat what we already sent. A follow-up needs a new reason to reply.',
    '- If the vehicle they were working a deal on has sold, its numbers are finished: do not follow up on its price, fees, discount or paperwork. Say plainly that it sold, once, and move to what is available.',
    '- Write in English only (the dealership translates separately). Never narrate rules or internal reasoning to the customer.',
    '- Questions on a lead form or trade tool (e.g. "How much were repair costs?") are form fields, not the customer asking you. If an earlier message of ours treated one as their question, let it drop.',
    '- Never show the customer our systems or paperwork: no stock numbers, VINs, "inventory feed", "our system", "the lead form", "notes" or "the record". Say it in their terms ("the Tundra you asked about").',
    '- Earlier history (before the current-lead marker) is background: use it for context, but do not answer old questions or revive old plans as if they were current.',
    '',
    'VOICE',
    'A capable person at the store writing to one customer: warm, specific, plain. No clichés ("just checking in", "touch base", "photos don\'t do it justice", "no pressure"), no hype, no exclamation-mark enthusiasm. One clear ask per message.',
    '',
    'FORMATS',
    '- sms: open with their first name. Usually 1-3 sentences. End with this signature, each on its own line: ' + [String(sg.name || '').split(' ')[0], sg.store, sg.phone].filter(Boolean).join(' / ') + '.',
    '- email: the body only (the subject goes in "subject"). Opens with their first name. It can carry more than the text: the useful detail behind the ask (what you will have ready, an offer that fits them, the next step), in two to four short paragraphs. Do not just repeat the text. End with this signature, each on its own line: ' + [sg.name, sg.title, sg.store, sg.phone].filter(Boolean).join(' / ') + '.',
    '- voicemail: a 20-30 second script in your voice, with your name, the store and your number.',
    '',
    'OUTPUT: valid JSON only, no markdown:',
    opts.noRead
      ? '{"sms":"...","email":"...","subject":"...","voicemail":"..."}'
      : '{"read":{"last_customer_message":"quote + when","where_it_stands":"...","what_we_owe_them":"promises or questions of theirs still unanswered, or none","constraints":"anything they told us about timing, channel or preferences","this_message_should":"..."},"sms":"...","email":"...","subject":"...","voicemail":"..."}'
  ].join('\n').replace(opts.noRead ? /\n2\. Write your READ[^\n]*\n3\. Then write the drafts from that read\./ : /$^/, '\n2. Then write the drafts.');
}

function rfUserPrompt(factsText, record) {
  return [
    '━━━ FACTS (from the store\'s systems) ━━━',
    factsText,
    '',
    '━━━ THE RECORD — ' + record.count + ' notes, oldest first ━━━',
    record.text,
    '',
    '━━━ YOUR TURN ━━━',
    'Write the read, then the next text, email and voicemail. Return the JSON only.'
  ].join('\n');
}

module.exports = { rfBuildRecord, rfBuildFacts, rfSystemPrompt, rfUserPrompt, rfEntry, rfClean };
