/**
 * Lead Pro — Cloudflare Worker v3.5
 * Promise.any hedge strategy: primary fires immediately, secondary at +400ms,
 * pro at +1000ms. First success wins and cancels the rest.
 */

const PRIMARY_MODEL   = 'gemini-3.1-flash-lite-preview';
const SECONDARY_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL  = 'gemini-3.1-pro-preview';

const TIMEOUT_MS = 12000;

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey)
      return corsResponse(JSON.stringify({ error: 'Missing API key' }), 500);

    let body;
    try { body = await request.json(); }
    catch { return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400); }

    if (!body.contents || !body.system_instruction)
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400);

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
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const callGemini = async (model, delay = 0, tag = '') => {
      if (delay) await scheduler.wait(delay);
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
        throw new Error(errBody?.error?.message || `${model} HTTP ${res.status}`);
      }
      const data = await res.json();
      data._model = model;
      data._tier  = tag;
      controller.abort(); // cancel the other in-flight requests
      return data;
    };

    try {
      const result = await Promise.any([
        callGemini(PRIMARY_MODEL,      0,    'primary'),
        callGemini(SECONDARY_MODEL,  400,    'secondary'),
        callGemini(FALLBACK_MODEL,  1000,    'pro')
      ]);
      clearTimeout(timeout);
      return corsResponse(JSON.stringify(result), 200);

    } catch (err) {
      clearTimeout(timeout);
      // AggregateError when all three reject — extract individual messages.
      const detail = err.errors
        ? err.errors.map(e => e.message).join(' | ')
        : err.message;
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
