import { describe, expect, it } from "vitest";

import { MESSAGES, signInErrorMessage, signUpErrorOutcome } from "@/lib/auth/errors";

describe("signInErrorMessage", () => {
  it("never returns the provider's raw message", () => {
    const raw = { code: "unexpected_failure", status: 500, message: "db: relation auth.users ..." };
    expect(signInErrorMessage(raw)).toBe(MESSAGES.signInFailed);
  });

  it("treats any 429 as rate limiting", () => {
    expect(signInErrorMessage({ code: null, status: 429 })).toBe(MESSAGES.rateLimited);
  });

  it("has a fallback for missing error details", () => {
    expect(signInErrorMessage(undefined)).toBe(MESSAGES.signInFailed);
  });
});

describe("signUpErrorOutcome", () => {
  it.each(["user_already_exists", "email_exists"])(
    "treats %s as a normal pending confirmation",
    (code) => {
      expect(signUpErrorOutcome({ code, status: 422 })).toEqual({ kind: "pending_confirmation" });
    },
  );

  it.each([
    ["weak_password", MESSAGES.weakPassword],
    ["email_address_invalid", MESSAGES.invalidEmail],
    ["signup_disabled", MESSAGES.signUpUnavailable],
    ["over_email_send_rate_limit", MESSAGES.rateLimited],
    ["something_new", MESSAGES.signUpFailed],
  ])("maps %s to a safe message", (code, message) => {
    expect(signUpErrorOutcome({ code, status: 400 })).toEqual({ kind: "error", message });
  });
});
