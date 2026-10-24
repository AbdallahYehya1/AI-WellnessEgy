import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AssistantIcon } from "@/components/assistants/icons";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { ButtonLink, PageHeader } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMyConsent } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages } from "@/lib/i18n/server";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Assistants · AI Wellness Egypt" };

/** The ten specialised assistants. Only ready ones can be opened; the rest are labelled. */
export default async function AssistantsPage() {
  const { locale, t } = await getMessages();
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/assistants");

  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect("/sign-in?next=/assistants");
    return <ServiceUnavailable t={t} />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const config = await fetchChatConfig(session.accessToken);
  if (!config.ok) {
    if (config.status === 401) redirect("/sign-in?next=/assistants");
    return <ServiceUnavailable t={t} />;
  }
  const a = t.assistants;
  const enabled = config.data.enabled;
  // Ready assistants first so the ones that can be opened aren't buried on a phone.
  const assistants = enabled
    ? [...(config.data.assistants ?? [])].sort((a, b) => Number(b.status === "ready") - Number(a.status === "ready"))
    : [];

  return (
    <AppShell current="chat" locale={locale} t={t} chatEnabled={enabled}>
      <PageHeader title={a.title} intro={a.intro} />
      {assistants.length === 0 ? (
        <div className="space-y-4">
          <p role="status" className="text-ink-muted">
            {t.chat.unavailableYet}
          </p>
          <ButtonLink href="/dashboard" variant="secondary">
            {t.common.backToDashboard}
          </ButtonLink>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {assistants.map((assistant) => {
            const name = locale === "ar" ? assistant.name_ar : assistant.name_en;
            const description = locale === "ar" ? assistant.description_ar : assistant.description_en;
            const starters = (locale === "ar" ? assistant.starters_ar : assistant.starters_en).slice(0, 2);
            const ready = assistant.status === "ready";
            const body = (
              <>
                <div className="flex items-start gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${ready ? "bg-secondary/40 text-primary-strong" : "bg-surface-muted text-ink-muted"}`}>
                    <AssistantIcon name={assistant.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold text-ink">{name}</h2>
                    <p className="text-sm text-ink-muted">{description}</p>
                  </div>
                  {!ready ? (
                    <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-muted">
                      {a.comingSoon}
                    </span>
                  ) : null}
                </div>
                {ready ? (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-semibold text-ink-muted">{a.examples}</p>
                    <ul className="space-y-1 text-sm text-ink" dir="auto">
                      {starters.map((s) => (
                        <li key={s} className="truncate">
                          “{s}”
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ink-muted">{a.comingSoonBody}</p>
                )}
              </>
            );
            return (
              <li key={assistant.assistant_id} className="min-w-0">
                {ready ? (
                  <Link
                    href={`/chat?assistant=${assistant.assistant_id}`}
                    className="block h-full rounded-3xl border border-line bg-surface p-5 shadow-sm transition-colors hover:border-primary hover:bg-surface-muted"
                  >
                    {body}
                  </Link>
                ) : (
                  <div aria-disabled="true" className="h-full rounded-3xl border border-dashed border-line bg-surface p-5 opacity-80">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
