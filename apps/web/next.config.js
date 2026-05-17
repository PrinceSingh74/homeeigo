const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: pin file-tracing root to the homigo project (silences the
  // multiple-lockfile workspace-root warning).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Allow opening the dev server from other devices on the LAN
  // (phone/tablet). Without this, Next 15 blocks /_next/* assets from
  // non-localhost origins → unstyled page + chunk-load runtime errors.
  // Add your machine's LAN IP(s) here if it changes.
  allowedDevOrigins: [
    "10.21.97.32",
    "10.*.*.*",
    "172.*.*.*",
    "192.168.*.*",
  ],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "via.placeholder.com" }],
  },
};

module.exports = nextConfig;
