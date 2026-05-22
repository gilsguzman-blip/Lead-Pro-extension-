/**
 * Lead Pro — Cloudflare Worker v7.17 (OpenAI)
 *
 * Sequential cascade with adaptive timeouts + per-tier reasoning tuning,
 * plus license management routes for Director-driven agent provisioning,
 * plus phone-ask classifier with auto-regenerate (v7.13),
 * PLUS OpenAI prompt caching (v7.14).
 *
 *   primary    — gpt-5.4-nano   (proven workhorse, restored to primary)
 *   fallback   — gpt-5.4-mini   (larger model held in reserve)
 *   emergency  — gpt-4.1-nano   (different family, resilient)
 *   classifier — gpt-4.1-nano   (binary YES/NO, fastest cheapest)
 *
 * v7.17: Performance optimizations
 *   1. ctx.waitUntil() — edge cache write no longer blocks the response path.
 *      The response returns to the client immediately; the KV write happens
 *      in the background within the Worker's lifetime.
 *   2. Single JSON.stringify — envelope serialized once, reused for both the
 *      cache body and the HTTP response (eliminates one full serialization).
 *   3. Parallel KV reads — list-licenses now fans out all KV.get() calls via
 *      Promise.all, dropping latency from O(N×RTT) to O(RTT).
 *   4. TextEncoder singleton — module-level instance avoids per-request
 *      allocation inside edgeCacheKey.
 *   5. Pre-compiled regexes — PHONE_ON_FILE_RE and DIGIT_RE hoisted to
 *      module scope; inline digit counting replaces match(/\d/g) array.
 *   6. Pre-built classifier prompt — static prefix/suffix extracted to module
 *      constants; only the dynamic message body is interpolated per call.
 *
 * v7.16: Cloudflare edge cache for AI responses
 *   Caches successful primary-tier AI responses at Cloudflare's edge
 *   using the Cache API. Same system+user prompt returns cached response
 *   instantly — no OpenAI call needed. TTL: 7 days (no 24h limit).
 *   Date prefix in cache key prevents cross-day stale hits.
 *   Adds _edgeCache field ("HIT"/"MISS") and X-Edge-Cache header.
 *   SAFE_FALLBACK and regenerated responses are never cached.
 *
 * v7.15.1: revert CACHE_RETENTION to 24h
 *   "7d" is NOT a valid value — OpenAI only accepts "in_memory" and "24h".
 *   7d caused 100% SAFE_FALLBACK on all requests.
 *
 * v7.15: bump primary timeout 8000ms → 10000ms
 *
 *   May 19 logs confirmed PRIMARY hitting the 8000ms ceiling (failure at
 *   13:57:56Z @ exactly 8000ms). P99 for PRIMARY was 6754ms with 55
 *   requests — plenty of headroom to absorb nano's long tail without
 *   falling to fallback. 10s matches fallback tier and gives nano full
 *   runway on peak-hour spikes.
 *
 * v7.14: OpenAI prompt caching — see v7.14 header for full details.
 * v7.13: phone-ask classifier + auto-regen pipeline.
 *
 * Response is normalised to Gemini shape so popup.js needs no changes.
 *
 * Secrets:    OPENAI_API_KEY (required)
 *             DIRECTOR_KEYS  (optional — comma-separated dev fallback keys)
 * KV (req.):  LEADPRO_LICENSES   — agent license records
 * KV (opt.):  LEADPRO_REGISTRY   — source registry storage
 */

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const REASONING_EFFORT = 'low';
const VERBOSITY        = 'low';

const MODEL_CASCADE = [
  { model: 'gpt-5.4-nano-2026-03-17', tokens: 3500, timeout: 10000, temperature: null, tier: 'primary',   gpt5: true  }, // v7.15: 8000 → 10000
  { model: 'gpt-5.4-mini',            tokens: 3500, timeout: 10000, temperature: null, tier: 'fallback',  gpt5: true  },
  { model: 'gpt-4.1-nano',            tokens: 2000, timeout:  5000, temperature: 0.3,  tier: 'emergency', gpt5: false },
];

const TOTAL_BUDGET_MS    = 24000;
const MIN_TIMEOUT_MS     = 2500;
const TIMEOUT_SLACK_MS   = 300;
const DEFAULT_MAX_TOKENS = 2500;
const MAX_TOKEN_CAP      = 8192;
const MIN_CONTENT_CHARS  = 2;

// ─── CLASSIFIER CONFIG (v7.13) ──────────────────────────────────────────
const CLASSIFIER_MODEL      = 'gpt-4.1-nano';
const CLASSIFIER_TIMEOUT_MS = 3000;
const CLASSIFIER_MAX_TOKENS = 4;
const CLASSIFIER_TEMP       = 0.0;
const REGEN_CONSTRAINT_TEXT =
  "\n\n━━━ CRITICAL OVERRIDE ━━━\n" +
  "Your previous draft asked the customer for a phone number. The customer's " +
  "phone IS ALREADY ON FILE. NEVER ask for, mention, or reference a phone number " +
  "in any form. Do not write 'send me your number', 'what's the best number', " +
  "'I don't have a phone number on file', 'send the best one', or any variation. " +
  "Generate a NEW message that engages the customer about their vehicle interest, " +
  "offers an appointment, or addresses their actual message — WITHOUT touching the " +
  "topic of phone numbers in any way. The phone-number topic is FORBIDDEN.\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

// ─── PROMPT CACHE CONFIG (v7.14) ────────────────────────────────────────
const CACHE_KEY_PREFIX = 'lp';
const CACHE_RETENTION  = '24h';

// ─── EDGE CACHE CONFIG (v7.16) ──────────────────────────────────────────
const EDGE_CACHE_TTL = 604800; // 7 days in seconds — no 24h limit!

// ─── MODULE-LEVEL SINGLETONS & PRE-COMPILED PATTERNS (v7.17) ───────────
// TextEncoder singleton — avoids per-request allocation in edgeCacheKey.
const TEXT_ENCODER = new TextEncoder();

// Pre-compiled phone-on-file regex — compiled once at module load.
const PHONE_ON_FILE_RE = /Customer\s+Phone\s*:\s*([^\n]{0,80})/i;

// Pre-built classifier prompt halves — only the message body is dynamic.
const CLASSIFIER_PROMPT_PREFIX =
  "You are a binary classifier. Read the following message and answer YES or NO.\n\n" +
  "Question: Does this message ask the recipient to provide, send, share, " +
  "confirm, or supply their phone number? Include direct requests " +
  '("send me your number"), indirect requests ("I don\'t have a number for ' +
  'you yet"), and trailing tags ("just send the best one to use").\n\n' +
  'Message:\n"""\n';
const CLASSIFIER_PROMPT_SUFFIX = '\n"""\n\nAnswer with only YES or NO.';

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
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
  'X-Content-Type-Options':       'nosniff',
  'Vary':                         'Origin',
};

const SAFE_FALLBACK_TEXT = JSON.stringify({
  sms:       "I'm pulling everything together for you now — would today or tomorrow work better to come in?",
  email:     "Subject: Following up on your inquiry\n\nHi,\n\nI'm getting your information ready right now. Would today or tomorrow work better for a quick visit?\n\nLooking forward to connecting,\n[Agent]",
  voicemail: "Hi, this is [Agent] from [Store]. I'm pulling some information together for you and wanted to personally reach out. Give me a call back when you get a chance. Talk soon.",
});

export default {
  // v7.17: ctx added so waitUntil() can be used for non-blocking cache writes.
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);

    const url = new URL(request.url);

    // ═══════════════════════════════════════════════════════════════════
    // LICENSE MANAGEMENT ROUTES
    // ═══════════════════════════════════════════════════════════════════

    if (request.method === 'POST' && url.pathname.endsWith('/provision-license')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { directorKey, agentName, agentEmail, persona, stores, dealer } = body || {};
      if (!directorKey || !agentName) {
        return corsResponse('{"error":"directorKey and agentName required"}', 400);
      }
      const auth = await validateLicenseRecord(directorKey, env);
      if (!auth.valid) {
        return corsResponse(JSON.stringify({ error: 'Unauthorized: ' + auth.error }), 403);
      }
      if (auth.record.persona !== 'director') {
        return corsResponse('{"error":"Only Director keys can provision licenses"}', 403);
      }
      if (!env.LEADPRO_LICENSES) {
        return corsResponse('{"error":"LEADPRO_LICENSES KV not bound"}', 503);
      }

      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let newKey = 'LP-';
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      for (const b of bytes) newKey += chars[b % chars.length];

      const record = {
        dealer:     dealer || auth.record.dealer || 'Community Auto Group',
        agentName:  agentName,
        agentEmail: agentEmail || '',
        persona:    persona || 'bdc',
        stores:     stores || [],
        active:     true,
        createdAt:  Date.now(),
        expiresAt:  null,
        createdBy:  directorKey,
      };
      await env.LEADPRO_LICENSES.put(newKey, JSON.stringify(record));
      return corsResponse(JSON.stringify({ ok: true, licenseKey: newKey, record }), 200);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/validate-license')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { licenseKey, agentEmail } = body || {};
      if (!licenseKey) {
        return corsResponse('{"error":"licenseKey required"}', 400);
      }
      const result = await validateLicenseRecord(licenseKey, env);
      if (!result.valid) {
        return corsResponse(JSON.stringify({ ok: false, error: result.error }), 200);
      }
      if (agentEmail && env.LEADPRO_LICENSES && !result.record.agentEmail) {
        result.record.agentEmail = agentEmail;
        result.record.firstUsedAt = Date.now();
        await env.LEADPRO_LICENSES.put(licenseKey, JSON.stringify(result.record));
      }
      return corsResponse(JSON.stringify({
        ok:        true,
        persona:   result.record.persona,
        agentName: result.record.agentName,
        dealer:    result.record.dealer,
        stores:    result.record.stores || [],
      }), 200);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/list-licenses')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { directorKey } = body || {};
      if (!directorKey) {
        return corsResponse('{"error":"directorKey required"}', 400);
      }
      const auth = await validateLicenseRecord(directorKey, env);
      if (!auth.valid || auth.record.persona !== 'director') {
        return corsResponse(JSON.stringify({ error: 'Unauthorized' }), 403);
      }
      if (!env.LEADPRO_LICENSES) {
        return corsResponse('{"error":"LEADPRO_LICENSES KV not bound"}', 503);
      }
      const list = await env.LEADPRO_LICENSES.list();

      // v7.17: fan out all KV reads in parallel (was serial O(N×RTT)).
      const pairs = await Promise.all(
        list.keys.map(async k => {
          const v = await env.LEADPRO_LICENSES.get(k.name);
          if (!v) return null;
          try { return { licenseKey: k.name, ...JSON.parse(v) }; } catch { return null; }
        })
      );
      const records = pairs.filter(Boolean);

      return corsResponse(JSON.stringify({ ok: true, licenses: records }), 200);
    }

    if (request.method === 'GET' && url.pathname.endsWith('/registry')) {
      const dealerId = url.searchParams.get('dealerId');
      if (!dealerId) {
        return corsResponse('{"error":"dealerId required"}', 400);
      }
      if (!env.LEADPRO_REGISTRY) {
        return corsResponse('{"error":"LEADPRO_REGISTRY KV not bound"}', 503);
      }
      const data = await env.LEADPRO_REGISTRY.get('registry:' + dealerId);
      if (!data) {
        return corsResponse(JSON.stringify({ ok: true, registry: null }), 200);
      }
      try {
        return corsResponse(JSON.stringify({ ok: true, registry: JSON.parse(data) }), 200);
      } catch {
        return corsResponse('{"error":"Corrupt registry data"}', 500);
      }
    }

    if (request.method === 'POST' && url.pathname.endsWith('/registry')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { licenseKey, dealerId, registry } = body || {};
      if (!licenseKey || !dealerId || !registry) {
        return corsResponse('{"error":"licenseKey, dealerId, and registry required"}', 400);
      }
      const auth = await validateLicenseRecord(licenseKey, env);
      if (!auth.valid) {
        return corsResponse(JSON.stringify({ error: 'Unauthorized: ' + auth.error }), 403);
      }
      if (!env.LEADPRO_REGISTRY) {
        return corsResponse('{"error":"LEADPRO_REGISTRY KV not bound"}', 503);
      }
      const toStore = Object.assign({}, registry, { updatedAt: Date.now(), pushedBy: licenseKey });
      await env.LEADPRO_REGISTRY.put('registry:' + dealerId, JSON.stringify(toStore));
      return corsResponse(JSON.stringify({ ok: true, updatedAt: toStore.updatedAt }), 200);
    }

    // ═══════════════════════════════════════════════════════════════════
    // AI GENERATION HANDLER
    // ═══════════════════════════════════════════════════════════════════

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

    const gen       = body.generationConfig || {};
    const callerMax = clampInt(gen.maxOutputTokens, 200, MAX_TOKEN_CAP, DEFAULT_MAX_TOKENS);

    const messages = [
      { role: 'system', content: systemText },
      { role: 'user',   content: userText   },
    ];

    const cacheKey = promptCacheKey(systemText);

    // ─── EDGE CACHE LOOKUP (v7.16) ───────────────────────────────────
    const edgeKey = await edgeCacheKey(systemText, userText);
    const cache   = caches.default;
    let edgeHit   = null;
    try { edgeHit = await cache.match(edgeKey); } catch (e) { console.warn(`[EDGE-CACHE] lookup error: ${e.message}`); }
    if (edgeHit) {
      const cached = await edgeHit.json();
      cached._edgeCache = 'HIT';
      console.log(`[EDGE-CACHE] HIT`);
      return corsResponse(JSON.stringify(cached), 200, { 'X-Edge-Cache': 'HIT' });
    }
    console.log(`[EDGE-CACHE] MISS`);

    const requestId  = crypto.randomUUID();
    const startTime  = Date.now();
    const authHeader = `Bearer ${apiKey}`;

    console.log(`[${requestId}] START tokens=${callerMax} cacheKey=${cacheKey}`);

    let lastError = null;
    let lastTier  = null;
    let lastModel = null;

    for (let i = 0; i < MODEL_CASCADE.length; i++) {
      const spec = MODEL_CASCADE[i];

      const remaining = TOTAL_BUDGET_MS - (Date.now() - startTime);
      if (remaining < MIN_TIMEOUT_MS) {
        lastError = `Budget exhausted before ${spec.tier} (${remaining}ms remaining)`;
        lastTier  = spec.tier;
        lastModel = spec.model;
        break;
      }

      const timeout   = Math.min(spec.timeout, remaining - TIMEOUT_SLACK_MS);
      const maxTokens = spec.tokens ?? callerMax;

      const result = await callOpenAI({
        spec, messages, maxTokens,
        authHeader, timeoutMs: timeout,
        cacheKey,
      });

      if (result.ok) {
        const total = Date.now() - startTime;
        console.log(`[${requestId}] ${spec.tier.toUpperCase()} OK ${spec.model} ${result.latency}ms total=${total}ms finish=${result.finishReason}`);
        logCacheHit(requestId, spec.tier, result.usage);

        let finalResult  = result;
        let finalModel   = spec.model;
        let finalLatency = result.latency;
        let regenerated  = false;
        let classifyDiag = null;

        try {
          const phoneOnFile = scanPhoneOnFile(userText);
          if (phoneOnFile) {
            const parsed    = safeJsonParse(result.text);
            const smsText   = (parsed && typeof parsed.sms   === 'string') ? parsed.sms   : '';
            const emailText = (parsed && typeof parsed.email === 'string') ? parsed.email : '';

            if (smsText.length > 20 || emailText.length > 20) {
              const [smsFlag, emailFlag] = await Promise.all([
                smsText.length   > 20 ? classifyPhoneAsk(smsText,   authHeader) : Promise.resolve(false),
                emailText.length > 20 ? classifyPhoneAsk(emailText, authHeader) : Promise.resolve(false),
              ]);

              classifyDiag = `sms=${smsFlag ? 'YES' : 'NO'} email=${emailFlag ? 'YES' : 'NO'} phoneOnFile=true`;
              console.log(`[${requestId}] CLASSIFY ${classifyDiag}`);

              if (smsFlag || emailFlag) {
                const reasons = [];
                if (smsFlag)   reasons.push('sms flagged');
                if (emailFlag) reasons.push('email flagged');
                console.log(`[${requestId}] REGEN triggered (${reasons.join(', ')})`);

                const regenRemaining = TOTAL_BUDGET_MS - (Date.now() - startTime);
                if (regenRemaining >= MIN_TIMEOUT_MS) {
                  const regenMessages = [
                    { role: 'system', content: systemText + REGEN_CONSTRAINT_TEXT },
                    { role: 'user',   content: userText },
                  ];
                  const regenTimeout = Math.min(spec.timeout, regenRemaining - TIMEOUT_SLACK_MS);

                  const regenResult = await callOpenAI({
                    spec, messages: regenMessages, maxTokens: spec.tokens,
                    authHeader, timeoutMs: regenTimeout,
                    cacheKey,
                  });

                  if (regenResult.ok) {
                    const regenTotal = Date.now() - startTime;
                    console.log(`[${requestId}] REGEN OK ${spec.model} ${regenResult.latency}ms total=${regenTotal}ms`);
                    logCacheHit(requestId, 'regen', regenResult.usage);
                    finalResult  = regenResult;
                    finalLatency = regenResult.latency;
                    regenerated  = true;
                  } else {
                    console.warn(`[${requestId}] REGEN FAIL ${spec.model} ${regenResult.latency}ms → ${regenResult.error} (keeping primary output)`);
                  }
                } else {
                  console.warn(`[${requestId}] REGEN SKIPPED — budget exhausted (${regenRemaining}ms remaining)`);
                }
              }
            } else {
              classifyDiag = `skipped (sms+email too short)`;
            }
          } else {
            classifyDiag = `skipped (no phone on file)`;
          }
        } catch (err) {
          console.warn(`[${requestId}] CLASSIFY ERROR → ${err.message || 'unknown'} (keeping primary output)`);
          classifyDiag = `error: ${(err.message || 'unknown').slice(0, 60)}`;
        }

        const finalTotal = Date.now() - startTime;
        console.log(`[${requestId}] FINAL total=${finalTotal}ms regenerated=${regenerated}`);

        const envelope = wrapAsGemini(finalResult, finalModel);
        if (i > 0) envelope[`_${spec.tier}Used`] = true;
        if (regenerated)  envelope._regenerated = true;
        if (classifyDiag) envelope._classify    = classifyDiag;

        envelope._edgeCache = 'MISS';

        // v7.17: serialize once — shared string used for both cache body and response.
        const envelopeJson = JSON.stringify(envelope);

        // ─── EDGE CACHE WRITE (v7.16 / v7.17) ───────────────────────
        // Only cache clean primary-tier responses — not regen, not fallback.
        // v7.17: ctx.waitUntil() — write happens in background, response
        //        returns to client immediately without waiting for cache.put.
        if (i === 0 && !regenerated) {
          try {
            const cacheResponse = new Response(envelopeJson, {
              headers: { 'Content-Type': 'application/json', 'Cache-Control': `s-maxage=${EDGE_CACHE_TTL}` },
            });
            ctx.waitUntil(
              cache.put(edgeKey, cacheResponse)
                .then(() => console.log(`[EDGE-CACHE] STORED ttl=${EDGE_CACHE_TTL}s`))
                .catch(e => console.warn(`[EDGE-CACHE] store error: ${e.message}`))
            );
          } catch (e) { console.warn(`[EDGE-CACHE] store setup error: ${e.message}`); }
        }

        return corsResponse(envelopeJson, 200, {
          'X-Request-ID':    requestId,
          'X-Model':         finalModel,
          'X-Tier':          spec.tier,
          'X-Total-Latency': String(finalTotal),
          'X-Regenerated':   regenerated ? 'true' : 'false',
          'X-Edge-Cache':    'MISS',
        });
      }

      console.warn(`[${requestId}] ${spec.tier.toUpperCase()} FAIL ${spec.model} ${result.latency}ms → ${result.error}`);

      lastError = result.error;
      lastTier  = spec.tier;
      lastModel = spec.model;

      if (result.fatal) break;
    }

    return safeFallback(requestId, startTime, { lastError, lastTier, lastModel });
  },
};

// ═══════════════════════════════════════════════════════════════════════
// LICENSE HELPERS
// ═══════════════════════════════════════════════════════════════════════

async function validateLicenseRecord(licenseKey, env) {
  if (!licenseKey) return { valid: false, error: 'No license key' };

  if (env.DIRECTOR_KEYS) {
    const allowed = env.DIRECTOR_KEYS.split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.includes(licenseKey)) {
      return {
        valid:  true,
        record: {
          persona:   'director',
          agentName: 'Director',
          dealer:    'Community Auto Group',
          stores:    [],
          active:    true,
        },
      };
    }
  }

  if (!env.LEADPRO_LICENSES) return { valid: false, error: 'KV not bound' };

  const raw = await env.LEADPRO_LICENSES.get(licenseKey);
  if (!raw) return { valid: false, error: 'License not found' };

  let record;
  try { record = JSON.parse(raw); }
  catch { return { valid: false, error: 'Corrupt license record' }; }

  if (record.active === false) return { valid: false, error: 'License inactive' };
  if (record.expiresAt && record.expiresAt < Date.now()) {
    return { valid: false, error: 'License expired' };
  }
  return { valid: true, record };
}

// ═══════════════════════════════════════════════════════════════════════
// AI CALL HELPERS
// ═══════════════════════════════════════════════════════════════════════

async function callOpenAI({ spec, messages, maxTokens, authHeader, timeoutMs, cacheKey }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  const payload = {
    model:                 spec.model,
    messages,
    max_completion_tokens: maxTokens,
    response_format:       { type: 'json_object' },
  };

  if (spec.temperature !== null) payload.temperature = spec.temperature;

  if (spec.gpt5) {
    payload.reasoning_effort = REASONING_EFFORT;
    payload.verbosity        = VERBOSITY;
  }

  if (cacheKey) {
    payload.prompt_cache_key       = cacheKey;
    payload.prompt_cache_retention = CACHE_RETENTION;
  }

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': authHeader,
        'Accept':        'application/json',
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const status  = res.status;
      const errBody = await res.json().catch(() => null);
      const errMsg  = errBody?.error?.message || `HTTP ${status}`;
      const fatal   = status === 401 || status === 403 || status === 404;
      return { ok: false, fatal, latency: Date.now() - t0, error: errMsg.slice(0, 140) };
    }

    const data         = await res.json();
    const choice       = data?.choices?.[0];
    const text         = choice?.message?.content || '';
    const openaiFin    = choice?.finish_reason || 'stop';
    const finishReason = FINISH_MAP[openaiFin] || 'STOP';

    if (text.length < MIN_CONTENT_CHARS)
      return { ok: false, latency: Date.now() - t0, error: `Empty response (finish=${openaiFin})` };

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

function wrapAsGemini({ text, finishReason, latency, usage }, model) {
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
    _model:   model,
    _latency: latency,
  };
}

function safeFallback(requestId, startTime, diag = {}) {
  const totalTime = Date.now() - startTime;
  const { lastError, lastTier, lastModel } = diag;
  const diagSuffix = lastError
    ? ` lastTier=${lastTier} lastModel=${lastModel} lastError="${lastError}"`
    : '';
  console.warn(`[${requestId}] SAFE_FALLBACK after ${totalTime}ms${diagSuffix}`);

  return corsResponse(JSON.stringify({
    candidates: [{
      content:      { parts: [{ text: SAFE_FALLBACK_TEXT }], role: 'model' },
      finishReason: 'STOP',
      _fallback:    true,
      _fallbackMs:  totalTime,
      _requestId:   requestId,
      _lastError:   lastError || null,
      _lastTier:    lastTier  || null,
      _lastModel:   lastModel || null,
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

function isLikelyJson(s) {
  const first = s.trimStart()[0];
  return first === '{' || first === '[';
}

// ═══════════════════════════════════════════════════════════════════════
// EDGE CACHE HELPERS (v7.16)
// ═══════════════════════════════════════════════════════════════════════

// edgeCacheKey — daily-scoped SHA-256 hash of system + user prompt.
// Date prefix prevents stale cross-day hits.
// v7.17: uses module-level TEXT_ENCODER singleton instead of per-call allocation.
async function edgeCacheKey(systemText, userText) {
  const today = new Date().toISOString().slice(0, 10); // "2026-05-21"
  const data = TEXT_ENCODER.encode(today + '\n' + systemText + '\n---SEP---\n' + userText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://edge-cache.leadpro.internal/key/${hashHex}`);
}

// ═══════════════════════════════════════════════════════════════════════
// PROMPT CACHE HELPERS (v7.14)
// ═══════════════════════════════════════════════════════════════════════

function promptCacheKey(systemPrompt) {
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return `${CACHE_KEY_PREFIX}_default`;
  }
  let hash = 5381;
  const sample = systemPrompt.slice(0, 200);
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) + hash + sample.charCodeAt(i)) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${CACHE_KEY_PREFIX}_${hex}`;
}

function logCacheHit(requestId, label, usage) {
  if (!usage || typeof usage !== 'object') return;
  const total  = usage.prompt_tokens || 0;
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  if (total <= 0) return;
  const pct = ((cached / total) * 100).toFixed(1);
  console.log(`[${requestId}] CACHE ${label} cached=${cached}/${total} (${pct}%)`);
}

// ═══════════════════════════════════════════════════════════════════════
// CLASSIFIER + REGEN HELPERS (v7.13)
// ═══════════════════════════════════════════════════════════════════════

// v7.17: uses pre-compiled PHONE_ON_FILE_RE; digit count via early-exit loop
// instead of match(/\d/g) array allocation.
function scanPhoneOnFile(userText) {
  if (!userText || typeof userText !== 'string') return false;
  const m = PHONE_ON_FILE_RE.exec(userText);
  if (!m) return false;
  const valuePart = m[1] || '';
  let digits = 0;
  for (let i = 0; i < valuePart.length; i++) {
    const c = valuePart.charCodeAt(i);
    if (c >= 48 && c <= 57 && ++digits >= 7) return true;
  }
  return false;
}

function safeJsonParse(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

// v7.17: uses pre-built CLASSIFIER_PROMPT_PREFIX / CLASSIFIER_PROMPT_SUFFIX
// constants — only the dynamic message body is interpolated per call.
async function classifyPhoneAsk(messageText, authHeader) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);

  const classifierPrompt = CLASSIFIER_PROMPT_PREFIX + messageText + CLASSIFIER_PROMPT_SUFFIX;

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': authHeader,
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [{ role: 'user', content: classifierPrompt }],
        max_completion_tokens: CLASSIFIER_MAX_TOKENS,
        temperature: CLASSIFIER_TEMP,
        prompt_cache_key:       `${CACHE_KEY_PREFIX}_classifier`,
        prompt_cache_retention: CACHE_RETENTION,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return false;
    const data = await res.json();
    const answer = (data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    return answer.startsWith('YES');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
