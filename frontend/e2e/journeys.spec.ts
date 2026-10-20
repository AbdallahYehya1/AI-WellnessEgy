import { expect, test } from "@playwright/test";

import { completeOnboarding, newUser, onboardedUser, outbox, registerAndConfirm, signIn } from "./helpers";

test.describe("first visit and registration", () => {
  test("landing → sign-up → confirmation → onboarding → consent → check-in → dashboard", async ({ browser }) => {
    const user = newUser("journey");
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A calm space to look after yourself");
    await expect(page.getByText(/not a medical service/)).toBeVisible();
    await page.getByRole("link", { name: "Create an account" }).first().click();
    await page.waitForURL("**/sign-up");

    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByLabel("Confirm password").fill(user.password);
    await page.getByLabel("I confirm that I am 18 or older.").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/auth/check-email");
    await expect(page.getByText("If you already have an account, you can sign in or reset your password.")).toBeVisible();

    const mail = (await outbox()).find((m) => m.to === user.email);
    await page.goto(mail!.link);
    // Confirmation shows its own success notice and asks for an explicit sign-in.
    await page.waitForURL("**/sign-in?status=confirmed");
    await expect(page.getByText("Your email address is confirmed. Sign in to continue.")).toBeVisible();
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await completeOnboarding(page);

    await expect(page.getByText(/not a medical assessment/)).toBeVisible();
    await page.locator("label", { hasText: "4" }).first().click();
    await page.getByRole("button", { name: "Save check-in" }).click();
    await page.waitForURL("**/dashboard?status=checked-in");
    await expect(page.getByText("✓ Your check-in was saved.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome");
    await expect(page.getByText(user.email)).toHaveCount(0); // no email shown
    await context.close();
  });

  test("registering again with an existing email reveals nothing and sends nothing new", async ({ browser }) => {
    const user = newUser("dup");
    await registerAndConfirm(browser, user);
    const before = (await outbox()).filter((m) => m.to === user.email).length;

    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill("a-different-password-9");
    await page.getByLabel("Confirm password").fill("a-different-password-9");
    await page.getByLabel("I confirm that I am 18 or older.").check();
    // Double-click: the button disables while the request is pending.
    await page.getByRole("button", { name: "Create account" }).dblclick();
    await page.waitForURL("**/auth/check-email");
    await expect(page.getByText("If you already have an account, you can sign in or reset your password.")).toBeVisible();
    expect((await outbox()).filter((m) => m.to === user.email).length).toBe(before);

    // The original password still works: the account was not replaced.
    await signIn(page, user);
    await page.waitForURL("**/onboarding");
    await context.close();
  });

  test("a signed-in user opening /sign-up is told they already have an account", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "signedup");
    await page.goto("/sign-up");
    await expect(page.getByText("You already have an account. Continue to your dashboard.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
    await page.getByRole("link", { name: "Continue to your dashboard" }).click();
    await page.waitForURL("**/dashboard");
    await context.close();
  });
});

test.describe("signed-in product journeys", () => {
  test("dashboard → check-in → progress → settings", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "product");
    for (const score of ["3", "5"]) {
      await page.goto("/check-in");
      await page.locator("label", { hasText: score }).first().click();
      await page.getByRole("button", { name: "Save check-in" }).click();
      await page.waitForURL("**/dashboard?status=checked-in");
    }
    await expect(page.getByText("You checked in today.")).toBeVisible();

    await page.getByRole("link", { name: "See your progress" }).click();
    await page.waitForURL("**/history");
    await expect(page.getByRole("img", { name: /Mood over your last check-ins/ })).toBeVisible();
    await expect(page.getByRole("table", { name: "Your check-ins" }).getByRole("row")).toHaveCount(3);

    await page.goto("/settings");
    await page.getByLabel("What should we call you?").fill("Nour");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("✓ Saved.")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Nour");

    await page.goto("/settings");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.getByRole("button", { name: "Apply" }).nth(1).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByLabel("Language", { exact: true }).selectOption("ar");
    await page.getByRole("button", { name: "Apply" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الملف الشخصي والإعدادات");
    await context.close();
  });

  test("sign-out protects every signed-in route", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "signout");
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL("**/sign-in?status=signed-out");
    for (const path of ["/dashboard", "/check-in", "/history", "/settings", "/chat", "/onboarding"]) {
      await page.goto(path);
      expect(new URL(page.url()).pathname, path).toBe("/sign-in");
    }
    await context.close();
  });

  test("an expired or removed session is sent to sign-in and can sign in again", async ({ browser }) => {
    const { user, context, page } = await onboardedUser(browser, "expired");
    await context.clearCookies();
    await page.goto("/history");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fhistory/);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/history");
    await context.close();
  });
});
