-- W2-D3 — a match-score component can now be UNKNOWN.
--
-- Relaxing only: four NOT NULL constraints are dropped. No column is added, removed, retyped or
-- renamed, and no row is touched, so every existing reader and writer keeps working unchanged.
--
-- Why: the matching scorer used to INVENT a value for every signal it had no evidence for — a flat
-- 15/30 rating for fewer than five reviews, a 1/10 completion score for a default 0% rate, and a
-- distance score computed from an invented 15 km. Those inventions were written into this table as
-- though they were measurements. The scorer now excludes a signal it has no evidence for, and this
-- table has to be able to record that the signal was excluded rather than record a fake number.
--
-- NULL here means "no evidence; excluded from the score". It never means zero.

ALTER TABLE "provider_match_scores" ALTER COLUMN "rating_score" DROP NOT NULL;
ALTER TABLE "provider_match_scores" ALTER COLUMN "distance_score" DROP NOT NULL;
ALTER TABLE "provider_match_scores" ALTER COLUMN "response_score" DROP NOT NULL;
ALTER TABLE "provider_match_scores" ALTER COLUMN "completion_score" DROP NOT NULL;
