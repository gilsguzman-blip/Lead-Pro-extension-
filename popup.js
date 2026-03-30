// ─────────────────────────────────────────────────────────────────
// Lead Pro — popup.js  v8.63
// Calls either a proxy server (recommended for team use) OR
// the Gemini API directly. Both configured in config.js.
// ─────────────────────────────────────────────────────────────────

// ── Config validation ─────────────────────────────────────────────
// config.js must define ONE of:
//   const LEADPRO_PROXY_URL = 'https://your-worker.workers.dev';  ← team/production
//   const LEADPRO_API_KEY   = 'your-gemini-key';                  ← direct/fallback
function getEndpoint() {
  // Proxy mode (preferred — key never leaves the server)
  if (typeof LEADPRO_PROXY_URL !== 'undefined' && LEADPRO_PROXY_URL && !LEADPRO_PROXY_URL.includes('YOUR_PROXY')) {
    return { type: 'proxy', url: LEADPRO_PROXY_URL };
  }
  // Direct mode (key in config.js — acceptable for single user)
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
let leadConvState     = 'first-touch'; // tracks conversation state for classifyScenario
let lastScrapedData   = null;          // stores latest scraped lead data for prompt building

// ── DealerID map ──────────────────────────────────────────────────
// Sourced directly from eccs/index.html?dealerId= URL parameter
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
  // Generic brand fallbacks — only used when no location context
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
  if (!field || !field.value.trim()) { wc.textContent = '—'; return; }
  const words = field.value.trim().split(/\s+/).filter(Boolean).length;
  wc.textContent = words + ' words · ' + field.value.length + ' chars';
}

// ── Copy buttons ──────────────────────────────────────────────────
document.querySelectorAll('.btn-copy').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const pane = btn.dataset.pane;
    const field = document.getElementById('output-' + pane);
    if (!field || !field.value) return;

    if (pane === 'email') {
      var rawText = field.value;
      // Remove blank line between greeting and first paragraph
      var cleanedText = rawText.replace(/^([^\n]{1,50},)\n\n/m, '$1\n');
      // Convert to HTML — single spaced TNR 16px
      var escaped = cleanedText
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/\n/g,'<br>');
      var htmlContent = '<div style="font-family:\'Times New Roman\',Times,serif;font-size:16px;line-height:1.4;color:#000000;margin:0;padding:0;">' + escaped + '</div>';

      if (window.ClipboardItem && navigator.clipboard.write) {
        var blob = new Blob([htmlContent], { type: 'text/html' });
        var plainBlob = new Blob([rawText], { type: 'text/plain' });
        navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': plainBlob })]).then(function() {
          btn.textContent = 'Copied!'; btn.classList.add('copied');
          setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
        }).catch(function() {
          navigator.clipboard.writeText(rawText).then(function() {
            btn.textContent = 'Copied!'; btn.classList.add('copied');
            setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
          });
        });
      } else {
        var el = document.createElement('div');
        el.innerHTML = htmlContent;
        el.style.position = 'fixed'; el.style.opacity = '0'; el.style.pointerEvents = 'none';
        document.body.appendChild(el);
        var sel = window.getSelection(); var range = document.createRange();
        range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('copy'); sel.removeAllRanges(); document.body.removeChild(el);
        btn.textContent = 'Copied!'; btn.classList.add('copied');
        setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
      }
      return;
    }

    navigator.clipboard.writeText(field.value).then(function() {
      btn.textContent = 'Copied!'; btn.classList.add('copied');
      setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
    }).catch(function() {
      btn.textContent = 'Try again';
      setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
    });
  });
});

// ── Populate form from scraped data ──────────────────────────────
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

  // Flag missing customer phone — changes message strategy
  const noCustomerPhone = !d.phone || d.phone.length < 7;

  // Follow-up context — conversationBrief now contains the full transcript
  const isFollowUp = !!(d.hasOutbound || d.isContacted); // Removed totalNoteCount check — system notes (lead received, auto-response, TradePending) inflate count on fresh leads

  // Stage overrides — in priority order
  const extras = [];

  // Sold/Delivered — highest priority
  if (d.isSoldDelivered) {
    extras.push('🎉 SOLD/DELIVERED — this customer has purchased and taken delivery. Do NOT send a re-engagement or sales message.');
    extras.push('MESSAGE GOAL: Warm congratulations only. Welcome them to the family. Set expectation for follow-up service/ownership experience.');
    extras.push('Tone: celebratory, warm, genuine. 2-3 sentences for SMS. No appointment offer. No vehicle pitch.');

  // Missed appointment — re-engagement to reschedule
  } else if (d.hasMissedAppt) {
    var missedApptTiming = d.missedApptTiming || 'recently';
    extras.push('📵 MISSED APPOINTMENT — customer did not make it to their scheduled appointment. This is a re-engagement to reschedule.');
    extras.push('TIMING RULE: Do NOT specify when the appointment was (today/yesterday) — appointment timing in the CRM can be unreliable. Instead use neutral language: "we missed connecting", "we did not get a chance to meet", "we were expecting you" — no date reference.');
    extras.push('MESSAGE GOAL: Acknowledge gently that you missed them. No guilt. Offer to find a new time that works better.');
    extras.push('Tone: warm, understanding, no pressure. Offer two new appointment times.');

  } else if (d.hasApptSet) {
    extras.push('📅 APPOINTMENT ALREADY SET — confirmation/reminder only. No re-pitch. No new times.');
    if (d.apptDetails) extras.push('Appointment details: ' + d.apptDetails);

  // Showroom visit
  } else if (d.isShowroomFollowUp) {
    extras.push('🏪 SHOWROOM STAGE: Customer has already visited the dealership. Post-visit follow-up only.');
    extras.push('IMPORTANT: The BD Agent did NOT meet the customer in person — the Sales Rep did. Do not write "it was great meeting you." Instead reference the visit indirectly: "I heard you stopped by" or "I wanted to follow up on your visit with [Sales Rep name if known]."');
    extras.push('No first-touch language. Frame return visit as finalizing, not starting.');
    if (d.showroomDetails) extras.push('Visit notes: ' + d.showroomDetails);
  }

  // The conversation brief IS the follow-up context — it contains the full transcript
  // and the AI directive. Stage overrides (appointment/showroom) prepend to it.
  const stageOverride = extras.join('\n');
  if (d.conversationBrief) {
    leadContext = (stageOverride ? stageOverride + '\n\n' : '') + d.conversationBrief;
  } else {
    leadContext = stageOverride;
  }

  // Append vehicle/inventory context after the transcript
  // When appointment/showroom stage is active, suppress inventory signals EXCEPT sold-with-appointment
  const stageActive = !!(d.hasApptSet || d.isShowroomFollowUp || d.isSoldDelivered);
  const vehicleExtras = [];
  if (d.condition)        vehicleExtras.push('Condition: ' + d.condition);
  if (d.color && !d.noSpecificVehicle) vehicleExtras.push('Color: ' + d.color);
  if (d.color &&  d.noSpecificVehicle) vehicleExtras.push('Customer expressed interest in ' + d.color + ' — but no specific unit confirmed. Do NOT say we have this color available.');
  if (d.stockNum)         vehicleExtras.push('Stock #: ' + d.stockNum);
  if (d.vin)              vehicleExtras.push('VIN: ' + d.vin);
  if (d.noSpecificVehicle && !stageActive) vehicleExtras.push('⚠ NO SPECIFIC UNIT: Customer has not selected a specific vehicle — no stock number or VIN. Qualifying questions required.');
  if (d.noVehicleAtAll && !stageActive) {
    vehicleExtras.push('⚠ NO VEHICLE ON LEAD: Customer has not indicated any specific vehicle interest — no model, no stock number, no VIN. Do NOT reference or imply a vehicle is ready. REQUIRED: Ask a qualifying question to find out what they are looking for. Example: "What type of vehicle were you thinking about — SUV, sedan, or something else?" or "Were you looking at anything specific on our site?"');
  }
  // Agent LP commands — highest priority
  if (d.agentLPCommands && Array.isArray(d.agentLPCommands) && d.agentLPCommands.length > 0) {
    vehicleExtras.push('');
    vehicleExtras.push('━━ AGENT INSTRUCTIONS (highest priority — follow exactly) ━━');
    d.agentLPCommands.forEach(function(cmd) { vehicleExtras.push('► ' + cmd); });
    vehicleExtras.push('These instructions were added by the agent and override default behavior.');
    // Extract URL from anywhere in LP commands
    var lpUrlExtracted = '';
    d.agentLPCommands.forEach(function(cmd) {
      if(!lpUrlExtracted) {
        var urlMatch = cmd.match(/https?:\/\/[^\s]+/);
        if(urlMatch) lpUrlExtracted = urlMatch[0];
      }
    });
    if(lpUrlExtracted) {
      vehicleExtras.push('AGENT-PROVIDED LINK: ' + lpUrlExtracted);
      vehicleExtras.push('- This URL must appear in the SMS on its own line. Mandatory — do not omit.');
    }
  }

  // Universal stock confirmation — applies to ALL lead sources
  if (!d.noSpecificVehicle && (d.stockNum || d.vin) && !d.inventoryWarning) {
    vehicleExtras.push('✅ VEHICLE CONFIRMED IN STOCK: Stock #' + (d.stockNum || '') + (d.vin ? ' / VIN: ' + d.vin : '') + '.');
    vehicleExtras.push('- Reference the SPECIFIC vehicle — NOT "similar options", "other models", or "available inventory".');
    vehicleExtras.push('- Say: "we have it here", "it is here and ready to see", or "I have it pulled up and ready for you."');
    vehicleExtras.push('- The customer asked about THIS vehicle. Do not pivot to alternatives unless explicitly requested.');
  }


  if (d.ownedVehicle) vehicleExtras.push('Customer\'s current vehicle (confirmed from service/sales history): ' + d.ownedVehicle
    + (d.ownedMileage ? ' | Mileage: ' + parseInt(d.ownedMileage).toLocaleString() : '')
    + (d.lastServiceDate ? ' | Last serviced: ' + d.lastServiceDate : '')
    + ' — USE THIS as the hook for the upgrade conversation when no vehicle of interest is on the lead. Example: "Still thinking about upgrading your ' + d.ownedVehicle.replace(/^\d{4}\s+/,'') + '?"'
    + (d.lastServiceDate && /\/(1[0-9]|20)\b/.test(d.lastServiceDate) ? ' NOTE: Last service was several years ago — customer may have already changed vehicles. Use the Optima reference cautiously.' : ''));
  if (d.ampEmailSubject) vehicleExtras.push('AMP marketing email subject sent to customer: "' + d.ampEmailSubject + '" — use this to understand the campaign angle (e.g. high-mileage upgrade, new model launch) and tie it to their current vehicle. Do NOT quote the subject directly.');
  // Sold vehicle: always inject, but when appointment is set, use do-not-disclose framing
  if (d.vehiclePendingSale) {
    vehicleExtras.push('⚠ VEHICLE STATUS: A note indicates this vehicle may be in the process of being sold. Do NOT confirm it is available. Do NOT say it is sold either. Instead use cautious language: "I want to make sure we get you in before it moves" or "I\'m monitoring the status closely for you." Create urgency to come in TODAY.');
  } else if (d.inventoryWarning) {
    if (d.hasApptSet) {
      vehicleExtras.push('⚠ VEHICLE STATUS: Vehicle is no longer in active inventory — DO NOT disclose this to the customer. Keep appointment confirmation neutral. Handle the vehicle conversation in person.');
    } else if (!stageActive) {
      vehicleExtras.push('🔴 VEHICLE STATUS: SOLD — pivot to comparable options');
    }
  }
  if (d.isInTransit && !stageActive)      vehicleExtras.push('🚛 VEHICLE STATUS: IN TRANSIT — lead with the good news');
  if (d.manager && d.manager !== 'None') vehicleExtras.push('Manager: ' + d.manager);
  if (d.hasTrade) {
    var tradeHook = d.tradeDescription
      ? '🔄 TRADE-IN: ' + d.tradeDescription
      : '🔄 TRADE-IN: Customer has a vehicle to trade in (details not specified).';
    vehicleExtras.push(tradeHook);
    vehicleExtras.push('TRADE-IN RULES:');
    vehicleExtras.push('- The trade is often the DECIDING FACTOR — customers need to know what their car is worth before they commit to buying.');
    vehicleExtras.push('- Lead with the trade angle in SMS and email: "I want to make sure we get your [trade vehicle] appraised so we can build the right deal for you."');
    vehicleExtras.push('- If trade details are listed (year/make/model/mileage), reference the specific vehicle — not a generic "your trade-in."');
    vehicleExtras.push('- Position the visit as the step where trade value gets confirmed: "We can do a quick appraisal when you come in — usually takes about 10 minutes."');
    vehicleExtras.push('- Never make up a trade value or imply you already know what it is worth.');
  }
  if (d.buyingSignals) vehicleExtras.push('BUYING SIGNAL DATA: ' + d.buyingSignals + ' — use these interests to make the message feel personally relevant WITHOUT revealing you have this data. Match the vehicle/category to their interests naturally.');
  if (noCustomerPhone) vehicleExtras.push('📵 NO CUSTOMER PHONE NUMBER — SMS and voicemail are not viable. Email is the only channel. Ask for a phone number to connect directly.');
  if (d.customerSaidNotToday) vehicleExtras.push('🚫 NOT TODAY: Customer explicitly said they cannot come in today. Do NOT offer same-day appointment times. Instead ask what day works better for them.');
  if (d.customerScheduleConstraint) {
    var isShiftWorkerLead = false; // Shift worker auto-detection removed — too many false positives in Baytown/Houston area
    if (isShiftWorkerLead) {
      vehicleExtras.push('🏭 SHIFT WORKER / REFINERY SCHEDULE: Customer works shift or hitch schedule. Context: "' + d.customerScheduleConstraint + '"');
      vehicleExtras.push('SHIFT WORKER RULES:');
      vehicleExtras.push('- Do NOT offer specific appointment times — shift workers often cannot commit until they know their rotation.');
      vehicleExtras.push('- Instead ASK about their schedule: "What does your schedule look like this week?" or "When are you off next?"');
      vehicleExtras.push('- If they mentioned coming off a hitch or having days off, reference that: "When you come off your hitch, I can have everything ready so your visit is quick."');
      vehicleExtras.push('- Acknowledge the schedule respectfully — shift workers appreciate that you understand their lifestyle, not a generic 9-5 pitch.');
      vehicleExtras.push('- If they give a specific day/time window ("I\'m off Thursday"), LOCK onto that and confirm it.');
      vehicleExtras.push('- Tone: flexible, low-pressure, accommodating. Never make them feel rushed or like they need to fit YOUR schedule.');
    } else {
      if(d.customerScheduleConstraint.indexOf('OUT_OF_TOWN:') === 0) {
        var constraint = d.customerScheduleConstraint.replace('OUT_OF_TOWN: ','');
        vehicleExtras.push('✈️ CUSTOMER IS OUT OF TOWN: ' + constraint);
        vehicleExtras.push('- Do NOT offer today or tomorrow as appointment options.');
        vehicleExtras.push('- Schedule AFTER their return date. Reference the trip positively: "Safe travels" or "Hope the trip goes well."');
        vehicleExtras.push('- Close by locking in a time for when they are back: "When you are back, would [day] work to come in?"');
      } else if(d.customerScheduleConstraint.indexOf('CUSTOMER ARRIVAL TIME:') === 0) {
        var arrHourMatch = d.customerScheduleConstraint.match(/around\s+(\d{1,2})/i);
        var arrHour = arrHourMatch ? parseInt(arrHourMatch[1]) : null;
        if(arrHour && arrHour < 8) arrHour += 12; // assume PM for small numbers
        var arrivalPlusDrive = arrHour ? (arrHour + ':30 PM') : 'after 6:30 PM';
        vehicleExtras.push('⏰ CUSTOMER ARRIVAL TIME CONSTRAINT: ' + d.customerScheduleConstraint);
        vehicleExtras.push('- The computed appointment times above are WRONG for this customer. IGNORE them.');
        vehicleExtras.push('- Customer gets off at ' + (arrHour || 6) + ' PM and needs ~30 min to drive. They will arrive around ' + arrivalPlusDrive + '.');
        vehicleExtras.push('- REQUIRED: Offer two times AFTER ' + arrivalPlusDrive + ' that are within store hours (store closes 8 PM). Example: 6:45 PM and 7:15 PM.');
        vehicleExtras.push('- Do NOT offer morning or early afternoon times. Evening only.');
      } else {
        vehicleExtras.push('🚫 SCHEDULE CONSTRAINT: Customer mentioned a recurring availability block: "' + d.customerScheduleConstraint + '". Do NOT offer appointment times that conflict with this. If they work mornings, offer afternoon/evening only. If uncertain, ASK — do not guess.');
      }
    }
  }
  // Hard block: missed appt re-engagement — no appointment confirmation allowed
  if (d.hasMissedAppt && !d.hasApptSet) {
    var lastOutIsReengagement = /life is busy|sorry you couldn.t make it|reschedule.*convenient|missed.*appointment/i.test(d.lastOutboundMsg||'');
    if(lastOutIsReengagement) {
      vehicleExtras.push('');
      vehicleExtras.push('🚫 NO APPOINTMENT EXISTS: Customer replied to re-engagement but has NOT agreed to a new time. DO NOT confirm any time. DO NOT say "I have you set for" or "See you at". Offer two new times to reschedule only.');
    }
  }

  // Contact recovery mode
  // Lead Response Velocity Governor — first response within ~60 seconds of lead creation
  if (d.isVelocityResponse && !d.hasOutbound) {
    vehicleExtras.push('');
    vehicleExtras.push('⚡ VELOCITY RESPONSE: This is the first outbound response within seconds of lead creation. SUPPRESS the appointment engine for this message only.');
    vehicleExtras.push('- Structure: Acknowledge inquiry + ONE light qualifying question. NO duration. NO appointment times.');
    vehicleExtras.push('- Example: "Hi [Name], this is [Agent] with [Store]. I saw your request on the [Vehicle] — are you just starting your search or looking to move soon?"');
    vehicleExtras.push('- Appointment engine activates on the second exchange after the customer replies.');
  }

  // SRP vehicle guard — auto-assigned vehicles are browsing references only
  if (d.isSRPVehicle && !d.noVehicleAtAll) {
    vehicleExtras.push('');
    vehicleExtras.push('⚠ SRP-INJECTED VEHICLE: This vehicle was automatically assigned by the system from search results — it is a browsing reference, NOT a specific customer request. Do NOT treat it as a confirmed vehicle of interest.');
    vehicleExtras.push('- Do NOT say the vehicle is "showing available" or "ready to see" as if the customer chose it.');
    vehicleExtras.push('- Reference the vehicle neutrally: "the vehicle you were looking at online" or ask a qualifying question about what they are looking for.');
    vehicleExtras.push('- Lead with the customer action (chat question, trade inquiry, source intent) — not the vehicle.');
  }

  // Override contactRecovery flags if phone already scraped correctly
  if (d.phone && d.phone.replace(/\D/g,'').length >= 7) d.contactRecoveryPhone = false;
  // Landline: suppress SMS and voicemail, email only
  if (d.isLandline) {
    vehicleExtras.push('📵 LANDLINE ON FILE: Notes confirm this number cannot receive texts. SMS and voicemail are not viable. Email is the only channel. Do NOT ask for a better number — they already provided contact info.');
  }
  if (d.contactRecoveryEmail) {
    vehicleExtras.push('');
    vehicleExtras.push(d.isMaskedEmail
      ? '📧 MASKED EMAIL DETECTED: Customer email is a marketplace relay address that may not reliably deliver. In the SMS, naturally request their direct email before the appointment close. Example: "What is the best email to send the vehicle details to?" Do NOT mention the email is masked.'
      : '📧 NO EMAIL ON FILE: Customer has no email address. In the SMS, request their email naturally before the close. Example: "What is a good email to send the details to?"');
  }
  if (d.contactRecoveryPhone) {
    vehicleExtras.push('');
    vehicleExtras.push('📞 NO PHONE ON FILE: Customer has no phone number. In the email, request their best number as the CLOSE — replace the appointment ask entirely. Example: "What is the best number to reach you on?" Do NOT add appointment times after asking for the number.');
  }

  if (d.isLiveConversation) vehicleExtras.push('🔥 LIVE CONVERSATION: Customer replied within the last few hours and is actively engaged. This is a HOT lead. Write a response that directly continues the live conversation thread. Same-day close is the priority — reference exactly what the customer said and move toward a today appointment.');
  if (d.isRecentOutbound && !d.isLiveConversation) vehicleExtras.push('📤 RECENT OUTBOUND: Agent sent a message within the last hour. Any times or offers already made in that message must be honored — do NOT contradict them with different times. If the prior message offered same-day times, continue that thread. Prior message: "' + (d.recentOutboundContent||'').substring(0,200) + '"');
  if (vehicleExtras.length) leadContext += '\n\nVEHICLE/LEAD DETAILS:\n' + vehicleExtras.join('\n');

  // Stalled flag — cold follow-ups with outbound history but no confirmed contact
  // A live conversation (customer replied today) is never stalled — active engagement beats all stall signals
  // Stalled = outbound sent, no customer reply, lead aging
  // Fires even when Contacted:No — that means attempted but no response
  const hasMultipleAttempts = (d.totalNoteCount || 0) >= 4;
  const isStalled = !d.hasApptSet && !d.isShowroomFollowUp && !d.isLiveConversation
    && (d.leadAgeDays || 0) >= 2
    && (isFollowUp || hasMultipleAttempts); // has outbound OR multiple notes = has been worked
  console.log('[Lead Pro] Stalled check — isFollowUp:', isFollowUp, '| isContacted:', d.isContacted, '| contactedAgeDays:', d.contactedAgeDays, '| hasApptSet:', d.hasApptSet, '| isShowroomFollowUp:', d.isShowroomFollowUp, '| hasOutbound:', d.hasOutbound, '| totalNoteCount:', d.totalNoteCount, '| convState:', d.convState, '| STALLED:', isStalled);
  if (isStalled) {
    toggleFlag('stalled', true);
    // Inject stalled context so AI adjusts tone accordingly
    const ageDays = d.leadAgeDays || 0;
    const ageLabel = ageDays >= 14 ? 'several weeks'
                   : ageDays >= 7  ? 'about a week'
                   : ageDays >= 3  ? 'a few days'
                   : 'a couple of days';
    const ownedVehicleHook = d.ownedVehicle ? ' Customer currently drives a ' + d.ownedVehicle + ' — use this as the specific hook.' : '';
    const ownedModel = d.ownedVehicle ? d.ownedVehicle.replace(/^\d{4}\s+/,'') : 'their current vehicle';
    // pastVisitNotes scraped in content script (inlineScraper) and passed via d.pastVisitNotes
    var pastVisitContext = '';
    if(d.pastVisitNotes && d.pastVisitNotes.length){
      pastVisitContext = '\nKNOWN HISTORY:\n' + d.pastVisitNotes.join('\n');
    }

    // Distinguish zero-contact stalled vs post-engagement stalled
    var neverReplied = !d.isContacted && !d.convState.includes('replied') && !d.isLiveConversation;

    const stalledNote = '⚠ STALLED LEAD: This lead has been open for ' + (ageDays > 0 ? ageDays + ' days' : ageLabel) + '.' + ownedVehicleHook
      + pastVisitContext + '\n'
      + (neverReplied
        ? '🚫 ZERO CUSTOMER RESPONSE: This customer has NEVER replied. Multiple outreach attempts have been made with no engagement.\n'
        + 'GOAL: Get a reply. That is the ONLY goal. Do NOT push an appointment — they haven\'t even responded yet.\n'
        + 'CRITICAL — NO APPOINTMENT TIMES: Do NOT offer 9:15 or 10:30 or any specific times. Do NOT say "would X or Y work for you." They have not engaged. An appointment offer to someone who has never replied feels tone-deaf and will be ignored.\n'
        + 'WHAT TO DO INSTEAD: One short warm message. Acknowledge the vehicle. Ask ONE low-friction question or offer something of value. Leave the door open.\n'
        + 'SMS GOAL: 3-4 sentences. Sound like a real person who actually looked at this file. Reference the specific vehicle. Ask one easy question. Warm enough that it could not be sent to any other customer.\n'
        + 'EXAMPLE SMS: "Caroline, still have that Land Cruiser here — it\'s a great spec. Still exploring or did your search take a different direction?"\n'
        + 'EXAMPLE EMAIL: One paragraph. Reference what they inquired about. Ask one easy question. No appointment times. No duration. Just re-open the conversation.\n'
        : '- Customer engaged but has gone quiet. Goal is to re-open conversation before pushing appointment.\n'
        + '- Do NOT reference any appointment confirmation — that appointment has passed.\n'
        + '- Do NOT say "thanks for confirming" or imply recent engagement.\n'
        + (d.hasConfirmedVisit ? '- KNOWN HISTORY confirms a past visit. Reference it specifically — what vehicle, what hesitation. Be honest and open a new door.\n' : '- NO CONFIRMED VISIT on record. Do NOT say "when you came in" — this customer has NOT visited.\n')
        + '- Be honest and specific. Never fabricate visit details.\n'
        + '- SMS = 3-4 sentences: warm opener, specific hook, one soft ask.\n')
      + '- WRONG in ALL stalled cases: Generic "check in", "touching base", "just wanted to follow up", appointment times on zero-contact leads.';
    leadContext = stalledNote + '\n\n' + leadContext;
    d._isStalled = true;
    d._neverReplied = neverReplied;
    // For zero-contact stalled: inject hard appointment block directly into leadContext
    // This is more reliable than the buildUserPrompt guard since we know neverReplied here
    if (neverReplied) {
      leadContext = '🚫 ZERO-CONTACT LEAD — APPOINTMENT ENGINE DISABLED\n'
        + 'This customer has NEVER replied to any outreach. Multiple attempts have been made.\n'
        + 'DO NOT include appointment times in ANY format. DO NOT say "would X or Y work". DO NOT mention duration. DO NOT say "get ahead of your schedule".\n'
        + 'EMAIL: Two short paragraphs. Warm reference to what they inquired about. End with ONE easy question about their search or interest. Nothing else.\n'
        + 'SMS: 3-4 sentences. Warm opener, one specific observation about the vehicle or their situation, one easy question. No appointment close.\n'
        + 'VOICEMAIL: Reference the vehicle. Say you wanted to connect. Leave number. End.\n'
        + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
        + leadContext;
    }
  }

  // Store
  let detectedStore = (d.dealerId && DEALER_ID_MAP[d.dealerId]) ? DEALER_ID_MAP[d.dealerId] : '';
  if (!detectedStore) detectedStore = resolveStore(d.store);
  if (!detectedStore) detectedStore = resolveStore(d.pageSnippet || '');
  if (detectedStore) setStore(detectedStore);

  // Auto-flags
  const ls = ((d.leadSource || '') + ' ' + (d.tradeDescription || '')).toLowerCase();
  if (d.hasTrade)                                              toggleFlag('trade', true);
  if (ls.includes('tradepending'))                             toggleFlag('trade', true);
  if (ls.includes('kbb') || ls.includes('kelley'))             toggleFlag('trade', true);
  const isLoyaltyLead = ls.includes('afs') || ls.includes('kmf') ||
      ls.includes('maturity') || ls.includes('lease end') || ls.includes('luv');
  if (isLoyaltyLead) {
    toggleFlag('loyalty', true);
    // Inject critical loyalty vehicle context — must override inventory status logic
    if (d.vehicle) {
      leadContext = '🔑 LOYALTY VEHICLE: "' + d.vehicle + '" is the customer\'s CURRENT OWNED VEHICLE — NOT dealership inventory. Never say it sold, is available, or check its inventory status.\n' + leadContext;
    }
  }
  if (ls.includes('capital one') || ls.includes('cap one'))    toggleFlag('credit', true);
  // Auto-detect credit sensitivity from customer's own words in inbound messages
  if (!activeFlags.has('credit') && d.lastInboundMsg && d.lastInboundMsg.length > 15) {
    // Only scan genuine customer messages — skip automated/system text
    var isAutomatedMsg = /automated response|we are not open|assurance that your request|working on your request|plugin\.tradepending|value-to-dealer|market report/i.test(d.lastInboundMsg);
    if(!isAutomatedMsg){
      var creditMention = /don.t have (good |great |perfect |the best )?credit|bad credit|no credit|poor credit|credit (is|isn.t|aint|ain.t)|low credit|credit score|credit challenge|working on (my |our )?credit|been denied|got denied|bankruptcy|repo|repossession|collections|it is what it is.*credit|credit.*it is what it is/i.test(d.lastInboundMsg);
      if(creditMention) toggleFlag('credit', true);
    }
  }
  // Auto-detect price gate from customer inbound price objection
  if (!activeFlags.has("price") && d.lastInboundMsg && d.lastInboundMsg.length > 10) {
    var priceObjection = /out.the.door|otd price|couldn.t reach.*agreement|price.*too high|too expensive|over.*budget|numbers.*not.*work|not.*work.*numbers|best.*price|lower.*price|better.*price|can.*do.*better|come down|negotiate|counter offer|upside down|negative equity|owe more than.*worth|underwater.*loan/i.test(d.lastInboundMsg);
    if(priceObjection) toggleFlag("price", true);
  }

  // Scan Gubagoo/chat lead data for credit signals
  if (!activeFlags.has("credit") && (ls.includes("chat") || ls.includes("gubagoo")) && d.context) {
    var chatCtx = d.context.toLowerCase().substring(0, 2000);
    if (/\brepo\b|\brepos\b|repossession|bankruptcy|bad credit|no credit|credit.*challenge|been denied|credit score|collections|low credit/i.test(chatCtx)) toggleFlag("credit", true);
  }

  // Enable generate button once we have something
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
    // Re-enable generate if we have data
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
  document.getElementById('wordCount').textContent = '—';
  const st = document.getElementById('crmStatus');
  if (st) { st.className = 'crm-status'; st.textContent = 'Open a VinSolutions lead to auto-fill.'; }
  const dot = document.getElementById('statusDot');
  if (dot) dot.classList.remove('active');
  const sb = document.getElementById('storeBadge');
  if (sb) { sb.textContent = 'Detecting store…'; sb.classList.remove('detected'); }
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
      'CRITICAL: Preserve ALL line breaks exactly as they appear in the original. The email signature must remain stacked on separate lines — do NOT join signature lines with commas.',
      'Return ONLY the translated text — no JSON, no labels, no extra commentary.',
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
    var raw = data.candidates[0].content.parts[0].text.trim();
    // Strip JSON wrapping if model returned structured output despite instructions
    try {
      var parsed = JSON.parse(raw);
      // Unwrap common nested structures
      if (typeof parsed === 'object') {
        raw = parsed.translation || parsed.text || parsed.message ||
              parsed.sms || parsed.email || parsed.voicemail ||
              parsed.body || parsed.content || raw;
      }
    } catch(e) {} // not JSON — use raw as-is
    // Strip markdown code fences if present
    raw = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'').trim();
    return raw;
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
    btn.textContent = 'Error — try again';
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
  statusEl.textContent = 'Scanning lead…';

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
  lastScrapedData = null; // clear so storage fallback isn't blocked by stale data
  tryExecuteScript(tab, statusEl, dot);

  // Safety net: if executeScript callback doesn't fire (channel closed),
  // content.js MutationObserver will have written data to storage — read it
  // Storage fallback — poll storage until data arrives or timeout
  // Popup may close/reopen so we can't rely on a single delayed timer
  var fallbackAttempts = 0;
  var fallbackMax = 24; // 24 x 500ms = 12 seconds total — longer for split-frame layouts
  function tryStorageFallback() {
    fallbackAttempts++;
    chrome.storage.local.get(['leadpro_data'], function(stored) {
      const m = stored && stored.leadpro_data;
      if (m && (m.name || m.vehicle) && m.totalNoteCount > 0) {
        console.log('[Lead Pro] Storage fallback triggered — attempt', fallbackAttempts, '| notes:', m.totalNoteCount, '| leadAgeDays:', m.leadAgeDays, '| isContacted:', m.isContacted, '| hasOutbound:', m.hasOutbound);
        lastScrapedData = m;
        const filled = populateFromData(m);
        if (filled > 0) {
          statusEl.className = 'crm-status found';
          statusEl.textContent = '✓ ' + m.totalNoteCount + ' notes';
          dot.classList.add('active');
        }
      } else if (fallbackAttempts < fallbackMax) {
        setTimeout(tryStorageFallback, 500);
      } else {
        console.log('[Lead Pro] Storage fallback exhausted after', fallbackAttempts, 'attempts');
      }
    });
  }
  setTimeout(tryStorageFallback, 1500); // first attempt after 1.5s
}

// ── Execute script scraper ────────────────────────────────────────
function tryExecuteScript(tab, statusEl, dot) {
  statusEl.textContent = 'Reading frames…';

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
    // dealerId from vindebug OR from eccs/index.html URL parameter
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

    // Also try to read store from eccs frame URL which contains dealerId
    // and from the URL parameters directly
    const storeFromUrl=(function(){
      try{
        // eccs frame URL contains the store context
        var u=window.location.href;
        if(/eccs\/index\.html/i.test(u)){
          // The eccs frame has the active tab in its parent - try parent access
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
      // Scan first 300 chars (page header) - Honda before Toyota
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
      // Broader scan 0-1500 chars
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
      // Buyer section fallback - "Buyer and Co-buyer Information: Buyer [Name]"
      qs('[class*="buyer-name"]'),
      qs('.buyerName'),
      // The vindebug div gives us customerId - try to find name near it
      (function(){
        // Text mine: "Customer Dashboard\nAbigail Paredones" pattern
        var m = TEXT.match(/Customer\s+Dashboard[\s\S]{0,50}?\n([A-Z][a-z\-]+ [A-Z][a-z\-]+(?:\s+[A-Z][a-z\-]+)?)\s*\n/);
        if(m) return m[1].trim();
        // "Buyer\n[Name]\n" pattern from Buyer section
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
    if(!phone){var phoneM=TEXT.match(/(?:Cell|Home|Work|Mobile|Day|Eve)[:\s]+([\(\d][\d\(\)\-\. ]{7,18})/i)||TEXT.match(/\((\d{3})\)\s*(\d{3})[-\s](\d{4})/);
      if(phoneM)phone=(phoneM[0]||'').replace(/^[^\d(]+/,'').trim().substring(0,20);}
    const agent=(function(){
      var a = firstOf([
        gid('ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedBDAgentLabel'),
        gid('ActiveLeadPanel1_m_CurrentAssignedBDAgentLabel'),
        qs('span[id*="BDAgentLabel"]'),
        qs('span[id*="AssignedBDAgent"]'),
        labelValue('BD Agent')
      ]);
      // Reject values that look like label text rather than actual names
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
    // Lead age from "Created: M/D/YY H:MMp (Nd)" pattern
    var leadAgeDays = 0;
    try {
      var createdText = labelValue('Created') || TEXT.match(/Created[:\s]+([^\n]{5,40})/i)?.[1] || '';
      var daysMatch = createdText.match(/\((\d+)d\)/i);
      if(daysMatch) leadAgeDays = parseInt(daysMatch[1]);
    } catch(e) {}
    // Scrape customer's current vehicle from service history (priority) or sales history
    // Also scrape AMP marketing email subject from Contact History for context
    var ownedVehicle = '';
    var ampEmailSubject = '';
    var ownedMileage = '';
    var lastServiceDate = '';
    try {
      // Priority 1: Y/M/M field in service repair order detail (most specific)
      var ymmMatch = TEXT.match(/Y\/M\/M[:\s]+(\d{4}\s+[A-Za-z][^\n]{3,40})/i);
      if(ymmMatch) ownedVehicle = ymmMatch[1].trim().substring(0,60);

      // Priority 2: Service history table - find table with RO# header
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

      // Priority 3: Sales history sold rows
      if(!ownedVehicle){
        var soldPat = /Sold\b[^\n]{0,120}?(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru)[^\n]{3,40})/i;
        var soldM = TEXT.match(soldPat);
        if(soldM) ownedVehicle = soldM[1].trim().replace(/\s+/g,' ').substring(0,60);
      }

      // Scrape AMP marketing email subject from Contact History section
      // Shows as "Marketing Campaign Email (subject: Refresh Your Higher-Mileage Vehicle, Wolf)"
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
    const stockNumRaw = tm([/Stock\s*#?[:\s]*([A-Z]{0,4}\d{3,8}[A-Z0-9]*)\b/i]);
    // Exclude 17-char VINs that may appear under "Stock #" in the Vehicle(s) of Interest panel
    const stockNum = (stockNumRaw && stockNumRaw.length < 15) ? stockNumRaw : '';
    const vin=tm([/\bVIN[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i]);
    // -- SRP-injected vehicle detection ----------------------------
    // Vehicles auto-assigned from search results pages are browsing references, not specific customer requests
    // -- Lead Response Velocity Governor ----------------------------
    // First response within 60 seconds of lead creation - suppress appointment engine
    var createdMatch = TEXT.match(/Created[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}[ap])/i);
    var isVelocityResponse = false;
    if(createdMatch) {
      var createdMs = new Date(createdMatch[1]).getTime();
      if(createdMs > 0 && (Date.now() - createdMs) < 90000) isVelocityResponse = true; // within 90 seconds
    }

    var isSRPVehicle = /top match auto.selected|automatically selected from.*inventory|initiated from[:\s]+(?:new-srp|srp|search.results)|search results page|vehicle added by system/i.test(TEXT.substring(0, 3000));

    // Inventory sold detection - TEXT-based only here; note scanning happens after noteEls is defined below
    const inventoryWarning = /no longer in your active inventory/i.test(TEXT);
    // No stock number AND no VIN = customer interested in model/trim but no specific unit selected
    const noSpecificVehicle = !!(vehicle && !stockNum && !vin && !inventoryWarning);
    const noVehicleAtAll = !vehicle && !stockNum && !vin; // No vehicle info at all - credit app only or browse lead
    // In-transit detection: VIN present but NO stock number, vehicle condition is New, Toyota store or Toyota vehicle
    const isToyotaStore = /toyota/i.test(store);
    const isToyotaVehicle = /toyota/i.test(vehicle || vehicleRaw || '');
    const isInTransit = !!(vin && !stockNum && condition === 'New' && (isToyotaStore || isToyotaVehicle) && !inventoryWarning);
    const leadSource=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1__LeadSourceName'),
      gid('ActiveLeadPanel1__LeadSourceName'),
      qs('span[id*="LeadSourceName"]'),
      labelValue('Source')
    ]);
        // Scrape Equity data from VinSolutions Key Information panel
    // Renders as: "Equity: ($25,374) 2023 Toyota Corolla Calculated: 03/09/2026"
    var equityData = '';
    var equityAmount = '';
    var equityVehicle = '';
    var equityDate = '';
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

    // Scrape AI Buying Signals from VinSolutions Key Information panel
    // DOM structure: #keyInfo-BuyingSignals-blurb = signal text, #keyInfo-BuyingSignals-date = date
    var buyingSignals = '';
    try {
      // Primary: exact IDs from the Key Information panel
      var bsBlurb = document.querySelector('#keyInfo-BuyingSignals-blurb, [id*="BuyingSignals-blurb"]');
      var bsDate  = document.querySelector('#keyInfo-BuyingSignals-date, [id*="BuyingSignals-date"]');
      if(bsBlurb) {
        var bsText = (bsBlurb.innerText||'').trim();
        var bsDateText = bsDate ? (bsDate.innerText||'').trim() : '';
        if(bsText) buyingSignals = bsText + (bsDateText ? ' (as of ' + bsDateText + ')' : '');
      }
      // Fallback 1: any buying-signals summary class
      if(!buyingSignals) {
        var bsEl = document.querySelector('[class*="buying-signals-summary"], [class*="buying-signal"], [id*="BuyingSignal"]');
        if(bsEl) buyingSignals = (bsEl.innerText||'').trim().substring(0,200);
      }
      // Fallback 2: scan Key Information section text
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
    // -- Contact recovery mode -------------------------------------
    var buyerEmail = (TEXT.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)||[''])[0].toLowerCase();
    var maskedDomains = ['anon.cargurus.com','relay.cargurus.com','privaterelay.appleid.com','marketplace.facebook.com'];
    var isMaskedEmail = maskedDomains.some(function(d){ return buyerEmail.indexOf(d) !== -1; });
    var directDomains = ['gmail.com','yahoo.com','icloud.com','outlook.com','hotmail.com','live.com','msn.com','aol.com','me.com','att.net','comcast.net'];
    var isDirectEmail = directDomains.some(function(d){ return buyerEmail.indexOf(d) !== -1; });
    var phonePattern = /(\d{3})[\s]?\d{3}[\s-]\d{4}|\d{3}[\s-]\d{3}[\s-]\d{4}/;
    var hasPhone = phonePattern.test(TEXT.substring(0,2000));
    var hasEmail = buyerEmail.length > 4;
    // Landline: only flag if notes explicitly say landline/cannot receive texts
    // Do NOT infer from Work/Home label — those are often cell numbers
    var isLandline = /landline|cannot receive.*message|unable to receive.*text|sms.*opt.out.*landline/i.test(TEXT);
    var contactRecoveryPhone = !hasPhone && hasEmail;
    var contactRecoveryEmail = isMaskedEmail || (!hasEmail && hasPhone);

    const noteEls = Array.from(document.querySelectorAll('.notes-and-history-item')||[]);
    const totalNoteCount = noteEls.length;

    // -- Agent LP commands - use MOST RECENT LP note only ----------
    // Notes are newest-first in VinSolutions DOM - stop at first LP note found
    var agentLPCommands = [];
    var lpNoteFound = false;
    for(var lpIdx = 0; lpIdx < noteEls.length; lpIdx++) {
      var lpNote = noteEls[lpIdx];
      // Expand collapsed notes before reading — VinSolutions collapses long notes with Show More
      var showMoreBtn = lpNote.querySelector('a.show-more, a.showMore, [class*="show-more"], [class*="showMore"], a[data-action="show-more"]');
      if(!showMoreBtn) {
        // Also try finding by text content
        var allLinks = lpNote.querySelectorAll('a, button, span[role="button"]');
        for(var smi=0; smi<allLinks.length; smi++){
          if(/(show more|show all|see more|expand)/i.test((allLinks[smi].innerText||'').trim())){
            showMoreBtn = allLinks[smi]; break;
          }
        }
      }
      if(showMoreBtn) { try { showMoreBtn.click(); } catch(e) {} }
      var c = ((lpNote.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      if(!c) c = ((lpNote.querySelector('.note-content')||{}).innerText||'').trim();
      if(!c) c = ((lpNote.querySelector('[class*="content"]')||{}).innerText||'').trim();
      if(!c) c = (lpNote.innerText||'').trim();
      if(!c) continue;
      var hasLP = false;
      // [LP: ...] bracket format
      var lpMatches = c.match(/\[LP:\s*([^\]]+)\]/gi);
      if(lpMatches) {
        lpMatches.forEach(function(m) {
          var cmd = m.replace(/^\[LP:\s*/i,'').replace(/\]$/,'').trim();
          if(cmd) { agentLPCommands.push(cmd); hasLP = true; }
        });
      }
      // bare LP: format - anywhere in note on its own line
      var lpLineMatch = c.match(/(?:^|\n)LP:\s*(.+)/i);
      if(lpLineMatch) {
        var bareCmd = lpLineMatch[1].trim();
        if(bareCmd) { agentLPCommands.push(bareCmd); hasLP = true; }
      }
      // Stop after first LP note found - most recent wins
      if(hasLP) { lpNoteFound = true; break; }
    }
    console.log('[Lead Pro] LP commands found:', agentLPCommands.length, agentLPCommands);

    // Also check agent notes for sold/pending-sold entries
    var inventoryWarningFromNotes = false;
    var vehiclePendingSale = false;
    noteEls.slice(0,10).forEach(function(n){
      var t = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var c = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
      if(/general note|vehicle/i.test(t)){
        if(/vehicle.*has been sold|has been sold|vehicle sold|unit.*sold|\bwas sold\b|\bwas SOLD\b|p\d+.*sold|sold!|stock.*sold/i.test(c)) inventoryWarningFromNotes = true;
        if(/process of being sold|in the process.*sold|being sold|pending.*sale|sold pending|may be sold|might be sold/i.test(c)) vehiclePendingSale = true;
      }
    });
    // Combine both detection methods
    var inventoryWarningFinal = inventoryWarning || inventoryWarningFromNotes;

    // -- Sanitizer --------------------------------------------------
    function sanitize(str) {
      return (str||'')
        .replace(/"/g, '\u201c').replace(/'/g, '\u2019')
        .replace(/\\/g, '/').replace(/[\r\n\t]+/g, ' ')
        .replace(/[^\x20-\x7E\u2018-\u201D]/g, '').trim();
    }

    // -- Full conversation transcript -------------------------------
    // JS extracts and labels. AI reads and understands.
    // Up to 25 entries. Skip pure noise. Full message content.
    const transcript = [];
    // Use lead created date as transcript cutoff - ignore history predating this lead
    // This prevents old lead history from bleeding into fresh lead responses
    var transcriptCutoffMs = Date.now() - (180 * 24 * 60 * 60 * 1000); // default 180 days
    try {
      var createdRaw = labelValue('Created') || TEXT.match(/Created[:\s]+([^\n]{5,40})/i)?.[1] || '';
      var createdDateMatch = createdRaw.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if(createdDateMatch) {
        var createdMs = new Date(createdDateMatch[1]).getTime();
        if(createdMs > 0) {
          // Set cutoff to lead created date minus 1 day buffer
          var leadCutoff = createdMs - (24 * 60 * 60 * 1000);
          // Only use lead date if it's more restrictive than 180 days
          if(leadCutoff > transcriptCutoffMs) transcriptCutoffMs = leadCutoff;
        }
      }
    } catch(e) {}
    noteEls.slice(0,25).forEach(function(item){
      var date    = ((item.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim(); // NOTE: 'hsitory' typo is intentional - matches VinSolutions DOM typo
      var title   = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
      var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      var dir     = (item.getAttribute('data-direction')||'').toLowerCase();
      if(/lead log/i.test(title) && /changed from/i.test(content) && content.length < 100) return;
      // Skip SMS opt-out status notes and old STOP messages - a new lead submission overrides prior opt-outs
      if(/sms status/i.test(title) && /opt.?out/i.test(content)) return;
      // Skip Cars.com/third-party shopper alert data - contains "still shopping", "our last update" etc
      // that makes the AI think there's prior history when this may be a fresh lead
      if(/lead received/i.test(title) && /cars\.com|shopper alert|still actively shopping|comparing dealerships|since our last update/i.test(content)) return;
      if(!title && !content) return;
      // Strip system data dumps from transcript entirely - TradePending/KBB valuation reports,
      // lead received data, and automated responses contain market data, credit scores, and
      // dollar amounts that the AI misreads as customer concerns
      var isDataDump = /value-to-dealer|market report|plugin\.tradepending|tradepending\.com|kelley blue book|kbb\.com|market size.*within|estimated.*miles.*value|landing page.*phone|automated response|we are not open for business|assurance that your request|we are working on your request/i.test(content);
      var isLeadReceived = /lead received/i.test(title);
      // Exception: Gubagoo SMS/chat transcripts are embedded in the lead received note
      // Extract and preserve the conversation before stripping the note
      if(isLeadReceived && content) {
        // Detect chat transcript pattern: "timestamp (customer): message"
        var hasChatTranscript = /\d{10}\s*\(\d{2}\/\d{2}\/\d{2}.*?\):|Lead Type.*sms.chat|Lead Type.*chat/i.test(content);
        if(hasChatTranscript) {
          // Extract customer messages from the chat
          var chatLines = content.split(/\n|(?=\d{10}\s*\()/).map(function(l){return l.trim();}).filter(Boolean);
          var chatOut = [];
          chatLines.forEach(function(line){
            // Customer messages: phone number (timestamp): message
            var custMatch = line.match(/^\d{10}\s*\([^)]+\):\s*(.+)/);
            if(custMatch && !/chat started|all notification|send stop|by texting|sure! i|could i please|thank you.*our sales|is there anything/i.test(custMatch[1])){
              chatOut.push('[CUSTOMER] ' + custMatch[1].trim());
            }
            // Subject line has the first message
            var subjectMatch = line.match(/Subject:\s*(.+)/i);
            if(subjectMatch) chatOut.push('[CHAT SUBJECT] ' + subjectMatch[1].trim());
          });
          if(chatOut.length) {
            transcript.push('[' + date + '] [GUBAGOO CHAT] Chat transcript:\n  ' + chatOut.join('\n  '));
          }
        }
      }
      var isAutoResponse = /email auto response|auto response/i.test(title) || (/email/i.test(title) && /welcome to community|thank you for your inquiry|your request was received/i.test(content));
      // Also catch TradePending/KBB data by content pattern - in case title varies
      var isValuationContent = /value-to-dealer|market report|plugin\.tradepending|tradepending\.com|value to dealer|market size.*within|installed from.*landing page|view market report/i.test(content);
      // Catch automated system outbound texts
      var isSystemOutbound = /automated response|we are not open for business|assurance that your request|we are currently working/i.test(content);
      if(isDataDump || isLeadReceived || isAutoResponse || isValuationContent || isSystemOutbound) return; // strip entirely from transcript
      var who = dir==='inbound' ? 'CUSTOMER' : dir==='outbound' ? 'AGENT' : 'NOTE';
      transcript.push('[' + date + '] [' + who + '] ' + title + '\n  ' + sanitize(content||'(no content)'));
    });
    const history = transcript.join('\n');
    // Apply transcript cutoff to ALL leads - filter out notes predating the current lead
    // This prevents old "not interested" messages from bleeding into fresh inquiries
    var isAIBuyingSignalSource = /ai buying signal/i.test(leadSource||'');
    var recentHistory = transcript.filter(function(line){
      var dateMatch = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if(dateMatch) {
        var lineMs = new Date(dateMatch[1]).getTime();
        if(lineMs > 0 && lineMs < transcriptCutoffMs) return false;
      }
      return true;
    }).join('\n');
    if(isAIBuyingSignalSource) {
      // For AI buying signal leads: also exclude outbound marketing blasts
      recentHistory = transcript.filter(function(line){
        var dateMatch = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if(dateMatch) {
          var lineMs = new Date(dateMatch[1]).getTime();
          if(lineMs > 0 && lineMs < transcriptCutoffMs) return false;
        }
        // Content filter - exclude mass marketing blasts
        var isMarketingBlast = /reply stop to cancel|reply stop to unsubscribe|0% apr|0\s*%\s*apr|new beginnings|savings event|anniversary sale|red tag|summer sale|spring event|click here to|shop now|view inventory|utm_source|utm_medium|utm_campaign/i.test(line);
        if(isMarketingBlast) return false;
        return true;
      }).join('\n') || '(No recent personal conversation - this is a re-engagement based on buying signal data only. Do not reference any marketing emails or blasts.)';
    }

    // -- Binary follow-up signals - JS detects, AI interprets ------
    const hasOutbound = noteEls.some(function(item){
      var dir = (item.getAttribute('data-direction')||'').toLowerCase();
      var title = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var msgContent = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
      // Only count real agent communication - not lead logs, system notes, or bad lead markers
      var isRealMessage = /outbound text|outbound phone|email reply|outbound email/i.test(title);
      // Exclude automated system messages - these are NOT real agent outreach
      var isAutomated = /automated response|we are not open for business|assurance that your request|we are currently working on your request|thank you.*inquiry.*community|this automated response/i.test(msgContent);
      return dir === 'outbound' && isRealMessage && !isAutomated;
    });
    const contactedEl = document.querySelector('[id*="CustomerContacted"]');
    const contactedRaw = contactedEl ? (contactedEl.innerText || '') : '';
    // VinSolutions renders contacted age inline: "Yes (4.88wk)" or "Yes (12d)"
    // A "Contacted: Yes" that is 14+ days old is STALE - the lead has gone cold.
    // Parse the age and expire isContacted after 14 days so stalled detection can fire.
    var contactedAgeDays = 0;
    try {
      var wkMatch  = contactedRaw.match(/\(([\d.]+)wk\)/i);
      var dayMatch = contactedRaw.match(/\((\d+)d\)/i);
      var hrMatch  = contactedRaw.match(/\((\d+):(\d+)\)/);  // e.g. "(3:03)" = 3h 3m ago
      if (wkMatch)       contactedAgeDays = parseFloat(wkMatch[1]) * 7;
      else if (dayMatch) contactedAgeDays = parseInt(dayMatch[1]);
      else if (hrMatch)  contactedAgeDays = 0.1; // hours old = same day = very fresh, well under 14d
    } catch(e) {}
    var CONTACTED_STALE_DAYS = 14; // contacts older than 2 weeks don't block stalled flag
    // contactedAgeDays === 0 means format unrecognized - treat as fresh (safe default)
    const isContacted = /yes/i.test(contactedRaw) && (contactedAgeDays === 0 || contactedAgeDays < CONTACTED_STALE_DAYS);

    // Exit/pause - scan recent transcript + page text
    // Exit/pause - scan INBOUND customer messages only (not agent outbound which has compliance footers like "Reply STOP to cancel")
    // Use cutoff-filtered transcript for exit/pause signal scanning
    // This prevents old "not interested" messages from 2024 poisoning fresh 2026 leads
    var filteredTranscript = transcript.filter(function(line){
      var dateMatch = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if(dateMatch) {
        var lineMs = new Date(dateMatch[1]).getTime();
        if(lineMs > 0 && lineMs < transcriptCutoffMs) return false;
      }
      return true;
    });
    const recentInbound = filteredTranscript.filter(function(t){ return t.indexOf('[CUSTOMER]') !== -1; }).slice(0,5).join(' ').toLowerCase();
    const recentTranscript = filteredTranscript.slice(0,5).join(' ').toLowerCase();
    const fullScanText = (recentInbound + ' ' + recentTranscript).toLowerCase();
    // Exit signal detection - customer bought elsewhere or is no longer interested
    // GUARDS: exclude trade-in ownership language ("we bought it brand new", "bought it new")
    // and conditional trade language ("I'll keep it if the offer is too low")
    var exitRaw = /already bought|bought.*something|bought.*elsewhere|purchased.*already|going.*elsewhere|not interested|not ever interested|never going back|will not be back|will never go back|won.t be back|never coming back|remove.*from.*list|stop.*contacting|decided to (buy|go with|purchase)|went with (another|a different|ford|chevy|toyota|kia|nissan|hyundai|chevrolet|gmc|ram|jeep|dodge|subaru|mazda|volvo|bmw|mercedes|lexus|acura|infiniti|cadillac|lincoln|buick)|found (one|a car|what we)|no longer (interested|looking|in the market)|took (a|the) (deal|offer) (at|from|with)|not satisfied.*process|bad experience|sharing.*bad.*experience|terrible.*experience|horrible.*experience/i.test(fullScanText);
    // "we bought" / "bought it" - only exit if followed by purchase context, not ownership history
    var boughtElsewhere = /we (bought|purchased|went with|decided on).{0,30}(another|elsewhere|different|other dealer|from them|from there)/i.test(fullScanText)
      || /bought (one|a car|a vehicle) (from|at|with)/i.test(fullScanText);
    var keepingTrade = /keep it if|keep my (car|truck|suv|altima|camry|vehicle)|hold onto it|just keep (it|my)/i.test(fullScanText);
    // Re-engagement override: if customer sent an active message AFTER the exit signal, cancel exit
    // e.g. "I am still on the hunt" after "no longer interested" = re-engaged
    var recentCustomerActive = /still (on the hunt|looking|interested|searching|in the market)|still want|still need|haven.t found|haven.t bought|still shopping|changed my mind|reconsidering|actually.*interested|would like to|still considering/i.test(recentInbound);
    const hasExitSignal = (exitRaw || boughtElsewhere) && !keepingTrade && !recentCustomerActive;
    const hasPauseSignal = !hasExitSignal && /taking a break|no luck|need time|not ready|still looking|need to think|not able to upgrade|not looking to upgrade|too early|just got|only have \d+k|low miles/i.test(fullScanText);

    // Detect live/hot conversation - inbound reply within last few hours = customer is actively engaged
    var isLiveConversation = false;
    var isRecentOutbound = false;  // agent sent something very recently (within 60 min)
    var recentOutboundContent = '';
    var todayMsLive = Date.now();
    for(var li=0; li<Math.min(3, noteEls.length); li++){
      var lDir = (noteEls[li].getAttribute('data-direction')||'').toLowerCase();
      if(lDir === 'inbound'){
        var lDate = ((noteEls[li].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var lMs = lDate ? new Date(lDate).getTime() : 0;
        if(lMs > 0 && (todayMsLive - lMs) < 8 * 60 * 60 * 1000) { // within 8 hours (same business day)
          isLiveConversation = true;
        }
        break;
      }
    }
    // Detect very recent outbound - agent sent a message within the last 60 minutes
    // This means any new generation should be consistent with what was already sent
    for(var roi=0; roi<Math.min(5, noteEls.length); roi++){
      var roDir = (noteEls[roi].getAttribute('data-direction')||'').toLowerCase();
      var roTitle = ((noteEls[roi].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var isRealOutbound = /outbound text|outbound email|email reply/i.test(roTitle);
      if(roDir === 'outbound' && isRealOutbound){
        var roDate = ((noteEls[roi].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var roMs = roDate ? new Date(roDate).getTime() : 0;
        if(roMs > 0 && (todayMsLive - roMs) < 60 * 60 * 1000){ // within 60 minutes
          isRecentOutbound = true;
          recentOutboundContent = ((noteEls[roi].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim().substring(0,300);
        }
        break;
      }
    }
    var isSpanishSpeaker = false; // Spanish detection removed - use translate button

    var customerSaidNotToday = false;
    var customerScheduleConstraint = ''; // captures recurring schedule blocks
    // Scan last 5 notes for timing constraints - INBOUND CUSTOMER MESSAGES ONLY
    // Skip system-generated notes even if tagged as inbound (lead received, TradePending data dumps)
    for(var nti=0; nti<Math.min(5, noteEls.length); nti++){
      var ntDir = (noteEls[nti].getAttribute('data-direction')||'').toLowerCase();
      var ntTitleCheck = ((noteEls[nti].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var isInboundNote = ntDir === 'inbound' || /inbound text|inbound sms|text message.*inbound|inbound.*text/i.test(ntTitleCheck);
      if(isInboundNote){
        var ntTitle = ((noteEls[nti].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var ntRawText = ((noteEls[nti].querySelector('.notes-and-history-item-content')||{}).innerText||'');
        // Skip system/automated inbound notes - these are data dumps not customer messages
        var ntIsSystem = /lead received|email auto response|auto response|system/i.test(ntTitle)
          || /value-to-dealer|market report|tradepending|plugin\.tradepending|kelley blue|kbb\.com|estimated.*miles.*value|market size.*within|automated response|we are not open|assurance that your request/i.test(ntRawText.substring(0,300));
        if(ntIsSystem) continue; // skip this note, check next one
        var ntText = ntRawText.toLowerCase();
        // Explicit same-day block
        if(/not today|can.t today|busy today|can.t make it today|no today|not available today|working today|at work today|won.t be able.*today|not.*able.*come.*today|not.*able.*out.*today|can.t come.*today|don.t think.*today|unable.*today|not going to make it today|won.t make it today|can.t.*today|not.*coming.*today|won.t be.*today|don.t think i.ll be able|i will call|i'll call|will call.*when|call.*when.*ready|not available today/i.test(ntText)){
          customerSaidNotToday = true;
        }
        // Customer specifies a future day as their availability - lock onto that day
        // e.g. "I won't be able to until Saturday", "can't until Friday", "not until next week"
        var futureDayMatch = ntText.match(/(?:until|till|on|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
          || ntText.match(/(?:won.t|can.t|cannot|not able|unable).{0,20}(?:until|till)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
          || ntText.match(/(saturday|sunday|monday|tuesday|wednesday|thursday|friday)\s+(?:works?|is\s+better|only|available)/i);
        if(futureDayMatch && !customerScheduleConstraint) {
          var specificDay = (futureDayMatch[1] || futureDayMatch[2] || '').toLowerCase();
          specificDay = specificDay.charAt(0).toUpperCase() + specificDay.slice(1);
          customerSaidNotToday = true;
          customerScheduleConstraint = 'CUSTOMER SPECIFIED DAY: Customer said ' + specificDay + ' is when they are available. LOCK IN ' + specificDay + ' - do NOT offer any other day. Offer two specific times on ' + specificDay + ' only. Do NOT try to pull them in sooner.';
        }
        // Customer states arrival time - e.g. "I get off at 6", "done at 5:30", "arrive around 7"
        var arrivalMatch = ntText.match(/(?:get off|off work|done|finish|out|arrive|be there|come by|stop by|swing by)(?:\s+(?:at|by|around|after))?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
        if(arrivalMatch && !customerScheduleConstraint) {
          customerScheduleConstraint = 'CUSTOMER ARRIVAL TIME: Customer said they arrive/get off around ' + arrivalMatch[1] + '. Offer appointment times AFTER this time - not before. Example: if they arrive at 6:30 PM, offer 6:45 PM and 7:15 PM or similar evening slots within store hours.';
        }
        // Out of town / travel / away - customer is unavailable until a future date
        var outOfTownMatch = ntText.match(/out of town until ([^.\n,]{3,25})|back (in town|home|around) (on |by )?([^.\n,]{3,20})|away until ([^.\n,]{3,20})|traveling until ([^.\n,]{3,20})|won.t be (back|available|around) until ([^.\n,]{3,20})/i);
        if(outOfTownMatch){
          var returnDay = (outOfTownMatch[1] || outOfTownMatch[4] || outOfTownMatch[5] || outOfTownMatch[6] || outOfTownMatch[9] || 'later this week').trim();
          customerSaidNotToday = true; // blocks same-day
          customerScheduleConstraint = 'OUT_OF_TOWN: Customer is out of town and returns ' + returnDay + '. Do NOT offer any times before their return. Schedule around: ' + returnDay;
        }
        // Recurring schedule constraints - work mornings, nights, weekdays, shift work, etc.
        var hasScheduleBlock = /i work (in the |the )?(morning|afternoon|evening|night|weekend|weekday)|work morning|morning.*work|work.*morning|work (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|busy (morning|afternoon|evening)|tied up.*morning|morning.*tied up/i.test(ntText);
        if(hasScheduleBlock){
          var constraintMatch = ntText.match(/.{0,50}(work|busy|tied up).{0,60}/i);
          customerScheduleConstraint = constraintMatch ? constraintMatch[0].trim() : ntText.substring(0,100);
        }
        // Direct time-of-day preference — customer replies with just "morning" or "afternoon"
        // e.g. "Morning please" "morning works" "afternoon is better" "evening preferred"
        if(!customerScheduleConstraint) {
          var todPref = ntText.match(/^(morning|afternoon|evening|night)/i)
            || ntText.match(/(morning|afternoon|evening)\s+(?:please|works|is better|preferred|only|time)/i)
            || ntText.match(/prefer(?:red|s)?\s+(?:the\s+)?(morning|afternoon|evening)/i);
          if(todPref) {
            var tod = (todPref[1] || todPref[2] || '').toLowerCase();
            var todMap = {
              'morning':   'MORNING PREFERENCE: Customer said they prefer morning. Offer times between 9:00 AM and 12:00 PM ONLY. Do NOT offer afternoon or evening times.',
              'afternoon': 'AFTERNOON PREFERENCE: Customer said they prefer afternoon. Offer times between 12:00 PM and 5:00 PM ONLY. Do NOT offer morning times.',
              'evening':   'EVENING PREFERENCE: Customer said they prefer evening. Offer times after 5:00 PM ONLY. Do NOT offer morning or early afternoon times.',
              'night':     'EVENING PREFERENCE: Customer said they prefer evening. Offer times after 5:00 PM ONLY.'
            };
            customerScheduleConstraint = todMap[tod] || 'TIME PREFERENCE: Customer said ' + tod + '. Match appointment times to this preference.';
          }
        }
        break;
      }
    }

    // Conversation state label
    // IMPORTANT: base on hasRealOutbound/isContacted NOT totalNoteCount
    // System notes (lead received, auto-response, TradePending) inflate totalNoteCount
    // on fresh leads making them appear as follow-ups when no agent has ever contacted the customer
    var convState = 'first-touch';
    if(hasExitSignal) {
      convState = 'exit';
    } else if(hasPauseSignal) {
      convState = 'pause';
    } else if(hasOutbound || isContacted) {
      // Only move to follow-up state if a real agent outbound exists or contact was confirmed
      var hasNegTag = noteEls.slice(0,10).some(function(item){ return /negative|pricing/i.test(item.innerHTML||''); });
      if(hasNegTag)          convState = 'negative-reply';
      else if(totalNoteCount > 4 && hasOutbound) convState = 'active-follow-up';
      else                   convState = 'first-follow-up';
    }
    // convState stays 'first-touch' if no real agent contact exists

    // Conversation header passed to AI
    var conversationBrief = '';
    // For Gubagoo SMS/chat leads: inject chat transcript into brief even on first-touch
    // The chat happened BEFORE the lead was created — it IS the first contact
    var gubogooChatEntry = transcript.filter(function(t){ return t.indexOf('[GUBAGOO CHAT]') !== -1; });
    if(gubogooChatEntry.length) {
      conversationBrief = 'CHAT TRANSCRIPT (customer already spoke with the chat bot — read this before writing):\n' + gubogooChatEntry.join('\n');
    }
    if(convState !== 'first-touch'){
      var stateLabel = {
        'exit':             'EXIT SIGNAL: customer purchased elsewhere or is not interested. Write a gracious close only.',
        'pause':            'PAUSE SIGNAL: customer needs more time. Empathetic check-in only. No appointment pressure.',
        'negative-reply':   'NEGATIVE/PRICING REPLY: customer expressed concern. Address it directly in opening.',
        'active-follow-up': 'FOLLOW-UP: read the full transcript and write a response that directly continues THIS conversation.',
        'first-follow-up':  'FOLLOW-UP: first outreach was made. Read the transcript and write a relevant continuation.'
      }[convState] || 'FOLLOW-UP';

      // Extract the single most important customer signal from inbound messages
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
        // Suppress keySignal for stale single-char replies (e.g. "C" confirming a weeks-old appointment)
        // These are not live conversation signals - injecting them as CRITICAL context misleads the AI
        var mostRecentInbound = inboundMsgs[0].trim();
        var isStaleReply = mostRecentInbound.length <= 2; // "C", "Y", "ok" etc - likely a past appt confirm
        // Also suppress if the reply is older than 7 days (stale even if longer text)
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

      // -- Customer concern extractor -------------------------------
      // Scans RECENT transcript only (last 180 days) for friction signals.
      // Old notes (mass marketing texts, ancient history) should not drive current messaging.
      var customerConcerns = [];
      var cutoffMs = Date.now() - (180 * 24 * 60 * 60 * 1000); // 180 days
      var recentTranscriptLines = transcript.filter(function(line){
        var dateMatch = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4}[^\]]*)\]/);
        if(!dateMatch) return true; // keep if no date parseable
        var lineMs = new Date(dateMatch[1]).getTime();
        return lineMs > 0 ? lineMs >= cutoffMs : true;
      });
      // CRITICAL: Exclude system notes, lead received data dumps, auto-responses, and
      // TradePending/KBB valuation text from concern scanning - these contain vehicle
      // market data with prices, "sold" comparables, and other text that falsely triggers
      // credit, trade, price, and shift worker detectors
      var concernScanLines = recentTranscriptLines.filter(function(line){
        var isSystemNote = /\[NOTE\].*(?:lead received|email auto response|lead log|system|tradepending|kbb|kelley|market report|value-to-dealer|market size|landing page|plugin\.tradepending|automated response|we are not open)/i.test(line);
        return !isSystemNote;
      });
      var allTranscriptText = concernScanLines.join(' ');
      var customerOnlyText = concernScanLines.filter(function(line){
        return line.indexOf('[CUSTOMER]') !== -1;
      }).join(' ');

      if(/too (much|high|expensive)|can.t afford|out of (my |our )?budget|payment.*too|over.*budget|price.*concern|what.s the (price|payment|cost)|how much (is|would)|monthly payment|out the door/i.test(allTranscriptText)){
        customerConcerns.push('PRICE/PAYMENT CONCERN: Customer raised price or payment as an issue. Open by addressing this directly - not by pitching features.');
      }
      if(/(wife|husband|spouse|partner)|run it by|talk (to|with) (my|the)|need to discuss|bring (him|her|them)/i.test(allTranscriptText)){
        customerConcerns.push('SPOUSE/PARTNER INVOLVED: Customer mentioned needing to involve their spouse or partner. Invite both in or offer to answer questions they might have for their partner.');
      }
      if(/not ready|not right now|give me (a few|some) (days|weeks|time)|check back|hold off|wait (a|until|till)|saving up|few months|next month|after (the|my)/i.test(allTranscriptText)){
        customerConcerns.push('TIMING HESITATION: Customer indicated they are not ready yet. Acknowledge the timing, keep the door open, and give ONE specific reason to act now - not a pressure tactic.');
      }
      var colorMatch = allTranscriptText.match(/(white|black|silver|gray|grey|blue|red|green|brown|beige|pearl|sonic gray|platinum|lunar silver)/i);
      var trimMatch = allTranscriptText.match(/(ex-?l|sport|touring|lx|ex|elite|awd|fwd|4wd|hybrid|plug-?in)/i);
      if(colorMatch) customerConcerns.push('COLOR PREFERENCE: Customer mentioned ' + colorMatch[0] + '. Match this in your message or acknowledge availability honestly.');
      if(trimMatch) customerConcerns.push('TRIM/CONFIG PREFERENCE: Customer referenced ' + trimMatch[0] + '. Reference this specifically - do not pitch a different trim without reason.');
      if(/trade.?(in|value|worth|get|offer)|what.*get for|how much.*trade|payoff|owe on/i.test(allTranscriptText)){
        customerConcerns.push('TRADE-IN CONCERN: Customer mentioned their trade. Use it as the hook - lead with the trade value conversation, not the vehicle pitch.');
      }
      if(/credit|financing|pre.?approv|interest rate|down payment|how much down/i.test(allTranscriptText)){
        customerConcerns.push('FINANCING CONCERN: Customer raised credit or financing. Acknowledge that the visit is the easiest way to get real numbers - keep it low pressure.');
      }
      if(/don.t have (good|great|perfect|the best)? credit|bad credit|no credit|poor credit|credit (is|isn.t|aint)|low credit score|been denied|got denied|bankruptcy|repo|repossession|it is what it is.*credit/i.test(customerOnlyText)){
        customerConcerns.push('CREDIT CHALLENGE DISCLOSED: Customer explicitly stated they have credit difficulties. Handle with empathy - NEVER say "no problem" or "we work with all credit" (sounds dismissive). Say: "We work through situations like this every day - let us look at the options together." Position the visit as where real answers happen, not a pre-approval guarantee.');
      }
      if(/co.?sign|cosign|co.?buyer|adding.*someone|need.*someone.*on.*loan|second.*person.*sign/i.test(customerOnlyText)){
        customerConcerns.push('CO-SIGNER NEEDED: Customer mentioned needing a co-signer or co-buyer. Both people must be present at signing. Invite both in together - do not push solo visit. Say: \'We will need both of you here to finalize everything.\'');
      }

      // -- Friction type: Spouse/partner approval needed ------------
      if(/run it by|talk (to|with) (my|the) (wife|husband|spouse|partner|boyfriend|girlfriend|mom|dad|father|mother)|need to (check|ask|discuss)|wife.*know|husband.*know|partner.*know|not my decision alone|need approval/i.test(customerOnlyText)){
        customerConcerns.push('SPOUSE/PARTNER APPROVAL: Customer needs to consult their partner before deciding. Apply TIER 2 CLOSE - do NOT push for same-day commitment. Instead invite both: "Bring them along - the more the merrier, and it only takes 30-45 minutes." Or ask: "When could you both come in together?"');
      }

      // -- Friction type: Comparison shopping ----------------------
      if(/looking at (a few|other|another|some other|multiple)|comparing|checking out (other|a few|another)|shop(ping)? around|other dealer|other options|see what else|not just here/i.test(customerOnlyText)){
        customerConcerns.push('COMPARISON SHOPPING: Customer is actively comparing options. Apply TIER 2 CLOSE - do NOT push appointment before earning the visit. Give them ONE concrete reason this vehicle/dealership wins: price confidence, availability, CPO warranty, or response speed. Then ask what matters most to them.');
      }

      // -- Friction type: Timeline vague / not urgent ---------------
      if(/not in a rush|no hurry|whenever|eventually|down the road|maybe next month|few months|next year|not right now|when the time (is right|comes)|not urgent/i.test(customerOnlyText)){
        customerConcerns.push('TIMELINE: Customer is not in a rush. Apply TIER 3 CLOSE - soft ask only. Do NOT push urgency that feels fake. Instead acknowledge their pace: "No pressure at all - when you are ready, I will have everything waiting for you." Then ask: "What is your rough timeframe so I can keep an eye on inventory for you?"');
      }

      // -- Friction type: Feature/fit uncertainty -------------------
      if(/not sure (if|whether|it has|this has)|does it have|wondering if|need to know if|want to make sure|confirm.*features|check.*features|see.*features/i.test(customerOnlyText)){
        customerConcerns.push('FEATURE UNCERTAINTY: Customer is not sure this vehicle meets their needs. Apply TIER 2 CLOSE - answer their question or invite them to see it in person: "The best way to know for sure is to see it - I can walk you through every feature." Do NOT push appointment before addressing their uncertainty.');
      }

      // -- Customer commitment detector ----------------------------
      // Scans recent inbound messages for explicit commitments or open questions
      var customerCommitments = [];
      var recentInboundText = inboundMsgs.slice(0,3).join(' ').toLowerCase();

      // Explicit day/time commitment
      var dayCommit = recentInboundText.match(/i.ll (come|be there|stop|come in|swing by|head over).{0,30}(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|this week|after work|in the morning|in the afternoon)/i)
        || recentInboundText.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow).{0,20}work(s)? for me/i)
        || recentInboundText.match(/i can (make it|come in|be there).{0,30}/i);
      if(dayCommit) customerCommitments.push('CUSTOMER COMMITTED: Customer said they would come in - "' + dayCommit[0].trim().substring(0,80) + '". Hold them to it. Reference this commitment directly: "You mentioned [day] works - I wanted to confirm we have everything ready for you."');

      // Waiting on information from dealer
      var waitingOn = recentInboundText.match(/send (me |over )?(the )?(price|numbers|info|details|photos|link|payment|payoff|trade)/i)
        || recentInboundText.match(/let me know (the |what |if ).{0,40}/i)
        || recentInboundText.match(/what (is|are|would) (the |my )?(price|payment|trade|payoff|interest rate|down)/i)
        || recentInboundText.match(/do you have (it in|one in|any in).{0,30}/i);
      if(waitingOn) customerCommitments.push('OPEN QUESTION FROM CUSTOMER: Customer asked - "' + waitingOn[0].trim().substring(0,80) + '". ANSWER THIS FIRST before asking for an appointment. Do not ignore an unanswered question.');

      // Decision pending on something specific
      var pendingDecision = recentInboundText.match(/i.ll (think about it|check|talk to|ask|decide|let you know|get back to you).{0,40}/i)
        || recentInboundText.match(/need to (check|talk|ask|think|discuss).{0,40}/i);
      if(pendingDecision) customerCommitments.push('PENDING DECISION: Customer said - "' + pendingDecision[0].trim().substring(0,80) + '". Acknowledge where they left off. Do not skip past this - ask if they had a chance to [check/talk/decide].');

      var commitmentBlock = customerCommitments.length > 0
        ? '\n! CUSTOMER COMMITMENTS / OPEN ITEMS - address these FIRST:\n' + customerCommitments.join('\n')
        : '';

      var concernBlock = customerConcerns.length > 0
        ? '\nIDENTIFIED CUSTOMER CONCERNS - lead with these, do not bury them:\n' + customerConcerns.join('\n')
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

    // Last inbound/outbound for fallback context
    let lastOutboundMsg = '';
    for(var ni=0;ni<noteEls.length;ni++){
      var niDateText = ((noteEls[ni].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      var niDateMs = niDateText ? new Date(niDateText).getTime() : 0;
      if(niDateMs > 0 && niDateMs < transcriptCutoffMs) continue;
      if((noteEls[ni].getAttribute('data-direction')||'').toLowerCase()==='outbound'){
        lastOutboundMsg=((noteEls[ni].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim().substring(0,300);
        break;
      }
    }
    if(!lastOutboundMsg){ var om=TEXT.match(/(?:Sent by:[^\n]*\n)([^\n]{20,300})/); if(om) lastOutboundMsg=om[1].trim(); }

    let lastInboundMsg = '';
    for(var ii=0;ii<noteEls.length;ii++){
      var iiDir = (noteEls[ii].getAttribute('data-direction')||'').toLowerCase();
      var iiTitle = ((noteEls[ii].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      // Skip system-generated inbound notes - lead received, auto-responses, TradePending data dumps
      var isSystemInbound = /lead received|email auto response|auto response|system/i.test(iiTitle);
      // Skip notes older than transcript cutoff - prevents ancient customer messages from bleeding in
      var iiDateText = ((noteEls[ii].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      var iiDateMs = iiDateText ? new Date(iiDateText).getTime() : 0;
      if(iiDateMs > 0 && iiDateMs < transcriptCutoffMs) continue;
      if(iiDir === 'inbound' && !isSystemInbound){
        var iiContent = ((noteEls[ii].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
        // Skip TradePending/KBB data dumps even if tagged as inbound
        var isDataDump = /value-to-dealer|market report|tradepending|plugin\.tradepending|kelley blue|kbb\.com|estimated.*miles.*value|market size.*within/i.test(iiContent);
        if(!isDataDump){
          lastInboundMsg = iiContent.substring(0,200);
          break;
        }
      }
    }
    if(!lastInboundMsg){ var im=TEXT.match(/(?:Text Message Reply Received|Inbound Text|Customer replied)[:\s]*([^\n]{10,200})/i); if(im) lastInboundMsg=im[1].trim(); }

    // -- Gubagoo VR deal status scraping ----------------------------------
    // Parse lead received note to find what customer actually completed vs skipped
    var vrCreditApp = false, vrPaymentSelected = false, vrTradeIn = false;
    var vrCompleted = false, vrDroppedOff = false;
    noteEls.forEach(function(n) {
      var t = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var c = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'');
      if (/lead received/i.test(t) && /gubagoo|virtual retail/i.test(c)) {
        vrCreditApp = /Credit App[sS]{0,5}(Started|Submitted|Complete)/i.test(c) && !/Credit App[sS]{0,5}Not Started/i.test(c);
        vrPaymentSelected = /Payment[:s]*$[d,]+/i.test(c) && !/No Payment selected/i.test(c);
        vrTradeIn = /Trade-In Vehicle[:s]*[A-Z0-9]/i.test(c);
        vrCompleted = /Customer completed VR deal/i.test(c);
        vrDroppedOff = /Dropped off on page/i.test(c);
      }
    });

    // -- Showroom visit detection -----------------------------------
    // Only count RECENT showroom visits (within ~7 days) - old visits shouldn't override current appointment
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
    // Walk-in / drive-by lead sources are always showroom follow-ups by definition
    var isWalkInSource = /walk.?in|drive.?by|walkin|showroom inquiry/i.test((leadSource||'').toLowerCase());
    const isShowroomFollowUp = recentShowroomVisit || isWalkInSource || (/showroom\s*visit\s*follow\s*up/i.test(processText) && recentShowroomVisit);

    // -- Appointment status - live status field + outbound text content -
    // Check status dropdown, status label, AND scan recent outbound messages for appointment times
    const apptStatusEl = document.querySelector('select[id*="Status"]');
    const statusDropdownVal = apptStatusEl ? (apptStatusEl.value || apptStatusEl.innerText || '') : '';
    const statusLabelEl2 = document.querySelector('[id*="LeadStatusLabel"]');
    const statusLabelVal = statusLabelEl2 ? (statusLabelEl2.innerText || '') : '';
    const currentStatus = (statusDropdownVal + ' ' + statusLabelVal).toLowerCase();

    // Appointment detection: check status field AND scan recent outbound messages
    var hasApptSet = /appointment made|appt made|appointment set/i.test(currentStatus);
    var apptDetails = '';
    var hasMissedAppt = false;

    // Also check for VinSolutions auto-generated appointment boarding pass email
    // IMPORTANT: Only treat as active appointment if boarding pass is recent (within 48h)
    // A boarding pass from 2 weeks ago means the appointment already passed - lead may be stalled
    if(!hasApptSet) {
      var todayMsBP = Date.now();
      var hasApptBoardingPass = noteEls.slice(0,10).some(function(n){
        var title = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'');
        var content = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var dateStr = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var noteMs = dateStr ? new Date(dateStr).getTime() : 0;
        var noteAge = noteMs > 0 ? (todayMsBP - noteMs) : Infinity;
        var isRecent = noteAge < 2 * 24 * 60 * 60 * 1000; // within 48 hours
        return isRecent && /email auto response/i.test(title) && /boarding pass|appointment boarding/i.test(content);
      });
      if(hasApptBoardingPass) hasApptSet = true;
    }

    // Check for explicit appointment reminder language in OUTBOUND AGENT notes only
    // (not lead received, system notes, or Gubagoo data dumps which may contain appointment URLs)
    // IMPORTANT: Only treat as active appointment if the reminder note is recent (within 48h).
    // An old reminder message (e.g. "quick reminder of our appointment on Saturday") should NOT
    // keep hasApptSet=true days later - that appointment has already passed.
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
        var isRecentRem = noteAgeRem < 2 * 24 * 60 * 60 * 1000; // within 48 hours
        // Must be an actual outbound agent message, not a system note or lead received
        var isAgentOutbound = dir === 'outbound' && !/lead received|system|auto response/i.test(title);
        if(isAgentOutbound && isRecentRem && /reminder of our appointment|remind you of the appointment|appointment you had set|your appointment.*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)|quick reminder.*appointment/i.test(content)){
          hasApptSet = true;
          apptDetails = content.trim().substring(0,250);
        }
      });
    }

    // Check if the most recent OUTBOUND agent notes indicate a missed appointment
    // ONLY agent outbound messages count - "sorry you couldn't make it" etc.
    // Must be within last 48 hours - not old history
    var todayMs2 = Date.now();
    var missedApptNoteDate = null;
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
    // Also scan ALL notes for appointment reminder language to find the original appointment date
    // This catches cases where the reminder was sent yesterday (>48h ago from now)
    var missedApptTiming2 = 'recently';
    try {
      var centralNow2 = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      var todayDateOnly = new Date(centralNow2.getFullYear(), centralNow2.getMonth(), centralNow2.getDate()).getTime();
      for(var msi=0; msi<Math.min(15, noteEls.length); msi++){
        var msDir = (noteEls[msi].getAttribute('data-direction')||'').toLowerCase();
        var msContent = ((noteEls[msi].querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var msDateStr = ((noteEls[msi].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var msNoteMs = msDateStr ? new Date(msDateStr).getTime() : 0;
        // Look for appointment reminder notes (outbound, contains time + date)
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
    // Also check if hasApptSet was already confirmed - if so, it's not a missed appt yet
    // hasMissedAppt should never be true when hasApptSet is true (appointment is future)
    // This gets resolved after hasApptSet is set below

    // Only set hasApptSet from outbound note scan if there's a genuine confirmation
    // A close question ("Would 4:00 work?") is NOT a confirmed appointment
    // Require: explicit confirmation language ("confirmed for", "we have you scheduled", "see you at", "your appointment is")
    // OR: a customer inbound reply with a time after an agent offered times (customer accepted)
    if(!hasMissedAppt) {
      var todayMs = Date.now();
      // First check for agent confirmation language in outbound (agent confirmed the appt)
      for(var ai=0; ai<Math.min(5, noteEls.length); ai++){
        var aDir = (noteEls[ai].getAttribute('data-direction')||'').toLowerCase();
        var aText = ((noteEls[ai].querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var aDate = ((noteEls[ai].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var hasTime = /\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(aText);
        // Only fire on CONFIRMED appointment language - not on close questions or invitations
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
      // Also check if customer replied with acceptance (inbound with a time or "yes"/"ok" after agent offered times)
      if(!hasApptSet) {
        for(var ci=0; ci<Math.min(5, noteEls.length); ci++){
          var cDir = (noteEls[ci].getAttribute('data-direction')||'').toLowerCase();
          var cText = ((noteEls[ci].querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
          var cDate = ((noteEls[ci].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
          var cMs = cDate ? new Date(cDate).getTime() : 0;
          var cAge = cMs > 0 ? (todayMs - cMs) : Infinity;
          if(cDir === 'inbound' && cAge < 2 * 24 * 60 * 60 * 1000){
            // Require more specific confirmation - not just "yes" or "ok" which appear in many contexts
            if(/\b(sounds good|i.ll be there|see you then|see you at|confirmed|works for me|i.ll come in|we.ll be there|that works)\b/i.test(cText)){
              hasApptSet = true;
              break;
            }
          }
        }
      }
    }
    // If a future appointment is confirmed, it can't also be a missed appointment
    if(hasApptSet) hasMissedAppt = false;

    // MISSED APPT RE-ENGAGEMENT GUARD:
    // If the most recent outbound was a re-engagement message (missed appt language)
    // and the customer replied but did NOT confirm a specific new time,
    // force hasApptSet = false so the AI cannot generate an appointment confirmation
    var lastOutboundIsMissedApptReengagement = /life is busy|sorry you couldn.t make it|couldn.t make it out|missed.*appointment|reschedule.*convenient|more convenient/i.test(lastOutboundMsg||'');
    var customerConfirmedSpecificTime = /([0-9]{1,2}:[0-9]{2}\s*(?:am|pm)?)/i.test(lastInboundMsg||'')
      && /(yes|ok|okay|sure|works|confirmed|see you|i.ll be|sounds good)/i.test(lastInboundMsg||'');
    if(lastOutboundIsMissedApptReengagement && !customerConfirmedSpecificTime) {
      hasApptSet = false;
      apptDetails = '';
      console.log('[Lead Pro] Missed appt re-engagement detected - hasApptSet forced false, no fabricated confirmation allowed');
    }

    // Detect sold/delivered - only flag RECENT sales (within 30 days) as congratulations territory
    // Old sold leads (past customers being re-engaged) are follow-up conversations, not congrats
    var isSoldDelivered = false;
    var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // Determine if current lead is active BEFORE running any sold detection
    // Must be defined here so all detection paths can use it
    // Determine if the CURRENT lead is active - check multiple sources
    var currentLeadIsActive = /active|waiting|appointment/i.test(currentStatus)
      || /Status[:\s]+Active/i.test(TEXT.substring(0, 5000))
      || /Active New Lead/i.test(TEXT.substring(0, 5000))
      || /Status Not Set/i.test(currentStatus)  // blank dropdown = not confirmed sold
      || /truecar|sams club|gubagoo|tradepending|cars\.com|autotrader|facebook|kbb|kelley blue/i.test(leadSource||''); // fresh lead sources are never sold
    // TrueCar post-sale benefit language is marketing - never a real sale
    if(/post sale benefit|eligible for post sale|sams club.*gift|truecar.*gift|gift card.*truecar/i.test(TEXT)) currentLeadIsActive = true;
    // Primary: Sale Info section shows a sold date AND a Deal # - both required to avoid
    // false positives from TradePending/KBB valuation text which also contains "Sold" dates
    // Require sold date to appear in Sale Info section - not in lead received notes or TrueCar data
    // TrueCar uses "Sold" to mean "matched through platform" - not an actual customer purchase
    var saleInfoSection = TEXT.match(/Sale Info[\s\S]{0,500}/i);
    var saleInfoText = saleInfoSection ? saleInfoSection[0] : '';
    var soldDateMatch = saleInfoText.match(/Sold[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    var hasDealNumber = /Deal\s*#?[:\s]*[A-Z]{0,3}\d{4,}/i.test(saleInfoText); // Only look in Sale Info section
    if(soldDateMatch && hasDealNumber) {
      var soldMs = new Date(soldDateMatch[1]).getTime();
      var soldAge = soldMs > 0 ? (Date.now() - soldMs) : Infinity;
      // Also verify current lead is not active
      if(soldAge < thirtyDaysMs && !currentLeadIsActive) {
        isSoldDelivered = true;
      }
    }
    // Secondary: status dropdown explicitly says sold/delivered
    // Guard with currentLeadIsActive - the selector may pick up Sales History table rows
    if(!isSoldDelivered && !currentLeadIsActive && /\bsold\b|\bdelivered\b/i.test(currentStatus)) {
      isSoldDelivered = true;
    }
    // Secondary-B: Lead Info Status label says "Sold" - must be in Lead Info context
    // IMPORTANT: Also check currentStatus from the dropdown - if dropdown shows Active/Waiting,
    // the current lead is not sold even if old Sales History rows show "Sold"
    // currentLeadIsActive defined above before sold detection block
    if(!isSoldDelivered && !currentLeadIsActive && /Status:\s*Sold\b/i.test(TEXT.substring(0, 1500))) {
      var soldStatusArea = TEXT.substring(0, 1500);
      var hasActiveLead = /Status:\s*Active/i.test(soldStatusArea);
      if(!hasActiveLead) isSoldDelivered = true;
    }
    // Tertiary: Sale Info section shows Delivered badge + Deal number - skip if current lead is active
    if(!isSoldDelivered && !currentLeadIsActive && hasDealNumber && /Sale Info[\s\S]{0,300}Delivered/i.test(TEXT.substring(0,3000))) {
      var createdMatch = TEXT.match(/Created[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if(createdMatch) {
        var createdMs2 = new Date(createdMatch[1]).getTime();
        var createdAge2 = createdMs2 > 0 ? (Date.now() - createdMs2) : Infinity;
        if(createdAge2 < thirtyDaysMs) isSoldDelivered = true;
      }
    }

    // Scrape past showroom visits and general notes for stalled lead context
    // IMPORTANT: Only include General Notes that describe an actual in-person interaction
    // (test drive, walked lot, met with rep). Generic notes like "sent email" or vehicle
    // mentions without visit language must NOT be included - they cause hallucinated visit references.
    var pastVisitNotes = [];
    var hasConfirmedVisit = false;
    for(var pni=0; pni<Math.min(25, noteEls.length); pni++){
      var pnTitle = ((noteEls[pni].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
      var pnContent = ((noteEls[pni].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      var pnDate = ((noteEls[pni].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      if(/showroom\s*visit/i.test(pnTitle) && pnContent){
        // Showroom Visit entries are always real visits
        pastVisitNotes.push('PAST SHOWROOM VISIT (' + pnDate + '): ' + pnContent.substring(0,300));
        hasConfirmedVisit = true;
      } else if(/general\s*note/i.test(pnTitle) && pnContent){
        // Only include General Notes that explicitly describe an in-person visit
        // Must contain visit language - not just a vehicle mention or system note
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
      isInTransit, hasApptSet, apptDetails, isSoldDelivered, hasMissedAppt, missedApptTiming: missedApptTiming2, vrCreditApp, vrPaymentSelected, vrTradeIn, vrCompleted, vrDroppedOff, noVehicleAtAll, agentLPCommands, contactRecoveryPhone, contactRecoveryEmail, isMaskedEmail, isSRPVehicle, isVelocityResponse, isLandline,
      isShowroomFollowUp, showroomDetails, showroomVisitToday,
      pastVisitNotes,
      hasConfirmedVisit,
      pageSnippet:TEXT.substring(0,3000),
      scrapedAt:Date.now()
    };
  } // end inlineScraper

  // Inject into all frames — each returns a Promise that resolves when notes are ready
  chrome.scripting.executeScript(
    { target: { tabId: tab.id, allFrames: true }, func: function() {
      // Inline polling scraper — waits for notes DOM then returns data
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
      // Notes are ready (or timed out) — now run the actual scraper
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
            statusEl.textContent = 'No frame data — reload the lead and try again.';
            return;
          }

          console.log('[Lead Pro] Frame results:', results.map(function(r){
            return { frame: r.frameId, notes: r.result && r.result.totalNoteCount, isLead: r.result && r.result.isLeadFrame, store: r.result && r.result.store, dealerId: r.result && r.result.dealerId, brief: r.result && r.result.conversationBrief ? 'YES' : 'no' };
          }));

          // Sort: most notes first, lead frame as tiebreaker
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
          // Track best store — prefer non-empty over empty, specific over generic
          let bestStore = '';
          for (const frame of sorted) {
            const d = frame.result; if (!d) continue;
            // Track best store across all frames — prefer more specific names
            if (d.store && (!bestStore || d.store.length > bestStore.length)) bestStore = d.store;
            for (const k of Object.keys(d)) {
              if (['hasTrade','inventoryWarning','isLeadFrame','hasExitSignal','hasPauseSignal','hasOutbound','isContacted','isInTransit','hasApptSet','isShowroomFollowUp'].includes(k)) {
                if(d[k]) m[k]=true;
              } else if (k === 'store') {
                // Handled separately via bestStore
              } else if (historyFields.has(k)) {
                if (!m[k] && d[k]) m[k] = d[k];
              } else if (k==='pageSnippet') {
                m[k]=(m[k]||'')+' '+(d[k]||'');
              } else if (!m[k] && d[k]) {
                m[k]=d[k];
              }
            }
          }
          // Set best store after all frames processed
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
            statusEl.textContent = '✓ ' + parts.join(' · ');
            dot.classList.add('active');
          } else {
            statusEl.className = 'crm-status error';
            statusEl.textContent = 'Nothing found — fill fields manually.';
          }
        }
      );
    } // end wait callback
  ); // end wait executeScript
} // end tryExecuteScript

// ── System Prompt ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// SCENARIO CLASSIFIER
// JS figures out the scenario. AI gets a focused, minimal prompt.
// ─────────────────────────────────────────────────────────────────
function classifyScenario(data) {
  const ls  = (data.leadSource || '').toLowerCase();
  const ctx = (data.context    || '').toLowerCase();
  const s   = {};

  // ── Conversation stage (highest priority) ──────────────────────
  s.isApptConfirmation = ctx.includes('appointment already set');
  s.isShowroomFollowUp = ctx.includes('showroom stage');
  s.isSoldDelivered    = /sold\/delivered/i.test(ctx) || !!data.isSoldDelivered;
  s.isMissedAppt       = ctx.includes('missed appointment');
  s.isExitSignal       = ctx.includes('exit signal');
  s.isPauseSignal      = ctx.includes('pause signal');
  // Match actual strings in conversationBrief: "⚡ FOLLOW-UP", "CONVERSATION TRANSCRIPT", "active-follow-up"
  s.isFollowUp         = (!!data.convState && data.convState !== 'first-touch') || !!data.hasOutbound; // ctx.includes checks removed — header labels in context caused false positives on fresh leads
  s.hasUnresolvedIssue = ctx.includes('unresolved issue');
  s.unresolvedText     = (ctx.match(/unresolved issue:\s*([^\n.]+)/i)||[])[1] || '';
  s.actionNeeded       = (ctx.match(/required message action:\s*([^\n.]+)/i)||[])[1] || '';
  s.customerLastSaid   = (ctx.match(/customer last said:\s*\[([^\]]+)\]/i)||[])[1] || '';

  // ── Lead source type ──────────────────────────────────────────
  // Lead source scenarios take priority even when isFollowUp is true from system notes only
  // A Gubagoo/TrueCar/CapitalOne lead is always that type — system note history shouldn't block it
  // Only defer to isFollowUp if there are actual human outbound messages (real agent contact)
  const hasRealOutbound = !!(data.hasOutbound);
  console.log('[Lead Pro] classifyScenario — ls:', (data.leadSource||''), '| isFollowUp:', s.isFollowUp, '| hasRealOutbound:', hasRealOutbound, '| convState:', data.convState);
  // Click & Go = virtual retailing / digital deal / finance app / DRS — NOT chat leads
  // Gubagoo Chat, HDS Chat are standard chat leads, not Click & Go
  const isGubagooChat = /chat|\bsms\b/i.test(ls) || /sms.chat|chat.sms/i.test(ls);
  const isClickAndGoSource = !isGubagooChat && /gubagoo|click.*go|click\s*&\s*go|\bdrs\b|dynamic.*credit|digital retail|virtual retail|hds dr|finance app/i.test(ls);
  // Click & Go wins when it's the lead source AND the lead is fresh (not stalled).
  // A Gubagoo-DRS source on a 47-day-old lead with a past visit and no purchase is the
  // SAME stale lead — the DRS source is just the original intake channel, not a new submission.
  // If contactedAgeDays >= 14 (stale) and there's real outbound history, treat as stalled not Click & Go.
  // Stale if: old contact AND not a live conversation (customer replied today)
  var isLive = !!(data.isLiveConversation);
  // Fresh contact = contacted within hours today (contactedAgeDays < 1 but > 0, set from hours parser)
  var isFreshContact = data.contactedAgeDays > 0 && data.contactedAgeDays < 1;
  // Stale if: real outbound history AND (old contact age OR live same-day reply OR freshly contacted today)
  // All three mean this is an active lead being worked — not a fresh Click & Go submission
  var isStaleClickAndGo = isClickAndGoSource && hasRealOutbound && ((data.contactedAgeDays >= 14) || isLive || isFreshContact);
  // Exit signal always wins — never treat a customer who said they bought elsewhere as a Click & Go lead
  s.isClickAndGo   = isClickAndGoSource && !isStaleClickAndGo && !s.isExitSignal;
  s.isTradePending = (!s.isFollowUp || !hasRealOutbound) && /tradepending/i.test(ls);
  s.isLoyalty      = /afs|kmf|luv|off loan|maturity|loyalty/i.test(ls);
  s.isCarGurusDD   = (!s.isFollowUp || !hasRealOutbound) && /cargurus.*digital deal|digital deal.*cargurus/i.test(ls);
  s.isKBB          = (!s.isFollowUp || !hasRealOutbound) && /kbb|kelley blue/i.test(ls) && !/autotrader/i.test(ls); // AutoTrader-KBB = purchase lead, not trade offer — AutoTrader takes priority
  s.isCapitalOne   = (!s.isFollowUp || !hasRealOutbound) && /capital one|cap one/i.test(ls);
  s.isTrueCar      = (!s.isFollowUp || !hasRealOutbound) && /truecar/i.test(ls);
  s.isAMP          = (!s.isFollowUp || !hasRealOutbound) && /\bamp\b/i.test(ls);
  // AI Buying Signals — detect both variants precisely
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
  s.isChatLead     = (!s.isFollowUp || !hasRealOutbound) && (/chat/i.test(ls) || /gubagoo.*sms|sms.*chat/i.test(ls)) && !s.isClickAndGo;
  s.isCarFax       = (!s.isFollowUp || !hasRealOutbound) && /carfax|iseecars|autobytel|car.*genie|modalyst/i.test(ls);
  // High-volume sources from store data
  // Walk-ins are handled by isShowroomFollowUp — no separate flag needed (they always have prior history)
  s.isRepeatCustomer = (!s.isFollowUp || !hasRealOutbound) && /repeat|returning|prior customer|dms sales|previous (customer|buyer|owner)|sold customer/i.test(ls);
  s.isThirdPartyOEM = (!s.isFollowUp || !hasRealOutbound) && /third party|3rd party|kia digital|honda digital|toyota digital|hyundai digital|oem partner|audi partner|manufacturer partner/i.test(ls) && !s.isOEMLead;
  s.isGoogleAd     = (!s.isFollowUp || !hasRealOutbound) && /google.*ad|google.*digital|paid search|sem lead|ppc/i.test(ls);
  s.isReferral     = (!s.isFollowUp || !hasRealOutbound) && /referral|referred by|word of mouth/i.test(ls);
  s.isStandard     = !s.isClickAndGo && !s.isTradePending && !s.isCarGurusDD && !s.isCarGurus && !s.isKBB && !s.isCapitalOne && !s.isTrueCar && !s.isAMP && !s.isAutoTrader && !s.isCarscom && !s.isEdmunds && !s.isOEMLead && !s.isPhoneUp && !s.isAIBuyingSignalNew && !s.isAIBuyingSignalReturner && !s.isFacebook && !s.isDealerWebsite && !s.isChatLead && !s.isCarFax && !s.isRepeatCustomer && !s.isThirdPartyOEM && !s.isGoogleAd && !s.isReferral && !s.isLoyalty;

  // ── Inventory status ───────────────────────────────────────────
  s.vehicleSold        = ctx.includes('vehicle status: sold');
  s.vehicleInTransit   = ctx.includes('vehicle status: in transit');
  s.isLoyaltyVehicle   = ctx.includes('loyalty vehicle');
  s.noSpecificVehicle  = ctx.includes('no specific unit');
  s.noCustomerPhone    = ctx.includes('no customer phone number');
  s.notToday           = ctx.includes('not today');
  s.isStalled          = ctx.includes('stalled lead') || !!data._isStalled;

  // Stale model year — flag if vehicle year is prior to current calendar year
  const currentYear = new Date().getFullYear();
  const vyMatch = (data.vehicle || '').match(/^(\d{4})/);
  s.vehicleYear    = vyMatch ? parseInt(vyMatch[1]) : 0;
  s.staleModelYear = s.vehicleYear > 0 && s.vehicleYear < currentYear;

  // ── Store / persona ────────────────────────────────────────────
  s.stockNum   = data.stockNum || '';
  s.isAudi     = /audi/i.test(data.store);
  s.isKia      = /kia/i.test(data.store);
  s.isHonda    = /honda/i.test(data.store);
  s.isToyota   = /toyota/i.test(data.store);
  s.storeGroup = s.isAudi ? 'Audi Lafayette' : (data.store || 'Community Auto Group');
  s.persona    = s.isAudi ? 'Audi Concierge' : 'Internet Sales Coordinator';
  // Detect non-Audi vehicle at Audi store (used Toyota, Honda, etc.)
  var vehicleText = (data.vehicle || '').toLowerCase();
  s.vehicleBrand = /toyota/i.test(vehicleText) ? 'Toyota'
    : /honda/i.test(vehicleText) ? 'Honda'
    : /ford/i.test(vehicleText) ? 'Ford'
    : /chevrolet|chevy/i.test(vehicleText) ? 'Chevrolet'
    : /bmw/i.test(vehicleText) ? 'BMW'
    : /mercedes/i.test(vehicleText) ? 'Mercedes'
    : /lexus/i.test(vehicleText) ? 'Lexus'
    : /jeep/i.test(vehicleText) ? 'Jeep'
    : /ram/i.test(vehicleText) ? 'Ram'
    : '';
  s.nonAudiVehicle = s.isAudi && s.vehicleBrand && s.vehicleBrand !== 'Audi';
  s.duration   = s.isAudi ? '45 minutes' : '30–45 minutes';

  // Brand mismatch detection — vehicle of interest is a competitor brand
  var vehicleBrand = (data.vehicle || '').toLowerCase();
  var storeBrand = (data.store || '').toLowerCase();
  var competitorBrands = ['toyota','honda','kia','hyundai','ford','chevy','chevrolet','gmc','ram','jeep','dodge',
    'nissan','subaru','mazda','volvo','bmw','mercedes','lexus','acura','infiniti','cadillac','lincoln','buick',
    'volkswagen','vw','genesis','mitsubishi','audi','porsche','land rover','jaguar','tesla','rivian'];
  s.isBrandMismatch = false;
  s.competitorBrand = '';
  for(var bi=0; bi<competitorBrands.length; bi++){
    var brand = competitorBrands[bi];
    if(vehicleBrand.includes(brand)){
      // Check if this brand matches the store
      var storeMatches = storeBrand.includes(brand) || (brand === 'chevy' && storeBrand.includes('chevrolet')) || (brand === 'vw' && storeBrand.includes('volkswagen'));
      // If stock number or VIN is present, the vehicle is in inventory — never a mismatch
      var hasInventoryConfirmation = !!(data.stockNum || data.vin);
      if(!storeMatches && !hasInventoryConfirmation){
        s.isBrandMismatch = true;
        s.competitorBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
        break;
      }
    }
  }
  s.salesRep   = data.salesRep || '';

  return s;
}

// ─────────────────────────────────────────────────────────────────
// PHONE LOOKUP — runs in JS, result passed directly to AI
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// FOCUSED SYSTEM PROMPT — universal rules only, short
// ─────────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  return [
    'You are Lead Pro, a BDC response engine for Community Auto Group dealerships.',
    'Respond ONLY with a single valid JSON object. No markdown. No text outside the JSON.',
    'Format: {"sms":"...","email":"...","voicemail":"..."}',
    'CRITICAL JSON STRUCTURE: All three fields (sms, email, voicemail) MUST be flat strings. Do NOT nest objects inside any field.',
    'WRONG: {"email": {"subject": "...", "body": "..."}} — this is invalid.',
    'WRONG: {"voicemail": {"translation": "..."}} — this is invalid.',
    'WRONG: {"sms": {"message": "..."}} — this is invalid.',
    'CORRECT: {"sms": "...", "email": "Subject: ...\n\nbody text here", "voicemail": "..."}',
    'The email field must always start with "Subject: " on the first line, then a blank line, then the body.',
    'UNIVERSAL RULES:',
    '- SMS: message body + newline + agent first name + newline + phone number. Nothing else in signature.',
    '- Email: Subject line first ("Subject: ..."), then full message, then complete signature stacked on separate lines (Name on line 1, Title on line 2, Store on line 3, Phone on line 4). Never use slashes between signature parts.',
    '- Voicemail: EXACT 3-PART STRUCTURE — no deviations:',
    '  PART 1 — INTRO: "Hi [First Name], this is [Agent First Name] from [Store Name]." One sentence. Nothing else.',
    '  PART 2 — HOOK: ONE sentence only. The single most compelling reason to call back, specific to THIS lead. Make it feel like news or a personal update — not a script. Choose the hook based on what is true:',
    '    • Vehicle available: "The [vehicle] you were looking at is still available and I wanted to make sure you had a chance to see it before it moves."',
    '    • Trade-in: "I pulled up some numbers on your trade and I think you are going to like what I found."',
    '    • Credit/Click & Go: "Your application came through and I have some information I think will make this work for you."',
    '    • Stalled/re-engagement: "I was thinking about you and wanted to reach out — I have something specific to share about the [vehicle/category]."',
    '    • Appointment reminder: "Just a reminder that we have you set for [time] and I will have everything ready when you arrive."',
    '    • General follow-up: "I have some information on the [vehicle] that I wanted to share with you personally."',
    '  PART 3 — CALLBACK: "Give me a call back at [number]." Repeat the number once: "That is [number] again." Nothing after the second number. End there.',
    '  TOTAL LENGTH: 60-80 words. Long enough to sound human, short enough to not lose them.',
    '  DO NOT include appointment times in voicemail — that is for SMS/email. Voicemail goal is ONE thing: get a callback.',
    '  DO NOT say: "following up" "touching base" "just wanted to" "at your earliest convenience" "please let me know" "I look forward to" — these kill callbacks.',
    '  RIGHT EXAMPLE: "Hi Maria, this is Kristen from Community Kia Baytown. I just pulled up some information on the Telluride and I have numbers I think are going to work really well for you — give me a call at 281-837-3383. That is 281-837-3383."',
    '  WRONG EXAMPLE: "Hi Maria, this is Kristen from Community Kia Baytown. I am following up on your inquiry about the Telluride and would love to schedule a time to discuss your needs and answer any questions you might have. Please call me back at your earliest convenience at 281-837-3383. Thank you and have a great day."',
    '- PROHIBITED PHRASES — GENERIC OPENERS (kills engagement): "Checking in" "Following up" "Touching base" "Just wanted to reach out" "Just wanted to connect" "Just checking" "Circling back" "Looping back" "Reaching out to see" "I hope this finds you well" "Hope your day is going well" "Hope you are having a good" "Hi there"',
    '- PROHIBITED PHRASES — OVERUSED VEHICLE AVAILABILITY (sounds scripted and robotic): "I have it pulled up and ready for you" "pulled up and ready to see" "pulled up and ready for you to see" "I have it pulled up" — ALL banned. Use fresh alternatives instead: "it is here", "we have it on the lot", "I checked and it is here", "it is in stock", "it is here waiting for you".',
    '- PROHIBITED PHRASES — PASSIVE CLOSINGS (kills show rate): "Let me know" "Stop by anytime" "Feel free to reach out" "Give us a call when you ready" "Anytime works" "Whatever works for you" "I look forward to hearing from you" "I look forward to your response" "Talk soon"',
    '- PROHIBITED PHRASES — TRACKING/SURVEILLANCE LANGUAGE: "I saw you were looking at" "I noticed you were looking at" "I saw you browsing" "I was looking at your" "I saw you looking at the" "We noticed you" "I thought of you" "I saw you visited"',
    '- PROHIBITED PHRASES — CORPORATE/SCRIPTED: "As per our conversation" "As a valued customer" "As a previous customer" "That is a fantastic choice" "Great choice" "Excited to see your request" "I understand that" "I wanted to follow up" "I am reaching out" "Just confirming" "Still working on" "I have been working on"',
    '- PROHIBITED PHRASES — BRAND/PLATFORM: "Carfax" "CARFAX" "Gubagoo" "Virtual retailing" "Digital retailing platform"',
    '- PROHIBITED PHRASES — APPOINTMENT PRESSURE: "Let us lock this in" "We just need your signature" "Let us get you locked in" "Strategy session" "Consultation" "Come in to buy"',
    '- PROHIBITED PHRASES — CREDIT SHAME: "Bad credit" "Poor credit history" "Low credit score" "You need a co-signer" "The bank requires"',
    '- PROHIBITED PHRASES — AI BUYING SIGNAL leads only: "newer model" "newer models" "latest model" "newest" "brand new" "new [model]" — use neutral: "[model] options available" "a few [models] on the lot"',
    '- Never fabricate inventory status. Never guarantee approval or rates.',
    '- VEHICLE RULE: ONLY reference the vehicle in the LEAD section. If the LEAD section says "(none specified)", do NOT name any vehicle at all — not from history, not from your training. Vehicles mentioned in conversation history belong to other leads or conversations and must be ignored.',
    '- Write all three formats completely. Do not truncate.',
    '- TRADE-IN: When a trade-in is present, mention it in ALL three formats including SMS.',
    '- SYSTEM DATA RULE: The conversation transcript may contain system-generated notes tagged as [NOTE] including lead received data, TradePending/KBB valuation reports, and automated responses. These contain market prices, dollar ranges, credit scores, and vehicle statistics. NEVER treat this system data as customer communication or use it to infer customer concerns. Only infer concerns from messages explicitly sent by the customer.',
    '- SCHEDULE ASSUMPTION RULE: NEVER assume a customer works shifts, has schedule constraints, or works unusual hours unless they explicitly said so in a customer message. Do NOT say "I know your schedule can vary with shift work" or similar unless the SHIFT WORKER flag is active in the context. Inferring schedule from job title, location, or industry is forbidden.',

    '- SCHEDULE LANGUAGE RULE: If a customer mentioned schedule constraints, ask directly and specifically: "When works best for you this week?" or "What days or times work for you?" — NOT vague phrases like "since your schedule can vary" or "whenever works for you". Be direct.',
    '- TRADE-IN CONDITIONAL LANGUAGE: Phrases like "I\'ll just keep it if the offer is too low", "I\'ll keep my car if the price isn\'t right", or "I might just hold onto it" are NOT exit signals. They are negotiating leverage — the customer is still engaged and wants a good trade offer. NEVER generate a closing/goodbye message for trade-in conditional language. Respond by acknowledging the trade concern and moving toward locking in a real number.',
    '- CUSTOMER ECHO RULE: NEVER parrot back the customer\'s own words as a compliment or validation. Do NOT say "Comparing prices is the smartest way to shop" if the customer said "just comparing prices." Do NOT say "That\'s a great question" or mirror their phrasing back at them. Respond naturally without echoing.',
    '- URL / LINK RULE: NEVER construct, guess, or fabricate inventory URLs or website links. Do NOT build links like "communityhondabaytown.com/inventory/P4776" — you do not know the correct URL format and guessing will produce wrong links. If a customer asks for a link, respond: "I will send you the direct link right now" and leave the URL out of the generated message — the agent will paste the real VDP link manually.',
    '- ANSWER FIRST RULE: If the customer asked a direct question in their last message (price, availability, color, payment, trade value, financing, features, specs, towing, MPG, packages), you MUST address it BEFORE asking for an appointment. Ignoring a customer question kills trust.',
    '- ANSWERING QUESTIONS — THREE PATHS: (1) If you know the answer confidently, give it directly and briefly. (2) If it is a pricing/payment question, give a range or starting point and position the visit as where they get the exact number. (3) If it is a spec/feature question you are not certain about (towing capacity, exact MPG, specific option), say: "I want to make sure I give you the right answer on that — let me confirm and get back to you" OR invite them in: "The best way to go over all the details is in person so nothing gets lost in translation." NEVER guess or fabricate specs.',
    '- SPEC ACCURACY RULE: Do NOT invent or guess specific numbers for towing capacity, payload, MPG, horsepower, or technical specs. If unsure, say you will confirm rather than risk giving wrong information.',
    '- FABRICATION RULE: NEVER reference a co-signer, co-buyer, credit issue, trade-in, or any customer circumstance unless it appears explicitly in the customer messages or the lead data fields. Do NOT infer these from form field labels, system notes, or lead received data. If the customer did not say it, do not mention it.',
    '- AGENT AVAILABILITY FABRICATION: NEVER claim the agent is "booked", "fully booked", "slammed", "packed", or "unavailable" on any day as a sales tactic. The agent\'s availability is unknown — do not invent scheduling pressure. If the customer asks about the weekend, either offer weekend times or redirect to today with a vehicle reason (inventory, availability), NOT a fake schedule reason.',
    '- APPOINTMENT FABRICATION RULE: NEVER confirm, reference, or imply a specific appointment time unless the customer explicitly agreed to that time in their messages. "Thank you" is NOT an appointment confirmation. If no time has been agreed to, offer new times — do not invent one.',
    '- CLOSE STRATEGY — READ THE ROOM: The two-time appointment close is not automatic. Choose the right tier:',
    '  TIER 0 — CONFIRM THEIR TIME: Customer already gave you a specific time or window ("3-4 PM", "Saturday morning", "around noon"). DO NOT offer alternative times. Confirm what they said and build around it. Example: "3:00 or 3:30 works great — I\'ll have everything ready for you." Offering earlier times when they told you 3-4 PM is a close strategy failure.',
    '  TIER 1 — TWO-TIME CLOSE: Customer is warm and engaged but has NOT given a specific time. Offer two specific times.',
    '  TIER 2 — QUALIFYING CLOSE: Customer has an objection or unresolved question. Ask ONE qualifying question before offering times. Example: "What monthly payment or out-the-door number would make this work for you?"',
    '  TIER 3 — SOFT CLOSE: Customer said not today or is lukewarm. Do not offer specific times. Ask what day works: "What day this week is looking best for you?"',
    '  TIER 4 — NO CLOSE: Customer expressed frustration, bought elsewhere, or is not interested. No appointment ask.',
    '- APPOINTMENT TIMES: When offering times, offer them ONCE. Never repeat.',
    '- APPOINTMENT LANGUAGE: Always frame as in-store — "come in," "stop by," "visit us." Never "discuss" or "talk."',
    '- EMAIL TONE — Write like a knowledgeable person who genuinely wants to help, not a corporate template:',
    '  WARMTH RULES:',
    '  • Contractions everywhere: "I\'ve", "I\'ll", "we\'ve", "it\'s", "that\'s", "can\'t", "won\'t", "you\'re" — formal language feels cold and distant',
    '  • Open with the most relevant thing to THIS customer — their specific vehicle, their specific situation, what they just said',
    '  • One moment of genuine enthusiasm or personality is allowed — not over the top, just human',
    '  • Reference something specific from their conversation or situation early in the first paragraph',
    '  • Write like you are continuing a relationship, not starting a form letter',
    '  WHAT NOT TO DO:',
    '  • Never open with: "I hope this email finds you well" / "Thank you for your interest" / "I am reaching out regarding" / "I wanted to follow up"',
    '  • Never stack feature lists or bullet points of vehicle specs',
    '  • Never write more than 3 short paragraphs — emails that are too long go unread',
    '  • Never sound like a press release or a form letter',
    '  STRUCTURE:',
    '  • Para 1: React to their specific situation — what they said, what they need, what matters to them',
    '  • Para 2: One relevant piece of useful information or what you have ready for them',
    '  • Para 3: The ask — duration, times, what happens next',
    '  WARM EMAIL OPENER EXAMPLES:',
    '  COLD: "I am reaching out regarding your interest in the 2026 Civic Sport. It is currently showing available here at Community Honda Lafayette."',
    '  WARM: "That Crystal Black Civic Sport is a great choice — I\'ve got it pulled up and it\'s showing available right now."',
    '  COLD: "I wanted to follow up on your Capital One pre-approval and confirm our next steps."',
    '  WARM: "Having that Capital One pre-approval already started puts you in a strong position — we\'re really just matching it to the right vehicle now."',
    '- SMS TONE — THIS IS THE MOST IMPORTANT FORMATTING RULE:',
    '  SMS must read like a real person texting, not a system generating a response.',
    '  WARMTH RULES:',
    '  • Use the customer first name naturally — not robotically at the start of every sentence',
    '  • Contractions are required: "I\'ve", "I\'ll", "we\'ve", "it\'s", "that\'s", "you\'re", "can\'t", "won\'t" — stiff formal language kills warmth',
    '  • One moment of genuine personality is allowed — a light observation, a brief expression of enthusiasm, a human reaction to what they said',
    '  • If customer said something specific (color preference, timeline, situation), react to THAT before moving to structure',
    '  • Match the customer energy — casual customer gets casual response, excited customer gets a slightly warmer tone',
    '  STRUCTURE RULES:',
    '  • Get to the point in the first sentence — do not build up to it',
    '  • One topic per SMS — do not stack multiple questions or multiple value points',
    '  • Close with ONE action — not multiple options, not multiple questions',
    '  • LENGTH: 3-5 lines before the signature. SHORT is not a goal — WARM is the goal. A 2-sentence SMS often feels dismissive. A 4-sentence SMS that reacts to the customer, references the vehicle, and makes a clear ask feels like a real person. Err on the side of slightly longer and warmer rather than short and clipped.',
    '  WHAT WARM LOOKS LIKE vs COLD:',
    '  COLD: "Latoya, this is Tania with Community Honda Lafayette. I am reaching out regarding your inquiry on the 2026 Civic Sport. It is currently showing available. It typically takes about 30-45 minutes. Would 9:15 AM or 10:30 AM Thursday work for you?"',
    '  WARM: "Latoya — that Civic Sport in Crystal Black is sharp. I\'ve got it pulled up and ready for you to see. Since Saturday works better, would 10:00 or 11:30 AM work for you?"',
    '  The warm version is shorter, more human, and reacts to what the customer actually said.',
    '- VOICEMAIL TONE: Confident, friendly, genuine. Sound like you actually want to talk to this person.',
    '- DISTANCE BUYER: If the Distance Buyer context flag is present, the message must acknowledge and justify the trip. A customer driving 30-60+ minutes needs a stronger reason than "come see it." Tactics: (1) Confirm the vehicle will be held/ready when they arrive. (2) Mention that everything can be mostly handled in advance so their time in-store is efficient. (3) Position the visit as worth the drive — "We can have everything ready so you\'re in and out in 45 minutes." Never casually say "stop by" to a distance buyer — the ask must feel worth the commitment.',
    '- TIME SENSITIVITY: Match urgency to the time of day. Same-day appointments = urgency. Late afternoon = mention closing time. Morning = position the full day as available.',
    '- LANGUAGE: Always write in English unless explicitly instructed otherwise by the agent.',
    'CONVERSATION RULE: When a transcript is provided, the SMS opening MUST be a direct human reaction to what the customer said last — not a summary, not a restatement, not a re-introduction. React first, then advance.',
    '  Ask yourself: Could this exact SMS be sent to any customer? If yes — it is too generic. REWRITE.',
    '  The customer\'s last message is the most important input. If they said "Saturday works", open with Saturday. If they said "I love the black one", open with the black one. If they said "I\'m nervous about credit", open with empathy about that.',
    '  EXCEPTION: For AI Buying Signal leads, outbound marketing blasts are NOT customer messages — ignore them entirely. Only react to genuine inbound customer replies.',
    'AI BUYING SIGNAL ABSOLUTE RULES — when the scenario section contains "AI BUYING SIGNAL", these rules are NON-NEGOTIABLE and cannot be overridden by any other instruction:',
    '  RULE 1: The email subject line MUST NOT contain the word "upgrade". Use "Your [Model]" or "[Model] options for you".',
    '  RULE 2: The words "newer model", "newer models", "newer [model]", "latest model", "step up", "brand new" are BANNED. Do not write them.',
    '  RULE 3: Do not write "upgrading your [vehicle]". Write "your next [model]" or "your [model] search" instead.',
    '  RULE 4: Do not mention a trade-in unless the LEAD section explicitly lists one.',
    '  RULE 5: Do not reference any sale event, 0% APR, or promotional offer.',
    '  RULE 6: Open with ownership hook: "[First name], still driving the [owned vehicle]? We have some great [model] options available right now."',
    'CRITICAL: Return only the JSON object.'
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
// FOCUSED USER PROMPT — scenario-specific, built by JS
// ─────────────────────────────────────────────────────────────────
function buildUserPrompt(data) {
  const sc   = classifyScenario(data);
  const appt = computeAppointmentTimes(data.store);
  const phone = lookupPhone(data.agent, data.store) || '(see directory)';
  const agentFirst = (data.agent || '').split(' ')[0] || data.agent || 'our team';

  const now   = new Date();
  const currentYear = now.getFullYear();
  const date  = now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', timeZone:'America/Chicago' });

  // ── Build the scenario instruction — one clear directive ────────
  let scenarioDirective = '';
  let scenarioRules = '';

  if (sc.isSoldDelivered) {
    // Detect if there is a recent post-sale interaction — service issue, return visit, paperwork, question
    // Limit post-sale service scan to RECENT context only — not full history blob
    // Full context can contain years-old service notes that falsely trigger service branch
    var fullContext = (data.context || '').toLowerCase();
    var recentContext = fullContext.substring(0, 800); // first 800 chars = most recent notes
    var lastInbound = (data.lastInboundMsg || '').toLowerCase();
    var hasRecentInbound = lastInbound.length > 0;
    var hasPostSaleService = /service|oil|alert|software|update|issue|problem|noise|concern|recall|repair|bring.*back|came back|just left|taken care of|get it looked|looked at|check.*on/i.test(recentContext + ' ' + lastInbound);
    var customerJustLeft = /just left|just got|just finished|all set|taken care of|yes ma.am|yes sir/i.test(lastInbound);

    if(hasRecentInbound && lastInbound.length < 20) {
      // Short inbound like "Hey", "Hi", "Hello" from a sold customer — they're reaching out, respond warmly
      scenarioDirective = 'TASK: Sold customer sent you a message. Respond warmly and naturally — ask how things are going with the vehicle or if there is anything you can help with.';
      scenarioRules = [
        '- They reached out to YOU. Acknowledge it warmly.',
        '- Do NOT pitch anything. Do NOT offer appointment times.',
        '- Keep it brief and genuine: "Hey [name]! Great to hear from you — how are you liking the [vehicle]? Is there anything I can help with?"',
        '- Tone: friend checking in, not a salesperson.',
      ].join('\n');
    } else if(customerJustLeft && hasPostSaleService) {
      scenarioDirective = 'TASK: Sold customer just left after a service or follow-up visit. Write a brief satisfaction check — not a sales pitch, not a congratulations.';
      scenarioRules = [
        '- Do NOT pitch any vehicle. Do NOT mention availability or Click & Go.',
        '- This is a relationship touchpoint — they just left the store after handling something.',
        '- SMS: Short and warm. Acknowledge they were just in and make sure everything was handled to their satisfaction.',
        '- EXAMPLE SMS: "Glad we got that taken care of for you! If anything else comes up with the [vehicle], do not hesitate to reach out."',
        '- Email: Brief check-in. Thank them for coming back in. Ask if everything was resolved to their satisfaction.',
        '- If a specific issue was mentioned (oil alert, paperwork, software update), reference it — do not be generic.',
        '- Close with an open door: "We are always here if you need anything."',
        '- Tone: genuine, warm, after-care focused.',
      ].join('\n');
    } else if(hasPostSaleService) {
      scenarioDirective = 'TASK: Sold customer has a post-sale service concern or follow-up item. Address it — do not send a generic congratulations.';
      scenarioRules = [
        '- Do NOT pitch any vehicle. Do NOT mention availability.',
        '- Acknowledge the specific issue or concern mentioned in the transcript.',
        '- Position the response as taking ownership: "I want to make sure we get this resolved for you."',
        '- If the issue is being handled by service/tech, reassure them and give a timeline if possible.',
        '- Offer a direct line of communication: "Feel free to reach out to me directly if anything else comes up."',
        '- Tone: accountable, reassuring, relationship-focused.',
      ].join('\n');
    } else {
      scenarioDirective = 'TASK: This customer has PURCHASED and taken DELIVERY. Write a warm congratulations/welcome message.';
      scenarioRules = [
        '- Do NOT pitch any vehicle. Do NOT offer appointment times. Do NOT mention availability.',
        '- SMS: 2-3 sentences. Congratulate them. Welcome them to the dealership family.',
        '- Email: Warm, personal congratulations. Mention the vehicle they purchased if known from context.',
        '- Reference the delivery/purchase naturally: "Congratulations on your new [vehicle]!"',
        '- Close with an offer to help with any questions about their new vehicle or upcoming service.',
        '- Tone: celebratory, genuine, relationship-building.',
      ].join('\n');
    }

  } else if (sc.isMissedAppt) {
    // Detect if a new appointment was explicitly confirmed by customer (specific time agreed to)
    // "Thank you" alone is NOT a confirmation — it is a polite response to re-engagement
    var missedApptNewTimeConfirmed = /(9:15|10:30|11:00|[0-9]{1,2}:[0-9]{2})/i.test(data.lastInboundMsg||'')
      && /(yes|ok|okay|sure|works|confirmed|see you|i.ll be|i will be)/i.test(data.lastInboundMsg||'');

    scenarioDirective = missedApptNewTimeConfirmed
      ? 'TASK: Customer confirmed a new appointment time. Confirm it clearly.'
      : 'TASK: Customer missed appointment. Re-engagement sent. Customer replied but NO new time agreed to. Offer two new times — do NOT confirm any appointment.';

    scenarioRules = [
      missedApptNewTimeConfirmed
        ? '- Confirm the agreed time clearly and briefly.'
        : '- NO APPOINTMENT EXISTS. "Thank you" is not a confirmation. Offer two new times only.',
      '- Do not repeat re-engagement language already sent.',
      '- Tone: warm, brief.',
      '- Never confirm a time the customer did not agree to.',
    ].join('\n');

  } else if (sc.isClickAndGo) {
    // Build opening based on what customer actually completed in the VR tool
    // ACCURACY: Only reference what the notes confirm — never claim a credit app was submitted if notes say "Not Started"
    var vrOpening;
    if (data.vrCompleted) vrOpening = 'I saw you completed your deal online through Click & Go — you have done all the heavy lifting!';
    else if (data.vrCreditApp) vrOpening = 'I saw your credit application come through via Click & Go.';
    else if (data.vrPaymentSelected && data.vrTradeIn) vrOpening = 'I saw you started your deal online through Click & Go — including your payment preferences and trade-in.';
    else if (data.vrPaymentSelected) vrOpening = 'I saw you started your deal online and selected your payment preferences through Click & Go.';
    else if (data.vrTradeIn) vrOpening = 'I saw you started your deal online through Click & Go — including your trade-in details.';
    else vrOpening = 'I saw you started your deal online through Click & Go.';

    var vrProgress;
    if (data.vrCompleted) vrProgress = 'You have done all the heavy lifting — we just need to finalize the details in person.';
    else if (data.vrCreditApp) vrProgress = 'Having that credit application started puts us in a great position to move quickly.';
    else if (data.vrTradeIn) vrProgress = 'Having your trade-in details in already saves time — I can have a solid number ready when you arrive.';
    else if (data.noVehicleAtAll) vrProgress = 'You have already taken the first step — let me help you find the right vehicle to go along with it.';
    else vrProgress = 'You have already done the hard part — the vehicle is here and ready for you to see.';

    var clickGoHasOutreach = data.hasOutbound || data.isContacted;
    scenarioDirective = clickGoHasOutreach
      ? 'TASK: Click & Go lead with PRIOR OUTREACH already made. This is a follow-up — NOT a first introduction. Do NOT re-introduce yourself as if this is first contact. React to where the conversation actually stands.'
      : 'TASK: Click & Go lead — first contact. Customer took an online action. Acknowledge EXACTLY what they completed.';
    scenarioRules = [
      clickGoHasOutreach
        ? '- PRIOR OUTREACH EXISTS: Agent already sent a message or made contact. Open by directly continuing the conversation — reference what was sent or what happened, not by re-introducing yourself.'
        : '- REQUIRED OPENING: ' + vrOpening,
      '- PROGRESS ACKNOWLEDGMENT: ' + vrProgress,
      '- ACCURACY RULE: ONLY reference what the customer actually completed in the VR tool. Never fabricate completion.',
      clickGoHasOutreach
        ? '- Do NOT use first-touch language: "I wanted to reach out", "I saw you started your deal" — the agent already said this. Pick up where things left off.'
        : '- Frame the visit as finalizing what they started — not starting over.',
      '- Never say Gubagoo, virtual retailing, or digital retailing platform.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].filter(Boolean).join('\n');

    } else if (sc.isTrueCar) {
    // Detect affinity partner from lead source name and lead received notes
    var tcContext = (data.context||'') + ' ' + (data.leadSource||'');
    var employerPerkMatch = tcContext.match(/EMPLOYER[^*]{0,5}[*]+\s*([A-Za-z0-9 &,.-]{2,40})/i);
    var buyerBonusMatch = tcContext.match(/BUYER.S BONUS[^*]{0,5}[*]+\s*([^*\n]{5,60})/i);
    var employerName = employerPerkMatch ? employerPerkMatch[1].trim() : '';
    var buyerBonus = buyerBonusMatch ? buyerBonusMatch[1].trim() : '';
    var hasPerkspot = /perkspot|employer perk|employee.*perk|perks site/i.test(tcContext);

    // Parse affinity partner directly from lead source format "TrueCar/PartnerName"
    var tcAffinityPartner = '';
    var ls2 = (data.leadSource||'').toLowerCase();
    var tcSlashMatch = (data.leadSource||'').match(/truecar\s*\/\s*(.+)/i);
    if(tcSlashMatch) {
      var parsed = tcSlashMatch[1].trim();
      // Normalize known variations
      if(/beneplace/i.test(parsed)) tcAffinityPartner = 'Beneplace';
      else if(/credit karma/i.test(parsed)) tcAffinityPartner = 'Credit Karma';
      else if(/usaa/i.test(parsed)) tcAffinityPartner = 'USAA';
      else if(/navy federal/i.test(parsed)) tcAffinityPartner = 'Navy Federal';
      else if(/sam.s club/i.test(parsed)) tcAffinityPartner = "Sam's Club";
      else if(/costco/i.test(parsed)) tcAffinityPartner = 'Costco';
      else if(/aaa/i.test(parsed)) tcAffinityPartner = 'AAA';
      else if(/consumer reports/i.test(parsed)) tcAffinityPartner = 'Consumer Reports';
      else tcAffinityPartner = parsed; // use whatever is after the slash as-is
    }
    // Fallback: scan context for known partners if no slash pattern
    if(!tcAffinityPartner) {
      if(/credit karma/i.test(tcContext)) tcAffinityPartner = 'Credit Karma';
      else if(/usaa/i.test(tcContext)) tcAffinityPartner = 'USAA';
      else if(/navy federal/i.test(tcContext)) tcAffinityPartner = 'Navy Federal';
      else if(/beneplace/i.test(tcContext)) tcAffinityPartner = 'Beneplace';
    }

    scenarioDirective = 'TASK: TrueCar affinity/partner lead. Customer submitted a pricing request through TrueCar. They expect a real price response — not a redirect.';
    scenarioRules = [
      tcAffinityPartner
        ? '- AFFINITY PARTNER: Customer came through TrueCar via ' + tcAffinityPartner + '. Reference this directly in opening — it builds instant trust. Example: "I saw your TrueCar request through ' + tcAffinityPartner + ' on the [vehicle]." Do NOT just say "I saw your TrueCar request" — name the partner.'
        : '- Acknowledge the TrueCar request directly: "I saw your TrueCar request on the [vehicle]."',
      '- Do NOT dodge the pricing ask. Position in-store as the way to lock in the best number.',
      sc.noSpecificVehicle
        ? '- NO STOCK NUMBER OR VIN: Do NOT confirm this specific vehicle is available. Say "we have [model] options available" — not "it\'s showing available." Include one qualifying question about trim, color, or configuration.'
        : '- Confirm the vehicle is available if stock/VIN is present using soft language: "showing available."',
      sc.staleModelYear
        ? '- MODEL YEAR NOTE: The vehicle listed may be a prior model year. Do NOT confirm we have a ' + sc.vehicleYear + ' in stock — say "we have the latest RAV4 options available" or reference the current model year generically.'
        : '',
      '- If a trade-in is present, mention it in ALL formats including SMS.',
      '- If there is prior conversation history, reference it naturally.',
      hasPerkspot && employerName
        ? '- EMPLOYER PERK DETECTED: Customer is shopping through their employer (' + employerName + ') via Perkspot/Employee Perks. Reference this directly — it builds trust and shows you read their request: "I saw you are using your ' + employerName + ' employee benefit through TrueCar."'
        : '',
      hasPerkspot && buyerBonus
        ? '- BUYER BONUS: Customer has ' + buyerBonus + ' available through their employer perk program. Mention this as an advantage — it is money they have already earned.'
        : '',
      '- Tone: straightforward and helpful — TrueCar customers are price-aware shoppers.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].filter(Boolean).join('\n');

  } else if (sc.isAMP && !sc.isStalled) {
    scenarioDirective = 'TASK: AMP marketing lead — this customer received a dealership marketing email and engaged with it. The specific email content is NOT available. Reach out as a warm personal follow-up without referencing what the email said.';
    scenarioRules = [
      '- NEVER reference the email content, what the email offered, or what vehicle it mentioned — you do not have that information.',
      '- NEVER say "I saw you clicked" or "I noticed you opened" — do not reveal tracking.',
      '- Frame as a natural check-in: "I wanted to personally reach out" or "We sent you some information recently and I wanted to follow up."',
      '- This is a previous customer — use the relationship as the reason to reach out.',
      '- If their current vehicle is known from service history or notes, reference it as context: "A lot of our [vehicle] owners are finding this a great time to explore what\'s new."',
      '- If no vehicle info is available, keep it general: "We have some exciting options right now and I wanted to make sure you had a chance to see them."',
      '- Position the visit as easy and low-pressure — come take a look, no obligation.',
      '- Tone: warm, familiar, like a check-in from someone who knows them. Not a cold pitch.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isCapitalOne) {
    scenarioDirective = 'TASK: Capital One pre-qualification lead.';
    scenarioRules = [
      '- Use "pre-qualification" language only. Never "approved" or "guaranteed rate."',
      '- Position: match the pre-qualification to the right vehicle and confirm final structure in person.',
    ].join('\n');

  } else if (sc.isApptConfirmation) {
    // Check if there's also an inventory warning — vehicle may have sold since appointment was made
    const apptWithSoldVehicle = data.context && /vehicle status: sold/i.test(data.context);
    scenarioDirective = 'TASK: Appointment is already confirmed. Write a warm confirmation message — NOT a new close or re-pitch.';
    var apptDetailsStr = data.apptDetails || '';
    scenarioRules = [
      '- NEVER offer new appointment times. NEVER say "would X or Y time work" — the time is set.',
      '- NEVER re-pitch the vehicle from scratch.',
      apptDetailsStr ? '- Appointment details: ' + apptDetailsStr + '. Reference these specifically.' : '- Reference the appointment day/time from the conversation.',
      '- SMS: brief and warm. Confirm the time, ask them to reply C or YES.',
      '- Email: confirmation tone — recap what will be ready for them (vehicle pulled up, numbers prepared). Make them feel taken care of before they arrive.',
      '- If customer asked a question in their last message, answer it FIRST then confirm the appointment.',
      apptWithSoldVehicle
        ? '- VEHICLE AVAILABILITY: Do not confirm or deny. Focus on the visit. Team handles this in person.'
        : '- Reassure them everything will be ready: "We will have the vehicle pulled up and ready for you."',
      '- Tone: excited to see them, organized, low pressure.',
    ].filter(Boolean).join('\n');

  } else if (sc.isExitSignal) {
    var isComplaint = /not satisfied|bad experience|sharing.*experience|terrible|horrible|never.*back|not.*back|won.t be back/i.test((data.lastInboundMsg || '') + ' ' + (data.context || '').substring(0, 500));
    scenarioDirective = isComplaint
      ? 'TASK: Customer had a bad experience and is expressing dissatisfaction. This requires a genuine, empathetic acknowledgment — NOT a closing pitch or a generic goodbye.'
      : 'TASK: Customer has purchased elsewhere or is not interested. Write a gracious closing message.';
    scenarioRules = isComplaint ? [
      '- LEAD with a sincere apology and acknowledgment: "I am sorry to hear that your experience did not meet your expectations — that is not the standard we hold ourselves to."',
      '- Do NOT make excuses. Do NOT say "we would love another chance" as a sales pitch.',
      '- 2-3 sentences. Acknowledge the frustration genuinely. Leave the door open only if it feels natural — not as a close.',
      '- No appointment offer. No vehicle pitch. No promotional language.',
      '- Tone: humble, sincere, human. This is damage control not a sales message.',
    ].join('\n') : [
      '- 2-3 sentences max. No vehicle pitch. No appointment offer.',
      '- Wish them well. Leave door open for future service.',
      '- Tone: warm, zero pressure.',
    ].join('\n');

  } else if (sc.isPauseSignal) {
    scenarioDirective = 'TASK: Customer needs more time. Write a soft empathetic check-in.';
    scenarioRules = [
      '- One natural question or warm acknowledgment. No appointment pressure.',
      '- Leave the door open naturally.',
    ].join('\n');

  } else if (sc.isShowroomFollowUp) {
    const visitTiming = data.showroomVisitToday ? 'earlier today' : 'recently';
    const visitRef = data.showroomVisitToday ? '"I heard you stopped in earlier today"' : '"I heard you stopped in recently" or "I wanted to follow up on your visit."';
    scenarioDirective = 'TASK: Customer visited the dealership and met with the Sales Rep. The BD Agent is writing this follow-up but was NOT present for the visit.';
    scenarioRules = [
      '- NEVER say "it was great meeting you" or "it was a pleasure meeting you" — the BD Agent did not meet the customer.',
      '- Reference the visit with accurate timing: ' + visitRef,
      '- If the Sales Rep name is known from context, reference them by name: "I heard you spent some time with [Sales Rep]" or "I saw you stopped in to see [Sales Rep]" — do NOT say it was a "great" visit. The BD Agent was not there and cannot judge how it went.',
      '- Do not use first-touch language.',
      '- Frame return visit as finalizing, not starting.',
      '- Offer the two appointment times for a return visit.',
    ].join('\n');

  } else if (sc.isLoyalty) {
    var equityHook = '';
    if (data.equityAmount) {
      var isPositiveEquity = !data.equityAmount.includes('-') && !data.equityAmount.includes('(');
      equityHook = isPositiveEquity
        ? 'EQUITY DATA: Customer has positive equity of ' + data.equityAmount + ' on their ' + (data.equityVehicle || data.vehicle || 'current vehicle') + '. Use this as the hook — they are in a strong position to upgrade.'
        : 'EQUITY DATA: Customer equity is ' + data.equityAmount + ' on their ' + (data.equityVehicle || data.vehicle || 'current vehicle') + '. Be sensitive — do not lead with the negative number. Focus on the upgrade opportunity and new payment structure instead.';
    }
    var isFirstTouch = !data.hasOutbound;
    var isPositiveEquity = data.equityAmount && !data.equityAmount.includes('-') && !data.equityAmount.includes('(');
    scenarioDirective = 'TASK: Loyalty/equity review — customer is in a manufacturer finance program. Vehicle shown is their CURRENT car, not inventory. Goal: get them in for a no-pressure options review.';
    scenarioRules = [
      '- NEVER say the vehicle "has sold," "is available," or reference its inventory status — it is their current car.',
      isFirstTouch
        ? '- FIRST TOUCH: Keep it warm and curiosity-driven. Do NOT mention equity numbers, tier pricing, or financing terms — those are in-person conversations. This message should feel like a friendly heads-up, not a finance pitch.'
        : '- FOLLOW-UP: Customer is already engaged — you may reference equity and options more directly.',
      isFirstTouch && isPositiveEquity
        ? '- You may tease the equity position without quoting the number: "I pulled up your account and you may be in a better position than you think to make a move." Do NOT say the dollar amount in a first touch.'
        : (!isFirstTouch && equityHook ? equityHook : '- Reference their current ownership and position the upgrade as a natural next step.'),
      '- FORBIDDEN in first-touch: "tier pricing", "estimated equity", "financing piece", "balance", specific dollar amounts.',
      '- Frame the visit as a no-pressure review: "It only takes about 30-45 minutes to go over your options and see what makes sense for you."',
      '- Do NOT pitch a specific new vehicle unless one is listed in the lead.',
      sc.isAudi  ? '- AFS (Audi Financial Services): Premium loyalty review. Concierge tone.' :
      sc.isKia   ? '- KMF (Kia Motors Finance): Kia loyalty upgrade review.' :
      sc.isHonda ? '- HFS (Honda Financial Services): Honda loyalty/equity review.' :
      sc.isToyota? '- TFS (Toyota Financial Services): Toyota loyalty/equity review.' :
                   '- Loyalty finance review.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].filter(Boolean).join('\n');

  } else if (sc.isFollowUp) {
    scenarioDirective = sc.isStalled
      ? 'TASK: Re-engagement outreach on a stalled lead. No confirmed contact has been made. This customer has seen your name before but has not responded. Write a warm, brief re-engagement — not a first-touch pitch, not an apology tour.'
      : 'TASK: Follow-up on an existing conversation. Read the FULL transcript carefully and write a message that accurately reflects where things stand RIGHT NOW.';
    const briefs = [];
    if (sc.customerLastSaid) briefs.push('Customer last said: [' + sc.customerLastSaid + ']');
    if (sc.hasUnresolvedIssue && sc.unresolvedText) briefs.push('Unresolved issue: ' + sc.unresolvedText);
    if (sc.actionNeeded) briefs.push('Your specific task: ' + sc.actionNeeded);
    const trimPref = (data.context||'').match(/Customer expressed interest in:\s*([^\n.\]]+)/i);
    const callNote = (data.context||'').match(/Most recent call note:\s*\[([^\]]+)\]/i);
    if (trimPref) briefs.push('Customer vehicle preference from prior conversation: ' + trimPref[1].trim());
    if (callNote) briefs.push('What was discussed on last call: ' + callNote[1].trim());

    const stalledRules = sc.isStalled ? [
      '- STALLED LEAD RULES:',
      '- Open with ONE hook or ONE brief acknowledgment — then immediately the reason. Not both, not three setups.',
      '- BEST openers: "Still thinking about the [vehicle]?" or "Wanted to make sure I didn\'t miss you —" then ONE reason.',
      '- SMS: 3-4 sentences. Hook + warm context + close. No setup language. Enough to feel like a real person texted, not a bot.',
      '- SMS EXAMPLE (RIGHT): "Hi Samantha, Kristen from Community Kia. Still thinking about upgrading your Optima? Would today at 3:00 or tomorrow at 10:30 work for a quick look?"',
      '- SMS EXAMPLE (WRONG): "We sent you some info recently, and with your Optima, I thought you might be interested in what\'s new. Could you stop by for 30-45 minutes today at 4 PM or tomorrow at 11 AM?" — this is setup, not a hook. The customer already knows who you are.',
      '- DO NOT open with "Great to hear from you again" — there has been no recent re-engagement. The customer has gone quiet.',
      '- DO NOT open with Click & Go framing ("I saw you started your deal online") — the DRS/Gubagoo source is the original lead channel, NOT a new submission. Leading with it is factually misleading.',
      '- If KNOWN HISTORY shows a showroom visit: lead with that specific visit — "I know the [vehicle] wasn\'t quite the right fit when you came in" — then open a new door.',
      sc.isAMP ? '- AMP source: the marketing email already went out days ago. Do NOT reference it or say "we sent you some information." Treat this purely as a warm re-engagement based on their vehicle ownership.' : '',
      !data.vehicle && data.ownedVehicle ? '- No vehicle of interest on this lead. Reference the customer\'s current vehicle (' + data.ownedVehicle + ') as the context for the upgrade conversation. Do NOT name any other vehicle.' : '',
      !data.vehicle && !data.ownedVehicle ? '- No vehicle attached to this lead. Do NOT reference or name any vehicle. Keep the message general — invite them in to see what\'s new.' : '',
      '- Email: 3 short paragraphs MAX — one hook sentence, one specific reason tied to their vehicle, one ask. Skip "Hope you\'re having a good Thursday" and all similar pleasantries.',
      '- Voicemail: one acknowledgment, one compelling hook, callback number. Done.',
      '- Short and specific wins. The goal is ONE reply, not a sale.',
    ].filter(Boolean) : [];

    scenarioRules = [
      ...stalledRules,
      sc.isStalled ? '' : '- Do NOT use a first-touch opening. This is a continuation of an existing conversation.',
      sc.isStalled ? '' : '- CONCERN-FIRST RULE: If IDENTIFIED CUSTOMER CONCERNS are listed above, your opening MUST directly address the top concern. Do not acknowledge it mid-message or at the end — lead with it. A response that ignores the customer\'s stated concern and opens with a generic vehicle pitch is a failure.',
      sc.isStalled ? '' : '- CONCERN EXAMPLES (RIGHT): "Hi Maria, I wanted to make sure we could work with your budget before you come in —" or "Hi James, wanted to follow up on the numbers you were looking at —"',
      sc.isStalled ? '' : '- CONCERN EXAMPLES (WRONG): "Hi Maria, just wanted to check in on the CR-V — we have it ready for you!" (ignores the budget concern entirely)',
      '- TONE CALIBRATION — CRITICAL: Match the register of the actual conversation across ALL THREE formats. If the conversation is casual texts, write ALL formats (SMS, email, voicemail) with that same warmth. The email should NOT flip into corporate formal mode just because it is an email — it should feel like the same person who sent the SMS.',
      '- EMAIL TONE RULE: When the conversation has been casual and text-based, the email should open with energy, not pleasantries. Skip "I hope this email finds you well." Skip "Thank you for letting me know." Start with the forward motion — same as the SMS.',
      '- EXAMPLE of the RIGHT email tone for a casual text follow-up:',
      '  WRONG email opening: "Hi Michael, Thanks for letting me know you need to discuss the Highlander with your wife. That\'s perfectly understandable! The 2011 Toyota Highlander Limited is still showing available..."',
      '  RIGHT email opening: "Hi Michael, Bring your wife by — the Highlander is still here and we\'re open till 8. Would 4:00 or 4:45 PM work for you both?"',
      '- BREVITY RULE: Match the energy of the conversation. Same-day hot active thread = 2-3 sentences. Standard follow-up or first touch = 3-5 sentences is ideal. SMS should feel complete — not clipped.',
      '- Never re-state information the customer already knows from the conversation.',
      '- Never start with "I understand..." — lead with energy and forward motion instead.',
      '- CRITICAL: If a note says "she said for me to call her at [TIME]" — the call has NOT happened yet.',
      '- CRITICAL: Check WHO made each note. If the Sales Rep made a call note, acknowledge their conversation.',
      '- If customer expressed a trim or model preference, reference THAT specifically.',
      '- Write only what is true based on what has actually happened in the transcript.',
      sc.noSpecificVehicle ? '- NO SPECIFIC VEHICLE SELECTED: Ask one question to advance toward a specific unit.' : '',
      briefs.length ? '\nKey context:\n' + briefs.join('\n') : '- Reference prior contact and advance the conversation directly.',
    ].filter(Boolean).join('\n');

  } else if (sc.isTradePending) {
    scenarioDirective = 'TASK: Customer submitted a trade-in inquiry through TradePending — they want to know what their vehicle is worth.';
    scenarioRules = [
      '- Open by acknowledging their trade submission specifically.',
      '- IMPORTANT: The CONVERSATION TRANSCRIPT may contain a TradePending data dump with market values, dollar amounts, and vehicle statistics. This is NOT customer communication — it is system data. IGNORE all numbers, credit references, and market data in system notes.',
      '- Do NOT reference any dollar amounts, market values, or credit information from the system data.',
      '- Curiosity hook: "The online estimate is a great starting point — an in-person appraisal can often improve on that number."',
      '- Keep it simple: acknowledge the trade, invite them in for the appraisal, give appointment times.',
      '- Never guarantee a higher trade value.',
      '- Duration: appraisal takes about 10-15 minutes, full visit 30-45 minutes.',
      '- Two-time close.',
    ].join('\n');

  } else if (sc.isCarGurusDD) {
    scenarioDirective = 'TASK: Customer used the CarGurus deal builder. Acknowledge the CarGurus deal structure.';
    scenarioRules = [
      '- Open: "I saw you put together a deal structure on CarGurus."',
      '- NOT Click & Go. Never say Gubagoo.',
      '- Next step: confirm the details in person.',
    ].join('\n');

  } else if (sc.isKBB) {
    scenarioDirective = 'TASK: KBB Instant Cash Offer lead — customer got an online trade value estimate through Kelley Blue Book.';
    scenarioRules = [
      '- NEVER quote the specific dollar amount from the KBB offer — the in-person appraisal may differ and quoting it sets an expectation we may not meet.',
      '- Reference the offer existance positively but neutrally: "I saw your KBB offer come through" or "the online estimate is a great starting point."',
      '- Hook: position the in-person appraisal as where they get the real number — often better than the online estimate.',
      '- Include KBB disclosure naturally: "The KBB value is based on what you submitted online — an in-person look lets us confirm everything and often improve on that number."',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isAIBuyingSignalNew) {
    scenarioDirective = 'TASK: AI Buying Signal — new prospect actively shopping for a vehicle. This customer has NO prior relationship with this dealership. The vehicle shown in the lead is the category they are interested in — use it to identify the segment (truck, SUV, sedan, etc.) but do NOT assume we carry that exact make/model.';
    scenarioRules = [
      '- CRITICAL: This is a BRAND NEW prospect — no ownership hook. Do NOT say "still driving the [vehicle]" — you have no idea what they drive.',
      '- NEVER name the specific vehicle from the lead in the message — it may be a competitor brand we do not carry (e.g. Ford F-150 at a Honda dealer).',
      '- NEVER reveal online activity was tracked. No "I saw you were looking at", "I noticed you", "I saw you browsing".',
      '- NEVER ask "are you looking new or pre-owned" — new/used data is unreliable. Skip this question entirely.',
      '- Identify the CATEGORY from the vehicle name: F-150/Tacoma/Tundra/Ram/Silverado → TRUCK; RAV4/CR-V/Equinox/Rogue/Explorer → SUV; Camry/Accord/Altima/Malibu → SEDAN; etc.',
      '- REQUIRED OPENING for new prospects (no ownership): "[First name], I wanted to reach out — we have some great [truck/SUV/sedan] options available right now that I think would be a perfect fit."',
      '- Include ONE genuine qualifying question about what matters to them: "What features are most important to you?" or "Are you set on a specific trim or are you open to options?"',
      '- Do NOT ask for their phone number in the email if they already have one on file. Only ask in SMS if no phone number exists.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
      '- Tone: warm, helpful, consultative — not a cold pitch.',
    ].join('\n');

  } else if (sc.isAIBuyingSignalReturner) {
    scenarioDirective = 'TASK: AI Buying Signal — previously sold customer showing active shopping behavior. The system detected buying signals from their recent online activity. Use the BUYING SIGNAL DATA field to understand what they are interested in NOW — do NOT rely on old conversation history which may be years old.';
    scenarioRules = [
      '- CRITICAL: The BUYING SIGNAL DATA tells you what the customer is actively shopping for. Use it to understand their category interest only.',
      '  - Vehicle model name (e.g. "Camry", "Tacoma") = their interest. Reference this model in your message.',
      '  - "Actively Shopping" = high intent. The customer is in the market now.',
      '  - New/Used designation and price range = IGNORE BOTH. These signals are unreliable. Do not constrain your message by them. Let the agent handle inventory positioning in person.',
      '- AVOID words that imply inventory type when unknown: "newer model", "newer models", "latest model", "brand new", "new [model]", "upgrade to a new". ',
      '- For the email subject line: Do NOT use "upgrade" — it implies new inventory. Use neutral subjects like: "Your [model]" or "[Model] options for you" or "Checking in on your [model] search".',
      '- In the message body: replace "upgrading your [vehicle]" with "your next [vehicle]" or "your [vehicle] search" — neutral framing that works for any inventory type.',
      '- CRITICAL: Do NOT reference any marketing event, promotional offer, or APR deal from the transcript — these are mass blast campaigns unrelated to the customer\'s personal buying intent.',
      '- The customer\'s prior purchase is CONTEXT only — do not make it the subject of the message.',
      '- Do NOT reference any conversation notes older than 6 months.',
      '- NEVER use these FORBIDDEN phrases: "I was looking at your [vehicle]", "I was looking at your Corolla", "I was looking at your trade", "I was looking at your [anything]", "I saw you were looking at", "I noticed you viewed", "you were browsing", "I saw your activity". The phrase "I was looking at your [vehicle]" is THE most common wrong opener — it sounds like the agent physically inspected their car. It is ALWAYS wrong. Rewrite using the OPENING FORMULA above instead.',
      '- REQUIRED OPENING FORMULA — pick one of these natural framings:',
      '  OPTION A (ownership hook): "[First name], still driving the [owned vehicle]? We have some great [category] options available right now that I think you\'d love."',
      '  OPTION B (direct offer): "[First name], we just got a few [used/new] [category] options in that I think would be a perfect upgrade from your [owned vehicle]."',
      '  OPTION C (no owned vehicle): "[First name], I wanted to reach out — we have some great [used/new] [category] options available right now that might be exactly what you\'re looking for."',
      '- Do NOT say "I was looking at your [vehicle]" — this sounds like the agent was staring at their car. The agent does not physically look at a customer\'s vehicle.',
      '- Tone: warm, low-pressure, relationship-first. This is a VIP customer — treat them like one.',
      '- CLOSE: Soft two-time close — frame as looking not buying. Only offer times if customer is warm. If hesitant, ask what day works instead of offering specific times.',
      '- EXAMPLE (RIGHT — SMS): "Roberto, still driving the Corolla? We have a few Tacomas available right now that I think would be a great fit. Could you stop by at 4:45 or 5:30 today?"',
      '- EXAMPLE (RIGHT — EMAIL opening): "Roberto, still driving the Corolla? We have a few Tacomas available that I think would be a great next step. I can have one ready for you to see — would 4:45 PM or 5:30 PM work today?"',
      '- EXAMPLE (WRONG): "Roberto, I was looking at your 2022 Corolla and I saw you were browsing our Tacoma inventory..." — Wrong because: exposes tracking, uses creepy "I was looking at your car" phrasing, ignores what the customer is actually interested in.',
    ].join('\n');

  } else if (sc.isAutoTrader) {
    var isAutoTraderKBB = /autotrader.*kbb|kbb.*autotrader/i.test(data.leadSource || '');
    scenarioDirective = 'TASK: AutoTrader lead — customer found this vehicle on AutoTrader and submitted an inquiry. They are an active buyer researching a PURCHASE, not a trade-in.';
    scenarioRules = [
      isAutoTraderKBB
        ? '- Source is AutoTrader/KBB combined — customer saw this vehicle listed with KBB pricing data. This is a PURCHASE inquiry. Do NOT treat as a trade-in cash offer.'
        : '- Open: "I saw your inquiry come through on AutoTrader for the [vehicle]."',
      '- AutoTrader shoppers are comparison shopping — your first response needs to stand out.',
      '- Give them ONE specific reason to come to you: price confidence, vehicle condition, fastest availability.',
      sc.vehicleSold ? '- Vehicle is sold — pivot immediately to comparable options.' : '- Confirm availability with confidence if stock/VIN is present.',
      '- Tone: direct, no fluff. They know what they want.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].filter(Boolean).join('\n');

  } else if (sc.isCarscom) {
    var tahoeVehicle = data.vehicle || 'vehicle';
    var hasStockNum = !!(data.stockNum || data.vin) && !data.inventoryWarning; // suppress if inventory warning active
    var stockConfirm = hasStockNum ? ' We have it here and it is available to see.' : '';
    var vehicleRef = data.vehicle || 'the vehicle';
    scenarioDirective = 'TASK: Cars.com lead — first contact. Customer just submitted an inquiry for the ' + vehicleRef + '. No prior communication exists.';
    scenarioRules = [
      '━━ FIRST CONTACT — ZERO PRIOR HISTORY ━━',
      'The agent has NEVER contacted this customer. No messages sent. No calls made. This is the very first outreach.',
      'REQUIRED SMS OPENER: "[First name], I saw your Cars.com inquiry for the ' + vehicleRef + ' — ' + (hasStockNum ? 'we have it here and it is ready to see.' : 'I wanted to reach out directly.') + '"',
      'REQUIRED EMAIL OPENER: "[First name],\n\nI saw your inquiry come through on Cars.com for the ' + vehicleRef + '.' + stockConfirm + ' I wanted to reach out directly."',
      hasStockNum ? '- ✅ VEHICLE IS CONFIRMED IN STOCK: Say "we have it here" or "it is here and ready to see". NEVER say "similar options", "a selection of", or "other SUVs". The customer asked about THIS vehicle and it IS available.' : '- No stock number — vehicle availability unconfirmed. Offer to check.',
      'BANNED OPENERS — these are WRONG and must NOT appear anywhere:',
      '  ✗ "I have been..." / "I have been getting..." / "I have been working..."',
      '  ✗ "I am still..." / "still working on..." / "still looking into..."',
      '  ✗ "I wanted to follow up..." / "following up on..."',
      '  ✗ "I have been organizing..." / "getting everything ready..."',
      '  ✗ ANY phrase that implies the agent already started working before this message',
      sc.vehicleSold ? '- Vehicle is sold — pivot to comparable options without bait-and-switch language.' : '',
      '- Cars.com shoppers compare dealers — give ONE concrete reason to come to you.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].filter(Boolean).join('\n');

  } else if (sc.isEdmunds) {
    scenarioDirective = 'TASK: Edmunds lead — this is a research-first, price-aware buyer who did their homework before reaching out.';
    scenarioRules = [
      '- Open: "I saw your inquiry come through on Edmunds for the [vehicle]."',
      '- Edmunds shoppers are the most informed buyers — treat them as equals, not prospects.',
      '- Do NOT dodge pricing or give a vague "come in and we will talk numbers" response.',
      '- Position the visit as where the real numbers get locked in: "The best I can do on price and trade is in person — I want to make sure you leave with the right deal, not just a quote."',
      '- Tone: knowledgeable, direct, zero condescension.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isOEMLead) {
    var oemBrand = /toyota/i.test(data.leadSource||'') ? 'Toyota' : /honda/i.test(data.leadSource||'') ? 'Honda' : /kia/i.test(data.leadSource||'') ? 'Kia' : /hyundai/i.test(data.leadSource||'') ? 'Hyundai' : 'the manufacturer';
    scenarioDirective = 'TASK: OEM/manufacturer website lead — customer came directly from ' + oemBrand + '\'s website. High intent, brand-committed buyer.';
    scenarioRules = [
      '- Open: "I saw your inquiry come through on ' + oemBrand + '.com for the [vehicle]."',
      '- This customer chose the brand FIRST then found a dealer — honor that by leading with brand enthusiasm, not just inventory.',
      '- If they built a specific configuration online (trim, color, packages), reference it specifically — this shows you read their submission.',
      '- If the exact config is not on the lot, offer the closest match and be specific about what is similar.',
      '- Tone: brand-proud, consultative. They are a ' + oemBrand + ' buyer — meet them there.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isPhoneUp) {
    scenarioDirective = 'TASK: Phone-up lead — this customer called in first. This follow-up continues a real conversation that already happened.';
    scenarioRules = [
      '- NEVER treat this as a cold intro. The customer called in — a real conversation already happened.',
      '- The BD Agent writing this may NOT have been on the call — NEVER say "it was great speaking with you" or "I enjoyed our call." Say: "Wanted to follow up on your call with us" or "Following up on your inquiry."',
      '- If call notes exist in the transcript, reference the single most important thing discussed: vehicle, price question, trade value, or timing. Lead with that — do not bury it.',
      '- If no call notes exist: "I wanted to make sure I followed up on your call — we have the [vehicle] and I want to make sure we get you the right information."',
      '- Frame the visit as the natural next step after the call — not a restart.',
      '- If the customer asked a specific question on the call (price, availability, trade value), acknowledge it: do not ignore unanswered questions.',
      '- Tone: warm continuation. They already know the dealership — skip the intro.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isCarGurus) {
    scenarioDirective = 'TASK: CarGurus standard lead — customer submitted a price inquiry or interest form through CarGurus.';
    scenarioRules = [
      '- Open: "I saw your inquiry come through on CarGurus for the [vehicle]."',
      '- CarGurus buyers are highly price-aware — the platform shows them your price vs market average. Do NOT ignore this.',
      '- If your price is competitive, acknowledge it: "You will see our price is well positioned in the market."',
      '- If price sensitivity is apparent, do NOT dodge — position the visit as where you finalize the best possible deal.',
      '- Tone: transparent and confident. CarGurus buyers respect directness.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isFacebook) {
    scenarioDirective = 'TASK: Facebook/Facebook Marketplace lead — customer found this vehicle on Facebook and reached out.';
    scenarioRules = [
      '- Open casually: "I saw your message on Facebook about the [vehicle]."',
      '- Facebook Marketplace buyers skew casual and deal-focused — match that energy. Do NOT be overly formal.',
      '- They often expect a quick, direct answer on price and availability — give it to them.',
      '- Do NOT send a corporate BDC pitch. Write like a real person responding to a Facebook message.',
      '- If no vehicle is specified, ask one simple question: "What are you looking for?"',
      '- Tone: conversational, friendly, zero corporate speak.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isDealerWebsite) {
    scenarioDirective = 'TASK: Dealer website lead — customer submitted an inquiry directly through the dealership website. High intent.';
    scenarioRules = [
      '- Open: "I saw your inquiry come through on our website for the [vehicle]."',
      '- Dealer website leads are high intent — they went to YOUR website specifically, not a third-party marketplace.',
      '- Acknowledge that directly: position the visit as the natural next step from where they already are in the process.',
      '- If stock/VIN is present, confirm availability confidently.',
      '- Tone: welcoming and direct. They chose you — make them feel that was the right call.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isChatLead && !sc.isStalled) {
    // Detect what the customer actually asked or was told in the chat
    var chatContext = (data.context || '').toLowerCase();
    var chatAskedPrice    = /how much|what.s the price|price on|what does it cost|monthly payment|what would (my|the) payment/i.test(chatContext);
    var chatAskedTrade    = /trade.?in|what.s my|how much (is|for) my|trade value/i.test(chatContext);
    var chatAskedAvail    = /is it (still )?available|do you (still )?have|is (that|the) (car|truck|suv|vehicle) (still )?there|in stock/i.test(chatContext);
    var chatAskedFinance  = /financing|get financed|credit|down payment|interest rate/i.test(chatContext);
    var chatGaveNumber    = /here.s my (number|phone)|call me|text me|my (cell|phone|number) is/i.test(chatContext);

    // Detect "size of" / comparison language — customer describing a size/type, not requesting that specific model
    var chatSizeComparison = /about the size of|similar to|like a|something like|comparable to|size of a/i.test(chatContext);
    var chatComparisonVehicle = '';
    var compMatch = chatContext.match(/(?:size of|similar to|like a|something like|comparable to) (?:a |an |the )?(ford |chevy |chevrolet |toyota |jeep |gmc |dodge |ram |nissan |hyundai |kia )?([a-z0-9\- ]{3,20})/i);
    if(compMatch) chatComparisonVehicle = compMatch[0].trim();

    // Map competitor vehicles to Honda/Kia equivalents for natural pivot
    var competitorMap = {
      'explorer': 'Honda Pilot or Passport', 'f-150': 'Honda Ridgeline', 'f150': 'Honda Ridgeline',
      'tahoe': 'Honda Pilot', 'suburban': 'Honda Pilot', 'traverse': 'Honda Pilot',
      'highlander': 'Honda Pilot', 'rav4': 'Honda CR-V or HR-V', 'cr-v': 'Honda CR-V',
      'equinox': 'Honda CR-V', 'escape': 'Honda CR-V or HR-V', 'rogue': 'Honda CR-V',
      'camry': 'Honda Accord', 'corolla': 'Honda Civic', 'altima': 'Honda Accord',
      'sorento': 'Kia Telluride or Sorento', 'telluride': 'Kia Telluride',
      'tucson': 'Kia Sportage', 'santa fe': 'Kia Sorento', 'palisade': 'Kia Telluride'
    };
    var competitorKey = Object.keys(competitorMap).find(function(k) { return chatContext.indexOf(k) !== -1; });
    var hondaEquivalent = competitorKey ? competitorMap[competitorKey] : '';

    var competitorVehicleName = competitorKey ? competitorKey.charAt(0).toUpperCase() + competitorKey.slice(1) : '';
    var chatAnswerHint = chatSizeComparison
        ? 'CHAT CONTEXT: Customer said they want something the size of a ' + (competitorVehicleName || 'competitor vehicle') + '. They are describing a SIZE/TYPE — not requesting that exact brand. Follow this exact approach: (1) Acknowledge naturally: "I saw you were looking for something in the ' + (competitorVehicleName || 'midsize SUV') + ' size range." (2) Ask a qualifying question: "Are you focused on a ' + (competitorVehicleName || 'specific brand') + ' or are you open to seeing how' + (hondaEquivalent ? ' the ' + hondaEquivalent : ' our options') + ' compare in size and layout?" (3) Offer two times. DO NOT confirm or stock-check the competitor vehicle. DO NOT say "we have a Ford Explorer available."'
      : chatAskedPrice   ? 'CHAT QUESTION: Customer asked about price or payment. Acknowledge this first — give a range or invite them in to get exact numbers. Do not ignore it.'
      : chatAskedTrade   ? 'CHAT QUESTION: Customer asked about their trade-in value. Lead with the trade — position the visit as where they get the real number.'
      : chatAskedAvail   ? 'CHAT QUESTION: Customer asked about availability. Confirm it directly if you can, or use urgency language if supply is limited.'
      : chatAskedFinance ? 'CHAT QUESTION: Customer asked about financing. Acknowledge it warmly — Capital One pre-qual or in-store options. Do not over-promise.'
      : '';

    // Deep transcript extraction — pull the actual customer words before building directive
    var chatTranscript = data.context || '';
    // Extract all customer (Guest) lines from transcript
    var guestLines = [];
    var guestMatches = chatTranscript.split('\n').filter(function(l){ return /^Guest/i.test(l.trim()); });
    guestMatches.forEach(function(line) {
      var text = line.replace(/^Guest[^:]*:\s*/i, '').trim();
      if(text && text.length > 3) guestLines.push(text);
    });
    var customerSaid = guestLines.join(' | ');

    // Extract what was already told to the customer in chat
    var agentChatLines = [];
    var agentMatches = chatTranscript.split('\n').filter(function(l){ return /Brittney|Jessica|resq/i.test(l.split(':')[0]||''); });
    agentMatches.forEach(function(line) {
      var text = line.replace(/^[^:]+:\s*/i, '').trim();
      if(text && text.length > 5) agentChatLines.push(text);
    });
    var agentToldCustomer = agentChatLines.join(' | ');

    // Detect specific customer intent from their actual words
    var chatWantsTestDrive = /test drive|test-drive|drive one|try one|drive it/i.test(customerSaid);
    var chatOpenToUsed = /used|pre.?owned|lightly used|certified|cpo|\d{2,3}k miles/i.test(customerSaid);
    var chatComparingModels = /or|vs|versus|between|deciding between|either/i.test(customerSaid) && guestLines.length > 1;
    var chatUnansweredQuestion = agentChatLines.some(function(l){ return /give me|another minute|still checking|not sure yet/i.test(l); });

    scenarioDirective = 'TASK: Chat lead — customer had a LIVE conversation on the dealer chat. You have the FULL transcript. Your job is to pick up EXACTLY where the chat left off — not restart it.';
    scenarioRules = [
      '- ⚠ MANDATORY: Read the full chat transcript in CONTEXT & HISTORY before writing a single word. The customer already told you what they want.',
      '- WHAT THE CUSTOMER SAID: ' + (customerSaid || 'See transcript'),
      chatUnansweredQuestion ? '- ⚠ UNANSWERED QUESTION IN CHAT: The agent left something unresolved. Your FIRST job is to answer or address that before anything else.' : '',
      chatWantsTestDrive ? '- CUSTOMER WANTS A TEST DRIVE: They specifically asked about test driving. Lead with scheduling the test drive — not a generic visit invite.' : '',
      chatOpenToUsed ? '- CUSTOMER IS OPEN TO PRE-OWNED: They said they are open to lightly used or certified options. Reference this — do not only pitch new inventory.' : '',
      chatComparingModels ? '- CUSTOMER IS COMPARING MODELS: They are deciding between options. Help them compare — do not pick one for them or ignore the other.' : '',
      chatAnswerHint || '- Lead with the most important thing the customer said in the chat.',
      '- NEVER re-introduce yourself, the dealership, or ask questions already answered in the chat.',
      '- NEVER say "Gubagoo", "chat platform", "virtual assistant" — reference naturally: "your chat earlier" or "from our conversation this morning."',
      '- Tone: you are continuing the chat conversation, not starting a new one. Same energy. Same context.',
      '- SMS: One direct reaction to what they said + one ask. Under 4 lines.',
      '- Email: Open by continuing from where the chat left off. Reference their specific request.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY.',
    ].filter(Boolean).join('\n');

  } else if (sc.isCarFax) {
    scenarioDirective = 'TASK: CarFax/third-party listing lead — customer found this vehicle through a vehicle history or listing platform.';
    scenarioRules = [
      '- Open: "I saw your inquiry come through about the [vehicle]."',
      '- CarFax buyers are research-oriented — they care about vehicle history and condition.',
      '- If condition/mileage/history info is available, reference it positively.',
      '- Tone: transparent and reassuring. These buyers want confidence in the vehicle, not just a price.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isRepeatCustomer) {
    var priorVehicle = data.ownedVehicle || '';
    var priorMiles = data.ownedMileage || '';
    scenarioDirective = 'TASK: Repeat/returning customer — this person has done business with the dealership before. They came back because they trust you.';
    scenarioRules = [
      '- NEVER treat this as a cold intro. They are family — they came back.',
      '- Acknowledge the relationship immediately: "It\'s great to hear from you again" or "Welcome back!"',
      priorVehicle ? '- Reference their current vehicle naturally: "I see you\'re still in your ' + priorVehicle + (priorMiles ? ' with ' + priorMiles + ' miles' : '') + ' — let\'s see what we can do for you."' : '- If prior vehicle is known from notes, reference it to show you know their history.',
      '- Position the new vehicle as a natural next step, not a sales pitch.',
      '- Skip the standard first-touch pitch — they know how this works. Get to what matters for them.',
      '- Tone: warm, familiar, genuinely happy they came back. Like picking up where you left off.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].filter(Boolean).join('\n');

  } else if (sc.isThirdPartyOEM && !sc.isStalled) {
    var oemRef = /kia/i.test(data.leadSource||'') ? 'Kia' : /honda/i.test(data.leadSource||'') ? 'Honda' : /toyota/i.test(data.leadSource||'') ? 'Toyota' : /hyundai/i.test(data.leadSource||'') ? 'Hyundai' : /audi/i.test(data.leadSource||'') ? 'Audi' : 'the manufacturer';
    scenarioDirective = 'TASK: Third-party OEM / manufacturer partner lead — customer came through an official ' + oemRef + ' marketing or partner program.';
    scenarioRules = [
      '- This customer is brand-committed — they engaged with ' + oemRef + ' directly before landing here.',
      '- Open by acknowledging the brand connection: "I saw your inquiry come through our ' + oemRef + ' partner program."',
      '- Lead with brand enthusiasm and model highlights — they want to be confirmed in their choice.',
      '- If a specific vehicle or trim is on the lead, reference it. These customers often have strong preferences.',
      '- Tone: brand-proud, warm, and confident. They chose ' + oemRef + ' — validate that.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isGoogleAd && !sc.isStalled) {
    scenarioDirective = 'TASK: Google Digital Advertising lead — customer clicked a paid ad and submitted their info.';
    scenarioRules = [
      '- This customer was actively searching and clicked YOUR ad — high intent, act fast.',
      '- Open directly: "I saw your inquiry come through — you were looking at the [vehicle]."',
      '- Do NOT mention Google or the ad — just treat it as a direct inquiry.',
      '- Google ad shoppers are often comparison shopping multiple results at once — speed and specificity win.',
      '- Tone: direct, fast, confident. First responder wins here.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else if (sc.isReferral && !sc.isStalled) {
    scenarioDirective = 'TASK: Referral lead — someone who knows this customer recommended the dealership.';
    scenarioRules = [
      '- Acknowledge the referral immediately — it is the reason they reached out.',
      '- Open: "I heard [referral source if known] sent you our way — that means a lot to us." If referral name unknown: "I understand someone referred you to us."',
      '- Referral customers have built-in trust — do NOT squander it with a generic pitch.',
      '- The tone should feel like you\'re welcoming a friend of a friend, not a cold prospect.',
      '- Do NOT push hard on appointment times immediately — build the connection first, then offer.',
      '- Tone: genuinely warm, grateful, personal.',
      '- CLOSE: Apply the appropriate tier from CLOSE STRATEGY. Warm engaged leads get two specific times. Leads with objections or open questions get a qualifying question first.',
    ].join('\n');

  } else {
    scenarioDirective = 'TASK: Standard first-touch response to a new inquiry.';
    if (sc.noSpecificVehicle) {
      scenarioRules = [
        '- Customer has expressed interest in the model/trim but NO specific unit has been confirmed (no stock number, no VIN).',
        '- Do NOT confirm availability of any specific unit, color, or configuration — none has been verified.',
        '- Do NOT say "we have the [color] available" — you do not know what is on the lot.',
        '- Use soft language: "we have Tellurides available" not "we have the Ebony Black Telluride available."',
        '- Include ONE qualifying question to narrow down what they want: color preference, trim, new vs pre-owned, budget.',
        '- CLOSE: Two-time close is appropriate here — customer is engaged. Offer two specific times.',
      ].join('\n');
    } else {
      scenarioRules = '- Standard structured response with one qualifying statement, duration, and two-time close.';
    }
  }

  // ── Inventory status overrides scenario directive for first-touch ─
  // Only applies when this is a first-touch lead (not follow-up/exit/etc.)
  if (!sc.isFollowUp && !sc.isExitSignal && !sc.isPauseSignal && !sc.isApptConfirmation && !sc.isShowroomFollowUp && !sc.isSoldDelivered) {
    if (sc.vehicleInTransit) {
      scenarioDirective = 'TASK: This vehicle is IN TRANSIT — the VIN is confirmed, meaning it exists and is assigned, but it has not yet arrived on the lot. This is a STRONG selling opportunity — the customer can secure it before it arrives.';
      scenarioRules = [
        '- LEAD WITH THE GOOD NEWS: Open with the fact that the vehicle is confirmed and available to secure.',
        '- REQUIRED opening: "Great news — the [vehicle] you are looking at is confirmed and on its way to our lot. You can secure it now before it arrives."',
        '- Create urgency around SECURING it: "Vehicles like this one often get spoken for before they even hit the lot."',
        '- Position the visit as locking it in: "If you can come in, we can get the paperwork started so it is reserved for you the moment it arrives."',
        '- Do NOT say the vehicle is available to see or test drive — it is not on the lot yet.',
        '- Do NOT offer to hold it without a visit — the visit IS the hold.',
        '- If trade is present: "We can also start on your trade-in appraisal now so everything is ready when the vehicle arrives."',
        '- Tone: excited, confident, exclusive — make the customer feel like they are getting first access.',
        '- Duration: adjust framing — "It usually takes about 30 minutes to get everything set up so the vehicle is reserved for you."',
        '- Two-time close still required.',
      ].join('\n');
    } else if (sc.vehicleSold) {
      scenarioDirective = 'TASK: The specific vehicle of interest has been sold. Your job is to pivot to alternatives WITHOUT making the customer feel misled or like a bait-and-switch.';
      scenarioRules = [
        '- NEVER say "no longer available", "sold out", or "unfortunately that one is gone" — these feel like bad news leads.',
        '- NEVER open with the bad news. Lead with what you DO have, then mention the original is spoken for.',
        '- PIVOT FORMULA: "We actually just had a [comparable vehicle] come in that I think you are going to love — it is very similar to the [original] you were looking at. I would love to show it to you."',
        '- If you must mention the sold status: "That specific one has been spoken for, but..." — then immediately to the alternative.',
        '- Reference the CATEGORY/MODEL — not a generic "we have other options." Be specific about what is comparable.',
        '- If trim, color, or features were mentioned: acknowledge them in the comparable option. "I found one in [similar color/trim] that I think checks the same boxes."',
        '- Tone: positive and excited about the alternative — not apologetic about the sold unit.',
        '- CLOSE: Two-time close is appropriate here — customer is engaged. Offer two specific times.',
      ].join('\n');
    }
  }

  // ── Inventory notes (for loyalty vehicle only — others handled above) ─
  let inventoryNote = '';
  if (sc.isLoyaltyVehicle) {
    inventoryNote = 'VEHICLE NOTE: This is the customer\'s current owned vehicle — not dealership inventory. Never reference its availability.';
  } else if (sc.staleModelYear) {
    inventoryNote = 'VEHICLE NOTE: The vehicle listed is a ' + sc.vehicleYear + ' model year, which is prior to the current year (' + currentYear + '). Do NOT confirm we have this specific model year in stock. Reference "the latest [model] options available" or the current model year instead. Never say a prior-year model "is showing available."';
  } else if (!sc.vehicleInTransit && !sc.vehicleSold && data.vehicle) {
    inventoryNote = 'Vehicle is currently showing available. Use soft confirmation language only: "showing available."';
  }

  // ── Audi Brand Specialist ──────────────────────────────────────
  let audiNote = '';
  if (sc.isAudi) {
    audiNote = [
      'AUDI CONCIERGE PERSONA — CRITICAL:',
      '- The agent is an Audi Concierge, not a generic sales coordinator. This distinction must come through in the writing.',
      '- SMS opening: "Hi [Name], this is [Agent], your Audi Concierge at Audi Lafayette."',
      '- Email opening: "Hi [Name], this is [Agent], your Audi Concierge at Audi Lafayette." — NOT "I hope this email finds you well."',
      '- Voicemail opening: "Hi [Name], this is [Agent], your Audi Concierge at Audi Lafayette."',
      '- The word "Concierge" must appear in the opening introduction of every format.',
      '- Tone: elevated, white-glove, personalized. Audi is a luxury brand — the communication should feel premium.',
      '- Never use generic BDC language like "I\'m reaching out regarding your inquiry." Instead: "I wanted to personally reach out..." or "I\'m personally following up..."',
      sc.salesRep
        ? '- Brand Specialist for this visit: ' + sc.salesRep + ' — reference as "your Audi Brand Specialist, ' + sc.salesRep + '"'
        : '- No Brand Specialist assigned — reference as "one of our Audi Brand Specialists."',
      sc.nonAudiVehicle
        ? '- NON-AUDI VEHICLE AT AUDI STORE: This is a pre-owned ' + (sc.vehicleBrand || 'non-Audi') + ' at Audi Lafayette. The Audi Concierge persona and Brand Specialist reference remain — that is the store experience. However do NOT describe the vehicle itself using Audi brand language. Do NOT say the vehicle has "Audi engineering" or "Audi quality." Simply present it as a premium pre-owned unit curated by the store.'
        : '',
    ].join('\n');
  }

  // ── Conversation pre-analysis — extracted before LEAD section ────
  // Forces AI to process what actually happened BEFORE seeing vehicle/times
  let conversationAnalysis = '';
  if (data.conversationBrief && data.convState !== 'first-touch') {
    // Extract the most recent customer message
    const lastInbound = data.lastInboundMsg || '';
    // Extract the most recent agent message
    const lastOutbound = data.lastOutboundMsg || '';
    // Extract any agent promises from outbound (questions asked, promises made)
    const agentAsked = lastOutbound.match(/\?[^?]*$/)?.[0]?.trim() || '';

    conversationAnalysis = [
      '━━━ CONVERSATION ANALYSIS ━━━',
      'Before writing anything, process this:',
      lastInbound ? '1. CUSTOMER SAID LAST: "' + lastInbound.substring(0, 300) + '"' : '1. No customer reply yet.',
      lastOutbound ? '2. AGENT LAST SAID: "' + lastOutbound.substring(0, 200) + '"' : '2. No agent message yet.',
      agentAsked   ? '3. OPEN QUESTION FROM AGENT: "' + agentAsked + '" — if unanswered, do not re-ask the same question.' : '',
      '4. REQUIRED: Your opening line must react to what the customer said (if they replied) or acknowledge what the agent asked. Do NOT open with a generic greeting that ignores the conversation.',
      '5. HUMAN TEST: Would a real person who just read this conversation write this message? If it could be sent to any customer, rewrite it.',
    ].filter(Boolean).join('\n');
  }

  // ── Build the prompt ───────────────────────────────────────────
  // For AI Buying Signal leads: inject a hard constraint block at the very top of the prompt
  // This appears BEFORE the scenario directive so the AI sees it first and cannot ignore it
  var buyingSignalHardBlock = '';
  if (sc.isAIBuyingSignalNew || sc.isAIBuyingSignalReturner) {
    var bsData = sc.buyingSignalData || (data.context||'').match(/BUYING SIGNAL DATA[:\s]+([^\n]+)/i)?.[1] || '';
    var bsModel = bsData.match(/\b(Camry|Tacoma|RAV4|Highlander|Corolla|Tundra|Sienna|4Runner|Venza|Prius|CR-V|Accord|Civic|Pilot|Odyssey|Telluride|Sorento|Sportage|Carnival|Tucson|Santa Fe|Palisade|Mustang|F-150|Explorer|Edge|Escape|Silverado|Equinox|Traverse|Malibu|Tahoe|Suburban|Colorado|Wrangler|Cherokee|Grand Cherokee|Ram|Charger|Challenger|Durango|Altima|Rogue|Murano|Pathfinder|Frontier|Titan|Legacy|Outback|Forester|Crosstrek|WRX|Impreza|CX-5|CX-9|Mazda3|Mazda6|RX350|ES350|GX|LX|IS|GS|UX|NX|Optima|Stinger|Forte|Soul|Niro)/i)?.[0] || '';
    buyingSignalHardBlock = [
      '⚠ AI BUYING SIGNAL LEAD — HARD CONSTRAINTS (these override everything else):',
      '1. SUBJECT LINE: Never use the word "upgrade". Use: "Your ' + (bsModel || 'vehicle') + '" or "' + (bsModel || 'Vehicle') + ' options for you".',
      '2. BODY: Never say "newer model", "newer models", "latest model", "newest", "step up", "brand new", "new ' + (bsModel||'vehicle') + '". These imply inventory type which is unknown.',
      '3. BODY: Never say "upgrading your [vehicle]" — say "your next ' + (bsModel||'vehicle') + '" or "your ' + (bsModel||'vehicle') + ' search".',
      '4. BODY: Never reference a trade-in unless one is explicitly listed in the LEAD section below.',
      '5. BODY: Never reference any marketing event, sale, APR offer, or promotional campaign.',
      '6. OPENING FORMULA — choose based on lead type:',
      sc.isAIBuyingSignalReturner ?
        '   RETURNER (has prior purchase): "[First name], still driving the [owned vehicle]? We have some great ' + (bsModel||'vehicle') + ' options available right now."' :
        '   NEW PROSPECT (no prior purchase): "[First name], I wanted to reach out — we have some great [category] options available right now that I think would be a perfect fit." Do NOT use ownership hook for new prospects.',
      '7. BUYING SIGNAL: ' + (bsData || '(see context)'),
      '',
    ].join('\n');
  }

  const lines = [
    'DATE: ' + date,
    '',
    buyingSignalHardBlock,
    '━━━ SCENARIO ━━━',
    scenarioDirective,
    scenarioRules,
    '',
  ];

  if (inventoryNote) lines.push('INVENTORY: ' + inventoryNote, '');
  if (audiNote)      lines.push(audiNote, '');
  if (conversationAnalysis) lines.push(conversationAnalysis, '');

  // ── Brand mismatch — competitor vehicle at wrong store ───────────
  if (sc.isBrandMismatch) {
    var storeBrandName = sc.isHonda ? 'Honda' : sc.isKia ? 'Kia' : sc.isToyota ? 'Toyota' : sc.isAudi ? 'Audi' : 'our brand';
    lines.push('⚠ BRAND MISMATCH: Customer listed a ' + sc.competitorBrand + ' — this store sells ' + storeBrandName + ', not ' + sc.competitorBrand + '.',
      'ABSOLUTE RULES FOR BRAND MISMATCH:',
      '- NEVER say we can have the ' + sc.competitorBrand + ' ready, available, or pulled up for them.',
      '- NEVER offer to show them the ' + sc.competitorBrand + ' — we do not carry it.',
      '- NEVER say "we do not sell ' + sc.competitorBrand + '" — just redirect naturally without explaining.',
      '- This applies to ALL THREE formats — SMS, email, and voicemail must all avoid mentioning the ' + sc.competitorBrand + ' as something we have.',
      data.hasTrade
        ? 'STRATEGY — TRADE PRESENT: Lead entirely with the trade-in. Focus 100% on getting them in to appraise the trade. Example email: "I want to make sure we get a solid number on your Explorer — can you bring it by so we can do a proper appraisal? It only takes about 10 minutes and we will have everything ready." Let the sales rep handle the brand conversation in person.'
        : 'STRATEGY — NO TRADE: Acknowledge their search neutrally and pivot to a comparable ' + storeBrandName + ' without naming a specific model unless clearly comparable.',
      '');
  }

  // ── Context flag rules — injected when flags are active ─────────
  var flags = data.activeFlags || [];
  if (flags.includes('credit')) {
    lines.push('🔴 CREDIT SENSITIVITY FLAG: This customer has shown credit sensitivity. Handle financing language with care.',
      '- NEVER say "get approved", "easy financing", "no matter your credit", or imply approval is guaranteed.',
      '- NEVER lead with payment amounts or APR — these can backfire if they are higher than expected.',
      '- Frame the visit as exploratory: "Let us look at the options together" — not "let us get you financed."',
      '- If Capital One or a credit app is involved, acknowledge it positively but neutrally: "Having that started puts us in a great position."',
      '- Tone: reassuring and low-pressure. The goal is getting them in, not pre-selling financing.',
      '');
  }
  if (flags.includes('price')) {
    var customerSaidTooExpensive = /outside.*budget|too expensive|out of.*budget|i.ll pass|will pass|not interested|thank you but|thanks but/i.test((data.lastInboundMsg||'') + ' ' + (data.context||'').substring(0,400));
    lines.push('🔴 PRICE GATE FLAG: This customer has expressed budget concerns or price resistance.',
      customerSaidTooExpensive
        ? '- CRITICAL: Customer already said the price is outside their budget. Apply TIER 2 CLOSE — ask ONE qualifying question first: "What monthly payment or out-the-door number are you trying to stay under?" Do NOT offer appointment times yet. Getting their number gives you something to work with.'
        : '- Frame the visit as finding the RIGHT number: "I want to make sure we find something that works for your budget."',
      '- NEVER pitch features or upgrades — they are buying value, not more car.',
      '- Do NOT mention MSRP or sticker price.',
      '- Acknowledge the concern directly — ignoring it loses the customer.',
      '- Tone: empathetic, solution-focused, on their side.',
      '');
  }
  // Spanish handled via translate button
  if (flags.includes('distance')) {
    var distanceContext = '';
    if (flags.includes('credit') || (data.activeFlags||[]).includes('credit')) {
      distanceContext = 'Customer has credit sensitivity AND is a distance buyer — the trip must feel financially worthwhile. Lead with financing confidence before asking them to drive.';
    } else if (data.vehicle) {
      distanceContext = 'Customer is interested in the ' + data.vehicle + '. Hold/confirm the vehicle so they know it will be there when they arrive.';
    }
    lines.push('🔴 DISTANCE BUYER: Customer is driving 30-60+ minutes. The visit ask must be worth the commitment.',
      '- NEVER say "stop by", "swing by", or "come see us" — these feel like casual asks for a significant trip.',
      '- REQUIRED in EVERY format: One specific reason the drive is worth it.',
      '  • Vehicle confirmation: "I will have the [vehicle] pulled and ready when you arrive — you will not be waiting."',
      '  • Efficiency: "We can pre-fill most of the paperwork so you are in and out in under an hour."',
      '  • Trade value: "I want to have your trade-in numbers ready before you arrive so we can get straight to business."',
      '  • First-touch: "I want to make sure your trip is productive — I will have [2-3 options] staged and ready specifically for you."',
      '- SMS: 1 sentence justifying the trip is MANDATORY. Example: "I will have it pulled up and ready when you arrive."',
      '- Email: Open with the vehicle/option confirmation, THEN the appointment ask.',
      '- Never make the distance buyer feel like they might drive far for nothing.',
      distanceContext ? '- CONTEXT: ' + distanceContext : '',
      '');
  }

  lines.push(
    '━━━ LEAD ━━━',
    'Customer:   ' + (data.name || '(unknown — do not say Hi there)'),
    'BD Agent:   ' + (data.agent || 'our team') + '  ← writes the message',
    'Sales Rep:  ' + (data.salesRep || '(not assigned)') + '  ← may appear in call notes as the person who spoke with customer',
    'Phone:      ' + phone + '  ← use this exact number in signature',
    'Store:      ' + sc.storeGroup,
    'Persona:    ' + sc.persona,
    (sc.isAIBuyingSignalNew || sc.isAIBuyingSignalReturner)
      ? 'Customer browsing interest: ' + (data.vehicle || '(not specified)') + '  ← THIS IS WHAT THEY SEARCHED ONLINE — NOT our inventory. Use only for category (truck/SUV/EV/sedan). NEVER name this vehicle in the message.'
      : data.vehicle
        ? 'Vehicle:    ' + data.vehicle + '  ← THIS IS THE VEHICLE FOR THIS LEAD. Do not substitute or reference other vehicles from the conversation history.'
        : 'Vehicle:    (none specified) ← NO VEHICLE IS ATTACHED TO THIS LEAD. Do NOT reference or name any vehicle from the conversation history — those belong to prior leads or conversations. Do not mention Telluride, Crown, Optima, or any other vehicle unless it is listed here.',
  );

  if (sc.isAudi && sc.salesRep) lines.push('Brand Specialist: ' + sc.salesRep);

  // Zero-contact stalled leads: suppress entire appointment engine
  // Check reliable flags AND scan leadContext for the hard block marker as fallback
  // ── Zero-contact stalled detection from raw context ──────────────
  // Scan data.context directly — this is always populated regardless of scraper path
  // Look for: outbound notes exist, no [CUSTOMER] lines, lead age > 2 days
  var ctx_raw = data.context || '';
  var hasOutboundNotes = /\[AGENT\].*(?:Outbound|Email reply to prospect|Left message)/i.test(ctx_raw)
    || /Email reply to prospect|Outbound Text|Outbound phone|Left message/i.test(ctx_raw);
  var hasCustomerReply = /\[CUSTOMER\]/i.test(ctx_raw)
    || /Inbound Text|Inbound phone|Email reply from prospect/i.test(ctx_raw);
  // Estimate age from context — multiple strategies
  var ctxAgeDays = 0;
  // Strategy 1: "(Nd)" pattern in Created field
  var ctxAgeMatch = ctx_raw.match(/Created[^(]*\((\d+)d\)/i);
  if (ctxAgeMatch) ctxAgeDays = parseInt(ctxAgeMatch[1]);
  // Strategy 2: calculate from oldest note date vs today
  if (!ctxAgeDays) {
    var dateMatches = ctx_raw.match(/\[(\d{1,2}\/\d{1,2}\/\d{4})/g) || [];
    if (dateMatches.length > 0) {
      var oldest = dateMatches[dateMatches.length - 1].replace('[','');
      var oldestMs = new Date(oldest).getTime();
      if (oldestMs > 0) ctxAgeDays = Math.floor((Date.now() - oldestMs) / 86400000);
    }
  }
  // Strategy 3: check lastScrapedData directly
  var ageDays_final = ctxAgeDays || data.leadAgeDays || (lastScrapedData && lastScrapedData.leadAgeDays) || 0;
  var isContacted_final = data.isContacted || /Contacted:\s*Yes/i.test(ctx_raw);
  var hasOutbound_final = data.hasOutbound || hasOutboundNotes;

  // Also treat active-follow-up with no customer reply as zero-contact stalled
  // BUT only if lead is at least 1 day old — same-day leads are never stalled
  var isActiveFollowUpNoReply = (data.convState || '').includes('active-follow-up') && !hasCustomerReply && ageDays_final >= 1;
  var isZeroContactStalled_ctx = !hasCustomerReply && hasOutbound_final && ageDays_final >= 2;

  var zeroContactMarker = (typeof leadContext !== 'undefined' && leadContext.includes('ZERO-CONTACT LEAD'));
  var isZeroContactStalled = (!!data._isStalled && !!data._neverReplied) || zeroContactMarker || isZeroContactStalled_ctx;
  console.log('[Lead Pro] isZeroContactStalled:', isZeroContactStalled, '| ctx_scan:', isZeroContactStalled_ctx, '| hasCustomerReply:', hasCustomerReply, '| hasOutbound:', hasOutbound_final, '| ageDays:', ageDays_final, '| _isStalled:', data._isStalled);

  if (isZeroContactStalled) {
    lines.push('');
    lines.push('════════════════════════════════════════════');
    lines.push('ABSOLUTE RULE — NO APPOINTMENT TIMES — CANNOT BE OVERRIDDEN:');
    lines.push('This customer has NEVER replied to any outreach. Every attempt has been ignored.');
    lines.push('DO NOT write appointment times. DO NOT write would X or Y work. DO NOT write duration. DO NOT write get ahead of your schedule.');
    lines.push('SMS: 3-4 sentences. Warm personal opener, one specific observation about the vehicle or situation, one easy question. Should feel like a real person who read their file.');
    lines.push('EMAIL: Two short paragraphs. End with one simple question. No close. No appointment.');
    lines.push('════════════════════════════════════════════');
  }

  if (!sc.isApptConfirmation && !sc.isExitSignal && !sc.isPauseSignal && !sc.isSoldDelivered && !isZeroContactStalled) {
    if (sc.notToday || (data.customerScheduleConstraint && (data.customerScheduleConstraint.indexOf('SHIFT_WORKER:') === 0 || data.customerScheduleConstraint.indexOf('OUT_OF_TOWN:') === 0))) {
      if (data.customerScheduleConstraint && data.customerScheduleConstraint.indexOf('SHIFT_WORKER:') === 0) {
        lines.push('', 'SHIFT WORKER TIMING: Do NOT offer the standard two appointment times. This customer works shift/hitch/rotation.',
          'INSTEAD: Ask an open-ended scheduling question.',
          'EXAMPLE SMS close: "What does your schedule look like this week — when are you off?"',
          'EXAMPLE email close: "I want to make sure we find a time that works around your schedule — when do you have some time off coming up?"',
          'If they already told you when they are off, reference that specifically and confirm it.');
      } else if (data.customerScheduleConstraint && data.customerScheduleConstraint.indexOf('OUT_OF_TOWN:') === 0) {
        var returnRef = data.customerScheduleConstraint.replace('OUT_OF_TOWN: Customer is out of town and returns ','').replace(/\. Do NOT.*$/,'').trim();
        lines.push('', 'OUT OF TOWN TIMING: Customer is traveling and returns ' + returnRef + '. Do NOT offer any specific times before their return.',
          'CLOSE by asking about their return: "When you are back ' + returnRef + ', would [Thursday/Friday] work to come in?" — name a day AFTER their return.',
          'Acknowledge the trip warmly: "Safe travels" or "Hope the trip is great" — then lock in the post-return appointment.');
      } else {
        lines.push('', 'TIMING NOTE: Customer said they cannot come in TODAY. Do NOT offer same-day times.',
          'Instead, ask what day works better for them. Example close: "What day this week works best for you?"');
      }
    } else {
      const now2 = new Date();
      const hour = now2.getHours();
      // isSameDay is true only when appointment calculator returned 'today' times
      // Check for 'today' explicitly — next-day times use day names (Saturday, Monday) not 'today'
      const isSameDay = appt.time1 && appt.time1.toLowerCase().includes('today');
      const isAfternoon = hour >= 12;
      const isEvening = hour >= 17;

      // Override computed times if customer stated an arrival time
      // Also check lastInboundMsg directly as fallback in case scraper cached stale data
      var arrivalFromInbound = '';
      // Scan both lastInboundMsg AND full context for arrival time
      // lastInboundMsg may be stale if agent hasn't re-grabbed since customer's last message
      var arrivalScanText = (data.lastInboundMsg || '') + ' ' + (data.context || '').substring(0, 1000);
      var inboundArrMatch = arrivalScanText.match(/(?:get off|off work|done|finish|out at|arrive|be there|come by)(?:\s+(?:at|by|around|after))?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      if(inboundArrMatch) arrivalFromInbound = inboundArrMatch[1].trim();
      var arrivalTimeOverride = (data.customerScheduleConstraint && data.customerScheduleConstraint.indexOf('CUSTOMER ARRIVAL TIME:') === 0) || arrivalFromInbound.length > 0;
      if(arrivalTimeOverride) {
        // Extract the hour from constraint and compute times after arrival
        var arrivalHourMatch = data.customerScheduleConstraint ? data.customerScheduleConstraint.match(/around\s+(\d{1,2})/i) : null;
        var arrivalHour = arrivalHourMatch ? parseInt(arrivalHourMatch[1]) : (arrivalFromInbound ? parseInt(arrivalFromInbound) : null);
        if(arrivalHour && arrivalHour < 12) arrivalHour += 12; // assume PM if no AM/PM
        var closeHour = appt.closeMins ? Math.floor(appt.closeMins / 60) : 20;
        if(arrivalHour && (arrivalHour + 1) < closeHour) {
          // Add 30-45 min for travel, offer two slots after arrival
          var slot1Hour = arrivalHour;
          var slot1Min = 30;
          var slot2Hour = arrivalHour + 1;
          var slot2Min = 0;
          var fmt = function(h,m){ var ampm = h >= 12 ? 'PM' : 'AM'; var h12 = h > 12 ? h-12 : h; return h12 + ':' + (m < 10 ? '0'+m : m) + ' ' + ampm; };
          var dayLabel = appt.time1 && appt.time1.match(/(today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i) ? appt.time1.match(/(today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)[1] : 'tomorrow';
          lines.push('', 'APPOINTMENT TIMES — ADJUSTED FOR CUSTOMER ARRIVAL TIME (use exactly):',
            'Time 1: ' + fmt(slot1Hour, slot1Min) + ' ' + dayLabel,
            'Time 2: ' + fmt(slot2Hour, slot2Min) + ' ' + dayLabel);
        } else {
          lines.push('', 'APPOINTMENT TIMES (use exactly — do not change):',
            'Time 1: ' + appt.time1,
            'Time 2: ' + appt.time2);
        }
      } else {
        lines.push('', 'APPOINTMENT TIMES (use exactly — do not change):',
          'Time 1: ' + appt.time1,
          'Time 2: ' + appt.time2);
      }

      const isMorning = hour >= 8 && hour < 12;
      const isLateAfternoon = hour >= 15 && hour < 17;
      const closeTimeStr = appt.closeTime || 'closing time';
      const hoursLeft = appt.minsUntilClose ? Math.round(appt.minsUntilClose / 60 * 10) / 10 : null;
      const hoursLeftStr = hoursLeft ? (hoursLeft < 1.5 ? 'about an hour' : Math.floor(hoursLeft) + ' hours') : 'a few hours';

      if (isEvening && isSameDay) {
        lines.push('URGENCY — CLOSING SOON: Store closes at ' + closeTimeStr + ' — only ' + hoursLeftStr + ' left today.',
          '- This is the last window. Create genuine urgency without being pushy.',
          '- SMS MUST reference closing time: "We are open until ' + closeTimeStr + ' tonight — if you can make it, I will have everything ready for you."',
          '- Email: Lead with the closing time in the first sentence. "We have until ' + closeTimeStr + ' tonight and I can have [options/vehicle] pulled up and ready."',
          '- Do NOT say "stop by anytime" or "whenever works" — the window is closing.',
          '- Close: "Can you make it in tonight?" — direct, not passive.');
      } else if (isLateAfternoon && isSameDay) {
        lines.push('URGENCY — LATE AFTERNOON: ' + hoursLeftStr + ' remaining today before close at ' + closeTimeStr + '.',
          '- Good window still available. Convey that today is better than waiting.',
          '- SMS: "Still a good window this afternoon — I can have everything ready if you can stop by."',
          '- Email: "There is still time this afternoon and I can have [options] pulled up for you."',
          '- Tone: confident and forward-moving. Not desperate — just timely.');
      } else if (isAfternoon && isSameDay) {
        lines.push('TIMING — AFTERNOON: Comfortable window remaining today. Close at ' + closeTimeStr + '.',
          '- SMS: Action-oriented. "I can have [options] ready for you this afternoon."',
          '- Email: Position as a convenient, efficient same-day visit.',
          '- Tone: helpful and confident. No urgency pressure needed — just make it easy.');
      } else if (isMorning && isSameDay) {
        lines.push('TIMING — MORNING: Full day ahead. Store open until ' + closeTimeStr + '.',
          '- SMS: "We have great availability today — morning or afternoon works."',
          '- Email: Position the day as wide open. "Whenever works best for you today — I can have everything ready."',
          '- Tone: relaxed and helpful. Full flexibility — lean into that.');
      } else if (!isSameDay) {
        lines.push('TIMING — NEXT-DAY: Appointments are for tomorrow. Be proactive, not urgent.',
          '- SMS: "I wanted to get ahead of your schedule — would ' + appt.time1 + ' or ' + appt.time2 + ' work?"',
          '- Email: Frame as planning ahead to make their visit smooth.',
          '- Tone: organized and thoughtful. No urgency — just proactive service.');
      }
    }
  } else if (isZeroContactStalled) {
    lines.push('', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('ZERO-CONTACT RE-ENGAGEMENT — READ THIS BEFORE WRITING ANYTHING');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('FACT: This customer has received multiple outreach attempts and has not replied to a single one.');
    lines.push('GOAL: Get their first reply. Nothing else.');
    lines.push('');
    lines.push('SMS — write exactly this structure:');
    lines.push('  Sentence 1: Short warm opener referencing the specific vehicle or inquiry. No intro, no store name beyond first touch.');
    lines.push('  Sentence 2: One easy yes/no or simple question. End there. No appointment times. No duration.');
    lines.push('  GOOD: "Tammy, still have the A3 here if you\'re still looking — any specific questions before you come check it out?"');
    lines.push('  BAD: anything with "would X or Y work", "45 minutes", "wide open today", "morning or afternoon"');
    lines.push('');
    lines.push('EMAIL — write exactly this structure:');
    lines.push('  Para 1 (2-3 sentences): Warm, personal, references what they inquired about. Acknowledge they haven\'t connected yet without making it awkward.');
    lines.push('  Para 2 (1 sentence): ONE simple question to re-open. Examples: "Is the A3 still on your radar?" or "Did your search go a different direction?" or "Any specific questions I can answer for you?"');
    lines.push('  STOP THERE. No "would X or Y work". No "45 minutes". No "wide open today". No appointment structure of any kind.');
    lines.push('  GOOD EMAIL CLOSE: "Is the Audi A3 still something you\'re exploring, or has your search taken a different direction?"');
    lines.push('  BAD EMAIL CLOSE: "Would 10:45 AM or 11:30 AM today work for your visit?"');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  if (data.context) {
    lines.push('', '━━━ CONTEXT & HISTORY ━━━', data.context);
  }

  // LP commands injected last — highest attention position right before format rules
  if (data.agentLPCommands && data.agentLPCommands.length > 0) {
    lines.push('', '━━━ AGENT OVERRIDE INSTRUCTIONS — FOLLOW EXACTLY ━━━');
    var lpHasUrl = false;
    var lpExtractedUrl = '';
    data.agentLPCommands.forEach(function(cmd) {
      // Extract URL from anywhere in the command text
      var urlMatch = cmd.match(/https?:\/\/[^\s]+/);
      if(urlMatch) {
        lpHasUrl = true;
        lpExtractedUrl = urlMatch[0];
        lines.push('► ' + cmd);
      } else {
        lines.push('► ' + cmd);
      }
    });
    if(lpHasUrl) {
      var urlLooksTruncated = !/\.[a-z]{2,6}(\/|$)/i.test(lpExtractedUrl);
      lines.push('');
      lines.push('⚠ URL MANDATE: The agent provided this link: ' + lpExtractedUrl);
      if(urlLooksTruncated) {
        lines.push('NOTE: This URL may be incomplete — the agent should verify and paste the full link manually if needed.');
      }
      lines.push('This URL MUST appear in the SMS on its own line. This is NOT optional.');
      lines.push('SMS format: write the message, then on a new line write just the URL, then the signature.');
      lines.push('Do NOT paraphrase, shorten, or omit the URL under any circumstances.');
    }
    lines.push('These instructions override all other defaults.');
  }

  lines.push(
    '',
    '━━━ FORMAT RULES ━━━',
    sc.noCustomerPhone
      ? 'NO PHONE NUMBER ON FILE: SMS and voicemail are not usable channels. Write email only. For SMS field, write a short note asking for their phone number so you can reach them directly. For voicemail field, write "(No phone number — cannot leave voicemail)".'
      : 'SMS signature: agent first name only + phone number (two lines). No title. No store name.',
    'EMAIL FORMAT RULES:',
    '- Greeting: Use "[First name]," on its own line for first-touch formal emails. For warm follow-ups where conversation is already active, "Hi [First name]," is natural and preferred.',
    '- After greeting: blank line, then body starts.',
    '- CORRECT (first touch): "Jose,\n\nI\'ve got the RS Q8 details pulled up for you..."',
    '- CORRECT (follow-up): "Hi Ashley,\n\nSo glad you reached out — let\'s find a time that works better for you."',
    '- Paragraphs: one blank line between paragraphs. Keep it to 2-3 paragraphs max.',
    '- Signature: each part on its own line — First Last / Title / Store / Phone.',
    'Email signature: Use line breaks between each part — NOT slashes. Format exactly as:\nFirst Last\nTitle\nStore Name\nPhone Number',
    'Voicemail: end with callback number. Nothing after it.',
    'Duration to state before times: ' + sc.duration + '.',
    'APPOINTMENT TIME FORMAT: Write times as "[Time 1] or [Time 2]" — the day/date appears ONCE after Time 2 only. CORRECT: "9:15 AM or 10:30 AM Saturday, March 21". WRONG: "9:15 AM Saturday, March 21 or 10:30 AM Saturday, March 21".',
    '',
    'Return ONLY the JSON object {"sms":"...","email":"...","voicemail":"..."}.',
    'CRITICAL JSON RULES: Never use unescaped double quotes inside field values. Never end a field value with a period followed by a closing quote. Phone numbers must not have a trailing period. Escape any special characters properly.'
  );

  return lines.filter(function(l){ return l !== undefined; }).join('\n');
}




// ── Appointment Time Calculator ───────────────────────────────────
// Computes valid appointment time pairs entirely in JS.
// The AI receives pre-validated times — it never does this math.
function computeAppointmentTimes(store) {
  // All times in Central Time
  const now    = new Date();
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const dayOfWeek = central.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const hour   = central.getHours();
  const minute = central.getMinutes();
  const nowMins = hour * 60 + minute; // minutes since midnight

  // Store hours and cutoffs (minutes since midnight)
  const storeKey = (store || '').toLowerCase();
  let openMins, closeMins, sameDayCutoffMins;

  if (storeKey.includes('audi')) {
    // Mon–Fri 9AM–7PM, Sat 9AM–6PM, closed Sun
    if (dayOfWeek === 0) { // Sunday
      openMins = null;
    } else if (dayOfWeek === 6) { // Saturday
      openMins = 9 * 60; closeMins = 18 * 60; sameDayCutoffMins = 16 * 60 + 30; // 4:30 PM
    } else {
      openMins = 9 * 60; closeMins = 19 * 60; sameDayCutoffMins = 18 * 60; // 6:00 PM
    }
  } else if (storeKey.includes('lafayette') || storeKey.includes('lafa')) {
    // Honda Lafayette: Mon–Sat 9AM–7PM, closed Sun
    // Cutoff at 6:00 PM — with 2hr buffer, agents at 4:00 PM can still offer same-day 6:00/6:30 slots
    if (dayOfWeek === 0) {
      openMins = null;
    } else {
      openMins = 9 * 60; closeMins = 19 * 60; sameDayCutoffMins = 18 * 60; // 6:00 PM
    }
  } else {
    // Baytown stores: Mon–Sat 9AM–8PM, closed Sun
    if (dayOfWeek === 0) {
      openMins = null;
    } else {
      openMins = 9 * 60; closeMins = 20 * 60; sameDayCutoffMins = 18 * 60 + 30; // 6:30 PM
    }
  }

  // Round current time UP to next 15-minute slot, then add 2-hour buffer
  function nextSlot(fromMins) {
    const buffered = fromMins + 120; // 2-hour buffer
    const rem = buffered % 15;
    return rem === 0 ? buffered : buffered + (15 - rem);
  }

  // Format minutes-since-midnight to "H:MM AM/PM"
  function fmtTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }

  // Format a date as "Day, Month D"
  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', timeZone:'America/Chicago' });
  }

  // Find two valid same-day slots (at least 45 min apart, before cutoff, before close)
  function findSameDayPair(earliestSlot) {
    const slots = [];
    let s = earliestSlot;
    while (s + 45 <= closeMins && s <= sameDayCutoffMins) {
      slots.push(s);
      s += 15;
    }
    // Need two slots at least 45 mins apart
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[j] - slots[i] >= 45) {
          // Prefer ~90+ min separation if possible
          if (slots[j] - slots[i] >= 90 || j === i + 3) {
            return [slots[i], slots[j]];
          }
        }
      }
    }
    // Fall back to first valid pair
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[j] - slots[i] >= 45) return [slots[i], slots[j]];
      }
    }
    return null;
  }

  // Next open business day (skips Sunday)
  function nextBusinessDay(fromDate) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + 1);
    // Convert to Central
    const cd = new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    if (cd.getDay() === 0) d.setDate(d.getDate() + 1); // skip Sunday
    return d;
  }

  // --- Determine whether same-day is valid ---
  const isClosed = openMins === null; // Sunday
  const earliestSlot = nextSlot(nowMins);
  const sameDayValid = !isClosed
    && earliestSlot <= sameDayCutoffMins
    && earliestSlot + 45 <= closeMins;

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

  // --- Next business day ---
  const tomorrow = nextBusinessDay(central);
  const tomorrowCentral = new Date(tomorrow.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const tomorrowDay = tomorrowCentral.getDay();

  // Next-day open hours (use same store rules)
  let nextOpen, nextClose;
  if (storeKey.includes('audi')) {
    nextOpen  = tomorrowDay === 6 ? 9*60 : 9*60;
    nextClose = tomorrowDay === 6 ? 18*60 : 19*60;
  } else if (storeKey.includes('lafayette') || storeKey.includes('lafa')) {
    nextOpen = 9*60; nextClose = 19*60;
  } else {
    nextOpen = 9*60; nextClose = 20*60;
  }

  // Pick two slots well-spaced in the next day morning
  const slot1 = nextOpen + 15;       // e.g. 9:15
  const slot2 = nextOpen + 60 + 30;  // e.g. 10:45 (~90 min later)

  const nextDayLabel = fmtDate(tomorrowCentral);
  return {
    time1: fmtTime(slot1),
    time2: fmtTime(slot2) + ' ' + nextDayLabel,
    dayLabel: nextDayLabel,
    closeTime: null,
    minsUntilClose: null,
    note: 'No same-day slots available — next business day used.'
  };
}


// ── Generate (single call, all three outputs) ─────────────────────
async function generateAll() {
  const endpoint = getEndpoint();
  if (!endpoint) {
    document.getElementById('keyWarning').classList.add('visible');
    return;
  }

  const name       = document.getElementById('custName').value.trim();
  const agent      = document.getElementById('agentName').value.trim();
  const vehicle    = document.getElementById('vehicle').value.trim();
  const leadSource = document.getElementById('leadSource').value.trim();
  const store      = selectedStore;
  const btn        = document.getElementById('btnGenerate');

  if (!name && !vehicle && !store) {
    alert('Please fill in fields or use ⚡ GRAB LEAD first.'); return;
  }

  // Show loading state
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.btn-label').textContent = 'Generating…';

  // Clear previous outputs
  ['sms','email','vm'].forEach(function(k) {
    const f = document.getElementById('output-' + k);
    if (f) { f.value = ''; f.classList.add('generating'); }
    const tabBtn = document.querySelector('.tab-btn.' + k);
    if (tabBtn) tabBtn.classList.remove('ready-' + k);
  });

  try {
    // Zero-contact stalled: strip appointment times from context before sending
    if (leadContext.includes('ZERO-CONTACT LEAD')) {
      console.log('[Lead Pro] Zero-contact stalled confirmed — stripping appointment times from context');
      // Remove any injected time lines that slipped through
      leadContext = leadContext.replace(/Time 1:.*$/gm, '').replace(/Time 2:.*$/gm, '').replace(/APPOINTMENT TIME FORMAT.*$/gm, '').replace(/Would.*AM or.*AM.*work/gi, '').trim();
    }
    console.log('[Lead Pro] Generating — context length:', leadContext.length, '| first 300:', leadContext.substring(0,300));
    const userPrompt = buildUserPrompt({
      name, agent, salesRep: leadSalesRep,
      store, vehicle, leadSource,
      context: leadContext,
      convState: leadConvState,
      contactedAgeDays: lastScrapedData ? (lastScrapedData.contactedAgeDays || 0) : 0,
      hasOutbound: lastScrapedData ? !!lastScrapedData.hasOutbound : false,
      isLiveConversation: lastScrapedData ? !!lastScrapedData.isLiveConversation : false,
      isContacted:       lastScrapedData ? !!lastScrapedData.isContacted : false,
      // Previously missing — now passed through (fixes dead code identified in stability assessment)
      lastInboundMsg:            lastScrapedData ? (lastScrapedData.lastInboundMsg || '') : '',
      lastOutboundMsg:           lastScrapedData ? (lastScrapedData.lastOutboundMsg || '') : '',
      conversationBrief:         lastScrapedData ? (lastScrapedData.conversationBrief || '') : '',
      equityAmount:              lastScrapedData ? (lastScrapedData.equityAmount || '') : '',
      equityVehicle:             lastScrapedData ? (lastScrapedData.equityVehicle || '') : '',
      ownedVehicle:              lastScrapedData ? (lastScrapedData.ownedVehicle || '') : '',
      showroomVisitToday:        lastScrapedData ? !!lastScrapedData.showroomVisitToday : false,
      customerScheduleConstraint: lastScrapedData ? (lastScrapedData.customerScheduleConstraint || '') : '',
      hasTrade:                  lastScrapedData ? !!lastScrapedData.hasTrade : false,
      tradeDescription:          lastScrapedData ? (lastScrapedData.tradeDescription || '') : '',
      isRecentOutbound:          lastScrapedData ? !!lastScrapedData.isRecentOutbound : false,
      recentOutboundContent:     lastScrapedData ? (lastScrapedData.recentOutboundContent || '') : '',
      stockNum:                  lastScrapedData ? (lastScrapedData.stockNum || '') : '',
      vin:                       lastScrapedData ? (lastScrapedData.vin || '') : '',
      inventoryWarning:          lastScrapedData ? !!lastScrapedData.inventoryWarning : false,
      vrCreditApp:               lastScrapedData ? !!lastScrapedData.vrCreditApp : false,
      vrPaymentSelected:         lastScrapedData ? !!lastScrapedData.vrPaymentSelected : false,
      vrTradeIn:                 lastScrapedData ? !!lastScrapedData.vrTradeIn : false,
      vrCompleted:               lastScrapedData ? !!lastScrapedData.vrCompleted : false,
      vrDroppedOff:              lastScrapedData ? !!lastScrapedData.vrDroppedOff : false,
      noVehicleAtAll:            lastScrapedData ? !!lastScrapedData.noVehicleAtAll : false,
      agentLPCommands:           lastScrapedData ? (lastScrapedData.agentLPCommands || []) : [],
      contactRecoveryPhone:      lastScrapedData ? !!lastScrapedData.contactRecoveryPhone : false,
      contactRecoveryEmail:      lastScrapedData ? !!lastScrapedData.contactRecoveryEmail : false,
      isMaskedEmail:             lastScrapedData ? !!lastScrapedData.isMaskedEmail : false,
      isSRPVehicle:              lastScrapedData ? !!lastScrapedData.isSRPVehicle : false,
      isVelocityResponse:        lastScrapedData ? !!lastScrapedData.isVelocityResponse : false,
      _isStalled:                lastScrapedData ? !!lastScrapedData._isStalled : false,
      _neverReplied:             lastScrapedData ? !!lastScrapedData._neverReplied : false,
      isSoldDelivered:           lastScrapedData ? !!lastScrapedData.isSoldDelivered : false,
      activeFlags: Array.from(activeFlags)
    });
    console.log('[Lead Pro] User prompt length:', userPrompt.length, '| scenario section:', userPrompt.substring(0, userPrompt.indexOf('━━━ LEAD ━━━')));
    const payload = {
      system_instruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role:'user', parts:[{ text: userPrompt }] }],
      generationConfig: {
        temperature:      0.5,
        maxOutputTokens:  8000,
        topP:             0.9,
        responseMimeType: 'application/json',
        thinkingConfig:   { thinkingLevel: 'low' }
      }
    };

    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    console.log('[Lead Pro] API response:', data);

    if (data.error) {
      showError('API Error: ' + data.error.message);
      return;
    }

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      showError('No content returned. Check console.');
      return;
    }

    // Check if response was truncated by token limit
    const finishReason = data.candidates[0].finishReason || '';
    if (finishReason === 'MAX_TOKENS') {
      console.warn('[Lead Pro] Response truncated by MAX_TOKENS — increasing limit may help');
    }

    const rawText = data.candidates[0].content.parts[0].text.trim();
    console.log('[Lead Pro] Raw response length:', rawText.length, '| finish:', finishReason, '| First 200:', rawText.substring(0,200));
    let parsed;
    try {
      // Strip markdown fences at start and end
      let clean = rawText.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/\s*```\s*$/,'').trim();
      // Find the root JSON object by tracking brace depth
      // This handles models that append "} "} "} "`  or extra garbage after valid JSON
      (function() {
        var first = clean.indexOf('{');
        if (first === -1) return;
        var depth = 0;
        var inStr = false;
        var escaped = false;
        for (var ci = first; ci < clean.length; ci++) {
          var ch = clean[ci];
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch === '"' && !escaped) { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { clean = clean.substring(first, ci + 1); return; } }
        }
      })();
      clean = clean.replace(/^\uFEFF/,'').replace(/^[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/,'');
      // Fix common AI JSON breakage: trailing period before closing quote
      clean = clean.replace(/\.(\")/g, '$1');  // escaped quotes
      clean = clean.replace(/\.("(?:[}\]\s,]|$))/g, '$1'); // unescaped quotes before } ] , or end
      // Fix raw control characters inside JSON string values
      // Walk char by char between quotes to safely escape raw newlines/tabs
      var result = '';
      var inString = false;
      var escaped = false;
      for (var ci = 0; ci < clean.length; ci++) {
        var ch = clean[ci];
        if (escaped) { result += ch; escaped = false; continue; }
        if (ch === '\\') { result += ch; escaped = true; continue; }
        if (ch === '"') { inString = !inString; result += ch; continue; }
        if (inString) {
          if (ch === '\n') { result += '\\n'; continue; }
          if (ch === '\r') { result += '\\r'; continue; }
          if (ch === '\t') { result += '\\t'; continue; }
        }
        result += ch;
      }
      clean = result;
      parsed = JSON.parse(clean);
      console.log('[Lead Pro] JSON parsed successfully');
    } catch(e) {
      const failPos = parseInt((e.message||'').match(/position (\d+)/)?.[1] || '-1');
      console.error('[Lead Pro] JSON parse failed at position', failPos,
        '| char:', failPos >= 0 ? rawText.charCodeAt(failPos) + ' (' + rawText.substring(Math.max(0,failPos-20), failPos+20) + ')' : 'unknown',
        '| Raw start:', rawText.substring(0,300));

      // Recovery 1: clean JSON boundaries
      try {
        const start = rawText.indexOf('{');
        const end   = rawText.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          parsed = JSON.parse(rawText.substring(start, end + 1));
          console.log('[Lead Pro] Recovery 1 succeeded');
        }
      } catch(e2) { console.log('[Lead Pro] Recovery 1 failed:', e2.message); }

      // Recovery 2: regex field extraction (works even on truncated responses)
      if (!parsed) {
        try {
          const extractField = function(key) {
            // This regex handles truncated strings — stops at unescaped quote OR end of string
            const rx = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)', 'i');
            const m = rawText.match(rx);
            if (!m) return '';
            // Clean up the extracted value — may be truncated
            let val = m[1].replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
            // If truncated, add ellipsis so agents know it's incomplete
            if (finishReason === 'MAX_TOKENS') val = val + '\n[Response was cut short — regenerate for complete message]';
            return val;
          };
          const sms   = extractField('sms');
          const email = extractField('email');
          const vm    = extractField('voicemail');
          if (sms || email || vm) {
            parsed = { sms, email, voicemail: vm };
            console.log('[Lead Pro] Recovery 2 (regex) succeeded — fields:', !!sms, !!email, !!vm);
          }
        } catch(e3) { console.log('[Lead Pro] Recovery 2 failed:', e3.message); }
      }

      // Recovery 3: raw text fallback — try to split intelligently by length
      if (!parsed) {
        console.error('[Lead Pro] All recovery failed — showing raw text');
        // Attempt to split by double newline sections
        var sections = rawText.split(/\n\n+/).filter(function(s){ return s.trim().length > 20; });
        parsed = {
          sms:       sections.length >= 1 ? sections[0].substring(0, 400) : rawText.substring(0, 400),
          email:     sections.length >= 2 ? sections.slice(1).join('\n\n') : rawText,
          voicemail: sections.length >= 3 ? sections[sections.length-1].substring(0, 300) : rawText.substring(0, 300)
        };
      }
    }

    // Populate tabs
    // Normalize all three fields — handle nested objects from non-standard AI responses

    function flattenField(raw, fieldType) {
      if (!raw) return '';
      // Already a string — unescape any literal \n sequences then use directly
      if (typeof raw === 'string') {
        return raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').trim();
      }
      // Object — try to extract meaningful content
      if (typeof raw === 'object') {
        // Email: {subject, body}
        if (fieldType === 'email') {
          var subj = raw.subject || raw.Subject || raw.asunto || '';
          var bod  = raw.body    || raw.Body    || raw.mensaje || raw.message || raw.content || '';
          return ((subj ? 'Subject: ' + subj + '\n\n' : '') + bod).trim();
        }
        // Voicemail: {translation, text, script, message}
        if (fieldType === 'voicemail') {
          return (raw.translation || raw.text || raw.script || raw.voicemail || raw.message || raw.content || JSON.stringify(raw)).trim();
        }
        // SMS: {message, text, sms}
        if (fieldType === 'sms') {
          return (raw.message || raw.text || raw.sms || raw.content || JSON.stringify(raw)).trim();
        }
        // Fallback — try common keys
        return (raw.text || raw.message || raw.content || raw.body || JSON.stringify(raw)).trim();
      }
      return String(raw).trim();
    }

    const smsText   = flattenField(parsed.sms,       'sms');
    const emailText = flattenField(parsed.email,      'email');
    const vmText    = flattenField(parsed.voicemail,  'voicemail');

    function setOutput(key, text) {
      const f = document.getElementById('output-' + key);
      if (f) { f.value = text; f.classList.remove('generating'); }
      if (text) {
        const tabBtn = document.querySelector('.tab-btn.' + key);
        if (tabBtn) tabBtn.classList.add('ready-' + key);
      }
    }

    setOutput('sms',   smsText);
    setOutput('email', emailText);
    setOutput('vm',    vmText);

    // Switch to SMS tab and update word count
    switchTab('sms');

  } catch(e) {
    showError('Network error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('.btn-label').textContent = '✦ Generate SMS · Email · Voicemail';
  }
}

function showError(msg) {
  ['sms','email','vm'].forEach(function(k) {
    const f = document.getElementById('output-' + k);
    if (f) { f.value = k === 'sms' ? msg : ''; f.classList.remove('generating'); }
  });
  switchTab('sms');
  document.getElementById('wordCount').textContent = '—';
}

// ── Side panel ────────────────────────────────────────────────────
const spBtn = document.getElementById('btnSidePanel');
if (spBtn) {
  spBtn.addEventListener('click', async function() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } catch(e) {
      spBtn.textContent = 'N/A';
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────
document.getElementById('btnGrab').addEventListener('click', grabLead);
document.getElementById('btnGenerate').addEventListener('click', generateAll);

// Listen for content.js DOM updates — fires when notes change in the CRM
// This catches cases where executeScript callback misses due to channel timeout
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.type === 'LEADPRO_DOM_UPDATED') {
    if (lastScrapedData && lastScrapedData.name) return; // already have data
    chrome.storage.local.get(['leadpro_data'], function(stored) {
      if (!stored || !stored.leadpro_data) return;
      const m = stored.leadpro_data;
      if (!m || (!m.name && !m.vehicle)) return;
      if (lastScrapedData && lastScrapedData.name) return;
      console.log('[Lead Pro] DOM update listener triggered — populateFromData from storage');
      lastScrapedData = m;
      populateFromData(m);
    });
  }
});

window.addEventListener('load', function() {
  console.log('[Lead Pro] v8.83 loaded');

  // On popup open — read storage immediately in case content.js already has data
  // This handles the case where the popup was closed and reopened after grab
  chrome.storage.local.get(['leadpro_data'], function(stored) {
    const m = stored && stored.leadpro_data;
    if (m && (m.name || m.vehicle) && m.totalNoteCount > 0 && !lastScrapedData) {
      console.log('[Lead Pro] On-open storage read — found data. Notes:', m.totalNoteCount, '| leadAgeDays:', m.leadAgeDays);
      lastScrapedData = m;
      populateFromData(m);
    }
  });

  // Detect popup vs side panel mode and apply appropriate layout class
  // Side panel windows are wider (Chrome enforces ~360px min); floating popups are narrower
  var isSidePanel = window.outerWidth > 500 || (window.matchMedia && window.matchMedia('(min-width: 500px)').matches);
  document.body.classList.add(isSidePanel ? 'sidepanel-mode' : 'popup-mode');
  console.log('[Lead Pro] Mode:', isSidePanel ? 'sidepanel' : 'popup', '| outerWidth:', window.outerWidth);

  // Check endpoint config
  if (!getEndpoint()) {
    document.getElementById('keyWarning').classList.add('visible');
    console.warn('[Lead Pro] No proxy URL or API key configured. Set up config.js.');
  }
  console.log('[Lead Pro] v8.83 loaded — manifest 8.53');
});
