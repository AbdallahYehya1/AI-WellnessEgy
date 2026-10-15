// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { randomBytes } from "node:crypto";

import { verifyRecoveryMarker } from "@/lib/auth/recovery";
import { authError, createFakeAuth, TEST_SESSION_ID, TEST_USER, type FakeAuth } from "@/test/supabase-mock";

let auth: FakeAuth;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));

const { GET } = await import("@/app/auth/confirm/route");

async function respond(query: string) {
  const response = await GET(new NextRequest(`http://localhost:3000/auth/confirm${query}`));
  expect(response.status).toBe(307);
  return response;
}

async function visit(query: string): Promise<URL> {
  return new URL((await respond(query)).headers.get("location") ?? "");
}

const RECOVERED = {
  user: { id: TEST_USER.sub },
  session: { access_token: "recovery-access-token", user: { id: TEST_USER.sub } },
};

beforeEach(() => {
  auth = createFakeAuth();
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("RECOVERY_MARKER_SECRET", randomBytes(32).toString("base64url"));
});

describe("GET /auth/confirm", () => {
  it("exchanges a PKCE code and continues to the dashboard", async () => {
    const target = await visit("?code=abc123&next=/dashboard");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(target.pathname).toBe("/dashboard");
  });

  it("verifies a token_hash sign-up link", async () => {
    const target = await visit("?token_hash=hash123&type=signup");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "hash123" });
    expect(target.pathname).toBe("/dashboard");
  });

  it("asks the user to sign in when the code can't be exchanged", async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: {},
      error: authError("bad_code_verifier"),
    } as never);
    const target = await visit("?code=abc123");
    expect(target.pathname).toBe("/sign-in");
    expect(target.searchParams.get("status")).toBe("sign-in-to-continue");
  });

  it("reports an invalid or expired token_hash link", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: {}, error: authError("otp_expired") } as never);
    const target = await visit("?token_hash=old&type=signup");
    expect(target.searchParams.get("status")).toBe("confirmation-failed");
  });

  it("reports an error forwarded by Supabase without calling it again", async () => {
    const target = await visit("?error=access_denied&error_code=otp_expired&code=abc");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(target.searchParams.get("status")).toBe("confirmation-failed");
  });

  it.each(["invite", "magiclink", "email_change"])(
    "rejects email types other than sign-up and recovery (%s)",
    async (type) => {
      const target = await visit(`?token_hash=hash123&type=${type}`);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(target.searchParams.get("status")).toBe("confirmation-failed");
    },
  );

  it("never redirects off-site", async () => {
    const target = await visit("?code=abc123&next=https://evil.example");
    expect(target.origin).toBe("http://localhost:3000");
    expect(target.pathname).toBe("/dashboard");
  });

  it("treats a request with no parameters as a failed confirmation", async () => {
    expect((await visit("")).searchParams.get("status")).toBe("confirmation-failed");
  });
});

describe("GET /auth/confirm: password recovery", () => {
  const SESSION = { userId: TEST_USER.sub, sessionId: TEST_SESSION_ID };

  function markerOf(response: Response): string | undefined {
    const header = response.headers.get("set-cookie") ?? "";
    return /aw_password_reset=([^;]+)/.exec(header)?.[1];
  }

  function recoveryExchange() {
    // The token Supabase returned verifies to a session for TEST_USER.
    auth = createFakeAuth({ signedIn: true });
    auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { ...RECOVERED, redirectType: "recovery" },
      error: null,
    } as never);
  }

  it("issues a signed marker bound to the verified user and session", async () => {
    recoveryExchange();
    const response = await respond("?code=abc123&next=/reset-password");
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.pathname).toBe("/reset-password");
    expect(target.search).toBe("");
    expect(auth.getClaims).toHaveBeenCalledWith("recovery-access-token");
    const marker = markerOf(response);
    expect(marker).toBeDefined();
    expect(marker).not.toBe(TEST_USER.sub);
    expect(verifyRecoveryMarker(marker, SESSION).ok).toBe(true);
    expect(verifyRecoveryMarker(marker, { ...SESSION, sessionId: "another-session" }).ok).toBe(false);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/reset-password/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it("recognises a recovery code even without next=/reset-password", async () => {
    recoveryExchange();
    expect((await visit("?code=abc123")).pathname).toBe("/reset-password");
  });

  it("verifies a token_hash recovery link and issues the marker", async () => {
    auth = createFakeAuth({ signedIn: true });
    auth.verifyOtp.mockResolvedValueOnce({ data: RECOVERED, error: null } as never);
    const response = await respond("?token_hash=hash123&type=recovery");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "hash123" });
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/reset-password");
    expect(verifyRecoveryMarker(markerOf(response), SESSION).ok).toBe(true);
  });

  it("never opens the reset page just because next=/reset-password (sign-up code)", async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({ data: RECOVERED, error: null } as never);
    const response = await respond("?code=abc123&next=/reset-password");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/dashboard");
    expect(markerOf(response)).toBeUndefined();
  });

  it.each([
    ["an expired or reused token_hash", "?token_hash=old&type=recovery", "verifyOtp"],
    ["a code that can't be exchanged (other browser or host)", "?code=abc&next=/reset-password", "exchangeCodeForSession"],
  ] as const)("sends %s to the invalid-link page", async (_, query, method) => {
    auth[method].mockResolvedValueOnce({ data: {}, error: authError("otp_expired") } as never);
    const response = await respond(query);
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.pathname).toBe("/forgot-password");
    expect(target.searchParams.get("status")).toBe("link-invalid");
    expect(markerOf(response)).toBeUndefined();
  });

  it("reports a reset link that Supabase already rejected, without calling it", async () => {
    const target = await visit("?error=access_denied&error_code=otp_expired&next=/reset-password");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(target.pathname).toBe("/forgot-password");
    expect(target.searchParams.get("status")).toBe("link-invalid");
  });

  it("fails closed when the verified recovery returned no session", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: null } as never);
    const response = await respond("?token_hash=hash123&type=recovery");
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("status")).toBe("link-invalid");
    expect(markerOf(response)).toBeUndefined();
  });

  it("fails closed when the returned token doesn't verify", async () => {
    recoveryExchange();
    auth.getClaims.mockResolvedValueOnce({ data: null, error: authError("bad_jwt", 401) } as never);
    const response = await respond("?code=abc123");
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("status")).toBe("link-invalid");
    expect(markerOf(response)).toBeUndefined();
  });

  it("fails closed when marker signing isn't configured", async () => {
    vi.stubEnv("RECOVERY_MARKER_SECRET", "");
    recoveryExchange();
    const response = await respond("?code=abc123");
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.pathname).toBe("/forgot-password");
    expect(target.searchParams.get("status")).toBe("unavailable");
    expect(markerOf(response)).toBeUndefined();
  });

  it("never redirects a recovery off-site", async () => {
    recoveryExchange();
    const target = await visit("?code=abc123&next=https://evil.example/reset-password");
    expect(target.origin).toBe("http://localhost:3000");
    expect(target.pathname).toBe("/reset-password");
  });
});
