/**
 * Lead Pro — Dealer Setup UI
 * Multi-store configuration, agent assignments, and brand setup
 */

const LEADPRO_SETUP = (function() {

  // ─── Dealer Group Setup (first-time) ─────────────────────────────────────
  function buildGroupSetupUI(container, onComplete) {
    var stores = [{ id: 1, name: '', crmDealerId: '', brand: 'generic', address: '', phone: '', titleTemplate: '', personaLock: '' }];
    var groupName = '';

    // Load existing config first, then render
    LEADPRO_DEALER.loadAll(function(existing) {
      if (existing && existing.stores && existing.stores.length > 0) {
        stores = existing.stores;
        groupName = (existing.group && existing.group.name) ? existing.group.name : (existing.group || '');
      }
      render();
    });
    function render() {
      var allBrands = LEADPRO_DEALER.getAllBrands();
      container.innerHTML = `
        <div style="padding:16px; display:flex; flex-direction:column; gap:14px;">
          <div>
            <div style="font-size:13px; font-weight:700; color:#e8f0ff; margin-bottom:3px;">Dealer Setup</div>
            <div style="font-size:10px; color:#7a90b8; line-height:1.5;">
              Configure your rooftops. Each store gets its own phone numbers, title, and persona rules.
            </div>
          </div>

          <!-- Dealer Group Name -->
          <div>
            <div style="font-size:9px; color:#7a90b8; margin-bottom:3px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em;">Dealer Group Name</div>
            <input id="ds-group-name" placeholder="e.g. Community Auto Group" value="${groupName}"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.2); border-radius:6px;
              padding:8px 10px; color:#e8f0ff; font-size:11px; width:100%; box-sizing:border-box;">
          </div>

          <!-- Stores -->
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <div style="font-size:9px; color:#7a90b8; font-weight:600; text-transform:uppercase; letter-spacing:0.06em;">Rooftops / Stores</div>
              <button id="ds-add-store" style="
                background:rgba(0,210,150,0.08); border:1px solid rgba(0,210,150,0.25);
                color:#00d296; border-radius:4px; padding:3px 10px; font-size:9px; cursor:pointer; font-weight:600;
              ">+ Add Store</button>
            </div>

            <div id="ds-stores-list" style="display:flex; flex-direction:column; gap:8px;">
              ${stores.map((s, i) => renderStoreCard(s, i, allBrands)).join('')}
            </div>
          </div>

          <!-- Save -->
          <button id="ds-save" style="
            width:100%; border:none; cursor:pointer; border-radius:6px;
            padding:10px; font-size:12px; font-weight:700;
            background:linear-gradient(135deg,#00d296,#009966); color:#001a0f;
          ">Save Dealer Configuration →</button>
        </div>
      `;

      wireEvents();
    }

    function renderStoreCard(store, idx, allBrands) {
      var brandDef = LEADPRO_DEALER.getBrandDefaults(store.brand || 'generic');
      return `
        <div class="ds-store-card" data-idx="${idx}" style="
          background:#131f33; border:1px solid rgba(0,210,150,0.12);
          border-radius:7px; padding:10px; display:flex; flex-direction:column; gap:7px;
        ">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="font-size:10px; font-weight:700; color:#00d296;">Store ${idx + 1}</div>
            ${idx > 0 ? `<button class="ds-remove-store" data-idx="${idx}" style="
              background:none; border:1px solid rgba(255,91,91,0.2); color:#ff5b5b;
              border-radius:3px; padding:2px 7px; font-size:9px; cursor:pointer;">Remove</button>` : ''}
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <div>
              <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">Store Name</div>
              <input class="ds-store-name" data-idx="${idx}" value="${store.name || ''}"
                placeholder="Community Toyota Baytown"
                style="background:#0d1625; border:1px solid rgba(0,210,150,0.12); border-radius:4px;
                padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box;">
            </div>
            <div>
              <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">CRM Dealer ID</div>
              <input class="ds-store-dealerid" data-idx="${idx}" value="${store.crmDealerId || ''}"
                placeholder="e.g. 6189"
                style="background:#0d1625; border:1px solid rgba(0,210,150,0.12); border-radius:4px;
                padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box; font-family:monospace;">
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <div>
              <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">Brand</div>
              <select class="ds-store-brand" data-idx="${idx}"
                style="background:#0d1625; border:1px solid rgba(0,210,150,0.12); border-radius:4px;
                padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; cursor:pointer;">
                ${allBrands.map(b =>
                  `<option value="${b.id}" ${b.id === (store.brand || 'generic') ? 'selected' : ''}>${b.label}</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">Title Template</div>
              <input class="ds-store-title" data-idx="${idx}"
                value="${store.titleTemplate || brandDef.title}"
                placeholder="${brandDef.title}"
                style="background:#0d1625; border:1px solid rgba(0,210,150,0.12); border-radius:4px;
                padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box;">
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <div>
              <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">Address (for email signature)</div>
              <input class="ds-store-address" data-idx="${idx}" value="${store.address || ''}"
                placeholder="123 Main St, City, ST 12345"
                style="background:#0d1625; border:1px solid rgba(0,210,150,0.12); border-radius:4px;
                padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box;">
            </div>
            <div>
              <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">Store Phone (fallback)</div>
              <input class="ds-store-phone" data-idx="${idx}" value="${store.phone || ''}"
                placeholder="e.g. 281-837-3382"
                style="background:#0d1625; border:1px solid rgba(0,210,150,0.12); border-radius:4px;
                padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box; font-family:monospace;">
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:8px;">
            <div style="font-size:9px; color:#3d5070;">Persona Lock:</div>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              ${[{id:'',label:'Auto'},{id:'bdc',label:'BDC'},{id:'sales',label:'Sales'},{id:'manager',label:'Manager'},{id:'internet_director',label:'Director'}].map(p => `
                <div class="ds-persona-lock" data-idx="${idx}" data-persona="${p.id}" style="
                  background:${(store.personaLock||'') === p.id ? 'rgba(0,210,150,0.15)' : '#0d1625'};
                  border:1px solid ${(store.personaLock||'') === p.id ? '#00d296' : 'rgba(0,210,150,0.1)'};
                  border-radius:3px; padding:3px 7px; font-size:9px; cursor:pointer;
                  color:${(store.personaLock||'') === p.id ? '#00d296' : '#3d5070'};
                ">${p.label}</div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    function wireEvents() {
      // Add store
      var addBtn = container.querySelector('#ds-add-store');
      if (addBtn) addBtn.addEventListener('click', function() {
        stores.push({ id: stores.length + 1, name: '', crmDealerId: '', brand: 'generic', address: '', phone: '', titleTemplate: '', personaLock: '' });
        render();
      });

      // Remove store
      container.querySelectorAll('.ds-remove-store').forEach(function(btn) {
        btn.addEventListener('click', function() {
          stores.splice(parseInt(this.dataset.idx), 1);
          render();
        });
      });

      // Field sync — name
      container.querySelectorAll('.ds-store-name').forEach(function(el) {
        el.addEventListener('input', function() { stores[parseInt(this.dataset.idx)].name = this.value; });
      });
      container.querySelectorAll('.ds-store-dealerid').forEach(function(el) {
        el.addEventListener('input', function() { stores[parseInt(this.dataset.idx)].crmDealerId = this.value; });
      });
      container.querySelectorAll('.ds-store-title').forEach(function(el) {
        el.addEventListener('input', function() { stores[parseInt(this.dataset.idx)].titleTemplate = this.value; });
      });
      container.querySelectorAll('.ds-store-address').forEach(function(el) {
        el.addEventListener('input', function() { stores[parseInt(this.dataset.idx)].address = this.value; });
      });
      container.querySelectorAll('.ds-store-phone').forEach(function(el) {
        el.addEventListener('input', function() { stores[parseInt(this.dataset.idx)].phone = this.value; });
      });

      // Brand select — auto-fill title
      container.querySelectorAll('.ds-store-brand').forEach(function(el) {
        el.addEventListener('change', function() {
          var idx = parseInt(this.dataset.idx);
          var brandDef = LEADPRO_DEALER.getBrandDefaults(this.value);
          stores[idx].brand = this.value;
          stores[idx].titleTemplate = brandDef.title;
          stores[idx].personaLock = brandDef.personaLock || '';
          render();
        });
      });

      // Persona lock tiles
      container.querySelectorAll('.ds-persona-lock').forEach(function(el) {
        el.addEventListener('click', function() {
          var idx = parseInt(this.dataset.idx);
          stores[idx].personaLock = this.dataset.persona;
          render();
        });
      });

      // Save
      var saveBtn = container.querySelector('#ds-save');
      if (saveBtn) saveBtn.addEventListener('click', function() {
        groupName = (container.querySelector('#ds-group-name').value || '').trim();
        if (!groupName) { alert('Please enter a dealer group name.'); return; }
        var valid = stores.every(function(s) { return s.name && s.crmDealerId; });
        if (!valid) { alert('Each store needs a name and CRM Dealer ID.'); return; }

        var group = { name: groupName, createdAt: Date.now() };
        LEADPRO_DEALER.setupDealerGroup(group, stores, function() {
          if (onComplete) onComplete(group, stores);
        });
      });
    }

    render();
  }

  // ─── Agent Assignment Panel ───────────────────────────────────────────────
  // Shows in profile settings — agent sets their phone/title for each store
  function buildAssignmentUI(container, profile, stores, assignments, onSave) {
    if (!stores || stores.length === 0) {
      container.innerHTML = '<div style="padding:12px; font-size:10px; color:#3d5070;">No stores configured. Ask your dealer admin to set up stores first.</div>';
      return;
    }

    var localAssignments = JSON.parse(JSON.stringify(assignments));
    var agentId = profile.email || profile.name;

    container.innerHTML = `
      <div style="padding:12px; display:flex; flex-direction:column; gap:10px;">
        <div style="font-size:10px; font-weight:700; color:#e8f0ff;">Your Store Assignments</div>
        <div style="font-size:9px; color:#7a90b8; line-height:1.5;">
          Set your direct phone number and title for each store you work.
          These override your profile defaults when you're working a lead from that store.
        </div>

        ${stores.map(function(store) {
          var asgn = localAssignments.find(function(a) { return a.agentId === agentId && a.storeId === store.id; }) || {};
          var brandDef = LEADPRO_DEALER.getBrandDefaults(store.brand);
          var personas = typeof LEADPRO_AUTH !== 'undefined' ? LEADPRO_AUTH.getAllPersonas() : {};
          return `
            <div class="asgn-card" data-storeid="${store.id}" style="
              background:#131f33; border:1px solid rgba(0,210,150,0.1);
              border-radius:6px; padding:9px 10px; display:flex; flex-direction:column; gap:6px;
            ">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="width:6px; height:6px; border-radius:50%; background:${brandDef.color || '#00d296'};"></div>
                <div style="font-size:10px; font-weight:700; color:#e8f0ff;">${store.name}</div>
                ${store.personaLock ? `<div style="font-size:8px; color:#9b6dff; background:rgba(155,109,255,0.1); border:1px solid rgba(155,109,255,0.2); border-radius:3px; padding:1px 5px;">🔒 ${store.personaLock}</div>` : ''}
              </div>

              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                <div>
                  <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">Your Direct Phone</div>
                  <input class="asgn-phone" data-storeid="${store.id}" value="${asgn.phone || ''}"
                    placeholder="${profile.phone || '555-000-0000'}"
                    style="background:#0d1625; border:1px solid rgba(0,210,150,0.1); border-radius:4px;
                    padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box;">
                </div>
                <div>
                  <div style="font-size:9px; color:#3d5070; margin-bottom:2px;">Title at This Store</div>
                  <input class="asgn-title" data-storeid="${store.id}" value="${asgn.titleOverride || store.titleTemplate || brandDef.title}"
                    style="background:#0d1625; border:1px solid rgba(0,210,150,0.1); border-radius:4px;
                    padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box;">
                </div>
              </div>

              ${!store.personaLock ? `
              <div>
                <div style="font-size:9px; color:#3d5070; margin-bottom:3px;">Persona at This Store (optional override)</div>
                <div style="display:flex; gap:3px; flex-wrap:wrap;">
                  ${[{id:'',label:'Use Profile Default'}].concat(Object.values(personas)).map(function(p) {
                    var isActive = (asgn.personaOverride || '') === p.id;
                    var pDef = p.id ? (typeof LEADPRO_AUTH !== 'undefined' ? LEADPRO_AUTH.getPersona(p.id) : null) : null;
                    var col = pDef ? pDef.color : '#3d5070';
                    return '<div class="asgn-persona" data-storeid="' + store.id + '" data-persona="' + p.id + '" style="' +
                      'background:' + (isActive ? 'rgba(0,210,150,0.1)' : '#0d1625') + ';' +
                      'border:1px solid ' + (isActive ? col : 'rgba(0,210,150,0.08)') + ';' +
                      'border-radius:3px; padding:3px 6px; font-size:9px; cursor:pointer; color:' + (isActive ? col : '#3d5070') + ';' +
                      '">' + p.label + '</div>';
                  }).join('')}
                </div>
              </div>` : `<div style="font-size:9px; color:#9b6dff;">Persona locked to ${store.personaLock} by store config</div>`}
            </div>
          `;
        }).join('')}

        <button id="asgn-save" style="
          width:100%; border:none; cursor:pointer; border-radius:5px;
          padding:8px; font-size:11px; font-weight:700;
          background:linear-gradient(135deg,#00d296,#009966); color:#001a0f;
        ">Save Assignments</button>
      </div>
    `;

    // Wire inputs
    container.querySelectorAll('.asgn-phone').forEach(function(el) {
      el.addEventListener('input', function() { updateLocalAssignment(agentId, this.dataset.storeid, { phone: this.value }, localAssignments); });
    });
    container.querySelectorAll('.asgn-title').forEach(function(el) {
      el.addEventListener('input', function() { updateLocalAssignment(agentId, this.dataset.storeid, { titleOverride: this.value }, localAssignments); });
    });
    container.querySelectorAll('.asgn-persona').forEach(function(el) {
      el.addEventListener('click', function() {
        var sid = this.dataset.storeid;
        var pid = this.dataset.persona;
        updateLocalAssignment(agentId, sid, { personaOverride: pid }, localAssignments);
        // Rehighlight
        container.querySelectorAll('.asgn-persona[data-storeid="' + sid + '"]').forEach(function(b) {
          var isAct = b.dataset.persona === pid;
          var bDef = b.dataset.persona && typeof LEADPRO_AUTH !== 'undefined' ? LEADPRO_AUTH.getPersona(b.dataset.persona) : null;
          var col = bDef ? bDef.color : '#3d5070';
          b.style.background  = isAct ? 'rgba(0,210,150,0.1)' : '#0d1625';
          b.style.borderColor = isAct ? col : 'rgba(0,210,150,0.08)';
          b.style.color       = isAct ? col : '#3d5070';
        });
      });
    });

    container.querySelector('#asgn-save').addEventListener('click', function() {
      var toSave = localAssignments.filter(function(a) { return a.agentId === agentId; });
      chrome.storage.sync.get('leadpro_assignments', function(r) {
        var all = (r.leadpro_assignments || []).filter(function(a) { return a.agentId !== agentId; });
        all = all.concat(toSave);
        chrome.storage.sync.set({ leadpro_assignments: all }, function() {
          var btn = container.querySelector('#asgn-save');
          btn.textContent = '✓ Saved';
          btn.style.background = 'rgba(0,210,150,0.2)';
          setTimeout(function() {
            btn.textContent = 'Save Assignments';
            btn.style.background = 'linear-gradient(135deg,#00d296,#009966)';
          }, 1500);
          if (onSave) onSave(all);
        });
      });
    });
  }

  function updateLocalAssignment(agentId, storeId, updates, assignments) {
    var existing = assignments.find(function(a) { return a.agentId === agentId && a.storeId === storeId; });
    if (existing) {
      Object.assign(existing, updates);
    } else {
      assignments.push(Object.assign({ agentId: agentId, storeId: storeId }, updates));
    }
  }

  // ─── Store summary panel (read-only overview) ─────────────────────────────
  function buildStoreOverviewUI(container, stores, assignments) {
    if (!stores || stores.length === 0) {
      container.innerHTML = '<div style="padding:12px; font-size:10px; color:#3d5070;">No stores configured yet.</div>';
      return;
    }

    container.innerHTML = `
      <div style="padding:12px; display:flex; flex-direction:column; gap:8px;">
        <div style="font-size:10px; font-weight:700; color:#e8f0ff;">${stores.length} Store${stores.length !== 1 ? 's' : ''} Configured</div>
        ${stores.map(function(store) {
          var brandDef = LEADPRO_DEALER.getBrandDefaults(store.brand);
          var storeAssignments = assignments.filter(function(a) { return a.storeId === store.id; });
          return `
            <div style="background:#131f33; border:1px solid rgba(0,210,150,0.1); border-radius:6px; padding:8px 10px;">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                <div style="width:6px; height:6px; border-radius:50%; background:${brandDef.color || '#00d296'};"></div>
                <div style="font-size:10px; font-weight:700; color:#e8f0ff;">${store.name}</div>
                <div style="font-size:9px; color:#3d5070; font-family:monospace;">ID: ${store.crmDealerId}</div>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <div style="font-size:9px; color:#7a90b8;">Brand: <span style="color:#e8f0ff;">${store.brand || 'generic'}</span></div>
                <div style="font-size:9px; color:#7a90b8;">Title: <span style="color:#e8f0ff;">${store.titleTemplate || brandDef.title}</span></div>
                ${store.personaLock ? `<div style="font-size:9px; color:#9b6dff;">🔒 Persona: ${store.personaLock}</div>` : ''}
                <div style="font-size:9px; color:#7a90b8;">Agents: <span style="color:#e8f0ff;">${storeAssignments.length}</span></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return {
    buildGroupSetupUI,
    buildAssignmentUI,
    buildStoreOverviewUI
  };

})();
