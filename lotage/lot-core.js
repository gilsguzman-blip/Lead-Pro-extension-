/*
 * Lead Pro Lot Age — core logic (v1.1)
 *
 * Pure functions, no DOM. Loaded by lotage/index.html in the browser and required by
 * tests/lotage-core.test.js in node, so the sorting a salesperson sees is the sorting the
 * tests check.
 *
 * Data source: GET /inventory?dealer=<id> on the Lead Pro proxy, the same per-store blob the
 * Data Tool publishes from the vAuto Merchandising export. Each unit carries daysOnLot (vAuto's
 * "Age" column) AS OF the export date in blob.generated, so the age shown today is
 * daysOnLot + whole days since that export.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LotCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Same five rooftops as the Data Tool's DEALER_MAP / ID2LABEL.
  const STORES = [
    { id: '6189',  label: 'Toyota Baytown',  make: 'Toyota' },
    { id: '6190',  label: 'Kia Baytown',     make: 'Kia' },
    { id: '6191',  label: 'Honda Baytown',   make: 'Honda' },
    { id: '24399', label: 'Honda Lafayette', make: 'Honda' },
    { id: '21135', label: 'Audi Lafayette',  make: 'Audi' },
  ];

  // Model families. Longest match wins, so "Grand Highlander" beats "Highlander" and
  // "Corolla Cross" beats "Corolla". Hybrid / Plug-in variants fold into their family; the
  // refine box narrows to them ("hybrid").
  const FAMILIES = [
    // Toyota
    'Corolla Cross', 'Corolla', 'Camry', 'Crown Signia', 'Crown', 'Prius', 'Tacoma', 'Tundra', 'RAV4',
    'Grand Highlander', 'Highlander', '4Runner', 'Sequoia', 'Venza', 'Sienna', 'bZ4X', 'bZ', 'GR86',
    'GR Corolla', 'GR Supra', 'Supra', 'Land Cruiser', 'C-HR', 'Mirai',
    // Honda
    'HR-V', 'CR-V', 'Prologue', 'Pilot', 'Passport', 'Civic', 'Accord', 'Prelude', 'Ridgeline', 'Odyssey',
    // Kia
    'Telluride', 'Sportage', 'Sorento', 'Seltos', 'Soul', 'Carnival', 'K5', 'K4', 'Forte', 'Stinger',
    'EV9', 'EV6', 'EV4', 'EV3', 'Niro',
    // Audi
    'Q3', 'Q4 e-tron', 'Q5', 'Q6 e-tron', 'Q7', 'Q8 e-tron', 'Q8', 'Q9', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
    'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'SQ5', 'SQ7', 'SQ8', 'SQ9', 'RS3', 'RS5', 'RS6', 'RS7', 'RS Q8',
    'e-tron GT', 'RS e-tron GT', 'TT', 'R8',
    // (v1.1) Audi's electric lines as vAuto spells them (11/28 export: "SQ6 e-tron Prestige",
    // "A6 Sportback e-tron Premium"). Without these, SQ6 grouped alone and the A6 e-tron sat in
    // the gas A6 list.
    'A6 Sportback e-tron', 'A6 e-tron', 'S6 Sportback e-tron', 'S6 e-tron', 'SQ6 e-tron',
    'Q6 Sportback e-tron', 'SQ6 Sportback e-tron', 'SQ8 e-tron', 'Q8 Sportback e-tron',
  ].sort((a, b) => b.length - a.length);
  const AUDI_FAMILIES = new Set(['Q3', 'Q5', 'Q7', 'Q8', 'Q9', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8',
    'SQ5', 'SQ7', 'SQ8', 'SQ9', 'RS3', 'RS5', 'RS6', 'RS7', 'RS Q8', 'TT', 'R8']);

  const AGED_WARN = 60;    // amber
  const AGED_ALERT = 90;   // red

  // Lowercase words, punctuation as spaces. (v1.1) "+" is a word ("plus"), because Ridgeline
  // TrailSport and TrailSport+ are different trucks and dropping it merged them.
  function _norm(s) { return String(s || '').toLowerCase().replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').trim(); }

  // (v1.1) vAuto writes "RS 3 2.5T quattro"; the model is the RS3.
  function _model(unit) {
    return String((unit && unit.model) || '').trim().replace(/\s+/g, ' ').replace(/^(RS|SQ|S) (\d)\b/, '$1$2');
  }

  // Whole days between two YYYY-MM-DD dates (b - a), in local calendar days.
  function daysBetween(a, b) {
    const pa = String(a || '').match(/^(\d{4})-(\d{2})-(\d{2})/), pb = String(b || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!pa || !pb) return null;
    const da = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]), db = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
    return Math.round((db - da) / 86400000);
  }

  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Age today. Null when the export had no Age for the unit -- never guessed.
  function ageToday(unit, generated, today) {
    const base = unit && Number.isFinite(unit.daysOnLot) ? unit.daysOnLot : null;
    if (base === null) return null;
    const drift = daysBetween(generated, today);
    return base + (drift !== null && drift > 0 ? drift : 0);
  }

  // "RAV4" from model "RAV4 Hybrid XLE Premium". Falls back to the first word, so a used
  // Wrangler at the Toyota store still groups as "Wrangler".
  function family(unit) {
    const model = _model(unit);
    if (!model) return 'Other';
    const m = _norm(model);
    for (const f of FAMILIES) {
      const nf = _norm(f);
      if (m === nf || m.startsWith(nf + ' ')) return f;
    }
    return model.split(/\s+/)[0];
  }

  // What follows the family name: "Hybrid XLE Premium".
  function trim(unit) {
    const model = _model(unit);
    const fam = family(unit);
    const words = fam.split(/\s+/).length;
    return model.split(/\s+/).slice(words).join(' ');
  }

  // (v1.1) Trims are split into powertrain + drive + the trim itself, so "Hybrid Sport-L",
  // "Sport-L" and "Sport-L AWD" are one trim ("Sport-L") with the powertrain as its own filter.
  // On 11/28 at Honda Baytown "Sport" listed Sport, Sport-L, Sport Touring, TrailSport and every
  // Passport in one pile; the trim filter is what lets a salesperson pick exactly one.
  //
  // Checked against all five stores' 11/28 exports (936 new units). What each rule is for:
  //   - drive words (AWD, quattro, FrontTrak) are not the trim: "Q6 e-tron Premium Plus" and
  //     "... Premium Plus quattro" are one trim;
  //   - Audi engine codes are not the trim either: "Q5 2.0T Premium Plus" is a Premium Plus,
  //     "Q7 55 Premium Plus" too ("A8 L 55" keeps its L);
  //   - "Base" next to a real name is noise: "Civic Si Base" is a Si, "bZ Woodland Base" a Woodland;
  //   - spelling is folded for the KEY (case, hyphen vs space): Tacoma "TRD Off-Road" and the
  //     hybrid's "TRD Off Road", Kia "SX-Prestige" and "SX Prestige", Audi "S Line" and "S line".
  //     The label shows the most common spelling.
  // Powertrain: what the model name states (Hybrid, Plug-in Hybrid, EV, e-tron), or a model
  // that has no gas version in that year (Prius; Sienna, Crown, Venza; Camry 2025+; RAV4 2026+,
  // which vAuto writes as plain "RAV4 LE").
  const EV_FAMILIES = ['Prologue', 'bZ4X', 'bZ', 'EV9', 'EV6', 'EV4', 'EV3', 'Q4 e-tron', 'Q6 e-tron', 'Q8 e-tron', 'e-tron GT',
    'RS e-tron GT', 'Mirai', 'A6 Sportback e-tron', 'A6 e-tron', 'S6 Sportback e-tron', 'S6 e-tron', 'SQ6 e-tron',
    'Q6 Sportback e-tron', 'SQ6 Sportback e-tron', 'SQ8 e-tron', 'Q8 Sportback e-tron'];
  const HYBRID_FROM = { 'Prius': 0, 'Sienna': 2021, 'Crown': 0, 'Crown Signia': 0, 'Venza': 0, 'Camry': 2025, 'RAV4': 2026 };
  const DRIVE_RX = /^(awd|fwd|rwd|4wd|2wd|4x4|4x2|e-?awd|quattro|fronttrak)$/i;
  const AUDI_ENGINE_RX = /^(\d\.\dt?|tfsi|tfsie|tdi|35|40|45|50|55|60|70)$/i;
  function trimParts(unit) {
    const fam = family(unit);
    let words = trim(unit).split(/\s+/).filter(Boolean);
    let power = 'Gas';
    if (EV_FAMILIES.includes(fam) || /\be-tron\b/i.test(_model(unit))) power = 'Electric';
    else if (fam in HYBRID_FROM && (unit.year || 0) >= HYBRID_FROM[fam]) power = 'Hybrid';
    const t = words.join(' ');
    let m;
    if ((m = t.match(/\b(plug-?in hybrid|phev)\b/i))) power = 'Plug-in Hybrid';
    else if ((m = t.match(/\bhybrid\b/i))) power = 'Hybrid';
    else if ((m = t.match(/^ev\b/i))) power = 'Electric';
    if (m) words = t.replace(m[0], ' ').split(/\s+/).filter(Boolean);
    const drive = words.filter(w => DRIVE_RX.test(w)).map(w => w.toUpperCase());
    words = words.filter(w => !DRIVE_RX.test(w));
    if (AUDI_FAMILIES.has(fam) || /^audi$/i.test(unit.make || '')) words = words.filter(w => !AUDI_ENGINE_RX.test(w));
    if (words.length > 1) words = words.filter(w => !/^base$/i.test(w));
    // Nothing left means vAuto gave no trim (Audi "A5 quattro"): say so rather than call it a Base.
    let base = words.join(' ') || 'Trim not listed';
    return { power, drive: drive.join(' '), base: base.charAt(0).toUpperCase() + base.slice(1) };
  }

  function ageBand(age) {
    if (age === null || age === undefined) return 'unknown';
    if (age >= AGED_ALERT) return 'alert';
    if (age >= AGED_WARN) return 'warn';
    return 'fresh';
  }

  // Attach computed fields once per load.
  function prepare(inventory, today) {
    const gen = inventory && inventory.generated;
    const units = (inventory && Array.isArray(inventory.units) ? inventory.units : []).map(u => {
      const age = ageToday(u, gen, today);
      const tp = trimParts(u);
      const fam = family(u);
      return Object.assign({}, u, {
        _family: fam,
        _trim: trim(u),
        _power: tp.power,
        _trimBase: tp.base,
        _trimKey: fam + '|' + _norm(tp.base),
        // (v1.1) No body type here: vAuto's "Sport Utility" and "Passenger Van" made "sport" match every
        // CR-V and "pass" match every Odyssey.
        _words: _norm([u.vehicle, u.year, u.make, _model(u), u.color, u.interior].join(' ')).split(' '),
        _age: age,
        _band: ageBand(age),
        _hay: _norm([u.vehicle, u.year, u.make, u.model, u.color, u.interior, u.stock, u.vin, u.body].join(' ')),
      });
    });
    return { store: inventory && inventory.store, generated: gen || null, units };
  }

  // Oldest first. Unknown age sorts last (a missing Age must never look like the oldest car).
  // Ties: older model year first, then stock number, so the order is stable.
  function byOldest(a, b) {
    const aa = a._age, bb = b._age;
    if (aa === null && bb !== null) return 1;
    if (bb === null && aa !== null) return -1;
    if (aa !== bb) return bb - aa;
    if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) - (b.year || 0);
    return String(a.stock || '').localeCompare(String(b.stock || ''));
  }

  function matchCondition(u, cond) {
    if (!cond || cond === 'all') return true;
    if (cond === 'used') return u.condition === 'used' || u.condition === 'cpo';
    return u.condition === cond;
  }

  // Every word of the refine text must appear (so "xle hybrid" finds XLE hybrids in any order).
  // (v1.1) WHOLE WORDS FIRST. "sport" matches the word Sport (so Sport, Sport-L, Sport Touring)
  // and no longer Sportage, Sportback, Passport or TrailSport. Only when no car in the store has
  // the whole word does it fall back to "starts with", so "pass" still finds Passport while
  // typing. A word with a digit in it is a stock number or VIN piece and matches anywhere
  // ("9503" finds stock TB099503).
  function _queryPlan(units, q) {
    return _norm(q).split(' ').filter(Boolean).map(w => {
      if (/\d/.test(w)) return { w, mode: 'any' };
      const exact = units.some(u => (u._words || []).includes(w));
      return { w, mode: exact ? 'word' : 'prefix' };
    });
  }
  // A one-letter word belongs to the word before it: "sport l" is Sport-L, not Sport + EX-L.
  function matchQuery(u, plan) {
    const vw = u._words || [];
    return plan.every((p, i) => {
      if (p.mode === 'any') return u._hay.includes(p.w);
      if (p.w.length === 1 && i > 0 && plan[i - 1].mode !== 'any') {
        const prev = plan[i - 1].w;
        return vw.some((x, j) => j > 0 && x === p.w && vw[j - 1].startsWith(prev));
      }
      return p.mode === 'word' ? vw.includes(p.w) : vw.some(x => x.startsWith(p.w));
    });
  }

  function filter(units, opts) {
    opts = opts || {};
    const pool = units.filter(u =>
      matchCondition(u, opts.condition) &&
      (!opts.family || u._family === opts.family) &&
      (!opts.power || u._power === opts.power) &&
      (!opts.trim || u._trimKey === opts.trim) &&
      (!opts.color || _norm(u.color) === _norm(opts.color)));
    // Whole word vs starts-with is decided on the cars being searched, so at Kia "sport" still
    // finds Sportage even if some used car elsewhere in the export says "Sport".
    const plan = opts.query ? _queryPlan(pool, opts.query) : null;
    return (plan ? pool.filter(u => matchQuery(u, plan)) : pool).sort(byOldest);
  }

  // Powertrain chips, only when the list mixes them (Gas + Hybrid CR-Vs, say).
  function powers(units) {
    const map = {};
    for (const u of units) map[u._power] = (map[u._power] || 0) + 1;
    const order = ['Gas', 'Hybrid', 'Plug-in Hybrid', 'Electric'];
    return Object.keys(map).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(p => ({ power: p, count: map[p] }));
  }

  // Trim chips, alphabetical so look-alikes sit side by side (Sport, Sport Touring, Sport-L;
  // TrailSport, TrailSport Elite). When a search spans models the label carries the model
  // ("CR-V Sport" vs "Civic Sport"), because those are different cars.
  function trims(units) {
    const map = {};
    const fams = new Set(units.map(u => u._family));
    for (const u of units) {
      const k = u._trimKey;
      const t = map[k] || (map[k] = { trim: k, family: u._family, spellings: {}, count: 0, oldest: null });
      t.count++;
      t.spellings[u._trimBase] = (t.spellings[u._trimBase] || 0) + 1;
      if (u._age !== null && (t.oldest === null || u._age > t.oldest)) t.oldest = u._age;
    }
    return Object.values(map).map(t => {
      // Most common spelling; on a tie the hyphenated one ("TRD Off-Road" is Toyota's name),
      // then the one with more capitals ("S Line" over "S line").
      const cnt = (s, rx) => (s.match(rx) || []).length;
      const sp = Object.keys(t.spellings).sort((a, b) => t.spellings[b] - t.spellings[a] ||
        cnt(b, /-/g) - cnt(a, /-/g) || cnt(b, /[A-Z]/g) - cnt(a, /[A-Z]/g))[0];
      return { trim: t.trim, label: fams.size > 1 ? t.family + ' ' + sp : sp, count: t.count, oldest: t.oldest };
    }).sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
  }

  // Family chips: [{family, count, oldest}] most-stocked first.
  function families(units, condition) {
    const map = {};
    for (const u of units) {
      if (!matchCondition(u, condition)) continue;
      const f = map[u._family] || (map[u._family] = { family: u._family, count: 0, oldest: null });
      f.count++;
      if (u._age !== null && (f.oldest === null || u._age > f.oldest)) f.oldest = u._age;
    }
    return Object.values(map).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
  }

  function colors(units) {
    const map = {};
    for (const u of units) { const c = String(u.color || '').trim(); if (c) map[c] = (map[c] || 0) + 1; }
    return Object.keys(map).sort((a, b) => map[b] - map[a] || a.localeCompare(b)).map(c => ({ color: c, count: map[c] }));
  }

  function summary(units) {
    const ages = units.map(u => u._age).filter(a => a !== null);
    return {
      count: units.length,
      oldest: ages.length ? Math.max.apply(null, ages) : null,
      avg: ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null,
      aged: ages.filter(a => a >= AGED_ALERT).length,
    };
  }

  return {
    STORES, FAMILIES, AGED_WARN, AGED_ALERT,
    daysBetween, todayISO, ageToday, family, trim, trimParts, ageBand, prepare, byOldest, filter, families, colors, summary, powers, trims,
  };
});
