const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  outputFileTracingRoot: path.join(__dirname, "../../"),
  allowedDevOrigins: ["10.*.*.*", "172.*.*.*", "192.168.*.*"],
  // Same-origin API proxy (see apps/web/next.config.js): browser calls `/api/*` on this
  // app's own origin → Next forwards to the backend server-side. Kills cross-origin/CORS/PNA
  // "Failed to fetch" on localhost and LAN. Production: set NEXT_PUBLIC_API_URL to skip it.
  async rewrites() {
    const backend = (process.env.BACKEND_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

module.exports = nextConfig;
