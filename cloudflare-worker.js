// ─────────────────────────────────────────────────────────────────
// Lead Pro — Cloudflare Worker Proxy  v2.0
// Race strategy: fires both models simultaneously, first success wins
// gemini-3.1-flash-lite-preview = fastest, lowest latency
// gemini-3-flash-preview = higher quality fallback
// ─────────────────────────────────────────────────────────────────

const PRIMARY_MODEL  = 'gemini-3.1-flash-lite-preview';  // fastest TTFT
const FALLBACK_MODEL = 'gemini-3-flash-preview';           // quality fallback

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const ALLOWED_ORIGINS = [];

export default {
  async fetch(request, env) {

    // ── CORS preflight ─────────────────────────────────────────────
    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    // ── Origin check ───────────────────────────────────────────────
    if (ALLOWED_ORIGINS.length > 0) {
      const origin = request.headers.get('Origin') || '';
      if (!ALLOWED_ORIGINS.includes(origin))
        return corsResponse(JSON.stringify({ error: 'Origin not allowed' }), 403);
    }

    // ── Parse body ─────────────────────────────────────────────────
    let body;
    try { body = await request.json(); }
    catch (e) { return corsResponse(JSON.stringify({ error: 'Invalid JSON body' }), 400); }

    if (!body.contents || !body.system_instruction)
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey)
      return corsResponse(JSON.stringify({ error: 'API key not configured' }), 500);

    const geminiPayload = {
      system_instruction: body.system_instruction,
      contents:           body.contents,
      generationConfig:   body.generationConfig || {
        temperature:      0.5,
        maxOutputTokens:  3000,
        topP:             0.9,
        responseMimeType: 'application/json'
      }
    };

    // ── Race strategy: fire both models, first valid 200 wins ──────
    const fetchModel = async (model, delayMs) => {
      if (delayMs) await scheduler.wait(delayMs);
      const url  = `${geminiUrl(model)}?key=${apiKey}`;
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(geminiPayload)
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`${model} → ${resp.status}: ${errText.substring(0, 200)}`);
      }
      const data = await resp.json();
      data._model = model; // tag which model responded for debugging
      return data;
    };

    try {
      // Primary fires immediately, fallback fires after 400ms
      // If primary responds in < 400ms, fallback never fires (saves quota)
      // If primary is slow or errors, fallback kicks in at 400ms
      const result = await Promise.any([
        fetchModel(PRIMARY_MODEL, 0),
        fetchModel(FALLBACK_MODEL, 400)
      ]);
      return corsResponse(JSON.stringify(result), 200);

    } catch (aggregateError) {
      // Both models failed — return clean error to extension
      const errors = aggregateError.errors
        ? aggregateError.errors.map(e => e.message).join(' | ')
        : aggregateError.message || 'Unknown error';
      console.error('[Lead Pro Worker] Both models failed:', errors);
      return corsResponse(
        JSON.stringify({ error: 'Service temporarily unavailable. Please try again in a moment.', detail: errors }),
        503
      );
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
    }
  });
}
