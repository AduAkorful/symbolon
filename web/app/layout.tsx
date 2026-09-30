import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Keep production builds offline and deterministic: these are the brand fonts kept in app/app/fonts (SIL Open Font License 1.1),
// rather than next/font/google fetching from fonts.googleapis.com at build time.
const caslon = localFont({ src: "./fonts/LibreCaslonDisplay-Regular.woff2", variable: "--font-caslon", weight: "400" });
const schibsted = localFont({ src: "./fonts/SchibstedGrotesk.woff2", variable: "--font-schibsted" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://symbolon-app.vercel.app"),
  title: {
    default: "Symbolon — Payables on Arc",
    template: "%s · Symbolon",
  },
  description: "Invoices sealed by the vendor, paid from the business's own Vault on Arc.",
  openGraph: {
    title: "Symbolon — Payables on Arc",
    description: "Invoices sealed by the vendor, paid from the business's own Vault on Arc.",
    siteName: "Symbolon",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Symbolon — Payables on Arc",
    description: "Invoices sealed by the vendor, paid from the business's own Vault on Arc.",
  },
};

// Dark only: tells the browser to draw its own controls and scrollbars dark, and colours the mobile browser bar.
export const viewport: Viewport = { colorScheme: "dark", themeColor: "#131A16" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${caslon.variable} ${schibsted.variable}`}>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-doc focus:bg-ink focus:px-4 focus:py-2 focus:text-paper focus:outline-none focus:ring-2 focus:ring-seal"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
