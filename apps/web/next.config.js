const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Windows often opens the app as 127.0.0.1 while Next binds to localhost.
  // That mismatch breaks /_next/* (HMR + RSC) and makes tab switches hang.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Lets a production build be produced into a separate folder while `next dev` holds `.next`
  // (measuring prod navigation without disturbing a running dev server). No-op when unset.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
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
    /**
     * NOT enabled: `turbopackPersistentCaching: true`.
     *
     * It is exactly the fix this app wants — the dev server recompiles everything on every restart
     * (warming all 28 routes measured 212s from an empty cache and 218s from a supposedly warm one,
     * i.e. nothing was reused). But on Next 15.5.19 it throws CanaryOnlyError at startup and the dev
     * server does not boot at all. Revisit when this project moves to a Next release that ships it
     * on stable; until then `scripts/dev-warm.mjs` pays the cost in the background instead.
     */
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
  // Legacy / cross-listed service URLs → canonical page, as real 308s from the
  // routing layer (a redirect thrown during render sits inside the app's
  // loading.tsx Suspense boundary and could only produce a 200 + meta refresh).
  // Generated from the taxonomy: bun run scripts/generate-service-redirects.ts
  async redirects() {
    return require("./src/lib/catalog/service-redirects.json").map((r) => ({
      source: r.source,
      destination: r.destination,
      permanent: true,
    }));
  },
  async rewrites() {
    const backend = (process.env.BACKEND_ORIGIN || "http://127.0.0.1:3000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  images: {
    // Serve modern formats first (P1 asset optimization): AVIF (~50% smaller than JPEG),
    // then WebP, falling back to the original. Next/Image handles responsive srcset + lazy.
    formats: ["image/avif", "image/webp"],
    // Next 16 requires every `quality` passed to next/image to be listed. 75 is the
    // framework default; 90/92/95 are used by catalog tiles and the AI hero.
    qualities: [75, 90, 92, 95],
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
