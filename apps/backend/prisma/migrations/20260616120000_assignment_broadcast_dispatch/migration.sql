-- Broadcast dispatch: a booking is offered to ALL eligible providers at once (first to accept
-- wins) so every qualified partner sees the request. This removes the single-offer-per-job
-- constraint that previously allowed only one outstanding SENT attempt per assignment job.
DROP INDEX IF EXISTS assignment_attempts_one_sent_per_job;
