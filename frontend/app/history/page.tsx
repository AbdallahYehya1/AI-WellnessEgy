import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MoodChart } from "@/components/mood/mood-chart";
import { formatCheckinTime } from "@/components/mood/mood-history";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMoodHistory, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Your progress · AI Wellness Egypt" };

const HISTORY_LIMIT = 30;

/** The user's own check-ins only: their ratings, never an interpretation or score about them. */
export default async function HistoryPage() {
  const { locale, t } = await getMessages();
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/history");

  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect("/sign-in?next=/history");
    return <ServiceUnavailable t={t} />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const [history, chat] = await Promise.all([
    fetchMoodHistory(session.accessToken, HISTORY_LIMIT),
    fetchChatConfig(session.accessToken),
  ]);
  const h = t.history;

  return (
    <AppShell current="history" locale={locale} t={t} chatEnabled={Boolean(chat?.ok && chat.data.enabled)}>
      <PageHeader title={h.title} intro={h.intro} />
      {!history.ok ? (
        <Card>
          <p role="status" className="text-sm text-ink-muted">
            {h.unavailable}
          </p>
        </Card>
      ) : history.data.checkins.length === 0 ? (
        <EmptyState title={h.empty} action={<ButtonLink href="/check-in">{h.emptyAction}</ButtonLink>} />
      ) : (
        <>
          {history.data.checkins.length >= 2 ? (
            <Card>
              <MoodChart checkins={history.data.checkins} locale={locale} />
            </Card>
          ) : null}
          <Card>
            <table className="w-full text-sm">
              <caption className="mb-2 text-start text-lg font-bold">{h.tableCaption}</caption>
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th scope="col" className="py-2 text-start font-semibold">
                    {h.when}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {h.score}
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.data.checkins.map((c) => (
                  <tr key={c.checkin_id} className="border-b border-line last:border-0">
                    <td className="py-2.5">
                      <time dateTime={c.submitted_at}>{formatCheckinTime(c.submitted_at, locale)}</time>
                    </td>
                    <td className="py-2.5 text-end font-semibold" dir="ltr">
                      {c.mood_score} / 5
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </AppShell>
  );
}
