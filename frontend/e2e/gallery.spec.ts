import { expect, type Page, test } from "@playwright/test";

import { onboardedUser } from "./helpers";

// Visual review gallery for the redesign (GALLERY=1 npx playwright test gallery). Local
// stack only: mock auth, scripted provider, synthetic data. Screens are written to
// test-results/gallery/ (git-ignored) for side-by-side review; nothing is asserted about
// pixels, so it never blocks CI.

const OUT = "test-results/gallery";
const ORIGIN = "http://localhost:3100";

test.skip(!process.env.GALLERY, "visual gallery runs only with GALLERY=1");
test.setTimeout(1_800_000);

async function prefs(page: Page, theme: string, locale: string) {
  await page.context().addCookies([
    { name: "aw_theme", value: theme, url: ORIGIN },
    { name: "aw_locale", value: locale, url: ORIGIN },
  ]);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
}

function composer(page: Page) {
  return page.locator("#chat-message");
}

async function ask(page: Page, text: string) {
  const log = page.getByRole("list", { name: /^(Conversation|المحادثة)$/ });
  const before = await log.locator(":scope > li").count().catch(() => 0);
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(log.locator(":scope > li")).toHaveCount(before + 2, { timeout: 30_000 });
}

test("gallery: every main page, light and dark, English and Arabic, desktop and phone", async ({ browser }) => {
  const { context, page } = await onboardedUser(browser, "gallery");
  await page.setViewportSize({ width: 1280, height: 900 });

  // Real data through the real UI: three reflections and two saved conversations.
  for (const [feelings, factors] of [
    [["Calm", "Tired"], ["Work", "Sleep"]],
    [["Anxious"], ["Work"]],
    [["Happy", "Excited"], ["Family"]],
  ] as const) {
    await page.goto("/check-in");
    for (const f of feelings) await page.locator("label", { hasText: f }).first().click();
    for (const f of factors) await page.locator("label", { hasText: f }).first().click();
    await page.getByRole("button", { name: "Save reflection" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
  }
  await page.goto("/chat?assistant=career");
  const turnOn = page.getByRole("button", { name: "Turn on saved chats" });
  if (await turnOn.count()) {
    await turnOn.click();
    await page.getByRole("dialog").getByRole("button", { name: "Save my chats" }).click();
  }
  await ask(page, "My manager keeps changing deadlines and I feel stressed at work. How can I handle it?");
  await ask(page, "What should I say in my next one-to-one?");
  await page.goto("/chat?assistant=emotional");
  await ask(page, "أنا مضغوط جداً اليومين دول بسبب الشغل والامتحانات ومش عارف أنام كويس، أعمل إيه عشان أهدى وأرتب يومي؟");

  const pages: [string, string][] = [
    ["dashboard", "/dashboard"],
    ["assistants", "/assistants"],
    ["check-in", "/check-in"],
    ["history", "/history"],
    ["settings", "/settings"],
    ["chat-empty", "/chat?assistant=family"],
  ];
  for (const [theme, locale] of [
    ["light", "en"],
    ["dark", "en"],
    ["light", "ar"],
    ["dark", "ar"],
  ] as const) {
    await prefs(page, theme, locale);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      for (const [name, path] of pages) {
        await page.goto(path);
        await settle(page);
        await page.screenshot({ path: `${OUT}/${locale}-${theme}-${width}-${name}.png`, fullPage: name !== "chat-empty" });
        if (name === "assistants" || name === "dashboard") {
          await page.screenshot({ path: `${OUT}/${locale}-${theme}-${width}-${name}-viewport.png` });
        }
      }
      // A saved conversation, reopened from the list.
      await page.goto("/chat?assistant=career");
      await settle(page);
      if (width < 1024) await page.locator("header button[aria-expanded]").first().click();
      await page.getByRole("navigation", { name: /^(Chats|المحادثات)$/ }).getByRole("button").first().click();
      await settle(page);
      await page.screenshot({ path: `${OUT}/${locale}-${theme}-${width}-chat-saved.png` });
    }
  }
  await context.close();

  // Signed-out pages.
  const anon = await browser.newContext();
  const p = await anon.newPage();
  for (const [theme, locale] of [
    ["light", "en"],
    ["dark", "ar"],
  ] as const) {
    await prefs(p, theme, locale);
    for (const width of [1280, 390]) {
      await p.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      for (const [name, path] of [
        ["home", "/"],
        ["sign-in", "/sign-in"],
        ["sign-up", "/sign-up"],
        ["forgot-password", "/forgot-password"],
      ]) {
        await p.goto(path!);
        await settle(p);
        await p.screenshot({ path: `${OUT}/${locale}-${theme}-${width}-${name}.png`, fullPage: true });
      }
    }
  }
  await anon.close();
});
