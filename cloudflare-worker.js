/**
 * Lead Pro — Cloudflare Worker v6.9
 *
 * Architecture: Smart sequential — primary first, immediate fallback on capacity error.
 *
 * Key insight from logs: gemini-2.5-flash capacity rejections happen in 1-2s (fast fail).
 * Timeouts happen when flash-lite is slow under load (8s+).
 *
 * Strategy:
 * - Primary (2.5-flash): attempt with 11s timeout
 *   - If capacity rejected (fast, ~1-2s) → immediately try fallback, no wait
 *   - If timeout → try fallback with reduced tokens
 * - Fallback (3.1-flash-lite): 650 tokens, thinkingLevel minimal, 10s timeout
 * - Emergency (2.0-flash): only if fallback also fails, separate payload with thinkingBudget
 * - Safe fallback: only if all three fail
 *
 * Token cost: one model call per request on happy path.
 * Only pays for fallback when primary actually fails.
 */

const PRIMARY_MODEL   = 'gemini-2.5-flash';
const FALLBACK_MODEL  = 'gemini-3.1-flash-lite-preview';
const EMERGENCY_MODEL = 'gemini-2.0-flash';

const PRIMARY_TIMEOUT  = 11000;
const FALLBACK_TIMEOUT = 10000;
const MAX_TOKENS       = 2500;
const FALLBACK_TOKENS  = 650;       // Smaller = faster response under load
const MIN_RESPONSE_CHARS = 200;     // Reject degraded placeholder responses below this

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
    if (!apiKey) return corsResponse(JSON.stringify({ error: 'Missing API key' }), 500);

    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    let body;
    try { body = await request.json(); }
    catch { return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400); }

    if (!body.contents || !body.system_instruction)
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400);

    const extConfig = body.generationConfig || {};

    const primaryPayload = {
      system_instruction: body.system_instruction,
      contents:           body.contents,
      generationConfig: {
        temperature:      extConfig.temperature      ?? 0.5,
        maxOutputTokens:  Math.min(extConfig.maxOutputTokens ?? MAX_TOKENS, MAX_TOKENS),
        topP:             extConfig.topP             ?? 0.9,
        responseMimeType: extConfig.responseMimeType ?? 'application/json',
        thinkingConfig:   { thinkingBudget: 0 }
      }
    };

    // gemini-3.1 uses thinkingLevel; gemini-2.0 uses thinkingBudget — separate payloads
    const fallbackPayload = {
      system_instruction: body.system_instruction,
      contents:           body.contents,
      generationConfig: {
        temperature:      0.5,
        maxOutputTokens:  FALLBACK_TOKENS,
        topP:             0.9,
        responseMimeType: extConfig.responseMimeType ?? 'application/json',
        thinkingConfig:   { thinkingLevel: 'minimal' }
      }
    };

    const emergencyPayload = {
      system_instruction: body.system_instruction,
      contents:           body.contents,
      generationConfig: {
        temperature:      0.5,
        maxOutputTokens:  FALLBACK_TOKENS,
        topP:             0.9,
        responseMimeType: extConfig.responseMimeType ?? 'application/json',
        thinkingConfig:   { thinkingBudget: 0 }
      }
    };

    console.log(`[${requestId}] CONFIG tokens=${primaryPayload.generationConfig.maxOutputTokens} source=${body.generationConfig ? 'ext' : 'worker'}`);

    // ── Step 1: Try primary ──────────────────────────────────────────
    const primaryResult = await callGemini(PRIMARY_MODEL, primaryPayload, apiKey, PRIMARY_TIMEOUT, requestId);

    if (primaryResult.ok) {
      const total = Date.now() - startTime;
      const usage = primaryResult.data.usageMetadata || {};
      console.log(`[${requestId}] SUCCESS ${PRIMARY_MODEL} in ${primaryResult.latency}ms | promptTokens=${usage.promptTokenCount ?? '?'} outputTokens=${usage.candidatesTokenCount ?? '?'} totalTokens=${usage.totalTokenCount ?? '?'} | total=${total}ms`);
      return corsResponse(JSON.stringify({
        ...primaryResult.data, _model: PRIMARY_MODEL, _latency: primaryResult.latency
      }), 200, { 'X-Request-ID': requestId, 'X-Model': PRIMARY_MODEL, 'X-Total-Latency': String(total) });
    }

    console.warn(`[${requestId}] PRIMARY FAIL ${PRIMARY_MODEL} in ${primaryResult.latency}ms → ${primaryResult.error}`);

    // ── Step 2: Try fallback ─────────────────────────────────────────
    const fallbackResult = await callGemini(FALLBACK_MODEL, fallbackPayload, apiKey, FALLBACK_TIMEOUT, requestId);

    if (fallbackResult.ok) {
      const total = Date.now() - startTime;
      const usage = fallbackResult.data.usageMetadata || {};
      console.log(`[${requestId}] FALLBACK SUCCESS ${FALLBACK_MODEL} in ${fallbackResult.latency}ms | promptTokens=${usage.promptTokenCount ?? '?'} outputTokens=${usage.candidatesTokenCount ?? '?'} | total=${total}ms`);
      return corsResponse(JSON.stringify({
        ...fallbackResult.data, _model: FALLBACK_MODEL, _latency: fallbackResult.latency, _fallbackUsed: true
      }), 200, { 'X-Request-ID': requestId, 'X-Model': FALLBACK_MODEL, 'X-Total-Latency': String(total) });
    }

    console.warn(`[${requestId}] FALLBACK FAIL ${FALLBACK_MODEL} in ${fallbackResult.latency}ms → ${fallbackResult.error}`);

    // ── Step 3: Emergency model ──────────────────────────────────────
    // 2.0-flash is a separate capacity pool — different quota bucket from 2.5/3.x
    // Uses thinkingBudget (not thinkingLevel) — separate emergencyPayload required
    const emergencyResult = await callGemini(EMERGENCY_MODEL, emergencyPayload, apiKey, FALLBACK_TIMEOUT, requestId);

    if (emergencyResult.ok) {
      const total = Date.now() - startTime;
      const usage = emergencyResult.data.usageMetadata || {};
      console.log(`[${requestId}] EMERGENCY SUCCESS ${EMERGENCY_MODEL} in ${emergencyResult.latency}ms | promptTokens=${usage.promptTokenCount ?? '?'} outputTokens=${usage.candidatesTokenCount ?? '?'} | total=${total}ms`);
      return corsResponse(JSON.stringify({
        ...emergencyResult.data, _model: EMERGENCY_MODEL, _latency: emergencyResult.latency, _emergencyUsed: true
      }), 200, { 'X-Request-ID': requestId, 'X-Model': EMERGENCY_MODEL, 'X-Total-Latency': String(total) });
    }

    console.error(`[${requestId}] EMERGENCY FAIL ${EMERGENCY_MODEL} in ${emergencyResult.latency}ms → ${emergencyResult.error}`);

    // ── All three failed ─────────────────────────────────────────────
    return safeFallback(requestId, startTime, 'all-models-failed');
  }
};

async function callGemini(model, payload, apiKey, timeoutMs, requestId) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), timeoutMs);
  const callStart  = Date.now();

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal
      }
    );

    let latency = Date.now() - callStart;

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg  = errBody?.error?.message || `HTTP ${res.status}`;
      return { ok: false, latency, error: errMsg.substring(0, 100) };
    }

    const data = await res.json();
    latency    = Date.now() - callStart;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text || text.length < MIN_RESPONSE_CHARS) {
      return { ok: false, latency, error: `Degraded response (${text.length} chars)` };
    }

    return { ok: true, data, latency };

  } catch (err) {
    const latency = Date.now() - callStart;
    return { ok: false, latency, error: err.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

function safeFallback(requestId, startTime, reason) {
  const totalTime = Date.now() - startTime;
  console.warn(`[${requestId}] SAFE FALLBACK after ${totalTime}ms | reason: ${reason}`);

  const fallbackText = JSON.stringify({
    sms:       "I'm pulling everything together for you now — would today or tomorrow work better to come in?",
    email:     "Subject: Following up on your inquiry\n\nHi,\n\nI'm getting your information ready right now. Would today or tomorrow work better for a quick visit?\n\nLooking forward to connecting,\n[Agent]",
    voicemail: "Hi, this is [Agent] from [Store]. I'm pulling some information together for you and wanted to personally reach out. Give me a call back when you get a chance. Talk soon."
  });

  return corsResponse(JSON.stringify({
    candidates: [{
      content:      { parts: [{ text: fallbackText }], role: 'model' },
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
