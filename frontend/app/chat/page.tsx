import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";

import { type ChatActions, ChatWorkspace } from "@/components/chat/workspace";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { ButtonLink } from "@/components/ui/primitives";
import { type ConversationPage, fetchChatConfig, fetchMyConsent, listConversations } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import {
  deleteAllChats,
  deleteChat,
  loadConversations,
  openConversation,
  renameChat,
  sendChat,
  setHistoryEnabled,
} from "@/lib/chat/actions";
import { CHAT_PATH } from "@/lib/chat/limits";
import { getMessages } from "@/lib/i18n/server";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Assistant (prototype) · AI Wellness Egypt" };

// The on-screen keyboard resizes the layout, so the composer stays visible above it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

const ACTIONS: ChatActions = {
  send: sendChat,
  loadConversations,
  openConversation,
  renameChat,
  deleteChat,
  deleteAllChats,
  setHistoryEnabled,
};

/**
 * Adult-only prototype, disabled unless the server enables it. Every safety decision
 * is made by the backend. Returning users get only their conversation list here; a
 * conversation's messages load when they open it.
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
  const data = config.data;

  if (!data.enabled) {
    return (
      <AppShell current="chat" locale={locale} t={t} chatEnabled={false}>
        <h1 className="text-xl font-bold">{c.title}</h1>
        <p role="status" className="text-ink-muted">
          {c.unavailableYet}
        </p>
        <ButtonLink href="/dashboard" variant="secondary">
          {t.common.backToDashboard}
        </ButtonLink>
      </AppShell>
    );
  }

  let initialConversations: ConversationPage | null = null;
  if (data.history?.available) {
    const list = await listConversations(session.accessToken);
    initialConversations = list.ok ? list.data : null;
  }

  const modeNote =
    data.generator === "model"
      ? c.modelMode.replace("{model}", data.model ?? "AI")
      : data.test_only_policy || data.generator
        ? c.testMode
        : null;

  return (
    <AppShell current="chat" locale={locale} t={t} chatEnabled workspace>
      <ChatWorkspace
        actions={ACTIONS}
        locale={locale}
        suggestions={(data.demo_prompts ?? []).map((p) => ({
          id: p.prompt_id,
          text: locale === "ar" ? p.ar : p.en,
          followUp: p.follow_up,
        }))}
        topics={data.supported_topics ?? []}
        typedInput={data.typed_input ?? "topics"}
        modeNote={modeNote}
        history={data.history ?? null}
        initialConversations={initialConversations}
      />
    </AppShell>
  );
}
