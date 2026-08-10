// Lead Pro -- popup.js  v9.7.467 (Commercial, auth.js. CRITICAL: LICENSE VALIDATION FIELD-NAME MISMATCH -- every real Worker login was silently rejected. Gil reported Veronica Villanueva's freshly-provisioned key ("LP-EAB3HY6L") failing with the generic "Invalid license key" message even after manually verifying the KV entry was byte-for-byte correct (confirmed against a known-working agent's record). Root cause, fully traced: every route in this Worker responds {ok: true/false, ...} -- /generate, /valuefact, /provision-license, all of it -- but validateLicense()'s check here was written against a `valid` field the Worker never sends. Result: `validation.valid` was ALWAYS undefined, so `!validation.valid` treated every login as a rejection -- including fully approved ones. This is exactly why the error text was the GENERIC fallback and never a specific one: the Worker's real rejections DO include an `error` field ("License not found," etc.) that would have shown through, but its SUCCESS response has no `error` field at all, which only produces the generic text when the approval itself is what's being misread as a failure. Never surfaced before now because this fetch path only started actually resolving once the endpoint-resolution fix shipped (v9.7.462) -- every agent set up before that took the Dev Mode bypass instead (which sets `valid: true` directly in this file's own fallback code), never touching the Worker's real response shape at all. Veronica was the first agent to go through the fully-wired path end to end. FIX: map `ok` -> `valid` on the parsed response before returning it, rather than changing the Worker's response shape everywhere else in the codebase. Verified against all 3 real shapes: Worker success (now valid:true), Worker rejection (still valid:false, specific error text preserved), and the pre-existing Dev Mode bypass object (untouched, already had `valid` set). Pairs: DEV v9.7.472-dev / COMMERCIAL v9.7.467. Builds on v9.7.466.)
// Lead Pro -- popup.js  v9.7.466 (Commercial, auth.js. LICENSE KEY PLACEHOLDER MISMATCH -- paired with Worker v7.37's case/whitespace normalization fix. Gil reported a freshly-provisioned key ("LP-EAB3HY6L", Veronica Villanueva) not being recognized on login. Root cause split across client + server: server-side, the KV license lookup was exact-case-sensitive with zero normalization anywhere in the chain (fixed in Worker v7.37 -- see that changelog for the full incident). Client-side contributor found while investigating: the login screen's license-key input placeholder read "LMPRO-XXXX-XXXX-XXXX" -- a stale format that has never matched what /provision-license actually generates ("LP-" + 8 chars, no internal dashes) -- plausibly prompting an agent to "correct" a genuinely valid key to match the wrong-looking hint. Fixed the placeholder to "LP-XXXXXXXX". No functional/validation logic changed client-side -- there was never a client-side format regex blocking submission, so this alone wasn't a hard block, but it's a real, confirmed piece of user-facing confusion worth closing alongside the actual server-side fix. Pairs: DEV v9.7.471-dev / COMMERCIAL v9.7.466 / Worker v7.37. Builds on v9.7.465.)
/**
 * Lead Pro — Auth & Profile Module
 * Handles login, license validation, and agent profile management
 */

const LEADPRO_AUTH = (function() {

  const STORAGE_KEY = 'leadpro_profile';
  const LICENSE_KEY = 'leadpro_license';
  const SESSION_KEY = 'leadpro_session';

  // Persona definitions — controls system prompt tone and behavior
  const PERSONAS = {

    bdc: {
      id: 'bdc',
      label: 'BDC Agent',
      title: 'Internet Sales Coordinator',
      color: '#38b6ff',
      group: 'Traffic Driver',
      objective: 'Time + Visit Commitment',
      mechanism: "Strategic Omission — leave 20% of info for the in-person experience",
      description: 'Appointment setter. Bridges inquiry to arrival. Never owns deal terms.',
      triggers: ['first-touch', 'info request', 'new lead'],
      convStates: ['first-touch', 'active-follow-up'],
      tone: 'Reassuring, we-focused, low pressure. Sound like a helpful coordinator, not a script. Validate the vehicle. Find a real reason for the visit beyond "you should come see it."',
      dos: ['Offer specific times that vary across messages — not always the same time slot', 'Confirm availability when relevant', 'Find a curiosity hook specific to THIS vehicle (not the same two details every time)', 'Keep 20% back — give them a real reason to show up that you cannot deliver over text', 'Ask one qualifying question when the customer state warrants it'],
      donts: ['Use "color justice" / "photos don\'t do it justice" — overused BDC cliche', 'Use "seat comfort is one of those things you have to feel" — overused BDC cliche', 'Open with "Quick note" — telegraphs template', 'Default to "4:15 today or tomorrow morning" or any single canonical time slot — vary the times offered', 'Use "as of this morning" as a default availability phrase', 'Use "20 minutes, no pressure" as the default appointment framing — the customer has heard this 100 times', 'Negotiate price or payment', 'Sound final on credit or terms', 'Over-explain technical specs', 'Answer every question fully — leave something for the visit'],
      exampleSms: "Dylan, the Pilot Touring is here. One thing I cannot do over text is the trade appraisal — that has to be in person. If you can swing by Thursday afternoon or Friday morning I can have it ready when you walk in. Which works better?",
      exampleEmail: "Dylan,\n\nGood news on the Civic Sport — it is on the lot. Couple of things easier in person than over text: the visibility from the driver's seat (the new A-pillar design surprises people) and a real trade number on your Accord. KBB gives you a starting figure but the actual offer depends on the car in person.\n\nI have time Wednesday around 5 or Saturday morning open. If neither works just send me a window that does and I'll line it up.",
      exampleVoicemail: "Hey Dylan, [Agent] at [Store]. Calling about the Telluride. Wanted to grab you because I can have the trade paperwork queued up ahead of time so you are not waiting around when you come in. Give me a shout back at 337-555-1234 — that's 337-555-1234.",
      systemHint: "You are a BDC agent \u2014 a traffic driver, not a closer. Your win is a real reason to come in and a time that works for them, never the deal itself. Read where they are and meet them there: a ready buyer gets confidence, a researcher gets one easy qualifying question before you ask for the visit, someone pulling back gets space and validation instead of a harder close. Your strongest pull is almost always something they can only get in person \u2014 a real trade number, the actual feel of the car, a side-by-side \u2014 so pick the one that fits this customer and lead with it. Leave pricing, payments, and final trade numbers for the visit; that is what earns the trip. Reassuring and low-pressure throughout: the appointment should feel like the obvious easy next step, not a commitment."
    },

    sales: {
      id: 'sales',
      label: 'Sales Consultant',
      title: 'Product Specialist',
      color: '#ff5b5b',
      group: 'Closer',
      objective: 'Decision and Commitment',
      mechanism: "Risk Reversal — the visit evaluates the deal, not just the car",
      description: 'Deal owner. Removes friction. Addresses objections directly. Speaks in outcomes.',
      triggers: ['trade-in inquiry', 'payment question', 'high intent', 'price discussion'],
      convStates: ['active-follow-up', 'negative-reply', 'active'],
      tone: 'Confident, concise, I-focused. Speak in outcomes. Frame the visit as low-stakes evaluation. Sound like a person who knows the deal, not a script.',
      dos: ['Speak in outcomes and next steps, not conditions', 'Address objections directly when they appear', 'Be specific to THIS customer and THIS vehicle, not generic showroom language', 'Use I-language ("I can have that ready") not we-language ("we might be able to")', 'Frame the visit as where the customer GETS answers, not where they get pitched'],
      donts: ['Use the phrase "keys and window sticker" — it is a tired showroom cliche', 'Ask "is this something you\'d want to move forward on today" or any variant — it sounds like a 1970s car jockey', 'Use the "if it checks out / if something\'s off, you walk and I respect that" structure — overused and scripted', 'Defer to management prematurely', 'Ask passive checking-in questions', 'Sound uncertain or conditional', 'Leave objections unaddressed'],
      exampleSms: "Got it — the Pilot Touring is here in the Lunar Silver you asked about. If you can swing by tomorrow I can have the trade appraisal done while you drive it, so you walk out knowing the real number. Morning or afternoon better?",
      exampleEmail: "Dylan,\n\nQuick note. The Blueprint Pearl Civic is here as of this morning — it has been getting attention but it is still on the lot. The piece I cannot do over text is your trade. KBB gives you a starting number; what we can actually pay against it depends on the car in person, and we are usually within $500 of the final number once we see it.\n\nIf you can come by tomorrow, I will have the appraisal queued up and we can run the actual deal — financing, trade, everything in one sitting. If the numbers do not land where you need them, you have not lost anything. If they do, you have a real answer.\n\nWhat time works?",
      exampleVoicemail: "Hey Dylan, [Agent] at [Store]. The Pilot you were asking about is still here, and I wanted to grab you before someone else does. If tomorrow works, I can have the trade appraisal ready when you walk in — you would not be guessing on numbers anymore. 337-555-1234 when you get a minute. Talk soon.",
      systemHint: "You are a sales consultant \u2014 the deal owner. You speak in outcomes, not maybes: 'I can have that ready,' not 'we might be able to.' But you read the room first. A decision-ready buyer gets a real pre-close that surfaces what is actually left to settle. A researcher gets a resource who makes the visit the place their questions get answered, not the place they get sold. Someone gone quiet gets one piece of genuine value and room to respond, not a push. Hold back written payment quotes, trade values before appraisal, and approval language \u2014 give them enough to want to come in, not enough to be shopped against another store. Sound like a person who knows this car and this deal, never like a pitch. If a lead has truly stalled, the Director voice handles it, not you."
    },

    manager: {
      id: 'manager',
      label: 'Sales Manager',
      title: 'Sales Manager',
      color: '#f5c842',
      group: 'Authority Reset',
      objective: 'Re-engage and De-escalate',
      mechanism: "Accountability — validating the customer's time and importance",
      description: "Steps in when momentum drops. Acknowledges the team's efforts. Re-engages with authority.",
      triggers: ['missed appointment', '48hr silence', 'no reply after multiple attempts', 're-engagement'],
      convStates: ['stalled', 'pause', 'negative-reply', 'call-followup'],
      tone: 'Polished, short sentences, intentional. Authority through restraint, not through repeating that you are the manager. Show you know the situation through specifics, not by announcing you reviewed it.',
      dos: ['Reference the specific vehicle, situation, or detail by name (shows you know without announcing it)', 'Keep it short — authority reads as concise', 'Offer your direct line when relevant', 'Validate the customer\'s time without hedging', 'Use one tone-shifting move per message: pressure removal, friction removal, or specific authority — not all three at once'],
      donts: ['Use the word "personally" more than ONCE per message — it loses meaning when repeated', 'Say "I reviewed" or "I reviewed your file/history/conversation" — show through specifics, do not announce', 'Use "step in" / "stepping in" / "step in directly" — find other ways to signal authority', 'Use the "either response is fine / useful information either way" pattern as a default — vary it', 'Sound salesy or scripted', 'Over-apologize', 'Push for a hard close in the opening', 'Repeat what the BDC already said'],
      exampleSms: "Dylan, [Manager] at [Store]. Saw the back-and-forth about the Pilot Touring. If something's making this harder than it should be, tell me what — I can usually unstick it. If timing just isn't right, that works too.",
      exampleEmail: "Dylan,\n\n[Manager] here, sales manager at [Store]. The Pilot has been on your radar a couple of weeks now and we've been chasing you a bit, so I wanted to reach out directly.\n\nNo agenda. If you've moved on, just tell me and I'll close this out clean. If you're stuck on something specific — number, timing, the vehicle itself — there's a good chance I can do something about it from my side.\n\nMy direct line is at the bottom. Use it whenever.",
      exampleVoicemail: "Dylan, [Manager], sales manager at [Store]. Wanted to reach out directly on the Pilot — no pitch, just available if anything is in the way. 337-555-1234 when you have a minute. That's 337-555-1234.",
      systemHint: "You are a sales manager. Your message carries authority \u2014 the shorter it is, the more weight it holds, so do not pad it. You are not above the team; you are accountable to the customer. The right move depends on the read: a frustrated or over-contacted customer gets honest acknowledgment and a clean way out before any ask; a silent one gets one restrained line and your direct number; someone who no-showed gets the blame removed entirely \u2014 things come up, reset the timeline without pressure. Authority shows through specifics and restraint \u2014 a concrete thing you will personally have ready \u2014 never through repeating your title or announcing that you reviewed the file. Do not re-sell what the team already said. You step in to remove the obstacle."
    },

    concierge: {
      id: 'concierge',
      label: 'Luxury Concierge',
      title: 'Audi Concierge',
      color: '#9b6dff',
      group: 'Experience Curator',
      objective: 'Elevate and Personalize',
      mechanism: "Anticipatory Service — suggest conveniences before they are asked for",
      description: 'Prioritizes the visit experience over the unit sale. Removes all friction. White-glove.',
      triggers: ['luxury brand lead', 'Audi lead', 'high-value trade', 'premium vehicle inquiry'],
      convStates: ['first-touch', 'active-follow-up', 'call-followup'],
      tone: 'Smooth, elevated, white-glove. Anticipate needs. Remove effort. Customer-first phrasing throughout.',
      dos: ['Offer specific conveniences proactively', 'Use your language — your Audi, your visit', 'Personalize every detail', 'Remove friction before they ask', 'Reference the Brand Specialist by name'],
      donts: ['Use urgency or pressure tactics', 'Use dealership slang or BDC language', 'Sound transactional', 'Use generic openers', 'Say I\'m reaching out regarding your inquiry'],
      exampleSms: "I'd be happy to have the Audi pulled into our indoor delivery bay so you can explore the technology comfortably. Would you prefer a chilled water or a coffee upon your arrival?",
      exampleEmail: "Dylan, I wanted to make your visit feel as effortless as possible. I'll have the Audi pulled into our indoor delivery bay before you arrive — climate controlled, quiet, no pressure. Matthew, your Brand Specialist, will walk you through the technology at whatever pace suits you. Would you prefer a chilled water or coffee waiting? And if there's a particular feature you'd like to focus on first, just let me know — I'll have it ready.",
      exampleVoicemail: "Dylan, this is [Agent], your Audi Concierge at Audi Lafayette. I wanted to make sure your visit is set up exactly the way you'd want it. The Audi will be pulled into our indoor bay, your Brand Specialist Matthew will be ready, and we'll take it at your pace. Give me a call back when you have a moment — 337-555-1234, that's 337-555-1234. Looking forward to it.",
      systemHint: "You are a luxury brand concierge. Every word should feel premium, personal, and unhurried \u2014 written for this one person, never generic, never rushed. You are selling the experience, not the unit: personalization ('your Audi,' 'your Brand Specialist'), control ('we will have everything ready before you arrive'), ease (the indoor bay, no waiting). Offer choices that keep them in control rather than a process to move through. No urgency, no dealership jargon, no sales-process language. Luxury customers exit quietly, so when one goes cool, step back further than you would elsewhere and leave a single elegant door open. A returning Audi owner is the heart of this work \u2014 reference the relationship directly and make the message unmistakably theirs."
    },

    internet_director: {
      id: 'internet_director',
      label: 'Internet Director',
      title: 'Director of Business Development',
      color: '#ff9f43',
      group: 'Pattern Breaker',
      objective: 'Recovery of Ghosted and Stalled Leads',
      mechanism: "Radical Transparency — break the sales script to find the real friction",
      description: 'Identifies the real reason momentum stopped. Changes the angle entirely. Unscripted and human.',
      triggers: ['5+ days ghosted', '3+ objections', 'exit signal', 'zero contact stalled', 'multiple attempts failed'],
      convStates: ['stalled', 'exit', 'zero-contact', 'pause'],
      tone: 'Observational, human, unscripted. Name the real possibilities. Give them an easy out.',
      dos: ['Ask pattern-breaking questions that name the real options', 'Acknowledge the stall without dwelling on it', 'Give the customer an easy out', 'Change the angle completely', 'Be curious, not accusatory'],
      donts: ['Use a standard template', 'Push for an appointment in the first sentence', 'Sound like BDC follow-up', 'Imply the dealer failed', 'Ask did you get my last message'],
      exampleSms: "Most people who go quiet are either still comparing or something changed — which is it for you? Either way, no pressure — just want to make sure we didn't miss the mark.",
      exampleEmail: "Dylan, [Director] here — Internet Director at [Store]. I'm not going to pretend this is a regular follow-up. When someone goes quiet at this point, it's usually one of two things: still comparing, or something changed. Either is completely fine — I just want to know which, so I either get out of your way or actually help. What's the real story?",
      exampleVoicemail: "Dylan, this is [Director], the Internet Director at [Store]. I'm not calling to push — I'm calling because either you found something elsewhere or something shifted on your end, and I'd rather just hear it straight. Either is fine. Call me back at 337-555-1234 when you get a minute. That's 337-555-1234.",
      systemHint: "You are the Internet Director. You step in when standard outreach has stopped working \u2014 your job is to find the real friction, not push harder. Read the whole arc before you write: what has already been tried, what their silence or last message actually means, and the angle no one else has used. They have been getting follow-ups that sound like follow-ups. You do not \u2014 you sound like someone who read the file and noticed they went quiet. One honest read, one real question, one clean way out if they want it. Never bolt a forward ask onto the exit; if you give them room to step back, let it stand alone. Curious, not accusatory. The relationship outlives this message."
    }

  };

  /**
   * Load profile from chrome.storage.sync
   */
  function loadProfile(cb) {
    chrome.storage.sync.get([STORAGE_KEY, LICENSE_KEY], function(result) {
      cb(result[STORAGE_KEY] || null, result[LICENSE_KEY] || null);
    });
  }

  /**
   * Save profile to chrome.storage.sync
   */
  function saveProfile(profile, licenseKey, cb) {
    const data = {};
    data[STORAGE_KEY] = profile;
    if (licenseKey) data[LICENSE_KEY] = licenseKey;
    chrome.storage.sync.set(data, function() {
      if (cb) cb();
    });
  }

  /**
   * Clear profile (logout)
   */
  function clearProfile(cb) {
    chrome.storage.sync.remove([STORAGE_KEY, LICENSE_KEY, SESSION_KEY], function() {
      if (cb) cb();
    });
  }

  /**
   * Validate license key against the Lead Pro backend
   * Returns { valid, dealer, stores, expiresAt, error }
   */
  async function validateLicense(licenseKey, agentEmail) {
    try {
      // (v9.7.462/457 fix) The old endpoint resolution read window.LEADPRO_PROXY_URL — but
      // config.js declares a top-level `const`, which never attaches to window, so the
      // endpoint was ALWAYS '' and every login silently passed in dev-mode. Resolve from the
      // actual globals (same `typeof` pattern popup.js getEndpoint() uses) and build the
      // /validate-license path explicitly instead of a replace() that never matched.
      var base = (typeof LEADPRO_LICENSE_ENDPOINT !== 'undefined' && LEADPRO_LICENSE_ENDPOINT)
              || (typeof window !== 'undefined' && window._leadProWorkerBase)
              || (typeof LEADPRO_PROXY_URL !== 'undefined' && LEADPRO_PROXY_URL)
              || '';
      base = String(base || '').replace(/\/generate$/, '').replace(/\/$/, '');
      if (!base) {
        // Dev mode — no Worker configured at all
        return { valid: true, dealer: 'Dev Mode', stores: [], expiresAt: null, devMode: true };
      }

      const res = await fetch(base + '/validate-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey, agentEmail })
      });

      // Route not implemented Worker-side yet — keep the historical fail-open behavior so
      // fixing the endpoint cannot lock agents out before the Worker ships the route. An
      // explicit Worker rejection (400/401/403/etc.) DOES block — which is the point.
      if (res.status === 404 || res.status === 501) {
        console.warn('[Lead Pro] /validate-license not implemented Worker-side — dev-mode fallback');
        return { valid: true, dealer: 'Dev Mode', stores: [], expiresAt: null, devMode: true };
      }
      if (!res.ok) {
        return { valid: false, error: `Server error: ${res.status}` };
      }

      const data = await res.json();
      // (v9.7.472/467 fix) Every Worker route in this codebase responds with {ok: true/false,
      // ...} -- /generate, /valuefact, /provision-license, all of it -- but this specific check
      // below was written against a `valid` field the Worker never actually sends. Confirmed
      // live (Veronica Villanueva): her key was genuinely approved server-side every time --
      // the Worker's success response has no `error` field, which is exactly what produced the
      // GENERIC "Invalid license key" fallback text rather than a specific rejection message --
      // but data.valid was always undefined, so `!validation.valid` treated every approval as a
      // rejection. This never surfaced before because this fetch path only started actually
      // resolving once the endpoint-resolution fix (v9.7.462) shipped; every agent set up
      // before that took the Dev Mode bypass instead, which sets `valid: true` directly and
      // never touches this field at all. Map ok -> valid here rather than changing the Worker's
      // established response shape everywhere else.
      if (typeof data.valid === 'undefined' && typeof data.ok !== 'undefined') data.valid = data.ok;
      return data;
    } catch (err) {
      // If validation endpoint doesn't exist yet, allow in dev mode
      console.warn('[Lead Pro] License validation unavailable — dev mode fallback');
      return { valid: true, dealer: 'Dev Mode', stores: [], expiresAt: null, devMode: true };
    }
  }

  /**
   * Build the login/profile UI and inject into the page
   */
  function buildLoginUI(container, onLogin) {
    container.innerHTML = `
      <div id="lp-auth-screen" style="
        display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
        padding: 24px 20px; gap:16px; min-height:100%;
        background: linear-gradient(180deg, #080e1a 0%, #0d1625 100%);
      ">
        <!-- Logo -->
        <div style="text-align:center; margin-bottom:4px;">
          <div style="
            font-size:22px; font-weight:900; letter-spacing:0.08em;
            background: linear-gradient(135deg, #f5c842 0%, #ffe87a 50%, #00d296 100%);
            -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
          ">Lead Pro</div>
          <div style="font-size:10px; color:#00d296; opacity:0.8; letter-spacing:0.06em; margin-top:2px;">BDC RESPONSE ENGINE</div>
        </div>

        <!-- Login form -->
        <div style="width:100%; display:flex; flex-direction:column; gap:10px;">
          <div style="font-size:9px; color:#3d5070; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Agent Profile</div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:9px; color:#7a90b8;">Full Name</label>
            <input id="lp-login-name" type="text" placeholder="First Last"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px;
              padding:8px 10px; color:#e8f0ff; font-size:12px; width:100%; box-sizing:border-box;">
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:9px; color:#7a90b8;">Email</label>
            <input id="lp-login-email" type="email" placeholder="agent@dealership.com"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px;
              padding:8px 10px; color:#e8f0ff; font-size:12px; width:100%; box-sizing:border-box;">
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:9px; color:#7a90b8;">Phone Number</label>
            <input id="lp-login-phone" type="tel" placeholder="281-555-1234"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px;
              padding:8px 10px; color:#e8f0ff; font-size:12px; width:100%; box-sizing:border-box;">
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:9px; color:#7a90b8;">Store / Dealership Name <span style="color:#3d5070;">(optional — auto-detected per lead)</span></label>
            <input id="lp-login-store" type="text" placeholder="Community Auto Group"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px;
              padding:8px 10px; color:#e8f0ff; font-size:12px; width:100%; box-sizing:border-box;">
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:9px; color:#7a90b8;">Role / Persona</label>
            <div id="lp-persona-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-top:2px;">
              ${Object.values(PERSONAS).map(p => `
                <div class="lp-persona-btn" data-persona="${p.id}" style="
                  background:#131f33; border:1px solid rgba(0,210,150,0.12);
                  border-radius:6px; padding:7px 8px; cursor:pointer; transition:all 0.15s;
                  ${p.id === 'bdc' ? `border-color:${p.color}; background:rgba(0,210,150,0.08);` : ''}
                ">
                  <div style="font-size:10px; font-weight:700; color:${p.color};">${p.label}</div>
                  <div style="font-size:9px; color:#3d5070; margin-top:2px; line-height:1.3;">${p.description}</div>
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="lp-login-persona" value="bdc">
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:9px; color:#7a90b8;">Custom Title <span style="color:#3d5070;">(optional — overrides role default)</span></label>
            <input id="lp-login-title" type="text" placeholder="e.g. Internet Sales Coordinator"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px;
              padding:8px 10px; color:#e8f0ff; font-size:12px; width:100%; box-sizing:border-box;">
          </div>

          <div style="display:flex; flex-direction:column; gap:3px;">
            <label style="font-size:9px; color:#7a90b8;">License Key</label>
            <input id="lp-login-license" type="text" placeholder="LP-XXXXXXXX"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:6px;
              padding:8px 10px; color:#e8f0ff; font-size:12px; width:100%; font-family:monospace;
              box-sizing:border-box; letter-spacing:0.04em;">
            <div style="font-size:9px; color:#3d5070; margin-top:2px;">Contact your dealer admin or leadpro.ai for a key</div>
          </div>
        </div>

        <!-- Error message -->
        <div id="lp-auth-error" style="
          display:none; width:100%; background:rgba(255,91,91,0.1);
          border:1px solid rgba(255,91,91,0.3); border-radius:6px;
          padding:8px 10px; font-size:10px; color:#ff5b5b; line-height:1.5;
        "></div>

        <!-- Save button -->
        <button id="lp-login-btn" style="
          width:100%; border:none; cursor:pointer; border-radius:6px;
          padding:11px; font-size:12px; font-weight:700; letter-spacing:0.04em;
          background:linear-gradient(135deg, #00d296 0%, #009966 100%);
          color:#001a0f; box-shadow:0 4px 18px rgba(0,210,150,0.25);
          transition:opacity 0.15s;
        ">Save Profile &amp; Continue →</button>

        <div style="font-size:9px; color:#3d5070; text-align:center; line-height:1.5;">
          Your profile is stored locally in Chrome.<br>
          No data is sent to any server except during generation.
        </div>
      </div>
    `;

    // Persona selection — cache NodeList and hidden input to avoid re-querying on every click
    const personaBtns = container.querySelectorAll('.lp-persona-btn');
    const personaHiddenInput = container.querySelector('#lp-login-persona');
    personaBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        personaBtns.forEach(b => {
          b.style.borderColor = 'rgba(0,210,150,0.12)';
          b.style.background = '#131f33';
        });
        const selected = PERSONAS[this.dataset.persona];
        this.style.borderColor = selected.color;
        this.style.background = `rgba(${hexToRgb(selected.color)},0.08)`;
        personaHiddenInput.value = this.dataset.persona;
      });
    });

    // Save button
    container.querySelector('#lp-login-btn').addEventListener('click', async function() {
      const name     = container.querySelector('#lp-login-name').value.trim();
      const email    = container.querySelector('#lp-login-email').value.trim();
      const phone    = container.querySelector('#lp-login-phone').value.trim();
      const store    = container.querySelector('#lp-login-store').value.trim();
      const persona  = container.querySelector('#lp-login-persona').value || 'bdc';
      const title    = container.querySelector('#lp-login-title').value.trim();
      const license  = container.querySelector('#lp-login-license').value.trim();
      const errorEl  = container.querySelector('#lp-auth-error');

      errorEl.style.display = 'none';

      if (!name || !phone || !store) {
        errorEl.textContent = 'Name, phone, and store are required.';
        errorEl.style.display = 'block';
        return;
      }

      this.textContent = 'Validating…';
      this.disabled = true;

      const personaDef = PERSONAS[persona];
      const profile = {
        name,
        email,
        phone,
        store,
        persona,
        title: title || personaDef.title,
        firstName: name.split(' ')[0],
        createdAt: Date.now()
      };

      // Validate license (or skip in dev mode)
      const validation = await validateLicense(license, email);
      if (!validation.valid) {
        errorEl.textContent = validation.error || 'Invalid license key. Contact your dealer admin.';
        errorEl.style.display = 'block';
        this.textContent = 'Save Profile & Continue →';
        this.disabled = false;
        return;
      }

      if (validation.devMode) {
        profile.devMode = true;
      }

      saveProfile(profile, license, function() {
        onLogin(profile);
      });
    });
  }

  /**
   * Build the profile settings UI (edit mode)
   */
  function buildProfileUI(container, currentProfile, onSave, onLogout) {
    container.innerHTML = `
      <div style="padding:16px 14px; display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="font-size:11px; font-weight:700; color:#e8f0ff;">Agent Profile</div>
          <button id="lp-logout-btn" style="
            background:rgba(255,91,91,0.1); border:1px solid rgba(255,91,91,0.3);
            color:#ff5b5b; border-radius:4px; padding:3px 8px; font-size:10px; cursor:pointer;
          ">Sign Out</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <div>
              <div style="font-size:9px; color:#7a90b8; margin-bottom:2px;">Name</div>
              <input id="lp-prof-name" value="${escAttr(currentProfile.name)}"
                style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:5px;
                padding:6px 8px; color:#e8f0ff; font-size:11px; width:100%; box-sizing:border-box;">
            </div>
            <div>
              <div style="font-size:9px; color:#7a90b8; margin-bottom:2px;">Phone</div>
              <input id="lp-prof-phone" value="${escAttr(currentProfile.phone)}"
                style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:5px;
                padding:6px 8px; color:#e8f0ff; font-size:11px; width:100%; box-sizing:border-box;">
            </div>
          </div>

          <div>
            <div style="font-size:9px; color:#7a90b8; margin-bottom:2px;">Store</div>
            <input id="lp-prof-store" value="${escAttr(currentProfile.store || 'Community Auto Group')}"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:5px;
              padding:6px 8px; color:#e8f0ff; font-size:11px; width:100%; box-sizing:border-box;">
          </div>

          <div>
            <div style="font-size:9px; color:#7a90b8; margin-bottom:2px;">Title</div>
            <input id="lp-prof-title" value="${escAttr(currentProfile.title)}"
              style="background:#131f33; border:1px solid rgba(0,210,150,0.15); border-radius:5px;
              padding:6px 8px; color:#e8f0ff; font-size:11px; width:100%; box-sizing:border-box;">
          </div>

          <div>
            <div style="font-size:9px; color:#7a90b8; margin-bottom:4px;">Persona</div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px;">
              ${Object.values(PERSONAS).map(p => `
                <div class="lp-persona-edit" data-persona="${p.id}" style="
                  background:#131f33; border:1px solid rgba(0,210,150,0.12);
                  border-radius:5px; padding:5px 6px; cursor:pointer; text-align:center;
                  transition:all 0.15s;
                  ${currentProfile.persona === p.id ? `border-color:${p.color}; background:rgba(0,210,150,0.08);` : ''}
                ">
                  <div style="font-size:9px; font-weight:700; color:${p.color};">${p.label}</div>
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="lp-prof-persona" value="${currentProfile.persona || 'bdc'}">
          </div>
        </div>

        <button id="lp-prof-save" style="
          width:100%; border:none; cursor:pointer; border-radius:5px;
          padding:8px; font-size:11px; font-weight:700;
          background:linear-gradient(135deg, #00d296, #009966);
          color:#001a0f; transition:opacity 0.15s;
        ">Save Changes</button>

        ${currentProfile.persona === 'internet_director' ? `
        <div style="border-top:1px solid rgba(0,210,150,0.1); padding-top:12px; display:flex; flex-direction:column; gap:8px;">
          <div style="font-size:10px; font-weight:700; color:#f5c842;">🔑 Agent License Keys</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px;">
            <div>
              <div style="font-size:9px; color:#7a90b8; margin-bottom:2px;">Agent Name</div>
              <input id="lp-lic-name" placeholder="Tania Gonzalez"
                style="background:#131f33; border:1px solid rgba(245,200,66,0.2); border-radius:4px;
                padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box;">
            </div>
            <div>
              <div style="font-size:9px; color:#7a90b8; margin-bottom:2px;">Persona</div>
              <select id="lp-lic-persona" style="background:#131f33; border:1px solid rgba(245,200,66,0.2);
                border-radius:4px; padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; cursor:pointer;">
                <option value="bdc">BDC Agent</option>
                <option value="sales">Sales Consultant</option>
                <option value="manager">Sales Manager</option>
              </select>
            </div>
          </div>
          <input id="lp-lic-email" placeholder="agent@dealership.com (optional)"
            style="background:#131f33; border:1px solid rgba(245,200,66,0.2); border-radius:4px;
            padding:5px 7px; color:#e8f0ff; font-size:10px; width:100%; box-sizing:border-box;">
          <button id="lp-lic-generate" style="border:none; cursor:pointer; border-radius:4px;
            padding:6px; font-size:10px; font-weight:700;
            background:linear-gradient(135deg, #f5c842, #e6a800); color:#1a1200;">
            Generate License Key
          </button>
          <div id="lp-lic-result" style="display:none; background:#0d1625; border:1px solid rgba(0,210,150,0.2);
            border-radius:5px; padding:8px; font-size:10px; color:#00d296; word-break:break-all;">
          </div>
        </div>
        ` : ''}
      </div>
    `;

    // Persona edit selection — cache NodeList and hidden input to avoid re-querying on every click
    const personaEditBtns = container.querySelectorAll('.lp-persona-edit');
    const profPersonaInput = container.querySelector('#lp-prof-persona');
    personaEditBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        personaEditBtns.forEach(b => {
          b.style.borderColor = 'rgba(0,210,150,0.12)';
          b.style.background = '#131f33';
        });
        const selected = PERSONAS[this.dataset.persona];
        this.style.borderColor = selected.color;
        this.style.background = `rgba(${hexToRgb(selected.color)},0.08)`;
        profPersonaInput.value = this.dataset.persona;
      });
    });

    container.querySelector('#lp-prof-save').addEventListener('click', function() {
      const persona = container.querySelector('#lp-prof-persona').value;
      const personaDef = PERSONAS[persona];
      const updated = Object.assign({}, currentProfile, {
        name:      container.querySelector('#lp-prof-name').value.trim(),
        phone:     container.querySelector('#lp-prof-phone').value.trim(),
        store:     container.querySelector('#lp-prof-store').value.trim(),
        title:     container.querySelector('#lp-prof-title').value.trim() || personaDef.title,
        persona,
        firstName: container.querySelector('#lp-prof-name').value.trim().split(' ')[0]
      });
      saveProfile(updated, null, function() {
        if (onSave) onSave(updated);
      });
    });

    // License key generation — Director only
    var licBtn = container.querySelector('#lp-lic-generate');
    if (licBtn) {
      licBtn.addEventListener('click', function() {
        var agentName  = container.querySelector('#lp-lic-name').value.trim();
        var agentEmail = container.querySelector('#lp-lic-email').value.trim();
        var persona    = container.querySelector('#lp-lic-persona').value;
        var resultEl   = container.querySelector('#lp-lic-result');
        if (!agentName) { alert('Agent name is required'); return; }

        licBtn.textContent = 'Generating...';
        licBtn.disabled = true;

        chrome.storage.sync.get(['leadpro_license'], function(r) {
          var directorKey = r.leadpro_license || '';
          console.log('[Lead Pro] Provision — directorKey:', directorKey ? directorKey.substring(0,12)+'...' : '(empty)');
          var workerBase = (window._leadProWorkerBase || '').replace(/\/$/, '');
          if (!directorKey || !workerBase) {
            resultEl.style.display = 'block';
            resultEl.style.color = '#ff5b5b';
            resultEl.textContent = 'Error: Could not read Director license key or Worker URL';
            licBtn.textContent = 'Generate License Key';
            licBtn.disabled = false;
            return;
          }
          fetch(workerBase + '/provision-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              directorKey: directorKey,
              agentName:   agentName,
              agentEmail:  agentEmail,
              persona:     persona,
              stores:      ['6189','6190','6191','24399'],
              dealer:      'Community Auto Group'
            })
          })
            .then(function(res) { return res.json(); })
            .then(function(data) {
              resultEl.style.display = 'block';
              if (data.ok) {
                resultEl.style.color = '#00d296';
                resultEl.innerHTML = '<strong>' + agentName + '</strong><br>Key: <span style="color:#f5c842;font-family:monospace;">'
                  + data.licenseKey + '</span><br><span style="color:#3d5070;font-size:9px;">'
                  + 'Persona: ' + persona + ' | Click key to copy</span>';
                resultEl.querySelector('span').addEventListener('click', function() {
                  navigator.clipboard.writeText(data.licenseKey);
                  this.textContent = 'Copied!';
                  setTimeout(() => { this.textContent = data.licenseKey; }, 1500);
                });
              } else {
                resultEl.style.color = '#ff5b5b';
                resultEl.textContent = 'Error: ' + (data.error || 'Unknown error');
              }
            })
            .catch(function(err) {
              resultEl.style.display = 'block';
              resultEl.style.color = '#ff5b5b';
              resultEl.textContent = 'Network error: ' + err.message;
            })
            .finally(function() {
              licBtn.textContent = 'Generate License Key';
              licBtn.disabled = false;
            });
        });
      });
    }

    container.querySelector('#lp-logout-btn').addEventListener('click', function() {
      if (confirm('Sign out of Lead Pro? You will need to re-enter your profile.')) {
        clearProfile(function() {
          if (onLogout) onLogout();
        });
      }
    });
  }

  /**
   * Get persona definition by id
   */
  function getPersona(id) {
    return PERSONAS[id] || PERSONAS.bdc;
  }

  /**
   * Get all persona definitions
   */
  function getAllPersonas() {
    return PERSONAS;
  }

  // Helpers
  // (v9.7.462/457) attribute-escape for values interpolated into innerHTML templates —
  // a quote in a stored profile value previously broke the attribute (self-XSS class).
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
  }

  return {
    loadProfile,
    saveProfile,
    clearProfile,
    validateLicense,
    buildLoginUI,
    buildProfileUI,
    getPersona,
    getAllPersonas,
    PERSONAS
  };

})();
