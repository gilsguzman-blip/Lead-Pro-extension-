/**
 * Lead Pro — Cloudflare Worker v4.0 (Production Build)
 * - Lite x2 (hedged) for max cost efficiency
 * - Flash pre-warmed at +2000ms — already in-flight if lite fails
 * - NO Pro (eliminates cost + timeout risk)
 * - Per-tier AbortControllers — winner cancels its loser, flash cancelled on lite win
 * - Guaranteed response (no hard 503 unless catastrophic)
 * - Full logging + tracking headers
 */

const LITE_MODEL  = 'gemini-3.1-flash-lite-preview';
const FLASH_MODEL = 'gemini-3-flash-preview';

const TIMEOUT_MS = 12000;

export default {
  async fetch(request, env) {

    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey)
      return corsResponse(JSON.stringify({ error: 'Missing API key' }), 500);

    let body;
    try { body = await request.json(); }
    catch {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400);
    }

    if (!body.contents || !body.system_instruction)
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400);

    const generationConfig = body.generationConfig || {
      temperature: 0.5,
      maxOutputTokens: 3000,
      responseMimeType: 'application/json'
    };

    const geminiPayload = {
      system_instruction: body.system_instruction,
      contents: body.contents,
      generationConfig
    };

    // 🔑 CORE CALL FUNCTION
    // tierSignal: aborted by the caller to cancel this call (e.g. another call won)
    const callGemini = async (model, delay = 0, tier = '', tierSignal) => {

      // Respect cancellation during the stagger delay
      if (delay) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          tierSignal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error(`${model} cancelled`));
          }, { once: true });
        });
      }

      if (tierSignal.aborted) throw new Error(`${model} cancelled`);

      // Per-call timeout controller, bridged to the tier signal
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);
      const onTierAbort = () => timeoutController.abort();
      tierSignal.addEventListener('abort', onTierAbort, { once: true });

      const callStart = Date.now();

      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload),
            signal: timeoutController.signal
          }
        );

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error?.message || `${model} HTTP ${res.status}`);
        }

        const data = await res.json();
        const latency = Date.now() - callStart;

        console.log(`[${requestId}] SUCCESS ${model} (${tier}) in ${latency}ms`);

        data._model   = model;
        data._tier    = tier;
        data._latency = latency;

        return data;

      } catch (err) {
        const latency = Date.now() - callStart;

        if (err.name === 'AbortError' || err.message?.includes('cancelled')) {
          console.warn(`[${requestId}] TIMEOUT/CANCEL ${model} (${tier}) after ${latency}ms`);
          throw new Error(`${model} timeout`);
        }

        console.warn(`[${requestId}] FAIL ${model} (${tier}) in ${latency}ms → ${err.message}`);
        throw err;

      } finally {
        clearTimeout(timeout);
        tierSignal.removeEventListener('abort', onTierAbort);
      }
    };

    const successResponse = (result) => {
      const totalTime = Date.now() - startTime;

      console.log(`[${requestId}] WINNER → ${result._model} (${result._tier}) | ${totalTime}ms total`);

      const response = corsResponse(JSON.stringify(result), 200);

      response.headers.set('X-Request-ID',     requestId);
      response.headers.set('X-Winning-Model',  result._model);
      response.headers.set('X-Winning-Tier',   result._tier);
      response.headers.set('X-Total-Latency',  String(totalTime));

      return response;
    };

    const safeFallback = () => {
      const totalTime = Date.now() - startTime;

      console.warn(`[${requestId}] SAFE FALLBACK used after ${totalTime}ms`);

      return corsResponse(JSON.stringify({
        message: "Got your request — pulling everything together now. When would you like to come in today or tomorrow so we can go over the best options?",
        fallback: true,
        requestId
      }), 200);
    };

    // Per-tier controllers — cancelling one tier never affects another
    const liteController  = new AbortController();
    const flashController = new AbortController();

    try {

      // ⚡ LITE HEDGE — primary strategy, fires immediately + at +200ms
      const lite1 = callGemini(LITE_MODEL,  0,    'lite-1', liteController.signal);
      const lite2 = callGemini(LITE_MODEL,  200,  'lite-2', liteController.signal);

      // 🧠 FLASH — pre-warmed at +2000ms so it's already in-flight if lite fails
      const flash = callGemini(FLASH_MODEL, 2000, 'flash',  flashController.signal);

      const liteResult = await Promise.any([lite1, lite2]).catch(() => null);

      if (liteResult) {
        liteController.abort();  // cancel the losing lite call
        flashController.abort(); // cancel flash (still in delay or warming up)
        return successResponse(liteResult);
      }

      console.warn(`[${requestId}] LITE LAYER FAILED → waiting for pre-warmed FLASH`);

      // Flash is already in-flight — no cold start penalty here
      try {
        const flashResult = await flash;
        return successResponse(flashResult);
      } catch {
        console.error(`[${requestId}] FLASH FAILED → using SAFE FALLBACK`);
      }

      // 🛟 FINAL GUARANTEED RESPONSE
      return safeFallback();

    } catch (err) {
      console.error(`[${requestId}] UNEXPECTED ERROR → ${err.message}`);
      liteController.abort();
      flashController.abort();
      return safeFallback();
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
