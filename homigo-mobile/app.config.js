/**
 * Extends app.json with build-time secrets that must never be committed.
 *
 * The Google Maps SDK key used to live in app.json (and the generated AndroidManifest.xml) and was
 * pushed. It is now read from GOOGLE_MAPS_API_KEY: an EAS secret for cloud builds
 * (`eas secret:create --name GOOGLE_MAPS_API_KEY`), homigo-mobile/.env (git-ignored) locally.
 * Expo loads .env before evaluating this file.
 */
module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    console.warn("[app.config] GOOGLE_MAPS_API_KEY is not set — maps will not render in this build");
    return config;
  }
  return {
    ...config,
    ios: { ...config.ios, config: { ...config.ios?.config, googleMapsApiKey: key } },
    android: { ...config.android, config: { ...config.android?.config, googleMaps: { apiKey: key } } },
  };
};
