# Lighthouse Enterprise Report

**Measurement tool:** Lighthouse CLI (headless Chrome)  
**Evidence files:** `measurements/lighthouse-*.json`

---

## Admin Panel — Desktop (`http://localhost:3003/`)

| Metric | Value | Target | Status | Evidence |
|--------|-------|--------|--------|----------|
| **FCP** | 274 ms | <1200 ms | **PASS** | `lighthouse-admin-desktop.json` fetchTime `2026-06-14T20:46:32.181Z` |
| **LCP** | 818 ms | <2500 ms | **PASS** | same file, score 0.98 |
| **CLS** | 0 | <0.1 | **PASS** | same file |
| **TTFB** | 28 ms | — | **PASS** | audit `server-response-time` |
| **TBT** | 50 ms | — | **PASS** | same file |
| **INP** | not measured | <200 ms | **NOT MEASURED** | no interaction trace |
| **Performance score** | 100 | — | **PASS** | `categories.performance.score: 1` |

---

## Admin Panel — Mobile (`http://localhost:3003/`)

| Metric | Value | Target | Status | Evidence |
|--------|-------|--------|--------|----------|
| **FCP** | 805 ms | <1200 ms | **PASS** | `lighthouse-admin-mobile.json` fetchTime `2026-06-14T20:46:58.901Z` |
| **LCP** | **2890 ms** | <2500 ms | **FAIL** | same file, score 0.81 |
| **CLS** | 0 | <0.1 | **PASS** | same file |
| **TTFB** | 14 ms | — | **PASS** | same file |
| **TBT** | 419 ms | — | **FAIL** | score 0.66 |
| **INP** | not measured | <200 ms | **NOT MEASURED** | — |
| **Performance score** | 85 | — | **PARTIAL** | `categories.performance.score: 0.85` |

---

## Customer Web — Static Route Proxy (`http://localhost:3015/legal/privacy`)

*Homepage Lighthouse blocked by prod server issues; lightest static route measured as proxy.*

| Metric | Value | Target | Status | Evidence |
|--------|-------|--------|--------|----------|
| **FCP** | 463 ms | <1200 ms | **PASS** | `lighthouse-web-legal-desktop.json` fetchTime `2026-06-14T20:47:29.092Z` |
| **LCP** | 713 ms | <2500 ms | **PASS** | same file |
| **CLS** | 0 | <0.1 | **PASS** | same file |
| **TTFB** | 243 ms | — | **PASS** | same file |
| **TBT** | 0 ms | — | **PASS** | same file |
| **INP** | not measured | <200 ms | **NOT MEASURED** | — |
| **Performance score** | 100 | — | **PASS** | same file |

---

## Customer Homepage (`/`)

| Metric | Status | Reason |
|--------|--------|--------|
| All vitals | **NOT MEASURED** | Prod server on `:3015` returned 500 for `/` during TTFB probe (`enterprise-performance-data.json`) |

---

## Summary

| Route | Desktop | Mobile |
|-------|---------|--------|
| Admin `/` | **PASS** (LCP 818ms) | **FAIL** (LCP 2890ms) |
| Customer `/legal/privacy` | **PASS** | **NOT MEASURED** |
| Customer `/` | **NOT MEASURED** | **NOT MEASURED** |
