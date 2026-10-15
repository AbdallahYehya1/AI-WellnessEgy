import "server-only";

import { cookies, headers } from "next/headers";

import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  isTheme,
  resolveLocale,
  type Locale,
  type Theme,
} from "@/lib/i18n/config";
import { messages, type Messages } from "@/lib/i18n/messages";

/**
 * The visitor's locale for this request. Outside a request (unit tests that
 * render a page directly) there are no headers; English is used there so
 * existing assertions stay deterministic. Real requests always have headers.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get("accept-language"));
  } catch {
    return "en";
  }
}

export async function getTheme(): Promise<Theme> {
  try {
    const value = (await cookies()).get(THEME_COOKIE)?.value;
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

export async function getMessages(): Promise<{ locale: Locale; t: Messages }> {
  const locale = await getLocale();
  return { locale, t: messages[locale] };
}
