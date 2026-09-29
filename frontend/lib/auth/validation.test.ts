import { describe, expect, it } from "vitest";

import { safeNextPath, validateEmail, validateSignIn, validateSignUp } from "@/lib/auth/validation";

describe("validateEmail", () => {
  it.each(["person@example.com", "first.last+tag@sub.example.org"])("accepts %s", (email) => {
    expect(validateEmail(email)).toBeUndefined();
  });

  it.each(["", "person", "person@", "@example.com", "a b@example.com", `${"a".repeat(250)}@x.io`])(
    "rejects %j",
    (email) => {
      expect(validateEmail(email)).toBeDefined();
    },
  );
});

describe("validateSignUp", () => {
  const valid = {
    email: "person@example.com",
    password: "a-long-password",
    confirmPassword: "a-long-password",
    ageConfirmed: true,
  };

  it("accepts valid input", () => {
    expect(validateSignUp(valid)).toEqual({});
  });

  it("rejects passwords over bcrypt's 72-byte limit, counting bytes not characters", () => {
    const arabic = "س".repeat(37); // 37 characters, 74 bytes in UTF-8
    expect(validateSignUp({ ...valid, password: arabic, confirmPassword: arabic }).password).toBe(
      "That password is too long. Use a shorter one.",
    );
  });

  it("requires the 18+ confirmation", () => {
    expect(validateSignUp({ ...valid, ageConfirmed: false }).ageConfirmed).toBeDefined();
  });
});

describe("validateSignIn", () => {
  it("does not apply sign-up length rules to existing passwords", () => {
    expect(validateSignIn({ email: "person@example.com", password: "short" })).toEqual({});
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/dashboard/week?view=1", "/dashboard/week?view=1"],
  ])("keeps the local path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "dashboard",
    "https://evil.example/x",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\u0000",
    "javascript:alert(1)",
    ["/dashboard"],
  ])("falls back for %j", (input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });
});
