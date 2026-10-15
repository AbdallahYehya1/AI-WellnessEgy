"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { MESSAGES, passwordUpdateOutcome, resetRequestOutcome } from "@/lib/auth/errors";
import {
  RECOVERY_COOKIE,
  RESET_LINK_INVALID,
  RESET_UNAVAILABLE,
  recoveryConfigured,
  recoveryCookieOptions,
  recoveryRedirectUrl,
} from "@/lib/auth/recovery";
import { checkRecoverySession } from "@/lib/auth/recovery-session";
import {
  hasErrors,
  readNewPassword,
  validateEmail,
  validateNewPassword,
  type FieldErrors,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export type ResetRequestState = { fieldErrors?: FieldErrors; formError?: string; email?: string };
export type NewPasswordState = { fieldErrors?: FieldErrors; formError?: string };

export async function requestPasswordReset(
  _: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim() : "";
  const emailError = validateEmail(email);
  if (emailError) return { fieldErrors: { email: emailError }, email };

  const supabase = await createClient();
  if (!supabase) return { formError: MESSAGES.notConfigured, email };
  // Without the marker-signing secret a link could never be completed, so
  // don't send one (fails closed).
  if (!recoveryConfigured()) return { formError: MESSAGES.resetUnavailable, email };

  // PKCE: supabase-js stores a code verifier (marked as a recovery flow) in a
  // cookie on this host, so the link must be opened in this browser.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: recoveryRedirectUrl(),
  });
  const outcome = resetRequestOutcome(error);
  if (outcome.kind === "error") return { formError: outcome.message, email };
  redirect("/forgot-password?status=sent");
}

export async function updatePassword(
  _: NewPasswordState,
  formData: FormData,
): Promise<NewPasswordState> {
  const supabase = await createClient();
  if (!supabase) return { formError: MESSAGES.notConfigured };

  // Re-check the session and the signed recovery marker: the page check
  // alone is not enough, because a server action can be called directly.
  const cookieStore = await cookies();
  const gate = await checkRecoverySession(supabase, cookieStore.get(RECOVERY_COOKIE)?.value);
  if (!gate.ok) redirect(gate.reason === "unconfigured" ? RESET_UNAVAILABLE : RESET_LINK_INVALID);

  // Passwords are never echoed back or logged.
  const input = readNewPassword(formData);
  const fieldErrors = validateNewPassword(input);
  if (hasErrors(fieldErrors)) return { fieldErrors };

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) {
    const outcome = passwordUpdateOutcome(error);
    if (outcome.kind === "expired") {
      cookieStore.delete({ name: RECOVERY_COOKIE, path: recoveryCookieOptions().path });
      redirect(RESET_LINK_INVALID);
    }
    return outcome.kind === "field"
      ? { fieldErrors: { password: outcome.message } }
      : { formError: outcome.message };
  }

  // Remove the marker from this browser and end all sessions. Global
  // sign-out revokes the sessions' refresh tokens on the Auth server; access
  // tokens already issued stay valid until they expire, which is why the
  // reset gate also checks the session with getUser().
  cookieStore.delete({ name: RECOVERY_COOKIE, path: recoveryCookieOptions().path });
  await supabase.auth.signOut({ scope: "global" });
  redirect("/sign-in?status=password-updated");
}
