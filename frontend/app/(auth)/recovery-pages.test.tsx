import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { randomBytes } from "node:crypto";

import { issueRecoveryMarker } from "@/lib/auth/recovery";
import { authError, createFakeAuth, TEST_SESSION_ID, TEST_USER, type FakeAuth } from "@/test/supabase-mock";

let auth: FakeAuth;
let host = "localhost:3000";
let acceptLanguage = "en";
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
  headers: async () => new Headers({ host, "accept-language": acceptLanguage }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));
vi.mock("@/lib/auth/recovery-actions", () => ({ requestPasswordReset: vi.fn(), updatePassword: vi.fn() }));
vi.mock("@/lib/preferences/actions", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { default: ForgotPasswordPage } = await import("@/app/(auth)/forgot-password/page");
const { default: ResetPasswordPage } = await import("@/app/(auth)/reset-password/page");

function props(values: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(values) };
}

beforeEach(() => {
  auth = createFakeAuth({ signedIn: true });
  host = "localhost:3000";
  acceptLanguage = "en";
  jar.clear();
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("RECOVERY_MARKER_SECRET", randomBytes(32).toString("base64url"));
});

function marker(userId = TEST_USER.sub, sessionId = TEST_SESSION_ID): string {
  return issueRecoveryMarker(userId, sessionId) ?? "";
}

describe("forgot-password page", () => {
  it("offers the email form", async () => {
    render(await ForgotPasswordPage(props()));
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(screen.queryByTestId("host-mismatch")).toBeNull();
  });

  it("shows the same account-neutral notice after a request", async () => {
    render(await ForgotPasswordPage(props({ status: "sent" })));
    expect(screen.getByRole("status").textContent).toMatch(/^If an account exists for that email/);
  });

  it("explains an invalid, expired or reused link", async () => {
    render(await ForgotPasswordPage(props({ status: "link-invalid" })));
    expect(screen.getByRole("alert").textContent).toMatch(/invalid, has expired or was already used/);
  });

  it("ignores unknown status values", async () => {
    render(await ForgotPasswordPage(props({ status: "<b>pwned</b>" })));
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toContain("pwned");
  });

  it("explains when password reset is unavailable", async () => {
    render(await ForgotPasswordPage(props({ status: "unavailable" })));
    expect(screen.getByRole("alert").textContent).toMatch(/isn't available right now/);
  });

  it("is shown in Arabic when the browser prefers Arabic", async () => {
    acceptLanguage = "ar-EG,ar;q=0.9,en;q=0.5";
    render(await ForgotPasswordPage(props({ status: "sent" })));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("نسيت كلمة السر؟");
    expect(screen.getByLabelText("البريد الإلكتروني")).toBeTruthy();
  });

  it("warns in development when the host differs from SITE_URL", async () => {
    host = "127.0.0.1:3000";
    render(await ForgotPasswordPage(props()));
    expect(screen.getByTestId("host-mismatch").textContent).toContain("localhost:3000");
  });
});

describe("reset-password page", () => {
  it("shows the form for a live session with a valid signed marker", async () => {
    jar.set("aw_password_reset", marker());
    render(await ResetPasswordPage());
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm new password")).toBeTruthy();
  });

  it.each([
    ["an ordinary signed-in session (no marker)", () => undefined],
    ["the original exploit: a cookie holding the user's id", () => jar.set("aw_password_reset", TEST_USER.sub)],
    ["a marker for another user", () => jar.set("aw_password_reset", marker("11111111-1111-4111-8111-111111111111"))],
    ["a marker for another session", () => jar.set("aw_password_reset", marker(TEST_USER.sub, "another-session"))],
    ["no session", () => { auth = createFakeAuth({ signedIn: false }); jar.set("aw_password_reset", marker()); }],
    ["a revoked session with a retained access token", () => {
      jar.set("aw_password_reset", marker());
      auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: authError("session_not_found", 403) } as never);
    }],
    ["a missing server secret", () => { jar.set("aw_password_reset", marker()); vi.stubEnv("RECOVERY_MARKER_SECRET", ""); }],
  ])("refuses %s", async (_, arrange) => {
    arrange();
    render(await ResetPasswordPage());
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/only works straight after/);
    expect(screen.getByRole("link", { name: "Request a new reset link" }).getAttribute("href")).toBe(
      "/forgot-password",
    );
  });
});
