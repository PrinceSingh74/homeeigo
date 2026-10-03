-- Financial history must not disappear with the row that owns it.
--
-- users → bookings → payments/ratings/cashbacks, users → wallet_transactions, providers →
-- earnings/withdrawals/wallet_transactions are all ON DELETE CASCADE. The application never
-- hard-deletes these (account deletion is a soft delete: users.deleted_at), but a script, a manual
-- statement or a mis-scoped cleanup would silently take payments, wallet movements and earnings with
-- it — the 2026-09-16 incident deleted ~3,939 completed bookings through a CLI against the dev DB.
--
-- A BEFORE DELETE guard refuses to delete a user, provider or booking that still carries money
-- history. It can be lifted ONLY deliberately, per session/transaction:
--     SET LOCAL homigo.allow_financial_purge = 'on';
-- or per database for the disposable test database (scripts/setup-test-db.ts sets it on homigo_test,
-- whose fixtures are created and deleted by design). Nothing here changes any existing FK.
--
-- Hand-scoped and additive: two functions, three triggers. Re-runnable.
CREATE OR REPLACE FUNCTION homigo_financial_purge_allowed() RETURNS boolean AS $$
  SELECT coalesce(current_setting('homigo.allow_financial_purge', true), '') = 'on';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_financial_history_delete() RETURNS trigger AS $$
BEGIN
  IF homigo_financial_purge_allowed() THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'users' THEN
    IF EXISTS (SELECT 1 FROM wallet_transactions WHERE user_id = OLD.id)
       OR EXISTS (SELECT 1 FROM payments WHERE user_id = OLD.id) THEN
      RAISE EXCEPTION 'financial history guard: user % has payment or wallet history — soft-delete instead (deleted_at)', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'providers' THEN
    IF EXISTS (SELECT 1 FROM earnings WHERE provider_id = OLD.id)
       OR EXISTS (SELECT 1 FROM withdrawals WHERE provider_id = OLD.id)
       OR EXISTS (SELECT 1 FROM wallet_transactions WHERE provider_id = OLD.id) THEN
      RAISE EXCEPTION 'financial history guard: provider % has earnings, withdrawals or wallet history', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'bookings' THEN
    IF EXISTS (SELECT 1 FROM payments WHERE booking_id = OLD.id
               AND status::text IN ('SUCCESS','REFUNDING','PARTIALLY_REFUNDED','REFUNDED'))
       OR EXISTS (SELECT 1 FROM earnings WHERE booking_id = OLD.id)
       OR EXISTS (SELECT 1 FROM wallet_transactions WHERE reference_id = OLD.id) THEN
      RAISE EXCEPTION 'financial history guard: booking % has captured payment, earning or wallet movements', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "users_financial_history_guard" ON "users";
CREATE TRIGGER "users_financial_history_guard" BEFORE DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION guard_financial_history_delete();

DROP TRIGGER IF EXISTS "providers_financial_history_guard" ON "providers";
CREATE TRIGGER "providers_financial_history_guard" BEFORE DELETE ON "providers"
  FOR EACH ROW EXECUTE FUNCTION guard_financial_history_delete();

DROP TRIGGER IF EXISTS "bookings_financial_history_guard" ON "bookings";
CREATE TRIGGER "bookings_financial_history_guard" BEFORE DELETE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION guard_financial_history_delete();
