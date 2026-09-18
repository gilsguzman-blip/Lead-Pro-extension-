/**
 * Lead Pro — Cloudflare Worker v3.6
 * Promise.any hedge strategy: primary fires immediately, secondary at +400ms,
 * pro at +1000ms. First success wins and cancels the rest.
 *
 * Every invocation emits one structured JSON log line (evt:"gemini_req")
 * carrying the per-tier outcome, so failures can be broken down after the
 * fact — see tools/README.md. Lead content is never logged.
 */

const PRIMARY_MODEL   = 'gemini-3.1-flash-lite-preview';
const SECONDARY_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL  = 'gemini-3.1-pro-preview';

const TIMEOUT_MS = 12000;

export default {
  async fetch(request, env, ctx) {

    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    // cf-ray ties this line back to Cloudflare's own request log.
    const rid     = request.headers.get('cf-ray') || crypto.randomUUID().slice(0, 8);
    const started = Date.now();

    // Reject-before-Gemini paths used to be invisible in the logs.
    const reject = (status, error) => {
      console.error(JSON.stringify({ evt: 'gemini_reject', rid, status, error }));
      return corsResponse(JSON.stringify({ error }), status);
    };

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return reject(500, 'Missing API key');

    let body;
    try { body = await request.json(); }
    catch { return reject(400, 'Invalid JSON'); }

    if (!body.contents || !body.system_instruction)
      return reject(400, 'Missing required fields');

    // Honour generationConfig from the caller; fall back to safe defaults.
    const generationConfig = body.generationConfig || {
      temperature:      0.5,
      maxOutputTokens:  3000,
      responseMimeType: 'application/json'
    };

    const geminiPayload = {
      system_instruction: body.system_instruction,
      contents:           body.contents,
      generationConfig
    };

    const controller = new AbortController();

    // One controller serves two very different aborts. Recording which one
    // fired is what separates "another tier already won" (expected, two per
    // request) from "the 12s ceiling hit" (a real failure).
    let abortReason = null;
    const timeout = setTimeout(() => {
      abortReason = abortReason || 'timeout';
      controller.abort();
    }, TIMEOUT_MS);

    const attempts = [];

    const callGemini = async (model, delay = 0, tag = '') => {
      const record = { tier: tag, model, wait: delay, ms: 0, ok: false };
      attempts.push(record);

      if (delay) await scheduler.wait(delay);
      const t0 = Date.now();

      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(geminiPayload),
            signal:  controller.signal
          }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          record.ms     = Date.now() - t0;
          record.err    = 'http';
          record.status = res.status;
          record.reason = errBody?.error?.status || null;   // RESOURCE_EXHAUSTED, INVALID_ARGUMENT, ...
          record.msg    = String(errBody?.error?.message || '').slice(0, 300);
          throw new Error(record.msg || `${model} HTTP ${res.status}`);
        }
        const data  = await res.json();
        record.ms   = Date.now() - t0;
        record.ok   = true;
        data._model = model;
        data._tier  = tag;
        abortReason = abortReason || 'winner';
        controller.abort(); // cancel the other in-flight requests
        return data;

      } catch (err) {
        if (!record.err) {                  // not already classified above
          record.ms  = Date.now() - t0;
          if (err.name === 'AbortError') {
            record.err = abortReason === 'timeout' ? 'timeout' : 'cancelled';
          } else {
            record.err = 'network';
            record.msg = String(err.message || err).slice(0, 300);
          }
        }
        throw err;
      }
    };

    const calls = [
      callGemini(PRIMARY_MODEL,      0,    'primary'),
      callGemini(SECONDARY_MODEL,  400,    'secondary'),
      callGemini(FALLBACK_MODEL,  1000,    'pro')
    ];

    // The losing tiers only settle once the winner aborts them, which can be
    // after the response is already on the wire — waitUntil keeps the
    // invocation alive long enough for their outcomes to reach the log.
    // ms is captured when the response is produced, not when the tiers settle
    // — the losers can outlive the response by a second and would inflate it.
    const logRequest = (ok, winner) => {
      const ms = Date.now() - started;
      return Promise.allSettled(calls).then(() => {
        const line = JSON.stringify({ evt: 'gemini_req', rid, ok, winner, ms, tiers: attempts });
        if (ok) console.log(line); else console.error(line);
      });
    };

    const keepAlive = p => { if (ctx && ctx.waitUntil) ctx.waitUntil(p); };

    try {
      const result = await Promise.any(calls);
      clearTimeout(timeout);
      keepAlive(logRequest(true, result._tier));
      return corsResponse(JSON.stringify(result), 200);

    } catch (err) {
      clearTimeout(timeout);
      // AggregateError when all three reject — extract individual messages.
      const detail = err.errors
        ? err.errors.map(e => e.message).join(' | ')
        : err.message;
      keepAlive(logRequest(false, null));
      return corsResponse(JSON.stringify({ error: 'Gemini unavailable', detail }), 503);
    }
  }
};

function corsResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options':       'nosniff'
    }
  });
}
