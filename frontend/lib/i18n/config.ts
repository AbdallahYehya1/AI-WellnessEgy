// Locale and theme preferences. Both are stored only on this device, in
// plain cookies; nothing is sent to the API (D-23: no preference keys yet).

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "aw_locale";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "aw_theme";

export const PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * The saved choice wins; otherwise the first of Arabic or English in the
 * browser's Accept-Language order; otherwise Arabic (D2).
 */
export function resolveLocale(saved: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(saved)) return saved;
  if (acceptLanguage) {
    const ranked = acceptLanguage
      .split(",")
      .map((part, index) => {
        const [tag, ...params] = part.trim().toLowerCase().split(";");
        const q = params.find((p) => p.trim().startsWith("q="));
        const weight = q ? Number(q.trim().slice(2)) : 1;
        return { lang: (tag ?? "").split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
      })
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.index - b.index);
    const match = ranked.find((entry) => isLocale(entry.lang));
    if (match && isLocale(match.lang)) return match.lang;
  }
  return DEFAULT_LOCALE;
}
