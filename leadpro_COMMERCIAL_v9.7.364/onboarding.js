/**
 * Lead Pro — Dealer Onboarding Module
 * Guides a new dealer through mapping their CRM lead sources to scenario categories
 */

const LEADPRO_ONBOARDING = (function() {

  const GROUP_LABELS = {
    digital:      '⚡ Digital / Online Tools',
    marketplace:  '🛒 Third-Party Marketplaces',
    trade:        '🔄 Trade-In Tools',
    loyalty:      '⭐ Loyalty / OEM Programs',
    finance:      '💳 Finance & Pre-Approval',
    social:       '📱 Social Media',
    marketing:    '📢 Marketing & Campaigns',
    website:      '🌐 Dealer Website & Phone',
    oem:          '🏭 OEM / Manufacturer',
    relationship: '🤝 Referral & Returning Customers',
    general:      '📋 General'
  };

  const CONFIDENCE_COLORS = {
    high:   '#00d296',
    medium: '#f5c842',
    low:    '#ff9f43'
  };

  /**
   * Build the full onboarding flow UI
   * Steps: 1) Paste sources  2) Review/assign  3) Confirm & save
   */
  function buildOnboardingUI(container, onComplete) {
    let currentStep = 1;
    let parsedSources = [];
    let suggestions = {};
    let finalMappings = {};

    function render() {
      if (currentStep === 1) renderStep1();
      else if (currentStep === 2) renderStep2();
      else if (currentStep === 3) renderStep3();
    }

    // ── Step 1: Paste source list ────────────────────────────────────────────
    function renderStep1() {
      container.innerHTML = `
        <div style="padding:20px 16px; display:flex; flex-direction:column; gap:16px;">
          <div>
            <div style="font-size:14px; font-weight:700; color:#e8f0ff; margin-bottom:4px;">Step 1 of 3 — Your Lead Sources</div>
            <div style="font-size:10px; color:#7a90b8; line-height:1.5;">
              Paste your CRM lead source names below — one per line, or comma-separated.
              Find them in VinSolutions under <strong>Admin → Lead Sources</strong> or export your lead source report.
            </div>
          </div>


          <div style="display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:4px;">
              <label style="font-size:10px; color:#7a90b8; font-weight:600;">Lead Source Names from your CRM</label>
              <div style="display:flex; gap:4px;">
                <label id="ob-import-label" style="
                  background:rgba(56,182,255,0.08); border:1px solid rgba(56,182,255,0.25);
                  color:#38b6ff; border-radius:4px; padding:2px 9px; font-size:9px;
                  cursor:pointer; font-weight:600; white-space:nowrap; display:inline-block;
                ">⬆ Import CSV / Excel
                  <input type="file" id="ob-file-input" accept=".csv,.xlsx,.xls,.txt" style="display:none;">
                </label>
                <button id="ob-load-sample" style="background:none; border:1px solid rgba(0,210,150,0.25); color:#00d296; border-radius:4px; padding:2px 8px; font-size:9px; cursor:pointer;">Load Sample</button>
              </div>
            </div>
            <div id="ob-import-status" style="display:none; background:rgba(56,182,255,0.06); border:1px solid rgba(56,182,255,0.2); border-radius:5px; padding:6px 10px; font-size:9px; color:#38b6ff; line-height:1.5;"></div>
            <textarea id="ob-source-input" placeholder="CarGurus&#10;AutoTrader&#10;Cars.com&#10;Dealer Website&#10;Gubagoo Virtual Retailing&#10;TradePending&#10;KFA In-Equity&#10;Facebook&#10;...&#10;&#10;Or use Import above to upload a CSV/Excel export from VinSolutions."
              style="
                background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px;
                padding:10px; color:#e8f0ff; font-size:11px; width:100%;
                min-height:160px; resize:vertical; box-sizing:border-box;
                font-family:monospace; line-height:1.6;
              "></textarea>
            <div id="ob-source-count" style="font-size:9px; color:#3d5070; text-align:right;">0 sources detected</div>
          </div>


          <div style="background:rgba(56,182,255,0.06); border:1px solid rgba(56,182,255,0.15); border-radius:6px; padding:10px;">
            <div style="font-size:9px; font-weight:700; color:#38b6ff; margin-bottom:4px;">💡 TIP</div>
            <div style="font-size:9px; color:#7a90b8; line-height:1.5;">
              Lead Pro will auto-suggest scenario categories for common source names.
              You review and approve each mapping in the next step.
              You can always update mappings later in Settings.
            </div>
          </div>

          <button id="ob-step1-next" style="
            width:100%; border:none; cursor:pointer; border-radius:6px;
            padding:10px; font-size:12px; font-weight:700;
            background:linear-gradient(135deg, #00d296, #009966);
            color:#001a0f; opacity:0.5; pointer-events:none;
            transition:opacity 0.15s;
          ">Analyze Sources →</button>
        </div>
      `;

      const textarea = container.querySelector('#ob-source-input');
      const countEl  = container.querySelector('#ob-source-count');
      const nextBtn   = container.querySelector('#ob-step1-next');
      const sampleBtn = container.querySelector('#ob-load-sample');

      // ── File import handler ───────────────────────────────────────────
      var fileInput = container.querySelector('#ob-file-input');
      var importStatus = container.querySelector('#ob-import-status');

      if (fileInput) {
        fileInput.addEventListener('change', function(e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;

          var ext = file.name.split('.').pop().toLowerCase();
          importStatus.style.display = 'block';
          importStatus.textContent = 'Reading ' + file.name + '...';

          if (ext === 'csv' || ext === 'txt') {
            // Plain text / CSV — read directly
            var reader = new FileReader();
            reader.onload = function(ev) {
              var raw = ev.target.result || '';
              var extracted = extractSourcesFromCSV(raw, file.name);
              textarea.value = extracted.sources.join('\n');
              textarea.dispatchEvent(new Event('input'));
              importStatus.textContent = '✓ Imported ' + extracted.sources.length + ' sources from ' + file.name
                + (extracted.column ? ' (column: "' + extracted.column + '")' : '');
              importStatus.style.color = '#00d296';
              importStatus.style.borderColor = 'rgba(0,210,150,0.2)';
              importStatus.style.background = 'rgba(0,210,150,0.06)';
            };
            reader.onerror = function() {
              importStatus.textContent = '✗ Could not read file. Try copying the source list and pasting it instead.';
              importStatus.style.color = '#ff5b5b';
            };
            reader.readAsText(file);

          } else if (ext === 'xlsx' || ext === 'xls') {
            // Excel — use SheetJS if available, otherwise guide user
            if (typeof XLSX !== 'undefined') {
              var reader2 = new FileReader();
              reader2.onload = function(ev) {
                try {
                  var wb = XLSX.read(ev.target.result, { type: 'array' });
                  var ws = wb.Sheets[wb.SheetNames[0]];
                  var rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                  var extracted = extractSourcesFromRows(rows);
                  textarea.value = extracted.sources.join('\n');
                  textarea.dispatchEvent(new Event('input'));
                  importStatus.textContent = '✓ Imported ' + extracted.sources.length + ' sources from ' + file.name
                    + (extracted.column ? ' (column: "' + extracted.column + '")' : '');
                  importStatus.style.color = '#00d296';
                  importStatus.style.borderColor = 'rgba(0,210,150,0.2)';
                  importStatus.style.background = 'rgba(0,210,150,0.06)';
                } catch(err) {
                  importStatus.textContent = '✗ Could not parse Excel file: ' + (err.message || 'unknown error');
                  importStatus.style.color = '#ff5b5b';
                }
              };
              reader2.readAsArrayBuffer(file);
            } else {
              // SheetJS not loaded — guide user to export as CSV
              importStatus.textContent = 'Excel detected. For best results, save as CSV from Excel (File → Save As → CSV), then import the CSV. Or paste your source names directly.';
              importStatus.style.color = '#f5c842';
              importStatus.style.borderColor = 'rgba(245,200,66,0.2)';
              importStatus.style.background = 'rgba(245,200,66,0.05)';
            }
          } else {
            importStatus.textContent = '✗ Unsupported file type. Please use CSV, Excel (.xlsx), or plain text (.txt).';
            importStatus.style.color = '#ff5b5b';
          }

          // Reset file input so same file can be re-imported
          fileInput.value = '';
        });
      }

      // ── CSV source extraction ─────────────────────────────────────────────
      function extractSourcesFromCSV(rawText, filename) {
        var lines = rawText.split(/[\r\n]+/).filter(function(l) { return l.trim(); });
        if (lines.length === 0) return { sources: [], column: null };

        // Parse as CSV
        var rows = lines.map(function(line) {
          // Simple CSV parse — handle quoted fields
          var fields = [];
          var cur = ''; var inQ = false;
          for (var ci = 0; ci < line.length; ci++) {
            var ch = line[ci];
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
            else { cur += ch; }
          }
          fields.push(cur.trim());
          return fields;
        });

        return extractSourcesFromRows(rows);
      }

      function extractSourcesFromRows(rows) {
        if (!rows || rows.length === 0) return { sources: [], column: null };

        var header = rows[0].map(function(h) { return String(h || '').toLowerCase().trim(); });

        // Look for a column that sounds like a lead source column
        var sourceColIdx = -1;
        var sourceColName = null;
        var sourceKeywords = ['source', 'lead source', 'leadsource', 'source name', 'lead_source', 'type', 'lead type'];

        for (var si = 0; si < sourceKeywords.length; si++) {
          var idx = header.indexOf(sourceKeywords[si]);
          if (idx !== -1) { sourceColIdx = idx; sourceColName = rows[0][idx]; break; }
        }

        // Partial match fallback
        if (sourceColIdx === -1) {
          for (var hi = 0; hi < header.length; hi++) {
            if (header[hi].includes('source') || header[hi].includes('lead')) {
              sourceColIdx = hi; sourceColName = rows[0][hi]; break;
            }
          }
        }

        var sources = [];
        if (sourceColIdx !== -1) {
          // Extract from identified column, skip header row
          for (var ri = 1; ri < rows.length; ri++) {
            var val = String(rows[ri][sourceColIdx] || '').trim();
            if (val && val.length > 1) sources.push(val);
          }
        } else {
          // No clear column — treat first column as sources (skip header if it looks like a header)
          var firstColIsHeader = isNaN(rows[0][0]) && /[a-zA-Z]/.test(rows[0][0]);
          var startRow = firstColIsHeader ? 1 : 0;
          for (var ri2 = startRow; ri2 < rows.length; ri2++) {
            var val2 = String(rows[ri2][0] || '').trim();
            if (val2 && val2.length > 1) sources.push(val2);
          }
          sourceColName = firstColIsHeader ? rows[0][0] : null;
        }

        // Dedupe
        sources = sources.filter(function(s, i, arr) { return arr.indexOf(s) === i; });
        return { sources: sources, column: sourceColName };
      }

      // ── Sample load ───────────────────────────────────────────────────────
      sampleBtn.addEventListener('click', function() {
        textarea.value = [
          'CarGurus Internet','AutoTrader','Cars.com','TrueCar',
          'Dealer Website (Phone)','Dealers WebSite',
          'Gubagoo Virtual Retailing','Gubagoo - Chat',
          'Hds Dr Lead - Gubagoo - Drs Digital Retailing',
          'TradePending','Kbb Ico Kelley Blue Book',
          'Kfa In-Equity (Internet)','Facebook (Internet)',
          'Capital One Auto Finance','Dealer E-Process - General Sales',
          'AMP Marketing','Tradepending'
        ].join('\n');
        textarea.dispatchEvent(new Event('input'));
      });

      textarea.addEventListener('input', function() {
        const lines = LEADPRO_REGISTRY.parseSourceList(textarea.value);
        countEl.textContent = lines.length + ' source' + (lines.length !== 1 ? 's' : '') + ' detected';
        if (lines.length > 0) {
          nextBtn.style.opacity = '1';
          nextBtn.style.pointerEvents = 'auto';
        } else {
          nextBtn.style.opacity = '0.5';
          nextBtn.style.pointerEvents = 'none';
        }
      });

      nextBtn.addEventListener('click', function() {
        parsedSources = LEADPRO_REGISTRY.parseSourceList(textarea.value);
        suggestions   = LEADPRO_REGISTRY.autoSuggestMappings(parsedSources);
        // Initialize final mappings with suggestions
        finalMappings = {};
        for (const src of parsedSources) {
          finalMappings[src] = suggestions[src].suggested;
        }
        currentStep = 2;
        render();
      });
    }

    // ── Step 2: Review and assign ────────────────────────────────────────────
    function renderStep2() {
      // Build sorted scenarios array once — passed to renderSourceRow to avoid per-row re-query
      const scenariosArr = Object.values(LEADPRO_REGISTRY.getAllScenarios())
        .sort((a, b) => a.priority - b.priority);

      const needsReview = parsedSources.filter(s => suggestions[s].needsReview);
      const autoMapped  = parsedSources.filter(s => !suggestions[s].needsReview);

      container.innerHTML = `
        <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div>
            <div style="font-size:13px; font-weight:700; color:#e8f0ff; margin-bottom:3px;">Step 2 of 3 — Review Mappings</div>
            <div style="font-size:10px; color:#7a90b8;">
              ${autoMapped.length} sources auto-mapped · ${needsReview.length} need review
            </div>
          </div>

          ${needsReview.length > 0 ? `
            <div style="background:rgba(255,159,67,0.06); border:1px solid rgba(255,159,67,0.2); border-radius:6px; padding:8px 10px;">
              <div style="font-size:9px; font-weight:700; color:#ff9f43; margin-bottom:6px;">⚠ NEEDS REVIEW — Assign a scenario for each</div>
              ${needsReview.map(src => renderSourceRow(src, scenariosArr, true)).join('')}
            </div>
          ` : ''}

          ${autoMapped.length > 0 ? `
            <div>
              <div style="font-size:9px; font-weight:700; color:#00d296; margin-bottom:6px;">✓ AUTO-MAPPED — Verify these look right</div>
              ${autoMapped.map(src => renderSourceRow(src, scenariosArr, false)).join('')}
            </div>
          ` : ''}

          <div style="display:flex; gap:8px;">
            <button id="ob-step2-back" style="
              flex:0; border:1px solid rgba(0,210,150,0.2); cursor:pointer; border-radius:6px;
              padding:9px 14px; font-size:11px; font-weight:600;
              background:transparent; color:#7a90b8;
            ">← Back</button>
            <button id="ob-step2-next" style="
              flex:1; border:none; cursor:pointer; border-radius:6px;
              padding:9px; font-size:12px; font-weight:700;
              background:linear-gradient(135deg, #00d296, #009966); color:#001a0f;
            ">Confirm Mappings →</button>
          </div>
        </div>
      `;

      // Wire selects
      container.querySelectorAll('.ob-scenario-select').forEach(sel => {
        sel.addEventListener('change', function() {
          finalMappings[this.dataset.source] = this.value;
        });
      });

      container.querySelector('#ob-step2-back').addEventListener('click', function() {
        currentStep = 1; render();
      });
      container.querySelector('#ob-step2-next').addEventListener('click', function() {
        currentStep = 3; render();
      });
    }

    function renderSourceRow(src, scenariosArr, needsReview) {
      const sugg = suggestions[src];
      const conf = sugg.confidence;
      const scenario = LEADPRO_REGISTRY.getScenario(sugg.suggested);
      return `
        <div style="
          display:flex; align-items:center; gap:8px;
          padding:7px 0; border-bottom:1px solid rgba(0,210,150,0.06);
        ">
          <div style="flex:1; min-width:0;">
            <div style="font-size:10px; color:#e8f0ff; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${src}">${src}</div>
            ${!needsReview ? `<div style="font-size:9px; color:${CONFIDENCE_COLORS[conf]}; margin-top:1px;">
              ${conf === 'high' ? '●' : '◐'} ${conf} confidence
            </div>` : ''}
          </div>
          <select class="ob-scenario-select" data-source="${src.replace(/"/g,'&quot;')}" style="
            background:#131f33; border:1px solid ${needsReview ? 'rgba(255,159,67,0.4)' : 'rgba(0,210,150,0.2)'};
            border-radius:4px; padding:4px 6px; color:#e8f0ff; font-size:9px;
            max-width:160px; cursor:pointer;
          ">
            ${scenariosArr.map(s => `<option value="${s.id}" ${s.id === finalMappings[src] ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </div>
      `;
    }

    // ── Step 3: Confirm and save ─────────────────────────────────────────────
    function renderStep3() {
      const grouped = {};
      for (const [src, scenId] of Object.entries(finalMappings)) {
        const scen = LEADPRO_REGISTRY.getScenario(scenId);
        const g = scen.group || 'general';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push({ src, scen });
      }

      container.innerHTML = `
        <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div>
            <div style="font-size:13px; font-weight:700; color:#e8f0ff; margin-bottom:3px;">Step 3 of 3 — Confirm & Save</div>
            <div style="font-size:10px; color:#7a90b8;">${parsedSources.length} sources mapped across ${Object.keys(grouped).length} categories</div>
          </div>

          <div style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">
            ${Object.entries(grouped).map(([group, items]) => `
              <div>
                <div style="font-size:9px; font-weight:700; color:#3d5070; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">
                  ${GROUP_LABELS[group] || group}
                </div>
                ${items.map(({src, scen}) => `
                  <div style="display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(0,210,150,0.05);">
                    <div style="font-size:9px; color:#7a90b8; font-family:monospace; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${src}">${src}</div>
                    <div style="font-size:9px; font-weight:600; color:#00d296; flex-shrink:0; margin-left:8px;">${scen.label}</div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>

          <div id="ob-save-error" style="display:none; background:rgba(255,91,91,0.1); border:1px solid rgba(255,91,91,0.3); border-radius:5px; padding:8px; font-size:10px; color:#ff5b5b;"></div>

          <div style="display:flex; gap:8px;">
            <button id="ob-step3-back" style="
              flex:0; border:1px solid rgba(0,210,150,0.2); cursor:pointer; border-radius:6px;
              padding:9px 14px; font-size:11px; font-weight:600;
              background:transparent; color:#7a90b8;
            ">← Back</button>
            <button id="ob-step3-save" style="
              flex:1; border:none; cursor:pointer; border-radius:6px;
              padding:9px; font-size:12px; font-weight:700;
              background:linear-gradient(135deg, #00d296, #009966); color:#001a0f;
            ">✓ Save &amp; Activate</button>
          </div>
        </div>
      `;

      container.querySelector('#ob-step3-back').addEventListener('click', function() {
        currentStep = 2; render();
      });

      container.querySelector('#ob-step3-save').addEventListener('click', function() {
        const registry = {
          mappings: finalMappings,
          version: 1,
          savedAt: Date.now(),
          sourceCount: parsedSources.length
        };
        LEADPRO_REGISTRY.saveRegistry(registry, function() {
          if (onComplete) onComplete(registry);
        });
      });
    }

    render();
  }

  /**
   * Build the source mapping settings panel (for editing after onboarding)
   */
  function buildSourceSettingsUI(container, registry, onSave) {
    const scenarios    = LEADPRO_REGISTRY.getAllScenarios();
    // Pre-sort once so the inner map() per row doesn't re-sort on every source
    const scenariosArr = Object.values(scenarios).sort((a, b) => a.priority - b.priority);
    const scenarioOptionsHtml = scenariosArr.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
    const mappings  = registry.mappings || {};
    const sources   = Object.keys(mappings);

    container.innerHTML = `
      <div style="padding:14px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="font-size:11px; font-weight:700; color:#e8f0ff;">Lead Source Mappings</div>
          <div style="font-size:9px; color:#3d5070;">${sources.length} sources configured</div>
        </div>

        <!-- Import + Re-analyze toolbar -->
        <div style="display:flex; gap:5px; flex-wrap:wrap;">
          <label id="ss-import-label" style="
            background:rgba(56,182,255,0.08); border:1px solid rgba(56,182,255,0.25);
            color:#38b6ff; border-radius:4px; padding:4px 9px; font-size:9px;
            cursor:pointer; font-weight:600; white-space:nowrap; display:inline-block;
          ">⬆ Import CSV / Excel
            <input type="file" id="ss-file-input" accept=".csv,.xlsx,.xls,.txt" style="display:none;">
          </label>
          <button id="ss-reanalyze" style="
            background:rgba(155,109,255,0.08); border:1px solid rgba(155,109,255,0.25);
            color:#9b6dff; border-radius:4px; padding:4px 9px; font-size:9px;
            cursor:pointer; font-weight:600; white-space:nowrap;
          ">⟳ Re-analyze All</button>
        </div>
        <div id="ss-import-status" style="display:none; background:rgba(56,182,255,0.06); border:1px solid rgba(56,182,255,0.2); border-radius:5px; padding:6px 10px; font-size:9px; color:#38b6ff; line-height:1.5;"></div>

        <div style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">
          ${sources.map(src => {
            const current = mappings[src];
            // Inject 'selected' into the pre-built options string for this row's current value
            const rowOptions = scenarioOptionsHtml.replace(`value="${current}"`, `value="${current}" selected`);
            return `
              <div style="display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid rgba(0,210,150,0.06);">
                <div style="flex:1; font-size:9px; color:#7a90b8; font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${src}">${src}</div>
                <select class="ss-scenario-select" data-source="${src.replace(/"/g,'&quot;')}" style="
                  background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:4px;
                  padding:3px 5px; color:#e8f0ff; font-size:9px; max-width:140px; cursor:pointer;
                ">
                  ${rowOptions}
                </select>
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex; gap:6px;">
          <button id="ss-add-source" style="
            flex:0; background:rgba(0,210,150,0.08); border:1px solid rgba(0,210,150,0.25);
            color:#00d296; border-radius:5px; padding:6px 10px; font-size:10px; cursor:pointer;
          ">+ Add Source</button>
          <button id="ss-save" style="
            flex:1; border:none; cursor:pointer; border-radius:5px;
            padding:7px; font-size:11px; font-weight:700;
            background:linear-gradient(135deg, #00d296, #009966); color:#001a0f;
          ">Save Mappings</button>
        </div>

        <div id="ss-add-form" style="display:none; background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px; padding:10px; flex-direction:column; gap:6px;">
          <div style="font-size:9px; color:#7a90b8;">Exact CRM source string (copy/paste from VinSolutions)</div>
          <input id="ss-new-source" placeholder="e.g. New Lead Source Name" style="
            background:#0d1625; border:1px solid rgba(0,210,150,0.15); border-radius:4px;
            padding:6px 8px; color:#e8f0ff; font-size:11px; width:100%; box-sizing:border-box;
          ">
          <select id="ss-new-scenario" style="
            background:#0d1625; border:1px solid rgba(0,210,150,0.15); border-radius:4px;
            padding:6px 8px; color:#e8f0ff; font-size:11px; cursor:pointer;
          ">
            ${Object.values(scenarios).sort((a,b) => a.priority - b.priority)
              .map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
          </select>
          <button id="ss-add-confirm" style="
            border:none; cursor:pointer; border-radius:4px; padding:6px;
            background:#00d296; color:#001a0f; font-size:10px; font-weight:700;
          ">Add</button>
        </div>
      </div>
    `;

    // Track changes
    const updatedMappings = Object.assign({}, mappings);

    container.querySelectorAll('.ss-scenario-select').forEach(sel => {
      sel.addEventListener('change', function() {
        updatedMappings[this.dataset.source] = this.value;
      });
    });

    const addBtn = container.querySelector('#ss-add-source');
    const addForm = container.querySelector('#ss-add-form');
    addBtn.addEventListener('click', function() {
      addForm.style.display = addForm.style.display === 'none' ? 'flex' : 'none';
    });

    // ── CSV/Excel import ───────────────────────────────────────────────
    var ssFileInput  = container.querySelector('#ss-file-input');
    var ssImportStatus = container.querySelector('#ss-import-status');

    if (ssFileInput) {
      ssFileInput.addEventListener('change', function(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var ext = file.name.split('.').pop().toLowerCase();
        ssImportStatus.style.display = 'block';
        ssImportStatus.textContent = 'Reading ' + file.name + '...';

        function processRows(rows) {
          var extracted = extractSourcesFromRows(rows);
          if (!extracted.sources.length) {
            ssImportStatus.textContent = '✗ No sources found. Check column headers.';
            ssImportStatus.style.color = '#ff5b5b';
            return;
          }
          // Auto-suggest for new sources only
          var newSources = extracted.sources.filter(function(s) { return !updatedMappings[s]; });
          var existing   = extracted.sources.filter(function(s) { return !!updatedMappings[s]; });
          var suggestions = LEADPRO_REGISTRY.autoSuggestMappings(newSources);
          newSources.forEach(function(s) {
            updatedMappings[s] = suggestions[s].suggested;
          });
          ssImportStatus.textContent = '✓ ' + extracted.sources.length + ' sources imported — '
            + newSources.length + ' new, ' + existing.length + ' already mapped. '
            + (extracted.column ? '(column: "' + extracted.column + '")' : '')
            + ' — Save Mappings to confirm.';
          ssImportStatus.style.color = '#00d296';
          ssImportStatus.style.borderColor = 'rgba(0,210,150,0.2)';
          ssImportStatus.style.background = 'rgba(0,210,150,0.06)';
          // Rebuild UI with merged mappings
          var merged = Object.assign({}, registry, { mappings: updatedMappings });
          buildSourceSettingsUI(container, merged, onSave);
        }

        if (ext === 'csv' || ext === 'txt') {
          var reader = new FileReader();
          reader.onload = function(ev) {
            var rows = (ev.target.result || '').split(/[\r\n]+/)
              .filter(function(l) { return l.trim(); })
              .map(function(line) {
                var fields = []; var cur = ''; var inQ = false;
                for (var ci = 0; ci < line.length; ci++) {
                  var ch = line[ci];
                  if (ch === '"') { inQ = !inQ; }
                  else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
                  else { cur += ch; }
                }
                fields.push(cur.trim());
                return fields;
              });
            processRows(rows);
          };
          reader.readAsText(file);
        } else if ((ext === 'xlsx' || ext === 'xls') && typeof XLSX !== 'undefined') {
          var reader2 = new FileReader();
          reader2.onload = function(ev) {
            try {
              var wb = XLSX.read(ev.target.result, { type: 'array' });
              var ws = wb.Sheets[wb.SheetNames[0]];
              processRows(XLSX.utils.sheet_to_json(ws, { header: 1 }));
            } catch(err) {
              ssImportStatus.textContent = '✗ Could not parse Excel: ' + (err.message || '');
              ssImportStatus.style.color = '#ff5b5b';
            }
          };
          reader2.readAsArrayBuffer(file);
        } else {
          ssImportStatus.textContent = 'Excel detected — save as CSV first, then import. Or paste source names into + Add Source.';
          ssImportStatus.style.color = '#f5c842';
        }
        ssFileInput.value = '';
      });
    }

    // ── Re-analyze all ────────────────────────────────────────────────
    var reanalyzeBtn = container.querySelector('#ss-reanalyze');
    if (reanalyzeBtn) {
      reanalyzeBtn.addEventListener('click', function() {
        var allSources = Object.keys(updatedMappings);
        var suggestions = LEADPRO_REGISTRY.autoSuggestMappings(allSources);
        var changed = 0;
        allSources.forEach(function(s) {
          var prev = updatedMappings[s];
          var newSugg = suggestions[s].suggested;
          // Only update if currently 'standard' (unmatched) and we found something better
          if (prev === 'standard' && newSugg !== 'standard') {
            updatedMappings[s] = newSugg;
            changed++;
          }
        });
        if (changed > 0) {
          ssImportStatus.style.display = 'block';
          ssImportStatus.textContent = '⟳ Re-analyzed ' + allSources.length + ' sources — ' + changed + ' updated from Standard to better matches. Save Mappings to confirm.';
          ssImportStatus.style.color = '#9b6dff';
          ssImportStatus.style.borderColor = 'rgba(155,109,255,0.2)';
          ssImportStatus.style.background = 'rgba(155,109,255,0.06)';
          var merged = Object.assign({}, registry, { mappings: updatedMappings });
          buildSourceSettingsUI(container, merged, onSave);
        } else {
          ssImportStatus.style.display = 'block';
          ssImportStatus.textContent = '✓ All sources already have the best available match — nothing to update.';
          ssImportStatus.style.color = '#00d296';
          ssImportStatus.style.background = 'rgba(0,210,150,0.06)';
          ssImportStatus.style.borderColor = 'rgba(0,210,150,0.2)';
        }
      });
    }

    // ── Shared row extractor (reused from onboarding) ─────────────────
    function extractSourcesFromRows(rows) {
      if (!rows || !rows.length) return { sources: [], column: null };
      var header = rows[0].map(function(h) { return String(h || '').toLowerCase().trim(); });
      var colIdx = -1, colName = null;
      var keywords = ['source', 'lead source', 'leadsource', 'source name', 'lead_source', 'type', 'lead type'];
      for (var ki = 0; ki < keywords.length; ki++) {
        var idx = header.indexOf(keywords[ki]);
        if (idx !== -1) { colIdx = idx; colName = rows[0][idx]; break; }
      }
      if (colIdx === -1) {
        for (var hi = 0; hi < header.length; hi++) {
          if (header[hi].includes('source') || header[hi].includes('lead')) {
            colIdx = hi; colName = rows[0][hi]; break;
          }
        }
      }
      var sources = [];
      if (colIdx !== -1) {
        for (var ri = 1; ri < rows.length; ri++) {
          var v = String(rows[ri][colIdx] || '').trim();
          if (v && v.length > 1) sources.push(v);
        }
      } else {
        var startRow = /[a-zA-Z]/.test(rows[0][0]) ? 1 : 0;
        for (var ri2 = startRow; ri2 < rows.length; ri2++) {
          var v2 = String(rows[ri2][0] || '').trim();
          if (v2 && v2.length > 1) sources.push(v2);
        }
        colName = startRow === 1 ? rows[0][0] : null;
      }
      sources = sources.filter(function(s, i, arr) { return arr.indexOf(s) === i; });
      return { sources: sources, column: colName };
    }

    container.querySelector('#ss-add-confirm').addEventListener('click', function() {
      const src = container.querySelector('#ss-new-source').value.trim();
      const scenId = container.querySelector('#ss-new-scenario').value;
      if (!src) return;
      updatedMappings[src] = scenId;
      const updated = Object.assign({}, registry, { mappings: updatedMappings, savedAt: Date.now() });
      LEADPRO_REGISTRY.saveRegistry(updated, function() {
        if (onSave) onSave(updated);
        buildSourceSettingsUI(container, updated, onSave);
      });
    });

    container.querySelector('#ss-save').addEventListener('click', function() {
      const updated = Object.assign({}, registry, { mappings: updatedMappings, savedAt: Date.now() });
      LEADPRO_REGISTRY.saveRegistry(updated, function() {
        if (onSave) onSave(updated);
        const btn = container.querySelector('#ss-save');
        btn.textContent = '✓ Saved';
        btn.style.background = 'rgba(0,210,150,0.2)';
        setTimeout(() => {
          btn.textContent = 'Save Mappings';
          btn.style.background = 'linear-gradient(135deg, #00d296, #009966)';
        }, 1500);
      });
    });
  }

  return {
    buildOnboardingUI,
    buildSourceSettingsUI
  };

})();
