const appJson = require("./app.json");

/**
 * Extends the static app.json with values that must come from the environment.
 *
 * Nothing credential-bearing is committed here. Every value below is read from the environment
 * (a local .env.local for dev, EAS secrets/variables for builds) and simply omitted when absent —
 * an omitted value fails loudly and is easy to diagnose, whereas a fabricated placeholder produces
 * a silently broken build (a blank grey map, crashes reported to the wrong project, or an OTA
 * channel pointing at another app).
 *
 * Required for a real build — see PHASE_8_P1_3.md:
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  Android Maps (iOS uses Apple Maps, no key needed)
 *   EXPO_PUBLIC_SENTRY_DSN           Sentry runtime DSN (partner app's OWN project)
 *   SENTRY_ORG / SENTRY_PROJECT      Build-time source-map upload
 *   EAS_PROJECT_ID                   EAS project identity + OTA update URL
 */
module.exports = () => {
  const expo = { ...appJson.expo };

  // ── Google Maps (Android only) ────────────────────────────────────────────
  // Must be restricted to this app's own package (com.homeeigo.partner) + signing fingerprint.
  // The customer app's key is restricted to a DIFFERENT package and is deliberately not copied.
  // Missing → no key: the Live Map shows its "Map unavailable" fallback (src/lib/maps-availability.ts).
  // Malformed → refuse the build: a bad key would mount a map that fails authorisation at runtime.
  // The message names the variable, never its value.
  const mapsApiKey = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim();
  if (mapsApiKey && !/^AIza[0-9A-Za-z_-]{35}$/.test(mapsApiKey)) {
    throw new Error(
      "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is set but is not a Google API key (expected AIza… 39 characters). " +
        "Unset it to build without a map, or set the Android key restricted to com.homeeigo.partner.",
    );
  }
  if (mapsApiKey) {
    expo.android = {
      ...expo.android,
      config: { ...(expo.android?.config ?? {}), googleMaps: { apiKey: mapsApiKey } },
    };
    expo.ios = {
      ...expo.ios,
      config: { ...(expo.ios?.config ?? {}), googleMapsApiKey: mapsApiKey },
    };
  }

  // ── Sentry ────────────────────────────────────────────────────────────────
  // The plugin handles native wiring + source-map upload at build time. org/project identify the
  // partner app's OWN Sentry project — reusing the customer app's would merge two apps' crash
  // streams into one issue feed. The DSN is a RUNTIME value (EXPO_PUBLIC_SENTRY_DSN), read in
  // src/lib/observability/sentry.ts, never placed here.
  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  if (sentryOrg && sentryProject) {
    expo.plugins = [
      ["@sentry/react-native/expo", { organization: sentryOrg, project: sentryProject }],
      ...(expo.plugins ?? []),
    ];
  }

  // ── EAS project identity + OTA updates ────────────────────────────────────
  // projectId is issued by `eas init`; it is NOT invented here. Without it, EAS build/update
  // commands fail with a clear "run eas init" message rather than building against a wrong id.
  const easProjectId = process.env.EAS_PROJECT_ID;
  if (easProjectId) {
    expo.extra = { ...(expo.extra ?? {}), eas: { projectId: easProjectId } };
    expo.updates = {
      ...(expo.updates ?? {}),
      url: `https://u.expo.dev/${easProjectId}`,
    };
    expo.runtimeVersion = expo.runtimeVersion ?? { policy: "appVersion" };
  }

  return expo;
};
