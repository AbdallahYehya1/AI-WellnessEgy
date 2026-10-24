import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InsightsView } from "@/components/mood/insights-view";
import { MoodChart } from "@/components/mood/mood-chart";
import { formatCheckinTime, MoodHistory } from "@/components/mood/mood-history";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMoodHistory, fetchMoodInsights, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { cairoOffsetMinutes } from "@/lib/mood/time";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Your reflections · AI Wellness Egypt" };

const HISTORY_LIMIT = 30;

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** The user's own reflections: descriptive summaries in their words, never a score about them. */
export default async function HistoryPage({ searchParams }: Props = {}) {
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

  const params = (await searchParams) ?? {};
  const period = params.period === "month" ? "month" : "week";
  const [history, insights, chat] = await Promise.all([
    fetchMoodHistory(session.accessToken, HISTORY_LIMIT),
    fetchMoodInsights(session.accessToken, period, cairoOffsetMinutes()),
    fetchChatConfig(session.accessToken),
  ]);
  const i = t.insights;
  const h = t.history;
  const legacy = history.ok ? history.data.checkins.filter((c) => c.mood_score !== null && c.kind !== "reflection") : [];

  return (
    <AppShell current="history" locale={locale} t={t} chatEnabled={Boolean(chat?.ok && chat.data.enabled)}>
      <PageHeader title={i.title} intro={i.intro} />
      {!history.ok ? (
        <Card>
          <p role="status" className="text-sm text-ink-muted">
            {i.unavailable}
          </p>
        </Card>
      ) : history.data.checkins.length === 0 ? (
        <EmptyState title={i.empty} action={<ButtonLink href="/check-in">{i.emptyAction}</ButtonLink>} />
      ) : (
        <>
          <Card>
            <nav aria-label={i.periodLabel} className="mb-5 flex gap-2">
              {(["week", "month"] as const).map((p) => (
                <Link
                  key={p}
                  href={`/history?period=${p}`}
                  aria-current={p === period ? "page" : undefined}
                  className="inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-muted aria-[current=page]:border-primary aria-[current=page]:bg-surface-muted aria-[current=page]:text-primary-strong"
                >
                  {p === "week" ? i.week : i.month}
                </Link>
              ))}
            </nav>
            {insights.ok ? (
              <InsightsView insights={insights.data} locale={locale} />
            ) : (
              <p role="status" className="text-sm text-ink-muted">
                {i.unavailable}
              </p>
            )}
          </Card>
          {legacy.length >= 2 ? (
            <Card>
              <MoodChart checkins={legacy} locale={locale} />
              <table className="mt-4 w-full text-sm">
                <caption className="mb-2 text-start font-semibold">{h.tableCaption}</caption>
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
                  {legacy.map((c) => (
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
          ) : null}
          <Card aria-labelledby="entries-title">
            <h2 id="entries-title" className="mb-2 text-lg font-bold">
              {i.entriesTitle}
            </h2>
            <MoodHistory checkins={history.data.checkins} locale={locale} />
          </Card>
        </>
      )}
    </AppShell>
  );
}
