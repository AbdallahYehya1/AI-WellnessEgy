import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  RECOVERY_COOKIE,
  RESET_LINK_INVALID,
  RESET_PASSWORD_PATH,
  RESET_UNAVAILABLE,
  issueRecoveryMarker,
  recoveryCookieOptions,
} from "@/lib/auth/recovery";
import { safeNextPath } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

// Email types this route accepts: sign-up confirmation and password recovery.
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>(["signup", "email", "recovery"]);

function accessTokenOf(data: unknown): string | null {
  const token = (data as { session?: { access_token?: unknown } | null } | null)?.session?.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

// supabase-js returns `redirectType: "recovery"` when the PKCE verifier stored
// in this browser was created by resetPasswordForEmail(). It is not part of
// the published AuthTokenResponse type, so read it defensively.
function isRecoveryExchange(data: unknown): boolean {
  return (data as { redirectType?: unknown } | null)?.redirectType === "recovery";
}

/**
 * Target of the email links. Supports both Supabase formats:
 *
 * - `?code=...`: the default template. Supabase verifies the link, then
 *   redirects here with a PKCE code, exchanged using the code-verifier
 *   cookie set when the email was requested (so it must be opened in the
 *   same browser, on the same host).
 * - `?token_hash=...&type=signup|recovery`: a customised template that links
 *   here directly. It works in any browser.
 *
 * A recovery is recognised only from Supabase's own signal (the recovery
 * verifier, or a verified `type=recovery` token), never from `next`. Only
 * then is the reset-page marker issued. `next` only chooses which failure
 * page to show.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const wantsReset = next === RESET_PASSWORD_PATH;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Supabase reports expired or already-used links with `error` params.
  const providerError = searchParams.has("error") || searchParams.has("error_code");

  const supabase = await createClient();
  let outcome: "signed-in" | "sign-in-to-continue" | "confirmation-failed" = "confirmation-failed";
  // The access token Supabase returned for a verified recovery, if any.
  let recoveryToken: string | null = null;
  let recoveryExchanged = false;

  if (supabase && !providerError && code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    // With the default template Supabase has already confirmed the address
    // before redirecting here, so a failed exchange (e.g. link opened in
    // another browser) usually just means the user must sign in.
    outcome = error ? "sign-in-to-continue" : "signed-in";
    if (!error && isRecoveryExchange(data)) {
      recoveryExchanged = true;
      recoveryToken = accessTokenOf(data);
    }
  } else if (supabase && !providerError && tokenHash && type && ALLOWED_OTP_TYPES.has(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    outcome = error ? "confirmation-failed" : "signed-in";
    if (!error && type === "recovery") recoveryToken = accessTokenOf(data);
  }

  const destination = request.nextUrl.clone();
  destination.search = "";

  if (supabase && recoveryToken) {
    // Verify the token Supabase just issued and bind the marker to its user
    // and session. Fails closed without signing configuration or claims.
    const { data: verified } = await supabase.auth.getClaims(recoveryToken);
    const claims = verified?.claims;
    const userId = typeof claims?.sub === "string" ? claims.sub : "";
    const sessionId = typeof claims?.session_id === "string" ? claims.session_id : "";
    const marker = userId && sessionId ? issueRecoveryMarker(userId, sessionId) : null;
    if (marker) {
      destination.pathname = RESET_PASSWORD_PATH;
      const response = NextResponse.redirect(destination);
      response.cookies.set(RECOVERY_COOKIE, marker, recoveryCookieOptions());
      return response;
    }
    const failure = new URL(userId && sessionId ? RESET_UNAVAILABLE : RESET_LINK_INVALID, request.nextUrl.origin);
    destination.pathname = failure.pathname;
    destination.search = failure.search;
    return NextResponse.redirect(destination);
  }

  // A confirmed sign-up (never a recovery, even with `next=/reset-password`):
  // end the session the link created and send the user to sign in explicitly,
  // with a confirmation notice. Signing in is the user's own, deliberate step.
  const signedInWithoutRecovery = outcome === "signed-in" && !recoveryExchanged && type !== "recovery";
  if (supabase && signedInWithoutRecovery) {
    await supabase.auth.signOut({ scope: "local" });
    destination.pathname = "/sign-in";
    destination.searchParams.set("status", "confirmed");
    return NextResponse.redirect(destination);
  }

  if (wantsReset || type === "recovery" || recoveryExchanged) {
    // A reset link that couldn't be verified: expired, reused, opened in
    // another browser or host, or verified without a session.
    const target = new URL(RESET_LINK_INVALID, request.nextUrl.origin);
    destination.pathname = target.pathname;
    destination.search = target.search;
    return NextResponse.redirect(destination);
  }

  destination.pathname = "/sign-in";
  destination.searchParams.set("status", outcome === "signed-in" ? "confirmed" : outcome);
  return NextResponse.redirect(destination);
}

