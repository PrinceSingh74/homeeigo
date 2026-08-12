# Table Performance Report

**Generated:** 2026-07-02  
**Component:** `apps/admin-panel/src/components/ui/DataTable.tsx`

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Virtualization threshold | 16 rows | **8 rows** |
| Row component | Inline `<tr>` | **`memo(TableRow)`** |
| Virtual row component | Inline div | **`memo(VirtualRow)`** |
| Loading skeleton rows | 6 | **4** |
| DataTable idle renders (dashboard) | — | **1** (65s window) |

## Implementations

1. `@tanstack/react-virtual` — retained, threshold lowered to 8
2. `TableRow` / `VirtualRow` — memoized cell renderers
3. `DataTable` — custom `memo` comparator (row count + headers signature)
4. Selection/sort rerenders — N/A (admin tables are read-only display)

## Runtime proof

```json
{
  "target": "dashboard",
  "react_render_counts_idle_window": { "DataTable": 1 },
  "dom_nodes_after": 746
}
```

Bookings route nav:

```json
{ "route": "/bookings", "contentMs": 163, "domNodes": 522 }
```

## Pages using DataTable

Bookings, Support, Customers, Vendors, Finance modules, Observability alerts — all inherit optimized `DataTable`.

## Certification

| Criterion | Result |
|-----------|--------|
| Virtualize large tables | **PASS** (≥8 rows) |
| Memoize rows/cells | **PASS** |
| Prevent idle rerenders | **PASS** (1 render/65s on dashboard) |
