import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AssistantIcon } from "@/components/assistants/icons";
import { cairoDay, DISPLAY_TIME_ZONE, EntrySummary, formatCheckinTime } from "@/components/mood/mood-history";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { ArrowIcon, ChatIcon, LockIcon, SettingsIcon } from "@/components/shell/icons";
import { ButtonLink, Notice, TextLink, toneStyle } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMe, fetchMoodHistory, fetchMyConsent, listConversations } from "@/lib/api/backend";
import { identity } from "@/lib/assistants/catalog";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/messages";
import { EMOJI } from "@/lib/mood/score";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Home · AI Wellness Egypt" };

const RECENT_LIMIT = 7;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function cairoHour(): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: DISPLAY_TIME_ZONE }).format(new Date()));
}

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
  // The assistant entries only appear when the server reports chat as enabled.
  const chatEnabled = Boolean(chat?.ok && chat.data.enabled);
  if (me.status !== "ok") return <ServiceUnavailable t={t} />;
  const saving = chat?.ok ? chat.data.history : null;
  // Only the person's own saved chats (the API checks ownership); titles are theirs.
  const recentChats =
    chatEnabled && saving?.available ? await listConversations(session.accessToken, { limit: 4 }) : null;
  const conversations = recentChats?.ok ? recentChats.data.conversations : [];
  const assistants = chatEnabled && chat?.ok ? (chat.data.assistants ?? []).filter((a) => a.status === "ready") : [];
  const assistantName = (id?: string) => {
    const a = assistants.find((x) => x.assistant_id === id);
    return a ? (locale === "ar" ? a.name_ar : a.name_en) : "";
  };

  const name = me.me.display_name;
  const d = t.dashboard;
  const v = t.v2.dashboard;
  const r = t.reflection;
  const latest = history.ok ? history.data.checkins[0] : undefined;
  const checkedInToday = latest ? cairoDay(latest.submitted_at) === cairoDay(new Date()) : false;
  const hour = cairoHour();
  const daypart = hour < 12 ? v.morning : hour < 18 ? v.afternoon : v.evening;
  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", timeZone: DISPLAY_TIME_ZONE }).format(new Date(iso));

  return (
    <AppShell current="home" locale={locale} t={t} chatEnabled={chatEnabled} wide>
      <header className="enter space-y-2">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-accent-ink">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {daypart}
        </p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-[2.6rem]">
          {name ? format(d.greetingNamed, { name }) : d.greeting}
        </h1>
        <p className="text-base text-ink-muted sm:text-lg">{d.intro}</p>
      </header>
      {checkedIn ? <Notice tone="success">{d.checkInSaved}</Notice> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Today: Daily Reflection */}
        <section
          aria-labelledby="checkin-title"
          className="enter enter-1 relative overflow-hidden rounded-[2rem] border border-line bg-surface p-6 shadow-soft sm:p-8 lg:col-span-2"
        >
          <div aria-hidden className="pointer-events-none absolute -end-20 -top-24 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink-muted">{v.todayTitle}</p>
              <h2 id="checkin-title" className="text-2xl font-semibold tracking-tight">
                {checkedInToday ? d.checkInTitle : v.reflectionCta}
              </h2>
              <p className="max-w-md text-ink-muted">{checkedInToday ? d.checkedInToday : v.reflectionPrompt}</p>
              {checkedInToday && latest ? (
                <div className="pt-1 text-sm">
                  <EntrySummary checkin={latest} locale={locale} />
                </div>
              ) : null}
            </div>
            <ButtonLink href="/check-in" variant={checkedInToday ? "secondary" : "primary"} className="shrink-0">
              {d.checkInAction}
              <ArrowIcon />
            </ButtonLink>
          </div>
          {!checkedInToday ? (
            <ul aria-hidden className="relative mt-6 flex flex-wrap gap-2">
              {(["happy", "calm", "good", "okay", "tired", "anxious"] as const).map((e) => (
                <li key={e}>
                  <Link
                    href="/check-in"
                    tabIndex={-1}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1.5 text-sm text-ink-muted transition-all duration-300 hover:-translate-y-0.5 hover:border-primary hover:text-ink"
                  >
                    <span className="text-lg">{EMOJI[e]}</span>
                    {r.emotions[e]}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Privacy and saving */}
        <section aria-labelledby="privacy-title" className="enter enter-2 flex flex-col gap-3 rounded-[2rem] border border-line bg-surface p-6 shadow-soft">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary-strong">
            <LockIcon />
          </span>
          <h2 id="privacy-title" className="text-lg font-semibold">
            {v.privacyTitle}
          </h2>
          <p className="flex items-start gap-2 text-sm text-ink-muted">
            <span
              aria-hidden
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${saving?.available && saving.enabled ? "bg-success-ink" : "bg-line-strong"}`}
            />
            {!saving?.available ? v.historyUnknown : saving.enabled ? v.historyOn : v.historyOff}
          </p>
          <TextLink href="/settings" className="mt-auto">
            {v.manage}
          </TextLink>
        </section>

        {/* Continue a conversation */}
        {chatEnabled ? (
          <section aria-labelledby="continue-title" className="enter enter-2 rounded-[2rem] border border-line bg-surface p-6 shadow-soft lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h2 id="continue-title" className="text-lg font-semibold">
                {conversations.length > 0 ? v.continueTitle : d.assistantTitle}
              </h2>
              <TextLink href="/assistants">{t.v2.common.viewAll}</TextLink>
            </div>
            {conversations.length > 0 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {conversations.map((c) => {
                  const id = c.assistant_id ?? "emotional";
                  const tone = identity(id);
                  return (
                    <li key={c.conversation_id}>
                      <Link
                        href={`/chat?assistant=${id}`}
                        className="tone lift group flex items-center gap-3 rounded-2xl border border-line bg-canvas/60 p-3 hover:border-[var(--tone-line)]"
                        style={toneStyle(tone.hue, tone.chroma)}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tone-bg)] text-[var(--tone-ink)]">
                          <AssistantIcon name={assistants.find((a) => a.assistant_id === id)?.icon ?? "sparkles"} className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink" dir="auto">
                            {c.title}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">
                            {assistantName(id)} · {timeOf(c.last_activity_at)}
                          </span>
                        </span>
                        <ArrowIcon className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-3 space-y-4">
                <p className="text-sm text-ink-muted">{d.assistantBody}</p>
                <p className="text-sm text-ink-muted">{saving?.available ? v.continueEmpty : null}</p>
                <ButtonLink href="/assistants">
                  <ChatIcon className="h-4 w-4" />
                  {d.assistantAction}
                </ButtonLink>
              </div>
            )}
          </section>
        ) : (
          <section aria-labelledby="assistant-off-title" className="rounded-[2rem] border border-line bg-surface p-6 shadow-soft lg:col-span-2">
            <h2 id="assistant-off-title" className="text-lg font-semibold">
              {d.assistantTitle}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{d.assistantUnavailable}</p>
          </section>
        )}

        {/* Recent reflections */}
        <section aria-labelledby="progress-title" className="enter enter-3 flex flex-col rounded-[2rem] border border-line bg-surface p-6 shadow-soft">
          <h2 id="progress-title" className="text-lg font-semibold">
            {v.recentTitle}
          </h2>
          {history.ok ? (
            history.data.checkins.length > 0 ? (
              <ul aria-label={t.checkIn.listLabel} className="mt-3 space-y-3">
                {history.data.checkins.slice(0, 3).map((c) => (
                  <li key={c.checkin_id} className="space-y-1.5">
                    <time dateTime={c.submitted_at} className="block text-xs text-ink-muted">
                      {formatCheckinTime(c.submitted_at, locale)}
                    </time>
                    <div className="text-sm [&>span]:justify-start">
                      <EntrySummary checkin={c} locale={locale} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">{v.recentEmpty}</p>
            )
          ) : (
            <p className="mt-3 text-sm text-ink-muted">{d.historyUnavailable}</p>
          )}
          <TextLink href="/history" className="mt-auto pt-4">
            {d.progressAction}
          </TextLink>
        </section>

        {/* Explore the assistants */}
        {assistants.length > 0 ? (
          <section aria-labelledby="explore-title" className="enter enter-3 rounded-[2rem] border border-line bg-surface p-6 shadow-soft lg:col-span-2">
            <h2 id="explore-title" className="text-lg font-semibold">
              {v.exploreTitle}
            </h2>
            <ul className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10">
              {assistants.map((a) => {
                const tone = identity(a.assistant_id);
                const label = locale === "ar" ? a.name_ar : a.name_en;
                return (
                  <li key={a.assistant_id}>
                    <Link
                      href={`/chat?assistant=${a.assistant_id}`}
                      aria-label={label}
                      title={label}
                      className="tone flex aspect-square items-center justify-center rounded-2xl bg-[var(--tone-bg)] text-[var(--tone-ink)] transition-all duration-300 hover:-translate-y-1 hover:shadow-soft"
                      style={toneStyle(tone.hue, tone.chroma)}
                    >
                      <AssistantIcon name={a.icon} className="h-6 w-6" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Settings */}
        <section aria-labelledby="settings-title" className="enter enter-4 flex items-start gap-4 rounded-[2rem] border border-line bg-surface p-6 shadow-soft">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-ink-muted">
            <SettingsIcon />
          </span>
          <div className="space-y-1">
            <h2 id="settings-title" className="text-lg font-semibold">
              {d.settingsTitle}
            </h2>
            <p className="text-sm text-ink-muted">{d.settingsBody}</p>
            <TextLink href="/settings" className="mt-1">
              {d.settingsAction}
            </TextLink>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
