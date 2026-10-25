import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { setLocale } from "@/lib/preferences/actions";

/** Switches to the other language. A plain form, so it works without JavaScript. */
export function LanguageSwitch({ locale, t }: { locale: Locale; t: Messages }) {
  const target: Locale = locale === "ar" ? "en" : "ar";
  return (
    <form action={setLocale}>
      <input type="hidden" name="locale" value={target} />
      {/* The accessible name contains the visible text (WCAG 2.5.3 Label in Name). */}
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-semibold text-primary-strong transition-colors hover:bg-surface-muted"
      >
        <span className="sr-only">{t.common.switchLanguageLabel}: </span>
        <span lang={target}>{target === "ar" ? t.common.switchToArabic : t.common.switchToEnglish}</span>
      </button>
    </form>
  );
}
