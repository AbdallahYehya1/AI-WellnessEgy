import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChatClient } from "@/components/chat/chat-client";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { Badge, ButtonLink, Notice } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { sendChat } from "@/lib/chat/actions";
import { CHAT_PATH } from "@/lib/chat/limits";
import { getMessages } from "@/lib/i18n/server";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Assistant (prototype) · AI Wellness Egypt" };

/**
 * Adult-only prototype, disabled unless the server enables it. Every safety
 * decision is made by the backend; this page only presents its responses.
 */
export default async function ChatPage() {
  const { locale, t } = await getMessages();
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHAT_PATH}`);

  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect(`/sign-in?next=${CHAT_PATH}`);
    return <ServiceUnavailable t={t} />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const config = await fetchChatConfig(session.accessToken);
  if (!config.ok) {
    if (config.status === 401) redirect(`/sign-in?next=${CHAT_PATH}`);
    return <ServiceUnavailable t={t} />;
  }
  const c = t.chat;
  const bandLabel = config.data.age_band === "adult" ? c.adult : config.data.age_band_label;

  return (
    <AppShell current="chat" locale={locale} t={t} chatEnabled={config.data.enabled} fullHeight>
      <header className="space-y-2 border-b border-line py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{c.title}</h1>
          <Badge tone="info">{bandLabel}</Badge>
          <Badge tone="warning">{t.common.prototype}</Badge>
        </div>
        <p className="text-sm text-ink-muted">{c.scope}</p>
        {config.data.enabled && (config.data.test_only_policy || config.data.generator) ? (
          <Notice tone="warning" role="note" className="py-2">
            {config.data.generator === "model"
              ? c.modelMode.replace("{model}", config.data.model ?? "AI")
              : c.testMode}
          </Notice>
        ) : null}
        {config.data.enabled ? <p className="text-xs text-ink-muted">{c.notSaved}</p> : null}
      </header>
      {config.data.enabled ? (
        <ChatClient
          send={sendChat}
          locale={locale}
          demoPrompts={
            config.data.demo_curated
              ? (config.data.demo_prompts ?? []).map((p) => ({
                  id: p.prompt_id,
                  text: locale === "ar" ? p.ar : p.en,
                  followUp: p.follow_up,
                }))
              : undefined
          }
        />
      ) : (
        <div className="space-y-4 py-6">
          <p role="status" className="text-ink-muted">
            {c.unavailableYet}
          </p>
          <ButtonLink href="/dashboard" variant="secondary">
            {t.common.backToDashboard}
          </ButtonLink>
        </div>
      )}
    </AppShell>
  );
}
