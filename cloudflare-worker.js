/**
 * Lead Pro — Cloudflare Worker v7.1 (OpenAI)
 *
 * Sequential cascade with adaptive timeouts.
 * All tiers hit the same model; lower tiers just cut tokens and timeout to
 * maximise odds of a fast, complete response when the primary fails.
 *
 *   primary    — honours caller's maxOutputTokens (up to MAX_TOKEN_CAP), 10s
 *   fallback   — 1100 tokens,  7s
 *   emergency  —  800 tokens,  5s
 *
 * Response is normalised to Gemini shape so popup.js needs no changes.
 * IMPORTANT: OpenAI's finish_reason is mapped to Gemini's finishReason so
 * popup.js can detect 'MAX_TOKENS' and run its truncation-recovery path.
 *
 * Secret: OPENAI_API_KEY
 */

const MODEL           = 'gpt-5.4-nano-2026-03-17';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// tokens=null means "use caller's maxOutputTokens (clamped)"
const MODEL_CASCADE = [
  { tokens: null, timeout: 10000, tempDelta:  0.0, tier: 'primary'   },
  { tokens: 1100, timeout:  7000, tempDelta: -0.1, tier: 'fallback'  },
  { tokens:  800, timeout:  5000, tempDelta: -0.2, tier: 'emergency' },
];

const TOTAL_BUDGET_MS     = 25000;
const MIN_TIMEOUT_MS      = 2500;
const TIMEOUT_SLACK_MS    = 300;    // reserve for header/JSON overhead
const DEFAULT_MAX_TOKENS  = 2500;
const MAX_TOKEN_CAP       = 8192;
const DEFAULT_TEMPERATURE = 0.5;
const MIN_CONTENT_CHARS   = 2;      // '{}' is the absolute minimum

// popup.js expects Gemini finishReason; check for 'MAX_TOKENS'
const FINISH_MAP = {
  stop:           'STOP',
  length:         'MAX_TOKENS',
  content_filter: 'SAFETY',
  tool_calls:     'OTHER',
  function_call:  'OTHER',
};

const CORS_HEADERS = {
  'Content-Type':                 'application/json',
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
  'X-Content-Type-Options':       'nosniff',
  'Vary':                         'Origin',
};

// Hoisted: static safe-fallback body — serialised once at module load.
const SAFE_FALLBACK_TEXT = JSON.stringify({
  sms:       "I'm pulling everything together for you now — would today or tomorrow work better to come in?",
  email:     "Subject: Following up on your inquiry\n\nHi,\n\nI'm getting your information ready right now. Would today or tomorrow work better for a quick visit?\n\nLooking forward to connecting,\n[Agent]",
  voicemail: "Hi, this is [Agent] from [Store]. I'm pulling some information together for you and wanted to personally reach out. Give me a call back when you get a chance. Talk soon.",
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST')
      return corsResponse('{"error":"Method not allowed"}', 405);

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return corsResponse('{"error":"Missing API key"}', 500);

    let body;
    try { body = await request.json(); }
    catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

    const systemText = body?.system_instruction?.parts?.[0]?.text;
    const userText   = body?.contents?.[0]?.parts?.[0]?.text;
    if (!systemText || !userText)
      return corsResponse('{"error":"Missing required fields"}', 400);

    const gen        = body.generationConfig || {};
    const callerMax  = clampInt(gen.maxOutputTokens, 200, MAX_TOKEN_CAP, DEFAULT_MAX_TOKENS);
    const callerTemp = clampFloat(gen.temperature,   0,   2,             DEFAULT_TEMPERATURE);

    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    console.log(`[${requestId}] START tokens=${callerMax} temp=${callerTemp}`);

    for (let i = 0; i < MODEL_CASCADE.length; i++) {
      const spec = MODEL_CASCADE[i];

      const remaining = TOTAL_BUDGET_MS - (Date.now() - startTime);
      if (remaining < MIN_TIMEOUT_MS) break;

      const timeout     = Math.min(spec.timeout, remaining - TIMEOUT_SLACK_MS);
      const maxTokens   = spec.tokens ?? callerMax;
      const temperature = clampFloat(callerTemp + spec.tempDelta, 0, 2, DEFAULT_TEMPERATURE);

      const result = await callOpenAI({
        systemText, userText, maxTokens, temperature,
        apiKey, timeoutMs: timeout, requestId,
      });

      if (result.ok) {
        const total = Date.now() - startTime;
        console.log(`[${requestId}] ${spec.tier.toUpperCase()} OK ${result.latency}ms total=${total}ms finish=${result.finishReason}`);

        const envelope = wrapAsGemini(result);
        if (i > 0) envelope[`_${spec.tier}Used`] = true;

        return corsResponse(JSON.stringify(envelope), 200, {
          'X-Request-ID':    requestId,
          'X-Model':         MODEL,
          'X-Tier':          spec.tier,
          'X-Total-Latency': String(total),
        });
      }

      console.warn(`[${requestId}] ${spec.tier.toUpperCase()} FAIL ${result.latency}ms → ${result.error}`);

      // Auth/billing/model errors won't fix themselves on retry — bail early.
      if (result.fatal) break;
    }

    return safeFallback(requestId, startTime);
  },
};

async function callOpenAI({ systemText, userText, maxTokens, temperature, apiKey, timeoutMs, requestId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemText },
          { role: 'user',   content: userText   },
        ],
        max_completion_tokens: maxTokens,
        temperature,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const status  = res.status;
      const errBody = await res.json().catch(() => null);
      const errMsg  = errBody?.error?.message || `HTTP ${status}`;
      const fatal   = status === 401 || status === 403 || status === 404;
      return { ok: false, fatal, latency: Date.now() - t0, error: errMsg.slice(0, 140) };
    }

    const data       = await res.json();
    const choice     = data?.choices?.[0];
    const text       = choice?.message?.content || '';
    const openaiFin  = choice?.finish_reason || 'stop';
    const finishReason = FINISH_MAP[openaiFin] || 'STOP';

    // Empty body is never recoverable.
    if (text.length < MIN_CONTENT_CHARS)
      return { ok: false, latency: Date.now() - t0, error: `Empty response (finish=${openaiFin})` };

    // If OpenAI says we stopped cleanly, the payload should be valid JSON
    // (we asked for response_format json_object). If not, caller can't parse.
    // On MAX_TOKENS we still hand it back — popup.js has a regex-recovery path.
    if (finishReason === 'STOP' && !isLikelyJson(text))
      return { ok: false, latency: Date.now() - t0, error: 'Non-JSON content with STOP finish' };

    return {
      ok: true,
      text,
      finishReason,
      latency: Date.now() - t0,
      usage:   data.usage || null,
    };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return {
      ok: false,
      latency: Date.now() - t0,
      error:   timedOut ? `Timeout ${timeoutMs}ms` : (err.message || 'fetch failed').slice(0, 140),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Shape OpenAI → Gemini (popup.js reads candidates[0].content.parts[0].text
// and candidates[0].finishReason).
function wrapAsGemini({ text, finishReason, latency, usage }) {
  return {
    candidates: [{
      content:      { parts: [{ text }], role: 'model' },
      finishReason,
    }],
    usageMetadata: {
      promptTokenCount:     usage?.prompt_tokens     || 0,
      candidatesTokenCount: usage?.completion_tokens || 0,
      totalTokenCount:      usage?.total_tokens      || 0,
    },
    _model:   MODEL,
    _latency: latency,
  };
}

function safeFallback(requestId, startTime) {
  const totalTime = Date.now() - startTime;
  console.warn(`[${requestId}] SAFE_FALLBACK after ${totalTime}ms`);

  return corsResponse(JSON.stringify({
    candidates: [{
      content:      { parts: [{ text: SAFE_FALLBACK_TEXT }], role: 'model' },
      finishReason: 'STOP',
      _fallback:    true,
      _fallbackMs:  totalTime,
      _requestId:   requestId,
    }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
  }), 200, { 'X-Request-ID': requestId, 'X-Fallback': 'safe' });
}

function corsResponse(body, status = 200, extra) {
  return new Response(body, {
    status,
    headers: extra ? { ...CORS_HEADERS, ...extra } : CORS_HEADERS,
  });
}

function clampInt(v, lo, hi, def) {
  const n = Number.isFinite(+v) ? Math.floor(+v) : def;
  return Math.max(lo, Math.min(hi, n));
}

function clampFloat(v, lo, hi, def) {
  const n = Number.isFinite(+v) ? +v : def;
  return Math.max(lo, Math.min(hi, n));
}

function isLikelyJson(s) {
  const first = s.trimStart()[0];
  return first === '{' || first === '[';
}
