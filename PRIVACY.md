# Lead Pro — Privacy Policy

**Last updated: April 20, 2026**

---

## Overview

Lead Pro is an internal productivity Chrome extension built exclusively for Community Auto Group dealership BDC teams. It assists agents by reading lead information from VinSolutions CRM pages and generating personalized response drafts (SMS, email, voicemail) using an AI model.

---

## What Data Lead Pro Accesses

Lead Pro reads the following information from VinSolutions CRM pages that the authorized user has already opened in their browser:

- Customer name, phone number, and email address
- Vehicle of interest, lead source, and dealer ID
- Lead notes and conversation history visible on the CRM page
- Agent name and contact information associated with the lead

This data is only accessed when the user actively clicks **Grab Lead** or **Generate** within the extension.

---

## How Data Is Used

Data accessed by Lead Pro is used solely to generate response drafts for the BDC agent. The process is:

1. The extension reads lead data from the active VinSolutions CRM page
2. That data is sent over HTTPS to a secure Cloudflare Worker proxy operated by Community Auto Group
3. The proxy forwards a structured prompt to the Google Gemini API
4. The AI-generated response is returned to the user's browser and displayed in the extension panel

No data is used for advertising, tracking, or any purpose other than generating the response draft.

---

## What Data Is Stored

- Lead Pro does **not** store customer data on any Lead Pro or Community Auto Group server
- Lead Pro does **not** log, retain, or archive customer lead information after the response is generated
- Lead Pro does **not** use cookies or persistent cross-session tracking
- Temporary data (active lead ID and generated responses) is stored only in the browser's local storage for the duration of the active session and is cleared when the session ends

---

## Third-Party Services

Lead Pro uses the following third-party service to generate responses:

- **Google Gemini API** — Customer lead data is included in prompts sent to this API for the sole purpose of generating draft responses. Google's data handling is governed by the [Google Cloud Privacy Notice](https://cloud.google.com/terms/cloud-privacy-notice).
- **Cloudflare Workers** — Used as a secure proxy between the extension and the Gemini API. Cloudflare's privacy policy is available at [cloudflare.com/privacypolicy](https://www.cloudflare.com/privacypolicy/).

Lead Pro does **not** sell, share, or transmit customer data to any other third party.

---

## Who Can Use Lead Pro

Lead Pro is distributed exclusively to authorized employees of Community Auto Group dealerships:

- Community Toyota Baytown
- Community Kia Baytown
- Community Honda Baytown
- Community Honda Lafayette
- Audi Lafayette

It is not a consumer product and is not available to the general public.

---

## Security

All data transmission between Lead Pro and the Cloudflare Worker proxy uses HTTPS encryption. The Cloudflare Worker validates requests before forwarding to the Gemini API. No customer data is exposed to unauthorized parties.

---

## Changes to This Policy

If this policy changes materially, the "Last updated" date above will be updated. Continued use of Lead Pro after changes constitutes acceptance of the revised policy.

---

## Contact

For questions about this privacy policy, contact:

**Gil Guzman**
Community Auto Group
Email: gilsguzman@gmail.com
