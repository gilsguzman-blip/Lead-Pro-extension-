// ─────────────────────────────────────────────────────────────────
// Lead Pro — popup.js  v7.38
// Calls either a proxy server (recommended for team use) OR
// the Gemini API directly. Both configured in config.js.
// ─────────────────────────────────────────────────────────────────
// ── Config validation ─────────────────────────────────────────────
function getEndpoint() {
  if (typeof LEADPRO_PROXY_URL !== 'undefined' && LEADPRO_PROXY_URL && !LEADPRO_PROXY_URL.includes('YOUR_PROXY')) {
    return { type: 'proxy', url: LEADPRO_PROXY_URL };
  }
  if (typeof LEADPRO_API_KEY !== 'undefined' && LEADPRO_API_KEY && LEADPRO_API_KEY !== 'YOUR_API_KEY_HERE') {
    return { type: 'direct', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=' + LEADPRO_API_KEY };
  }
  return null;
}
// ── State ─────────────────────────────────────────────────────────
let selectedStore     = '';
let activeFlags       = new Set();
let leadContext       = '';
let leadSalesRep      = '';
let leadConvState     = 'first-touch';
let lastScrapedData   = null;
// ── DealerID map ──────────────────────────────────────────────────
const DEALER_ID_MAP = {
  '6189':  'Community Toyota Baytown',
  '6190':  'Community Kia Baytown',
  '6191':  'Community Honda Baytown',
  '24399': 'Community Honda Lafayette',
  '21135': 'Audi Lafayette'
};
// ── Store resolver ────────────────────────────────────────────────
function resolveStore(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('audi'))                                                       return 'Audi Lafayette';
  if (t.includes('honda')  && (t.includes('lafayette') || t.includes('lafa'))) return 'Community Honda Lafayette';
  if (t.includes('honda')  && (t.includes('baytown') || t.includes('#619') || t.includes('#618')))  return 'Community Honda Baytown';
  if (t.includes('kia')    && (t.includes('baytown') || t.includes('#619') || t.includes('#618')))  return 'Community Kia Baytown';
  if (t.includes('toyota') && (t.includes('baytown') || t.includes('#619') || t.includes('#618')))  return 'Community Toyota Baytown';
  if (t.includes('honda'))  return 'Community Honda Baytown';
  if (t.includes('kia'))    return 'Community Kia Baytown';
  if (t.includes('toyota')) return 'Community Toyota Baytown';
  return '';
}
function setStore(name) {
  if (!name) return;
  selectedStore = name;
  const badge = document.getElementById('storeBadge');
  badge.textContent = name;
  badge.classList.add('detected');
}
// ── Tab switching ─────────────────────────────────────────────────
function switchTab(tabKey) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
  const btn  = document.querySelector('.tab-btn[data-tab="' + tabKey + '"]');
  const pane = document.getElementById('pane-' + tabKey);
  if (btn)  btn.classList.add('active');
  if (pane) pane.classList.add('active');
  updateWordCount(tabKey);
}
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
});
// ── Word count for active tab ─────────────────────────────────────
function updateWordCount(tabKey) {
  const activeTab = tabKey || (document.querySelector('.tab-btn.active') || {}).dataset || {tab:'sms'};
  const key = typeof tabKey === 'string' ? tabKey : (document.querySelector('.tab-btn.active') || {dataset:{tab:'sms'}}).dataset.tab;
  const field = document.getElementById('output-' + key);
  const wc    = document.getElementById('wordCount');
  if (!field || !field.value.trim()) { wc.textContent = '\u2014'; return; }
  const words = field.value.trim().split(/\s+/).filter(Boolean).length;
  wc.textContent = words + ' words \u00b7 ' + field.value.length + ' chars';
}
// ── Copy buttons ──────────────────────────────────────────────────
document.querySelectorAll('.btn-copy').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const pane = btn.dataset.pane;
    const field = document.getElementById('output-' + pane);
    if (!field || !field.value) return;
    navigator.clipboard.writeText(field.value).then(function() {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
    }).catch(function() {
      btn.textContent = 'Try again';
      setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
    });
  });
});
// ── Populate form from scraped data ──────────────────────────
function populateFromData(d) {
  let filled = 0;
  console.log('[Lead Pro] populateFromData — notes:', d.totalNoteCount, '| brief:', d.conversationBrief ? d.conversationBrief.substring(0,100) : 'NONE', '| convState:', d.convState);
  function fill(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value; el.classList.add('populated'); filled++;
  }
  fill('custName',   d.name);
  fill('agentName',  d.agent || d.salesRep);
  fill('vehicle',    d.vehicle);
  fill('leadSource', d.leadSource);
  leadSalesRep  = d.salesRep  || '';
  leadConvState = d.convState || 'first-touch';
  const noCustomerPhone = !d.phone || d.phone.length < 7;
  const isFollowUp = !!(d.hasOutbound || d.isContacted || (d.totalNoteCount && d.totalNoteCount > 3));
  const extras = [];
  if (d.isSoldDelivered) {
    extras.push('\ud83c\udf89 SOLD/DELIVERED \u2014 this customer has purchased and taken delivery. Do NOT send a re-engagement or sales message.');
    extras.push('MESSAGE GOAL: Warm congratulations only. Welcome them to the family. Set expectation for follow-up service/ownership experience.');
    extras.push('Tone: celebratory, warm, genuine. 2-3 sentences for SMS. No appointment offer. No vehicle pitch.');
  } else if (d.hasMissedAppt) {
    var missedApptTiming = d.missedApptTiming || 'recently';
    extras.push('\ud83d\udcf5 MISSED APPOINTMENT \u2014 customer did not make it to their scheduled appointment. This is a re-engagement to reschedule.');
    extras.push('TIMING RULE: Do NOT specify when the appointment was (today/yesterday) \u2014 appointment timing in the CRM can be unreliable. Instead use neutral language: "we missed connecting", "we did not get a chance to meet", "we were expecting you" \u2014 no date reference.');
    extras.push('MESSAGE GOAL: Acknowledge gently that you missed them. No guilt. Offer to find a new time that works better.');
    extras.push('Tone: warm, understanding, no pressure. Offer two new appointment times.');
  } else if (d.hasApptSet) {
    extras.push('\ud83d\udcc5 APPOINTMENT ALREADY SET \u2014 confirmation/reminder only. No re-pitch. No new times.');
    if (d.apptDetails) extras.push('Appointment details: ' + d.apptDetails);
  } else if (d.isShowroomFollowUp) {
    extras.push('\ud83c\udfea SHOWROOM STAGE: Customer has already visited the dealership. Post-visit follow-up only.');
    extras.push('IMPORTANT: The BD Agent did NOT meet the customer in person \u2014 the Sales Rep did. Do not write "it was great meeting you." Instead reference the visit indirectly: "I heard you stopped by" or "I wanted to follow up on your visit with [Sales Rep name if known]."');
    extras.push('No first-touch language. Frame return visit as finalizing, not starting.');
    if (d.showroomDetails) extras.push('Visit notes: ' + d.showroomDetails);
  }
  const stageOverride = extras.join('\n');
  if (d.conversationBrief) {
    leadContext = (stageOverride ? stageOverride + '\n\n' : '') + d.conversationBrief;
  } else {
    leadContext = stageOverride;
  }
  const stageActive = !!(d.hasApptSet || d.isShowroomFollowUp || d.isSoldDelivered);
  const vehicleExtras = [];
  if (d.condition)        vehicleExtras.push('Condition: ' + d.condition);
  if (d.color && !d.noSpecificVehicle) vehicleExtras.push('Color: ' + d.color);
  if (d.color &&  d.noSpecificVehicle) vehicleExtras.push('Customer expressed interest in ' + d.color + ' \u2014 but no specific unit confirmed. Do NOT say we have this color available.');
  if (d.stockNum)         vehicleExtras.push('Stock #: ' + d.stockNum);
  if (d.vin)              vehicleExtras.push('VIN: ' + d.vin);
  if (d.noSpecificVehicle && !stageActive) vehicleExtras.push('\u26a0 NO SPECIFIC UNIT: Customer has not selected a specific vehicle \u2014 no stock number or VIN. Qualifying questions required.');
  if (d.ownedVehicle) vehicleExtras.push('Customer\'s current vehicle (confirmed from service/sales history): ' + d.ownedVehicle
    + (d.ownedMileage ? ' | Mileage: ' + parseInt(d.ownedMileage).toLocaleString() : '')
    + (d.lastServiceDate ? ' | Last serviced: ' + d.lastServiceDate : '')
    + ' \u2014 USE THIS as the hook for the upgrade conversation when no vehicle of interest is on the lead.'
    + (d.lastServiceDate && /\/(1[0-9]|20)\b/.test(d.lastServiceDate) ? ' NOTE: Last service was several years ago \u2014 customer may have already changed vehicles. Use the Optima reference cautiously.' : ''));
  if (d.ampEmailSubject) vehicleExtras.push('AMP marketing email subject sent to customer: "' + d.ampEmailSubject + '" \u2014 use this to understand the campaign angle and tie it to their current vehicle. Do NOT quote the subject directly.');
  if (d.vehiclePendingSale) {
    vehicleExtras.push('\u26a0 VEHICLE STATUS: A note indicates this vehicle may be in the process of being sold. Do NOT confirm it is available. Do NOT say it is sold either. Instead use cautious language: "I want to make sure we get you in before it moves" or "I\'m monitoring the status closely for you." Create urgency to come in TODAY.');
  } else if (d.inventoryWarning) {
    if (d.hasApptSet) {
      vehicleExtras.push('\u26a0 VEHICLE STATUS: Vehicle is no longer in active inventory \u2014 DO NOT disclose this to the customer. Keep appointment confirmation neutral. Handle the vehicle conversation in person.');
    } else if (!stageActive) {
      vehicleExtras.push('\ud83d\udd34 VEHICLE STATUS: SOLD \u2014 pivot to comparable options');
    }
  }
  if (d.isInTransit && !stageActive)      vehicleExtras.push('\ud83d\ude9b VEHICLE STATUS: IN TRANSIT \u2014 lead with the good news');
  if (d.manager && d.manager !== 'None') vehicleExtras.push('Manager: ' + d.manager);
  if (d.hasTrade) {
    var tradeHook = d.tradeDescription
      ? '\ud83d\udd04 TRADE-IN: ' + d.tradeDescription
      : '\ud83d\udd04 TRADE-IN: Customer has a vehicle to trade in (details not specified).';
    vehicleExtras.push(tradeHook);
    vehicleExtras.push('TRADE-IN RULES:');
    vehicleExtras.push('- The trade is often the DECIDING FACTOR \u2014 customers need to know what their car is worth before they commit to buying.');
    vehicleExtras.push('- Lead with the trade angle in SMS and email: "I want to make sure we get your [trade vehicle] appraised so we can build the right deal for you."');
    vehicleExtras.push('- If trade details are listed (year/make/model/mileage), reference the specific vehicle \u2014 not a generic "your trade-in."');
    vehicleExtras.push('- Position the visit as the step where trade value gets confirmed: "We can do a quick appraisal when you come in \u2014 usually takes about 10 minutes."');
    vehicleExtras.push('- Never make up a trade value or imply you already know what it is worth.');
  }
  if (d.buyingSignals) vehicleExtras.push('BUYING SIGNAL DATA: ' + d.buyingSignals + ' \u2014 use these interests to make the message feel personally relevant WITHOUT revealing you have this data.');
  if (noCustomerPhone) vehicleExtras.push('\ud83d\udcf5 NO CUSTOMER PHONE NUMBER \u2014 SMS and voicemail are not viable. Email is the only channel. Ask for a phone number to connect directly.');
  if (d.customerSaidNotToday) vehicleExtras.push('\ud83d\udeab NOT TODAY: Customer explicitly said they cannot come in today. Do NOT offer same-day appointment times. Instead ask what day works better for them.');
  if (d.customerScheduleConstraint) {
    var isShiftWorkerLead = d.customerScheduleConstraint.indexOf('SHIFT_WORKER:') === 0;
    if (isShiftWorkerLead) {
      vehicleExtras.push('\ud83c\udfe5 SHIFT WORKER / REFINERY SCHEDULE: Customer works shift or hitch schedule (refinery, plant, offshore, rotation). Context: "' + d.customerScheduleConstraint.replace('SHIFT_WORKER: ','') + '"');
      vehicleExtras.push('SHIFT WORKER RULES:');
      vehicleExtras.push('- Do NOT offer specific appointment times \u2014 shift workers often cannot commit until they know their rotation.');
      vehicleExtras.push('- Instead ASK about their schedule: "What does your schedule look like this week?" or "When are you off next?"');
      vehicleExtras.push('- Acknowledge the schedule respectfully \u2014 shift workers appreciate that you understand their lifestyle, not a generic 9-5 pitch.');
      vehicleExtras.push('- Tone: flexible, low-pressure, accommodating. Never make them feel rushed.');
    } else {
      if(d.customerScheduleConstraint.indexOf('OUT_OF_TOWN:') === 0) {
        var constraint = d.customerScheduleConstraint.replace('OUT_OF_TOWN: ','');
        vehicleExtras.push('\u2708\ufe0f CUSTOMER IS OUT OF TOWN: ' + constraint);
        vehicleExtras.push('- Do NOT offer today or tomorrow as appointment options.');
        vehicleExtras.push('- Schedule AFTER their return date. Reference the trip positively: "Safe travels" or "Hope the trip goes well."');
        vehicleExtras.push('- Close by locking in a time for when they are back: "When you are back, would [day] work to come in?"');
      } else {
        vehicleExtras.push('\ud83d\udeab SCHEDULE CONSTRAINT: Customer mentioned a recurring availability block: "' + d.customerScheduleConstraint + '". Do NOT offer appointment times that conflict with this.');
      }
    }
  }
  if (d.isLiveConversation) vehicleExtras.push('\ud83d\udd25 LIVE CONVERSATION: Customer replied within the last few hours and is actively engaged. This is a HOT lead. Write a response that directly continues the live conversation thread. Same-day close is the priority.');
  if (d.isRecentOutbound && !d.isLiveConversation) vehicleExtras.push('\ud83d\udce4 RECENT OUTBOUND: Agent sent a message within the last hour. Any times or offers already made in that message must be honored. Prior message: "' + (d.recentOutboundContent||'').substring(0,200) + '"');
  if (vehicleExtras.length) leadContext += '\n\nVEHICLE/LEAD DETAILS:\n' + vehicleExtras.join('\n');
  const isStalled = isFollowUp && !d.isContacted && !d.hasApptSet && !d.isShowroomFollowUp && !d.isLiveConversation;
  console.log('[Lead Pro] Stalled check \u2014 isFollowUp:', isFollowUp, '| isContacted:', d.isContacted, '| hasApptSet:', d.hasApptSet, '| isShowroomFollowUp:', d.isShowroomFollowUp, '| STALLED:', isStalled);
  if (isStalled) {
    toggleFlag('stalled', true);
    const ageDays = d.leadAgeDays || 0;
    const ageLabel = ageDays >= 14 ? 'several weeks'
                   : ageDays >= 7  ? 'about a week'
                   : ageDays >= 3  ? 'a few days'
                   : 'a couple of days';
    const ownedVehicleHook = d.ownedVehicle ? ' Customer currently drives a ' + d.ownedVehicle + ' \u2014 use this as the specific hook.' : '';
    const ownedModel = d.ownedVehicle ? d.ownedVehicle.replace(/^\d{4}\s+/,'') : 'their current vehicle';
    var pastVisitContext = '';
    if(d.pastVisitNotes && d.pastVisitNotes.length){
      pastVisitContext = '\nKNOWN HISTORY:\n' + d.pastVisitNotes.join('\n');
    }
    const stalledNote = '\u26a0 STALLED LEAD: This lead has been open for ' + (ageDays > 0 ? ageDays + ' days' : ageLabel) + ' with no confirmed contact.' + ownedVehicleHook
      + pastVisitContext + '\n'
      + 'CRITICAL STALLED LEAD RULES:\n'
      + '- Do NOT reference any appointment confirmation (e.g. "C" reply) \u2014 that appointment has passed.\n'
      + '- Do NOT say "thanks for confirming" or imply recent engagement.\n'
      + '- Do NOT treat this as a re-engagement \u2014 the customer has gone quiet after their dealership visit.\n'
      + (d.hasConfirmedVisit ? '- KNOWN HISTORY confirms a past visit. Reference it specifically \u2014 what vehicle, what hesitation. Be honest and open a new door.\n' : '- NO CONFIRMED VISIT on record. Do NOT invent or imply a showroom visit. Do NOT say "when you came in" \u2014 this customer has NOT visited. Approach as a stalled internet lead with no in-person contact.\n')
      + '- Be honest and specific. Never fabricate visit details not present in KNOWN HISTORY.\n'
      + 'SMS = 2-3 sentences MAX: one specific reference to their visit, one new hook, one close.';
    leadContext = stalledNote + '\n\n' + leadContext;
  }
  let detectedStore = (d.dealerId && DEALER_ID_MAP[d.dealerId]) ? DEALER_ID_MAP[d.dealerId] : '';
  if (!detectedStore) detectedStore = resolveStore(d.store);
  if (!detectedStore) detectedStore = resolveStore(d.pageSnippet || '');
  if (detectedStore) setStore(detectedStore);
  const ls = ((d.leadSource || '') + ' ' + (d.tradeDescription || '')).toLowerCase();
  if (d.hasTrade)                                              toggleFlag('trade', true);
  if (ls.includes('tradepending'))                             toggleFlag('trade', true);
  if (ls.includes('kbb') || ls.includes('kelley'))             toggleFlag('trade', true);
  const isLoyaltyLead = ls.includes('afs') || ls.includes('kmf') ||
      ls.includes('maturity') || ls.includes('lease end') || ls.includes('luv');
  if (isLoyaltyLead) {
    toggleFlag('loyalty', true);
    if (d.vehicle) {
      leadContext = '\ud83d\udd11 LOYALTY VEHICLE: "' + d.vehicle + '" is the customer\'s CURRENT OWNED VEHICLE \u2014 NOT dealership inventory. Never say it sold, is available, or check its inventory status.\n' + leadContext;
    }
  }
  if (ls.includes('capital one') || ls.includes('cap one'))    toggleFlag('credit', true);
  if (!activeFlags.has('credit') && d.lastInboundMsg) {
    var creditMention = /don.t have (good |great |perfect |the best )?credit|bad credit|no credit|poor credit|credit (is|isn.t|aint|ain.t)|low credit|credit score|credit challenge|working on (my |our )?credit|been denied|got denied|bankruptcy|repo|repossession|collections|it is what it is.*credit|credit.*it is what it is/i.test(d.lastInboundMsg);
    if(creditMention) toggleFlag('credit', true);
  }
  const canGenerate = !!(d.name || d.vehicle || detectedStore);
  document.getElementById('btnGenerate').disabled = !canGenerate;
  return filled;
}
// ── Flags ─────────────────────────────────────────────────────────
function toggleFlag(key, forceOn) {
  const btn = document.querySelector('.flag-toggle[data-flag="' + key + '"]');
  if (!btn) return;
  if (forceOn === true || !activeFlags.has(key)) {
    activeFlags.add(key); btn.classList.add('on');
  } else {
    activeFlags.delete(key); btn.classList.remove('on');
  }
}
document.querySelectorAll('.flag-toggle').forEach(function(b) {
  b.addEventListener('click', function() {
    toggleFlag(b.dataset.flag);
    const hasData = !!(document.getElementById('custName').value || document.getElementById('vehicle').value || selectedStore);
    document.getElementById('btnGenerate').disabled = !hasData;
  });
});
// ── Clear ─────────────────────────────────────────────────────────
function clearFields() {
  ['custName','agentName','vehicle','leadSource'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('populated'); }
  });
  ['sms','email','vm'].forEach(function(k) {
    const f = document.getElementById('output-' + k);
    if (f) f.value = '';
    const tabBtn = document.querySelector('.tab-btn.' + k);
    if (tabBtn) tabBtn.classList.remove('ready-' + k);
  });
  document.getElementById('wordCount').textContent = '\u2014';
  const st = document.getElementById('crmStatus');
  if (st) { st.className = 'crm-status'; st.textContent = 'Open a VinSolutions lead to auto-fill.'; }
  const dot = document.getElementById('statusDot');
  if (dot) dot.classList.remove('active');
  const sb = document.getElementById('storeBadge');
  if (sb) { sb.textContent = 'Detecting store\u2026'; sb.classList.remove('detected'); }
  selectedStore = ''; leadContext = ''; leadSalesRep = ''; leadConvState = 'first-touch';
  activeFlags.clear();
  document.querySelectorAll('.flag-toggle').forEach(function(b) { b.classList.remove('on'); });
  document.getElementById('btnGenerate').disabled = true;
  chrome.storage.local.remove(['leadpro_data']);
  switchTab('sms');
}
document.getElementById('btnClear').addEventListener('click', clearFields);
// ── Translate to Spanish ──────────────────────────────────────────
document.getElementById('btnTranslate').addEventListener('click', async function() {
  const btn = this;
  const smsEl   = document.getElementById('output-sms');
  const emailEl = document.getElementById('output-email');
  const vmEl    = document.getElementById('output-vm');
  const smsText   = (smsEl   && smsEl.value)   ? smsEl.value.trim()   : '';
  const emailText = (emailEl && emailEl.value)  ? emailEl.value.trim() : '';
  const vmText    = (vmEl    && vmEl.value)     ? vmEl.value.trim()    : '';
  if (!smsText && !emailText && !vmText) {
    alert('Generate messages first, then translate.');
    return;
  }
  const endpoint = getEndpoint();
  if (!endpoint) { alert('No API key configured.'); return; }
  btn.classList.add('translating');
  btn.textContent = 'Traduciendo...';
  async function translateOne(text, label) {
    if (!text || text.length < 5) return text;
    const prompt = [
      'Translate this dealership BDC ' + label + ' message to conversational Mexican Spanish.',
      'Keep tone warm and natural. Keep names, phone numbers, store names, and times exactly as-is.',
      'Return ONLY the translated text \u2014 no JSON, no labels, no extra commentary.',
      '',
      text
    ].join('\n');
    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a professional automotive BDC translator. Translate to natural Mexican Spanish. Return only the translated message text.' }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 3000 }
      })
    });
    const data = await resp.json();
    if (!data.candidates || !data.candidates[0]) return text;
    return data.candidates[0].content.parts[0].text.trim();
  }
  try {
    const [transSMS, transEmail, transVM] = await Promise.all([
      translateOne(smsText, 'SMS'),
      translateOne(emailText, 'email'),
      translateOne(vmText, 'voicemail')
    ]);
    if (transSMS   && smsEl)   { smsEl.value   = transSMS;   updateWordCount('sms'); }
    if (transEmail && emailEl) { emailEl.value  = transEmail; updateWordCount('email'); }
    if (transVM    && vmEl)    { vmEl.value     = transVM;    updateWordCount('vm'); }
    btn.textContent = 'Translated!';
    setTimeout(function() { btn.textContent = 'Mx Espanol'; btn.classList.remove('translating'); }, 2000);
  } catch(err) {
    console.error('[Lead Pro] Translation error:', err);
    btn.textContent = 'Error \u2014 try again';
    btn.classList.remove('translating');
    setTimeout(function() { btn.textContent = 'Mx Espanol'; }, 3000);
  }
});
// ── GRAB LEAD ─────────────────────────────────────────────────────
async function grabLead() {
  const statusEl = document.getElementById('crmStatus');
  const dot      = document.getElementById('statusDot');
  clearFields();
  statusEl.className   = 'crm-status scanning';
  statusEl.textContent = 'Scanning lead\u2026';
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); }
  catch(e) { statusEl.className = 'crm-status error'; statusEl.textContent = 'Cannot access tab.'; return; }
  const isVin = tab && tab.url && (tab.url.includes('vinsolutions.com') || tab.url.includes('coxautoinc.com'));
  if (!isVin) {
    statusEl.className = 'crm-status error';
    statusEl.textContent = 'Open a VinSolutions lead first.';
    return;
  }
  chrome.storage.local.remove(['leadpro_data']);
  tryExecuteScript(tab, statusEl, dot);
}
// ── Execute script scraper ────────────────────────────────────────
function tryExecuteScript(tab, statusEl, dot) {
  statusEl.textContent = 'Reading frames\u2026';
  function inlineScraper() {
    function gid(id) {
      try { const e=document.getElementById(id); return e?(e.innerText||e.textContent||e.value||'').trim():''; } catch(x){return '';}
    }
    function qs(s) {
      try { const e=document.querySelector(s); return e?(e.innerText||e.textContent||e.value||'').trim():''; } catch(x){return '';}
    }
    function firstOf(a) {
      for(const v of a){const s=(v||'').toString().trim();if(s&&s!=='None'&&s!=='none')return s;} return '';
    }
    function labelValue(lbl) {
      try {
        const rows=document.querySelectorAll('tr');
        for(const row of rows){
          const cells=row.querySelectorAll('td');
          if(cells.length<2)continue;
          const label=(cells[0].innerText||cells[0].textContent||'').trim();
          if(label.toLowerCase().replace(/[:\s]/g,'').includes(lbl.toLowerCase().replace(/[:\s]/g,''))){
            const valEl=cells[1].querySelector('span')||cells[1];
            const v=(valEl.innerText||valEl.textContent||'').trim();
            if(v&&v!=='None'&&v!=='none')return v;
          }
        }
      } catch(e){}
      return '';
    }
    const TEXT=(document.body?document.body.innerText||document.body.textContent||'':'').substring(0,12000);
    function tm(pats){for(const r of pats){try{const m=TEXT.match(r);if(m&&m[1])return m[1].trim();}catch(x){}}return '';}
    const dbg=document.getElementById('vindebug-section-wrap');
    const dbgI=dbg?dbg.querySelector('.vindebug-section'):null;
    const autoLeadId=dbgI?(dbgI.getAttribute('data-autoleadid')||''):'';
    const dealerIdFromUrl=(function(){
      try{
        var u=window.location.href;
        var m=u.match(/[?&]de(?:aler(?:Id)?)?=(\d+)/i)||u.match(/[?&]dealerId=(\d+)/i);
        return m?m[1]:'';
      }catch(e){return '';}
    })();
    const dealerId=dbgI?(dbgI.getAttribute('data-dealerid')||dealerIdFromUrl):dealerIdFromUrl;
    const customerId=dbgI?(dbgI.getAttribute('data-globalcustomerid')||''):'';
    const isLeadFrame=!!autoLeadId;
    const storeFromUrl=(function(){
      try{
        var u=window.location.href;
        if(/eccs\/index\.html/i.test(u)){
          try{
            var parentTabEl=window.parent&&window.parent.document&&window.parent.document.getElementById('tabs-tab-customer-dashboard-selected');
            if(parentTabEl&&parentTabEl.innerText) return parentTabEl.innerText.trim();
          }catch(e){}
        }
      }catch(e){}
      return '';
    })();
    const store=firstOf([
      storeFromUrl,
      gid('tabs-tab-customer-dashboard-selected'),
      qs('li.enterpriseCustomer_tab.active a'),
      qs('li.enterprisecustomer_tab.active a'),
      qs('li.enterpriseCustomer_tab.active'),
      qs('ol.breadcrumb li:last-child a'),
      qs('ul.breadcrumb li:last-child a'),
      qs('.breadcrumb li:last-child'),
      qs('h1.page-title'),
      qs('.dealer-name'),
      qs('[class*="dealerName"]'),
      qs('[id*="dealerName"]'),
      qs('[id*="DealerName"]'),
      (function(){
        var top = TEXT.substring(0, 300);
        if(/community\s+honda\s+baytown/i.test(top))   return 'Community Honda Baytown';
        if(/community\s+honda\s+lafayette/i.test(top)) return 'Community Honda Lafayette';
        if(/community\s+kia\s+baytown/i.test(top))     return 'Community Kia Baytown';
        if(/community\s+toyota\s+baytown/i.test(top))  return 'Community Toyota Baytown';
        if(/audi\s+lafayette/i.test(top))              return 'Audi Lafayette';
        if(/community\s+honda/i.test(top))   return 'Community Honda Baytown';
        if(/community\s+kia/i.test(top))     return 'Community Kia Baytown';
        if(/community\s+toyota/i.test(top))  return 'Community Toyota Baytown';
        return '';
      })(),
      (function(){
        var snippet = TEXT.substring(0, 1500);
        if(/community\s+honda\s+baytown/i.test(snippet))   return 'Community Honda Baytown';
        if(/community\s+honda\s+lafayette/i.test(snippet)) return 'Community Honda Lafayette';
        if(/community\s+kia\s+baytown/i.test(snippet))     return 'Community Kia Baytown';
        if(/community\s+toyota\s+baytown/i.test(snippet))  return 'Community Toyota Baytown';
        if(/audi\s+lafayette/i.test(snippet))              return 'Audi Lafayette';
        if(/community\s+honda/i.test(snippet))   return 'Community Honda Baytown';
        if(/community\s+kia/i.test(snippet))     return 'Community Kia Baytown';
        if(/community\s+toyota/i.test(snippet))  return 'Community Toyota Baytown';
        return '';
      })(),
      document.title||''
    ]);
    const name=firstOf([
      gid('ContentPlaceHolder1_m_CustomerAndTaskInfo_m_CustomerInfo__CustomerName'),
      gid('ContentPlaceHolder1_m_CustomerName'),
      qs('.CustomerInfo_CustomerName'),
      qs('span[id$="__CustomerName"]'),
      qs('span[id*="CustomerName"]'),
      qs('[class*="buyer-name"]'),
      qs('.buyerName'),
      (function(){
        var m = TEXT.match(/Customer\s+Dashboard[\s\S]{0,50}?\n([A-Z][a-z\-]+ [A-Z][a-z\-]+(?:\s+[A-Z][a-z\-]+)?)\s*\n/);
        if(m) return m[1].trim();
        m = TEXT.match(/\bBuyer\s*\n([A-Z][a-z\-]+ [A-Z][a-z\-]+(?:\s+[A-Z][a-z\-]+)?)\s*\n/);
        if(m) return m[1].trim();
        return '';
      })()
    ]);
    const emailEl=document.getElementById('customer-email-span');
    const email=emailEl?(emailEl.getAttribute('data-email')||emailEl.innerText||'').trim():'';
    const detailEl=document.querySelector('.CustomerInfo_CustomerDetail,[id*="_CustomerDetail"]');
    let phone='';
    if(detailEl){const m=(detailEl.innerText||'').match(/(?:C|H|W|M|Cell|Home|Work|Eve)[:\s]+([\(\d][\d\(\)\-\. ]{7,18})/i);if(m)phone=m[1].replace(/[^\d\(\)\-\. ]/g,'').trim();}
    const agent=(function(){
      var a = firstOf([
        gid('ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedBDAgentLabel'),
        gid('ActiveLeadPanel1_m_CurrentAssignedBDAgentLabel'),
        qs('span[id*="BDAgentLabel"]'),
        qs('span[id*="AssignedBDAgent"]'),
        labelValue('BD Agent')
      ]);
      if(/^status[:\s]|^manager[:\s]|^source[:\s]|^none$/i.test((a||'').trim())) return '';
      return a;
    })();
    const salesRep=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedUserLabel'),
      gid('ActiveLeadPanel1_m_CurrentAssignedUserLabel'),
      qs('span[id*="CurrentAssignedUser"]'),
      labelValue('Sales Rep')
    ]);
    const manager=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedManagerLabel'),
      gid('ActiveLeadPanel1_m_CurrentAssignedManagerLabel'),
      labelValue('Manager')
    ]);
    var leadAgeDays = 0;
    try {
      var createdText = labelValue('Created') || TEXT.match(/Created[:\s]+([^\n]{5,40})/i)?.[1] || '';
      var daysMatch = createdText.match(/\((\d+)d\)/i);
      if(daysMatch) leadAgeDays = parseInt(daysMatch[1]);
    } catch(e) {}
    var ownedVehicle = '';
    var ampEmailSubject = '';
    var ownedMileage = '';
    var lastServiceDate = '';
    try {
      var ymmMatch = TEXT.match(/Y\/M\/M[:\s]+(\d{4}\s+[A-Za-z][^\n]{3,40})/i);
      if(ymmMatch) ownedVehicle = ymmMatch[1].trim().substring(0,60);
      if(!ownedVehicle){
        var allTbls = document.querySelectorAll('table');
        for(var tbi=0; tbi<allTbls.length && !ownedVehicle; tbi++){
          var hdrs = allTbls[tbi].querySelectorAll('th');
          var hText = Array.from(hdrs).map(function(h){return (h.innerText||'').toLowerCase();}).join('|');
          if(/ro#|repair.order/.test(hText)){
            var svcTrs = allTbls[tbi].querySelectorAll('tr');
            for(var str2=1; str2<svcTrs.length && !ownedVehicle; str2++){
              var sTds = svcTrs[str2].querySelectorAll('td');
              if(sTds.length >= 2){
                var vTxt = (sTds[1].innerText||'').trim();
                if(/\d{4}\s+[A-Za-z]/.test(vTxt) && vTxt.length > 5)
                  ownedVehicle = vTxt.replace(/\s+/g,' ').substring(0,60);
              }
            }
          }
        }
      }
      if(!ownedVehicle){
        var soldPat = /Sold\b[^\n]{0,120}?(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru)[^\n]{3,40})/i;
        var soldM = TEXT.match(soldPat);
        if(soldM) ownedVehicle = soldM[1].trim().replace(/\s+/g,' ').substring(0,60);
      }
      var ampMatch = TEXT.match(/Marketing Campaign Email[^\n]*subject[:\s]+([^\n\)]{5,100})/i);
      if(ampMatch) ampEmailSubject = ampMatch[1].replace(/[)\]]/g,'').trim().substring(0,100);
    } catch(e) {}
    if(ownedVehicle) console.log('[Lead Pro] ownedVehicle:', ownedVehicle);
    if(ampEmailSubject) console.log('[Lead Pro] ampEmailSubject:', ampEmailSubject);
    const vehicleRaw=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo'),
      gid('ActiveLeadPanel1_m_VehicleInfo'),
      qs('span[id*="VehicleInfo"].leadinfodetails'),
      qs('span[id*="VehicleInfo"]'),
      qs('.leadinfodetails')
    ]);
    const vehicle=vehicleRaw.replace(/\s*\((New|Used|CPO|Pre-Owned|Certified)\)\s*/gi,'').trim();
    const condition=/\(New\)/i.test(vehicleRaw)?'New':/Used|Pre-Owned|CPO|Certified/i.test(vehicleRaw)?'Pre-Owned':'';
    const color=tm([/Color[:\s]+([A-Za-z ]{3,25})(?:\n|Mfr|Stock|VIN|Warning|\s{3})/i]);
    const stockNumRaw = tm([/Stock\s*#?[:\s]*([A-Z]?\d{3,6}[A-Z0-9]*)\b/i]);
    const stockNum = (stockNumRaw && stockNumRaw.length < 12) ? stockNumRaw : '';
    const vin=tm([/\bVIN[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i]);
    const inventoryWarning = /no longer in your active inventory/i.test(TEXT);
    const noSpecificVehicle = !!(vehicle && !stockNum && !vin && !inventoryWarning);
    const isToyotaStore = /toyota/i.test(store);
    const isToyotaVehicle = /toyota/i.test(vehicle || vehicleRaw || '');
    const isInTransit = !!(vin && !stockNum && condition === 'New' && (isToyotaStore || isToyotaVehicle) && !inventoryWarning);
    const leadSource=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1__LeadSourceName'),
      gid('ActiveLeadPanel1__LeadSourceName'),
      qs('span[id*="LeadSourceName"]'),
      labelValue('Source')
    ]);
    var equityData = '';
    var equityAmount = '';
    var equityVehicle = '';
    try {
      var eqEl = document.querySelector('[class*="equity"], [id*="equity"], [class*="Equity"]');
      if(eqEl) equityData = (eqEl.innerText||'').trim().substring(0,150);
      if(!equityData) {
        var eqMatch = TEXT.match(/Equity[^\n]{0,5}([\(\$\d\-,\.]+)[^\n]{0,30}?(20\d\d[^\n]{3,40}?)\s+Calculated/i);
        if(eqMatch) {
          equityAmount  = eqMatch[1].replace(/[()]/g,'').trim();
          equityVehicle = eqMatch[2].trim();
          equityData    = 'Equity: ' + equityAmount + ' on ' + equityVehicle;
        }
      }
      if(!equityData) {
        var eqLine = TEXT.match(/Equity[^\n]{5,120}/i);
        if(eqLine) equityData = eqLine[0].trim().substring(0,120);
      }
    } catch(e) {}
    var buyingSignals = '';
    try {
      var bsBlurb = document.querySelector('#keyInfo-BuyingSignals-blurb, [id*="BuyingSignals-blurb"]');
      var bsDate  = document.querySelector('#keyInfo-BuyingSignals-date, [id*="BuyingSignals-date"]');
      if(bsBlurb) {
        var bsText = (bsBlurb.innerText||'').trim();
        var bsDateText = bsDate ? (bsDate.innerText||'').trim() : '';
        if(bsText) buyingSignals = bsText + (bsDateText ? ' (as of ' + bsDateText + ')' : '');
      }
      if(!buyingSignals) {
        var bsEl = document.querySelector('[class*="buying-signals-summary"], [class*="buying-signal"], [id*="BuyingSignal"]');
        if(bsEl) buyingSignals = (bsEl.innerText||'').trim().substring(0,200);
      }
      if(!buyingSignals) {
        var bsMatch = TEXT.match(/Buying\s+Signals?[:\s]+([^\n]{10,200})/i);
        if(bsMatch) buyingSignals = bsMatch[1].trim();
      }
    } catch(e) {}
    const leadStatus=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1_m_LeadStatusLabel'),
      gid('ActiveLeadPanel1_m_LeadStatusLabel'),
      labelValue('Status')
    ]);
    const tradeEl=document.getElementById('ActiveLeadPanelWONotesAndHistory1__TradeInfoPanel')||document.getElementById('ActiveLeadPanel1__TradeInfoPanel')||document.querySelector('[id*="TradeInfoPanel"]');
    const tradeRaw=tradeEl?(tradeEl.innerText||tradeEl.textContent||'').trim():'';
    const tradeClean=tradeRaw.replace(/Trade-?in\s*Info/gi,'').trim();
    const hasTrade=tradeClean.length>2&&!tradeClean.includes('(none entered)');
    const tradeDescription=hasTrade?tradeClean.substring(0,200):'';
    const noteEls = Array.from(document.querySelectorAll('.notes-and-history-item')||[]);
    const totalNoteCount = noteEls.length;
    var inventoryWarningFromNotes = false;
    var vehiclePendingSale = false;
    noteEls.slice(0,10).forEach(function(n){
      var t = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var c = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
      if(/general note|vehicle/i.test(t)){
        if(/vehicle.*has been sold|has been sold|vehicle sold|unit.*sold/i.test(c)) inventoryWarningFromNotes = true;
        if(/process of being sold|in the process.*sold|being sold|pending.*sale|sold pending|may be sold|might be sold/i.test(c)) vehiclePendingSale = true;
      }
    });
    var inventoryWarningFinal = inventoryWarning || inventoryWarningFromNotes;
    function sanitize(str) {
      return (str||'')
        .replace(/"/g, '\u201c').replace(/'/g, '\u2019')
        .replace(/\\/g, '/').replace(/[\r\n\t]+/g, ' ')
        .replace(/[^\x20-\x7E\u2018-\u201D]/g, '').trim();
    }
    const transcript = [];
    var transcriptCutoffMs = Date.now() - (180 * 24 * 60 * 60 * 1000);
    noteEls.slice(0,25).forEach(function(item){
      var date    = ((item.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      var title   = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
      var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      var dir     = (item.getAttribute('data-direction')||'').toLowerCase();
      if(/lead log/i.test(title) && /changed from/i.test(content) && content.length < 100) return;
      if(!title && !content) return;
      var who = dir==='inbound' ? 'CUSTOMER' : dir==='outbound' ? 'AGENT' : 'NOTE';
      transcript.push('[' + date + '] [' + who + '] ' + title + '\n  ' + sanitize(content||'(no content)'));
    });
    const history = transcript.join('\n');
    var isAIBuyingSignalSource = /ai buying signal/i.test(leadSource||'');
    var recentHistory = history;
    if(isAIBuyingSignalSource) {
      recentHistory = transcript.filter(function(line){
        var dateMatch = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if(dateMatch) {
          var lineMs = new Date(dateMatch[1]).getTime();
          if(lineMs > 0 && lineMs < transcriptCutoffMs) return false;
        }
        var isMarketingBlast = /reply stop to cancel|reply stop to unsubscribe|0% apr|0\s*%\s*apr|new beginnings|savings event|anniversary sale|red tag|summer sale|spring event|click here to|shop now|view inventory|utm_source|utm_medium|utm_campaign/i.test(line);
        if(isMarketingBlast) return false;
        return true;
      }).join('\n') || '(No recent personal conversation \u2014 this is a re-engagement based on buying signal data only.)';
    }
    const hasOutbound = noteEls.some(function(item){
      var dir = (item.getAttribute('data-direction')||'').toLowerCase();
      var title = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var isRealMessage = /outbound text|outbound phone|email reply|outbound email/i.test(title);
      return dir === 'outbound' && isRealMessage;
    });
    const contactedEl = document.querySelector('[id*="CustomerContacted"]');
    const contactedRaw = contactedEl ? (contactedEl.innerText || '') : '';
    var contactedAgeDays = 0;
    try {
      var wkMatch  = contactedRaw.match(/\(([\d.]+)wk\)/i);
      var dayMatch = contactedRaw.match(/\((\d+)d\)/i);
      var hrMatch  = contactedRaw.match(/\((\d+):(\d+)\)/);
      if (wkMatch)       contactedAgeDays = parseFloat(wkMatch[1]) * 7;
      else if (dayMatch) contactedAgeDays = parseInt(dayMatch[1]);
      else if (hrMatch)  contactedAgeDays = 0.1;
    } catch(e) {}
    var CONTACTED_STALE_DAYS = 14;
    const isContacted = /yes/i.test(contactedRaw) && (contactedAgeDays === 0 || contactedAgeDays < CONTACTED_STALE_DAYS);
    const recentTranscript = transcript.slice(0,5).join(' ').toLowerCase();
    const recentInbound = transcript.filter(function(t){ return t.indexOf('[CUSTOMER]') !== -1; }).slice(0,5).join(' ').toLowerCase();
    const fullScanText = (recentInbound + ' ' + recentTranscript).toLowerCase();
    const hasExitSignal  = /already bought|bought.*something|bought.*elsewhere|purchased.*already|going.*elsewhere|not interested|remove.*from.*list|stop.*contacting|decided to (buy|go with|purchase)|we (bought|purchased|went with|decided on)|went with (another|a different|ford|chevy|toyota|kia|nissan|hyundai|chevrolet|gmc|ram|jeep|dodge|subaru|mazda|volvo|bmw|mercedes|lexus|acura|infiniti|cadillac|lincoln|buick)|bought (it|one|a car|a vehicle|from|at)|found (one|a car|what we)|no longer (interested|looking|in the market)|took (a|the) (deal|offer) (at|from|with)/i.test(fullScanText);
    const hasPauseSignal = !hasExitSignal && /taking a break|no luck|need time|not ready|still looking|need to think|not able to upgrade|not looking to upgrade|too early|just got|only have \d+k|low miles/i.test(fullScanText);
    var isLiveConversation = false;
    var isRecentOutbound = false;
    var recentOutboundContent = '';
    var todayMsLive = Date.now();
    for(var li=0; li<Math.min(3, noteEls.length); li++){
      var lDir = (noteEls[li].getAttribute('data-direction')||'').toLowerCase();
      if(lDir === 'inbound'){
        var lDate = ((noteEls[li].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var lMs = lDate ? new Date(lDate).getTime() : 0;
        if(lMs > 0 && (todayMsLive - lMs) < 8 * 60 * 60 * 1000) {
          isLiveConversation = true;
        }
        break;
      }
    }
    for(var roi=0; roi<Math.min(5, noteEls.length); roi++){
      var roDir = (noteEls[roi].getAttribute('data-direction')||'').toLowerCase();
      var roTitle = ((noteEls[roi].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var isRealOutbound = /outbound text|outbound email|email reply/i.test(roTitle);
      if(roDir === 'outbound' && isRealOutbound){
        var roDate = ((noteEls[roi].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var roMs = roDate ? new Date(roDate).getTime() : 0;
        if(roMs > 0 && (todayMsLive - roMs) < 60 * 60 * 1000){
          isRecentOutbound = true;
          recentOutboundContent = ((noteEls[roi].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim().substring(0,300);
        }
        break;
      }
    }
    var customerSaidNotToday = false;
    var customerScheduleConstraint = '';
    for(var nti=0; nti<Math.min(5, noteEls.length); nti++){
      var ntDir = (noteEls[nti].getAttribute('data-direction')||'').toLowerCase();
      if(ntDir === 'inbound'){
        var ntText = ((noteEls[nti].querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
        if(/not today|can.t today|busy today|can.t make it today|no today|not available today|working today|at work today/i.test(ntText)){
          customerSaidNotToday = true;
        }
        var outOfTownMatch = ntText.match(/out of town until ([^.\n,]{3,25})|back (in town|home|around) (on |by )?([^.\n,]{3,20})|away until ([^.\n,]{3,20})|traveling until ([^.\n,]{3,20})|won.t be (back|available|around) until ([^.\n,]{3,20})/i);
        if(outOfTownMatch){
          var returnDay = (outOfTownMatch[1] || outOfTownMatch[4] || outOfTownMatch[5] || outOfTownMatch[6] || outOfTownMatch[9] || 'later this week').trim();
          customerSaidNotToday = true;
          customerScheduleConstraint = 'OUT_OF_TOWN: Customer is out of town and returns ' + returnDay + '. Do NOT offer any times before their return. Schedule around: ' + returnDay;
        }
        var isShiftWorker = /refinery|plant|shift|hitch|offshore|on.*hitch|off.*hitch|7.*on|7.*off|14.*on|14.*off|rotation|turnaround|12.*hour|night shift|day shift|swing shift|work nights|work days|on call|on the boat|back.*offshore|back.*hitch|come off|days off|off days|my days off|when i.m off/i.test(ntText);
        var hasScheduleBlock = /i work (in the |the )?(morning|afternoon|evening|night|weekend|weekday)|work morning|morning.*work|work.*morning|work (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|busy (morning|afternoon|evening)|tied up.*morning|morning.*tied up/i.test(ntText);
        if(isShiftWorker || hasScheduleBlock){
          var constraintMatch = ntText.match(/.{0,50}(refinery|plant|shift|hitch|offshore|rotation|work|busy|tied up|days off|off days|come off).{0,60}/i);
          customerScheduleConstraint = constraintMatch ? constraintMatch[0].trim() : ntText.substring(0,100);
          if(isShiftWorker) customerScheduleConstraint = 'SHIFT_WORKER: ' + customerScheduleConstraint;
        }
        break;
      }
    }
    var convState = 'first-touch';
    if(totalNoteCount > 0){
      var hasNegTag = noteEls.slice(0,10).some(function(item){ return /negative|pricing/i.test(item.innerHTML||''); });
      if(hasExitSignal)        convState = 'exit';
      else if(hasPauseSignal)  convState = 'pause';
      else if(hasNegTag)       convState = 'negative-reply';
      else if(totalNoteCount > 2) convState = 'active-follow-up';
      else                     convState = 'first-follow-up';
    }
    var conversationBrief = '';
    if(convState !== 'first-touch'){
      var stateLabel = {
        'exit':             'EXIT SIGNAL: customer purchased elsewhere or is not interested. Write a gracious close only.',
        'pause':            'PAUSE SIGNAL: customer needs more time. Empathetic check-in only. No appointment pressure.',
        'negative-reply':   'NEGATIVE/PRICING REPLY: customer expressed concern. Address it directly in opening.',
        'active-follow-up': 'FOLLOW-UP: read the full transcript and write a response that directly continues THIS conversation.',
        'first-follow-up':  'FOLLOW-UP: first outreach was made. Read the transcript and write a relevant continuation.'
      }[convState] || 'FOLLOW-UP';
      var keySignal = '';
      var inboundMsgs = [];
      for(var ki=0; ki<Math.min(10, noteEls.length); ki++){
        var kDir = (noteEls[ki].getAttribute('data-direction')||'').toLowerCase();
        if(kDir === 'inbound'){
          var kText = ((noteEls[ki].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
          if(kText && kText.length > 3) inboundMsgs.push(kText);
        }
      }
      if(inboundMsgs.length > 0){
        var mostRecentInbound = inboundMsgs[0].trim();
        var isStaleReply = mostRecentInbound.length <= 2;
        var keySignalSuppressed = false;
        for(var ksi=0; ksi<Math.min(10, noteEls.length); ksi++){
          var ksDir = (noteEls[ksi].getAttribute('data-direction')||'').toLowerCase();
          if(ksDir === 'inbound'){
            var ksDate = ((noteEls[ksi].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
            var ksMs = ksDate ? new Date(ksDate).getTime() : 0;
            var ksAge = ksMs > 0 ? (Date.now() - ksMs) : 0;
            if(ksAge > 7 * 24 * 60 * 60 * 1000) keySignalSuppressed = true;
            break;
          }
        }
        if(!isStaleReply && !keySignalSuppressed){
          keySignal = '\nMOST RECENT CUSTOMER MESSAGE: "' + mostRecentInbound.substring(0,200) + '"'
            + '\nCRITICAL: Your response MUST directly address or acknowledge what the customer said above. '
            + 'Open with a reaction to their words, not a generic greeting.';
        }
      }
      var customerConcerns = [];
      var cutoffMs = Date.now() - (180 * 24 * 60 * 60 * 1000);
      var recentTranscriptLines = transcript.filter(function(line){
        var dateMatch = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4}[^\]]*)\]/);
        if(!dateMatch) return true;
        var lineMs = new Date(dateMatch[1]).getTime();
        return lineMs > 0 ? lineMs >= cutoffMs : true;
      });
      var allTranscriptText = recentTranscriptLines.join(' ');
      if(/too (much|high|expensive)|can.t afford|out of (my |our )?budget|payment.*too|over.*budget|price.*concern|what.s the (price|payment|cost)|how much (is|would)|monthly payment|out the door/i.test(allTranscriptText)){
        customerConcerns.push('PRICE/PAYMENT CONCERN: Customer raised price or payment as an issue. Open by addressing this directly \u2014 not by pitching features.');
      }
      if(/(wife|husband|spouse|partner)|run it by|talk (to|with) (my|the)|need to discuss|bring (him|her|them)/i.test(allTranscriptText)){
        customerConcerns.push('SPOUSE/PARTNER INVOLVED: Customer mentioned needing to involve their spouse or partner. Invite both in or offer to answer questions they might have for their partner.');
      }
      if(/not ready|not right now|give me (a few|some) (days|weeks|time)|check back|hold off|wait (a|until|till)|saving up|few months|next month|after (the|my)/i.test(allTranscriptText)){
        customerConcerns.push('TIMING HESITATION: Customer indicated they are not ready yet. Acknowledge the timing, keep the door open, and give ONE specific reason to act now \u2014 not a pressure tactic.');
      }
      var colorMatch = allTranscriptText.match(/(white|black|silver|gray|grey|blue|red|green|brown|beige|pearl|sonic gray|platinum|lunar silver)/i);
      var trimMatch = allTranscriptText.match(/(ex-?l|sport|touring|lx|ex|elite|awd|fwd|4wd|hybrid|plug-?in)/i);
      if(colorMatch) customerConcerns.push('COLOR PREFERENCE: Customer mentioned ' + colorMatch[0] + '. Match this in your message or acknowledge availability honestly.');
      if(trimMatch) customerConcerns.push('TRIM/CONFIG PREFERENCE: Customer referenced ' + trimMatch[0] + '. Reference this specifically \u2014 do not pitch a different trim without reason.');
      if(/trade.?(in|value|worth|get|offer)|what.*get for|how much.*trade|payoff|owe on/i.test(allTranscriptText)){
        customerConcerns.push('TRADE-IN CONCERN: Customer mentioned their trade. Use it as the hook \u2014 lead with the trade value conversation, not the vehicle pitch.');
      }
      if(/credit|financing|pre.?approv|interest rate|down payment|how much down/i.test(allTranscriptText)){
        customerConcerns.push('FINANCING CONCERN: Customer raised credit or financing. Acknowledge that the visit is the easiest way to get real numbers \u2014 keep it low pressure.');
      }
      if(/don.t have (good|great|perfect|the best)? credit|bad credit|no credit|poor credit|credit (is|isn.t|aint)|low credit score|been denied|got denied|bankruptcy|repo|repossession|it is what it is.*credit/i.test(allTranscriptText)){
        customerConcerns.push('CREDIT CHALLENGE DISCLOSED: Customer explicitly stated they have credit difficulties. Handle with empathy \u2014 NEVER say "no problem" or "we work with all credit" (sounds dismissive). Say: "We work through situations like this every day \u2014 let us look at the options together."');
      }
      if(/co.?sign|cosign|co.?buyer|adding.*someone|need.*someone.*on.*loan|second.*person.*sign/i.test(allTranscriptText)){
        customerConcerns.push('CO-SIGNER NEEDED: Customer mentioned needing a co-signer or co-buyer. Both people must be present at signing. Invite both in together.');
      }
      var customerCommitments = [];
      var recentInboundText = inboundMsgs.slice(0,3).join(' ').toLowerCase();
      var dayCommit = recentInboundText.match(/i.ll (come|be there|stop|come in|swing by|head over).{0,30}(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|this week|after work|in the morning|in the afternoon)/i)
        || recentInboundText.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow).{0,20}work(s)? for me/i)
        || recentInboundText.match(/i can (make it|come in|be there).{0,30}/i);
      if(dayCommit) customerCommitments.push('CUSTOMER COMMITTED: Customer said they would come in \u2014 "' + dayCommit[0].trim().substring(0,80) + '". Hold them to it. Reference this commitment directly.');
      var waitingOn = recentInboundText.match(/send (me |over )?(the )?(price|numbers|info|details|photos|link|payment|payoff|trade)/i)
        || recentInboundText.match(/let me know (the |what |if ).{0,40}/i)
        || recentInboundText.match(/what (is|are|would) (the |my )?(price|payment|trade|payoff|interest rate|down)/i)
        || recentInboundText.match(/do you have (it in|one in|any in).{0,30}/i);
      if(waitingOn) customerCommitments.push('OPEN QUESTION FROM CUSTOMER: Customer asked \u2014 "' + waitingOn[0].trim().substring(0,80) + '". ANSWER THIS FIRST before asking for an appointment.');
      var pendingDecision = recentInboundText.match(/i.ll (think about it|check|talk to|ask|decide|let you know|get back to you).{0,40}/i)
        || recentInboundText.match(/need to (check|talk|ask|think|discuss).{0,40}/i);
      if(pendingDecision) customerCommitments.push('PENDING DECISION: Customer said \u2014 "' + pendingDecision[0].trim().substring(0,80) + '". Acknowledge where they left off.');
      var commitmentBlock = customerCommitments.length > 0
        ? '\n\u26a1 CUSTOMER COMMITMENTS / OPEN ITEMS \u2014 address these FIRST:\n' + customerCommitments.join('\n')
        : '';
      var concernBlock = customerConcerns.length > 0
        ? '\nIDENTIFIED CUSTOMER CONCERNS \u2014 lead with these, do not bury them:\n' + customerConcerns.join('\n')
        : '';
      conversationBrief = stateLabel + '\n'
        + 'Total CRM entries: ' + totalNoteCount + '\n'
        + keySignal + '\n'
        + commitmentBlock + '\n'
        + concernBlock + '\n'
        + 'CONVERSATION TRANSCRIPT (newest first):\n---\n'
        + (isAIBuyingSignalSource ? recentHistory : history) + '\n---\n'
        + 'Read every entry. Your message must reflect this specific conversation - not a generic follow-up. '
        + 'What did the customer say? What was promised? What is still open? Lead with that.';
    }
    let lastOutboundMsg = '';
    for(var ni=0;ni<noteEls.length;ni++){
      if((noteEls[ni].getAttribute('data-direction')||'').toLowerCase()==='outbound'){
        lastOutboundMsg=((noteEls[ni].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim().substring(0,300);
        break;
      }
    }
    if(!lastOutboundMsg){ var om=TEXT.match(/(?:Sent by:[^\n]*\n)([^\n]{20,300})/); if(om) lastOutboundMsg=om[1].trim(); }
    let lastInboundMsg = '';
    for(var ii=0;ii<noteEls.length;ii++){
      if((noteEls[ii].getAttribute('data-direction')||'').toLowerCase()==='inbound'){
        lastInboundMsg=((noteEls[ii].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim().substring(0,200);
        break;
      }
    }
    if(!lastInboundMsg){ var im=TEXT.match(/(?:Text Message Reply Received|Inbound Text|Customer replied)[:\s]*([^\n]{10,200})/i); if(im) lastInboundMsg=im[1].trim(); }
    var recentShowroomVisit = false;
    var showroomDetails = '';
    var showroomVisitToday = false;
    var now2 = Date.now();
    for(var si=0;si<noteEls.length;si++){
      var sTitle = ((noteEls[si].querySelector('.legacy-notes-and-history-title')||{}).innerText||'');
      if(/showroom\s*visit/i.test(sTitle)){
        var sDate = ((noteEls[si].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var sDateMs = sDate ? new Date(sDate).getTime() : 0;
        var ageMs = sDateMs > 0 ? (now2 - sDateMs) : Infinity;
        var sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        var oneDayMs = 24 * 60 * 60 * 1000;
        if(ageMs < sevenDaysMs) {
          recentShowroomVisit = true;
          showroomVisitToday = (ageMs < oneDayMs);
          showroomDetails = ((noteEls[si].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim().substring(0,300);
          break;
        }
      }
    }
    const processEl2 = document.querySelector('select[id*="Process"], [id*="ProcessLabel"]');
    const processText = processEl2 ? (processEl2.innerText || processEl2.value || '') : '';
    var isWalkInSource = /walk.?in|drive.?by|walkin|showroom inquiry/i.test((leadSource||'').toLowerCase());
    const isShowroomFollowUp = recentShowroomVisit || isWalkInSource || (/showroom\s*visit\s*follow\s*up/i.test(processText) && recentShowroomVisit);
    const apptStatusEl = document.querySelector('select[id*="Status"]');
    const statusDropdownVal = apptStatusEl ? (apptStatusEl.value || apptStatusEl.innerText || '') : '';
    const statusLabelEl2 = document.querySelector('[id*="LeadStatusLabel"]');
    const statusLabelVal = statusLabelEl2 ? (statusLabelEl2.innerText || '') : '';
    const currentStatus = (statusDropdownVal + ' ' + statusLabelVal).toLowerCase();
    var hasApptSet = /appointment made|appt made|appointment set/i.test(currentStatus);
    var apptDetails = '';
    var hasMissedAppt = false;
    if(!hasApptSet) {
      var todayMsBP = Date.now();
      var hasApptBoardingPass = noteEls.slice(0,10).some(function(n){
        var title = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'');
        var content = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var dateStr = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var noteMs = dateStr ? new Date(dateStr).getTime() : 0;
        var noteAge = noteMs > 0 ? (todayMsBP - noteMs) : Infinity;
        var isRecent = noteAge < 2 * 24 * 60 * 60 * 1000;
        return isRecent && /email auto response/i.test(title) && /boarding pass|appointment boarding/i.test(content);
      });
      if(hasApptBoardingPass) hasApptSet = true;
    }
    if(!hasApptSet) {
      var todayMsRem = Date.now();
      noteEls.slice(0,8).forEach(function(n){
        if(hasApptSet) return;
        var dir = (n.getAttribute('data-direction')||'').toLowerCase();
        var title = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var content = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var dateStrRem = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var noteMsRem = dateStrRem ? new Date(dateStrRem).getTime() : 0;
        var noteAgeRem = noteMsRem > 0 ? (todayMsRem - noteMsRem) : Infinity;
        var isRecentRem = noteAgeRem < 2 * 24 * 60 * 60 * 1000;
        var isAgentOutbound = dir === 'outbound' && !/lead received|system|auto response/i.test(title);
        if(isAgentOutbound && isRecentRem && /reminder of our appointment|remind you of the appointment|appointment you had set|your appointment.*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)|quick reminder.*appointment/i.test(content)){
          hasApptSet = true;
          apptDetails = content.trim().substring(0,250);
        }
      });
    }
    var todayMs2 = Date.now();
    var recentOutbound3 = Array.from(noteEls).slice(0,5).filter(function(n){
      var dir = (n.getAttribute('data-direction')||'').toLowerCase();
      var dateStr = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      var noteMs2 = dateStr ? new Date(dateStr).getTime() : 0;
      var age2 = noteMs2 > 0 ? (todayMs2 - noteMs2) : Infinity;
      return dir === 'outbound' && age2 < 2 * 24 * 60 * 60 * 1000;
    });
    var recentOutbound3Text = recentOutbound3.map(function(n){
      return ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
    }).join(' ');
    if(/couldn.t make it|missed.*appointment|no.show|wasn.t able to make|sorry you couldn|sorry.*miss/i.test(recentOutbound3Text)){
      hasMissedAppt = true;
    }
    var missedApptTiming2 = 'recently';
    try {
      var centralNow2 = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      var todayDateOnly = new Date(centralNow2.getFullYear(), centralNow2.getMonth(), centralNow2.getDate()).getTime();
      for(var msi=0; msi<Math.min(15, noteEls.length); msi++){
        var msDir = (noteEls[msi].getAttribute('data-direction')||'').toLowerCase();
        var msContent = ((noteEls[msi].querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var msDateStr = ((noteEls[msi].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var msNoteMs = msDateStr ? new Date(msDateStr).getTime() : 0;
        if(msDir === 'outbound' && /reminder.*appointment|appointment.*at\s+\d|your appt/i.test(msContent)){
          if(msNoteMs > 0){
            var noteDateOnly = new Date(new Date(msNoteMs).toLocaleDateString('en-US', {timeZone:'America/Chicago'})).getTime();
            var diffMs = todayDateOnly - noteDateOnly;
            var diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            if(diffDays === 0) missedApptTiming2 = 'today';
            else if(diffDays === 1) missedApptTiming2 = 'yesterday';
            else if(diffDays > 1) missedApptTiming2 = diffDays + ' days ago';
            break;
          }
        }
      }
    } catch(e) {}
    if(!hasMissedAppt) {
      var todayMs = Date.now();
      for(var ai=0; ai<Math.min(5, noteEls.length); ai++){
        var aDir = (noteEls[ai].getAttribute('data-direction')||'').toLowerCase();
        var aText = ((noteEls[ai].querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var aDate = ((noteEls[ai].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var hasTime = /\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(aText);
        var hasConfirmedLang = /confirmed for|we have you scheduled|see you at|your appointment is|appointment.*confirmed|we.ll see you|you.re all set|we.re set for|scheduled.*at|set.*for\s+\d/i.test(aText);
        var hasConfirmRequestLang = /text C to confirm|reply C|reply YES|please confirm/i.test(aText);
        if(aDir === 'outbound' && hasTime && (hasConfirmedLang || hasConfirmRequestLang)){
          var noteMs = aDate ? new Date(aDate).getTime() : 0;
          var noteAge = noteMs > 0 ? (todayMs - noteMs) : Infinity;
          if(noteAge < 2 * 24 * 60 * 60 * 1000) {
            hasApptSet = true;
            apptDetails = aText.trim().substring(0,250);
          }
          break;
        }
      }
      if(!hasApptSet) {
        for(var ci=0; ci<Math.min(5, noteEls.length); ci++){
          var cDir = (noteEls[ci].getAttribute('data-direction')||'').toLowerCase();
          var cText = ((noteEls[ci].querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
          var cDate = ((noteEls[ci].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
          var cMs = cDate ? new Date(cDate).getTime() : 0;
          var cAge = cMs > 0 ? (todayMs - cMs) : Infinity;
          if(cDir === 'inbound' && cAge < 2 * 24 * 60 * 60 * 1000){
            if(/\b(sounds good|i.ll be there|see you then|see you at|confirmed|works for me|i.ll come in|we.ll be there|that works)\b/i.test(cText)){
              hasApptSet = true;
              break;
            }
          }
        }
      }
    }
    if(hasApptSet) hasMissedAppt = false;
    var isSoldDelivered = false;
    var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    var soldDateMatch = TEXT.match(/Sold[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if(soldDateMatch) {
      var soldMs = new Date(soldDateMatch[1]).getTime();
      var soldAge = soldMs > 0 ? (Date.now() - soldMs) : Infinity;
      if(soldAge < thirtyDaysMs) isSoldDelivered = true;
    }
    if(!isSoldDelivered && /\bsold\b|\bdelivered\b/i.test(currentStatus)) isSoldDelivered = true;
    if(!isSoldDelivered && /Sale Info[\s\S]{0,300}Delivered/i.test(TEXT.substring(0,3000))) {
      var createdMatch = TEXT.match(/Created[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if(createdMatch) {
        var createdMs2 = new Date(createdMatch[1]).getTime();
        var createdAge2 = createdMs2 > 0 ? (Date.now() - createdMs2) : Infinity;
        if(createdAge2 < thirtyDaysMs) isSoldDelivered = true;
      }
    }
    var pastVisitNotes = [];
    var hasConfirmedVisit = false;
    for(var pni=0; pni<Math.min(25, noteEls.length); pni++){
      var pnTitle = ((noteEls[pni].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
      var pnContent = ((noteEls[pni].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      var pnDate = ((noteEls[pni].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      if(/showroom\s*visit/i.test(pnTitle) && pnContent){
        pastVisitNotes.push('PAST SHOWROOM VISIT (' + pnDate + '): ' + pnContent.substring(0,300));
        hasConfirmedVisit = true;
      } else if(/general\s*note/i.test(pnTitle) && pnContent){
        var hasVisitLanguage = /test.?drove?|came in|stopped in|walked|visited|showroom|in.person|met with|showed (him|her|them)|demo|we showed|customer (came|was here|visited)/i.test(pnContent);
        if(hasVisitLanguage){
          pastVisitNotes.push('DEALER NOTE (' + pnDate + '): ' + pnContent.substring(0,300));
          hasConfirmedVisit = true;
        }
      }
    }
    return {
      isLeadFrame,autoLeadId,dealerId,customerId,
      store,name,email,phone,agent,salesRep,manager,
      vehicle,vehicleRaw,color,condition,stockNum,vin,inventoryWarning:inventoryWarningFinal,vehiclePendingSale,noSpecificVehicle,ownedVehicle,ampEmailSubject,ownedMileage,lastServiceDate,leadAgeDays,equityData,equityAmount,equityVehicle,
      leadSource,leadStatus: currentStatus || leadStatus,hasTrade,tradeDescription,buyingSignals,
      history, totalNoteCount, hasOutbound, isContacted, contactedAgeDays, lastOutboundMsg, lastInboundMsg,
      hasPauseSignal, hasExitSignal, convState, conversationBrief, customerSaidNotToday, customerScheduleConstraint, isLiveConversation, isRecentOutbound, recentOutboundContent,
      isInTransit, hasApptSet, apptDetails, isSoldDelivered, hasMissedAppt, missedApptTiming: missedApptTiming2,
      isShowroomFollowUp, showroomDetails, showroomVisitToday,
      pastVisitNotes,
      hasConfirmedVisit,
      pageSnippet:TEXT.substring(0,3000),
      scrapedAt:Date.now()
    };
  } // end inlineScraper
  // Inject into all frames
  chrome.scripting.executeScript(
    { target: { tabId: tab.id, allFrames: true }, func: function() {
      var maxWait = 3000, interval = 250, elapsed = 0;
      function wait(resolve) {
        var noteCount = document.querySelectorAll('.notes-and-history-item').length;
        var hasContent = !!(document.querySelector('span[id*="BDAgentLabel"]') ||
          document.querySelector('.notes-and-history-item') ||
          document.getElementById('ContentPlaceHolder1_m_CustomerAndTaskInfo_m_CustomerInfo__CustomerName'));
        if (noteCount > 0 || elapsed >= maxWait) { resolve(); }
        else { elapsed += interval; setTimeout(function(){ wait(resolve); }, interval); }
      }
      return new Promise(function(resolve) { wait(resolve); });
    }},
    function() {
      chrome.scripting.executeScript(
        { target: { tabId: tab.id, allFrames: true }, func: inlineScraper },
        function(results) {
          if (chrome.runtime.lastError) {
            statusEl.className = 'crm-status error';
            statusEl.textContent = 'Inject error: ' + chrome.runtime.lastError.message;
            return;
          }
          if (!results || !results.length) {
            statusEl.className = 'crm-status error';
            statusEl.textContent = 'No frame data \u2014 reload the lead and try again.';
            return;
          }
          console.log('[Lead Pro] Frame results:', results.map(function(r){
            return { frame: r.frameId, notes: r.result && r.result.totalNoteCount, isLead: r.result && r.result.isLeadFrame, store: r.result && r.result.store, dealerId: r.result && r.result.dealerId, brief: r.result && r.result.conversationBrief ? 'YES' : 'no' };
          }));
          const sorted = results.slice().sort(function(a,b){
            const aNotes = (a.result && a.result.totalNoteCount) || 0;
            const bNotes = (b.result && b.result.totalNoteCount) || 0;
            const aLead  = (a.result && a.result.isLeadFrame) ? 1 : 0;
            const bLead  = (b.result && b.result.isLeadFrame) ? 1 : 0;
            if (bNotes !== aNotes) return bNotes - aNotes;
            return bLead - aLead;
          });
          const m = {};
          const historyFields = new Set(['totalNoteCount','history','conversationBrief','convState','hasExitSignal','hasPauseSignal','lastInboundMsg','lastOutboundMsg','isContacted','hasOutbound']);
          let bestStore = '';
          for (const frame of sorted) {
            const d = frame.result; if (!d) continue;
            if (d.store && (!bestStore || d.store.length > bestStore.length)) bestStore = d.store;
            for (const k of Object.keys(d)) {
              if (['hasTrade','inventoryWarning','isLeadFrame','hasExitSignal','hasPauseSignal','hasOutbound','isContacted','isInTransit','hasApptSet','isShowroomFollowUp'].includes(k)) {
                if(d[k]) m[k]=true;
              } else if (k === 'store') {
                // handled via bestStore
              } else if (historyFields.has(k)) {
                if (!m[k] && d[k]) m[k] = d[k];
              } else if (k==='pageSnippet') {
                m[k]=(m[k]||'')+' '+(d[k]||'');
              } else if (!m[k] && d[k]) {
                m[k]=d[k];
              }
            }
          }
          m.store = bestStore;
          lastScrapedData = m;
          const filled = populateFromData(m);
          console.log('[Lead Pro] Merged store:', m.store, '| dealerId:', m.dealerId);
          if (filled > 0 || selectedStore) {
            statusEl.className = 'crm-status found';
            const parts = [];
            if (filled > 0)    parts.push(filled + ' field' + (filled>1?'s':'') + ' filled');
            if (selectedStore) parts.push('store detected');
            if ((m.totalNoteCount||0) > 0) parts.push(m.totalNoteCount + ' notes');
            statusEl.textContent = '\u2713 ' + parts.join(' \u00b7 ');
            dot.classList.add('active');
          } else {
            statusEl.className = 'crm-status error';
            statusEl.textContent = 'Nothing found \u2014 fill fields manually.';
          }
        }
      );
    }
  );
} // end tryExecuteScript
// ── classifyScenario ─────────────────────────────────────────────
function classifyScenario(data) {
  const ls  = (data.leadSource || '').toLowerCase();
  const ctx = (data.context    || '').toLowerCase();
  const s   = {};
  s.isApptConfirmation = ctx.includes('appointment already set');
  s.isShowroomFollowUp = ctx.includes('showroom stage');
  s.isSoldDelivered    = ctx.includes('sold/delivered');
  s.isMissedAppt       = ctx.includes('missed appointment');
  s.isExitSignal       = ctx.includes('exit signal');
  s.isPauseSignal      = ctx.includes('pause signal');
  s.isFollowUp         = ctx.includes('follow-up') || ctx.includes('conversation transcript') || ctx.includes('conversation brief') || !!data.convState && data.convState !== 'first-touch';
  s.hasUnresolvedIssue = ctx.includes('unresolved issue');
  s.unresolvedText     = (ctx.match(/unresolved issue:\s*([^\n.]+)/i)||[])[1] || '';
  s.actionNeeded       = (ctx.match(/required message action:\s*([^\n.]+)/i)||[])[1] || '';
  s.customerLastSaid   = (ctx.match(/customer last said:\s*\[([^\]]+)\]/i)||[])[1] || '';
  const hasRealOutbound = !!(data.hasOutbound);
  console.log('[Lead Pro] classifyScenario \u2014 ls:', (data.leadSource||''), '| isFollowUp:', s.isFollowUp, '| hasRealOutbound:', hasRealOutbound, '| convState:', data.convState);
  const isGubagooChat = /chat/i.test(ls);
  const isClickAndGoSource = !isGubagooChat && /gubagoo|click.*go|click\s*&\s*go|\bdrs\b|dynamic.*credit|digital retail|virtual retail|hds dr|finance app/i.test(ls);
  var isLive = !!(data.isLiveConversation);
  var isFreshContact = data.contactedAgeDays > 0 && data.contactedAgeDays < 1;
  var isStaleClickAndGo = isClickAndGoSource && hasRealOutbound && ((data.contactedAgeDays >= 14) || isLive || isFreshContact);
  s.isClickAndGo   = isClickAndGoSource && !isStaleClickAndGo && !s.isExitSignal;
  s.isTradePending = (!s.isFollowUp || !hasRealOutbound) && /tradepending/i.test(ls);
  s.isLoyalty      = /afs|kmf|luv|off loan|maturity|loyalty/i.test(ls);
  s.isCarGurusDD   = (!s.isFollowUp || !hasRealOutbound) && /cargurus.*digital deal|digital deal.*cargurus/i.test(ls);
  s.isKBB          = (!s.isFollowUp || !hasRealOutbound) && /kbb|kelley blue/i.test(ls);
  s.isCapitalOne   = (!s.isFollowUp || !hasRealOutbound) && /capital one|cap one/i.test(ls);
  s.isTrueCar      = (!s.isFollowUp || !hasRealOutbound) && /truecar/i.test(ls);
  s.isAMP          = (!s.isFollowUp || !hasRealOutbound) && /\bamp\b/i.test(ls);
  const isAISignalLead = !s.isFollowUp && /ai buying signal/i.test(ls);
  s.isAIBuyingSignalReturner = isAISignalLead && /previously sold customer/i.test(ls) && !/not previously sold/i.test(ls);
  s.isAIBuyingSignalNew      = isAISignalLead && !s.isAIBuyingSignalReturner;
  s.buyingSignalData = (data.context||'').match(/buying signal data[:\s]+([^\n]+)/i)?.[1]?.trim() || '';
  s.isAutoTrader   = (!s.isFollowUp || !hasRealOutbound) && /autotrader/i.test(ls);
  s.isCarscom      = (!s.isFollowUp || !hasRealOutbound) && /cars\.com|cars com/i.test(ls);
  s.isEdmunds      = (!s.isFollowUp || !hasRealOutbound) && /edmunds/i.test(ls);
  s.isOEMLead      = (!s.isFollowUp || !hasRealOutbound) && /toyota\.com|honda\.com|kia\.com|hyundai\.com|oem|manufacturer/i.test(ls);
  s.isPhoneUp      = (!s.isFollowUp || !hasRealOutbound) && /phone.*up|phone-up|phoneup|inbound.*call|call.*center/i.test(ls);
  s.isCarGurus     = (!s.isFollowUp || !hasRealOutbound) && !s.isCarGurusDD && /cargurus/i.test(ls);
  s.isFacebook     = (!s.isFollowUp || !hasRealOutbound) && /facebook|fb marketplace|fb lead|meta lead/i.test(ls);
  s.isDealerWebsite = (!s.isFollowUp || !hasRealOutbound) && /dealer\.com|dealersocket|dealerfire|dealer website|website lead|internet lead|hds dr lead|dealertrack.*lead/i.test(ls) && !s.isClickAndGo;
  s.isChatLead     = (!s.isFollowUp || !hasRealOutbound) && /chat/i.test(ls) && !s.isClickAndGo;
  s.isCarFax       = (!s.isFollowUp || !hasRealOutbound) && /carfax|iseecars|autobytel|car.*genie|modalyst/i.test(ls);
  s.isRepeatCustomer = (!s.isFollowUp || !hasRealOutbound) && /repeat|returning|prior customer|dms sales|previous (customer|buyer|owner)|sold customer/i.test(ls);
  s.isThirdPartyOEM = (!s.isFollowUp || !hasRealOutbound) && /third party|3rd party|kia digital|honda digital|toyota digital|hyundai digital|oem partner|audi partner|manufacturer partner/i.test(ls) && !s.isOEMLead;
  s.isGoogleAd     = (!s.isFollowUp || !hasRealOutbound) && /google.*ad|google.*digital|paid search|sem lead|ppc/i.test(ls);
  s.isReferral     = (!s.isFollowUp || !hasRealOutbound) && /referral|referred by|word of mouth/i.test(ls);
  s.isStandard     = !s.isClickAndGo && !s.isTradePending && !s.isCarGurusDD && !s.isCarGurus && !s.isKBB && !s.isCapitalOne && !s.isTrueCar && !s.isAMP && !s.isAutoTrader && !s.isCarscom && !s.isEdmunds && !s.isOEMLead && !s.isPhoneUp && !s.isAIBuyingSignalNew && !s.isAIBuyingSignalReturner && !s.isFacebook && !s.isDealerWebsite && !s.isChatLead && !s.isCarFax && !s.isRepeatCustomer && !s.isThirdPartyOEM && !s.isGoogleAd && !s.isReferral;
  s.vehicleSold        = ctx.includes('vehicle status: sold');
  s.vehicleInTransit   = ctx.includes('vehicle status: in transit');
  s.isLoyaltyVehicle   = ctx.includes('loyalty vehicle');
  s.noSpecificVehicle  = ctx.includes('no specific unit');
  s.noCustomerPhone    = ctx.includes('no customer phone number');
  s.notToday           = ctx.includes('not today');
  s.isStalled          = ctx.includes('stalled lead');
  const currentYear = new Date().getFullYear();
  const vyMatch = (data.vehicle || '').match(/^(\d{4})/);
  s.vehicleYear    = vyMatch ? parseInt(vyMatch[1]) : 0;
  s.staleModelYear = s.vehicleYear > 0 && s.vehicleYear < currentYear;
  s.isAudi     = /audi/i.test(data.store);
  s.isKia      = /kia/i.test(data.store);
  s.isHonda    = /honda/i.test(data.store);
  s.isToyota   = /toyota/i.test(data.store);
  s.storeGroup = s.isAudi ? 'Audi Lafayette' : (data.store || 'Community Auto Group');
  s.persona    = s.isAudi ? 'Audi Concierge' : 'Internet Sales Coordinator';
  s.duration   = s.isAudi ? '45 minutes' : '30\u201345 minutes';
  s.salesRep   = data.salesRep || '';
  return s;
}
// ── Phone directory ───────────────────────────────────────────────
const PHONE_DIR = {
  'noelia diaz':      { audi:'337-247-9118', honda_laf:'337-321-5656', baytown:'281-837-3683' },
  'anahi lepe':       { audi:'337-247-7866', honda_laf:'337-205-8409', baytown:'281-837-3629' },
  'berenice torres':  { audi:'337-247-7877', honda_laf:'337-205-8311', baytown:'281-837-3377' },
  'carly osuna':      { audi:'337-247-9003', honda_laf:'337-247-9081', baytown:'281-837-3626' },
  'danay rodriguez':  { audi:'337-205-5635', honda_laf:'337-247-9083', baytown:'281-837-3624' },
  'kaylee guzman':    { audi:'337-557-8731', honda_laf:'337-889-2654', baytown:'281-837-3381' },
  'kristen willis':   { audi:'337-247-9205', honda_laf:'337-446-2432', baytown:'281-837-3380' },
  'patricia galvan':  { audi:'337-247-9237', honda_laf:'337-205-8323', baytown:'281-837-3384' },
  'rotaxlyn hudson':  { audi:'337-247-9266', honda_laf:'337-205-8301', baytown:'281-837-3684' },
  'tania gonzalez':   { audi:'337-247-9304', honda_laf:'337-205-8301', baytown:'281-837-3383' },
  'jolette aguilar':  { audi:'337-247-9110', honda_laf:'337-205-8339', baytown:'281-837-3627' },
  'jacqueline ramos': { audi:'337-706-0761', honda_laf:'337-706-0756', baytown:'281-837-3685' },
  'karen alaniz':     { audi:'337-205-5514', honda_laf:'337-247-9033', baytown:'281-837-3682' },
  'melanie martinez': { audi:'337-889-2034', honda_laf:'337-568-0435', baytown:'281-837-3373' },
  'samantha lopez':   { audi:'337-706-0507', honda_laf:'337-541-0253', baytown:'281-837-3375' }
};
function lookupPhone(agentName, store) {
  const key = (agentName || '').toLowerCase().trim();
  const row = PHONE_DIR[key];
  if (!row) return null;
  const s = (store || '').toLowerCase();
  if (s.includes('audi'))     return row.audi;
  if (s.includes('lafayette') || s.includes('lafa')) return row.honda_laf;
  return row.baytown;
}
// ── System Prompt ─────────────────────────────────────────────────
function buildSystemPrompt() {
  return [
    'You are Lead Pro, a BDC response engine for Community Auto Group dealerships.',
    'Respond ONLY with a single valid JSON object. No markdown. No text outside the JSON.',
    'Format: {"sms":"...","email":"...","voicemail":"..."}',
    '',
    'UNIVERSAL RULES:',
    '- SMS: message body + newline + agent first name + newline + phone number. Nothing else in signature.',
    '- Email: Subject line first ("Subject: ..."), then full message, then complete signature stacked on separate lines (Name on line 1, Title on line 2, Store on line 3, Phone on line 4). Never use slashes between signature parts.',
    '- Voicemail: EXACT 3-PART STRUCTURE \u2014 no deviations:',
    '  PART 1 \u2014 INTRO: "Hi [First Name], this is [Agent First Name] from [Store Name]." One sentence. Nothing else.',
    '  PART 2 \u2014 HOOK: ONE sentence only. The single most compelling reason to call back, specific to THIS lead.',
    '  PART 3 \u2014 CALLBACK: "Give me a call back at [number]." Repeat the number once: "That is [number] again." Nothing after the second number. End there.',
    '  TOTAL LENGTH: 60-80 words.',
    '  DO NOT include appointment times in voicemail.',
    '  DO NOT say: "following up" "touching base" "just wanted to" "at your earliest convenience" "please let me know" "I look forward to"',
    '- Never say: "Checking in" "Following up" "Touching base" "Just wanted to reach out" "Let me know" "Stop by anytime" "I look forward to hearing from you" "Hi there" "Carfax" "Gubagoo" "Virtual retailing" "I\'m reaching out" "I wanted to follow up" "Please let me know" "Hope your day is going well" "Hope you\'re having a good" "Hope you\'re having a great" "Just confirming" "That\'s a fantastic choice" "Great choice" "Excited to see your request" "I understand that" "As per our conversation" "We noticed you" "As a valued customer" "As a previous customer" "Let me know which time" "Which time works best" "I thought of you" "I saw you were looking at" "I noticed you were looking at" "I saw you browsing"',
    '- Never fabricate inventory status. Never guarantee approval or rates.',
    '- VEHICLE RULE: ONLY reference the vehicle in the LEAD section. If the LEAD section says "(none specified)", do NOT name any vehicle at all.',
    '- Write all three formats completely. Do not truncate.',
    '- TRADE-IN: When a trade-in is present, mention it in ALL three formats including SMS.',
    '- ANSWER FIRST RULE: If the customer asked a direct question in their last message, you MUST address or acknowledge it BEFORE asking for an appointment.',
    '- APPOINTMENT TIMES: Offer the two times ONCE and close. Never repeat them.',
    '- APPOINTMENT LANGUAGE: Always frame as in-store \u2014 "come in," "stop by," "visit us." Never "discuss" or "talk."',
    '- EMAIL TONE: Warm, conversational, never corporate. Never open with "I hope this email finds you well."',
    '- SMS TONE: Real person texting. Direct, warm, natural.',
    '- VOICEMAIL TONE: Confident, friendly, genuine.',
    '- LANGUAGE: Always write in English unless explicitly instructed otherwise by the agent.',
    'CONVERSATION RULE: When a transcript is provided, the opening MUST be a direct reaction to what the customer said last.',
    'AI BUYING SIGNAL ABSOLUTE RULES \u2014 when the scenario section contains "AI BUYING SIGNAL", these rules are NON-NEGOTIABLE:',
    '  RULE 1: The email subject line MUST NOT contain the word "upgrade".',
    '  RULE 2: The words "newer model", "newer models", "newer [model]", "latest model", "step up", "brand new" are BANNED.',
    '  RULE 3: Do not write "upgrading your [vehicle]". Write "your next [model]" or "your [model] search" instead.',
    '  RULE 4: Do not mention a trade-in unless the LEAD section explicitly lists one.',
    '  RULE 5: Do not reference any sale event, 0% APR, or promotional offer.',
    '  RULE 6: Open with ownership hook: "[First name], still driving the [owned vehicle]? We have some great [model] options available right now."',
    'CRITICAL: Return only the JSON object.'
  ].join('\n');
}
// ── computeAppointmentTimes ───────────────────────────────────────
function computeAppointmentTimes(store) {
  const now    = new Date();
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const dayOfWeek = central.getDay();
  const hour   = central.getHours();
  const minute = central.getMinutes();
  const nowMins = hour * 60 + minute;
  const storeKey = (store || '').toLowerCase();
  let openMins, closeMins, sameDayCutoffMins;
  if (storeKey.includes('audi')) {
    if (dayOfWeek === 0) { openMins = null; }
    else if (dayOfWeek === 6) { openMins = 9*60; closeMins = 18*60; sameDayCutoffMins = 16*60+30; }
    else { openMins = 9*60; closeMins = 19*60; sameDayCutoffMins = 18*60; }
  } else if (storeKey.includes('lafayette') || storeKey.includes('lafa')) {
    if (dayOfWeek === 0) { openMins = null; }
    else { openMins = 9*60; closeMins = 19*60; sameDayCutoffMins = 18*60; }
  } else {
    if (dayOfWeek === 0) { openMins = null; }
    else { openMins = 9*60; closeMins = 20*60; sameDayCutoffMins = 18*60+30; }
  }
  function nextSlot(fromMins) {
    const buffered = fromMins + 120;
    const rem = buffered % 15;
    return rem === 0 ? buffered : buffered + (15 - rem);
  }
  function fmtTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }
  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', timeZone:'America/Chicago' });
  }
  function findSameDayPair(earliestSlot) {
    const slots = [];
    let s = earliestSlot;
    while (s + 45 <= closeMins && s <= sameDayCutoffMins) {
      slots.push(s);
      s += 15;
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[j] - slots[i] >= 45) {
          if (slots[j] - slots[i] >= 90 || j === i + 3) {
            return [slots[i], slots[j]];
          }
        }
      }
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[j] - slots[i] >= 45) return [slots[i], slots[j]];
      }
    }
    return null;
  }
  function nextBusinessDay(fromDate) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + 1);
    const cd = new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    if (cd.getDay() === 0) d.setDate(d.getDate() + 1);
    return d;
  }
  const isClosed = openMins === null;
  const earliestSlot = nextSlot(nowMins);
  const sameDayValid = !isClosed && earliestSlot <= sameDayCutoffMins && earliestSlot + 45 <= closeMins;
  if (sameDayValid) {
    const pair = findSameDayPair(earliestSlot);
    if (pair) {
      const today = fmtDate(central);
      return {
        time1: fmtTime(pair[0]) + ' today',
        time2: fmtTime(pair[1]) + ' today',
        dayLabel: 'today',
        closeTime: fmtTime(closeMins),
        minsUntilClose: closeMins - nowMins,
        note: 'Same-day slots available.'
      };
    }
  }
  const tomorrow = nextBusinessDay(central);
  const tomorrowCentral = new Date(tomorrow.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const tomorrowDay = tomorrowCentral.getDay();
  let nextOpen, nextClose;
  if (storeKey.includes('audi')) {
    nextOpen  = 9*60;
    nextClose = tomorrowDay === 6 ? 18*60 : 19*60;
  } else if (storeKey.includes('lafayette') || storeKey.includes('lafa')) {
    nextOpen = 9*60; nextClose = 19*60;
  } else {
    nextOpen = 9*60; nextClose = 20*60;
  }
  const slot1 = nextOpen + 15;
  const slot2 = nextOpen + 60 + 30;
  const nextDayLabel = fmtDate(tomorrowCentral);
  return {
    time1: fmtTime(slot1),
    time2: fmtTime(slot2) + ' ' + nextDayLabel,
    dayLabel: nextDayLabel,
    closeTime: null,
    minsUntilClose: null,
    note: 'No same-day slots available \u2014 next business day used.'
  };
}
// ── buildUserPrompt ───────────────────────────────────────────────
function buildUserPrompt(data) {
  const s = classifyScenario(data);
  const apptTimes = computeAppointmentTimes(data.store);
  const agentName = (data.agent || '').trim();
  const agentFirst = agentName.split(/\s+/)[0] || agentName;
  const agentPhone = lookupPhone(agentName, data.store) || data.agentPhone || '[agent phone]';
  const customerFirst = (data.customerName || '').trim().split(/\s+/)[0] || (data.customerName || '').trim();
  const vehicle    = (data.vehicle || '').trim();
  const store      = (data.store  || '').trim();
  const leadSource = (data.leadSource || '').trim();
  const ctx        = (data.context || '').trim();

  // ── Scenario block ──────────────────────────────────────────────
  let scenarioBlock = '';
  if (s.isApptConfirmation) {
    scenarioBlock = 'SCENARIO: Appointment already confirmed. Send a warm pre-visit reminder. Do NOT re-ask for appointment times. Confirm the scheduled visit.';
  } else if (s.isSoldDelivered) {
    scenarioBlock = 'SCENARIO: SOLD/DELIVERED. Write a 3-day follow-up. Thank them, confirm satisfaction, give direct contact for any questions. Do not pitch anything.';
  } else if (s.isMissedAppt) {
    const timing = s.missedApptTiming || 'recently';
    scenarioBlock = 'SCENARIO: MISSED APPOINTMENT (' + timing + '). Open by acknowledging the missed visit warmly. Offer to reschedule. Do not guilt-trip. Do not ask why they missed it.';
  } else if (s.isExitSignal) {
    scenarioBlock = 'SCENARIO: EXIT SIGNAL. Customer bought elsewhere or is no longer interested. Write a gracious, zero-pressure close. Wish them well. Leave the door open without any pitch.';
  } else if (s.isPauseSignal) {
    scenarioBlock = 'SCENARIO: PAUSE SIGNAL. Customer needs more time. Empathetic check-in only. No appointment pressure. No pitch. Just staying in touch.';
  } else if (s.isShowroomFollowUp) {
    if (s.showroomVisitToday) {
      scenarioBlock = 'SCENARIO: SHOWROOM FOLLOW-UP \u2014 SAME DAY. Customer visited the showroom today. Write a same-day thank-you. Reference the visit warmly. Offer a clear next step.';
    } else {
      scenarioBlock = 'SCENARIO: SHOWROOM FOLLOW-UP. Customer visited the showroom recently. Reference their visit. Move toward a decision or next step.';
    }
    if (s.showroomDetails) scenarioBlock += '\nShowroom visit details: ' + s.showroomDetails;
    if (s.pastVisitNotes && s.pastVisitNotes.length) scenarioBlock += '\n' + s.pastVisitNotes.join('\n');
  } else if (s.isFollowUp && data.conversationBrief) {
    scenarioBlock = 'SCENARIO: ACTIVE FOLLOW-UP.\n' + data.conversationBrief;
  } else if (s.isLiveConversation) {
    scenarioBlock = 'SCENARIO: LIVE CONVERSATION \u2014 customer messaged recently (within last 8 hours). Respond directly to their most recent message. Keep it conversational and fast.';
  } else if (s.isClickAndGo) {
    scenarioBlock = 'SCENARIO: CLICK & GO / DIGITAL DEAL. Customer completed a digital deal application. They pre-configured a deal online. Reference this effort specifically \u2014 they put time into this. Acknowledge their work and invite them in to finalize.';
  } else if (s.isTradePending) {
    scenarioBlock = 'SCENARIO: TRADE PENDING / KBB ICO. Customer submitted a trade value request. Lead with the trade-in as the hook. Invite them in for the full appraisal.';
  } else if (s.isCarGurusDD) {
    scenarioBlock = 'SCENARIO: CARGURUS DIGITAL DEAL. Customer submitted a deal through CarGurus. They engaged at a high intent level. Reference their deal submission.';
  } else if (s.isKBB) {
    scenarioBlock = 'SCENARIO: KBB / KELLEY BLUE BOOK. Customer requested a trade value from KBB. Lead with the trade-in appraisal offer. Be specific about getting them the full, in-person value.';
  } else if (s.isCapitalOne) {
    scenarioBlock = 'SCENARIO: CAPITAL ONE PRE-APPROVAL. Customer was pre-approved through Capital One and landed on our lot. Reference their approval. Make it easy to use it.';
  } else if (s.isTrueCar) {
    scenarioBlock = 'SCENARIO: TRUECAR CERTIFIED PRICE. Customer received a TrueCar price certificate. Reference the certified price and invite them to come claim it.';
  } else if (s.isAMP) {
    const ampSubject = data.ampEmailSubject || '';
    scenarioBlock = 'SCENARIO: AMP / MARKETING EMAIL RE-ENGAGEMENT. Customer clicked a marketing email and re-engaged.'
      + (ampSubject ? ' The email they responded to had the subject: "' + ampSubject + '".' : '')
      + ' Do NOT reference a specific promotional offer unless one is listed in the LEAD section. Do NOT say 0% APR or any rate unless explicitly listed. Reference their interest and invite them in.';
  } else if (s.isAIBuyingSignalReturner) {
    scenarioBlock = 'SCENARIO: AI BUYING SIGNAL \u2014 PREVIOUSLY SOLD CUSTOMER. Our AI flagged this customer as showing buying signal behavior based on their ownership profile and market activity. They are a past customer. Open with their current vehicle ("still driving the [owned vehicle]?") and invite them to explore their options. DO NOT use the word "upgrade." DO NOT say "newer model." DO NOT reference any promotional offers unless listed.';
    if (s.buyingSignalData) scenarioBlock += '\nBuying signal data: ' + s.buyingSignalData;
  } else if (s.isAIBuyingSignalNew) {
    scenarioBlock = 'SCENARIO: AI BUYING SIGNAL \u2014 NEW PROSPECT. Our AI flagged this customer as showing in-market buying behavior. Reach out as a first touch based on their ownership data. DO NOT use the word "upgrade." DO NOT say "newer model." Be curious and helpful, not salesy.';
    if (s.buyingSignalData) scenarioBlock += '\nBuying signal data: ' + s.buyingSignalData;
  } else if (s.isLoyalty) {
    scenarioBlock = 'SCENARIO: LOYALTY / LEASE END. Customer\'s lease or loan is maturing. Lead with the transition, not a pitch. Be helpful. Make the process feel easy.';
  } else if (s.isAutoTrader) {
    scenarioBlock = 'SCENARIO: AUTOTRADER LEAD. Customer found the vehicle on AutoTrader. Reference the listing and confirm availability.';
  } else if (s.isCarscom) {
    scenarioBlock = 'SCENARIO: CARS.COM LEAD. Customer inquired via Cars.com. Reference the vehicle and invite them in for a personalized experience.';
  } else if (s.isEdmunds) {
    scenarioBlock = 'SCENARIO: EDMUNDS LEAD. Customer submitted through Edmunds. Reference their inquiry and confirm the vehicle details.';
  } else if (s.isOEMLead) {
    scenarioBlock = 'SCENARIO: OEM / MANUFACTURER LEAD. Customer came directly from the manufacturer website. They may have used the build-and-price tool. Reference the vehicle they configured.';
  } else if (s.isPhoneUp) {
    scenarioBlock = 'SCENARIO: PHONE-UP. Customer called in. Write a follow-up message after the phone call.';
  } else if (s.isFacebook) {
    scenarioBlock = 'SCENARIO: FACEBOOK / META LEAD. Customer submitted through Facebook or Instagram. Keep the tone casual and conversational.';
  } else if (s.isDealerWebsite) {
    scenarioBlock = 'SCENARIO: DEALER WEBSITE LEAD. Customer submitted an inquiry directly from the dealership website. They expressed interest in the vehicle listed.';
  } else if (s.isChatLead) {
    scenarioBlock = 'SCENARIO: CHAT LEAD. Customer initiated a chat on the website. Reference their chat inquiry.';
  } else if (s.isCarFax) {
    scenarioBlock = 'SCENARIO: CARFAX / THIRD-PARTY RESEARCH LEAD. Customer was researching the vehicle on a third-party site. They are actively shopping.';
  } else if (s.isRepeatCustomer) {
    scenarioBlock = 'SCENARIO: REPEAT / RETURNING CUSTOMER. Customer has purchased from us before. Acknowledge the relationship. Make them feel valued and recognized.';
  } else if (s.isGoogleAd) {
    scenarioBlock = 'SCENARIO: GOOGLE AD / PAID SEARCH LEAD. Customer clicked a paid ad and submitted a lead. They are in-market and actively searching.';
  } else if (s.isReferral) {
    scenarioBlock = 'SCENARIO: REFERRAL. Customer was referred to us. Acknowledge the referral in your opening.';
  } else {
    scenarioBlock = 'SCENARIO: STANDARD INTERNET LEAD. First-touch outreach. Warm, direct, specific to the vehicle.';
  }

  // ── Overlays (vehicle status, special flags) ────────────────────
  let overlays = [];
  if (s.vehicleSold)       overlays.push('VEHICLE STATUS: SOLD. Do NOT promise availability. Offer to find a similar vehicle or add them to a waitlist.');
  if (s.vehicleInTransit)  overlays.push('VEHICLE STATUS: IN TRANSIT. The vehicle is on order and not yet on the lot. Confirm it is coming and give an honest ETA if known.');
  if (s.isLoyaltyVehicle)  overlays.push('LOYALTY VEHICLE: This vehicle was owned by the customer previously. Acknowledge their familiarity with the model.');
  if (s.noSpecificVehicle) overlays.push('NO SPECIFIC UNIT: Customer has not specified a vehicle. Do NOT name a vehicle. Ask what they are looking for.');
  if (s.noCustomerPhone)   overlays.push('NO CUSTOMER PHONE: Only email is available. Do not write an SMS or voicemail. Write the email only, and ask for their number.');
  if (s.notToday)          overlays.push('NOT TODAY: Customer said they cannot come in today. Do NOT offer today as an appointment option.');
  if (s.customerScheduleConstraint) overlays.push('SCHEDULE CONSTRAINT: ' + s.customerScheduleConstraint);
  if (s.isStalled)         overlays.push('STALLED LEAD: No response in 30+ days. Re-engage with a low-pressure, humble tone. Reference the original interest briefly.');
  if (s.staleModelYear && vehicle) overlays.push('STALE MODEL YEAR: The vehicle of interest (' + vehicle + ') is a prior model year. Acknowledge availability honestly. Offer to check current-year options as well if appropriate.');
  if (s.vehiclePendingSale) overlays.push('VEHICLE PENDING SALE: There is a note that this vehicle may be in the process of being sold. Do NOT promise it is available. Let the customer know you will confirm status.');
  if (s.hasApptSet && !s.isMissedAppt) overlays.push('APPOINTMENT CONTEXT: An appointment has been set or confirmed. If writing a reminder, confirm the time. Do NOT re-offer appointment slots that were already accepted.');
  if (s.isRecentOutbound && data.recentOutboundContent) overlays.push('RECENT OUTBOUND (within 1 hour): A message was already sent recently: "' + data.recentOutboundContent.substring(0, 200) + '". Write a DIFFERENT follow-up that does not repeat this message.');
  if (overlays.length) scenarioBlock += '\n\n' + overlays.join('\n');

  // ── Appointment times block ─────────────────────────────────────
  let apptBlock = '';
  if (!s.noCustomerPhone && !s.isExitSignal && !s.isPauseSignal && !s.isSoldDelivered) {
    apptBlock = '\nAPPOINTMENT SLOTS (use these exact times):\n'
      + '  Option 1: ' + apptTimes.time1 + '\n'
      + '  Option 2: ' + apptTimes.time2 + '\n'
      + (apptTimes.note ? '  Note: ' + apptTimes.note + '\n' : '');
  }

  // ── Agent block ─────────────────────────────────────────────────
  const agentBlock = [
    'AGENT:',
    '  Name: ' + (agentName || '[agent name]'),
    '  First name: ' + (agentFirst || '[agent first name]'),
    '  Phone: ' + agentPhone,
    '  Title: ' + s.persona,
    '  Store: ' + (store || '[store]'),
  ].join('\n');

  // ── Lead block ──────────────────────────────────────────────────
  const vehicleDisplay = vehicle || '(none specified)';
  const stockDisplay   = data.stockNum ? 'Stock #' + data.stockNum : (data.vin ? 'VIN ' + data.vin : '');
  const colorDisplay   = data.color    ? 'Color: ' + data.color    : '';
  const condDisplay    = data.condition? 'Condition: ' + data.condition : '';
  let leadBlock = [
    'LEAD:',
    '  Customer: ' + (data.customerName || '[customer name]'),
    '  First name: ' + (customerFirst  || '[customer first name]'),
    '  Vehicle of interest: ' + vehicleDisplay,
    stockDisplay  ? ('  ' + stockDisplay)  : '',
    colorDisplay  ? ('  ' + colorDisplay)  : '',
    condDisplay   ? ('  ' + condDisplay)   : '',
    data.hasTrade  ? ('  Trade-in: ' + (data.tradeDescription || 'Yes \u2014 details not available')) : '',
    data.equityData? ('  Equity data: ' + data.equityData) : '',
    data.ownedVehicle ? ('  Currently owns: ' + data.ownedVehicle) : '',
    data.buyingSignals? ('  Buying signals: ' + data.buyingSignals) : '',
    '  Lead source: ' + (leadSource || '[unknown]'),
    data.leadStatus ? ('  Status: ' + data.leadStatus) : '',
  ].filter(Boolean).join('\n');

  // ── Context block (custom instructions) ─────────────────────────
  const ctxBlock = ctx ? ('\nADDITIONAL CONTEXT / INSTRUCTIONS:\n' + ctx) : '';

  const prompt = [
    scenarioBlock,
    '',
    agentBlock,
    '',
    leadBlock,
    apptBlock,
    ctxBlock,
    '',
    'Write all three: SMS, email, and voicemail. Return only the JSON object.'
  ].filter(s => s !== undefined).join('\n');

  return prompt;
}
// ── generateMessages ─────────────────────────────────────────────
async function generateMessages() {
  const btn        = document.getElementById('generateBtn');
  const spinner    = document.getElementById('spinner');
  const output     = document.getElementById('output');
  const smsOut     = document.getElementById('smsOutput');
  const emailOut   = document.getElementById('emailOutput');
  const vmOut      = document.getElementById('voicemailOutput');
  const smsCount   = document.getElementById('smsCharCount');
  const emailCount = document.getElementById('emailCharCount');
  const vmCount    = document.getElementById('vmCharCount');
  const copyBtns   = document.querySelectorAll('.copy-btn');
  btn.disabled = true;
  spinner.style.display = 'inline-block';
  output.style.display  = 'none';
  copyBtns.forEach(function(b){ b.textContent = 'Copy'; b.classList.remove('copied'); });

  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      showError('No API key saved. Go to Settings and enter your Claude API key.');
      return;
    }

    // Build payload from form fields
    const customerName = (document.getElementById('customerName')||{}).value || '';
    const vehicle      = (document.getElementById('vehicle')||{}).value || '';
    const stockNum     = (document.getElementById('stockNum')||{}).value || '';
    const vin          = (document.getElementById('vin')||{}).value || '';
    const color        = (document.getElementById('color')||{}).value || '';
    const condition    = (document.getElementById('condition')||{}).value || '';
    const agentSel     = document.getElementById('agentSelect');
    const agentName    = agentSel ? agentSel.value : '';
    const agentPhone   = lookupPhone(agentName, selectedStore) || '';
    const leadSource   = (document.getElementById('leadSource')||{}).value || '';
    const context      = (document.getElementById('contextNotes')||{}).value || '';
    const hasTrade     = document.getElementById('hasTrade') && document.getElementById('hasTrade').checked;
    const tradeDesc    = (document.getElementById('tradeDescription')||{}).value || '';
    const equityData   = lastScrapedData ? (lastScrapedData.equityData || '') : '';
    const buyingSignals= lastScrapedData ? (lastScrapedData.buyingSignals || '') : '';
    const ownedVehicle = lastScrapedData ? (lastScrapedData.ownedVehicle || '') : '';
    const ampEmailSubject = lastScrapedData ? (lastScrapedData.ampEmailSubject || '') : '';
    const conversationBrief = lastScrapedData ? (lastScrapedData.conversationBrief || '') : '';
    const convState    = lastScrapedData ? (lastScrapedData.convState || 'first-touch') : 'first-touch';
    const hasOutbound  = lastScrapedData ? !!(lastScrapedData.hasOutbound) : false;
    const isLiveConversation = lastScrapedData ? !!(lastScrapedData.isLiveConversation) : false;
    const isRecentOutbound   = lastScrapedData ? !!(lastScrapedData.isRecentOutbound) : false;
    const recentOutboundContent = lastScrapedData ? (lastScrapedData.recentOutboundContent || '') : '';
    const hasApptSet   = lastScrapedData ? !!(lastScrapedData.hasApptSet) : false;
    const apptDetails  = lastScrapedData ? (lastScrapedData.apptDetails || '') : '';
    const isSoldDelivered = lastScrapedData ? !!(lastScrapedData.isSoldDelivered) : false;
    const hasMissedAppt = lastScrapedData ? !!(lastScrapedData.hasMissedAppt) : false;
    const missedApptTiming = lastScrapedData ? (lastScrapedData.missedApptTiming || 'recently') : 'recently';
    const isShowroomFollowUp = lastScrapedData ? !!(lastScrapedData.isShowroomFollowUp) : false;
    const showroomDetails    = lastScrapedData ? (lastScrapedData.showroomDetails || '') : '';
    const showroomVisitToday = lastScrapedData ? !!(lastScrapedData.showroomVisitToday) : false;
    const pastVisitNotes     = lastScrapedData ? (lastScrapedData.pastVisitNotes || []) : [];
    const vehiclePendingSale = lastScrapedData ? !!(lastScrapedData.vehiclePendingSale) : false;
    const noSpecificVehicle  = lastScrapedData ? !!(lastScrapedData.noSpecificVehicle) : false;
    const isInTransit        = lastScrapedData ? !!(lastScrapedData.isInTransit) : false;
    const customerSaidNotToday = lastScrapedData ? !!(lastScrapedData.customerSaidNotToday) : false;
    const customerScheduleConstraint = lastScrapedData ? (lastScrapedData.customerScheduleConstraint || '') : '';
    const leadAgeDays = lastScrapedData ? (lastScrapedData.leadAgeDays || 0) : 0;

    // Compute context flags from CRM data
    let augmentedContext = context;
    const contextParts = [context];
    if (hasApptSet && !hasMissedAppt) contextParts.push('appointment already set' + (apptDetails ? ': ' + apptDetails.substring(0,150) : ''));
    if (isShowroomFollowUp) contextParts.push('showroom stage');
    if (isSoldDelivered)    contextParts.push('sold/delivered');
    if (hasMissedAppt)      contextParts.push('missed appointment (' + missedApptTiming + ')');
    if (vehiclePendingSale) contextParts.push('vehicle pending sale');
    if (noSpecificVehicle)  contextParts.push('no specific unit');
    if (isInTransit)        contextParts.push('vehicle status: in transit');
    if (customerSaidNotToday) contextParts.push('not today');
    if (customerScheduleConstraint) contextParts.push('schedule constraint: ' + customerScheduleConstraint);
    if (leadAgeDays > 30)   contextParts.push('stalled lead (' + leadAgeDays + ' days old)');
    augmentedContext = contextParts.filter(Boolean).join('\n');

    const data = {
      customerName, vehicle, stockNum, vin, color, condition,
      store: selectedStore || '',
      agent: agentName, agentPhone,
      leadSource, context: augmentedContext,
      hasTrade, tradeDescription: tradeDesc,
      equityData, buyingSignals, ownedVehicle, ampEmailSubject,
      conversationBrief, convState, hasOutbound,
      isLiveConversation, isRecentOutbound, recentOutboundContent,
      hasApptSet, apptDetails, isSoldDelivered, hasMissedAppt, missedApptTiming,
      isShowroomFollowUp, showroomDetails, showroomVisitToday, pastVisitNotes,
      vehiclePendingSale, noSpecificVehicle, isInTransit,
    };

    const systemPrompt = buildSystemPrompt();
    const userPrompt   = buildUserPrompt(data);

    console.log('[Lead Pro] User prompt:\n', userPrompt);

    const settings = await chrome.storage.sync.get(['claudeModel']);
    const model    = settings.claudeModel || 'claude-sonnet-4-5';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = 'API error ' + response.status;
      try { const e = JSON.parse(errText); errMsg = e.error?.message || errMsg; } catch(x){}
      throw new Error(errMsg);
    }

    const result = await response.json();
    const raw    = result.content?.[0]?.text || '';
    console.log('[Lead Pro] Raw API response:', raw);

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {
      throw new Error('Could not parse response JSON: ' + e.message);
    }

    const sms      = (parsed.sms      || '').trim();
    const email    = (parsed.email    || '').trim();
    const voicemail= (parsed.voicemail|| '').trim();

    if (!sms && !email && !voicemail) throw new Error('Empty response from API');

    smsOut.textContent   = sms;
    emailOut.textContent = email;
    vmOut.textContent    = voicemail;

    if (smsCount)   smsCount.textContent   = sms.length   + ' chars';
    if (emailCount) emailCount.textContent = email.length + ' chars';
    if (vmCount)    vmCount.textContent    = voicemail.length + ' chars';

    output.style.display = 'block';
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch(err) {
    console.error('[Lead Pro] generateMessages error:', err);
    showError(err.message || 'Unknown error generating messages.');
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

function showError(msg) {
  const errEl = document.getElementById('errorMsg');
  if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  else { alert(msg); }
  document.getElementById('spinner').style.display = 'none';
  document.getElementById('generateBtn').disabled = false;
}
// ── Copy helpers ──────────────────────────────────────────────────
function setupCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const targetId = btn.getAttribute('data-target');
      const el = document.getElementById(targetId);
      if (!el) return;
      const text = el.textContent || el.innerText || '';
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(function(err) {
        console.error('[Lead Pro] Copy failed:', err);
      });
    });
  });
}

// ── Settings panel ────────────────────────────────────────────────
async function openSettings() {
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') {
    const keyInput = document.getElementById('apiKeyInput');
    if (keyInput) {
      const stored = await chrome.storage.sync.get(['claudeApiKey']);
      keyInput.value = stored.claudeApiKey ? '\u2022'.repeat(20) : '';
    }
    const modelSel = document.getElementById('modelSelect');
    if (modelSel) {
      const ms = await chrome.storage.sync.get(['claudeModel']);
      modelSel.value = ms.claudeModel || 'claude-sonnet-4-5';
    }
  }
}

async function saveSettings() {
  const keyInput = document.getElementById('apiKeyInput');
  const modelSel = document.getElementById('modelSelect');
  const statusEl = document.getElementById('settingsSaveStatus');
  const newKey   = keyInput ? keyInput.value.trim() : '';
  const newModel = modelSel ? modelSel.value : 'claude-sonnet-4-5';
  const saveObj  = { claudeModel: newModel };
  if (newKey && !newKey.startsWith('\u2022')) {
    saveObj.claudeApiKey = newKey;
  }
  await chrome.storage.sync.set(saveObj);
  if (statusEl) {
    statusEl.textContent = '\u2713 Saved';
    statusEl.style.color = '#22c55e';
    setTimeout(function(){ statusEl.textContent = ''; }, 2000);
  }
}

async function getApiKey() {
  const s = await chrome.storage.sync.get(['claudeApiKey']);
  return s.claudeApiKey || '';
}

// ── Regenerate single tab ─────────────────────────────────────────
async function regenerateSingle(type) {
  const smsOut  = document.getElementById('smsOutput');
  const emailOut= document.getElementById('emailOutput');
  const vmOut   = document.getElementById('voicemailOutput');
  const map = { sms: smsOut, email: emailOut, voicemail: vmOut };
  const el  = map[type];
  if (!el) return;
  const regenBtn = document.querySelector('[data-regen="' + type + '"]');
  const origText = el.textContent;
  if (regenBtn) { regenBtn.disabled = true; regenBtn.textContent = '\u21bb\u2026'; }
  el.style.opacity = '0.4';
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key');
    const customerName = (document.getElementById('customerName')||{}).value || '';
    const vehicle      = (document.getElementById('vehicle')||{}).value || '';
    const agentSel     = document.getElementById('agentSelect');
    const agentName    = agentSel ? agentSel.value : '';
    const leadSource   = (document.getElementById('leadSource')||{}).value || '';
    const context      = (document.getElementById('contextNotes')||{}).value || '';
    const hasTrade     = document.getElementById('hasTrade') && document.getElementById('hasTrade').checked;
    const tradeDesc    = (document.getElementById('tradeDescription')||{}).value || '';
    const conversationBrief = lastScrapedData ? (lastScrapedData.conversationBrief || '') : '';
    const convState    = lastScrapedData ? (lastScrapedData.convState || 'first-touch') : 'first-touch';
    const ownedVehicle = lastScrapedData ? (lastScrapedData.ownedVehicle || '') : '';
    const ampEmailSubject = lastScrapedData ? (lastScrapedData.ampEmailSubject || '') : '';
    const data = {
      customerName, vehicle, store: selectedStore || '',
      agent: agentName, agentPhone: lookupPhone(agentName, selectedStore) || '',
      leadSource, context,
      hasTrade, tradeDescription: tradeDesc,
      equityData: lastScrapedData ? (lastScrapedData.equityData||'') : '',
      buyingSignals: lastScrapedData ? (lastScrapedData.buyingSignals||'') : '',
      ownedVehicle, ampEmailSubject,
      conversationBrief, convState,
      hasOutbound: lastScrapedData ? !!(lastScrapedData.hasOutbound) : false,
      isLiveConversation: lastScrapedData ? !!(lastScrapedData.isLiveConversation) : false,
      hasApptSet: lastScrapedData ? !!(lastScrapedData.hasApptSet) : false,
      isSoldDelivered: lastScrapedData ? !!(lastScrapedData.isSoldDelivered) : false,
      hasMissedAppt: lastScrapedData ? !!(lastScrapedData.hasMissedAppt) : false,
      missedApptTiming: lastScrapedData ? (lastScrapedData.missedApptTiming||'recently') : 'recently',
      isShowroomFollowUp: lastScrapedData ? !!(lastScrapedData.isShowroomFollowUp) : false,
      showroomDetails: lastScrapedData ? (lastScrapedData.showroomDetails||'') : '',
      showroomVisitToday: lastScrapedData ? !!(lastScrapedData.showroomVisitToday) : false,
      pastVisitNotes: lastScrapedData ? (lastScrapedData.pastVisitNotes||[]) : [],
      vehiclePendingSale: lastScrapedData ? !!(lastScrapedData.vehiclePendingSale) : false,
      noSpecificVehicle: lastScrapedData ? !!(lastScrapedData.noSpecificVehicle) : false,
      isInTransit: lastScrapedData ? !!(lastScrapedData.isInTransit) : false,
      customerSaidNotToday: lastScrapedData ? !!(lastScrapedData.customerSaidNotToday) : false,
      customerScheduleConstraint: lastScrapedData ? (lastScrapedData.customerScheduleConstraint||'') : '',
      leadAgeDays: lastScrapedData ? (lastScrapedData.leadAgeDays||0) : 0,
    };
    const systemPrompt = buildSystemPrompt();
    const userPrompt   = buildUserPrompt(data);
    const regenInstructions = {
      sms: 'Write a DIFFERENT SMS. Same info, fresh wording. Return only: {"sms":"..."}',
      email: 'Write a DIFFERENT email. Same scenario, fresh wording. Return only: {"email":"..."}',
      voicemail: 'Write a DIFFERENT voicemail. Same scenario, fresh wording. Return only: {"voicemail":"..."}'
    };
    const ms = await chrome.storage.sync.get(['claudeModel']);
    const model = ms.claudeModel || 'claude-sonnet-4-5';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: '{"sms":"' + (smsOut.textContent||'').replace(/"/g,'\\"').substring(0,300) + '..."}' },
          { role: 'user', content: regenInstructions[type] }
        ]
      })
    });
    if (!response.ok) throw new Error('API error ' + response.status);
    const result = await response.json();
    const raw    = result.content?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed[type]) {
      el.textContent = parsed[type].trim();
      const countMap = { sms: 'smsCharCount', email: 'emailCharCount', voicemail: 'vmCharCount' };
      const countEl  = document.getElementById(countMap[type]);
      if (countEl) countEl.textContent = el.textContent.length + ' chars';
    }
  } catch(err) {
    console.error('[Lead Pro] Regen error:', err);
    el.textContent = origText;
  } finally {
    el.style.opacity = '1';
    if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = '\u21bb'; }
  }
}
// ── Tab switching ─────────────────────────────────────────────────
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panes= document.querySelectorAll('.tab-pane');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      tabs.forEach(function(t){ t.classList.remove('active'); });
      panes.forEach(function(p){ p.classList.remove('active'); });
      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      const pane   = document.getElementById('tab-' + target);
      if (pane) pane.classList.add('active');
    });
  });
}

// ── Trade-in toggle ───────────────────────────────────────────────
function setupTradeToggle() {
  const cb      = document.getElementById('hasTrade');
  const details = document.getElementById('tradeDetailsRow');
  if (!cb || !details) return;
  function update() {
    details.style.display = cb.checked ? 'block' : 'none';
  }
  cb.addEventListener('change', update);
  update();
}

// ── Agent select → auto-fill phone preview ────────────────────────
function setupAgentSelect() {
  const sel = document.getElementById('agentSelect');
  if (!sel) return;
  sel.addEventListener('change', function() {
    const phone = lookupPhone(sel.value, selectedStore);
    const preview = document.getElementById('agentPhonePreview');
    if (preview) preview.textContent = phone ? '\u260e ' + phone : '';
  });
}

// ── Store selector ────────────────────────────────────────────────
function setupStoreSelector() {
  const sel = document.getElementById('storeSelect');
  if (!sel) return;
  sel.addEventListener('change', function() {
    selectedStore = sel.value;
    chrome.storage.local.set({ leadpro_store: selectedStore });
    updateStoreUI();
  });
}

function updateStoreUI() {
  const storeBadge = document.getElementById('storeBadge');
  if (storeBadge && selectedStore) {
    storeBadge.textContent = selectedStore;
    storeBadge.style.display = 'inline-block';
  } else if (storeBadge) {
    storeBadge.style.display = 'none';
  }
  const storeSelect = document.getElementById('storeSelect');
  if (storeSelect && selectedStore) storeSelect.value = selectedStore;
  const agentSel = document.getElementById('agentSelect');
  if (!agentSel) return;
  const s = (selectedStore||'').toLowerCase();
  const isAudi    = s.includes('audi');
  const isLaf     = s.includes('lafayette');
  const isBaytown = !isAudi && !isLaf;
  const options   = agentSel.querySelectorAll('option');
  options.forEach(function(opt) {
    const val  = opt.value.toLowerCase();
    const isAll= val === '' || val === 'all' || !val;
    if (!isAll) opt.style.display = '';
  });
}

// ── populateFromData ──────────────────────────────────────────────
function populateFromData(data) {
  let filled = 0;

  function setField(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    filled++;
  }

  setField('customerName', data.name || data.customerName);
  setField('vehicle',      data.vehicle);
  setField('stockNum',     data.stockNum);
  setField('vin',          data.vin);
  setField('color',        data.color);
  setField('condition',    data.condition);
  setField('leadSource',   data.leadSource);

  // Agent
  const agentSelect = document.getElementById('agentSelect');
  if (agentSelect && data.agent) {
    const agentKey = data.agent.toLowerCase().trim();
    const opts = agentSelect.querySelectorAll('option');
    let matched = false;
    opts.forEach(function(opt) {
      if (opt.value.toLowerCase().trim() === agentKey) {
        agentSelect.value = opt.value;
        matched = true;
        filled++;
      }
    });
    if (!matched) {
      opts.forEach(function(opt) {
        const fn = opt.value.split(' ')[0].toLowerCase();
        if (!matched && fn && agentKey.startsWith(fn)) {
          agentSelect.value = opt.value;
          matched = true;
          filled++;
        }
      });
    }
    const phonePreview = document.getElementById('agentPhonePreview');
    if (phonePreview && agentSelect.value) {
      const phone = lookupPhone(agentSelect.value, data.store || selectedStore);
      phonePreview.textContent = phone ? '\u260e ' + phone : '';
    }
  }

  // Store
  if (data.store) {
    const inferredStore = inferStore(data.store);
    if (inferredStore && !selectedStore) {
      selectedStore = inferredStore;
      const storeSelect = document.getElementById('storeSelect');
      if (storeSelect) storeSelect.value = inferredStore;
      chrome.storage.local.set({ leadpro_store: inferredStore });
      updateStoreUI();
      filled++;
    }
  }

  // Trade-in
  if (data.hasTrade) {
    const cb = document.getElementById('hasTrade');
    if (cb) { cb.checked = true; filled++; }
    setField('tradeDescription', data.tradeDescription);
    const details = document.getElementById('tradeDetailsRow');
    if (details) details.style.display = 'block';
  }

  return filled;
}

function inferStore(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('audi'))                     return 'Audi Lafayette';
  if (s.includes('honda') && s.includes('lafayette')) return 'Community Honda Lafayette';
  if (s.includes('honda'))                    return 'Community Honda Baytown';
  if (s.includes('kia'))                      return 'Community Kia Baytown';
  if (s.includes('toyota'))                   return 'Community Toyota Baytown';
  if (s.includes('hyundai'))                  return 'Community Hyundai Baytown';
  return '';
}

// ── clearFields ───────────────────────────────────────────────────
function clearFields() {
  ['customerName','vehicle','stockNum','vin','color','condition','leadSource','contextNotes','tradeDescription'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const cb = document.getElementById('hasTrade');
  if (cb) cb.checked = false;
  const tradeRow = document.getElementById('tradeDetailsRow');
  if (tradeRow) tradeRow.style.display = 'none';
  const agentSel = document.getElementById('agentSelect');
  if (agentSel) agentSel.selectedIndex = 0;
  const phonePreview = document.getElementById('agentPhonePreview');
  if (phonePreview) phonePreview.textContent = '';
  const output = document.getElementById('output');
  if (output) output.style.display = 'none';
  const errEl = document.getElementById('errorMsg');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  lastScrapedData = null;
}
// ── DOMContentLoaded ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  // Restore saved store
  const saved = await chrome.storage.local.get(['leadpro_store']);
  if (saved.leadpro_store) {
    selectedStore = saved.leadpro_store;
    updateStoreUI();
  }

  // Wire generate button
  const generateBtn = document.getElementById('generateBtn');
  if (generateBtn) generateBtn.addEventListener('click', generateMessages);

  // Wire grab lead button
  const grabBtn = document.getElementById('grabLeadBtn');
  if (grabBtn) grabBtn.addEventListener('click', grabLead);

  // Wire clear button
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearFields);

  // Wire settings button
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

  // Wire settings save
  const saveBtn = document.getElementById('saveSettingsBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);

  // Wire regen buttons
  document.querySelectorAll('[data-regen]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      regenerateSingle(btn.getAttribute('data-regen'));
    });
  });

  // Wire close settings
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', function() {
      const panel = document.getElementById('settingsPanel');
      if (panel) panel.style.display = 'none';
    });
  }

  setupCopyButtons();
  setupTabs();
  setupTradeToggle();
  setupAgentSelect();
  setupStoreSelector();

  // Auto-grab on open if on VinSolutions
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && (tab.url.includes('vinsolutions.com') || tab.url.includes('coxautoinc.com'))) {
      const cached = await chrome.storage.local.get(['leadpro_data']);
      if (cached.leadpro_data && (Date.now() - cached.leadpro_data.scrapedAt) < 30000) {
        const m = cached.leadpro_data;
        lastScrapedData = m;
        const filled = populateFromData(m);
        const statusEl = document.getElementById('crmStatus');
        const dot      = document.getElementById('statusDot');
        if (statusEl) {
          if (filled > 0 || selectedStore) {
            statusEl.className = 'crm-status found';
            statusEl.textContent = '\u2713 ' + filled + ' field' + (filled > 1 ? 's' : '') + ' restored from cache';
            if (dot) dot.classList.add('active');
          }
        }
      }
    }
  } catch(e) {
    console.log('[Lead Pro] Auto-grab skipped:', e.message);
  }

  // Listen for storage changes (in case content script pushes data)
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.leadpro_data && changes.leadpro_data.newValue) {
      const m = changes.leadpro_data.newValue;
      lastScrapedData = m;
      const filled = populateFromData(m);
      const statusEl = document.getElementById('crmStatus');
      const dot      = document.getElementById('statusDot');
      if (statusEl && (filled > 0 || selectedStore)) {
        statusEl.className   = 'crm-status found';
        statusEl.textContent = '\u2713 ' + filled + ' field' + (filled > 1 ? 's' : '') + ' updated';
        if (dot) dot.classList.add('active');
      }
    }
  });
});
// ── END OF FILE ───────────────────────────────────────────────────
