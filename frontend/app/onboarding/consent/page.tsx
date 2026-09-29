import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/form-parts";
import { ConsentForm } from "@/components/onboarding/consent-form";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { fetchCurrentConsent, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { submitConsent } from "@/lib/onboarding/actions";
import { ONBOARDING_CONSENT } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Terms · AI Wellness Egypt" };

export default async function OnboardingConsentPage() {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${ONBOARDING_CONSENT}`);

  const [current, mine] = await Promise.all([
    fetchCurrentConsent(),
    fetchMyConsent(session.accessToken),
  ]);
  if (!mine.ok && mine.status === 401) redirect(`/sign-in?next=${ONBOARDING_CONSENT}`);
  if (!current.ok || !mine.ok) return <ServiceUnavailable />;
  if (mine.data.status === "granted") redirect("/dashboard");

  const doc = current.data;
  return (
    <AuthShell titleAr="الشروط والموافقة" title="Review and agree to the terms">
      <p className="text-sm text-calm-700">Step 2 of 2</p>
      {mine.data.status === "outdated" ? (
        <p role="status" className="rounded-md border border-calm-100 bg-white px-3 py-2 text-sm">
          The terms have changed since you last agreed. Please review and agree to the new
          version to continue.
        </p>
      ) : null}

      <article className="space-y-3 rounded-lg border border-calm-100 bg-white p-5 text-sm leading-relaxed">
        {doc.pending_legal_review ? (
          <p
            data-testid="draft-notice"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-900"
          >
            DRAFT, NOT FINAL. The full terms and privacy wording for this service have not been
            written yet and are pending legal review. This placeholder must not be used for a
            public launch.
          </p>
        ) : null}
        <p>
          AI Wellness Egypt is a wellness-support service for adults (18+). It is not a medical
          service. It does not diagnose conditions or recommend medication, and it is not a
          replacement for professional or emergency care.
        </p>
        <p className="text-xs text-calm-700">
          Version {doc.version} · published {doc.published_at.slice(0, 10)}
        </p>
      </article>

      <ConsentForm action={submitConsent} version={doc.version} />
    </AuthShell>
  );
}
