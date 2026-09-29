import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

// Email types this route accepts. M2 only sends sign-up confirmations.
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>(["signup", "email"]);

/**
 * Target of the confirmation email link. Supports both Supabase formats:
 *
 * - `?code=...`: the default template. Supabase verifies the email, then
 *   redirects here with a PKCE code, exchanged using the code-verifier
 *   cookie set at sign-up (so it must be opened in the same browser).
 * - `?token_hash=...&type=signup`: a customised template that links here
 *   directly. It works in any browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Supabase reports expired or already-used links with `error` params.
  const providerError = searchParams.has("error") || searchParams.has("error_code");

  const supabase = await createClient();
  let outcome: "signed-in" | "sign-in-to-continue" | "confirmation-failed" = "confirmation-failed";

  if (supabase && !providerError && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // With the default template Supabase has already confirmed the address
    // before redirecting here, so a failed exchange (e.g. link opened in
    // another browser) usually just means the user must sign in.
    outcome = error ? "sign-in-to-continue" : "signed-in";
  } else if (supabase && !providerError && tokenHash && type && ALLOWED_OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    outcome = error ? "confirmation-failed" : "signed-in";
  }

  const destination = request.nextUrl.clone();
  destination.search = "";
  if (outcome === "signed-in") {
    const target = new URL(next, request.nextUrl.origin);
    destination.pathname = target.pathname;
    destination.search = target.search;
  } else {
    destination.pathname = "/sign-in";
    destination.searchParams.set("status", outcome);
  }
  return NextResponse.redirect(destination);
}
