// ─────────────────────────────────────────────────────────────────
// Lead Pro — config.example.js
//
// SETUP INSTRUCTIONS:
// 1. Copy this file, rename the copy to: config.js
// 2. Fill in EITHER the proxy URL (recommended for teams)
//    OR the direct API key (single user only)
// 3. Save config.js and reload the extension at chrome://extensions
//
// ⚠ Never share config.js or post either value anywhere.
// ─────────────────────────────────────────────────────────────────

// ── OPTION A: Proxy URL (recommended for team use) ────────────────
// Your Cloudflare Worker URL — key never touches this machine.
// Get this URL after deploying the worker on Cloudflare.
// Example: 'https://leadpro-proxy.yourname.workers.dev'
const LEADPRO_PROXY_URL = 'YOUR_PROXY_URL_HERE';

// ── OPTION B: Direct API key (single user / testing only) ─────────
// Only used if LEADPRO_PROXY_URL is not set.
// const LEADPRO_API_KEY = 'YOUR_API_KEY_HERE';
