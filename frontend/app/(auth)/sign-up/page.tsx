import type { Metadata } from "next";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { PublicShell } from "@/components/shell/public-shell";
import { ButtonLink } from "@/components/ui/primitives";
import { signUp } from "@/lib/auth/actions";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Create an account · AI Wellness Egypt" };

/**
 * A signed-in visitor (identity verified from their own session) is told they
 * already have an account. Anonymous visitors always get the same form and the
 * same "check your email" page, so nobody learns whether an email is registered.
 */
export default async function SignUpPage() {
  const [{ locale, t }, session] = await Promise.all([getMessages(), getVerifiedSession()]);

  if (session) {
    return (
      <PublicShell locale={locale} t={t} title={t.auth.alreadySignedInTitle}>
        <p role="status">{t.auth.alreadySignedInBody}</p>
        <ButtonLink href="/dashboard" full>
          {t.auth.continueToDashboard}
        </ButtonLink>
      </PublicShell>
    );
  }

  return (
    <PublicShell locale={locale} t={t} title={t.auth.signUpTitle}>
      <p className="text-sm text-ink-muted">{t.auth.signUpIntro}</p>
      <SignUpForm action={signUp} locale={locale} />
    </PublicShell>
  );
}
