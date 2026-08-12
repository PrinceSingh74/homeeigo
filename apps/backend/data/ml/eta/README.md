# HOMIGO ETA ML Dataset

## Source

NCR (Delhi / Gurugram / Noida) dispatch-to-arrival trips, generated deterministically
with seed `20260808`, covering 2024-01-01 to 2024-06-30. Delivered as a bundle of two
data files plus vendor documentation, all copied verbatim from
`C:/Users/Kapiissh Green/Downloads/machine_learning_homigo/`.

## Location

```
apps/backend/data/ml/eta/
├── raw/                                        immutable — as delivered
│   ├── ETA_Training_Data.csv                   ★ CANONICAL — 50,000 rows × 31 cols
│   ├── HOMIGO_ETA_Training_Dataset.xlsx        sample — 5,000 rows (10%) + metadata sheets
│   └── source-docs/                            vendor documentation, verbatim
│       ├── README.txt
│       ├── Feature_Definitions.txt
│       ├── FINAL_SUMMARY.txt
│       └── HOMIGO_ETA_Dataset_Sample.json
├── processed/                                  pipeline-generated artifacts only
├── manifests/
│   └── dataset-version.json                    sha256 + measured stats + discrepancies
└── README.md
```

| File | Role | Rows | SHA256 |
| --- | --- | --- | --- |
| `raw/ETA_Training_Data.csv` | **canonical** | 50,000 | `455b946b…cafadae4` |
| `raw/HOMIGO_ETA_Training_Dataset.xlsx` | sample | 5,000 | `97381e6c…b4ff9b24` |

Use the CSV for anything real. The `.xlsx` is kept only because it carries the
`Data_Dictionary` sheet and because it was the originally supplied artifact.

## Purpose

Candidate ETA model training and experimentation.

This dataset exists to exercise the existing validation, feature-engineering and
warehouse path end to end. It is **not** evidence about production ETA accuracy.

## Data Policy

The raw dataset is immutable.

Never modify the source dataset — no in-place cleaning, no column renames, no row
edits, no flag changes. Any transformation must be generated into `processed/` by
the existing pipeline. `processed/` is never populated by hand.

If a raw file is replaced, regenerate the SHA256 in `manifests/dataset-version.json`
from the new bytes and bump the version.

## ⚠️ The Target Label — read this before training

`actual_travel_duration_sec` = **`arrived_at − en_route_at`**

Verified against all 50,000 rows: **0 mismatches**.

The bundled `source-docs/README.txt` and `source-docs/Feature_Definitions.txt` both
state the label is `arrived_at − dispatched_at`. **That is wrong** — it disagrees with
the actual column on 46,232 of 50,000 rows (92.5%), by up to 288.9 s. Reconstructing
the label from the documented formula produces a different target that wrongly folds in
the dispatch→en-route wait.

Use the column as shipped, or recompute as `arrived_at − en_route_at`. Do not follow
the vendor formula.

## Pipeline

```
Raw Dataset  (raw/ETA_Training_Data.csv)
    ↓
Existing Validation            analytics/eta/validation.ts
    ↓
Existing Feature Engineering   analytics/eta/feature-engineering.ts
    ↓
Existing ETL / BigQuery        analytics/etl/engine.ts → analytics/bigquery/10_phase2_eta_intelligence.sql
    ↓
ETA Training Dataset           BigQuery vw_train_eta
    ↓
Candidate Model                model_eta (BOOSTED_TREE_REGRESSOR)
```

## Existing HOMIGO Components

This directory adds storage and a manifest only. All transformation logic already
exists and must be reused — do not create duplicate implementations:

| Concern | Existing component |
| --- | --- |
| ETA validation | [`analytics/eta/validation.ts`](../../../analytics/eta/validation.ts) |
| ETA feature engineering | [`analytics/eta/feature-engineering.ts`](../../../analytics/eta/feature-engineering.ts) |
| Phase 1 ETL | [`analytics/etl/engine.ts`](../../../analytics/etl/engine.ts), [`analytics/etl/jobs/index.ts`](../../../analytics/etl/jobs/index.ts) |
| BigQuery ETA layers | [`analytics/bigquery/10_phase2_eta_intelligence.sql`](../../../analytics/bigquery/10_phase2_eta_intelligence.sql), [`11_phase2_eta_remediation.sql`](../../../analytics/bigquery/11_phase2_eta_remediation.sql) |
| Feature Store | [`analytics/feature-store/service.ts`](../../../analytics/feature-store/service.ts) |
| MLOps / model registry | [`src/services/mlops.service.ts`](../../../src/services/mlops.service.ts), [`analytics/bigquery/04_mlops.sql`](../../../analytics/bigquery/04_mlops.sql) |
| ETA intelligence service | [`src/services/eta-intelligence.service.ts`](../../../src/services/eta-intelligence.service.ts) |
| Data quality | [`analytics/data-quality/engine.ts`](../../../analytics/data-quality/engine.ts) |
| PII hashing | [`analytics/etl/pii.ts`](../../../analytics/etl/pii.ts) |
| Eligibility contract | [`docs/architecture/eta-training-eligibility-contract.md`](../../../../../docs/architecture/eta-training-eligibility-contract.md) |

## Synthetic Data Policy

**This dataset is 100% synthetic. It is simulation output, not observed production data.**

Measured across all 50,000 canonical rows:

- `is_synthetic = True` on 50,000 / 50,000
- `is_training_eligible = False` on 50,000 / 50,000

Every record is already quarantined under the ETA training-eligibility contract.
Nothing here is eligible for training as-is.

Synthetic data must never be represented as real production data, and the
`is_synthetic` / `is_training_eligible` flags must never be silently changed. Flipping
`is_training_eligible` is a deliberate, reviewable act — not a data-cleaning step.

## Data Quality — measured

Structurally the CSV is clean. What was verified independently:

| Check | Result |
| --- | --- |
| Data rows / columns | 50,000 × 31 |
| Ragged rows | 0 |
| Null or empty cells | 0 (across all 31 columns) |
| Duplicate `trip_id` | 0 |
| Duplicate full rows | 0 |
| Timestamp ordering (`dispatched ≤ en_route ≤ arrived`) | 0 violations |
| Label consistency (`arrived − en_route`) | 50,000 / 50,000 exact |

Vendor distribution claims that **held**: duration mean 1,189 s, P50 1,010 s,
P90 2,213 s, P99 3,928 s; distance mean 4.36 km, P50 4.25 km, P90 6.85 km;
`google_eta` mean 843 s, P90 1,488 s, P99 2,448 s; ETA underprediction 99.0 %
at +346 s mean.

## Known Discrepancies

Full detail under `discrepancies` in `manifests/dataset-version.json`.

| ID | Severity | Status | Summary |
| --- | --- | --- | --- |
| `TARGET_DEFINITION_WRONG_IN_VENDOR_DOCS` | HIGH | OPEN | Docs define the label as `arrived − dispatched`; it is actually `arrived − en_route`. Wrong on 92.5% of rows. |
| `DURATION_MAX_CLAIM_WRONG` | HIGH | OPEN | Docs claim max 4,560 s and mark it "✓ PASS". Measured max 9,889.9 s (2.2×). |
| `DISTANCE_MAX_CLAIM_WRONG` | MEDIUM | OPEN | Docs claim max 24.98 km. Measured max 15.57 km. |
| `ROWCOUNT_MISMATCH` | HIGH | **RESOLVED** | xlsx held 5,000 rows but described 50,000. Full CSV is now canonical. |
| `ORDERING_CLAIM_IMPRECISE` | LOW | OPEN | Claim uses strict `<`; 169 rows have zero dispatch wait. No real violations. |

The vendor's own `Data_Quality` block self-reports "✓ PASS" on all nine checks while
at least two of those checks are demonstrably false against its own data. Treat that
block as unverified; the measured figures in the manifest are authoritative.

## Production Policy

This dataset must **NOT** automatically enable customer-facing ML inference.

Google Maps remains the customer-facing ETA source until a candidate model passes
offline evaluation and explicit promotion approval. Landing these files changes no
runtime behaviour: no model is trained, no model is deployed, `model_eta` is
untouched, and no production configuration is modified.
