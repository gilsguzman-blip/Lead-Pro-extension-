/*
 * Lead Pro Lot Age — core logic (v1.0)
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
    'e-tron GT', 'TT', 'R8',
  ].sort((a, b) => b.length - a.length);

  const AGED_WARN = 60;    // amber
  const AGED_ALERT = 90;   // red

  function _norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

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
    const model = String((unit && unit.model) || '').trim();
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
    const model = String((unit && unit.model) || '').trim();
    const fam = family(unit);
    const words = fam.split(/\s+/).length;
    return model.split(/\s+/).slice(words).join(' ');
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
      return Object.assign({}, u, {
        _family: family(u),
        _trim: trim(u),
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
  function matchQuery(u, q) {
    const words = _norm(q).split(' ').filter(Boolean);
    return words.every(w => u._hay.includes(w));
  }

  function filter(units, opts) {
    opts = opts || {};
    return units.filter(u =>
      matchCondition(u, opts.condition) &&
      (!opts.family || u._family === opts.family) &&
      (!opts.color || _norm(u.color) === _norm(opts.color)) &&
      (!opts.query || matchQuery(u, opts.query))
    ).sort(byOldest);
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
    daysBetween, todayISO, ageToday, family, trim, ageBand, prepare, byOldest, filter, families, colors, summary,
  };
});
