import Link from "next/link";
import type { ReactNode } from "react";

import { ChartIcon, ChatIcon, HeartIcon, HomeIcon, LogoMark, SettingsIcon, SignOutIcon } from "@/components/shell/icons";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
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
  /** Full-height layouts manage their own scrolling. */
  fullHeight?: boolean;
  /** Full-width, full-height workspace (chat): no page padding, only inner areas scroll. */
  workspace?: boolean;
  /** Wider content column (dashboard, directory, insights). */
  wide?: boolean;
};

/**
 * Signed-in layout: skip link, a glass top bar (brand, pill navigation, theme, language,
 * sign-out) and a glass bottom tab bar on phones and tablets (below 1024px). Logical
 * properties (ms/me/ps/pe, start/end) keep it correct in both RTL and LTR.
 */
export function AppShell({ current, locale, t, chatEnabled, children, fullHeight = false, workspace = false, wide = false }: Props) {
  const items: { section: Section; href: string; label: string; icon: ReactNode }[] = [
    { section: "home", href: "/dashboard", label: t.nav.home, icon: <HomeIcon /> },
    { section: "check-in", href: "/check-in", label: t.nav.checkIn, icon: <HeartIcon /> },
    { section: "history", href: "/history", label: t.nav.history, icon: <ChartIcon /> },
    ...(chatEnabled
      ? [{ section: "chat" as const, href: "/assistants", label: t.nav.assistant, icon: <ChatIcon /> }]
      : []),
    { section: "settings", href: "/settings", label: t.nav.settings, icon: <SettingsIcon /> },
  ];

  return (
    <div className={`relative flex flex-col ${fullHeight || workspace ? "h-dvh overflow-hidden" : "min-h-dvh"}`}>
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t.common.skipToContent}
      </a>

      {!workspace ? (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] overflow-hidden">
          <div className="aurora opacity-60">
            <span />
            <span />
          </div>
        </div>
      ) : null}

      <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
        <div className={`mx-auto flex h-16 items-center gap-3 px-4 sm:px-6 ${workspace ? "max-w-none" : "max-w-6xl"}`}>
          <Link href="/dashboard" className="flex min-h-11 shrink-0 items-center gap-2.5">
            <LogoMark />
            <span lang="en" dir="ltr" className="font-display sr-only whitespace-nowrap text-[1.02rem] font-semibold tracking-tight min-[380px]:not-sr-only">
              {t.app.name}
            </span>
          </Link>
          <nav aria-label={t.nav.label} className="ms-2 hidden lg:block xl:ms-6">
            <ul className="flex items-center gap-1 rounded-full border border-line/70 bg-surface/60 p-1">
              {items.map((item) => (
                <li key={item.section}>
                  <Link
                    href={item.href}
                    aria-current={item.section === current ? "page" : undefined}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-muted transition-all duration-200 hover:text-ink aria-[current=page]:bg-surface aria-[current=page]:text-primary-strong aria-[current=page]:shadow-soft xl:px-3.5 [&>svg]:hidden [&>svg]:h-4 [&>svg]:w-4 xl:[&>svg]:block"
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex items-center gap-0.5">
            <ThemeSwitch t={t} />
            <LanguageSwitch locale={locale} t={t} />
            {/* Below the desktop breakpoint sign-out lives in Settings, keeping this bar uncluttered. */}
            <form action={signOut} className="hidden lg:block">
              <button
                type="submit"
                title={t.common.signOut}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink xl:px-3.5"
              >
                <SignOutIcon className="h-4 w-4" />
                {/* Icon-only between 1024 and 1279px so the bar fits; the name stays for screen readers. */}
                <span className="sr-only xl:not-sr-only">{t.common.signOut}</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        data-chat-main={workspace ? "" : undefined}
        className={
          workspace
            ? "relative flex min-h-0 w-full flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0"
            : fullHeight
              ? "relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pb-20 lg:pb-4"
              : `relative mx-auto w-full flex-1 space-y-8 px-4 py-8 pb-32 sm:px-6 sm:py-10 lg:pb-16 ${wide ? "max-w-6xl" : "max-w-3xl"}`
        }
      >
        {children}
      </main>

      <nav
        aria-label={t.nav.label}
        data-bottom-tabs=""
        className="glass fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg px-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((item) => (
            <li key={item.section}>
              <Link
                href={item.href}
                aria-current={item.section === current ? "page" : undefined}
                className="group flex min-h-[4.25rem] flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold text-ink-muted transition-colors aria-[current=page]:text-primary-strong"
              >
                <span className="flex h-8 w-12 items-center justify-center rounded-full transition-all duration-300 group-aria-[current=page]:bg-primary/12 group-aria-[current=page]:scale-105">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
