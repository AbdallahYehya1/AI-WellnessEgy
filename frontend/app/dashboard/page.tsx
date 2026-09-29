import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ServiceUnavailable } from "@/components/onboarding/service-unavailable";
import { fetchMe, fetchMyConsent } from "@/lib/api/backend";
import { signOut } from "@/lib/auth/actions";
import { getVerifiedSession } from "@/lib/auth/session";
import { requiredOnboardingStep } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Dashboard · AI Wellness Egypt" };

export default async function DashboardPage() {
  // The proxy already guards this route; check again here in case the
  // proxy is bypassed or misconfigured.
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/dashboard");

  // Consent gate: nothing below is shown until the API confirms that the
  // current consent version has been accepted. Fails closed.
  const consent = await fetchMyConsent(session.accessToken);
  if (!consent.ok) {
    if (consent.status === 401) redirect("/sign-in?next=/dashboard");
    return <ServiceUnavailable />;
  }
  const step = requiredOnboardingStep(consent.data.status);
  if (step) redirect(step);

  const me = await fetchMe(session.accessToken);
  if (me.status !== "ok") return <ServiceUnavailable />;
  const name = me.me.display_name;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1">
        <p className="text-sm font-medium text-calm-700">AI Wellness Egypt</p>
        <h1 className="text-3xl font-bold">أهلاً بيك</h1>
      </header>

      <section
        lang="en"
        dir="ltr"
        className="space-y-3 rounded-lg border border-calm-100 bg-white p-5 text-left"
      >
        <h2 className="text-xl font-semibold">
          Welcome{name ? <span dir="auto">, {name}</span> : null}
        </h2>
        {me.me.email ? (
          <p>
            You&apos;re signed in as <span className="font-medium">{me.me.email}</span>.
          </p>
        ) : (
          <p>You&apos;re signed in.</p>
        )}
        <p role="status" className="text-sm">
          ✓ Your session was verified by the AI Wellness Egypt API.
        </p>
        <p className="text-sm text-calm-700">
          This is a placeholder. Wellness features will appear here in later releases.
        </p>
      </section>

      <form action={signOut} lang="en" dir="ltr" className="text-left">
        <button
          type="submit"
          className="rounded-md border border-calm-700 px-4 py-2 font-medium text-calm-700 transition hover:bg-calm-100"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
