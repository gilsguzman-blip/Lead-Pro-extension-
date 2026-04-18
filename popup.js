// ─────────────────────────────────────────────────────────────────
// Lead Pro -- popup.js  v9.0.7
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
let lastScrapedData   = null;
var _grabRetryCount   = 0;            // auto-retry counter for
var _grabStartTime    = 0;            // timestamp when current grab started — rejects stale storage
var _degradedRetryTimer = null;       // timeout handle for degraded response retry — cancel on success
var _isAutoRetry      = false;        // flag to preserve retry count sparse scrape          // stores latest scraped lead da
var _lpTimerIds       = [];           // copy button timeout IDs — cleared on unloadta for prompt building

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
          _lpTimerIds.push(setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800));
        }).catch(function() {
          navigator.clipboard.writeText(rawText).then(function() {
            btn.textContent = 'Copied!'; btn.classList.add('copied');
            _lpTimerIds.push(setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800));
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
        _lpTimerIds.push(setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800));
      }
      return;
    }

    navigator.clipboard.writeText(field.value).then(function() {
      btn.textContent = 'Copied!'; btn.classList.add('copied');
      _lpTimerIds.push(setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800));
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
  if (d.vehicle) vehicleExtras.push('Vehicle of Interest: ' + d.vehicle + (d.condition ? ' (' + d.condition + ')' : ''));
  if (d.condition && !d.vehicle) vehicleExtras.push('Condition: ' + d.condition);
  if (d.color && !d.noSpecificVehicle) vehicleExtras.push('Color: ' + d.color);
  if (d.color &&  d.noSpecificVehicle) vehicleExtras.push('Customer expressed interest in ' + d.color + ' — but no specific unit confirmed. Do NOT say we have this color available.');
  if (d.stockNum)         vehicleExtras.push('Stock #: ' + d.stockNum);
  if (d.vin)              vehicleExtras.push('VIN: ' + d.vin);
  if (d.noSpecificVehicle && !d.stockNum && !d.vin && !stageActive) vehicleExtras.push('⚠ NO SPECIFIC UNIT: No stock number or VIN — do NOT say the vehicle is "showing available", "in stock", "here and ready", or "available right now". Say "we have the [model] available" or ask a qualifying question about color, trim, or configuration.');
  // Only warn about no vehicle if notes don't mention one either
  var contextMentionsVehicle = d.context && /\b(pilot|odyssey|civic|accord|cr-v|crv|hr-v|hrv|ridgeline|passport|highlander|camry|corolla|rav4|tacoma|tundra|sequoia|4runner|venza|sienna|k5|sportage|telluride|sorento|seltos|carnival|stinger|ev6|niro|q3|q5|q7|q8|a3|a4|a5|a6|a7|a8|e-tron|etron|silverado|f-150|f150|ram|explorer|bronco|mustang|equinox|traverse|tahoe|suburban|yukon|escalade|chevy|chevrolet|ford|gmc|dodge|jeep|nissan|altima|rogue|pathfinder|armada|frontier|hyundai|santa fe|tucson|elantra|ioniq|palisade|genesis)\b/i.test(d.context);
  if (d.noVehicleAtAll && !d.vehicle && !stageActive && !contextMentionsVehicle) {
    vehicleExtras.push('⚠ NO VEHICLE ON LEAD: No vehicle in the lead header. READ THE NOTES AND TRANSCRIPT FIRST — if a vehicle is mentioned there, write about that vehicle. Only ask a qualifying question if no vehicle appears anywhere in the notes or transcript.');
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
      vehicleExtras.push('- This URL must appear in BOTH the SMS and the email. Mandatory — do not omit or paraphrase.');
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
    vehicleExtras.push('- Example: "Hi [Name], this is ' + agentFirst + ' with [Store]. I saw your request on the [Vehicle] — are you just starting your search or looking to move soon?"');
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
        + 'The quality bar is the same for SMS and email. NEVER write a lazy follow-up reference like "I sent you an email earlier" without standalone value.\n'
        + 'SMS GOAL: Sound like a real person who actually looked at this file. Reference the specific vehicle. Ask one easy question. Warm enough that it could not be sent to any other customer.\n'
        + 'EXAMPLE SMS: "Caroline, still have that Land Cruiser here — it\'s a great spec. Still exploring or did your search take a different direction?"\n'
        + 'EXAMPLE EMAIL: One paragraph. Reference what they inquired about. Ask one easy question. No appointment times. No duration. Just re-open the conversation.\n'
        : '- Customer engaged but has gone quiet. Goal is to re-open conversation before pushing appointment.\n'
        + '- Do NOT reference any appointment confirmation — that appointment has passed.\n'
        + '- Do NOT say "thanks for confirming" or imply recent engagement.\n'
        + (d.hasConfirmedVisit ? '- KNOWN HISTORY confirms a past visit. Reference it specifically — what vehicle, what hesitation. Be honest and open a new door.\n' : '- NO CONFIRMED VISIT on record. Do NOT say "when you came in" — this customer has NOT visited.\n')
        + '- Be honest and specific. Never fabricate visit details.\n'
        + '- SMS: warm opener, specific hook, one soft ask.\n')
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
        + 'SMS: Warm opener, one specific observation about the vehicle or their situation, one easy question. No appointment close.\n'
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
  // For new leads today with Gubagoo/VR source — hasTrade from old history is unreliable
  // Only set trade flag if there's actual trade data in THIS lead's trade section
  var isNewLeadToday = (d.leadAgeDays || 0) === 0;
  var hasActualTrade = d.hasTrade && d.tradeDescription && !/(none entered)/i.test(d.tradeDescription||'');
  if (hasActualTrade)                                          toggleFlag('trade', true);
  if (ls.includes('tradepending'))                             toggleFlag('trade', true);
  if (ls.includes('kbb') || ls.includes('kelley'))             toggleFlag('trade', true);
  // Loyalty flag: only for actual loyalty/AFS lead sources — not VR leads from loyal customers
  const isLoyaltyLead = !isNewLeadToday
    ? (ls.includes('afs') || ls.includes('kmf') || ls.includes('maturity') || ls.includes('lease end') || ls.includes('luv'))
    : (ls.includes('afs') || ls.includes('kmf') || ls.includes('maturity') || ls.includes('lease end') || ls.includes('luv'))
      && !/gubagoo|virtual retail|click.*go/i.test(d.leadSource||'');
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
  const canGenerate = !!(d.name && (d.agent || d.salesRep) && (d.vehicle || detectedStore || d.leadSource || d.totalNoteCount > 0));
  _btnGenerate.disabled = !canGenerate;
  const vmBtnEl = document.getElementById('btnVoicemail');
  if (vmBtnEl) vmBtnEl.disabled = !canGenerate;

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
    _btnGenerate.disabled = !hasData;
  });
});

// ── Clear ─────────────────────────────────────────────────────────
function clearFields() {
  // counter managed by button handler — not reset here
  // Clear storage so previous lead data can't contaminate the next grab
  _grabStartTime = Date.now();
  window._activeLeadId = ''; // reset active lead ID — prevents stale storage from bleeding in
  chrome.storage.local.remove(['leadpro_data'], function() {});
  lastScrapedData = null;
  ['custName','agentName','vehicle','leadSource'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('populated'); }
  });
  ['sms','email'].forEach(function(k) {
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
  _btnGenerate.disabled = true;
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
    var raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
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

  // Extract the active lead ID from the tab URL to prevent frame contamination
  var activeLeadIdMatch = (tab.url || '').match(/AutoLeadID[=_]?(\d{6,12})/i)
    || (tab.url || '').match(/leadId[=_]?(\d{6,12})/i)
    || (tab.url || '').match(/\/leads\/(\d{6,12})/i);
  window._activeLeadId = activeLeadIdMatch ? activeLeadIdMatch[1] : '';

  chrome.storage.local.remove(['leadpro_data']);
  lastScrapedData = null; // clear so storage fallback isn't blocked by stale data
  tryExecuteScript(tab, statusEl, dot);

  // Safety net: if executeScript callback doesn't fire (channel closed),
  // content.js MutationObserver will have written data to storage — read it
  // Storage fallback — poll storage until data arrives or timeout
  // Popup may close/reopen so we can't rely on a single delayed timer
  var fallbackAttempts = 0;
  var fallbackMax = 30; // 30 x 500ms = 15 seconds total — extra buffer for slow-loading leads
  function tryStorageFallback() {
    fallbackAttempts++;
    chrome.storage.local.get(['leadpro_data'], function(stored) {
      const m = stored && stored.leadpro_data;
      // Reject stale data from previous lead — only use if scraped after this grab started
      if (m && m.scrapedAt && m.scrapedAt < _grabStartTime) {
        console.log('[Lead Pro] Storage fallback rejected stale data (scraped before this grab)');
        return;
      }
      // Reject data belonging to a different lead entirely
      // _activeLeadId is set from the tab URL when Grab is clicked
      if (m && m.autoLeadId && window._activeLeadId && m.autoLeadId !== window._activeLeadId) {
        console.log('[Lead Pro] Storage fallback rejected wrong lead ID:', m.autoLeadId, '!== active:', window._activeLeadId);
        return;
      }
      // Reject storage data if vehicle brand doesn't match store brand
      // Prevents Honda/Audi vehicle data from bleeding into Kia/Toyota leads
      if (m && m.vehicle && m.store) {
        var storeLower = m.store.toLowerCase();
        var vehLower = m.vehicle.toLowerCase();
        var storeIsKia = /kia/i.test(storeLower);
        var storeIsToyota = /toyota/i.test(storeLower);
        var storeIsHonda = /honda/i.test(storeLower);
        var storeIsAudi = /audi/i.test(storeLower);
        var vehIsKia = /kia/i.test(vehLower);
        var vehIsToyota = /toyota/i.test(vehLower);
        var vehIsHonda = /honda/i.test(vehLower);
        var vehIsAudi = /audi/i.test(vehLower);
        var knownBrands = ['toyota','honda','kia','audi','bmw','chevrolet','chevy','ford',
          'hyundai','jeep','dodge','ram','gmc','nissan','subaru','mazda','volkswagen','vw',
          'lexus','infiniti','acura','cadillac','buick','lincoln','volvo','mercedes',
          'porsche','mitsubishi','chrysler','fiat','genesis','rivian','tesla'];
        var vehBrand = knownBrands.find(function(b) { return vehLower.indexOf(b) !== -1; }) || null;
        var brandMismatch = false;
        if (vehBrand) {
          brandMismatch = (storeIsKia && vehBrand !== 'kia') ||
                          (storeIsToyota && vehBrand !== 'toyota') ||
                          (storeIsHonda && vehBrand !== 'honda' && vehBrand !== 'acura') ||
                          (storeIsAudi && vehBrand !== 'audi');
        }
        if (brandMismatch) {
          m.vehicle = ''; // Clear mismatched vehicle — let inlineScraper use the lead header
          console.log('[Lead Pro] Storage vehicle cleared — brand mismatch with store');
        }
      }
      if (m && (m.name || m.vehicle || m.agent) && (m.totalNoteCount > 0 || m.agent || m.vehicle)) {
        console.log('[Lead Pro] Storage fallback triggered — attempt', fallbackAttempts, '| notes:', m.totalNoteCount, '| leadAgeDays:', m.leadAgeDays, '| isContacted:', m.isContacted, '| hasOutbound:', m.hasOutbound);
        lastScrapedData = m;
        const filled = populateFromData(m);
        if (filled > 0) {
          statusEl.className = 'crm-status found';
          statusEl.textContent = '✓ ' + m.totalNoteCount + ' notes';
          dot.classList.add('active');
        }
      } else if (fallbackAttempts < fallbackMax) {
        var backoff = Math.min(500 * Math.pow(1.5, fallbackAttempts), 4000);
        setTimeout(tryStorageFallback, backoff);
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
    var leadReceivedCustomerQuestion='';
    var firstLeadReceivedSeen=false;
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
        qs('span[id*="CurrentAssignedBDAgent"]'),
        qs('span[id*="BDAgent"]'),
        qs('td[id*="BDAgent"]'),
        labelValue('BD Agent'),
        labelValue('BD')
      ]);
      // Reject values that look like label text rather than actual names
      if(/^status[:\s]|^manager[:\s]|^source[:\s]|^none$/i.test((a||'').trim())) return '';
      if(a) return a;
      // Text-mining fallback: extract from "BD Agent Changed From X to Y" log
      var bdChanges=(TEXT.match(/BD Agent Changed From .+ to ([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/g)||[]);
      if(bdChanges.length){
        var lastChange=bdChanges[bdChanges.length-1];
        var bm=lastChange.match(/to ([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)$/);
        if(bm) return bm[1];
      }
      // Last resort: scan recent outbound call notes for "By: First Last" pattern
      // This catches call-first leads where agent name appears in call note
      var byMatches = TEXT.match(/By:\s*([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)\s*(?:\n|$)/g) || [];
      for(var bi=0; bi<byMatches.length; bi++){
        var bByMatch = byMatches[bi].match(/By:\s*([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/);
        if(bByMatch) {
          var bName = bByMatch[1];
          // Skip system-generated names and common non-agent entries
          if(!/^(System|Kristen Willis|Ken Young|BJ Wilson|Jeremy Pratt|Colby Landry|Lonnie Sabbath|Damion Emholtz|Jeff Pasquale|Ever Pereira|Carlos Campbell|Jean DuPont|Bennett Johnson)$/i.test(bName)) {
            return bName;
          }
        }
      }
      return '';
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
      qs('.leadinfodetails'),
      labelValue('Vehicle Info'),
      labelValue('Vehicle'),
      // Text scan fallback — look for year+make pattern in lead panel text
      (function(){
        var panels = document.querySelectorAll('.leadinfodetails, [id*="LeadPanel"], [id*="VehicleInfo"]');
        for(var pi=0;pi<panels.length;pi++){
          var pt = (panels[pi].innerText||'').trim();
          var ym = pt.match(/(202[0-9]\s+[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z0-9]+[^\n]{0,40})/);
          // Exclude URLs (contain % or /) and equity/trade references
          if(ym && !/equity|calculated|trade|%2f|http|www\.|communit/i.test(ym[1])) return ym[1].trim();
        }
        return '';
      })()
    ]);
    // Strip equity data if it leaked into vehicle field
    var vehicle=vehicleRaw.replace(/\s*\((New|Used|CPO|Pre-Owned|Certified)\)\s*/gi,'').trim();
    if(/^equity[:\s]/i.test(vehicle) || /\$[\d,]+.*calculated/i.test(vehicle)) vehicle = '';
    // Strip VinSolutions UI placeholder text that leaks into vehicle field
    if(/^select$/i.test(vehicle) || /^click to add/i.test(vehicle) || /^none$/i.test(vehicle) || /^vehicle of interest$/i.test(vehicle)) vehicle = '';
    // If DOM scrape missed vehicle, scan page text ONLY if the VehicleInfo panel
    // actually exists in the DOM — prevents bleeding from other frames when lead has no vehicle
    if(!vehicle) {
      // allText scan: only fire if VehicleInfo panel exists AND has a real vehicle string
      // (not the placeholder "Click to add additional vehicles of interest")
      var vehiclePanelEl = (
        document.getElementById('ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo') ||
        document.getElementById('ActiveLeadPanel1_m_VehicleInfo') ||
        document.querySelector('span[id*="VehicleInfo"]')
      );
      var vehiclePanelText = vehiclePanelEl ? (vehiclePanelEl.innerText || '').trim() : '';
      var hasRealVehiclePanel = !!(vehiclePanelEl && vehiclePanelText &&
        vehiclePanelText.length > 4 &&
        !/click to add|no vehicle|none entered/i.test(vehiclePanelText));
      if (hasRealVehiclePanel) {
        // Only scan the VehicleInfo panel itself — not the full page body (avoids notes/URL contamination)
        var vmMatch = vehiclePanelText.match(/(202[0-9]\s+(?:Honda|Toyota|Kia|Audi)\s+[A-Za-z0-9][^\n]{2,50}?)(?:\s*\((?:New|Used|Certified|CPO|Pre-Owned)\))?/);
        if(vmMatch && !/equity|calculated|trade.in/i.test(vmMatch[0])) {
          vehicle = vmMatch[1].trim();
        }
      }
    }
    const condition=/\(New\)/i.test(vehicleRaw)?'New':/Used|Pre-Owned|CPO|Certified/i.test(vehicleRaw)?'Pre-Owned':'';
    const color=tm([/Color[:\s]+([A-Za-z ]{3,25})(?:\n|Mfr|Stock|VIN|Warning|\s{3})/i]);
    // Extract customer state from buyer address — "City, ST 00000" pattern in page text
    var customerState = '';
    var stateMatch = TEXT.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
    if (stateMatch) customerState = stateMatch[1];
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
    // If vehicle field is still empty, scan General Notes for vehicle mentions
    // e.g. "customer is shopping for a Pilot" — the AI should know this
    if (!vehicle) {
      var generalNoteEls = document.querySelectorAll('.notes-and-history-item');
      var vehicleFromNote = '';
      var noteVehiclePatterns = [
        /shopping(?:\s+for)?(?:\s+a)?\s+(\d{0,4}\s*(?:honda|toyota|kia|audi|hyundai|ford|chevrolet|chevy|nissan|jeep|gmc|dodge|ram|subaru|mazda|bmw|mercedes|lexus)\s+[a-z0-9\-]+(?:\s+[a-z0-9\-]+)?)/i,
        /(?:looking(?:\s+for|\s+at)|interested\s+in|wants?|need|searching\s+for)(?:\s+a(?:\s+new)?)?\s+(\d{0,4}\s*(?:honda|toyota|kia|audi|hyundai|ford|chevrolet|chevy|nissan|jeep|gmc|dodge|ram|subaru|mazda|bmw|mercedes|lexus)?\s*(?:pilot|odyssey|civic|accord|cr-v|hrv|ridgeline|passport|highlander|camry|corolla|rav4|tacoma|tundra|4runner|sequoia|sienna|venza|telluride|sorento|sportage|seltos|carnival|k5|stinger|ev6|niro|elantra|santa fe|palisade|tucson|ioniq|q3|q5|q7|q8|a3|a4|a5|a6|a7|a8|e-tron|silverado|f-150|f150|explorer|bronco|mustang|tahoe|suburban|pathfinder|rogue|altima|frontier))/i,
        /(\d{4}\s+(?:honda|toyota|kia|audi|hyundai|ford|chevrolet|chevy|nissan|jeep|gmc|dodge|ram)\s+[a-z0-9\-]+)/i
      ];
      for (var gni = 0; gni < Math.min(generalNoteEls.length, 10); gni++) {
        var gnTitle = ((generalNoteEls[gni].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var gnContent = ((generalNoteEls[gni].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
        if (!/general note/i.test(gnTitle) || !gnContent) continue;
        for (var pi = 0; pi < noteVehiclePatterns.length; pi++) {
          var nm = gnContent.match(noteVehiclePatterns[pi]);
          if (nm && nm[1] && nm[1].trim().length > 3) {
            vehicleFromNote = nm[1].trim()
              .replace(/^(a|an|the|new|used)\s+/i, '')
              .replace(/(\w)/g, function(c){return c.toUpperCase();});
            break;
          }
        }
        if (vehicleFromNote) break;
      }
      if (vehicleFromNote) vehicle = vehicleFromNote;
    }
    const noVehicleAtAll = !vehicle && !stockNum && !vin; // No vehicle info at all - credit app only or browse lead
    // In-transit detection: VIN present but NO stock number, vehicle condition is New, Toyota store or Toyota vehicle
    const isToyotaStore = /toyota/i.test(store);
    const isToyotaVehicle = /toyota/i.test(vehicle || vehicleRaw || '');
    const isInTransit = !!(vin && !stockNum && condition === 'New' && (isToyotaStore || isToyotaVehicle) && !inventoryWarning);
    const leadSource=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1__LeadSourceName'),
      gid('ActiveLeadPanel1__LeadSourceName'),
      qs('span[id*="LeadSourceName"]'),
      qs('span[id*="_LeadSourceName"]'),
      qs('span[id*="LeadSource"]'),
      labelValue('Source'),
      labelValue('Lead Source')
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
      if(showMoreBtn) {
        try {
          showMoreBtn.click();
          // Also try to find and remove any CSS truncation directly
          var contentEl = lpNote.querySelector('.notes-and-history-item-content, .note-content, [class*="content"]');
          if(contentEl) {
            contentEl.style.maxHeight = 'none';
            contentEl.style.overflow = 'visible';
            contentEl.style.webkitLineClamp = 'unset';
            contentEl.style.display = 'block';
          }
        } catch(e) {}
      }
      // Also try reading full text from the note's data attributes or hidden elements
      var fullNoteText = '';
      var hiddenSpans = lpNote.querySelectorAll('[style*="display:none"], [style*="display: none"], [hidden], .show-more-content, [class*="full-text"], [class*="fullText"]');
      hiddenSpans.forEach(function(el){ fullNoteText += ' ' + (el.innerText || el.textContent || ''); });
      var c = ((lpNote.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      if(fullNoteText.trim().length > c.length) c = fullNoteText.trim();
      if(!c) c = ((lpNote.querySelector('.note-content')||{}).innerText||'').trim();
      if(!c) c = ((lpNote.querySelector('[class*="content"]')||{}).innerText||'').trim();
      if(!c) c = (lpNote.innerText||'').trim();
      if(!c) continue;
      var hasLP = false;
      // [LP: ...] bracket format
      var lpMatches = c.match(/\[LP:\s*([^\]]{3,}?)(?:\]|$)/gim);
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
        // Collapse newlines first so email chain patterns match reliably
        .replace(/[\r\n\t]+/g, ' ')
        // Strip email device/app footers — "Sent from Yahoo Mail for iPad On Tuesday..."
        .replace(/\s*(?:Sent from|Get|Downloaded from)\s+(?:Yahoo Mail|my iPhone|my iPad|Outlook|Gmail|Apple Mail|Android)[^]*/gi, '')
        // Strip "On [Day], [Date]..." email reply chain headers and everything after
        .replace(/\s*On (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^]*$/gi, '')
        // Strip any remaining "> quoted" email lines
        .replace(/\s*>[^]*/g, '')
        .replace(/"/g, '\u201c').replace(/'/g, '\u2019')
        .replace(/\\/g, '/')
        .replace(/[^\x20-\x7E\u2018-\u201D]/g, '').trim();
    }

    // -- Full conversation transcript -------------------------------
    // JS extracts and labels. AI reads and understands.
    // Up to 25 entries. Skip pure noise. Full message content.
    const transcript = [];
    // Use lead created date as transcript cutoff - ignore history predating this lead
    // This prevents old lead history from bleeding into fresh lead responses
    var transcriptCutoffMs = Date.now() - (180 * 24 * 60 * 60 * 1000); // default 180 days
    var leadCreatedMs = 0; // exposed for marker logic below
    try {
      var createdRaw = labelValue('Created') || TEXT.match(/Created[:\s]+([^\n]{5,40})/i)?.[1] || '';
      var createdDateMatch = createdRaw.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if(createdDateMatch) {
        var createdMs = new Date(createdDateMatch[1]).getTime();
        if(createdMs > 0) {
          leadCreatedMs = createdMs;
          // Set cutoff to lead created date minus 1 day buffer
          var leadCutoff = createdMs - (24 * 60 * 60 * 1000);
          // Only use lead date if it's more restrictive than 180 days
          if(leadCutoff > transcriptCutoffMs) transcriptCutoffMs = leadCutoff;
        }
      }
    } catch(e) {}
    // Detect phone-up leads -- source contains "Phone"
    var isPhoneUpLead = /phone/i.test(leadSource || '');
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
      // MARK where the CURRENT lead starts.
      // Logic differs by source type:
      //  - Phone-up leads (source contains "phone"): the "Inbound phone call" is the starting point.
      //    Phone-up leads often have OLD Lead Received notes stacked from previous web inquiries;
      //    the current inquiry is the inbound call, not any old Lead Received.
      //  - Internet leads: the Lead Received note closest to the lead Created date is the starting point.
      //    Some leads have multiple Lead Received notes from different inquiry cycles -- we want the one
      //    that matches the current lead's Created timestamp.
      if(!firstLeadReceivedSeen) {
        var noteMs = date ? new Date(date).getTime() : 0;
        // Date must be within 2 days of the lead's Created date to count as the current lead starter
        var withinLeadWindow = leadCreatedMs > 0 && noteMs > 0 && Math.abs(noteMs - leadCreatedMs) < 2 * 86400000;
        var isCurrentLeadStart = false;
        if(isPhoneUpLead) {
          // Phone-up: first Inbound phone call within the lead window is the current lead
          isCurrentLeadStart = /inbound phone/i.test(title) && withinLeadWindow;
        } else {
          // Internet: first Lead Received within the lead window is the current lead
          // If no Created date is available, fall back to just the first Lead Received (old behavior)
          isCurrentLeadStart = isLeadReceived && (leadCreatedMs === 0 || withinLeadWindow);
        }
        if(isCurrentLeadStart) {
          firstLeadReceivedSeen = true;
          transcript.push('[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted. The transcript is newest-first. Everything ABOVE this line is the active conversation for THIS lead (today\'s outreach, replies, calls). Everything BELOW is older history from prior interactions -- use only for background context, not as active conversation. Count attempts, recent messages, and outreach only from above this marker.');
        }
      }
      // Extract customer question from lead received note BEFORE stripping
      // VinSolutions embeds the customer's comment/question at the end of lead received notes
      // e.g. "I'm gonna have to pay APR?" or "Consumer requests to be contacted by text"
      if(isLeadReceived && content && !lastInboundMsg) {
        // Look for customer-written content: questions or statements after common lead note markers
        var custCommentMatch = content.match(/Consumer(?:\s+requests?)?[^\n]*(?:\n|$)([^\n]{10,200})/i)
          || content.match(/Customer(?:\s+(?:comment|note|message|said))?[:\s]+([^\n]{10,200})/i)
          || content.match(/\nNote:\s*([^\n]{10,200})/i);
        // Direct question pattern — customer typed something that looks like a question or statement
        var directQuestion = content.match(/(?:^|\n)([^\n]{5,150}\?)(?:\s|$)/m);
        // Customer instruction pattern — "When responding please include X", "Please provide X"
        var custInstruction = content.match(/(?:when responding|please (?:include|provide|send|give)|I(?:'d| would) like to (?:know|see|get)|can you (?:include|provide|send))\s+([^\n]{5,200})/i);
        var extractedCustQ = (custCommentMatch && custCommentMatch[1] && !/lead reference|customer id|lead id|dealer id|consumer requests to be contacted/i.test(custCommentMatch[1]))
          ? custCommentMatch[1].trim()
          : (directQuestion && !/click here|reply stop|lead from|in-market|follow up/i.test(directQuestion[1]))
          ? directQuestion[1].trim()
          : (custInstruction && custInstruction[1])
          ? custInstruction[0].trim()
          : '';
        if(extractedCustQ) {
          leadReceivedCustomerQuestion = extractedCustQ;
          // Also push to transcript as a customer request so AI sees it
          transcript.push('[CUSTOMER REQUEST FROM INQUIRY] ' + extractedCustQ);
        }
      }
      // Extract TFS/lease maturity data from lead received note before stripping
      // TFS leads contain structured data: payoff, residual, maturity date, intent
      if(isLeadReceived && content && /maturity date|account type.*lease|payoff|residual/i.test(content)) {
        var tfsData = [];
        var maturityMatch = content.match(/Maturity Date[:\s]+([\d\-]+)/i);
        var payoffMatch = content.match(/Payoff[:\s]+([\d,\.]+)/i);
        var residualMatch = content.match(/Residual[:\s]+([\d,\.]+)/i);
        var intentMatch = content.match(/Customer.?s Intent[:\s]+([^\n,\]]+)/i);
        var paymentMatch = content.match(/Current Payment[:\s]+([\d,\.]+)/i);
        var acctTypeMatch = content.match(/Account Type[:\s]*([^\n,\]]+)/i);
        if(maturityMatch) tfsData.push('Lease maturity: ' + maturityMatch[1].trim());
        if(payoffMatch && parseFloat(payoffMatch[1]) > 0) tfsData.push('Payoff: $' + parseFloat(payoffMatch[1]).toLocaleString());
        if(residualMatch && parseFloat(residualMatch[1]) > 0) tfsData.push('Residual: $' + parseFloat(residualMatch[1]).toLocaleString());
        if(intentMatch) tfsData.push('Customer intent: ' + intentMatch[1].trim().replace(/_/g,' ').toLowerCase());
        if(acctTypeMatch) tfsData.push('Account type: ' + acctTypeMatch[1].trim());
        if(tfsData.length) {
          var tfsNote = 'LEASE/TFS DATA — use this to frame the response around their lease end:\n' + tfsData.join(' | ');
          transcript.push('[TFS LEASE DATA] ' + tfsNote);
          // Also inject into conversationBrief so it's top of context
          conversationBrief = conversationBrief ? tfsNote + '\n\n' + conversationBrief : tfsNote;
        }
      }
      // Extract browsed vehicle names from VR/Gubagoo page view URLs before stripping
      // e.g. "used-2024-toyota-corolla-hybrid-le-baytown-tx/117917021/" → "2024 Toyota Corolla Hybrid LE"
      if(isLeadReceived && content && /Previous Page Views|Page Views/i.test(content)) {
        var urlMatches = content.match(/\/auto\/([^\/\s"]+)/g) || [];
        var browsedVehicles = [];
        urlMatches.forEach(function(url) {
          // Extract year-make-model from URL slug like "used-2024-toyota-corolla-hybrid-le-baytown-tx"
          var slug = url.replace('/auto/', '').replace(/[-\/]baytown.*|[-\/]lafayette.*|[-\/]\d{8,}.*/, '');
          var yearMatch = slug.match(/(20\d\d)/);
          if(!yearMatch) return;
          var year = yearMatch[1];
          var rest = slug.replace(/^(?:used|new|certified)-/, '').replace(year, '').replace(/^-/, '');
          var modelWords = rest.split('-').filter(function(w){ return w.length > 1; }).slice(0,5);
          var modelName = year + ' ' + modelWords.map(function(w){ return w.charAt(0).toUpperCase()+w.slice(1); }).join(' ');
          if(browsedVehicles.indexOf(modelName) === -1) browsedVehicles.push(modelName);
        });
        if(browsedVehicles.length && !vehicle) {
          // Use most-viewed vehicle as the vehicle of interest
          vehicle = browsedVehicles[0];
        }
        if(browsedVehicles.length) {
          // Store browsing context for the transcript
          var browseNote = 'CUSTOMER BROWSING: Customer viewed these vehicles on the website before submitting: ' + browsedVehicles.join(', ');
          transcript.push('[BROWSE HISTORY] ' + browseNote);
        }
      }
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
            // Detect customer-proposed time from chat (e.g. "I can come around 3:30")
            // This is NOT a confirmed appointment — customer proposed a time, agent must confirm it
            var chatAllCustomer = chatOut.join(' ');
            var chatTimeMatch = chatAllCustomer.match(/(?:i can (?:come|be there|make it|stop by)|i.ll (?:come|be there|stop by)|can come (?:at|around|by)|come (?:at|around))[\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i)
              || chatAllCustomer.match(/(?:around|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
            if(chatTimeMatch) {
              transcript.push('[CHAT NOTE] CUSTOMER PROPOSED TIME: Customer said they can come at ' + chatTimeMatch[1].trim() + '. CONFIRM this time in your response — do NOT offer different times. Say something like "Perfect, I will have everything ready for you at [time]."');
            }
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
      var noteDate = ((item.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      var noteDateMs = noteDate ? new Date(noteDate).getTime() : Date.now();
      if(noteDateMs > 0 && noteDateMs < transcriptCutoffMs) return false;
      var dir = (item.getAttribute('data-direction')||'').toLowerCase();
      var title = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var msgContent = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
      // Only count real agent communication - not lead logs, system notes, or bad lead markers
      var isRealMessage = /outbound text|outbound phone|email reply|outbound email/i.test(title);
      // Exclude automated system messages - these are NOT real agent outreach
      var isAutomated = /automated response|we are not open for business|assurance that your request|we are currently working on your request|thank you.*inquiry.*community|this automated response/i.test(msgContent);
      return dir === 'outbound' && isRealMessage && !isAutomated;
    })
    // Track whether a text or email has been sent (vs call-only) — 
    // determines if digital first-touch is still needed
    var hasTextOrEmailSent = noteEls.some(function(item){
      var noteDate2 = ((item.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      var noteDateMs2 = noteDate2 ? new Date(noteDate2).getTime() : Date.now();
      if(noteDateMs2 > 0 && noteDateMs2 < transcriptCutoffMs) return false;
      var title = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var msgContent = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
      var isDigital = /outbound text|email reply to prospect|outbound email/i.test(title);
      var isAutomated = /automated response|we are not open for business|assurance that your request|thank you.*inquiry.*community|this automated response/i.test(msgContent);
      return isDigital && !isAutomated;
    });;
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
    // STOP = SMS opt-out — treat as exit, do NOT generate follow-up content
    // STOP opt-out: context-aware -- new lead submission overrides old opt-out
    var hasNewLeadToday = (leadAgeDays || 0) === 0;
    var hasRecentReoptIn = /lead received|gubagoo|virtual retail|click.*go|credit app/i.test(recentTranscript);
    var rawStopSignal = /^stop$|^stop\s*$/i.test((recentInbound||'').trim())
      || /successfully.*removed.*text|opted out of text|removed from.*text messages/i.test(fullScanText);
    isSmsOptOut = rawStopSignal && !(hasNewLeadToday && hasRecentReoptIn);
    // isSmsOptOut means "stop texting" — NOT "not interested"
    // Only treat SMS opt-out as a full exit signal if it's fresh AND no new lead exists
    // Otherwise: suppress SMS only, keep email/voicemail active
    var smsOptOutIsExit = isSmsOptOut && !hasNewLeadToday && !hasRecentReoptIn;
    var exitRaw = smsOptOutIsExit || /already bought|bought.*something|bought.*elsewhere|purchased.*already|going.*elsewhere|not interested in (the car|the vehicle|buying|purchasing|a vehicle|coming in|visiting)|not ever interested|never going back|will not be back|will never go back|won.t be back|never coming back|remove.*from.*list|stop.*contacting|decided to (buy|go with|purchase)|went with (another|a different|ford|chevy|toyota|kia|nissan|hyundai|chevrolet|gmc|ram|jeep|dodge|subaru|mazda|volvo|bmw|mercedes|lexus|acura|infiniti|cadillac|lincoln|buick)|found (one|a car|what we)|no longer (interested|looking|in the market)|took (a|the) (deal|offer) (at|from|with)|not satisfied.*process|bad experience|sharing.*bad.*experience|terrible.*experience|horrible.*experience/i.test(fullScanText);
    // "we bought" / "bought it" - only exit if followed by purchase context, not ownership history
    var boughtElsewhere = /we (bought|purchased|went with|decided on).{0,30}(another|elsewhere|different|other dealer|from them|from there)/i.test(fullScanText)
      || /bought (one|a car|a vehicle) (from|at|with)/i.test(fullScanText);
    var keepingTrade = /keep it if|keep my (car|truck|suv|altima|camry|vehicle)|hold onto it|just keep (it|my)/i.test(fullScanText);
    // Re-engagement override: if customer sent an active message AFTER the exit signal, cancel exit
    // e.g. "I am still on the hunt" after "no longer interested" = re-engaged
    var recentCustomerActive = /still (on the hunt|looking|interested|searching|in the market)|still want|still need|haven.t found|haven.t bought|still shopping|changed my mind|reconsidering|actually.*interested|would like to|still considering/i.test(recentInbound);
    const hasExitSignal = (exitRaw || boughtElsewhere) && !keepingTrade && !recentCustomerActive;
    // isSmsOptOutOnly: customer stopped texts but did NOT say they're not interested
    // Email and voicemail should still advance the conversation normally
    const isSmsOptOutOnly = isSmsOptOut && !smsOptOutIsExit && !hasExitSignal;
    const hasPauseSignal = !hasExitSignal && /taking a break|no luck|need time|not ready|still looking|need to think|not able to upgrade|not looking to upgrade|too early|just got|only have \d+k|low miles|get back to you later|i.ll reach out|contact you later|good day|have a good|have a great|talk later|i.ll let you know|let you know when|not right now|maybe later|later on|patient person|very patient|when the time is right|when i.m ready|not in a rush|no rush|take my time|taking my time|not looking yet|just browsing|just looking|thank you so much|appreciate it|keep in touch|still enjoying|loving it|love it|happy with|works great|runs great|no complaints/i.test(fullScanText);

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
    // Scan last 10 notes for timing constraints - INBOUND CUSTOMER MESSAGES ONLY
    // Skip system-generated notes even if tagged as inbound (lead received, TradePending data dumps)
    // Also skip single-word confirmations (C, YES, Morning, OK) — these are replies not schedule info
    for(var nti=0; nti<Math.min(10, noteEls.length); nti++){
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
        // Skip very short replies (1-2 words) that are confirmations not schedule info
        // e.g. "C", "YES", "Morning", "OK", "Sure" — these don't contain schedule constraints
        var ntWordCount = ntRawText.trim().split(/\s+/).filter(Boolean).length;
        var isShortConfirmation = ntWordCount <= 2 && /^(c|yes|ok|okay|sure|morning|afternoon|evening|great|perfect|sounds good|got it|thanks|thank you|hi|hello|\d{1,2}(:\d{2})?\s*(am|pm)?)$/i.test(ntRawText.trim());
        if(isShortConfirmation && !customerScheduleConstraint) continue; // skip but keep looking deeper
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
    if(hasExitSignal && !(agentLPCommands && agentLPCommands.length > 0)) {
      convState = 'exit';
    } else if(hasPauseSignal && !(agentLPCommands && agentLPCommands.length > 0)) {
      convState = 'pause';
    } else if(hasOutbound || isContacted) {
      var hasNegTag = noteEls.slice(0,10).some(function(item){ return /negative|pricing/i.test(item.innerHTML||''); });
      // Check if customer has sent a real inbound text/email reply
      var hasRealCustomerReply = noteEls.slice(0,15).some(function(item){
        var dir = (item.getAttribute('data-direction')||'').toLowerCase();
        var title = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
        return dir === 'inbound' && /inbound text|inbound sms|text message/i.test(title)
          && content && content.length > 3
          && !/lead received|auto response|opted out|stop$/i.test(content);
      });
      if(hasNewLeadToday && hasRecentReoptIn && !hasRealCustomerReply) {
        // Brand new lead submitted today — customer re-engaged fresh, no reply yet
        // Old outbound history is irrelevant — treat as first-touch
        convState = 'first-touch';
      } else if(hasNegTag) {
        convState = 'negative-reply';
      } else if(!hasTextOrEmailSent) {
        // Agent called but hasn't sent text/email yet
        // This is NOT first-touch — the call already happened. Text/email is the follow-up to the call.
        convState = 'call-followup';
      } else if(totalNoteCount > 4 && hasOutbound) {
        convState = 'active-follow-up';
      } else {
        convState = 'first-follow-up';
      }
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
    // ── Inject agent context notes into brief — always, regardless of convState ──
    // Collect: General Notes, agent call notes with content, Showroom Visit notes
    var contextNoteLines = [];

    // 1. General Notes
    transcript.filter(function(t){
      return t.indexOf('[NOTE]') !== -1 && t.indexOf('General Note') !== -1;
    }).forEach(function(t){ contextNoteLines.push(t); });

    // 2. Agent call notes that have meaningful content (not just "Left message" or system)
    // These are [AGENT] outbound phone call notes with real content written by agent
    noteEls.forEach(function(n) {
      var title = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
      var content = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      var dir = (n.getAttribute('data-direction')||'').toLowerCase();
      var date = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      // Only include agent outbound call notes that have real content beyond boilerplate
      if(dir === 'outbound' && /phone call/i.test(title) && content && content.length > 5) {
        var isBoilerplate = /^(left message|no answer|auto generated|voicemail|machine|mb full|full mailbox|https?:)/i.test(content.trim()) || /^left\s/i.test(content.trim());
        if(!isBoilerplate) {
          contextNoteLines.push('[' + date + '] [CALL NOTE] ' + title + '\n  By: ' + (content.match(/By:\s*([^\n]+)/)||['','Agent'])[1] + '\n  ' + content.replace(/By:[^\n]+\n?/,'').trim());
        }
      }
    });

    // 3. Showroom Visit notes — rich context: what steps completed, manager turnover, notes
    noteEls.forEach(function(n) {
      var title = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
      var content = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      var date = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      if(/showroom visit/i.test(title) && content) {
        contextNoteLines.push('[' + date + '] [SHOWROOM VISIT]\n  ' + content.replace(/\n/g, '\n  '));
      }
    });

    if(contextNoteLines.length) {
      var notePrefix = 'AGENT CONTEXT (read before writing — call notes, showroom visits, and agent observations):' +
        '\n' + contextNoteLines.join('\n');
      conversationBrief = conversationBrief ? notePrefix + '\n\n' + conversationBrief : notePrefix;
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
          var kTitle = ((noteEls[ki].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
          var kText = ((noteEls[ki].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
          var isRealReply = /inbound text|inbound sms|text message|email reply from prospect|email from prospect|inbound phone|inbound call/i.test(kTitle);
          if(kText && kText.length > 3 && isRealReply) inboundMsgs.push(kText);
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
            + 'Read the FULL transcript. The customer may have communicated across text, email, and phone. Agent notes, call notes, and sales rep interactions all provide context. React to the complete picture, not just one message.';
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
        customerConcerns.push('TRADE-IN CONCERN: Customer mentioned their trade-in. This is THE hook -- lead with it in BOTH the SMS and email. Do not bury it. Do not default to a generic vehicle check-in. Example SMS opener: "Angel, still want to get that 2023 Tacoma appraised -- took 10 min to pull values, just need to confirm before I send."');
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
    var lastOutboundMsg = '';
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

    var lastInboundMsg = '';
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
          // Collect consecutive inbound messages — customer may have sent multiple texts
          if(!lastInboundMsg) {
            lastInboundMsg = iiContent.substring(0,200);
          } else if(lastInboundMsg.length < 400) {
            // Check if this next inbound is from same day (burst messages like "How much?" + "Please")
            var prevDateMs = iiDateMs;
            var firstMsgDate = iiDateMs;
            // Only combine if within 5 minutes of each other
            var nextEl = noteEls[ii+1];
            if(nextEl && (nextEl.getAttribute('data-direction')||'').toLowerCase() === 'inbound') {
              var nextDateText = ((nextEl.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
              var nextDateMs = nextDateText ? new Date(nextDateText).getTime() : 0;
              if(Math.abs(firstMsgDate - nextDateMs) < 10*60*1000) {
                // Within 10 minutes — prepend (older message first for context)
                var nextContent = ((nextEl.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
                lastInboundMsg = nextContent.substring(0,200) + ' / ' + lastInboundMsg;
              }
            }
            break;
          } else {
            break;
          }
        }
      }
    }
    if(!lastInboundMsg){ var im=TEXT.match(/(?:Text Message Reply Received|Inbound Text|Customer replied)[:\s]*([^\n]{10,200})/i); if(im) lastInboundMsg=im[1].trim(); }

    // -- Gubagoo VR deal status scraping ----------------------------------
    // Parse lead received note to find what customer actually completed vs skipped
    var vrCreditApp = false, vrPaymentSelected = false, vrTradeIn = false;
    var vrCompleted = false, vrDroppedOff = false;
    var vrMonthlyPayment = '', vrDownPayment = '', vrCreditScore = '';
    var vrAPR = '', vrTerm = '', vrLender = '';
    noteEls.forEach(function(n) {
      var t = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var c = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'');
      if (/lead received/i.test(t) && /gubagoo|virtual retail/i.test(c)) {
        // Detect credit app from both structured note content AND lead type / URL patterns
        var creditAppFromContent = /Credit App.*?(Started|Submitted|Complete)/i.test(c) && !/Credit App.*?Not Started/i.test(c);
        var creditAppFromType    = /Dynamic Credit App|finance.application|finance-app/i.test(c);
        vrCreditApp = creditAppFromContent || creditAppFromType;
        vrPaymentSelected = /Payment[:\s]*\$[\d,]+/i.test(c) && !/No Payment selected/i.test(c);
        vrTradeIn = /Trade-In Vehicle[:\s]*[A-Z0-9]/i.test(c);
        vrCompleted = /Customer completed VR deal/i.test(c);
        vrDroppedOff = /Dropped off on page/i.test(c);
        // Extract VR deal details for context — these tell us exactly what the customer built
        var vrPaymentMatch = c.match(/Payment[:\s]*\$([\d,\.]+)\/month/i);
        var vrDownMatch    = c.match(/Down Payment[:\s]*\$([\d,\.]+)/i);
        var vrCreditMatch  = c.match(/Verified Credit Score[:\s]*(\d+)/i);
        var vrAprMatch     = c.match(/APR[:\s]*%?([\d\.]+)/i);
        var vrTermMatch    = c.match(/Term[:\s]*(\d+)\s*mo/i);
        var vrLenderMatch  = c.match(/Lender[:\s]*([^\n;,]{5,60})/i);
        if(vrPaymentMatch) vrMonthlyPayment = '$' + vrPaymentMatch[1] + '/mo';
        if(vrDownMatch)    vrDownPayment    = '$' + vrDownMatch[1];
        if(vrCreditMatch)  vrCreditScore    = vrCreditMatch[1];
        if(vrAprMatch)     vrAPR            = vrAprMatch[1] + '%';
        if(vrTermMatch)    vrTerm           = vrTermMatch[1] + ' months';
        if(vrLenderMatch)  vrLender         = vrLenderMatch[1].trim();
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

    // Check for system-generated appointment confirmation/reminder emails
    if(!hasApptSet) {
      var todayMsAE = Date.now();
      noteEls.slice(0,10).some(function(n){
        var aeTitle = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var aeContent = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'');
        var aeDateStr = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var aeDateMs = aeDateStr ? new Date(aeDateStr).getTime() : 0;
        var aeAge = aeDateMs > 0 ? (todayMsAE - aeDateMs) : Infinity;
        var aeRecent = aeAge < 3 * 24 * 60 * 60 * 1000;
        var aeIsAppt = /email auto response|email failure/i.test(aeTitle)
          && /appointment confirmation|reminder.*appointment|reminder about.*appointment/i.test(aeContent);
        if (aeRecent && aeIsAppt) {
          hasApptSet = true;
          apptDetails = aeContent.trim().substring(0,250);
          return true;
        }
        return false;
      });
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
      history, totalNoteCount, hasOutbound, isContacted, contactedAgeDays, lastOutboundMsg, lastInboundMsg: lastInboundMsg||leadReceivedCustomerQuestion,
      hasPauseSignal, hasExitSignal, isSmsOptOutOnly, hasTextOrEmailSent, convState,
      vrMonthlyPayment, vrDownPayment, vrCreditScore, vrAPR, vrTerm, vrLender, conversationBrief, customerSaidNotToday, customerScheduleConstraint, isLiveConversation, isRecentOutbound, recentOutboundContent,
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
      var maxWait = 4000, interval = 150, elapsed = 0;
      function wait(resolve) {
        var noteCount = document.querySelectorAll('.notes-and-history-item').length;
        var hasLeadInfo = !!(
          document.querySelector('span[id*="BDAgentLabel"]') ||
          document.querySelector('span[id*="BDAgent"]') ||
          document.querySelector('span[id*="LeadSourceName"]') ||
          document.querySelector('span[id*="VehicleInfo"]') ||
          document.querySelector('.notes-and-history-item') ||
          document.querySelector('.leadinfodetails') ||
          document.querySelector('tr td.datalabel') ||
          document.getElementById('ContentPlaceHolder1_m_CustomerAndTaskInfo_m_CustomerInfo__CustomerName')
        );
        if (noteCount > 0 || hasLeadInfo || elapsed >= maxWait) { resolve(); }
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

          // If _activeLeadId wasn't in the tab URL (Tasks panel navigation),
          // derive it from the most common autoLeadId across frames
          if (!window._activeLeadId) {
            var leadIdCounts = {};
            for (var fi = 0; fi < sorted.length; fi++) {
              var faid = sorted[fi].result && sorted[fi].result.autoLeadId;
              if (faid) leadIdCounts[faid] = (leadIdCounts[faid] || 0) + 1;
            }
            var bestLeadId = '', bestCount = 0;
            for (var lid in leadIdCounts) {
              if (leadIdCounts[lid] > bestCount) { bestCount = leadIdCounts[lid]; bestLeadId = lid; }
            }
            if (bestLeadId) {
              window._activeLeadId = bestLeadId;
              console.log('[Lead Pro] _activeLeadId derived from frames:', bestLeadId);
            }
          }
          var _aid = window._activeLeadId || '';
          for (const frame of sorted) {
            const d = frame.result; if (!d) continue;
            // Reject frames from a different lead — autoLeadId mismatch
            // This prevents stale frames from another open lead contaminating the current one
            if (_aid && d.autoLeadId && d.autoLeadId !== _aid) {
              console.log('[Lead Pro] Frame rejected — autoLeadId mismatch:', d.autoLeadId, '!==', _aid);
              continue;
            }
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
              } else if (k==='vehicle') {
                // Vehicle: take longest non-empty value — avoids empty string overwriting
                if (!m[k] && d[k]) m[k] = d[k];
                else if (d[k] && d[k].length > (m[k]||'').length) m[k] = d[k];
              } else if (!m[k] && d[k]) {
                m[k]=d[k];
              }
            }
          }
          // Set best store after all frames processed
          m.store = bestStore;

          // If vehicle still empty, pull from content.js storage (runs in CustomerDashboard)
          if (!m.vehicle) {
            chrome.storage.local.get(['leadpro_data'], function(sd) {
              if (sd && sd.leadpro_data && sd.leadpro_data.vehicle &&
                  !/equity|calculated/i.test(sd.leadpro_data.vehicle)) {
                m.vehicle = sd.leadpro_data.vehicle;
              }
              lastScrapedData = m;
              populateFromData(m);
            });
          }
          lastScrapedData = m;
          const filled = populateFromData(m);

          // Auto-retry if notes came back undefined — VinSolutions may not have loaded yet
          // Retry if key fields missing — name+store alone is not enough to generate
          if ((!m.agent && !m.salesRep) && !m.totalNoteCount && _grabRetryCount < 2) {
            _grabRetryCount++;
            var _savedCount = _grabRetryCount;
            console.log('[Lead Pro] Sparse data — auto-retrying GRAB LEAD in 2.5s (attempt ' + _savedCount + ')');
            statusEl.className = 'crm-status';
            statusEl.textContent = '\u29d7 Loading lead data... retrying (' + _savedCount + '/2)';
            setTimeout(grabLead, 2500);
            return;
          }
          _grabRetryCount = 0; // reset on successful load

          // If still no notes after retries, do a final delayed storage read
          // content.js MutationObserver may write data slightly after inlineScraper times out
          if (!m.totalNoteCount && !m.agent) {
            statusEl.className = 'crm-status';
            statusEl.textContent = '⟳ Waiting for CRM data... (6s)';
            setTimeout(function() {
              chrome.storage.local.get(['leadpro_data'], function(stored) {
                const sm = stored && stored.leadpro_data;
                if (sm && sm.totalNoteCount > 0) {
                  console.log('[Lead Pro] Delayed storage read succeeded — notes:', sm.totalNoteCount);
                  lastScrapedData = sm;
                  populateFromData(sm);
                  statusEl.className = 'crm-status found';
                  statusEl.textContent = '✓ ' + sm.totalNoteCount + ' notes · store detected';
                } else {
                  // Still nothing — try asking content.js directly via message
                  console.log('[Lead Pro] Delayed read empty — trying content.js message');
                  statusEl.textContent = '⟳ Requesting data from page...';
                  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                    if (!tabs || !tabs[0]) {
                      statusEl.className = 'crm-status error';
                      statusEl.textContent = '⟳ Still loading — scroll through the notes panel, then GRAB LEAD again';
                      return;
                    }
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'LEADPRO_SCRAPE_NOW' }, function(resp) {
                      if (chrome.runtime.lastError || !resp || !resp.totalNoteCount) {
                        // Content.js also has nothing — genuine slow load
                        if (m.name && m.agent) {
                          lastScrapedData = m;
                          populateFromData(m);
                          statusEl.className = 'crm-status';
                          statusEl.textContent = '⚠ Partial data only — scroll through notes then GRAB LEAD again';
                          _btnGenerate.disabled = false;
                        } else {
                          statusEl.className = 'crm-status error';
                          statusEl.textContent = '⟳ Still loading — scroll through the notes panel, then GRAB LEAD again';
                        }
                      } else {
                        // Content.js has data — use it
                        console.log('[Lead Pro] Content.js message returned notes:', resp.totalNoteCount);
                        lastScrapedData = resp;
                        populateFromData(resp);
                        statusEl.className = 'crm-status found';
                        statusEl.textContent = '✓ ' + resp.totalNoteCount + ' notes · data loaded';
                      }
                    });
                  });
                }
              });
            }, 6000);
          }

          console.log('[Lead Pro] Merged store:', m.store, '| dealerId:', m.dealerId);
          if (filled > 0 || selectedStore) {
            // Warn if agent name is missing — prevents hallucinated signatures
            if (!m.agent && !m.salesRep && m.totalNoteCount > 0) {
              statusEl.className = 'crm-status error';
              statusEl.textContent = '⚠ BD Agent name missing — reload the lead in VinSolutions and GRAB again';
              _btnGenerate.disabled = true;
              var _vmBtn = document.getElementById('btnVoicemail');
              if (_vmBtn) _vmBtn.disabled = true;
            } else {
            statusEl.className = 'crm-status found';
            const parts = [];
            if (filled > 0)    parts.push(filled + ' field' + (filled>1?'s':'') + ' filled');
            if (selectedStore) parts.push('store detected');
            if ((m.totalNoteCount||0) > 0) parts.push(m.totalNoteCount + ' notes');
            statusEl.textContent = '✓ ' + parts.join(' · ');
            dot.classList.add('active');
            }
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
  // Stale = old lead being re-worked, NOT a fresh submission being followed up same day
  // isFreshContact alone should not kill Click & Go — agent working a fresh Gubagoo lead IS a C&G scenario
  // Only demote to stale if: aged contact (14+ days) OR live conversation (customer replied today actively)
  // OR fresh contact BUT with heavy outbound history (3+ attempts = it's clearly been worked before)
  // Stale only if lead is genuinely old (14+ days since contact) or customer is actively in live conversation
  // Fresh same-day leads with heavy outbound are just being worked hard — still C&G
  var isStaleClickAndGo = isClickAndGoSource && hasRealOutbound && ((data.contactedAgeDays >= 14) || isLive);
  // Exit signal always wins — never treat a customer who said they bought elsewhere as a Click & Go lead
  s.isClickAndGo   = isClickAndGoSource && !isStaleClickAndGo && !s.isExitSignal;
  s.isTradePending = /tradepending/i.test(ls);
  s.isLoyalty      = /afs|kmf|luv|off loan|maturity|loyalty/i.test(ls);
  s.isCarGurusDD = /cargurus.*digital deal|digital deal.*cargurus/i.test(ls);
  s.isKBB = /kbb|kelley blue/i.test(ls) && !/autotrader/i.test(ls); // AutoTrader-KBB = purchase lead, not trade offer — AutoTrader takes priority
  s.isCapitalOne = /capital one|cap one/i.test(ls);
  s.isTrueCar = /truecar/i.test(ls);
  s.isAMP = /\bamp\b/i.test(ls);
  // AI Buying Signals — detect both variants precisely
  const isAISignalLead = !s.isFollowUp && /ai buying signal/i.test(ls);
  s.isAIBuyingSignalReturner = isAISignalLead && /previously sold customer/i.test(ls) && !/not previously sold/i.test(ls);
  s.isAIBuyingSignalNew      = isAISignalLead && !s.isAIBuyingSignalReturner;
  s.buyingSignalData = (data.context||'').match(/buying signal data[:\s]+([^\n]+)/i)?.[1]?.trim() || '';
  s.isAutoTrader = /autotrader/i.test(ls);
  s.isCarscom = /cars\.com|cars com/i.test(ls);
  s.isEdmunds = /edmunds/i.test(ls);
  s.isOEMLead = /toyota\.com|honda\.com|kia\.com|hyundai\.com|oem|manufacturer/i.test(ls);
  s.isPhoneUp = /phone.*up|phone-up|phoneup|inbound.*call|call.*center/i.test(ls);
  s.isCarGurus = !s.isCarGurusDD && /cargurus/i.test(ls);
  s.isFacebook = /facebook|fb marketplace|fb lead|meta lead/i.test(ls);
  s.isDealerWebsite = /dealer\.com|dealersocket|dealerfire|dealer website|website lead|internet lead|hds dr lead|dealertrack.*lead/i.test(ls) && !s.isClickAndGo;
  s.isChatLead = (/chat/i.test(ls) || /gubagoo.*sms|sms.*chat/i.test(ls)) && !s.isClickAndGo;
  s.isCarFax = /carfax|iseecars|autobytel|car.*genie|modalyst/i.test(ls);
  // High-volume sources from store data
  // Walk-ins are handled by isShowroomFollowUp — no separate flag needed (they always have prior history)
  s.isRepeatCustomer = /repeat|returning|prior customer|dms sales|previous (customer|buyer|owner)|sold customer/i.test(ls);
  s.isThirdPartyOEM = /third.?party|3rd.?party|kia digital|honda digital|toyota digital|hyundai digital|oem partner|audi partner|manufacturer partner/i.test(ls) && !s.isOEMLead;
  s.isGoogleAd = /google.*ad|google.*digital|paid search|sem lead|ppc/i.test(ls);
  s.isReferral = /referral|referred by|word of mouth/i.test(ls);
  s.isStandard     = !s.isClickAndGo && !s.isTradePending && !s.isCarGurusDD && !s.isCarGurus && !s.isKBB && !s.isCapitalOne && !s.isTrueCar && !s.isAMP && !s.isAutoTrader && !s.isCarscom && !s.isEdmunds && !s.isOEMLead && !s.isPhoneUp && !s.isAIBuyingSignalNew && !s.isAIBuyingSignalReturner && !s.isFacebook && !s.isDealerWebsite && !s.isChatLead && !s.isCarFax && !s.isRepeatCustomer && !s.isThirdPartyOEM && !s.isGoogleAd && !s.isReferral && !s.isLoyalty;

  // ── Inventory status ───────────────────────────────────────────
  s.vehicleSold        = ctx.includes('vehicle status: sold');
  s.vehicleInTransit   = ctx.includes('vehicle status: in transit');
  s.isLoyaltyVehicle   = ctx.includes('loyalty vehicle')
    || (/loyalty lead created|account type.*leas|afs.*off lease|off lease.*afs/i.test(ctx) && !!data.inventoryWarning);
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
  // Clean store name — strip VinSolutions Connect frame label if present
  var cleanStore = (data.store || '');
  if (/vinsolutions connect/i.test(cleanStore)) {
    // Map dealerId to real store name
    var dealerMap = {
      '6189': 'Community Toyota Baytown',
      '6190': 'Community Kia Baytown',
      '6191': 'Community Honda Baytown',
      '24399': 'Community Honda Lafayette',
      '21135': 'Audi Lafayette'
    };
    cleanStore = dealerMap[String(data.dealerId)] || cleanStore;
  }
  s.storeGroup = s.isAudi ? 'Audi Lafayette' : (cleanStore || 'Community Auto Group');
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

  // Lease maturity / TFS off-lease lead
  s.isLeaseMature = /off.?lease|lease.?fin|tfs|toyota.*financial|insprod/i.test(ls)
    || /maturity date|account type.*lease/i.test(ctx);

  // Distance buyer — customer address is out of state, or customer explicitly mentions distance/delivery
  // IMPORTANT: only scan INBOUND/customer lines — not agent outbound messages
  // Avoids feedback loop where a prior bad AI output triggers the same wrong scenario again
  var ctxLines = (data.context || '').split('\n');
  var customerOnlyCtx = ctxLines.filter(function(line) {
    return !/^Outbound Text Message|^Outbound phone call|^Email reply to prospect|^Sent (to|by):/i.test(line.trim());
  }).join(' ').toLowerCase();
  s.isDistanceBuyer = (!s.isShowroomFollowUp) && (
    !!(data.isDistanceBuyer)
    || /home delivery|ship.*vehicle|out.of.state|how far|located.*away|drive.*from|deliver.*to me/i.test(customerOnlyCtx)
  );

  // Automotive Mastermind -- Audi Lafayette ONLY
  // IMPORTANT: Only check lead source -- NOT full context/transcript.
  // ctx scan reaches back years and catches manager names (Lonnie Sabbath)
  // from old lead log entries on non-Mastermind leads.
  var isMastermindSource = /mastermind/i.test(ls); // STRICT: only fires on explicit Mastermind lead source
  var isMastermindStore  = /audi lafayette/i.test((data.store || '').toLowerCase());
  s.isAutomotiveMastermind = isMastermindSource && isMastermindStore;

  // ── Manual flag overrides ──────────────────────────────────────
  // If the agent manually activated a context flag, force that scenario on.
  // This overrides whatever the scraper detected and ensures the right
  // module fires even when auto-detection missed it.
  var manualFlags = data.activeFlags || [];
  if (manualFlags.indexOf('trade') !== -1)      { s.hasTrade = true; }
  if (manualFlags.indexOf('price_gate') !== -1)  { s.isPriceGate = true; }
  if (manualFlags.indexOf('distance') !== -1)    { s.isDistanceBuyer = true; }
  if (manualFlags.indexOf('credit') !== -1)      { s.isCreditSensitive = true; }
  if (manualFlags.indexOf('loyalty') !== -1)     { s.isLoyalty = true; s.isLeaseMature = true; }
  if (manualFlags.indexOf('stalled') !== -1)     { s.isStalled = true; }

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
    'You are a BDC agent at a car dealership. You write SMS, email, and voicemail responses to real customers.',
    'Respond ONLY with valid JSON: {"sms":"...","email":"...","voicemail":"...","subject":"..."}. No markdown, no text outside JSON.',
    '',
    '━━━ HOW TO THINK ━━━',
    'Before you write anything, read the transcript and ask: Where does this conversation actually stand right now?',
    '',
    'If you see "[=== CURRENT LEAD SUBMITTED HERE ===]" in the transcript, that line marks where the current inquiry was submitted. The transcript is newest-first, so everything ABOVE that marker is today\'s active conversation for THIS lead. Everything BELOW is older history from prior lead submissions — you can use it for background ("customer has looked at us before" or "they asked about a Tacoma two years ago"), but do NOT treat old messages as part of the current conversation. Don\'t reference "11 attempts" if only 1 attempt happened on this lead. Don\'t write like you\'ve been chasing someone who just inquired today.',
    '',
    'Read the room. Every lead has a specific state:',
    '- What has the customer said (their actual words, their tone, their mood)?',
    '- What has the agent already sent (so you do not repeat it)?',
    '- What is the one thing that would move this conversation forward RIGHT NOW?',
    '',
    'Match the customer\'s energy:',
    '- They sent a one-word reply? Keep yours short. A novel in response feels tone-deaf.',
    '- They wrote a detailed message with specific questions? Answer each one. Match their depth.',
    '- They sound frustrated or tired of outreach? Slow down. Acknowledge it. Give them space.',
    '- They sound excited or high-intent? Move with them. Do not stall.',
    '- They asked a question? Answer it FIRST. Everything else comes after.',
    '',
    'Be the human who read their file, not the template that got triggered. Real agents write differently to different people. Your responses should feel like a person thinking, not a form being filled.',
    '',
    '━━━ WHAT MAKES A RESPONSE LAND ━━━',
    'Specific beats generic. Every time. The opening sentence should tell the customer: "you know I read what I said, not a script."',
    'Examples of specific: "The Blueprint with graphite is the combo you asked about..." / "That trade number you mentioned..." / "Since the Pilot already sold, the gray Touring is the closer match..."',
    'Examples of generic (avoid): "I wanted to reach out about your inquiry..." / "Just checking in..." / "I saw your interest in our vehicle..."',
    '',
    'The difference: the specific version could only be sent to THIS customer. The generic version could be copy-pasted to any lead.',
    '',
    '━━━ FORMAT ━━━',
    'SMS — text message. The SMS is NOT a shorter, dumber email. It is built from the same raw material: same specific hook, same reason, same tone, written at text length. The quality bar is identical. If the email mentions the trade, the SMS mentions the trade. If the email answers their question, the SMS answers their question. If the email has a specific opener, the SMS has a specific opener. Never default to "wanted to see if you had questions" or "just checking in" — that is empty filler and a dead giveaway of an automated message. The SMS opener must name a specific thing: their vehicle, their trade, their question, their price concern, something they actually said. Always end with signature on three lines: first name, store name, phone. Never skip the signature, even on a one-liner reply.',
    '',
    'EMAIL — full format. Open with something specific (their question, their vehicle, what they said). Body addresses the actual conversation. Close naturally — two appointment times if scheduling makes sense, an open question if it does not. Include a subject line in the "subject" field. Full signature at the end.',
    '',
    'VOICEMAIL — 20-30 seconds, natural, one specific reason for calling, phone number said twice.',
    '',
    '━━━ WHEN TO CLOSE WITH TIMES ━━━',
    'Default: offer two specific appointment times when the customer is engaged and ready.',
    'Skip the time close when: customer said timing is off, price is unresolved, they have not replied to previous attempts, or they asked an open scheduling question ("what time works for you"). In those cases close with a question or leave the door open.',
    '',
    '━━━ HARD RULES ━━━',
    'Never invent: vehicles not in the lead, inventory timing, stock numbers, agent names. If the agent name is unknown, sign the SMS with the phone number only.',
    'Never confirm a specific unit available without a stock number or VIN. Use soft language: "we have the model available" instead.',
    'Never copy the exact scenario opener verbatim when prior outreach already used it — that is a dead giveaway this is automated.',
    '',
    'Contractions are fine. Imperfect is fine if it sounds human. Avoid anything that reads like it came from a BDC handbook.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
// FOCUSED USER PROMPT — scenario-specific, built by JS
// ─────────────────────────────────────────────────────────────────

function buildSystemPromptVoicemailOnly() {
  return [
    'You are Lead Pro, a BDC response engine for Community Auto Group dealerships.',
    'Respond ONLY with a single valid JSON object: {"voicemail":"..."}',
    'No markdown. No text outside the JSON. The voicemail field must be a flat string.',
    'VOICEMAIL STRUCTURE — EXACT 3 PARTS:',
    '  PART 1 — INTRO: "Hi [First Name], this is [Agent First Name] from [Store Name]." One sentence.',
    '  PART 2 — HOOK: ONE sentence. The single most compelling reason to call back, specific to THIS lead.',
    '  PART 3 — CALLBACK: "Give me a call back at [number]. That is [number] again." End there.',
    'TOTAL LENGTH: 60-80 words. DO NOT include appointment times in voicemail — goal is callback only.',
    'DO NOT say: "following up" "touching base" "just wanted to" "at your earliest convenience"',
    'Agent name and phone come from the lead context provided.',
  ].join('\n');
}

function buildUserPrompt(data) {
  const sc   = classifyScenario(data);
  const hasRealOutbound = !!(data.hasOutbound);
  const appt = computeAppointmentTimes(data.store);
  const phone = lookupPhone(data.agent, data.store) || '(see directory)';
  const agentFirst = (data.agent || '').split(' ')[0] || data.agent || '';

  // ── SITUATION BRIEF — pre-digest the transcript so the model reads the room ──
  var situationBrief = [];

  // Isolate the CURRENT LEAD portion of the transcript.
  // Transcript is newest-first, so the marker appears in the MIDDLE of the string:
  //   [today's notes] [MARKER] [older history]
  // We want to analyze only the part BEFORE the marker (the current lead's activity).
  var ctx_sb_raw = data.context || '';
  var currentLeadMarkerIdx = ctx_sb_raw.indexOf('=== CURRENT LEAD SUBMITTED HERE ===');
  var ctx_sb = currentLeadMarkerIdx >= 0
    ? ctx_sb_raw.substring(0, currentLeadMarkerIdx)
    : ctx_sb_raw;

  // Attempt counting
  var sbTexts    = (ctx_sb.match(/Outbound Text Message/gi) || []).length;
  var sbCalls    = (ctx_sb.match(/Outbound phone call/gi) || []).length;
  var sbEmails   = (ctx_sb.match(/Email reply to prospect/gi) || []).length;
  var sbTotal    = sbTexts + sbCalls + sbEmails;
  var sbMachine  = (ctx_sb.match(/Machine/gi) || []).length;
  var sbNoContact= (ctx_sb.match(/No Contact/gi) || []).length;
  var sbContacted= (ctx_sb.match(/Contacted/gi) || []).length;
  var sbHungUp   = /hung up|hangs up|hung immediately|hung the phone/i.test(ctx_sb);
  var sbNoVm     = /no vmb|no voicemail box|voicemail not set up|voicemail.*full|vmb.*full|full.*voicemail|box is full/i.test(ctx_sb);
  var sbMsgs     = (ctx_sb.match(/left message|left vm/gi) || []).length;

  // Customer words analysis
  var sbCustWords = (data.lastInboundMsg || '') + ' ' +
    ctx_sb.split('\n').filter(function(l){return /^Inbound/i.test(l.trim());}).join(' ');
  var sbCustLow   = sbCustWords.toLowerCase();
  var sbPriceConcern   = /too expensive|outside.*budget|best price|lowest price|what.*deal|add.?on|package.*remove|negotiat|markup/i.test(sbCustLow);
  var sbTimingConcern  = /not ready|few months|next year|waiting|when i.m ready|not yet|saving up|months away/i.test(sbCustLow);
  var sbSpecificQuestion = data.lastInboundMsg && /\?/.test(data.lastInboundMsg);
  var sbShortMsg  = (data.lastInboundMsg || '').trim().split(/\s+/).length <= 6;
  var sbLongMsg   = (data.lastInboundMsg || '').trim().split(/\s+/).length > 20;
  // Emotional read — helps AI calibrate tone
  var sbFrustrated    = /stop (texting|calling|emailing|messaging)|leave me alone|not interested|already told|already said|told you|how many times|multiple times|quit contacting|unsubscribe/i.test(sbCustLow);
  var sbEnthusiastic  = /ready to (buy|purchase|move)|let.s do|sounds great|perfect|awesome|excited|can.?t wait|love it|absolutely|definitely/i.test(sbCustLow);
  var sbHesitant      = /thinking about|not sure|maybe|might|considering|weighing|on the fence|need to discuss|talk to (my|the)/i.test(sbCustLow);
  var sbApologetic    = /sorry|apologize|my bad|didn.?t mean|wasn.?t trying/i.test(sbCustLow);

  if (sbTotal > 0 || sbHungUp || sbMsgs > 0 || sbPriceConcern || sbTimingConcern || sbFrustrated || sbEnthusiastic || sbHesitant || data.lastInboundMsg) {
    situationBrief.push('━━━ SITUATION BRIEF ━━━');
    situationBrief.push('Read this before writing. It tells you what has already happened and what approach will work.');
    situationBrief.push('');

    // What has been tried
    var tried = [];
    if (sbTexts > 0)  tried.push(sbTexts + ' text' + (sbTexts > 1 ? 's' : ''));
    if (sbCalls > 0)  tried.push(sbCalls + ' call' + (sbCalls > 1 ? 's' : ''));
    if (sbEmails > 0) tried.push(sbEmails + ' email' + (sbEmails > 1 ? 's' : ''));
    if (tried.length) situationBrief.push('Contact history: ' + tried.join(', ') + ' sent so far.');

    // Call outcomes
    if (sbHungUp)          situationBrief.push('⚠ Customer has hung up on calls. Phone is not the right channel right now — use text.');
    if (sbNoVm)            situationBrief.push('⚠ No voicemail box — cannot leave VM. Text or email only.');
    if (sbMachine > 2)     situationBrief.push('⚠ ' + sbMachine + ' calls hit voicemail — customer is not answering. A different approach is needed.');
    if (sbContacted > 0)   situationBrief.push('✓ Customer was reached ' + sbContacted + ' time(s) — they know who we are. No need to re-introduce.');
    if (sbMsgs > 1 && (data.leadAgeDays || 0) >= 2) situationBrief.push('⚠ ' + sbMsgs + ' messages already left over ' + (data.leadAgeDays || 0) + ' days — do not send another generic check-in. Change the approach.');

    // Customer signals (price/timing/question)
    if (sbPriceConcern)    situationBrief.push('💰 Customer raised price or package concerns — address this directly. Do not pivot past it.');
    if (sbTimingConcern)   situationBrief.push('⏳ Customer indicated timing is not right yet — soft re-engagement only. No appointment pressure.');
    if (sbSpecificQuestion) situationBrief.push('❓ Customer asked a specific question in their last message — answer it first before anything else.');

    // Emotional read — calibrate tone
    if (sbFrustrated)      situationBrief.push('😤 Customer sounds frustrated. Slow down. Acknowledge it directly. Do not push — give them an easy out.');
    if (sbEnthusiastic)    situationBrief.push('🔥 Customer is enthusiastic and high-intent. Match their energy. Move fast. Do not over-explain.');
    if (sbHesitant)        situationBrief.push('🤔 Customer is weighing options. Be informative, not pushy. Help them think it through, do not close hard.');
    if (sbApologetic)      situationBrief.push('🫶 Customer apologized for being slow to respond. Be warm and gracious — no guilt trip, no urgency.');

    // Email depth guidance — applies to EMAIL tone, not SMS length
    // SMS should always be specific and substantive, matching email quality, regardless of customer message length
    if (sbLongMsg)         situationBrief.push('📝 Customer wrote a detailed message. In the EMAIL, match that depth — address each thing they said. The SMS should still be specific and substantive (same quality bar as email), not a short generic reply.');
    if (sbShortMsg && data.lastInboundMsg)  situationBrief.push('💬 Customer sent a short reply. The EMAIL can be tighter, but the SMS should still carry the specific hook (trade, question, price point). Do not let "short reply" become an excuse for a generic SMS.');

    // Recommended play
    situationBrief.push('');
    situationBrief.push('BEST APPROACH:');
    if (sbFrustrated) {
      situationBrief.push('→ Customer sounds frustrated. This is the most important signal. Acknowledge the friction directly — "I hear you" or "I won\'t keep pushing." Offer a real easy-out. Do not try to close. Earning trust back comes before selling anything.');
    } else if (data.convState === 'call-followup') {
      var vmNote = sbMachine > 0 ? 'Left a voicemail.' : (sbMsgs > 0 ? 'Left a message.' : 'Called — no contact made.');
      situationBrief.push('→ ' + vmNote + ' This text and email follow up on that call. Reference the call naturally — do not re-introduce as if this is the first contact. Keep it brief.');
    } else if (sbHungUp && sbTotal >= 3) {
      situationBrief.push('→ Pattern breaker required. ' + sbTotal + ' attempts + hang-ups. Try: curiosity angle ("Did you go a different direction?"), easy-out ("No pressure — just let me know"), or value shift ("Something came in I thought of you for"). NOT another check-in.');
    } else if (sbTotal >= 5 && sbContacted === 0 && (data.leadAgeDays || 0) >= 2) {
      situationBrief.push('→ ' + sbTotal + ' attempts over ' + (data.leadAgeDays || 0) + ' days, zero contact. This is a last re-engagement. Use curiosity or easy-out only. Short. Low pressure.');
    } else if (sbTotal >= 5 && sbContacted === 0) {
      situationBrief.push('→ Multiple attempts today with no reply yet. Normal for a same-day lead — stay confident, lead with the specific hook, and keep moving. Do NOT write a giveup or "last attempt" message.');
    } else if (sbPriceConcern) {
      situationBrief.push('→ Price/package is the blocker. Lead with it. Either address the specific concern or invite them in to review options together. Do not skip past it.');
    } else if (sbTimingConcern) {
      situationBrief.push('→ Timing is the issue. Do NOT push for appointment. Warm acknowledgment + leave the door open with one specific reason to come back when ready.');
    } else if (sbEnthusiastic) {
      situationBrief.push('→ High-intent customer. Move fast, do not over-explain. They are ready — confirm the next step and get out of the way. Short, confident, clear.');
    } else if (sbHesitant) {
      situationBrief.push('→ Customer is weighing options. Be a helpful resource, not a closer. Share one useful piece of info that helps them decide, then make the next step optional.');
    } else if (sbLongMsg) {
      situationBrief.push('→ Customer sent a detailed message — they are engaged. Be collaborative. Answer everything they said. Match their energy.');
    } else if (sbContacted > 0 && sbTotal > 2) {
      situationBrief.push('→ Customer was reached before but went quiet. Reference the last real conversation and re-open naturally. Do not start from scratch.');
    } else {
      situationBrief.push('→ Read the transcript. Identify the last meaningful exchange and continue from exactly where things left off.');
    }
    situationBrief.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }


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
      '- They reached out to you. Respond warmly — ask how they are enjoying the vehicle.',
      '- No pitch. No appointment offer. Just genuine follow-through.',
      '- Keep it brief. Tone: friend checking in.'
    ].join('\n');
    } else if(customerJustLeft && hasPostSaleService) {
      scenarioDirective = 'TASK: Sold customer just left after a service or follow-up visit. Write a brief satisfaction check — not a sales pitch, not a congratulations.';
      scenarioRules = [
      '- They were just in the store. Keep it short and warm — make sure everything was handled.',
      '- No pitch. No vehicle. Just relationship.'
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
      '- Congratulate them warmly. Welcome them to the family.',
      '- Mention the vehicle they purchased if known.',
      '- No pitch, no appointment offer. Short and genuine.'
    ].join('\n');
    }

  } else if (sc.isMissedAppt) {
    // Detect if a new appointment was confirmed

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
    if (data.vrCompleted) vrProgress = 'You have done all the heavy lifting — we just need to finalize the details in person';
    else if (data.vrCreditApp) vrProgress = 'Having that credit application started puts us in a great position to move quickly';
    else if (data.vrTradeIn) vrProgress = 'Having your trade-in details in already saves time — I can have a solid number ready when you arrive';
    else if (data.noVehicleAtAll && data.vrCreditApp) vrProgress = 'With your application already in, we can match you to the right vehicle and get you numbers fast — coming in takes about 30 minutes';
    else if (data.noVehicleAtAll) vrProgress = 'You have already taken the first step — let me help you find the right vehicle to go along with it';
    else vrProgress = 'You have already done the hard part — the vehicle is here and ready for you to see';

    var clickGoHasOutreach = data.hasOutbound || data.isContacted;
    scenarioDirective = clickGoHasOutreach
      ? 'TASK: Click & Go lead with PRIOR OUTREACH already made. This is a follow-up — NOT a first introduction. Do NOT re-introduce yourself as if this is first contact. React to where the conversation actually stands.'
      : 'TASK: Click & Go lead — first contact. Customer took an online action. Acknowledge EXACTLY what they completed.';
    scenarioRules = clickGoHasOutreach
      ? [
        '- Prior outreach already sent. Do NOT use the Click & Go opening again.',
        '- Read the transcript to see what was already sent. Continue from there naturally.',
        '- If an email or text was already sent by the agent, acknowledge it naturally.',
        '- Do NOT re-introduce yourself. Do NOT re-pitch the vehicle.',
        '- Close with two appointment times (or easy-out if CLOSE OVERRIDE is active).',
        '- Never say Gubagoo, virtual retailing platform, digital retailing, or "dynamic credit app".'
      ].join('\n')
      : [
        '- Open with: ' + vrOpening,
        '- Then: ' + vrProgress,
        '- Close with two appointment times (or easy-out if CLOSE OVERRIDE is active).',
        '- Never say Gubagoo, virtual retailing platform, digital retailing, or "dynamic credit app".'
      ].join('\n');

  } else if (sc.isAutomotiveMastermind) {
    // Determine which Mastermind touch we are on based on convState + attempt count
    var mmPhase   = 'touch1';
    var mmTexts   = (ctx_sb.match(/Outbound Text Message/gi) || []).length;
    var mmEmails  = (ctx_sb.match(/Email reply to prospect/gi) || []).length;
    var mmTouches = mmTexts + mmEmails;
    var mmCustomerReplied = /\[CUSTOMER\]/i.test(ctx_sb);
    var mmDaysOld = (data.leadAgeDays || 0);

    if (sc.isExitSignal || sc.isPauseSignal) {
      mmPhase = 'touch5';
    } else if (mmCustomerReplied) {
      mmPhase = 'active';
    } else if (!sc.isFollowUp || mmTouches === 0) {
      mmPhase = 'touch1';
    } else if (mmDaysOld >= 7 || mmTouches >= 4) {
      mmPhase = 'touch4';
    } else if (mmTouches >= 3) {
      mmPhase = 'touch3';
    } else {
      mmPhase = 'touch2';
    }

    var mmSalesRep = sc.salesRep ? sc.salesRep.split(' ')[0] : 'your Brand Specialist';

    var mmHook    = 'I\'m reaching out regarding the exclusive Private Incentive offer you recently received from our General Manager, Lonnie Sabbath.';
    var mmPivot   = 'As a current Audi owner, you were specifically selected for this opportunity. I\'ve partnered with your Audi Brand Specialist, ' + mmSalesRep + ', who will help you maximize this offer and guide you through the available models.';
    var mmClose   = 'It takes about 45 minutes to review your options and the details.';
    var mmNever   = 'NEVER use: "consultation", "white-glove", "curated", "checking in", "following up", "touching base". Use: "review options", "go over details", "prepared for your arrival". NEVER suggest a specific day of the week (Tuesday, Wednesday, etc.) unless the customer explicitly stated a preference for that day.';

    if (mmPhase === 'touch1') {
      scenarioDirective = 'TASK: Automotive Mastermind — Private Incentive first contact. Lead with the GM offer. Frame as exclusive owner loyalty campaign.';
      scenarioRules = [
        '- HOOK: ' + mmHook,
        '- PIVOT: ' + mmPivot,
        '- CLOSE: ' + mmClose + ' Offer two specific times.',
        '- TRADE-IN context: Their current Audi is their trade-in vehicle — reference it naturally as "your current Audi."',
        '- NEW VEHICLE: The vehicle of interest is their upgrade option — reference it by name.',
        '- ' + mmNever
      ].join('\n');
    } else if (mmPhase === 'touch2') {
      scenarioDirective = 'TASK: Automotive Mastermind — Touch 2 (Model/Service Pivot). Shift focus to specific models (Q5/A6) and reference GM Lonnie Sabbath offer.';
      scenarioRules = [
        '- Reference GM Lonnie Sabbath Private Incentive by name.',
        '- Mention ' + mmSalesRep + ' by name as their Brand Specialist preparing options.',
        '- Pivot to specific models: Q5, A6, or the vehicle of interest.',
        '- Close with two specific times.',
        '- ' + mmNever
      ].join('\n');
    } else if (mmPhase === 'touch3') {
      scenarioDirective = 'TASK: Automotive Mastermind — Touch 3 (Micro-Question). Low-friction question about intent with the offer. Do NOT push appointment times.';
      scenarioRules = [
        '- Ask ONE low-friction question: did they have a specific model in mind to apply the incentive toward, or still exploring?',
        '- Mention ' + mmSalesRep + ' is available for remote trade evaluation.',
        '- Do NOT offer appointment times in the SMS if still in silence/stalled phase.',
        '- ' + mmNever
      ].join('\n');
    } else if (mmPhase === 'touch4') {
      scenarioDirective = 'TASK: Automotive Mastermind — Touch 4 (Expiration/Urgency Anchor). Reference the offer expiration date if available in notes.';
      scenarioRules = [
        '- Anchor to the offer expiration date from the transcript/notes if present.',
        '- Frame as timing-sensitive — not aggressive pressure.',
        '- ' + mmSalesRep + ' is ready to prepare options before the offer ends.',
        '- Close with two specific times.',
        '- ' + mmNever
      ].join('\n');
    } else if (mmPhase === 'active') {
      scenarioDirective = 'TASK: Automotive Mastermind — Customer has replied. Read the full transcript and respond to exactly what they said. Stay within the Private Incentive framing throughout.';
      scenarioRules = [
        '- READ THE TRANSCRIPT FIRST. The customer has engaged. Your response must directly continue their conversation.',
        '- Answer any question they asked before anything else.',
        '- Keep the Private Incentive and GM Lonnie Sabbath framing present but natural — do not force it if the conversation has moved past it.',
        '- Reference ' + mmSalesRep + ' as their Brand Specialist if relevant.',
        '- CLOSE: If the customer is ready or asked a specific question that leads toward a visit, offer two times. If the CLOSE OVERRIDE says no specific times, honor it — do not invent a day or time.',
        '- ' + mmNever
      ].join('\n');
    } else {
      scenarioDirective = 'TASK: Automotive Mastermind — Touch 5 (Soft Exit). Final attempt. Remove all appointment pressure. Preserve relationship.';
      scenarioRules = [
        '- Acknowledge you have been unable to connect.',
        '- Pause outreach gracefully — do not push.',
        '- Leave the door open: "simply reply and ' + mmSalesRep + ' will have everything ready."',
        '- ' + mmNever
      ].join('\n');
    }

  } else if (sc.isDistanceBuyer) {
    scenarioDirective = 'TASK: Distance buyer — customer is out of state or has explicitly asked about delivery/shipping. They cannot easily come in. Adjust the entire approach.';
    scenarioRules = [
      '- DO NOT open with a two-time close asking them to come in. They are far away.',
      '- Address their actual questions first: price negotiation, delivery options, remote process.',
      '- Be honest: if delivery is available, say so. If not, do not promise it — tell them what you CAN do (photos, video walkaround, remote paperwork, trade-in value by photos).',
      '- Make the distance feel manageable — not a barrier. Frame the trip as worth it if they come, or offer what remote steps you can take to move things forward without a visit.',
      '- Close with a next step that works for them: a phone call, a video of the vehicle, a price quote, or a delivery inquiry — whatever fits the conversation.',
      '- If they asked a specific question, answer it directly before anything else.',
    ].join('\n');

  } else if (sc.isLeaseMature) {
    scenarioDirective = 'TASK: Lease maturity / off-lease lead. Customer is coming off a lease — this is not a cold inquiry, it is a warm transition opportunity.';
    scenarioRules = [
      '- The customer is at or near the end of their lease. This is the hook — lead with it.',
      '- Reference the lease maturity date and transition options naturally: purchase, finance, or new lease.',
      '- If payoff and residual data is available in context, use it to frame the conversation (e.g. "your buyout is around $X").',
      '- Do NOT treat this like a cold first-touch. They have a Toyota, they are already in the ecosystem.',
      '- Goal: get them in before the lease matures to discuss their options. Frame it as timing-sensitive.',
      '- CLOSE: Two specific appointment times. Urgency is appropriate here.'
    ].join('\n');
  } else if (sc.isTrueCar) {
    // TrueCar / affinity partner leads (Sam's Club, USAA, etc.)
    var ls = (data.leadSource || '');
    var tcPartner = 'TrueCar';
    var slashIdx = ls.indexOf('/');
    if (slashIdx !== -1) {
      var afterSlash = ls.substring(slashIdx + 1).trim();
      var partnerRaw = afterSlash
        .replace(/^truecar\s+for\s+/i, '')
        .replace(/\s*\(internet\)\s*$/i, '')
        .replace(/\s+members\s*$/i, '')
        .trim();
      if (partnerRaw && partnerRaw.length > 2 && !/^truecar$/i.test(partnerRaw)) {
        tcPartner = partnerRaw;
      }
    }
    var isTcPartner = tcPartner !== 'TrueCar';
    var tcFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = tcFollowUp
      ? 'TASK: TrueCar' + (isTcPartner ? ' / ' + tcPartner + ' affinity partner' : '') + ' lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: TrueCar' + (isTcPartner ? ' / ' + tcPartner + ' affinity partner' : '') + ' lead -- customer came through a price-transparent platform.';
    scenarioRules = tcFollowUp
      ? [
        '- Prior outreach already sent. Do NOT use the TrueCar' + (isTcPartner ? '/' + tcPartner : '') + ' opening again.',
        '- Read the transcript. Continue from where things left off.',
        '- If an email or text was already sent by the agent, acknowledge it naturally.',
        '- Do NOT re-introduce yourself. Do NOT re-pitch the vehicle.'
      ].join('\n')
      : [
      isTcPartner
        ? '- OPEN with the ' + tcPartner + ' connection.'
        : '- MUST mention TrueCar in the opening.',
      '- Do NOT re-pitch the vehicle from scratch.',
      '- Do NOT use high-pressure language.',
      '- If the vehicle is in stock: confirm it is here and offer to have it pulled and ready.',
      '- Close: offer two specific appointment times.',
      isTcPartner ? '- Mention the ' + tcPartner + ' benefit naturally.' : '',
    ].filter(Boolean).join('\n');

  } else if (sc.isCapitalOne) {
    var coFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = coFollowUp
      ? 'TASK: Capital One lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Capital One pre-qualification lead.';
    scenarioRules = coFollowUp
      ? [
        '- Prior outreach already sent. Do NOT use the Capital One opening again.',
        '- Read the transcript. Continue from where things left off.',
        '- If an email or text was already sent by the agent, acknowledge it naturally.',
        '- Do NOT re-introduce yourself.'
      ].join('\n')
      : [
        '- Customer pre-qualified through Capital One.',
        '- Position the visit as matching the pre-qualification to the right vehicle.'
      ].join('\n');

  } else if (sc.isApptConfirmation) {
    // Check if there's also an inventory warning — vehicle may have sold since appointment was made
    const apptWithSoldVehicle = data.context && /vehicle status: sold/i.test(data.context);
    scenarioDirective = 'TASK: Appointment is already confirmed. Write a warm confirmation message — NOT a new close or re-pitch.';
    var apptDetailsStr = data.apptDetails || '';

    // Detect if appointment is today or tomorrow so model doesn't say "tomorrow" for today's appt
    var apptTiming = '';
    if (apptDetailsStr) {
      var todayDay = now.toLocaleDateString('en-US', { weekday:'long', timeZone:'America/Chicago' });
      var tomorrowDate = new Date(now); tomorrowDate.setDate(now.getDate() + 1);
      var tomorrowDay = tomorrowDate.toLocaleDateString('en-US', { weekday:'long', timeZone:'America/Chicago' });
      if (apptDetailsStr.toLowerCase().includes(todayDay.toLowerCase())) apptTiming = 'TODAY';
      else if (apptDetailsStr.toLowerCase().includes(tomorrowDay.toLowerCase())) apptTiming = 'TOMORROW';
    }

    scenarioRules = [
      '- Appointment is already set. Do not re-pitch. Do not offer new times unless the customer asked to reschedule.',
      '- If the customer asked a question, answer it first, then confirm the appointment.',
      '- Keep it brief and warm — they are already coming in.'
    ].join('\n');

  } else if (sc.isPauseSignal) {
    scenarioDirective = 'TASK: Customer is not ready yet. Acknowledge that genuinely. No appointment push. Leave the door open.';
    scenarioRules = [''].join('\n');

  } else if (sc.isShowroomFollowUp) {
    const visitTiming = data.showroomVisitToday ? 'earlier today' : 'recently';
    const visitRef = data.showroomVisitToday ? '"I heard you stopped in earlier today"' : '"I heard you stopped in recently" or "I wanted to follow up on your visit."';
    scenarioDirective = 'TASK: Customer visited the dealership and met with the Sales Rep. The BD Agent is writing this follow-up but was NOT present for the visit.';
    scenarioRules = [
      '- Customer was in the showroom. BD Agent was NOT there — never say \'it was great meeting you.\'',
      '- Reference the visit: \'I heard you came in to look at the [vehicle].\'',
      '- Frame next step as finalizing, not starting over.',
      '- Keep it short — they already know the dealership.'
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
      '- The vehicle shown is their CURRENT car — never say it is available or on the lot.',
      '- This is an equity/upgrade conversation. Lead with their ownership position, not a new-vehicle pitch.',
      '- First touch: be warm and curiosity-driven. Tease the equity position without quoting numbers — \'I pulled up your account and you may be in a better spot than you think.\'',
      '- Follow-up: you can be more direct about options and equity if they are already engaged.'
    ].join('\n');

  } else if (sc.isCarGurusDD) {
    var cgddFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = cgddFollowUp
      ? 'TASK: CarGurus Digital Deal lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Customer used the CarGurus deal builder.';
    scenarioRules = cgddFollowUp
      ? [
        '- Prior outreach already sent. Do NOT use the CarGurus opening again.',
        '- Read the transcript. Continue from where things left off.',
        '- If an email or text was already sent by the agent, acknowledge it naturally.',
        '- Do NOT re-introduce yourself.'
      ].join('\n')
      : [
        '- Acknowledge the deal they built.',
        '- Frame the visit as confirming and finalizing.',
        '- Never say Gubagoo. This is CarGurus.'
      ].join('\n');

  } else if (sc.isKBB) {
    var kbbFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = kbbFollowUp
      ? 'TASK: KBB lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: KBB Instant Cash Offer lead.';
    scenarioRules = kbbFollowUp
      ? [
        '- Prior outreach already sent. Do NOT use the KBB opening again.',
        '- Read the transcript. Continue from where things left off.',
        '- If an email or text was already sent by the agent, acknowledge it naturally.',
        '- Do NOT re-introduce yourself.'
      ].join('\n')
      : [
        '- MUST mention KBB/Kelley Blue Book in the opening.',
        '- Customer got a KBB Instant Cash Offer.',
        '- Never quote the specific KBB dollar amount.',
        '- Hook: position the visit as where they get the full story on their trade.'
      ].join('\n');

  } else if (sc.isAIBuyingSignalNew) {
    scenarioDirective = 'TASK: AI Buying Signal — new prospect actively shopping for a vehicle. This customer has NO prior relationship with this dealership. The vehicle shown in the lead is the category they are interested in — use it to identify the segment (truck, SUV, sedan, etc.) but do NOT assume we carry that exact make/model.';
    scenarioRules = [
      '- Brand new prospect. No prior relationship — no ownership hook.',
      '- The buying signal data tells you what model they are shopping. Use the model name. Ignore price range data.',
      '- These are real buyers actively in the market right now. Be fast and specific.',
      '- Tone: confident, no fluff. They do not need a dealership introduction — they need a reason to come here.'
    ].join('\n');

  } else if (sc.isOEMLead) {
    var oemBrand = /toyota/i.test(data.leadSource||'') ? 'Toyota' : /honda/i.test(data.leadSource||'') ? 'Honda' : /kia/i.test(data.leadSource||'') ? 'Kia' : /hyundai/i.test(data.leadSource||'') ? 'Hyundai' : 'the manufacturer';
    scenarioDirective = 'TASK: OEM/manufacturer website lead — customer came directly from ' + oemBrand + '\'s website. High intent, brand-committed buyer.';
    scenarioRules = [
      '- Customer came directly from the brand\'s website. They chose the brand first — honor that.',
      '- Lead with brand enthusiasm and the specific vehicle or configuration they showed interest in.',
      '- If they built a configuration online, reference it. If the exact config is not on the lot, offer the closest match and be specific.'
    ].join('\n');

  } else if (sc.isPhoneUp) {
    scenarioDirective = 'TASK: Phone-up lead — this customer called in first. This follow-up continues a real conversation that already happened.';
    scenarioRules = [
      '- Customer called in first. A real conversation already happened. Never treat this as a cold intro.',
      '- BD Agent may not have been on the call — never say \'it was great speaking with you.\' Say: \'following up on your call with us.\'',
      '- If call notes exist, reference the most important thing discussed: vehicle, price question, trade, timing.',
      '- Frame the visit as the natural next step after the call.'
    ].join('\n');

  } else if (sc.isCarGurus) {
    var cgFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = cgFollowUp
      ? 'TASK: CarGurus lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: CarGurus lead -- customer submitted an inquiry through CarGurus.';
    scenarioRules = cgFollowUp
      ? [
        '- Prior outreach already sent. Do NOT use the CarGurus opening again.',
        '- Read the transcript. Continue from where things left off.',
        '- If an email or text was already sent by the agent, acknowledge it naturally.',
        '- Do NOT re-introduce yourself. Do NOT re-pitch the vehicle.',
        '- Tone: direct and real.'
      ].join('\n')
      : [
        '- CarGurus buyers have already seen your price and compared it against other listings. They are not shopping — they are validating. Your job is to confirm the vehicle is real, available, and worth the drive.',
        '- Mention CarGurus once so they know you saw their inquiry, then move directly to what matters: the vehicle is here, here is why it is a good one, here is when you can come see it.',
        '- Tone: direct and real. No sales-speak. They can tell.'
      ].join('\n');

  } else if (sc.isFacebook) {
    var fbFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = fbFollowUp
      ? 'TASK: Facebook lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Facebook/Facebook Marketplace lead.';
    scenarioRules = fbFollowUp
      ? [
        '- Prior outreach already sent. Do NOT use the Facebook opening again.',
        '- Read the transcript. Continue from where things left off.',
        '- If an email or text was already sent by the agent, acknowledge it naturally.',
        '- Do NOT re-introduce yourself. Do NOT re-pitch the vehicle.'
      ].join('\n')
      : [
        '- Facebook Marketplace buyers expect casual, direct messaging. They are not looking for dealership formality — they want to know if the car is still there and what the real number is.',
        '- Acknowledge Facebook briefly, then give them what they want: yes it is here, here is the out-the-door ballpark or an honest way to get it, come check it out.',
        '- Tone: text-message casual. Contractions. Short sentences. Match how a person actually types on Facebook Marketplace.'
      ].join('\n');

  } else if (sc.isAutoTrader) {
    var atFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = atFollowUp
      ? 'TASK: AutoTrader lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: AutoTrader lead.';
    scenarioRules = atFollowUp
      ? '- Prior outreach already sent. Read the transcript. Continue naturally.'
      : '- AutoTrader buyers are comparison shoppers — they are likely looking at multiple similar vehicles across different dealers. Acknowledge AutoTrader briefly, then give them a reason this specific vehicle and this specific store are worth their attention. Close with a concrete next step.';

  } else if (sc.isCarscom) {
    var ccFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = ccFollowUp
      ? 'TASK: Cars.com lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Cars.com lead.';
    scenarioRules = ccFollowUp
      ? '- Prior outreach already sent. Read the transcript. Continue naturally.'
      : '- Cars.com buyers have done their homework — reviews, comparisons, pricing. They expect professionalism and straight answers. Acknowledge Cars.com, confirm the vehicle, explain what makes it a good one, close with a time.';

  } else if (sc.isEdmunds) {
    var edFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = edFollowUp
      ? 'TASK: Edmunds lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Edmunds lead.';
    scenarioRules = edFollowUp
      ? '- Prior outreach already sent. Read the transcript. Continue naturally.'
      : '- Edmunds buyers are research-heavy — they have likely read reviews, compared trims, and know the market price. Treat them as informed. Skip the basics. Confirm the vehicle, share any unique detail that makes this unit notable, close with a time.';

  } else if (sc.isDealerWebsite) {
    scenarioDirective = 'TASK: Dealer website lead — customer submitted an inquiry directly through the dealership website. High intent.';
    scenarioRules = [
      '- High intent lead — they came to YOUR website directly, not a third-party marketplace.',
      '- Lead with the vehicle they inquired about. Position the visit as the natural next step.',
      '- If stock/VIN is confirmed, be confident about availability.'
    ].join('\n');

  } else if (sc.isChatLead && !sc.isStalled) {
    // Detect what the customer actually asked or was told in the chat
    var chatContext = (data.context || '').toLowerCase();
    var chatAskedPrice    = /how much|what.s the price|price on|what does it cost|monthly payment|what would (my|the) payment/i.test(chatContext);
    var chatAskedTrade    = /trade.?in|what.s my|how much (is|for) my|trade value/i.test(chatContext);
    var chatAskedAvail    = /is it (still )?available|do you (still )?have|is (that|the) (car|truck|suv|vehicle) (still )?there|in stock/i.test(chatContext);
    var chatAskedFinance  = /financing|get financed|credit|down payment|interest rate/i.test(chatContext);
    var chatGaveNumber    = /here.s my (number|phone)|call me|text me|my (cell|phone|number) is/i.test(chatContext);
    // Extract color mentioned in chat — customer often specifies color preference in chat
    var chatColorMatch = chatContext.match(/\b(black|white|silver|gray|grey|red|blue|green|pearl|platinum|sonic gray|lunar silver|crystal black|radiant red|aegean blue|still night|morning mist)\b/i);
    var chatColor = chatColorMatch ? chatColorMatch[1].charAt(0).toUpperCase() + chatColorMatch[1].slice(1) : '';
    if (chatColor && !data.color) data.color = chatColor + ' (mentioned in chat)';

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
      '- Read the full chat transcript. Your message picks up where the chat left off — the customer already knows the dealership.',
      '- Reference specifics from the chat: the exact vehicle, color, trim, or question they raised. Use what they actually said.',
      '- The chat agent (e.g. Jessica) was not the BD agent writing this. Never say "it was great chatting with you" — you were not in the chat.',
      '- Open naturally: "I saw you were chatting with us about the [vehicle]..." or lead directly with what they asked about.',
      '- Tone: warm continuation. Already a warm lead — no cold intro needed.'
    ].join('\n');

  } else if (sc.isRepeatCustomer) {
    var priorVehicle = data.ownedVehicle || '';
    var priorMiles = data.ownedMileage || '';
    scenarioDirective = 'TASK: Repeat/returning customer — this person has done business with the dealership before. They came back because they trust you.';
    scenarioRules = [
      '- They came back. This is family — never treat them as a cold lead.',
      '- Acknowledge the relationship immediately and reference their history if known.',
      '- Tone: warm recognition. They trust you already — honor that.'
    ].join('\n');

  } else if (sc.isGoogleAd && !sc.isStalled) {
    scenarioDirective = 'TASK: Google Digital Advertising lead — customer clicked a paid ad and submitted their info.';
    scenarioRules = [
      '- High intent — they were actively searching and clicked your ad.',
      '- Speed and specificity win. Get to the vehicle and the appointment fast.',
      '- Never mention Google or the ad.'
    ].join('\n');

  } else if (sc.isReferral && !sc.isStalled) {
    scenarioDirective = 'TASK: Referral lead — someone who knows this customer recommended the dealership.';
    scenarioRules = [
      '- Someone sent them here. Acknowledge that immediately — it sets the tone.',
      '- Referral customers come with built-in trust. Do not squander it with a generic pitch.',
      '- Tone: warm, personal. They are already predisposed to like you.'
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
      '- Great news — the vehicle is confirmed and on its way. Lead with that.',
      '- Create light urgency around securing it before it arrives.',
      '- Give an estimated timeline if known. Invite them to commit now.'
    ].join('\n');
    } else if (sc.vehicleSold) {
      scenarioDirective = 'TASK: The specific vehicle of interest has been sold. Your job is to pivot to alternatives WITHOUT making the customer feel misled or like a bait-and-switch.';
      scenarioRules = [
      '- Lead with what you DO have — do not open with the bad news.',
      '- Pivot: \'We actually just got a [comparable vehicle] in that I think you will love.\'',
      '- Be specific. Offer a real alternative, not a generic \'we have options.\''
    ].join('\n');
    }
  }

  // ── Inventory notes (for loyalty vehicle only — others handled above) ─
  let inventoryNote = '';
  if (sc.isLoyaltyVehicle) {
    inventoryNote = 'VEHICLE NOTE: This is the customer\'s current owned vehicle — not dealership inventory. Never reference its availability.';
  } else if (sc.staleModelYear && sc.stockNum && !data.inventoryWarning) {
    // Stock number confirmed — vehicle is physically on the lot regardless of model year
    inventoryNote = 'Vehicle is confirmed in stock (Stock #' + sc.stockNum + '). Say "we have it here" or "it is here and available to see." Model year is ' + sc.vehicleYear + ' — that is fine, reference it normally.';
  } else if (sc.staleModelYear) {
    // Prior model year with no stock confirmation — do not claim availability
    inventoryNote = 'VEHICLE NOTE: The vehicle listed is a ' + sc.vehicleYear + ' ' + (data.vehicle || 'vehicle').replace(/^20\d\d\s+/,'') + ', which is a prior model year. You MAY reference the vehicle by name — the customer knows what they asked about. Do NOT confirm we have this specific ' + sc.vehicleYear + ' unit available. Use soft language: "we have options similar to the ' + (data.vehicle || 'vehicle') + ' you were looking at" or reference the model generically. Never say a prior-year unit "is showing available."';
  } else if (!sc.vehicleInTransit && !sc.vehicleSold && data.vehicle) {
    if (data.stockNum || data.vin) {
      // Confirmed unit — stock number or VIN on the lead
      inventoryNote = 'Vehicle is confirmed in inventory. Use soft language: "showing available" or "we have it here."';
    } else {
      // Vehicle of interest only — no specific unit confirmed
      inventoryNote = 'VEHICLE NOTE: No specific unit confirmed (no stock number or VIN). Do NOT say the vehicle is "showing available" or "ready to see." Say we have the model available or that you can check on availability — never claim a specific unit is ready.';
    }
  }

  // ── Audi Brand Specialist ──────────────────────────────────────
  let audiNote = '';
  if (sc.isAudi) {
    audiNote = [
      'AUDI CONCIERGE PERSONA — CRITICAL:',
      '- The agent is an Audi Concierge, not a generic sales coordinator. This distinction must come through in the writing.',
      '- SMS opening: "Hi [Name], this is ' + agentFirst + ', your Audi Concierge at Audi Lafayette."',
      '- Email opening: "Hi [Name], this is ' + agentFirst + ', your Audi Concierge at Audi Lafayette." — NOT "I hope this email finds you well."',
      '- Voicemail opening: "Hi [Name], this is ' + agentFirst + ', your Audi Concierge at Audi Lafayette."',
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

  // Honda Lafayette new location note
  var hondaLafNote = '';
  var isHondaLafayetteStore = data.dealerId === 24399 || data.dealerId === '24399' || /honda.*lafayette|community honda laf/i.test(data.store || '');
  if (isHondaLafayetteStore) {
    var today = new Date();
    var movePromoEnd = new Date('2026-06-13');
    var isFirstOrEarlyTouch = !data.hasOutbound || (data.totalNoteCount || 0) < 6;
    if (today <= movePromoEnd && isFirstOrEarlyTouch) {
      hondaLafNote = 'STORE LOCATION NOTE: Community Honda Lafayette recently moved to a brand new facility. NEW ADDRESS: 2503 SE Evangeline Thwy, Lafayette, LA 70508. Include the new address in the EMAIL (one line, naturally placed -- e.g. near the close or in the signature block). In the SMS, include it only if the message has room and it fits naturally -- one mention max, never the focus. Do not skip it from the email.';
    } else {
      hondaLafNote = 'STORE LOCATION NOTE: Community Honda Lafayette is located at 2503 SE Evangeline Thwy, Lafayette, LA 70508. Only mention if the customer asks about location or directions.';
    }
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
      '━━━ READ BEFORE WRITING ━━━',
      'The transcript above is the full conversation. Read it like you\'re the agent picking up this lead.',
      'Your message must reflect THIS conversation specifically — what was said, asked, promised, or left open.',
      'If the customer answered something, do not ask it again. If they said what they want, lead with that.',
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


  // ── CLOSE OVERRIDE — computed from Situation Brief signals ──────────────
  // When the situation calls for no appointment push, override the scenario close instruction
  // This prevents the model defaulting to two-time close when it should use pattern breaker
  var closeOverride = '';
  if (sc.isPauseSignal || sc.isExitSignal) {
    closeOverride = 'CLOSE OVERRIDE: Do NOT offer appointment times. Customer is not ready.';
  } else if (sbHungUp && sbTotal >= 3) {
    closeOverride = 'CLOSE OVERRIDE: Customer has hung up on ' + sbTotal + ' attempts. Do NOT offer appointment times. Use TIER 4 — pattern breaker only. Curiosity, easy-out, or value shift.';
  } else if (sbTotal >= 5 && sbContacted === 0 && (data.leadAgeDays || 0) >= 2) {
    closeOverride = 'CLOSE OVERRIDE: ' + sbTotal + ' attempts over ' + (data.leadAgeDays || 0) + ' days, zero contact. Do NOT offer specific times. TIER 4 — short, low pressure, easy-out only.';
  } else if (sbTimingConcern) {
    closeOverride = 'CLOSE OVERRIDE: Customer indicated timing is not right. Do NOT offer specific times. TIER 3 — soft close or leave door open only.';
  } else if (sbMsgs >= 3 && sbContacted === 0 && (data.leadAgeDays || 0) >= 2) {
    closeOverride = 'CLOSE OVERRIDE: ' + sbMsgs + ' messages left over ' + (data.leadAgeDays || 0) + ' days with no response. Do NOT send another appointment push. TIER 3 or TIER 4 only.';
  } else if (sbPriceConcern) {
    closeOverride = 'CLOSE OVERRIDE: Price/package is unresolved. Do NOT offer times yet. TIER 2 — answer the price concern first, then ask what day works.';
  }

  // Append close override to scenarioRules if applicable
  if (closeOverride) {
    scenarioRules = scenarioRules + '\n' + closeOverride;
  }

  // SMS channel override — applies universally across ALL lead sources
  // When customer has opted out of SMS, suppress it and let email/VM carry the message
  if (data.isSmsOptOutOnly) {
    scenarioRules = scenarioRules + '\nSMS CHANNEL OVERRIDE: Customer opted out of SMS texts. Set sms field to empty string. Email and voicemail should proceed normally — do NOT mention the opt-out in email or voicemail. Write the email as a strong, forward-moving message appropriate to the scenario (Click & Go, follow-up, first-touch, etc.). Do NOT be apologetic or defeated.';
  }

  const lines = [
    'DATE: ' + date,
    '',
    ...(situationBrief.length ? situationBrief : []),
    ...(situationBrief.length ? [''] : []),
    buyingSignalHardBlock,
    '━━━ SCENARIO ━━━',
    scenarioDirective,
    scenarioRules,
    '',
  ];

  if (inventoryNote) lines.push('INVENTORY: ' + inventoryNote, '');
  if (audiNote)      lines.push(audiNote, '');
  if (hondaLafNote)  lines.push(hondaLafNote, '');
  // OPEN AVAILABILITY QUESTION DETECTION — must be declared before use below
  var customerAsksAvailability = false;
  if (data.lastInboundMsg) {
    var lastMsg = data.lastInboundMsg.toLowerCase();
    customerAsksAvailability = /when(?:s|\s+is|\s+can|\s+would|\s+do|\s+are)?\s+(?:a\s+)?(?:good|best|better)?\s*(?:time|day|days?|moment|chance|available|availability|work)/i.test(lastMsg)
      || /what\s+(?:day|time|days?|time\s+works?|works?\s+for\s+you)/i.test(lastMsg)
      || /when\s+(?:can|should|could|would)\s+(?:i|we|be\s+a)/i.test(lastMsg)
      || /(?:when|what time)\s+(?:can|should|do)\s+i\s+(?:come|stop|visit|swing|head|get)/i.test(lastMsg)
      || /(?:whens|when's)\s+(?:a\s+)?(?:good|best|great)/i.test(lastMsg);
  }

  // Append open availability override INSIDE conversation analysis block
  // so it appears before the transcript and cannot be overridden by old history
  if (customerAsksAvailability && !lpSuppressAppointment) {
    conversationAnalysis += (conversationAnalysis ? '\n' : '') +
      '\n⛔ CRITICAL — CUSTOMER ASKED OPEN SCHEDULING QUESTION:\n' +
      'Customer said: "' + (data.lastInboundMsg || '').trim() + '"\n' +
      'This is an OPEN question asking WHEN they can come in.\n' +
      'They did NOT propose a specific day. DO NOT invent or assume any day (not Thursday, not Friday, not tomorrow).\n' +
      'REQUIRED RESPONSE: Ask what day and time works best for them.\n' +
      'CORRECT: "What day works best for you this week?"\n' +
      'WRONG: "Would Thursday at 2:00 or 4:30 work?" — you made that day up.\n' +
      'This rule overrides any day mentioned anywhere else in the transcript.';
  }
  if (conversationAnalysis) lines.push(conversationAnalysis, '');

  // ── Brand mismatch — competitor vehicle at wrong store ───────────
  if (sc.isBrandMismatch) {
    var storeBrandName = sc.isHonda ? 'Honda' : sc.isKia ? 'Kia' : sc.isToyota ? 'Toyota' : sc.isAudi ? 'Audi' : 'our brand';
    lines.push('⚠ BRAND MISMATCH: Customer listed a ' + sc.competitorBrand + ' — this store sells ' + storeBrandName + ', not ' + sc.competitorBrand + '.',
      'ABSOLUTE RULES FOR BRAND MISMATCH:',
      '- NEVER say we can have the ' + sc.competitorBrand + ' ready, available, or pulled up for them.',
      '- NEVER offer to show them the ' + sc.competitorBrand + ' — we do not carry it.',
      '- NEVER say "we do not sell ' + sc.competitorBrand + '", "we don\'t carry ' + sc.competitorBrand + '", "we don\'t have ' + sc.competitorBrand + '" — just redirect naturally without explaining.',
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
    data.isSmsOptOutOnly ? '⚠ SMS STATUS: Customer has opted out of text messages. Do NOT generate an SMS. Generate email and voicemail only. Email and voicemail should NOT mention the opt-out — they should advance the conversation normally as if it were any other lead.' : '',
    'BD Agent:   ' + (data.agent || '⚠ AGENT NAME UNKNOWN — CRITICAL: Do NOT invent or guess a name. Use ONLY the phone number in the SMS signature. Sign as the phone number only. Never fabricate a name.') + '  ← writes the message',
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
  // Prioritize scraper leadAgeDays (from VinSolutions Created field) over context scan
  // Context scan can pick up old notes and return inflated age
  var scrapedAge = data.leadAgeDays || (lastScrapedData && lastScrapedData.leadAgeDays) || 0;
  var ageDays_final = (scrapedAge === 0 && ctxAgeDays > 0 && /Created[^(]*\(0d\)/i.test(ctx_raw))
    ? 0  // scraper says new lead, Created confirms 0d — trust it
    : (scrapedAge > 0 ? scrapedAge : ctxAgeDays || 0);
  var isContacted_final = data.isContacted || /Contacted:\s*Yes/i.test(ctx_raw);
  var hasOutbound_final = data.hasOutbound || hasOutboundNotes;

  // Also treat active-follow-up with no customer reply as zero-contact stalled
  // BUT only if lead is at least 1 day old — same-day leads are never stalled
  var isActiveFollowUpNoReply = (data.convState || '').includes('active-follow-up') && !hasCustomerReply && ageDays_final >= 1;
  var isZeroContactStalled_ctx = !hasCustomerReply && hasOutbound_final && ageDays_final >= 2 && !data.isContacted;

  var zeroContactMarker = (typeof leadContext !== 'undefined' && leadContext.includes('ZERO-CONTACT LEAD'));
  var isZeroContactStalled = (!!data._isStalled && !!data._neverReplied) || zeroContactMarker || isZeroContactStalled_ctx;
  console.log('[Lead Pro] isZeroContactStalled:', isZeroContactStalled, '| ctx_scan:', isZeroContactStalled_ctx, '| hasCustomerReply:', hasCustomerReply, '| hasOutbound:', hasOutbound_final, '| ageDays:', ageDays_final, '| _isStalled:', data._isStalled);

  if (isZeroContactStalled) {
    // Only count attempts on the CURRENT lead (before the marker, since transcript is newest-first)
    var stalledMarkerIdx = ctx_raw.indexOf('=== CURRENT LEAD SUBMITTED HERE ===');
    var ctx_stalled = stalledMarkerIdx >= 0 ? ctx_raw.substring(0, stalledMarkerIdx) : ctx_raw;
    var stalledTexts = (ctx_stalled.match(/Outbound Text Message/gi) || []).length;
    var stalledEmails = (ctx_stalled.match(/Email reply to prospect/gi) || []).length;
    var stalledTouches = stalledTexts + stalledEmails;
    var stalledPhase = '';
    var stalledApproach = '';
    if (stalledTouches <= 1) {
      stalledPhase = 'PHASE 1 -- VALUE / OPTIONS';
      stalledApproach = 'Offer something useful: new options that match, a price update, or specific info about the vehicle.';
    } else if (stalledTouches <= 2) {
      stalledPhase = 'PHASE 2 -- MICRO QUESTION';
      stalledApproach = 'Ask ONE low-effort question. NOT "are you still interested?" Instead: "Are you leaning more new or pre-owned?" or "Did your timeline change?"';
    } else if (stalledTouches <= 3) {
      stalledPhase = 'PHASE 3 -- TIMING CHECK';
      stalledApproach = 'Acknowledge their silence respectfully and check timing: "Did your timeline shift or just been busy?"';
    } else if (stalledTouches <= 4) {
      stalledPhase = 'PHASE 4 -- PATTERN INTERRUPT';
      stalledApproach = 'Break the script. Try: "Quick one -- did you already pick something up or still weighing options?" or "Should I keep this on my radar or close it out?"';
    } else {
      stalledPhase = 'PHASE 5 -- ASSUMPTION CLOSE';
      stalledApproach = 'Gently assume they moved on: "I am guessing you found something already -- did you end up going with something similar?" Keep it short, warm, zero pressure.';
    }
    lines.push('');
    lines.push('STALLED LEAD RE-ENGAGEMENT -- ' + stalledPhase);
    lines.push('This customer has not responded to ' + stalledTouches + ' message(s).');
    lines.push('DO NOT ask "are you still interested?" DO NOT repeat what previous messages said.');
    lines.push('DO NOT offer appointment times. DO NOT write duration.');
    lines.push('YOUR APPROACH: ' + stalledApproach);
    lines.push('Read the transcript. Your message must feel DIFFERENT from every previous attempt.');
    lines.push('SMS: Short. One observation or question. Feels like a real person.');
    lines.push('EMAIL: Two short paragraphs max. End with one simple question. No close.');
  }

  // LP APPOINTMENT SUPPRESSION — if agent LP command explicitly says no scheduling/no appointment push,
  // suppress the appointment engine for ALL formats (SMS and email)
  var lpSuppressAppointment = false;
  // Check LP commands from scraper AND scan leadContext for LP blocks (catches stale scrape)
  var lpCheckText = '';
  if (data.agentLPCommands && data.agentLPCommands.length > 0) {
    lpCheckText = data.agentLPCommands.join(' ');

    // Inject LP commands directly into lines as a top-priority override block
    // This ensures the model reads them as instructions, not buried data
    lines.push('');
    lines.push('━━━ AGENT LP COMMAND — HIGHEST PRIORITY ━━━');
    lines.push('The agent has written specific instructions for this lead. Follow them exactly.');
    lines.push('These override default scenario behavior:');
    data.agentLPCommands.forEach(function(cmd) { lines.push('► ' + cmd); });
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
  }
  // Also scan the full context for any LP instruction block
  if (!lpCheckText && data.context) {
    var lpContextMatch = data.context.match(/AGENT INSTRUCTIONS[\s\S]{0,800}?(?:These instructions|━━━)/i);
    var lpArrowMatches = data.context.match(/► .{20,300}/g);
    if (lpContextMatch) {
      lpCheckText = lpContextMatch[0];
    } else if (lpArrowMatches) {
      lpCheckText = lpArrowMatches.join(' ');
    }
  }
  if (lpCheckText) {
    lpSuppressAppointment = /(?:do not|no(?:t)?|never|avoid)\s+(?:\w+\s+){0,4}(?:offer|push|schedule|give|provide|include|use)\s+(?:\w+\s+){0,3}(?:times?|appointment|appt|close|scheduling)|goal[:\s]+discovery(?:,?\s*not\s*scheduling)|\bno\s+(?:appointment|close|times|scheduling)\b|discovery only\b|no close\b|soft re.?engagement only/i.test(lpCheckText.toLowerCase());
    if (lpSuppressAppointment) {
      lines.push('');
      lines.push('🚫 LP COMMAND APPOINTMENT OVERRIDE: The agent LP instruction explicitly suppresses appointment scheduling.');
      lines.push('DO NOT offer appointment times in ANY format — SMS, email, or voicemail.');
      lines.push('DO NOT include duration ("30-45 minutes"). DO NOT say "stop by" or "come in".');
      lines.push('EMAIL: Follow the LP instruction exactly — discovery/temperature check only. End with one open question.');
      lines.push('SMS: One warm sentence + one open question. No times. No close.');
    }
  }

  if (!sc.isApptConfirmation && !sc.isExitSignal && !sc.isPauseSignal && !sc.isSoldDelivered && !isZeroContactStalled) {
    if (lpSuppressAppointment) {
      // LP command suppresses appointment engine — already injected override block above
      // Do not inject times, duration, or urgency language
    } else if (customerAsksAvailability) {
      // Customer asked an open availability question ("whens a good time?", "what day works?")
      // Do NOT assume a day or offer specific times — ask for their availability instead
      lines.push('');
      lines.push('📅 CUSTOMER ASKING OPEN AVAILABILITY QUESTION:');
      lines.push('Customer asked WHEN they can come in — they did not propose a day or time.');
      lines.push('DO NOT assume or invent a day (e.g. Thursday, Friday). DO NOT offer specific times.');
      lines.push('INSTEAD: Ask what day and time works best for them this week.');
      lines.push('Example SMS: "What day works best for you this week?"');
      lines.push('Example email: "What day works best for you? Just let me know and I will have everything ready."');
    } else if (sc.notToday || (data.customerScheduleConstraint && (data.customerScheduleConstraint.indexOf('SHIFT_WORKER:') === 0 || data.customerScheduleConstraint.indexOf('OUT_OF_TOWN:') === 0))) {
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

  // Day-off override — scan context for explicit day-off statements that may be buried
  // This catches cases like "I am actually off on Friday" where the computed appointment
  // times defaulted to the wrong day because the constraint wasn't scraped
  if (data.context && !sc.isApptConfirmation && !sc.isExitSignal && !sc.isPauseSignal) {
    var ctxLower = data.context.toLowerCase();
    var dayOffMatch = ctxLower.match(/(?:i(?:'m| am)(?: actually)? off (?:on |this )?)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
      || ctxLower.match(/(?:day off (?:on |this )?)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
      || ctxLower.match(/(?:off (?:on |this )?)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s|,|\.)/i);
    if (dayOffMatch) {
      var offDay = (dayOffMatch[1] || dayOffMatch[2] || '').toLowerCase();
      offDay = offDay.charAt(0).toUpperCase() + offDay.slice(1);
      lines.push('');
      lines.push('⚠ CUSTOMER DAY-OFF OVERRIDE — CRITICAL: Customer explicitly said they are off on ' + offDay + '.');
      lines.push('REQUIRED: Offer appointment times on ' + offDay + ' ONLY. Do NOT offer any other day.');
      lines.push('The computed appointment times above may be wrong — IGNORE them. Use ' + offDay + ' morning times instead.');
      lines.push('Example: "Would 9:15 AM or 10:30 AM ' + offDay + ' work for you?"');
    }
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
      lines.push('This URL MUST appear in BOTH the SMS and the email. This is NOT optional.');
      lines.push('SMS format: write the message, then on a new line write just the URL, then the signature.');
      lines.push('Email format: include the URL as a clickable link in the email body — either as its own line or naturally embedded in a sentence.');
      lines.push('Do NOT paraphrase, shorten, or omit the URL under any circumstances.');
    }
    // Detect pending agent actions in LP (pics, video, callback) and surface them explicitly
    var allLPText = data.agentLPCommands.join(' ');
    var hasPicsAction = /pic|photo|video|image|shot|footage/i.test(allLPText);
    var hasCallbackAction = /i will call|i.ll call|will callback|call.*back|reaching out.*call/i.test(allLPText);
    if(hasPicsAction) {
      lines.push('AGENT PENDING ACTION: The agent said they will provide photos or video of this vehicle.');
      lines.push('REQUIRED: Reference this in the message — tell the customer to expect photos/video shortly. Example: "I am having our team grab some photos and video for you right now."');
    }
    if(hasCallbackAction) {
      lines.push('AGENT PENDING ACTION: The agent indicated they will call the customer.');
      lines.push('REQUIRED: Reference this commitment in the message.');
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

  // Guard: block generation if agent name is missing — prevents [Agent First Name] in output
  if (!agent) {
    const statusEl = document.getElementById('crmStatus');
    if (statusEl) {
      statusEl.className = 'crm-status error';
      statusEl.textContent = '⚠ BD Agent name missing — reload the lead in VinSolutions and GRAB again';
      setTimeout(() => { statusEl.className = 'crm-status found'; statusEl.textContent = ''; }, 6000);
    }
    return;
  }
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
      activeFlags: Array.from(activeFlags),
      dealerId: lastScrapedData ? (lastScrapedData.dealerId || '') : ''
    });
    console.log('[Lead Pro] User prompt length:', userPrompt.length, '| scenario section:', userPrompt.substring(0, userPrompt.indexOf('━━━ LEAD ━━━')));
    const payload = {
      system_instruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role:'user', parts:[{ text: userPrompt }] }],
      generationConfig: {
        temperature:      0.5,
        maxOutputTokens:  2500,
        topP:             0.9,
        responseMimeType: 'application/json',
        // thinkingConfig removed — forces slow reasoning mode, not needed for BDC responses
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
            if (finishReason === 'MAX_TOKENS' && fieldType === 'voicemail') val = val + '\n[Voicemail cut short — hit Generate again for full response]';
            return val;
          };
          const sms   = extractField('sms');
          const email = extractField('email');
          if (sms || email) {
            parsed = { sms, email };
            console.log('[Lead Pro] Recovery 2 (regex) succeeded — fields:', !!sms, !!email);
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

    // Enforce SMS signature — append if model dropped it
  function enforceSmsSig(sms) {
    if (!sms) return sms;
    var agentFirst = (data.agent || '').split(' ')[0] || '';
    var storeName  = data.store ? data.store.replace(/VinSolutions Connect \[.*?\]/i, '').trim() : '';
    var agentPhone = data.agentPhone || '';
    var isAudi     = /audi/i.test(storeName);
    // Check if phone already present near end of message
    var hasPhone = /\(\d{3}\)\s?\d{3}[-.]\d{4}|\d{3}[-.]\d{3}[-.]\d{4}/.test(sms.slice(-120));
    if (hasPhone) return sms;
    var sig = '';
    if (agentFirst) sig += '\n' + agentFirst;
    if (isAudi)     sig += '\nAudi Concierge | Audi Lafayette';
    else if (storeName) sig += '\n' + storeName;
    if (agentPhone) sig += '\n' + agentPhone;
    if (sig) {
      console.log('[Lead Pro] SMS signature missing — appended by enforcer');
      return sms.trimEnd() + sig;
    }
    return sms;
  }

  function cleanOutput(raw, isSms) {
      if (!raw) return raw;
      var result = raw
        .replace(/\.{2,}/g, '.')   // double periods
        .replace(/\.\s*\?/g, '?')     // period+question mark
        .replace(/\.\s*!/g, '!')      // period+exclamation
        .replace(/!\s*\./g, '!')      // exclamation+period
        .replace(/\?\s*\./g, '?')     // question+period
        .trim();
      if (isSms) {
        result = result.replace(/\n{2,}/g, '\n');
      }
      return result.length > 15 ? result : raw;
    }
    var rawSms   = flattenField(parsed.sms,   'sms');
    var rawSubject = parsed.subject ? parsed.subject.trim() : '';
    var rawEmail = flattenField(parsed.email, 'email');
    // Prepend subject line to email if present
    if(rawSubject && rawEmail) {
      rawEmail = 'Subject: ' + rawSubject + '\n\n' + rawEmail;
    }

    // Light-touch SMS opener check — only fix if opener has no customer name and is pure template
    (function() {
      if (!rawSms) return;
      var firstName = (lastScrapedData && lastScrapedData.name || '').split(' ')[0] || '';
      var firstSentence = rawSms.split(/[.!?\n]/)[0] || '';
      // Only rewrite if: banned opener AND customer name is completely absent from first sentence
      var hasBannedOpener = /^(I saw you started|I saw you were|I noticed you|I wanted to|I am reaching|Just checking|Following up|I.d love to|I hope this)/i.test(rawSms.trim());
      var hasName = firstName && firstSentence.toLowerCase().indexOf(firstName.toLowerCase()) !== -1;
      if (hasBannedOpener && !hasName && firstName) {
        // Prepend name to salvage the opener rather than rewriting the whole sentence
        rawSms = firstName + ', ' + rawSms.trim();
      }
    })();

    // Good response received — cancel any pending retry and reset counter
    if (_degradedRetryTimer) { clearTimeout(_degradedRetryTimer); _degradedRetryTimer = null; }
    _grabRetryCount = 0;

    const smsText   = enforceSmsSig(cleanOutput(rawSms, true));
    const emailText = cleanOutput(rawEmail, false);

    // Detect Gemini degraded response — retry once if we got the generic placeholder
    var isGeminiDegraded = rawSms && /pulling everything together|getting your information ready right now/i.test(rawSms)
      && rawSms.length < 150;
    if (isGeminiDegraded) {
      _grabRetryCount = (_grabRetryCount || 0) + 1;
      if (_grabRetryCount <= 2) {
        console.log('[Lead Pro] Gemini returned degraded response — retrying in 3s (attempt', _grabRetryCount, ')');
        var retryStatusEl = document.getElementById('crm-status') || document.querySelector('.crm-status');
        if (retryStatusEl) {
          retryStatusEl.className = 'crm-status';
          retryStatusEl.textContent = '⟳ Response incomplete — retrying...';
        }
        _degradedRetryTimer = setTimeout(function() { _degradedRetryTimer = null; generateAll(); }, 3000);
      } else {
        console.log('[Lead Pro] Gemini degraded after 2 retries — stopping');
        var retryStatusEl2 = document.getElementById('crm-status') || document.querySelector('.crm-status');
        if (retryStatusEl2) {
          retryStatusEl2.className = 'crm-status error';
          retryStatusEl2.textContent = 'Gemini unavailable — try again in a moment';
        }
        _grabRetryCount = 0;
      }
      return;
    }

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

    // Switch to SMS tab and update word count
    switchTab('sms');

  } catch(e) {
    showError('Network error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('.btn-label').textContent = '✦ Generate SMS · Email';
  }
}

async function generateVoicemail() {
  if (!lastScrapedData) { showError('Grab a lead first.'); return; }

  const vmBtn = document.getElementById('btnVoicemail');
  if (vmBtn) { vmBtn.disabled = true; vmBtn.textContent = 'Generating…'; }

  // Clear voicemail field
  const vmField = document.getElementById('output-vm');
  if (vmField) { vmField.value = ''; vmField.classList.add('generating'); }
  const vmTab = document.querySelector('.tab-btn.vm');
  if (vmTab) vmTab.classList.remove('ready-vm');

  try {
    // Build a lightweight voicemail-only payload
    const sc = classifyScenario(lastScrapedData);
    const userPrompt = buildUserPrompt(lastScrapedData, sc);

    const vmSystemPrompt = buildSystemPromptVoicemailOnly();

    const endpoint = getEndpoint();
    const payload = {
      system_instruction: { parts: [{ text: vmSystemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature:      0.5,
        maxOutputTokens:  600,
        topP:             0.9,
        responseMimeType: 'application/json',
      }
    };

    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (data.error) { showError('Voicemail error: ' + data.error.message); return; }
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      showError('No voicemail returned — try again.'); return;
    }

    const rawText = data.candidates[0].content.parts[0].text.trim();
    let vmText = '';
    try {
      const parsed = JSON.parse(rawText.replace(/^```json\s*/i,'').replace(/\s*```\s*$/,'').trim());
      vmText = parsed.voicemail || parsed.vm || parsed.message || rawText;
    } catch(e) {
      // If not JSON, use raw text
      vmText = rawText;
    }

    if (vmField) { vmField.value = vmText; vmField.classList.remove('generating'); }
    if (vmText && vmTab) vmTab.classList.add('ready-vm');
    switchTab('vm');

  } catch(e) {
    if (vmField) { vmField.classList.remove('generating'); }
    showError('Voicemail error: ' + e.message);
  } finally {
    if (vmBtn) { vmBtn.disabled = false; vmBtn.textContent = '📞 Generate Voicemail'; }
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
document.getElementById('btnGrab').addEventListener('click', function() { _grabRetryCount = 0; grabLead(); });
var _btnGenerate = document.getElementById('btnGenerate');
_btnGenerate.addEventListener('click', generateAll);
const btnVm = document.getElementById('btnVoicemail');
if (btnVm) btnVm.addEventListener('click', generateVoicemail);

// Listen for content.js DOM updates — fires when notes change in the CRM
// This catches cases where executeScript callback misses due to channel timeout
var _lpMsgListener = function(msg) {
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
};
chrome.runtime.onMessage.addListener(_lpMsgListener);
window.addEventListener('beforeunload', function() { chrome.runtime.onMessage.removeListener(_lpMsgListener); lastScrapedData = null; _lpTimerIds.forEach(function(id) { clearTimeout(id); }); _lpTimerIds = []; });;

window.addEventListener('load', function() {
  console.log('[Lead Pro] v9.0.7 loaded');

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
  console.log('[Lead Pro] v9.0.7 loaded -- manifest 9.07');
});
