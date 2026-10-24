import { describe, expect, it } from "vitest";

import { cairoOffsetMinutes } from "@/lib/mood/time";

describe("cairoOffsetMinutes", () => {
  it("follows Egypt's daylight saving time", () => {
    expect(cairoOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(120);
    expect(cairoOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(180);
  });
});
