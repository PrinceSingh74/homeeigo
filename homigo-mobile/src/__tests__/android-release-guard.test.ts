/**
 * Release-build guards for scripts/android-release.cjs (customer app, 2026-10-01): refuse a misleading
 * artefact before building, keep the production Sentry DSN out of internal builds, and detect it in a
 * built bundle.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const release = require("../../scripts/android-release.cjs") as {
  checkAndroidReleaseEnv: (env: Record<string, string | undefined>) => { errors: string[]; warnings: string[] };
  releaseBuildEnv: (env: Record<string, string | undefined>, opts?: { internal?: boolean }) => Record<string, string | undefined>;
  dsnKey: (dsn: string | undefined) => string | null;
  inspectBundle: (bundle: string, o: { dsn?: string; apiUrl?: string }) => { dsnEmbedded: boolean; apiUrlPresent: boolean };
};

const DSN = "https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42";

describe("android release guard", () => {
  it("refuses a missing, local, emulator-host or plain-http API url — before building", () => {
    for (const api of [undefined, "", "http://localhost:3000", "http://10.0.2.2:3100", "https://127.0.0.1", "http://api.example.com"]) {
      expect(release.checkAndroidReleaseEnv({ EXPO_PUBLIC_API_URL: api }).errors.length).toBeGreaterThan(0);
    }
    expect(release.checkAndroidReleaseEnv({ EXPO_PUBLIC_API_URL: "https://api.example.com" }).errors).toEqual([]);
  });

  it("refuses the native E2E switch in a release", () => {
    const r = release.checkAndroidReleaseEnv({ EXPO_PUBLIC_API_URL: "https://api.example.com", EXPO_PUBLIC_E2E_NATIVE: "1" });
    expect(r.errors.join(" ")).toMatch(/E2E_NATIVE/);
  });

  it("never prints a value in its messages", () => {
    const r = release.checkAndroidReleaseEnv({ EXPO_PUBLIC_API_URL: "http://localhost:3000" });
    expect(r.errors.join(" ")).not.toMatch(/localhost:3000/);
  });

  it("an --internal build blanks the DSN with a SET value (an empty one would be refilled from .env)", () => {
    const env = release.releaseBuildEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN }, { internal: true });
    expect(env.EXPO_PUBLIC_SENTRY_DSN).toBe(" ");
    expect(env.SENTRY_DISABLE_AUTO_UPLOAD).toBe("true");
    expect(env.EXPO_NO_METRO_WORKSPACE_ROOT).toBe("1");
    expect(release.releaseBuildEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN }).EXPO_PUBLIC_SENTRY_DSN).toBe(DSN);
  });

  it("detects the DSN key in a bundle and requires the API url as a positive control", () => {
    expect(release.dsnKey(DSN)).toBe("0123456789abcdef0123456789abcdef");
    expect(release.dsnKey(" ")).toBeNull();
    const withDsn = `x="https://api.example.com";y="${DSN}"`;
    expect(release.inspectBundle(withDsn, { dsn: DSN, apiUrl: "https://api.example.com" })).toEqual({ dsnEmbedded: true, apiUrlPresent: true });
    expect(release.inspectBundle('x="https://api.example.com"', { dsn: DSN, apiUrl: "https://api.example.com" })).toEqual({
      dsnEmbedded: false,
      apiUrlPresent: true,
    });
    // A bundle without the API url means the scan (or the build) is broken — never a clean pass.
    expect(release.inspectBundle("", { dsn: DSN, apiUrl: "https://api.example.com" }).apiUrlPresent).toBe(false);
  });
});
