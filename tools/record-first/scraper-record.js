'use strict';
// RECORD-FIRST (experiment). The scraper half: every note on the lead, as VinSolutions shows it.
//
// inlineScraper is serialised and injected into the CRM frame, so this has to live INSIDE that function
// and depend on nothing outside it. Until the experiment is adopted it is not in the shipped build:
// patchScraper() inserts it into a copy of popup.js for the replay harness, at the same place it would go.
//
// The transcript the current prompt is built from caps at 150 notes, drops lead-received forms, system
// notes, auto-responses and valuation reports, and shortens entries later. This keeps everything and judges
// nothing: date, title, direction, tags and the full body. Cleaning and labelling happen in record-first.js.

const ANCHOR = "      scrapedAt:Date.now(),";
const SNIPPET = `      // (RECORD-FIRST) every note, untruncated -- see tools/record-first/scraper-record.js
      recordNotes: (function () {
        var out = [];
        try {
          for (var _rn = 0; _rn < noteEls.length && _rn < 400; _rn++) {
            var _ri = noteEls[_rn];
            var _rc = _ri.querySelector('.notes-and-history-item-content');
            var _rIn = (_rc && _rc.innerText || '').trim(), _rTx = (_rc && _rc.textContent || '').trim();
            out.push({
              when:  ((_ri.querySelector('.notes-and-hsitory-item-date') || {}).innerText || '').trim(),
              title: ((_ri.querySelector('.legacy-notes-and-history-title') || {}).innerText || '').trim(),
              dir:   (_ri.getAttribute('data-direction') || '').toLowerCase(),
              tags:  (_ri.getAttribute('data-tags') || ''),
              body:  (_rTx.length > _rIn.length + 20 && _rTx.length > _rIn.length * 1.3) ? _rTx : _rIn
            });
          }
        } catch (eRec) { _lpD('[LP RECORD DIAG] threw while reading notes: ' + (eRec && eRec.message)); }
        return out;
      })(),
      recordLeadStartMs: (typeof _lpMarkerMs === 'number') ? _lpMarkerMs : 0,
`;

function patchScraper(src) {
  if (src.indexOf('recordNotes:') >= 0) return src;
  const i = src.indexOf(ANCHOR);
  if (i < 0 || src.indexOf(ANCHOR, i + 1) >= 0) throw new Error('scraper anchor not found exactly once');
  return src.slice(0, i) + SNIPPET + src.slice(i);
}

module.exports = { patchScraper, SNIPPET };
