import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Symbolon",
    short_name: "Symbolon",
    description: "Payables on Arc: invoices sealed by the vendor, paid from the business's Vault.",
    start_url: "/",
    display: "standalone",
    background_color: "#131A16",
    theme_color: "#131A16",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
