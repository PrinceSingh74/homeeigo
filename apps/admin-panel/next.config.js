const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow dev assets when opening admin via LAN IP (e.g. http://10.71.97.32:3003).
  allowedDevOrigins: ["10.*.*.*", "172.*.*.*", "192.168.*.*"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Same-origin API proxy (see apps/web/next.config.js): browser calls `/api/*` on this
  // app's own origin → Next forwards to the backend server-side. Kills cross-origin/CORS/PNA
  // "Failed to fetch" on localhost and LAN. Production: set NEXT_PUBLIC_API_URL to skip it.
  async rewrites() {
    const backend = (process.env.BACKEND_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

module.exports = nextConfig;
