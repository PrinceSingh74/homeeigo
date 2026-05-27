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
};

module.exports = nextConfig;
