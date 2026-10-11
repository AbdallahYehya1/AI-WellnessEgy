import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/form-parts";
import { MoodForm } from "@/components/mood/mood-form";
import { MoodHistory } from "@/components/mood/mood-history";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { fetchMoodHistory, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { submitMoodCheckin } from "@/lib/mood/actions";
import { CHECK_IN_PATH } from "@/lib/mood/score";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Check in · AI Wellness Egypt" };

const RECENT_LIMIT = 7;

export default async function CheckInPage() {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHECK_IN_PATH}`);

  // Consent gate: mood data is only collected after the current consent is accepted.
  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect(`/sign-in?next=${CHECK_IN_PATH}`);
    return <ServiceUnavailable />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const history = await fetchMoodHistory(session.accessToken, RECENT_LIMIT);

  return (
    // Arabic title is provisional copy pending native review (D-19, D-31).
    <AuthShell titleAr="عامل إيه النهارده؟" title="Daily check-in">
      <p className="text-sm">
        A quick check-in about how you feel right now. It is not a medical assessment and is
        not used to diagnose anything.
      </p>
      <MoodForm action={submitMoodCheckin} />
      <Link href="/dashboard" className="inline-block text-sm font-medium text-calm-700 underline">
        Skip for now
      </Link>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Your recent check-ins</h2>
        {history.ok ? (
          <MoodHistory checkins={history.data.checkins} />
        ) : (
          <p role="status" className="text-sm text-calm-700">
            Your recent check-ins can&apos;t be loaded right now.
          </p>
        )}
      </section>
    </AuthShell>
  );
}
