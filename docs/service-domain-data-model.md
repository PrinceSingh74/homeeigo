# Service domain data model

Implemented schema (Prisma: `apps/backend/prisma/schema.prisma`).

## `services`

Existing columns are unchanged. Additive columns:

| Column | Type | Meaning |
|--------|------|---------|
| `service_code` | text unique | Operator code; backfilled from `slug` |
| `display_name` | text | Customer-facing name; backfilled from `name` |
| `capability_profile` | enum | `GENERAL` / `CLEANING` / `BEAUTY` / `REPAIR` / … inferred from `category` on migrate |
| `lifecycle_status` | enum | `ACTIVE` if `is_active`, else `PAUSED` (coming soon → `PUBLISHED`) |
| `config_status` | enum | `READY` / `COMING_SOON` / `PAUSED` / `CONFIGURATION_REQUIRED` |
| `is_customer_visible` | boolean | Synced with `is_active` |
| `is_bookable` | boolean | False when paused or coming soon |
| `version` | int | Bumped when an active service’s config is published |
| `owner_team`, `operations_notes` | text | Admin-only |
| `published_at`, `published_by`, `created_by`, `updated_by`, `last_reviewed_at` | timestamps / text | Audit metadata |

`catalog_config` JSONB remains the typed configuration document (Zod `serviceCatalogConfigSchema`). Variant/add-on rows hydrate into that document at quote/book/detail time.

## `service_variants` / `service_addons`

Queryable options. Unique `(service_id, code)`. `code` is the id the client sends. Prices here feed `resolveSelection` after hydrate — not a second pricing engine. Backfill copies existing JSON; unknown facts are not invented.

## `service_categories`

Lookup of distinct `services.category` strings. Public URLs still use the string column.

## `service_config_versions`

Immutable published snapshot of `catalog_config` per `(service_id, version)`.

## `bookings`

Additive:

- `service_config_version` — catalogue version at create time
- `service_config_snapshot` — inclusions, policies, duration, variant/quantity identity

Existing `service_selection` and `addons` JSON are unchanged.

## What was not created

- No second `resolveSelection` / quote / booking engine
- No stored rating column (still aggregated from `ratings`)
- No fabricated materials, equipment, certifications, or badges
