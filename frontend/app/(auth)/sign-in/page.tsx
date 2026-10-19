import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/sign-in-form";
import { PublicShell } from "@/components/shell/public-shell";
import { Notice } from "@/components/ui/primitives";
import { signIn } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/validation";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Sign in · AI Wellness Egypt" };

// Only these fixed notices can be shown; the query string can't inject text.
const NOTICES: Record<Locale, Record<string, { tone: "info" | "danger"; text: string }>> = {
  en: {
    "signed-out": { tone: "info", text: "You've been signed out." },
    "password-updated": {
      tone: "info",
      text: "Your password has been updated. We've also ended your other sessions, which can take a little while to apply on every device. Sign in with your new password.",
    },
    confirmed: { tone: "info", text: "Your email address is confirmed. Sign in to continue." },
    "sign-in-to-continue": { tone: "info", text: "If you just confirmed your email, sign in below to continue." },
    "confirmation-failed": {
      tone: "danger",
      text: "That confirmation link is invalid or has expired. Try signing in, or sign up again to get a new link.",
    },
  },
  ar: {
    "signed-out": { tone: "info", text: "اتسجّل خروجك." },
    "password-updated": {
      tone: "info",
      text: "كلمة السر اتغيّرت. وقفنا كمان جلساتك التانية، وده ممكن ياخد شوية وقت علشان يتطبق على كل الأجهزة. سجّل الدخول بكلمة السر الجديدة.",
    },
    confirmed: { tone: "info", text: "بريدك الإلكتروني اتأكّد. سجّل الدخول علشان تكمّل." },
    "sign-in-to-continue": { tone: "info", text: "لو لسه مأكّد بريدك، سجّل الدخول تحت علشان تكمّل." },
    "confirmation-failed": {
      tone: "danger",
      text: "لينك التأكيد ده مش صالح أو انتهى. جرّب تسجّل الدخول، أو اعمل حساب تاني علشان يوصلك لينك جديد.",
    },
  },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const { locale, t } = await getMessages();
  const status = typeof params.status === "string" ? params.status : undefined;
  const notice = status ? NOTICES[locale][status] : undefined;

  return (
    <PublicShell locale={locale} t={t} title={t.auth.signInTitle}>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <SignInForm action={signIn} next={safeNextPath(params.next)} locale={locale} />
    </PublicShell>
  );
}
