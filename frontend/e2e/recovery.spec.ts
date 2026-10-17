import { expect, test, type Page } from "@playwright/test";

import { events, MOCK_AUTH, newUser, outbox, registerAndConfirm, signIn } from "./helpers";

// Password recovery against the mock auth server. This verifies the app's
// behaviour; it is NOT a verification of the real Supabase email flow.

async function requestReset(page: Page, email: string): Promise<string> {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.waitForURL("**/forgot-password?status=sent");
  return (await page.locator("main [role=status]").innerText()).trim();
}

async function latestRecoveryLink(email: string): Promise<string> {
  const mail = (await outbox()).filter((m) => m.to === email && m.type === "recovery").at(-1);
  expect(mail, "recovery email in the mock outbox").toBeTruthy();
  return mail!.link;
}

const formShown = (page: Page) => page.getByLabel("New password", { exact: true }).count();

test("full recovery: neutral request, reset, old password rejected, new password works, email link can't be reused", async ({ browser }) => {
  const user = newUser("recover");
  await registerAndConfirm(browser, user);
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await page.waitForURL("**/forgot-password");

  const before = (await outbox()).length;
  const unknownMessage = await requestReset(page, `nobody-${Date.now()}@example.com`);
  expect((await outbox()).length).toBe(before); // nothing sent for an unknown account
  const knownMessage = await requestReset(page, user.email);
  expect(knownMessage).toBe(unknownMessage); // identical: no account enumeration

  const link = await latestRecoveryLink(user.email);
  await page.goto(link);
  await page.waitForURL("**/reset-password");
  const marker = (await context.cookies()).find((c) => c.name === "aw_password_reset");
  expect(marker?.httpOnly).toBe(true);
  expect(marker?.sameSite).toBe("Lax");
  expect(marker?.path).toBe("/reset-password");
  expect(marker?.value).not.toBe(""); // signed value, not a bare user id
  expect(await page.evaluate(() => document.cookie)).not.toContain("aw_password_reset");

  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByLabel("Confirm new password").fill("different");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();

  const NEW = "a-new-e2e-password-7";
  await page.getByLabel("New password", { exact: true }).fill(NEW);
  await page.getByLabel("Confirm new password").fill(NEW);
  await page.getByRole("button", { name: "Save new password" }).click();
  await page.waitForURL("**/sign-in?status=password-updated");
  expect((await context.cookies()).some((c) => c.name === "aw_password_reset")).toBe(false);
  expect(await events()).toContain("POST /auth/v1/logout global");

  await signIn(page, user); // old password
  await expect(page.locator("main [role=alert]")).toContainText("The email or password is incorrect.");
  await signIn(page, user, NEW);
  await page.waitForURL("**/onboarding");

  await page.goto(link); // reused link
  await expect(page).toHaveURL(/\/forgot-password\?status=link-invalid/);
  await context.close();
});

test("the original forged-cookie exploit and a stolen marker are both refused", async ({ browser }) => {
  const user = newUser("forge");
  await registerAndConfirm(browser, user);

  // Ordinary signed-in session ("thief") sets the old exploit cookie (= user id).
  const thief = await browser.newContext({ locale: "en-US" });
  const t = await thief.newPage();
  await signIn(t, user);
  await t.waitForURL("**/onboarding");
  const token = await (
    await fetch(`${MOCK_AUTH}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    })
  ).json();
  await thief.addCookies([{ name: "aw_password_reset", value: token.user.id, url: new URL("/reset-password", t.url()).toString() }]);
  await t.goto("/reset-password");
  expect(await formShown(t)).toBe(0);

  // A valid marker from the real recovery session, replayed with another session.
  const victim = await browser.newContext({ locale: "en-US" });
  const v = await victim.newPage();
  await requestReset(v, user.email);
  await v.goto(await latestRecoveryLink(user.email));
  await v.waitForURL("**/reset-password");
  expect(await formShown(v)).toBe(1);
  const stolen = (await victim.cookies()).find((c) => c.name === "aw_password_reset")!;
  await thief.addCookies([{ name: "aw_password_reset", value: stolen.value, url: new URL("/reset-password", t.url()).toString() }]);
  await t.goto("/reset-password");
  expect(await formShown(t)).toBe(0);

  // Replay of the recovery session's own cookies after a successful reset.
  const captured = await victim.cookies();
  await v.getByLabel("New password", { exact: true }).fill("victim-new-password-3");
  await v.getByLabel("Confirm new password").fill("victim-new-password-3");
  await v.getByRole("button", { name: "Save new password" }).click();
  await v.waitForURL("**/sign-in?status=password-updated");
  const replay = await browser.newContext({ locale: "en-US" });
  await replay.addCookies(captured);
  const r = await replay.newPage();
  await r.goto("/reset-password");
  expect(await formShown(r)).toBe(0);

  await Promise.all([thief.close(), victim.close(), replay.close()]);
});

test("a recovery link opened in a different browser is refused", async ({ browser }) => {
  const user = newUser("otherbrowser");
  await registerAndConfirm(browser, user);
  const a = await browser.newContext({ locale: "en-US" });
  const pa = await a.newPage();
  await requestReset(pa, user.email);
  const link = await latestRecoveryLink(user.email);

  const b = await browser.newContext({ locale: "en-US" });
  const pb = await b.newPage();
  await pb.goto(link);
  await expect(pb).toHaveURL(/\/forgot-password\?status=link-invalid/);
  expect((await b.cookies()).some((c) => c.name === "aw_password_reset")).toBe(false);
  await Promise.all([a.close(), b.close()]);
});
