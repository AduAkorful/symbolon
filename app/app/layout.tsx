import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Keep production builds offline and deterministic: these are the brand fonts kept in app/app/fonts (SIL Open Font License 1.1),
// rather than next/font/google fetching from fonts.googleapis.com at build time.
const caslon = localFont({ src: "./fonts/LibreCaslonDisplay-Regular.woff2", variable: "--font-caslon", weight: "400" });
const schibsted = localFont({ src: "./fonts/SchibstedGrotesk.woff2", variable: "--font-schibsted" });

export const metadata: Metadata = {
  title: "Symbolon",
  description: "Payables on Arc: invoices sealed by the vendor, paid from the business's Vault.",
};

// Dark only: tells the browser to draw its own controls and scrollbars dark, and colours the mobile browser bar.
export const viewport: Viewport = { colorScheme: "dark", themeColor: "#131A16" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${caslon.variable} ${schibsted.variable}`}>
      <body>{children}</body>
    </html>
  );
}
