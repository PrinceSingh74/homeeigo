-- Journal entry numbering: replace count()+1 (collision-prone after deletes,
-- race-prone under concurrency) with an atomic Postgres sequence.
-- Seed the sequence above the current max so existing numbers never repeat.

CREATE SEQUENCE IF NOT EXISTS journal_entry_number_seq;

SELECT setval(
  'journal_entry_number_seq',
  GREATEST(
    COALESCE(
      (SELECT MAX(CAST(SUBSTRING(entry_number FROM 'JE-([0-9]+)') AS BIGINT)) FROM journal_entries),
      0
    ),
    1
  )
);
