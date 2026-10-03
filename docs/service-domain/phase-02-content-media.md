# Phase 02 — Service content + media

Status: **PASS**, with the scope notes below (2026-09-21).

## Content model

Content stays in the existing validated structures, per the Phase 00 decision. No giant untyped blob and no second content table:

| Content | Where | Validation |
|---|---|---|
| short description | `services.description` | required on create; must not be blank when going LIVE (`CONTENT_DESCRIPTION_MISSING`) |
| long description | `services.detailed_description` | optional |
| title | `services.name` / `display_name` | must not be blank when LIVE (`CONTENT_TITLE_MISSING`, applies to grandfathered rows too) |
| included / excluded | `services.included_services` / `excluded_services` | ≤ 20 × 300 chars (route schema) |
| customer summary, value proposition, highlights, process | `catalog_config.content` (existing) | zod, bounded |
| key benefits, limitations, important notes, customer disclosures | `catalog_config.content` (**new**) | zod: ≤ 12 × 200, ≤ 15 × 300, ≤ 15 × 300, ≤ 10 × 500; no empty strings |

The content lists are ordered arrays inside a strict zod schema, so ordering is preserved and oversized or empty content is rejected. Localization is not implemented anywhere in this codebase, so it is not introduced here.

**Content requiredness is phase-aware.** A LIVE service needs a title and a description. Scope lists are not required, because the customer page already has an approved, non-fabricated fallback ("Details will be confirmed during booking"), which is existing product policy.

## Customer detail sections

`GET /api/services/:id` now returns a customer-safe `content` block: summary, valueProposition, highlights, keyBenefits, included, excluded, limitations, importantNotes, customerDisclosures and media.

The web detail page (`ServiceDetail.tsx`) renders:
- **Overview** (+ value proposition)
- **What you get** (highlights + benefits; hidden when none)
- **Choose your option**
- **Scope** (included / not included, then limitations, notes and a verbatim "Please read before booking" disclosure box)
- materials, add-ons, availability, preparation and FAQ (unchanged)

The loading, error, unavailable and coming-soon states already exist (`DetailSkeleton`, `CatalogError`, `ServiceEmptyState`, `ComingSoonDetail`). Paused and archived services now return 404 from the API, which lands on "Service unavailable". Verified in a headless browser on the isolated dev server: no console errors, no internal fields in the page text.

## Media

The storage architecture is unchanged: media are **URL references** in `services.thumbnail` / `images[]` / `icon` and `catalog_config.video` / `media`. There is no upload endpoint for service media and none was invented.

| Media field | Location |
|---|---|
| thumbnail, gallery (`images[]`) | columns (existing) |
| icon | column (URL or icon token) |
| hero image, hero video, instructional, before/after pairs, documents (label + url) | `catalog_config.media` (new fields) |

Safety: every media reference must be `https://…` or a site-relative `/path`. `javascript:`, `data:`, `http:`, `ftp:` and protocol-relative `//host` are refused:
- zod `mediaUrl` for config media;
- `INVALID_MEDIA` for column media on admin writes.

Private media and signed URLs do not apply, because no private service media exists. The existing rating-photo upload route is untouched.

## Admin

The editor (`ServiceConfigEditor.tsx`) gained key benefits, limitations, important notes, disclosures and hero image. It shows:
- validation errors (`role="alert"`)
- an unsaved-changes indicator, a `beforeunload` guard, and a confirm before switching or closing a dirty form
- the service code, version and last-updated time
- lifecycle state, allowed transitions and the published version history

**Defect fixed:** the editor rebuilt `catalogConfig` from `{}` on every save, which wiped coverage, materials, equipment, variant inclusions and quantity overrides, add-on compatibility and payment timing. It now merges onto the stored document (by id for variants and add-ons). This is proven by `admin-panel/src/components/services/__tests__/service-config-editor.test.ts`, whose reintroduction proof fails with the old behaviour and passes restored.

Preview is the customer page itself; no separate preview renderer was added. The editor has no draft/publish split beyond lifecycle, because there is no draft-content storage in the architecture.

## Partner projection

Partners receive no marketing content, SEO fields or notes. The leak guard covers `seo*`, `operationsNotes`, `ownerTeam`, `catalogConfig`.

## Tests

- `service-selection-resolver.test.ts`: media URL safety, oversized and empty content.
- `service-identity-lifecycle.test.ts`: content gate.
- `service-domain-foundation.integration.test.ts`: `INVALID_MEDIA` over HTTP; a live service cannot lose its description.
- Reintroduction proof P6: removing `contentIssues` from the gate fails 3 tests, and restoring passes.
