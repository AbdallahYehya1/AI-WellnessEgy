import Link from "next/link";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/shell/icons";
import { LanguageSwitch } from "@/components/shell/language-switch";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

/** Layout for signed-out pages: brand, language switch, and a centred card. */
export function PublicShell({
  locale,
  t,
  title,
  children,
  wide = false,
}: {
  locale: Locale;
  t: Messages;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t.common.skipToContent}
      </a>
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-bold">
          <LogoMark />
          <span lang="en" dir="ltr">
            {t.app.name}
          </span>
        </Link>
        <LanguageSwitch locale={locale} t={t} />
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        {wide ? (
          <div className="w-full max-w-4xl">{children}</div>
        ) : (
          <div className="w-full max-w-md space-y-6 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            {title ? <h1 className="text-2xl font-bold leading-tight">{title}</h1> : null}
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
