const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next dev disposes inactive pages after 60s and keeps only 2. A 50-minute Playwright
  // run then times out recompiling app/layout.js (ChunkLoadError). Production ignores this.
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 50,
  },
  // Lets a production build be produced into a separate folder while `next dev` holds `.next`
  // (measuring prod navigation without disturbing a running dev server). No-op when unset.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  outputFileTracingRoot: path.join(__dirname, "../../"),
  allowedDevOrigins: ["127.0.0.1", "localhost", "10.*.*.*", "172.*.*.*", "192.168.*.*"],
  // Same-origin API proxy (see apps/web/next.config.js): browser calls `/api/*` on this
  // app's own origin → Next forwards to the backend server-side. Kills cross-origin/CORS/PNA
  // "Failed to fetch" on localhost and LAN. Production: set NEXT_PUBLIC_API_URL to skip it.
  async rewrites() {
    // A production build without a backend variable would proxy to localhost: say so in the build
    // log. `npm run build:release` refuses it outright (scripts/release-env.cjs).
    if (process.env.NODE_ENV === "production") {
      const { checkReleaseEnv } = require("./scripts/release-env.cjs");
      for (const e of checkReleaseEnv(process.env).errors) console.warn(`[release-env] warning: ${e}`);
    }
    const backend = (process.env.BACKEND_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

module.exports = nextConfig;
