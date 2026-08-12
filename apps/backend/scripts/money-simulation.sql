-- Money simulation: N transactions, trigger-enforced paise dual-write.
-- Usage: psql -v sim_rows=1000000 -f money-simulation.sql
\set sim_rows :sim_rows

DROP TABLE IF EXISTS money_sim;
CREATE TABLE money_sim (
  id BIGSERIAL PRIMARY KEY,
  amount DOUBLE PRECISION NOT NULL,
  amount_paise BIGINT
);

CREATE OR REPLACE FUNCTION sync_money_sim_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := money_to_paise(NEW.amount);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_money_sim BEFORE INSERT OR UPDATE ON money_sim
  FOR EACH ROW EXECUTE FUNCTION sync_money_sim_paise();

\timing on
INSERT INTO money_sim(amount)
SELECT round((random() * 99999)::numeric, 2)::double precision
FROM generate_series(1, :sim_rows);
\timing off

-- 1. Row-level drift: paise column vs exact conversion. Expected 0.
SELECT COUNT(*) AS row_level_drift
FROM money_sim
WHERE amount_paise IS DISTINCT FROM money_to_paise(amount);

-- 2. Aggregate drift: float SUM (converted) vs exact paise SUM.
--    Non-zero value here is precisely the float error the migration eliminates.
SELECT
  ROUND(SUM(amount)::numeric * 100) AS float_sum_as_paise,
  SUM(amount_paise) AS exact_paise_sum,
  ROUND(SUM(amount)::numeric * 100) - SUM(amount_paise) AS float_aggregate_drift_paise
FROM money_sim;

-- 3. Paise arithmetic determinism: re-sum in reverse order — BIGINT is order-independent.
SELECT
  (SELECT SUM(amount_paise) FROM (SELECT amount_paise FROM money_sim ORDER BY id ASC) a)
  -
  (SELECT SUM(amount_paise) FROM (SELECT amount_paise FROM money_sim ORDER BY id DESC) b)
  AS paise_order_dependence;

DROP TABLE money_sim;
