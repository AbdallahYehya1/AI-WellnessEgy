import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AssistantDirectory, type DirectoryItem } from "@/components/assistants/directory";
import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { AppShell } from "@/components/shell/app-shell";
import { ButtonLink, PageHeader } from "@/components/ui/primitives";
import { fetchChatConfig, fetchMyConsent } from "@/lib/api/backend";
import { BY_ID, identity } from "@/lib/assistants/catalog";
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
  const d = t.v2.directory;
  const enabled = config.data.enabled;
  // Ready assistants first so the ones that can be opened aren't buried on a phone.
  const assistants = enabled
    ? [...(config.data.assistants ?? [])].sort((x, y) => Number(y.status === "ready") - Number(x.status === "ready"))
    : [];
  // Live names, descriptions and starters from the server; identity (colour, group) from the catalog.
  const items: DirectoryItem[] = assistants.map((x) => {
    const id = identity(x.assistant_id);
    return {
      id: x.assistant_id,
      icon: x.icon,
      name: locale === "ar" ? x.name_ar : x.name_en,
      description: locale === "ar" ? x.description_ar : x.description_en,
      starters: (locale === "ar" ? x.starters_ar : x.starters_en).slice(0, 3),
      uses: BY_ID[x.assistant_id]?.uses[locale] ?? [],
      hue: id.hue,
      chroma: id.chroma,
      group: id.group,
      ready: x.status === "ready",
    };
  });

  return (
    <AppShell current="chat" locale={locale} t={t} chatEnabled={enabled} wide>
      <PageHeader eyebrow={d.eyebrow} title={a.title} intro={a.intro} />
      {items.length === 0 ? (
        <div className="space-y-4">
          <p role="status" className="text-ink-muted">
            {t.chat.unavailableYet}
          </p>
          <ButtonLink href="/dashboard" variant="secondary">
            {t.common.backToDashboard}
          </ButtonLink>
        </div>
      ) : (
        <AssistantDirectory
          items={items}
          copy={{
            filterLabel: d.filterLabel,
            searchLabel: d.searchLabel,
            searchPlaceholder: d.searchPlaceholder,
            noMatch: d.noMatch,
            goodFor: d.goodFor,
            tryAsking: d.tryAsking,
            startChat: t.v2.common.startChat,
            comingSoon: a.comingSoon,
            comingSoonBody: a.comingSoonBody,
            groups: t.v2.landing.groups,
          }}
        />
      )}
    </AppShell>
  );
}
