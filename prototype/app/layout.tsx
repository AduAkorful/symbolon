import type { Metadata } from "next";
import { Geist_Mono, Libre_Caslon_Display, Schibsted_Grotesk } from "next/font/google";
import { NotifyProvider } from "@/components/notify";
import { ProfileProvider } from "@/components/profile";
import "./globals.css";

const caslon = Libre_Caslon_Display({ weight: "400", subsets: ["latin"], variable: "--font-caslon" });
const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Symbolon prototype",
  description: "Clickable motion prototype. Demo data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${caslon.variable} ${schibsted.variable} ${geistMono.variable}`}>
      <body>
        <ProfileProvider>
          <NotifyProvider>{children}</NotifyProvider>
        </ProfileProvider>
      </body>
    </html>
  );
}
