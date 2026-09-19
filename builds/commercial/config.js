// Lead Pro — config.js  (DO NOT SHARE)

// Proxy URL — Cloudflare Worker. The Worker handles model selection,
// cascade fallback, API auth, and license management. This is the
// ONLY endpoint the extension talks to.
const LEADPRO_PROXY_URL = 'https://leadpro-proxy.gilsguzman.workers.dev/';

// Legacy slot — direct mode is no longer supported. Worker is the only endpoint.
// Kept as an empty const to avoid ReferenceError in any legacy code path.
const LEADPRO_API_KEY = '';
