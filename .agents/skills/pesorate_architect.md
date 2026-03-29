---
description: OFW Pesorate - Core Architecture, Deployment Pipeline, & Self-Healing Playbook
---

# 🧠 OFW Pesorate: Architectural & DevOps Playbook

Welcome, Agent. If you are reading this skill file, you have been instantiated to develop, debug, or maintain the **OFW Pesorate** platform. This document contains the collective operational intelligence, hard-learned lessons, and systemic rules for this repository. 

**Adhere strictly to the Do's and Don'ts outlined below.**

---

## 1. System Architecture

The OFW Pesorate platform is a "Zero-Cost, High-Availability" currency conversion dashboard heavily utilizing the Cloudflare ecosystem.

### Core Stack
- **Frontend Core**: Vanilla JS (`public/app.js`), HTML5 (`public/index.html`), Vanilla CSS for premium Glassmorphism design aesthetics.
- **Backend / Edge**: Cloudflare Pages Functions (`functions/api/*`). Logic executes directly on the CDN edge via V8 isolates.
- **Database**: Cloudflare D1 (SQLite) bound via `wrangler.toml` as `env.DB`.
- **Data Source**: Fixer.io API (via background CRON syncs).

### The "Single Source of Math" Principle
Never calculate currency conversions on the frontend. 
All exchange rates are retrieved from Fixer.io in `EUR` base, stored in D1 (`rates_cache`), and mathematically transformed in `functions/api/rate.js` before being served to the client. The frontend only consumes and displays pre-calculated JSON endpoints.

---

## 2. DevSecOps & CI/CD Pipeline

We utilize a multi-staged, **Self-Healing Automation System** via GitHub Actions.

### Deployment Flow (`.github/workflows/deploy.yml`)
1. **Preview Tier**: Code is first pushed to a hidden Cloudflare Page preview URL automatically.
2. **Puppeteer Headless Tests**: The `scripts/health_check.js` script launches a Chromium instance and hits the Preview URL.
3. **Geo-Spoofing Headers**: Puppeteer injects `X-Test-Country` (e.g., `MY`, `SG`, `PH`) and `X-Test-Token`. The `rate.js` edge worker is strictly programmed to respect this header during CI, acting precisely as if the user is in Malaysia or Singapore.
4. **Promotion**: *Only* if Puppeteer verifies the DOM has actually rendered a real exchange rate (ensuring no JS crashes), the pipeline promotes the code to the live `production` branch.
5. **Cache Invalidation**: The pipeline triggers `scripts/purge_cache.js` to dump the Cloudflare edge cache automatically.

### Continuous Monitoring (`.github/workflows/monitor.yml`)
- A CRON job runs `health_check.js` against the live production URL every 15 minutes.
- **Tier 1 Healing (Anomaly Response)**: If the DOM is blank or returns a 500 error, the pipeline immediately purges the Cloudflare Cache. Browser API responses occasionally get stuck in `304 Not Modified` loops; purging fixes edge desyncs.

---

## 3. Incident Post-Mortems

### Incident: The "Malaysia Blank Page"
- **Symptoms**: Users in Malaysia using older in-app WebViews (Grab, Facebook, Shopee browsers) reported a completely blank white screen. 
- **Root Cause**: The application initialized a `crypto.randomUUID()` call early in the bootstrap sequence. This modern API is not supported in non-secure-context older WebViews, causing a silent runtime crash. Because the main UI containers (`#dashboard`, `#first-visit`) were styled as `display: none` by default, the crash halted the CSS `classList.remove('hidden')` logic, leaving the page blank forever.
- **Resolution**:
    1. Built a mathematical pseudo-random fallback generator for `generateUUID()`.
    2. Wrapped the bootloader in `try/catch`.
    3. **Architectural Shift**: Replaced `display: none` defaults with a visible "Loading Skeleton" (`#app-boot-loading`). The page now gracefully degrades to a loading spinner or an `window.onerror` "Oops" screen instead of a blank void.

---

## 4. Agent Operational Directives (Do's & Don'ts)

### ✅ DO:
1. **Prioritize Aesthetics**: Maintain the premium Glassmorphism design. Never use basic red/blue/green colors. Rely on the predefined variables or rich gradients.
2. **Defensive Programming**: Wrap new JS initialization logic in `try/catch` blocks. The frontend runs on highly fragmented mobile devices across Southeast Asia and the Middle East.
3. **Test with the CDN in mind**: Remember that API responses will be aggressively cached. Ensure any sensitive or user-specific endpoints emit `Cache-Control: no-store, no-cache, must-revalidate`.
4. **Use Puppeteer**: If you edit frontend layout ID names (like `#rate-value`), you MUST update `scripts/health_check.js`, or the CI/CD pipeline will permanently block all future deployments.

### ❌ DON'T:
1. **Don't Push Straight to `production`**: If you must manually invoke `wrangler pages deploy`, do *not* skip the preview stage unless it's a critical production outage fix.
2. **Don't Alter the Math Engine**: `functions/api/rates.js` and the `calculateRate()` function represent a mathematically verified, unified matrix. Do not introduce new mathematical constants or rounding logic outside of this centralized file.
3. **Don't Forget Fallbacks**: If you use modern ES6/ES8 APIs (like `IntersectionObserver`, `crypto`, `Intl`), immediately consider if a polyfill or fallback is necessary for older Android default browsers.
4. **Don't use `process.env` in Client JS**: Environment variables in Cloudflare are injected at the Worker/Pages Function level, not compiled into the static JS bundle.
