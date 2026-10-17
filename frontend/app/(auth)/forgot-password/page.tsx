import type { Metadata } from "next";
import { headers } from "next/headers";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { PublicShell } from "@/components/shell/public-shell";
import { Notice } from "@/components/ui/primitives";
import { requestPasswordReset } from "@/lib/auth/recovery-actions";
import { siteUrl } from "@/lib/auth/site-url";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Reset your password · AI Wellness Egypt" };

// Only these fixed notices can be shown; the query string can't inject text.
// "sent" is shown for every request, whether or not an account exists. The
// email link itself is one-time and expires (Supabase); our page marker is
// short-lived but not single-use (see README "Password recovery").
const NOTICES: Record<Locale, Record<string, { tone: "info" | "danger"; text: string }>> = {
  en: {
    sent: {
      tone: "info",
      text: "If an account exists for that email, we've sent it a link to reset your password. The email link expires soon and can be used once. Open it in this browser.",
    },
    "link-invalid": {
      tone: "danger",
      text: "That reset link is invalid, has expired or was already used. Request a new one below.",
    },
    unavailable: { tone: "danger", text: "Password reset isn't available right now. Please try again later." },
  },
  ar: {
    sent: {
      tone: "info",
      text: "لو فيه حساب بالبريد ده، بعتناله لينك لإعادة تعيين كلمة السر. اللينك بينتهي بسرعة وبيشتغل مرة واحدة. افتحه في نفس المتصفح ده.",
    },
    "link-invalid": {
      tone: "danger",
      text: "لينك إعادة التعيين ده مش صالح أو انتهى أو اتستخدم قبل كده. اطلب لينك جديد من تحت.",
    },
    unavailable: { tone: "danger", text: "إعادة تعيين كلمة السر مش متاحة دلوقتي. حاول تاني بعدين." },
  },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** In development only: warn when this page's host differs from SITE_URL, which breaks the link. */
async function hostMismatch(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  const host = (await headers()).get("host");
  const expected = new URL(siteUrl()).host;
  return host && host !== expected ? expected : null;
}

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const { locale, t } = await getMessages();
  const status = typeof params.status === "string" ? params.status : undefined;
  const notice = status ? NOTICES[locale][status] : undefined;
  const expectedHost = await hostMismatch();

  return (
    <PublicShell locale={locale} t={t} title={t.auth.forgotTitle}>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {expectedHost ? (
        <Notice tone="warning" role="note" data-testid="host-mismatch">
          <span lang="en" dir="ltr">
            Development note: reset links open at {expectedHost}. Request the reset from that same
            address, or the link can&apos;t be completed in this browser.
          </span>
        </Notice>
      ) : null}
      <ForgotPasswordForm action={requestPasswordReset} locale={locale} />
    </PublicShell>
  );
}
