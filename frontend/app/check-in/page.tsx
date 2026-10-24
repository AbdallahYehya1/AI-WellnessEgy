import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MoodHistory } from "@/components/mood/mood-history";
import { ReflectionForm } from "@/components/mood/reflection-form";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { Card, PageHeader, TextLink } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMoodHistory, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { submitReflection } from "@/lib/mood/actions";
import { CHECK_IN_PATH } from "@/lib/mood/score";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Daily Reflection · AI Wellness Egypt" };

const RECENT_LIMIT = 7;

export default async function CheckInPage() {
  const { locale, t } = await getMessages();
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHECK_IN_PATH}`);

  // Consent gate: reflections are only collected after the current consent is accepted.
  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect(`/sign-in?next=${CHECK_IN_PATH}`);
    return <ServiceUnavailable t={t} />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const [history, chat] = await Promise.all([
    fetchMoodHistory(session.accessToken, RECENT_LIMIT),
    fetchChatConfig(session.accessToken),
  ]);
  const r = t.reflection;
  const chatEnabled = Boolean(chat?.ok && chat.data.enabled);
  const assistantNames = Object.fromEntries(
    (chat?.ok && chatEnabled ? (chat.data.assistants ?? []) : [])
      .filter((a) => a.status === "ready")
      .map((a) => [a.assistant_id, locale === "ar" ? a.name_ar : a.name_en]),
  );

  return (
    <AppShell current="check-in" locale={locale} t={t} chatEnabled={chatEnabled}>
      <PageHeader title={r.title} />
      <Card>
        <ReflectionForm action={submitReflection} locale={locale} assistantNames={assistantNames} />
        <TextLink href="/dashboard" className="mt-4">
          {t.checkIn.skip}
        </TextLink>
      </Card>
      <Card aria-labelledby="recent-title">
        <h2 id="recent-title" className="mb-2 text-lg font-bold">
          {r.recentTitle}
        </h2>
        {history.ok ? (
          <MoodHistory checkins={history.data.checkins} locale={locale} />
        ) : (
          <p role="status" className="text-sm text-ink-muted">
            {r.recentUnavailable}
          </p>
        )}
      </Card>
    </AppShell>
  );
}
