// ─────────────────────────────────────────────────────────────────
// Lead Pro -- popup.js  v9.7.120
// Calls the Cloudflare Worker (LEADPRO_PROXY_URL in config.js) which
// runs a sequential cascade across OpenAI models (gpt-5.4-mini → gpt-5.4-nano
// → gpt-4.1-nano). The worker normalises responses to a Gemini-shaped
// envelope so this client doesn't have to know which model answered.
// ─────────────────────────────────────────────────────────────────

// ── Config validation ─────────────────────────────────────────────
// config.js must define:
//   const LEADPRO_PROXY_URL = "https://leadpro-proxy.gilsguzman.workers.dev";
function getEndpoint() {
  if (typeof LEADPRO_PROXY_URL !== 'undefined' && LEADPRO_PROXY_URL && !LEADPRO_PROXY_URL.includes('YOUR_PROXY')) {
    return { type: 'proxy', url: LEADPRO_PROXY_URL };
  }
  return null;
}

// ── State ─────────────────────────────────────────────────────────
const REQUIRED_SCRAPER = 'v9.7.51'; // ← bump when content.js scraperVersion bumps
// ── REQUIRED_SCRAPER — must match scraperVersion in content.js ───────────
// When content.js scraper logic changes, bump scraperVersion there AND here.
// This check rejects any cached storage data written by older scraper
// versions, forcing a clean re-scrape and preventing poisoned context.

// ── STORE HOURS — fleet-wide constants for Community Auto Group ──────────
// Keyed by crmDealerId. Used by the TIME AWARENESS block to prevent the
// model from accepting/offering appointments outside open hours or on
// closed days. The Jenny Fortenberry case (May 7) exposed the gap when
// the customer offered Saturday OR Sunday — model had no source of truth
// for which days the store was open. This table fills that gap.
//
// To add a new rooftop: add a new entry keyed by crmDealerId.
// To change hours: edit here, no other code changes needed.
const STORE_HOURS = {
  '6189':  { name: 'Toyota Baytown',    weekday: '9 AM - 8 PM', saturday: '9 AM - 8 PM', sunday: 'CLOSED' },
  '6191':  { name: 'Honda Baytown',     weekday: '9 AM - 8 PM', saturday: '9 AM - 8 PM', sunday: 'CLOSED' },
  '6190':  { name: 'Kia Baytown',       weekday: '9 AM - 8 PM', saturday: '9 AM - 8 PM', sunday: 'CLOSED' },
  '24399': { name: 'Honda Lafayette',   weekday: '9 AM - 7 PM', saturday: '9 AM - 7 PM', sunday: 'CLOSED' },
  '21135': { name: 'Audi Lafayette',    weekday: '9 AM - 7 PM', saturday: '9 AM - 6 PM', sunday: 'CLOSED' },
};

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

// (v9.7.81) Inverse lookup — store name back to dealerId. Used by the
// frame-merge fallback when dealerId is unresolved but a store name can be
// inferred from pageSnippet (typical for Thirdparty Honda leads on stale
// SPA frames where the vindebug DOM marker hasn't hydrated).
const STORE_TO_DEALER_ID = {
  'Community Toyota Baytown':   '6189',
  'Community Kia Baytown':      '6190',
  'Community Honda Baytown':    '6191',
  'Community Honda Lafayette':  '24399',
  'Audi Lafayette':             '21135'
};

// ── Store resolver ────────────────────────────────────────────────
function resolveStore(text) {
  const t = (text || '').toLowerCase();
  // (v9.7.81) Anchored brand+location checks first. The Audi check is the
  // STRICTEST because Audi appears far more often as a trade-in vehicle
  // than as a store assignment. Honda/Kia/Toyota are safer to anchor on
  // co-occurrence (Honda Lafayette stores naturally repeat "Honda" and
  // "Lafayette" in proximity), but Audi gets adjacency-only matching:
  //   "audi lafayette" as adjacent words, OR
  //   "audi" appearing alongside the "#211" dealer-code prefix.
  //
  // Selah Johnson / Amya Green case (May 11): Honda Lafayette leads with
  // Audi trade-ins were being routed to Audi Lafayette because the old
  // unanchored "t.includes('audi')" check matched. The first attempted
  // fix (requiring 'audi' AND 'lafayette' to co-occur) still failed
  // because both words appear in the page body — Lafayette as the store,
  // Audi as the trade-in. Adjacency is what actually distinguishes them.
  if (/audi\s+lafayette/.test(t) || (t.includes('audi') && t.includes('#211'))) return 'Audi Lafayette';
  if (t.includes('honda') && (t.includes('lafayette') || t.includes('lafa') || t.includes('#243'))) return 'Community Honda Lafayette';
  if (t.includes('honda') && (t.includes('baytown')   || t.includes('#619') || t.includes('#618'))) return 'Community Honda Baytown';
  if (t.includes('kia')   && (t.includes('baytown')   || t.includes('#619') || t.includes('#618'))) return 'Community Kia Baytown';
  if (t.includes('toyota')&& (t.includes('baytown')   || t.includes('#619') || t.includes('#618'))) return 'Community Toyota Baytown';
  // Generic brand fallbacks — only used when no location context AT ALL.
  // Audi is intentionally NOT here: there is only one Audi rooftop, but
  // routing to it on a bare "audi" substring is the bug this fix prevents.
  if (t.includes('honda'))  return 'Community Honda Baytown';
  if (t.includes('kia'))    return 'Community Kia Baytown';
  if (t.includes('toyota')) return 'Community Toyota Baytown';
  return '';
}

// ── Cached DOM references ─────────────────────────────────────────
// Queried once at startup; all functions reference these instead of re-querying
const _domStoreBadge  = document.getElementById('storeBadge');
const _domCrmStatus   = document.getElementById('crmStatus');
const _domStatusDot   = document.getElementById('statusDot');
const _domWordCount   = document.getElementById('wordCount');
const _tabBtns        = Array.from(document.querySelectorAll('.tab-btn'));
const _tabPanes       = Array.from(document.querySelectorAll('.tab-pane'));
const _tabBtnMap      = Object.fromEntries(_tabBtns.map(b => [b.dataset.tab, b]));
const _tabPaneMap     = Object.fromEntries(_tabPanes.map(p => [p.id.replace('pane-', ''), p]));
const _flagToggleBtns = Array.from(document.querySelectorAll('.flag-toggle'));

function setStore(name) {
  if (!name) return;
  selectedStore = name;
  _domStoreBadge.textContent = name;
  _domStoreBadge.classList.add('detected');
}

// ── Tab switching ─────────────────────────────────────────────────
function switchTab(tabKey) {
  _tabBtns.forEach(function(b) { b.classList.remove('active'); });
  _tabPanes.forEach(function(p) { p.classList.remove('active'); });
  const btn  = _tabBtnMap[tabKey];
  const pane = _tabPaneMap[tabKey];
  if (btn)  btn.classList.add('active');
  if (pane) pane.classList.add('active');
  updateWordCount(tabKey);
}

_tabBtns.forEach(function(btn) {
  btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
});

// ── Word count for active tab ─────────────────────────────────────
function updateWordCount(tabKey) {
  const key = typeof tabKey === 'string' ? tabKey : (_tabBtns.find(b => b.classList.contains('active')) || {dataset:{tab:'sms'}}).dataset.tab;
  const field = document.getElementById('output-' + key);
  if (!field || !field.value.trim()) { _domWordCount.textContent = '—'; return; }
  const words = field.value.trim().split(/\s+/).filter(Boolean).length;
  _domWordCount.textContent = words + ' words · ' + field.value.length + ' chars';
}

// ── Copy button feedback helper ───────────────────────────────────
function _markCopied(btn) {
  btn.textContent = 'Copied!'; btn.classList.add('copied');
  _lpTimerIds.push(setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800));
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
          _markCopied(btn);
        }).catch(function() {
          navigator.clipboard.writeText(rawText).then(function() { _markCopied(btn); });
        });
      } else {
        var el = document.createElement('div');
        el.innerHTML = htmlContent;
        el.style.position = 'fixed'; el.style.opacity = '0'; el.style.pointerEvents = 'none';
        document.body.appendChild(el);
        var sel = window.getSelection(); var range = document.createRange();
        range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('copy'); sel.removeAllRanges(); document.body.removeChild(el);
        _markCopied(btn);
      }
      return;
    }

    navigator.clipboard.writeText(field.value).then(function() {
      _markCopied(btn);
    }).catch(function() {
      btn.textContent = 'Try again';
      setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
    });
  });
});

// ── Populate form from scraped data ──────────────────────────────
function populateFromData(d) {
  let filled = 0;
  let _populateOrder = 0;
  console.log('[Lead Pro] populateFromData — notes:', d.totalNoteCount, '| brief:', d.conversationBrief ? d.conversationBrief.substring(0,100) : 'NONE', '| convState:', d.convState);

  // CROSS-LEAD CONTAMINATION GUARD (v9.7.45):
  // When a new lead is grabbed, reset selectedStore so we don't carry over
  // the previous lead's store when this lead's store detection fails.
  // populateFromData fires multiple times per Grab (initial + rescue success),
  // so only reset when the active lead has actually changed.
  //
  // (v9.7.51) Also clear the visible input fields. fill() at line 197 has an
  // early return when value is empty, which means stale text from the previous
  // lead's render stays in the form even after Lead Pro detects a lead change.
  // Patricia's fast lead-switching exposed this: panel showed "Shirley Lowery"
  // (correctly populated by Rescue) alongside "2021 Kia Forte" (stale from a
  // prior lead's render). Clear the slate so the form cannot lie about the
  // active lead's data.
  var _activeLeadIdNow = (d && d.autoLeadId) || window._activeLeadId || '';
  if (_activeLeadIdNow && _activeLeadIdNow !== window._lastPopulatedLeadId) {
    if (window._lastPopulatedLeadId) {
      // This is a DIFFERENT lead from the last one — clear stale store
      console.log('[Lead Pro] Lead changed (' + window._lastPopulatedLeadId + ' -> ' + _activeLeadIdNow + ') — resetting store + form fields');
      selectedStore = '';
      if (_domStoreBadge) {
        _domStoreBadge.textContent = 'Detecting store...';
        _domStoreBadge.classList.remove('detected');
      }
      // Clear visible form fields so a partial new-lead scrape cannot render
      // alongside leftover text from the previous lead's render.
      var _fieldsToClear = ['custName', 'agentName', 'vehicle', 'leadSource'];
      for (var _fi = 0; _fi < _fieldsToClear.length; _fi++) {
        var _fEl = document.getElementById(_fieldsToClear[_fi]);
        if (_fEl) {
          _fEl.value = '';
          _fEl.classList.remove('populated', 'just-populated');
        }
      }
    }
    window._lastPopulatedLeadId = _activeLeadIdNow;
  }

  function fill(id, value) {
    if (!value) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value; el.classList.add('populated'); filled++;
    // Subtle stagger — 60ms between fields. Same data, feels like the system read it.
    var _delay = _populateOrder++ * 60;
    setTimeout(function() {
      el.classList.add('just-populated');
      setTimeout(function() { el.classList.remove('just-populated'); }, 360);
    }, _delay);
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
    extras.push('Tone: celebratory, warm, genuine. No appointment offer. No vehicle pitch.');

  // Showroom visit
  } else if (d.isShowroomFollowUp) {
    extras.push('🏪 SHOWROOM STAGE: Customer has already visited the dealership. Post-visit follow-up only.');
    extras.push('IMPORTANT: The BD Agent did NOT meet the customer in person — the Sales Rep did. Do not write "it was great meeting you." Instead reference the visit indirectly: "I heard you stopped by" or "I wanted to follow up on your visit with [Sales Rep name if known]."');
    extras.push('No first-touch language. Frame return visit as finalizing, not starting.');
    if (d.showroomDetails) extras.push('Visit notes: ' + d.showroomDetails);
  }

  // Appointment timeline — raw facts only, model reads the arc and decides what it means
  if (d.apptTimeline && d.apptTimeline.length) {
    extras.push('');
    extras.push('📅 APPOINTMENT HISTORY (read the arc — do not assume the current state):');
    d.apptTimeline.forEach(function(line) { extras.push(line); });
    extras.push('Read these facts and decide what they mean for the current conversation. Do not apply a fixed rule — use judgment.');
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
  if (d.color &&  d.noSpecificVehicle) vehicleExtras.push('Color: ' + d.color + ' (expressed interest — specific unit not confirmed)');
  if (d.stockNum) vehicleExtras.push('Stock #: ' + d.stockNum + ' ← confirmed in stock. Reference this specific vehicle.');
  if (d.vin && !d.stockNum) vehicleExtras.push('VIN: ' + d.vin + ' (in transit — do not say "in stock")');
  // VIN is not injected when stockNum is present — stock number is sufficient for customer messaging
  if (d.noSpecificVehicle && !d.stockNum && !d.vin && !stageActive) vehicleExtras.push('⚠ No stock number or VIN — do not claim availability. Reference the model and ask a qualifying question.');
  // Only warn about no vehicle if notes don't mention one either
  // IMPORTANT: only check the current lead context (above the marker), not old 2022 history
  var ctxForVehicleCheck = d.context || '';
  var markerInCtx = ctxForVehicleCheck.indexOf('=== CURRENT LEAD SUBMITTED HERE ===');
  if (markerInCtx > 0) ctxForVehicleCheck = ctxForVehicleCheck.substring(0, markerInCtx);
  var contextMentionsVehicle = /\b(pilot|odyssey|civic|accord|cr-v|crv|hr-v|hrv|ridgeline|passport|highlander|camry|corolla|rav4|tacoma|tundra|sequoia|4runner|venza|sienna|k5|sportage|telluride|sorento|seltos|carnival|stinger|ev6|niro|q3|q5|q7|q8|a3|a4|a5|a6|a7|a8|e-tron|etron|silverado|f-150|f150|ram|explorer|bronco|mustang|equinox|traverse|tahoe|suburban|yukon|escalade|chevy|chevrolet|ford|gmc|dodge|jeep|nissan|altima|rogue|pathfinder|armada|frontier|hyundai|santa fe|tucson|elantra|ioniq|palisade|genesis)\b/i.test(ctxForVehicleCheck);
  // Seller-intent detection — customer appears to be selling, not buying
  var sellerIntent = /i might have.*buyer|have.*buyer for you|looking to sell|want to sell|selling my|sell.*vehicle|sell.*car|sell.*truck/i.test(ctxForVehicleCheck);
  if (d.noVehicleAtAll && !d.vehicle && !stageActive && !contextMentionsVehicle) {
    vehicleExtras.push('⚠ No vehicle on lead — read the notes and transcript first. Write about any vehicle mentioned there. Ask a qualifying question only if no vehicle appears anywhere.');
  }
  if (sellerIntent) {
    vehicleExtras.push('⚠ Customer may be looking to SELL, not buy — read the lead note carefully before writing.');
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

  // VIN only, no stock — not confirmed on lot, hold appointment offer
  if (!d.stockNum && d.vin && !d.isInTransit && !d.inventoryWarning && !d.vehiclePendingSale) {
    vehicleExtras.push('⚠ VIN on file but no stock number — lot presence not confirmed. Do not offer appointment times. Acknowledge inquiry, ask one qualifying question, commit to verify and follow up.');
  }

  if (d.ownedVehicle) vehicleExtras.push('Customer\'s current vehicle (confirmed from service/sales history): ' + d.ownedVehicle
    + (d.ownedMileage ? ' | Mileage: ' + parseInt(d.ownedMileage).toLocaleString() : '')
    + (d.lastServiceDate ? ' | Last serviced: ' + d.lastServiceDate : '')
    + (d.vehicle ? ' — This is their CURRENT vehicle, not what they want to buy. Do NOT use it as the vehicle of interest.' :
       ' — No vehicle of interest is confirmed. You may reference this as a potential trade-in or upgrade hook, but only if the customer has not named a specific vehicle they want.')
    + (d.lastServiceDate && /\/(1[0-9]|20)\b/.test(d.lastServiceDate) ? ' NOTE: Last service was several years ago — customer may have already changed vehicles. Reference cautiously.' : ''));
  if (d.ampEmailSubject) vehicleExtras.push('AMP marketing email subject sent to customer: "' + d.ampEmailSubject + '" — use this to understand the campaign angle (e.g. high-mileage upgrade, new model launch) and tie it to their current vehicle. Do NOT quote the subject directly.');
  // Sold vehicle: always inject, but when appointment is set, use do-not-disclose framing
  if (d.vehiclePendingSale) {
    vehicleExtras.push('⚠ VEHICLE STATUS: may be in the process of being sold — do not confirm available, do not say sold. Create urgency to come in today.');
  } else if (d.inventoryWarning) {
    if (d.hasApptSet) {
      vehicleExtras.push('⚠ VEHICLE STATUS: no longer in active inventory — do not disclose. Keep appointment confirmation neutral. Handle vehicle conversation in person.');
    } else if (!stageActive) {
      vehicleExtras.push('🔴 VEHICLE STATUS: SOLD — pivot to comparable options.');
    }
  }
  if (d.isInTransit && !stageActive) {
    vehicleExtras.push('🚛 VEHICLE STATUS: IN TRANSIT — VIN allocated and confirmed inbound via Toyota, not yet on the lot. Speak to it concretely. Do NOT say "we have it here." DO create urgency to lock it before arrival — this is a strong selling moment.');
  }
  // Only inject manager if it looks like an actual name (2 words, no special chars)
  var managerClean = (d.manager && d.manager !== 'None') ? d.manager.trim() : '';
  if (managerClean && /^[A-Za-z]+ [A-Za-z]+/.test(managerClean) && managerClean.length < 50) {
    vehicleExtras.push('Manager: ' + managerClean);
  }
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
  if (noCustomerPhone && !d.contactRecoveryPhone) vehicleExtras.push('📵 NO CUSTOMER PHONE NUMBER — SMS and voicemail are not viable. Email is the only channel. Ask for a phone number to connect directly.');
  if (d.customerSaidNotToday && !d.customerScheduleConstraint) vehicleExtras.push('🚫 NOT TODAY: Customer explicitly said they cannot or do not want to come in right now. Do NOT offer appointment times — not today, not tomorrow, not any day. Acknowledge their situation warmly and leave the door open. Let them reach back out when they are ready. Do not ask what day works better.');
  if (d.customerSaidNotToday && d.customerScheduleConstraint) vehicleExtras.push('🚫 NOT TODAY: Customer said today does not work.');
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
      } else if(d.customerScheduleConstraint.indexOf('CUSTOMER SPECIFIED DAY:') === 0) {
        var dayLine = d.customerScheduleConstraint.replace('CUSTOMER SPECIFIED DAY: ','');
        vehicleExtras.push('📅 CUSTOMER NAMED A SPECIFIC DAY — THIS IS A HARD CONSTRAINT:');
        vehicleExtras.push('- ' + dayLine);
        vehicleExtras.push('- Do NOT offer today. Do NOT offer any other day.');
        vehicleExtras.push('- Do NOT add "or if you want to come sooner." That is a critical failure.');
        vehicleExtras.push('- Your ONLY close is two times on the day the customer named. Nothing else.');
      } else {
        vehicleExtras.push('SCHEDULE NOTE: Customer mentioned an availability constraint in the conversation: "' + d.customerScheduleConstraint + '". Read it carefully and propose times that respect what they said, or ask them to pick a time that works.');
      }
    }
  }
  // Hard block: customer replied R — explicit reschedule
  if (d.customerRepliedReschedule) {
    vehicleExtras.push('');
    vehicleExtras.push('🔄 RESCHEDULE REQUESTED: The customer replied "R" to your message that said "Reply C to confirm or R to reschedule." R means RESCHEDULE. The appointment is NOT confirmed. DO NOT say "see you tomorrow" or "you are all set." Acknowledge the reschedule and offer two NEW time options.');
  }

  // Appointment state is surfaced via apptTimeline — model reads the arc directly

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

  // Override contactRecoveryPhone with multi-signal evidence — the scraper's
  // structured phone extraction can miss phones that ARE present due to
  // panel rendering quirks. Clear the flag if ANY of these prove the customer
  // has a phone:
  //   1. d.phone was scraped successfully
  //   2. The conversation context contains "Received from: (XXX) XXX-XXXX"
  //      headers — these always include the customer's phone on text/call notes
  //   3. The lead has SMS history (inbound or outbound text) — proves a phone
  //      exists and is reachable
  //   4. The full context (not just first 2000 chars) contains a phone-pattern
  //      match — catches phones the scraper missed

  // Capture initial state BEFORE any overrides for diagnostic logging
  var _phoneDiag = {
    initialFlag: d.contactRecoveryPhone,
    scrapedPhone: d.phone || '(empty)',
    scrapedPhoneDigits: d.phone ? d.phone.replace(/\D/g,'').length : 0,
    contextLen: (d.context || '').length,
    contextSample: (d.context || '').substring(0, 400).replace(/\n/g, ' | '),
    leadId: d._activeLeadId || d.leadId || '(unknown)',
    customerName: d.name || '(unknown)',
    overrideFired: 'none',
    overrideReason: ''
  };

  if (d.phone && d.phone.replace(/\D/g,'').length >= 7) {
    d.contactRecoveryPhone = false;
    _phoneDiag.overrideFired = 'scrapedPhone';
    _phoneDiag.overrideReason = 'd.phone has ' + _phoneDiag.scrapedPhoneDigits + ' digits';
  }

  if (d.contactRecoveryPhone) {
    var _ctxForPhone = d.context || '';
    // (v9.7.81) ALSO scan d.pageSnippet — the customer info panel phone
    // ("Cell: (504) 407-6104") sits in the buyer-info section of the page,
    // not in the conversation transcript. If we ONLY scan d.context, leads
    // with a customer phone on file but no SMS/call history (typical for
    // brand-new first-touch leads) fail all three evidence checks and we
    // tell the model to ask for a phone Lead Pro already has.
    //
    // Selah Johnson + Amya Green case (May 11): both were first-touch
    // leads with phones on the customer card, no text history, no call
    // notes with phone-header format. Three evidence checks all failed
    // against d.context, so contactRecoveryPhone stayed true and the
    // generated SMS asked "what's the best number to reach you on?" —
    // visible directly above the customer's phone number.
    var _bodyForPhone = d.pageSnippet || '';
    var _combinedForPhone = _ctxForPhone + '\n' + _bodyForPhone;
    // "Received from: (XXX) XXX-XXXX" or "Sent to: (XXX) XXX-XXXX" prove a phone exists
    var _phoneInCtx = /(?:Received from|Sent to|Cell|Home|Work|Mobile|Eve)[:\s]+\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/i.test(_combinedForPhone);
    // Any text-message activity proves a phone is on file
    var _hasSmsHistory = /Inbound Text Message|Outbound Text Message/i.test(_combinedForPhone);
    // Generic phone-pattern match anywhere in the full conversation text or page body
    var _hasPhonePattern = /\(\d{3}\)\s*\d{3}[\s-]\d{4}|\d{3}[\s-]\d{3}[\s-]\d{4}/.test(_combinedForPhone);

    _phoneDiag.headerMatch = _phoneInCtx;
    _phoneDiag.smsHistory = _hasSmsHistory;
    _phoneDiag.patternMatch = _hasPhonePattern;
    _phoneDiag.snippetLen = _bodyForPhone.length;

    if (_phoneInCtx || _hasSmsHistory || _hasPhonePattern) {
      d.contactRecoveryPhone = false;
      _phoneDiag.overrideFired = 'contextEvidence';
      _phoneDiag.overrideReason = 'sms:' + _hasSmsHistory + ', header:' + _phoneInCtx + ', pattern:' + _hasPhonePattern;
    }
  }

  _phoneDiag.finalFlag = d.contactRecoveryPhone;

  // Always log the diagnostic, regardless of outcome — if a phone-asking message
  // slips through, this single line tells us why. Look for `[LP PHONE DIAG]`
  // in the console to find the decision trace for any specific lead.
  console.log('[LP PHONE DIAG]', _phoneDiag);
  if (_phoneDiag.finalFlag === true) {
    // (v9.7.81) Distinguish expected-no-phone lead sources from scraper misses.
    // AI Buying Signals leads are inferred-intent (third-party browsing data) —
    // they have no phone by design. Asking for it is correct. Flagging it as a
    // "scrape missed it" is misleading and noisy.
    var _isAILeadSrc = /ai\s*buying\s*signal/i.test(d.leadSource || '');
    if (_isAILeadSrc) {
      console.log('[LP PHONE DIAG] contactRecoveryPhone TRUE -- expected for AI Buying Signals lead source (no phone by design). Asking for phone is correct.');
    } else {
      console.log('[LP PHONE DIAG] contactRecoveryPhone REMAINS TRUE -- message will ask for a phone number. If a phone IS visible on the lead, the scrape and patterns missed it. Inspect contextSample above and consider extending the evidence patterns.');
    }
  }
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
  if (d.isRecentOutbound && !d.isLiveConversation) vehicleExtras.push('📤 RECENT OUTBOUND: Agent sent a message within the last hour. Maintain conversational continuity with that thread — IF the prior content is compatible with current ground truth (verified inventory, customer-stated availability, store hours, internal notes). If the prior outbound conflicts with what is actually possible (e.g. offered times for a vehicle without confirmed stock, accepted a closed-day appointment, promised availability that contradicts an internal note), apply the WHEN PRIOR OUTBOUND CONFLICTS WITH GROUND TRUTH guidance from your system prompt — pivot warmly toward what IS possible without throwing the prior message under the bus. Prior message: "' + (d.recentOutboundContent||'').substring(0,200) + '"');
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
    ? (ls.includes('afs') || ls.includes('kmf') || ls.includes('maturity') || ls.includes('lease end') || ls.includes('luv') || ls.includes('kfa'))
    : (ls.includes('afs') || ls.includes('kmf') || ls.includes('maturity') || ls.includes('lease end') || ls.includes('luv') || ls.includes('kfa'))
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
  if (!activeFlags.has("price_gate") && d.lastInboundMsg && d.lastInboundMsg.length > 10) {
    var priceObjection = /out.the.door|otd price|couldn.t reach.*agreement|price.*too high|too expensive|over.*budget|numbers.*not.*work|not.*work.*numbers|best.*price|lower.*price|better.*price|can.*do.*better|come down|negotiate|counter offer|upside down|negative equity|owe more than.*worth|underwater.*loan/i.test(d.lastInboundMsg);
    if(priceObjection) toggleFlag("price_gate", true);
  }

  // Scan Gubagoo/chat lead data for credit signals
  if (!activeFlags.has("credit") && (ls.includes("chat") || ls.includes("gubagoo")) && d.context) {
    var chatCtx = d.context.toLowerCase().substring(0, 8000);
    if (/\brepo\b|\brepos\b|repossession|bankruptcy|bad credit|no credit|credit.*challenge|been denied|credit score|collections|low credit/i.test(chatCtx)) toggleFlag("credit", true);
  }

  // Auto-detect Distance Buyer — scraper computed isDistanceBuyer based on zip/state distance from store
  // Suppress for showroom-followup leads (customer already came in) and for Audi (luxury concierge handles distance differently)
  if (d.isDistanceBuyer && !d.hasShowroomVisit && !/audi/i.test(detectedStore || d.store || '')) {
    toggleFlag('distance', true);
  }
  // Also detect distance from customer's own words even if zip/state didn't trigger
  if (!activeFlags.has('distance') && d.lastInboundMsg && /(\d+)\s*(?:hours?|hr)\s*(?:away|drive|from)|out of state|out.of.state|live in.+(?:from|away)|(?:two|three|four|2|3|4)\s*hours?\s*(?:away|drive)/i.test(d.lastInboundMsg)) {
    toggleFlag('distance', true);
  }
  // Also fire if scraper detected mentioned-distance signals (e.g. customer said "I am 2 hours away")
  if (!activeFlags.has('distance') && d.context) {
    var distanceCtxScan = d.context.substring(0, 4000);
    if (/customer.+(\d+)\s*(?:hours?|hr)\s*(?:away|drive)|(?:driving|coming).+(\d+)\s*(?:hours?|hr)/i.test(distanceCtxScan) && !/already (?:visited|came|stopped)/i.test(distanceCtxScan)) {
      toggleFlag('distance', true);
    }
  }

  // Auto-detect Stalled state — leverages the existing stalled check at line 395-397
  // (which already calls toggleFlag('stalled', true) when convState='stalled' or _isStalled is set)
  // Add a fallback: if scraper flagged stalled from CRM ("Stalled Lead") but the conv state didn't pick it up
  if (!activeFlags.has('stalled') && d.context && /stalled lead|days since last contact|long-term follow.?up needed/i.test(d.context.substring(0, 2000))) {
    toggleFlag('stalled', true);
  }

  // Enable generate button once we have something
  const canGenerate = !!(d.name && (d.agent || d.salesRep) && (d.vehicle || detectedStore || d.leadSource || d.totalNoteCount > 0));
  _btnGenerate.disabled = !canGenerate;
  const vmBtnEl = document.getElementById('btnVoicemail');
  if (vmBtnEl) vmBtnEl.disabled = !canGenerate;

  // Update persona bar
  if (canGenerate && typeof LEADPRO_AUTH !== 'undefined' && typeof updatePersonaBar === 'function') {
    requestAnimationFrame(function() { updatePersonaBar(d); });
  }

  return filled;
}

// ── Flags ─────────────────────────────────────────────────────────
function _updateFlagCountBadge() {
  var badge = document.getElementById('lp-flag-count-badge');
  if (!badge) return;
  var n = activeFlags.size;
  if (n >= 2) {
    badge.textContent = n + ' active';
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}
// Build lookup map from _flagToggleBtns (cached at startup above)
const _flagBtnMap = Object.fromEntries(_flagToggleBtns.map(b => [b.dataset.flag, b]));

function toggleFlag(key, forceOn) {
  const btn = _flagBtnMap[key];
  if (!btn) return;
  if (forceOn === true || !activeFlags.has(key)) {
    activeFlags.add(key); btn.classList.add('on');
  } else {
    activeFlags.delete(key); btn.classList.remove('on');
  }
  _updateFlagCountBadge();
}
_flagToggleBtns.forEach(function(b) {
  b.addEventListener('click', function() {
    toggleFlag(b.dataset.flag);
    // Re-enable generate if we have data
    const hasData = !!(document.getElementById('custName').value || document.getElementById('vehicle').value || selectedStore);
    _btnGenerate.disabled = !hasData;
  });
});

// ── Manual fill: BD Agent + Customer Name inputs patch lastScrapedData ─────
// When the scraper fails to capture identity (e.g. on Cox's React variants where
// BD Agent renders too late or in an unreachable virtual DOM), the agent can fill
// the fields manually and Generate enables. Without these listeners, typing into
// these fields was display-only and never updated the underlying data the gate
// checks against.
function _wireManualFillField(fieldId, dataKey) {
  var el = document.getElementById(fieldId);
  if (!el) return;
  el.addEventListener('input', function() {
    var val = (el.value || '').trim();
    if (!lastScrapedData) lastScrapedData = {};
    lastScrapedData[dataKey] = val;
    // (v9.7.46) Removed storage mirror — auto-populate-on-open path is gone.
    // Re-evaluate generate eligibility — same rule populateFromData uses
    var d = lastScrapedData;
    var canGen = !!(d.name && (d.agent || d.salesRep) && (d.vehicle || selectedStore || d.leadSource || d.totalNoteCount > 0));
    _btnGenerate.disabled = !canGen;
    var vmBtnEl = document.getElementById('btnVoicemail');
    if (vmBtnEl) vmBtnEl.disabled = !canGen;
    // If generate is now enabled and persona bar exists, refresh it so the
    // dropdown reflects the data we have
    if (canGen && typeof updatePersonaBar === 'function') {
      requestAnimationFrame(function() { updatePersonaBar(d); });
    }
  });
}
_wireManualFillField('custName',  'name');
_wireManualFillField('agentName', 'agent');
_wireManualFillField('vehicle',   'vehicle');

// ── Clear ─────────────────────────────────────────────────────────
function clearFields() {
  // (v9.7.46) Simplified — frames don't auto-write storage anymore so
  // clearFields can just hard-clear everything. Same path for Clear button
  // and Grab Lead.
  //
  // (v9.7.82) FULL RESET ON EVERY GRAB. Adds explicit clearing of the
  // escalation cache, resolved-context, and last-populated-lead tracker.
  // Prior behavior left these in place between grabs, causing cross-lead
  // contamination when the SPA navigation race left stale data attached
  // to the DOM. The Kaylee-specific Audi Lafayette cross-store bleed was a
  // direct symptom: previous lead's resolved context could survive a grab
  // and override the freshly-scraped dealerId. Now every grab starts from
  // a truly clean slate. Agent identity = profile (signature phone OK).
  // Lead identity = vindebug (dealerId is authoritative). The two never
  // fall back to each other for the OTHER's domain.
  _grabStartTime = Date.now();
  window._activeLeadId = '';
  // (v9.7.82) Clear persistent caches that previously survived across grabs.
  window._leadProEscalationCache = null;
  window._leadProResolvedContext = null;
  window._lastPopulatedLeadId = '';
  chrome.storage.local.remove(['leadpro_data'], function() {});
  lastScrapedData = null;
  ['custName','agentName','vehicle','leadSource'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('populated'); }
  });
  ['sms','email'].forEach(function(k) {
    const f = document.getElementById('output-' + k);
    if (f) f.value = '';
    const tabBtn = _tabBtnMap[k];
    if (tabBtn) tabBtn.classList.remove('ready-' + k);
  });
  _domWordCount.textContent = '—';
  if (_domCrmStatus) { _domCrmStatus.className = 'crm-status'; _domCrmStatus.textContent = 'Open a VinSolutions lead to auto-fill.'; }
  if (_domStatusDot) _domStatusDot.classList.remove('active');
  if (_domStoreBadge) { _domStoreBadge.textContent = 'Detecting store…'; _domStoreBadge.classList.remove('detected'); }
  selectedStore = ''; leadContext = ''; leadSalesRep = ''; leadConvState = 'first-touch';
  activeFlags.clear();
  _flagToggleBtns.forEach(function(b) { b.classList.remove('on'); });
  _updateFlagCountBadge();
  // Restore empty-state overlays
  document.querySelectorAll('.output-empty-overlay').forEach(function(o) { o.classList.remove('hidden'); });
  // Hide regen strip — no output to adjust
  var regenStripEl = document.getElementById('regenStrip');
  if (regenStripEl) regenStripEl.classList.remove('visible');
  window._lpRegenDirective = '';
  _btnGenerate.disabled = true;
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
      'Return ONLY a JSON object with this exact shape: {"translation": "<the translated text>"}. The translation field must contain the full translated message including all line breaks (use \\n for line breaks within the string). Return ONLY this JSON — no markdown, no commentary, no other fields.',
      '',
      'ORIGINAL TEXT TO TRANSLATE:',
      text
    ].join('\n');
    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a professional automotive BDC translator. Translate to natural Mexican Spanish. Always return your translation wrapped in {"translation": "..."} JSON. Preserve line breaks as \\n in the JSON string.' }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 3000, responseMimeType: 'application/json' }
      })
    });
    const data = await resp.json();
    if (!data.candidates || !data.candidates[0]) return text;
    var raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    // Strip markdown code fences if present
    raw = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'').trim();
    // Parse JSON wrapper to extract the translation
    try {
      var parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        var unwrapped = parsed.translation || parsed.text || parsed.message ||
                        parsed.sms || parsed.email || parsed.voicemail ||
                        parsed.body || parsed.content || '';
        if (unwrapped) return unwrapped;
        // If error field present, surface it but return original text so user isn't left with garbage
        if (parsed.error) {
          console.warn('[Lead Pro] Translation API returned error:', parsed.error);
          return text;
        }
      }
    } catch(e) {
      // Not valid JSON — fall through and use raw text. May happen if model
      // returned plain text despite the instruction. Better than nothing.
    }
    return raw || text;
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
  const statusEl = _domCrmStatus;
  const dot      = _domStatusDot;

  clearFields();
  statusEl.className   = 'crm-status scanning';
  statusEl.textContent = 'Scanning lead…';
  if (dot) { dot.classList.remove('active'); dot.classList.add('scanning'); }

  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); }
  catch(e) { statusEl.className = 'crm-status error'; statusEl.textContent = 'Cannot access tab.'; return; }

  const isVin = tab && tab.url && (tab.url.includes('vinsolutions.com') || tab.url.includes('coxautoinc.com'));
  if (!isVin) {
    statusEl.className = 'crm-status error';
    statusEl.textContent = 'Open a VinSolutions lead first.';
    return;
  }

  // Extract the active lead ID from the tab URL — the merge logic in
  // tryExecuteScript uses this as the lead anchor.
  var activeLeadIdMatch = (tab.url || '').match(/AutoLeadID[=_]?(\d{6,12})/i)
    || (tab.url || '').match(/leadId[=_]?(\d{6,12})/i)
    || (tab.url || '').match(/\/leads\/(\d{6,12})/i);
  window._activeLeadId = activeLeadIdMatch ? activeLeadIdMatch[1] : '';

  tryExecuteScript(tab, statusEl, dot);
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
        // (v9.7.83) SCOPED TO LEAD-DETAIL CONTAINERS ONLY.
        // The original implementation walked ALL <tr> rows in the document.
        // In the top frame (VinSolutions ILM worklist), tables list all leads
        // with columns like "BD Agent / Sales Rep / Created" — and the column
        // data cells contain agent names from ALL agents in the dealership,
        // not the active lead. labelValue('BD Agent') on the top frame would
        // match a worklist row's <td>BD Agent</td><td>Givani De La Cerda</td>
        // pair and return "Givani" as the agent — a name unrelated to the
        // active lead. This was the Rolando case.
        //
        // Fix: only walk tables that are descendants of known lead-detail
        // panels (ActiveLeadPanel, LeadInfo, BuyerInfo, etc.) — the original
        // ASP.NET-rendered lead detail pane. Tables in the newer React-rendered
        // worklist UI (styled-components classes like common__StyledP-sqfzx-1)
        // are excluded because they have no ancestor matching these IDs.
        var leadDetailRoots = document.querySelectorAll(
          '[id*="ActiveLeadPanel" i], [id*="LeadInfo" i], [id*="BuyerInfo" i], ' +
          '[id*="LeadDetail" i], [id*="CustomerInfo" i], [id*="VehicleInfo" i], ' +
          '#vindebug-section-wrap'
        );
        // If we found lead-detail containers, only search within them.
        // If we didn't find any (e.g. a fresh DOM variant where IDs have shifted),
        // fall back to the OLD behavior so we don't lock agents out — but log
        // the unscoped scan so the regression is visible in diagnostics.
        var rows;
        if (leadDetailRoots.length > 0) {
          rows = [];
          for (var ldri = 0; ldri < leadDetailRoots.length; ldri++) {
            var ldrRows = leadDetailRoots[ldri].querySelectorAll('tr');
            for (var ldrj = 0; ldrj < ldrRows.length; ldrj++) rows.push(ldrRows[ldrj]);
          }
        } else {
          // No lead-detail container found in this frame — refuse to scan rather
          // than fall through to document-wide rows. The top frame fits this
          // case: no ActiveLeadPanel, no LeadInfo, no vindebug. Returning empty
          // here is correct — labelValue shouldn't supply lead-detail data from
          // a frame that doesn't have lead-detail context.
          return '';
        }
        for (var ri = 0; ri < rows.length; ri++) {
          var row = rows[ri];
          var cells = row.querySelectorAll('td');
          if (cells.length < 2) continue;
          var label = (cells[0].innerText||cells[0].textContent||'').trim();
          if (label.toLowerCase().replace(/[:\s]/g,'').includes(lbl.toLowerCase().replace(/[:\s]/g,''))) {
            var valEl = cells[1].querySelector('span') || cells[1];
            var v = (valEl.innerText||valEl.textContent||'').trim();
            if (v && v !== 'None' && v !== 'none') return v;
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
    var autoLeadId=dbgI?(dbgI.getAttribute('data-autoleadid')||''):'';
    // dealerId from vindebug OR from eccs/index.html URL parameter
    const dealerIdFromUrl=(function(){
      try{
        var u=window.location.href;
        var m=u.match(/[?&]de(?:aler(?:Id)?)?=(\d+)/i)||u.match(/[?&]dealerId=(\d+)/i);
        return m?m[1]:'';
      }catch(e){return '';}
    })();
    var dealerId=dbgI?(dbgI.getAttribute('data-dealerid')||dealerIdFromUrl):dealerIdFromUrl;
    const customerId=dbgI?(dbgI.getAttribute('data-globalcustomerid')||''):'';

    // Fallback lead ID detection when vindebug element is missing (VinSolutions DOM change)
    if(!autoLeadId){
      // Try data-autoleadid on any element
      var anyLeadEl=document.querySelector('[data-autoleadid]');
      if(anyLeadEl) autoLeadId=anyLeadEl.getAttribute('data-autoleadid')||'';
    }
    if(!autoLeadId){
      // Try URL - VinSolutions sometimes puts LeadID in the URL.
      // (v9.7.51) Decode first because nested cdQuery params hide AutoLeadID
      // behind URL-encoding (%26 for &, %3d for =).
      try {
        var rawUrl = window.location.href;
        var decUrl = '';
        try { decUrl = decodeURIComponent(rawUrl); } catch(e2) { decUrl = rawUrl; }
        var urlLeadM = decUrl.match(/[?&#](?:AutoLeadID|LeadID|lead(?:id)?|lid|autoLeadId)[=:](\d{6,12})/i);
        if(urlLeadM) autoLeadId = urlLeadM[1];
      } catch(e) {}
    }
    if(!autoLeadId){
      // Try page text - "LeadID: 2004236550" pattern appears in note footers
      var textLeadM=TEXT.match(/LeadID:\s*(\d{8,12})/i);
      if(textLeadM) autoLeadId=textLeadM[1];
    }
    if(!dealerId){
      // Try data-dealerid on any element
      var anyDealerEl=document.querySelector('[data-dealerid]');
      if(anyDealerEl) dealerId=anyDealerEl.getAttribute('data-dealerid')||'';
    }
    if(!dealerId){
      // Try page text - "DealerID: 6189" pattern appears in note footers
      var textDealerM=TEXT.match(/DealerID:\s*(\d{4,6})/i);
      if(textDealerM) dealerId=textDealerM[1];
    }
    // Lead-content heuristic: if we see populated BD Agent or Sales Rep DOM elements,
    // this IS a lead frame even without an autoLeadId. Cox/VinSolutions has been rolling
    // out DOM variants that strip the vindebug-section-wrap identity marker - without
    // this fallback, agents on the new variant would be locked out entirely.
    var hasLeadContentMarkers=false;
    if(!autoLeadId){
      var bdAgentEl=document.querySelector('[id*="BDAgent" i], [id*="AssignedBDAgent" i], [id*="CurrentAssignedBDAgent" i]');
      var salesRepEl=document.querySelector('[id*="SalesRep" i], [id*="AssignedSalesRep" i]');
      if((bdAgentEl && bdAgentEl.textContent.trim()) || (salesRepEl && salesRepEl.textContent.trim())){
        hasLeadContentMarkers=true;
      }
    }
    const isLeadFrame=!!autoLeadId || hasLeadContentMarkers;

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
      // (v9.7.119) ActiveLeadPanel BuyerName span — renders earlier than CustomerInfo
      // on slow-loading/merged-record leads. Strip honorifics ("Mr.Art" → "Art Lopez").
      // NOTE: must use document.getElementById directly — gid() returns a string, not element.
      (function(){
        var _bn = document.getElementById('ActiveLeadPanelWONotesAndHistory1__BuyerName') ||
                  document.querySelector('span[id$="__BuyerName"]') ||
                  document.querySelector('span[id*="BuyerName"]');
        if (!_bn) return '';
        var _raw = (_bn.innerText || _bn.textContent || '').replace(/\n/g,' ').trim();
        // Strip leading honorific — handles "Mr.Art" (no space) and "Mr. Art" (with space)
        _raw = _raw.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s*/i, '').trim();
        return _raw.length > 1 ? _raw : '';
      })(),
      // Buyer section fallback - "Buyer and Co-buyer Information: Buyer [Name]"
      qs('[class*="buyer-name"]'),
      qs('.buyerName'),
      // The vindebug div gives us customerId - try to find name near it
      (function(){
        // Text mine: "Customer Dashboard\nJennifer Mena-Rivera" pattern
        // Uses [A-Za-z'\-]+ to handle hyphenated surnames; [ \t] not \s to prevent
        // cross-line matching of unrelated page labels (e.g. "Created\nSource\nVehicle")
        var m = TEXT.match(/Customer\s+Dashboard[\s\S]{0,50}?\n([A-Z][A-Za-z'\-]+(?:[ \t]+[A-Z][A-Za-z'\-]+){1,3})\s*\n/);
        if(m) return m[1].trim();
        // "Buyer\n[Name]\n" — name on line immediately after Buyer keyword (two+ word names)
        m = TEXT.match(/\bBuyer\s*\n([A-Z][A-Za-z'\-]+(?:[ \t]+[A-Z][A-Za-z'\-]+){1,3})\n/);
        if(m) return m[1].trim();
        // Single first-name only leads — gate on phone label following to avoid false positives
        m = TEXT.match(/\bBuyer\s*\n([A-Z][A-Za-z'\-]{2,30})\n(?:Cell|Day|Eve|Home|Work|Mobile):/);
        if(m) return m[1].trim();
        if(m) return m[1].trim();
        // Name followed by Cell/Day/Eve/Home/Work phone label — covers all buyer section layouts
        // [ \t] not \s between words: prevents matching multi-line label sequences like
        // "Created\n\tSource\n\tVehicle\nCell:" which would otherwise be falsely captured
        m = TEXT.match(/\n([A-Z][A-Za-z'\-]+(?:[ \t]+[A-Z][A-Za-z'\-]+){1,3})\n(?:Cell|Day|Eve|Home|Work|Mobile):/);
        if(m) return m[1].trim();
        return '';
      })()
    ]);
    const emailEl=document.getElementById('customer-email-span');
    const email=emailEl?(emailEl.getAttribute('data-email')||emailEl.innerText||'').trim():'';
    let phone='';
    var _phoneCandEls=[];var _pushPCE=function(el){if(el&&_phoneCandEls.indexOf(el)===-1)_phoneCandEls.push(el);};
    _pushPCE(document.querySelector('.CustomerInfo_CustomerDetail,[id*="_CustomerDetail"]'));
    _pushPCE(document.querySelector('[id$="__BuyerInfoDetails"],[id*="_BuyerInfoDetails"]'));
    _pushPCE(document.querySelector('[id*="BuyerInfo"],[id*="Buyer_Info"]'));
    for(var _pi=0;_pi<_phoneCandEls.length&&!phone;_pi++){var _pt=_phoneCandEls[_pi].innerText||_phoneCandEls[_pi].textContent||'';var _pm=_pt.match(/(?:C|H|W|M|Cell|Home|Work|Eve|Evening)[:\s]+([\(\d][\d\(\)\-\. ]{7,18})/i);if(_pm){var _pc=_pm[1].replace(/[^\d\(\)\-\. ]/g,'').trim();if((_pc.match(/\d/g)||[]).length>=7)phone=_pc;}}
    if(!phone){var phoneM=TEXT.match(/(?:Cell|Home|Work|Mobile|Day|Eve|Evening)[:\s]+([\(\d][\d\(\)\-\. ]{7,18})/i)||TEXT.match(/\((\d{3})\)\s*(\d{3})[-\s](\d{4})/);
      if(phoneM)phone=(phoneM[0]||'').replace(/^[^\d(]+/,'').trim().substring(0,20);}
    const agent=(function(){
      var a = firstOf([
        gid('ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedBDAgentLabel'),
        gid('ActiveLeadPanel1_m_CurrentAssignedBDAgentLabel'),
        qs('[id*="CurrentAssignedBDAgent" i]'),
        qs('[id*="AssignedBDAgent" i]'),
        qs('[id*="BDAgentLabel" i]'),
        qs('[id*="BDAgent" i]'),
        qs('[data-field*="BDAgent" i]'),
        // (v9.7.83) Removed labelValue('BD') — too loose. The 'BD Agent' call
        // below is the precise match for the lead-detail table row. The bare
        // 'BD' substring matched arbitrary cells.
        labelValue('BD Agent')
      ]);
      // Reject values that look like label text rather than actual names
      var _aTrimmed = (a||'').trim();
      if (!_aTrimmed) return '';
      if (/^(status|manager|source|sales\s*rep|bd\s*agent|created|contacted|attempted|none)[:\s]/i.test(_aTrimmed)) return '';
      if (/^\w+:\s*$/.test(_aTrimmed)) return ''; // anything that's just "Word:" is a label artifact
      // Reject if DOM returned the sales rep name instead of BD agent
      // This happens when VinSolutions renders the newly-assigned sales rep in a shared field
      if(a) {
        var srFromLabel = labelValue('Sales Rep') || '';
        if(srFromLabel && a.trim() === srFromLabel.trim()) return ''; // DOM gave us sales rep - skip, use log fallback
        // If DOM returned only a single word (first name only), fall through to text-mining for full name
        if(a.trim().indexOf(' ') === -1) { /* single word - fall through */ }
        else return a;
      }
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
          // Exclude managers, system accounts, and sales reps - only BD agents should sign
          var salesRepName = (TEXT.match(/Sales Rep[:\s]+([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/)||[])[1] || '';
          var isSalesRep = salesRepName && bName === salesRepName;
          if(!isSalesRep && !/^(System|Kristen Willis|Ken Young|BJ Wilson|Jeremy Pratt|Colby Landry|Lonnie Sabbath|Damion Emholtz|Jeff Pasquale|Ever Pereira|Carlos Campbell|Jean DuPont|Bennett Johnson|Gerald Bailey|Robert Staten|Jennifer Brumbaugh|Gabrielle Jackson|Jocelyne Martinez)$/i.test(bName)) {
            return bName;
          }
        }
      }
      return '';
    })();
    console.log('[Lead Pro] agent resolved:', agent || '(empty)');
    const salesRep=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedUserLabel'),
      gid('ActiveLeadPanel1_m_CurrentAssignedUserLabel'),
      qs('[id*="CurrentAssignedUser" i]'),
      qs('[id*="AssignedUserLabel" i]'),
      qs('[id*="SalesRep" i]'),
      qs('[id*="AssignedSalesRep" i]'),
      qs('[data-field*="SalesRep" i]'),
      labelValue('Sales Rep')
    ]);
    const manager=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedManagerLabel'),
      gid('ActiveLeadPanel1_m_CurrentAssignedManagerLabel'),
      qs('[id*="CurrentAssignedManager" i]'),
      qs('[id*="AssignedManagerLabel" i]'),
      qs('[id*="ManagerLabel" i]'),
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
    let vehicleRaw=firstOf([
      gid('ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo'),
      gid('ActiveLeadPanel1_m_VehicleInfo'),
      qs('span[id*="VehicleInfo"].leadinfodetails'),
      qs('span[id*="VehicleInfo"]'),
      qs('.leadinfodetails'),
      labelValue('Vehicle Info'),
      labelValue('Vehicle'),
      // Text scan fallback - look for year+make pattern ONLY in the active lead panel
      // DO NOT scan all panels - task queue and other frames contain other leads' vehicles
      (function(){
        // Only search within the known active lead panel containers
        var activePanels = [
          document.getElementById('ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo'),
          document.getElementById('ActiveLeadPanel1_m_VehicleInfo'),
          document.querySelector('[id*="ActiveLeadPanel"]')
        ].filter(Boolean);
        for(var pi=0;pi<activePanels.length;pi++){
          var pt = (activePanels[pi].innerText||'').trim();
          var ym = pt.match(/(202[0-9]\s+[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z0-9]+[^\n]{0,40})/);
          if(ym && !/equity|calculated|trade|%2f|http|www\.|communit/i.test(ym[1])) return ym[1].trim();
        }
        return '';
      })()
    ]);
    // (v9.7.81) CANONICALIZE BEFORE STRIPPING: extract just the Year+Make+Model+Trim
    // from the first line of vehicleRaw, anchored on newline or "(New)"/"(Used)" paren.
    // This handles the multi-line VehicleInfo panel innerText cleanly. After canonicalization
    // the (Used)/(New) strip below operates on a clean single line. Brand-agnostic to
    // handle non-house-brand used inventory.
    var canonical = vehicleRaw.match(/(20[12][0-9]\s+[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z0-9\-]+(?:\s+[A-Za-z0-9\-]+){0,4})(?=\s*[(\n]|$)/);
    if (canonical && canonical[1]) {
      vehicleRaw = canonical[1].trim();
    }
    // Strip equity data if it leaked into vehicle field
    var vehicle=vehicleRaw.replace(/\s*\((New|Used|CPO|Pre-Owned|Certified)\)\s*/gi,'').trim();
    if(/^equity[:\s]/i.test(vehicle) || /\$[\d,]+.*calculated/i.test(vehicle)) vehicle = '';
    // Strip VinSolutions UI placeholder text that leaks into vehicle field
    if(/^select$/i.test(vehicle) || /^click to add/i.test(vehicle) || /^none$/i.test(vehicle) || /^vehicle of interest$/i.test(vehicle)) vehicle = '';
    // Reject vehicle strings that contain a person's name - indicates task queue bleed
    // A real vehicle field looks like "2024 Honda HR-V", not "Ramona Shepard 2024 Honda HR-V"
    if(vehicle && /^[A-Z][a-z]+ [A-Z][a-z]+\s+\d{4}/.test(vehicle)) vehicle = '';
    // If DOM scrape missed vehicle, scan page text ONLY if the VehicleInfo panel
    // actually exists in the DOM - prevents bleeding from other frames when lead has no vehicle
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
        // Only scan the VehicleInfo panel itself - not the full page body (avoids notes/URL contamination)
        // (v9.7.81) Brand-agnostic match — used inventory may be any make, not just house brands.
        var vmMatch = vehiclePanelText.match(/(20[12][0-9]\s+[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z0-9\-]+(?:\s+[A-Za-z0-9\-]+){0,3})/);
        if(vmMatch && !/equity|calculated|trade.in/i.test(vmMatch[0])) {
          vehicle = vmMatch[1].trim();
        }
      }
    }
    // If lead has no vehicle but customer's last message is a vehicle name,
    // use that as the vehicle of interest - it's a direct buying signal
    if (!vehicle && lastInboundMsg) {
      var vehicleModels = ['sequoia','tundra','tacoma','4runner','highlander','camry','corolla','rav4','sienna','venza','crown','prius',
        'telluride','sorento','sportage','seltos','carnival','k5','k4','ev6','niro','stinger',
        'pilot','odyssey','civic','accord','cr-v','passport','ridgeline','hr-v','prologue',
        'q3','q5','q7','q8','a3','a4','a5','a6','e-tron'];
      var lastMsgClean = lastInboundMsg.trim().toLowerCase().replace(/[^a-z0-9\s-]/g,'');
      for (var vmi = 0; vmi < vehicleModels.length; vmi++) {
        if (new RegExp('\\b' + vehicleModels[vmi] + '\\b').test(lastMsgClean)) {
          vehicle = vehicleModels[vmi].charAt(0).toUpperCase() + vehicleModels[vmi].slice(1);
          break;
        }
      }
    }
    const condition=/\(New\)/i.test(vehicleRaw)?'New':/Used|Pre-Owned|CPO|Certified/i.test(vehicleRaw)?'Pre-Owned':'';
    const color=tm([/Color[:\s]+([A-Za-z ]{3,25})(?:\n|Mfr|Stock|VIN|Warning|\s{3})/i]);
    // Extract customer state from buyer address - "City, ST 00000" pattern in page text
    var customerState = '';
    var stateMatch = TEXT.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
    if (stateMatch) customerState = stateMatch[1];
    const stockNumRaw = tm([/Stock\s*#?[:\s]*([A-Z]{0,4}\d{3,8}[A-Z0-9]*)\b/i]);
    // Exclude 17-char VINs that may appear under "Stock #" in the Vehicle(s) of Interest panel
    const stockNum = (stockNumRaw && stockNumRaw.length < 15) ? stockNumRaw : '';
    // VIN extraction: anchor to stockNum when available to prevent cross-contamination
    // from alternate vehicles of interest listed on the same page.
    // On new vehicles, last 6 chars of stock number always match last 6 of VIN — use as primary validator.
    var vin = '';
    var _allVins = [];
    var _vinScan = TEXT.matchAll(/\bVIN[:\s]+([A-HJ-NPR-Z0-9]{17})\b/ig);
    for (var _vm of _vinScan) _allVins.push(_vm[1]);

    if (stockNum && _allVins.length > 0) {
      var _stockSuffix = stockNum.slice(-6).toUpperCase();
      // First try: find a VIN whose last 6 chars match the stock number suffix
      var _matchedVin = _allVins.find(function(v) { return v.slice(-6).toUpperCase() === _stockSuffix; });
      if (_matchedVin) {
        vin = _matchedVin;
      } else {
        // Fallback: VIN within 250 chars of the stock number in page text
        var _stockIdx = TEXT.indexOf(stockNum);
        if (_stockIdx >= 0) {
          var _vicinity = TEXT.substring(Math.max(0, _stockIdx - 50), _stockIdx + 250);
          var _vinNear = _vicinity.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
          if (_vinNear) vin = _vinNear[1];
        }
      }
    } else if (_allVins.length > 0) {
      // No stockNum — take the first VIN on page
      vin = _allVins[0];
    }
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
    // e.g. "customer is shopping for a Pilot" - the AI should know this
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
    const noVehicleAtAll = (!vehicle || /not provided/i.test(vehicle)) && !stockNum && !vin; // No vehicle info at all - credit app only or browse lead
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

    // Scrape AI Buying Signals -- pattern-based, works regardless of which DOM render
    // variant VinSolutions used. Key text: "<stage>. Interests: <list>." where stage is
    // Actively Shopping / Browsing / Ready To Buy / Not Shopping / Not in Market.
    var buyingSignals = '';
    try {
      // Path 1: stable ID if present
      var bsBlurb = document.querySelector('#keyInfo-BuyingSignals-blurb, [id*="BuyingSignals-blurb"]');
      if(bsBlurb) {
        var bsText = (bsBlurb.innerText||'').trim();
        if(bsText && bsText.length > 5 && /interests?:/i.test(bsText)) buyingSignals = bsText.substring(0,200);
      }
      // Path 2: tight text pattern -- requires BOTH stage word AND Interests label together.
      // No looser fragment fallback -- a partial match on "Interests:" alone produced false
      // positives from unrelated note text. Better empty than wrong.
      if(!buyingSignals) {
        var pageText = (document.body ? document.body.innerText || '' : '');
        var bsM = pageText.match(/(actively shopping|ready to buy|browsing|not shopping|not in market)\.\s*interests?:\s*([A-Z][A-Za-z0-9\s,\/&-]{2,120})\./);
        if(bsM) {
          var bsStage = bsM[1].trim();
          var bsInterests = bsM[2].trim().replace(/\s+/g, ' ');
          buyingSignals = bsStage + '. Interests: ' + bsInterests + '.';
        }
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
    // (v9.7.81) Scan the Buyer panel directly, not the first 2000 chars of the
    // page. The 2000-char limit (in place since spring 2026) caused false
    // negatives on any lead where the Vehicle Info panel rendered before the
    // Buyer panel in DOM order — pushing the customer phone past char 2000.
    // On Tyrone Brass's lead (5/12), every one of 27 outbound texts contained
    // the customer phone (337) 496-6601 in 'Sent to:' headers, but ALL of
    // them rendered past char 2000, so hasPhone returned false. The flag
    // fired, the model wrote 'what is the best number,' and 3 attempted
    // downstream overrides all failed to compensate.
    //
    // Targeted scan: look for the Buyer panel element first; fall back to the
    // wider page text only if the panel can't be located. This avoids both
    // the original false-negative (panel beyond 2000) and a hypothetical
    // false-positive (dealer signature phone in notes — those appear past the
    // Buyer panel and we don't want them counting as the customer phone).
    var buyerPanelText = '';
    var buyerPanelEl = document.querySelector('[id*="BuyerCobuyer"]') ||
                       document.querySelector('[id*="CustomerInfo"]') ||
                       document.querySelector('[id*="BuyerInfo"]') ||
                       document.querySelector('[id*="ContactInfo"]');
    if (buyerPanelEl) {
      buyerPanelText = (buyerPanelEl.innerText || '').trim();
    }
    // Also include the detailEl which is the existing phone-scrape source —
    // this is where d.phone got extracted from, so the customer phone is
    // definitely in here too. Concatenating gives us defense-in-depth.
    var detailElText = (typeof detailEl !== 'undefined' && detailEl) ? (detailEl.innerText || '') : '';
    var combinedBuyerText = buyerPanelText + '\n' + detailElText;
    var hasPhone = phonePattern.test(combinedBuyerText) || phonePattern.test(TEXT.substring(0, 2500));
    var hasEmail = buyerEmail.length > 4;
    // Landline: only flag if notes explicitly say landline/cannot receive texts
    // Do NOT infer from Work/Home label - those are often cell numbers
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
      // Expand collapsed notes before reading - VinSolutions collapses long notes with Show More
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
    noteEls.slice(0,30).forEach(function(n){
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
        // Strip email device/app footers - "Sent from Yahoo Mail for iPad On Tuesday..."
        .replace(/\s*(?:Sent from|Get|Downloaded from)\s+(?:Yahoo Mail|my iPhone|my iPad|Outlook|Gmail|Apple Mail|Android)[^]*/gi, '')
        // Strip email reply chain headers: "On [Day], [Date or details], [name] wrote:"
        // Tightened to require the comma-with-date pattern OR ending in "wrote:" - prevents
        // false-stripping of organic customer phrases like "Are you open on Saturday?"
        // Megan Mckennie case (May 8) - sanitize was deleting "on Saturday?" from her question.
        .replace(/\s*On (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}[^]*$/gi, '')
        .replace(/\s*On\s+\d{1,2}\/\d{1,2}\/\d{2,4}[^]*$/gi, '')
        .replace(/\s*On [^,]{1,80},[^]{0,200}wrote:[^]*$/gi, '')
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
          // Use lead created date as the hard cutoff - anything before is prior lead cycle
          // Subtract 1 hour buffer to include same-day notes from the lead receipt itself
          var leadCutoff = createdMs - (1 * 60 * 60 * 1000);
          if(leadCutoff > transcriptCutoffMs) transcriptCutoffMs = leadCutoff;
        }
      }
    } catch(e) {}
    // For re-engagement leads (loyalty/KFA/AFS), also scan note text for most recent
    // 'Lead received' timestamp and use THAT as the definitive cutoff start point.
    // This prevents old objections from prior lead cycles bleeding into new outreach.
    try {
      noteEls.forEach(function(item) {
        var title2 = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
        if(!/^Lead received$/i.test(title2)) return;
        var dateStr2 = ((item.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var noteMs2 = dateStr2 ? new Date(dateStr2).getTime() : 0;
        // Use the most recent Lead received note as the definitive start
        if(noteMs2 > 0) {
          var receivedCutoff = noteMs2 - (1 * 60 * 60 * 1000); // 1hr buffer
          if(receivedCutoff > transcriptCutoffMs) transcriptCutoffMs = receivedCutoff;
        }
      });
    } catch(e) {}
    // Detect phone-up leads -- source contains "Phone"
    var isPhoneUpLead = /phone/i.test(leadSource || '');
    noteEls.slice(0,60).forEach(function(item){
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
          // If this lead note is significantly newer than the original created date,
          // this is a re-activated/recycled lead. Tighten the cutoff so old outbound
          // is excluded from hasOutbound and follow-up detection.
          if(noteMs > 0 && leadCreatedMs > 0 && (noteMs - leadCreatedMs) > 30 * 86400000) {
            // New lead submitted 30+ days after original created - treat as fresh
            var freshCutoff = noteMs - (24 * 60 * 60 * 1000);
            if(freshCutoff > transcriptCutoffMs) transcriptCutoffMs = freshCutoff;
          }
          transcript.push('[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted. The transcript is newest-first. Everything ABOVE this line is the active conversation for THIS lead (today\'s outreach, replies, calls). Everything BELOW is older history from prior interactions -- use only for background context, not as active conversation. Count attempts, recent messages, and outreach only from above this marker.');
        }
      }
      // Extract customer question from lead received note BEFORE stripping
      // VinSolutions embeds the customer's comment/question at the end of lead received notes
      // e.g. "I'm gonna have to pay APR?" or "Consumer requests to be contacted by text"
      // For chat leads, extract the full Gubagoo chat summary and inject it as customer context
      // Chat summaries appear as plain prose: "Asked if..., Looking for..., Wants..., Requested..."
      if(isLeadReceived && content && /m-chat|chat lead|gubagoo.*chat|live chat/i.test(content + title)) {
        // Extract the summary line - it's the plain text before the URL/lead type markers
        var chatSummary = content.match(/(?:Asked|Looking|Want|Need|Request|Interested|Said|Mentioned|Inquir)[^\n]{10,400}/gi);
        if(chatSummary && chatSummary.length > 0) {
          var fullSummary = chatSummary.join('. ').substring(0, 400);
          transcript.push('[CUSTOMER CHAT SUMMARY] ' + fullSummary);
          lastInboundMsg = lastInboundMsg || fullSummary;
        }
      }
      if(isLeadReceived && content && !lastInboundMsg) {
        // Look for customer-written content: questions or statements after common lead note markers
        var custCommentMatch = content.match(/Consumer(?:\s+requests?)?[^\n]*(?:\n|$)([^\n]{10,200})/i)
          || content.match(/Customer(?:\s+(?:comment|note|message|said))?[:\s]+([^\n]{10,200})/i)
          || content.match(/\nNote:\s*([^\n]{10,200})/i);
        // Direct question pattern - customer typed something that looks like a question or statement
        var directQuestion = content.match(/(?:^|\n)([^\n]{5,150}\?)(?:\s|$)/m);
        // Customer instruction pattern - "When responding please include X", "Please provide X"
        var custInstruction = content.match(/(?:when responding|please (?:include|provide|send|give)|I(?:'d| would) like to (?:know|see|get)|can you (?:include|provide|send))\s+([^\n]{5,200})/i);
        var extractedCustQ = (custCommentMatch && custCommentMatch[1] && !/lead reference|customer id|lead id|dealer id|consumer requests to be contacted/i.test(custCommentMatch[1]))
          ? custCommentMatch[1].trim()
          : (directQuestion && !/click here|reply stop|lead from|in-market|follow up/i.test(directQuestion[1]))
          ? directQuestion[1].trim()
          : (custInstruction && custInstruction[1])
          ? custInstruction[0].trim()
          : '';
        // Fallback: catch short freeform vehicle interest statements ("looking for a honda pilot", "interested in tacoma trd")
        // These appear as standalone text in simple lead notes (CarPro, basic website leads)
        if(!extractedCustQ && content && content.trim().length < 300) {
          var freeformMatch = content.trim().match(/^([^\n]{5,150})$/m);
          if(freeformMatch && /looking for|interested in|need a|want a|searching for|inquir/i.test(freeformMatch[1])) {
            extractedCustQ = freeformMatch[1].trim();
          }
        }
        if(extractedCustQ) {
          // Strip OEM form placeholder artifacts before using as customer inquiry
          extractedCustQ = extractedCustQ
            .replace(/\[?Customer Comments\]?\s*\|+\s*\|*/gi, '')
            .replace(/\[?Ownership and Service\]?\s*-?\s*Ownership and Service History Not Available\.?/gi, '')
            .replace(/\|+/g, '')
            .trim();
          if (!extractedCustQ || extractedCustQ.length < 5) extractedCustQ = '';
        }
        if(extractedCustQ) {
          leadReceivedCustomerQuestion = extractedCustQ;
          transcript.push('[CUSTOMER REQUEST FROM INQUIRY] ' + extractedCustQ);
          // If no vehicle detected yet, try to extract model from the statement
          if(!vehicle) {
            var vehicleFromStatement = extractedCustQ.match(/(?:looking for|interested in|need a|want a|searching for)\s+(?:a\s+)?(.{5,60}?)(?:\s*$|\s*[,.])/i);
            if(vehicleFromStatement && vehicleFromStatement[1]) {
              vehicle = vehicleFromStatement[1].trim();
            }
          }
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
          var tfsNote = 'LEASE/TFS DATA - use this to frame the response around their lease end:\n' + tfsData.join(' | ');
          transcript.push('[TFS LEASE DATA] ' + tfsNote);
          // Also inject into conversationBrief so it's top of context
          conversationBrief = conversationBrief ? tfsNote + '\n\n' + conversationBrief : tfsNote;
        }
      }
      // Extract browsed vehicle names from VR/Gubagoo page view URLs before stripping
      // e.g. "used-2024-toyota-corolla-hybrid-le-baytown-tx/117917021/" ? "2024 Toyota Corolla Hybrid LE"
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

        // Also extract from /search/ URLs -- these are search results pages like
        // /search/new-toyota-corolla-baytown-tx/ or /search/used-toyota-rav4-baytown-tx/
        // These tell us what the customer was actively searching for
        var searchMatches = content.match(/\/search\/([^\/\s"?]+)/g) || [];
        var searchVehicles = [];
        searchMatches.forEach(function(url) {
          var slug = url.replace('/search/', '').replace(/[-\/]baytown.*|[-\/]lafayette.*/, '');
          // Pattern: new-toyota-corolla or used-toyota-rav4 or used-jeep
          var parts = slug.split('-').filter(function(w){ return w.length > 1; });
          // Remove condition prefix
          if(/^(new|used|certified)$/.test(parts[0])) parts = parts.slice(1);
          // Need at least make + model
          if(parts.length < 2) return;
          var modelName = parts.map(function(w){ return w.charAt(0).toUpperCase()+w.slice(1); }).join(' ');
          if(searchVehicles.indexOf(modelName) === -1) searchVehicles.push(modelName);
        });

        // Merge: VDP-level vehicles take priority, search vehicles fill in if no VDP found
        if(browsedVehicles.length === 0 && searchVehicles.length > 0) {
          browsedVehicles = searchVehicles.slice(0, 3);
        }
        if(browsedVehicles.length && !vehicle) {
          // Use most-viewed vehicle as the vehicle of interest
          vehicle = browsedVehicles[0];
        }
        if(browsedVehicles.length && vehicle && browsedVehicles[0] !== vehicle) {
          // If a vehicle was already scraped (e.g. from an old sold record), but browse history
          // shows something different, prefer the browse history on new leads with no stock/VIN
          // This prevents the 2017 sold Camry from bleeding into a fresh Tundra inquiry
          if(!stockNum && !vin) {
            vehicle = browsedVehicles[0];
          }
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
            // This is NOT a confirmed appointment - customer proposed a time, agent must confirm it
            var chatAllCustomer = chatOut.join(' ');
            var chatTimeMatch = chatAllCustomer.match(/(?:i can (?:come|be there|make it|stop by)|i.ll (?:come|be there|stop by)|can come (?:at|around|by)|come (?:at|around))[\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i)
              || chatAllCustomer.match(/(?:around|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
            if(chatTimeMatch) {
              transcript.push('[CHAT NOTE] CUSTOMER PROPOSED TIME: Customer said they can come at ' + chatTimeMatch[1].trim() + '. CONFIRM this time in your response - do NOT offer different times. Say something like "Perfect, I will have everything ready for you at [time]."');
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
      // Strip LP command notes — already extracted to vehicleExtras, don't send raw to model
      if(/\[LP:/i.test(line)) return false;
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
      // Only count real customer-facing outbound -- texts and emails with substantive content.
      // Phone-call notes (left voicemail, no answer, phone kept ringing) are NOT real outreach
      // from the customer's perspective -- they did not receive a message they could read.
      var isRealMessage = /outbound text|email reply|outbound email/i.test(title);
      // Exclude automated/system messages -- these are not real agent outreach.
      // Includes: dealership auto-responses, system Welcome SMS opt-in prompts ("Reply YES to receive..."),
      // and dealership-branded Welcome emails ("Welcome to Community Toyota", "Thanks for Contacting").
      var isAutomated = /automated response|we are not open for business|assurance that your request|we are currently working on your request|thank you.*inquiry.*community|this automated response|reply yes to receive text messages|message and data rates may apply|welcome to (community|audi|toyota|honda|kia)|thanks? for contacting|thank you for contacting/i.test(msgContent);
      return dir === 'outbound' && isRealMessage && !isAutomated;
    })
    // Track whether a text or email has been sent (vs call-only) -- 
    // determines if digital first-touch is still needed
    var hasTextOrEmailSent = noteEls.some(function(item){
      var noteDate2 = ((item.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      var noteDateMs2 = noteDate2 ? new Date(noteDate2).getTime() : Date.now();
      if(noteDateMs2 > 0 && noteDateMs2 < transcriptCutoffMs) return false;
      var title = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var msgContent = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
      var isDigital = /outbound text|email reply to prospect|outbound email/i.test(title);
      var isAutomated = /automated response|we are not open for business|assurance that your request|thank you.*inquiry.*community|this automated response|reply yes to receive text messages|message and data rates may apply|welcome to (community|audi|toyota|honda|kia)|thanks? for contacting|thank you for contacting/i.test(msgContent);
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
    // STOP = SMS opt-out - treat as exit, do NOT generate follow-up content
    // STOP opt-out: context-aware -- new lead submission overrides old opt-out
    var hasNewLeadToday = (leadAgeDays || 0) === 0;
    // (v9.7.65) hasRecentReoptIn: detect a REAL re-opt-in event, not just any new lead.
    // The old regex matched "lead received" which is on every new lead -- so it was
    // inadvertently disabling isSmsOptOut for every fresh STOP. A real re-opt-in is:
    //   - Customer texting YES (the prompt response to the welcome SMS)
    //   - BDC agent manually flipping SMS status BACK to Opt-In (after a prior opt-out)
    //   - Customer explicit re-engagement language
    // None of these apply to Wendy-style "fresh lead, customer texts STOP" cases.
    var hasRecentReoptIn = /sms status.*opt.?in|manually changed to:?\s*opt.?in|status.*has been.*opt.?in|^yes[\s.!]*$|reply yes/i.test(recentTranscript);
    // Also scan note titles/contents directly for explicit Opt-In status flips (mirrors hasSystemOptOutNote)
    try {
      var hasSystemOptInNote = noteEls.slice(0,30).some(function(item){
        var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
        var title   = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        return /sms status.*opt.?in|manually changed to:?\s*opt.?in/i.test(content)
          || (/sms status/i.test(title) && /opt.?in/i.test(content));
      });
      if (hasSystemOptInNote) hasRecentReoptIn = true;
    } catch(e) {}
    // VinSolutions inbound note format: "Received from: <phone>\nReceived by: <agent>\n<actual message>"
    // Extract just the message body for clean STOP detection - strip header lines.
    var inboundMessageOnly = (recentInbound || '').replace(/^\s*Received (from|by)[^\n]*\n?/gim, '').trim();
    // ALSO: scan noteEls directly for System-authored SMS Status opt-out notes.
    // These notes don't carry [CUSTOMER]/[AGENT] tags, so they get filtered out of
    // recentInbound/recentTranscript. Without this direct scan, opt-outs recorded as
    // System status changes go undetected.
    var hasSystemOptOutNote = false;
    try {
      hasSystemOptOutNote = noteEls.slice(0,30).some(function(item){
        var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
        var title   = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        return /sms status.*opt.?out|manually changed to:?\s*opt.?out|status.*has been.*opt.?out/i.test(content)
          || /sms status/i.test(title) && /opt.?out/i.test(content);
      });
    } catch(e) {}
    var rawStopSignal = /^stop[\s.!]*$/i.test(inboundMessageOnly)
      || /^stop[\s.!]*$/i.test((recentInbound||'').trim())
      || /successfully.*removed.*text|opted out of text|removed from.*text messages|sms status.*opt.?out|manually changed to:?\s*opt.?out/i.test(fullScanText)
      || hasSystemOptOutNote;
    isSmsOptOut = rawStopSignal && !(hasNewLeadToday && hasRecentReoptIn);
    // isSmsOptOut means "stop texting" - NOT "not interested"
    // Only treat SMS opt-out as a full exit signal if it's fresh AND no new lead exists
    // Otherwise: suppress SMS only, keep email/voicemail active
    var smsOptOutIsExit = isSmsOptOut && !hasNewLeadToday && !hasRecentReoptIn;
    var exitRaw = smsOptOutIsExit || /already bought|bought.*something|bought.*elsewhere|purchased.*already|going.*elsewhere|not interested in (the car|the vehicle|buying|purchasing|a vehicle|coming in|visiting)|not ever interested|never going back|will not be back|will never go back|won.t be back|never coming back|remove.*from.*list|stop.*contacting|decided to (buy|go with|purchase)|went with (another|a different|ford|chevy|toyota|kia|nissan|hyundai|chevrolet|gmc|ram|jeep|dodge|subaru|mazda|volvo|bmw|mercedes|lexus|acura|infiniti|cadillac|lincoln|buick)|found (one|a car|what we)|no longer (interested|looking|in the market)|took (a|the) (deal|offer) (at|from|with)|not satisfied.*process|bad experience|sharing.*bad.*experience|terrible.*experience|horrible.*experience/i.test(fullScanText);
    // "we bought" / "bought it" - only exit if followed by purchase context, not ownership history
    var boughtElsewhere = /we (bought|purchased|went with|decided on).{0,30}(another|elsewhere|different|other dealer|from them|from there)/i.test(fullScanText)
      || /bought (one|a car|a vehicle) (from|at|with)/i.test(fullScanText);
    var keepingTrade = /keep it if|keep my (car|truck|suv|altima|camry|vehicle)|hold onto it|just keep (it|my)/i.test(fullScanText);

    // (v9.7.56) INTERNAL AGENT NOTE EXIT DETECTION
    // When BDC agents discover the customer bought elsewhere, they record it in
    // call notes / general notes -- "purchased elsewhere", "bought elsewhere",
    // "she bought eslewhere", "he/she got something already", etc. The customer
    // never says these words themselves, so the digital-only fullScanText scan
    // misses them. Internal observations from the team are trusted ground truth
    // (same precedence as "deposit placed" / "on hold for [name]" notes).
    var hasInternalSoldElsewhere = false;
    try {
      hasInternalSoldElsewhere = noteEls.slice(0, 40).some(function(item){
        var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
        if (!content) return false;
        // Patterns BDC agents use to record sold-elsewhere status. Tolerant of
        // common typos (eslewhere, elswhere) and informal phrasing.
        return /\b(bought|purchased|got)\s+(it\s+)?(elsewhere|elswhere|eslewhere|already|somewhere\s+else|another|a\s+different|from\s+(another|a\s+different))\b/i.test(content)
          || /\bpurchased?\s+elsewhere|purchased?\s+already\b/i.test(content)
          || /\b(she|he|they|customer)\s+(bought|purchased|got)\s+(elsewhere|elswhere|eslewhere|already|somewhere\s+else)\b/i.test(content)
          || /\bsold\s+(elsewhere|somewhere\s+else)\b/i.test(content)
          || /\b(found|got)\s+(one|a\s+car|a\s+vehicle)\s+(elsewhere|already|somewhere\s+else)\b/i.test(content);
      });
    } catch(e) {}

    // Re-engagement override: if customer sent an active message AFTER the exit signal, cancel exit
    // e.g. "I am still on the hunt" after "no longer interested" = re-engaged
    var recentCustomerActive = /still (on the hunt|looking|interested|searching|in the market)|still want|still need|haven.t found|haven.t bought|still shopping|changed my mind|reconsidering|actually.*interested|would like to|still considering/i.test(recentInbound);
    const exitByRemoval = /take me off|remove me from|off your list|off the list|not interested anymore|no longer interested/i.test((lastInboundMsg || '') + ' ' + (fullScanText||''));
    const hasExitSignal = (exitRaw || boughtElsewhere || exitByRemoval || hasInternalSoldElsewhere) && !keepingTrade && !recentCustomerActive;
    if (hasInternalSoldElsewhere) {
      console.log('[Lead Pro] EXIT (internal note): BDC team noted customer bought/purchased elsewhere -- treating as exit signal');
    }
    // isSmsOptOutOnly: customer stopped texts but did NOT say they're not interested
    // Email and voicemail should still advance the conversation normally
    const isSmsOptOutOnly = isSmsOptOut && !smsOptOutIsExit && !hasExitSignal;
    // (v9.7.64) Diagnostic: trace SMS opt-out flag resolution so we can see why
    // isSmsOptOutOnly isn't firing when expected. Specifically to debug STOP-as-first-touch.
    try {
      console.log('[Lead Pro] SMS opt-out flag trace -- isSmsOptOut:', isSmsOptOut,
        '| rawStopSignal:', rawStopSignal,
        '| hasNewLeadToday:', hasNewLeadToday,
        '| hasRecentReoptIn:', hasRecentReoptIn,
        '| smsOptOutIsExit:', smsOptOutIsExit,
        '| hasExitSignal:', hasExitSignal,
        '| isSmsOptOutOnly (final):', isSmsOptOutOnly);
    } catch(e) {}
    const hasPauseSignal = !hasExitSignal && /taking a break|no luck|need time|not ready|still looking|not able to upgrade|not looking to upgrade|too early|just got|only have \d+k|low miles|get back to you later|i.ll reach out|contact you later|good day|have a good|have a great|talk later|i.ll let you know|let you know when|not right now|maybe later|later on|patient person|very patient|when the time is right|when i.m ready|not in a rush|no rush|take my time|taking my time|not looking yet|just browsing|just looking|thank you so much|appreciate it|keep in touch|still enjoying|loving it|love it|happy with|works great|runs great|no complaints|build.*credit|save.*up|saving.*up|hold off|holding off|wait.*little|not quite ready|need to save|saving more|building.*credit|credit.*build|won.t be home|will not be home|not home until|not back until|camping|out of town|traveling|on vacation|on a trip|don.t want to come in|not coming in|can.t come in today|won.t be able to come|not available today|unavailable today|busy today|tied up today/i.test(fullScanText);
    // Also detect pause from call notes - scan the raw transcript (not just fullScanText)
    // since call notes are [AGENT] blocks excluded from fullScanText's digital-only filter
    var callNoteText = transcript.filter(function(t){ return t.indexOf('[CALL NOTE]') !== -1 || t.indexOf('[AGENT]') !== -1; }).join(' ').toLowerCase();
    var recentNoteText = noteEls.slice(0,25).map(function(el){ return (el.innerText||'').toLowerCase(); }).join(' ');
    const hasCallNotePause = /will call back if interested|he.ll call back|she.ll call back|they.ll call back|will call back|he will call|she will call|will reach out|will contact|if (?:he|she|they) (?:is|are) interested|call.*if interested|interested.*call back|left it up to|letting him know|letting her know|waiting to hear|said (?:he|she|they) would call|said to call back/i.test(callNoteText + ' ' + recentNoteText + ' ' + TEXT.toLowerCase());
    const effectivePauseSignal = hasPauseSignal || hasCallNotePause;

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
    // Also skip single-word confirmations (C, YES, Morning, OK) - these are replies not schedule info
    for(var nti=0; nti<Math.min(10, noteEls.length); nti++){
      var ntDir = (noteEls[nti].getAttribute('data-direction')||'').toLowerCase();
      var ntTitleCheck = ((noteEls[nti].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
      var isInboundNote = ntDir === 'inbound' || /inbound text|inbound sms|text message.*inbound|inbound.*text|email reply from prospect|email from prospect|inbound phone|inbound call/i.test(ntTitleCheck);
      // [LP SCHED GATE] - log every note's gate decision to trace why constraint detection isn't reaching the email reply
      try { console.log('[LP SCHED GATE]', { noteIndex: nti, dir: ntDir || '(empty)', title: ntTitleCheck.substring(0,100), passesGate: isInboundNote }); } catch(e) {}
      if(isInboundNote){
        var ntTitle = ((noteEls[nti].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var ntRawText = ((noteEls[nti].querySelector('.notes-and-history-item-content')||{}).innerText||'');
        // Skip system/automated inbound notes - these are data dumps not customer messages
        var ntIsSystem = /lead received|email auto response|auto response|system/i.test(ntTitle)
          || /value-to-dealer|market report|tradepending|plugin\.tradepending|kelley blue|kbb\.com|estimated.*miles.*value|market size.*within|automated response|we are not open|assurance that your request/i.test(ntRawText.substring(0,300));
        if(ntIsSystem) continue; // skip this note, check next one
        // Skip very short replies (1-2 words) that are confirmations not schedule info
        // e.g. "C", "YES", "Morning", "OK", "Sure" - these don't contain schedule constraints
        var ntWordCount = ntRawText.trim().split(/\s+/).filter(Boolean).length;
        var isShortConfirmation = ntWordCount <= 2 && /^(c|yes|ok|okay|sure|morning|afternoon|evening|great|perfect|sounds good|got it|thanks|thank you|hi|hello|\d{1,2}(:\d{2})?\s*(am|pm)?)$/i.test(ntRawText.trim());
        if(isShortConfirmation && !customerScheduleConstraint) continue; // skip but keep looking deeper
        var ntText = ntRawText.toLowerCase();
        // Explicit same-day block
        if(/not today|can.t today|busy today|can.t make it today|no today|not available today|working today|at work today|won.t be able.*today|not.*able.*come.*today|not.*able.*out.*today|can.t come.*today|don.t think.*today|unable.*today|not going to make it today|won.t make it today|can.t.*today|not.*coming.*today|won.t be.*today|don.t think i.ll be able|i will call|i'll call|will call.*when|call.*when.*ready|not available today|don.t want to come in|do not want to come in|not coming in|won.t be home|will not be home|not home until|camping|out of town|on vacation|traveling/i.test(ntText)){
          customerSaidNotToday = true;
        }
        // Customer specifies a future day as their availability - lock onto that day
        // e.g. "I won't be able to until Saturday", "can't until Friday", "not until next week"
        var futureDayMatch = ntText.match(/(?:until|till|on|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
          || ntText.match(/(?:won.t|can.t|cannot|not able|unable).{0,20}(?:until|till)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
          || ntText.match(/(saturday|sunday|monday|tuesday|wednesday|thursday|friday)\s+(?:works?|is\s+better|only|available)/i)
          || ntText.match(/(?:come|coming|stop|swing|head|in|visit|be there).{0,15}(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)
          || ntText.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:morning|afternoon|evening|night)/i)
          || ntText.match(/(?:thinking|plan|hope|want|prefer).{0,20}(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
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
        // Numeric work-hour ranges: "I work 8-5", "8 to 5 every day", "9-6 weekdays",
        // "7am-4pm", "12 to 9". Captures the actual hours so the downstream directive
        // renders concrete unavailable-block numbers the model must filter against.
        // Megan Mckennie case (May 7) - said "I work 8-5 every day" and the named-time
        // detector above missed it entirely, leaving the constraint empty and the model
        // inferring (often badly) on every regen.
        if(!customerScheduleConstraint) {
          var workRangeMatch = ntText.match(/(?:i\s+)?work(?:ing)?\s+(\d{1,2})(?:\s*(am|pm))?\s*(?:-|-|to|until|till)\s*(\d{1,2})(?:\s*(am|pm))?(?:\s+(every\s*day|weekdays?|daily|mon[\s-]*fri|monday[\s-]*friday))?/i);
          // [LP SCHED DIAG] - verify whether numeric work-hour detection ran on this note
          try { console.log('[LP SCHED DIAG]', { noteIndex: nti, title: ntTitle.substring(0,80), ntTextSample: ntText.substring(0,250).replace(/\n/g,' | '), ntTextLen: ntText.length, workRangeMatch: workRangeMatch ? workRangeMatch[0] : '(no match)', hasScheduleBlock: hasScheduleBlock, constraintAlreadySet: !!customerScheduleConstraint }); } catch(e) {}
          if(workRangeMatch) {
            var startHr = workRangeMatch[1];
            var startAmPm = workRangeMatch[2] || '';
            var endHr = workRangeMatch[3];
            var endAmPm = workRangeMatch[4] || '';
            var freq = workRangeMatch[5] || '';
            // Default am/pm: when neither side has am/pm, infer from typical work patterns.
            // "8-5" -> 8 AM to 5 PM. "9-6" -> 9 AM to 6 PM. "12-9" -> 12 PM to 9 PM.
            if(!startAmPm && !endAmPm) {
              var sH = parseInt(startHr,10), eH = parseInt(endHr,10);
              if(sH >= 6 && sH <= 11 && eH >= 1 && eH <= 7) { startAmPm = 'AM'; endAmPm = 'PM'; }
              else if(sH === 12 && eH >= 1 && eH <= 11) { startAmPm = 'PM'; endAmPm = 'PM'; }
              else if(sH >= 1 && sH <= 11 && eH >= sH) { startAmPm = 'AM'; endAmPm = 'AM'; }
            }
            var rangeStr = startHr + (startAmPm ? ' ' + startAmPm.toUpperCase() : '') + ' to ' + endHr + (endAmPm ? ' ' + endAmPm.toUpperCase() : '');
            var freqStr = freq ? ' (' + freq.replace(/\s+/g,' ').toLowerCase() + ')' : '';
            customerScheduleConstraint = 'WORK HOURS BLOCK: Customer works ' + rangeStr + freqStr + '. They are unavailable during these hours. Offer ONLY times outside this block - typically AFTER ' + endHr + (endAmPm ? ' ' + endAmPm.toUpperCase() : '') + ' on weekdays, OR Saturday anytime within store hours. Do NOT offer any time inside ' + rangeStr + '.';
          }
        }
        // Direct time-of-day preference - customer replies with just "morning" or "afternoon"
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
    } else if((hasPauseSignal || hasCallNotePause) && !(agentLPCommands && agentLPCommands.length > 0)) {
      convState = 'pause';
    } else if(hasOutbound || isContacted) {
      // Detect actual customer concern (not just any DOM mention of "negative" or "pricing")
      // - explicit VinSolutions sentiment tag/badge ONLY (not generic body text)
      // - or an inbound message with concrete price-pushback language from the customer
      var hasNegTag = noteEls.slice(0,10).some(function(item){
        var html = item.innerHTML || '';
        var dir = (item.getAttribute('data-direction')||'').toLowerCase();
        var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase().trim();
        // VinSolutions sentiment tag - these appear as compact pill/badge elements
        var hasSentimentTag = /class="[^"]*\b(negative|sentiment-neg|negative-tag|negative-pricing)\b[^"]*"/i.test(html)
          || /<[^>]+\b(?:data-sentiment|data-tag)\s*=\s*["']negative["']/i.test(html);
        // Explicit price-pushback language from customer (inbound only) - "Stop" is opt-out, not concern
        var isStopOptOut = /^stop[\s.!]*$/i.test(content);
        var hasPricePushback = dir === 'inbound' && !isStopOptOut && content.length > 5
          && /too (high|expensive|much|pricey)|can.t afford|out of (my|our) budget|over (my|our) budget|that.s a lot|too pricy|way too|not in (my|our) budget|pricing.*high|price.*high|asking too much|over priced|overpriced|sticker.*shock/i.test(content);
        return hasSentimentTag || hasPricePushback;
      });
      // Check if customer has sent a real inbound text/email reply
      var hasRealCustomerReply = noteEls.slice(0,40).some(function(item){
        var dir = (item.getAttribute('data-direction')||'').toLowerCase();
        var title = ((item.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var content = ((item.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
        var isRealInboundText = dir === 'inbound' && /inbound text|inbound sms|text message/i.test(title)
          && content && content.length > 3
          && !/lead received|auto response|opted out|stop$/i.test(content);
        var isRealEmailReply = dir === 'inbound' && /email reply from prospect|email from prospect/i.test(title)
          && content && content.length > 3;
        return isRealInboundText || isRealEmailReply;
      });
      if(hasNewLeadToday && !hasRealCustomerReply && (hasRecentReoptIn || contactedAgeDays === undefined || contactedAgeDays > 90)) {
        // Brand new lead submitted today with no recent contact - customer re-engaged fresh
        // Old outbound history is irrelevant - treat as first-touch
        convState = 'first-touch';
      } else if(hasNegTag) {
        convState = 'negative-reply';
      } else if(!hasTextOrEmailSent) {
        // Agent called but hasn't sent text/email yet
        // This is NOT first-touch - the call already happened. Text/email is the follow-up to the call.
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
    // The chat happened BEFORE the lead was created - it IS the first contact
    var gubogooChatEntry = transcript.filter(function(t){ return t.indexOf('[GUBAGOO CHAT]') !== -1; });
    if(gubogooChatEntry.length) {
      conversationBrief = 'CHAT TRANSCRIPT (customer already spoke with the chat bot - read this before writing):\n' + gubogooChatEntry.join('\n');
    }
    // ?? Inject agent context notes into brief - always, regardless of convState ??
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
      if(/phone call/i.test(title) && content && content.length > 5) { // include all call types (outbound, contacted, inbound)
        var isBoilerplate = /^(left message|no answer|auto generated|voicemail|machine|mb full|full mailbox|https?:)/i.test(content.trim()) || /^left\s/i.test(content.trim());
        if(!isBoilerplate) {
          // Strip Lead Pro's injected context block - appended after ' --- ' separator
          var cleanContent = content.replace(/By:[^\n]+\n?/,'').trim();
          var lpSep = cleanContent.indexOf(' --- ');
          if (lpSep > 0) cleanContent = cleanContent.substring(0, lpSep).trim();
          if (!cleanContent || cleanContent.length < 2) cleanContent = content.replace(/By:[^\n]+\n?/,'').trim().split('\n')[0];
          contextNoteLines.push('[' + date + '] [CALL NOTE] ' + title + '\n  By: ' + (content.match(/By:\s*([^\n]+)/)||['','Agent'])[1] + '\n  ' + cleanContent);
        }
      }
    });

    // 3. Showroom Visit notes - rich context: what steps completed, manager turnover, notes
    noteEls.forEach(function(n) {
      var title = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
      var content = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
      var date = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
      if(/showroom visit/i.test(title) && content) {
        contextNoteLines.push('[' + date + '] [SHOWROOM VISIT]\n  ' + content.replace(/\n/g, '\n  '));
      }
    });

    if(contextNoteLines.length) {
      var notePrefix = 'AGENT CONTEXT (read before writing - call notes, showroom visits, and agent observations):' +
        '\n' + contextNoteLines.join('\n');
      conversationBrief = conversationBrief ? notePrefix + '\n\n' + conversationBrief : notePrefix;
    }


    if(convState !== 'first-touch'){
      // (v9.7.62) Detect STOP-as-first-touch subcase: customer's ONLY inbound is "STOP"
      // (or similar opt-out keyword) with no prior real conversation.
      // Detection is convState-agnostic because convState may route to 'active-follow-up'
      // when the lead is fresh (hasNewLeadToday=true), 'exit' when the opt-out is treated
      // as full exit, or 'first-follow-up'. Whichever bucket the lead falls into, if the
      // only customer message is STOP, we want SMS terse + email honoring original inquiry.
      var _isStopOnlyExit = false;
      try {
        if (isSmsOptOut) {
          // Count real customer inbound messages that aren't just the STOP itself
          var _realInboundCount = 0;
          for (var _si = 0; _si < Math.min(20, noteEls.length); _si++) {
            var _sn = noteEls[_si];
            var _sdir = (_sn.getAttribute('data-direction')||'').toLowerCase();
            if (_sdir !== 'inbound') continue;
            var _stitle = ((_sn.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
            var _stext = ((_sn.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
            // Skip non-customer-content inbound entries (system notifications etc)
            if (!/inbound text|inbound sms|text message|email reply from prospect|email from prospect|inbound phone|inbound call/i.test(_stitle)) continue;
            // Skip the STOP message itself (and short opt-out variants)
            if (_stext && /^(stop|stopall|unsubscribe|cancel|quit|end|opt.?out)\.?$/i.test(_stext.trim())) continue;
            // Real customer content
            if (_stext && _stext.length > 3) _realInboundCount++;
          }
          // If the ONLY inbound was STOP (or no real conversation prior), this is first-touch-STOP
          _isStopOnlyExit = (_realInboundCount === 0);
        }
      } catch(e) {}

      var stateLabel = {
        'exit':             'EXIT SIGNAL: customer purchased elsewhere or is not interested. Write a gracious close only.',
        'pause':            'PAUSE SIGNAL: customer needs more time. Empathetic check-in only. No appointment pressure.',
        'negative-reply':   'NEGATIVE/PRICING REPLY: customer expressed concern. Address it directly in opening.',
        'active-follow-up': 'FOLLOW-UP: read the full transcript and write a response that directly continues THIS conversation.',
        'first-follow-up':  'FOLLOW-UP: first outreach was made. Read the transcript and write a relevant continuation.'
      }[convState] || 'FOLLOW-UP';

      // (v9.7.62) STOP-as-first-touch OVERRIDE: replace whatever stateLabel was assigned
      // when this subcase fires. Lives outside the convState map so it works for exit,
      // active-follow-up, first-follow-up -- any bucket the lead got routed into.
      if (_isStopOnlyExit) {
        stateLabel = 'SMS OPT-OUT AS FIRST TOUCH: The customer texted STOP before any real conversation happened. They did NOT say they bought elsewhere or that they are uninterested in the vehicle -- they only said they do not want texts. This is a channel preference, not an exit. Handle as follows:\n'
          + '  - SMS = ONE short sentence acknowledging the opt-out, then signature. Nothing else. Do NOT re-engage on SMS, do NOT ask follow-up questions on SMS, do NOT introduce the vehicle on SMS. Just the confirmation.\n'
          + '  - EMAIL = This is your real channel now. Briefly note SMS is off (one line, not the whole paragraph), then HONOR THEIR ORIGINAL INQUIRY by delivering substantive content on what the LEAD section shows they actually asked about (vehicle availability, trade offer, KBB cash offer amount if present, whatever brought them in). Email is NOT covered by the SMS opt-out. Treat the email like a real first-touch response to their original inquiry, just with a one-sentence SMS-off acknowledgement at the start.\n'
          + '  - VOICEMAIL = Skip or keep extremely brief (one sentence). Do not leave a voicemail dwelling on the STOP.\n'
          + '  - Do NOT introduce off-topic business they did not ask about. Anchor on the actual inquiry from the LEAD section.\n'
          + '  - The customer opted out of ONE channel. Serve them through the others, on the topic they raised.';
        console.log('[Lead Pro] STOP-as-first-touch detected (convState=' + convState + ') -- SMS terse, email honors original inquiry through non-SMS channel');
      }

      // Extract the single most important customer signal from inbound messages
      var keySignal = '';
      var inboundMsgs = [];
      for(var ki=0; ki<Math.min(10, noteEls.length); ki++){
        var kDir = (noteEls[ki].getAttribute('data-direction')||'').toLowerCase();
        if(kDir === 'inbound'){
          // Skip notes older than transcript cutoff - prevents prior lead cycle messages bleeding in
          var kDateText = ((noteEls[ki].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
          var kDateMs = kDateText ? new Date(kDateText).getTime() : 0;
          if(kDateMs > 0 && kDateMs < transcriptCutoffMs) continue;
          var kTitle = ((noteEls[ki].querySelector('.legacy-notes-and-history-title')||{}).innerText||'').trim();
          var kText = ((noteEls[ki].querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
          var isRealReply = /inbound text|inbound sms|text message|email reply from prospect|email from prospect|inbound phone|inbound call/i.test(kTitle);
          if(kText && kText.length > 3 && isRealReply) inboundMsgs.push(sanitize(kText));
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
          // Calculate how old this message is relative to today
          var msgAgeLabel = '';
          for(var msi=0; msi<Math.min(10, noteEls.length); msi++){
            var msDir = (noteEls[msi].getAttribute('data-direction')||'').toLowerCase();
            if(msDir === 'inbound'){
              var msDate = ((noteEls[msi].querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
              var msMs = msDate ? new Date(msDate).getTime() : 0;
              if(msMs > 0){
                var msDiff = Math.floor((Date.now() - msMs) / (24*60*60*1000));
                if(msDiff === 0) msgAgeLabel = ' [sent TODAY]';
                else if(msDiff === 1) msgAgeLabel = ' [sent YESTERDAY -- any "tomorrow" in this message means TODAY]';
                else msgAgeLabel = ' [sent ' + msDiff + ' days ago -- any "tomorrow" in this message is now ' + (msDiff - 1) + ' days ago]';
              }
              break;
            }
          }
          keySignal = '\nMOST RECENT CUSTOMER MESSAGE' + msgAgeLabel + ': "' + mostRecentInbound.substring(0,200) + '"'
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
        customerConcerns.push('SPOUSE/PARTNER APPROVAL: Customer needs to consult their partner before deciding. A same-day commitment is unlikely - the response should invite both in together or ask when they could both come.');
      }

      // -- Friction type: Comparison shopping ----------------------
      if(/looking at (a few|other|another|some other|multiple)|comparing|checking out (other|a few|another)|shop(ping)? around|other dealer|other options|see what else|not just here/i.test(customerOnlyText)){
        customerConcerns.push('COMPARISON SHOPPING: Customer is actively comparing options. Earn the visit before asking for it - give them one concrete reason this vehicle or store stands out, then read where they are.');
      }

      // -- Friction type: Timeline vague / not urgent ---------------
      if(/not in a rush|no hurry|whenever|eventually|down the road|maybe next month|few months|next year|not right now|when the time (is right|comes)|not urgent/i.test(customerOnlyText)){
        customerConcerns.push('TIMELINE: Customer is not in a rush. Match their pace - no urgency, no pressure. Leave the door open and make it easy to re-engage when they are ready.');
      }

      // -- Friction type: Feature/fit uncertainty -------------------
      if(/not sure (if|whether|it has|this has)|does it have|wondering if|need to know if|want to make sure|confirm.*features|check.*features|see.*features/i.test(customerOnlyText)){
        customerConcerns.push('FEATURE UNCERTAINTY: Customer is not sure this vehicle fits their needs. Answer their specific question first - then the visit becomes the natural next step, not a demand.');
      }

      // -- Customer commitment detector ----------------------------
      // Scans recent inbound messages for explicit commitments or open questions
      var customerCommitments = [];
      var recentInboundText = inboundMsgs.slice(0,3).join(' ').toLowerCase();

      // Explicit day/time commitment
      var dayCommit = recentInboundText.match(/i.ll (come|be there|stop|come in|swing by|head over).{0,30}(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|this week|after work|in the morning|in the afternoon)/i)
        || recentInboundText.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow).{0,20}work(s)? for me/i)
        || recentInboundText.match(/i can (make it|come in|be there).{0,30}/i);
      if(dayCommit) customerCommitments.push('CUSTOMER COMMITTED: Customer said they would come in - "' + dayCommit[0].trim().substring(0,80) + '". Reference this naturally.');

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
        + recentHistory + '\n---\n' // always use cutoff-filtered history
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
    // TEXT fallback: only when no notes exist at all
    if(!lastOutboundMsg && noteEls.length === 0){ var om=TEXT.match(/(?:Sent by:[^\n]*\n)([^\n]{20,300})/); if(om) lastOutboundMsg=om[1].trim(); }

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
          // Collect consecutive inbound messages - customer may have sent multiple texts
          if(!lastInboundMsg) {
            lastInboundMsg = iiContent.substring(0,800);
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
                // Within 10 minutes - prepend (older message first for context)
                var nextContent = ((nextEl.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
                lastInboundMsg = nextContent.substring(0,800) + ' / ' + lastInboundMsg;
              }
            }
            break;
          } else {
            break;
          }
        }
      }
    }
    // TEXT fallback: only use when no notes exist at all (new lead, no history)
    // Do NOT use when notes exist but were filtered by transcriptCutoffMs - that would bypass the cutoff
    if(!lastInboundMsg && noteEls.length === 0){ var im=TEXT.match(/(?:Text Message Reply Received|Inbound Text|Customer replied)[:\s]*([^\n]{10,200})/i); if(im) lastInboundMsg=im[1].trim(); }

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
        // Extract VR deal details for context - these tell us exactly what the customer built
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

    // ?? Appointment timeline - raw facts, no pre-interpretation ??????????????
    // Scrape appointment-related notes and surface them as a factual timeline.
    // The model reads the timeline and decides what it means. No flags. No rules.
    var apptTimeline = [];
    var hasApptSet = false;      // kept for isStalled / stageActive calculations only
    var hasMissedAppt = false;   // kept for persona auto-switch only
    var apptDetails = '';
    var customerRepliedRescheduleFlag = false;

    try {
      var apptNow = Date.now();
      var apptCentralNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      var apptTodayLabel = apptCentralNow.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

      // Scan last 20 notes for appointment-related events, build a chronological timeline
      var apptNotes = [];
      for (var ani = Math.min(noteEls.length, 20) - 1; ani >= 0; ani--) {
        var anEl = noteEls[ani];
        var anDir = (anEl.getAttribute('data-direction') || '').toLowerCase();
        var anTitle = ((anEl.querySelector('.legacy-notes-and-history-title') || {}).innerText || '').toLowerCase();
        var anContent = ((anEl.querySelector('.notes-and-history-item-content') || {}).innerText || '').trim();
        var anDateStr = ((anEl.querySelector('.notes-and-hsitory-item-date') || {}).innerText || '').trim();
        var anMs = anDateStr ? new Date(anDateStr).getTime() : 0;
        var anAge = anMs > 0 ? (apptNow - anMs) : Infinity;
        var anDays = Math.round(anAge / (1000*60*60*24));
        var anLabel = anDays === 0 ? 'today' : anDays === 1 ? 'yesterday' : anDays + ' days ago';

        var isApptRelated = false;
        var apptEvent = '';

        // Appointment confirmation / reminder sent by agent
        if (anDir === 'outbound' && /quick reminder.*appointment|reminder of our appointment|your appointment.*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|reply c to confirm/i.test(anContent)) {
          isApptRelated = true;
          apptEvent = 'Agent sent appointment reminder (' + anLabel + '): "' + anContent.substring(0, 120).replace(/[\r\n]+/g, ' ') + '"';
          if (anDays <= 3) { hasApptSet = true; apptDetails = anContent.substring(0, 250); }
        }
        // System appointment confirmation email
        else if (/email auto response/i.test(anTitle) && /appointment confirmation|reminder.*appointment/i.test(anContent)) {
          isApptRelated = true;
          apptEvent = 'System sent appointment confirmation email (' + anLabel + ')';
          if (anDays <= 3) hasApptSet = true;
        }
        // Missed appointment re-engagement sent by agent
        else if (anDir === 'outbound' && /life is busy|sorry you couldn.t make it|couldn.t make it out|missed.*appointment|reschedule.*convenient|sorry.*miss/i.test(anContent)) {
          isApptRelated = true;
          apptEvent = 'Agent sent missed-appointment re-engagement (' + anLabel + '): "' + anContent.substring(0, 120).replace(/[\r\n]+/g, ' ') + '"';
          hasMissedAppt = true;
          hasApptSet = false;
        }
        // System missed appointment email
        else if (/email auto response/i.test(anTitle) && /missed you|sorry you couldn/i.test(anContent)) {
          isApptRelated = true;
          apptEvent = 'System sent missed-appointment email (' + anLabel + ')';
          hasMissedAppt = true;
          hasApptSet = false;
        }
        // Customer confirmed appointment verbally (call note)
        else if (anDir === 'outbound' && /will be here|will come in|confirmed.*monday|confirmed.*appointment/i.test(anContent)) {
          isApptRelated = true;
          apptEvent = 'Call note: customer verbally confirmed (' + anLabel + '): "' + anContent.substring(0, 100).replace(/[\r\n]+/g, ' ') + '"';
          if (anDays <= 7) hasApptSet = true;
        }
        // Customer replied R to reschedule
        else if (anDir === 'inbound' && /^r$/i.test(anContent.replace(/[\r\n]+.*$/m, '').trim())) {
          isApptRelated = true;
          apptEvent = 'Customer replied "R" (reschedule) (' + anLabel + ')';
          customerRepliedRescheduleFlag = true;
          hasMissedAppt = true;
          hasApptSet = false;
        }
        // Customer inbound with rescheduling language
        else if (anDir === 'inbound' && /need to reschedule|can.t make it|cannot make it|want to reschedule/i.test(anContent)) {
          isApptRelated = true;
          apptEvent = 'Customer requested reschedule (' + anLabel + '): "' + anContent.substring(0, 100).replace(/[\r\n]+/g, ' ') + '"';
          customerRepliedRescheduleFlag = true;
          hasMissedAppt = true;
          hasApptSet = false;
        }

        if (isApptRelated) apptNotes.push(apptEvent);
      }

      if (apptNotes.length) {
        apptTimeline = apptNotes;
      }

      // hasMissedCallBackPromise - keep as raw fact in timeline
      var hasMissedCallBackPromise = false;
      var missedCallBackDetail = '';
      for (var mci = 0; mci < Math.min(10, noteEls.length); mci++) {
        var mcEl = noteEls[mci];
        var mcDir = (mcEl.getAttribute('data-direction') || '').toLowerCase();
        var mcTitle = ((mcEl.querySelector('.legacy-notes-and-history-title') || {}).innerText || '').toLowerCase();
        var mcContent = ((mcEl.querySelector('.notes-and-history-item-content') || {}).innerText || '').trim();
        if (mcDir === 'inbound' && /inbound text|inbound sms|email reply from prospect/i.test(mcTitle)) {
          var cbMatch = /(\d{1,2}:\d{2})\s*(am|pm)?.{0,30}(call|call me|call back)/i.test(mcContent.substring(0, 200))
            || /give me a call|call me back/i.test(mcContent.substring(0, 200));
          if (cbMatch) {
            var cbDateStr = ((mcEl.querySelector('.notes-and-hsitory-item-date') || {}).innerText || '').trim();
            var cbMs = cbDateStr ? new Date(cbDateStr).getTime() : 0;
            if (cbMs > 0 && (Date.now() - cbMs) > 12 * 60 * 60 * 1000) {
              hasMissedCallBackPromise = true;
              missedCallBackDetail = mcContent.substring(0, 150);
              apptTimeline.push('Customer requested a call-back (missed - no call was made): "' + missedCallBackDetail + '"');
            }
          }
        }
        if (mcDir === 'inbound') break;
      }

      // Clear hasApptSet if convState indicates it's already past / irrelevant
      if (hasApptSet && (convState === 'negative-reply' || convState === 'pause' || convState === 'exit')) {
        hasApptSet = false;
        apptDetails = '';
      }
      if (customerRepliedRescheduleFlag) {
        hasApptSet = false;
        hasMissedAppt = true;
      }

    } catch(apptErr) {
      console.log('[Lead Pro] Appointment timeline error:', apptErr);
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

    // -- RELATIONSHIP SIGNALS (v9.7.54, extended v9.7.81) -----------
    // Walk noteEls to extract structured signals about the relationship arc.
    // This produces a digest the model can use to calibrate its response,
    // separate from the raw transcript.
    //
    // Five categories:
    //   - ENGAGEMENT: reply cadence, consecutive outbound, last-reply age (v9.7.54)
    //   - FRICTION: no-shows, frustration signals, pricing objections (v9.7.54)
    //   - TOPIC: recurring conversation threads -- trade, financing, configuration,
    //     distance, use-case, competitor (v9.7.81)
    //   - FORWARD: open commitments (customer + agent) and unanswered questions
    //     (v9.7.81)
    //   - PERSONAL CONTEXT: customer-volunteered facts about themselves -- family,
    //     occupation, life events, geographic, prior vehicles (v9.7.81)
    //
    // CRITICAL: signals are INTERNAL -- model uses them to shape tone, must
    // never reference them directly to the customer. PERSONAL CONTEXT especially
    // must never be echoed as recall.
    var relationshipSignals = (function(){
      var sig = {
        // Engagement
        consecutiveOutboundNoReply: 0,
        lastInboundAgeDays: null,
        totalInboundCount: 0,
        totalOutboundCount: 0,
        // Friction
        priorAppointmentsTotal: 0,
        priorNoShows: 0,
        frustrationSignals: [],
        priorPricingObjections: [],
        // Topic (v9.7.81) -- recurring conversation threads
        // Each topic: { count: N, mentions: [{date, sentence}], categories used as keys }
        topicMentions: {
          trade: { count: 0, mentions: [] },
          financing: { count: 0, mentions: [] },
          configuration: { count: 0, mentions: [] },
          distance: { count: 0, mentions: [] },
          useCase: { count: 0, mentions: [] },
          competitor: { count: 0, mentions: [] }
        },
        // Forward (v9.7.81) -- open commitments and unanswered questions
        customerCommitments: [],   // { date, sentence } -- "I'll come by Saturday"
        agentCommitments: [],      // { date, sentence } -- "I'll send pics"
        unansweredQuestions: [],   // { date, question } -- inbound questions with no matching outbound after
        // Relational (v9.7.81) -- personal context customer has volunteered
        personalContext: [],       // { date, type, sentence } -- family/occupation/event/geo/prior-vehicle
        // Computed flags (set by interpretation step)
        channelFatigue: false,
        hasNoShowHistory: false,
        hasFrustrationHistory: false,
        hasPricingFriction: false,
        // (v9.7.81) new computed flags
        hasRecurringTopic: false,
        hasOpenCommitments: false,
        hasUnansweredQuestions: false,
        hasPersonalContext: false
      };

      if (!noteEls || !noteEls.length) return sig;

      // Helper: parse VinSolutions date strings like "05/09/2026 12:27 PM"
      function parseNoteDate(s){
        if (!s) return null;
        // Try native Date first -- handles most formats VinSolutions emits
        try {
          var nat = new Date(s).getTime();
          if (!isNaN(nat) && nat > 0) return nat;
        } catch(e) {}
        // Fallback regex for unusual formats
        var m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (!m) return null;
        var mo = parseInt(m[1],10), dy = parseInt(m[2],10), yr = parseInt(m[3],10);
        if (yr < 100) yr += 2000;
        var hr = parseInt(m[4],10), mn = parseInt(m[5],10);
        var ampm = (m[6]||'').toUpperCase();
        if (ampm === 'PM' && hr < 12) hr += 12;
        if (ampm === 'AM' && hr === 12) hr = 0;
        try { return new Date(yr, mo-1, dy, hr, mn, 0).getTime(); } catch(e) { return null; }
      }

      // Walk newest-first (VinSolutions DOM order is newest-first)
      // Engagement: count consecutive outbound from top until first inbound
      var sawInbound = false;
      var lastInboundTs = null;

      for (var i = 0; i < noteEls.length; i++) {
        var n = noteEls[i];
        var dir = (n.getAttribute('data-direction')||'').toLowerCase();
        var title = ((n.querySelector('.legacy-notes-and-history-title')||{}).innerText||'').toLowerCase();
        var body = ((n.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
        var dateStr = ((n.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
        var bodyLower = body.toLowerCase();

        // Tally totals (only count actual messages, not system notes)
        // Counts: text messages, emails, phone calls (both directions), voicemails left.
        // VinSolutions title patterns: "Inbound Text Message", "Outbound Text Message",
        // "Email reply to prospect", "Inbound phone call", "Outbound phone call (Machine)",
        // "Voicemail", etc.
        var isMessage = /text message|email|phone call|voicemail|inbound|outbound|received|sent|left.*message/i.test(title) || dir === 'inbound' || dir === 'outbound';
        if (isMessage) {
          // For phone calls without explicit data-direction, infer direction from title
          var resolvedDir = dir;
          if (!resolvedDir) {
            if (/^\s*(inbound|received)/i.test(title)) resolvedDir = 'inbound';
            else if (/^\s*(outbound|sent|left)/i.test(title) || /outbound\s+(phone|call)/i.test(title) || /^\s*voicemail\b/i.test(title)) resolvedDir = 'outbound';
          }
          if (resolvedDir === 'inbound') {
            sig.totalInboundCount++;
            if (!sawInbound) {
              sawInbound = true;
              lastInboundTs = parseNoteDate(dateStr);
            }
          } else if (resolvedDir === 'outbound') {
            sig.totalOutboundCount++;
            if (!sawInbound) sig.consecutiveOutboundNoReply++;
          }
        }

        // Friction: appointment history
        // Match Showroom Visit notes AND appt-set/missed system entries
        if (/showroom\s*visit|appointment\s*set|appt\s*set|appointment\s*confirmed/i.test(title)) {
          sig.priorAppointmentsTotal++;
        }
        if (/missed\s*appointment|no.?show|did\s*not\s*show|customer\s*missed|appt.*missed|missed.*visit/i.test(title) ||
            /\bno.?show\b|\bdidn.?t\s*show\s*up\b|\bdid\s*not\s*show\s*(up|for)\b|\bnever\s*(showed|came|arrived)\b|\bmissed\s*(the\s*)?(appointment|appt|visit)\b/i.test(bodyLower)) {
          sig.priorNoShows++;
        }

        // Friction: frustration signals (inbound only -- customer frustration)
        if (dir === 'inbound' && body) {
          var frustWords = /\b(frustrated|frustrating|annoyed|annoying|wrong number|leave me alone|stop texting|stop calling|stop contacting|disappointed|upset|fed up|ridiculous|unprofessional|harassment|harassing)\b/i;
          if (frustWords.test(body)) {
            // Capture surrounding sentence
            var sentMatch = body.match(/[^.!?\n]*\b(?:frustrated|frustrating|annoyed|annoying|wrong number|leave me alone|stop texting|stop calling|stop contacting|disappointed|upset|fed up|ridiculous|unprofessional|harassment|harassing)\b[^.!?\n]*/i);
            sig.frustrationSignals.push({
              date: dateStr,
              sentence: (sentMatch ? sentMatch[0] : body.substring(0,140)).trim().substring(0,140)
            });
          }
        }

        // Friction: pricing objections (inbound only)
        if (dir === 'inbound' && body) {
          var priceObj = /\b(too expensive|too high|too much|out of my (range|budget|price)|can.?t afford|cannot afford|over budget|over my budget|price is too|payment is too high|monthly is too|lower payment|cheaper options?|less expensive|need.*lower price|come down on (the )?price)\b/i;
          if (priceObj.test(bodyLower)) {
            var poMatch = body.match(/[^.!?\n]*\b(?:too expensive|too high|too much|out of my (?:range|budget|price)|can.?t afford|cannot afford|over budget|over my budget|price is too|payment is too high|monthly is too|lower payment|cheaper options?|less expensive|come down on)\b[^.!?\n]*/i);
            sig.priorPricingObjections.push({
              date: dateStr,
              sentence: (poMatch ? poMatch[0] : body.substring(0,140)).trim().substring(0,140)
            });
          }
        }

        // (v9.7.81) TOPIC: recurring conversation threads — both directions count, but
        // dedupe so a single note can't count for the same topic twice. Detects category
        // by keyword; captures one short snippet per match.
        if (body && body.length > 0) {
          var topicPatterns = {
            trade:         /\b(trade.?in|trade.?value|appraisal|kbb|kelley blue book|payoff|my (current|old) (car|vehicle|truck|suv))\b/i,
            financing:     /\b(financ\w+|credit (app|application|score|union)|down ?payment|monthly payment|interest rate|apr|prequalif\w+|approval|loan|lease (offer|payment|term)|cosigner|co.?signer)\b/i,
            configuration: /\b(color|colour|trim|package|spec|interior|exterior|wheels?|sunroof|moonroof|leather|cloth|awd|fwd|hybrid|seats?|cargo|towing capacity|engine option|infotainment|sound system)\b/i,
            distance:      /\b(driv\w+ (from|down|up|over)|com\w+ from|out of (state|town)|live in|hour.? away|miles? away|trip\w*|out.of.town|long drive|how far)\b/i,
            useCase:       /\b(my (kids?|wife|husband|family|daughter|son|baby)|work commut\w+|drive to work|kids? in|family (car|vehicle|hauler)|towing|hauling|road trip|daily driver|new baby|just had a (baby|kid)|getting married)\b/i,
            competitor:    /\b(toyota|honda|ford|chevy|chevrolet|nissan|hyundai|kia|mazda|subaru|jeep|ram|gmc|dodge|buick|cadillac|lincoln|acura|infiniti|lexus|bmw|mercedes|audi|volkswagen|vw|tesla|volvo|porsche|other dealer\w*|another dealership|shopping around|comparing|cross.?shop)\b/i
          };
          for (var topicKey in topicPatterns) {
            if (topicPatterns[topicKey].test(body)) {
              var topicMatch = body.match(new RegExp('[^.!?\\n]*' + topicPatterns[topicKey].source + '[^.!?\\n]*', 'i'));
              sig.topicMentions[topicKey].count++;
              if (sig.topicMentions[topicKey].mentions.length < 3) {
                sig.topicMentions[topicKey].mentions.push({
                  date: dateStr,
                  sentence: (topicMatch ? topicMatch[0] : body.substring(0,140)).trim().substring(0,140)
                });
              }
            }
          }
        }

        // (v9.7.81) FORWARD - CUSTOMER COMMITMENTS: things the customer said they would do.
        // Inbound only. Pattern: "I'll [verb]" / "I will [verb]" / "let me [verb]" with
        // forward-looking verbs. Avoid past-tense and non-commitment uses.
        if (dir === 'inbound' && body) {
          var custCommitRe = /\b(i.ll|i will|let me|gonna|going to|i.m gonna|i.m going to)\s+(stop by|come by|come in|swing by|drop by|be there|be in|check|think about|talk to|talk it over|let you know|get back to you|review|look at|consider|decide|run it by|sleep on it|figure out|reach out|call|text|email)\b/i;
          if (custCommitRe.test(body)) {
            var ccMatch = body.match(/[^.!?\n]*\b(?:i.ll|i will|let me|gonna|going to)\s+(?:stop by|come by|come in|swing by|drop by|be there|be in|check|think about|talk to|talk it over|let you know|get back to you|review|look at|consider|decide|run it by|sleep on it|figure out|reach out|call|text|email)\b[^.!?\n]*/i);
            sig.customerCommitments.push({
              date: dateStr,
              sentence: (ccMatch ? ccMatch[0] : body.substring(0,140)).trim().substring(0,140)
            });
          }
        }

        // (v9.7.81) FORWARD - AGENT COMMITMENTS: things the agent said they would do.
        // Outbound only. Pattern: "I'll [verb]" / "I will [verb]" with action verbs that
        // create expectations (send, call, text, get, have ready, schedule, follow up).
        if (dir === 'outbound' && body) {
          var agentCommitRe = /\b(i.ll|i will|will (have|get|send|call|text|email)|going to (send|get|have|call|text|email))\s+(send|get|have|reach out|call|text|email|follow ?up|check|schedule|line up|grab|pull|set up|put together|find out|confirm|get back|circle back)\b/i;
          if (agentCommitRe.test(body)) {
            var acMatch = body.match(/[^.!?\n]*\b(?:i.ll|i will|will (?:have|get|send|call|text|email))\s+(?:send|get|have|reach out|call|text|email|follow ?up|check|schedule|line up|grab|pull|set up|put together|find out|confirm|get back|circle back)\b[^.!?\n]*/i);
            sig.agentCommitments.push({
              date: dateStr,
              sentence: (acMatch ? acMatch[0] : body.substring(0,140)).trim().substring(0,140),
              ts: parseNoteDate(dateStr)
            });
          }
        }

        // (v9.7.81) RELATIONAL - PERSONAL CONTEXT: things the customer volunteered.
        // Inbound only. Captures family, occupation, life events, geographic, prior-vehicle
        // mentions that signal personhood -- model can calibrate warmth without surfacing.
        if (dir === 'inbound' && body) {
          var pcPatterns = {
            family:        /\b(my (wife|husband|spouse|partner|kids?|daughter|son|family|mom|mother|dad|father|brother|sister|in.?laws?))\b/i,
            occupation:    /\b(my job|my work|i work (at|for|as|in)|i.m a (teacher|nurse|doctor|engineer|driver|contractor|mechanic|operator|technician|manager|sales|owner)|i drive for|work commut\w+|on the road|self.?employed|retired|active duty|military|deploy\w+)\b/i,
            lifeEvent:     /\b(just had a (baby|kid)|new baby|getting married|just got married|moving|relocat\w+|new (job|position)|just (started|finished) (school|college|deployment)|graduat\w+|expecting)\b/i,
            geographic:    /\b(i live in|from|driv\w+ from|com\w+ from|hour.? (from|away)|out of town|out of state|local to|i.m in)\s+[A-Z][a-z]+/,
            priorVehicle:  /\b(my (current|old|previous|last) (car|vehicle|truck|suv|sedan|coupe)|trading (in|my)|i.ve (had|owned|been driving)|owned (a|my)|drove (a|my)|loyal to)\b/i
          };
          for (var pcKey in pcPatterns) {
            if (pcPatterns[pcKey].test(body)) {
              var pcMatch = body.match(new RegExp('[^.!?\\n]*' + pcPatterns[pcKey].source + '[^.!?\\n]*', pcKey === 'geographic' ? '' : 'i'));
              sig.personalContext.push({
                date: dateStr,
                type: pcKey,
                sentence: (pcMatch ? pcMatch[0] : body.substring(0,140)).trim().substring(0,140)
              });
            }
          }
        }
      }

      // Last inbound age (days)
      if (lastInboundTs) {
        sig.lastInboundAgeDays = Math.round((Date.now() - lastInboundTs) / (1000*60*60*24) * 10) / 10;
      }

      // (v9.7.81) UNANSWERED QUESTIONS: walk oldest-first this time and identify
      // inbound questions whose topic doesn't appear in subsequent outbound messages.
      // Limited to last 5 inbound questions on the lead to avoid scanning ancient history.
      // The check is loose -- looks for any shared content word (4+ chars) between
      // the question and the next outbound. Misses are conservatively flagged.
      (function detectUnansweredQuestions() {
        // Collect inbound questions oldest-first with their note index
        var inboundQuestions = [];
        for (var qi = noteEls.length - 1; qi >= 0; qi--) {
          var qn = noteEls[qi];
          var qdir = (qn.getAttribute('data-direction')||'').toLowerCase();
          if (qdir !== 'inbound') continue;
          var qbody = ((qn.querySelector('.notes-and-history-item-content')||{}).innerText||'').trim();
          if (!qbody || qbody.length < 8) continue;
          // Find sentences ending with ?
          var qs = qbody.match(/[^.!?\n]{8,200}\?/g);
          if (!qs) continue;
          var qdate = ((qn.querySelector('.notes-and-hsitory-item-date')||{}).innerText||'').trim();
          var qts = parseNoteDate(qdate);
          for (var qsi = 0; qsi < qs.length; qsi++) {
            inboundQuestions.push({
              date: qdate, ts: qts, question: qs[qsi].trim().substring(0,200), noteIdx: qi
            });
          }
        }
        // Keep only the last 5 inbound questions chronologically
        inboundQuestions = inboundQuestions.slice(-5);
        // For each question, check if any subsequent outbound (lower index, since DOM is newest-first)
        // contains a shared content word
        for (var iqi = 0; iqi < inboundQuestions.length; iqi++) {
          var iq = inboundQuestions[iqi];
          // Extract content words from the question (4+ chars, skip stopwords)
          var stopwords = /^(what|when|where|which|whose|whom|that|this|these|those|with|from|have|will|would|could|should|about|there|their|they|them|then|than|because|just|like|need|want|know|much|many|more|some|any|the|and|but|for|are|you|your|can|did|does|how|why|who|its|it|is|to|of|in|on|at|do|i|a|an|or|so|if|be|am|as|by|me|my)$/i;
          var qWords = (iq.question.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
                       .filter(function(w){ return !stopwords.test(w); });
          if (qWords.length === 0) continue;
          // Check outbound notes that came AFTER this question
          var answered = false;
          for (var oi = iq.noteIdx - 1; oi >= 0 && !answered; oi--) {
            var on = noteEls[oi];
            var odir = (on.getAttribute('data-direction')||'').toLowerCase();
            if (odir !== 'outbound') continue;
            var obody = ((on.querySelector('.notes-and-history-item-content')||{}).innerText||'').toLowerCase();
            if (!obody) continue;
            // Count word overlaps
            var hits = 0;
            for (var wi = 0; wi < qWords.length; wi++) {
              if (obody.indexOf(qWords[wi]) >= 0) hits++;
              if (hits >= 2) break;
            }
            if (hits >= 2) { answered = true; break; }
          }
          if (!answered) {
            sig.unansweredQuestions.push({ date: iq.date, question: iq.question });
          }
        }
        // Cap at 3 to avoid noise
        sig.unansweredQuestions = sig.unansweredQuestions.slice(-3);
      })();

      // Computed interpretation flags
      sig.channelFatigue = sig.consecutiveOutboundNoReply >= 3;
      sig.hasNoShowHistory = sig.priorNoShows > 0;
      sig.hasFrustrationHistory = sig.frustrationSignals.length > 0;
      sig.hasPricingFriction = sig.priorPricingObjections.length > 0;
      // (v9.7.81) New computed flags
      sig.hasRecurringTopic = (function(){
        for (var k in sig.topicMentions) {
          if (sig.topicMentions[k].count >= 2) return true;
        }
        return false;
      })();
      sig.hasOpenCommitments = sig.customerCommitments.length > 0 || sig.agentCommitments.length > 0;
      sig.hasUnansweredQuestions = sig.unansweredQuestions.length > 0;
      sig.hasPersonalContext = sig.personalContext.length > 0;

      return sig;
    })();

    return {
      isLeadFrame,autoLeadId,dealerId,customerId,
      store,name,email,phone,agent,salesRep,manager,
      vehicle,vehicleRaw,color,condition,stockNum,vin,inventoryWarning:inventoryWarningFinal,vehiclePendingSale,noSpecificVehicle,ownedVehicle,ampEmailSubject,ownedMileage,lastServiceDate,leadAgeDays,equityData,equityAmount,equityVehicle,
      leadSource,leadStatus: currentStatus || leadStatus,hasTrade,tradeDescription,buyingSignals,
      history, totalNoteCount, hasOutbound, isContacted, contactedAgeDays, lastOutboundMsg, lastInboundMsg: lastInboundMsg||leadReceivedCustomerQuestion,
      hasPauseSignal, hasExitSignal, isSmsOptOutOnly, hasTextOrEmailSent, convState,
      vrMonthlyPayment, vrDownPayment, vrCreditScore, vrAPR, vrTerm, vrLender, conversationBrief, customerSaidNotToday, customerScheduleConstraint, isLiveConversation, isRecentOutbound, recentOutboundContent,
      email: (isMaskedEmail ? '' : buyerEmail),
      isInTransit, hasApptSet, apptDetails, isSoldDelivered, hasMissedAppt, customerRepliedReschedule: customerRepliedRescheduleFlag, apptTimeline, hasMissedCallBackPromise, missedCallBackDetail, vrCreditApp, vrPaymentSelected, vrTradeIn, vrCompleted, vrDroppedOff, noVehicleAtAll, agentLPCommands, contactRecoveryPhone, contactRecoveryEmail, isMaskedEmail, isSRPVehicle, isVelocityResponse, isLandline,
      isShowroomFollowUp, showroomDetails, showroomVisitToday,
      pastVisitNotes,
      hasConfirmedVisit,
      relationshipSignals,
      pageSnippet:TEXT.substring(0,8000),
      scrapedAt:Date.now(),
      // (v9.7.51) Frame freshness signals -- used to identify which iframe was
      // most recently loaded. When VinSolutions SPA shell holds multiple
      // iframes loaded with different leads (user navigated between leads,
      // some iframes lag), the freshly-loaded one is the lead user is viewing.
      // Stale iframes from prior nav have older load times.
      frameLoadedAt: (function(){
        try {
          // Modern: PerformanceNavigationTiming
          var navEntries = performance.getEntriesByType ? performance.getEntriesByType('navigation') : [];
          if (navEntries && navEntries.length > 0) {
            // navEntry.responseEnd is high-res relative to timeOrigin
            return Math.round(performance.timeOrigin + navEntries[0].responseEnd);
          }
          // Legacy: performance.timing
          if (performance && performance.timing && performance.timing.responseEnd) {
            return performance.timing.responseEnd;
          }
        } catch(e) {}
        return 0;
      })(),
      // hasActiveLeadPanel: true if THIS frame currently has an active lead
      // panel rendered with VehicleInfo span containing real content (not
      // empty placeholder). Stale-but-prior-active iframes will also have
      // this true, so this is a NECESSARY but not SUFFICIENT signal --
      // combine with frameLoadedAt to pick the freshly-rendered one.
      hasActiveLeadPanel: (function(){
        try {
          var v = document.getElementById('ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo')
               || document.getElementById('ActiveLeadPanel1_m_VehicleInfo');
          if (!v) return false;
          var t = (v.innerText || v.textContent || '').trim();
          return t.length > 0 && !/click to add/i.test(t);
        } catch(e) { return false; }
      })(),
      // (v9.7.59) isActiveStatus: true if THIS frame's lead has Status: Active
      // VinSolutions marks the currently-worked record as "Active" or "Active New Lead".
      // Duplicate leads for the same customer (same person, different sources) display
      // alternate statuses like "Sold", "Lost", "Bad", "Closed", etc. When multiple
      // frames have active panels, prefer the one whose lead is marked Active.
      isActiveStatus: (function(){
        try {
          var s = document.getElementById('ActiveLeadPanelWONotesAndHistory1_m_LeadStatusLabel')
               || document.getElementById('ActiveLeadPanel1_m_LeadStatusLabel');
          if (!s) return false;
          var t = ((s.innerText || s.textContent || '') + '').trim().toLowerCase();
          // Match Active, Active New Lead, etc. Reject Sold, Lost, Bad, Closed, etc.
          return /^active\b/i.test(t);
        } catch(e) { return false; }
      })(),
      // (v9.7.59) leadStatusText: raw status string for diagnostic logging
      leadStatusText: (function(){
        try {
          var s = document.getElementById('ActiveLeadPanelWONotesAndHistory1_m_LeadStatusLabel')
               || document.getElementById('ActiveLeadPanel1_m_LeadStatusLabel');
          if (!s) return '';
          return ((s.innerText || s.textContent || '') + '').trim();
        } catch(e) { return ''; }
      })()
    };
  } // end inlineScraper

  // Inject into all frames — each returns a Promise that resolves when notes are ready
  chrome.scripting.executeScript(
    { target: { tabId: tab.id, allFrames: true }, func: function() {
      // Inline polling scraper — waits for notes DOM then returns data
      // (v9.7.83) Tightened hydration check. Original resolved on
      // (noteCount > 0 || hasLeadInfo) — when a lead-info marker hydrated
      // BEFORE notes did, the wait resolved prematurely and the scraper ran
      // against a half-loaded DOM. Result: notes=0, phone undefined,
      // transcript empty, even though the page had all the data moments
      // later (visible to a DevTools diagnostic). The Rolando case (Honda
      // Baytown, 26 notes in DOM but 0 scraped) showed this exact pattern.
      // Fix: require BOTH a lead-info marker (we're on a lead) AND notes
      // hydration (the data is loaded). Timeout cap unchanged at 4s.
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
        // (v9.7.83) Require BOTH conditions, not OR. Frames that don't have
        // either marker (e.g. ECCS, Loading.gif, top frame) just wait out the
        // maxWait timeout — which is the correct behavior since they have no
        // lead data to wait for and will return their empty state on timeout.
        // Frames that DO have lead markers wait for both to be present.
        var bothReady = (noteCount > 0 && hasLeadInfo);
        if (bothReady || elapsed >= maxWait) { resolve(); }
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
          // derive it from frame data. Two-tier strategy:
          //
          // TIER 1 (v9.7.51): Newest-loaded active lead frame wins.
          //   When VinSolutions SPA shell holds multiple iframes loaded with
          //   different leads (user switched leads, some iframes lag), the
          //   freshly-loaded one is the lead user is currently viewing. We
          //   compare frameLoadedAt timestamps and pick the newest frame that
          //   has both an active lead panel rendered AND an autoLeadId.
          //   This is the Anna Theus pattern: iframes for old lead 2013153649
          //   linger in DOM tree alongside new lead 2013150224's freshly-
          //   loaded frame.
          //
          // TIER 2 (legacy): Vote-based — only frames with active-lead-page
          //   evidence (notes loaded or isLeadFrame) vote. Used when no
          //   frame has both freshness AND a lead panel.
          //
          // (v9.7.51 lesson learned) Do NOT use inner iframe URLs (e.g. ECCS
          // cdQuery) to override active-lead detection. Inner iframe URLs lag
          // during SPA transitions just like DOM markers do. Frame load
          // timing is the only signal that distinguishes "freshly-rendered
          // by parent navigation" from "still showing previous lead".
          if (!window._activeLeadId) {
            // TIER 1: Pick newest-loaded frame with active lead panel
            var freshCandidates = [];
            for (var fi = 0; fi < sorted.length; fi++) {
              var fr = sorted[fi].result;
              if (!fr || !fr.autoLeadId) continue;
              if (!fr.hasActiveLeadPanel) continue;
              if (!fr.frameLoadedAt) continue;
              freshCandidates.push({ leadId: fr.autoLeadId, loadedAt: fr.frameLoadedAt, isActiveStatus: !!fr.isActiveStatus, statusText: fr.leadStatusText || '' });
            }
            // (v9.7.59) STATUS-PRIORITY FILTER:
            // If any candidate has Status: Active, prefer only those. VinSolutions creates
            // duplicate lead records when the same customer comes in through multiple sources
            // (Truecar + Facebook, Cargurus + Walk-In, etc). Only one of those records is
            // typically marked Active -- the rest are Sold/Lost/Bad/Closed. The newest-frame
            // heuristic alone can pick a stale dupe; status text is the cue VinSolutions
            // gives us to disambiguate.
            var hasAnyActive = freshCandidates.some(function(c){ return c.isActiveStatus; });
            if (hasAnyActive) {
              var beforeCount = freshCandidates.length;
              freshCandidates = freshCandidates.filter(function(c){ return c.isActiveStatus; });
              if (beforeCount !== freshCandidates.length) {
                console.log('[Lead Pro] Status-priority filter: kept ' + freshCandidates.length + ' Active candidate(s), dropped ' + (beforeCount - freshCandidates.length) + ' non-Active dupe(s)');
              }
            }
            // Sort newest-first
            freshCandidates.sort(function(a,b){ return b.loadedAt - a.loadedAt; });
            // If we have multiple candidates and the newest one is significantly
            // newer than the second (>3 seconds), trust it absolutely. Otherwise
            // we may be looking at simultaneously-loaded frames for the same lead.
            if (freshCandidates.length > 0) {
              var newest = freshCandidates[0];
              var secondNewest = freshCandidates[1];
              // Confidence check: if there's a clear gap, newest wins outright.
              // If multiple frames loaded within 3 seconds of each other, they
              // likely belong to the same lead -- pick the newest as a fine
              // tiebreaker but log low confidence.
              var gap = secondNewest ? (newest.loadedAt - secondNewest.loadedAt) : Infinity;
              window._activeLeadId = newest.leadId;
              console.log('[Lead Pro] _activeLeadId from newest frame:', newest.leadId,
                '(loadedAt:', new Date(newest.loadedAt).toISOString().substring(11,19),
                '| candidates:', freshCandidates.length,
                '| gap to next:', gap === Infinity ? 'n/a' : gap + 'ms',
                '| status:', newest.statusText || '(none)', ')');
            } else {
              // TIER 2: Legacy vote-based fallback
              var leadIdCounts = {};
              var leadIdStatus = {}; // (v9.7.59) Track which leads are Active
              var leadIdStatusText = {}; // For diagnostic log
              for (var fi2 = 0; fi2 < sorted.length; fi2++) {
                var fres = sorted[fi2].result;
                if (!fres || !fres.autoLeadId) continue;
                var hasLeadEvidence = (fres.totalNoteCount && fres.totalNoteCount > 0) || fres.isLeadFrame;
                if (!hasLeadEvidence) continue;
                leadIdCounts[fres.autoLeadId] = (leadIdCounts[fres.autoLeadId] || 0) + 1;
                // OR-merge: any frame with isActiveStatus marks the lead as Active.
                if (fres.isActiveStatus) leadIdStatus[fres.autoLeadId] = true;
                if (fres.leadStatusText && !leadIdStatusText[fres.autoLeadId]) {
                  leadIdStatusText[fres.autoLeadId] = fres.leadStatusText;
                }
              }
              // (v9.7.59) STATUS-PRIORITY: if any candidate is Active, restrict the
              // vote to Active-status leads only. Same logic as TIER 1.
              var anyActiveInVote = Object.keys(leadIdStatus).length > 0;
              if (anyActiveInVote) {
                var filteredCounts = {};
                for (var lid_a in leadIdCounts) {
                  if (leadIdStatus[lid_a]) filteredCounts[lid_a] = leadIdCounts[lid_a];
                }
                var droppedCount = Object.keys(leadIdCounts).length - Object.keys(filteredCounts).length;
                if (droppedCount > 0) {
                  console.log('[Lead Pro] Status-priority filter (vote): kept ' + Object.keys(filteredCounts).length + ' Active lead(s), dropped ' + droppedCount + ' non-Active dupe(s)');
                }
                leadIdCounts = filteredCounts;
              }
              var bestLeadId = '', bestCount = 0;
              for (var lid in leadIdCounts) {
                if (leadIdCounts[lid] > bestCount) { bestCount = leadIdCounts[lid]; bestLeadId = lid; }
              }
              // Last resort: any autoLeadId from any frame with data
              if (!bestLeadId) {
                for (var fj = 0; fj < sorted.length; fj++) {
                  if (sorted[fj].result && sorted[fj].result.autoLeadId) {
                    bestLeadId = sorted[fj].result.autoLeadId;
                    break;
                  }
                }
              }
              if (bestLeadId) {
                window._activeLeadId = bestLeadId;
                console.log('[Lead Pro] _activeLeadId derived from frames:', bestLeadId, '(votes:', bestCount, '| status:', leadIdStatusText[bestLeadId] || '(none)', ')');
              }
            }
          }
          var _aid = window._activeLeadId || '';
          var _activeCustomerId = ''; // Captured from confirmed-active-lead frames
          var _pass1HadActiveFrame = false; // (v9.7.51) True if any frame matched _aid

          // PASS 1: Merge frames with autoLeadId matching the active lead.
          // These are CONFIRMED to belong to this lead. Capture customerId for pass 2.
          for (const frame of sorted) {
            const d = frame.result; if (!d) continue;
            // Reject frames from a different lead — autoLeadId mismatch
            if (_aid && d.autoLeadId && d.autoLeadId !== _aid) {
              console.log('[Lead Pro] Frame rejected — autoLeadId mismatch:', d.autoLeadId, '!==', _aid);
              continue;
            }
            // Skip frames without autoLeadId in this pass — they go to pass 2
            if (!d.autoLeadId) continue;
            _pass1HadActiveFrame = true; // PASS 1 authoritatively scraped the active lead
            // This frame is confirmed-active. Capture customerId if present.
            if (d.customerId && !_activeCustomerId) _activeCustomerId = d.customerId;
            // Track best store across confirmed frames — prefer more specific names
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
                if (!m[k] && d[k]) m[k] = d[k];
                else if (d[k] && d[k].length > (m[k]||'').length) m[k] = d[k];
              } else if (!m[k] && d[k]) {
                m[k]=d[k];
              }
            }
          }

          // PASS 2: Merge frames WITHOUT autoLeadId (customer-level frames like ECCS).
          // These can contaminate dealerId/store from a stale previous lead's customer page.
          // Only accept their fields if customerId matches the active lead's customer.
          // If we don't have an active customerId yet (sparse pass 1), be conservative —
          // only merge fields the lead-page frames couldn't supply at all (vehicle, etc.).

          // RECOVERY (v9.7.45): If PASS 1 didn't capture _activeCustomerId (rims2's
          // vindebug-section-wrap was still loading or empty), establish it from the
          // most-voted customerId across customer-level frames. If multiple frames agree
          // on a customerId, that's the active customer with high confidence.
          if (!_activeCustomerId) {
            var custIdVotes = {};
            for (const frame of sorted) {
              const d = frame.result;
              if (!d || d.autoLeadId) continue; // only consider customer-level frames
              if (d.customerId) custIdVotes[d.customerId] = (custIdVotes[d.customerId] || 0) + 1;
            }
            var bestCustId = '', bestCustVotes = 0;
            for (var cid in custIdVotes) {
              if (custIdVotes[cid] > bestCustVotes) { bestCustVotes = custIdVotes[cid]; bestCustId = cid; }
            }
            // Require >=2 votes to establish — single-vote could be stale frame
            if (bestCustId && bestCustVotes >= 2) {
              _activeCustomerId = bestCustId;
              console.log('[Lead Pro] _activeCustomerId established from PASS 2 votes:', bestCustId, '(votes:', bestCustVotes, ')');
            }
          }

          for (const frame of sorted) {
            const d = frame.result; if (!d) continue;
            if (d.autoLeadId) continue; // already handled in pass 1
            // Cross-lead customer contamination guard
            if (_activeCustomerId && d.customerId && d.customerId !== _activeCustomerId) {
              console.log('[Lead Pro] Frame rejected — customerId mismatch:', d.customerId, '!==', _activeCustomerId);
              continue;
            }
            // Frame matches (or no customerId info either way) — merge cautiously.
            // For identity fields (dealerId, store, name, agent, salesRep, manager,
            // vehicle, vehicleRaw, condition, stockNum, vin), require a customerId
            // match. Without one, do not let customer-level frames supply them.
            //
            // CRITICAL (v9.7.51): vehicle is gated. Customer-level frames (Customer
            // Dashboard, Sale Info, lead grid) contain ALL leads tied to this
            // customer — including old sold leads with their old purchased vehicle.
            // For repeat customers, that old vehicle would bleed into the active
            // lead's vehicle field. The active lead's rims2 frame (PASS 1) is the
            // only authoritative source for vehicle of interest. Empty there means
            // "no specific vehicle picked yet" — that's a real value the model
            // should respect, not a gap to fill from customer history.
            var _customerVerified = !!(_activeCustomerId && d.customerId && d.customerId === _activeCustomerId);
            if (d.store && _customerVerified && (!bestStore || d.store.length > bestStore.length)) bestStore = d.store;
            for (const k of Object.keys(d)) {
              var _isIdentityField = (k === 'dealerId' || k === 'store' || k === 'name' || k === 'agent' || k === 'salesRep' || k === 'manager' || k === 'customerId' || k === 'phone' || k === 'email' || k === 'vehicle' || k === 'vehicleRaw' || k === 'condition' || k === 'stockNum' || k === 'vin');
              if (_isIdentityField && !_customerVerified) continue;
              if (['hasTrade','inventoryWarning','isLeadFrame','hasExitSignal','hasPauseSignal','hasOutbound','isContacted','isInTransit','hasApptSet','isShowroomFollowUp'].includes(k)) {
                if(d[k]) m[k]=true;
              } else if (k === 'store') {
                // Handled separately via bestStore
              } else if (historyFields.has(k)) {
                if (!m[k] && d[k]) m[k] = d[k];
              } else if (k==='pageSnippet') {
                m[k]=(m[k]||'')+' '+(d[k]||'');
              } else if (k==='vehicle') {
                // (v9.7.51) PASS 1 wins for vehicle — period. If any frame in
                // PASS 1 matched the active leadId, that frame is the authoritative
                // source for vehicle of interest. Empty there means "no specific
                // vehicle picked yet" (e.g. "(New)" with no model in the active
                // lead). Customer-level frames must NOT fill that gap, even when
                // customerId matches — repeat customers have OLD leads with
                // OLD purchased vehicles attached to the same customer record.
                //
                // Only allow PASS 2 vehicle when PASS 1 had no active frame at all
                // (rims2 didn't load, or AI Buying Signals lead with no rims2 panel).
                if (!_pass1HadActiveFrame && !m[k] && d[k]) m[k] = d[k];
                // No length-based overwrite under any condition.
              } else if (!m[k] && d[k]) {
                m[k]=d[k];
              }
            }
          }
          // Set best store after all frames processed
          m.store = bestStore;

          // (v9.7.52) DEALER ID IS SOURCE OF TRUTH FOR STORE NAME.
          // VinSolutions UI shows the user's currently-selected dealer tab
          // in the parent frame chrome. When Jolette has Audi Lafayette tab
          // open in her session and grabs a Honda Lafayette lead, ECCS
          // frame's storeFromUrl reads the parent tab text "Audi Lafayette"
          // even though the lead's dealerId is 24399 (Honda Lafayette).
          // That leak routes the persona to "concierge (Audi default)" on
          // Honda leads — wrong store voice across the entire session.
          //
          // The lead's dealerId from vindebug DOM marker is authoritative.
          // Always overwrite m.store from DEALER_ID_MAP when dealerId is set.
          // The text-scraped store value is a fallback ONLY for cases where
          // dealerId can't be resolved.
          if (m.dealerId && DEALER_ID_MAP[String(m.dealerId)]) {
            var _canonicalStore = DEALER_ID_MAP[String(m.dealerId)];
            if (m.store !== _canonicalStore) {
              console.log('[Lead Pro] Store override: "' + m.store + '" -> "' + _canonicalStore + '" (from dealerId ' + m.dealerId + ')');
              m.store = _canonicalStore;
            }
          }

          // (v9.7.82) VINDEBUG DEALERID RESCUE — runs BEFORE the pageSnippet
          // fallback below. Frame merge can lose dealerId when the active-lead
          // disambiguation rejects the frame that carried the vindebug element
          // (e.g. two rims2 iframes in the DOM, the older one wins the lead-ID
          // vote, the newer one — which has the correct vindebug attributes —
          // gets rejected as a mismatch and its dealerId is dropped).
          //
          // Strategy: independently of the lead-ID merge result, count per-frame
          // dealerId votes across all frame results. If a clear majority of
          // frames report the same dealerId, that's the active lead's dealer
          // with high confidence — regardless of which frame's autoLeadId won
          // the lead-ID vote. This is brand-agnostic and works for Kaylee's
          // Honda Lafayette / Audi Lafayette mixed-session case as well as any
          // other cross-store scenario.
          //
          // Why this beats the pageSnippet fallback: pageSnippet is concatenated
          // across all 7 frames, so VinSolutions session chrome text like
          // "Audi Lafayette #21135" (Kaylee's currently-selected dealer tab in
          // her session) leaks in even when the active lead is Honda Lafayette.
          // dealerId attributes on per-frame DOM elements are scoped to each
          // frame and don't carry parent chrome contamination.
          if (!m.dealerId) {
            var _dealerVotes = {};
            for (var _fvi = 0; _fvi < sorted.length; _fvi++) {
              var _fres = sorted[_fvi] && sorted[_fvi].result;
              if (_fres && _fres.dealerId) {
                var _did = String(_fres.dealerId);
                _dealerVotes[_did] = (_dealerVotes[_did] || 0) + 1;
              }
            }
            var _bestDid = '', _bestDidVotes = 0;
            for (var _didKey in _dealerVotes) {
              if (_dealerVotes[_didKey] > _bestDidVotes) {
                _bestDidVotes = _dealerVotes[_didKey];
                _bestDid = _didKey;
              }
            }
            if (_bestDid && DEALER_ID_MAP[_bestDid]) {
              m.dealerId = _bestDid;
              if (!m.store || m.store !== DEALER_ID_MAP[_bestDid]) m.store = DEALER_ID_MAP[_bestDid];
              console.log('[Lead Pro] DealerId rescue from per-frame votes: ' + _bestDid + ' -> "' + m.store + '" (votes: ' + _bestDidVotes + '/' + sorted.length + ')');
            }
          }

          // (v9.7.81) STORE-FROM-PAGESNIPPET FALLBACK
          // Trigger: both m.dealerId and m.store are still empty after frame
          // merge. This happens on Thirdparty Honda leads (and similar)
          // where the vindebug DOM marker hasn't hydrated and the lead
          // panel is rendered without an ECCS URL frame. Without this
          // fallback, downstream prompt building falls back to the user's
          // profile store (e.g. Kaylee = Audi Lafayette) for what may be
          // a Honda Lafayette inquiry — wrong store name in the prompt.
          //
          // Strategy: scan m.pageSnippet using the same resolveStore()
          // anchored brand+location matching used elsewhere. If a store
          // name resolves, look up its dealerId via STORE_TO_DEALER_ID
          // and write both fields back. Only fires when dealerId is
          // genuinely missing; never overrides a resolved dealerId.
          // (v9.7.81) Store-from-content fallback when frame merge produces
          // neither dealerId nor store. This happens on Thirdparty Honda /
          // AI Buying Signals leads where the vindebug DOM marker hasn't
          // hydrated and no ECCS URL is present in any frame.
          //
          // Resolution strategy: try the conversation transcript first
          // (m.context), then fall back to pageSnippet with the active
          // session's dealer-tab header stripped. Without the strip, a
          // Kaylee-session Honda Lafayette lead would resolve to Audi
          // Lafayette because the page header text "VinSolutions Connect
          // [Audi Lafayette]" appears verbatim in pageSnippet.
          if (!m.dealerId && !m.store) {
            var _fallbackStore = '';
            // 1. Try conversation transcript first — no dealer chrome there.
            if (m.context) _fallbackStore = resolveStore(m.context);
            // 2. Fall back to pageSnippet with the dealer-tab label stripped.
            //    (v9.7.82) Expanded strip patterns. Previously only the
            //    "VinSolutions Connect [Store]" pattern was stripped, but
            //    the VinSolutions session chrome also includes a top-right
            //    "Store Name #dealerId" badge plus an agent-name label
            //    underneath. On a multi-store user account (Kaylee with
            //    Audi Lafayette tab selected while viewing a Honda lead),
            //    that chrome leaks "Audi Lafayette" + "#21135" into pageSnippet
            //    and resolveStore matches it. The expanded strip removes
            //    these patterns BEFORE resolveStore runs.
            if (!_fallbackStore && m.pageSnippet) {
              var _strippedSnippet = m.pageSnippet
                .replace(/VinSolutions Connect \[[^\]]*\]/gi, '')
                .replace(/(?:Audi|Honda|Toyota|Kia)\s+\w+\s*#\s*\d{4,6}/gi, '') // "Audi Lafayette #21135"
                .replace(/Search Customers/gi, '');
              _fallbackStore = resolveStore(_strippedSnippet);
            }
            if (_fallbackStore && STORE_TO_DEALER_ID[_fallbackStore]) {
              m.store = _fallbackStore;
              m.dealerId = STORE_TO_DEALER_ID[_fallbackStore];
              console.log('[Lead Pro] Store fallback (from content): "' + _fallbackStore + '" (dealerId ' + m.dealerId + ') — vindebug marker missing, ECCS URL absent');
            }
          }

          // (v9.7.46) Frame merge is the single source of truth.
          lastScrapedData = m;
          const filled = populateFromData(m);

          // (v9.7.47) Direct rule: AI Buying Signals leads have 0 notes by
          // design — they're system-generated, not customer inquiries. Skip
          // the retry/rescue logic entirely for them. No need to wait for
          // notes that will never come.
          var isAILead = /ai\s*buying\s*signal/i.test(m.leadSource || '');
          m.isAILead = isAILead; // persisted so phantom gate can exempt AI leads

          // Did we get the basic lead-page data? Used as a secondary signal
          // for non-AI-Signals leads — if name+vehicle/source is present, the
          // page loaded, so empty notes are real data not a slow-load symptom.
          var leadPageLoaded = isAILead || !!(m.name && (m.vehicle || m.leadSource));

          if (isAILead) {
            console.log('[Lead Pro] AI Buying Signals lead — skipping retry/rescue (0 notes is expected for this source)');
          }

          // Auto-retry only when the lead page itself didn't load.
          // Skip retry for AI Signals leads regardless of note count.
          if (!leadPageLoaded && !m.totalNoteCount && _grabRetryCount < 2) {
            _grabRetryCount++;
            var _savedCount = _grabRetryCount;
            console.log('[Lead Pro] Lead page not loaded — auto-retrying GRAB LEAD in 2.5s (attempt ' + _savedCount + ')');
            statusEl.className = 'crm-status';
            statusEl.textContent = '\u29d7 Loading lead data... retrying (' + _savedCount + '/2)';
            setTimeout(grabLead, 2500);
            return;
          }
          _grabRetryCount = 0; // reset on successful load

          // 6s re-scrape rescue: only fires when the lead page DID NOT load
          // and we have nothing useful. AI Signals leads bypass this too.
          if (!m.totalNoteCount && !m.agent && !leadPageLoaded) {
            statusEl.className = 'crm-status';
            statusEl.textContent = '⟳ Waiting for CRM data... (6s)';
            setTimeout(function() {
              statusEl.textContent = '⟳ Re-scanning frames...';
              chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: inlineScraper
              }, function(rescueResults) {
                if (chrome.runtime.lastError || !rescueResults) {
                  statusEl.className = 'crm-status error';
                  statusEl.textContent = '⟳ Still loading — scroll through the notes panel, then GRAB LEAD again';
                  return;
                }
                // Find the frame with the most notes for this lead
                var best = null;
                var _aid = window._activeLeadId || '';
                for (var ri = 0; ri < rescueResults.length; ri++) {
                  var rd = rescueResults[ri] && rescueResults[ri].result;
                  if (!rd) continue;
                  if (_aid && rd.autoLeadId && rd.autoLeadId !== _aid) continue;
                  if (!best || (rd.totalNoteCount || 0) > (best.totalNoteCount || 0)) best = rd;
                }
                if (best && best.totalNoteCount > 0) {
                  console.log('[Lead Pro] Re-scrape succeeded — notes:', best.totalNoteCount);
                  lastScrapedData = best;
                  populateFromData(best);
                  statusEl.className = 'crm-status found';
                  statusEl.textContent = '✓ ' + best.totalNoteCount + ' notes · data loaded';
                } else if (m.name && m.agent) {
                  // Original scrape had partial data — keep it
                  lastScrapedData = m;
                  populateFromData(m);
                  statusEl.className = 'crm-status';
                  statusEl.textContent = '⚠ Partial data only — scroll through notes then GRAB LEAD again';
                  _btnGenerate.disabled = false;
                } else {
                  statusEl.className = 'crm-status error';
                  statusEl.textContent = '⟳ Still loading — scroll through the notes panel, then GRAB LEAD again';
                }
              });
            }, 6000);
          }

          console.log('[Lead Pro] Merged store:', m.store, '| dealerId:', m.dealerId);
          console.log('[Lead Pro] Gate eval — filled:', filled, '| selectedStore:', !!selectedStore, '| m.agent:', JSON.stringify(m.agent), '| m.salesRep:', JSON.stringify(m.salesRep), '| m.name:', JSON.stringify(m.name), '| m.totalNoteCount:', m.totalNoteCount, '| isAILead:', isAILead);
          // (v9.7.81) Popup-side SMS opt-out diagnostic — mirrors the scraper-side
          // trace at line 1972 into the popup console so we can see flag resolution
          // without switching to the page DevTools.
          console.log('[Lead Pro] POPUP-side SMS opt-out trace -- m.isSmsOptOutOnly:', m.isSmsOptOutOnly,
            '| m.hasExitSignal:', m.hasExitSignal,
            '| m.hasPauseSignal:', m.hasPauseSignal,
            '| m.convState:', m.convState,
            '| m.lastInboundMsg:', JSON.stringify((m.lastInboundMsg||'').substring(0,80)));
          if (filled > 0 || selectedStore) {
            // Identity rescue: fires when EITHER agent+salesRep are both
            // missing, OR customer name is missing — provided we have other
            // signals the lead page is partially loaded (notes, vehicle,
            // source, or store).
            //
            // Two trigger conditions because the failure modes differ:
            //   1. Fast lead-switching: rims2/CustomerDashboard hadn't
            //      rendered, so agent + salesRep + name all missing.
            //   2. Selector edge cases (e.g. Gubagoo chat leads): agent
            //      and salesRep extracted fine but customer name selector
            //      missed. m.name alone is undefined.
            //
            // Both cases benefit from the 7s passive wait + re-scrape since
            // the rescue's re-extract pass uses different selectors than
            // the initial scrape and is more resilient to DOM variants.
            var hasPartialLoad = !!(m.totalNoteCount || m.vehicle || m.leadSource || selectedStore);
            var identityMissing = (!m.agent && !m.salesRep) || !m.name;
            if (identityMissing && hasPartialLoad) {
              // PASSIVE-WAIT RESCUE (v9.7.44):
              // Mirrors the v9.7.27 pattern that was working reliably before our v9.7.43
              // polling refactor. Key insight: aggressive 500ms polling with executeScript
              // competes with Cox's React hydration for the main thread, slowing the very
              // render we're waiting for. v9.7.27 worked by waiting passively (single
              // setTimeout, no polling), letting the page finish loading uninterrupted,
              // then doing ONE check at the end.
              //
              // Flow:
              //   1. Block UI, show "loading" status
              //   2. Wait 7s passively (no scripting, no polling) - lets Cox finish rendering
              //   3. Check chrome.storage for content.js's late-write
              //   4. If still empty, send ONE SCRAPE_NOW message to content.js
              //   5. If content.js also has nothing, fall back to manual fill
              console.log('[Lead Pro] Rescue: starting passive wait (7s) - letting page finish loading');
              statusEl.className = 'crm-status scanning';
              statusEl.textContent = '⏳ Loading lead data...';
              _btnGenerate.disabled = true;
              var _vmBtn = document.getElementById('btnVoicemail');
              if (_vmBtn) _vmBtn.disabled = true;

              // Single non-polling status update at 4s (just visual reassurance, no DOM work)
              var _rescueMidpointTimer = setTimeout(function() {
                statusEl.textContent = '⏳ Almost ready...';
              }, 4000);

              function rescueComplete(d) {
                clearTimeout(_rescueMidpointTimer);
                // (v9.7.59) BROAD MERGE: rescue used to only patch identity fields
                // (agent, salesRep, manager, name). When VinSolutions renders slowly
                // -- or when the initial scrape hits a partially-hydrated DOM --
                // other critical fields stay empty: buyerPhone, context, vehicle,
                // leadSource, contactRecoveryPhone, etc. Those gaps cause downstream
                // failures: phone-recovery messages on leads that have a phone,
                // missing vehicle context, empty conversation transcripts.
                // Merge ALL data fields here, not just identity, while preserving
                // any non-empty values already in m from the initial scrape.
                var _rescueMergedKeys = [];
                if (d && typeof d === 'object') {
                  for (var _k in d) {
                    if (!Object.prototype.hasOwnProperty.call(d, _k)) continue;
                    // Skip booleans where false is meaningful; only merge when m's slot is empty/falsy AND d has a real value
                    var _mv = m[_k];
                    var _dv = d[_k];
                    if (_dv === undefined || _dv === null) continue;
                    // Strings: m empty -> use d
                    if (typeof _dv === 'string' && _dv.length > 0 && (!_mv || (typeof _mv === 'string' && _mv.length === 0))) {
                      m[_k] = _dv; _rescueMergedKeys.push(_k);
                    }
                    // Numbers: m missing/0 -> use d if d > 0 (notes count, etc)
                    else if (typeof _dv === 'number' && _dv > 0 && (!_mv || _mv === 0)) {
                      m[_k] = _dv; _rescueMergedKeys.push(_k);
                    }
                    // Arrays: m missing/empty -> use d
                    else if (Array.isArray(_dv) && _dv.length > 0 && (!_mv || (Array.isArray(_mv) && _mv.length === 0))) {
                      m[_k] = _dv; _rescueMergedKeys.push(_k);
                    }
                    // Booleans: ONLY adopt d's value if m has never been set (undefined). Don't overwrite an explicit false.
                    else if (typeof _dv === 'boolean' && _mv === undefined) {
                      m[_k] = _dv; _rescueMergedKeys.push(_k);
                    }
                    // Objects (non-array): m missing -> use d
                    else if (typeof _dv === 'object' && !Array.isArray(_dv) && (!_mv || (typeof _mv === 'object' && Object.keys(_mv).length === 0))) {
                      m[_k] = _dv; _rescueMergedKeys.push(_k);
                    }
                  }
                }
                console.log('[Lead Pro] Rescue succeeded:', { agent: m.agent, salesRep: m.salesRep, name: m.name, mergedKeys: _rescueMergedKeys.length, hasPhone: !!m.phone, hasContext: !!(m.context && m.context.length) });
                if (_rescueMergedKeys.length > 0) {
                  console.log('[Lead Pro] Rescue broad-merge filled ' + _rescueMergedKeys.length + ' field(s):', _rescueMergedKeys.slice(0, 15).join(', ') + (_rescueMergedKeys.length > 15 ? ' ...' : ''));
                }
                // (v9.7.81) Mirror of the store-from-pageSnippet fallback applied
                // at the post-frame-merge path above. When rescue's broad-merge
                // still hasn't filled dealerId/store (because the rescue scrape
                // hit the same partially-hydrated DOM), scan the rescued
                // pageSnippet using resolveStore() as the final fallback.
                // (v9.7.81) Mirror of the store-from-content fallback applied
                // at the post-frame-merge path above. When rescue's broad-merge
                // still hasn't filled dealerId/store (because the rescue scrape
                // hit the same partially-hydrated DOM), try the conversation
                // transcript first, then pageSnippet with the dealer-tab label
                // stripped. The strip prevents the active session's dealer tab
                // header from contaminating resolution.
                if (!m.dealerId && !m.store) {
                  var _rFallbackStore = '';
                  if (m.context) _rFallbackStore = resolveStore(m.context);
                  if (!_rFallbackStore && m.pageSnippet) {
                    var _rStrippedSnippet = m.pageSnippet.replace(/VinSolutions Connect \[[^\]]*\]/gi, '');
                    _rFallbackStore = resolveStore(_rStrippedSnippet);
                  }
                  if (_rFallbackStore && STORE_TO_DEALER_ID[_rFallbackStore]) {
                    m.store = _rFallbackStore;
                    m.dealerId = STORE_TO_DEALER_ID[_rFallbackStore];
                    console.log('[Lead Pro] Rescue store fallback (from content): "' + _rFallbackStore + '" (dealerId ' + m.dealerId + ')');
                  }
                }
                // (v9.7.59) Re-evaluate contactRecoveryPhone after broad merge.
                // The initial scrape may have set it true when the phone field
                // hadn't rendered yet. Now that we have rescued data, if there's
                // any phone evidence at all (scraped phone, SMS history, phone
                // pattern in context or page body), clear the flag.
                // populateFromData will run its own override logic on top of
                // this, but we set the baseline here so the flag reflects the
                // rescued state, not the initial one.
                // (v9.7.81) Scan d.pageSnippet too — the customer info panel
                // phone often only appears in the page body, not the
                // conversation transcript. Same fix as in populateFromData.
                if (m.contactRecoveryPhone === true) {
                  var _hasPhoneNow = (m.phone && m.phone.replace(/\D/g,'').length >= 7);
                  var _ctxNow = (m.context || '') + '\n' + (m.pageSnippet || '');
                  var _smsNow = /Inbound Text Message|Outbound Text Message/i.test(_ctxNow);
                  var _phoneHdrNow = /(?:Received from|Sent to|Cell|Home|Work|Mobile|Eve)[:\s]+\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/i.test(_ctxNow);
                  var _phonePatNow = /\(\d{3}\)\s*\d{3}[\s-]\d{4}|\d{3}[\s-]\d{3}[\s-]\d{4}/.test(_ctxNow);
                  if (_hasPhoneNow || _smsNow || _phoneHdrNow || _phonePatNow) {
                    m.contactRecoveryPhone = false;
                    console.log('[Lead Pro] Rescue cleared contactRecoveryPhone (phone evidence found in rescued data — hasPhone:' + _hasPhoneNow + ' sms:' + _smsNow + ' hdr:' + _phoneHdrNow + ' pat:' + _phonePatNow + ')');
                  }
                }
                lastScrapedData = m;
                populateFromData(m);

                // (v9.7.118) If custName field is still empty after rescue
                // (name hydrates later than agent/salesRep on some machines),
                // try to extract it from the page snippet as a last resort.
                // The model already gets name from transcript context but the
                // UI field showing "First Last" is confusing to agents.
                setTimeout(function() {
                  var _nameEl = document.getElementById('custName');
                  if (_nameEl && !_nameEl.value) {
                    var _resolvedName = m.name || '';
                    // (v9.7.119) If m.name still empty, query BuyerName DOM directly.
                    // This span renders after the content-script scrape fires but
                    // is settled by the time this 500ms timer runs.
                    if (!_resolvedName) {
                      var _bn = document.getElementById('ActiveLeadPanelWONotesAndHistory1__BuyerName') ||
                                document.querySelector('span[id$="__BuyerName"]') ||
                                document.querySelector('span[id*="BuyerName"]');
                      if (_bn) {
                        var _raw = (_bn.innerText || _bn.textContent || '').replace(/\n/g, ' ').trim();
                        _raw = _raw.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s*/i, '').trim();
                        if (_raw.length > 1) {
                          _resolvedName = _raw;
                          m.name = _resolvedName;
                          console.log('[LP RESCUE NAME] BuyerName DOM patch: "' + _resolvedName + '"');
                        }
                      }
                    }
                    if (_resolvedName) {
                      _nameEl.value = _resolvedName;
                      _nameEl.classList.add('populated');
                    }
                  }
                }, 500);

                // (v9.7.83) POST-SCRAPE VALIDATION GATE.
                // After rescue completes, detect the phantom-scrape failure
                // mode: vindebug element confirmed present (so the page IS
                // a real loaded lead with a known ID), but all the rich data
                // is missing (notes=0, no phone, no transcript). The Rolando
                // case was the canonical instance — 26 notes in DOM, full
                // buyer panel, but the scraper saw none of it because the
                // pre-scrape wait resolved before notes hydrated.
                //
                // The .82 Customer Phone fix makes this failure mode
                // customer-facing because it emits an explicit "asking IS
                // appropriate" instruction when phone is empty — the model
                // then confidently asks for a phone number that's actually
                // on file. Block Generate when we know the data is phantom,
                // so the agent sees a clear "data didn't load" message
                // rather than generating garbage.
                var _hasVindebug = !!(m.autoLeadId || m.customerId);
                var _phantomScrape = _hasVindebug
                  && (!m.totalNoteCount || m.totalNoteCount === 0)
                  && !m.phone
                  && !m.lastInboundMsg
                  && !m.context
                  && !m.isAILead; // AI Buying Signals leads have no notes/phone by design
                if (_phantomScrape) {
                  console.log('[Lead Pro] PHANTOM SCRAPE detected — vindebug present but no notes, phone, or transcript. Blocking Generate.');
                  statusEl.className = 'crm-status error';
                  statusEl.textContent = '⚠ Lead data didn\'t fully load — refresh the page and try GRAB LEAD again';
                  _btnGenerate.disabled = true;
                  var _vmBtnPhantom = document.getElementById('btnVoicemail');
                  if (_vmBtnPhantom) _vmBtnPhantom.disabled = true;
                  return;
                }

                statusEl.className = 'crm-status found';
                var parts = [];
                if (filled > 0)    parts.push(filled + ' field' + (filled>1?'s':'') + ' filled');
                if (selectedStore) parts.push('store detected');
                if ((m.totalNoteCount||0) > 0) parts.push(m.totalNoteCount + ' notes');
                statusEl.textContent = '✓ ' + parts.join(' · ');
                dot.classList.remove('scanning');
                dot.classList.add('active');
                _btnGenerate.disabled = false;
                var _vmBtnOK = document.getElementById('btnVoicemail');
                if (_vmBtnOK) _vmBtnOK.disabled = false;
              }

              function rescueFailed() {
                clearTimeout(_rescueMidpointTimer);
                console.log('[Lead Pro] Rescue passive wait completed - falling back to manual fill');
                lastScrapedData = m;
                statusEl.className = 'crm-status error';
                statusEl.textContent = '⚠ Couldn\'t load BD Agent automatically - type your name in the BD Agent field below to continue';
                var _vmBtnFail = document.getElementById('btnVoicemail');
                if (_vmBtnFail) _vmBtnFail.disabled = true;
              }

              // (v9.7.46) Wait 7s passively for Cox to finish loading, then
              // re-run executeScript across all frames for a fresh scrape.
              // No storage check — frames don't write storage. Re-scraping is
              // the rescue: same merge logic as initial Grab, but against a
              // page that's had time to fully load.
              setTimeout(function() {
                statusEl.textContent = '⏳ Re-scanning frames...';
                try {
                  chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    func: inlineScraper
                  }, function(rescueFrameResults) {
                    if (chrome.runtime.lastError || !rescueFrameResults) {
                      rescueFailed();
                      return;
                    }
                    // Same merge as initial scrape — pick any frame's identity
                    // fields if matching the active lead.
                    // (v9.7.83) Gate identity fields on isLeadFrame so non-lead
                    // frames (top frame worklist, ECCS frame, customer dashboard
                    // frame) cannot supply agent/salesRep/manager/name. The
                    // Rolando case showed the top frame's VinSolutions ILM
                    // worklist returning "Givani De La Cerda" via labelValue's
                    // unscoped tr/td scan — that flow is now blocked at two
                    // layers (scoped labelValue + this gate).
                    var rescued = {};
                    var _aid = window._activeLeadId || '';
                    for (var ri = 0; ri < rescueFrameResults.length; ri++) {
                      var rd = rescueFrameResults[ri] && rescueFrameResults[ri].result;
                      if (!rd) continue;
                      if (_aid && rd.autoLeadId && rd.autoLeadId !== _aid) continue;
                      // (v9.7.83) Identity fields only from confirmed lead frames.
                      if (!rd.isLeadFrame) continue;
                      if (rd.agent     && !rescued.agent)     rescued.agent     = rd.agent;
                      if (rd.salesRep  && !rescued.salesRep)  rescued.salesRep  = rd.salesRep;
                      if (rd.manager   && !rescued.manager)   rescued.manager   = rd.manager;
                      if (rd.name      && !rescued.name)      rescued.name      = rd.name;
                      // (v9.7.118) Also rescue data fields that miss on slow-loading leads.
                      // Vehicle is the most common — VehicleInfo panel hydrates late in
                      // some sessions (observed consistently on Rotaxlyn's machine).
                      // Gate on isLeadFrame same as identity fields to prevent bleed.
                      if (rd.vehicle   && !rescued.vehicle)   rescued.vehicle   = rd.vehicle;
                      if (rd.stockNum  && !rescued.stockNum)  rescued.stockNum  = rd.stockNum;
                      if (rd.vin       && !rescued.vin)       rescued.vin       = rd.vin;
                      if (rd.condition && !rescued.condition) rescued.condition = rd.condition;
                      if (rd.color     && !rescued.color)     rescued.color     = rd.color;
                      if (rd.phone     && !rescued.phone)     rescued.phone     = rd.phone;
                    }
                    if (rescued.agent || rescued.salesRep || rescued.name || rescued.vehicle || rescued.phone || rescued.stockNum) {
                      rescueComplete(rescued);
                    } else {
                      rescueFailed();
                    }
                  });
                } catch(e) {
                  console.warn('[Lead Pro] Rescue re-scrape failed:', e.message);
                  rescueFailed();
                }
              }, 7000);
            } else {
            // (v9.7.83) Same phantom-scrape gate as in rescueComplete.
            // The initial scrape path can hit the same partial-load failure
            // mode — store gets detected (sets selectedStore=true above) but
            // notes, phone, and transcript are all missing. Without this
            // gate, the agent gets Generate enabled and produces garbage
            // built from incomplete data.
            var _hasVindebugInit = !!(m.autoLeadId || m.customerId);
            var _phantomInit = _hasVindebugInit
              && (!m.totalNoteCount || m.totalNoteCount === 0)
              && !m.phone
              && !m.lastInboundMsg
              && !m.context
              && !m.isAILead; // AI Buying Signals leads have no notes/phone by design
            if (_phantomInit) {
              console.log('[Lead Pro] PHANTOM SCRAPE detected (initial path) — vindebug present but no notes, phone, or transcript. Blocking Generate.');
              statusEl.className = 'crm-status error';
              statusEl.textContent = '⚠ Lead data didn\'t fully load — refresh the page and try GRAB LEAD again';
              _btnGenerate.disabled = true;
              var _vmBtnPhantomInit = document.getElementById('btnVoicemail');
              if (_vmBtnPhantomInit) _vmBtnPhantomInit.disabled = true;
              return;
            }
            statusEl.className = 'crm-status found';
            const parts = [];
            if (filled > 0)    parts.push(filled + ' field' + (filled>1?'s':'') + ' filled');
            if (selectedStore) parts.push('store detected');
            if ((m.totalNoteCount||0) > 0) parts.push(m.totalNoteCount + ' notes');
            statusEl.textContent = '✓ ' + parts.join(' · ');
            dot.classList.remove('scanning');
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
  s.isApptConfirmation = ctx.includes('appointment already set') && !data.hasMissedCallBackPromise;
  s.isShowroomFollowUp = ctx.includes('showroom stage');
  s.isSoldDelivered    = /sold\/delivered/i.test(ctx) || !!data.isSoldDelivered;
  s.isMissedAppt       = ctx.includes('missed appointment');
  s.isExitSignal       = ctx.includes('exit signal');
  s.isPauseSignal      = ctx.includes('pause signal') || !!data.hasPauseSignal;
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

  // Registry-aware classification
  if (typeof LEADPRO_REGISTRY !== 'undefined' && window._leadProSourceRegistry) {
    s._registryScenario = LEADPRO_REGISTRY.classify(data.leadSource || '', window._leadProSourceRegistry);
  }

  // Auto persona resolution (trigger matrix)
  s.resolvedPersona = (function() {
    var base    = (_leadProProfile && _leadProProfile.persona) || 'bdc';
    var conv    = (data.convState || '').toLowerCase();
    var ageDays = parseFloat(data.leadAgeDays || 0);
    var noteCount = parseInt(data.totalNoteCount || 0);
    // FALLBACK: if scraper didn't capture leadAgeDays, derive from text sources.
    // data.context is only set during generation, so during persona resolution we have to use
    // pageSnippet (raw page text from scraper) or history (joined transcript).
    if (!ageDays) {
      var ctxForAge = (data.context || data.pageSnippet || data.history || '');
      var ctxAgeMatch = ctxForAge.match(/Created[^(]*\((\d+)d\)/i);
      if (ctxAgeMatch) ageDays = parseInt(ctxAgeMatch[1]);
      if (!ageDays) {
        var dateMatches = ctxForAge.match(/\[(\d{1,2}\/\d{1,2}\/\d{4})/g) || [];
        if (dateMatches.length > 0) {
          var oldest = dateMatches[dateMatches.length - 1].replace('[','');
          var oldestMs = new Date(oldest).getTime();
          if (oldestMs > 0) ageDays = Math.floor((Date.now() - oldestMs) / 86400000);
        }
      }
    }
    // Compute hasCustomerReply directly here — s.hasCustomerReply is never set at this point.
    var ctxRaw = (data.context || data.pageSnippet || data.history || '');
    var hasCustomerReplyComputed = !!data.hasCustomerReply
                                || /\[CUSTOMER\]/i.test(ctxRaw)
                                || /Inbound Text|Inbound phone|Email reply from prospect/i.test(ctxRaw)
                                || (data.lastInboundMsg && data.lastInboundMsg.length > 5);

    // (v9.7.50) FRESH-LEAD GUARD for repeat customers.
    // When a known customer with historical activity submits a NEW inquiry,
    // we don't want their old conversation history to fire staleness-based
    // triggers (Director auto, Manager long-stall, Sales staleness block).
    // The new lead submission IS the reset signal. We treat staleness-related
    // signals as zeroed for the trigger evaluation only - identity-based
    // routing (Audi, missed-appt on THIS lead, trade/high-intent flags)
    // continues to work normally.
    //
    // Trigger: ageDays <= 1 means this specific lead was just submitted.
    // Even if customer record has 50 notes from prior interactions, those
    // are not the current conversation.
    var _isFreshLead = (typeof ageDays === 'number') && ageDays <= 1;
    var _staleNoteCount = noteCount;
    var _staleContactedAge = data.contactedAgeDays;
    if (_isFreshLead && noteCount > 3) {
      // Customer has accumulated history but this lead is fresh.
      // Override the staleness signals so triggers don't fire on old history.
      _staleNoteCount = 0;
      _staleContactedAge = 0;
      console.log('[Lead Pro] Fresh-lead guard ACTIVE — ageDays:', ageDays, '| historical noteCount:', noteCount, '| staleness signals zeroed for trigger evaluation (history will still inform message content via transcript)');
    }

    // Diagnostic: log every persona resolution so we can see why auto-switch did/didn't fire
    console.log('[Lead Pro] Persona resolver — base:', base, '| ageDays:', ageDays, '| noteCount:', noteCount, '| hasCustomerReply:', hasCustomerReplyComputed, '| hasRealOutbound:', hasRealOutbound, '| convState:', conv, '| store:', (data.store||'(empty)'));
    // (v9.7.51) State-based persona escalations run BEFORE the Audi-Concierge
    // store override. Damion Wilson case (May 7 missed Audi appointment)
    // exposed that the Audi check was short-circuiting state escalations -
    // manager (missed appt) fired correctly on first pass but got overwritten
    // by concierge on the second pass. Order now: Director (ghost recovery)
    // -> manager (missed appt / long stall) -> sales (trade/high-intent) ->
    // concierge (Audi default) -> base.
    var _isAudiStore = !!(s.isAudi || /audi/i.test(data.store || ''));

    // (v9.7.51) State-escalation cache. classifyScenario runs multiple times per
    // generation. Pass 1 typically has full data (notes, hasCustomerReply, etc.);
    // pass 2 often runs early in prompt-building with cleared inputs (noteCount: 0,
    // hasCustomerReply: empty) and would naturally fall through to a default.
    // The cache lets pass 1's correct state-escalation persist through pass 2
    // for the same lead. Cleared automatically when _activeLeadId changes.
    var _cachedLeadId = (window._leadProEscalationCache && window._leadProEscalationCache.leadId) || '';
    var _currentLeadId = window._activeLeadId || data._activeLeadId || data.leadId || '';
    if (_cachedLeadId && _cachedLeadId !== _currentLeadId) {
      // Lead changed — clear cache
      window._leadProEscalationCache = null;
    }
    var _cachedEscalation = (window._leadProEscalationCache && window._leadProEscalationCache.persona) || '';

    function _recordEscalation(persona) {
      window._leadProEscalationCache = { leadId: _currentLeadId, persona: persona };
    }

    if (['bdc','sales'].includes(base)) {
      // (v9.7.50) Tightened Director triggers - Director should be EARNED, not default.
      var isHeavyAttemptGhost = !hasCustomerReplyComputed && hasRealOutbound && _staleNoteCount >= 10;
      var isLongSilenceGhost = !hasCustomerReplyComputed && hasRealOutbound && (_staleContactedAge || ageDays) >= 21 && _staleNoteCount >= 6;
      var wentCold = hasCustomerReplyComputed && hasRealOutbound && (_staleContactedAge || 0) >= 14;
      var isApptContext = conv === 'appt-confirmation' || conv === 'missed-appt' || !!s.hasApptSet || !!data.hasApptSet;
      var isPauseContext = conv === 'pause';
      var shouldDirector = (isHeavyAttemptGhost || isLongSilenceGhost || wentCold || conv === 'exit');
      console.log('[Lead Pro] Director check - isHeavyAttemptGhost:', isHeavyAttemptGhost, '| isLongSilenceGhost:', isLongSilenceGhost, '| wentCold:', wentCold, '| isApptContext:', isApptContext, '| isPauseContext:', isPauseContext, '| shouldDirector:', shouldDirector);
      if (shouldDirector && !isApptContext && !isPauseContext) {
        console.log('[Lead Pro] -> internet_director (auto' + (_isAudiStore ? ' - Audi state escalation' : '') + ')');
        _recordEscalation('internet_director');
        return 'internet_director';
      }
    } else {
      console.log('[Lead Pro] Director check skipped - base persona is:', base);
    }
    if (base === 'bdc') {
      var isMissedAppt = !!data.hasMissedAppt || s.isMissedAppt;
      if (_isFreshLead && isMissedAppt) {
        console.log('[Lead Pro] Fresh-lead guard: missed-appt suppressed - historical missed appointment from prior lead, customer just submitted fresh inquiry');
        isMissedAppt = false;
      }
      var _stallContactedAge = _staleContactedAge || ageDays;
      var isLongStall = conv === 'stalled' || (_stallContactedAge >= 14 && _staleNoteCount >= 8 && !hasCustomerReplyComputed && hasRealOutbound);
      if (isMissedAppt) {
        console.log('[Lead Pro] -> manager (missed appt' + (_isAudiStore ? ' - Audi state escalation' : '') + ')');
        _recordEscalation('manager');
        return 'manager';
      }
      if (isLongStall) {
        console.log('[Lead Pro] -> manager (long stall' + (_isAudiStore ? ' - Audi state escalation' : '') + ')');
        _recordEscalation('manager');
        return 'manager';
      }
    }
    if (base === 'bdc' && (s.hasTrade || data.hasTrade || s.isHighIntent)) {
      var _salesContactedAge = _staleContactedAge || ageDays;
      var _salesStale = !hasCustomerReplyComputed && hasRealOutbound && _salesContactedAge >= 10;
      if (_salesStale) {
        console.log('[Lead Pro] Sales auto-route blocked - lead is stale (' + _salesContactedAge.toFixed(0) + 'd no reply) - falling through');
      } else {
        console.log('[Lead Pro] -> sales (trade/high-intent' + (_isAudiStore ? ' - Audi state escalation' : '') + ')');
        _recordEscalation('sales');
        return 'sales';
      }
    }
    // Cache rescue: if no state escalation matched THIS pass but a previous pass
    // for the same lead recorded one (e.g. pass 1 had full data, pass 2 has
    // partial data), honor the cached escalation instead of downgrading to
    // Audi default or base. This prevents the Damion Wilson failure pattern
    // where pass 2's missing data caused a manager -> concierge downgrade.
    if (_cachedEscalation && ['manager','sales','internet_director'].includes(_cachedEscalation)) {
      console.log('[Lead Pro] -> ' + _cachedEscalation + ' (cached escalation from prior pass for lead ' + _currentLeadId + ')');
      return _cachedEscalation;
    }
    // Audi store: fall through to profile base persona (agents have concierge baked into their profile)
    console.log('[Lead Pro] -> ' + base + ' (fallthrough)');
    return base;
  })();

  var _basePersona = (_leadProProfile && _leadProProfile.persona) || 'bdc';
  if (s.resolvedPersona !== _basePersona) {
    console.log('[Lead Pro] Persona auto-switched:', _basePersona, '→', s.resolvedPersona);
  }
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
  s.isLoyalty      = /afs|kmf|luv|off loan|maturity|loyalty|kfa/i.test(ls);
  s.isCarGurusDD = /cargurus.*digital deal|digital deal.*cargurus/i.test(ls);
  s.isKBB = /kbb|kelley blue/i.test(ls) && !/autotrader/i.test(ls); // AutoTrader-KBB = purchase lead, not trade offer — AutoTrader takes priority
  s.isCapitalOne = /capital one|cap one/i.test(ls);
  s.isCreditApp  = /credit.*app|standalone.*credit|finance.*application|routeone|^dealertrack(?!.*gubagoo|.*autofi|.*cargurus|.*kiacom)/i.test(ls) && !s.isClickAndGo;
  s.isTrueCar = /truecar/i.test(ls);
  s.isAMP = /\bamp\b/i.test(ls);
  // AI Buying Signals — detect both variants precisely
  // NOTE: do NOT gate on !isFollowUp here. VinSolutions auto-marks AI Buying Signal
  // leads as "contacted" the moment the signal fires, which previously blocked the
  // matrix from running on fresh leads. Source name is authoritative.
  const isAISignalLead = /ai buying signal/i.test(ls);
  s.isAIBuyingSignalReturner = isAISignalLead && /previously sold customer/i.test(ls) && !/not previously sold/i.test(ls);
  s.isAIBuyingSignalNew      = isAISignalLead && !s.isAIBuyingSignalReturner;
  // Prefer structured field set by scraper. Fall back to context regex only when needed,
  // and require strict uppercase + colon to avoid matching placeholder text
  // "buying signal data only. Do not reference any marketing emails..."
  s.buyingSignalData = data.buyingSignals
                    || (data.context||'').match(/BUYING SIGNAL DATA:\s+([^\n]+)/)?.[1]?.trim()
                    || '';

  // ── AI Buying Signal — three-axis context resolution ──────────────────────
  // Axis 1: Location type — multi-brand group (more conversational latitude) vs standalone (must stay in-brand)
  // Note: sister stores give the agent ROOM to keep the conversation alive without overpromising,
  //       NOT a license to commit to cross-store referrals in BDC outreach.
  // Axis 2: Customer relationship — previously sold (returner) vs cold prospect
  // Axis 3: Brand match — target vehicle in-brand for this store vs cross-brand
  s.aiBSStoreBrand   = '';
  s.aiBSGroupBrands  = [];
  s.aiBSSisterBrands = [];
  s.aiBSTargetBrand  = '';
  s.aiBSIsCrossBrand = false;
  s.aiBSIsStandalone = true;

  // Store-brand and sister-store detection — used by AI Buying Signal matrix AND
  // by KBB+vehicle-of-interest cross-brand pivot. Compute unconditionally so the
  // KBB pivot (added v9.7.10) has access to the same data.
  if (typeof window !== 'undefined' && window._leadProDealerData) {
    var _dd = window._leadProDealerData || {};
    var _stores = _dd.stores || [];
    var _thisStore = _stores.find(function(st) { return String(st.crmDealerId) === String(data.dealerId||''); });
    if (_thisStore) {
      s.aiBSStoreBrand = (_thisStore.brand || '').toLowerCase();
      var _allBrands = _stores.map(function(st) { return (st.brand || '').toLowerCase(); }).filter(Boolean);
      s.aiBSGroupBrands = Array.from(new Set(_allBrands));
      s.aiBSSisterBrands = s.aiBSGroupBrands.filter(function(b) { return b !== s.aiBSStoreBrand; });
      s.aiBSIsStandalone = s.aiBSSisterBrands.length === 0;
      // For KBB cross-brand: the customer's vehicle-of-interest brand may be the target
      // (different from the AI Buying Signal's target which uses buying-signal text).
      // Capture lead-vehicle brand so KBB pivot can know if the customer's interest
      // matches a sister store.
      var _leadVehBrandText = ((data.vehicle||'') + ' ' + (data.vehicleRaw||'')).toLowerCase();
      var _leadBrandMatch = _leadVehBrandText.match(/\b(toyota|honda|chevrolet|chevy|gmc|ford|kia|nissan|hyundai|mazda|subaru|jeep|ram|dodge|chrysler|audi|bmw|mercedes|lexus|acura|infiniti|cadillac|lincoln|buick|volkswagen|vw|volvo|porsche|tesla|genesis|mitsubishi)\b/);
      if (_leadBrandMatch) {
        s.leadVehicleBrand = _leadBrandMatch[1] === 'chevy' ? 'chevrolet' : _leadBrandMatch[1] === 'vw' ? 'volkswagen' : _leadBrandMatch[1];
        s.leadVehicleBrandHasSisterStore = s.aiBSSisterBrands.indexOf(s.leadVehicleBrand) >= 0;
      } else {
        s.leadVehicleBrand = '';
        s.leadVehicleBrandHasSisterStore = false;
      }
    }
  }

  if (isAISignalLead && typeof window !== 'undefined' && window._leadProDealerData) {
    var _bsText = (s.buyingSignalData + ' ' + (data.vehicle||'') + ' ' + (data.vehicleRaw||'')).toLowerCase();
    var _brandMatch = _bsText.match(/\b(toyota|honda|chevrolet|chevy|gmc|ford|kia|nissan|hyundai|mazda|subaru|jeep|ram|dodge|chrysler|audi|bmw|mercedes|lexus|acura|infiniti|cadillac|lincoln|buick|volkswagen|vw|volvo|porsche|tesla|genesis|mitsubishi)\b/);
    if (_brandMatch) {
      s.aiBSTargetBrand = _brandMatch[1] === 'chevy' ? 'chevrolet' : _brandMatch[1] === 'vw' ? 'volkswagen' : _brandMatch[1];
    }
    if (s.aiBSStoreBrand && s.aiBSTargetBrand && s.aiBSStoreBrand !== s.aiBSTargetBrand) {
      s.aiBSIsCrossBrand = true;
    }
  }

  s.isAutoTrader = /autotrader/i.test(ls);
  s.isCarscom = /cars\.com|cars com/i.test(ls);
  s.isEdmunds = /edmunds/i.test(ls);
  s.isCarFax = /carfax|car fax/i.test(ls);
  s.isOEMLead = /toyota\.com|toyota certified|honda\.com|kia\.com|kiacom|hyundai\.com|oem|manufacturer|honda.*ahm|honda.*assoc|honda.*search|buyatoyota|audi.*partner/i.test(ls);
  s.isPhoneUp = /phone.*up|phone-up|phoneup|inbound.*call|call.*center/i.test(ls);
  s.isCarGurus = !s.isCarGurusDD && /cargurus/i.test(ls);
  s.isFacebook = /facebook|fb marketplace|fb lead|meta lead/i.test(ls);
  s.isDealerWebsite = /dealer\.com|dealersocket|dealerfire|dealer website|website lead|internet lead|hds.*lead|dealer eprocess|eprocess.*website|dealertrack.*lead/i.test(ls) && !s.isClickAndGo;
  s.isChatLead = (/chat/i.test(ls) || /gubagoo.*sms|sms.*chat/i.test(ls)) && !s.isClickAndGo;
  s.isCarPro = /carpro|carprousa|car pro usa|car pro show/i.test(ls);
  s.isRepeatCustomer = /repeat|returning|prior customer|dms sales|previous (customer|buyer|owner)|sold customer/i.test(ls);
  s.isThirdPartyOEM = /third.?party|3rd.?party|kia digital|honda digital|toyota digital|hyundai digital|manufacturer partner|autobytel|blackbook|rct.request|oadd.*vdp|thirdparty/i.test(ls) && !s.isOEMLead;
  s.isCostco = /costco/i.test(ls);
  s.isIdentityMax = /identitymax|identity.*max/i.test(ls);
  s.isGoogleAd = /google.*ad|google.*digital|digital advertising.*google|paid search|sem lead|ppc/i.test(ls);
  s.isReferral = /referral|referred by|word of mouth/i.test(ls);
  // KMF loyalty programs — Kia Motors Finance total loss, LUV conquest, event
  s.isLoyalty = /afs|kmf|luv|off loan|maturity|loyalty|kfa|total loss.*kmf|kmf.*total loss|kia event/i.test(ls);
  s.isStandard = !s.isClickAndGo && !s.isTradePending && !s.isCarGurusDD && !s.isCarGurus && !s.isKBB && !s.isCapitalOne && !s.isCreditApp && !s.isTrueCar && !s.isAMP && !s.isAutoTrader && !s.isCarscom && !s.isEdmunds && !s.isOEMLead && !s.isPhoneUp && !s.isAIBuyingSignalNew && !s.isAIBuyingSignalReturner && !s.isFacebook && !s.isDealerWebsite && !s.isChatLead && !s.isCarFax && !s.isRepeatCustomer && !s.isThirdPartyOEM && !s.isCostco && !s.isIdentityMax && !s.isGoogleAd && !s.isReferral && !s.isLoyalty && !s.isCarPro;

  // ── Inventory status ───────────────────────────────────────────
  // vehicleSold must NOT fire on loyalty/KFA leads — the vehicle shown IS the customer's current car
  s.vehicleSold        = !s.isLoyalty && !s.isLeaseMature && (
    ctx.includes('vehicle status: sold')
    || /the vehicle (?:has |I sent you has )?sold|vehicle sold|that (?:car|vehicle|unit) (?:has been |is )?sold|sorry.*(?:vehicle|car|it).*sold|unfortunately.*sold|no longer available/i.test(ctx)
  );
  s.vehicleInTransit   = ctx.includes('vehicle status: in transit');
  s.isLoyaltyVehicle   = ctx.includes('loyalty vehicle')
    || (/loyalty lead created|account type.*leas|afs.*off lease|off lease.*afs/i.test(ctx) && !!data.inventoryWarning);
  s.noSpecificVehicle  = ctx.includes('no specific unit') || ctx.includes('No stock number or VIN');
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

  // Lease maturity / TFS / AFS / Kia LUV off-lease and off-loan leads
  // These are end-of-term transition leads — specific verbiage required
  s.isLeaseMature = /off.?lease|lease.?fin|tfs|toyota.*financial|insprod|kfa.*equity|kfa.*in.equity/i.test(ls)
    || /afs.*off.?lease|off.?lease.*in.*month|off.?loan.*in.*month/i.test(ls)
    || /kmf.*off.?lease|luv.*off.?lease|kia.*luv|luv.*kia/i.test(ls)
    || /maturity date|account type.*lease/i.test(ctx);

  // Distance buyer — customer address is out of state, or customer explicitly mentions distance/delivery
  // IMPORTANT: only scan INBOUND/customer lines — not agent outbound messages
  // Avoids feedback loop where a prior bad AI output triggers the same wrong scenario again
  // Build customer-only context for distance detection
  // Exclude agent blocks, quoted email chains, and system notes
  var ctxLines = (data.context || '').split('\n');
  var inAgentBlock2 = false;
  var customerOnlyCtx = ctxLines.filter(function(line) {
    var t = line.trim();
    if (/^\[\d{2}\/\d{2}\/\d{4}/.test(t)) { inAgentBlock2 = /\[AGENT\]/i.test(t); }
    if (inAgentBlock2) return false;
    if (/^From:\s|^Sent:\s|^On .{5,40}wrote:|^>{1,3}\s/.test(t)) return false;
    if (/^\[NOTE\]|\[AGENT\]|\[BROWSE|\[TFS|\[CHAT NOTE\]|\[CURRENT LEAD/i.test(t)) return false;
    return true;
  }).join(' ').toLowerCase();
  // Never flag as distance buyer if customer has a showroom visit on record
  var hasShowroomVisit = /Showroom Visit|showroom visit started|walkaround.*demo|test drive.*manager/i.test(ctx);
  s.isDistanceBuyer = (!s.isShowroomFollowUp) && (!s.isLeaseMature) && (!s.isLoyalty) && (!hasShowroomVisit) && (
    !!(data.isDistanceBuyer)
    || /home delivery|ship.*vehicle|out.of.state|how far|located.*away|drive.*hours|deliver.*to me|can.t come in|cannot come in|won.t be able to come|i live.*far|too far.*drive|not local|not nearby|out of town/i.test(customerOnlyCtx)
    && !/back in town|coming back|back to town|return.*town|back.*area|back.*home/i.test(customerOnlyCtx)
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
  'gil guzman':       { audi:'337-247-9107', honda_laf:'337-247-9088', baytown:'281-837-3382' },
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
  'melanie martinez': { audi:'337-889-2034', honda_laf:'337-568-0435', baytown:'281-837-3373' },
  'samantha lopez':   { audi:'337-706-0507', honda_laf:'337-541-0253', baytown:'281-837-3375' },
  'zoey zenker':      { audi:'337-568-0459', honda_laf:'337-895-0775', baytown:'281-837-3682' }
};

// Store-level phone fallbacks — used when agent isn't in directory
var STORE_PHONE_FALLBACK = {
  '6189':  '281-837-3382',
  '6190':  '281-837-3683',
  '6191':  '281-837-3384',
  '24399': '337-235-9086'
  // '21135' intentionally omitted — falls back to agent's own number
};

function lookupPhone(agentName, store, dealerId) {
  const key = (agentName || '').toLowerCase().trim();
  const row = PHONE_DIR[key];
  if (!row) {
    // Agent not in directory — return store-level fallback
    var fbDid = String(dealerId || '');
    if (fbDid && STORE_PHONE_FALLBACK[fbDid]) return STORE_PHONE_FALLBACK[fbDid];
    // Try to infer from store name
    var fbStore = (store || '').toLowerCase();
    if (DEALER_ID_MAP) {
      for (var did in DEALER_ID_MAP) {
        if (fbStore.includes(DEALER_ID_MAP[did].toLowerCase().substring(0,8)) && STORE_PHONE_FALLBACK[did]) return STORE_PHONE_FALLBACK[did];
      }
    }
    return null;
  }
  // Resolve store from dealerId if raw store string is a VinSolutions frame label
  var resolvedStore = store || '';
  var did = String(dealerId || '');
  if (did && DEALER_ID_MAP && DEALER_ID_MAP[did]) resolvedStore = DEALER_ID_MAP[did];
  // Agent is in directory — if store has no fallback, use agent's own number for that store
  var did2 = String(dealerId || '');
  if (did2 && !STORE_PHONE_FALLBACK[did2]) {
    var rs2 = resolvedStore.toLowerCase();
    if (rs2.includes('audi'))                              return row.audi     || row.honda_laf || row.baytown;
    if (rs2.includes('lafayette') || rs2.includes('lafa')) return row.honda_laf || row.audi || row.baytown;
    return row.baytown || row.honda_laf || row.audi;
  }
  const s = resolvedStore.toLowerCase();
  if (s.includes('audi'))                                    return row.audi;
  if (s.includes('lafayette') || s.includes('lafa'))         return row.honda_laf;
  if (did === '6189' || s.includes('toyota'))                return row.baytown;
  if (did === '6190' || s.includes('kia'))                   return row.baytown;
  if (did === '6191' || s.includes('honda baytown'))         return row.baytown;
  return row.baytown;
}

// ─────────────────────────────────────────────────────────────────
// FOCUSED SYSTEM PROMPT — universal rules only, short
// ─────────────────────────────────────────────────────────────────
function buildSystemPrompt(personaId) {
  var activePersonaId = personaId || (window._leadProResolvedContext && window._leadProResolvedContext.persona) || (_leadProProfile && _leadProProfile.persona) || 'bdc';
  var personaDef  = (typeof LEADPRO_AUTH !== 'undefined') ? LEADPRO_AUTH.getPersona(activePersonaId) : null;
  var personaHint = personaDef ? personaDef.systemHint : 'You are a BDC agent at a car dealership.';


  // Director mode override — the static systemHint anchors the model in stall-recovery
  // tone ("Standard outreach has stopped working"). For fresh and active leads where
  // the user manually picked Director, we need to swap that for a mode-appropriate hint.
  // Detection mirrors the persona-block logic at the user-prompt level (line ~4558).
  if (activePersonaId === 'internet_director' && lastScrapedData) {
    var _d = lastScrapedData;
    var _convStateLow = (_d.convState || '').toLowerCase();
    var _ageDays = parseFloat(_d.leadAgeDays || 0);

    var _isFirstTouch = _ageDays < 1
                     || (!_d.hasOutbound && !_d.isContacted && _ageDays < 2)
                     || (_d.hasOutbound && !_d.isContacted && (_d.contactedAgeDays === undefined || _d.contactedAgeDays < 1) && _ageDays < 2);

    var _isStallContext = _convStateLow === 'stalled'
                       || _convStateLow === 'exit'
                       || _convStateLow === 'pause'
                       || _convStateLow === 'zero-contact'
                       || (_ageDays > 5 && !_d.hasCustomerReply);

    var _isActiveDirector = !_isFirstTouch
                         && !_isStallContext
                         && (_d.hasCustomerReply
                             || _convStateLow === 'active-follow-up'
                             || _convStateLow === 'call-followup'
                             || _convStateLow === 'first-touch'
                             || _ageDays <= 3);

    if (_isFirstTouch) {
      console.log('[Lead Pro] Director mode: FIRST TOUCH (fresh lead, no recovery framing)');
      // FIRST TOUCH MODE — append a short note. The customer just arrived;
      // they have not gone quiet. The Director voice here means clarity
      // and confidence on a first impression, not stall recovery.
      personaHint = personaHint + "\n\nSITUATION: This is a fresh first-touch lead. The customer just arrived — they have not gone silent, there is nothing to recover. The Director voice here is about clarity and directness on a first impression, not pattern-break or stall-recovery framing.";
    } else if (_isActiveDirector) {
      console.log('[Lead Pro] Director mode: ACTIVE MOMENTUM (engaged conversation, forward motion)');
      // ACTIVE MOMENTUM MODE — append a short note. The conversation is alive
      // and moving; the Director steps in to cut through hedge, not to recover.
      personaHint = personaHint + "\n\nSITUATION: The conversation is active and moving — the customer has engaged, this is not a stall. The Director voice here is about cutting through hedge with substance, not pattern-break framing.";
    } else {
      console.log('[Lead Pro] Director mode: STALL RECOVERY (default — pattern-break the silence)');
    }
    // (else: stall recovery — the base systemHint already covers this case, no situation note needed)
  }

  // Resolve signer first — both personaTitle and agentName reference it below.
  // For non-director/manager profiles, signer fields come from their PROFILE persona,
  // not the active (switched) persona. The persona switch is for VOICE, not credentials.
  var _resolvedSigner = window._leadProResolvedSigner;
  var personaTitle = (_resolvedSigner && _resolvedSigner.title)
                  || (window._leadProResolvedContext && window._leadProResolvedContext.title)
                  || (personaDef && personaDef.title)
                  || 'Internet Sales Coordinator';
  // Use the resolved signer's name -- this is who the message will actually be signed as,
  // which for non-director profiles is the CRM BD Agent on the lead, not the logged-in user.
  // Falling back to logged-in profile only when no signer resolved (rare edge case).
  var agentName = (_resolvedSigner && _resolvedSigner.name)
                  || (_leadProProfile && _leadProProfile.name)
                  || '';
  var storeName = (window._leadProResolvedContext && window._leadProResolvedContext.storeName) || (_leadProProfile && _leadProProfile.store) || '';
  var _sysPhone = '';
  var _sysCtxDealerId = (window._leadProResolvedContext && window._leadProResolvedContext.dealerId)
    || (lastScrapedData && lastScrapedData.dealerId) || '';
  if (_sysCtxDealerId && window._leadProDealerData) {
    var _sysStore = (window._leadProDealerData.stores || []).find(function(s) {
      return String(s.crmDealerId) === String(_sysCtxDealerId) || String(s.id) === String(_sysCtxDealerId);
    });
    if (_sysStore && _sysStore.phone) _sysPhone = _sysStore.phone;
  }
  if (!_sysPhone) _sysPhone = (window._leadProResolvedContext && window._leadProResolvedContext.phone) || (_leadProProfile && _leadProProfile.phone) || '';
  return [
    // ── STATIC PREFIX (cache anchor — never changes across any call) ──────────
    '━━━ YOUR JOB ━━━',
    'Write like a real human who read this customer\'s file and has something specific to say. The best agents trust the customer to take the next step — they don\'t oversell it. Say what needs to be said. Don\'t pad it. Don\'t under-say it either. Let the message be the length the moment calls for.',
    '',
    'Before you write a single word, read the full transcript and answer three questions:',
    '1. What is the actual state of this conversation right now — not what the lead type suggests, but what the arc of messages shows?',
    '2. What does this specific customer need to hear right now to move in a positive direction — or to feel respected if they are stepping back?',
    '3. What would a tone-deaf response do that would cost us this customer?',
    '',
    'Write the response that answers question 2 without doing question 3.',
    '',
    '━━━ READING THE ROOM ━━━',
    'The transcript is your most important input. Everything else is context.',
    '',
    'Match their energy exactly:',
    '- Short reply → short response. A wall of text after a one-word reply is tone-deaf.',
    '- Detailed message → match the depth. Answer every question they raised.',
    '- Excited → move with them. Do not over-explain.',
    '- Asked a question → answer it first. Everything else comes after.',
    '',
    '━━━ DO NOT MATCH ELEVATED EMOTION ━━━',
    'Customer messages sometimes arrive heated — frustration, urgency, demands, profanity, ALL CAPS, ultimatums. Match their VOLUME with calm, not heat. The dealership voice is the calm one in the room. "I hear you, here is what I can actually do" always beats "ABSOLUTELY! I am ON IT RIGHT NOW!" Never reflect anger back. Never use exclamation marks in response to customer urgency. Never use customer profanity. When a customer issues an ultimatum, respond to the substance, not the ultimatum.',
    '',
    'Context signals to watch for:',
    '- If you see "[=== CURRENT LEAD SUBMITTED HERE ===]" in the transcript — everything ABOVE that line is the current active conversation. Everything BELOW is older history.',
    '- Not every customer reply is a buying signal. Read what they are actually communicating.',
    '- A short vehicle name reply to a marketing blast IS a buying signal. If someone gets a text about Tundras and replies "Sequoia" — that is what they want.',
    '- The vehicle in the lead header may not be what the customer wants. If they replied with a different vehicle name, that is what they are asking about.',
    '- Single-letter replies must be read in context. If the agent sent "Reply C to confirm or R to reschedule" and the customer replies "R" — that means RESCHEDULE.',
    '- NEVER ask for contact information that is already on the lead. If the LEAD section shows a phone number or email, use it — do not ask for it again.',
    '- When a customer asks you to email something, email it. Do not pivot immediately to appointment times.',
    '',
    '━━━ TOUCH POSITION AWARENESS ━━━',
    'Every response you write occurs at a specific position in this customer\'s contact sequence. The user prompt will tell you the phase and attempt density explicitly. Internalize what each phase means strategically — it shapes tone, structure, and what counts as the right close.',
    '',
    'PHASE STRATEGY:',
    '- first-touch (Day 0-1): The relationship does not exist yet. Earn the right to ask. Specific opening, one clear forward question. No recovery framing. They just got here.',
    '- engagement (Day 2-7): Customer has responded or you are early in continuation. Build on what they said. Reference prior thread without repeating it. Continuation tone, not cold reintroduction.',
    '- persistence (Day 8-30): Multiple touches already happened. The customer was engaged earlier but not recently. Vary your angle every time — if last touch was a check-in, this one is not. Repeating prior moves is the cardinal sin of this phase.',
    '- reactivation (Day 31-60): Long gap. Acknowledge it honestly OR pivot to a fresh angle. Pattern-break framing welcome. Do NOT pretend the conversation paused yesterday. Inventory has shifted. Their situation has shifted.',
    '- long-dormant (Day 61+): Recovery posture, not continuation. The old conversation is archaeology. Director voice often appropriate. Warm, low-pressure, dignified. "Still here when you are ready" energy. No hard asks. The customer\'s original vehicle of interest may not even be on the lot anymore — be careful claiming availability without verification.',
    '',
    'ATTEMPT DENSITY:',
    '- light (0-2 prior notes): Fresh territory. No vary-angle pressure yet.',
    '- normal (3-7 prior notes): Active conversation. Some self-awareness about not repeating openers.',
    '- sustained (8-14 prior notes): You have been working this lead. Read your prior messages. Do NOT recycle openers, phrasings, or angles you already used.',
    '- heavy (15+ prior notes): A lot of history. Every opener you reach for, check the transcript first to make sure you have not already used it.',
    '',
    'ONE-SIDED CONVERSATIONS: When attempt density is sustained or heavy AND customer responses are zero, you are in a one-sided conversation. The customer has read every message you sent and chosen not to respond. Acknowledge that reality directly rather than sending another optimistic check-in. A pattern-break, an honest "should we step back," or a different angle entirely serves better than another generic outreach. Earn their attention by being different from what was already sent.',
    '',
    'FRESH-LEAD GUARD: If the user prompt indicates a fresh-lead guard is active (Day 0-1 lead with historical notes from prior interactions), the customer\'s prior history is BACKGROUND CONTEXT, not the current conversation. Treat it as a fresh inquiry — they came back to you. Do not frame this as recovery. Do not pretend you have been chasing them. They submitted a new lead today.',
    '',
    'The phase strategy and density rules above apply to every response. The user prompt provides the runtime values; you provide the judgment.',
    '',
    '━━━ WHEN PRIOR OUTBOUND CONFLICTS WITH GROUND TRUTH ━━━',
    'A prior agent message in the conversation arc may have made commitments that conflict with what is actually possible right now — appointment times for an unverified vehicle, acceptance of a closed-day offer, promises that contradict internal notes about deposits or holds, vehicle availability claimed without stock confirmation. The arc preserves what was sent, but what was sent was not always correct.',
    '',
    'When prior outbound conflicts with current ground truth (the architectural rules in this system prompt and the user prompt directives), do NOT compound the mistake by honoring the prior commitment as if it were correct. The job of THIS message is not to be consistent with a prior error — it is to move the customer forward truthfully.',
    '',
    'How to correct trajectory without throwing the prior message under the bus:',
    '- Acknowledge warmly that the prior message went out (the customer received it).',
    '- Quietly steer THIS message toward what IS possible. Do NOT say "we made a mistake," "we should not have said that," "ignore the previous email," or any apology that signals the prior agent erred.',
    '- The agent who sent the prior message is the same agent identity you are signing as. Own the conversation as one continuous voice — do not write as if you are a different person correcting them.',
    '- The customer should read CONTINUITY, not contradiction. They should feel "the dealership is being thorough," not "they don\'t know what they\'re doing."',
    '',
    'Examples:',
    '- Prior outbound offered test drive times for a VIN-only-no-stock vehicle. Your follow-up: do NOT propose times. Pivot warmly: "Before we lock in a time, I want to verify the exact unit is on the lot today — what features matter most to you so I can confirm the right match?" Then commit to following up with confirmed times.',
    '- Prior outbound accepted a Sunday appointment but the store is closed Sundays. Your follow-up: "Looking at our schedule, Saturday actually works better — would [Saturday date] morning or afternoon fit your day?"',
    '- Prior outbound promised a test drive on a vehicle that has a deposit per internal notes. Your follow-up: acknowledge the deposit honestly, offer to keep them informed if it falls through, and do not push the appointment.',
    '',
    'The principle: a prior message is INPUT to your current judgment, not a contract you are bound to. When the prior input conflicts with current truth, current truth wins. The customer is better served by a message that quietly corrects course than by one that doubles down on an error.',
    '',
    '━━━ WHAT MAKES A RESPONSE LAND ━━━',
    'Specific beats generic every time. The opening sentence should prove you read their file.',
    '',
    'Real specific: "The Blueprint with graphite is the one you asked about — it\'s still here."',
    'Fake specific: "I noticed your interest in the Tundra and wanted to follow up." — names the vehicle but says nothing about THIS customer. This is the trap. Avoid it.',
    'Generic: "I wanted to reach out about your inquiry." — could be sent to anyone. Never use this.',
    '',
    '━━━ RHYTHM ━━━',
    'Real human writing has uneven sentence lengths. A short sentence after a long one creates impact. A long sentence after a short one creates flow. AI writing tends to settle into 12-18 word sentences and stays there. Don\'t.',
    '',
    'Mix it up. Sometimes one word is the whole sentence. Sometimes a full thought needs 25 words and you let it run. Read it back in your head — if it sounds like a press release or a polished marketing email, rewrite the rhythm before you send.',
    '',
    '━━━ FORMAT ━━━',
    'SMS: A real text message — not a compressed email. Same specific hook, same quality, same framing. Just written at text length. The opener must name something specific: their vehicle, their trade, their question, something they actually said. End with the stacked signature — agent first name, store name, phone — each on its own line. Nothing else. No dash, no comma, no name in the message body before the signature.',
    '',
    'EMAIL: Full format. Opens with something specific. Body addresses the actual conversation. Closes in whatever way fits where this customer is. Subject line in the "subject" field. Full signature at the end.',
    '',
    'VOICEMAIL: 20-30 seconds. Natural speech. One specific reason to call back. Phone number said twice at the end. Never "following up", "touching base", "just wanted to", "at your earliest convenience".',
    '',
    '━━━ THE CLOSE ━━━',
    'The close is whatever the next right move is for this specific customer based on everything you have read.',
    '',
    'If they told you when they are coming — confirm it. Offer times on the day they named.',
    'If they are engaged and ready — move them toward the visit.',
    'If they are hesitant — be a helpful resource, not a closer.',
    'If they are not ready — respect it. Leave the door open warmly.',
    'If they are stepping back or frustrated — give them the easy out. Relationship over transaction.',
    '',
    'Appointment times are one tool. Use them when they are the natural next step. Skip them when they would feel pushy or tone-deaf.',
    '',
    '━━━ WRITING MECHANICS ━━━',
    'Use proper punctuation between phrases always. Join clauses with commas, em-dashes, or separate sentences. Never let phrases run together without a separator. When in doubt, use a period and start a new sentence.',
    '',
    '━━━ NON-NEGOTIABLES ━━━',
    'Never invent vehicle details, stock numbers, or inventory availability without confirmation in the lead data.',
    'Never confirm a specific unit, trim, color, or configuration is available without a stock number or VIN. You may reference the BASE MODEL (we sell the line) but never claim the specific build the customer named is on the lot. Use soft language: "I can check availability" or ask a qualifying question about trim/color rather than claim availability.',
    'Time awareness: every transcript message is dated. Always check how old a message is before referencing what it says. Travel plans, schedule constraints, school breaks, "I\'ll be back next week" — these expire fast. A customer detail from 30+ days ago is stale and likely no longer true. When a customer says "tomorrow" or "next week" in an old message, those dates passed long ago — never echo them back as if they\'re current. If the lead has been dormant for 60+ days, acknowledge the gap honestly or pivot to a fresh angle. Do NOT pretend the prior conversation just happened.',
    'Do not say "Carfax" — say "AutoCheck report" or "vehicle history report."',
    'Contractions are fine. Sounding human is the goal.',
    '',
    // ── VARIABLE SUFFIX (changes per persona/agent/store — cache boundary here) ──
    '━━━ YOUR ROLE ━━━',
    personaHint,
    '',
    'You write SMS, email, and voicemail responses to real car dealership customers. ' + (agentName ? 'You are ' + agentName + ', ' + personaTitle + (storeName ? ' at ' + storeName : '') + '.' : '') + (_sysPhone ? ' Your direct phone number is ' + _sysPhone + '. Use ONLY this number in ALL signatures — never use any other number.' : ''),
    (agentName ? 'IDENTITY LOCK: Your name is ' + agentName + '. Sign as ' + agentName + ', open as ' + agentName + ', refer to yourself as ' + agentName + '. The lead data may contain names of other dealership staff (Sales Rep, BD Agent, Manager, Brand Specialist, etc.) — those people are CONTEXT about the lead, not you. Never substitute one of those names for your own. Never write "I am [Sales Rep name]" or "[Sales Rep name] here" — you are ' + agentName + '.' : ''),
    'IMPORTANT: Always return all three formats. Respond ONLY with valid JSON: {"sms":"...","email":"...","voicemail":"...","subject":"..."}. No markdown, no text outside JSON.',
    'CRITICAL: You MUST always include ALL four fields — sms, email, subject, and voicemail — even if the persona is terse. Never omit a field. Never return an empty string for email.',
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
    'DO NOT say "Carfax" — the dealership uses AutoCheck for vehicle history reports. If referencing a vehicle history report, say "AutoCheck report" or "vehicle history report" — never "Carfax".',
    'Agent name and phone come from the lead context provided.',
  ].join('\n');
}

// (v9.7.54) Renders the RELATIONSHIP READING prompt section from
// data.relationshipSignals. Returns an empty string for simple/clean leads
// to avoid wall-of-green-bullets noise. Only emits the section when at least
// one meaningful signal fires.
//
// IMPORTANT: signals are INTERNAL — the model uses them to shape tone, never
// to reference back to the customer. The interpretation block at the bottom
// translates raw signals into behavioral guidance.
function renderRelationshipReading(data) {
  var s = data && data.relationshipSignals;
  if (!s) return '';

  // Brevity guard: bail entirely on simple leads with no friction or fatigue.
  // Hot-and-clean leads don't need a digest -- the raw transcript is enough.
  //
  // Triggers (any one fires the section):
  //   - friction history: no-show, frustration, or pricing objection
  //   - channel fatigue: 3+ outbound with no reply, OR last inbound 14+ days ago
  //   - rich arc: 8+ total messages on the lead
  //   - dormancy: 30+ days quiet (catches long-tail leads even with sparse counts)
  //   - high note volume + age: 20+ notes AND 14+ days since contact (catches
  //     long messy leads where signal extraction may have undercounted messages)
  var anyFriction = s.hasNoShowHistory || s.hasFrustrationHistory || s.hasPricingFriction;
  var anyFatigue  = s.channelFatigue || (s.lastInboundAgeDays !== null && s.lastInboundAgeDays >= 14);
  var anyArc      = (s.totalInboundCount + s.totalOutboundCount) >= 8;
  // Pull lead-level age + note count from the data envelope as fallback signals.
  // Some leads (especially phone-heavy or older repeat-customer records) under-count
  // through the message regex but are still rich-history situations where the model
  // benefits from a relationship reading.
  //
  // (v9.7.56) IMPORTANT: data.contactedAgeDays comes from VinSolutions' "Contacted"
  // field which counts ANY outbound activity including System Marketing Campaign
  // emails. A 90-day-quiet lead can show contactedAge=0 just because a system blast
  // went out yesterday. Prefer s.lastInboundAgeDays (customer-only signal) when
  // available; only fall back to contactedAge when we have no customer signal at all.
  var contactedAge   = (typeof data.contactedAgeDays === 'number') ? data.contactedAgeDays : null;
  var totalNotes     = (typeof data.totalNoteCount === 'number') ? data.totalNoteCount : 0;
  // Effective age = customer-only inbound age if we have it, else VinSolutions contacted
  // (which is fallible but better than nothing).
  var effectiveAge   = (s.lastInboundAgeDays !== null) ? s.lastInboundAgeDays : contactedAge;
  var anyDormancy    = effectiveAge !== null && effectiveAge >= 30;
  var anyRichHistory = totalNotes >= 20 && (effectiveAge === null || effectiveAge >= 14 || s.consecutiveOutboundNoReply >= 2);

  if (!anyFriction && !anyFatigue && !anyArc && !anyDormancy && !anyRichHistory
      && !s.hasOpenCommitments && !s.hasUnansweredQuestions && !s.hasRecurringTopic && !s.hasPersonalContext) return '';

  var lines = [];
  lines.push('');
  lines.push('━━━ RELATIONSHIP READING — INTERNAL CONTEXT, NEVER REFERENCE TO CUSTOMER ━━━');
  lines.push('Pre-digested signals from the full lead history. Use these to calibrate tone and approach.');
  lines.push('Do NOT quote, mention, or hint at these signals to the customer in your response.');
  lines.push('');

  // ENGAGEMENT
  var engagementBits = [];
  if (s.lastInboundAgeDays !== null) {
    if (s.lastInboundAgeDays === 0)        engagementBits.push('Customer replied today.');
    else if (s.lastInboundAgeDays < 1)     engagementBits.push('Customer replied in the last 24 hours.');
    else if (s.lastInboundAgeDays < 3)     engagementBits.push('Customer last replied ' + Math.round(s.lastInboundAgeDays) + ' day(s) ago.');
    else if (s.lastInboundAgeDays < 14)    engagementBits.push('Customer last replied ' + Math.round(s.lastInboundAgeDays) + ' days ago.');
    else if (s.lastInboundAgeDays < 30)    engagementBits.push('Customer last replied ' + Math.round(s.lastInboundAgeDays) + ' days ago -- going cold.');
    else                                   engagementBits.push('Customer last replied ' + Math.round(s.lastInboundAgeDays) + ' days ago -- long dormant.');
  } else if (effectiveAge !== null && effectiveAge >= 14) {
    // Fallback: signal extraction missed the inbound timestamp but lead-level
    // age says the lead is quiet. Surface that to the model anyway.
    // Uses effectiveAge (customer-only when available, VinSolutions Contacted as
    // fallback) so System Marketing email blasts don't make dormant leads look fresh.
    if (effectiveAge < 30)      engagementBits.push('Last contact was about ' + Math.round(effectiveAge) + ' days ago -- going cold.');
    else                        engagementBits.push('Last contact was about ' + Math.round(effectiveAge) + ' days ago -- long dormant.');
  }
  if (s.consecutiveOutboundNoReply >= 3) {
    engagementBits.push(s.consecutiveOutboundNoReply + ' consecutive outbound messages with no customer reply. Channel showing fatigue.');
  } else if (s.consecutiveOutboundNoReply === 2) {
    engagementBits.push('2 outbound messages since last customer reply -- early fatigue.');
  }
  if (s.totalInboundCount + s.totalOutboundCount >= 6) {
    engagementBits.push('Total exchange: ' + s.totalInboundCount + ' inbound / ' + s.totalOutboundCount + ' outbound across the lead history.');
  } else if (totalNotes >= 20) {
    // Fallback: lots of activity on the lead even if message-counter undercounted
    engagementBits.push('Heavy lead history: ' + totalNotes + ' total CRM entries across the relationship. Read the arc carefully before responding.');
  }
  if (engagementBits.length) {
    lines.push('ENGAGEMENT:');
    engagementBits.forEach(function(b){ lines.push('  - ' + b); });
    lines.push('');
  }

  // FRICTION
  var frictionBits = [];
  if (s.hasNoShowHistory) {
    frictionBits.push(s.priorNoShows + ' prior no-show appointment(s) on file. Do NOT reference the no-show directly — it would feel accusatory. Soft re-engage instead.');
  } else if (s.priorAppointmentsTotal >= 2) {
    frictionBits.push(s.priorAppointmentsTotal + ' prior appointments on file (no no-shows). Customer has shown up before.');
  }
  if (s.hasFrustrationHistory) {
    var frustExamples = s.frustrationSignals.slice(0,2).map(function(f){
      return '"' + f.sentence.replace(/"/g,"'").substring(0,100) + '"' + (f.date ? ' (' + f.date + ')' : '');
    });
    frictionBits.push('Customer has expressed frustration before: ' + frustExamples.join(' / ') + '. Lead with empathy, never push, do not match heat.');
  }
  if (s.hasPricingFriction) {
    var poExamples = s.priorPricingObjections.slice(0,2).map(function(p){
      return '"' + p.sentence.replace(/"/g,"'").substring(0,100) + '"' + (p.date ? ' (' + p.date + ')' : '');
    });
    frictionBits.push('Customer has raised pricing/budget concerns: ' + poExamples.join(' / ') + '. Be careful with payment talk; do not pile on price pressure.');
  }
  if (frictionBits.length) {
    lines.push('FRICTION HISTORY:');
    frictionBits.forEach(function(b){ lines.push('  - ' + b); });
    lines.push('');
  }

  // (v9.7.81) RECURRING TOPICS -- categories the customer has come back to 2+ times.
  // The model frequently misses these because they're spread across the transcript.
  var topicBits = [];
  if (s.hasRecurringTopic) {
    var topicLabels = {
      trade:         'Trade-in / trade value',
      financing:     'Financing / credit / payment',
      configuration: 'Vehicle configuration (color, trim, features)',
      distance:      'Distance / travel logistics',
      useCase:       'Family / use-case (kids, work, towing)',
      competitor:    'Other vehicles or dealerships'
    };
    for (var tk in s.topicMentions) {
      var tm = s.topicMentions[tk];
      if (tm.count >= 2) {
        var topicExamples = tm.mentions.slice(0,2).map(function(m){
          return '"' + m.sentence.replace(/"/g,"'").substring(0,100) + '"' + (m.date ? ' (' + m.date + ')' : '');
        });
        topicBits.push(topicLabels[tk] + ' has come up ' + tm.count + ' time(s): ' + topicExamples.join(' / '));
      }
    }
  }
  if (topicBits.length) {
    lines.push('RECURRING TOPICS IN THIS RELATIONSHIP:');
    topicBits.forEach(function(b){ lines.push('  - ' + b); });
    lines.push('');
  }

  // (v9.7.81) FORWARD -- open commitments and unanswered questions. These are
  // the threads the conversation expected to continue but may not have.
  var forwardBits = [];
  if (s.customerCommitments.length > 0) {
    var ccExamples = s.customerCommitments.slice(-2).map(function(c){
      return '"' + c.sentence.replace(/"/g,"'").substring(0,100) + '"' + (c.date ? ' (' + c.date + ')' : '');
    });
    forwardBits.push('Customer said they would do something: ' + ccExamples.join(' / ') + '. If this never followed through, the conversation has an open loop on their side.');
  }
  if (s.agentCommitments.length > 0) {
    var acExamples = s.agentCommitments.slice(-2).map(function(c){
      return '"' + c.sentence.replace(/"/g,"'").substring(0,100) + '"' + (c.date ? ' (' + c.date + ')' : '');
    });
    forwardBits.push('Agent committed to do something: ' + acExamples.join(' / ') + '. Check if this commitment was fulfilled in subsequent outbound. If not, address it or honor it before asking for anything new.');
  }
  if (s.unansweredQuestions.length > 0) {
    var uqExamples = s.unansweredQuestions.slice(-3).map(function(q){
      return '"' + q.question.replace(/"/g,"'").substring(0,120) + '"' + (q.date ? ' (' + q.date + ')' : '');
    });
    forwardBits.push('Customer asked question(s) that may not have been answered: ' + uqExamples.join(' / ') + '. Read the surrounding transcript carefully — if the question is still open, address it directly before moving on.');
  }
  if (forwardBits.length) {
    lines.push('OPEN THREADS:');
    forwardBits.forEach(function(b){ lines.push('  - ' + b); });
    lines.push('');
  }

  // (v9.7.81) PERSONAL CONTEXT -- things the customer has volunteered.
  // CRITICAL: framed as silent calibration. The model must not echo these as recall.
  if (s.hasPersonalContext) {
    // Dedupe by type+sentence to avoid showing the same fact 5 times
    var seenContext = {};
    var dedupedContext = s.personalContext.filter(function(p){
      var key = p.type + '::' + p.sentence.substring(0,60).toLowerCase();
      if (seenContext[key]) return false;
      seenContext[key] = true;
      return true;
    }).slice(0, 5);
    if (dedupedContext.length > 0) {
      lines.push('PERSONAL CONTEXT THE CUSTOMER HAS SHARED (silent calibration only):');
      dedupedContext.forEach(function(p){
        lines.push('  - [' + p.type + '] "' + p.sentence.replace(/"/g,"'").substring(0,120) + '"' + (p.date ? ' (' + p.date + ')' : ''));
      });
      lines.push('  CRITICAL: Use these to calibrate warmth and relevance. NEVER echo them back as recall ("I remember you mentioned..."). The customer told the agent — not you — and surfacing them as recall reads as creepy or AI-templated. Let them inform tone, vehicle framing, or relevance. Never quote them.');
      lines.push('');
    }
  }

  // INTERPRETATION — translate signals into instructions
  var interp = [];
  if (s.channelFatigue && !s.hasNoShowHistory) {
    interp.push('This is not a hot lead. Soft re-engage — change the angle, do not press for an appointment hard.');
  }
  if (s.hasNoShowHistory) {
    interp.push('Treat this as a re-engagement, not a fresh appointment push. The customer has missed before — they need a low-pressure reason to come in.');
  }
  if (s.hasFrustrationHistory) {
    interp.push('Customer has been irritated in this thread before. Stay calm, acknowledge briefly if the most recent message hints at it, never escalate energy.');
  }
  if (s.hasPricingFriction) {
    interp.push('Pricing has been a friction point. Avoid leading with payment math unless the customer asks. Frame value, then offer to talk numbers in person.');
  }
  // (v9.7.81) New interpretation rules for the new categories
  if (s.hasUnansweredQuestions) {
    interp.push('There are open questions from the customer that may not have been answered. Read the transcript carefully — if any are still unanswered, addressing them is the highest-leverage move this message can make. The customer is more likely to be silent because we did not answer than because they lost interest.');
  }
  if (s.agentCommitments.length > 0) {
    interp.push('The agent made commitments to the customer that may or may not have been fulfilled. If the agent said "I will send pics" or "I will call you back" and no follow-up is visible in the outbound history, honoring that commitment now (or acknowledging the slip honestly) is the right move. Do NOT ask for new commitments while owing the customer an old one.');
  }
  if (s.customerCommitments.length > 0 && s.lastInboundAgeDays !== null && s.lastInboundAgeDays >= 3) {
    interp.push('The customer said they would do something (think it over, come by, get back to you) but has gone quiet since. Soft re-open — acknowledge their last commitment without naming it accusatorily. "Wanted to make sure we did not lose touch" lands better than "you said you would come by."');
  }
  if (s.hasRecurringTopic) {
    var topTopic = null;
    var topCount = 0;
    for (var tk2 in s.topicMentions) {
      if (s.topicMentions[tk2].count > topCount) {
        topCount = s.topicMentions[tk2].count;
        topTopic = tk2;
      }
    }
    if (topTopic && topCount >= 3) {
      interp.push('"' + topTopic + '" has been a recurring thread (' + topCount + ' mentions). If this topic has not been resolved, it may be the silent reason for any stall. Addressing it directly often unsticks the conversation.');
    }
  }
  if (s.lastInboundAgeDays !== null && s.lastInboundAgeDays >= 14 && !s.channelFatigue) {
    interp.push('Conversation has been quiet for a while. Acknowledge the gap honestly or pivot to a fresh angle -- do NOT pretend the prior conversation just happened.');
  }
  // Fallback dormancy interpretation when extracted signals were sparse
  if (s.lastInboundAgeDays === null && effectiveAge !== null && effectiveAge >= 30 && interp.length === 0) {
    interp.push('Lead has been quiet for over a month. Acknowledge the gap honestly or pivot to a fresh angle. Do NOT pretend the prior conversation just happened. Soft re-engage rather than pressing for an immediate appointment.');
  }
  // Rich-history catch-all: surface the depth of the relationship to the model
  // when the lead has heavy history but no specific friction signal extracted.
  if (interp.length === 0 && totalNotes >= 20) {
    interp.push('This lead has substantial history (' + totalNotes + ' entries). Read the full arc carefully -- prior context likely matters more than the most recent message alone. Match your tone to where the customer actually is in the journey, not where they started.');
  }
  if (interp.length) {
    lines.push('INTERPRETATION FOR THIS RESPONSE:');
    interp.forEach(function(b){ lines.push('  - ' + b); });
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  return lines.join('\n');
}

function buildUserPrompt(data) {
  const sc   = classifyScenario(data);
  const hasRealOutbound = !!(data.hasOutbound);
  const appt = computeAppointmentTimes(data.store);
  // (v9.7.88) Phone resolution: prefer the RESOLVED SIGNER's phone, then
  // agent directory, then store-level fallback. Prior order put store phone
  // first, which leaked the Internet Director's number (281-837-3382) into
  // SMS/email signatures when generating as a BDC impersonating Kristen
  // Willis on Honda Baytown (her number is 281-837-3380). The model would
  // use 3382 in its signature; enforceSmsSig/EnforceEmailPhone would append
  // a canonical sig with 3380; result: doubled-sig with mismatched numbers.
  //
  // The resolved signer is computed by resolveSignerForPersona before this
  // function runs and accounts for persona impersonation correctly: Director
  // signing as BDC → BD Agent's phone; sales as sales rep's; etc.
  var _resolvedSignerPhone = (window._leadProResolvedSigner && window._leadProResolvedSigner.phone) || '';
  var _promptStorePhone = '';
  if (data.dealerId && window._leadProDealerData) {
    var _pds = (window._leadProDealerData.stores || []).find(function(s) {
      return String(s.crmDealerId) === String(data.dealerId) || String(s.id) === String(data.dealerId);
    });
    if (_pds && _pds.phone) _promptStorePhone = _pds.phone;
  }
  const phone = _resolvedSignerPhone
    || lookupPhone(data.agent, data.store, data.dealerId)
    || _promptStorePhone
    || (window._leadProResolvedContext && window._leadProResolvedContext.phone)
    || (_leadProProfile && _leadProProfile.phone)
    || data.agentPhone
    || '';
  // (v9.7.88) Diagnostic: which phone source won, and what each candidate had.
  try {
    var _phoneSrc = _resolvedSignerPhone ? 'signer'
      : lookupPhone(data.agent, data.store, data.dealerId) ? 'directory'
      : _promptStorePhone ? 'storeConfig'
      : (window._leadProResolvedContext && window._leadProResolvedContext.phone) ? 'resolvedContext'
      : (_leadProProfile && _leadProProfile.phone) ? 'profile'
      : data.agentPhone ? 'agentPhone'
      : 'empty';
    console.log('[LP PROMPT PHONE] used:', phone, '| source:', _phoneSrc,
      '| signer:', _resolvedSignerPhone || '(none)',
      '| directory:', lookupPhone(data.agent, data.store, data.dealerId) || '(none)',
      '| storeConfig:', _promptStorePhone || '(none)',
      '| agent:', data.agent || '(none)');
  } catch(e) { console.log('[LP PROMPT PHONE] diag error:', e.message); }
  const agentFirst = (data.agent || '').split(' ')[0] || data.agent || '';

  // ── SITUATION BRIEF — pre-digest the transcript so the model reads the room ──
  var situationBrief = [];

  // Isolate the CURRENT LEAD portion of the transcript.
  // Transcript is newest-first, so the marker appears in the MIDDLE of the string:
  //   [today's notes] [MARKER] [older history]
  // We want to analyze only the part BEFORE the marker (the current lead's activity).
  var ctx_sb_raw = data.context || '';
  // Declare hasCustomerReply early so situation brief branches can use it
  var hasCustomerReply = /\[CUSTOMER\]/i.test(ctx_sb_raw)
    || /Inbound Text|Inbound phone|Email reply from prospect/i.test(ctx_sb_raw);
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
  var sbTimingConcern  = /not ready|few months|next year|waiting|when i.m ready|not yet|saving up|months away|this weekend|next weekend|impossible|can.?t (make it|come in|this weekend|next weekend)|keep you posted|let you know|will (let|keep)|not (available|able to)|won.?t be able|another time|check back|not a good time/i.test(sbCustLow);
  var sbSpecificQuestion = data.lastInboundMsg && /\?/.test(data.lastInboundMsg);
  var sbShortMsg  = (data.lastInboundMsg || '').trim().split(/\s+/).length <= 6;
  var sbLongMsg   = (data.lastInboundMsg || '').trim().split(/\s+/).length > 20;
  // Emotional read — helps AI calibrate tone
  var sbFrustrated    = /stop (texting|calling|emailing|messaging)|leave me alone|not interested|already told|already said|told you|how many times|multiple times|quit contacting|unsubscribe/i.test(sbCustLow);
  var sbEnthusiastic  = /ready to (buy|purchase|move)|let.s do|sounds great|perfect|awesome|excited|can.?t wait|love it|absolutely|definitely/i.test(sbCustLow);
  var sbHesitant      = /thinking about|not sure|maybe|might|considering|weighing|on the fence|need to discuss|talk to (my|the)/i.test(sbCustLow);
  var sbApologetic    = /sorry|apologize|my bad|didn.?t mean|wasn.?t trying/i.test(sbCustLow);

  if (sbTotal > 0 || sbHungUp || sbMsgs > 0 || sbPriceConcern || sbTimingConcern || sbFrustrated || sbEnthusiastic || sbHesitant || data.lastInboundMsg || data.hasMissedCallBackPromise) {
    situationBrief.push('━━━ SITUATION BRIEF ━━━');
    situationBrief.push('');

    // What has been tried
    var tried = [];
    if (sbTexts > 0)  tried.push(sbTexts + ' text' + (sbTexts > 1 ? 's' : ''));
    if (sbCalls > 0)  tried.push(sbCalls + ' call' + (sbCalls > 1 ? 's' : ''));
    if (sbEmails > 0) tried.push(sbEmails + ' email' + (sbEmails > 1 ? 's' : ''));
    if (tried.length) situationBrief.push('Contact history: ' + tried.join(', ') + ' sent so far.');

    // Hard facts the model needs to know
    if (sbHungUp)          situationBrief.push('⚠ Customer hung up on calls — text only.');
    if (data.hasMissedCallBackPromise) situationBrief.push('📞 MISSED CALL-BACK: Customer expected a call that never came (they said: "' + (data.missedCallBackDetail || '').substring(0,80) + '"). Acknowledge this — do not re-pitch.');
    if (sbNoVm)            situationBrief.push('⚠ No voicemail box — text or email only.');
    if (sbContacted > 0)   situationBrief.push('✓ Customer was reached ' + sbContacted + ' time(s) — no need to re-introduce.');
    if (sbSpecificQuestion) situationBrief.push('❓ Customer asked a specific question — answer it first.');
    if (sbFrustrated)      situationBrief.push('😤 Customer sounds frustrated.');
    if (sbEnthusiastic)    situationBrief.push('🔥 Customer is high-intent and ready to move.');
    if (sbHesitant)        situationBrief.push('🤔 Customer is weighing options.');
    if (sbPriceConcern)    situationBrief.push('💰 Customer raised price or package concerns.');
    if (sbTimingConcern)   situationBrief.push('⏳ Customer indicated timing is not right yet.');

    situationBrief.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  // ── STRATEGIC MANDATE — synthesize all signals into one behavioral directive ──
  // This sits above the scenario so the model has strategic judgment before it reads the task.
  // The scenario provides content and facts. This provides the read of the room.



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
    scenarioDirective = 'TASK: Customer missed their appointment. Re-engage warmly — do not guilt them. The goal is to reschedule without making them feel bad about missing.';
    scenarioRules = [
      '- Open with empathy, not accusation. Do NOT say "you missed your appointment."',
      '- Use neutral language: "we missed connecting", "something must have come up", "no worries at all."',
      '- Offer to reschedule — make it easy and low-pressure.',
      '- Reference what they were coming in for (vehicle, trade, financing) so it feels personal.',
      '- If they have hung up repeatedly or gone dark, shift to a pattern breaker — curiosity angle or easy-out. Do NOT push another appointment time.',
    ].join('\n');

  } else if (sc.isClickAndGo) {
    // Build opening based on what customer actually completed in the VR tool
    // ACCURACY: Only reference what the notes confirm — never claim a credit app was submitted if notes say "Not Started"
    var vrOpening;
    if (data.vrCompleted) vrOpening = 'I saw you completed your deal online through Click & Go — you have done all the heavy lifting!';
    else if (data.vrCreditApp) vrOpening = 'I saw your credit application come through — that is a great first step and puts us in a strong position to move fast.';
    else if (data.vrPaymentSelected && data.vrTradeIn) vrOpening = 'I saw you started your deal online through Click & Go — including your payment preferences and trade-in.';
    else if (data.vrPaymentSelected) vrOpening = 'I saw you started your deal online and selected your payment preferences through Click & Go.';
    else if (data.vrTradeIn) vrOpening = 'I saw you started your deal online through Click & Go — including your trade-in details.';
    else vrOpening = 'I saw you started your deal online through Click & Go.';

    var vrProgress;
    if (data.vrCompleted) vrProgress = 'You have done all the heavy lifting — we just need to finalize the details in person';
    else if (data.vrCreditApp) vrProgress = 'With your application already submitted, I can have financing options and numbers ready before you even arrive — coming in typically takes about 30-45 minutes to finalize everything';
    else if (data.vrTradeIn) vrProgress = 'Having your trade-in details in already saves time — I can have a solid number ready when you arrive';
    else if (data.noVehicleAtAll && data.vrCreditApp) vrProgress = 'With your application already in, we can match you to the right vehicle and get you numbers fast — coming in takes about 30 minutes';
    else if (data.noVehicleAtAll) vrProgress = 'You have already taken the first step — let me help you find the right vehicle to go along with it';
    else vrProgress = 'You have already done the hard part — the vehicle is here and ready for you to see';

    var clickGoHasOutreach = data.hasOutbound || data.isContacted;
    scenarioDirective = clickGoHasOutreach
      ? 'TASK: Click & Go lead with PRIOR OUTREACH already made. This is a follow-up — NOT a first introduction. Do NOT re-introduce yourself as if this is first contact. React to where the conversation actually stands.'
      : data.vrCreditApp
        ? 'TASK: Gubagoo Dynamic Credit App — customer submitted a credit application online. This is HIGH INTENT. They are ready to move. Your job is to confirm the vehicle, acknowledge the application, and get them in to finalize.'
        : 'TASK: Click & Go lead — first contact. Customer took an online action. Acknowledge EXACTLY what they completed.';
    scenarioRules = clickGoHasOutreach
      ? [
        '- Follow-up: read the transcript and continue naturally from where things left off.',
        '- Never say Gubagoo, virtual retailing platform, digital retailing, or "dynamic credit app".'
      ].join('\n')
      : data.vrCreditApp
      ? [
        '- What happened: This customer submitted a credit application through the Click & Go online retailing tool before the lead came in. That is a buying signal, not a casual inquiry.',
        '- BOTH SMS and EMAIL must mention Click & Go by name once — briefly, naturally. Something like "through our Click & Go tool" or "via Click & Go." Do not explain what it is. Just reference it in both formats.',
        '- SMS quality bar is the same as email. The SMS should not be a watered-down version — same specificity, same confidence, same Click & Go reference, same urgency. Written at text length, not compressed.',
        '- What they want: They want to know where things stand and what happens next. Answer that.',
        '- What to avoid: Do NOT open with a generic "I saw your inquiry" opener. Reference the application specifically — they filled something out. Acknowledge that they took a real step.',
        '- How to position it: Frame the visit as the finishing line, not the starting line. The hard part is already done on their end — you just need to confirm the vehicle, pull the numbers, and get them in.',
        '- Tone: Confident and ready. Match their energy — they moved fast, you move fast.',
        '- Never say Gubagoo, virtual retailing platform, or "dynamic credit app". Say "your application" or "the info you submitted."',
        '- Energy: high-intent customer who took a real step. Move with them.'
      ].join('\n')
      : [
        '- What happened: Customer used the Click & Go online retailing tool and took an action — ' + vrOpening.toLowerCase().replace(/^i saw /, '') + '.',
        '- Mention Click & Go by name once in BOTH SMS and email — briefly and naturally. Do not explain what it is. Just reference it.',
        '- SMS quality bar is the same as email — same specific hook, same confidence, same Click & Go reference. Written at text length — the SMS is a complete message, not a summary.',
        '- Reference what they actually did. Do not restate the whole VR process — just name the specific thing they completed.',
        '- ' + vrProgress + '. Lead with that angle.',
        '- CRITICAL: The VR deal data (credit score, APR, payment amount, lender) is SYSTEM-GENERATED context — NOT something the customer said or complained about. Do NOT reference pricing concerns, credit concerns, APR, or payment friction unless the customer explicitly stated it in a message. This is first contact — treat it as a warm, high-intent opener, NOT a recovery of an objection.',
        '- Close in whatever way the conversation calls for.',
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
        '- ' + mmClose,
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
        '- Close in whatever way the conversation calls for.',
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
        '- Close in whatever way the conversation calls for.',
        '- ' + mmNever
      ].join('\n');
    } else if (mmPhase === 'active') {
      scenarioDirective = 'TASK: Automotive Mastermind — Customer has replied. Read the full transcript and respond to exactly what they said. Stay within the Private Incentive framing throughout.';
      scenarioRules = [
        '- READ THE TRANSCRIPT FIRST. The customer has engaged. Your response must directly continue their conversation.',
        '- Answer any question they asked before anything else.',
        '- Keep the Private Incentive and GM Lonnie Sabbath framing present but natural — do not force it if the conversation has moved past it.',
        '- Reference ' + mmSalesRep + ' as their Brand Specialist if relevant.',
        '- Read the transcript and respond to exactly what they said. Close in whatever way the conversation calls for.',
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

  } else if (sc.isLeaseMature) {
    var lsLower2 = (data.leadSource || '').toLowerCase();
    var isAFSlead   = /afs/i.test(lsLower2);
    var isKiaLUV    = /luv|kmf/i.test(lsLower2);
    var isTFSlead   = /tfs|toyota.*financ|insprod/i.test(lsLower2);
    var isKFAlead   = /kfa/i.test(lsLower2);
    var monthsOut   = (lsLower2.match(/in\s+(\d+)\s+month/i) || [])[1] || '';
    var acctType    = (isKFAlead || /off.?loan/i.test(lsLower2)) ? 'loan' : 'lease';
    var programName = isAFSlead ? 'Audi Financial Services (AFS)'
      : isKiaLUV ? 'Kia Motors Finance (KMF / LUV program)'
      : isTFSlead ? 'Toyota Financial Services (TFS)'
      : isKFAlead ? 'Kia Finance America (KFA)'
      : 'manufacturer finance program';
    var timingLine = monthsOut
      ? 'Their ' + acctType + ' matures in approximately ' + monthsOut + ' months -- this is the hook.'
      : 'Their ' + acctType + ' is approaching maturity -- lead with this timing.';
    scenarioDirective = 'TASK: ' + programName + ' end-of-' + acctType + ' lead. Customer\'s ' + acctType + ' is coming due. This is a warm transition opportunity, not a cold inquiry.';
    scenarioRules = [
      '- The vehicle shown is their CURRENT ' + acctType + 'ed vehicle — NEVER say it is in stock, available, or on the lot.',
      '- ' + timingLine,
      '- Open by acknowledging their current vehicle and the upcoming ' + acctType + ' end.',
      acctType === 'lease'
        ? '- Options: return and lease new, purchase at residual, or switch to finance. Let them lead.'
        : '- Options: trade in and finance new, pay off and keep, or upgrade. Do not push one.',
      isAFSlead
        ? '- Audi Concierge tone: premium, personal. Frame as a planned transition, not a sales call.'
        : isKFAlead
        ? '- KFA In-Equity: customer has positive equity in their Kia loan — lead with the equity angle ("your current vehicle has built up equity we can put toward your next one"). Do NOT treat as lease-end.'
        : isKiaLUV
        ? '- Kia LUV/KMF: warm and loyalty-based. Acknowledge they are a returning Kia customer.'
        : isTFSlead
        ? '- TFS: reference Toyota Financial naturally. Frame the maturity date as an opportunity, not a deadline.'
        : '',
      monthsOut ? '- Reference the ' + monthsOut + '-month window naturally.' : '',
      '- If payoff or residual data is in context, reference the buyout amount (e.g. "your buyout is around $X").',
    ].filter(Boolean).join('\n');
  } else if (sc.isDistanceBuyer) {
    scenarioDirective = 'TASK: Distance buyer — customer is out of state or has explicitly asked about delivery/shipping. They cannot easily come in. Adjust the entire approach.';
    scenarioRules = [
      '- This customer cannot easily come in. Their actual questions come first: price, delivery, remote process.',
      '- Be honest: if delivery is available, say so. If not, tell them what you CAN do (photos, video walkaround, remote paperwork, trade-in value by photos).',
      '- Make the distance feel manageable. Frame the trip as worth it if they come, or offer concrete remote steps.',
      '- Close with whatever next step works for them: a phone call, a video, a price quote, or a delivery inquiry.',
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
      // Exclude TrueCar's own non-affinity segment names. "Extended Network" is what TrueCar
      // calls leads from outside the affinity network — there is no "Extended Network benefit"
      // to reference. These should be treated as plain TrueCar leads.
      var _isNonAffinitySegment = /^(extended\s*network|standard|direct|partner\s*network|non[\s-]?affinity)$/i.test(partnerRaw);
      if (partnerRaw && partnerRaw.length > 2 && !/^truecar$/i.test(partnerRaw) && !_isNonAffinitySegment) {
        tcPartner = partnerRaw;
      }
    }
    var isTcPartner = tcPartner !== 'TrueCar';
    // Only treat as follow-up if there is real recent outbound — not just old history on a recycled lead
    var tcFollowUp = sc.isFollowUp && hasRealOutbound && (data.contactedAgeDays !== undefined && data.contactedAgeDays < 30);
    scenarioDirective = tcFollowUp
      ? 'TASK: TrueCar' + (isTcPartner ? ' / ' + tcPartner + ' affinity partner' : '') + ' lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: TrueCar' + (isTcPartner ? ' / ' + tcPartner + ' affinity partner' : '') + ' lead -- customer came through a price-transparent platform.';
    scenarioRules = tcFollowUp
      ? [
        '- Follow-up: read the transcript and continue naturally from where things left off.'
      ].join('\n')
      : [
      isTcPartner
        ? '- OPEN with the ' + tcPartner + ' connection.'
        : '- MUST mention TrueCar in the opening.',
      '- Do NOT re-pitch the vehicle from scratch.',
      '- Do NOT use high-pressure language.',
      '- If the vehicle is in stock: confirm it is here and offer to have it pulled and ready.',
      '- Close in whatever way the conversation calls for.',
      isTcPartner ? '- Mention the ' + tcPartner + ' benefit naturally.' : '',
      /credit karma/i.test(ls) ? '- CREDIT KARMA CONTEXT: This customer came through a credit-focused channel. They are likely credit-conscious or actively working on their credit. Do NOT assume strong credit. Tone should be reassuring, not pushy. Avoid payment or financing pressure in the opener. Lead with the vehicle and the transparent pricing benefit.' : '',
    ].filter(Boolean).join('\n');

  } else if (sc.isCapitalOne) {
    var coFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = coFollowUp
      ? 'TASK: Capital One lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Capital One pre-qualification lead.';
    scenarioRules = coFollowUp
      ? [
        '- Follow-up: read the transcript and continue naturally from where things left off.'
      ].join('\n')
      : [
        '- Customer pre-qualified through Capital One.',
        '- Position the visit as matching the pre-qualification to the right vehicle.'
      ].join('\n');

  } else if (sc.isCreditApp) {
    var caFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = caFollowUp
      ? 'TASK: Credit application lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Credit application lead — customer submitted a credit or finance application.';
    scenarioRules = caFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : [
        '- Customer already took the biggest step — they submitted their credit. This is HIGH INTENT.',
        '- Acknowledge the application directly and warmly. Make them feel like they are almost done.',
        '- The next step is matching them to the right vehicle and finalizing in store. Frame the visit as the finish line.',
        '- Do NOT ask qualifying questions about budget or credit — they already gave you that. Ask about the vehicle.',
        '- Tone: confident and ready. This customer is a buyer.'
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
    scenarioDirective = 'TASK: Customer is not ready right now. Acknowledge it. Leave the door open.';
    scenarioRules = '';

  } else if (sc.isShowroomFollowUp) {
    const visitTiming = data.showroomVisitToday ? 'earlier today' : 'recently';
    const visitRef = data.showroomVisitToday ? '"I heard you stopped in earlier today"' : '"I heard you stopped in recently" or "I wanted to follow up on your visit."';
    scenarioDirective = 'TASK: Customer visited the dealership and met with the Sales Rep. The BD Agent is writing this follow-up but was NOT present for the visit.';
    scenarioRules = [
      '- Customer was in the showroom. BD Agent was NOT there — never say \'it was great meeting you.\'',
      '- Reference the visit: \'I heard you came in to look at the [vehicle].\'',
      '- Frame next step as finalizing, not starting over.',
      '- Keep it short — they already know the dealership.',
      '- Close in whatever way the conversation calls for.'
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
    var kbbHasNoVehicle = !data.vehicle || /not provided/i.test(data.vehicle || '');
    scenarioDirective = kbbFollowUp
      ? 'TASK: KBB Trade-In Advisor follow-up. Prior outreach already sent. Continue naturally from where things left off.'
      : 'TASK: KBB Trade-In Advisor lead — customer got a Kelley Blue Book value on their trade-in vehicle.';
    scenarioRules = kbbFollowUp
      ? [
        '- This is a TRADE-IN lead. The customer came to get a value on their current vehicle — they did NOT necessarily inquire about a specific vehicle to buy.',
        kbbHasNoVehicle
          ? '- NO VEHICLE OF INTEREST: There is no vehicle of interest on this lead. Do NOT reference a VIN, stock number, or specific vehicle. Do NOT say "the vehicle you inquired about." The customer has not expressed interest in any specific vehicle to purchase.'
          : '- Vehicle of interest is on the lead — reference it naturally.',
        '- WHAT THIS CUSTOMER WANTS: To know what their trade-in is worth. Lead with that angle.',
        '- Frame the visit as: come in, get a real appraisal on your trade, see what your options are from there.',
        '- Prior outreach already sent. Do NOT repeat the same angle. Continue from where things left off.',
        '- Do NOT re-introduce yourself.'
      ].join('\n')
      : [
        '- This is a TRADE-IN lead. Customer got a KBB value on their current vehicle.',
        kbbHasNoVehicle
          ? '- NO VEHICLE OF INTEREST: Do NOT mention a VIN or specific vehicle to buy. There is none on this lead.'
          : '- Vehicle of interest is on the lead — reference it naturally after acknowledging the trade.',
        '- Lead with the trade angle: their KBB value is a starting point — a real in-person appraisal gives them the actual number.',
        '- Never quote the specific KBB dollar amount.',
        '- Hook: position the visit as where they get the full story on their trade and see what it unlocks.'
      ].join('\n');

  } else if (sc.isAIBuyingSignalNew) {
    scenarioDirective = 'TASK: AI Buying Signal — new prospect flagged by behavioral data. See the SITUATION MATRIX above for the specific cell of this lead. Choose the play that fits.';
    scenarioRules = [
      '- This customer has NO prior purchase here. Cold prospect spotted by signals — they did not raise their hand.',
      '- Tone: light and curious, not cold outreach and not familiar warmth either. Approach gently.',
      '- Do not invent an ownership hook. Do not promise inventory you cannot confirm.',
      '- See the matrix block above for which play fits this specific lead — do not default to the same opener for every AI Buying Signal lead.'
    ].join('\n');

  } else if (sc.isAIBuyingSignalReturner) {
    scenarioDirective = 'TASK: AI Buying Signal — previously sold customer flagged as actively shopping. See the SITUATION MATRIX above for the specific cell of this lead. Choose the play that fits.';
    scenarioRules = [
      '- This is a RETURNING customer with real prior purchase history at this store.',
      '- Reference their currently owned vehicle (from the lead or trade-in field) if available. Do NOT invent an owned vehicle.',
      '- Tone: warm and familiar — they know you. Not cold outreach.',
      '- Do NOT use a cold opener like "I wanted to reach out." There is a relationship to draw on.',
      '- See the matrix block above — if this is a cross-brand situation, do not promise inventory you do not have. Read the matrix and choose the right play.',
      '- If no owned vehicle appears in the lead, skip the ownership reference and lead gently with the matrix-appropriate play.'
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
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : [
        '- CarGurus buyers have already seen your price and compared it against other listings. They are not shopping — they are validating. Your job is to confirm the vehicle is real, available, and worth the drive.',
        '- Move directly to what matters: the vehicle is here, here is why it is a good one, here is when you can come see it.',
        '- Tone: direct and real. No sales-speak. They can tell.'
      ].join('\n');

  } else if (sc.isFacebook) {
    var fbFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = fbFollowUp
      ? 'TASK: Facebook lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Facebook/Facebook Marketplace lead.';
    scenarioRules = fbFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : [
        '- Facebook Marketplace buyers expect casual, direct messaging. They are not looking for dealership formality — they want to know if the car is still there and what the real number is.',
        '- REQUIRED OPENING in both SMS and email: Start with a Facebook acknowledgment. Use exactly this kind of opener: "Thanks for reaching out on Facebook" or "Saw your message on Facebook" or "Got your Facebook message." This is not optional — it must be the first or second sentence in both formats.',
        '- Give them what they want: yes it is here, here is the out-the-door ballpark or an honest way to get it, come check it out.',
        '- Tone applies to BOTH SMS and email: casual, direct, no dealership formality. Short sentences. Contractions. The email should feel like a real person replied on Facebook Messenger, not a formal dealership email.'
      ].join('\n');

  } else if (sc.isAutoTrader) {
    var atFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = atFollowUp
      ? 'TASK: AutoTrader lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: AutoTrader lead.';
    scenarioRules = atFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : '- AutoTrader buyers are comparison shoppers — they are likely looking at multiple similar vehicles across different dealers. Give them a reason this specific vehicle and this specific store are worth their attention. Close with a concrete next step.';

  } else if (sc.isCarscom) {
    var ccFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = ccFollowUp
      ? 'TASK: Cars.com lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Cars.com lead.';
    scenarioRules = ccFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : '- Cars.com buyers have done their homework — reviews, comparisons, pricing. They expect professionalism and straight answers. Confirm the vehicle, explain what makes it a good one, close with a time.';

  } else if (sc.isEdmunds) {
    var edFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = edFollowUp
      ? 'TASK: Edmunds lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Edmunds lead.';
    scenarioRules = edFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : '- Edmunds buyers are research-heavy — they have likely read reviews, compared trims, and know the market price. Treat them as informed. Skip the basics. Confirm the vehicle, share any unique detail that makes this unit notable, close with a time.';

  } else if (sc.isCarFax) {
    var cfFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = cfFollowUp
      ? 'TASK: CarFax lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: CarFax lead — customer found this vehicle through CarFax.';
    scenarioRules = cfFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : '- CarFax buyers care about vehicle history — they likely already viewed the report. Confirm the vehicle is here, share any unique detail that makes this unit notable, close with a time.';

  } else if (sc.isDealerWebsite) {
    scenarioDirective = 'TASK: Dealer website lead — customer submitted an inquiry directly through the dealership website. High intent.';
    scenarioRules = [
      '- High intent lead — they came to YOUR website directly, not a third-party marketplace.',
      '- Lead with the vehicle they inquired about. Position the visit as the natural next step.',
      '- If stock/VIN is confirmed AND no internal agent notes indicate the vehicle is pending or on hold, be confident about availability. If the conversation arc contains a recent note about a deposit, pending sale, or hold, defer to that status (see AGENT INTELLIGENCE guidance above).'
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

  } else if (sc.isThirdPartyOEM && !sc.isStalled) {
    var tpoFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = tpoFollowUp
      ? 'TASK: Third-party lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Third-party lead — customer submitted an inquiry through an aggregator or partner program.';
    scenarioRules = tpoFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : [
        '- Treat like a marketplace lead. Customer compared you to other dealers — they need a reason to choose you.',
        '- Do NOT mention the specific lead source or aggregator name.',
        '- Confirm the vehicle is real and available, give them a reason to visit, close in whatever way fits where this customer is.',
        '- Tone: direct and confident. No fluff.'
      ].join('\n');

  } else if (sc.isCostco && !sc.isStalled) {
    var costcoFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = costcoFollowUp
      ? 'TASK: Costco Auto Program lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Costco Auto Program lead — customer came through the Costco member buying program.';
    scenarioRules = costcoFollowUp
      ? [
        '- Prior outreach already sent. Continue from where things left off.',
        '- Do NOT re-use the Costco opening.'
      ].join('\n')
      : [
        '- MUST acknowledge the Costco Auto Program in the opening of BOTH SMS and email. The customer came through their Costco membership — that is the trust foundation.',
        '- Opening example: \"Hi [Name], I saw you came to us through the Costco Auto Program — welcome.\"',
        '- Costco members expect a no-haggle, member-pricing experience. Reinforce that experience: they have pre-negotiated member pricing and a designated contact.',
        '- Let them know a dedicated Costco specialist will be their point of contact. This is part of the program expectation.',
        '- Tone: professional, trustworthy, low-pressure. Costco members chose this program specifically to avoid the typical dealership experience — honor that.',
        '- CLOSE: Two specific appointment times.'
      ].join('\n');

  } else if (sc.isIdentityMax && !sc.isStalled) {
    var imFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = imFollowUp
      ? 'TASK: IdentityMax lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: IdentityMax lead — customer responded to a targeted offer from the dealer website (e.g. a pop-up incentive or conquest offer).';
    scenarioRules = imFollowUp
      ? '- Follow-up: read the transcript and continue naturally from where things left off.'
      : [
        '- Customer responded to a specific offer shown on the website — likely a conquest incentive, trade offer, or model-specific promotion.',
        '- The vehicle shown in the lead is what triggered the offer. Reference it specifically.',
        '- Do NOT say "IdentityMax" or reference any data tool. Frame it as: they saw an offer on the website and responded.',
        '- Lead with the offer that brought them in. Confirm it is still available. Move to appointment.',
        '- Tone: warm and specific. They raised their hand — respond to exactly what they responded to.'
      ].join('\n');

  } else if (sc.isCarPro && !sc.isStalled) {
    var carProFollowUp = sc.isFollowUp && hasRealOutbound;
    scenarioDirective = carProFollowUp
      ? 'TASK: Car Pro Show lead with PRIOR OUTREACH already made. Read the transcript and continue naturally.'
      : 'TASK: Car Pro Show lead — customer came through the Car Pro Show with Jerry Reynolds. This is a relationship-based lead with a specific expectation.';
    scenarioRules = carProFollowUp
      ? [
        '- Prior outreach already sent. Continue from where things left off.',
        '- Do NOT re-use the Car Pro Show opening.',
        '- Read the transcript. Continue naturally.'
      ].join('\n')
      : [
        '- MUST mention the Car Pro Show and Jerry Reynolds in the opening of BOTH SMS and email. The customer came through that relationship — acknowledge it in both formats.',
        '- Car Pro Show customers have a pre-built trust. They chose this dealership because Jerry Reynolds recommended it. Honor that.',
        '- Opening example: "Hi [Name], I saw you came to us through the Car Pro Show with Jerry Reynolds — welcome."',
        '- Let them know the General Manager will be personally reaching out as well — include this in BOTH SMS and email. This is part of the Car Pro experience.',
        '- Tone: warm, trustworthy, personal. This is not a cold inquiry — they chose you specifically.',
        '- CLOSE: Two specific appointment times.'
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
        '- CLOSE: Customer is engaged. Close in whatever way moves this conversation forward naturally.',
      ].join('\n');
    } else if (data.vin && !data.stockNum && !sc.vehicleInTransit) {
      // VIN-only-no-stock — vehicle existence is known, physical lot presence is NOT.
      // The close cannot mandate appointment times for a vehicle we have not verified.
      scenarioRules = [
        '- The lead has a VIN but no stock number — the specific unit has NOT been verified as physically on the lot.',
        '- Do NOT claim the vehicle is here, pulled up, ready to see, or available to test drive.',
        '- Do NOT offer appointment times yet — offering "9:15 or 10:30 Friday" implies the vehicle will be here when the customer arrives. We cannot promise that until the unit is verified.',
        '- Reference the vehicle softly ("the LX you asked about") and ask ONE qualifying question that buys time to verify ("what features matter most so I can confirm the right match for you?").',
        '- CLOSE: Commit to verifying the unit and following up with confirmed availability and times. Example close: "Once I confirm the exact unit and what is on the lot today, I will get you a couple of times that work for you." Do NOT propose specific times in this message.',
        '- This protects the customer from making a wasted trip and protects the dealership from a broken promise.',
      ].join('\n');
    } else {
      scenarioRules = '- Read the conversation and use judgment. If the customer is engaged and available, close with an appointment. If the customer has signaled they are unavailable, not ready, or pushing back on timing, do not force appointment times — acknowledge and leave the door open instead.';
    }
  }

  // ── Inventory status overrides scenario directive for first-touch ─
  // Only applies when this is a first-touch lead (not follow-up/exit/etc.)
  // Exempt loyalty/lease-end leads — the vehicle shown IS the customer's current car,
  // not inventory that "sold". Sold-vehicle pivot is irrelevant for AFS/TFS/Kia LUV leads.
  // vehicleSold also applies to follow-ups — agent may have told customer mid-thread
  if (!sc.isExitSignal && !sc.isPauseSignal && !sc.isApptConfirmation && !sc.isShowroomFollowUp && !sc.isSoldDelivered && !sc.isLeaseMature && !sc.isLoyalty) {
    if (sc.vehicleInTransit && !sc.isFollowUp) {
      scenarioDirective = 'TASK: This vehicle is IN TRANSIT — the VIN is confirmed, meaning it exists and is assigned, but it has not yet arrived on the lot. This is a STRONG selling opportunity — the customer can secure it before it arrives.';
      scenarioRules = [
      '- Great news — the vehicle is confirmed and on its way. Lead with that.',
      '- Create light urgency around securing it before it arrives.',
      '- Give an estimated timeline if known. Invite them to commit now.'
    ].join('\n');
    } else if (sc.vehicleSold) {
      // Check if customer already knows the vehicle sold and is continuing to shop
      var custAlreadyKnows = /just started|still looking|keep looking|still searching|send me|let me know|keep me posted|let me know what|good to know|appreciate|ok thank|noted|understood/i.test(hasCustomerReply ? (data.lastInboundMsg || '') : '');
      if (custAlreadyKnows) {
        scenarioDirective = 'TASK: The vehicle sold — customer already knows and is continuing their search. They asked you to keep them updated. Your job is to acknowledge their search criteria and commit to finding them the right match.';
        scenarioRules = [
          '- Do NOT re-announce the vehicle sold — they know.',
          '- Acknowledge their search criteria specifically — what they told you they want.',
          '- Commit to a clear next step: "I will keep an eye out for X and send you options as they come in."',
          '- Ask ONE clarifying question only if something critical is still unknown (timeline, budget, must-have features).',
          '- Keep it brief — they are still shopping, not ready to close.',
        ].join('\n');
      } else {
        scenarioDirective = 'TASK: The specific vehicle of interest has been sold. Your job is to pivot to alternatives WITHOUT making the customer feel misled or like a bait-and-switch.';
        scenarioRules = [
          '- Lead with what you DO have — do not open with the bad news if the customer does not know yet.',
          '- Pivot: \'We actually just got a [comparable vehicle] in that I think you will love.\'',
          '- Be specific. Offer a real alternative, not a generic \'we have options.\'',
        ].join('\n');
      }
    }
  }

  // ── Vehicle pivot detection ────────────────────────────────────
  // Detect when customer's recent messages reference a different model than the lead vehicle.
  // e.g. Lead says 4Runner but customer is now asking about Tundra pricing.
  var vehiclePivotNote = '';
  var leadVehicleModel = (data.vehicle || '').replace(/^\d{4}\s+/,'').replace(/\s+/g,' ').toLowerCase();
  // Only scan actual customer messages for vehicle pivot — not full context which includes owned vehicle history
  // Extract only [CUSTOMER] tagged lines from context to avoid false positives from trade-in/service history
  // For pivot detection, ONLY use actual customer messages — not owned vehicle data,
  // service history, agent messages, or context injections which contain other vehicle names
  var ctxForPivot = (data.context || '');
  var inCustBlockPivot = false;
  var custOnlyLines = [];
  ctxForPivot.split('\n').forEach(function(l) {
    if (/\[CUSTOMER\]/i.test(l)) { inCustBlockPivot = true; }
    else if (/\[AGENT\]|\[NOTE\]|\[CALL NOTE\]|\[BROWSE|\[TFS|^---/.test(l)) { inCustBlockPivot = false; }
    if (inCustBlockPivot && l.trim().length > 2) custOnlyLines.push(l);
  });
  // Use lastInboundMsg + only confirmed customer block lines — nothing else
  var recentCustomerCtx = (data.lastInboundMsg || '') + ' ' + custOnlyLines.join(' ').slice(-2000);
  var toyotaModels = ['tundra','tacoma','sequoia','sienna','camry','corolla','rav4','highlander','venza','prius','crown','gr86','supra','land cruiser'];
  var hondaModels  = ['accord','civic','cr-v','pilot','odyssey','ridgeline','passport','hr-v','insight','prologue'];
  var kiaModels    = ['telluride','sorento','sportage','carnival','stinger','k5','k4','ev6','niro','soul','forte'];
  var allModels    = toyotaModels.concat(hondaModels).concat(kiaModels);
  var pivotModel   = '';
  for (var pm = 0; pm < allModels.length; pm++) {
    var m = allModels[pm];
    // Only flag if: model appears in recent customer context AND is NOT the lead vehicle
    if (!leadVehicleModel.includes(m) && new RegExp('\\b' + m + '\\b', 'i').test(recentCustomerCtx)) {
      pivotModel = m.charAt(0).toUpperCase() + m.slice(1);
      break;
    }
  }
  if (pivotModel && leadVehicleModel && !leadVehicleModel.includes(pivotModel.toLowerCase())) {
    // Suppress pivot if agent already addressed the pivot model in an outbound message
    // AND customer's last message doesn't re-raise it (indicating the question is resolved)
    var agentAlreadyAnsweredPivot = new RegExp('\\b' + pivotModel + '\\b', 'i').test(data.lastOutboundMsg || '');
    var pivotInLastCustomerMsg = new RegExp('\\b' + pivotModel + '\\b', 'i').test(data.lastInboundMsg || '');
    var pivotResolved = agentAlreadyAnsweredPivot && !pivotInLastCustomerMsg;
    if (!pivotResolved) {

      // Determine the brand of the pivot model
      var _pivotBrandMap = {
        'camry':'toyota','corolla':'toyota','rav4':'toyota','tacoma':'toyota','tundra':'toyota',
        'highlander':'toyota','sequoia':'toyota','sienna':'toyota','venza':'toyota','prius':'toyota',
        '4runner':'toyota','crown':'toyota','gr86':'toyota','supra':'toyota','land cruiser':'toyota',
        'accord':'honda','civic':'honda','cr-v':'honda','pilot':'honda','odyssey':'honda',
        'ridgeline':'honda','passport':'honda','hr-v':'honda','insight':'honda','prologue':'honda',
        'telluride':'kia','sorento':'kia','sportage':'kia','carnival':'kia','stinger':'kia',
        'k5':'kia','k4':'kia','ev6':'kia','niro':'kia','soul':'kia','forte':'kia','seltos':'kia',
      };
      var _pivotBrand = _pivotBrandMap[pivotModel.toLowerCase()] || '';
      var _currentStoreBrand = (/toyota/i.test(data.store||'') ? 'toyota'
        : /honda/i.test(data.store||'') ? 'honda'
        : /kia/i.test(data.store||'') ? 'kia'
        : /audi/i.test(data.store||'') ? 'audi' : '');
      var _pivotBrandCap   = _pivotBrand   ? _pivotBrand.charAt(0).toUpperCase()   + _pivotBrand.slice(1)   : pivotModel;
      var _currentBrandCap = _currentStoreBrand ? _currentStoreBrand.charAt(0).toUpperCase() + _currentStoreBrand.slice(1) : '';

      // Sister-brand stores in Baytown: Toyota, Honda, and Kia are all under Community Auto Group
      var _sisterbrandStores = { toyota: 'Community Toyota Baytown', honda: 'Community Honda Baytown', kia: 'Community Kia Baytown' };
      var _isBaytownStore = /baytown/i.test(data.store||'');
      var _hasSisterBrand = _isBaytownStore && _pivotBrand && _pivotBrand !== _currentStoreBrand && !!_sisterbrandStores[_pivotBrand];
      var _sisterStoreName = _hasSisterBrand ? _sisterbrandStores[_pivotBrand] : '';

      if (_hasSisterBrand) {
        // Customer pivoted to a brand we carry at a sister Baytown store — warm handoff opportunity
        vehiclePivotNote = '⚠ SISTER-BRAND PIVOT: Customer is now interested in a ' + pivotModel + ' (' + _pivotBrandCap + '). We are a ' + _currentBrandCap + ' store and do not carry ' + _pivotBrandCap + ' — BUT our sister store ' + _sisterStoreName + ' does. DO NOT pretend we have it here. Required approach: (1) Acknowledge their interest in the ' + pivotModel + ' warmly. (2) Be honest that we are a ' + _currentBrandCap + ' store. (3) Offer to connect them with ' + _sisterStoreName + ', which is also part of the Community Auto Group family — same team, different brand. (4) Ask one qualifying question (trim, color, budget) so you can provide the right intro. Close with a soft handoff offer, not a hard appointment at this store.';
      } else if (_pivotBrand && _currentStoreBrand && _pivotBrand !== _currentStoreBrand) {
        // Cross-brand pivot to a brand we don't carry anywhere in the group (e.g. Toyota store, customer wants Ford)
        var _brandPivotEquiv = {
          'camry':{'honda':'Honda Accord','kia':'Kia K5'},
          'corolla':{'honda':'Honda Civic','kia':'Kia Forte'},
          'rav4':{'honda':'Honda CR-V','kia':'Kia Sportage'},
          'highlander':{'honda':'Honda Pilot','kia':'Kia Telluride'},
          'tacoma':{'honda':'Honda Ridgeline'},
          'accord':{'toyota':'Toyota Camry','kia':'Kia K5'},
          'civic':{'toyota':'Toyota Corolla','kia':'Kia Forte'},
          'cr-v':{'toyota':'Toyota RAV4','kia':'Kia Sportage'},
          'pilot':{'toyota':'Toyota Highlander','kia':'Kia Telluride'},
          'k5':{'toyota':'Toyota Camry','honda':'Honda Accord'},
          'sportage':{'toyota':'Toyota RAV4','honda':'Honda CR-V'},
          'telluride':{'toyota':'Toyota Highlander','honda':'Honda Pilot'},
        };
        var _equiv = (_brandPivotEquiv[pivotModel.toLowerCase()] || {})[_currentStoreBrand] || '';
        vehiclePivotNote = '⚠ CROSS-BRAND PIVOT: Customer is now interested in a ' + pivotModel + ' (' + _pivotBrandCap + '). We are a ' + _currentBrandCap + ' store — we do NOT carry ' + _pivotBrandCap + '. DO NOT offer an appointment to see a ' + pivotModel + ' here. Required approach: (1) Acknowledge their interest in the ' + pivotModel + ' — validate it is a solid choice. (2) Be honest we are a ' + _currentBrandCap + ' store and cannot provide ' + _pivotBrandCap + ' inventory.' + (_equiv ? ' (3) Bridge to our comparable: "If you are still comparing, the ' + _equiv + ' is worth a look — what matters most to you in a vehicle?" Ask one qualifying question.' : ' (3) Close warmly and offer to stay in touch.') + ' Do NOT push for an appointment at this store for a vehicle we do not carry.';
      } else {
        // Same-brand pivot (different model within our brand) — standard pivot note
        vehiclePivotNote = 'VEHICLE PIVOT DETECTED: Customer is now asking about a ' + pivotModel + ', not the ' + (data.vehicle || 'original vehicle') + ' on the lead. Do NOT reference the ' + (data.vehicle || 'original vehicle') + ' as the vehicle they want. Address the ' + pivotModel + ' questions directly.';
      }
    }
  }

  // ── Inventory notes (for loyalty vehicle only — others handled above) ─
  let inventoryNote = '';

  // VIN-only-no-stock language is shared across model years — defined once,
  // composed into the relevant branches below. The architectural truth: stock
  // number = on the lot. VIN alone = exists in the world somewhere. Don't
  // imply availability either way.
  var _vinOnlyNoStockText = 'VIN-ONLY HANDLING: A VIN is on the lead but no stock number. VIN alone does NOT confirm the vehicle is physically on our lot — it may be inbound, a dealer-trade, or a lead-aggregator listing for a vehicle we have not yet acquired. RULES: (1) Reference the base model softly ("the LX you asked about"), do NOT claim availability of THIS specific unit. (2) NEVER say "I pulled up the [vehicle]", "we have it here", "it is here and ready to see", "we have it available", "ready to show", "got it ready", or any phrasing that implies the unit is at the dealership. (3) Better: "I can verify the exact unit and confirm availability before you make the trip", or "let me check on the specific unit and get back to you with what we have." (4) Best for first-touch: ask a qualifying question that buys time to verify ("what features matter most so I can confirm the right match?") rather than claiming availability you cannot prove. (5) NEVER offer appointment times that imply the customer can come see THIS unit — first verify the unit, THEN offer times.';

  if (sc.isLoyaltyVehicle) {
    inventoryNote = 'VEHICLE NOTE: This is the customer\'s current owned vehicle — not dealership inventory. Never reference its availability.';
  } else if (sc.staleModelYear && sc.stockNum && !data.inventoryWarning) {
    // Stock number confirmed — vehicle is physically on the lot regardless of model year
    inventoryNote = 'Vehicle is confirmed in stock (Stock #' + sc.stockNum + '). Say "we have it here" or "it is here and available to see" — UNLESS the conversation arc contains a recent internal agent note indicating the vehicle has a deposit, is on hold, or has a pending sale (see AGENT INTELLIGENCE guidance — internal notes take precedence over the base inventory status). Model year is ' + sc.vehicleYear + ' — that is fine, reference it normally.';
  } else if (sc.staleModelYear && data.vin && !sc.vehicleInTransit) {
    // Prior model year + VIN only (no stock #) — both warnings layered.
    // Lacey Lafont case (May 7) — was implying availability via "I pulled up the Honda"
    // because the year-only branch said nothing about VIN-not-confirming.
    inventoryNote = 'VEHICLE NOTE: The vehicle listed is a ' + sc.vehicleYear + ' ' + (data.vehicle || 'vehicle').replace(/^20\d\d\s+/,'') + ' — a prior model year — and it has a VIN but NO stock number on the lead. TWO things to handle: (A) MODEL YEAR: Reference the MODEL ONLY (e.g. "the Civic", "the Ridgeline"). DROP the year. NEVER say "the ' + sc.vehicleYear + ' is available", "we pulled up the ' + sc.vehicleYear + ' options", or "we have the ' + sc.vehicleYear + '". (B) ' + _vinOnlyNoStockText + ' Combined posture: reference the base model softly, ask a qualifying question, do NOT claim availability or offer times for THIS specific unit until you can verify it physically.';
  } else if (sc.staleModelYear) {
    // Prior model year with no stock AND no VIN — soft model-only language.
    inventoryNote = 'VEHICLE NOTE: The vehicle listed is a ' + sc.vehicleYear + ' ' + (data.vehicle || 'vehicle').replace(/^20\d\d\s+/,'') + ', which is a prior model year. RULES: (1) Reference the MODEL ONLY (e.g. "the Ridgeline", "the Civic") — DROP the year ' + sc.vehicleYear + ' entirely. Phrases like "the ' + sc.vehicleYear + ' Ridgeline options" or "the right ' + sc.vehicleYear + ' Ridgeline" imply we have year-specific inventory we cannot confirm. (2) Use generic, model-level language: "your Ridgeline options", "the Ridgeline you were looking at", or just "the Ridgeline". (3) The customer knows what year they asked about — you do not need to repeat it back. (4) NEVER say "we have the ' + sc.vehicleYear + ' available", "the ' + sc.vehicleYear + ' is showing available", or "we pulled up the ' + sc.vehicleYear + ' options". (5) When in doubt, ask: "What features matter most so I can show you the right Ridgeline?"';
  } else if (!sc.vehicleInTransit && !sc.vehicleSold && data.vehicle && !/not provided/i.test(data.vehicle)) {
    if (data.stockNum && !/not provided/i.test(data.vehicle)) {
      // Confirmed unit — stock number on the lead means physically on lot
      inventoryNote = 'Vehicle is confirmed in inventory. Use soft language: "showing available" or "we have it here" — UNLESS the conversation arc contains a recent internal agent note indicating the vehicle has a deposit, is on hold, or has a pending sale (see AGENT INTELLIGENCE guidance — internal notes take precedence over the base inventory status).';
    } else if (data.vin && !/not provided/i.test(data.vehicle)) {
      // VIN present but no stock number — non-Toyota-inbound case.
      // May be inbound, dealer-trade prospect, or third-party scrape. Do NOT claim availability.
      inventoryNote = _vinOnlyNoStockText;
    } else {
      // Vehicle of interest only — no specific unit confirmed
      inventoryNote = 'VEHICLE NOTE: No specific unit confirmed (no stock number or VIN). The customer asked about ' + (data.vehicle || 'a vehicle') + ', but we have not verified we have THIS specific trim/configuration on the lot. RULES: (1) You MAY reference the BASE MODEL by name (e.g. "the Prius", "the CR-V") because we carry that line. (2) Do NOT confirm availability of the specific TRIM, COLOR, or CONFIGURATION the customer mentioned (e.g. "Nightshade", "Touring", "Hybrid AWD") — we have not verified those. (3) Do NOT say "we have the [Nightshade/specific trim] available" or "we can get you set up with the [specific trim]" — these claim availability we cannot confirm. (4) Better phrasing: "I can check availability on the Nightshade trim specifically" or "We have the Prius — let me confirm the exact trim and color you are looking for." (5) Best phrasing for first-touch: ask a qualifying question — "What trim and color are you set on?" — instead of claiming availability.';
    }
  }

  // ── Audi Brand Specialist ──────────────────────────────────────
  var _currentPersona = window._leadProPersonaOverride || window._leadProResolvedPersona || 'bdc';
  let audiNote = '';
  if (sc.isAudi && (
    !_currentPersona ||
    _currentPersona === 'bdc' ||
    _currentPersona === 'concierge'
  )) {
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
    // Fresh-lead aware: a repeat customer submitting a fresh inquiry hasn't seen
    // our new-address message yet for THIS conversation, so still treat as early-touch.
    var _ladForPromo = data.leadAgeDays || 0;
    var isFirstOrEarlyTouch = !data.hasOutbound || (data.totalNoteCount || 0) < 6 || _ladForPromo <= 1;
    if (today <= movePromoEnd && isFirstOrEarlyTouch) {
      hondaLafNote = 'STORE LOCATION NOTE: Community Honda Lafayette recently moved to a brand new facility. NEW ADDRESS: 2503 SE Evangeline Thwy, Lafayette, LA 70508. Include the new address in the EMAIL (one line, naturally placed -- e.g. near the close or in the signature block). In the SMS, include it only if the message has room and it fits naturally -- one mention max, never the focus. Do not skip it from the email.';
    } else {
      hondaLafNote = 'STORE LOCATION NOTE: Community Honda Lafayette is located at 2503 SE Evangeline Thwy, Lafayette, LA 70508. Only mention if the customer asks about location or directions.';
    }
  }

  // ── Conversation pre-analysis — extracted before LEAD section ────
  // Forces AI to process what actually happened BEFORE seeing vehicle/times
  let conversationAnalysis = '';
  var hasCallNoteContent = /\[CALL NOTE\]/i.test(data.context || '');
  var hasVerbalCommitment = false;

  // digestCutoffMs: not needed — data.context is already filtered by transcriptCutoffMs in scraper
  var digestCutoffMs = 0;

  // Detect verbal commitment from call notes BEFORE digest — fires even on first-touch
  // so the appointment engine is suppressed whenever an agent noted a verbal agreement
  if (hasCallNoteContent) {
    var callNoteRawPre = (data.context || '').match(/\[CALL NOTE\][\s\S]{0,500}/i);
    if (callNoteRawPre) {
      var callTextPre = callNoteRawPre[0];
      var dayCommitPre = callTextPre.match(/(?:will (?:come|be|visit|stop|bring)|coming|can come|scheduled?|set for|confirmed?|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|credit approval)[^\n]{0,100}/i);
      if (dayCommitPre) {
        hasVerbalCommitment = true;
        var commitText = dayCommitPre[0].trim().substring(0, 150);
        conversationAnalysis = [
          '━━━ CALL NOTE — READ BEFORE WRITING ━━━',
          'Agent spoke with this customer by phone. Here is what was noted:',
          '  "' + commitText + '"',
          '',
          'WHAT THIS MEANS FOR YOUR RESPONSE:',
          '- The customer already has a next step agreed upon verbally.',
          '- Do NOT offer new appointment times — confirm and reinforce what was agreed.',
          '- Reference the call naturally: "Great speaking with you earlier" or "As we discussed."',
          '- Focus on what needs to happen next (credit, paperwork, arrival time) not on scheduling.',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ].join('\n');
      }
    }
  }
  if (data.conversationBrief && (data.convState !== 'first-touch' || hasCallNoteContent)) {
    // Extract the most recent customer message
    const lastInbound = data.lastInboundMsg || '';
    // Extract the most recent agent message
    const lastOutbound = data.lastOutboundMsg || '';
    // Extract any agent promises from outbound (questions asked, promises made)
    const agentAsked = lastOutbound.match(/\?[^?]*$/)?.[0]?.trim() || '';

    // agentOffered now comes from the richer digest above (agentMsgs)
    // Keep as fallback for edge cases where digest has no agent messages
    var agentOffered = '';

    // Build a full chronological conversation digest from the current lead cycle only
    // Transcript is newest-first - reverse it so the AI reads oldest->newest (cause before effect)
    var ctx_full = data.context || '';
    var ctxEntries = ctx_full.split(/\n(?=\[\d{2}\/\d{2}\/)/).filter(Boolean);
    // Reverse to chronological order (oldest first)
    var ctxChron = ctxEntries.slice().reverse();

    // Low-info message detector - single word replies, confirmations, emoji-only etc.
    function isLowInfo(txt) {
      var t = txt.trim().replace(/[^a-zA-Z0-9\s]/g, '').trim();
      var words = t.split(/\s+/).filter(Boolean);
      if (words.length <= 2) return true; // "Yes", "C", "Ok", "No", "Thanks"
      if (/^(yes|no|ok|okay|sure|thanks|thank you|awesome|great|perfect|confirmed|c|y|n|got it|sounds good|will do|noted)[\.!\s]*$/i.test(t)) return true;
      return false;
    }

    // Collect ALL exchanges since lead received - no cap, full arc
    // Skip low-info messages unless they're the ONLY customer message (then keep for context)
    var exchanges = []; // {who, text, isLowInfo, hasQuestion}
    var custCount = 0, agentCount = 0;

    for (var ci = 0; ci < ctxChron.length; ci++) {
      var entry = ctxChron[ci];
      var isCust     = /\[CUSTOMER\]/i.test(entry);
      var isAgent    = /\[AGENT\]/i.test(entry);
      var isCallNote = /\[CALL NOTE\]/i.test(entry);
      if (!isCust && !isAgent && !isCallNote) continue;

      var contentLines = entry.split('\n').slice(1).map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 2; });
      var msgText = contentLines.join(' ').substring(0, 1500).trim();
      // Strip Lead Pro's injected context block — it begins after '---' in agent notes
      // This prevents recycled VEHICLE CONFIRMED IN STOCK / VIN injections from poisoning the arc
      var lpSepIdx = msgText.indexOf(' --- ');
      if (lpSepIdx > 0) msgText = msgText.substring(0, lpSepIdx).trim();
      if (!msgText) continue;

      var who = isCust ? 'CUSTOMER' : (isCallNote ? 'CALL NOTE' : 'AGENT');
      var lowInfo = isCust && isLowInfo(msgText);
      var hasQ = msgText.indexOf('?') !== -1;

      exchanges.push({ who: who, text: msgText, lowInfo: lowInfo, hasQ: hasQ });
      if (isCust) custCount++;
      if (isAgent || isCallNote) agentCount++;
    }

    // If all customer messages are low-info, keep them anyway (need something)
    var allCustLowInfo = custCount > 0 && exchanges.filter(function(e){ return e.who === 'CUSTOMER' && !e.lowInfo; }).length === 0;

    // Build the exchange narrative - chronological, skip low-info unless only option
    var exchangeLines = [];
    var prevWho = '';
    exchanges.forEach(function(ex, i) {
      if (ex.who === 'CUSTOMER' && ex.lowInfo && !allCustLowInfo) {
        // Skip low-info unless it's the last message (most recent = what we're responding to)
        var isLast = (i === exchanges.length - 1);
        if (!isLast) return;
        exchangeLines.push('CUSTOMER (latest - short reply): "' + ex.text + '"');
        return;
      }
      if (ex.who !== prevWho) {
        exchangeLines.push(''); // blank line between speaker changes
      }
      exchangeLines.push(ex.who + ': "' + ex.text.substring(0, 1000) + (ex.text.length > 1000 ? '...' : '') + '"');
      prevWho = ex.who;
    });

    // Identify the most recent substantive customer message (skip low-info for question detection)
    var lastSubstantiveCust = '';
    for (var ei = exchanges.length - 1; ei >= 0; ei--) {
      if (exchanges[ei].who === 'CUSTOMER' && (!exchanges[ei].lowInfo || allCustLowInfo)) {
        lastSubstantiveCust = exchanges[ei].text;
        break;
      }
    }
    // Fall back to most recent customer message if all are low-info
    if (!lastSubstantiveCust && custCount > 0) {
      for (var ei2 = exchanges.length - 1; ei2 >= 0; ei2--) {
        if (exchanges[ei2].who === 'CUSTOMER') { lastSubstantiveCust = exchanges[ei2].text; break; }
      }
    }

    // Unanswered questions: from the most recent substantive customer message only
    // (if that message came after the most recent agent message)
    var lastAgentIdx = -1, lastSubstCustIdx = -1;
    for (var ei3 = exchanges.length - 1; ei3 >= 0; ei3--) {
      if (lastAgentIdx === -1 && (exchanges[ei3].who === 'AGENT' || exchanges[ei3].who === 'CALL NOTE')) lastAgentIdx = ei3;
      if (lastSubstCustIdx === -1 && exchanges[ei3].who === 'CUSTOMER' && (!exchanges[ei3].lowInfo || allCustLowInfo)) lastSubstCustIdx = ei3;
      if (lastAgentIdx !== -1 && lastSubstCustIdx !== -1) break;
    }
    var custQuestionsStr = '';
    // Questions are unanswered if the substantive customer message came AFTER the last agent message
    if (lastSubstCustIdx > lastAgentIdx && lastSubstantiveCust && lastSubstantiveCust.indexOf('?') !== -1) {
      custQuestionsStr = lastSubstantiveCust.substring(0, 800);
    }

    // For backwards compat
    var recentCust = lastSubstantiveCust;
    var custMsgs = exchanges.filter(function(e){ return e.who === 'CUSTOMER'; }).map(function(e){ return e.text; });
    var agentMsgs = exchanges.filter(function(e){ return e.who === 'AGENT' || e.who === 'CALL NOTE'; }).map(function(e){ return e.text; });

    var digestLines = [
      '━━━ CONVERSATION ARC — READ THIS BEFORE WRITING ━━━',
      'Full exchange since this lead opened. Read chronologically (oldest → newest) to understand how the conversation evolved.',
      '',
      '⚠️ READ INTERNAL AGENT NOTES CAREFULLY — they may contain status that overrides default behavior.',
      'The arc below includes internal agent notes (call notes, phone notes, system notes). Some of these notes contain critical status information that changes what your response should be. Before writing, scan recent notes (last 48 hours) for signals that the situation has changed since the customer\'s inquiry:',
      '',
      '  • VEHICLE NO LONGER CLEANLY AVAILABLE: deposit placed by another customer, sale pending finance, "DW has a deposit", "sold pending", "on hold for [name]", "another customer is in process", "let him know if it falls through".',
      '  • ANOTHER AGENT IS ACTIVELY WORKING THE DEAL: "DW working it", "wait for [agent] to call back", "manager handling", "[name] called him already". You are picking up the thread, not steering it independently.',
      '  • REQUEST IS ESCALATED OR AWAITING INTERNAL DECISION: "waiting on manager approval", "needs GSM signoff", "appraisal pending", "checking with finance".',
      '  • INTERNAL COMMITMENT MADE TO THE CUSTOMER: "promised callback at 3pm", "told him we\'d match", "committed to following up Monday". You must honor or reference these.',
      '',
      'IF ANY OF THESE SIGNALS ARE PRESENT IN RECENT NOTES, your response MUST reflect that status honestly. Do NOT default to "come see the vehicle today" when an internal note indicates the vehicle is pending or spoken for. Do NOT promise availability that contradicts an agent\'s internal note. Do NOT independently respond on a deal another agent is actively working without acknowledging that.',
      '',
      'Instead: be transparent about the status, offer to keep them informed if circumstances change, and only suggest a visit if it genuinely serves the customer (e.g., looking at comparable alternatives) — not to expose them to a wasted trip or contradict another agent\'s active work.',
      '',
      'These notes are written in shorthand by humans. They will not always be tagged or formatted obviously. Read them with the eye of someone protecting the customer\'s time and the team\'s coordination.',
      '',
    ];
    if (exchangeLines.length > 0) {
      exchangeLines.forEach(function(l){ digestLines.push(l); });
      digestLines.push('');
    } else if (recentCust) {
      // Fallback if no structured exchanges found
      digestLines.push('CUSTOMER: "' + recentCust.substring(0, 300) + '"');
      digestLines.push('');
    }
    if (custQuestionsStr) {
      digestLines.push('OPEN QUESTION FROM CUSTOMER (not yet answered — address this first):');
      digestLines.push('  "' + custQuestionsStr + '"');
      digestLines.push('');
    }
    // Add no-reply-yet warning when agent sent outreach but customer hasn't replied
    var noReplyYet = custCount === 0 && agentCount > 0;
    if (noReplyYet) {
      digestLines.push('NO CUSTOMER REPLY YET: The agent already sent the messages above. Customer has not responded.');
      digestLines.push('- Do NOT repeat questions or content already sent.');
      digestLines.push('- Write a DIFFERENT follow-up: new angle, a specific detail about the vehicle or trade, or a softer check-in.');
      digestLines.push('- The follow-up should feel like a different person picked up the thread — not a copy of the first outreach.');
      digestLines.push('- CRITICAL: Do NOT say "I left a voicemail" or "I called earlier" unless YOU are the agent who made those prior contacts. If the prior outreach was from a different agent, you are picking up the thread — not continuing your own prior conversation. Write as if you are aware of what was sent but do not claim ownership of messages you did not send.');
      digestLines.push('');
    }

    digestLines.push('RULES FOR THIS RESPONSE:');
    digestLines.push('1. Answer every unanswered customer question above — do not skip any.');
    digestLines.push('2. Do NOT re-ask what the customer already answered.');
    digestLines.push('3. Do NOT re-send information the agent already sent.');
    digestLines.push('4. If the customer asked about a different vehicle than the lead vehicle, respond about THAT vehicle.');
    digestLines.push('5. Match the channel — if the thread is email, write at email depth. If text, write at text depth.');
    digestLines.push('6. SIGNING: Sign ONLY as the BD Agent listed in the LEAD section below — NOT as any sales rep or other agent whose name appears in prior messages. Prior agent messages are context, not identity.');
    digestLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    conversationAnalysis = digestLines.filter(Boolean).join('\n');

    // (v9.7.54) Append RELATIONSHIP READING after the arc digest. The
    // renderer returns '' for simple/clean leads so we don't add noise to
    // hot fresh leads. Logged so we can verify firing on the leads we expect.
    var _relReading = renderRelationshipReading(data);
    if (_relReading) {
      conversationAnalysis += '\n' + _relReading;
      var _rs = data.relationshipSignals || {};
      console.log('[Lead Pro] RelReading FIRED — fatigue:', _rs.channelFatigue, '| noShow:', _rs.hasNoShowHistory, '| frustration:', _rs.hasFrustrationHistory, '| pricing:', _rs.hasPricingFriction, '| lastInboundAge:', _rs.lastInboundAgeDays, '| consecutiveOutbound:', _rs.consecutiveOutboundNoReply);
    } else {
      console.log('[Lead Pro] RelReading skipped — simple lead, no friction or fatigue');
    }
  }

  // ── Build the prompt ───────────────────────────────────────────
  // For AI Buying Signal leads: inject context block at the very top of the prompt
  // This appears BEFORE the scenario directive so the AI sees it first and cannot ignore it
  // Architecture: tell the AI the situation (3-axis matrix), give it three approach options,
  // let it choose. Constraints are firm; play selection is judgment.
  var buyingSignalHardBlock = '';
  if (sc.isAIBuyingSignalNew || sc.isAIBuyingSignalReturner) {
    // Pull buying signal data from structured field first (set by scraper from Key Information panel),
    // fall back to context-block regex. The regex MUST anchor on the colon to avoid matching the
    // re-engagement placeholder text "buying signal data only. Do not reference any marketing emails..."
    // which is not actual signal data — it's filler text shown when there is no transcript.
    var bsData = (data.buyingSignals || sc.buyingSignalData || '');
    if (!bsData) {
      var _bsMatch = (data.context||'').match(/BUYING SIGNAL DATA:\s+([^\n]+)/);
      if (_bsMatch) bsData = _bsMatch[1].trim();
    }
    // Expanded model list — covers in-brand AND common cross-brand trucks/SUVs
    var bsModel = bsData.match(/\b(Camry|Tacoma|RAV4|Highlander|Corolla|Tundra|Sienna|4Runner|Venza|Prius|CR-V|Accord|Civic|Pilot|Odyssey|Passport|Ridgeline|HR-V|Telluride|Sorento|Sportage|Carnival|Tucson|Santa Fe|Palisade|Mustang|F-150|F-250|F-350|Explorer|Edge|Escape|Bronco|Maverick|Ranger|Expedition|Silverado|Equinox|Traverse|Malibu|Tahoe|Suburban|Colorado|Blazer|Trailblazer|Sierra|Yukon|Acadia|Terrain|Canyon|Wrangler|Cherokee|Grand Cherokee|Compass|Renegade|Gladiator|Ram|1500|2500|3500|Charger|Challenger|Durango|Altima|Rogue|Murano|Pathfinder|Frontier|Titan|Armada|Kicks|Sentra|Maxima|Legacy|Outback|Forester|Crosstrek|WRX|Impreza|Ascent|CX-5|CX-9|CX-50|Mazda3|Mazda6|RX350|ES350|GX|LX|IS|GS|UX|NX|TX|Optima|K5|Stinger|Forte|Soul|Niro|EV6|EV9|Q3|Q5|Q7|Q8|A3|A4|A5|A6|A7|A8|S3|S4|S5|RS|e-tron|X1|X3|X5|X7|3 Series|5 Series|7 Series|GLE|GLC|GLS|C-Class|E-Class|S-Class|MDX|RDX|TLX|ILX|QX50|QX60|QX80|Q50|Escalade|XT4|XT5|XT6|Navigator|Aviator|Corsair|Nautilus|Enclave|Encore|Envision|Tiguan|Atlas|Jetta|Passat|Taos|XC40|XC60|XC90|S60|S90|Macan|Cayenne|Panamera|Taycan|G70|G80|GV70|GV80|Outlander|Eclipse Cross|Mirage)/i)?.[0] || '';

    // Resolve human-friendly brand names for the matrix block
    function _brandLabel(b) {
      if (!b) return '';
      var map = {
        toyota:'Toyota', honda:'Honda', chevrolet:'Chevrolet', gmc:'GMC', ford:'Ford',
        kia:'Kia', nissan:'Nissan', hyundai:'Hyundai', mazda:'Mazda', subaru:'Subaru',
        jeep:'Jeep', ram:'Ram', dodge:'Dodge', chrysler:'Chrysler', audi:'Audi',
        bmw:'BMW', mercedes:'Mercedes-Benz', lexus:'Lexus', acura:'Acura',
        infiniti:'INFINITI', cadillac:'Cadillac', lincoln:'Lincoln', buick:'Buick',
        volkswagen:'Volkswagen', volvo:'Volvo', porsche:'Porsche', tesla:'Tesla',
        genesis:'Genesis', mitsubishi:'Mitsubishi'
      };
      return map[b] || (b.charAt(0).toUpperCase() + b.slice(1));
    }
    var storeBrandLabel = _brandLabel(sc.aiBSStoreBrand);
    var targetBrandLabel = _brandLabel(sc.aiBSTargetBrand);
    var sisterBrandLabels = (sc.aiBSSisterBrands || []).map(_brandLabel).filter(Boolean);
    var hasSisterStoreOfTargetBrand = sc.aiBSTargetBrand && (sc.aiBSSisterBrands || []).indexOf(sc.aiBSTargetBrand) >= 0;

    // Build the situation matrix description
    var matrixLines = ['━━━ AI BUYING SIGNAL — SITUATION MATRIX ━━━'];
    matrixLines.push('This is an "AI Buying Signal" lead — the system flagged this customer based on observed shopping behavior (third-party browsing, price-quote requests, KBB lookups). The customer did not directly inquire with this dealership about this vehicle. Approach with finesse — they have not asked you to contact them about this specific vehicle.');
    matrixLines.push('');
    matrixLines.push('THREE AXES TO READ BEFORE WRITING:');
    // Axis 1
    if (sc.aiBSIsStandalone) {
      matrixLines.push('1. LOCATION: ' + (storeBrandLabel || 'this store') + ' is a STANDALONE store. No sister stores. All conversation must stay in-brand or be framed around what this store actually has.');
    } else {
      matrixLines.push('1. LOCATION: ' + (storeBrandLabel || 'this store') + ' is part of a multi-brand auto group. This gives you conversational latitude — you have more options to keep the dialogue alive even if their interest is outside this store. IMPORTANT: this is for your awareness only. Do NOT name sister stores. Do NOT promise to connect or transfer the customer to another rooftop. Specific cross-store handoffs happen manually, agent-to-customer, not in BDC outreach. Use the latitude to be confident in keeping the door open — not to commit to anything.');
    }
    // Axis 2
    if (sc.isAIBuyingSignalReturner) {
      matrixLines.push('2. RELATIONSHIP: This customer PREVIOUSLY BOUGHT from this dealership. They have a real prior relationship — use it. The ownership hook is genuine, not manufactured.');
    } else {
      matrixLines.push('2. RELATIONSHIP: This customer has NO PRIOR PURCHASE here. Cold prospect spotted by behavioral signals. They did not raise their hand. Do NOT pretend a relationship exists. Approach gently — they may not even realize they were flagged.');
    }
    // Axis 3
    if (sc.aiBSIsCrossBrand) {
      matrixLines.push('3. BRAND MATCH: CROSS-BRAND. The vehicle they are shopping (' + (targetBrandLabel ? targetBrandLabel + ' ' : '') + (bsModel || 'target vehicle') + ') is NOT sold at ' + (storeBrandLabel || 'this store') + '. Do NOT promise to have it. Do NOT say "we have great ' + (bsModel || 'options') + ' available."');
      if (hasSisterStoreOfTargetBrand) {
        matrixLines.push('   ↳ The auto group does have a sister ' + targetBrandLabel + ' store, but this is for YOUR situational awareness only. Do NOT mention or promise a sister-store handoff in the message — those happen manually after the conversation gets going. Use this knowledge to be confident the relationship has options, not to commit to anything specific.');
      } else if (!sc.aiBSIsStandalone) {
        matrixLines.push('   ↳ The group does not include a ' + (targetBrandLabel || 'target-brand') + ' store. Stay in-brand or use a questioning approach.');
      }
    } else if (sc.aiBSTargetBrand) {
      matrixLines.push('3. BRAND MATCH: IN-BRAND. The vehicle they are shopping (' + (bsModel || 'target vehicle') + ') is something this store actually sells. Inventory may or may not match the exact spec — do not confirm specific units without verification.');
    } else {
      matrixLines.push('3. BRAND MATCH: UNCLEAR. Could not determine the target brand from buying signal data. Treat as in-brand category interest until customer indicates otherwise.');
    }
    matrixLines.push('');

    // Build the three plays
    matrixLines.push('THREE PLAYS -- choose based on the matrix above and the customer\'s state:');
    matrixLines.push('');
    if (sc.aiBSIsCrossBrand) {
      matrixLines.push('CONTEXT: We almost certainly do not carry what they are shopping. AI Buying Signal leads at a single-brand store are usually cross-brand by definition -- that is why they got flagged. They are shopping somewhere, not here. Pretending otherwise reads as bait-and-switch and burns trust.');
      matrixLines.push('');
      matrixLines.push('PLAY A -- HONEST RELATIONSHIP OPENER (RECOMMENDED for cross-brand): Be candid that the specific vehicle/brand they are shopping is not what this store carries. Do NOT pivot to "but we have something similar" -- that is the bait-and-switch move that loses them. Instead: position the message as opening a relationship for the next time they shop, and ask what is driving their search. Example tone: "Saw you have been looking at ' + (bsModel || 'a Cadillac CTS') + 's -- straight up, that is not something we carry. If we ever earn the chance to be considered when you are shopping ' + (sc.storeBrand || 'this brand') + ', we would love that. What is pulling you toward ' + (bsModel || 'that') + '? Replacing something, growing family, just exploring?" The point is not to redirect their shopping. The point is to be a real human who acknowledges reality and stays in the picture.');
      matrixLines.push('');
      matrixLines.push('PLAY B -- CURIOSITY OPEN (alternative when interests are vague or ambiguous): Acknowledge they are in the market, ask what is driving the search, no inventory commitments either way. Example: "Saw you are out shopping around. What is pulling you in that direction -- replacing something, or just looking?" Use this when the signal data is too vague to name a specific make/model to be honest about.');
      matrixLines.push('');
      matrixLines.push('PLAY C -- FALLBACK (when there is no usable signal data at all): Light, brand-neutral check-in. Ask one open qualifying question. No specifics. No reveals. No assumptions.');
    } else {
      matrixLines.push('PLAY A -- DIRECT MATCH (when target is in-brand and we likely have inventory): Reference the model they are shopping by name. Open with availability or a specific value point. Confident but not pushy.');
      matrixLines.push('');
      matrixLines.push('PLAY B -- OWNERSHIP HOOK (returners only): Lead with their currently-owned vehicle, then bridge to the new shopping interest. "Still driving the [owned]? Was thinking of you -- we have some [model] options that might work for what you are after."');
      matrixLines.push('');
      matrixLines.push('PLAY C -- QUESTIONING OPEN (safest default for cold prospects): Acknowledge they are shopping without revealing how you know. Ask one open qualifying question. Lets them confirm or correct the signal before you commit to specifics.');
    }
    matrixLines.push('');
    matrixLines.push('JUDGMENT GUIDE:');
    matrixLines.push('- Cold prospect (no prior purchase): lean toward PLAY A or B. Be honest about what we are and what we are not. A relationship opener beats a fake pitch every time.');
    matrixLines.push('- Returner with strong prior relationship: PLAY A still applies even cross-brand. They already trust us -- the honest acknowledgment lands BETTER coming from someone they know.');
    matrixLines.push('- Cross-brand reality: do NOT redirect to "we have X instead". Customers can tell when they are being steered. The honest move is "we do not carry that, but here is who we are if you ever consider ' + (sc.storeBrand || 'us') + '".');
    matrixLines.push('- The goal of the message is to start a conversation, not close a sale. AI Buying Signal leads convert long-term, not same-day.');
    matrixLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    matrixLines.push('');

    // Universal hard constraints (apply to ALL AI Buying Signal leads regardless of axis)
    matrixLines.push('UNIVERSAL CONSTRAINTS for AI Buying Signal leads:');
    matrixLines.push('- Never use "upgrade", "newer model", "latest", "newest", "step up", "brand new" as descriptors. These imply inventory specifics that are unknown.');
    matrixLines.push('- Never reference a trade-in unless one is explicitly listed in the LEAD section below.');
    matrixLines.push('- Never reference any marketing event, sale, APR offer, or promotional campaign.');
    matrixLines.push('- Never reveal you have behavioral/shopping signal data on them. Speak as if you are a thoughtful agent reaching out — not a system that flagged them.');
    matrixLines.push('- The customer DID NOT directly contact this dealership about this vehicle. Phrasing like "I wanted to follow up on your inquiry" is FALSE — there was no inquiry.');
    matrixLines.push('- Never name sister stores, other rooftops, or promise to connect/transfer the customer to another dealership. That decision is made manually by the agent later if it makes sense — not committed to in BDC outreach.');

    // Parse buying signal interests into usable hints. Real-world examples:
    //   "Actively Shopping. Interests: Suv."                              -> body=SUV
    //   "Browsing. Interests: Truck."                                      -> body=Truck
    //   "Actively Shopping. Interests: Cadillac, Sedan, Cts, Used."        -> make=Cadillac, body=Sedan, model=Cts, condition=Used
    //   "Ready To Buy. Interests: Honda, CR-V, New."                       -> make=Honda, model=CR-V, condition=New
    if (bsData) {
      var _stageMatch = bsData.match(/(actively shopping|ready to buy|browsing|not shopping|not in market)/i);
      var _stage = _stageMatch ? _stageMatch[1] : '';

      // Pull the comma-separated interests list and classify each item
      var _bodyStyles = ['suv','truck','sedan','coupe','hatchback','convertible','wagon','minivan','van','crossover'];
      var _makes = ['acura','audi','bmw','buick','cadillac','chevrolet','chevy','chrysler','dodge','ford','genesis','gmc','honda','hyundai','infiniti','jaguar','jeep','kia','land rover','lexus','lincoln','mazda','mercedes','mercedes-benz','mini','mitsubishi','nissan','porsche','ram','subaru','tesla','toyota','volkswagen','vw','volvo'];
      var _conditions = ['new','used','pre-owned','preowned','certified','cpo'];

      var _interestList = [];
      var _intMatch = bsData.match(/interests?:\s*([^.]+?)(?:\.|$)/i);
      if (_intMatch) {
        _interestList = _intMatch[1].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      }

      var _foundMake = '', _foundBody = '', _foundModel = '', _foundCondition = '';
      _interestList.forEach(function(item) {
        var lower = item.toLowerCase();
        if (!_foundBody && _bodyStyles.indexOf(lower) !== -1) {
          _foundBody = item.charAt(0).toUpperCase() + item.slice(1).toLowerCase();
        } else if (!_foundMake && _makes.indexOf(lower) !== -1) {
          _foundMake = item.charAt(0).toUpperCase() + item.slice(1).toLowerCase();
          // Normalize common make casings
          if (_foundMake.toLowerCase() === 'bmw') _foundMake = 'BMW';
          if (_foundMake.toLowerCase() === 'gmc') _foundMake = 'GMC';
          if (_foundMake.toLowerCase() === 'vw') _foundMake = 'Volkswagen';
        } else if (!_foundCondition && _conditions.indexOf(lower) !== -1) {
          _foundCondition = item.charAt(0).toUpperCase() + item.slice(1).toLowerCase();
          if (_foundCondition.toLowerCase() === 'cpo') _foundCondition = 'Certified Pre-Owned';
          if (_foundCondition.toLowerCase() === 'preowned') _foundCondition = 'Pre-Owned';
        } else if (!_foundModel) {
          // Anything left over that's 2+ chars and not a known classification is likely a model
          if (item.length >= 2) _foundModel = item;
        }
      });

      matrixLines.push('');
      matrixLines.push('SHOPPING SIGNALS (for your reasoning - reference categories naturally, do not reveal the data source):');
      if (_stage) {
        matrixLines.push('- Stage: ' + _stage + '. Calibrate urgency to this -- "Actively Shopping" = real movement, "Browsing" = early, "Ready To Buy" = high intent, "Not Shopping" = ease off.');
      }
      // Build a natural-language description of what they want
      var _wantParts = [];
      if (_foundCondition) _wantParts.push(_foundCondition.toLowerCase());
      if (_foundMake) _wantParts.push(_foundMake);
      if (_foundModel) _wantParts.push(_foundModel);
      if (_foundBody && !_foundModel) _wantParts.push(_foundBody.toLowerCase());

      if (_wantParts.length > 0) {
        var _wantPhrase = _wantParts.join(' ');
        matrixLines.push('- They have signaled interest in: ' + _wantPhrase + '. Reference this naturally -- e.g. "if a ' + _wantPhrase + ' is what you are after" or "looking at ' + (_foundBody ? _foundBody.toLowerCase() + 's' : 'options') + '?"');
        matrixLines.push('- Do NOT default to vague phrasing like "the vehicle category you have been browsing" or "looking at vehicles online" -- that reveals surveillance and reads as creepy. Just reference what they want like a normal person would.');

        // Cross-brand awareness
        if (_foundMake) {
          var _storeBrand = (sc.storeBrand || '').toLowerCase();
          if (_storeBrand && _foundMake.toLowerCase() !== _storeBrand) {
            matrixLines.push('- CROSS-BRAND ALERT: They want a ' + _foundMake + '. This store sells ' + (sc.storeBrand || 'a different brand') + '. Use PLAY A (honest relationship opener) -- be candid that we do not carry it, position for the next time they shop, ask what is driving the search. Do NOT pivot to in-brand alternatives -- that is bait-and-switch and burns trust.');
          }
        }
      } else {
        matrixLines.push('- No specific category detected from signals. Lean toward PLAY C -- open question, no specifics.');
      }

      if (!_stage && _wantParts.length === 0) {
        matrixLines.push('- Raw signal data was: ' + bsData + ' -- could not parse cleanly. Use PLAY C as fallback.');
      }
    } else {
      matrixLines.push('- BUYING SIGNAL DATA: not available. Lean toward PLAY C -- open question, no specifics.');
    }

    buyingSignalHardBlock = matrixLines.join('\n');
  }


  // ── CLOSE OVERRIDE — computed from Situation Brief signals ──────────────
  // When the situation calls for no appointment push, override the scenario close instruction
  // This prevents the model defaulting to two-time close when it should use pattern breaker
  var closeOverride = '';
  // Situation flags — factual context for the model, no prescriptions
  if (sc.isPauseSignal || sc.isExitSignal) {
    closeOverride = '📋 SITUATION: Customer has signaled they are not ready or stepping back. Read the transcript and respond accordingly.';
  } else if (hasVerbalCommitment) {
    closeOverride = '📋 SITUATION: Customer already made a verbal commitment on the phone. Confirm what was agreed and move to the next step — no need to re-close.';
  } else if (sc.isDistanceBuyer && /video|walkaround|photos|pictures|send.*over|virtual/i.test((data.lastOutboundMsg || '') + ' ' + (data.lastInboundMsg || ''))) {
    closeOverride = '📋 SITUATION: Agent already committed to sending video/photos to this distance buyer. Confirm it is coming and ask one clarifying question.';
  } else if (sc.vehicleSold) {
    closeOverride = '📋 SITUATION: The vehicle they inquired about has sold. Pivot to comparable alternatives — do not offer appointment times for a vehicle that no longer exists.';
  } else if (sbHungUp && sbTotal >= 3) {
    closeOverride = '📋 SITUATION: Customer has hung up on ' + sbTotal + ' calls. Phone is not working. Try a completely different angle — curiosity, easy-out, or value shift.';
  } else if (sbTotal >= 5 && sbContacted === 0 && (data.leadAgeDays || 0) >= 2) {
    closeOverride = '📋 SITUATION: ' + sbTotal + ' attempts over ' + (data.leadAgeDays || 0) + ' days with zero contact. This needs a pattern break, not another push.';
  } else if (sbTimingConcern) {
    closeOverride = '📋 SITUATION: Customer has indicated timing is not right for them yet. Respect that. Do not pressure a timeline they have already told you does not work.';
  } else if (sbMsgs >= 3 && sbContacted === 0 && (data.leadAgeDays || 0) >= 2) {
    closeOverride = '📋 SITUATION: ' + sbMsgs + ' messages over ' + (data.leadAgeDays || 0) + ' days with no response. A different approach is needed — not another check-in.';
  } else if (sbPriceConcern) {
    closeOverride = '📋 SITUATION: Customer raised a price or package concern. Address it directly before anything else.';
  }

  if (closeOverride) {
    scenarioRules = scenarioRules + '\n' + closeOverride;
  }

  // SMS channel override — applies universally across ALL lead sources
  // When customer has opted out of SMS, suppress it and let email/VM carry the message
  var customerSentStop = /^stop\s*$/i.test((data.lastInboundMsg || '').trim());
  var customerRequestedRemoval = /take me off|remove me|unsubscribe|not interested.*list|off.*list/i.test(data.lastInboundMsg || '');
  if (data.isSmsOptOutOnly || customerSentStop) {
    scenarioRules = scenarioRules + '\nSMS CHANNEL OVERRIDE: Customer opted out of SMS texts. Set sms field to empty string. Email and voicemail should proceed normally — do NOT mention the opt-out in email or voicemail. Write the email as a strong, forward-moving message appropriate to the scenario (Click & Go, follow-up, first-touch, etc.). Do NOT be apologetic or defeated.';
  }

// Append open availability override INSIDE conversation analysis block
  // so it appears before the transcript and cannot be overridden by old history
  if (customerAsksAvailability && !lpSuppressAppointment) {
    conversationAnalysis += (conversationAnalysis ? '\n' : '') +
      '\n⛔ CRITICAL — CUSTOMER ASKED OPEN SCHEDULING QUESTION:\n' +
      'Customer said: "' + (data.lastInboundMsg || '').trim() + '"\n' +
      'This is an OPEN question asking WHEN they can come in.\n' +
      'They did NOT propose a specific day. DO NOT invent or assume any day (not Thursday, not Friday, not tomorrow).\n' +
      'Customer asked an open scheduling question — do not invent a day they never mentioned. Ask them what works.';
  }

    // ── Build persona block if active ──────────────────────────────
    var personaBlock = [];
    var _rp = window._leadProPersonaOverride || window._leadProResolvedPersona;
    if (typeof LEADPRO_AUTH !== 'undefined' && _rp) {
      var pDef = LEADPRO_AUTH.getPersona(_rp);
      if (pDef && pDef.id !== 'bdc') {
        // For Director, detect THREE distinct modes — the existing systemHint defaults
        // to stall-recovery tone which is wrong for active and first-touch leads.
        //   FIRST TOUCH  — brand new lead, no outbound yet. "Set the tone" mode.
        //   ACTIVE       — engaged conversation, customer replying, lead still alive. "Forward motion" mode.
        //   STALL        — actual stall/ghost/exit. The default systemHint mode.
        var _isFirstTouch = (data.leadAgeDays || 0) < 1
                         || (!data.hasOutbound && !data.isContacted && (data.leadAgeDays || 0) < 2)
                         || (data.hasOutbound && !data.isContacted && (data.contactedAgeDays === undefined || data.contactedAgeDays < 1) && (data.leadAgeDays || 0) < 2);
        // Active lead detection: customer has replied recently OR conversation is alive
        // and not stalled/exit/pause. Catches the most common Director-misuse case:
        // user picks Director on a 2-day-old lead with active back-and-forth.
        var _convStateLow = (data.convState || '').toLowerCase();
        var _isStallContext = _convStateLow === 'stalled'
                           || _convStateLow === 'exit'
                           || _convStateLow === 'pause'
                           || _convStateLow === 'zero-contact'
                           || sc.isZeroContactStalled
                           || sc.isExitSignal
                           || sc.isPauseSignal
                           || ((data.leadAgeDays || 0) > 5 && !data.hasCustomerReply);
        var _isActiveDirector = !_isFirstTouch
                             && !_isStallContext
                             && (data.hasCustomerReply || _convStateLow === 'active-follow-up' || _convStateLow === 'call-followup' || _convStateLow === 'first-touch' || (data.leadAgeDays || 0) <= 3);
        var _objective = pDef.objective;
        var _mechanism = pDef.mechanism;
        var _tone = pDef.tone || '';
        // Multi-line bullets (not pipe-joined) — invites prioritization rather than mechanical discharge
        var _dos = (pDef.dos || []).map(function(x){ return '  • ' + x; }).join('\n');
        var _donts = (pDef.donts || []).map(function(x){ return '  • ' + x; }).join('\n');
        var _voiceExample = pDef.exampleSms || '';
        var _voiceExampleEmail = pDef.exampleEmail || '';
        var _voiceExampleVoicemail = pDef.exampleVoicemail || '';
        if (pDef.id === 'internet_director' && _isFirstTouch) {
          _objective = 'First Impression — warm, direct, human. Set the tone for the relationship.';
          _mechanism = 'Confident clarity — get to the point without scripts or recovery language';
          _tone = 'Direct, warm, unhurried. You sound like someone who read the file and has something specific to say.';
          // (v9.7.81) dos/donts intentionally NOT overridden here. The base
          // Director dos/donts plus the SITUATION note added to the systemHint
          // give the model enough framing. Layering on six more DOs and six
          // more DON'Ts produces the over-constrained outputs that prompted
          // this rewrite. Voice example below still anchors the shape.
          _voiceExample = '[Customer], [Your first name] here — Internet Director at [Store]. Saw you submitted your application — appreciate you taking that step. What are you shopping for, and what matters most to you right now?';
        } else if (pDef.id === 'internet_director' && _isActiveDirector) {
          // ACTIVE MOMENTUM — pattern-breaker as forward motion, NOT recovery
          _objective = 'Active Momentum — cut through dealership noise and move the conversation forward with clarity.';
          _mechanism = 'Direct intelligence — say the thing other agents would hedge around';
          _tone = 'Direct, sharp, forward-leaning. You sound like the agent who actually answers the question instead of dancing. Confident without being pushy.';
          // (v9.7.81) dos/donts intentionally NOT overridden — see comment above.
          _voiceExample = 'Got it — yes, the Blueprint with graphite is here. The trade conversation usually goes faster in person but I can give you a real ballpark right now if that helps you decide.';
        }
        // (else: stall recovery is the default systemHint mode — no overrides needed)

        // Build a context-flags awareness line for the persona block
        var personaFlagsLine = '';
        var _activeFlagLabels = [];
        if ((data.activeFlags || []).indexOf('trade') !== -1) _activeFlagLabels.push('Trade-In');
        if ((data.activeFlags || []).indexOf('price_gate') !== -1) _activeFlagLabels.push('Price Gate');
        if ((data.activeFlags || []).indexOf('credit') !== -1) _activeFlagLabels.push('Credit Sensitivity');
        if ((data.activeFlags || []).indexOf('distance') !== -1) _activeFlagLabels.push('Distance Buyer');
        if ((data.activeFlags || []).indexOf('loyalty') !== -1) _activeFlagLabels.push('Loyalty / Lease-End');
        if ((data.activeFlags || []).indexOf('stalled') !== -1) _activeFlagLabels.push('Stalled');
        if (_activeFlagLabels.length) {
          personaFlagsLine = 'Active flags for this lead: ' + _activeFlagLabels.join(', ') + '. Modulate your tone per the flag-specific guidance in your role above. Detailed rules are below.';
        }

        personaBlock = [
          '━━━ VOICE FOR THIS RESPONSE ━━━',
          'Voice profile: ' + pDef.label,
          'Your objective: ' + _objective,
          'Your mechanism: ' + _mechanism,
          'Tone: ' + _tone,
          ...(personaFlagsLine ? [personaFlagsLine] : []),
          'DO:',
          _dos,
          "DON'T:",
          _donts,
          'Voice example (SMS): ' + _voiceExample,
          ...(_voiceExampleEmail ? ['Voice example (email): ' + _voiceExampleEmail] : []),
          ...(_voiceExampleVoicemail ? ['Voice example (voicemail): ' + _voiceExampleVoicemail] : []),
          '',
          'NOTE: This is the VOICE TEMPLATE, not your identity. Your identity is set in YOUR ROLE above. Apply this voice while writing as yourself. Placeholders like [Customer], [Your first name], [Director], [Agent], or [Store] in the examples are PATTERNS to fill with YOUR actual identity from YOUR ROLE — never substitute another person\'s name from the lead context (Sales Rep, BD Agent, Manager, etc.). The example shows the SHAPE of the message, not the names to use.',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          ''
        ];
      }
    }

    const lines = [
    'DATE: ' + date + ' ' + currentYear,
    ...(function() {
      var ageBlock = [];
      var lad = (data.leadAgeDays || 0);
      ageBlock.push('LEAD AGE: ' + (lad === 0 ? 'submitted today' : lad === 1 ? 'submitted yesterday' : 'submitted ' + lad + ' days ago'));
      ageBlock.push('');
      ageBlock.push('━━━ TIME AWARENESS — READ BEFORE INTERPRETING THE TRANSCRIPT ━━━');
      ageBlock.push('Every transcript message has a date in brackets like [04/15/2026 3:14 PM]. Before referencing anything a customer said, check how old it is.');
      ageBlock.push('');
      // (v9.7.51) Calendar enumeration — explicit date lookup so model never
      // has to do "what day is tomorrow" arithmetic. The Jenny Fortenberry case
      // (May 7) exposed the gap: customer said "I have to work tomorrow,
      // Saturday or Sunday works" and the model offered Friday — the very day
      // she had ruled out. This block makes "tomorrow", "Friday", "Saturday",
      // "Sunday" all directly resolvable to specific calendar dates.
      try {
        var _cal_now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        var _cal_lines = ['CALENDAR REFERENCE (use these dates when customer mentions days):'];
        var _cal_dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        for (var _ci = 0; _ci <= 4; _ci++) {
          var _cd = new Date(_cal_now); _cd.setDate(_cal_now.getDate() + _ci);
          var _cd_day = _cal_dayNames[_cd.getDay()];
          var _cd_md = (_cd.getMonth()+1) + '/' + _cd.getDate();
          var _cd_label = _ci === 0 ? 'TODAY' : _ci === 1 ? 'TOMORROW' : _ci === 2 ? 'in 2 days' : _ci === 3 ? 'in 3 days' : 'in 4 days';
          _cal_lines.push('  ' + _cd_label + ' = ' + _cd_day + ' ' + _cd_md);
        }
        _cal_lines.forEach(function(l){ ageBlock.push(l); });
        ageBlock.push('');
        // (v9.7.51) Current time-of-day — the Megan Mckennie case (May 7
        // evening) exposed the gap: model offered times today that had
        // already passed because it had dates but no time awareness.
        var _now_hr12 = _cal_now.getHours() % 12 || 12;
        var _now_min = String(_cal_now.getMinutes()).padStart(2, '0');
        var _now_ampm = _cal_now.getHours() >= 12 ? 'PM' : 'AM';
        var _now_str = _now_hr12 + ':' + _now_min + ' ' + _now_ampm + ' Central';
        ageBlock.push('CURRENT TIME: ' + _now_str + ' on TODAY (' + _cal_dayNames[_cal_now.getDay()] + ' ' + ((_cal_now.getMonth()+1) + '/' + _cal_now.getDate()) + ')');
        ageBlock.push('');
      } catch (_calErr) { /* fail silent — block continues without calendar */ }

      // (v9.7.51) Store hours injection — prevents accepting/offering Sunday
      // (all rooftops closed) or after-hours times. Looks up STORE_HOURS by
      // the active lead's crmDealerId. The Jenny Fortenberry case exposed
      // the need: customer offered "Saturday or Sunday" and the model had
      // no way to know we are closed Sundays.
      try {
        var _hrsDealerId = (window._leadProResolvedContext && window._leadProResolvedContext.dealerId)
                        || (data && data.dealerId)
                        || '';
        var _hrs = (_hrsDealerId && STORE_HOURS[String(_hrsDealerId)]) || null;
        if (_hrs) {
          ageBlock.push('STORE HOURS — ' + _hrs.name + ':');
          ageBlock.push('  Monday-Friday: ' + _hrs.weekday);
          ageBlock.push('  Saturday: ' + _hrs.saturday);
          ageBlock.push('  Sunday: ' + _hrs.sunday);
          ageBlock.push('');

          // Compute real-time open/closed status. Requires _cal_now from the
          // calendar block above — if that block failed, _cal_now is undefined
          // and we skip status computation.
          try {
            if (typeof _cal_now === 'undefined' || !_cal_now) throw new Error('no _cal_now');
            var _todayHrs = _cal_now.getDay() === 0 ? _hrs.sunday
                          : _cal_now.getDay() === 6 ? _hrs.saturday
                          : _hrs.weekday;
            var _isClosedToday = /closed/i.test(_todayHrs);
            var _statusLine = '';
            if (_isClosedToday) {
              _statusLine = 'STORE STATUS RIGHT NOW: CLOSED today (' + _cal_dayNames[_cal_now.getDay()] + '). Earliest available appointment is tomorrow.';
            } else {
              // Parse "9 AM - 7 PM" or similar
              var _hrsMatch = _todayHrs.match(/(\d+)\s*(AM|PM)\s*-\s*(\d+)\s*(AM|PM)/i);
              if (_hrsMatch) {
                var _openHr = parseInt(_hrsMatch[1], 10);
                if (/PM/i.test(_hrsMatch[2]) && _openHr !== 12) _openHr += 12;
                if (/AM/i.test(_hrsMatch[2]) && _openHr === 12) _openHr = 0;
                var _closeHr = parseInt(_hrsMatch[3], 10);
                if (/PM/i.test(_hrsMatch[4]) && _closeHr !== 12) _closeHr += 12;
                if (/AM/i.test(_hrsMatch[4]) && _closeHr === 12) _closeHr = 0;
                var _curHr = _cal_now.getHours();
                var _curMin = _cal_now.getMinutes();
                var _curMinutesSinceMidnight = _curHr * 60 + _curMin;
                var _openMinutes = _openHr * 60;
                var _closeMinutes = _closeHr * 60;
                if (_curMinutesSinceMidnight < _openMinutes) {
                  _statusLine = 'STORE STATUS RIGHT NOW: NOT YET OPEN today. Opens at ' + _hrsMatch[1] + ' ' + _hrsMatch[2] + '.';
                } else if (_curMinutesSinceMidnight >= _closeMinutes) {
                  _statusLine = 'STORE STATUS RIGHT NOW: CLOSED for the day (closed at ' + _hrsMatch[3] + ' ' + _hrsMatch[4] + '). Earliest available appointment is tomorrow.';
                } else {
                  // Compute remaining minutes
                  var _minsLeft = _closeMinutes - _curMinutesSinceMidnight;
                  var _hrsLeft = Math.floor(_minsLeft / 60);
                  var _minLeft = _minsLeft % 60;
                  var _remainStr = _hrsLeft > 0 ? (_hrsLeft + 'h ' + _minLeft + 'm') : (_minLeft + 'm');
                  _statusLine = 'STORE STATUS RIGHT NOW: OPEN. Closes at ' + _hrsMatch[3] + ' ' + _hrsMatch[4] + ' (' + _remainStr + ' remaining today).';
                }
              }
            }
            if (_statusLine) {
              ageBlock.push(_statusLine);
              ageBlock.push('');
            }
          } catch (_statusErr) { /* fail silent — fall through to general directives */ }

          ageBlock.push('CRITICAL: Do NOT offer or accept appointments outside the open hours above. Do NOT offer Sunday appointments — the store is CLOSED Sundays. If the customer offers a day or time outside our open hours:');
          ageBlock.push('- Acknowledge their availability warmly without making them feel wrong for offering it.');
          var _closeTime = (_hrs.weekday.split('-')[1] || '').trim();
          ageBlock.push('- Briefly state the hours constraint (e.g. "we are closed Sundays"' + (_closeTime ? ', or "we close at ' + _closeTime + ' on weeknights"' : '') + ').');
          ageBlock.push('- Pivot to the closest workable alternative from their offered window. If they offered "Saturday or Sunday" and Sunday is closed, lock onto SATURDAY. If they offered "tonight at 9" and we close earlier, suggest the latest open slot or tomorrow.');
          ageBlock.push('- Never silently offer a time that conflicts with their stated availability OR our hours.');
          ageBlock.push('');
          ageBlock.push('TIME-OF-DAY AWARENESS: The CURRENT TIME is shown above. NEVER offer appointment slots that are already in the past today. If today\'s 5:15 PM has already passed (current time is after 5:15 PM), 5:15 PM today is NOT a valid offer — it is a time that already happened. If the STORE STATUS RIGHT NOW says CLOSED for the day, the earliest valid appointment offer is tomorrow during open hours. Compute proposed times against the CURRENT TIME, not just against open/close hours.');
          ageBlock.push('');
        }
      } catch (_hrsErr) { /* fail silent — block continues without hours */ }
      ageBlock.push('CUSTOMER-STATED AVAILABILITY:');
      ageBlock.push('Read what the customer said about their schedule, work hours, or availability. Reason about it against our store hours and the current time. Propose times that respect what they told you. If the math is messy or you are unsure, ask them to pick a time that works — that always beats guessing wrong. Never propose a time that conflicts with what they said. Never pair an impossible time with a possible time.');
      ageBlock.push('');
      ageBlock.push('CALL NOTES COUNT AS CUSTOMER-STATED AVAILABILITY: If a [CALL NOTE] or [AGENT] phone note from the past 7 days captures what the customer said about timing — a specific day, a "possibly" or "maybe" reference to a day, a window like "next week" or "this weekend," or a constraint like "after work" — treat that as customer-stated availability with the same weight as a text or email reply. The customer said it to a live person; the call note is the agent transcribing that exchange. Anchor any time offer on the day or window the call note captured, not on a generic "today" offer that ignores it. If the call note says "possibly tuesday," do not propose today — propose Tuesday. If the call note says "after work" or "after 5," respect that window. The call note is not background — it is the most recent direct signal from the customer about when they can come in.');
      ageBlock.push('');
      ageBlock.push('DAY NAMES MUST BE BOUND TO DATES: When you mention a weekday name in your response (Thursday, Friday, Saturday), bind it to a specific calendar date from the CALENDAR REFERENCE above. "Thursday" alone is ambiguous — it could mean today\'s Thursday (which the customer may have just ruled out) or next Thursday (7 days away, usually too far). Either anchor the day with a date ("Saturday May 9") or pick a more specific reference ("tomorrow", "this weekend"). NEVER offer "Thursday" when today IS Thursday and the customer told you today does not work.');
      ageBlock.push('');
      ageBlock.push('Rules for handling old transcript content:');
      ageBlock.push('- A customer detail older than 30 days is STALE. Do NOT reference it as if it is current. "Heard you\'re back in New Mexico" said in February is not relevant in May.');
      ageBlock.push('- Travel plans, schedule constraints, school breaks, work conflicts, "I\'ll be back next week" — these expire. If the message is more than 14 days old, do not echo the timing back to the customer.');
      ageBlock.push('- Vehicle interest from months ago may have shifted. Inventory has changed. Their situation has changed. Do not pretend the conversation paused yesterday.');
      ageBlock.push('- If the lead is 60+ days old with no recent reply, this is a long-dormant lead. Acknowledge the gap honestly or pivot to a fresh angle. Do NOT pretend the prior conversation just happened.');
      ageBlock.push('- If the customer\'s most recent message has [sent N days ago] or similar age tag, that is your anchor — not the words alone.');
      ageBlock.push('- "Tomorrow," "next week," "this Friday" in old messages mean those dates THEN, not now. Recompute or do not reference.');
      ageBlock.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      ageBlock.push('');

      // (v9.7.50) TOUCH POSITION — auto-derived from existing data so LP knows
      // where in a long follow-up sequence it is firing. No agent input needed.
      // The phase + attempt density shapes tone; the prior-messages directive
      // prevents recycling openers across a 30+ touch flow.
      var _lad = data.leadAgeDays || 0;
      var _nc = data.totalNoteCount || 0;
      var _cad = data.contactedAgeDays || 0;
      var _hasReply = !!data.hasCustomerReply
                   || /\[CUSTOMER\]/i.test(data.context || '')
                   || /Inbound Text|Inbound phone|Email reply from prospect/i.test(data.context || '');
      var _phase;
      if (_lad <= 1) {
        _phase = 'first-touch (Day 0-1)';
      } else if (_lad <= 7) {
        _phase = 'engagement (Day 2-7)';
      } else if (_lad <= 30) {
        _phase = 'persistence (Day 8-30)';
      } else if (_lad <= 60) {
        _phase = 'reactivation (Day 31-60)';
      } else {
        _phase = 'long-dormant (Day 61+)';
      }

      // (v9.7.50) Fresh-lead guard for repeat customers with historical activity.
      // If the lead itself is fresh (Day 0-1) but the customer record has accumulated
      // notes from prior interactions, those historical notes should NOT trigger
      // attempt-density labels, vary-angle directives, or one-sided-conversation
      // acknowledgments - the new lead submission is a reset event. The transcript
      // still contains the full history so the model can reference past context
      // appropriately, but the staleness directives stay quiet on fresh leads.
      var _ncForDirectives = _nc;
      var _hasReplyForDirectives = _hasReply;
      var _freshLeadActive = (_lad <= 1) && (_nc > 3);
      if (_freshLeadActive) {
        _ncForDirectives = 0;
        _hasReplyForDirectives = true; // suppress one-sided directive on fresh leads
        console.log('[Lead Pro] TOUCH POSITION: fresh-lead guard active - historical noteCount (' + _nc + ') suppressed for directive logic');
      }

      var _attemptDensity;
      if (_freshLeadActive) {
        _attemptDensity = 'fresh inquiry (this lead just submitted; customer has prior history with us but the new inquiry is the current conversation)';
      } else if (_nc >= 15) {
        _attemptDensity = 'heavy (' + _nc + ' notes)';
      } else if (_nc >= 8) {
        _attemptDensity = 'sustained (' + _nc + ' notes)';
      } else if (_nc >= 3) {
        _attemptDensity = 'normal (' + _nc + ' notes)';
      } else {
        _attemptDensity = 'light (' + _nc + ' notes)';
      }

      ageBlock.push('━━━ TOUCH POSITION — WHERE IN THE SEQUENCE ARE YOU ━━━');
      ageBlock.push('Phase: ' + _phase);
      ageBlock.push('Attempt density: ' + _attemptDensity);
      ageBlock.push('Customer responses so far: ' + (_hasReply ? 'YES (customer engaged at some point)' : 'NONE (one-sided so far)'));
      if (_cad > 0 && !_freshLeadActive) ageBlock.push('Days since last contact: ' + _cad.toFixed(0));
      ageBlock.push('');
      ageBlock.push('Apply the phase strategy and density rules from your system prompt (TOUCH POSITION AWARENESS section). The values above are the runtime inputs; your system prompt has the strategic implications.');
      ageBlock.push('');
      if (_freshLeadActive) {
        ageBlock.push('FRESH-LEAD GUARD ACTIVE:');
        ageBlock.push('This customer has prior history with us, but the lead they just submitted is the current conversation. Apply the fresh-lead guard rule from your system prompt — treat as fresh inquiry, not recovery. Prior history is BACKGROUND CONTEXT.');
        ageBlock.push('');
      }
      if (_ncForDirectives >= 5) {
        ageBlock.push('VARY YOUR ANGLE:');
        ageBlock.push('You have already sent ' + _ncForDirectives + '+ messages on this lead. Read your prior outbound messages above carefully. Do NOT reuse openers, phrasings, or angles you have already used.');
        ageBlock.push('');
      }
      if (!_hasReplyForDirectives && _ncForDirectives >= 8) {
        ageBlock.push('ONE-SIDED CONVERSATION:');
        ageBlock.push('Customer has not replied to ' + _ncForDirectives + '+ prior outreaches. Apply the one-sided conversation rule from your system prompt — acknowledge the silence honestly rather than sending another optimistic check-in.');
        ageBlock.push('');
      }
      ageBlock.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      ageBlock.push('');
      return ageBlock;
    })(),
    ...(conversationAnalysis ? [conversationAnalysis, ''] : []),
    buyingSignalHardBlock,
    ...personaBlock,
    '━━━ YOUR TASK ━━━',
    'Read everything in this prompt — the full conversation arc, the lead details, any constraints below.',
    'Before you write a single word, reason through these questions:',
    '',
    '1. WHAT IS THE FULL STORY? Trace the arc from first contact to now. How did this customer originally engage? What has changed? What have they responded to and what have they ignored?',
    '2. WHERE IS THIS CUSTOMER RIGHT NOW — emotionally and practically? Are they moving toward a decision, stepping back, frustrated, curious, done, or something else entirely? Use the whole arc, not just the last message.',
    '3. WHAT DO THEY ACTUALLY NEED FROM THIS MESSAGE? Not what the script says to do — what does this specific human need to hear right now to move in a positive direction (or to feel respected if they are exiting)?',
    '4. WHAT WOULD MAKE THIS WORSE? What is the one thing a tone-deaf response would do that would cost you this customer or damage the relationship?',
    '',
    'Write the response that answers question 3 without doing question 4.',
    '',
    '━━━ HARD CONSTRAINTS ━━━',
    '- Write three formats: SMS, email (with subject line), and voicemail.',
    '- SMS: first-name opener, specific and substantive — not a generic check-in. Stacked signature at end.',
    '- Email: match the depth of the customer\'s last message. Full signature block at end. Write the body as natural prose paragraphs — NEVER use numbered lists, bullet points, or "1." / "2." style enumeration in the email body. Email is a personal message, not a memo. If you have multiple things to convey, weave them into sentences.',
    '- Voicemail: 20-30 seconds, natural speech, one clear ask.',
    '- NEVER fabricate vehicle specs, prices, inventory, or availability you cannot confirm.',
    '- NEVER mention a specific vehicle model, trim, or name that does not appear in this prompt. If no vehicle of interest is listed on the lead, do NOT invent one. Ask what they are looking for instead.',
    '- NEVER reference a trade-in unless one is explicitly listed in the LEAD section above OR the customer themselves has mentioned a trade in their inbound messages. A prior agent\'s outbound message mentioning "trade-in numbers" or similar generic language does NOT mean a trade is part of this conversation — that is boilerplate the agent included by default. If the LEAD section says "Trade-in: (none entered)" or has no trade listed, do NOT introduce trade discussion.',
    '- DO NOT introduce topics the customer has not engaged with simply because a prior agent message touched on them. Outbound agent text often includes generic offers ("trade numbers", "financing options", "incentives") that the customer never asked about. Anchor your message on what the CUSTOMER has actually said or what is explicitly listed in the LEAD section — not on what a prior agent volunteered.',
    '- NEVER use the sales rep name as the signer — sign as the BD Agent only.',
    '- LANGUAGE: ALL responses are written in English, regardless of what language the customer used. The dealership uses an in-CRM translation tool for delivery to non-English-speaking customers. NEVER write any portion of the SMS, email, or voicemail in Spanish, French, or any non-English language. NEVER mix languages in a single message. Even if the customer\'s most recent message is in Spanish ("hola," "gracias," "cuando este") OR a prior agent has been replying in Spanish, your output must be 100% English. Do not translate phrases for them. Do not include Spanish greetings, closings, or filler phrases ("hola," "saludos," "que tenga buen dia"). The translation step happens after Lead Pro generates the message, not inside it.',
    '- EMOTIONAL CALIBRATION: If the customer\'s most recent message is emotionally elevated — urgency ("I need this NOW", "TODAY"), frustration, anger, profanity, or aggressive demand — do NOT match that energy. Respond with calm, grounded, professional tone. Acknowledge what they said directly without dismissing it, but never escalate, never use exclamation points to mirror their intensity, never adopt their urgency framing, and never use words in all caps. The dealership voice that earns trust under pressure is steady, not amplified. Mirroring heat reads as performative or unprofessional; staying calm reads as competent.',
    ...(scenarioRules ? ['', scenarioRules] : []),
    '',
  ];

  // Suppress inventory note for trade-tool leads (KBB or TradePending) with no vehicle of interest
  // The customer came to get a trade value — there is no vehicle for them to see
  var suppressInventory = (sc.isKBB || sc.isTradePending) && (!data.vehicle || /not provided/i.test(data.vehicle || ''));

  // Also suppress for brand-mismatch leads — the generic "we have the [model] available"
  // line directly contradicts the brand-mismatch directive's "NEVER say we can have the
  // [competitor] ready or available" rule. The brand-mismatch directive handles inventory
  // framing on its own terms.
  if (sc.isBrandMismatch) {
    suppressInventory = true;
  }

  if (vehiclePivotNote) lines.push(vehiclePivotNote, '');
  if (inventoryNote && !vehiclePivotNote && !suppressInventory) lines.push('INVENTORY: ' + inventoryNote, '');
  if (inventoryNote &&  vehiclePivotNote && !suppressInventory) lines.push('INVENTORY (original lead vehicle - customer has pivoted away from this): ' + inventoryNote, '');
  if (audiNote)      lines.push(audiNote, '');
  if (hondaLafNote)  lines.push(hondaLafNote, '');

  // ── NAMED SOURCE ACKNOWLEDGMENT (v9.7.16) ──
  // Customers who came through a recognized third-party source (CarGurus, Cars.com,
  // AutoTrader, Edmunds, KBB, TradePending, CarFax, Costco) should hear that source
  // referenced once in the message — it builds trust ("they actually read my inquiry").
  // This block fires AFTER the persona block so the named-source directive coexists
  // with persona-required openings (especially Audi Concierge) instead of being
  // crowded out by them.
  var namedSourceNote = '';
  // Skip on follow-ups where prior outreach already exists — re-mentioning the source
  // on a continuing conversation feels redundant.
  var _alreadyContacted = sc.isFollowUp && hasRealOutbound;
  if (!_alreadyContacted) {
    if (sc.isCarGurus || sc.isCarGurusDD) {
      namedSourceNote = 'NAMED SOURCE — CARGURUS:\n- The customer came in through CarGurus. MUST mention "CarGurus" once in BOTH the SMS and the email — naturally, in the first or second sentence. Example: "Saw your CarGurus inquiry on the [vehicle]" or "Got your message from CarGurus."\n- Do NOT skip the mention. CarGurus shoppers compare across listings — naming the source confirms you read their specific inquiry, not a generic auto-reply.\n- Do NOT mention CarGurus more than once. Once is the right amount.';
    } else if (sc.isCarscom) {
      namedSourceNote = 'NAMED SOURCE — CARS.COM:\n- The customer came in through Cars.com. MUST mention "Cars.com" once in BOTH the SMS and the email — naturally, in the first or second sentence. Example: "Got your inquiry from Cars.com" or "Saw your Cars.com message on the [vehicle]."\n- Do NOT skip the mention. Cars.com shoppers expect professionalism — naming the source signals you read their inquiry specifically.\n- Do NOT mention Cars.com more than once.';
    } else if (sc.isAutoTrader) {
      namedSourceNote = 'NAMED SOURCE — AUTOTRADER:\n- The customer came in through AutoTrader. MUST mention "AutoTrader" once in BOTH the SMS and the email — naturally, in the first or second sentence. Example: "Saw your AutoTrader inquiry" or "Got your message from AutoTrader."\n- Do NOT skip the mention. AutoTrader shoppers compare across multiple dealers — naming the source confirms this is a real, specific reply to their listing.\n- Do NOT mention AutoTrader more than once.';
    } else if (sc.isEdmunds) {
      namedSourceNote = 'NAMED SOURCE — EDMUNDS:\n- The customer came in through Edmunds. MUST mention "Edmunds" once in BOTH the SMS and the email — naturally, in the first or second sentence. Example: "Got your Edmunds inquiry" or "Saw your message from Edmunds."\n- Do NOT skip the mention. Edmunds shoppers do their research — naming the source signals you saw their specific inquiry.\n- Do NOT mention Edmunds more than once.';
    } else if (sc.isCarFax) {
      namedSourceNote = 'NAMED SOURCE — CARFAX:\n- The customer came in through CarFax. MUST mention "CarFax" once in BOTH the SMS and the email — naturally, in the first or second sentence. Example: "Saw your CarFax inquiry on the [vehicle]" or "Got your message from CarFax."\n- Do NOT skip the mention. CarFax shoppers care about vehicle history — naming the source confirms you read their specific inquiry.\n- Do NOT mention CarFax more than once.';
    } else if (sc.isKBB) {
      namedSourceNote = 'NAMED SOURCE — KBB:\n- The customer came in through Kelley Blue Book (KBB) — they used KBB to value their trade. MUST mention "KBB" or "Kelley Blue Book" once in BOTH the SMS and the email — naturally, in the first or second sentence. Example: "Saw you got a KBB value on your [trade vehicle]" or "Thanks for using KBB to start the trade conversation."\n- Naming the source confirms you saw what they actually did — they did not just inquire, they took the step of valuing their trade.\n- Do NOT mention KBB more than once.';
    } else if (sc.isTradePending) {
      namedSourceNote = 'NAMED SOURCE — TRADEPENDING:\n- The customer came in through TradePending — they used the TradePending tool to value their trade. MUST mention "TradePending" once in BOTH the SMS and the email — naturally, in the first or second sentence. Example: "Saw your TradePending value on the [trade vehicle]" or "Thanks for starting with TradePending on the trade."\n- Naming the source confirms you saw what they actually did. Do NOT mention TradePending more than once.';
    }
    // Note: Costco, TrueCar, Facebook already have strong named-source directives
    // baked into their scenario blocks (Costco: "MUST acknowledge"; TrueCar: "MUST mention TrueCar";
    // Facebook: "REQUIRED OPENING"). No duplicate guidance needed — those scenarios own their
    // named-source acknowledgment internally.
  }
  if (namedSourceNote) lines.push(namedSourceNote, '');

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

  // availability override is now computed before lines array — see above

    // conversationAnalysis is now injected at prompt start (before SCENARIO) — not here

  // ── Brand mismatch — competitor vehicle at wrong store ───────────
  // NOTE: when the AI Buying Signal matrix is active and the lead is cross-brand,
  // the matrix's PLAY A language ("straight up, [target] isn't something we carry")
  // is the correct play — the brand-mismatch directive's "don't explain" rule does
  // NOT apply there because the customer never asked us about the cross-brand vehicle.
  // Skip the directive entirely in that case to avoid contradictory guidance.
  if (sc.isBrandMismatch && !((sc.isAIBuyingSignalNew || sc.isAIBuyingSignalReturner) && sc.aiBSIsCrossBrand)) {
    var storeBrandName = sc.isHonda ? 'Honda' : sc.isKia ? 'Kia' : sc.isToyota ? 'Toyota' : sc.isAudi ? 'Audi' : 'our brand';
    // Concrete in-brand alternatives by category — gives the model somewhere to land
    var competitorLow = (sc.competitorBrand || '').toLowerCase();
    var competitorVehicle = (data.vehicle || '').toLowerCase();
    var inBrandAlt = '';
    if (sc.isHonda) {
      if (/telluride|sorento|palisade|atlas|grand cherokee|durango|highlander|pathfinder|explorer|tahoe|suburban|pilot|traverse|ascent/i.test(competitorVehicle)) inBrandAlt = 'Pilot or Passport';
      else if (/sportage|tucson|cr-v|rav4|escape|equinox|terrain|forester|outback|cx-5|rogue|murano/i.test(competitorVehicle)) inBrandAlt = 'CR-V or HR-V';
      else if (/forte|elantra|corolla|civic|sentra|jetta|mazda3|impreza/i.test(competitorVehicle)) inBrandAlt = 'Civic';
      else if (/optima|sonata|camry|altima|legacy|mazda6|accord|maxima/i.test(competitorVehicle)) inBrandAlt = 'Accord';
      else if (/sierra|silverado|f-150|tundra|ram|titan|ridgeline|tacoma|colorado|ranger/i.test(competitorVehicle)) inBrandAlt = 'Ridgeline';
      else if (/odyssey|sienna|carnival|pacifica/i.test(competitorVehicle)) inBrandAlt = 'Odyssey';
    } else if (sc.isKia) {
      if (/pilot|cr-v|rav4|highlander|pathfinder|explorer|tahoe|suburban|atlas|grand cherokee|durango|traverse|ascent/i.test(competitorVehicle)) inBrandAlt = 'Telluride or Sorento';
      else if (/tucson|escape|equinox|terrain|forester|outback|cx-5|rogue/i.test(competitorVehicle)) inBrandAlt = 'Sportage';
      else if (/elantra|civic|corolla|sentra|jetta|mazda3|impreza/i.test(competitorVehicle)) inBrandAlt = 'Forte';
      else if (/sonata|accord|camry|altima|legacy|maxima/i.test(competitorVehicle)) inBrandAlt = 'K5';
    } else if (sc.isToyota) {
      if (/pilot|cr-v|telluride|sorento|palisade|grand cherokee|durango|atlas|traverse|ascent/i.test(competitorVehicle)) inBrandAlt = 'Highlander or Grand Highlander';
      else if (/tucson|sportage|escape|equinox|terrain|forester|outback|cx-5|rogue/i.test(competitorVehicle)) inBrandAlt = 'RAV4';
      else if (/civic|elantra|forte|sentra|jetta|mazda3/i.test(competitorVehicle)) inBrandAlt = 'Corolla';
      else if (/accord|sonata|optima|altima|legacy|maxima/i.test(competitorVehicle)) inBrandAlt = 'Camry';
      else if (/sierra|silverado|f-150|ram|titan|ridgeline|colorado|ranger/i.test(competitorVehicle)) inBrandAlt = 'Tundra or Tacoma';
    }

    // KBB or TradePending sub-tier: customer brought their trade AND named a vehicle of interest.
    // This is different from a pure trade play — they're vehicle-shopping while valuing
    // their current ride. We honor the trade (the ostensible reason they came) but open
    // a soft door to comparable on-brand options. Sister-store latitude applies if the
    // customer's brand-of-interest matches a rooftop in the auto group.
    var _isTradeToolWithVehicleInterest = (sc.isKBB || sc.isTradePending) && data.vehicle && data.hasTrade;
    var _tradeToolName = sc.isKBB ? 'KBB' : (sc.isTradePending ? 'TradePending' : 'the trade tool');
    var _hasSisterStoreForLeadBrand = sc.leadVehicleBrandHasSisterStore;

    lines.push('⚠ BRAND MISMATCH: Customer listed a ' + sc.competitorBrand + ' — this store sells ' + storeBrandName + ', not ' + sc.competitorBrand + '.',
      'ABSOLUTE RULES FOR BRAND MISMATCH:',
      '- NEVER say we can have the ' + sc.competitorBrand + ' ready, available, or pulled up for them.',
      '- NEVER offer to show them the ' + sc.competitorBrand + ' — we do not carry it.',
      '- NEVER say "we do not sell ' + sc.competitorBrand + '", "we don\'t carry ' + sc.competitorBrand + '", "we don\'t have ' + sc.competitorBrand + '" — just redirect naturally without explaining.',
      '- This applies to ALL THREE formats — SMS, email, and voicemail must all avoid mentioning the ' + sc.competitorBrand + ' as something we have.');

    if (_isTradeToolWithVehicleInterest) {
      // Trade-tool (KBB or TradePending) + Vehicle of Interest + Brand Mismatch — the soft-pivot tier
      lines.push(
        'STRATEGY — TRADE-TOOL CROSS-BRAND WITH VEHICLE INTEREST: This is a NUANCED case. The customer used ' + _tradeToolName + ' to value their ' + sc.competitorBrand + ', AND they listed a ' + sc.competitorBrand + ' as their vehicle of interest. They are doing two things at once: getting a trade number AND vehicle-shopping. Your job is to honor BOTH without pushing them off their brand AND without implying we have the ' + sc.competitorBrand + '.',
        '',
        'WRITE THE MESSAGE IN THIS EXACT ORDER — FOUR DISTINCT PARAGRAPHS:',
        'PARAGRAPH 1 (OPENER): Acknowledge their trade specifically. Reference the year/model of the ' + sc.competitorBrand + ' they have for trade. Validate that they came to get a number on it. The trade is the ostensible reason they reached out — lead with it. Keep this paragraph focused entirely on the trade.',
        'PARAGRAPH 2 (THE ASK): Frame the in-person visit as where they get a real number on their trade. ' + _tradeToolName + ' is a starting point, not the final word. Appraisals usually move the number. Make this paragraph about getting them in for the appraisal — NOTHING else. Do NOT mention the new vehicle here.',
        'PARAGRAPH 3 (OPTIONAL — STANDS ALONE, ONE LINE ONLY): If it fits naturally, this paragraph is the soft on-brand mention. Phrasing must follow the stay-OR-consider pattern. Customer chooses. Never push.' + (inBrandAlt ? ' Use the specific name "' + inBrandAlt + '" — never "comparable Honda option" or generic phrasing. Example: "If you decide to stay ' + sc.competitorBrand + ', that trade number is yours either way. If you\'d consider the ' + inBrandAlt + ' as a comparable, I\'m happy to show you how it stacks up against your ' + sc.competitorBrand + ' in person."' : '') + ' This must be its own paragraph, separated from paragraph 2 by a line break. Never merge it into paragraph 2.',
        'PARAGRAPH 4 (CLOSE): Time-of-day question or soft commitment ask. Anchor back to getting them in for the trade appraisal.',
        '',
        'WHAT TO AVOID — READ CAREFULLY:',
        '- Do NOT say "we have the ' + sc.competitorBrand + ' available" — we do not carry it.',
        '- Do NOT say "build the deal around your ' + sc.competitorBrand + '" or "build the right deal around the ' + sc.competitorBrand + '" — we are not putting them in another ' + sc.competitorBrand + '. We do not sell ' + sc.competitorBrand + '.',
        '- Do NOT imply the appraisal leads to a ' + sc.competitorBrand + ' purchase. The appraisal gives them a NUMBER for their trade. The number is portable — they take it wherever they go.',
        '- Do NOT lead with the on-brand pivot. The trade comes first.',
        '- Do NOT merge the on-brand mention into the trade paragraph. It must be its own line, late in the message, optional.',
        '- Do NOT use generic phrasing like "comparable Honda option" — name the specific model (' + (inBrandAlt || 'a specific in-brand model') + ').',
        '- Do NOT dismiss the ' + sc.competitorBrand + '. The customer loves what they have. Honor that.',
        '- Do NOT skip the on-brand mention if it fits — leaving it out misses the chance for a real conversation in person.',
        '- The trade number is what we offer here. The ' + sc.competitorBrand + ' purchase is what happens elsewhere if they decide to stay in-brand. Be honest about this.');

      if (_hasSisterStoreForLeadBrand) {
        lines.push('SISTER-STORE LATITUDE: The auto group does include a ' + sc.competitorBrand + ' rooftop. This is for YOUR situational awareness only — it gives the conversation more room. Do NOT name the sister store. Do NOT promise to connect or transfer the customer to another rooftop. Specific cross-store handoffs happen manually, agent-to-customer, after the conversation gets going. Use this knowledge to be confident the relationship has options — not to commit to anything specific in this message.');
      }
    } else if (data.hasTrade) {
      // Pure trade play — for trade-only KBB / TradePending leads (no vehicle of interest)
      lines.push('STRATEGY — TRADE PRESENT: Lead entirely with the trade-in. Focus 100% on getting them in to appraise the trade. Example email: "I want to make sure we get a solid number on your Explorer — can you bring it by so we can do a proper appraisal? It only takes about 10 minutes and we will have everything ready." Let the sales rep handle the brand conversation in person.');
    } else {
      lines.push('STRATEGY — NO TRADE: Acknowledge their search neutrally and pivot to a comparable ' + storeBrandName + (inBrandAlt ? ' — ' + inBrandAlt + ' is the natural fit if you want to name something. Otherwise reference the segment.' : ' without naming a specific model unless clearly comparable.'));
    }
    lines.push('');
  }

  // ── Context flag rules — injected when flags are active ─────────
  var flags = data.activeFlags || [];
  if (flags.includes('trade')) {
    lines.push('🔴 TRADE-IN FLAG: Trade-in is part of this conversation — either listed in the lead, mentioned in messages, or manually flagged.',
      '- Reference the trade ASSESSMENT (the number, the conversation about value), not the trade vehicle as inventory.',
      '- Frame the trade as a numbers conversation: "Let us get a real number on your trade in person — appraisals are within $500 of the final value."',
      '- Do NOT promise a specific trade value sight-unseen. Avoid "your trade is worth X" language.',
      '- The trade is the EMOTIONAL CENTER for many customers — they want to feel they are getting a fair number, not lowballed.',
      '- If KBB or a third-party value was mentioned, acknowledge it: "I have seen the KBB number — let us see what we can actually pay against that in person."',
      '- Do NOT say "build the deal around your KBB number" or "build the right deal around the KBB value" — this implies we are committing to that number sight-unseen. The KBB number is a STARTING POINT we appraise against, not a number we build the deal around. Use "confirm the number in person," "see what we can actually pay against that," or "get you a real number" instead.',
      '- Tone: confident on the appraisal process, never on the specific number until you see the vehicle.',
      '');
  }
  if (flags.includes('credit')) {
    lines.push('🔴 CREDIT SENSITIVITY FLAG: Customer has shown credit concern — past denial, low credit, repo, bankruptcy, or "working on credit" language.',
      '- NEVER say "get approved", "easy financing", "no matter your credit", "we can get anyone approved", or imply approval is guaranteed.',
      '- NEVER lead with payment amounts, APR rates, or down payment requirements — these can backfire if they are higher than expected.',
      '- NEVER use the word "qualify" — it puts the customer in an evaluation seat. Use "options" or "what works for you."',
      '- Frame the visit as exploratory: "Let us look at the options together." Not "let us get you financed." The customer needs to feel they are in control.',
      '- If Capital One, a credit app, or a co-signer is mentioned, reference it neutrally and positively: "Having that started gives us a head start."',
      '- Acknowledge their concern indirectly — never quote their credit language back to them. ("I hear you" is OK; "since your credit is rough" is not.)',
      '- Tone: reassuring, low-pressure, dignified. The goal is getting them in the door safely. Save financing specifics for the visit.',
      '');
  }
  if (flags.includes('price_gate')) {
    lines.push('🔴 PRICE GATE FLAG: Customer has signaled budget concern, payment resistance, or "best price" pressure.',
      '- Acknowledge the concern directly. Do NOT skip past it or pretend it was not raised.',
      '- Frame the visit as finding the right number FOR THEM, not selling more car. The visit is a problem-solving session, not a pitch.',
      '- Do NOT mention MSRP, sticker price, or discount language. Those frame the conversation around the dealer\'s number, not theirs.',
      '- Avoid words like "deal", "savings", "great price" — they read as setup.',
      '- Helpful framing: "I want to make sure the numbers work the way you need them to before you make the trip." Empathy first, then the visit.',
      '- If they cited a specific budget or payment, reference it concretely — do not paraphrase it away.',
      '- Tone: empathetic, on their side, calm. Pressure is the enemy here.',
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
  if (flags.includes('loyalty')) {
    lines.push('🔴 LOYALTY / LEASE-END FLAG: Customer is a returning buyer or in a manufacturer finance program (lease maturity, AFS, KMF, KFA).',
      '- The vehicle shown in the lead may be their CURRENT owned vehicle, NOT inventory. Treat it that way.',
      '- Lead with the relationship, not a sales pitch. They chose us once.',
      '- Frame the visit as an "options review" — not a sales appointment. "Let us look at where you stand" not "let us put you in something new."',
      '- If lease maturity is in play, reference the program neutrally — "your lease is coming up" — without urgency or upgrade language.',
      '- Their equity, payoff, or remaining payments are powerful conversation starters but must be handled with discretion. "Let us see what your situation looks like."',
      '- NEVER say "upgrade", "newer model", "trade up" — these read as sales talk to a loyal customer. They want a fair conversation.',
      '- Tone: warm, familiar, no pressure. Their loyalty earned them a different conversation than a cold prospect.',
      '');
  }
  if (flags.includes('stalled')) {
    lines.push('🔴 STALLED LEAD FLAG: Customer has gone silent, multiple outreach attempts have failed, or it has been 5+ days with no reply.',
      '- This is a recovery moment. Standard follow-up tactics have already failed — do not repeat them.',
      '- Acknowledge the gap honestly without making them feel guilty. Do NOT say "did you get my last message" or "checking in again."',
      '- Use a pattern-break: a question that names the real possibilities. "Most people who go quiet at this point are either still comparing or something changed — which is it?"',
      '- Give them an easy out. The path to re-engagement is making them feel safe to say no. "If timing shifted, that is completely fine — I just want to know which so I can either get out of your way or actually help."',
      '- ONE question. ONE easy out. No appointment ask in the opener — that is what was failing.',
      '- Tone: human, observational, unscripted. They have been receiving templated follow-up. The cure is sounding like a real person who actually noticed they went quiet.',
      '');
  }

  lines.push(
    '━━━ LEAD ━━━'
  );
  if (data.isSmsOptOutOnly) {
    lines.push(
      '',
      '╔════════════════════════════════════════════════════════════════════╗',
      '║ TOP-PRIORITY DIRECTIVE — SMS OPT-OUT — READ AND OBEY EXACTLY       ║',
      '╚════════════════════════════════════════════════════════════════════╝',
      'The customer texted STOP. This is a CHANNEL preference (no more texts), NOT an exit signal. They did not say they bought elsewhere. They did not say they lost interest. They just said no more SMS.',
      '',
      'WHAT TO DO:',
      '1. SMS = generate a very short opt-out confirmation. ONE sentence. Then the stacked signature. Nothing else. No re-engagement, no questions, no vehicle mention.',
      '2. EMAIL = DO NOT make the email about the opt-out. The email subject and body must address the ORIGINAL INQUIRY shown in the LEAD section below (vehicle they asked about, trade-in/KBB offer amount if present, whatever brought them in). Treat the email like a normal first-touch outreach for their actual inquiry. You may include ONE brief sentence acknowledging SMS is off, but do NOT make it the subject or the lead paragraph.',
      '3. VOICEMAIL = skip or one sentence max. Do not dwell on the STOP.',
      '',
      'WRONG email subject: "Text updates stopped" / "SMS opt-out confirmed" / "Your text preferences" — these treat the email as if it were just another STOP confirmation. The customer ALREADY got that confirmation via SMS.',
      'RIGHT email subject: References the actual vehicle/trade/inquiry. e.g. "Your KBB offer on the 2017 Audi A4" / "Your 2024 Honda Accord inquiry" / "Following up on your trade-in".',
      '',
      'WRONG email body: "Hi [name], I have marked your number to stop text messages. [signature]" — this is dead weight. The customer already knows their texts are off.',
      'RIGHT email body: Opens with the actual inquiry. e.g. "Hi [name], I saw your KBB instant cash offer come through at $8,568 on your 2017 Audi A4 Prestige. That offer is good for [X days] and we can have it ready to look at any time. [Optional one-liner: I have also confirmed your number is off our text list per your request.] [Substantive content about the inquiry / next step / signature]."',
      '',
      'The customer opted out of ONE channel. Serve them on the channel they did not opt out of, on the topic they actually raised.',
      '╔════════════════════════════════════════════════════════════════════╗',
      '║ END SMS OPT-OUT DIRECTIVE                                           ║',
      '╚════════════════════════════════════════════════════════════════════╝',
      ''
    );
  }
  // (v9.7.118) LATE-SCRAPE BACKFILL: data is a snapshot taken when populate ran.
  // If a late frame scrape populated lastScrapedData.phone AFTER that snapshot
  // (third-party leads often render the buyer panel several seconds after the
  // main lead panel), reconcile here before the prompt is built. Without this,
  // a phone visible on the lead at click time still produces "no phone on file"
  // in the prompt because data.phone was empty when populate ran.
  try {
    if (!data.phone && lastScrapedData && lastScrapedData.phone) {
      var _lspDigits = String(lastScrapedData.phone).replace(/\D/g,'').length;
      if (_lspDigits >= 7) {
        console.log('[LP PHONE BACKFILL] data.phone was empty; backfilling from lastScrapedData.phone:', lastScrapedData.phone);
        data.phone = lastScrapedData.phone;
      }
    }
  } catch(e) { /* non-fatal */ }

  // (v9.7.91) DIAGNOSTIC: log what the prompt will tell the worker about
  // Customer Phone. The Cloudflare worker's classifier reads "Customer Phone:"
  // from the prompt to decide whether to run the phone-ask classifier. This
  // log lets us audit the worker's decision in cases where the regen does
  // (or doesn't) fire as expected — especially for work-only phone leads
  // where the scraper picks up "W: (xxx) xxx-xxxx" as data.phone.
  try {
    var _phoneOnFileForPrompt = !!data.phone;
    var _phoneDigits = data.phone ? String(data.phone).replace(/\D/g,'').length : 0;
    console.log('[LP PROMPT CUSTOMER PHONE] willSayPhoneOnFile:', _phoneOnFileForPrompt,
      '| data.phone:', data.phone || '(empty)',
      '| digitCount:', _phoneDigits,
      '| leadSource:', (data.leadSource || '(unknown)'));
  } catch(e) { console.log('[LP PROMPT CUSTOMER PHONE] diag error:', e.message); }

  lines.push(
    'Customer:   ' + (data.name || '(unknown — do not say Hi there)'),
    data.email ? 'Email:      ' + data.email + '  ← customer email already on file. Do NOT ask for their email address.' : '',
    // (v9.7.82) UNIVERSAL PHONE-ASK FIX: Mirror the email rule. When the customer's
    // phone is on file, show it as an explicit field with a "Do NOT ask" instruction.
    // When genuinely missing, show that explicitly so the model knows asking is appropriate.
    // Prior to this, customer phone only appeared indirectly in transcript "Sent to: (...)"
    // lines, which the model interpreted as outbound logs rather than "phone on file".
    // The model would then default to asking for a phone number even when one existed,
    // especially on leads with failed call attempts in the call history.
    data.phone
      ? 'Customer Phone: ' + data.phone + '  ← already on file. Do NOT ask for a phone number.'
      : 'Customer Phone: (no phone on file)  ← genuinely missing. Asking for a phone number IS appropriate.',
    data.isSmsOptOutOnly ? '⚠ SMS STATUS: see TOP-PRIORITY DIRECTIVE above. SMS = brief opt-out confirm only. Email = substantive on original inquiry, NOT about the opt-out.' : '',
    'BD Agent:   ' + (data.agent || '⚠ AGENT NAME UNKNOWN — CRITICAL: Do NOT invent or guess a name. Use ONLY the phone number in the SMS signature. Sign as the phone number only. Never fabricate a name.') + '  ← THIS IS WHO WRITES AND SIGNS THIS MESSAGE. Use this name in the signature — NOT any sales rep name from prior messages.',
    'Sales Rep:  ' + (data.salesRep || '(not assigned)') + '  ← may appear in call notes as the person who spoke with customer',
    'Agent Phone: ' + phone + '  ← CRITICAL: this is the AGENT signature phone (use in signature). Do NOT confuse with Customer Phone above. Do NOT use any other number you may have seen.',
    'Store:      ' + sc.storeGroup,
    'Persona:    ' + sc.persona,
    'SMS SIGNATURE — copy these three lines exactly at the end of every SMS, stacked, nothing else:',
    '  ' + (window._leadProResolvedSigner ? window._leadProResolvedSigner.firstName : (agentFirst || '[agent first name]')),
    '  ' + (sc.storeGroup || '[store name]'),
    '  ' + (window._leadProResolvedSigner ? (window._leadProResolvedSigner.phone || phone) : phone),
    'The stacked signature IS your sign-off. Do NOT write your name anywhere in the message body — not at the end, not as a closing. The name in the signature IS the closing. Never sign off inline.',
    'EMAIL SIGNATURE — end every email with this exact block, each item on its own line:',
    '  ' + (window._leadProResolvedSigner ? window._leadProResolvedSigner.name : (data.agent || agentFirst || '[agent full name]')),
    '  ' + (window._leadProResolvedSigner ? window._leadProResolvedSigner.title : (sc.persona || 'Internet Sales Coordinator')),
    '  ' + (sc.storeGroup || '[store name]'),
    '  ' + (window._leadProResolvedSigner ? (window._leadProResolvedSigner.phone || phone) : phone),
    (sc.isAIBuyingSignalNew || sc.isAIBuyingSignalReturner)
      ? (sc.aiBSIsCrossBrand
          ? 'Customer browsing interest: ' + (data.vehicle || '(not specified)') + '  ← This is the cross-brand vehicle they have been shopping online. Refer to the SITUATION MATRIX above for play guidance — naming it is appropriate when doing the honest pivot (PLAY A).'
          : 'Customer browsing interest: ' + (data.vehicle || '(not specified)') + '  ← This is what they have been shopping online — not necessarily what is on our lot today. Reference the model naturally if it fits, but never claim a specific unit, color, trim, or stock is available without confirmation.')
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

  if (!sc.isApptConfirmation && !sc.isExitSignal && !sc.isPauseSignal && !sc.isSoldDelivered && !sc.vehicleSold && !hasVerbalCommitment && !closeOverride && !isZeroContactStalled) {
    // Suppress appointment-time injection on cross-brand AI Buying Signal leads.
    // The matrix's PLAY A (honest pivot) and PLAY C (questioning open) need the model
    // to ASK before committing — appointment times pull the model toward closing on
    // inventory the store doesn't have. Cold-prospect AI Buying Signal leads also
    // get suppressed regardless of brand match.
    var aiBSSuppressAppt = (sc.isAIBuyingSignalNew || sc.isAIBuyingSignalReturner) &&
                           (sc.aiBSIsCrossBrand || sc.isAIBuyingSignalNew);
    if (aiBSSuppressAppt) {
      lines.push('', 'AI BUYING SIGNAL — APPOINTMENT TIMES SUPPRESSED:',
        '- Do NOT offer specific appointment times in this message.',
        '- The customer did not raise their hand for an appointment — they were spotted by signals.',
        '- Close with a question that opens the conversation, not a time that closes it. Use the matrix block above to choose the right play.',
        sc.aiBSIsCrossBrand
          ? '- This is also a cross-brand case — anchoring on appointment times forces a close on inventory we do not have. Avoid.'
          : '- Lean toward a curious, low-pressure question. They will tell you when they want to come in if you do this right.');
    } else if (lpSuppressAppointment) {
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
            'First option: ' + fmt(slot1Hour, slot1Min) + ' ' + dayLabel,
            'Second option: ' + fmt(slot2Hour, slot2Min) + ' ' + dayLabel);
        } else {
          lines.push('', 'APPOINTMENT TIMES (use exactly — do not change):',
            'First option: ' + appt.time1 + '  ← use this exact time',
            'Second option: ' + appt.time2 + '  ← use this exact time');
        }
      } else {
        lines.push('', 'APPOINTMENT TIMES (use exactly — do not change):',
          'First option: ' + appt.time1 + '  ← use this exact time',
          'Second option: ' + appt.time2 + '  ← use this exact time');
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
    '- Greeting: Use the customer first name on its own line for first-touch formal emails. For warm follow-ups where conversation is already active, "Hi [customer name]," is natural and preferred.',
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
    // ── Regenerate-with directive (v9.7.5) ── injected when agent clicks an adjustment chip
    ...((function(){
      var d = (typeof window !== 'undefined') ? (window._lpRegenDirective || '') : '';
      if (!d) return [];
      return [
        '━━━ TONE ADJUSTMENT (REGENERATE) ━━━',
        'The previous version of this message did not land for the agent. Apply this adjustment to the new version:',
        d,
        '',
        'IDENTITY LOCK — DO NOT CHANGE ON REGENERATION:',
        '- Keep the same agent identity in the opener and signature as the previous version implied.',
        '- The agent writing this message is the one named in YOUR ROLE above. Do not switch to a different name from the lead data (Sales Rep, BD Agent, Manager, etc.) just because they are mentioned in the lead.',
        '- Names visible in the lead data (Sales Rep, BD Agent, Manager) are CONTEXT about the lead — not candidates for who is writing the message.',
        '- The shortener directive applies to LENGTH and CONCISION, not to identity. Cut filler, not the agent\'s name.',
        '',
        'Honor all other rules above. This adjustment is in addition to them, not in place of them.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ''
      ];
    })()),
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

  // Lead ID guard — prevents cross-lead contamination when an agent switches leads
  // quickly and lastScrapedData hasn't refreshed. The active lead ID is derived from
  // the VinSolutions URL at grab time and stored on the scrape payload as autoLeadId.
  // If the agent has scrolled to a different lead since the last grab, those won't
  // match and we must force a re-grab before generating.
  if (lastScrapedData && lastScrapedData.autoLeadId && window._activeLeadId
      && String(lastScrapedData.autoLeadId) !== String(window._activeLeadId)) {
    if (_domCrmStatus) {
      _domCrmStatus.className = 'crm-status error';
      _domCrmStatus.textContent = '⚠ Lead changed — click GRAB LEAD again to refresh data for this lead';
      setTimeout(() => { _domCrmStatus.className = 'crm-status'; _domCrmStatus.textContent = ''; }, 8000);
    }
    console.warn('[Lead Pro] Generate blocked — stale scraped data:', lastScrapedData.autoLeadId, '!= active:', window._activeLeadId);
    return;
  }

  const name       = document.getElementById('custName').value.trim();
  var agentField = document.getElementById('agentName').value.trim();
  const agent = agentField || (_leadProProfile && _leadProProfile.name) || '';

  // (v9.7.81) NORMALIZE leadAgeDays before any downstream code reads it.
  //
  // The scraper occasionally fails to capture leadAgeDays (race condition,
  // rims2 not yet rendered, customer-dashboard frame not surfaced). When
  // that happens, lastScrapedData.leadAgeDays is undefined or 0 — but the
  // lead might be 90+ days old with rich history.
  //
  // The persona resolver at line 3679 has a fallback that derives ageDays
  // from "Created (Xd)" text in pageSnippet or from the oldest transcript
  // date — so the resolver correctly routes a 92-day ghost lead to
  // internet_director. BUT the system-prompt builder at line 4158 and the
  // LEAD AGE block at line 6160 do NOT have the same fallback. They read
  // `data.leadAgeDays || 0` directly. When leadAgeDays is missing, those
  // readers see 0, fire the FIRST TOUCH branch, and tell the model
  // "submitted today | Phase: first-touch (Day 0-1) | Attempt density:
  // light (0 notes)".
  //
  // Amya Green case (May 11): 92-day-old Thirdparty Honda lead with 20
  // notes, 9 unanswered outbound touches, 0 customer replies. Resolver
  // correctly routed to internet_director with isHeavyAttemptGhost: true,
  // isLongSilenceGhost: true. But the prompt told the model it was a
  // fresh first-touch lead with 0 notes, so the model wrote a first-touch
  // opener repeating the exact question Kaylee had asked 6 days prior.
  //
  // Fix: run the resolver's same fallback BEFORE any prompt-building code
  // reads from lastScrapedData. Write the canonical value back so every
  // downstream consumer sees the same age.
  if (lastScrapedData) {
    var _lad = parseFloat(lastScrapedData.leadAgeDays || 0);
    if (!_lad || _lad === 0) {
      var _ctxForAge = (lastScrapedData.context || lastScrapedData.pageSnippet || lastScrapedData.history || '');
      var _ctxAgeMatch = _ctxForAge.match(/Created[^(]*\((\d+)d\)/i);
      if (_ctxAgeMatch) _lad = parseInt(_ctxAgeMatch[1]);
      if (!_lad) {
        var _dateMatches = _ctxForAge.match(/\[(\d{1,2}\/\d{1,2}\/\d{4})/g) || [];
        if (_dateMatches.length > 0) {
          var _oldest = _dateMatches[_dateMatches.length - 1].replace('[','');
          var _oldestMs = new Date(_oldest).getTime();
          if (_oldestMs > 0) _lad = Math.floor((Date.now() - _oldestMs) / 86400000);
        }
      }
      if (_lad && _lad > 0) {
        lastScrapedData.leadAgeDays = _lad;
        console.log('[Lead Pro] leadAgeDays normalized via fallback:', _lad, '— scraper returned 0/undefined, derived from transcript');
      }
    }
  }

  // Guard: block generation if agent name is missing — prevents [Agent First Name] in output
  if (!agent) {
    if (_domCrmStatus) {
      _domCrmStatus.className = 'crm-status error';
      _domCrmStatus.textContent = '⚠ BD Agent name missing — type your name in the field below or GRAB LEAD again';
      setTimeout(() => { _domCrmStatus.className = 'crm-status found'; _domCrmStatus.textContent = ''; }, 6000);
    }
    // Focus the agent input to make it obvious where to type
    var agentInput = document.getElementById('agentName');
    if (agentInput) agentInput.focus();
    return;
  }
  const vehicle    = document.getElementById('vehicle').value.trim();
  const leadSource = document.getElementById('leadSource').value.trim();
  const store      = selectedStore;

  // Guard: block generation if store wasn't detected. Prevents stale store
  // bleeding from prior lead, and prevents store-less generation.
  if (!store) {
    if (_domCrmStatus) {
      _domCrmStatus.className = 'crm-status error';
      _domCrmStatus.textContent = '⚠ Store not detected — wait a moment for the lead to fully load, then click GRAB LEAD again';
      setTimeout(() => { _domCrmStatus.className = 'crm-status'; _domCrmStatus.textContent = ''; }, 8000);
    }
    return;
  }
  const btn        = document.getElementById('btnGenerate');

  if (!name && !vehicle && !store) {
    alert('Please fill in fields or use ⚡ GRAB LEAD first.'); return;
  }

  // Lead-ID guard — prevent generating against stale data after a lead switch.
  // VinSolutions lets agents switch leads quickly; lastScrapedData can be from
  // lead A while the active tab is now lead B. Generating in that window means
  // silently wrong output. We pull the lead ID from the LIVE tab URL right now
  // (not the stale window._activeLeadId from the last Grab) and compare to the
  // lead ID baked into lastScrapedData.
  if (lastScrapedData && lastScrapedData.autoLeadId) {
    try {
      var _scrapedId = lastScrapedData.autoLeadId || '';
      // Ask Chrome for the current active tab URL right now
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs || !tabs[0] || !tabs[0].url) return;
        var _liveUrl = tabs[0].url || '';
        var _liveMatch = _liveUrl.match(/AutoLeadID[=_]?(\d{6,12})/i)
                      || _liveUrl.match(/leadId[=_]?(\d{6,12})/i)
                      || _liveUrl.match(/\/leads\/(\d{6,12})/i);
        var _liveId = _liveMatch ? _liveMatch[1] : '';
        if (_liveId && _scrapedId && _liveId !== _scrapedId) {
          console.warn('[Lead Pro] Lead ID guard tripped post-generate — live:', _liveId, 'vs scraped:', _scrapedId);
          // Already mid-generate — flag for the agent so they know to discard the result
          if (_domCrmStatus) {
            _domCrmStatus.className = 'crm-status error';
            _domCrmStatus.textContent = '⚠ Lead changed — generated output may not match active lead. GRAB again.';
          }
        }
      });
      // Synchronous quick check using cached _activeLeadId — catches the case
      // where Grab was clicked, then a different lead was opened, then Generate
      // was clicked without re-grabbing. _activeLeadId still matches lastScrapedData
      // here, so this only catches the case where the URL on Grab and on Generate
      // have already diverged. The async check above catches the live case.
      var _activeId = window._activeLeadId || '';
      if (_activeId && _scrapedId && _activeId !== _scrapedId) {
        console.warn('[Lead Pro] Lead ID guard tripped — active:', _activeId, 'vs scraped:', _scrapedId);
        if (_domCrmStatus) {
          _domCrmStatus.className = 'crm-status error';
          _domCrmStatus.textContent = '⚠ Lead mismatch — click GRAB LEAD to refresh';
        }
        alert('You switched leads since the last grab. Click ⚡ GRAB LEAD to refresh data for this lead before generating.');
        return;
      }
    } catch (e) {
      console.warn('[Lead Pro] Lead ID guard check failed:', e);
    }
  }

  // Show loading state
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.btn-label').textContent = 'Generating…';

  // Clear previous outputs
  ['sms','email','vm'].forEach(function(k) {
    const f = document.getElementById('output-' + k);
    if (f) { f.value = ''; f.classList.add('generating'); }
    const tabBtn = _tabBtnMap[k];
    if (tabBtn) tabBtn.classList.remove('ready-' + k);
  });

  try {
    // Zero-contact stalled: strip appointment times from context before sending
    if (leadContext.includes('ZERO-CONTACT LEAD')) {
      console.log('[Lead Pro] Zero-contact stalled confirmed — stripping appointment times from context');
      // Remove any injected time lines that slipped through
      leadContext = leadContext.replace(/Time 1:.*$/gm, '').replace(/Time 2:.*$/gm, '').replace(/APPOINTMENT TIME FORMAT.*$/gm, '').replace(/Would.*AM or.*AM.*work/gi, '').trim();
    }
    // Resolve signer BEFORE building prompt — email signature reads this
    window._leadProResolvedSigner = resolveSignerForPersona();
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
      buyingSignals:             lastScrapedData ? (lastScrapedData.buyingSignals || '') : '',
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
      email:                     lastScrapedData ? (lastScrapedData.email || '') : '',
      isSRPVehicle:              lastScrapedData ? !!lastScrapedData.isSRPVehicle : false,
      isVelocityResponse:        lastScrapedData ? !!lastScrapedData.isVelocityResponse : false,
      _isStalled:                lastScrapedData ? !!lastScrapedData._isStalled : false,
      _neverReplied:             lastScrapedData ? !!lastScrapedData._neverReplied : false,
      isSoldDelivered:           lastScrapedData ? !!lastScrapedData.isSoldDelivered : false,
      hasMissedCallBackPromise:  lastScrapedData ? !!lastScrapedData.hasMissedCallBackPromise : false,
      missedCallBackDetail:      lastScrapedData ? (lastScrapedData.missedCallBackDetail || '') : '',
      // (v9.7.81) Missing flags caused dead-code injection — scraper detected
      // STOP correctly and isSmsOptOutOnly arrived at lastScrapedData as true,
      // but the buildUserPrompt call was dropping it on the floor. The boxed
      // TOP-PRIORITY DIRECTIVE block at line 6589 reads data.isSmsOptOutOnly
      // — which was always undefined here because nothing passed it through.
      // Wendy Browne case (May 11) — diagnostic v9.7.81 confirmed flag was
      // true at popup level but prompt length never grew. Root cause: this
      // missing prop bridge.
      isSmsOptOutOnly:           lastScrapedData ? !!lastScrapedData.isSmsOptOutOnly : false,
      hasExitSignal:             lastScrapedData ? !!lastScrapedData.hasExitSignal : false,
      hasPauseSignal:            lastScrapedData ? !!lastScrapedData.hasPauseSignal : false,
      hasTextOrEmailSent:        lastScrapedData ? !!lastScrapedData.hasTextOrEmailSent : false,
      activeFlags: Array.from(activeFlags),
      dealerId: lastScrapedData ? (lastScrapedData.dealerId || '') : '',
      leadAgeDays: lastScrapedData ? (lastScrapedData.leadAgeDays || 0) : 0
    });
    console.log('[Lead Pro] User prompt length:', userPrompt.length, '| scenario section:', userPrompt.substring(0, userPrompt.indexOf('━━━ LEAD ━━━')));
    const payload = {
      system_instruction: { parts: [{ text: buildSystemPrompt(window._leadProPersonaOverride || window._leadProResolvedPersona) }] },
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

    // (v9.7.91) DIAGNOSTIC: surface worker's classifier/regen metadata.
    // The Cloudflare worker (v7.13+) tags the response envelope with
    // _classify and _regenerated. Pairs with the [LP PROMPT CUSTOMER PHONE]
    // log to give end-to-end visibility on the phone-ask protection layer.
    try {
      if (data && (data._classify || data._regenerated !== undefined)) {
        console.log('[LP WORKER CLASSIFIER]',
          'classify:', data._classify || '(absent)',
          '| regenerated:', !!data._regenerated);
      }
    } catch(e) { /* non-fatal */ }

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

    // Use the signer resolved before generate (line 5175) — persona-aware name/title
    var signer   = window._leadProResolvedSigner || {};
    var leadInfo = lastScrapedData || {};

    var agentFirst = signer.firstName || (leadInfo.agent || '').split(' ')[0] || '';
    var agentFull  = signer.name || leadInfo.agent || '';
    var agentTitle = signer.title || '';
    // Phone: signer has the correct phone for whoever is signing (persona-aware)
    // lookupPhone(leadInfo.agent) would return the BD Agent's phone, not the signer's
    var agentPhone = signer.phone || lookupPhone(leadInfo.agent, leadInfo.store, leadInfo.dealerId) || leadInfo.agentPhone || '';
    // If no directory entry, use store phone from dealer config
    if (!agentPhone && leadInfo.dealerId && window._leadProDealerData) {
      var _ss = (window._leadProDealerData.stores || []).find(function(s) {
        return String(s.crmDealerId) === String(leadInfo.dealerId) || String(s.id) === String(leadInfo.dealerId);
      });
      if (_ss && _ss.phone) agentPhone = _ss.phone;
    }

    var storeName = '';
    var dealerId = (leadInfo.dealerId || '') + '';
    if (dealerId && DEALER_ID_MAP[dealerId]) {
      storeName = DEALER_ID_MAP[dealerId];
    } else {
      var raw = (selectedStore || '').replace(/VinSolutions Connect \[.*?\]/i, '').trim();
      if (raw && !/^VinSolutions/i.test(raw)) storeName = raw;
    }

    // Build persona-aware store sig line
    // CRITICAL: use the resolved signer's title (computed by resolveSignerForPersona based on
    // PROFILE persona, not active persona). When a BDC agent borrows a different voice, the
    // signature title must reflect their actual role — not the borrowed voice. Falling back to
    // _sigPersona derivation only when no signer was resolved (rare edge case).
    var isAudi = /audi/i.test(storeName);
    var _resolvedSig = window._leadProResolvedSigner;
    var _personaTitle;
    if (_resolvedSig && _resolvedSig.title) {
      _personaTitle = _resolvedSig.title;
    } else {
      var _sigPersona = window._leadProPersonaOverride || window._leadProResolvedPersona || 'bdc';
      var _personaTitleMap = {
        'bdc':               isAudi ? 'Audi Concierge' : 'Internet Sales Coordinator',
        'internet_director': 'Internet Director',
        'manager':           'Sales Manager',
        'sales':             isAudi ? 'Brand Specialist' : 'Sales Consultant',
        'concierge':         isAudi ? 'Audi Concierge' : 'Luxury Concierge',
      };
      _personaTitle = _personaTitleMap[_sigPersona] || agentTitle || '';
    }
    var storeSigLine;
    if (_personaTitle) {
      storeSigLine = _personaTitle + ' | ' + storeName;
    } else {
      storeSigLine = storeName;
    }

    // Build canonical stacked signature
    // (v9.7.50) Taper signature based on touch count - in a long follow-up flow
    // the same canonical 3-line signature on every SMS gets repetitive.
    // - Touches 1-5: full stacked (Agent / Store-with-title / Phone)
    // - Touches 6-15: drop phone (they have it in the thread by now)
    // - Touches 16+: first name only (the relationship is established)
    //
    // Fresh-lead guard: if the lead is fresh (Day 0-1) but customer has historical
    // noteCount from prior interactions, treat as a fresh thread for signature
    // purposes - the customer hasn't seen our SMS for THIS conversation yet.
    var _ncForSig = (lastScrapedData && lastScrapedData.totalNoteCount) || 0;
    var _ladForSig = (lastScrapedData && lastScrapedData.leadAgeDays) || 0;
    if (_ladForSig <= 1 && _ncForSig > 3) {
      // Fresh lead from repeat customer - reset for signature purposes
      console.log('[Lead Pro] Sig taper: fresh-lead guard active - using full signature despite historical noteCount (' + _ncForSig + ')');
      _ncForSig = 0;
    }
    var canonicalSig = '';
    if (agentFirst)   canonicalSig += '\n' + agentFirst;
    if (_ncForSig < 16) {
      if (storeSigLine) canonicalSig += '\n' + storeSigLine;
      if (_ncForSig < 6 && agentPhone) canonicalSig += '\n' + agentPhone;
    }
    var _sigMode = _ncForSig < 6 ? 'full' : (_ncForSig < 16 ? 'compact' : 'minimal');

    if (!canonicalSig) return sms;

    console.log('[Lead Pro] enforceSmsSig — dealerId:', dealerId, '| storeName:', storeName, '| agent:', agentFirst, '| hasPhone:', !!agentPhone, '| hasStore:', !!storeName, '| hasAgent:', !!agentFirst, '| sigMode:', _sigMode, '| noteCount:', _ncForSig);

    // Always strip and re-append — never trust model's self-generated sig
    var stripped = sms.trimEnd();
    var storeKey = isAudi ? 'audi' : (storeName ? storeName.split(/\s+/)[0] : '');
    var signerFirst = agentFirst;

    // (v9.7.89) BLOCK-ANCHOR STRIP — primary path. Anchor on the agent's first
    // name on its own line near end of message, then remove that line plus up
    // to 4 following lines. Order-independent: doesn't care whether the trailing
    // lines are phone/store/title or in what sequence, doesn't care if the
    // phone is malformed ("337-9205" instead of "337-247-9205"), doesn't care
    // if a title line was inserted between name and store.
    //
    // The Dennie case (v9.7.88): rawSms ended "...May 13.\nKristen\nAudi
    // Lafayette\n337-9205". Old cascade tried to strip phone first, but
    // "337-9205" didn't match the 3-3-4 digit regex. Phone line stayed,
    // anchoring the next strips to the wrong $, so name and store strips
    // didn't match either. Canonical appended on top, double sig.
    //
    // Block-anchor strip avoids this brittleness entirely: find "\nKristen" at
    // end-or-followed-by-up-to-4-lines, strip the whole block.
    if (signerFirst) {
      var sFirstEsc = signerFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var sFullEsc  = agentFull ? agentFull.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
      // Pattern: newline + first-or-full name on its own line + up to 4 following lines + end.
      // "On its own line" means: line starts with the name (possibly preceded by dash/space),
      // and is followed by a newline OR end-of-string (no trailing punctuation on the name line).
      var blockPattern = sFullEsc
        ? '\\n[-\u2013\u2014\\s]*(?:' + sFullEsc + '|' + sFirstEsc + ')[,\\s]*(?:\\n[^\\n]*){0,4}$'
        : '\\n[-\u2013\u2014\\s]*' + sFirstEsc + '[,\\s]*(?:\\n[^\\n]*){0,4}$';
      stripped = stripped.replace(new RegExp(blockPattern, 'i'), '').trimEnd();
    }

    // Safety-net cascade for edge cases the block-anchor didn't catch
    // (e.g. signature only contains store+phone with no agent name).
    stripped = stripped.replace(/\n[^\n]*(?:\(\d{3}\)\s?\d{3}[-.]\d{4}|\d{3}[-.]\d{3}[-.]\d{4})[^\n]*$/, '').trimEnd();
    if (storeKey) stripped = stripped.replace(new RegExp('\\n[^\\n]*' + storeKey + '[^\\n]*$', 'i'), '').trimEnd();
    if (signerFirst) {
      stripped = stripped.replace(new RegExp('\\n' + signerFirst + '\\s*$', 'i'), '').trimEnd();
      stripped = stripped.replace(new RegExp('\\n[-\u2013\u2014\\s]*' + signerFirst + '[,\\s]*$', 'i'), '').trimEnd();
      // (v9.7.84) Also strip inline signoff: space-prefixed name at end of body.
      // Happens after the phone-ask guard strips an intervening sentence and
      // collapses the newline that originally separated body from the model's
      // inline name. Without this, the canonical signature appends ON TOP of
      // the inline name and produces "...work? Kristen\nKristen\n[title]".
      // Require the name to be preceded by sentence-ending punctuation so
      // we don't accidentally strip a name mentioned mid-message (e.g.
      // "Mike said he would call Kristen").
      stripped = stripped.replace(new RegExp('([.!?])\\s+' + signerFirst + '\\s*$', 'i'), '$1').trimEnd();
    }
    if (agentFull && agentFull !== agentFirst) {
      stripped = stripped.replace(new RegExp('\\n' + agentFull.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\s*$', 'i'), '').trimEnd();
    }
    stripped = stripped.replace(/\n[-–—]+\s*$/, '').trimEnd();

    console.log('[Lead Pro] SMS signature enforced — appending canonical stacked signature');
    return stripped + canonicalSig;
  }

  function enforceEmailPhone(email, correctPhone) {
    if (!email) return email;

    // Use the signer already resolved by enforceSmsSig — it has correct name/title/phone
    // for whoever is signing (Director = Gil, BDC = Samantha, Manager = Colby, etc.)
    var signer = window._leadProResolvedSigner || {};
    var agentFull  = signer.name  || (_leadProProfile && _leadProProfile.name)  || '';
    var agentTitle = signer.title || (_leadProProfile && _leadProProfile.title) || '';
    // signer.phone has agent's direct number — store fallback (correctPhone) only if signer has none
    var agentPhone = signer.phone || correctPhone || (_leadProProfile && _leadProProfile.phone) || '';

    // Store name from current lead's dealer config, not cached context
    var _storeName = '';
    var _did = (lastScrapedData && lastScrapedData.dealerId) || '';
    if (_did && window._leadProDealerData) {
      var _ds = (window._leadProDealerData.stores || []).find(function(s) {
        return String(s.crmDealerId) === String(_did) || String(s.id) === String(_did);
      });
      if (_ds) {
        _storeName = _ds.name || '';
        if (!agentPhone && _ds.phone) agentPhone = _ds.phone;
      }
    }
    if (!_storeName) _storeName = (window._leadProResolvedContext && window._leadProResolvedContext.storeName) || (_leadProProfile && _leadProProfile.store) || '';

    if (!agentFull) return email; // nothing to enforce

    // Strip the model's signature block — find last occurrence of agent name near end
    var nameFirst = agentFull.split(' ')[0];
    var nameEsc   = agentFull.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var firstEsc  = nameFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Remove trailing sig: agent name (full or first) + up to 5 following lines.
    // (v9.7.88) Pattern allows the agent name to be preceded by either a newline
    // OR a space — the phone-ask guard's clause-strip can collapse the original
    // double-newline separator between body and signature, leaving the model's
    // signature inlined to the prior sentence ("...visit? Kristen Willis\n..."
    // instead of "...visit?\n\nKristen Willis\n..."). Sentence punctuation
    // ([.!?]) plus single space is required so we don't match a name mention
    // mid-paragraph.
    var stripped = email.trimEnd();
    var sigPat = new RegExp(
      '(?:\\n|(?<=[.!?])\\s)(?:' + nameEsc + '|' + firstEsc + ')(?:\\n[^\\n]*){0,5}$',
      'i'
    );
    stripped = stripped.replace(sigPat, '').trimEnd();

    // Build canonical sig: Full Name / Title / Store / Phone
    var sig = '\n\n' + agentFull;
    if (agentTitle) sig += '\n' + agentTitle;
    if (_storeName)  sig += '\n' + _storeName;
    if (agentPhone)  sig += '\n' + agentPhone;

    return stripped + sig;
  }


  function cleanOutput(raw, isSms) {
      if (!raw) return raw;
      // Diagnostic: log any unusual control / format characters in the raw output.
      // These can render as missing or compressed in the textarea (e.g. zero-width joiners,
      // line separators, paragraph separators) and produce artifacts like "today1I can".
      if (!isSms) {
        var unusual = raw.match(/[\u0000-\u0009\u000B-\u001F\u007F\u00a0\u2000-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/g);
        if (unusual && unusual.length) {
          console.log('[Lead Pro] cleanOutput email — unusual chars detected:',
            unusual.map(function(c){ return 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'); }).join(' '));
        }
      }
      var result = raw
        // Strip zero-width and unusual format characters that render invisibly
        // but break word spacing in clients (zero-width space, joiner, non-joiner,
        // word joiner, BOM, line/paragraph separators, narrow no-break space)
        .replace(/[\u200B-\u200F\u2028\u2029\u202F\u205F\u2060\uFEFF]/g, '')
        .replace(/\u00a0/g, ' ')      // non-breaking space → regular space
        .replace(/\t+/g, ' ')         // tabs become single space (model artifact)
        .replace(/\.{2,}/g, '.')   // double periods
        .replace(/\.\s*\?/g, '?')     // period+question mark
        .replace(/\.\s*!/g, '!')      // period+exclamation
        .replace(/!\s*\./g, '!')      // exclamation+period
        .replace(/\?\s*\./g, '?')     // question+period
        .trim();
      // Fix list-item artifacts where the model dropped the period/space after a list number.
      // Pattern: "<word><digit><uppercase letter>" where the digit is 1-9 and there's no
      // whitespace separator. Example: "today1I can" → "today\n1. I can".
      result = result.replace(/([a-z])(\d{1,2})([A-Z][a-z])/g, '$1\n$2. $3');
      // Collapse runs of multiple spaces within a line — but never touch newlines.
      result = result.split('\n').map(function(line) {
        return line.replace(/ {2,}/g, ' ');
      }).join('\n');
      if (isSms) {
        result = result.replace(/\n{2,}/g, '\n');
      }

      return result.length > 15 ? result : raw;
    }
    var rawSms   = flattenField(parsed.sms,   'sms');
    var rawSubject = parsed.subject ? parsed.subject.trim() : '';
    var rawEmail = flattenField(parsed.email, 'email');
    // (v9.7.58) Strip ALL leading Subject: lines from email body before prepending
    // canonical subject. Models occasionally return "Subject: ..." embedded in the
    // email field itself -- sometimes more than one (e.g. "Subject: Re: prior thread"
    // followed by "Subject: new compose"). Prepending without stripping creates
    // doubled subject lines in the rendered output.
    if (rawEmail) {
      var stripCount = 0;
      while (/^\s*Subject:\s*[^\n]*\n+/i.test(rawEmail) && stripCount < 5) {
        rawEmail = rawEmail.replace(/^\s*Subject:\s*[^\n]*\n+/i, '');
        stripCount++;
      }
      if (stripCount > 0) {
        console.log('[Lead Pro] Email subject hygiene: stripped ' + stripCount + ' embedded Subject: line(s) from email body before prepend');
      }
    }
    // Prepend subject line to email if present; fallback if AI omitted it
    if(rawSubject && rawEmail) {
      rawEmail = 'Subject: ' + rawSubject + '\n\n' + rawEmail;
    } else if(rawEmail && !rawEmail.trim().startsWith('Subject:')) {
      var vName = data.vehicle ? data.vehicle.replace(/^\d{4}\s+/,'').replace(/\s+\(New\)|\s+\(Used\)/i,'').substring(0,40) : '';
      var storeShort = (data.store || '').replace(/VinSolutions Connect \[.*?\]/i,'').trim().split(/\s+/).slice(0,3).join(' ') || 'us';
      var fallbackSubject = vName ? 'Your ' + vName + ' inquiry' : 'Following up from ' + storeShort;
      rawEmail = 'Subject: ' + fallbackSubject + '\n\n' + rawEmail;
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

    // Cancel any pending retry timer
    if (_degradedRetryTimer) { clearTimeout(_degradedRetryTimer); _degradedRetryTimer = null; }

    // (v9.7.86) DIAGNOSTIC: full raw text of model output before any cleanup.
    // Use this to see exactly what the model produced, so when a phone-ask
    // slips through we can determine whether the model wrote it, the guard
    // saw it, the patterns missed it, or the guard never ran. Each line is
    // labeled and uses JSON.stringify so newlines/whitespace are visible.
    try {
      console.log('[LP RAW DIAG] phoneOnFile:',
        !!(lastScrapedData && lastScrapedData.phone &&
           String(lastScrapedData.phone).replace(/\D/g,'').length >= 7),
        '| phone value:', (lastScrapedData && lastScrapedData.phone) || '(empty)');
      console.log('[LP RAW DIAG] rawSms:', JSON.stringify(rawSms || ''));
      console.log('[LP RAW DIAG] rawEmail:', JSON.stringify(rawEmail || ''));
    } catch(e) { console.log('[LP RAW DIAG] error:', e.message); }

    const smsText   = enforceSmsSig(cleanOutput(rawSms, true));
    // Re-derive correct phone for email enforcement using lead data
    // Store phone is fallback only — signer.phone takes priority inside enforceEmailPhone
    var _emailStoreFallback = '';
    var _emailLeadDealerId = (lastScrapedData && lastScrapedData.dealerId) || '';
    if (_emailLeadDealerId && window._leadProDealerData) {
      var _eds = (window._leadProDealerData.stores || []).find(function(s) {
        return String(s.crmDealerId) === String(_emailLeadDealerId) || String(s.id) === String(_emailLeadDealerId);
      });
      if (_eds && _eds.phone) _emailStoreFallback = _eds.phone;
    }
    const emailText = enforceEmailPhone(cleanOutput(rawEmail, false), _emailStoreFallback);

    // Detect degraded response — retry up to 2 times if we got the generic placeholder.
    // The placeholder text comes from the worker's SAFE_FALLBACK_TEXT when all cascade
    // tiers fail; pattern is provider-agnostic since the worker shapes it.
    var isDegradedResponse = rawSms && /pulling everything together|getting your information ready right now/i.test(rawSms)
      && rawSms.length < 150;
    if (isDegradedResponse) {
      _grabRetryCount = (_grabRetryCount || 0) + 1;
      if (_grabRetryCount <= 2) {
        console.log('[Lead Pro] Worker returned safe-fallback placeholder — retrying in 3s (attempt', _grabRetryCount, ')');
        var retryStatusEl = document.getElementById('crm-status') || document.querySelector('.crm-status');
        if (retryStatusEl) {
          retryStatusEl.className = 'crm-status';
          retryStatusEl.textContent = '⟳ Response incomplete — retrying...';
        }
        _degradedRetryTimer = setTimeout(function() { _degradedRetryTimer = null; generateAll(); }, 3000);
      } else {
        console.log('[Lead Pro] Degraded after 2 retries — stopping');
        var retryStatusEl2 = document.getElementById('crm-status') || document.querySelector('.crm-status');
        if (retryStatusEl2) {
          retryStatusEl2.className = 'crm-status error';
          retryStatusEl2.textContent = 'API unavailable — try again in a moment';
        }
        _grabRetryCount = 0;
      }
      return;
    }

    // Good response — reset retry counter
    _grabRetryCount = 0;

    function setOutput(key, text) {
      const f = document.getElementById('output-' + key);
      if (f) {
        f.value = text;
        f.classList.remove('generating');
        if (text) {
          // Fade-in moment for fresh content
          f.classList.remove('just-generated');
          // Force reflow so re-adding the class re-runs the animation
          void f.offsetWidth;
          f.classList.add('just-generated');
          setTimeout(function() { f.classList.remove('just-generated'); }, 320);
          // Hide empty overlay for this pane
          const overlay = document.querySelector('.output-empty-overlay[data-overlay="' + key + '"]');
          if (overlay) overlay.classList.add('hidden');
        }
      }
      if (text) {
        const tabBtn = _tabBtnMap[key];
        if (tabBtn) tabBtn.classList.add('ready-' + key);
      }
    }

    setOutput('sms',   smsText);
    setOutput('email', emailText);

    // v9.7.5 — Save to history (local audit log, last 50)
    if (smsText || emailText) {
      try {
        _lpHistorySave({
          id:            (lastScrapedData && lastScrapedData.autoLeadId) || ('gen_' + Date.now()),
          ts:            Date.now(),
          leadId:        (lastScrapedData && lastScrapedData.autoLeadId) || '',
          customerName:  name || '(no name)',
          vehicle:       vehicle || '',
          persona:       (window._leadProPersonaOverride || window._leadProResolvedPersona || 'bdc'),
          personaIsAuto: !window._leadProPersonaOverride,
          flags:         Array.from(activeFlags || []),
          sms:           smsText || '',
          email:         emailText || '',
          voicemail:     ''
        });
      } catch (histErr) {
        console.warn('[Lead Pro] History save failed:', histErr);
      }
    }

    // Reveal the regenerate-with chip strip now that output exists
    if (smsText || emailText) {
      var regenStrip = document.getElementById('regenStrip');
      if (regenStrip) regenStrip.classList.add('visible');
    }

    // Success flash on the generate button — quick confirmation through motion
    btn.classList.remove('just-succeeded');
    void btn.offsetWidth;
    btn.classList.add('just-succeeded');
    setTimeout(function() { btn.classList.remove('just-succeeded'); }, 1000);

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

// resolveSignerForPersona — hoisted to module level (v9.7.118) so both
// generateAll() and generateVoicemail() can call it. Previously defined
// inside generateAll(), which made it inaccessible to generateVoicemail()
// and caused "resolveSignerForPersona is not defined" on voicemail generation.
function resolveSignerForPersona() {
  var activePersona  = window._leadProPersonaOverride || window._leadProResolvedPersona || 'bdc';
  var leadData       = lastScrapedData || {};
  var profile        = _leadProProfile || {};
  var dealerData     = window._leadProDealerData || { stores: [], assignments: [] };
  function phoneFor(name, store) {
    if (!name) return '';
    var d = lookupPhone(name, store, (leadData && leadData.dealerId));
    if (d) return d;
    if (typeof LEADPRO_DEALER !== 'undefined' && dealerData.assignments.length) {
      var a = dealerData.assignments.find(function(x) { return x.agentId && x.agentId.toLowerCase().includes((name||'').toLowerCase().split(' ')[0]); });
      if (a && a.phone) return a.phone;
    }
    if (profile.name && name.toLowerCase().includes((profile.name||'').toLowerCase().split(' ')[0])) return profile.phone || '';
    return '';
  }
  function titleFor(name, personaId) {
    var _resolvedStoreName = leadData.store || '';
    var _ldId = leadData.dealerId || '';
    if (_ldId && typeof DEALER_ID_MAP !== 'undefined' && DEALER_ID_MAP[_ldId]) {
      _resolvedStoreName = DEALER_ID_MAP[_ldId];
    } else if (_ldId && window._leadProDealerData) {
      var _ms = (window._leadProDealerData.stores || []).find(function(s) {
        return String(s.crmDealerId) === String(_ldId) || String(s.id) === String(_ldId);
      });
      if (_ms && _ms.name) _resolvedStoreName = _ms.name;
    }
    var _isAudiStore = /audi/i.test(_resolvedStoreName);
    var _personaTitles = {
      'internet_director': 'Internet Director',
      'manager':           'Sales Manager',
      'sales':             _isAudiStore ? 'Brand Specialist' : 'Sales Consultant',
      'concierge':         _isAudiStore ? 'Audi Concierge' : 'Luxury Concierge',
      'bdc':               _isAudiStore ? 'Audi Concierge' : 'Internet Sales Coordinator',
    };
    if (personaId && _personaTitles[personaId]) return _personaTitles[personaId];
    if (typeof LEADPRO_DEALER !== 'undefined' && dealerData.stores.length) {
      var st = dealerData.stores.find(function(s) { return String(s.crmDealerId) === String(leadData.dealerId||''); });
      if (st) {
        var a = dealerData.assignments.find(function(x) { return x.storeId === st.id && x.agentId && x.agentId.toLowerCase().includes((name||'').toLowerCase().split(' ')[0]); });
        if (a && a.titleOverride) return a.titleOverride;
      }
    }
    if (typeof LEADPRO_AUTH !== 'undefined') { var p = LEADPRO_AUTH.getPersona(personaId); if (p && p.title) return p.title; }
    return 'Internet Sales Coordinator';
  }
  var profilePersona    = profile.persona || 'bdc';
  var isDirectorProfile = profilePersona === 'internet_director';
  var isManagerProfile  = profilePersona === 'manager';
  var canImpersonate    = isDirectorProfile || isManagerProfile;
  var s = {};

  if (activePersona === 'internet_director' && isDirectorProfile) {
    s.name = profile.name||''; s.firstName = profile.firstName||(profile.name||'').split(' ')[0]; s.title = 'Internet Director';
    s.phone = phoneFor(profile.name, leadData.store) || profile.phone || '';

  } else if (activePersona === 'manager' && isManagerProfile && !window._leadProPersonaOverride) {
    s.name = profile.name||''; s.firstName = profile.firstName||(profile.name||'').split(' ')[0]; s.title = 'Sales Manager';
    s.phone = phoneFor(profile.name, leadData.store) || profile.phone || '';

  } else if (canImpersonate && activePersona === 'manager') {
    var mgr = leadData.manager||leadData.salesManager||'';
    s.name = mgr||profile.name||''; s.firstName = (s.name).split(' ')[0]; s.title = titleFor(s.name,'manager'); s.phone = phoneFor(s.name,leadData.store)||profile.phone||'';

  } else if (canImpersonate && activePersona === 'sales') {
    var rep = leadData.salesRep||'';
    s.name = rep||(leadData.agent||''); s.firstName = (s.name).split(' ')[0]; s.title = titleFor(s.name,'sales'); s.phone = phoneFor(s.name,leadData.store)||profile.phone||'';

  } else if (canImpersonate && activePersona === 'bdc') {
    var bd2 = leadData.agent||'';
    s.name = bd2; s.firstName = bd2.split(' ')[0]||''; s.title = titleFor(bd2,'bdc');
    s.phone = phoneFor(bd2,leadData.store)||leadData.agentPhone||(window._leadProResolvedContext&&window._leadProResolvedContext.phone)||profile.phone||'';

  } else {
    var bd = leadData.agent||'';
    s.name = bd; s.firstName = bd.split(' ')[0]||''; s.title = titleFor(bd, profilePersona);
    s.phone = phoneFor(bd,leadData.store)||leadData.agentPhone||(window._leadProResolvedContext&&window._leadProResolvedContext.phone)||profile.phone||'';
  }
  return s;
}

async function generateVoicemail() {
  if (!lastScrapedData) { showError('Grab a lead first.'); return; }

  // Lead ID guard — same protection as generateAll
  if (lastScrapedData.autoLeadId && window._activeLeadId
      && String(lastScrapedData.autoLeadId) !== String(window._activeLeadId)) {
    if (_domCrmStatus) {
      _domCrmStatus.className = 'crm-status error';
      _domCrmStatus.textContent = '⚠ Lead changed — click GRAB LEAD again to refresh data for this lead';
      setTimeout(() => { _domCrmStatus.className = 'crm-status'; _domCrmStatus.textContent = ''; }, 8000);
    }
    console.warn('[Lead Pro] Voicemail generation blocked — stale scraped data:', lastScrapedData.autoLeadId, '!= active:', window._activeLeadId);
    return;
  }

  const vmBtn = document.getElementById('btnVoicemail');
  if (vmBtn) { vmBtn.disabled = true; vmBtn.textContent = 'Generating…'; }

  // Clear voicemail field
  const vmField = document.getElementById('output-vm');
  if (vmField) { vmField.value = ''; vmField.classList.add('generating'); }
  const vmTab = _tabBtnMap['vm'];
  if (vmTab) vmTab.classList.remove('ready-vm');

  try {
    // Build a lightweight voicemail-only payload
    const sc = classifyScenario(lastScrapedData);
    // (v9.7.88) Resolve signer before prompt build — voicemail uses the
    // resolved signer's phone in the prompt header (same fix as SMS path).
    window._leadProResolvedSigner = resolveSignerForPersona();
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

    if (vmField) {
      vmField.value = vmText;
      vmField.classList.remove('generating');
      if (vmText) {
        vmField.classList.remove('just-generated');
        void vmField.offsetWidth;
        vmField.classList.add('just-generated');
        setTimeout(function() { vmField.classList.remove('just-generated'); }, 320);
        const vmOverlay = document.querySelector('.output-empty-overlay[data-overlay="vm"]');
        if (vmOverlay) vmOverlay.classList.add('hidden');

        // v9.7.5 — Update most recent history entry with VM, or create new if no recent match
        try {
          var leadIdNow = (lastScrapedData && lastScrapedData.autoLeadId) || '';
          chrome.storage.local.get(['leadpro_history'], function(r) {
            var list = (r && r.leadpro_history) || [];
            var fiveMinAgo = Date.now() - (5 * 60 * 1000);
            if (list.length && list[0].leadId === leadIdNow && list[0].ts > fiveMinAgo) {
              // Append VM to the existing entry
              list[0].voicemail = vmText;
              chrome.storage.local.set({ leadpro_history: list });
            } else {
              // No matching recent entry — create a VM-only entry
              _lpHistorySave({
                id:            leadIdNow || ('vm_' + Date.now()),
                ts:            Date.now(),
                leadId:        leadIdNow,
                customerName:  (lastScrapedData && lastScrapedData.name) || '(no name)',
                vehicle:       (lastScrapedData && lastScrapedData.vehicle) || '',
                persona:       (window._leadProPersonaOverride || window._leadProResolvedPersona || 'bdc'),
                personaIsAuto: !window._leadProPersonaOverride,
                flags:         Array.from(activeFlags || []),
                sms:           '',
                email:         '',
                voicemail:     vmText
              });
            }
          });
        } catch (vmHistErr) {
          console.warn('[Lead Pro] VM history save failed:', vmHistErr);
        }
      }
    }
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
  _domWordCount.textContent = '—';
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


// Expose Worker base URL for registry sync
(function() {
  if (typeof getEndpoint === 'function') {
    var ep = getEndpoint();
    if (ep && ep.url) window._leadProWorkerBase = ep.url.replace(/\/generate$/, '').replace(/\/$/, '');
  }
  if (!window._leadProWorkerBase && typeof PROXY_URL !== 'undefined') {
    window._leadProWorkerBase = PROXY_URL.replace(/\/generate$/, '').replace(/\/$/, '');
  }
})();

// ─── Commercial Boot ─────────────────────────────────────────────────────────
let _leadProProfile = null;
window._leadProSourceRegistry = null;
window._leadProDealerData = { group: null, stores: [], assignments: [] };
window._leadProPersonaOverride = null;
window._leadProResolvedPersona = null;
window._leadProResolvedContext = null;
window._leadProResolvedSigner  = null;

(function initDealerConfig() {
  if (typeof LEADPRO_DEALER === 'undefined') return;
  LEADPRO_DEALER.loadAll(function(data) {
    window._leadProDealerData = data;
    console.log('[Lead Pro] Dealer config loaded —', data.stores.length, 'stores,', data.assignments.length, 'assignments');
    // Inject store-level phone numbers from dealer config into STORE_PHONE_FALLBACK
    (data.stores || []).forEach(function(s) {
      if (s.crmDealerId && s.phone) {
        STORE_PHONE_FALLBACK[String(s.crmDealerId)] = s.phone;
      }
    });
    // Re-resolve persona context now that stores are loaded — fixes timing race
    // where updatePersonaBar ran before dealer config was available
    if (lastScrapedData && typeof updatePersonaBar === 'function') {
      updatePersonaBar(lastScrapedData);
    }
  });
})();

(function initRegistry() {
  if (typeof LEADPRO_REGISTRY === 'undefined') return;
  LEADPRO_REGISTRY.loadRegistry(function(registry) {
    window._leadProSourceRegistry = registry;
    var hasMappings = registry && Object.keys(registry.mappings || {}).length > 0;
    if (!hasMappings) console.log('[Lead Pro] No source registry found — onboarding will be shown after login');
  });
})();

function updateProfileBadge(profile) {
  var btn = document.getElementById('btnProfile');
  if (!btn || !profile) return;
  var persona = (typeof LEADPRO_AUTH !== 'undefined') ? LEADPRO_AUTH.getPersona(profile.persona) : null;
  btn.title = profile.name + ' · ' + profile.title + ' · ' + profile.store;
  btn.style.borderColor = persona ? persona.color : 'rgba(245,200,66,0.3)';
  btn.style.color = persona ? persona.color : '#f5c842';
  btn.textContent = (profile.firstName || '?').charAt(0).toUpperCase();
  btn.style.fontWeight = '900';
  btn.style.fontSize = '12px';
}

function showLoginScreen(onLogin) {
  var overlay = document.getElementById('lp-auth-overlay');
  if (!overlay) { if (onLogin) onLogin(null); return; }
  overlay.style.display = 'block';
  LEADPRO_AUTH.buildLoginUI(overlay, function(savedProfile) {
    // After profile saved — check if stores are configured and prompt for assignments
    var dealerData = window._leadProDealerData || { stores: [], assignments: [] };
    var stores = dealerData.stores || [];
    if (stores.length > 0 && typeof LEADPRO_SETUP !== 'undefined') {
      // Show store assignment step inline in the overlay before dismissing
      overlay.innerHTML = '';
      var stepWrap = document.createElement('div');
      stepWrap.style.cssText = 'padding:20px; display:flex; flex-direction:column; gap:12px; background:#0d1625; min-height:100%;';
      stepWrap.innerHTML = '<div style="font-size:13px; font-weight:700; color:#e8f0ff;">One more step</div>' +
        '<div style="font-size:10px; color:#7a90b8; line-height:1.5;">Set your direct phone number for each store you work. This ensures your signature is correct on every lead.</div>';
      overlay.appendChild(stepWrap);
      LEADPRO_DEALER.loadAll(function(data) {
        LEADPRO_SETUP.buildAssignmentUI(stepWrap, savedProfile, data.stores, data.assignments, function(allAssignments) {
          overlay.style.display = 'none';
          _leadProProfile = savedProfile;
          updateProfileBadge(savedProfile);
          if (onLogin) onLogin(savedProfile);
        });
        // Add skip option
        var skipBtn = document.createElement('button');
        skipBtn.textContent = 'Skip for now →';
        skipBtn.style.cssText = 'background:none; border:none; color:#3d5070; font-size:10px; cursor:pointer; text-align:center; padding:4px;';
        skipBtn.addEventListener('click', function() {
          overlay.style.display = 'none';
          _leadProProfile = savedProfile;
          updateProfileBadge(savedProfile);
          if (onLogin) onLogin(savedProfile);
        });
        stepWrap.appendChild(skipBtn);
      });
    } else {
      overlay.style.display = 'none';
      _leadProProfile = savedProfile;
      updateProfileBadge(savedProfile);
      if (onLogin) onLogin(savedProfile);
    }
  });
}

function updatePersonaBar(leadData) {
  var bar = document.getElementById('lp-persona-bar');
  if (!bar || typeof LEADPRO_AUTH === 'undefined') return;
  var sc = classifyScenario(leadData);
  var autoPersona = sc.resolvedPersona || ((_leadProProfile && _leadProProfile.persona) || 'bdc');
  var dealerData = window._leadProDealerData || { stores: [], assignments: [] };
  var dealerId   = leadData.dealerId || leadData.storeId || '';
  var resolved   = (typeof LEADPRO_DEALER !== 'undefined' && dealerData.stores.length > 0)
    ? LEADPRO_DEALER.resolveContext(_leadProProfile, dealerId, dealerData.stores, dealerData.assignments, autoPersona)
    : { phone: (_leadProProfile||{}).phone||'', title: (_leadProProfile||{}).title||'', persona: autoPersona, storeName: (_leadProProfile||{}).store||'', resolvedBy: 'profile_fallback' };
  window._leadProResolvedContext = resolved;
  window._leadProPersonaOverride = null;
  var resolvedId = resolved.persona || autoPersona;
  // AUTO means "the system chose for me" — that includes profile default, store lock,
  // auto-escalation, and profile fallback. Only an active manual override flips the
  // bar to the Override visual state.
  var isAuto     = !window._leadProPersonaOverride;
  window._leadProResolvedPersona = resolvedId;
  window._leadProResolvedSigner  = null;
  var pDef        = LEADPRO_AUTH.getPersona(resolvedId);
  var allPersonas = LEADPRO_AUTH.getAllPersonas();
  var indicator = document.getElementById('lp-persona-indicator');
  var labelEl   = document.getElementById('lp-persona-label');
  var badge     = document.getElementById('lp-persona-auto-badge');
  var objEl     = document.getElementById('lp-persona-objective');
  if (indicator) indicator.style.background = pDef.color;
  if (labelEl)   { labelEl.textContent = pDef.label; labelEl.style.color = pDef.color; }
  if (badge)     badge.style.display = isAuto ? 'inline-block' : 'none';
  if (objEl)     objEl.textContent = pDef.objective || '';
  // v9.7.3 polish — visual distinction between AUTO and Override + ambient glow
  bar.classList.remove('persona-state-auto', 'persona-state-override',
                       'glow-bdc', 'glow-sales', 'glow-manager', 'glow-director', 'glow-concierge');
  bar.classList.add(isAuto ? 'persona-state-auto' : 'persona-state-override');
  if (resolvedId === 'bdc')              bar.classList.add('glow-bdc');
  else if (resolvedId === 'sales')       bar.classList.add('glow-sales');
  else if (resolvedId === 'manager')     bar.classList.add('glow-manager');
  else if (resolvedId === 'internet_director') bar.classList.add('glow-director');
  else if (resolvedId === 'concierge')   bar.classList.add('glow-concierge');
  var grid = document.getElementById('lp-persona-override-grid');
  if (grid) {
    grid.innerHTML = '';
    // Hide Concierge from manual override picker unless we're at a luxury store where
    // it's already the auto-selected persona. Concierge fires automatically for Audi
    // (and any future BMW/Mercedes/Lexus/Genesis/Cadillac/Porsche/Volvo store via
    // dealer-config personaLock) — surfacing it as a manual choice at non-luxury stores
    // creates confusion since it's never the right pick there.
    var _isLuxuryActive = resolvedId === 'concierge';
    Object.values(allPersonas).forEach(function(p) {
      if (p.id === 'concierge' && !_isLuxuryActive) return;
      var isActive = p.id === resolvedId;
      var tile = document.createElement('div');
      tile.dataset.pid = p.id;
      tile.style.cssText = 'background:' + (isActive ? 'rgba(0,210,150,0.1)' : '#131f33') + ';border:1px solid ' + (isActive ? p.color : 'rgba(0,210,150,0.1)') + ';border-radius:5px;padding:5px 6px;cursor:pointer;transition:all 0.12s;text-align:center;';
      tile.innerHTML = '<div style="font-size:9px;font-weight:700;color:' + p.color + ';">' + p.label + '</div><div style="font-size:8px;color:#3d5070;margin-top:1px;line-height:1.2;">' + (p.group || '') + '</div>';
      tile.addEventListener('click', function() {
        window._leadProPersonaOverride = p.id;
        var oDef = LEADPRO_AUTH.getPersona(p.id);
        if (indicator) indicator.style.background = oDef.color;
        if (labelEl)   { labelEl.textContent = oDef.label; labelEl.style.color = oDef.color; }
        if (badge)     badge.style.display = 'none';
        if (objEl)     objEl.textContent = '⚡ Override — ' + (oDef.objective || '');
        // Switch bar to override visual state and re-glow to picked persona
        bar.classList.remove('persona-state-auto', 'glow-bdc', 'glow-sales', 'glow-manager', 'glow-director', 'glow-concierge');
        bar.classList.add('persona-state-override');
        if (p.id === 'bdc')                     bar.classList.add('glow-bdc');
        else if (p.id === 'sales')              bar.classList.add('glow-sales');
        else if (p.id === 'manager')            bar.classList.add('glow-manager');
        else if (p.id === 'internet_director')  bar.classList.add('glow-director');
        else if (p.id === 'concierge')          bar.classList.add('glow-concierge');
        grid.querySelectorAll('[data-pid]').forEach(function(t) {
          var tDef = LEADPRO_AUTH.getPersona(t.dataset.pid);
          t.style.borderColor = t.dataset.pid === p.id ? tDef.color : 'rgba(0,210,150,0.1)';
          t.style.background  = t.dataset.pid === p.id ? 'rgba(0,210,150,0.08)' : '#131f33';
        });
        var panel = document.getElementById('lp-persona-override-panel');
        if (panel) panel.style.display = 'none';
      });
      grid.appendChild(tile);
    });
  }
  var overrideBtn = document.getElementById('lp-persona-override-btn');
  var panel       = document.getElementById('lp-persona-override-panel');
  if (overrideBtn && panel) {
    var fresh = overrideBtn.cloneNode(true);
    overrideBtn.parentNode.replaceChild(fresh, overrideBtn);
    fresh.addEventListener('click', function() {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
  }
  var resetBtn = document.getElementById('lp-persona-reset-btn');
  if (resetBtn) {
    var freshR = resetBtn.cloneNode(true);
    resetBtn.parentNode.replaceChild(freshR, resetBtn);
    freshR.addEventListener('click', function() {
      window._leadProPersonaOverride = null;
      if (indicator) indicator.style.background = pDef.color;
      if (labelEl)   { labelEl.textContent = pDef.label; labelEl.style.color = pDef.color; }
      if (badge)     badge.style.display = isAuto ? 'inline-block' : 'none';
      if (objEl)     objEl.textContent = pDef.objective || '';
      // Restore auto visual state and original-resolved glow
      bar.classList.remove('persona-state-override', 'glow-bdc', 'glow-sales', 'glow-manager', 'glow-director', 'glow-concierge');
      bar.classList.add(isAuto ? 'persona-state-auto' : 'persona-state-override');
      if (resolvedId === 'bdc')                     bar.classList.add('glow-bdc');
      else if (resolvedId === 'sales')              bar.classList.add('glow-sales');
      else if (resolvedId === 'manager')            bar.classList.add('glow-manager');
      else if (resolvedId === 'internet_director')  bar.classList.add('glow-director');
      else if (resolvedId === 'concierge')          bar.classList.add('glow-concierge');
      var p2 = document.getElementById('lp-persona-override-panel');
      if (p2) p2.style.display = 'none';
      if (grid) {
        grid.querySelectorAll('[data-pid]').forEach(function(t) {
          var tDef = LEADPRO_AUTH.getPersona(t.dataset.pid);
          t.style.borderColor = t.dataset.pid === resolvedId ? tDef.color : 'rgba(0,210,150,0.1)';
          t.style.background  = t.dataset.pid === resolvedId ? 'rgba(0,210,150,0.1)' : '#131f33';
        });
      }
    });
  }
  bar.style.display = 'block';
}

(function initAuth() {
  if (typeof LEADPRO_AUTH === 'undefined') return;
  LEADPRO_AUTH.loadProfile(function(profile, licenseKey) {
    function checkAndShowOnboarding(afterCb) {
      if (typeof LEADPRO_ONBOARDING === 'undefined' || typeof LEADPRO_REGISTRY === 'undefined') { if (afterCb) afterCb(); return; }
      LEADPRO_REGISTRY.loadRegistry(function(registry) {
        window._leadProSourceRegistry = registry;
        if (typeof LEADPRO_DEALER !== 'undefined') { LEADPRO_DEALER.loadAll(function(data) { window._leadProDealerData = data; }); }
        // Lead source mapping is pre-configured at the dealer level — agents never go through onboarding.
        // Always skip the onboarding screen regardless of registry state.
        if (afterCb) afterCb(); return;
      });
    }
    if (!profile) {
      showLoginScreen(function() { checkAndShowOnboarding(null); });
    } else {
      _leadProProfile = profile; window._leadProProfile = profile;
      updateProfileBadge(profile);
      checkAndShowOnboarding(null);
    }
    // Wire profile panel
    var profileBtn    = document.getElementById('btnProfile');
    var profilePanel  = document.getElementById('lp-profile-panel');
    var profileClose  = document.getElementById('lp-profile-close');
    var profileContent = document.getElementById('lp-profile-content');
    if (profileBtn && profilePanel) {
      profileBtn.addEventListener('click', function() {
        if (!_leadProProfile) { showLoginScreen(null); return; }
        profilePanel.style.display = 'block';
        LEADPRO_AUTH.buildProfileUI(profileContent, _leadProProfile,
          function(updated) {
            _leadProProfile = updated; window._leadProProfile = updated;
            updateProfileBadge(updated);
            var af = document.getElementById('agentName');
            if (af) af.value = updated.name;
          },
          function() {
            _leadProProfile = null; window._leadProProfile = null;
            profilePanel.style.display = 'none';
            showLoginScreen(null);
          }
        );
        // Director-only: Push Registry to Worker button
        var isDir = _leadProProfile && _leadProProfile.persona === 'internet_director';
        var existingPushBtn = profileContent.querySelector('#lp-push-registry-btn');
        if (isDir && !existingPushBtn) {
          var pushWrap = document.createElement('div');
          pushWrap.style.cssText = 'margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08);';
          var pushBtn = document.createElement('button');
          pushBtn.id = 'lp-push-registry-btn';
          pushBtn.textContent = '⬆ Push Registry to Worker';
          pushBtn.style.cssText = 'width:100%; background:#1B4F8A; color:#fff; border:none; border-radius:4px; padding:8px 12px; font-size:11px; font-weight:700; cursor:pointer; letter-spacing:0.5px;';
          var pushStatus = document.createElement('div');
          pushStatus.style.cssText = 'font-size:10px; margin-top:6px; color:#7a90b8; text-align:center; min-height:14px;';
          pushBtn.addEventListener('click', function() {
            pushBtn.disabled = true;
            pushBtn.textContent = 'Pushing...';
            pushStatus.textContent = '';
            var STORAGE_KEY = 'leadpro_source_registry';
            chrome.storage.sync.get([STORAGE_KEY, 'leadpro_license', 'lp_profile'], function(result) {
              var registry = result[STORAGE_KEY];
              var licenseKey = result['leadpro_license'] || '';
              var prof = {}; try { prof = JSON.parse(result['lp_profile'] || '{}'); } catch(e) {}
              var DEALER_MAP = { '6189':'Community Toyota Baytown','6190':'Community Kia Baytown','6191':'Community Honda Baytown','24399':'Community Honda Lafayette','21135':'Audi Lafayette' };
              var storeName = (prof.store || '').toLowerCase();
              var dealerId = '';
              for (var did in DEALER_MAP) { if (DEALER_MAP[did].toLowerCase().includes(storeName.substring(0,8))) { dealerId = did; break; } }
              if (!registry || !Object.keys(registry.mappings || {}).length) {
                pushBtn.textContent = '⬆ Push Registry to Worker'; pushBtn.disabled = false;
                pushStatus.style.color = '#e05'; pushStatus.textContent = '❌ No registry found in storage.'; return;
              }
              if (!licenseKey) {
                pushBtn.textContent = '⬆ Push Registry to Worker'; pushBtn.disabled = false;
                pushStatus.style.color = '#e05'; pushStatus.textContent = '❌ No license key found.'; return;
              }
              if (!dealerId) {
                pushBtn.textContent = '⬆ Push Registry to Worker'; pushBtn.disabled = false;
                pushStatus.style.color = '#e05'; pushStatus.textContent = '❌ Could not detect dealer ID from store: "' + prof.store + '"'; return;
              }
              var workerBase = (typeof LEADPRO_PROXY_URL !== 'undefined') ? LEADPRO_PROXY_URL.replace(/\/$/, '') : 'https://leadpro-proxy.gilsguzman.workers.dev';
              fetch(workerBase + '/registry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey: licenseKey, dealerId: dealerId, registry: registry })
              }).then(function(r) { return r.json(); }).then(function(res) {
                pushBtn.textContent = '⬆ Push Registry to Worker'; pushBtn.disabled = false;
                if (res.ok) {
                  pushStatus.style.color = '#1E6B3C';
                  pushStatus.textContent = '✅ Pushed ' + Object.keys(registry.mappings).length + ' mappings to Worker.';
                } else {
                  pushStatus.style.color = '#e05';
                  pushStatus.textContent = '❌ Worker error: ' + (res.error || 'unknown');
                }
              }).catch(function(err) {
                pushBtn.textContent = '⬆ Push Registry to Worker'; pushBtn.disabled = false;
                pushStatus.style.color = '#e05';
                pushStatus.textContent = '❌ Network error: ' + err.message;
              });
            });
          });
          pushWrap.appendChild(pushBtn);
          pushWrap.appendChild(pushStatus);
          profileContent.appendChild(pushWrap);

          // ── Export / Import Settings (Director-only) ──────────────────
          // Belt-and-suspenders backup before Chrome Store reinstall.
          // Captures both chrome.storage.local and chrome.storage.sync into
          // one timestamped JSON, and restores from the same format.
          var backupWrap = document.createElement('div');
          backupWrap.style.cssText = 'margin-top:10px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.08); display:flex; gap:8px;';

          var exportBtn = document.createElement('button');
          exportBtn.id = 'lp-export-settings-btn';
          exportBtn.textContent = '⬇ Export Settings';
          exportBtn.title = 'Download a complete backup of your Lead Pro settings, dealer config, lead source mappings, and profile.';
          exportBtn.style.cssText = 'flex:1; background:#2A6B3C; color:#fff; border:none; border-radius:4px; padding:8px 10px; font-size:11px; font-weight:700; cursor:pointer; letter-spacing:0.5px;';

          var importBtn = document.createElement('button');
          importBtn.id = 'lp-import-settings-btn';
          importBtn.textContent = '⬆ Import Settings';
          importBtn.title = 'Restore Lead Pro settings from a previously exported backup file. This will overwrite current settings.';
          importBtn.style.cssText = 'flex:1; background:#5A4B1F; color:#fff; border:none; border-radius:4px; padding:8px 10px; font-size:11px; font-weight:700; cursor:pointer; letter-spacing:0.5px;';

          var backupStatus = document.createElement('div');
          backupStatus.style.cssText = 'font-size:10px; margin-top:6px; color:#7a90b8; text-align:center; min-height:14px;';

          // Export handler
          exportBtn.addEventListener('click', function() {
            exportBtn.disabled = true;
            importBtn.disabled = true;
            exportBtn.textContent = 'Exporting...';
            backupStatus.textContent = '';
            try {
              chrome.storage.local.get(null, function(localData) {
                chrome.storage.sync.get(null, function(syncData) {
                  try {
                    var manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : { version: 'unknown' };
                    var payload = {
                      _format: 'leadpro-settings-backup',
                      _version: 1,
                      _exportedAt: new Date().toISOString(),
                      _extensionVersion: manifest.version_name || manifest.version || 'unknown',
                      _exportedBy: (_leadProProfile && _leadProProfile.name) || 'unknown',
                      local: localData || {},
                      sync: syncData || {}
                    };
                    var localKeyCount = Object.keys(payload.local).length;
                    var syncKeyCount = Object.keys(payload.sync).length;
                    var json = JSON.stringify(payload, null, 2);
                    var blob = new Blob([json], { type: 'application/json' });
                    var url = URL.createObjectURL(blob);
                    var ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').substring(0, 19);
                    var safeName = ((_leadProProfile && _leadProProfile.name) || 'leadpro').replace(/[^a-zA-Z0-9_-]/g, '_');
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = 'leadpro_backup_' + safeName + '_' + ts + '.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
                    backupStatus.style.color = '#2A6B3C';
                    backupStatus.textContent = '✅ Exported ' + localKeyCount + ' local + ' + syncKeyCount + ' sync keys.';
                  } catch (innerErr) {
                    backupStatus.style.color = '#e05';
                    backupStatus.textContent = '❌ Export failed: ' + (innerErr.message || 'unknown error');
                  }
                  exportBtn.textContent = '⬇ Export Settings';
                  exportBtn.disabled = false;
                  importBtn.disabled = false;
                });
              });
            } catch (err) {
              backupStatus.style.color = '#e05';
              backupStatus.textContent = '❌ Export failed: ' + (err.message || 'unknown error');
              exportBtn.textContent = '⬇ Export Settings';
              exportBtn.disabled = false;
              importBtn.disabled = false;
            }
          });

          // Import handler
          importBtn.addEventListener('click', function() {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.style.display = 'none';
            input.addEventListener('change', function(e) {
              var file = e.target.files && e.target.files[0];
              if (!file) return;
              importBtn.disabled = true;
              exportBtn.disabled = true;
              importBtn.textContent = 'Importing...';
              backupStatus.textContent = '';
              var reader = new FileReader();
              reader.onload = function(ev) {
                try {
                  var payload = JSON.parse(ev.target.result);
                  if (!payload || payload._format !== 'leadpro-settings-backup') {
                    backupStatus.style.color = '#e05';
                    backupStatus.textContent = '❌ Not a valid Lead Pro backup file.';
                    importBtn.textContent = '⬆ Import Settings';
                    importBtn.disabled = false;
                    exportBtn.disabled = false;
                    return;
                  }
                  var localCount = Object.keys(payload.local || {}).length;
                  var syncCount = Object.keys(payload.sync || {}).length;
                  var confirmMsg = 'Restore ' + localCount + ' local + ' + syncCount + ' sync settings from backup?\n\n' +
                                   'Exported: ' + (payload._exportedAt || 'unknown date') + '\n' +
                                   'By: ' + (payload._exportedBy || 'unknown') + '\n' +
                                   'From version: ' + (payload._extensionVersion || 'unknown') + '\n\n' +
                                   'This will OVERWRITE your current settings. Continue?';
                  if (!confirm(confirmMsg)) {
                    backupStatus.style.color = '#7a90b8';
                    backupStatus.textContent = 'Import canceled.';
                    importBtn.textContent = '⬆ Import Settings';
                    importBtn.disabled = false;
                    exportBtn.disabled = false;
                    return;
                  }
                  // Restore both storages
                  chrome.storage.local.clear(function() {
                    chrome.storage.local.set(payload.local || {}, function() {
                      chrome.storage.sync.clear(function() {
                        chrome.storage.sync.set(payload.sync || {}, function() {
                          backupStatus.style.color = '#2A6B3C';
                          backupStatus.textContent = '✅ Restored ' + localCount + '+' + syncCount + ' keys. Reloading...';
                          importBtn.textContent = '⬆ Import Settings';
                          setTimeout(function() {
                            try { window.location.reload(); } catch(e) {}
                          }, 1500);
                        });
                      });
                    });
                  });
                } catch (parseErr) {
                  backupStatus.style.color = '#e05';
                  backupStatus.textContent = '❌ Could not parse backup file: ' + (parseErr.message || 'invalid JSON');
                  importBtn.textContent = '⬆ Import Settings';
                  importBtn.disabled = false;
                  exportBtn.disabled = false;
                }
              };
              reader.onerror = function() {
                backupStatus.style.color = '#e05';
                backupStatus.textContent = '❌ Could not read file.';
                importBtn.textContent = '⬆ Import Settings';
                importBtn.disabled = false;
                exportBtn.disabled = false;
              };
              reader.readAsText(file);
            });
            document.body.appendChild(input);
            input.click();
            setTimeout(function() { try { document.body.removeChild(input); } catch(e) {} }, 100);
          });

          backupWrap.appendChild(exportBtn);
          backupWrap.appendChild(importBtn);
          profileContent.appendChild(backupWrap);
          profileContent.appendChild(backupStatus);
        }
      });
    }
    if (profileClose && profilePanel) {
      profileClose.addEventListener('click', function() { profilePanel.style.display = 'none'; });
    }
    // Wire source settings
    var srcBtn = document.getElementById('lp-source-settings-btn');
    var srcContent = document.getElementById('lp-source-settings-content');
    if (srcBtn && srcContent) {
      srcBtn.addEventListener('click', function() {
        var isOpen = srcContent.style.display !== 'none';
        srcContent.style.display = isOpen ? 'none' : 'block';
        if (!isOpen && typeof LEADPRO_ONBOARDING !== 'undefined') {
          LEADPRO_REGISTRY.loadRegistry(function(registry) {
            LEADPRO_ONBOARDING.buildSourceSettingsUI(srcContent, registry, function(updated) {
              window._leadProSourceRegistry = updated;
            });
          });
        }
      });
    }
    // Wire store assignments
    var asgnBtn = document.getElementById('lp-store-assignments-btn');
    var asgnContent = document.getElementById('lp-store-assignments-content');
    if (asgnBtn && asgnContent) {
      asgnBtn.addEventListener('click', function() {
        var isOpen = asgnContent.style.display !== 'none';
        asgnContent.style.display = isOpen ? 'none' : 'block';
        if (!isOpen && _leadProProfile && typeof LEADPRO_DEALER !== 'undefined' && typeof LEADPRO_SETUP !== 'undefined') {
          LEADPRO_DEALER.loadAll(function(data) {
            window._leadProDealerData = data;
            LEADPRO_SETUP.buildAssignmentUI(asgnContent, _leadProProfile, data.stores, data.assignments, function() {
              LEADPRO_DEALER.loadAll(function(fresh) { window._leadProDealerData = fresh; });
            });
          });
        }
      });
    }
    // Wire dealer setup
    var dsSection = document.getElementById('lp-dealer-setup-section');
    var dsBtn     = document.getElementById('lp-dealer-setup-btn');
    var dsContent = document.getElementById('lp-dealer-setup-content');
    if (typeof LEADPRO_DEALER !== 'undefined') {
      LEADPRO_DEALER.loadStores(function(stores) {
        // Always show dealer setup — needed to add/edit stores after initial config
        if (dsSection) dsSection.style.display = 'block';
        if (asgnBtn) asgnBtn.parentElement.style.display = stores.length > 0 ? 'block' : 'none';
      });
    }
    if (dsBtn && dsContent) {
      dsBtn.addEventListener('click', function() {
        var isOpen = dsContent.style.display !== 'none';
        dsContent.style.display = isOpen ? 'none' : 'block';
        if (!isOpen && typeof LEADPRO_SETUP !== 'undefined') {
          LEADPRO_SETUP.buildGroupSetupUI(dsContent, function(group, stores) {
            LEADPRO_DEALER.loadAll(function(data) { window._leadProDealerData = data; });
            dsContent.style.display = 'none';
            // Keep dsSection visible so user can return to edit stores
            if (asgnBtn) asgnBtn.parentElement.style.display = 'block';
          });
        }
      });
    }
  });
})();
// ─── End Commercial Boot ──────────────────────────────────────────────────────

document.getElementById('btnGrab').addEventListener('click', function() { _grabRetryCount = 0; grabLead(); });
var _btnGenerate = document.getElementById('btnGenerate');
_btnGenerate.addEventListener('click', function() {
  // Manual Generate clears any stale regen directive — fresh start
  window._lpRegenDirective = '';
  generateAll();
});
const btnVm = document.getElementById('btnVoicemail');
if (btnVm) btnVm.addEventListener('click', generateVoicemail);

// ── Regenerate-with chip handlers (v9.7.5) ──
// Each chip sets a tone-adjustment directive, then triggers Generate again.
// The directive is consumed by buildUserPrompt and injected into the prompt.
var _regenDirectives = {
  'shorter':       'Shorten the message to roughly 60-70% of its previous length while preserving the core ask. Cut filler, not substance. The goal is concision, not omission of important context.',
  'warmer':        'Warm the tone. Lead with relationship language, acknowledge the human, and soften any hard-edged phrasing. Sound like a person who is glad to hear from them, not a system processing their inquiry.',
  'direct':        'Make the tone more direct. Cut hedge words ("just wanted to", "I was thinking"), get to the point in the first sentence, name the actual ask plainly. The customer should feel respected, not dodged around.',
  'lead-trade':    'Restructure the message so the trade-in conversation is the leading element, not a secondary note. The visit becomes about getting a real number on their trade — that\'s the highest-value reason for them to come in.',
  'lead-distance': 'Make the distance reality the leading element. Acknowledge the trip directly, commit specifically to what will be ready when they arrive, and make the trip feel worth their time.',
  'lead-credit':   'Soften the credit framing. No approval language, no qualification language. Use options-based language. The visit is about exploring what fits, not vetting them. Reassure without being patronizing.',
  'no-appt':       'Remove the appointment ask entirely. Replace the close with a question that invites the next reply rather than a commitment. Lead Pro should sound like it\'s opening a conversation, not closing one.',
  'add-urgency':   'Add a justified, real urgency element — vehicle activity, schedule constraint, market context. NEVER fabricate urgency. If you cannot find a real reason, use scarcity of the agent\'s availability ("I only have a couple slots open this week") rather than inventing inventory pressure.'
};
document.querySelectorAll('.regen-chip').forEach(function(chip) {
  chip.addEventListener('click', function() {
    if (!lastScrapedData) {
      alert('Grab a lead first.');
      return;
    }
    var key = chip.dataset.regen;
    var directive = _regenDirectives[key];
    if (!directive) return;
    window._lpRegenDirective = directive;
    // Visual feedback — dim the chip while regenerating
    chip.classList.add('regen-loading');
    document.querySelectorAll('.regen-chip').forEach(function(c) { c.classList.add('regen-loading'); });
    // Trigger the same Generate flow
    generateAll().finally(function() {
      // Re-enable chips + clear the directive (one-shot per click)
      document.querySelectorAll('.regen-chip').forEach(function(c) { c.classList.remove('regen-loading'); });
      window._lpRegenDirective = '';
    });
  });
});

// (v9.7.46 architecture) Removed LEADPRO_DOM_UPDATED listener and
// auto-populate-on-open block. Frames no longer broadcast DOM changes or
// auto-write storage — Grab Lead is the single source of truth. This is what
// eliminated cross-lead contamination in the panel.
window.addEventListener('beforeunload', function() { lastScrapedData = null; _lpTimerIds.forEach(function(id) { clearTimeout(id); }); _lpTimerIds = []; });

window.addEventListener('load', function() {
  console.log('[Lead Pro] v9.7.120 loaded');

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
  console.log('[Lead Pro] v1.0.0 loaded');
});

// ────────────────────────────────────────────────────────────────────
// ── v9.7.5 — Generation History (local audit log) ──
// ────────────────────────────────────────────────────────────────────
// Captures each successful generation to chrome.storage.local. Local-only —
// nothing leaves the device. Helps agents recall what they sent earlier in
// the day and gives them ownership over their own work history.
//
// Storage key:  leadpro_history (array, capped at HISTORY_CAP entries)
// Each entry:   { id, ts, leadId, customerName, vehicle, persona,
//                 personaIsAuto, flags, sms, email, voicemail }
var HISTORY_CAP = 50;

function _lpHistorySave(entry) {
  if (!entry) return;
  chrome.storage.local.get(['leadpro_history'], function(r) {
    var list = (r && r.leadpro_history) || [];
    list.unshift(entry);
    if (list.length > HISTORY_CAP) list = list.slice(0, HISTORY_CAP);
    chrome.storage.local.set({ leadpro_history: list }, function() {
      console.log('[Lead Pro] History saved — total entries:', list.length);
    });
  });
}

function _lpHistoryFormatTime(ts) {
  var d = new Date(ts);
  var now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  var hh = d.getHours();
  var mm = d.getMinutes().toString().padStart(2, '0');
  var ampm = hh >= 12 ? 'PM' : 'AM';
  var hh12 = ((hh + 11) % 12) + 1;
  var time = hh12 + ':' + mm + ' ' + ampm;
  if (sameDay) return 'Today ' + time;
  var yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday ' + time;
  var mo = d.toLocaleString('en-US', { month: 'short' });
  return mo + ' ' + d.getDate() + ' ' + time;
}

function _lpHistoryEscape(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _lpHistoryRenderList() {
  var listEl   = document.getElementById('historyList');
  var detailEl = document.getElementById('historyDetail');
  var countEl  = document.getElementById('historyCount');
  if (!listEl) return;
  detailEl.classList.remove('visible');
  listEl.style.display = 'block';
  chrome.storage.local.get(['leadpro_history'], function(r) {
    var list = (r && r.leadpro_history) || [];
    if (countEl) countEl.textContent = list.length + ' generation' + (list.length === 1 ? '' : 's') + ' stored';
    if (list.length === 0) {
      listEl.innerHTML = '<div class="history-empty">' +
        '<div class="history-empty-mark">LP</div>' +
        'No generations yet.<br>Your last 50 generated messages will show up here once you start using Lead Pro.' +
        '</div>';
      return;
    }
    var html = list.map(function(item, idx) {
      var preview = item.sms || item.email || item.voicemail || '';
      preview = preview.replace(/\n+/g, ' ').slice(0, 140);
      var personaLabel = ({
        bdc: 'BDC', sales: 'SALES', manager: 'MANAGER',
        internet_director: 'DIRECTOR', concierge: 'CONCIERGE'
      })[item.persona] || item.persona || 'BDC';
      var flagsHtml = (item.flags || []).slice(0, 4).map(function(f) {
        return '<span class="history-pill flag">' + _lpHistoryEscape(f) + '</span>';
      }).join('');
      var vehHtml = item.vehicle
        ? '<span class="history-pill vehicle">' + _lpHistoryEscape(item.vehicle.slice(0, 30)) + '</span>'
        : '';
      return '<div class="history-item" data-history-idx="' + idx + '">' +
        '<div class="history-item-head">' +
          '<div class="history-item-name">' + _lpHistoryEscape(item.customerName || '(no name)') + '</div>' +
          '<div class="history-item-time">' + _lpHistoryFormatTime(item.ts) + '</div>' +
        '</div>' +
        '<div class="history-item-meta">' +
          '<span class="history-pill persona-' + (item.persona || 'bdc') + '">' + personaLabel + '</span>' +
          vehHtml +
          flagsHtml +
        '</div>' +
        '<div class="history-item-preview">' + _lpHistoryEscape(preview) + '</div>' +
      '</div>';
    }).join('');
    listEl.innerHTML = html;
    listEl.querySelectorAll('.history-item').forEach(function(el) {
      el.addEventListener('click', function() {
        _lpHistoryRenderDetail(parseInt(el.dataset.historyIdx, 10));
      });
    });
  });
}

function _lpHistoryRenderDetail(idx) {
  chrome.storage.local.get(['leadpro_history'], function(r) {
    var list = (r && r.leadpro_history) || [];
    var item = list[idx];
    if (!item) return;
    var listEl   = document.getElementById('historyList');
    var detailEl = document.getElementById('historyDetail');
    listEl.style.display = 'none';
    var personaLabel = ({
      bdc: 'BDC Agent', sales: 'Sales Consultant', manager: 'Sales Manager',
      internet_director: 'Internet Director', concierge: 'Luxury Concierge'
    })[item.persona] || 'BDC Agent';
    var flagsLine = (item.flags && item.flags.length) ? item.flags.join(' · ') : 'No flags';
    var html = '<button class="history-detail-back" id="historyDetailBack">← Back to list</button>' +
      '<div class="history-detail-head">' +
        '<div class="history-detail-name">' + _lpHistoryEscape(item.customerName || '(no name)') + '</div>' +
        '<div class="history-detail-meta">' + _lpHistoryFormatTime(item.ts) +
          ' · ' + personaLabel + (item.personaIsAuto ? ' (AUTO)' : ' (Override)') +
          (item.vehicle ? ' · ' + _lpHistoryEscape(item.vehicle) : '') +
          ' · ' + _lpHistoryEscape(flagsLine) +
        '</div>' +
      '</div>';
    if (item.sms) {
      html += '<div class="history-detail-section"><div class="history-detail-label">SMS</div>' +
              '<div class="history-detail-text">' + _lpHistoryEscape(item.sms) + '</div></div>';
    }
    if (item.email) {
      html += '<div class="history-detail-section"><div class="history-detail-label">Email</div>' +
              '<div class="history-detail-text">' + _lpHistoryEscape(item.email) + '</div></div>';
    }
    if (item.voicemail) {
      html += '<div class="history-detail-section"><div class="history-detail-label">Voicemail</div>' +
              '<div class="history-detail-text">' + _lpHistoryEscape(item.voicemail) + '</div></div>';
    }
    detailEl.innerHTML = html;
    detailEl.classList.add('visible');
    var backBtn = document.getElementById('historyDetailBack');
    if (backBtn) backBtn.addEventListener('click', _lpHistoryRenderList);
  });
}

// Wire up history button + drawer
(function() {
  var btn       = document.getElementById('btnHistory');
  var overlay   = document.getElementById('historyOverlay');
  var closeBtn  = document.getElementById('historyClose');
  var clearAllBtn = document.getElementById('historyClearAll');
  if (btn && overlay) {
    btn.addEventListener('click', function() {
      overlay.classList.add('visible');
      _lpHistoryRenderList();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', function() { overlay.classList.remove('visible'); });
  if (overlay) overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.classList.remove('visible');
  });
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', function() {
      if (!confirm('Clear all history? This cannot be undone.')) return;
      chrome.storage.local.set({ leadpro_history: [] }, function() {
        _lpHistoryRenderList();
      });
    });
  }
})();

