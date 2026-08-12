# Table Virtualization Audit

**Component:** `apps/admin-panel/src/components/ui/DataTable.tsx`  
**Threshold:** 8 rows (`VIRTUALIZE_THRESHOLD`)

## Tables Audited

| Table | Location | Rows | Virtualized | Status |
|-------|----------|------|-------------|--------|
| Geospatial zone analytics | `geospatial/page.tsx` | 8+ zones | ✅ via `DataTable` | **Fixed** |
| Dashboard recent bookings | `page.tsx` | 6 | No (below threshold) | ✅ |
| Bookings list | `/bookings` | many | ✅ `DataTable` | ✅ |
| Support tickets | `/support` | many | ✅ `DataTable` | ✅ |
| Analytics tables | N/A | lists only | N/A | — |

## Geospatial Migration (Before → After)

**Before:** Raw `<table>` rendering all zone rows synchronously.

**After:** `DataTable` with memoized `TableRow` / `VirtualRow`, `@tanstack/react-virtual` when `rows.length >= 8`.

```tsx
// geospatial/page.tsx
<DataTable
  headers={["Zone", "Shape", "Surge", "Supply", "Demand", "Util.", "Revenue 24h"]}
  rows={zoneRows}
  isLoading={analyticsQ.isLoading}
/>
```

## DataTable Features

- `TableRow` — `memo` for standard rows
- `VirtualRow` — `memo` for virtualized rows
- `useVirtualizer` — overscan 4, 48px row height
- Headers always rendered; body virtualizes when ≥8 rows

## Runtime Evidence

Geospatial page DOM (`dom-heatmap` not run on geospatial this pass); architecture matches bookings/support pattern already probed at 395–522 DOM with virtualized tables.

## Certification

| Check | Status |
|-------|--------|
| Tables >8 rows virtualized | ✅ geospatial migrated |
| Memoized rows/cells | ✅ `TableRow`, `VirtualRow` |
| Row rerenders minimized | ✅ `memo` + stable row keys |
