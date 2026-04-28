# 🔒 OFW PesoRate — Restore Point
**Tag:** `stable/2026-04-28-admin-hardened`
**Commit:** `f64df4c`
**Date:** 2026-04-28 10:50 PHT (UTC+8)
**Deployed:** https://ofwpesorate.madzlab.site

---

> [!CAUTION]
> ## ⛔ READ THIS BEFORE ANY REFACTOR OR REFINEMENT
>
> This is a **production-stable restore point**. Before changing **ANY** file in this project:
> 1. **Review this document first**
> 2. **Check what was stabilized** in the sections below
> 3. **Test in preview** before merging to production
> 4. **Never remove** the patterns documented here without understanding why they exist
>
> To restore to this point at any time:
> ```
> git checkout stable/2026-04-28-admin-hardened
> ```

---

## ✅ What Is Stable At This Restore Point

### 🔐 Security
| File | What Was Secured |
|---|---|
| `functions/api/admin/_auth.js` | Hardcoded master token `ofwAk026` **removed** — auth uses only `CF_ADMIN_TOKEN` env secret |
| `public/admin.html` | Token hint removed from login placeholder |
| `scripts/autonomous_sync.js` | Token removed from URL query string — uses `Authorization: Bearer` header only |
| `scripts/devops_check.js` | Hardcoded fallback token removed |
| `scripts/health_check.js` | Hardcoded fallback token removed |
| `scripts/autonomous_healer.js` | Hardcoded fallback token removed |

> ⚠️ **CF_ADMIN_TOKEN must be set as a Cloudflare Pages secret** — the system will return 401 for all admin endpoints without it.

---

### 🔄 Sync Engine (v4.0.0 Dual-Source)
| File | What Was Fixed |
|---|---|
| `functions/api/admin/sync.js` | **PRIMARY:** `ExchangeRate-API` (open.er-api.com) — free, no key, no rate limits, 166 currencies in 1 call |
| | **FALLBACK:** Twelve Data — only if primary fails |

**Why this matters:** The old engine sent 26 Twelve Data symbols per call = 26 credits, exceeding the 8 credits/minute free-tier limit. This caused `fail_count: 152`, circuit breaker locked for hours, and `API: Down` status permanently.

> ⛔ **DO NOT revert sync.js to Twelve Data as primary** without adding batching logic (max 8 symbols per minute).

---

### 📊 Admin Dashboard
| File | What Was Fixed |
|---|---|
| `functions/api/admin/system.js` | API health thresholds: healthy <3h, degraded <12h, down ≥12h (was 4h/8h) |
| `functions/api/admin/validate.js` | Fixed undeclared `token` variable (was causing ReferenceError on self-heal) |
| `public/admin.html` | Added `#toast-container` div + `.visible` CSS for tooltip + `API`/`DB` status labels |
| `public/admin.js` | Fixed snapshot error handler using `e` outside catch scope |
| `public/admin.js` | Fixed `fetchSocialData()` — was calling unauthenticated `/api/social` (always ERROR) |
| `public/admin.js` | Social data now reads from `cachedMetricsData.socialTraffic` (auth-protected) |
| `public/admin.js` | Removed `Heal Now` CDN purge button (unnecessary) |
| `public/admin.js` | Status bar shows `API` and `DB` labels before health indicator |

---

### ⚙️ GitHub Actions Workflows
| File | What Was Fixed |
|---|---|
| `.github/workflows/daily-sync.yml` | Added `workflow_dispatch` for manual re-trigger |
| `.github/workflows/devops-hourly.yml` | Fixed snapshot step: `CF_ADMIN_TOKEN` env declared BEFORE `run:` (was always empty → 401) |

---

## 🏗️ System Architecture at This Point

```
Sync Engine (v4.0.0)
├── PRIMARY:  ExchangeRate-API (open.er-api.com)
│             └── Free, no key, no rate limits, 166 currencies/call
└── FALLBACK: Twelve Data API
              └── 26 credits/call, 800/day budget, circuit breaker

Auth Layer
└── CF_ADMIN_TOKEN (Cloudflare Pages Secret only — no hardcoded fallback)

Admin Dashboard
├── /api/admin/system   — health, rates, analytics
├── /api/admin/metrics  — trends, social traffic, conversion data
├── /api/admin/sync     — manual rate sync trigger
├── /api/admin/snapshot — EOD trend snapshot
├── /api/admin/cleanup  — 7-day data retention
├── /api/admin/devops   — system health verdict
└── /api/admin/validate — cache consistency checker

GitHub Actions
├── devops-hourly.yml   — runs every hour (sync + snapshot + cleanup)
└── daily-sync.yml      — runs every 2h (sync + snapshot, manual trigger available)
```

---

## 🔑 Required Cloudflare Pages Secrets

These MUST be set for the system to function:

| Secret | Purpose | How to set |
|---|---|---|
| `CF_ADMIN_TOKEN` | Admin dashboard authentication | `npx wrangler pages secret put CF_ADMIN_TOKEN --project-name=ofw-pesorate` |
| `CF_TWELVEDATA_KEY` | Twelve Data fallback API key | `npx wrangler pages secret put CF_TWELVEDATA_KEY --project-name=ofw-pesorate` |

And in GitHub Actions secrets (`Settings → Secrets → Actions`):
- `CF_ADMIN_TOKEN` — same value as above
- `CLOUDFLARE_API_TOKEN` — for deploy workflow
- `CLOUDFLARE_ACCOUNT_ID` — `5197d11c405e6101323daf924df39cfe`

---

## 📋 Pre-Refactor Checklist

Before making ANY changes to the following critical files, review this document:

- [ ] `functions/api/admin/_auth.js` — auth must stay env-only, no hardcoded tokens
- [ ] `functions/api/admin/sync.js` — ExchangeRate-API must remain primary source
- [ ] `functions/api/admin/system.js` — health thresholds must stay at 3h/12h
- [ ] `public/admin.js` — social data source must remain `cachedMetricsData.socialTraffic`
- [ ] `.github/workflows/devops-hourly.yml` — `env:` must be declared BEFORE `run:` in snapshot step
- [ ] Any script in `scripts/` — must NOT contain hardcoded token fallbacks
