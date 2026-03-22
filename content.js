// ─────────────────────────────────────────────────────────────────
// Lead Pro — content.js  v4.8
// Runs in EVERY frame. Each frame contributes what it can find.
// Customer name lives in left pane. Lead Info (agent, source,
// vehicle) lives in right pane. Both frames write to storage
// and popup.js merges them.
// ─────────────────────────────────────────────────────────────────
(function() {
  'use strict';
  if (!document.body) return;

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
  function labelValue(labelText) {
    try {
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;
        const label = (cells[0].innerText || cells[0].textContent || '').trim();
        if (label.toLowerCase().replace(/[:\s]/g,'').includes(labelText.toLowerCase().replace(/[:\s]/g,''))) {
          const valEl = cells[1].querySelector('span') || cells[1];
          const v = (valEl.innerText || valEl.textContent || '').trim();
          if (v && v !== 'None' && v !== 'none' && v.length > 0) return v;
        }
      }
    } catch(e) {}
    return '';
  }

  const URL  = window.location.href;
  const TEXT = (document.body.innerText || document.body.textContent || '').substring(0, 12000);

  function textAfterLabel(label) {
    const rx = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[:\\s]+([^\\n\\r]{2,60})', 'i');
    const m  = TEXT.match(rx);
    return m ? m[1].trim() : '';
  }

  // ── Frame identity ──────────────────────────────────────────────
  const debugEl    = document.getElementById('vindebug-section-wrap');
  const debugInner = debugEl ? debugEl.querySelector('.vindebug-section') : null;
  const autoLeadId = debugInner ? (debugInner.getAttribute('data-autoleadid') || '') : '';
  const dealerId   = debugInner ? (debugInner.getAttribute('data-dealerid')   || '') : '';
  const customerId = debugInner ? (debugInner.getAttribute('data-globalcustomerid') || '') : '';
  const isLeadFrame = !!autoLeadId;
  const isCustomerDashboard = URL.includes('CustomerDashboard') || URL.includes('DeskLog') || isLeadFrame;

  var ownedVehicle = '';
  var ampEmailSubject = '';
  var ownedMileage = '';
  var lastServiceDate = '';

  // Log full URL when in eccs frame
  if (URL.includes('eccs/index.html')) {
    console.log('[Lead Pro] ECCS full URL:', URL);
    try {
      var eccsHTML = (document.body ? document.body.innerHTML || '' : '');
      var eccsText = (document.body ? document.body.innerText || '' : '');

      if(!ownedVehicle) {
        var ymmHtmlMatch = eccsHTML.match(/Y\/M\/M[:\s]*<\/td>\s*<td[^>]*>([^<]{5,60})<\/td>/i);
        if(ymmHtmlMatch) {
          var ymmCand = ymmHtmlMatch[1].trim();
          if(/\d{4}\s+[A-Za-z]/.test(ymmCand)) ownedVehicle = ymmCand.substring(0,60);
        }
      }
      if(!ownedVehicle) {
        var gridMatch = eccsHTML.match(/rgRow[^>]*>[\s\S]{0,200}?<td[^>]*>[\s\S]{0,100}?<\/td><td[^>]*>(20\d\d\s+[A-Za-z][^<]{3,40})<\/td>/i);
        if(gridMatch) ownedVehicle = gridMatch[1].trim().substring(0,60);
      }
      if(!ownedVehicle) {
        var tvMatch = eccsText.match(/(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru|Acura|Lexus)[^\n]{2,30})/i);
        if(tvMatch) ownedVehicle = tvMatch[1].trim().replace(/\s+/g,' ').substring(0,60);
      }
      if(!ampEmailSubject) {
        var ampHtmlMatch = eccsHTML.match(/lastcontacttitlelink[^>]*>[^<]*Marketing Campaign Email[^<]*\(subject[:\s]*([^\)<]{5,100})\)/i);
        if(ampHtmlMatch) ampEmailSubject = ampHtmlMatch[1].trim().substring(0,100);
      }
      if(!ampEmailSubject) {
        var ampTxtMatch = eccsText.match(/Marketing Campaign Email[^\n]*\(subject[:\s]*([^\)\n]{5,100})\)/i);
        if(ampTxtMatch) ampEmailSubject = ampTxtMatch[1].trim().substring(0,100);
      }
      var mileageMatch = eccsHTML.match(/Mileage[:\s]*<\/td>\s*<td[^>]*>([0-9,]{3,10})<\/td>/i);
      if(mileageMatch) ownedMileage = mileageMatch[1].replace(/,/g,'').trim();
      var lastSvcMatch = eccsHTML.match(/rgRow[^>]*>[\s\S]{0,400}?<td[^>]*>\s*(\d{1,2}\/\d{1,2}\/\d{2,4}[^<]*)<\/td>/i);
      if(lastSvcMatch) lastServiceDate = lastSvcMatch[1].trim().substring(0,20);
      console.log('[Lead Pro] ECCS scrape result:', { ownedVehicle: ownedVehicle, ampEmailSubject: ampEmailSubject, ownedMileage: ownedMileage, lastServiceDate: lastServiceDate });
    } catch(e) { console.log('[Lead Pro] ECCS scrape error:', e.message); }
  }

  console.log('[Lead Pro] content.js in frame:', URL.substring(0,80), '| isLeadFrame:', isLeadFrame, '| vindebug:', autoLeadId);

  // ── Store ────────────────────────────────────────────────────────
  const dealerIdFromUrl = (URL.match(/[?&]dealerId=(\d+)/i)||[])[1] || '';
  const dealerNameFromUrl = (URL.match(/[?&]dealerName=([^&]+)/i)||[])[1];
  const dealerNameDecoded = dealerNameFromUrl ? decodeURIComponent(dealerNameFromUrl) : '';

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

  // ── Customer name ────────────────────────────────────────────────
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
  const detailEl = document.querySelector('.CustomerInfo_CustomerDetail,[id*="_CustomerDetail"]');
  let phone = '';
  if (detailEl) {
    const m = (detailEl.innerText || '').match(/(?:C|H|W|M|Cell|Home|Work|Eve)[:\s]+([\(\d][\d\(\)\-\. ]{7,18})/i);
    if (m) phone = m[1].replace(/[^\d\(\)\-\. ]/g,'').trim();
  }

  // ── BD Agent ────────────────────────────────────────────────────
  const agent = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedBDAgentLabel',
    'ActiveLeadPanel1_m_CurrentAssignedBDAgentLabel'
  ]) || firstSel([
    'span[id*="BDAgentLabel"]',
    'span[id*="AssignedBDAgent"]',
    'span[id*="CurrentAssignedBDAgent"]'
  ]) || labelValue('BD Agent');

  // ── Sales Rep ────────────────────────────────────────────────────
  const salesRep = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedUserLabel',
    'ActiveLeadPanel1_m_CurrentAssignedUserLabel'
  ]) || firstSel([
    'span[id*="CurrentAssignedUser"]',
    'span[id*="AssignedUserLabel"]'
  ]) || labelValue('Sales Rep');

  // ── Manager ──────────────────────────────────────────────────────
  const manager = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_CurrentAssignedManagerLabel',
    'ActiveLeadPanel1_m_CurrentAssignedManagerLabel'
  ]) || labelValue('Manager');

  // ── Vehicle ──────────────────────────────────────────────────────
  const vehicleRaw = firstId([
    'ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo',
    'ActiveLeadPanel1_m_VehicleInfo'
  ]) || firstSel([
    'span[id*="VehicleInfo"].leadinfodetails',
    'span[id*="VehicleInfo"]',
    '.leadinfodetails'
  ]);
  const vehicle   = vehicleRaw.replace(/\s*\((New|Used|CPO|Pre-Owned|Certified)\)\s*/gi,'').trim();
  const condition = /\(New\)/i.test(vehicleRaw) ? 'New'
    : /Used|Pre-Owned|CPO|Certified/i.test(vehicleRaw) ? 'Pre-Owned' : '';

  // ── Color ────────────────────────────────────────────────────────
  const color = (TEXT.match(/Color[:\s]+([A-Za-z ]{3,25})(?:\n|Mfr|Stock|VIN|Warning|\s{3})/i) || [])[1] || '';

  // ── Stock / VIN ──────────────────────────────────────────────────
  const stockNum = (TEXT.match(/Stock\s*#?[:\s]*([A-Z]?\d{3,6}[A-Z0-9]*)\b/i) || [])[1] || '';
  const vin      = (TEXT.match(/\bVIN[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i) || [])[1] || '';

  // ── Inventory warning ────────────────────────────────────────────
  const inventoryWarning = /no longer in your active inventory/i.test(TEXT);

  // ── Lead source ──────────────────────────────────────────────────
  const leadSource = firstId([
    'ActiveLeadPanelWONotesAndHistory1__LeadSourceName',
    'ActiveLeadPanel1__LeadSourceName'
  ]) || firstSel([
    'span[id*="LeadSourceName"]',
    'span[id*="_LeadSourceName"]'
  ]) || labelValue('Source');

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
    if (d||t||c) histLines.push('['+d+'] ['+who+'] '+t+': '+c);
  });
  const history = histLines.join('\n');
  const totalNoteCount = noteEls.length;

  // ── Owned vehicle from service/sales history ─────────────────────
  try {
    var bodyText = (document.body ? document.body.innerText || '' : '');
    var ymmM = bodyText.match(/Y\/M\/M[:\s]+(\d{4}\s+[A-Za-z][^\n]{3,40})/i);
    if(ymmM) ownedVehicle = ymmM[1].trim().substring(0,60);
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
    if(!ownedVehicle) {
      var soldM = bodyText.match(/Sold\b[^\n]{0,100}(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru)[^\n]{3,40})/i);
      if(soldM) ownedVehicle = soldM[1].trim().replace(/\s+/g,' ').substring(0,60);
    }
    var ampM = bodyText.match(/Marketing Campaign Email[^\n]*subject[:\s]+([^\n\)]{5,100})/i);
    if(ampM) ampEmailSubject = ampM[1].replace(/[)\]]/g,'').trim().substring(0,100);
  } catch(e) {}

  if(!ownedVehicle && /rims2/i.test(URL)) {
    try {
      var rimsText = (document.body ? document.body.innerText || '' : '');
      var rimsVehicleMatch = rimsText.match(/(\d{4}\s+(?:Toyota|Honda|Kia|Hyundai|Ford|Chevy|Chevrolet|GMC|Dodge|Nissan|Jeep|Mazda|Subaru|Acura|Lexus|Infiniti|BMW|Mercedes|Audi|Volkswagen)[^\n]{2,30})/i);
      if(rimsVehicleMatch) ownedVehicle = rimsVehicleMatch[1].trim().replace(/\s+/g,' ').substring(0,60);
      if(!ampEmailSubject) {
        var rimsAmpMatch = rimsText.match(/Marketing Campaign Email[^\n]*subject[:\s]+([^\n\)]{5,100})/i);
        if(rimsAmpMatch) ampEmailSubject = rimsAmpMatch[1].replace(/[)\]]/g,'').trim().substring(0,100);
      }
    } catch(e2) {}
  }

  if(ownedVehicle || ampEmailSubject) console.log('[Lead Pro] content.js found:', { ownedVehicle: ownedVehicle, ampEmailSubject: ampEmailSubject, frame: URL.substring(0,60) });

  // ── Only write to storage if this frame found something ─────────
  const hasData = !!(name || agent || vehicle || leadSource || autoLeadId || store || ownedVehicle || ampEmailSubject);
  if (!hasData) {
    console.log('[Lead Pro] Frame has no useful data, skipping storage write');
    return;
  }

  const result = {
    isLeadFrame, autoLeadId, dealerId: dealerId || dealerIdFromUrl, customerId,
    store, storeConfident,
    name, email, phone,
    agent, salesRep, manager,
    vehicle, vehicleRaw, color, condition,
    stockNum, vin, inventoryWarning,
    leadSource, leadStatus,
    hasTrade, tradeDescription,
    ownedVehicle, ampEmailSubject, ownedMileage, lastServiceDate,
    history, totalNoteCount,
    frameUrl: URL,
    scrapedAt: Date.now()
  };

  console.log('[Lead Pro] Writing to storage from frame:', URL.substring(0,60), {
    name, agent, vehicle, leadSource, store, storeConfident, dealerId
  });

  // ── Merge with storage — lead frames win on conflicts ───────────
  chrome.storage.local.get(['leadpro_data'], function(existing) {
    const prev = (existing && existing.leadpro_data) || {};
    if (autoLeadId && prev.autoLeadId && prev.autoLeadId !== autoLeadId) {
      chrome.storage.local.set({ leadpro_data: result });
      return;
    }
    const merged = Object.assign({}, prev);
    for (const k of Object.keys(result)) {
      if (k === 'hasTrade' || k === 'inventoryWarning' || k === 'isLeadFrame') {
        if (result[k]) merged[k] = true;
      } else if (k === 'scrapedAt') {
        merged[k] = result[k];
      } else if (k === 'store') {
        if (result.storeConfident && result.store) {
          merged.store = result.store;
          merged.storeConfident = true;
        } else if (!merged.storeConfident && result.store) {
          merged.store = result.store;
        }
      } else if (k === 'storeConfident') {
        if (result[k]) merged[k] = true;
      } else if (k === 'history' || k === 'totalNoteCount') {
        const prevCount = merged.totalNoteCount || 0;
        const thisCount = result.totalNoteCount || 0;
        if (thisCount > prevCount) {
          merged.history = result.history;
          merged.totalNoteCount = result.totalNoteCount;
        }
      } else if (k === 'pageSnippet') {
        // not used here
      } else {
        if (isLeadFrame && result[k]) {
          merged[k] = result[k];
        } else if (!merged[k] && result[k]) {
          merged[k] = result[k];
        }
      }
    }
    chrome.storage.local.set({ leadpro_data: merged });
    console.log('[Lead Pro] Storage updated:', { name: merged.name, agent: merged.agent, store: merged.store, storeConfident: merged.storeConfident, dealerId: merged.dealerId, ownedVehicle: merged.ownedVehicle, ampEmailSubject: merged.ampEmailSubject, ownedMileage: merged.ownedMileage, lastServiceDate: merged.lastServiceDate });
  });

  // ── Respond to live requests from popup ─────────────────────────
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.type === 'LEADPRO_SCRAPE_NOW') {
      sendResponse(result);
    }
    return true;
  });
})();
