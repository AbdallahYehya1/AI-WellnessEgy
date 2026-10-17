import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/onboarding/profile-form";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { PublicShell } from "@/components/shell/public-shell";
import { fetchMyConsent, fetchProfile } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { saveProfile } from "@/lib/onboarding/actions";

export const metadata: Metadata = { title: "Your profile · AI Wellness Egypt" };

export default async function OnboardingProfilePage() {
  const { locale, t } = await getMessages();
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/onboarding");

  const [consent, profile] = await Promise.all([
    fetchMyConsent(session.accessToken),
    fetchProfile(session.accessToken),
  ]);
  if (!consent.ok && consent.status === 401) redirect("/sign-in?next=/onboarding");
  if (!consent.ok || !profile.ok) return <ServiceUnavailable t={t} />;
  if (consent.data.status === "granted") redirect("/dashboard");

  return (
    <PublicShell locale={locale} t={t} title={t.onboarding.profileTitle}>
      <StepIndicator step={1} t={t} />
      <ProfileForm action={saveProfile} initialDisplayName={profile.data.display_name} locale={locale} />
    </PublicShell>
  );
}
