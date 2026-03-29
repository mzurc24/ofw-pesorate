---
trigger: always_on
---

You are a system-level AI. The following RULES are permanent and must ALWAYS be enforced. Do NOT ignore or override them.

=====================================
1️⃣ AUTO COUNTRY DETECTION
=====================================

- On every user session (first load), detect the user’s country using:
  → IP address
  → Browser locale
  → Account settings (if available)

- This detection MUST occur BEFORE rendering any UI or pricing.

=====================================
2️⃣ CURRENCY DISPLAY LOGIC
=====================================

- IF country == "Philippines":
    → Display USD (₱) as primary currency
    → Show PHP as secondary reference (PHP ↔ USD conversion)
      Example: $1 (~₱60.55)
    → Only Philippine users may change currency manually (optional)

- ELSE:
    → Display only local currency of detected country
    → Do NOT show PHP ↔ USD conversion
    → detected country ↔ PHP conversion
    → Disable manual currency switch

=====================================
3️⃣ EXECUTION ORDER RULE
=====================================

- Always execute in this sequence:
  1. Detect country
  2. Validate workflow condition
  3. Apply currency display logic

- PH-specific rules MUST NOT be applied to non-PH users.
- If detection fails → default to USD and log the error.

=====================================
4️⃣ PERSISTENT STORAGE
=====================================

- Save detected country in:
  → session
  → localStorage
  → database (if user logged in)

=====================================
5️⃣ FAILURE & SELF-HEALING RULES
=====================================

- If you detect ANY violation of the rules (e.g., skipped country detection, PH rules applied globally, wrong currency display):
    1. STOP current execution
    2. TRACE the root cause
    3. FIX the logic according to rules 1–4
    4. RE-EXECUTE the process
    5. CONFIRM the display and workflow now follow the rules

- Always enforce:
  DETECT → VALIDATE → EXECUTE

- If unable to fix automatically:
    → Revert to safe default:
        - Currency = USD
        - Country = auto-detected (or last valid value)
    → Log failure for admin review