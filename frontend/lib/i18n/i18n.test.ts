import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { dirFor, resolveLocale } from "@/lib/i18n/config";
import { format, messages } from "@/lib/i18n/messages";
import { TRANSLATED_MESSAGES, translateMessage } from "@/lib/i18n/translate";

describe("resolveLocale", () => {
  it.each([
    [undefined, "en-US,en;q=0.9", "en"],
    [undefined, "ar-EG,ar;q=0.9,en;q=0.8", "ar"],
    [undefined, "fr-FR,fr;q=0.9,en;q=0.5", "en"], // first supported language in preference order
    [undefined, "fr-FR,de;q=0.9", "ar"], // nothing supported: Arabic (D2)
    [undefined, null, "ar"],
    [undefined, "en;q=0,ar;q=0.1", "ar"], // q=0 means "not acceptable"
    ["en", "ar-EG", "en"], // a saved choice wins
    ["xx", "en-GB", "en"], // an invalid saved value is ignored
  ] as const)("saved=%s accept=%s -> %s", (saved, accept, expected) => {
    expect(resolveLocale(saved, accept)).toBe(expected);
  });

  it("maps Arabic to RTL and English to LTR", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });
});

describe("dictionaries", () => {
  function keys(value: unknown, prefix = ""): string[] {
    if (typeof value !== "object" || value === null) return [prefix];
    return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  }

  it("Arabic and English have the same keys", () => {
    expect(keys(messages.ar).sort()).toEqual(keys(messages.en).sort());
  });

  it("inserts placeholder values as plain text", () => {
    expect(format("Welcome, {name}", { name: "<b>x</b>" })).toBe("Welcome, <b>x</b>");
  });
});

describe("translateMessage", () => {
  it("leaves English unchanged and unknown text untouched", () => {
    expect(translateMessage("en", "The email or password is incorrect.")).toBe("The email or password is incorrect.");
    expect(translateMessage("ar", "Something new")).toBe("Something new");
  });

  it("covers every fixed message the server actions return", () => {
    const root = join(__dirname, "..", "..");
    const sources = ["lib/auth/errors.ts", "lib/auth/validation.ts", "lib/onboarding/actions.ts", "lib/mood/actions.ts", "lib/chat/actions.ts", "lib/settings/actions.ts"]
      .map((f) => readFileSync(join(root, f), "utf8"))
      .join("\n");
    const literals = [...sources.matchAll(/"([A-Z][^"]{8,}[.!?])"/g)].map((m) => m[1]!);
    const missing = [...new Set(literals)].filter((text) => !TRANSLATED_MESSAGES.includes(text));
    expect(missing).toEqual([]);
  });
});

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

describe("preference actions", () => {
  beforeEach(() => set.mockReset());

  it("stores only supported values, device-only and httpOnly", async () => {
    const { setLocale, setTheme } = await import("@/lib/preferences/actions");
    const form = (k: string, v: string) => {
      const d = new FormData();
      d.set(k, v);
      return d;
    };
    await setLocale(form("locale", "en"));
    await setTheme(form("theme", "dark"));
    await setLocale(form("locale", "fr"));
    await setTheme(form("theme", "<script>"));
    expect(set.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["aw_locale", "en"],
      ["aw_theme", "dark"],
    ]);
    expect(set.mock.calls[0]?.[2]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});
