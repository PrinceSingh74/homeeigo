const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // framer-motion must not be tree-shaken here — breaks hydration / motion on homepage
    optimizePackageImports: ["lucide-react"],
  },
  // Monorepo: pin file-tracing root to the homigo project (silences the
  // multiple-lockfile workspace-root warning).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "via.placeholder.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
    ],
  },
};

module.exports = nextConfig;
