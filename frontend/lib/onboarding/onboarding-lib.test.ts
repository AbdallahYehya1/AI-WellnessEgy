import { describe, expect, it } from "vitest";

import { requiredOnboardingStep } from "@/lib/onboarding/steps";
import { validateDisplayName } from "@/lib/onboarding/validation";

describe("requiredOnboardingStep", () => {
  it.each([
    ["missing", "/onboarding"],
    ["declined", "/onboarding/consent"],
    ["outdated", "/onboarding/consent"],
    ["granted", null],
  ] as const)("%s → %s", (status, step) => {
    expect(requiredOnboardingStep(status)).toBe(step);
  });
});

describe("validateDisplayName", () => {
  it("trims and accepts Arabic and Latin names", () => {
    expect(validateDisplayName("  سلمى ")).toEqual({ value: "سلمى" });
    expect(validateDisplayName("Salma")).toEqual({ value: "Salma" });
  });

  it("treats blank input as no name", () => {
    expect(validateDisplayName("   ")).toEqual({ value: null });
  });

  it("counts characters, not UTF-16 units, for the length limit", () => {
    expect(validateDisplayName("😀".repeat(50)).error).toBeUndefined();
    expect(validateDisplayName("😀".repeat(51)).error).toBeDefined();
  });

  it.each(["tab\there", "new\nline", "zero​width", "nul\u0000"])("rejects %j", (name) => {
    expect(validateDisplayName(name).error).toBeDefined();
  });
});
