# Google Maps Live Certification

**Date:** 2026-06-14 · **STATUS: BLOCKED — keys not present. NOT FAKED.**

## Key check (execution)
- `apps/backend/.env` → `GOOGLE_MAPS_API_KEY` lines = **0** (not set).
- `apps/web/.env.local` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` = **0** (not set).

Per mission rule: keys missing ⇒ **BLOCKED**, no fabricated PASS. Live Autocomplete / Geocoding / Reverse-geocode / Directions / Distance-Matrix / Traffic-ETA **cannot be certified** without the key.

## What IS verified (no key)
- Integration code present + audited (`google-maps-enterprise-audit.md`).
- Graceful fallback live: ETA→haversine, geocode→null, autocomplete→[] (no fake data).
- Customer/partner/admin maps render real coordinates via normalized scatter / embed-when-keyed.

## To unblock
Set both keys (GCP referrer/IP restrictions + quota caps + billing alerts), then re-run `maps.service` checks → expect `source:"google"` ETAs + non-null geocode. Then this doc flips to PASS.
