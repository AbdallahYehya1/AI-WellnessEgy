import { expect, type Page, test } from "@playwright/test";

// Regression (2026-10-20): in Arabic the show/hide button covered the typed password.

async function geometry(page: Page, inputId: string) {
  return page.evaluate((id) => {
    const input = document.getElementById(id) as HTMLInputElement;
    const row = input.parentElement as HTMLElement;
    const toggle = row.querySelector("button") as HTMLButtonElement;
    const a = input.getBoundingClientRect();
    const b = toggle.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      overlap: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
      toggleInsideRow: b.left >= r.left - 0.5 && b.right <= r.right + 0.5,
      inputInsideRow: a.left >= r.left - 0.5 && a.right <= r.right + 0.5,
      rowBorder: getComputedStyle(row).borderTopWidth,
      inputBorder: getComputedStyle(input).borderTopWidth,
      // Focus shows once, on the row, never as a second ring inside it.
      innerOutline: getComputedStyle(input).outlineStyle,
      rowRing: getComputedStyle(row).boxShadow !== "none",
    };
  }, inputId);
}

for (const [language, width] of [
  ["ar", 390],
  ["ar", 320],
  ["en", 390],
] as const) {
  test(`password show/hide never covers the text (${language}, ${width}px)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await page.goto("/sign-up");
    if (language === "ar") await page.getByRole("button", { name: /العربية/ }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    for (const id of ["password", "confirmPassword"]) {
      await page.locator(`#${id}`).fill("a-long-example-passphrase-1234567890");
      await page.locator(`#${id}`).press("End"); // keyboard focus, as a real user has
      const g = await geometry(page, id);
      expect(g).toEqual({
        overlap: 0,
        toggleInsideRow: true,
        inputInsideRow: true,
        rowBorder: "1px",
        inputBorder: "0px",
        innerOutline: "none",
        rowRing: true,
      });
    }
    await page.screenshot({ path: `test-results/screens/password-${language}-${width}.png` });
    await context.close();
  });
}
