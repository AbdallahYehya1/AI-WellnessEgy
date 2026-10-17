"use server";

import { cookies } from "next/headers";

import {
  LOCALE_COOKIE,
  PREFERENCE_MAX_AGE,
  THEME_COOKIE,
  isLocale,
  isTheme,
} from "@/lib/i18n/config";

// Device-only preferences: plain, non-sensitive cookies. Unknown values are
// ignored rather than stored.
const options = { path: "/", sameSite: "lax" as const, httpOnly: true, maxAge: PREFERENCE_MAX_AGE };

export async function setLocale(formData: FormData): Promise<void> {
  const value = formData.get("locale");
  if (isLocale(value)) (await cookies()).set(LOCALE_COOKIE, value, options);
}

export async function setTheme(formData: FormData): Promise<void> {
  const value = formData.get("theme");
  if (isTheme(value)) (await cookies()).set(THEME_COOKIE, value, options);
}
