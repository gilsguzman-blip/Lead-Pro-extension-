/**
 * Lead Pro — Cloudflare Worker v7.0
 *
 * Architecture: Sequential cascade with adaptive timeouts.
 *
 * - Tries models in priority order; first success wins
 * - Fast capacity rejections (~1-2s) immediately cascade to the next model
 * - Adaptive timeouts prevent exceeding Cloudflare's 30s wall-clock limit
 * - One model call on the happy path (cost-efficient)
 * - Safe fallback with pre-built copy if every model fails
 *
 * Model tiers:
 *   primary   — gemini-2.5-flash   (full tokens, thinking off)
 *   fallback  — gemini-3-flash     (reduced tokens, minimal thinking)
 *   emergency — gemini-3.1-flash-lite (reduced tokens, minimal thinking)
 */

const MODEL_CASCADE = [
  {
    model:   'gemini-2.5-flash',
    tokens:  2500,
    timeout: 11000,
    thinking: { thinkingBudget: 0 },
    tier:    'primary',
  },
  {
    model:   'gemini-3-flash-preview',
    tokens:  650,
    timeout: 10000,
    thinking: { thinkingLevel: 'minimal' },
    tier:    'fallback',
  },
  {
    model:   'gemini-3.1-flash-lite-preview',
    tokens:  650,
    timeout: 10000,
    thinking: { thinkingLevel: 'minimal' },
    tier:    'emergency',
  },
];

const TOTAL_BUDGET_MS    = 25000;  // Max wall-clock before giving up on models
const MIN_TIMEOUT_MS     = 2000;   // Don't attempt a model with less time left
const MIN_RESPONSE_CHARS = 200;    // Reject degraded/placeholder responses
const DEFAULT_MAX_TOKENS = 2500;

const CORS_HEADERS = {
  'Content-Type':                 'application/json',
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options':       'nosniff',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return corsResponse(JSON.stringify({ error: 'Missing API key' }), 500);

    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    let body;
    try { body = await request.json(); }
    catch { return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400); }

    if (!body.contents || !body.system_instruction)
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400);

    const extConfig = body.generationConfig || {};

    console.log(`[${requestId}] START tokens=${extConfig.maxOutputTokens || DEFAULT_MAX_TOKENS} source=${body.generationConfig ? 'ext' : 'worker'}`);

    // ── Try each model in cascade order ──────────────────────────────
    for (let i = 0; i < MODEL_CASCADE.length; i++) {
      const { model, tokens, timeout: baseTimeout, thinking, tier } = MODEL_CASCADE[i];

      // Adaptive timeout: cap at remaining budget minus a small buffer
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startTime);
      if (remaining < MIN_TIMEOUT_MS) break;
      const timeout = Math.min(baseTimeout, remaining - 500);

      // Primary honours caller config; fallback tiers use conservative defaults
      const isPrimary = i === 0;
      const payload = {
        system_instruction: body.system_instruction,
        contents:           body.contents,
        generationConfig: {
          temperature:      isPrimary ? (extConfig.temperature      ?? 0.5) : 0.5,
          maxOutputTokens:  isPrimary ? Math.min(extConfig.maxOutputTokens ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS) : tokens,
          topP:             isPrimary ? (extConfig.topP             ?? 0.9) : 0.9,
          responseMimeType: extConfig.responseMimeType ?? 'application/json',
          thinkingConfig:   thinking,
        },
      };

      const result = await callGemini(model, payload, apiKey, timeout, requestId);

      if (result.ok) {
        const total = Date.now() - startTime;
        console.log(`[${requestId}] ${tier.toUpperCase()} OK ${model} ${result.latency}ms | total=${total}ms`);
        return corsResponse(JSON.stringify({
          ...result.data,
          _model:   model,
          _latency: result.latency,
          ...(i > 0 && { [`_${tier}Used`]: true }),
        }), 200, {
          'X-Request-ID':    requestId,
          'X-Model':         model,
          'X-Total-Latency': String(total),
        });
      }

      console.warn(`[${requestId}] ${tier.toUpperCase()} FAIL ${model} ${result.latency}ms → ${result.error}`);
    }

    // ── All models failed ────────────────────────────────────────────
    return safeFallback(requestId, startTime);
  },
};

// ── Gemini API call with per-model timeout ───────────────────────────
async function callGemini(model, payload, apiKey, timeoutMs, requestId) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  const t0         = Date.now();

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      }
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg  = errBody?.error?.message || `HTTP ${res.status}`;
      return { ok: false, latency: Date.now() - t0, error: errMsg.substring(0, 120) };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text || text.length < MIN_RESPONSE_CHARS) {
      return { ok: false, latency: Date.now() - t0, error: `Degraded response (${text.length} chars)` };
    }

    return { ok: true, data, latency: Date.now() - t0 };
  } catch (err) {
    return {
      ok:      false,
      latency: Date.now() - t0,
      error:   err.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Pre-built safe fallback (no API dependency) ──────────────────────
function safeFallback(requestId, startTime) {
  const totalTime = Date.now() - startTime;
  console.warn(`[${requestId}] SAFE FALLBACK after ${totalTime}ms`);

  const fallbackText = JSON.stringify({
    sms:       "I'm pulling everything together for you now — would today or tomorrow work better to come in?",
    email:     "Subject: Following up on your inquiry\n\nHi,\n\nI'm getting your information ready right now. Would today or tomorrow work better for a quick visit?\n\nLooking forward to connecting,\n[Agent]",
    voicemail: "Hi, this is [Agent] from [Store]. I'm pulling some information together for you and wanted to personally reach out. Give me a call back when you get a chance. Talk soon.",
  });

  return corsResponse(JSON.stringify({
    candidates: [{
      content:      { parts: [{ text: fallbackText }], role: 'model' },
      finishReason: 'STOP',
      _fallback:    true,
      _fallbackMs:  totalTime,
      _requestId:   requestId,
    }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
  }), 200);
}

// ── CORS wrapper ─────────────────────────────────────────────────────
function corsResponse(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, ...extra },
  });
}
