import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { AuthShell } from "@/components/auth/form-parts";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { FORGOT_PASSWORD_PATH, RECOVERY_COOKIE } from "@/lib/auth/recovery";
import { updatePassword } from "@/lib/auth/recovery-actions";
import { checkRecoverySession } from "@/lib/auth/recovery-session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password · AI Wellness Egypt" };

/**
 * Reachable only straight after a verified recovery link: it needs a live
 * session plus the signed recovery marker that /auth/confirm issued for that
 * same user and session. An ordinary signed-in session is not enough.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const allowed = supabase
    ? (await checkRecoverySession(supabase, cookieStore.get(RECOVERY_COOKIE)?.value)).ok
    : false;

  return (
    // Arabic title is provisional copy pending native review (D-19).
    <AuthShell titleAr="كلمة سر جديدة" title="Choose a new password">
      {allowed ? (
        <>
          <p className="text-sm">
            Choose a new password for your account. After saving, you&apos;ll be signed out and your
            other sessions will be ended. Then sign in with the new password.
          </p>
          <ResetPasswordForm action={updatePassword} />
        </>
      ) : (
        <>
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            This page only works straight after you open a password-reset link, and that link is
            invalid, has expired or was already used.
          </p>
          <Link
            href={FORGOT_PASSWORD_PATH}
            className="inline-block text-sm font-medium text-calm-700 underline"
          >
            Request a new reset link
          </Link>
        </>
      )}
    </AuthShell>
  );
}
