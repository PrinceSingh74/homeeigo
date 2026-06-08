import { config } from "dotenv";
import { resolve } from "node:path";

/** Override stale shell DATABASE_URL so local .env always wins in dev. */
config({ path: resolve(import.meta.dir, "../.env"), override: true });
