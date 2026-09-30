import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://symbolon-app.vercel.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/verify", "/status"],
        disallow: [
          "/business/",
          "/vendor/",
          "/invoice/",
          "/receipt/",
          "/invite/",
          "/join/",
          "/notifications",
          "/profile",
          "/api/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
