"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { buttonStyles } from "@/components/ui/primitives";
import { messages } from "@/lib/i18n/messages";

const subscribe = () => () => {};
const documentLocale = () => (document.documentElement.lang === "ar" ? "ar" : "en");
const serverLocale = () => "en" as const;

/**
 * Last-resort error screen for unexpected rendering failures. It shows no
 * error details (they can contain internal information) and offers a retry.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useSyncExternalStore(subscribe, documentLocale, serverLocale);
  const t = messages[locale];
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">{t.errors.genericTitle}</h1>
        <p role="alert" className="text-ink-muted">
          {t.errors.genericBody}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={reset} className={buttonStyles("primary")}>
            {t.common.tryAgain}
          </button>
          <Link href="/" className={buttonStyles("secondary")}>
            {t.errors.goHome}
          </Link>
        </div>
      </div>
    </main>
  );
}
