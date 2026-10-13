import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyRecoveryMarker, type MarkerCheck } from "@/lib/auth/recovery";

export type RecoveryGate = MarkerCheck | { ok: false; reason: "no-session" | "session-revoked" };

/**
 * Whether the current request may use the recovery-only reset page/action.
 *
 * Three independent checks must agree:
 * 1. getClaims(): the access token is valid (verified locally via JWKS);
 *    gives the user id and Supabase session id.
 * 2. getUser(): the Auth server still accepts the session. getClaims() alone
 *    can't see a revoked session: a retained access token keeps verifying
 *    until it expires.
 * 3. The signed recovery marker matches that user and session.
 *
 * This only authorises our UI and action. Supabase still authorises the
 * password change itself (updateUser).
 */
export async function checkRecoverySession(
  supabase: SupabaseClient,
  marker: string | undefined,
): Promise<RecoveryGate> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : undefined;
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : undefined;
  if (!userId || !sessionId) return { ok: false, reason: "no-session" };

  const markerCheck = verifyRecoveryMarker(marker, { userId, sessionId });
  if (!markerCheck.ok) return markerCheck;

  const { data: live, error } = await supabase.auth.getUser();
  if (error || live?.user?.id !== userId) return { ok: false, reason: "session-revoked" };
  return markerCheck;
}
