import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsentForm } from "@/components/onboarding/consent-form";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { PublicShell } from "@/components/shell/public-shell";
import { Notice } from "@/components/ui/primitives";
import { fetchCurrentConsent, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { submitConsent } from "@/lib/onboarding/actions";
import { ONBOARDING_CONSENT } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Terms · AI Wellness Egypt" };

export default async function OnboardingConsentPage() {
  const { locale, t } = await getMessages();
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${ONBOARDING_CONSENT}`);

  const [current, mine] = await Promise.all([fetchCurrentConsent(), fetchMyConsent(session.accessToken)]);
  if (!mine.ok && mine.status === 401) redirect(`/sign-in?next=${ONBOARDING_CONSENT}`);
  if (!current.ok || !mine.ok) return <ServiceUnavailable t={t} />;
  if (mine.data.status === "granted") redirect("/dashboard");

  const doc = current.data;
  return (
    <PublicShell locale={locale} t={t} title={t.onboarding.consentTitle}>
      <StepIndicator step={2} t={t} />
      {mine.data.status === "outdated" ? <Notice tone="info">{t.onboarding.outdated}</Notice> : null}

      {/* The terms text is legal wording: shown exactly as written, in English,
          until a reviewed translation exists (D-11, D-19). */}
      {t.onboarding.termsLanguageNote ? (
        <p className="text-sm text-ink-muted">{t.onboarding.termsLanguageNote}</p>
      ) : null}
      <article lang="en" dir="ltr" className="space-y-3 rounded-xl border border-line bg-surface-muted p-5 text-start text-sm leading-relaxed">
        {doc.pending_legal_review ? (
          <p data-testid="draft-notice" className="rounded-lg bg-warning-bg px-3 py-2 font-semibold text-warning-ink">
            DRAFT, NOT FINAL. The full terms and privacy wording for this service have not been written yet and are
            pending legal review. This placeholder must not be used for a public launch.
          </p>
        ) : null}
        <p>
          AI Wellness Egypt is a wellness-support service for adults (18+). It is not a medical service. It does not
          diagnose conditions or recommend medication, and it is not a replacement for professional or emergency care.
        </p>
        <p className="text-xs text-ink-muted">
          Version {doc.version} · published {doc.published_at.slice(0, 10)}
        </p>
      </article>

      <ConsentForm action={submitConsent} version={doc.version} locale={locale} />
    </PublicShell>
  );
}
