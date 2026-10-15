import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/form-parts";
import { ChatClient } from "@/components/chat/chat-client";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { fetchChatConfig, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { sendChat } from "@/lib/chat/actions";
import { CHAT_PATH } from "@/lib/chat/limits";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Assistant (prototype) · AI Wellness Egypt" };

export default async function ChatPage() {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHAT_PATH}`);

  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect(`/sign-in?next=${CHAT_PATH}`);
    return <ServiceUnavailable />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const config = await fetchChatConfig(session.accessToken);
  if (!config.ok) {
    if (config.status === 401) redirect(`/sign-in?next=${CHAT_PATH}`);
    return <ServiceUnavailable />;
  }

  return (
    // Arabic title is provisional copy pending native review (D-19).
    <AuthShell titleAr="مساعد العافية" title="Wellness assistant">
      <p className="flex gap-2 text-xs font-semibold">
        <span className="rounded bg-calm-100 px-2 py-0.5">{config.data.age_band_label}</span>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Prototype</span>
      </p>
      <p className="text-sm">
        This assistant shares general wellness information from reviewed sources. It is not a
        therapist or doctor, can&apos;t diagnose anything and can&apos;t advise on medication.
      </p>
      {config.data.test_only_policy ? (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs">
          Test mode: replies come from a scripted test generator and synthetic test content. They
          are not clinically reviewed.
        </p>
      ) : null}
      {config.data.enabled ? (
        <ChatClient send={sendChat} />
      ) : (
        <p role="status" className="text-sm text-calm-700">
          The assistant isn&apos;t available yet.
        </p>
      )}
      <Link href="/dashboard" className="inline-block text-sm font-medium text-calm-700 underline">
        Back to dashboard
      </Link>
    </AuthShell>
  );
}
