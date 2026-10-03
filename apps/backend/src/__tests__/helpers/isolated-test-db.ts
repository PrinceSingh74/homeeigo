/**
 * Isolation guard for integration tests.
 *
 * Historical suites hard-coded `homigo_p39` (a local schema clone). CI and `bun test`
 * use `homigo_test`. Both names are isolated; `homigo_db` / production names are not.
 */
export function isIsolatedTestDatabase(db: string): boolean {
  return /test/i.test(db) || db === "homigo_p39";
}

export function refuseIfNotIsolatedTestDb(db: string): void {
  if (!isIsolatedTestDatabase(db)) {
    throw new Error(
      `REFUSING TO RUN: connected to ${db}, not an isolated test database (homigo_test / homigo_p39)`,
    );
  }
}
