# ETA 50K — Dataset Quality Report

- **Source** `raw/ETA_Training_Data.csv`
- **SHA256** `455b946bfdc77e06ba25b5cff9f28f2f7811c3ec85a6975c066e3f6ccafadae4`
- **Rows** 50,000 · **Columns** 31
- **Null cells** 0 · **Duplicate trip_ids** 0 · **Duplicate rows** 0
- **Timestamp ordering violations** 0
- **Range** 2024-01-01T06:00:42 → 2024-06-28T22:22:07

## Target verification (independent)

- `arrived_at - en_route_at` matches **50,000/50,000** rows
- `arrived_at - dispatched_at` matches **169/50,000** rows
- Vendor documentation claims the dispatch formula — **WRONG**
- Using the wrong anchor would add a mean **17.42s** of dispatch wait
- min 60.0 · median 1010.2 · mean 1189.1 · P90 2212.9 · P95 2739.7 · P99 3928.5 · max 9889.9
- Contract window [60, 14400]s → below 0, above 0, **no clamping applied**

## Split

- train 35,000 (2024-01-01 → 2024-05-06)
- validation 7,500 (2024-05-06 → 2024-06-02)
- test 7,500 (2024-06-02 → 2024-06-28)

## Leakage

- 19 features admitted, 12 excluded
- Excluded: actual_travel_duration_sec, arrival_source, arrived_at, dispatched_at, en_route_at, google_eta_captured_at, is_synthetic, is_training_eligible, quality_score, trip_id, validation_flags, validation_status
