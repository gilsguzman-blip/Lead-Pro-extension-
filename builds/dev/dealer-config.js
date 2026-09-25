/**
 * Lead Pro — Dealer Configuration Module
 * Manages dealer groups, stores, and multi-store agent assignments
 *
 * Storage keys:
 *   leadpro_dealer_group   — the dealer group this install belongs to
 *   leadpro_stores         — array of store configs
 *   leadpro_assignments    — agent store assignments (phone, title, persona per store)
 */

const LEADPRO_DEALER = (function() {

  const KEY_GROUP       = 'leadpro_dealer_group';
  const KEY_STORES      = 'leadpro_stores';
  const KEY_ASSIGNMENTS = 'leadpro_assignments';

  // ─── Brand definitions ────────────────────────────────────────────────────
  // Each brand carries defaults that can be overridden per store
  const BRAND_DEFAULTS = {
    toyota:    { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#eb0a1e' },
    honda:     { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#cc0000' },
    kia:       { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#05141f' },
    hyundai:   { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#002c5f' },
    ford:      { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#003778' },
    chevrolet: { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#d4a017' },
    gmc:       { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#cc0000' },
    ram:       { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#cc0000' },
    jeep:      { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#1a1a1a' },
    subaru:    { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#0033a0' },
    mazda:     { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#1a1a1a' },
    nissan:    { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#c3002f' },
    volkswagen:{ title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#001e50' },
    audi:      { title: 'Audi Concierge',             personaLock: 'concierge',luxury: true,  color: '#bb0a21' },
    bmw:       { title: 'BMW Genius',                 personaLock: 'concierge',luxury: true,  color: '#0066cc' },
    mercedes:  { title: 'Mercedes-Benz Concierge',   personaLock: 'concierge',luxury: true,  color: '#1a1a1a' },
    lexus:     { title: 'Lexus Concierge',            personaLock: 'concierge',luxury: true,  color: '#1a1a1a' },
    genesis:   { title: 'Genesis Concierge',          personaLock: 'concierge',luxury: true,  color: '#1a1a1a' },
    cadillac:  { title: 'Cadillac Concierge',         personaLock: 'concierge',luxury: true,  color: '#1a2b47' },
    porsche:   { title: 'Porsche Sales Advisor',      personaLock: 'concierge',luxury: true,  color: '#1a1a1a' },
    volvo:     { title: 'Volvo Concierge',            personaLock: 'concierge',luxury: true,  color: '#003057' },
    preowned:  { title: 'Pre-Owned Specialist',       personaLock: null,       luxury: false, color: '#00d296' },
    generic:   { title: 'Internet Sales Coordinator', personaLock: null,       luxury: false, color: '#38b6ff' },
  };

  // ─── Storage helpers ──────────────────────────────────────────────────────

  function loadAll(cb) {
    chrome.storage.sync.get([KEY_GROUP, KEY_STORES, KEY_ASSIGNMENTS], function(r) {
      cb({
        group:       r[KEY_GROUP]       || null,
        stores:      r[KEY_STORES]      || [],
        assignments: r[KEY_ASSIGNMENTS] || []
      });
    });
  }

  function saveAll(data, cb) {
    var payload = {};
    if (data.group       !== undefined) payload[KEY_GROUP]       = data.group;
    if (data.stores      !== undefined) payload[KEY_STORES]      = data.stores;
    if (data.assignments !== undefined) payload[KEY_ASSIGNMENTS] = data.assignments;
    chrome.storage.sync.set(payload, function() { if (cb) cb(); });
  }

  // ─── Store management ─────────────────────────────────────────────────────

  function addStore(store, cb) {
    loadAll(function(data) {
      var stores = data.stores.filter(function(s) { return s.id !== store.id; });
      stores.push(Object.assign({ createdAt: Date.now() }, store));
      saveAll({ stores: stores }, cb);
    });
  }

  function removeStore(storeId, cb) {
    loadAll(function(data) {
      var stores = data.stores.filter(function(s) { return s.id !== storeId; });
      var assignments = data.assignments.filter(function(a) { return a.storeId !== storeId; });
      saveAll({ stores: stores, assignments: assignments }, cb);
    });
  }

  function updateStore(storeId, updates, cb) {
    loadAll(function(data) {
      var stores = data.stores.map(function(s) {
        return s.id === storeId ? Object.assign({}, s, updates) : s;
      });
      saveAll({ stores: stores }, cb);
    });
  }

  // ─── Assignment management ────────────────────────────────────────────────

  function setAssignment(agentId, storeId, details, cb) {
    // details: { phone, titleOverride, personaOverride }
    loadAll(function(data) {
      var assignments = data.assignments.filter(function(a) {
        return !(a.agentId === agentId && a.storeId === storeId);
      });
      assignments.push(Object.assign({ agentId: agentId, storeId: storeId }, details));
      saveAll({ assignments: assignments }, cb);
    });
  }

  function getAssignment(agentId, storeId, assignments) {
    return assignments.find(function(a) {
      return a.agentId === agentId && a.storeId === storeId;
    }) || null;
  }

  function removeAssignment(agentId, storeId, cb) {
    loadAll(function(data) {
      var assignments = data.assignments.filter(function(a) {
        return !(a.agentId === agentId && a.storeId === storeId);
      });
      saveAll({ assignments: assignments }, cb);
    });
  }

  // ─── Resolution engine ────────────────────────────────────────────────────
  /**
   * Resolve all agent+store context for a given lead
   * Returns: { phone, title, persona, storeName, storeAddress, brand, isLuxury, resolvedBy }
   *
   * Priority:
   *   1. Store.personaLock        → always wins if set
   *   2. StoreAssignment overrides
   *   3. Store brand defaults
   *   4. Agent profile
   *   5. System fallback
   */
  function resolveContext(profile, dealerId, stores, assignments, autoPersona) {
    // Find store by CRM dealer ID
    var store = stores.find(function(s) {
      return String(s.crmDealerId) === String(dealerId) || String(s.id) === String(dealerId);
    });

    if (!store) {
      // No store match — use profile defaults
      return {
        phone:        profile ? profile.phone : '',
        title:        profile ? profile.title : 'Internet Sales Coordinator',
        persona:      autoPersona || (profile ? profile.persona : 'bdc'),
        storeName:    profile ? profile.store : '',
        storeAddress: '',
        brand:        'generic',
        isLuxury:     false,
        resolvedBy:   'profile_fallback'
      };
    }

    var brandKey    = (store.brand || 'generic').toLowerCase();
    var brandDef    = BRAND_DEFAULTS[brandKey] || BRAND_DEFAULTS.generic;
    var assignment  = profile ? getAssignment(profile.email || profile.name, store.id, assignments) : null;

    // Resolve phone: assignment → store fallback → profile
    var phone = (assignment && assignment.phone) || store.phone || (profile ? profile.phone : '');

    // Resolve title priority chain
    var title = (assignment && assignment.titleOverride)
      || store.titleTemplate
      || brandDef.title
      || (profile ? profile.title : 'Internet Sales Coordinator');

    // Resolve persona priority chain
    // (v9.7.51) State-escalation autoPersonas (manager / sales / director) win
    // over store.personaLock. The Damion Wilson case (May 7 missed Audi
    // appointment) exposed that Audi store-lock 'concierge' was overriding
    // a legitimate manager-voice escalation. State reflects what the customer
    // needs RIGHT NOW; store lock reflects the default voice. State wins.
    // Manual assignment.personaOverride still beats everything (explicit
    // human choice trumps automation).
    var persona;
    var resolvedBy;
    var _stateEscalations = ['manager', 'sales', 'internet_director'];
    var _isStateEscalation = autoPersona && _stateEscalations.indexOf(autoPersona) !== -1;
    if (assignment && assignment.personaOverride) {
      persona    = assignment.personaOverride;
      resolvedBy = 'assignment';
    } else if (_isStateEscalation) {
      persona    = autoPersona;
      resolvedBy = 'state_escalation';
    } else if (store.personaLock) {
      persona    = store.personaLock;
      resolvedBy = 'store_lock';
    } else if (autoPersona && autoPersona !== (profile ? profile.persona : 'bdc')) {
      persona    = autoPersona;
      resolvedBy = 'auto_trigger';
    } else {
      persona    = (profile ? profile.persona : null) || brandDef.personaLock || 'bdc';
      resolvedBy = 'profile_default';
    }

    return {
      phone:        phone,
      title:        title,
      persona:      persona,
      storeName:    store.name,
      storeAddress: store.address || '',
      brand:        brandKey,
      isLuxury:     store.luxuryPersona || brandDef.luxury || false,
      storeId:      store.id,
      resolvedBy:   resolvedBy
    };
  }

  // ─── Brand helpers ────────────────────────────────────────────────────────

  function getBrandFromDealerId(dealerId, stores) {
    var store = stores.find(function(s) {
      return String(s.crmDealerId) === String(dealerId);
    });
    return store ? (store.brand || 'generic') : 'generic';
  }

  function getBrandDefaults(brand) {
    return BRAND_DEFAULTS[(brand || 'generic').toLowerCase()] || BRAND_DEFAULTS.generic;
  }

  function getAllBrands() {
    return Object.keys(BRAND_DEFAULTS).map(function(key) {
      return Object.assign({ id: key, label: key.charAt(0).toUpperCase() + key.slice(1) }, BRAND_DEFAULTS[key]);
    });
  }

  // ─── Convenience loaders ──────────────────────────────────────────────────

  function loadStores(cb) {
    chrome.storage.sync.get(KEY_STORES, function(r) { cb(r[KEY_STORES] || []); });
  }

  function loadAssignments(cb) {
    chrome.storage.sync.get(KEY_ASSIGNMENTS, function(r) { cb(r[KEY_ASSIGNMENTS] || []); });
  }

  function loadGroup(cb) {
    chrome.storage.sync.get(KEY_GROUP, function(r) { cb(r[KEY_GROUP] || null); });
  }

  // ─── Quick setup helpers ──────────────────────────────────────────────────
  // For the onboarding flow — set up an entire dealer group at once

  function setupDealerGroup(groupData, storesData, cb) {
    var stores = storesData.map(function(s, i) {
      var brandDef = BRAND_DEFAULTS[(s.brand || 'generic').toLowerCase()] || BRAND_DEFAULTS.generic;
      return {
        id:           s.crmDealerId || s.id || ('store_' + i),
        crmDealerId:  s.crmDealerId || s.id || ('store_' + i),
        name:         s.name,
        brand:        (s.brand || 'generic').toLowerCase(),
        address:      s.address || '',
        phone:        s.phone || '',
        titleTemplate: s.titleTemplate || brandDef.title,
        personaLock:  s.personaLock !== undefined ? s.personaLock : brandDef.personaLock,
        luxuryPersona: s.luxuryPersona !== undefined ? s.luxuryPersona : brandDef.luxury,
        active:       true,
        createdAt:    Date.now()
      };
    });

    saveAll({ group: groupData, stores: stores }, cb);
  }

  return {
    BRAND_DEFAULTS,
    loadAll,
    saveAll,
    addStore,
    removeStore,
    updateStore,
    setAssignment,
    getAssignment,
    removeAssignment,
    resolveContext,
    getBrandFromDealerId,
    getBrandDefaults,
    getAllBrands,
    loadStores,
    loadAssignments,
    loadGroup,
    setupDealerGroup
  };

})();
