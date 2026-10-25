import Link from "next/link";
import type { ReactNode } from "react";

import { LogoMark, ShieldIcon, SparkIcon } from "@/components/shell/icons";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

/**
 * Layout for signed-out pages. Forms get a split layout on large screens: the form card
 * on one side and a calm brand panel on the other; phones get the card alone.
 */
export function PublicShell({
  locale,
  t,
  title,
  children,
  wide = false,
  bare = false,
}: {
  locale: Locale;
  t: Messages;
  title?: string;
  children: ReactNode;
  wide?: boolean;
  /** No main wrapper styling at all (the landing page lays itself out). */
  bare?: boolean;
}) {
  const p = t.v2.publicPanel;
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t.common.skipToContent}
      </a>
      {!bare ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="aurora">
            <span />
            <span />
            <span />
          </div>
          <div className="dot-grid absolute inset-0 opacity-60" />
        </div>
      ) : null}
      <header className={`relative z-20 ${bare ? "glass sticky top-0 border-x-0 border-t-0" : ""}`}>
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center gap-2.5">
            <LogoMark />
            <span lang="en" dir="ltr" className="font-display sr-only whitespace-nowrap text-[1.02rem] font-semibold tracking-tight min-[380px]:not-sr-only">
              {t.app.name}
            </span>
          </Link>
          <div className="flex items-center gap-0.5">
            <ThemeSwitch t={t} />
            <LanguageSwitch locale={locale} t={t} />
          </div>
        </div>
      </header>
      {bare ? (
        <main id="main" tabIndex={-1} className="relative flex-1">
          {children}
        </main>
      ) : (
        <main id="main" tabIndex={-1} className="relative z-10 flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
          {wide ? (
            <div className="w-full max-w-4xl">{children}</div>
          ) : (
            <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr_minmax(0,28rem)]">
              <div className="enter hidden space-y-6 lg:block">
                <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-sm font-semibold text-primary-strong">
                  <SparkIcon className="h-4 w-4" />
                  {p.eyebrow}
                </p>
                <p className="font-display max-w-md text-4xl font-semibold leading-tight tracking-tight">
                  {p.title}
                </p>
                <ul className="max-w-md space-y-3 text-ink-muted">
                  {p.points.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary-strong">
                        <ShieldIcon className="h-4 w-4" />
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="enter enter-1 glass w-full space-y-6 rounded-[2rem] p-6 shadow-lifted sm:p-9">
                {title ? <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1> : null}
                {children}
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
