import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/auth/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));
const getVerifiedSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/preferences/actions", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));

const { default: SignInPage } = await import("@/app/(auth)/sign-in/page");
const { default: CheckEmailPage } = await import("@/app/auth/check-email/page");
const { default: SignUpPage } = await import("@/app/(auth)/sign-up/page");

function params(values: Record<string, string>) {
  return { searchParams: Promise.resolve(values) };
}

describe("check-email page", () => {
  it("shows the confirmation-pending state after sign-up", async () => {
    render(await CheckEmailPage());
    expect(screen.getByRole("status").textContent).toContain(
      "Confirm your email address to finish creating your account.",
    );
  });

  it("points existing users to sign-in and reset without revealing account existence", async () => {
    render(await CheckEmailPage());
    expect(screen.getByText("If you already have an account, you can sign in or reset your password.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/sign-in");
    expect(screen.getByRole("link", { name: "Forgot your password?" }).getAttribute("href")).toBe("/forgot-password");
  });
});

describe("sign-up page", () => {
  it("shows the form to anonymous visitors, with sign-in and reset links", async () => {
    getVerifiedSession.mockResolvedValue(null);
    render(await SignUpPage());
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    expect(screen.getByRole("link", { name: "Forgot your password?" }).getAttribute("href")).toBe("/forgot-password");
  });

  it("tells a signed-in user they already have an account", async () => {
    getVerifiedSession.mockResolvedValue({ accessToken: "t", email: "person@example.com" });
    render(await SignUpPage());
    expect(screen.getByRole("status").textContent).toBe("You already have an account. Continue to your dashboard.");
    expect(screen.getByRole("link", { name: "Continue to your dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    // The visitor's own email is not echoed back.
    expect(document.body.textContent).not.toContain("person@example.com");
  });
});

describe("sign-in page", () => {
  it("shows the signed-out notice", async () => {
    render(await SignInPage(params({ status: "signed-out" })));
    expect(screen.getByRole("status").textContent).toBe("You've been signed out.");
  });

  it("confirms a password reset and offers the forgot-password link", async () => {
    render(await SignInPage(params({ status: "password-updated" })));
    expect(screen.getByRole("status").textContent).toMatch(/password has been updated/);
    expect(screen.getByRole("link", { name: "Forgot your password?" }).getAttribute("href")).toBe(
      "/forgot-password",
    );
  });

  it("shows an understandable message for a failed confirmation link", async () => {
    render(await SignInPage(params({ status: "confirmation-failed" })));
    expect(screen.getByRole("alert").textContent).toContain("invalid or has expired");
  });

  it("ignores unknown status values instead of displaying them", async () => {
    render(await SignInPage(params({ status: "<script>alert(1)</script>" })));
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toContain("<script>");
  });

  it("sanitises the `next` parameter", async () => {
    const { container } = render(await SignInPage(params({ next: "https://evil.example" })));
    const hidden = container.querySelector<HTMLInputElement>('input[name="next"]');
    expect(hidden?.value).toBe("/dashboard");
  });
});
