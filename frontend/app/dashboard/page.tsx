import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { cairoDay, MoodHistory } from "@/components/mood/mood-history";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { ButtonLink, Card, Notice, PageHeader, TextLink } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMe, fetchMoodHistory, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/messages";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Home · AI Wellness Egypt" };

const RECENT_LIMIT = 7;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  // Fixed notice only: the query string can't inject text.
  const checkedIn = params.status === "checked-in";
  const { locale, t } = await getMessages();

  // The proxy already guards this route; check again here in case the
  // proxy is bypassed or misconfigured.
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/dashboard");

  // Consent gate: nothing below is shown until the API confirms that the
  // current consent version has been accepted. Fails closed.
  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect("/sign-in?next=/dashboard");
    return <ServiceUnavailable t={t} />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const [me, history, chat] = await Promise.all([
    fetchMe(session.accessToken),
    fetchMoodHistory(session.accessToken, RECENT_LIMIT),
    fetchChatConfig(session.accessToken),
  ]);
  // The assistant entry only appears when the server reports chat as enabled.
  const chatEnabled = Boolean(chat?.ok && chat.data.enabled);
  if (me.status !== "ok") return <ServiceUnavailable t={t} />;
  const name = me.me.display_name;
  const d = t.dashboard;
  const latest = history.ok ? history.data.checkins[0] : undefined;
  const checkedInToday = latest ? cairoDay(latest.submitted_at) === cairoDay(new Date()) : false;

  return (
    <AppShell current="home" locale={locale} t={t} chatEnabled={chatEnabled}>
      <PageHeader
        title={name ? format(d.greetingNamed, { name }) : d.greeting}
        intro={d.intro}
      />
      {checkedIn ? <Notice tone="success">{d.checkInSaved}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {chatEnabled ? (
          <Card className="sm:col-span-2" aria-labelledby="assistant-title">
            <h2 id="assistant-title" className="text-lg font-bold">
              {d.assistantTitle}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{d.assistantBody}</p>
            <ButtonLink href="/chat" className="mt-4">
              {d.assistantAction}
            </ButtonLink>
          </Card>
        ) : null}

        <Card aria-labelledby="checkin-title">
          <h2 id="checkin-title" className="text-lg font-bold">
            {d.checkInTitle}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{checkedInToday ? d.checkedInToday : d.checkInBody}</p>
          <ButtonLink href="/check-in" variant={chatEnabled || checkedInToday ? "secondary" : "primary"} className="mt-4">
            {d.checkInAction}
          </ButtonLink>
        </Card>

        <Card aria-labelledby="progress-title">
          <h2 id="progress-title" className="text-lg font-bold">
            {d.progressTitle}
          </h2>
          <div className="mt-2">
            {history.ok ? (
              <MoodHistory checkins={history.data.checkins.slice(0, 3)} locale={locale} />
            ) : (
              <p className="text-sm text-ink-muted">{d.historyUnavailable}</p>
            )}
          </div>
          <TextLink href="/history" className="mt-3">
            {d.progressAction}
          </TextLink>
        </Card>

        {!chatEnabled ? (
          <Card aria-labelledby="assistant-off-title">
            <h2 id="assistant-off-title" className="text-lg font-bold">
              {d.assistantTitle}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{d.assistantUnavailable}</p>
          </Card>
        ) : null}

        <Card aria-labelledby="settings-title">
          <h2 id="settings-title" className="text-lg font-bold">
            {d.settingsTitle}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{d.settingsBody}</p>
          <TextLink href="/settings" className="mt-3">
            {d.settingsAction}
          </TextLink>
        </Card>
      </div>
    </AppShell>
  );
}
