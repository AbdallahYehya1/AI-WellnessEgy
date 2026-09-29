import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { fetchMe, type MeResult } from "@/lib/api/backend";
import { signOut } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard · AI Wellness Egypt" };

function ApiStatus({ result }: { result: MeResult }) {
  if (result.status === "ok") {
    return (
      <p role="status" className="text-sm">
        ✓ Your session was verified by the AI Wellness Egypt API.
      </p>
    );
  }
  if (result.status === "unauthorized") {
    return (
      <p role="alert" className="text-sm text-red-800">
        The API could not verify your session. Please sign out and sign in again.
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-calm-700">
      The API server can&apos;t be reached right now, so your session couldn&apos;t be checked
      there. You&apos;re still signed in.
    </p>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  // The proxy already guards this route; check again here in case the
  // proxy is bypassed or misconfigured.
  const { data } = supabase ? await supabase.auth.getClaims() : { data: null };
  const claims = data?.claims;
  if (!supabase || typeof claims?.sub !== "string") {
    redirect("/sign-in?next=/dashboard");
  }

  // getClaims() has verified the session, so its access token can be
  // forwarded to the API, which verifies it again independently.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const api: MeResult = session ? await fetchMe(session.access_token) : { status: "unauthorized" };
  const email = api.status === "ok" ? api.me.email : typeof claims.email === "string" ? claims.email : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1">
        <p className="text-sm font-medium text-calm-700">AI Wellness Egypt</p>
        <h1 className="text-3xl font-bold">أهلاً بيك</h1>
      </header>

      <section lang="en" dir="ltr" className="space-y-3 rounded-lg border border-calm-100 bg-white p-5 text-left">
        <h2 className="text-xl font-semibold">Welcome</h2>
        {email ? (
          <p>
            You&apos;re signed in as <span className="font-medium">{email}</span>.
          </p>
        ) : (
          <p>You&apos;re signed in.</p>
        )}
        <ApiStatus result={api} />
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
