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

const { default: SignInPage } = await import("@/app/(auth)/sign-in/page");
const { default: CheckEmailPage } = await import("@/app/auth/check-email/page");

function params(values: Record<string, string>) {
  return { searchParams: Promise.resolve(values) };
}

describe("check-email page", () => {
  it("shows the confirmation-pending state after sign-up", () => {
    render(<CheckEmailPage />);
    expect(screen.getByRole("status").textContent).toContain(
      "Confirm your email address to finish creating your account.",
    );
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
