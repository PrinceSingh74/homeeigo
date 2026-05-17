const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: pin file-tracing root to the homigo project (silences the
  // multiple-lockfile workspace-root warning).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "via.placeholder.com" }],
  },
};

module.exports = nextConfig;
