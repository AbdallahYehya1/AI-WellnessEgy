import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/form-parts";
import { ProfileForm } from "@/components/onboarding/profile-form";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { fetchMyConsent, fetchProfile } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { saveProfile } from "@/lib/onboarding/actions";

export const metadata: Metadata = { title: "Your profile · AI Wellness Egypt" };

export default async function OnboardingProfilePage() {
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/onboarding");

  const [consent, profile] = await Promise.all([
    fetchMyConsent(session.accessToken),
    fetchProfile(session.accessToken),
  ]);
  if (!consent.ok && consent.status === 401) redirect("/sign-in?next=/onboarding");
  if (!consent.ok || !profile.ok) return <ServiceUnavailable />;
  if (consent.data.status === "granted") redirect("/dashboard");

  return (
    <AuthShell titleAr="ملفك الشخصي" title="Set up your profile">
      <p className="text-sm text-calm-700">Step 1 of 2</p>
      <ProfileForm action={saveProfile} initialDisplayName={profile.data.display_name} />
    </AuthShell>
  );
}
