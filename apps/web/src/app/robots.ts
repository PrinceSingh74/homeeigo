import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/profile",
          "/wallet",
          "/bookings",
          "/book",
          "/settings",
          "/notifications",
          "/referrals",
          "/membership",
          "/verify-email",
          "/verify-otp",
          "/reset-password",
          "/forgot-password",
          "/auth/",
          "/ai",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
