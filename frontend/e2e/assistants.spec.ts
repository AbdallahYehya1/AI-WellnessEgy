import { expect, type Page, test } from "@playwright/test";

import { onboardedUser } from "./helpers";

// Local stack only (see README): curated mode with assistants, scripted fake provider,
// the real source files in backend/app/knowledge/sources. Not a verification of production.

const SCREENS = "test-results/screens";

function composer(page: Page) {
  return page.getByRole("textbox", { name: /Ask a general question|اسأل سؤال عام/ });
}

function log(page: Page) {
  return page.getByRole("list", { name: /^(Conversation|المحادثة)$/ });
}

async function ask(page: Page, text: string) {
  const before = await log(page).locator(":scope > li").count().catch(() => 0);
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(log(page).locator(":scope > li")).toHaveCount(before + 2, { timeout: 20_000 });
}

async function settle(page: Page) {
  await page.waitForTimeout(400);
}

function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Chats" });
}

test.describe("assistants", () => {
  test("directory: ten assistants, only ready ones open", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "asstdir");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Assistants" }).first().click();
    await page.waitForURL("**/assistants");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How can we help you today?");
    await expect(page.locator("main h2")).toHaveCount(10);
    for (const name of ["Marriage & Healthy Relationships", "Career & Work", "Emotional Wellbeing & Resilience"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
    await expect(page.getByText("Coming soon")).toHaveCount(7);
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/assistants-desktop.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: `${SCREENS}/assistants-mobile.png`, fullPage: true });
    await context.close();
  });

  test("career: natural question, cited answer, saved under that assistant only", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "asstcareer");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/assistants");
    await page.getByRole("link", { name: /Career & Work/ }).click();
    await page.waitForURL("**/chat?assistant=career");
    await expect(page.getByRole("heading", { level: 2, name: "Career & Work" })).toBeVisible();
    await expect(page.getByText("Topics I can answer right now")).toHaveCount(0);

    await expect(page.getByText(/not clinically or professionally reviewed/)).toBeVisible();
    await expect(composer(page)).toBeEnabled();
    await sidebar(page).getByRole("button", { name: "Turn on saved chats" }).click();
    await page.getByRole("dialog", { name: "Save your chats?" }).getByRole("button", { name: "Save my chats" }).click();
    await expect(sidebar(page).getByText("Saving chats is on")).toBeVisible();
    await ask(page, "My manager keeps changing deadlines and I feel stressed at work. How can I handle it?");
    await expect(log(page).getByRole("note")).toHaveCount(0);
    await expect(log(page).getByText(/^Sources \(\d\)$/).last()).toBeVisible();
    // Career sources only (NIOSH / NHS / OPM), never the general wellbeing set.
    const hrefs = await log(page).locator("a[href^='http']").evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/cdc\.gov\/niosh|nhs\.uk|opm\.gov/);
    await expect(composer(page)).toHaveAttribute("placeholder", "Describe what's going on, in your own words…");
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/assistant-career-desktop.png` });

    await ask(page, "Can you give me a short summary?");
    await expect(log(page).getByRole("note")).toHaveCount(0);
    await expect(sidebar(page).getByRole("listitem")).toHaveCount(1);

    // The same account's relationships assistant doesn't list the career chat.
    await page.goto("/chat?assistant=relationships");
    await expect(page.getByRole("heading", { level: 2, name: "Marriage & Healthy Relationships" })).toBeVisible();
    await expect(sidebar(page).getByText(/No saved chats yet/)).toBeVisible();
    await page.goto("/chat?assistant=career");
    await expect(sidebar(page).getByRole("listitem")).toHaveCount(1);
    await context.close();
  });

  test("relationships: safety first, and an off-topic question is handed off", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "asstrel");
    await page.goto("/chat?assistant=relationships");
    await ask(page, "How can my wife and I communicate better when we disagree?");
    await expect(log(page).getByRole("note")).toHaveCount(0);
    await expect(log(page).getByText(/^Sources \(\d\)$/).last()).toBeVisible();

    await ask(page, "My husband hits me when he is angry");
    const safety = log(page).getByRole("note").last();
    await expect(safety).toContainText("not your fault");
    await expect(safety).toContainText("122");

    await ask(page, "I want to kill myself");
    await expect(log(page).getByRole("note").last()).toHaveAttribute("data-status", "support");

    await ask(page, "How do I prepare for a job interview and ask for a promotion at work?");
    const handoff = page.getByRole("link", { name: "Open Career & Work" });
    await expect(handoff).toHaveAttribute("href", "/chat?assistant=career");
    await context.close();
  });

  test("a preview assistant can't be opened by URL", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "asstpreview");
    await page.goto("/chat?assistant=finance");
    await expect(page.getByText("Topics I can answer right now")).toBeVisible(); // default assistant
    await expect(page.getByText("Financial Wellbeing")).toHaveCount(0);
    await context.close();
  });

  test("Arabic, right to left: directory, assistant and reflection", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "asstar");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/assistants");
    await page.getByRole("button", { name: /العربية/ }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/assistants-mobile-arabic.png`, fullPage: true });

    await page.goto("/chat?assistant=career");
    await ask(page, "مديري بيغير المواعيد كل شوية وأنا متوتر في الشغل، أعمل إيه؟");
    await expect(log(page).getByText(/^المصادر \(\d\)$/).last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/assistant-career-mobile-arabic.png` });

    await page.goto("/check-in");
    await expect(page.getByRole("group", { name: "حاسس بإيه النهارده؟" })).toBeVisible();
    await page.locator("label", { hasText: "قلقان" }).first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: `${SCREENS}/reflection-mobile-arabic.png`, fullPage: true });
    await context.close();
  });
});
