import { vi } from "vitest";

// A stand-in for the parts of the Supabase auth client the app uses.
// Tests configure return values per case; nothing touches the network.

export const TEST_USER = {
  sub: "7d8f7b0e-3c1a-4b8e-9d2f-5a6c7e8f9a0b",
  email: "person@example.com",
};

export type FakeAuth = ReturnType<typeof createFakeAuth>;

export function createFakeAuth(options: { signedIn?: boolean } = {}) {
  const claims = options.signedIn ? { ...TEST_USER, role: "authenticated", aud: "authenticated" } : null;
  return {
    getClaims: vi.fn(async () => ({ data: claims ? { claims } : null, error: null })),
    getSession: vi.fn(async () => ({
      data: { session: claims ? { access_token: "test-access-token" } : null },
      error: null,
    })),
    signUp: vi.fn(async () => ({ data: { user: { id: TEST_USER.sub }, session: null }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
  };
}

export function authError(code: string, status = 400, message = "raw provider message: internal detail") {
  return { name: "AuthApiError", code, status, message };
}

/** Error thrown by our `redirect` mock, mirroring Next's NEXT_REDIRECT. */
export class RedirectError extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

export const redirectMock = vi.fn((url: string): never => {
  throw new RedirectError(url);
});

export async function expectRedirect(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectError) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}
