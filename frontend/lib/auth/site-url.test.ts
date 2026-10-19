// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { siteUrl } = await import("@/lib/auth/site-url");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("prefers the configured SITE_URL, without a trailing slash", () => {
    vi.stubEnv("SITE_URL", "https://ai-wellness-egy.vercel.app/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "other.vercel.app");
    expect(siteUrl()).toBe("https://ai-wellness-egy.vercel.app");
  });

  it("falls back to Vercel's production domain instead of localhost", () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "ai-wellness-egy.vercel.app");
    expect(siteUrl()).toBe("https://ai-wellness-egy.vercel.app");
  });

  it("ignores a malformed Vercel value", () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "evil.example/path?x=1");
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("uses localhost only for local development", () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});
