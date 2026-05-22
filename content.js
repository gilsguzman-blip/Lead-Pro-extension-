// ─────────────────────────────────────────────────────────────────
// Lead Pro — content.js  v4.9
// Runs in EVERY frame. Each frame contributes what it can find.
// Customer name lives in left pane. Lead Info (agent, source,
// vehicle) lives in right pane. Both frames write to storage
// and popup.js merges them.
// ─────────────────────────────────────────────────────────────────
(function() {
  'use strict';
  if (!document.body) return;

  // ── Singleton guard — prevent duplicate injection in same frame ─
  if (window.__LEADPRO_CONTENT_LOADED__) {
    console.log('[Lead Pro] content.js already running in this frame — skipping duplicate injection');
    return;
  }
  window.__LEADPRO_CONTENT_LOADED__ = true;

  // ── Helpers ────────────────────────────────────────────────────
  function gid(id) {
    try {
      const el = document.getElementById(id);
      return el ? (el.innerText || el.textContent || el.value || '').trim() : '';
    } catch(e) { return ''; }
  }

  function qs(sel) {
    try {
      const el = document.querySelector(sel);
      return el ? (el.innerText || el.textContent || el.value || '').trim() : '';
    } catch(e) { return ''; }
  }

  function firstId(ids) {
    for (const id of ids) {
      const v = gid(id);
      if (v && v !== 'None' && v !== 'none') return v;
    }
    return '';
  }

  function firstSel(sels) {
    for (const s of sels) {
      const v = qs(s);
      if (v && v !== 'None' && v !== 'none') return v;
    }
    return '';
  }

  // Read the value cell next to a label in a table
  // Works on the confirmed Lead Info HTML structure:
  // <tr><td class="datalabel">BD Agent:</td><td class="datavalue"><span>Carly Osuna</span></td></tr>
  // Row cache: populated on first call, cleared by reExtractIdentity() before each re-read
  var _rowCache = null;
  function labelValue(labelText) {
    try {
      const rows = _rowCache || (_rowCache = Array.from(document.querySelectorAll('tr')));
      const labelNorm = labelText.toLowerCase().replace(/[:\s]/g,'');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;
        const label = (cells[0].innerText || cells[0].textContent || '').trim();
        if (label.toLowerCase().replace(/[:\s]/g,'').includes(labelNorm)) {
          // Get value from second cell — strip nested span whitespace
          const valEl = cells[1].querySelector('span') || cells[1];
          const v = (valEl.innerText || valEl.textContent || '').trim();
          if (v && v !== 'None' && v !== 'none' && v.length > 0) return v;
        }
      }
    } catch(e) { console.warn('[Lead Pro] scraper error:', e.message); }
    return '';
  }

  const URL  = window.location.href;
  var rawText = (document.body.innerText || document.body.textContent || '').substring(0, 12000);
  // Strip worklist panel content — the left-side lead list bleeds customer names
  // into the current lead context, causing the model to hallucinate them as vehicle models
  rawText = rawText
    .replace(/(?:Dismiss Edit|SENT NEW LEAD|Wish list has found|KBB Dismiss|Assigned To:[^\n]*\n)/g, '')
    .replace(/(?:Waiting for prospect response|Appointment Made|Active Lead|Active New Lead)[^\n]*\n[^\n]*\n[^\n]*\n/g, '');
  const TEXT = rawText;

  // Targeted text mining — only used where no reliable element exists
  function textAfterLabel(label) {
    // Matches "Label:\nValue" or "Label: Value" patterns
    const rx = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[:\\s]+([^\\n\\r]{2,60})', 'i');
    const m  = TEXT.match(rx);
    return m ? m[1].trim() : '';
  }

  // ── Frame identity ──────────────────────────────────────────────
  // Original DOM marker (legacy VinSolutions layout)
  const debugEl    = document.getElementById('vindebug-section-wrap');
  const debugInner = debugEl ? debugEl.querySelector('.vindebug-section') : null;
  let autoLeadId = debugInner ? (debugInner.getAttribute('data-autoleadid') || '') : '';
  let dealerId   = debugInner ? (debugInner.getAttribute('data-dealerid')   || '') : '';
  let customerId = debugInner ? (debugInner.getAttribute('data-globalcustomerid') || '') : '';

  // FALLBACK 1: URL params — VinSolutions URLs often carry these.
  // (v9.7.51) Decode the URL first because nested params (cdQuery) can
  // contain URL-encoded AutoLeadID — e.g. ECCS frame URL has
  // "...&cdQuery=%3fGlobalCustomerID%3d...%26AutoLeadID%3d2013150224"
  // where the %26 (&) and %3d (=) prevent the raw regex from matching.
  // This is the only authoritative active-lead signal when the iframe
  // tree still has stale vindebug markers from a previous lead's render.
  var DECODED_URL = URL;
  try { DECODED_URL = decodeURIComponent(URL); } catch(e) { DECODED_URL = URL; }
  if (!autoLeadId) {
    autoLeadId = (DECODED_URL.match(/[?&#]AutoLeadID[=:](\d+)/i) || [])[1] || '';
    if (!autoLeadId) autoLeadId = (DECODED_URL.match(/[?&#]LeadID[=:](\d+)/i) || [])[1] || '';
    if (!autoLeadId) autoLeadId = (DECODED_URL.match(/leadId[=:](\d+)/i) || [])[1] || '';
  }
  if (!customerId) {
    customerId = (DECODED_URL.match(/[?&#]GlobalCustomerID[=:](\d+)/i) || [])[1] || '';
    if (!customerId) customerId = (DECODED_URL.match(/customerId[=:](\d+)/i) || [])[1] || '';
  }
  if (!dealerId) {
    dealerId = (DECODED_URL.match(/[?&#]dealerId[=:](\d+)/i) || [])[1] || '';
  }

  // FALLBACK 2: Hidden form inputs (ASP.NET WebForms layout typical for VinSolutions)
  if (!autoLeadId) {
    const hiddenLeadId = document.querySelector('input[name*="AutoLeadID" i], input[id*="AutoLeadID" i], input[name*="LeadID" i]');
    if (hiddenLeadId) autoLeadId = hiddenLeadId.value || '';
  }
  if (!customerId) {
    const hiddenCustId = document.querySelector('input[name*="GlobalCustomerID" i], input[id*="GlobalCustomerID" i], input[name*="CustomerID" i]');
    if (hiddenCustId) customerId = hiddenCustId.value || '';
  }

  // FALLBACK 3: Look for any element with data-autoleadid on it (without the wrap)
  if (!autoLeadId) {
    const anyAutoLead = document.querySelector('[data-autoleadid]');
    if (anyAutoLead) autoLeadId = anyAutoLead.getAttribute('data-autoleadid') || '';
  }

  // FALLBACK 4: Lead-content heuristic — if we see BD Agent or Sales Rep DOM elements
  // populated, treat this as a lead frame even without an autoLeadId. The downstream
  // scraper can still extract names; we just won't have the lead-ID-based dedup.
  // This prevents agents on UI variants without the identity marker from being locked out.
  let hasLeadContentMarkers = false;
  if (!autoLeadId) {
    const bdAgentEl = document.querySelector('[id*="BDAgent" i], [id*="AssignedBDAgent" i], [id*="CurrentAssignedBDAgent" i]');
    const salesRepEl = document.querySelector('[id*="SalesRep" i], [id*="AssignedSalesRep" i]');
    if ((bdAgentEl && bdAgentEl.textContent.trim()) || (salesRepEl && salesRepEl.textContent.trim())) {
      hasLeadContentMarkers = true;
    }
  }

  const isLeadFrame = !!autoLeadId || hasLeadContentMarkers;

  // Identify which pane this frame is
  const isCustomerDashboard = URL.includes('CustomerDashboard') || URL.includes('DeskLog') || isLeadFrame;

  // Declared early so eccs block and later blocks can both populate them
  var ownedVehicle = '';
  var ampEmailSubject = '';
  var ownedMileage = '';
  var lastServiceDate = '';

  // Log full URL when in eccs frame so we can capture dealerId
  if (URL.includes('eccs/index.html')) {
    console.log('[Lead Pro] ECCS full URL:', URL);

    // Scrape service vehicle and AMP email from eccs frame
    // Use both innerHTML scan (catches rendered content) and innerText scan
    try {
      var eccsHTML = (document.body ? document.body.innerHTML || '' : '');
      var eccsText = (document.body ? document.body.innerText || '' : '');

      // Method 1: Y/M/M datalabel in innerHTML
      if(!ownedVehicle) {
        var ymmHtmlMatch = eccsHTML.match(/Y\/M\/M[:\s]*<\/td>\s*<td[^>]*>([^<]{5,60})<\/td>/i);
        if(ymmHtmlMatch) {
          var ymmCand = ymmHtmlMatch[1].trim();
          if(/\d{4}\s+[A-Za-z]/.test(ymmCand)) ownedVehicle = ymmCand.substring(0,60);
        }
      }

      // Method 2: rgHeader Vehicle column in innerHTML
      if(!ownedVehicle) {
        var gridMatch = eccsHTML.match(/rgRow[^>]*>[\s\S]{0,200}?<td[^>]*>[\s\S]{0,100}?<\/td><td[^>]*>(20\d\d\s+[A-Za-z][^<]{3,40})<\/td>/i);
        if(gridMatch) ownedVehicle = gridMatch[1].trim().substring(0,60);
      }

      // Method 3: innerText scan for Year Make Model pattern
      if(!ownedVehicle) {
        var tvMatch = eccsText.match(/(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru|Acura|Lexus)[^\n]{2,30})/i);
        if(tvMatch) ownedVehicle = tvMatch[1].trim().replace(/\s+/g,' ').substring(0,60);
      }

      // AMP: lastcontacttitlelink in innerHTML
      if(!ampEmailSubject) {
        var ampHtmlMatch = eccsHTML.match(/lastcontacttitlelink[^>]*>[^<]*Marketing Campaign Email[^<]*\(subject[:\s]*([^\)<]{5,100})\)/i);
        if(ampHtmlMatch) ampEmailSubject = ampHtmlMatch[1].trim().substring(0,100);
      }
      // AMP: TEXT fallback
      if(!ampEmailSubject) {
        var ampTxtMatch = eccsText.match(/Marketing Campaign Email[^\n]*\(subject[:\s]*([^\)\n]{5,100})\)/i);
        if(ampTxtMatch) ampEmailSubject = ampTxtMatch[1].trim().substring(0,100);
      }

      // Mileage from Y/M/M panel
      var mileageMatch = eccsHTML.match(/Mileage[:\s]*<\/td>\s*<td[^>]*>([0-9,]{3,10})<\/td>/i);
      if(mileageMatch) ownedMileage = mileageMatch[1].replace(/,/g,'').trim();

      // Last service date from service grid (most recent = first row)
      var lastSvcMatch = eccsHTML.match(/rgRow[^>]*>[\s\S]{0,400}?<td[^>]*>\s*(\d{1,2}\/\d{1,2}\/\d{2,4}[^<]*)<\/td>/i);
      if(lastSvcMatch) lastServiceDate = lastSvcMatch[1].trim().substring(0,20);

      console.log('[Lead Pro] ECCS scrape result:', { ownedVehicle: ownedVehicle, ampEmailSubject: ampEmailSubject, ownedMileage: ownedMileage, lastServiceDate: lastServiceDate });
    } catch(e) { console.log('[Lead Pro] ECCS scrape error:', e.message); }
  }
  console.log('[Lead Pro] content.js in frame:', URL.substring(0,80), '| isLeadFrame:', isLeadFrame, '| vindebug:', autoLeadId);

  // ── Store — highest confidence: dealerName from eccs URL parameter ─
  // Try multiple URL patterns for dealerId — covers split-frame layouts
  const dealerIdFromUrl = (
    (URL.match(/[?&]dealerId=(\d+)/i)||[])[1] ||
    (URL.match(/[?&]de=(\d+)/i)||[])[1] ||
    (URL.match(/\/dealer\/(\d+)\//i)||[])[1] ||
    (URL.match(/dealerID=(\d+)/i)||[])[1] ||
    ''
  );
  const dealerNameFromUrl = (URL.match(/[?&]dealerName=([^&]+)/i)||[])[1];
  const dealerNameDecoded = dealerNameFromUrl ? decodeURIComponent(dealerNameFromUrl) : '';

  // Map decoded dealer names to canonical store names
  const ECCS_STORE_MAP = {
    'Community Toyota':       'Community Toyota Baytown',
    'Community Kia':          'Community Kia Baytown',
    'Community Honda':        'Community Honda Baytown',
    'Community Honda Lafa':   'Community Honda Lafayette',
    'Community Honda Lafay':  'Community Honda Lafayette',
    'Community Honda Lafayette': 'Community Honda Lafayette',
    'Audi Lafayette':         'Audi Lafayette'
  };
  const storeFromEccsUrl = ECCS_STORE_MAP[dealerNameDecoded] || (dealerNameDecoded ? dealerNameDecoded : '');

  const storeFromTab = !storeFromEccsUrl && (firstId(['tabs-tab-customer-dashboard-selected'])
    || firstSel([
      'li.enterpriseCustomer_tab.active a',
      'li.enterprisecustomer_tab.active a',
      'li.enterpriseCustomer_tab.active',
      'ol.breadcrumb li:last-child a',
      'ul.breadcrumb li:last-child a',
      '[class*="breadcrumb"] li:last-child a',
      '[class*="breadcrumb"] li.active'
    ]));

  const storeFromText = (!storeFromEccsUrl && !storeFromTab) ? (
    /community\s+honda\s+baytown/i.test(TEXT)   ? 'Community Honda Baytown'   :
    /community\s+honda\s+lafayette/i.test(TEXT) ? 'Community Honda Lafayette' :
    /community\s+kia\s+baytown/i.test(TEXT)     ? 'Community Kia Baytown'     :
    /community\s+toyota\s+baytown/i.test(TEXT)  ? 'Community Toyota Baytown'  :
    /audi\s+lafayette/i.test(TEXT)              ? 'Audi Lafayette'            : ''
  ) : '';

  const store = storeFromEccsUrl || storeFromTab || storeFromText;
  const storeConfident = !!(storeFromEccsUrl || storeFromTab);

  // ── Customer name ───────────────────────────────────────────────
  // Lives in the Customer Info panel (left pane / DeskLog frame)
  const name = firstId([
    'ContentPlaceHolder1_m_CustomerAndTaskInfo_m_CustomerInfo__CustomerName',
    'ContentPlaceHolder1_m_CustomerName'
  ]) || firstSel([
    '.CustomerInfo_CustomerName',
    'span[id$="__CustomerName"]',
    'span[id*="_CustomerInfo__CustomerName"]',
    'span[id*="CustomerName"]'
  ]);

  // ── Email ────────────────────────────────────────────────────────
  const emailEl = document.getElementById('customer-email-span');
  const email   = emailEl
    ? (emailEl.getAttribute('data-email') || emailEl.innerText || '').trim()
    : (TEXT.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/) || [])[1] || '';

  // ── Phone ────────────────────────────────────────────────────────
  // Iterate multiple selector candidates. The customer phone can appear in:
  //   a) CustomerInfo_CustomerDetail span (CustomerDashboard frame) — primary
  //   b) BuyerInfoDetails span inside ActiveLeadPanel (LeadManagement frame) —
  //      third-party-lead path; the customer-dashboard frame may not be the
  //      active lead frame when leads come through third-party feeds, so this
  //      selector is the only source the active scrape can see.
  //   c) Any element with id ending in "_BuyerInfoDetails" — covers DOM
  //      variants across rooftops where the wrapper id prefix differs.
  // The phone-prefix regex already supports H/C/W/M/Cell/Home/Work/Eve.
  let phone = '';
  const phoneCandidateEls = [];
  const pushIf = (el) => { if (el && !phoneCandidateEls.includes(el)) phoneCandidateEls.push(el); };
  pushIf(document.querySelector('.CustomerInfo_CustomerDetail,[id*="_CustomerDetail"]'));
  pushIf(document.querySelector('[id$="__BuyerInfoDetails"],[id*="_BuyerInfoDetails"]'));
  pushIf(document.querySelector('[id*="BuyerInfo"],[id*="Buyer_Info"]'));
  for (const el of phoneCandidateEls) {
    const text = el.innerText || el.textContent || '';
    const m = text.match(/(?:C|H|W|M|Cell|Home|Work|Eve|Evening)[:\s]+([\(\d][\d\(\)\-\. ]{7,18})/i);
    if (m) {
      const cleaned = m[1].replace(/[^\d\(\)\-\. ]/g,'').trim();
      const digitCount = (cleaned.match(/\d/g) || []).length;
      if (digitCount >= 7) { phone = cleaned; break; }
    }
  }

  // ── BD Agent ────────────────────────────────────────────────────
  // Try exact IDs first, then the confirmed Lead Info table structure.
  // Selectors are intentionally tag-agnostic — VinSolutions DOM variants may
  // render BD Agent as div, label, or custom element instead of span/td.
  const _rawAgent = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedBDAgentLabel',
    'ActiveLeadPanel1_m_CurrentAssignedBDAgentLabel'
  ]) || firstSel([
    '[id*="CurrentAssignedBDAgent" i]',
    '[id*="AssignedBDAgent" i]',
    '[id*="BDAgentLabel" i]',
    '[id*="BDAgent" i]',
    '[data-label="BD Agent" i]',
    '[data-field*="BDAgent" i]'
  ]) || labelValue('BD Agent') || labelValue('BDAgent') || labelValue('BD');
  // Sanitize — reject values that look like CRM labels, not names
  const _agentInvalid = !_rawAgent ||
    /^Status:/i.test(_rawAgent) ||
    /^(Active|Bad|Sold|Lost|None|System|Unknown)$/i.test(_rawAgent.trim()) ||
    _rawAgent.trim().length < 3;
  const agent = _agentInvalid ? '' : _rawAgent;

  // ── Sales Rep ────────────────────────────────────────────────────
  // Tag-agnostic selectors — VinSolutions UI variants render Sales Rep as
  // various element types (span, div, custom tags depending on tenant build).
  const salesRep = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedUserLabel',
    'ActiveLeadPanel1_m_CurrentAssignedUserLabel'
  ]) || firstSel([
    '[id*="CurrentAssignedUser" i]',
    '[id*="AssignedUserLabel" i]',
    '[id*="SalesRep" i]',
    '[id*="AssignedSalesRep" i]',
    '[data-field*="SalesRep" i]'
  ]) || labelValue('Sales Rep');

  // ── Manager ──────────────────────────────────────────────────────
  const manager = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedManagerLabel',
    'ActiveLeadPanel1_m_CurrentAssignedManagerLabel'
  ]) || firstSel([
    '[id*="CurrentAssignedManager" i]',
    '[id*="AssignedManagerLabel" i]',
    '[id*="ManagerLabel" i]'
  ]) || labelValue('Manager');

  // ── Vehicle ──────────────────────────────────────────────────────
  const vehicleRaw = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo',
    'ActiveLeadPanel1_m_VehicleInfo'
  ]) || firstSel([
    'span[id*="VehicleInfo"].leadinfodetails',
    'span[id*="VehicleInfo"]',
    'span[id*="Vehicle"]',
    '.leadinfodetails',
    '[data-label="Vehicle"]'
  ]) || labelValue('Vehicle') || labelValue('Vehicle Info') || (function() {
    // Heading-style fallback for newer lead layouts (e.g. AI Buying Signals).
    // Captures "Vehicle Info\n<value>" where value sits on the next line after
    // the heading. Guards against the "Vehicle(s) of Interest" header that
    // typically follows, and against link/button text like "Click to add".
    var m = TEXT.match(/(?:^|\n)Vehicle Info\s*\n+\s*([^\n]{4,80})/);
    if (m) {
      var candidate = m[1].trim();
      // Reject heading-only matches and CTA links
      if (/^Vehicle\(s\)\s+of\s+Interest/i.test(candidate)) return '';
      if (/^Click to add|^Add (a|another)|^Edit Vehicle|^None|^N\/A/i.test(candidate)) return '';
      // Looks like a real vehicle string (year-make-model, or has a make keyword, or contains condition tag)
      if (/^\d{4}\s+\w+/.test(candidate)
          || /\((New|Used|CPO|Pre-Owned|Certified)\)/i.test(candidate)
          || /(toyota|honda|chevrolet|gmc|ford|kia|nissan|hyundai|mazda|subaru|jeep|ram|dodge|audi|bmw|mercedes|lexus|acura|infiniti|cadillac|lincoln|buick|volkswagen|volvo|porsche|tesla|genesis|mitsubishi)/i.test(candidate)) {
        return candidate;
      }
    }
    return '';
  })();
  const vehicle   = vehicleRaw.replace(/\s*\((New|Used|CPO|Pre-Owned|Certified)\)\s*/gi,'').trim();
  const condition = /\(New\)/i.test(vehicleRaw) ? 'New'
    : /Used|Pre-Owned|CPO|Certified/i.test(vehicleRaw) ? 'Pre-Owned' : '';

  // ── Color ────────────────────────────────────────────────────────
  const color = (TEXT.match(/Color[:\s]+([A-Za-z ]{3,25})(?:\n|Mfr|Stock|VIN|Warning|\s{3})/i) || [])[1] || '';

  // ── Stock / VIN ──────────────────────────────────────────────────
  // Scope the VIN search to the vehicle info section only — before trade-in
  // data and notes appear. KBB leads embed the trade-in VIN in the notes,
  // which the full-page regex would incorrectly treat as the vehicle of interest.
  const stockNum = (TEXT.match(/Stock\s*#?[:\s]*([A-Z]?\d{3,6}[A-Z0-9]*)\b/i) || [])[1] || '';
  // Find the vehicle section boundary — stop before trade-in or notes sections
  var _vinSearchEnd = TEXT.length;
  var _tradeIdx = TEXT.search(/Trade-?in\s*(Vehicle|Info|:)/i);
  var _notesIdx = TEXT.search(/Notes\s*&?\s*History/i);
  if (_tradeIdx > 100) _vinSearchEnd = Math.min(_vinSearchEnd, _tradeIdx);
  if (_notesIdx > 100) _vinSearchEnd = Math.min(_vinSearchEnd, _notesIdx);
  var _vinSearchText = TEXT.substring(0, _vinSearchEnd);
  const vin = ((_vinSearchText).match(/\bVIN[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i) || [])[1] || '';

  // ── Inventory warning ────────────────────────────────────────────
  const inventoryWarning = /no longer in your active inventory/i.test(TEXT);

  // ── Lead source ──────────────────────────────────────────────────
  // Exact IDs first, then label table lookup
  // NOTE: labelValue('Source') must NOT match "Buying Signal" section —
  // the Lead Info table has "Source:" as a row label; "Buying Signal" is
  // a separate section further down the page.
  const leadSource = firstId([
    'ActiveLeadPanelWONotesAndHistory1__LeadSourceName',
    'ActiveLeadPanel1__LeadSourceName'
  ]) || firstSel([
    'span[id*="LeadSourceName"]',
    'span[id*="_LeadSourceName"]',
    'span[id*="LeadSource"]',
    '[data-label="Source"]'
  ]) || labelValue('Source') || labelValue('Lead Source');

  // ── Lead status ──────────────────────────────────────────────────
  const leadStatus = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_LeadStatusLabel',
    'ActiveLeadPanel1_m_LeadStatusLabel'
  ]) || labelValue('Status');

  // ── Trade info ───────────────────────────────────────────────────
  const tradeEl  = document.getElementById('ActiveLeadPanelWONotesAndHistory1__TradeInfoPanel')
    || document.getElementById('ActiveLeadPanel1__TradeInfoPanel')
    || document.querySelector('[id*="TradeInfoPanel"]');
  const tradeRaw  = tradeEl ? (tradeEl.innerText || tradeEl.textContent || '').trim() : '';
  const tradeClean = tradeRaw.replace(/Trade-?in\s*Info/gi,'').trim();
  const hasTrade  = tradeClean.length > 2 && !tradeClean.includes('(none entered)');
  const tradeDescription = hasTrade ? tradeClean.substring(0,200) : '';

  // ── Lead age, contact status, outbound history ──────────────────
  // These are needed for stalled detection in the storage fallback path
  const fullText = (document.body ? document.body.innerText || document.body.textContent || '' : '').substring(0, 8000);
  var leadAgeDays = 0;
  try {
    var createdText = labelValue('Created') || '';
    if (!createdText) {
      var createdMatch = fullText.match(/Created[:\s]+([^\n]{5,40})/i);
      if (createdMatch) createdText = createdMatch[1];
    }
    var daysMatch = createdText.match(/\((\d+)d\)/i);
    if (daysMatch) leadAgeDays = parseInt(daysMatch[1]);
  } catch(e) { console.warn('[Lead Pro] scraper error:', e.message); }

  var isContacted = /Contacted:\s*Yes/i.test(fullText);
  var hasOutbound = /Outbound (Text|phone|Email)/i.test(fullText);
  var convState = '';
  if (/Inbound (Text|phone|Email)/i.test(fullText)) convState = 'has-inbound';

  // ── AI Buying Signals from Key Information panel ─────────────────
  // VinSolutions renders this in several DOM locations across views — sometimes with
  // ID #keyInfo-BuyingSignals-blurb, sometimes inside a generic <h4> with no stable ID.
  // The reliable signal is the text pattern itself: "<stage>. Interests: <list>."
  // Stages: Actively Shopping | Browsing | Ready To Buy | Not Shopping | Not in Market
  var buyingSignals = '';
  try {
    // Path 1: stable ID if present (some renders)
    var bsEl = document.querySelector('#keyInfo-BuyingSignals-blurb, [id*="BuyingSignals-blurb"]');
    if (bsEl) {
      var bsText = (bsEl.innerText || bsEl.textContent || '').trim();
      if (bsText && bsText.length > 5 && /interests?:/i.test(bsText)) buyingSignals = bsText.substring(0, 200);
    }
    // Path 2: tight pattern match -- requires BOTH stage word AND Interests label together,
    // with the interests value starting with a capital letter (the actual signal data uses
    // "Interests: Cadillac, Sedan, Cts, Used." -- always capitalized). Looser fallbacks
    // produced false positives from unrelated note text.
    if (!buyingSignals) {
      var pageText = (document.body ? document.body.innerText || '' : '');
      var m = pageText.match(/(actively shopping|ready to buy|browsing|not shopping|not in market)\.\s*interests?:\s*([A-Z][A-Za-z0-9\s,/&-]{2,120})\./);
      if (m) {
        var stage = m[1].trim();
        var interests = m[2].trim().replace(/\s+/g, ' ');
        buyingSignals = stage + '. Interests: ' + interests + '.';
      }
    }
    if (buyingSignals) {
      console.log('[Lead Pro] content.js captured buyingSignals:', buyingSignals, '| frame:', (location.href||'').substring(0,80));
    }
  } catch(e) {}

  // ── Notes & history ──────────────────────────────────────────────
  const noteEls   = Array.from(document.querySelectorAll('.notes-and-history-item') || []);
  const histLines = [];
  noteEls.slice(0,15).forEach(function(item) {
    const d   = ((item.querySelector('.notes-and-hsitory-item-date')    ||{}).innerText||'').trim();
    const t   = ((item.querySelector('.legacy-notes-and-history-title') ||{}).innerText||'').trim();
    const c   = (((item.querySelector('.notes-and-history-item-content')||{}).innerText||'')).trim().substring(0,300);
    const dir = (item.getAttribute('data-direction')||'').toLowerCase();
    const who = dir==='inbound' ? 'CUSTOMER' : dir==='outbound' ? 'AGENT' : 'NOTE';
    if (/lead log/i.test(t) && /changed from/i.test(c) && c.length < 100) return;
    // Strip OEM form placeholders — Toyota.com, Honda.com etc submit empty form fields as "|| ||"
    var cClean = c.replace(/\[Customer Comments\]\s*\|\|\s*\|\|/gi, '')
                  .replace(/\|\|\s*\|\|/g, '')
                  .replace(/\[Ownership and Service\]\s*-?\s*Ownership and Service History Not Available\.?/gi, 'No service history available.')
                  .trim();
    if (d||t||cClean) histLines.push('['+d+'] ['+who+'] '+t+': '+cClean);
  });
  const history = histLines.join('\n');
  const totalNoteCount = noteEls.length;

  // ── Owned vehicle from service/sales history ─────────────────────
  // Scraped from CustomerDashboard frame which has service tab visible
  try {
    // Priority 1: Y/M/M field in repair order detail
    var bodyText = (document.body ? document.body.innerText || '' : '');
    var ymmM = bodyText.match(/Y\/M\/M[:\s]+(\d{4}\s+[A-Za-z][^\n]{3,40})/i);
    if(ymmM) ownedVehicle = ymmM[1].trim().substring(0,60);

    // Priority 2: Service history table (RO# | Vehicle | Date)
    if(!ownedVehicle) {
      var tables = document.querySelectorAll('table');
      for(var ti=0; ti<tables.length && !ownedVehicle; ti++) {
        var ths = tables[ti].querySelectorAll('th');
        var thText = Array.from(ths).map(function(h){return (h.innerText||'').toLowerCase();}).join('|');
        if(/ro#|repair.order/.test(thText) && /vehicle/.test(thText)) {
          var trs = tables[ti].querySelectorAll('tr');
          for(var ri=1; ri<trs.length && !ownedVehicle; ri++) {
            var tds = trs[ri].querySelectorAll('td');
            if(tds.length >= 2) {
              var vt = (tds[1].innerText||'').trim();
              if(/\d{4}\s+[A-Za-z]/.test(vt) && vt.length > 5)
                ownedVehicle = vt.replace(/\s+/g,' ').substring(0,60);
            }
          }
        }
      }
    }

    // Priority 3: Sales history sold row
    if(!ownedVehicle) {
      var soldM = bodyText.match(/Sold\b[^\n]{0,100}(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru)[^\n]{3,40})/i);
      if(soldM) ownedVehicle = soldM[1].trim().replace(/\s+/g,' ').substring(0,60);
    }

    // AMP email subject from Contact History
    var ampM = bodyText.match(/Marketing Campaign Email[^\n]*subject[:\s]+([^\n\)]{5,100})/i);
    if(ampM) ampEmailSubject = ampM[1].replace(/[)\]]/g,'').trim().substring(0,100);

  } catch(e) { console.warn('[Lead Pro] scraper error:', e.message); }

  // Extra scan for rims2 service frame which has different DOM structure
  if(!ownedVehicle && /rims2/i.test(URL)) {
    try {
      var rimsText = (document.body ? document.body.innerText || '' : '');
      // rims2 shows vehicle as "Year Make Model" in service records
      var rimsVehicleMatch = rimsText.match(/(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru|Acura|Lexus|Infiniti|BMW|Mercedes|Audi|Volkswagen)[^\n]{2,30})/i);
      if(rimsVehicleMatch) ownedVehicle = rimsVehicleMatch[1].trim().replace(/\s+/g,' ').substring(0,60);
      // Also look for AMP contact history in rims2
      if(!ampEmailSubject) {
        var rimsAmpMatch = rimsText.match(/Marketing Campaign Email[^\n]*subject[:\s]+([^\n\)]{5,100})/i);
        if(rimsAmpMatch) ampEmailSubject = rimsAmpMatch[1].replace(/[)\]]/g,'').trim().substring(0,100);
      }
    } catch(e2) { console.warn('[Lead Pro] scraper error:', e2.message); }
  }

  if(ownedVehicle || ampEmailSubject) console.log('[Lead Pro] content.js found:', { ownedVehicle: ownedVehicle, ampEmailSubject: ampEmailSubject, frame: URL.substring(0,60) });

  // ── Skip frames with no useful data ───────────────────────────
  const hasData = !!(name || agent || vehicle || leadSource || autoLeadId || store || ownedVehicle || ampEmailSubject || buyingSignals);
  if (!hasData) {
    console.log('[Lead Pro] Frame has no useful data, exiting');
    return;
  }


  // ── Agent name fallback — extract from most recent agent note if DOM missed it ──
  var agentFallback = agent;
  if (!agentFallback && typeof TEXT === 'string') {
    var agentNoteMatch = TEXT.match(/BD Agent:\s*([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/);
    if (!agentNoteMatch) agentNoteMatch = TEXT.match(/By:\s*([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)\s*\nLeft message/);
    if (!agentNoteMatch) {
      // Try to get from "BD Agent Changed From X to Y" — take last value
      var bdChanges = TEXT.match(/BD Agent Changed From .+ to ([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)/g) || [];
      if (bdChanges.length) {
        var lastChange = bdChanges[bdChanges.length - 1];
        var m = lastChange.match(/to ([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+)$/);
        if (m) agentFallback = m[1];
      }
    } else {
      agentFallback = agentNoteMatch[1];
    }
  }

  const isEccsFrame = URL.includes('eccs/index.html');
  // Extract customer state from page text — "City, ST 00000" pattern
  var customerZipMatch = TEXT.match(/\b(\d{5})(?:-\d{4})?\b/);
  var customerZip = customerZipMatch ? customerZipMatch[1] : '';
  var customerStateMatch = TEXT.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
  var customerState = customerStateMatch ? customerStateMatch[1] : '';

  // Store coordinates for distance calculation (lat, lng)
  var STORE_COORDS = {
    '6189':  { lat: 29.7355, lng: -94.9774 }, // Community Toyota Baytown
    '6190':  { lat: 29.7355, lng: -94.9774 }, // Community Kia Baytown
    '6191':  { lat: 29.7355, lng: -94.9774 }, // Community Honda Baytown
    '24399': { lat: 30.2241, lng: -92.0198 }, // Community Honda Lafayette
    '21135': { lat: 30.2241, lng: -92.0198 }, // Audi Lafayette
  };

  // Zip code centroid lookup — major TX/LA zips near our stores
  // Covers ~200 mile radius around Baytown and Lafayette
  var ZIP_COORDS = {
    // Baytown / Houston area
    '77520': { lat: 29.7355, lng: -94.9774 }, // Baytown
    '77521': { lat: 29.7474, lng: -94.9538 },
    '77522': { lat: 29.7355, lng: -94.9774 },
    '77530': { lat: 29.7552, lng: -95.0924 }, // Channelview
    '77547': { lat: 29.7269, lng: -95.2291 }, // Galena Park
    '77562': { lat: 29.8024, lng: -95.0419 }, // Highlands
    '77571': { lat: 29.7383, lng: -95.0191 }, // La Porte
    '77586': { lat: 29.5916, lng: -94.9949 }, // Seabrook
    '77015': { lat: 29.7780, lng: -95.1594 }, // Houston East
    '77049': { lat: 29.8091, lng: -95.1780 },
    '77058': { lat: 29.5580, lng: -95.0899 }, // Clear Lake
    '77001': { lat: 29.7604, lng: -95.3698 }, // Houston
    '77002': { lat: 29.7604, lng: -95.3698 },
    '77003': { lat: 29.7333, lng: -95.3488 },
    '77004': { lat: 29.7246, lng: -95.3704 },
    '77005': { lat: 29.7163, lng: -95.4241 },
    '77006': { lat: 29.7433, lng: -95.3947 },
    '77007': { lat: 29.7718, lng: -95.4085 },
    '77008': { lat: 29.7947, lng: -95.4130 },
    '77009': { lat: 29.7898, lng: -95.3684 },
    '77010': { lat: 29.7540, lng: -95.3628 },
    '77011': { lat: 29.7391, lng: -95.3239 },
    '77012': { lat: 29.7183, lng: -95.2992 },
    '77013': { lat: 29.7680, lng: -95.2354 },
    '77014': { lat: 29.9658, lng: -95.4741 },
    '77016': { lat: 29.8264, lng: -95.2750 },
    '77017': { lat: 29.6966, lng: -95.2721 },
    '77018': { lat: 29.8197, lng: -95.4131 },
    '77019': { lat: 29.7491, lng: -95.4113 },
    '77020': { lat: 29.7697, lng: -95.3138 },
    '77021': { lat: 29.7001, lng: -95.3616 },
    '77022': { lat: 29.8197, lng: -95.3754 },
    '77023': { lat: 29.7244, lng: -95.3300 },
    '77024': { lat: 29.7675, lng: -95.5102 },
    '77025': { lat: 29.6886, lng: -95.4241 },
    '77026': { lat: 29.7877, lng: -95.3343 },
    '77027': { lat: 29.7383, lng: -95.4469 },
    '77028': { lat: 29.8197, lng: -95.2982 },
    '77029': { lat: 29.7483, lng: -95.2500 },
    '77030': { lat: 29.7066, lng: -95.3997 },
    '77031': { lat: 29.6677, lng: -95.5372 },
    '77032': { lat: 29.9480, lng: -95.3343 },
    '77033': { lat: 29.6766, lng: -95.3343 },
    '77034': { lat: 29.6419, lng: -95.2158 },
    '77035': { lat: 29.6602, lng: -95.4741 },
    '77036': { lat: 29.7001, lng: -95.5372 },
    '77037': { lat: 29.8755, lng: -95.3836 },
    '77038': { lat: 29.9019, lng: -95.4469 },
    '77039': { lat: 29.8794, lng: -95.3469 },
    '77040': { lat: 29.8716, lng: -95.5141 },
    '77041': { lat: 29.8450, lng: -95.5627 },
    '77042': { lat: 29.7338, lng: -95.5627 },
    '77043': { lat: 29.7927, lng: -95.5611 },
    '77044': { lat: 29.8294, lng: -95.1780 },
    '77045': { lat: 29.6552, lng: -95.4241 },
    '77046': { lat: 29.7338, lng: -95.4469 },
    '77047': { lat: 29.6302, lng: -95.4019 },
    '77048': { lat: 29.6141, lng: -95.3836 },
    '77050': { lat: 29.8716, lng: -95.2721 },
    '77051': { lat: 29.6652, lng: -95.3836 },
    '77053': { lat: 29.6091, lng: -95.4469 },
    '77054': { lat: 29.6852, lng: -95.3997 },
    '77055': { lat: 29.7927, lng: -95.4741 },
    '77056': { lat: 29.7491, lng: -95.4638 },
    '77057': { lat: 29.7388, lng: -95.4891 },
    '77059': { lat: 29.5869, lng: -95.1152 },
    '77060': { lat: 29.9313, lng: -95.3836 },
    '77061': { lat: 29.6602, lng: -95.2992 },
    '77062': { lat: 29.5852, lng: -95.0835 },
    '77063': { lat: 29.7338, lng: -95.5141 },
    '77064': { lat: 29.9019, lng: -95.5627 },
    '77065': { lat: 29.9313, lng: -95.6308 },
    '77066': { lat: 29.9597, lng: -95.5141 },
    '77067': { lat: 29.9597, lng: -95.4469 },
    '77068': { lat: 30.0072, lng: -95.4638 },
    '77069': { lat: 29.9872, lng: -95.5141 },
    '77070': { lat: 29.9597, lng: -95.5866 },
    '77071': { lat: 29.6602, lng: -95.5141 },
    '77072': { lat: 29.7001, lng: -95.5866 },
    '77073': { lat: 29.9872, lng: -95.3836 },
    '77074': { lat: 29.7001, lng: -95.5372 },
    '77075': { lat: 29.6263, lng: -95.2992 },
    '77076': { lat: 29.8450, lng: -95.3836 },
    '77077': { lat: 29.7491, lng: -95.5866 },
    '77078': { lat: 29.8147, lng: -95.2354 },
    '77079': { lat: 29.7675, lng: -95.5611 },
    '77080': { lat: 29.8147, lng: -95.4891 },
    '77081': { lat: 29.7183, lng: -95.4891 },
    '77082': { lat: 29.7338, lng: -95.6308 },
    '77083': { lat: 29.7001, lng: -95.6483 },
    '77084': { lat: 29.8450, lng: -95.6694 },
    '77085': { lat: 29.6302, lng: -95.4638 },
    '77086': { lat: 29.9019, lng: -95.4469 },
    '77087': { lat: 29.6938, lng: -95.2992 },
    '77088': { lat: 29.8977, lng: -95.4131 },
    '77089': { lat: 29.5988, lng: -95.2158 },
    '77090': { lat: 29.9930, lng: -95.4469 },
    '77091': { lat: 29.8450, lng: -95.4131 },
    '77092': { lat: 29.8216, lng: -95.4469 },
    '77093': { lat: 29.8716, lng: -95.3469 },
    '77094': { lat: 29.7927, lng: -95.6694 },
    '77095': { lat: 29.8977, lng: -95.6483 },
    '77096': { lat: 29.6766, lng: -95.4741 },
    '77097': { lat: 29.7388, lng: -95.4469 },
    '77098': { lat: 29.7388, lng: -95.4131 },
    '77099': { lat: 29.6938, lng: -95.6308 },
    '77201': { lat: 29.7604, lng: -95.3698 },
    '77338': { lat: 29.9872, lng: -95.2721 }, // Humble
    '77339': { lat: 29.9872, lng: -95.1780 },
    '77345': { lat: 29.9597, lng: -95.1152 },
    '77346': { lat: 29.9597, lng: -95.1516 },
    '77365': { lat: 30.1108, lng: -95.1152 }, // Porter
    '77373': { lat: 30.0561, lng: -95.3836 }, // Spring
    '77377': { lat: 29.9313, lng: -95.6694 },
    '77379': { lat: 30.0072, lng: -95.5866 },
    '77380': { lat: 30.1108, lng: -95.4638 }, // The Woodlands
    '77381': { lat: 30.1683, lng: -95.4891 },
    '77382': { lat: 30.1958, lng: -95.5141 },
    '77384': { lat: 30.2219, lng: -95.4469 },
    '77385': { lat: 30.1683, lng: -95.4469 },
    '77386': { lat: 30.1683, lng: -95.3836 },
    '77388': { lat: 30.0847, lng: -95.4469 },
    '77389': { lat: 30.0847, lng: -95.5372 },
    '77396': { lat: 29.9313, lng: -95.2354 }, // Humble
    '77401': { lat: 29.6963, lng: -95.4638 }, // Bellaire
    '77406': { lat: 29.6866, lng: -95.7660 }, // Richmond
    '77407': { lat: 29.6866, lng: -95.7010 },
    '77423': { lat: 29.8450, lng: -95.9480 }, // Brookshire
    '77429': { lat: 29.9597, lng: -95.7010 }, // Cypress
    '77433': { lat: 29.9872, lng: -95.6694 },
    '77447': { lat: 29.9019, lng: -95.8516 }, // Hockley
    '77449': { lat: 29.8450, lng: -95.7660 }, // Katy
    '77450': { lat: 29.7675, lng: -95.7660 },
    '77459': { lat: 29.5602, lng: -95.5372 }, // Missouri City
    '77469': { lat: 29.5602, lng: -95.7660 }, // Richmond
    '77471': { lat: 29.5869, lng: -95.7660 }, // Rosenberg
    '77477': { lat: 29.5552, lng: -95.5866 }, // Stafford
    '77478': { lat: 29.5869, lng: -95.5866 }, // Sugar Land
    '77479': { lat: 29.5602, lng: -95.6694 },
    '77489': { lat: 29.6302, lng: -95.5141 }, // Missouri City
    '77494': { lat: 29.7927, lng: -95.8214 }, // Katy
    '77498': { lat: 29.7388, lng: -95.7660 },
    '77502': { lat: 29.6938, lng: -95.1516 }, // Pasadena
    '77503': { lat: 29.6938, lng: -95.1152 },
    '77504': { lat: 29.6602, lng: -95.1780 },
    '77505': { lat: 29.6302, lng: -95.1152 },
    '77506': { lat: 29.7183, lng: -95.2158 },
    '77507': { lat: 29.6552, lng: -95.0419 },
    '77508': { lat: 29.6263, lng: -95.1152 },
    '77510': { lat: 29.4513, lng: -95.0711 }, // Santa Fe
    '77511': { lat: 29.4266, lng: -95.2354 }, // Alvin
    '77514': { lat: 29.8122, lng: -94.6024 }, // Anahuac
    '77515': { lat: 29.2974, lng: -95.4638 }, // Angleton
    '77517': { lat: 29.3858, lng: -95.1516 },
    '77518': { lat: 29.5088, lng: -95.0127 }, // Bacliff
    '77519': { lat: 30.1533, lng: -94.6024 }, // Batson
    '77523': { lat: 29.8716, lng: -94.8838 }, // Baytown area
    '77531': { lat: 29.2641, lng: -95.4469 }, // Clute
    '77532': { lat: 29.9597, lng: -95.0127 }, // Crosby
    '77534': { lat: 29.3191, lng: -95.3836 }, // Danbury
    '77535': { lat: 30.0561, lng: -94.9127 }, // Dayton
    '77536': { lat: 29.7183, lng: -95.0419 }, // Deer Park
    '77539': { lat: 29.5552, lng: -94.9949 }, // Dickinson
    '77541': { lat: 29.2969, lng: -95.3343 }, // Freeport
    '77545': { lat: 29.4983, lng: -95.4638 }, // Fresno
    '77546': { lat: 29.5088, lng: -95.1152 }, // Friendswood
    '77548': { lat: 29.5358, lng: -95.2354 },
    '77549': { lat: 29.5552, lng: -95.2158 },
    '77550': { lat: 29.2977, lng: -94.7944 }, // Galveston
    '77551': { lat: 29.2641, lng: -94.8516 },
    '77554': { lat: 29.2258, lng: -94.9775 },
    '77555': { lat: 29.3097, lng: -94.7944 },
    '77560': { lat: 29.9019, lng: -94.5938 }, // Hankamer
    '77561': { lat: 30.0561, lng: -94.6469 }, // Hardin
    '77563': { lat: 29.5088, lng: -94.9127 }, // Hitchcock
    '77564': { lat: 30.1108, lng: -94.6938 }, // Hull
    '77565': { lat: 29.5358, lng: -94.9127 }, // Jamaica Beach area
    '77566': { lat: 29.0858, lng: -95.4469 }, // Lake Jackson
    '77568': { lat: 29.3858, lng: -94.9775 }, // La Marque
    '77573': { lat: 29.5088, lng: -95.0835 }, // League City
    '77574': { lat: 29.5358, lng: -95.0419 },
    '77575': { lat: 30.1533, lng: -94.7438 }, // Liberty
    '77577': { lat: 29.3552, lng: -95.3836 }, // Liverpool
    '77578': { lat: 29.4513, lng: -95.3343 }, // Manvel
    '77580': { lat: 29.9597, lng: -94.8127 }, // Mont Belvieu
    '77581': { lat: 29.5552, lng: -95.2721 }, // Pearland
    '77584': { lat: 29.5088, lng: -95.3836 },
    '77585': { lat: 30.2219, lng: -94.6938 }, // Saratoga
    '77587': { lat: 29.6552, lng: -95.2354 }, // South Houston
    '77590': { lat: 29.3858, lng: -94.9949 }, // Texas City
    '77591': { lat: 29.3552, lng: -95.0127 },
    '77597': { lat: 29.8977, lng: -94.6469 }, // Wallisville
    '77598': { lat: 29.5552, lng: -95.1516 }, // Webster
    // San Antonio
    '78201': { lat: 29.4241, lng: -98.5372 },
    '78202': { lat: 29.4241, lng: -98.4891 },
    '78203': { lat: 29.4241, lng: -98.4469 },
    '78204': { lat: 29.4083, lng: -98.5141 },
    '78205': { lat: 29.4241, lng: -98.4941 },
    '78207': { lat: 29.4402, lng: -98.5372 },
    '78208': { lat: 29.4480, lng: -98.4638 },
    '78209': { lat: 29.4925, lng: -98.4469 },
    '78210': { lat: 29.4083, lng: -98.4638 },
    '78212': { lat: 29.4680, lng: -98.4891 },
    '78213': { lat: 29.5083, lng: -98.5372 },
    '78216': { lat: 29.5602, lng: -98.4891 },
    '78217': { lat: 29.5358, lng: -98.4131 },
    '78218': { lat: 29.4847, lng: -98.3836 },
    '78219': { lat: 29.4480, lng: -98.3469 },
    '78220': { lat: 29.4083, lng: -98.3836 },
    '78221': { lat: 29.3552, lng: -98.4891 },
    '78222': { lat: 29.3858, lng: -98.3836 },
    '78223': { lat: 29.3552, lng: -98.4131 },
    '78224': { lat: 29.3708, lng: -98.5372 },
    '78225': { lat: 29.4083, lng: -98.5372 },
    '78226': { lat: 29.4402, lng: -98.5627 },
    '78227': { lat: 29.4083, lng: -98.6308 },
    '78228': { lat: 29.4680, lng: -98.5866 },
    '78229': { lat: 29.5083, lng: -98.5866 },
    '78230': { lat: 29.5358, lng: -98.5372 },
    '78231': { lat: 29.5602, lng: -98.5866 },
    '78232': { lat: 29.5869, lng: -98.4891 },
    '78233': { lat: 29.5602, lng: -98.3836 },
    '78234': { lat: 29.4847, lng: -98.4131 },
    '78235': { lat: 29.3552, lng: -98.4469 },
    '78236': { lat: 29.4083, lng: -98.6694 },
    '78237': { lat: 29.4680, lng: -98.6308 },
    '78238': { lat: 29.4925, lng: -98.6308 },
    '78239': { lat: 29.5083, lng: -98.3836 },
    '78240': { lat: 29.5358, lng: -98.6308 },
    '78241': { lat: 29.5083, lng: -98.3469 },
    '78242': { lat: 29.3552, lng: -98.6308 },
    '78243': { lat: 29.3858, lng: -98.6308 },
    '78244': { lat: 29.4480, lng: -98.3469 },
    '78245': { lat: 29.4083, lng: -98.7010 },
    '78247': { lat: 29.6141, lng: -98.4469 },
    '78248': { lat: 29.5869, lng: -98.5372 },
    '78249': { lat: 29.5602, lng: -98.6308 },
    '78250': { lat: 29.5083, lng: -98.7010 },
    '78251': { lat: 29.4680, lng: -98.7010 },
    '78252': { lat: 29.3552, lng: -98.7010 },
    '78253': { lat: 29.4083, lng: -98.8214 },
    '78254': { lat: 29.5358, lng: -98.7660 },
    '78255': { lat: 29.6141, lng: -98.6694 },
    '78256': { lat: 29.5869, lng: -98.6694 },
    '78257': { lat: 29.6302, lng: -98.6694 },
    '78258': { lat: 29.6552, lng: -98.4891 },
    '78259': { lat: 29.6302, lng: -98.4131 },
    '78260': { lat: 29.6863, lng: -98.4469 },
    '78261': { lat: 29.6863, lng: -98.4131 },
    // Austin
    '78701': { lat: 30.2747, lng: -97.7404 },
    '78702': { lat: 30.2608, lng: -97.7172 },
    '78703': { lat: 30.2941, lng: -97.7660 },
    '78704': { lat: 30.2413, lng: -97.7660 },
    '78705': { lat: 30.2941, lng: -97.7404 },
    '78710': { lat: 30.2747, lng: -97.7404 },
    '78717': { lat: 30.5197, lng: -97.7660 },
    '78723': { lat: 30.2941, lng: -97.6938 },
    '78728': { lat: 30.4647, lng: -97.6938 },
    '78729': { lat: 30.4380, lng: -97.7660 },
    '78730': { lat: 30.3775, lng: -97.8214 },
    '78731': { lat: 30.3580, lng: -97.7660 },
    '78732': { lat: 30.3941, lng: -97.9024 },
    '78733': { lat: 30.3358, lng: -97.8516 },
    '78734': { lat: 30.3775, lng: -97.9480 },
    '78735': { lat: 30.2608, lng: -97.8516 },
    '78736': { lat: 30.2247, lng: -97.9024 },
    '78737': { lat: 30.1780, lng: -97.9024 },
    '78738': { lat: 30.3141, lng: -97.9774 },
    '78739': { lat: 30.1847, lng: -97.8516 },
    '78741': { lat: 30.2247, lng: -97.6938 },
    '78744': { lat: 30.1847, lng: -97.7172 },
    '78745': { lat: 30.2108, lng: -97.7874 },
    '78746': { lat: 30.2941, lng: -97.8214 },
    '78747': { lat: 30.1380, lng: -97.7172 },
    '78748': { lat: 30.1780, lng: -97.8214 },
    '78749': { lat: 30.2247, lng: -97.8516 },
    '78750': { lat: 30.4380, lng: -97.8214 },
    '78751': { lat: 30.3141, lng: -97.7172 },
    '78752': { lat: 30.3358, lng: -97.6938 },
    '78753': { lat: 30.3775, lng: -97.6694 },
    '78754': { lat: 30.3580, lng: -97.6469 },
    '78757': { lat: 30.3580, lng: -97.7404 },
    '78758': { lat: 30.3941, lng: -97.7172 },
    '78759': { lat: 30.4141, lng: -97.7660 },
    // Dallas / Fort Worth
    '75001': { lat: 32.9741, lng: -96.8360 },
    '75006': { lat: 32.9491, lng: -96.9024 },
    '75019': { lat: 32.9813, lng: -96.9774 },
    '75024': { lat: 33.0808, lng: -96.8214 },
    '75025': { lat: 33.1108, lng: -96.8516 },
    '75034': { lat: 33.1533, lng: -96.8214 },
    '75035': { lat: 33.1808, lng: -96.7660 },
    '75038': { lat: 32.8847, lng: -96.9774 },
    '75039': { lat: 32.8697, lng: -96.9480 },
    '75040': { lat: 32.9280, lng: -96.7010 },
    '75041': { lat: 32.8647, lng: -96.6694 },
    '75042': { lat: 32.9019, lng: -96.6938 },
    '75043': { lat: 32.8208, lng: -96.6469 },
    '75044': { lat: 32.9741, lng: -96.6694 },
    '75048': { lat: 32.9491, lng: -96.6094 },
    '75050': { lat: 32.7813, lng: -97.0127 },
    '75051': { lat: 32.7491, lng: -97.0419 },
    '75052': { lat: 32.6813, lng: -97.0127 },
    '75054': { lat: 32.5830, lng: -97.0127 },
    '75056': { lat: 33.1283, lng: -96.9774 },
    '75057': { lat: 33.0258, lng: -96.9774 },
    '75061': { lat: 32.8147, lng: -96.9774 },
    '75062': { lat: 32.8647, lng: -96.9480 },
    '75063': { lat: 32.9280, lng: -96.9480 },
    '75065': { lat: 33.0808, lng: -97.0419 },
    '75067': { lat: 33.0258, lng: -97.0127 },
    '75068': { lat: 33.1808, lng: -96.9480 },
    '75069': { lat: 33.0808, lng: -96.6094 },
    '75070': { lat: 33.1108, lng: -96.6694 },
    '75071': { lat: 33.1533, lng: -96.6694 },
    '75074': { lat: 33.0258, lng: -96.6938 },
    '75075': { lat: 33.0258, lng: -96.7404 },
    '75080': { lat: 32.9741, lng: -96.7404 },
    '75081': { lat: 32.9491, lng: -96.7010 },
    '75082': { lat: 32.9813, lng: -96.6694 },
    '75087': { lat: 32.9813, lng: -96.5372 },
    '75088': { lat: 32.9280, lng: -96.5866 },
    '75089': { lat: 32.9280, lng: -96.5372 },
    '75093': { lat: 33.0258, lng: -96.8214 },
    '75094': { lat: 32.9813, lng: -96.6094 },
    '75098': { lat: 32.9491, lng: -96.4891 },
    '75101': { lat: 32.3313, lng: -96.6694 },
    '75104': { lat: 32.6552, lng: -96.9480 },
    '75115': { lat: 32.6302, lng: -96.9774 },
    '75116': { lat: 32.7280, lng: -96.9774 },
    '75119': { lat: 32.3558, lng: -96.8516 },
    '75125': { lat: 32.4841, lng: -96.6469 },
    '75126': { lat: 32.7813, lng: -96.5141 },
    '75134': { lat: 32.6552, lng: -96.8516 },
    '75137': { lat: 32.6302, lng: -96.9024 },
    '75141': { lat: 32.6552, lng: -96.7404 },
    '75146': { lat: 32.5280, lng: -96.8516 },
    '75149': { lat: 32.7813, lng: -96.6694 },
    '75150': { lat: 32.8147, lng: -96.6469 },
    '75154': { lat: 32.5552, lng: -96.9774 },
    '75159': { lat: 32.6552, lng: -96.5866 },
    '75160': { lat: 32.7491, lng: -96.5372 },
    '75161': { lat: 32.7813, lng: -96.4638 },
    '75166': { lat: 33.0808, lng: -96.5372 },
    '75172': { lat: 32.5280, lng: -96.7660 },
    '75180': { lat: 32.7491, lng: -96.6469 },
    '75181': { lat: 32.7280, lng: -96.5866 },
    '75182': { lat: 32.7813, lng: -96.5866 },
    '75189': { lat: 32.9019, lng: -96.4638 },
    '75201': { lat: 32.7813, lng: -96.7874 },
    '75202': { lat: 32.7813, lng: -96.8214 },
    '75203': { lat: 32.7491, lng: -96.8214 },
    '75204': { lat: 32.8147, lng: -96.7874 },
    '75205': { lat: 32.8447, lng: -96.7874 },
    '75206': { lat: 32.8447, lng: -96.7660 },
    '75207': { lat: 32.7813, lng: -96.8516 },
    '75208': { lat: 32.7491, lng: -96.8516 },
    '75209': { lat: 32.8447, lng: -96.8214 },
    '75210': { lat: 32.7491, lng: -96.7404 },
    '75211': { lat: 32.7280, lng: -96.8838 },
    '75212': { lat: 32.7813, lng: -96.9024 },
    '75214': { lat: 32.8447, lng: -96.7172 },
    '75215': { lat: 32.7491, lng: -96.7172 },
    '75216': { lat: 32.7019, lng: -96.7874 },
    '75217': { lat: 32.7019, lng: -96.7172 },
    '75218': { lat: 32.8647, lng: -96.6938 },
    '75219': { lat: 32.8147, lng: -96.8214 },
    '75220': { lat: 32.8647, lng: -96.8838 },
    '75221': { lat: 32.7813, lng: -96.7874 },
    '75223': { lat: 32.8147, lng: -96.7404 },
    '75224': { lat: 32.7019, lng: -96.8214 },
    '75225': { lat: 32.8647, lng: -96.7874 },
    '75226': { lat: 32.7813, lng: -96.7404 },
    '75227': { lat: 32.7813, lng: -96.6938 },
    '75228': { lat: 32.8147, lng: -96.6694 },
    '75229': { lat: 32.8847, lng: -96.8838 },
    '75230': { lat: 32.9019, lng: -96.7874 },
    '75231': { lat: 32.8847, lng: -96.7172 },
    '75232': { lat: 32.6813, lng: -96.8516 },
    '75233': { lat: 32.6813, lng: -96.8838 },
    '75234': { lat: 32.9280, lng: -96.9024 },
    '75235': { lat: 32.8147, lng: -96.8838 },
    '75236': { lat: 32.6813, lng: -96.9024 },
    '75237': { lat: 32.6552, lng: -96.8838 },
    '75238': { lat: 32.8847, lng: -96.7172 },
    '75240': { lat: 32.9280, lng: -96.7874 },
    '75241': { lat: 32.6552, lng: -96.7660 },
    '75243': { lat: 32.9019, lng: -96.7172 },
    '75244': { lat: 32.9280, lng: -96.8516 },
    '75246': { lat: 32.8147, lng: -96.7660 },
    '75247': { lat: 32.8147, lng: -96.9024 },
    '75248': { lat: 32.9741, lng: -96.7874 },
    '75249': { lat: 32.6302, lng: -96.9774 },
    '75251': { lat: 32.9019, lng: -96.7660 },
    '75252': { lat: 33.0258, lng: -96.7660 },
    '75253': { lat: 32.6813, lng: -96.6694 },
    '75254': { lat: 32.9491, lng: -96.8214 },
    // Lafayette LA area
    '70501': { lat: 30.2241, lng: -92.0198 }, // Lafayette
    '70502': { lat: 30.2241, lng: -92.0198 },
    '70503': { lat: 30.1780, lng: -92.0198 },
    '70504': { lat: 30.2241, lng: -92.0198 },
    '70505': { lat: 30.2641, lng: -92.0198 },
    '70506': { lat: 30.2108, lng: -92.0751 },
    '70507': { lat: 30.2841, lng: -91.9774 },
    '70508': { lat: 30.1647, lng: -92.0751 },
    '70510': { lat: 30.0180, lng: -92.1941 }, // Abbeville area
    '70512': { lat: 30.3780, lng: -91.8838 }, // Arnaudville
    '70515': { lat: 30.2241, lng: -92.4131 }, // Basile
    '70516': { lat: 30.3447, lng: -91.9774 }, // Breaux Bridge area
    '70517': { lat: 30.3947, lng: -91.9024 }, // Breaux Bridge
    '70518': { lat: 30.1247, lng: -92.0419 }, // Broussard
    '70519': { lat: 30.1647, lng: -92.1308 }, // Carencro area
    '70520': { lat: 30.3141, lng: -92.0419 }, // Carencro
    '70521': { lat: 30.3447, lng: -91.8516 }, // Cecilia
    '70522': { lat: 29.7597, lng: -91.6694 }, // Centerville
    '70523': { lat: 29.8858, lng: -91.6469 }, // Charenton
    '70524': { lat: 30.3780, lng: -92.1308 }, // Chataignier
    '70525': { lat: 30.2641, lng: -92.2354 }, // Church Point
    '70526': { lat: 30.0041, lng: -92.3836 }, // Crowley
    '70527': { lat: 30.0180, lng: -92.3469 },
    '70528': { lat: 29.9719, lng: -91.9774 }, // Delcambre
    '70529': { lat: 30.2108, lng: -92.1308 }, // Duson
    '70531': { lat: 30.1847, lng: -92.4469 }, // Egan
    '70532': { lat: 30.2241, lng: -92.6469 }, // Elton
    '70533': { lat: 29.9458, lng: -91.9480 }, // Erath
    '70534': { lat: 30.2241, lng: -92.4638 }, // Eunice area
    '70535': { lat: 30.4941, lng: -92.4131 }, // Eunice
    '70537': { lat: 30.1247, lng: -92.3836 }, // Estherwood
    '70538': { lat: 29.7958, lng: -91.5372 }, // Franklin
    '70541': { lat: 30.5441, lng: -92.2721 }, // Grand Coteau
    '70542': { lat: 30.0441, lng: -92.5141 }, // Gueydan
    '70543': { lat: 30.1647, lng: -92.5372 }, // Iota
    '70544': { lat: 29.9458, lng: -91.8214 }, // Jeanerette
    '70546': { lat: 30.2841, lng: -92.6694 }, // Jennings
    '70548': { lat: 29.8619, lng: -92.1308 }, // Kaplan
    '70549': { lat: 30.2241, lng: -93.0127 }, // Lake Arthur
    '70550': { lat: 30.5180, lng: -92.1308 }, // Lawtell
    '70551': { lat: 30.4641, lng: -91.9480 }, // Leonville
    '70552': { lat: 30.0980, lng: -91.7010 }, // Loreauville
    '70554': { lat: 30.4380, lng: -92.3469 }, // Mamou
    '70555': { lat: 30.1247, lng: -92.2354 }, // Maurice
    '70556': { lat: 30.2641, lng: -92.7010 }, // Mermentau
    '70558': { lat: 30.1047, lng: -92.1941 }, // Milton
    '70559': { lat: 30.0741, lng: -92.4131 }, // Morse
    '70560': { lat: 29.9869, lng: -91.8516 }, // New Iberia
    '70562': { lat: 29.9719, lng: -91.7874 },
    '70563': { lat: 30.0380, lng: -91.8214 },
    '70569': { lat: 29.9319, lng: -91.7172 }, // Olivier
    '70570': { lat: 30.5480, lng: -92.0988 }, // Opelousas
    '70571': { lat: 30.5180, lng: -92.0419 },
    '70575': { lat: 29.8869, lng: -91.9774 }, // Perry
    '70576': { lat: 30.5741, lng: -92.4131 }, // Pine Prairie
    '70577': { lat: 30.5947, lng: -91.9480 }, // Port Barre
    '70578': { lat: 30.2641, lng: -92.3469 }, // Rayne
    '70580': { lat: 30.5641, lng: -92.5866 }, // Reddell
    '70581': { lat: 30.2241, lng: -92.7010 }, // Roanoke
    '70582': { lat: 30.4080, lng: -91.8214 }, // Saint Martinville
    '70583': { lat: 30.3480, lng: -92.0988 }, // Scott
    '70584': { lat: 30.5180, lng: -92.2721 }, // Sunset
    '70585': { lat: 31.1247, lng: -92.6469 }, // Turkey Creek
    '70586': { lat: 30.6480, lng: -92.2354 }, // Ville Platte
    '70589': { lat: 30.6980, lng: -92.0419 }, // Washington
    '70591': { lat: 30.2241, lng: -93.2354 }, // Welsh
    '70592': { lat: 30.1447, lng: -92.1941 }, // Youngsville
    '70593': { lat: 30.2241, lng: -92.0198 },
    '70594': { lat: 30.2241, lng: -92.0198 },
    '70595': { lat: 30.2241, lng: -92.0198 },
    '70596': { lat: 30.2241, lng: -92.0198 },
    // Baton Rouge
    '70801': { lat: 30.4515, lng: -91.1874 },
    '70802': { lat: 30.4313, lng: -91.1516 },
    '70803': { lat: 30.4147, lng: -91.1780 },
    '70804': { lat: 30.4515, lng: -91.1874 },
    '70805': { lat: 30.4941, lng: -91.1152 },
    '70806': { lat: 30.4647, lng: -91.1308 },
    '70807': { lat: 30.5080, lng: -91.1780 },
    '70808': { lat: 30.4180, lng: -91.1516 },
    '70809': { lat: 30.3980, lng: -91.0835 },
    '70810': { lat: 30.3513, lng: -91.0419 },
    '70811': { lat: 30.5380, lng: -91.0835 },
    '70812': { lat: 30.5180, lng: -91.1152 },
    '70814': { lat: 30.4980, lng: -91.0835 },
    '70815': { lat: 30.4647, lng: -91.0835 },
    '70816': { lat: 30.4313, lng: -91.0419 },
    '70817': { lat: 30.3647, lng: -91.0127 },
    '70818': { lat: 30.5680, lng: -91.0419 },
    '70819': { lat: 30.4647, lng: -91.0419 },
    '70820': { lat: 30.3847, lng: -91.1308 },
    '70821': { lat: 30.4515, lng: -91.1874 },
    '70825': { lat: 30.4515, lng: -91.1874 },
    '70826': { lat: 30.4515, lng: -91.1874 },
    // New Orleans
    '70112': { lat: 29.9511, lng: -90.0715 },
    '70113': { lat: 29.9358, lng: -90.0835 },
    '70114': { lat: 29.9047, lng: -90.0419 },
    '70115': { lat: 29.9358, lng: -90.1152 },
    '70116': { lat: 29.9597, lng: -90.0419 },
    '70117': { lat: 29.9597, lng: -90.0127 },
    '70118': { lat: 29.9597, lng: -90.1308 },
    '70119': { lat: 29.9813, lng: -90.0835 },
    '70121': { lat: 29.9813, lng: -90.1516 },
    '70122': { lat: 30.0041, lng: -89.9774 },
    '70123': { lat: 29.9813, lng: -90.2158 },
    '70124': { lat: 30.0041, lng: -90.0835 },
    '70125': { lat: 29.9597, lng: -90.1308 },
    '70126': { lat: 30.0041, lng: -90.0127 },
    '70127': { lat: 30.0180, lng: -89.9480 },
    '70128': { lat: 30.0180, lng: -89.9127 },
    '70129': { lat: 30.0380, lng: -89.8516 },
    '70130': { lat: 29.9358, lng: -90.0835 },
    '70131': { lat: 29.9047, lng: -89.9774 },
    // Shreveport
    '71101': { lat: 32.5252, lng: -93.7502 },
    '71103': { lat: 32.5069, lng: -93.7874 },
    '71104': { lat: 32.4847, lng: -93.7172 },
    '71105': { lat: 32.4547, lng: -93.6938 },
    '71106': { lat: 32.4247, lng: -93.7404 },
    '71107': { lat: 32.5869, lng: -93.8214 },
    '71108': { lat: 32.4847, lng: -93.7874 },
    '71109': { lat: 32.5069, lng: -93.8516 },
    '71110': { lat: 32.5480, lng: -93.6694 },
    '71111': { lat: 32.5869, lng: -93.7172 },
    '71112': { lat: 32.4547, lng: -93.6469 },
    '71115': { lat: 32.4047, lng: -93.6694 },
    '71118': { lat: 32.4247, lng: -93.8214 },
    '71119': { lat: 32.4847, lng: -93.9024 },
    '71129': { lat: 32.4247, lng: -93.9774 },
  };

  // Haversine formula — returns distance in miles between two lat/lng points
  function haversineDistance(lat1, lng1, lat2, lng2) {
    var R = 3958.8; // Earth radius in miles
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Check distance from customer zip to store
  var storeId = String(dealerId || dealerIdFromUrl || '');
  var storeCoords = STORE_COORDS[storeId];
  var customerCoords = customerZip ? ZIP_COORDS[customerZip] : null;
  var distanceMiles = null;
  if (storeCoords && customerCoords) {
    distanceMiles = haversineDistance(storeCoords.lat, storeCoords.lng, customerCoords.lat, customerCoords.lng);
  }

  // Distance buyer: >100 miles by zip, OR out of state (as fallback when zip not in table)
  var LA_DEALER_IDS = ['24399', '21135'];
  var storeState = LA_DEALER_IDS.indexOf(storeId) !== -1 ? 'LA' : 'TX';
  var isDistanceBuyer = false;
  if (distanceMiles !== null) {
    isDistanceBuyer = distanceMiles > 100;
  } else if (customerState) {
    isDistanceBuyer = customerState !== storeState;
  }

  const result = {
    isLeadFrame, isEccsFrame, autoLeadId, dealerId: dealerId || dealerIdFromUrl, customerId,
    store, storeConfident,
    name, email, phone,
    agent: agentFallback || agent, salesRep, manager,
    customerState, isDistanceBuyer,
    vehicle: isEccsFrame ? '' : vehicle,  // ECCS frame never sets vehicle — it's the customer profile, not the lead
    vehicleRaw, color, condition,
    stockNum, vin, inventoryWarning,
    leadSource, leadStatus,
    hasTrade, tradeDescription,
    ownedVehicle, ampEmailSubject, ownedMileage, lastServiceDate,
    buyingSignals,
    history, totalNoteCount,
    leadAgeDays, isContacted, hasOutbound, convState,
    frameUrl: URL,
    // ── SCRAPER VERSION — BUMP THIS when scraper logic changes ──────────────────
    // Must match REQUIRED_SCRAPER in popup.js. Bumping invalidates all cached
    // storage data and forces a clean re-scrape on next lead load.
    // Format: 'vMAJOR.MINOR.PATCH' — bump patch for small changes, minor for
    // significant scraper changes (new fields, VIN logic, note parsing, etc.)
    scraperVersion: 'v9.7.51', // ← bump here when scraper changes
    scrapedAt: Date.now()
  };

  console.log('[Lead Pro] Frame scraped:', URL.substring(0,60), {
    name, agent, vehicle, leadSource, store, storeConfident, dealerId, isLeadFrame
  });

  // (v9.7.46 architecture) NO storage write here. Frame results stay in this
  // frame's memory only, exposed via SCRAPE_NOW message handler at the bottom
  // of this file. Popup pulls fresh data from each frame on demand at Grab time.
  // This eliminates the cross-frame storage race that was producing
  // mixed-lead state in the panel.

  // ── Useful-frame check ──────────────────────────────────────────
  // Frames that contain identity data benefit from delayed re-extraction
  // attempts (Cox renders BD Agent / Customer Name asynchronously).
  var usefulFrame = isLeadFrame
    || URL.includes('rims2.aspx')
    || URL.includes('CustomerDashboard')
    || URL.includes('eccs/index.html');

  // Re-extract identity fields (agent, salesRep, manager, name) from current DOM.
  // VinSolutions React variants render these AFTER document_idle, so the original
  // result snapshot may have empty values. This function re-reads the DOM live.
  function reExtractIdentity() {
    _rowCache = null; // Invalidate row cache so labelValue() re-queries fresh DOM
    try {
      var freshAgent = firstId([
        'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedBDAgentLabel',
        'ActiveLeadPanel1_m_CurrentAssignedBDAgentLabel'
      ]) || firstSel([
        '[id*="CurrentAssignedBDAgent" i]',
        '[id*="AssignedBDAgent" i]',
        '[id*="BDAgentLabel" i]',
        '[id*="BDAgent" i]',
        '[data-label="BD Agent" i]',
        '[data-field*="BDAgent" i]'
      ]) || labelValue('BD Agent') || labelValue('BDAgent') || labelValue('BD');
      var freshSalesRep = firstId([
        'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedUserLabel',
        'ActiveLeadPanel1_m_CurrentAssignedUserLabel'
      ]) || firstSel([
        '[id*="CurrentAssignedUser" i]',
        '[id*="AssignedUserLabel" i]',
        '[id*="SalesRep" i]',
        '[id*="AssignedSalesRep" i]'
      ]) || labelValue('Sales Rep');
      var freshManager = firstId([
        'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedManagerLabel',
        'ActiveLeadPanel1_m_CurrentAssignedManagerLabel'
      ]) || firstSel([
        '[id*="CurrentAssignedManager" i]',
        '[id*="AssignedManagerLabel" i]',
        '[id*="ManagerLabel" i]'
      ]) || labelValue('Manager');
      var freshName = firstId([
        'ActiveLeadPanelWONotesAndHistory1_m_CustomerNameLabel',
        'ActiveLeadPanel1_m_CustomerNameLabel'
      ]) || firstSel([
        '[id*="CustomerName" i]',
        '[id*="BuyerName" i]'
      ]);
      // Reject obvious labels and too-short values
      function clean(v) {
        if (!v) return '';
        var t = v.trim();
        if (t.length < 3) return '';
        if (/^(Status|Manager|Source|Sales\s*Rep|BD\s*Agent|Created|Contacted|None)[:\s]/i.test(t)) return '';
        return t;
      }
      return {
        agent: clean(freshAgent),
        salesRep: clean(freshSalesRep),
        manager: clean(freshManager),
        name: clean(freshName)
      };
    } catch(e) { return { agent: '', salesRep: '', manager: '', name: '' }; }
  }

  // Patch the cached result with any newly-found identity fields.
  // Only fills empty fields — never overwrites a value the original scrape captured.
  // Updates this frame's local `result` variable; popup reads it via SCRAPE_NOW.
  function patchIdentityIntoResult() {
    var fresh = reExtractIdentity();
    var changed = false;
    if (!result.agent && fresh.agent) { result.agent = fresh.agent; changed = true; }
    if (!result.salesRep && fresh.salesRep) { result.salesRep = fresh.salesRep; changed = true; }
    if (!result.manager && fresh.manager) { result.manager = fresh.manager; changed = true; }
    if (!result.name && fresh.name) { result.name = fresh.name; changed = true; }
    if (changed) {
      console.log('[Lead Pro] Identity re-extracted from late render:', { agent: result.agent, salesRep: result.salesRep, name: result.name });
    }
    return changed;
  }

  // Schedule delayed re-extractions — Cox's React variant typically populates
  // identity fields within 1-7 seconds after document_idle. Try at multiple
  // checkpoints to catch fast and slow renders alike.
  if (usefulFrame) {
    setTimeout(patchIdentityIntoResult, 1000);
    setTimeout(patchIdentityIntoResult, 2000);
    setTimeout(patchIdentityIntoResult, 3500);
    setTimeout(patchIdentityIntoResult, 5000);
    setTimeout(patchIdentityIntoResult, 7000);
  }

  // (v9.7.46) MutationObserver and shared-storage writes removed. Each frame
  // keeps its scrape result in local memory only. Popup re-runs executeScript
  // across all frames when it needs fresh data (initial Grab + rescue paths).
  // The SCRAPE_NOW handler below is retained for possible future use but is
  // not currently called by popup.js.

  // ── Respond to live requests from popup ─────────────────────────
  // On scrape-now request, attempt fresh identity extraction first so we return
  // the most current state even if document_idle missed late-rendered fields.
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.type === 'LEADPRO_SCRAPE_NOW') {
      if (!result.agent || !result.salesRep || !result.name) patchIdentityIntoResult();
      sendResponse(result);
    }
    if (msg && msg.type === 'LEADPRO_FORCE_RESCRAPE_IDENTITY') {
      // Popup is in rescue-polling mode — try fresh DOM extraction NOW
      // regardless of our own setTimeout schedule. Critical for variants where
      // identity fields render minutes after document_idle.
      if (usefulFrame && (!result.agent || !result.salesRep || !result.name)) {
        patchIdentityIntoResult();
      }
    }
    return true;
  });

})();
