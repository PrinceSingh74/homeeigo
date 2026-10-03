import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * X-56 (emulator, backend request log): opening one job fired ~13 `GET /providers/me/bookings` in a
 * second — the job screen mounted four list queries (open offers with a poll, active, completed, and
 * a 50-row "lookup") next to `GET /api/bookings/:id`, and every booking invalidation refetched all
 * of them. `GET /api/bookings/:id` serves every stage the screen shows (the partner's access rule
 * includes a SENT offer), so the job screen fetches that one row; it only READS the list caches the
 * Requests tab already keeps (first paint, most-advanced merge), and fetches the offer feed only for
 * a job that is still an offer — the feed is the only source of the offer window.
 */
const src = readFileSync(join(import.meta.dirname, "..", "..", "screens", "JobDetailScreen.tsx"), "utf8");

function queryBlock(key: string): string {
  const i = src.indexOf(`queryKey: ["partner", "bookings", "${key}"]`);
  assert.ok(i >= 0, `query "${key}" not found — update this test`);
  const start = src.lastIndexOf("useQuery({", i);
  return src.slice(start, src.indexOf("});", i));
}

test("the job screen does not fetch the active / completed lists — it only reads their caches", () => {
  for (const key of ["active", "completed"]) {
    assert.match(queryBlock(key), /enabled:\s*false/, `${key} list must be cache-only on the job screen`);
  }
});

test("the offer feed is fetched (and polled) only while the job is an offer", () => {
  const block = queryBlock("pending");
  assert.match(block, /enabled:\s*offerFeedNeeded/);
  assert.match(src, /const offerFeedNeeded\s*=\s*detail\.isError \|\| \(detail\.isSuccess && isPendingStatus\(detail\.data/);
});

test("no second, unfiltered booking list is fetched to find one booking", () => {
  assert.doesNotMatch(src, /listBookings\(\{\s*limit:\s*50/);
});
