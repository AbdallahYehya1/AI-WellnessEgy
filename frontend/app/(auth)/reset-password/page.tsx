import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { PublicShell } from "@/components/shell/public-shell";
import { ButtonLink, Notice } from "@/components/ui/primitives";
import { FORGOT_PASSWORD_PATH, RECOVERY_COOKIE } from "@/lib/auth/recovery";
import { updatePassword } from "@/lib/auth/recovery-actions";
import { checkRecoverySession } from "@/lib/auth/recovery-session";
import { getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password · AI Wellness Egypt" };

const COPY = {
  en: {
    intro: "Choose a new password for your account. After saving, you'll be signed out and your other sessions will be ended. Then sign in with the new password.",
    invalid: "This page only works straight after you open a password-reset link, and that link is invalid, has expired or was already used.",
    requestNew: "Request a new reset link",
  },
  ar: {
    intro: "اختار كلمة سر جديدة لحسابك. بعد الحفظ هيتسجّل خروجك وهنوقف جلساتك التانية. وبعدين سجّل الدخول بكلمة السر الجديدة.",
    invalid: "الصفحة دي بتشتغل بس بعد ما تفتح لينك إعادة تعيين كلمة السر على طول، واللينك ده مش صالح أو انتهى أو اتستخدم قبل كده.",
    requestNew: "اطلب لينك جديد",
  },
} as const;

/**
 * Reachable only straight after a verified recovery link: it needs a live
 * session plus the signed recovery marker that /auth/confirm issued for that
 * same user and session. An ordinary signed-in session is not enough.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const { locale, t } = await getMessages();
  const copy = COPY[locale];
  const allowed = supabase
    ? (await checkRecoverySession(supabase, cookieStore.get(RECOVERY_COOKIE)?.value)).ok
    : false;

  return (
    <PublicShell locale={locale} t={t} title={t.auth.resetTitle}>
      {allowed ? (
        <>
          <p className="text-sm text-ink-muted">{copy.intro}</p>
          <ResetPasswordForm action={updatePassword} locale={locale} />
        </>
      ) : (
        <>
          <Notice tone="danger">{copy.invalid}</Notice>
          <ButtonLink href={FORGOT_PASSWORD_PATH} full>
            {copy.requestNew}
          </ButtonLink>
        </>
      )}
    </PublicShell>
  );
}
