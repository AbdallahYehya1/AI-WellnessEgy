import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { siteUrl } from "@/lib/auth/site-url";

// Password recovery (M6.0).
//
// A recovery link gives the browser an ordinary Supabase session, and nothing
// in that session marks it as a recovery session. So the reset page and its
// action also require a recovery marker: a short-lived, httpOnly cookie that
// only /auth/confirm issues, only after Supabase has verified a recovery link.
//
// The marker is signed with HMAC-SHA256 using RECOVERY_MARKER_SECRET (server
// only) and binds the user id, the Supabase session id, an expiry and a random
// token id. Without the secret it can't be forged, and it only works for the
// session that verified the recovery link.
//
// It is NOT strictly single-use: nothing server-side records its consumption.
// After a successful reset every session is signed out, and the reset gate
// asks the Auth server whether the session is still live (getUser), so a
// replay with that revoked session is refused. Within its lifetime, before a
// successful reset, the same session can use it more than once.

export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";
export const RESET_LINK_INVALID = `${FORGOT_PASSWORD_PATH}?status=link-invalid`;
export const RESET_UNAVAILABLE = `${FORGOT_PASSWORD_PATH}?status=unavailable`;

export const RECOVERY_COOKIE = "aw_password_reset";
export const RECOVERY_TTL_SECONDS = 10 * 60;
const MARKER_VERSION = "v1";
const MIN_SECRET_BYTES = 32;

/** Where the reset email sends the user: our confirm route, on the configured site origin. */
export function recoveryRedirectUrl(): string {
  return `${siteUrl()}/auth/confirm?next=${RESET_PASSWORD_PATH}`;
}

export function recoveryCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: siteUrl().startsWith("https://"),
    path: RESET_PASSWORD_PATH,
    maxAge: RECOVERY_TTL_SECONDS,
  };
}

/**
 * The signing key, or null when it is missing or too weak (recovery then fails
 * closed). Expected: at least 32 random bytes, base64url-encoded, e.g.
 * `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
 */
export function recoverySecret(): Buffer | null {
  const raw = process.env.RECOVERY_MARKER_SECRET?.trim();
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const key = Buffer.from(raw, "base64url");
  if (key.length < MIN_SECRET_BYTES) return null;
  // Reject obviously non-random keys (e.g. one repeated character).
  if (new Set(key).size < 8) return null;
  return key;
}

export function recoveryConfigured(): boolean {
  return recoverySecret() !== null;
}

type MarkerPayload = { sub: string; sid: string; exp: number; jti: string };

function sign(key: Buffer, body: string): Buffer {
  return createHmac("sha256", key).update(body).digest();
}

/** Issue a marker for a verified recovery session. Returns null when signing isn't configured. */
export function issueRecoveryMarker(
  userId: string,
  sessionId: string,
  now: number = Date.now(),
): string | null {
  const key = recoverySecret();
  if (!key || !userId || !sessionId) return null;
  const payload: MarkerPayload = {
    sub: userId,
    sid: sessionId,
    exp: Math.floor(now / 1000) + RECOVERY_TTL_SECONDS,
    jti: randomBytes(16).toString("base64url"),
  };
  const body = `${MARKER_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${sign(key, body).toString("base64url")}`;
}

export type MarkerCheck =
  | { ok: true; tokenId: string }
  | { ok: false; reason: "unconfigured" | "missing" | "malformed" | "signature" | "expired" | "mismatch" };

/** Verify a marker against the current session's user id and session id. */
export function verifyRecoveryMarker(
  marker: string | undefined,
  session: { userId?: string; sessionId?: string },
  now: number = Date.now(),
): MarkerCheck {
  const key = recoverySecret();
  if (!key) return { ok: false, reason: "unconfigured" };
  if (!marker) return { ok: false, reason: "missing" };

  const [version, encoded, signature, ...rest] = marker.split(".");
  if (version !== MARKER_VERSION || !encoded || !signature || rest.length > 0) {
    return { ok: false, reason: "malformed" };
  }
  const expected = sign(key, `${version}.${encoded}`);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature" };
  }

  let payload: Partial<MarkerPayload>;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<MarkerPayload>;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.jti !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.exp <= Math.floor(now / 1000)) return { ok: false, reason: "expired" };
  if (payload.sub !== session.userId || payload.sid !== session.sessionId) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, tokenId: payload.jti };
}
