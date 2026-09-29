// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authError, createFakeAuth, type FakeAuth } from "@/test/supabase-mock";

let auth: FakeAuth;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));

const { GET } = await import("@/app/auth/confirm/route");

async function visit(query: string): Promise<URL> {
  const response = await GET(new NextRequest(`http://localhost:3000/auth/confirm${query}`));
  expect(response.status).toBe(307);
  return new URL(response.headers.get("location") ?? "");
}

beforeEach(() => {
  auth = createFakeAuth();
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

  it("rejects email types other than sign-up confirmation", async () => {
    const target = await visit("?token_hash=hash123&type=recovery");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(target.searchParams.get("status")).toBe("confirmation-failed");
  });

  it("never redirects off-site", async () => {
    const target = await visit("?code=abc123&next=https://evil.example");
    expect(target.origin).toBe("http://localhost:3000");
    expect(target.pathname).toBe("/dashboard");
  });

  it("treats a request with no parameters as a failed confirmation", async () => {
    expect((await visit("")).searchParams.get("status")).toBe("confirmation-failed");
  });
});
