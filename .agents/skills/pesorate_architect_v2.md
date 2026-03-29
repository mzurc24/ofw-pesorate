---
description: OFW Pesorate - AI Skillset, System Architecture, & Deep DevOps Manual (V2 Full Scan)
---

# 🧠 OFW Pesorate: AI Skillset & Deep DevOps Manual

> [!CAUTION]
> **AGENT DIRECTIVE**: You are currently operating inside the OFW Pesorate repository. This document is your technical baseline. Before writing new code, deleting files, or pushing deployments, you must abide by the architectural rules, security policies, and incident mitigation strategies defined below.

---

## 1. System Architecture & Component Mapping

### A. Frontend (The "Glassmorphism" UI)
*   **Path**: `public/`
*   **Core Logic**: `app.js` handles bootstrapping and local storage logic (`ofw_pesorate_name`, `ofw_pesorate_id`, `ofw_pesorate_base`).
*   **Design Paradigm**: Vanilla HTML5/CSS3 relying on strict flexbox and `backdrop-filter: blur` (Glassmorphism). Avoid introducing Tailwind or bulk CSS frameworks unless explicitly authorized.

### B. The Edge Backend (Cloudflare Pages Functions)
*   **Path**: `functions/api/`
*   **Core Math Engine (`rates.js`)**: Synchronizes with Fixer.io. It validates cache TTL against the D1 Database before making external calls to preserve free-tier request limits.
*   **Client Router (`rate.js`)**: Consumes the raw data from `rates.js`, detects the user's location via `request.cf.country`, and performs real-time currency conversion mathematically before feeding it to `app.js`.

### C. The D1 Database & Analytics Layer
*   **Path**: `wrangler.toml` (binding `ofw_pesorate_db`).
*   **Tables**: `users` (logs geographic and timestamp data), `conversions` (track rate inquiries), `rates_cache` (caches Fixer.io JSON), `settings` (stores `last_fixer_fetch`).

### D. Security & Zero-Trust Policies
*   **Path**: `public/_headers`
*   **Rules**: Strict Content-Security-Policy (CSP) enforcing `default-src 'self'`, `X-Frame-Options: DENY`, and strictly disallowing inline unsafe evaluation. 
*   **Agent Constraint**: Do not introduce remote CDNs (like jQuery or un-audited unpkg links) into `index.html` without whitelisting them in `_headers`.

---

## 2. CI/CD & Zero-Downtime Deployment Playbook

The pipeline explicitly forbids manual pushes to Production without automated regional verification.

### The Pipeline (`.github/workflows/deploy.yml`)
1.  **Isolated Preview**: Code is pushed via Wrangler to a Cloudflare Pages `--branch=production` preview link.
2.  **Global Simulation (`health_check.js`)**: Puppeteer boots the preview URL dynamically.
    *   It bypasses the "Welcome" UI logic.
    *   It spoof-routes through 4 strict regions (`MY`, `SG`, `PH`, `US`) using `X-Test-Country` and `X-Test-Token` to override the native Cloudflare `cf.country` header in `rate.js`.
3.  **Production Promotion**: If all 4 mathematical tests pass (showing the correct rates for ringgit, dollars, etc), the pipeline merges to `main/production`.
4.  **Edge Cache Purge**: `scripts/purge_cache.js` hits the Cloudflare API (`v4/zones/{ZONE_ID}/purge_cache`) to invalidate edge nodes instantly.

### Continuous Monitoring (`.github/workflows/monitor.yml`)
-   A CRON action runs `health_check.js` against the live production URL every 15 minutes.
-   If it detects a broken UI, a blank page, or an API error, it executes a **Self-Healing Layer 1** response: force-purging the cache via webhook to resolve stuck 304 loops or stale HTML drops.

---

## 3. Incident Knowledge & Mitigation Mappings

### 🔴 Incident Alpha: "The Malaysia Blank Page"
*   **Symptom**: Users in Malaysia using regional in-app browsers (Facebook, Grab) saw infinite white screens.
*   **Root Cause**: In-app WebViews lacked secure context support for modern ES APIs like `crypto.randomUUID()`. Because the main UI (`#dashboard`) was `display: none` by default, the runtime crash halted the UI before it could un-hide.
*   **Mitigation Policy**: 
    1.  Always write graceful polyfills for modern ES6+ features (e.g., using `Math.random` bitwise fallbacks for UUIDs).
    2.  Always wrap primary UI boot sequences in `try/catch` handlers.
    3.  **Architecture Rule**: Never hide elements via `display: none` natively in CSS without a fallback. We now use an animated `#app-boot-loading` HTML skeleton that inherently shows on screen, degrading gracefully via `window.onerror`.

### 🔴 Incident Beta: "Puppeteer HTTP 304 Crashes"
*   **Symptom**: CI/CD health checks successfully rendered the UI but crashed on HTTP verification stating `Error: 304`.
*   **Root Cause**: Puppeteer tracks `response.ok()`, which only permits standard 200–299 limits. Cloudflare Edge perfectly serves cached hits as `304 Not Modified`.
*   **Mitigation Policy**: When writing headless checks, treat `304` as a valid success code: `response.ok() || response.status() === 304`.

### 🔴 Incident Gamma: "D1 500 Exhaustion"
*   **Symptom**: Spikes in traffic crashing the API endpoints.
*   **Root Cause**: D1 database queries (`env.DB.prepare`) are asynchronous and finite. If traffic spikes while the Worker makes 5 DB reads per user, the connection pool shatters.
*   **Mitigation Policy**: Use the custom `safeDbQuery()` and `safeDbRun()` helper wrappers. Wrap `INSERT` logging functions in Cloudflare `context.waitUntil()` so they fire silently in the background after the user's JSON response has already been sent.

---

## 4. Operational Do's and Don'ts For AI Agents

### ✅ DO:
1.  **Respect "The Single Source of Math"**: The frontend (`app.js`) is strictly a presentation layer. Do *not* write Javascript to multiply currency amounts on the client side. All math MUST happen inside `functions/api/rate.js` using the normalized 8-decimal engine.
2.  **Verify UI Fallbacks**: When building new HTML modules, ensure they can load (or fail gracefully with standard text) even if JavaScript is globally disabled or crashes.
3.  **Maintain the Deployment Token Chain**: The `.github` workflows explicitly rely on three crucial secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_ZONE_ID`. If modifying GitHub Actions, ensure you map these exact ENVs.

### ❌ DON'T:
1.  **Don't Break The Geo-Switch**: The UI hides the Currency Selector (`<select>`) for users outside the Philippines (`PH`). Never override this conditionally unless explicitly asked by the User.
2.  **Don't Push Without Previews**: Do not circumvent the `Deploy & Validate` workflow. If testing Cloudflare Functions natively, use `wrangler pages dev` locally.
3.  **Don't Ignore `_headers`**: Adding tracking scripts or third-party fonts requires manually altering the Content-Security-Policy in `public/_headers`.
