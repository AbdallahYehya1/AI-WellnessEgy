import { expect, type Browser, type Page } from "@playwright/test";

// Helpers for the local E2E stack (mock auth, synthetic accounts only).
export const MOCK_AUTH = process.env.E2E_MOCK_AUTH_URL ?? "http://127.0.0.1:54321";

export type TestUser = { email: string; password: string };

export function newUser(prefix: string): TestUser {
  return { email: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`, password: "e2e-password-123" };
}

type Mail = { to: string; link: string; type?: string };

export async function outbox(): Promise<Mail[]> {
  return (await (await fetch(`${MOCK_AUTH}/__outbox`)).json()) as Mail[];
}

export async function events(): Promise<string[]> {
  return (await (await fetch(`${MOCK_AUTH}/__events`)).json()) as string[];
}

/** Sign up and confirm through the real UI, in a throwaway browser context. */
export async function registerAndConfirm(browser: Browser, user: TestUser): Promise<void> {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByLabel("I confirm that I am 18 or older.").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/auth/check-email");
  const mail = (await outbox()).find((m) => m.to === user.email && m.type !== "recovery");
  expect(mail, "confirmation email in the mock outbox").toBeTruthy();
  await page.goto(mail!.link);
  await page.waitForURL("**/onboarding");
  await context.close();
}

export async function signIn(page: Page, user: TestUser, password = user.password): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Profile (skipped) and consent, ending on the check-in page. */
export async function completeOnboarding(page: Page): Promise<void> {
  await page.waitForURL("**/onboarding");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL("**/onboarding/consent");
  await page.getByLabel("I have read and agree to these terms.").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.waitForURL("**/check-in");
}

/** A ready-to-use account: registered, confirmed, signed in and onboarded. */
export async function onboardedUser(browser: Browser, prefix: string, locale = "en-US") {
  const user = newUser(prefix);
  await registerAndConfirm(browser, user);
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  await signIn(page, user);
  await completeOnboarding(page);
  return { user, context, page };
}

/** Alerts inside <main> only (Next.js adds its own route-announcer alert). */
export function mainAlert(page: Page) {
  return page.locator("main [role=alert]");
}
