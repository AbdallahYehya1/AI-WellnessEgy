import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { onboardedUser } from "./helpers";

// Accessibility (axe, WCAG 2.2 A/AA rules), responsive layout and touch
// targets across languages, themes and viewports. Automated checks cover only
// part of WCAG; manual screen-reader testing is still required.

const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440];
const PUBLIC_PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password", "/auth/check-email", "/reset-password", "/no-such-page"];
const APP_PAGES = ["/dashboard", "/check-in", "/history", "/settings", "/assistants", "/chat", "/chat?assistant=career"];
const SHOTS = process.env.E2E_SCREENSHOTS ?? "test-results/screens";

async function setPrefs(context: BrowserContext, baseURL: string, locale: "ar" | "en", theme: "light" | "dark") {
  await context.addCookies([
    { name: "aw_locale", value: locale, url: baseURL },
    { name: "aw_theme", value: theme, url: baseURL },
  ]);
}

async function axe(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function layoutIssues(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll<HTMLElement>("a, button, input, select, textarea, summary")]
      .filter((el) => el.offsetParent !== null && !el.classList.contains("sr-only") && getComputedStyle(el).visibility !== "hidden")
      .filter((el) => !(el instanceof HTMLInputElement && el.type === "radio"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 24 || r.height < 24))
      .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    return { overflow: doc.scrollWidth > doc.clientWidth + 1 ? doc.scrollWidth - doc.clientWidth : 0, small };
  });
}

for (const locale of ["en", "ar"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`public pages: axe, overflow and targets (${locale}, ${theme})`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ locale: locale === "ar" ? "ar-EG" : "en-US" });
      await setPrefs(context, baseURL!, locale, theme);
      const page = await context.newPage();
      for (const path of PUBLIC_PAGES) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
        await axe(page, `${path} ${locale} ${theme}`);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          const { overflow, small } = await layoutIssues(page);
          expect(overflow, `horizontal overflow on ${path} @${width}`).toBe(0);
          expect(small, `touch targets < 24px on ${path} @${width}`).toEqual([]);
          if (width === 375 || width === 1280) {
            await page.screenshot({ path: `${SHOTS}/${locale}-${theme}-${width}${path.replace(/\//g, "_") || "_home"}.png`, fullPage: true });
          }
        }
      }
      await context.close();
    });

    test(`signed-in pages: axe, overflow and targets (${locale}, ${theme})`, async ({ browser, baseURL }) => {
      // Onboard through the English UI, then switch language and theme by cookie.
      const { context, page } = await onboardedUser(browser, `q-${locale}-${theme}`);
      await setPrefs(context, baseURL!, locale, theme);
      for (const path of APP_PAGES) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(path);
        await axe(page, `${path} ${locale} ${theme}`);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          const { overflow, small } = await layoutIssues(page);
          expect(overflow, `horizontal overflow on ${path} @${width}`).toBe(0);
          expect(small, `touch targets < 24px on ${path} @${width}`).toEqual([]);
          if (width === 375 || width === 1280) {
            await page.screenshot({ path: `${SHOTS}/${locale}-${theme}-${width}${path.replace(/[/?=]/g, "_")}.png`, fullPage: true });
          }
        }
      }
      await context.close();
    });
  }
}

test("keyboard: skip link moves focus to the main content", async ({ browser }) => {
  const { context, page } = await onboardedUser(browser, "kbd");
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await context.close();
});

test("reduced motion is honoured", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const duration = await page.evaluate(() => getComputedStyle(document.body).transitionDuration);
  expect(["0s", "1e-05s", "0.00001s"]).toContain(duration);
  await context.close();
});
