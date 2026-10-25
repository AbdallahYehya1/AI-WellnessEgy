"use client";

import { useSyncExternalStore } from "react";

import type { Messages } from "@/lib/i18n/messages";
import { setTheme } from "@/lib/preferences/actions";

const subscribe = () => () => {};
/** The saved theme, as the root layout set it on <html data-theme>. */
const currentTheme = () => document.documentElement.dataset.theme ?? "system";

/** One-tap light/dark switch. A plain form posting to the existing preference action, so
 * it also works without JavaScript; the full choice ("match my device") stays in Settings. */
export function ThemeSwitch({ t }: { t: Messages }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "system");
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? t.v2.common.themeToDark : t.v2.common.themeToLight;
  return (
    <form action={setTheme}>
      <input type="hidden" name="theme" value={next} />
      <button
        type="submit"
        aria-label={label}
        title={label}
        className="group inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5 transition-transform duration-500 group-hover:rotate-[20deg]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          {next === "dark" ? (
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          ) : (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
            </>
          )}
        </svg>
      </button>
    </form>
  );
}
