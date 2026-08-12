const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Strip console.* from the production bundle (keep error/warn for prod diagnostics). Smaller
  // bundle + no dev-log noise in prod. Safe, non-breaking. (Playbook Phase 2 — applicable item.)
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    // framer-motion must not be tree-shaken here — breaks hydration / motion on homepage
    optimizePackageImports: ["lucide-react"],
    // Route Segment Caching (P1): keep static segments warm in the client router cache so
    // back/forward + tab switches are instant and don't re-hit the server.
    staleTimes: { dynamic: 30, static: 180 },
  },
  // Monorepo: pin file-tracing root to the homigo project (silences the
  // multiple-lockfile workspace-root warning).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Dev/LAN same-origin API proxy. The browser calls `/api/*` on THIS app's own origin
  // (localhost:3001 or the LAN IP), and the Next server forwards it to the backend
  // server-side. This eliminates ALL cross-origin/CORS/Private-Network-Access failures
  // ("Failed to fetch") on localhost AND on phones/tablets over the LAN, because the
  // browser never makes a cross-origin request. WebSockets bypass this and use resolveWsBase().
  // Production: set NEXT_PUBLIC_API_URL to the API domain → the resolver skips the proxy.
  async rewrites() {
    const backend = (process.env.BACKEND_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  images: {
    // Serve modern formats first (P1 asset optimization): AVIF (~50% smaller than JPEG),
    // then WebP, falling back to the original. Next/Image handles responsive srcset + lazy.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "via.placeholder.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
      // Google OAuth profile photos
      { protocol: "https", hostname: "**.googleusercontent.com" },
      // Service/catalog images are admin-curated and can point at any image host
      // (e.g. a vendor's CDN), so allow any HTTPS source. HTTP is intentionally
      // excluded to keep mixed-content out.
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;
