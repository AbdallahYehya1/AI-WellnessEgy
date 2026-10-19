import { createHmac, randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MESSAGES, passwordUpdateOutcome, resetRequestOutcome } from "@/lib/auth/errors";
import {
  issueRecoveryMarker,
  recoveryConfigured,
  RECOVERY_TTL_SECONDS,
  verifyRecoveryMarker,
} from "@/lib/auth/recovery";
import { validateNewPassword } from "@/lib/auth/validation";
import {
  authError,
  createFakeAuth,
  expectRedirect,
  redirectMock,
  TEST_SESSION_ID,
  TEST_USER,
  type FakeAuth,
} from "@/test/supabase-mock";

let auth: FakeAuth;
let configured = true;
const jar = new Map<string, string>();
const cookieStore = {
  get: vi.fn((name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined)),
  delete: vi.fn((arg: string | { name: string }) => jar.delete(typeof arg === "string" ? arg : arg.name)),
};

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => (configured ? { auth } : null)),
}));

const { requestPasswordReset, updatePassword } = await import("@/lib/auth/recovery-actions");

const SECRET = randomBytes(32).toString("base64url");
const OTHER_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";
const NEW_PASSWORD = "a-brand-new-password";
const SESSION = { userId: TEST_USER.sub, sessionId: TEST_SESSION_ID };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function validMarker(userId = TEST_USER.sub, sessionId = TEST_SESSION_ID, now = Date.now()): string {
  const marker = issueRecoveryMarker(userId, sessionId, now);
  if (!marker) throw new Error("marker not issued");
  return marker;
}

/** Re-sign an arbitrary payload with a given key (used to build tampered/forged markers). */
function signWith(key: Buffer, payload: object): string {
  const body = `v1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

beforeEach(() => {
  auth = createFakeAuth({ signedIn: true });
  configured = true;
  jar.clear();
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("RECOVERY_MARKER_SECRET", SECRET);
});

// --- The signed marker -------------------------------------------------------------

describe("recovery marker", () => {
  it("accepts a marker issued for this user and session", () => {
    const check = verifyRecoveryMarker(validMarker(), SESSION);
    expect(check.ok).toBe(true);
  });

  it("gives each marker a random token id", () => {
    const a = verifyRecoveryMarker(validMarker(), SESSION);
    const b = verifyRecoveryMarker(validMarker(), SESSION);
    expect(a.ok && b.ok && a.tokenId !== b.tokenId).toBe(true);
  });

  it("rejects the original exploit: a cookie holding the user's id", () => {
    expect(verifyRecoveryMarker(TEST_USER.sub, SESSION)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a tampered payload (user id swapped, signature kept)", () => {
    const [version, , signature] = validMarker(OTHER_USER).split(".");
    const payload = Buffer.from(
      JSON.stringify({ sub: TEST_USER.sub, sid: TEST_SESSION_ID, exp: 9999999999, jti: "x" }),
    ).toString("base64url");
    expect(verifyRecoveryMarker(`${version}.${payload}.${signature}`, SESSION)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rejects a marker signed with a different key", () => {
    const forged = signWith(randomBytes(32), { sub: TEST_USER.sub, sid: TEST_SESSION_ID, exp: 9999999999, jti: "x" });
    expect(verifyRecoveryMarker(forged, SESSION)).toEqual({ ok: false, reason: "signature" });
  });

  it.each(["", "v1", "v1.abc", "v2.abc.def", "v1.abc.def.ghi", "v1..sig", "v1.payload.%%%"])(
    "rejects a malformed or truncated marker (%j)",
    (marker) => {
      expect(verifyRecoveryMarker(marker, SESSION).ok).toBe(false);
    },
  );

  it("rejects an expired marker", () => {
    const issued = Date.now() - (RECOVERY_TTL_SECONDS + 1) * 1000;
    expect(verifyRecoveryMarker(validMarker(TEST_USER.sub, TEST_SESSION_ID, issued), SESSION)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it.each([
    ["wrong user", { userId: OTHER_USER, sessionId: TEST_SESSION_ID }],
    ["wrong session", { userId: TEST_USER.sub, sessionId: OTHER_SESSION }],
    ["no session id", { userId: TEST_USER.sub, sessionId: undefined }],
  ])("rejects a valid marker presented by the %s", (_, session) => {
    expect(verifyRecoveryMarker(validMarker(), session)).toEqual({ ok: false, reason: "mismatch" });
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["too short (16 bytes)", randomBytes(16).toString("base64url")],
    ["too short in standard base64", randomBytes(16).toString("base64")],
    ["not base64", "this is not a key!"],
    ["low entropy", Buffer.alloc(32, 7).toString("base64url")],
    ["low entropy in standard base64", Buffer.alloc(32, 7).toString("base64")],
  ])("fails closed when the secret is %s", (_, value) => {
    vi.stubEnv("RECOVERY_MARKER_SECRET", value as string);
    expect(recoveryConfigured()).toBe(false);
    expect(issueRecoveryMarker(TEST_USER.sub, TEST_SESSION_ID)).toBeNull();
    expect(verifyRecoveryMarker("v1.a.b", SESSION)).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("accepts a standard-base64 secret (openssl rand -base64 32) with the same key", () => {
    const bytes = randomBytes(32);
    vi.stubEnv("RECOVERY_MARKER_SECRET", bytes.toString("base64"));
    expect(recoveryConfigured()).toBe(true);
    const marker = issueRecoveryMarker(TEST_USER.sub, TEST_SESSION_ID);
    expect(marker).not.toBeNull();
    // The same 32 bytes in base64url verify the same marker: one key, two spellings.
    vi.stubEnv("RECOVERY_MARKER_SECRET", bytes.toString("base64url"));
    expect(verifyRecoveryMarker(marker as string, SESSION)).toMatchObject({ ok: true });
  });

  it("stops accepting old markers when the secret is rotated", () => {
    const marker = validMarker();
    vi.stubEnv("RECOVERY_MARKER_SECRET", randomBytes(32).toString("base64url"));
    expect(verifyRecoveryMarker(marker, SESSION)).toEqual({ ok: false, reason: "signature" });
  });
});

// --- Requesting a reset email -------------------------------------------------------

describe("requestPasswordReset", () => {
  it("asks Supabase for a reset email that returns to our confirm route", async () => {
    const url = await expectRedirect(requestPasswordReset({}, form({ email: " person@example.com " })));
    expect(url).toBe("/forgot-password?status=sent");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("person@example.com", {
      redirectTo: "http://localhost:3000/auth/confirm?next=/reset-password",
    });
  });

  it.each([
    ["an unknown account", authError("user_not_found", 404)],
    ["an unconfirmed email", authError("email_not_confirmed", 400)],
    ["an unexpected 4xx", authError("unexpected_failure", 422)],
  ])("does not reveal %s: the same 'sent' page is shown", async (_, error) => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error } as never);
    expect(await expectRedirect(requestPasswordReset({}, form({ email: "x@example.com" })))).toBe(
      "/forgot-password?status=sent",
    );
  });

  it("validates the email before calling Supabase", async () => {
    const state = await requestPasswordReset({}, form({ email: "not-an-email" }));
    expect(state.fieldErrors?.email).toBe("Enter a valid email address, like name@example.com.");
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends no email when marker signing isn't configured", async () => {
    vi.stubEnv("RECOVERY_MARKER_SECRET", "");
    const state = await requestPasswordReset({}, form({ email: "person@example.com" }));
    expect(state.formError).toBe(MESSAGES.resetUnavailable);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it.each([
    [authError("over_email_send_rate_limit", 429), MESSAGES.rateLimited],
    [authError("unexpected_failure", 500), MESSAGES.resetEmailFailed],
  ])("shows account-independent failures", async (error, message) => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error } as never);
    const state = await requestPasswordReset({}, form({ email: "person@example.com" }));
    expect(state.formError).toBe(message);
    expect(state.email).toBe("person@example.com");
  });

  it("reports when auth is not configured", async () => {
    configured = false;
    expect((await requestPasswordReset({}, form({ email: "person@example.com" }))).formError).toBe(
      MESSAGES.notConfigured,
    );
  });
});

// --- Setting the new password ----------------------------------------------------------

describe("updatePassword", () => {
  const valid = { password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD };
  const INVALID = "/forgot-password?status=link-invalid";

  it("updates the password for a verified recovery session, clears the marker and signs out everywhere", async () => {
    jar.set("aw_password_reset", validMarker());
    const url = await expectRedirect(updatePassword({}, form(valid)));
    expect(url).toBe("/sign-in?status=password-updated");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: NEW_PASSWORD });
    expect(cookieStore.delete).toHaveBeenCalledWith({ name: "aw_password_reset", path: "/reset-password" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it.each([
    ["an ordinary signed-in session (no marker)", () => undefined],
    ["the original exploit: a cookie holding the user's id", () => jar.set("aw_password_reset", TEST_USER.sub)],
    ["a marker for another user", () => jar.set("aw_password_reset", validMarker(OTHER_USER))],
    ["a marker for another session", () => jar.set("aw_password_reset", validMarker(TEST_USER.sub, OTHER_SESSION))],
    ["an expired marker", () => jar.set("aw_password_reset", validMarker(TEST_USER.sub, TEST_SESSION_ID, Date.now() - 11 * 60 * 1000))],
    ["a marker signed with another key", () => jar.set("aw_password_reset", signWith(randomBytes(32), { sub: TEST_USER.sub, sid: TEST_SESSION_ID, exp: 9999999999, jti: "x" }))],
  ])("refuses %s without calling Supabase", async (_, arrange) => {
    arrange();
    expect(await expectRedirect(updatePassword({}, form(valid)))).toBe(INVALID);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses when there is no session", async () => {
    auth = createFakeAuth({ signedIn: false });
    jar.set("aw_password_reset", validMarker());
    expect(await expectRedirect(updatePassword({}, form(valid)))).toBe(INVALID);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a revoked session whose access token still verifies (replay after success)", async () => {
    // getClaims() still verifies the retained access token locally, but the
    // Auth server no longer knows the session.
    jar.set("aw_password_reset", validMarker());
    auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: authError("session_not_found", 403),
    } as never);
    expect(await expectRedirect(updatePassword({}, form(valid)))).toBe(INVALID);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is missing, even with a previously valid marker", async () => {
    jar.set("aw_password_reset", validMarker());
    vi.stubEnv("RECOVERY_MARKER_SECRET", "");
    expect(await expectRedirect(updatePassword({}, form(valid)))).toBe("/forgot-password?status=unavailable");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("validates before calling Supabase and never echoes passwords", async () => {
    jar.set("aw_password_reset", validMarker());
    const state = await updatePassword({}, form({ password: "short", confirmPassword: "different" }));
    expect(state.fieldErrors?.password).toBe("Use at least 8 characters.");
    expect(state.fieldErrors?.confirmPassword).toBe("The passwords don't match.");
    expect(JSON.stringify(state)).not.toContain("short");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [authError("same_password", 422), { fieldErrors: { password: MESSAGES.samePassword } }],
    [authError("weak_password", 422), { fieldErrors: { password: MESSAGES.weakPassword } }],
    [authError("unexpected_failure", 500), { formError: MESSAGES.passwordUpdateFailed }],
  ])("maps update errors to safe messages", async (error, expected) => {
    jar.set("aw_password_reset", validMarker());
    auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error } as never);
    expect(await updatePassword({}, form(valid))).toEqual(expected);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("treats a session lost during the update as an expired link and clears the marker", async () => {
    jar.set("aw_password_reset", validMarker());
    auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error: authError("session_not_found", 403) } as never);
    expect(await expectRedirect(updatePassword({}, form(valid)))).toBe(INVALID);
    expect(jar.has("aw_password_reset")).toBe(false);
  });
});

describe("recovery helpers", () => {
  it("shares the sign-up password rules", () => {
    expect(validateNewPassword({ password: "12345678", confirmPassword: "12345678" })).toEqual({});
    expect(validateNewPassword({ password: "x".repeat(73), confirmPassword: "x".repeat(73) }).password).toBe(
      "That password is too long. Use a shorter one.",
    );
  });

  it("reports 'sent' for a successful request", () => {
    expect(resetRequestOutcome(null)).toEqual({ kind: "sent" });
  });

  it("treats auth status 401 as an expired link", () => {
    expect(passwordUpdateOutcome(authError("anything", 401))).toEqual({ kind: "expired" });
  });
});
