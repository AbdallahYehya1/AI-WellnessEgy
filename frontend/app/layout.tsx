import type { Metadata, Viewport } from "next";
import { Alexandria, IBM_Plex_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";

import { dirFor } from "@/lib/i18n/config";
import { getLocale, getTheme } from "@/lib/i18n/server";

import "./globals.css";

// Downloaded at build time and served from this site: no runtime requests to a
// third-party font service. Both cover Arabic and Latin. Alexandria (display) is a
// variable typeface by an Egyptian type designer; IBM Plex Sans Arabic carries body text.
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
  // Not preloaded: body text renders at once in the fallback and swaps when ready, so the
  // eight Plex files don't compete with the display face the headline needs (LCP).
  preload: false,
});
const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-alexandria",
});

export const metadata: Metadata = {
  title: "AI Wellness Egypt",
  description:
    "Ten specialised AI assistants for everyday life in Egypt, in Egyptian Arabic and English. General guidance with sources, not medical, legal or financial advice.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f12" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={theme} className={`${plex.variable} ${alexandria.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
