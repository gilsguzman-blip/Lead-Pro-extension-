// ─────────────────────────────────────────────────────────────────
// Lead Pro — Cloudflare Worker Proxy
// Sits between the Chrome extension and the Gemini API.
// The Gemini API key lives here as a secret — never in the extension.
//
// Deploy to Cloudflare Workers (free tier).
// Set the GEMINI_API_KEY environment variable as a Secret (not plain text).
// ─────────────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Allowed origins ───────────────────────────────────────────────
// Chrome extensions send requests with a chrome-extension:// origin.
// Add your extension's ID here once you know it.
// Find it at chrome://extensions after loading the extension.
// Format: 'chrome-extension://abcdefghijklmnopqrstuvwxyz123456'
// Leave the array empty during development to allow all origins.
const ALLOWED_ORIGINS = [
  // 'chrome-extension://YOUR_EXTENSION_ID_HERE',
];

export default {
  async fetch(request, env) {

    // ── CORS preflight ─────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    // ── Only accept POST ───────────────────────────────────────────
    if (request.method !== 'POST') {
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405, env);
    }

    // ── Origin check (optional but recommended) ────────────────────
    if (ALLOWED_ORIGINS.length > 0) {
      const origin = request.headers.get('Origin') || '';
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return corsResponse(JSON.stringify({ error: 'Origin not allowed' }), 403, env);
      }
    }

    // ── Read request body from extension ──────────────────────────
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON body' }), 400, env);
    }

    // ── Validate required fields ───────────────────────────────────
    if (!body.contents || !body.system_instruction) {
      return corsResponse(JSON.stringify({ error: 'Missing required fields: contents, system_instruction' }), 400, env);
    }

    // ── Build Gemini request ───────────────────────────────────────
    // The API key comes from the Worker secret — never from the client
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return corsResponse(JSON.stringify({ error: 'API key not configured on server' }), 500, env);
    }

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

    // ── Call Gemini ────────────────────────────────────────────────
    let geminiResp;
    try {
      geminiResp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(geminiPayload)
      });
    } catch (e) {
      return corsResponse(JSON.stringify({ error: 'Failed to reach Gemini API', detail: e.message }), 502, env);
    }

    // ── Return Gemini response to extension ────────────────────────
    const geminiData = await geminiResp.json();
    return corsResponse(JSON.stringify(geminiData), geminiResp.status, env);
  }
};

// ── CORS helper ───────────────────────────────────────────────────
function corsResponse(body, status, env) {
  const headers = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  return new Response(body, { status: status || 200, headers });
}
