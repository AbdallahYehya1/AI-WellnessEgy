import type { Metadata } from "next";

import { PublicShell } from "@/components/shell/public-shell";
import { Notice, TextLink } from "@/components/ui/primitives";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Check your email · AI Wellness Egypt" };

const COPY = {
  en: {
    lead: "Confirm your email address to finish creating your account.",
    body: "If this email address can be used for a new account, we've sent it a confirmation link. Open the link on this device and in this browser, then sign in.",
    spam: "Can't find it? Check your spam folder, and allow a few minutes for it to arrive.",
  },
  ar: {
    lead: "أكّد بريدك الإلكتروني علشان تكمّل إنشاء حسابك.",
    body: "لو البريد ده ينفع لحساب جديد، بعتناله لينك تأكيد. افتح اللينك على نفس الجهاز ونفس المتصفح، وبعدين سجّل الدخول.",
    spam: "مش لاقيه؟ شوف فولدر الـ spam، واستنى كام دقيقة.",
  },
} as const;

// The same page is shown whether or not the email was already registered, so
// it never reveals account existence; it points existing users to sign-in and
// password reset instead.
export default async function CheckEmailPage() {
  const { locale, t } = await getMessages();
  const copy = COPY[locale];
  return (
    <PublicShell locale={locale} t={t} title={t.auth.checkEmailTitle}>
      <Notice tone="info">
        <p className="font-semibold">{copy.lead}</p>
        <p className="mt-2">{copy.body}</p>
        <p className="mt-2">{copy.spam}</p>
      </Notice>
      <p className="text-sm">{t.auth.existingAccountHint}</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <TextLink href="/sign-in">{t.forms.backToSignIn}</TextLink>
        <TextLink href="/forgot-password">{t.auth.forgotPasswordLink}</TextLink>
      </div>
    </PublicShell>
  );
}
