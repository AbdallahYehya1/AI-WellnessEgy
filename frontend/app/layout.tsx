import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";

import { dirFor } from "@/lib/i18n/config";
import { getLocale, getTheme } from "@/lib/i18n/server";

import "./globals.css";

// Downloaded at build time and served from this site: no runtime requests to
// a third-party font service. Covers Arabic and Latin.
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "AI Wellness Egypt",
  description: "An Egyptian Arabic-first digital wellness companion. In development.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={theme} className={plex.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
