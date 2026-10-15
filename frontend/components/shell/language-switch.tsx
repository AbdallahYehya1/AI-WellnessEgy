import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { setLocale } from "@/lib/preferences/actions";

/** Switches to the other language. A plain form, so it works without JavaScript. */
export function LanguageSwitch({ locale, t }: { locale: Locale; t: Messages }) {
  const target: Locale = locale === "ar" ? "en" : "ar";
  return (
    <form action={setLocale}>
      <input type="hidden" name="locale" value={target} />
      <button
        type="submit"
        lang={target}
        aria-label={t.common.switchLanguageLabel}
        className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-primary-strong hover:bg-surface-muted"
      >
        {target === "ar" ? t.common.switchToArabic : t.common.switchToEnglish}
      </button>
    </form>
  );
}
