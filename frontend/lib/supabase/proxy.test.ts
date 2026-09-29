// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAuth, type FakeAuth } from "@/test/supabase-mock";

type CookieMethods = {
  getAll: () => { name: string; value: string }[];
  setAll: (
    cookies: { name: string; value: string; options: Record<string, unknown> }[],
    headers: Record<string, string>,
  ) => void;
};

let auth: FakeAuth;
let cookieMethods: CookieMethods | undefined;
let refreshCookieOnGetClaims = false;

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: { cookies: CookieMethods }) => {
    cookieMethods = options.cookies;
    return {
      auth: {
        ...auth,
        getClaims: vi.fn(async () => {
          if (refreshCookieOnGetClaims) {
            cookieMethods?.setAll(
              [{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }],
              { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
            );
          }
          return auth.getClaims();
        }),
      },
    };
  }),
}));

const { updateSession } = await import("@/lib/supabase/proxy");

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

function location(response: Response): URL | null {
  const value = response.headers.get("location");
  return value ? new URL(value) : null;
}

describe("updateSession (proxy)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    auth = createFakeAuth();
    refreshCookieOnGetClaims = false;
  });

  it("redirects an unauthenticated visitor from the dashboard to sign-in", async () => {
    const response = await updateSession(request("/dashboard"));
    const target = location(response);
    expect(response.status).toBe(307);
    expect(target?.pathname).toBe("/sign-in");
    expect(target?.searchParams.get("next")).toBe("/dashboard");
  });

  it("protects the onboarding steps too", async () => {
    for (const path of ["/onboarding", "/onboarding/consent"]) {
      const target = location(await updateSession(request(path)));
      expect(target?.pathname).toBe("/sign-in");
      expect(target?.searchParams.get("next")).toBe(path);
    }
    auth = createFakeAuth({ signedIn: true });
    expect(location(await updateSession(request("/onboarding/consent")))).toBeNull();
  });

  it("keeps the requested path and query in `next`", async () => {
    const target = location(await updateSession(request("/dashboard/week?view=1")));
    expect(target?.searchParams.get("next")).toBe("/dashboard/week?view=1");
  });

  it("lets an authenticated session reach the dashboard", async () => {
    auth = createFakeAuth({ signedIn: true });
    const response = await updateSession(request("/dashboard"));
    expect(location(response)).toBeNull();
    expect(response.status).toBe(200);
  });

  it("verifies the session with getClaims, not the raw cookie", async () => {
    await updateSession(request("/dashboard"));
    expect(auth.getClaims).toHaveBeenCalledOnce();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("sends a signed-in user away from the auth pages", async () => {
    auth = createFakeAuth({ signedIn: true });
    for (const path of ["/sign-in", "/sign-up"]) {
      expect(location(await updateSession(request(path)))?.pathname).toBe("/dashboard");
    }
  });

  it("leaves public pages alone for anonymous visitors", async () => {
    for (const path of ["/", "/sign-in", "/sign-up", "/auth/check-email"]) {
      expect(location(await updateSession(request(path)))).toBeNull();
    }
  });

  it("does not treat look-alike paths as protected", async () => {
    expect(location(await updateSession(request("/dashboards-info")))).toBeNull();
  });

  it("writes refreshed session cookies onto the response", async () => {
    auth = createFakeAuth({ signedIn: true });
    refreshCookieOnGetClaims = true;
    const response = await updateSession(request("/dashboard"));
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("keeps refreshed cookies when it also redirects", async () => {
    refreshCookieOnGetClaims = true;
    const response = await updateSession(request("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });

  it("removes dashboard access once the session is signed out", async () => {
    auth = createFakeAuth({ signedIn: true });
    expect(location(await updateSession(request("/dashboard")))).toBeNull();

    auth = createFakeAuth({ signedIn: false }); // cookies cleared by signOut()
    expect(location(await updateSession(request("/dashboard")))?.pathname).toBe("/sign-in");
  });

  it("fails closed when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await updateSession(request("/dashboard"));
    expect(location(response)?.pathname).toBe("/sign-in");
    expect(location(await updateSession(request("/")))).toBeNull();
  });
});
