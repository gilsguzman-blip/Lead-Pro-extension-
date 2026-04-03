/**
 * Lead Pro — Cloudflare Worker v6.1
 *
 * Architecture: Single model — gemini-3.1-flash-lite-preview only
 * Optimizations v6.1:
 * - CORS headers hoisted to module scope (no per-request object recreation)
 * - requestId/startTime moved after early exits (no wasted UUID on OPTIONS/invalid)
 * - clearTimeout moved to finally block (guaranteed cleanup)
 * - Eliminated parse → mutate → re-stringify pattern
 * - corsResponse accepts extra headers (no post-construction header mutation)
 *
 * Performance targets:
 * - Typical response: 2–5s
 * - Hard timeout: 9s (gives model full runway, fallback before Cloudflare 10s limit)
 * - maxOutputTokens: 2000 (headroom for all three formats — voicemail is third and needs budget)
 */

const MODEL      = 'gemini-3.1-flash-lite-preview';
const TIMEOUT_MS = 9000;
const MAX_TOKENS = 2000;

const CORS_HEADERS = {
  'Content-Type':                 'application/json',
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options':       'nosniff'
};

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey)
      return corsResponse(JSON.stringify({ error: 'Missing API key' }), 500);

    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    let body;
    try { body = await request.json(); }
    catch {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400);
    }

    if (!body.contents || !body.system_instruction)
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400);

    const extConfig = body.generationConfig || {};
    const generationConfig = {
      temperature:      extConfig.temperature      ?? 0.5,
      maxOutputTokens:  Math.min(extConfig.maxOutputTokens ?? MAX_TOKENS, MAX_TOKENS),
      topP:             extConfig.topP             ?? 0.9,
      responseMimeType: extConfig.responseMimeType ?? 'application/json',
      ...(extConfig.thinkingConfig ? { thinkingConfig: extConfig.thinkingConfig } : {})
    };

    console.log(
      `[${requestId}] CONFIG maxOutputTokens=${generationConfig.maxOutputTokens}` +
      ` source=${body.generationConfig ? 'extension' : 'worker-default'}`
    );

    const geminiPayload = {
      system_instruction: body.system_instruction,
      contents:           body.contents,
      generationConfig
    };

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const callStart  = Date.now();

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(geminiPayload),
          signal:  controller.signal
        }
      );

      const latency = Date.now() - callStart;

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errMsg  = errBody?.error?.message || `HTTP ${res.status}`;
        console.warn(`[${requestId}] FAIL ${MODEL} in ${latency}ms → ${errMsg}`);
        return safeFallback(requestId, startTime, 'model-error');
      }

      const data  = await res.json();
      const usage = data.usageMetadata || {};
      const total = Date.now() - startTime;

      console.log(
        `[${requestId}] SUCCESS ${MODEL} in ${latency}ms` +
        ` | promptTokens=${usage.promptTokenCount ?? '?'}` +
        ` outputTokens=${usage.candidatesTokenCount ?? '?'}` +
        ` totalTokens=${usage.totalTokenCount ?? '?'}` +
        ` | total=${total}ms`
      );

      const output = { ...data, _model: MODEL, _latency: latency };

      return corsResponse(JSON.stringify(output), 200, {
        'X-Request-ID':    requestId,
        'X-Model':         MODEL,
        'X-Total-Latency': String(total)
      });

    } catch (err) {
      const latency = Date.now() - callStart;

      if (err.name === 'AbortError') {
        console.warn(`[${requestId}] TIMEOUT ${MODEL} after ${latency}ms`);
        return safeFallback(requestId, startTime, 'timeout');
      }

      console.error(`[${requestId}] ERROR ${MODEL} in ${latency}ms → ${err.message}`);
      return safeFallback(requestId, startTime, 'unexpected');

    } finally {
      clearTimeout(timeout);
    }
  }
};

function safeFallback(requestId, startTime, reason) {
  const totalTime = Date.now() - startTime;
  console.warn(`[${requestId}] SAFE FALLBACK used after ${totalTime}ms | reason: ${reason}`);

  const fallbackText = JSON.stringify({
    sms:       "I'm pulling everything together for you now — would today or tomorrow work better to come in?",
    email:     "Subject: Following up on your inquiry\n\nHi,\n\nI'm getting your information ready right now. Would today or tomorrow work better for a quick visit?\n\nLooking forward to connecting,\n[Agent]",
    voicemail: "Hi, this is [Agent] from [Store]. I'm pulling some information together for you and wanted to personally reach out. Give me a call back when you get a chance. Talk soon."
  });

  return corsResponse(JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text: fallbackText }],
        role:  'model'
      },
      finishReason: 'STOP',
      _fallback:    true,
      _fallbackMs:  totalTime,
      _reason:      reason,
      _requestId:   requestId
    }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }
  }), 200);
}

function corsResponse(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, ...extra }
  });
}
