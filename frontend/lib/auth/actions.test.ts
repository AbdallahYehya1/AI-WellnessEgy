import { beforeEach, describe, expect, it, vi } from "vitest";

import { MESSAGES } from "@/lib/auth/errors";
import {
  authError,
  createFakeAuth,
  expectRedirect,
  redirectMock,
  type FakeAuth,
} from "@/test/supabase-mock";

let auth: FakeAuth;
let configured = true;

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => (configured ? { auth } : null)),
}));

const { signIn, signOut, signUp } = await import("@/lib/auth/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const validSignUp = {
  email: "person@example.com",
  password: "a-long-password",
  confirmPassword: "a-long-password",
  ageConfirmed: "on",
};

beforeEach(() => {
  auth = createFakeAuth();
  configured = true;
  vi.stubEnv("SITE_URL", "http://localhost:3000");
});

describe("signUp", () => {
  it("creates the account and shows the confirmation-pending page", async () => {
    const url = await expectRedirect(signUp({}, form(validSignUp)));
    expect(url).toBe("/auth/check-email");
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "a-long-password",
      options: { emailRedirectTo: "http://localhost:3000/auth/confirm?next=/dashboard" },
    });
  });

  it("does not reveal whether the email is already registered", async () => {
    auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: authError("user_already_exists", 422),
    } as never);
    expect(await expectRedirect(signUp({}, form(validSignUp)))).toBe("/auth/check-email");
  });

  it("validates input before calling Supabase", async () => {
    const state = await signUp(
      {},
      form({ email: "not-an-email", password: "short", confirmPassword: "different" }),
    );
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(state.fieldErrors).toEqual({
      email: expect.any(String),
      password: "Use at least 8 characters.",
      confirmPassword: "The passwords don't match.",
      ageConfirmed: "You must be 18 or older to create an account.",
    });
    expect(state.email).toBe("not-an-email");
  });

  it("requires the adult-age confirmation", async () => {
    const withoutAge = Object.fromEntries(
      Object.entries(validSignUp).filter(([key]) => key !== "ageConfirmed"),
    );
    const state = await signUp({}, form(withoutAge));
    expect(state.fieldErrors?.ageConfirmed).toBeDefined();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("maps provider errors to safe messages and never echoes the password", async () => {
    auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: authError("weak_password", 422),
    } as never);
    const state = await signUp({}, form(validSignUp));
    expect(state.formError).toBe(MESSAGES.weakPassword);
    expect(JSON.stringify(state)).not.toContain("a-long-password");
    expect(JSON.stringify(state)).not.toContain("raw provider message");
  });

  it("reports when sign-in is not configured", async () => {
    configured = false;
    expect((await signUp({}, form(validSignUp))).formError).toBe(MESSAGES.notConfigured);
  });
});

describe("signIn", () => {
  it("signs in and redirects to the dashboard", async () => {
    const url = await expectRedirect(
      signIn({}, form({ email: "person@example.com", password: "a-long-password" })),
    );
    expect(url).toBe("/dashboard");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "a-long-password",
    });
  });

  it("returns to a safe `next` path after sign-in", async () => {
    const data = form({ email: "person@example.com", password: "pw", next: "/dashboard/week" });
    expect(await expectRedirect(signIn({}, data))).toBe("/dashboard/week");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "ignores an unsafe `next` value (%s)",
    async (next) => {
      const data = form({ email: "person@example.com", password: "pw", next });
      expect(await expectRedirect(signIn({}, data))).toBe("/dashboard");
    },
  );

  it.each([
    ["invalid_credentials", 400, MESSAGES.invalidCredentials],
    ["email_not_confirmed", 400, MESSAGES.emailNotConfirmed],
    ["over_request_rate_limit", 429, MESSAGES.rateLimited],
    ["unexpected_failure", 500, MESSAGES.signInFailed],
  ])("shows a safe message for %s", async (code, status, message) => {
    auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: authError(code, status),
    } as never);
    const state = await signIn({}, form({ email: "person@example.com", password: "wrong-pass" }));
    expect(state.formError).toBe(message);
    expect(state.email).toBe("person@example.com");
    expect(JSON.stringify(state)).not.toContain("wrong-pass");
    expect(JSON.stringify(state)).not.toContain("raw provider message");
  });

  it("validates input before calling Supabase", async () => {
    const state = await signIn({}, form({ email: "", password: "" }));
    expect(state.fieldErrors).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("ends the Supabase session and returns to sign-in", async () => {
    const url = await expectRedirect(signOut());
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(url).toBe("/sign-in?status=signed-out");
  });
});
