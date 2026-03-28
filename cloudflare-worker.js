// ─────────────────────────────────────────────────────────────────
// Lead Pro — Cloudflare Worker Proxy
// Sits between the Chrome extension and the Gemini API.
// The Gemini API key lives here as a secret — never in the extension.
//
// Deploy to Cloudflare Workers (free tier).
// Set the GEMINI_API_KEY environment variable as a Secret (not plain text).
// ─────────────────────────────────────────────────────────────────

const PRIMARY_MODEL  = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash';

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const ALLOWED_ORIGINS = [];

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')    return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    if (ALLOWED_ORIGINS.length > 0) {
      const origin = request.headers.get('Origin') || '';
      if (!ALLOWED_ORIGINS.includes(origin))
        return corsResponse(JSON.stringify({ error: 'Origin not allowed' }), 403);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return corsResponse(JSON.stringify({ error: 'Invalid JSON body' }), 400); }

    if (!body.contents || !body.system_instruction)
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return corsResponse(JSON.stringify({ error: 'API key not configured' }), 500);

    const geminiPayload = {
      system_instruction: body.system_instruction,
      contents:           body.contents,
      generationConfig:   body.generationConfig || {
        temperature:      0.35,
        maxOutputTokens:  3000,
        topP:             0.9,
        responseMimeType: 'application/json'
      }
    };

    // ── Try primary model, then fallback, with retry on rate limit ──
    const models = [PRIMARY_MODEL, FALLBACK_MODEL];

    for (let m = 0; m < models.length; m++) {
      const model = models[m];
      const url   = `${geminiUrl(model)}?key=${apiKey}`;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await sleep(2000); // wait 2s before retry

        let resp;
        try {
          resp = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(geminiPayload)
          });
        } catch (e) {
          if (m === models.length - 1 && attempt === 1)
            return corsResponse(JSON.stringify({ error: 'Failed to reach Gemini API', detail: e.message }), 502);
          continue;
        }

        // Success
        if (resp.status === 200) {
          const data = await resp.json();
          // Tag which model was used so popup.js can log it
          if (m > 0 || attempt > 0) data._fallback = { model, attempt };
          return corsResponse(JSON.stringify(data), 200);
        }

        // Rate limited — retry or try fallback
        if (resp.status === 429 || resp.status === 503) {
          const errText = await resp.text();
          const isOverloaded = errText.includes('high demand') || errText.includes('overloaded') || errText.includes('RESOURCE_EXHAUSTED');
          if (isOverloaded) continue; // retry this model once, then fall to next
          // Non-retryable error on this model — break to fallback
          break;
        }

        // Other error — return it
        const data = await resp.json().catch(() => ({ error: resp.statusText }));
        return corsResponse(JSON.stringify(data), resp.status);
      }
    }

    return corsResponse(JSON.stringify({ error: 'Gemini API unavailable after retries. Please try again in a moment.' }), 503);
  }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function corsResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
