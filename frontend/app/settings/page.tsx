import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { DisplayNameForm } from "@/components/settings/display-name-form";
import { AppShell } from "@/components/shell/app-shell";
import { buttonStyles, Card, Notice, PageHeader } from "@/components/ui/primitives";
import { fetchChatConfig, fetchCurrentConsent, fetchMe, fetchMyConsent, fetchProfile } from "@/lib/api/backend";
import { signOut } from "@/lib/auth/actions";
import { getVerifiedSession } from "@/lib/auth/session";
import { getMessages, getTheme } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/messages";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";
import { setLocale, setTheme } from "@/lib/preferences/actions";
import { updateDisplayName } from "@/lib/settings/actions";

export const metadata: Metadata = { title: "Settings · AI Wellness Egypt" };

const selectClasses =
  "block min-h-12 w-full rounded-2xl border border-line-strong/60 bg-surface px-4 py-2.5 text-base text-ink shadow-soft transition-colors hover:border-line-strong sm:w-64";

/**
 * Only settings the backend supports today. Unsupported account actions
 * (data export, deletion, consent withdrawal) are explained as text, never
 * offered as buttons that don't work.
 */
export default async function SettingsPage() {
  const [{ locale, t }, theme] = await Promise.all([getMessages(), getTheme()]);
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/settings");

  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect("/sign-in?next=/settings");
    return <ServiceUnavailable t={t} />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const [profile, me, current, chat] = await Promise.all([
    fetchProfile(session.accessToken),
    fetchMe(session.accessToken),
    fetchCurrentConsent(),
    fetchChatConfig(session.accessToken),
  ]);
  if (!profile.ok) return <ServiceUnavailable t={t} />;
  const s = t.settings;
  const recordedAt = consent.data.recorded_at?.slice(0, 10) ?? "";

  return (
    <AppShell current="settings" locale={locale} t={t} chatEnabled={Boolean(chat?.ok && chat.data.enabled)}>
      <PageHeader title={s.title} />

      <Card aria-labelledby="profile-title">
        <h2 id="profile-title" className="mb-4 text-lg font-semibold">
          {s.profileTitle}
        </h2>
        <DisplayNameForm action={updateDisplayName} initialDisplayName={profile.data.display_name} locale={locale} />
      </Card>

      <Card aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="mb-4 text-lg font-semibold">
          {s.appearanceTitle}
        </h2>
        <div className="space-y-5">
          <form action={setLocale} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="locale" className="block text-sm font-semibold">
                {s.languageLabel}
              </label>
              <select id="locale" name="locale" defaultValue={locale} className={selectClasses}>
                <option value="ar" lang="ar">
                  العربية
                </option>
                <option value="en" lang="en">
                  English
                </option>
              </select>
            </div>
            <button type="submit" className={buttonStyles("secondary")}>
              {s.apply}
            </button>
          </form>
          <form action={setTheme} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="theme" className="block text-sm font-semibold">
                {s.themeLabel}
              </label>
              <select id="theme" name="theme" defaultValue={theme} className={selectClasses}>
                <option value="system">{s.themeSystem}</option>
                <option value="light">{s.themeLight}</option>
                <option value="dark">{s.themeDark}</option>
              </select>
            </div>
            <button type="submit" className={buttonStyles("secondary")}>
              {s.apply}
            </button>
          </form>
          <p className="text-sm text-ink-muted">{s.deviceOnly}</p>
        </div>
      </Card>

      <Card aria-labelledby="consent-title">
        <h2 id="consent-title" className="mb-2 text-lg font-semibold">
          {s.consentTitle}
        </h2>
        <p className="text-sm">
          {format(s.consentStatus, { version: consent.data.recorded_version ?? consent.data.current_version, date: recordedAt })}
        </p>
        {current.ok && current.data.pending_legal_review ? (
          <Notice tone="warning" role="note" className="mt-3">
            {s.consentDraft}
          </Notice>
        ) : null}
        <p className="mt-3 text-sm text-ink-muted">{s.consentWithdrawNote}</p>
      </Card>

      <Card aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="mb-2 text-lg font-semibold">
          {s.privacyTitle}
        </h2>
        <p className="text-sm text-ink-muted">{s.privacyBody}</p>
      </Card>

      <Card aria-labelledby="account-title">
        <h2 id="account-title" className="mb-2 text-lg font-semibold">
          {s.accountTitle}
        </h2>
        {me.status === "ok" && me.me.email ? (
          <p className="mb-4 text-sm">
            {format(s.signedInAs, { email: "" })}
            <span dir="ltr" className="font-semibold">
              {me.me.email}
            </span>
          </p>
        ) : null}
        <form action={signOut}>
          <button type="submit" className={buttonStyles("secondary")}>
            {t.common.signOut}
          </button>
        </form>
      </Card>
    </AppShell>
  );
}
