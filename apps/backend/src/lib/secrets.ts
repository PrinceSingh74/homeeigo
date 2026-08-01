/**
 * Secret loading for production (Phase 2 — Google Secret Manager).
 *
 * Default (dev/local): NO-OP — secrets come from `.env` exactly as before.
 * Production: set `SECRETS_SOURCE=gsm` + `GCP_PROJECT_ID` and the listed secrets are pulled from
 * Google Secret Manager at boot and injected into `process.env` (only if not already set, so an
 * explicit env override still wins). Fail-safe: if the SDK is absent or a fetch fails, it logs and
 * falls back to whatever is in the environment — boot never hard-fails on the secret backend.
 *
 * Migrate secrets once with:
 *   echo -n "$VALUE" | gcloud secrets create JWT_SECRET --data-file=- --replication-policy=automatic
 * Grant the Cloud Run / GKE service account `roles/secretmanager.secretAccessor`.
 * Rotation: add a new version (`gcloud secrets versions add NAME --data-file=-`); the loader reads
 * `versions/latest`, so a rolling restart picks it up. Access is audited via Cloud Audit Logs.
 */

/** The sensitive keys that must come from Secret Manager in production (never baked into an image). */
export const MANAGED_SECRETS = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "PII_MASTER_KEY",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "SENTRY_DSN",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "WEATHER_API_KEY",
  "GOOGLE_MAPS_API_KEY",
] as const;

type SmClient = {
  accessSecretVersion: (req: { name: string }) => Promise<[{ payload?: { data?: Uint8Array | string | null } }]>;
};

export async function loadSecretsFromManager(): Promise<void> {
  if (process.env.SECRETS_SOURCE !== "gsm") return; // dev/local: .env mode, unchanged
  const project = process.env.GCP_PROJECT_ID;
  if (!project) {
    console.warn("[secrets] SECRETS_SOURCE=gsm but GCP_PROJECT_ID unset — falling back to env");
    return;
  }

  let client: SmClient;
  try {
    // Optional dependency: load via a computed specifier so it's only required in production and
    // doesn't have to be installed (or type-resolved) in dev/local builds.
    const pkg = "@google-cloud/secret-manager";
    const mod = (await import(/* @vite-ignore */ pkg)) as {
      SecretManagerServiceClient: new () => SmClient;
    };
    client = new mod.SecretManagerServiceClient();
  } catch {
    console.error("[secrets] @google-cloud/secret-manager not installed — staying on env");
    return;
  }

  let loaded = 0;
  await Promise.all(
    MANAGED_SECRETS.map(async (key) => {
      if (process.env[key]) return; // explicit env override wins
      try {
        const [res] = await client.accessSecretVersion({
          name: `projects/${project}/secrets/${key}/versions/latest`,
        });
        const data = res.payload?.data;
        if (data) {
          process.env[key] = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
          loaded++;
        }
      } catch {
        // Missing/inaccessible secret → leave to env; surfaced by the config validator at boot.
      }
    }),
  );
  console.log(`[secrets] loaded ${loaded}/${MANAGED_SECRETS.length} from Secret Manager (project ${project})`);
}
