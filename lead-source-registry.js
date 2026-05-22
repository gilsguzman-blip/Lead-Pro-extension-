/**
 * Lead Pro — Lead Source Registry
 * Version: 1.0.0
 *
 * Transforms the hardcoded classifyScenario regex chain into a data-driven
 * system. Each dealer uploads their CRM lead source strings and maps them
 * to standardized scenario categories.
 *
 * Architecture:
 *   SCENARIO_LIBRARY     — canonical list of all available scenarios
 *   DEFAULT_MATCH_RULES  — built-in fuzzy matching (covers 95% of common sources)
 *   DealerSourceRegistry — per-dealer custom mappings stored in chrome.storage.sync
 */

const LEADPRO_REGISTRY = (function() {

  // ─── Scenario Library ────────────────────────────────────────────────────────
  // These are the canonical scenario categories Lead Pro knows how to handle.
  // Each has: id, label, description, priority, tone guidance, close strategy.

  const SCENARIO_LIBRARY = {

    // ── High-intent digital tools ──────────────────────────────────────────────
    click_and_go: {
      id: 'click_and_go',
      label: 'Click & Go / Virtual Retailing',
      description: 'Customer started an online deal, credit app, or payment tool',
      priority: 10,
      group: 'digital',
      tone: 'confident, fast, frame the visit as the finish line',
      close: 'two_times',
      tags: ['high_intent', 'digital', 'appointment_ready']
    },
    chat_lead: {
      id: 'chat_lead',
      label: 'Live Chat Lead',
      description: 'Customer chatted on the dealer website or marketplace',
      priority: 11,
      group: 'digital',
      tone: 'warm continuation — they already know you. Pick up where chat left off.',
      close: 'two_times',
      tags: ['warm', 'digital']
    },
    credit_app: {
      id: 'credit_app',
      label: 'Credit Application',
      description: 'Customer submitted a standalone credit application',
      priority: 9,
      group: 'digital',
      tone: 'confident and ready. Acknowledge the application. Frame as nearly done.',
      close: 'two_times',
      tags: ['high_intent', 'finance']
    },

    // ── Third-party marketplaces ───────────────────────────────────────────────
    cargurus: {
      id: 'cargurus',
      label: 'CarGurus',
      description: 'Lead from CarGurus marketplace listing',
      priority: 20,
      group: 'marketplace',
      tone: 'direct, validate the listing, confirm availability, move to appointment',
      close: 'two_times',
      tags: ['marketplace', 'price_sensitive']
    },
    cargurus_digital: {
      id: 'cargurus_digital',
      label: 'CarGurus Digital Deal',
      description: 'Customer started a digital deal through CarGurus',
      priority: 12,
      group: 'marketplace',
      tone: 'high intent — customer already engaged with pricing tool. Confirm and close.',
      close: 'two_times',
      tags: ['high_intent', 'marketplace', 'digital']
    },
    autotrader: {
      id: 'autotrader',
      label: 'AutoTrader',
      description: 'Lead from AutoTrader marketplace',
      priority: 21,
      group: 'marketplace',
      tone: 'direct, confirm the vehicle, move to visit',
      close: 'two_times',
      tags: ['marketplace']
    },
    cars_com: {
      id: 'cars_com',
      label: 'Cars.com',
      description: 'Lead from Cars.com marketplace',
      priority: 22,
      group: 'marketplace',
      tone: 'direct, confirm the vehicle, move to visit',
      close: 'two_times',
      tags: ['marketplace']
    },
    edmunds: {
      id: 'edmunds',
      label: 'Edmunds',
      description: 'Lead from Edmunds marketplace',
      priority: 23,
      group: 'marketplace',
      tone: 'research-oriented buyer — lead with value, then appointment',
      close: 'two_times',
      tags: ['marketplace', 'research_phase']
    },
    truecar: {
      id: 'truecar',
      label: 'TrueCar',
      description: 'Lead from TrueCar — certificate-based pricing',
      priority: 15,
      group: 'marketplace',
      tone: 'acknowledge TrueCar price. Confirm we honor it. Make the visit easy.',
      close: 'two_times',
      tags: ['marketplace', 'price_committed']
    },
    carfax: {
      id: 'carfax',
      label: 'CarFax / AutoCheck',
      description: 'Lead from vehicle history report site',
      priority: 25,
      group: 'marketplace',
      tone: 'research buyer. They already vetted the vehicle. Move to visit.',
      close: 'two_times',
      tags: ['marketplace', 'research_phase']
    },
    kbb: {
      id: 'kbb',
      label: 'Kelley Blue Book / KBB ICO',
      description: 'Trade valuation lead from KBB',
      priority: 18,
      group: 'trade',
      tone: 'lead with trade. Appraisal is the hook. Buying new is secondary.',
      close: 'trade_appraisal',
      tags: ['trade', 'value_focused']
    },
    tradepending: {
      id: 'tradepending',
      label: 'TradePending',
      description: 'Trade valuation lead from TradePending tool',
      priority: 19,
      group: 'trade',
      tone: 'lead with trade value. Get them in for the appraisal.',
      close: 'trade_appraisal',
      tags: ['trade']
    },

    // ── Dealer website ─────────────────────────────────────────────────────────
    dealer_website: {
      id: 'dealer_website',
      label: 'Dealer Website',
      description: 'Direct website inquiry — highest intent',
      priority: 8,
      group: 'website',
      tone: 'high intent — they came directly to you. Confident, specific, close fast.',
      close: 'two_times',
      tags: ['high_intent', 'direct']
    },
    phone_up: {
      id: 'phone_up',
      label: 'Phone / Inbound Call',
      description: 'Customer called in — warm lead',
      priority: 7,
      group: 'website',
      tone: 'follow up on the call. Reference it naturally. Do not re-introduce.',
      close: 'two_times',
      tags: ['warm', 'call']
    },

    // ── OEM / Loyalty programs ─────────────────────────────────────────────────
    kfa_loyalty: {
      id: 'kfa_loyalty',
      label: 'KFA In-Equity / Loyalty',
      description: 'Kia Finance America end-of-loan or loyalty program',
      priority: 5,
      group: 'loyalty',
      tone: 'warm transition. Lead with equity. Not a cold pitch.',
      close: 'two_times',
      tags: ['loyalty', 'equity', 'finance']
    },
    tfs_loyalty: {
      id: 'tfs_loyalty',
      label: 'TFS / Toyota Loyalty',
      description: 'Toyota Financial Services loyalty or lease-end program',
      priority: 5,
      group: 'loyalty',
      tone: 'warm transition. Lead with equity or lease-end timing.',
      close: 'two_times',
      tags: ['loyalty', 'lease_end', 'finance']
    },
    afs_loyalty: {
      id: 'afs_loyalty',
      label: 'AFS / Acura/Honda Loyalty',
      description: 'American Honda Finance loyalty program',
      priority: 5,
      group: 'loyalty',
      tone: 'warm transition. Equity or lease-end approach.',
      close: 'two_times',
      tags: ['loyalty', 'lease_end', 'finance']
    },
    oem_generic: {
      id: 'oem_generic',
      label: 'OEM / Manufacturer Lead',
      description: 'Lead sourced from manufacturer website or program',
      priority: 14,
      group: 'oem',
      tone: 'brand-aligned, acknowledge their research, confirm we can match',
      close: 'two_times',
      tags: ['oem']
    },

    // ── Finance leads ──────────────────────────────────────────────────────────
    capital_one: {
      id: 'capital_one',
      label: 'Capital One Auto Navigator',
      description: 'Pre-approved customer from Capital One',
      priority: 13,
      group: 'finance',
      tone: 'acknowledge their pre-approval. Frame as nearly done. Close fast.',
      close: 'two_times',
      tags: ['high_intent', 'finance', 'pre_approved']
    },

    // ── Social / Marketing ─────────────────────────────────────────────────────
    facebook: {
      id: 'facebook',
      label: 'Facebook / Meta',
      description: 'Facebook Marketplace, Facebook Lead Ad, or Instagram',
      priority: 30,
      group: 'social',
      tone: 'casual, direct, text-message energy. Acknowledge Facebook. No formality.',
      close: 'two_times',
      tags: ['social', 'casual']
    },
    amp_marketing: {
      id: 'amp_marketing',
      label: 'AMP / Marketing Blast',
      description: 'Customer responded to a marketing campaign text or email',
      priority: 35,
      group: 'marketing',
      tone: 'they responded to a blast. Treat it as a buying signal. Lead with what they replied to.',
      close: 'two_times',
      tags: ['marketing', 're_engagement']
    },
    ai_buying_signal: {
      id: 'ai_buying_signal',
      label: 'AI Buying Signal',
      description: 'AI-detected customer showing buying intent from existing database',
      priority: 16,
      group: 'marketing',
      tone: 'soft re-engagement. Do not reference AI detection. Make it feel personal.',
      close: 'soft',
      tags: ['marketing', 're_engagement']
    },
    google_ad: {
      id: 'google_ad',
      label: 'Google Ads / Paid Search',
      description: 'Lead from Google paid search campaign',
      priority: 28,
      group: 'marketing',
      tone: 'direct, confirm the vehicle or model they searched for',
      close: 'two_times',
      tags: ['digital', 'paid']
    },

    // ── Relationship / Referral ────────────────────────────────────────────────
    repeat_customer: {
      id: 'repeat_customer',
      label: 'Repeat / Returning Customer',
      description: 'Prior buyer returning for another purchase',
      priority: 6,
      group: 'relationship',
      tone: 'acknowledge the relationship. Warm, personal, loyal-customer energy.',
      close: 'two_times',
      tags: ['loyal', 'warm']
    },
    referral: {
      id: 'referral',
      label: 'Referral',
      description: 'Customer referred by existing customer or employee',
      priority: 6,
      group: 'relationship',
      tone: 'acknowledge the referral source if known. Warm, trusted.',
      close: 'two_times',
      tags: ['warm', 'trust']
    },
    carpro: {
      id: 'carpro',
      label: 'CarPro / Radio',
      description: 'CarPro USA show listener or radio referral',
      priority: 24,
      group: 'relationship',
      tone: 'acknowledge CarPro. They came because they trust the show. Honor that.',
      close: 'two_times',
      tags: ['trust', 'radio']
    },

    // ── Catch-all ──────────────────────────────────────────────────────────────
    costco: {
      id: 'costco',
      label: 'Costco Auto Program',
      description: 'Customer came through Costco member buying program',
      priority: 17,
      group: 'relationship',
      tone: 'professional, low-pressure, member-experience framing. Acknowledge Costco.',
      close: 'two_times',
      tags: ['trust', 'program', 'no_haggle']
    },
    identitymax: {
      id: 'identitymax',
      label: 'IdentityMax (Website Offer)',
      description: 'Customer responded to a targeted website pop-up or conquest offer',
      priority: 16,
      group: 'marketing',
      tone: 'respond directly to the offer they saw. Confirm it is still available. Move to appointment.',
      close: 'two_times',
      tags: ['digital', 'offer', 'conquest']
    },
    third_party_generic: {
      id: 'third_party_generic',
      label: 'Third Party / Aggregator',
      description: 'Lead from a third-party aggregator or partner program (AutoBytel, RCT, etc.)',
      priority: 27,
      group: 'marketplace',
      tone: 'treat like a marketplace lead. Confirm vehicle, give a reason to choose you, close.',
      close: 'two_times',
      tags: ['marketplace', 'aggregator']
    },
    standard: {
      id: 'standard',
      label: 'Standard / Unknown Source',
      description: 'Unrecognized lead source — use standard approach',
      priority: 99,
      group: 'general',
      tone: 'professional, qualifying question, two-time close',
      close: 'two_times',
      tags: []
    }
  };

  // ─── Default Match Rules ─────────────────────────────────────────────────────
  // Fuzzy patterns that cover the most common CRM source string variations.
  // Order matters — first match wins. More specific patterns go first.

  const DEFAULT_MATCH_RULES = [
    // Digital deals / Virtual retailing (most specific first)
    { pattern: /cargurus.*digital deal|digital deal.*cargurus/i,          scenario: 'cargurus_digital' },
    { pattern: /gubagoo.*dynamic credit|dynamic credit.*app|hds dr.*lead|hds.*virtual retail/i, scenario: 'click_and_go' },
    { pattern: /click.*go|click\s*&\s*go|virtual retail|digital retail|\bdrs\b/i, scenario: 'click_and_go' },
    { pattern: /gubagoo.*vr|gubagoo.*retailing|gubagoo(?!.*chat|.*sms)/i, scenario: 'click_and_go' },
    { pattern: /gubagoo.*chat|gubagoo.*sms|chat.*lead|live.*chat|dealer.*chat|carnow|podium.*chat/i, scenario: 'chat_lead' },
    { pattern: /credit.*app(?!.*cargurus)|standalone.*credit|finance.*application|routeone|dealertrack(?!.*gubagoo|.*autofi|.*cargurus|.*kiacom)/i, scenario: 'credit_app' },

    // Loyalty / OEM programs
    { pattern: /kfa|kia finance america|kia.*equity|kia.*maturity|kia.*loyalty/i, scenario: 'kfa_loyalty' },
    { pattern: /kmf|kia motors finance|luv.*program|kmf.*total loss|total loss.*kmf|kia.*event/i, scenario: 'kfa_loyalty' },
    { pattern: /tfs|toyota financial|toyota.*loyalty|toyota.*lease.*end|toyota.*maturity/i, scenario: 'tfs_loyalty' },
    { pattern: /afs|american honda finance|acura financial|honda.*loyalty|honda.*lease.*end/i, scenario: 'afs_loyalty' },
    { pattern: /\bvwfs\b|volkswagen financial|vw.*loyalty|audi financial|audi.*loyalty/i, scenario: 'afs_loyalty' },
    { pattern: /bmw financial|mercedes financial|lexus financial|infiniti financial/i, scenario: 'oem_generic' },

    // Finance pre-approval
    { pattern: /capital one|cap one|auto navigator/i,                     scenario: 'capital_one' },

    // Trade tools
    { pattern: /tradepending|trade.*pending/i,                            scenario: 'tradepending' },
    { pattern: /kbb.*ico|kelley.*blue.*book.*instant|kbb.*instant|kbb.*trade/i, scenario: 'kbb' },
    { pattern: /\bkbb\b|kelley.?blue.?book|blackbook|black.*book/i,      scenario: 'kbb' },

    // Costco — distinct buying program, own scenario
    { pattern: /costco/i,                                                  scenario: 'costco' },

    // Marketplaces
    { pattern: /truecar|true.car/i,                                       scenario: 'truecar' },
    { pattern: /cargurus/i,                                               scenario: 'cargurus' },
    { pattern: /autotrader|auto.trader|car and driver/i,                  scenario: 'autotrader' },
    { pattern: /cars\.com|cars com|carscom/i,                             scenario: 'cars_com' },
    { pattern: /edmunds/i,                                                scenario: 'edmunds' },
    { pattern: /carfax|autocheck|auto.*check|vehicle.*history/i,          scenario: 'carfax' },
    { pattern: /carpro|carprousa|car pro usa|car pro show/i,               scenario: 'carpro' },

    // Social
    { pattern: /facebook|fb marketplace|fb lead|meta lead|instagram.*lead/i, scenario: 'facebook' },

    // Marketing / Re-engagement
    { pattern: /\bamp\b|marketing.*blast|mass.*text|campaign.*lead/i,    scenario: 'amp_marketing' },
    { pattern: /identitymax|identity.*max/i,                              scenario: 'identitymax' },
    { pattern: /ai buying signal|ai.*intent|buying signal/i,              scenario: 'ai_buying_signal' },
    { pattern: /google.*ad|google.*digital|digital advertising.*google|paid.*search|\bsem\b|\bppc\b/i, scenario: 'google_ad' },

    // OEM — expanded to cover kiacom, toyotacertified, Honda AHM, Audi partner
    { pattern: /toyota\.com|toyotacertified|buyatoyota|honda\.com|kia\.com|hyundai\.com|subaru\.com|mazda\.com/i, scenario: 'oem_generic' },
    { pattern: /\bkiacom\b|kia\.com|honda.*ahm|honda.*assoc.*ahm|honda.*vehicle.*search/i, scenario: 'oem_generic' },
    { pattern: /oem|manufacturer.*lead|third.?party.*oem|digital.*dealer.*program|audi.*partner/i, scenario: 'oem_generic' },

    // Third-party aggregators (AutoBytel, RCT, OADD, generic third party)
    { pattern: /autobytel|auto.?bytel/i,                                  scenario: 'third_party_generic' },
    { pattern: /rct.request|rct-request|\brct\b/i,                       scenario: 'third_party_generic' },
    { pattern: /oadd.*vdp|vdp.*inquiry/i,                                 scenario: 'third_party_generic' },
    { pattern: /third.?party|thirdparty|3rd.?party/i,                    scenario: 'third_party_generic' },
    { pattern: /kia digital.*3rd|kia digital.*third/i,                   scenario: 'third_party_generic' },

    // Relationship
    { pattern: /referral|referred by|word of mouth/i,                     scenario: 'referral' },
    { pattern: /repeat|returning|prior customer|dms sales|previous (?:customer|buyer|owner)|sold customer/i, scenario: 'repeat_customer' },

    // Dealer website / Phone
    { pattern: /phone.*up|phone-up|phoneup|inbound.*call|call.*center|phone.*lead/i, scenario: 'phone_up' },
    { pattern: /dealer\.com|dealerfire|dealersocket|dealer.*website|website.*lead|internet.*lead|get.*eprice|e.price|dealer.*e.process/i, scenario: 'dealer_website' },
    { pattern: /pam.*ai|pam ai|digital.*showroom/i,                       scenario: 'dealer_website' },
  ];

  // ─── DealerSourceRegistry ────────────────────────────────────────────────────
  // Manages per-dealer custom source mappings stored in chrome.storage.sync

  const REGISTRY_STORAGE_KEY = 'leadpro_source_registry';

  /**
   * Load the dealer's custom source registry
   * Returns: { mappings: { "Raw Source String": "scenario_id" }, ... }
   */
  // ── Worker endpoint for shared registry ───────────────────────────
  var REGISTRY_WORKER_URL = null; // set at runtime from config

  function getWorkerUrl() {
    if (REGISTRY_WORKER_URL) return REGISTRY_WORKER_URL;
    // Check window global set by popup.js
    if (window._leadProWorkerBase) {
      REGISTRY_WORKER_URL = window._leadProWorkerBase;
      return REGISTRY_WORKER_URL;
    }
    // Try popup.js getEndpoint
    if (typeof getEndpoint === 'function') {
      var ep = getEndpoint();
      if (ep && ep.url) {
        REGISTRY_WORKER_URL = ep.url.replace(/\/generate$/, '').replace(/\/$/, '');
        return REGISTRY_WORKER_URL;
      }
    }
    // Fall back to reading PROXY_URL directly from config scope
    if (typeof PROXY_URL !== 'undefined' && PROXY_URL) {
      REGISTRY_WORKER_URL = PROXY_URL.replace(/\/generate$/, '').replace(/\/$/, '');
      return REGISTRY_WORKER_URL;
    }
    // Last resort: read from chrome.storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['lp_proxy_url'], function(r) {
        if (r && r.lp_proxy_url) REGISTRY_WORKER_URL = r.lp_proxy_url.replace(/\/generate$/, '').replace(/\/$/, '');
      });
    }
    return REGISTRY_WORKER_URL || null;
  }

  function loadRegistry(cb) {
    // 1. Always load local first for instant startup
    chrome.storage.sync.get(REGISTRY_STORAGE_KEY, function(result) {
      var local = result[REGISTRY_STORAGE_KEY] || { mappings: {}, version: 1 };
      cb(local);

      // 2. Then try to pull fresh copy from Worker in background
      var workerBase = getWorkerUrl();
      var profile = window._leadProProfile || {};
      // Resolve dealerId from DEALER_ID_MAP by matching store name
      var dealerId = profile.dealerId || (function() {
        if (!window.DEALER_ID_MAP || !profile.store) return '';
        var storeLower = profile.store.toLowerCase();
        for (var did in window.DEALER_ID_MAP) {
          if (window.DEALER_ID_MAP[did].toLowerCase().includes(storeLower.substring(0,10))) return did;
        }
        return '';
      })();
      if (!workerBase || !dealerId) return;

      fetch(workerBase + '/registry?dealerId=' + encodeURIComponent(dealerId))
        .then(function(r) { return r.json(); })
        .then(function(remote) {
          if (!remote || !remote.mappings) return;
          // Use remote if it's newer than local
          var remoteTs = remote.updatedAt || 0;
          var localTs  = local.savedAt   || 0;
          if (remoteTs > localTs) {
            console.log('[Lead Pro Registry] Remote registry is newer — syncing locally');
            var data = {};
            data[REGISTRY_STORAGE_KEY] = remote;
            chrome.storage.sync.set(data);
            window._leadProSourceRegistry = remote;
          }
        })
        .catch(function(err) {
          console.log('[Lead Pro Registry] Worker pull failed (offline?):', err.message);
        });
    });
  }

  /**
   * Save the dealer's custom source registry
   */
  function saveRegistry(registry, cb) {
    // Always save locally first
    const data = {};
    data[REGISTRY_STORAGE_KEY] = registry;
    chrome.storage.sync.set(data, function() {
      if (cb) cb();
    });

    // Push to Worker if Director — read licenseKey from storage async
    var profile    = window._leadProProfile || {};
    var isDirector = profile.persona === 'internet_director';
    var workerBase = getWorkerUrl();

    if (!isDirector || !workerBase) return;

    chrome.storage.sync.get(['leadpro_license'], function(r) {
      var licenseKey = r.leadpro_license || '';
      var dealerId = (function() {
        if (!profile.store) return '';
        var storeLower = profile.store.toLowerCase();
        var map = window.DEALER_ID_MAP || {
          '6189': 'Community Toyota Baytown',
          '6190': 'Community Kia Baytown',
          '6191': 'Community Honda Baytown',
          '24399': 'Community Honda Lafayette'
        };
        for (var did in map) {
          if (map[did].toLowerCase().includes(storeLower.substring(0,8))) return did;
        }
        return '';
      })();
      if (!licenseKey || !dealerId) {
        console.log('[Lead Pro Registry] Push skipped — missing license or dealerId');
        return;
      }

      fetch(workerBase + '/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKey, dealerId: dealerId, registry: registry })
      })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          if (result.ok) console.log('[Lead Pro Registry] ✓ Pushed to Worker — agents will sync on next load');
          else console.warn('[Lead Pro Registry] Worker push failed:', result.error);
        })
        .catch(function(err) {
          console.warn('[Lead Pro Registry] Worker push error:', err.message);
        });
    });
  }

  /**
   * Classify a lead source string to a scenario id
   * Priority: 1) Exact dealer custom mapping  2) Fuzzy default rules  3) 'standard'
   */
  function classify(rawSourceString, registry) {
    if (!rawSourceString) return 'standard';
    const src = rawSourceString.trim();

    // 1. Exact match in dealer's custom registry
    if (registry && registry.mappings) {
      // Try exact match first
      if (registry.mappings[src]) return registry.mappings[src];
      // Try case-insensitive match
      const srcLower = src.toLowerCase();
      for (const key of Object.keys(registry.mappings)) {
        if (key.toLowerCase() === srcLower) return registry.mappings[key];
      }
    }

    // 2. Fuzzy match against default rules
    for (const rule of DEFAULT_MATCH_RULES) {
      if (rule.pattern.test(src)) return rule.scenario;
    }

    // 3. Fallback
    return 'standard';
  }

  /**
   * Get scenario definition by id
   */
  function getScenario(scenarioId) {
    return SCENARIO_LIBRARY[scenarioId] || SCENARIO_LIBRARY.standard;
  }

  /**
   * Get all scenario definitions (for UI display)
   */
  function getAllScenarios() {
    return SCENARIO_LIBRARY;
  }

  /**
   * Get scenarios grouped by category (for onboarding UI)
   */
  function getScenariosGrouped() {
    const groups = {};
    for (const [id, scenario] of Object.entries(SCENARIO_LIBRARY)) {
      const g = scenario.group || 'general';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ id, ...scenario });
    }
    return groups;
  }

  /**
   * Parse a dealer's raw lead source list (CSV or newline-separated)
   * Returns array of unique source strings
   */
  function parseSourceList(rawText) {
    return [...new Set(
      rawText.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0)
    )];
  }

  /**
   * Auto-suggest mappings for a list of source strings
   * Returns: { sourceString: { suggested: scenarioId, confidence: 'high'|'medium'|'low' } }
   */
  function autoSuggestMappings(sourceList) {
    const suggestions = {};
    for (const src of sourceList) {
      let matched = null;
      let confidence = 'low';

      // Check default rules
      for (const rule of DEFAULT_MATCH_RULES) {
        if (rule.pattern.test(src)) {
          matched = rule.scenario;
          // High confidence if the match is specific (not a generic catch-all)
          confidence = ['standard', 'dealer_website'].includes(rule.scenario) ? 'medium' : 'high';
          break;
        }
      }

      suggestions[src] = {
        suggested: matched || 'standard',
        confidence: matched ? confidence : 'low',
        needsReview: !matched || confidence === 'low'
      };
    }
    return suggestions;
  }

  /**
   * Export registry as JSON (for dealer admin portal)
   */
  function exportRegistry(registry) {
    return JSON.stringify(registry, null, 2);
  }

  /**
   * Import registry from JSON
   */
  function importRegistry(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.mappings) throw new Error('Invalid registry format');
      return { ok: true, registry: data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return {
    SCENARIO_LIBRARY,
    DEFAULT_MATCH_RULES,
    classify,
    getScenario,
    getAllScenarios,
    getScenariosGrouped,
    loadRegistry,
    saveRegistry,
    parseSourceList,
    autoSuggestMappings,
    exportRegistry,
    importRegistry
  };

})();
