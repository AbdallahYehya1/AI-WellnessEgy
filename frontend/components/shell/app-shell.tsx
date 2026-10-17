import Link from "next/link";
import type { ReactNode } from "react";

import { ChartIcon, ChatIcon, HeartIcon, HomeIcon, LogoMark, SettingsIcon } from "@/components/shell/icons";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { signOut } from "@/lib/auth/actions";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

export type Section = "home" | "check-in" | "history" | "chat" | "settings";

type Props = {
  current: Section;
  locale: Locale;
  t: Messages;
  /** Show the Assistant entry only when the server reports chat as enabled. */
  chatEnabled: boolean;
  children: ReactNode;
  /** Full-height layouts (chat) manage their own scrolling. */
  fullHeight?: boolean;
};

/**
 * Signed-in layout: skip link, top bar (brand, desktop navigation, language,
 * sign-out) and a bottom tab bar on phones and tablets (below 1024px). Logical properties
 * (ms/me/ps/pe, start/end) keep it correct in both RTL and LTR.
 */
export function AppShell({ current, locale, t, chatEnabled, children, fullHeight = false }: Props) {
  const items: { section: Section; href: string; label: string; icon: ReactNode }[] = [
    { section: "home", href: "/dashboard", label: t.nav.home, icon: <HomeIcon /> },
    { section: "check-in", href: "/check-in", label: t.nav.checkIn, icon: <HeartIcon /> },
    { section: "history", href: "/history", label: t.nav.history, icon: <ChartIcon /> },
    ...(chatEnabled
      ? [{ section: "chat" as const, href: "/chat", label: t.nav.assistant, icon: <ChatIcon /> }]
      : []),
    { section: "settings", href: "/settings", label: t.nav.settings, icon: <SettingsIcon /> },
  ];

  return (
    <div className={`flex flex-col ${fullHeight ? "h-dvh" : "min-h-dvh"}`}>
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t.common.skipToContent}
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4">
          <Link href="/dashboard" className="flex min-h-11 shrink-0 items-center gap-2 font-bold">
            <LogoMark />
            <span lang="en" dir="ltr" className="whitespace-nowrap">
              {t.app.name}
            </span>
          </Link>
          <nav aria-label={t.nav.label} className="ms-4 hidden lg:block">
            <ul className="flex items-center gap-1">
              {items.map((item) => (
                <li key={item.section}>
                  <Link
                    href={item.href}
                    aria-current={item.section === current ? "page" : undefined}
                    className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-ink-muted hover:bg-surface-muted hover:text-ink aria-[current=page]:bg-surface-muted aria-[current=page]:text-primary-strong"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <LanguageSwitch locale={locale} t={t} />
            {/* Below the desktop breakpoint sign-out lives in Settings, keeping this bar uncluttered. */}
            <form action={signOut} className="hidden lg:block">
              <button
                type="submit"
                className="inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                {t.common.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={
          fullHeight
            ? "mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pb-20 lg:pb-4"
            : "mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 pb-28 lg:pb-12"
        }
      >
        {children}
      </main>

      <nav
        aria-label={t.nav.label}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((item) => (
            <li key={item.section}>
              <Link
                href={item.href}
                aria-current={item.section === current ? "page" : undefined}
                className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-ink-muted aria-[current=page]:text-primary-strong"
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
