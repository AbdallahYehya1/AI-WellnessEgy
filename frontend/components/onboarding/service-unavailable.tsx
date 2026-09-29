import { signOut } from "@/lib/auth/actions";

// Shown when the account state can't be checked. The app fails closed: no
// consent-gated content is shown until the API confirms consent.
export function ServiceUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold">عذرًا</h1>
      <div lang="en" dir="ltr" className="space-y-4 text-left">
        <p role="alert">
          We can&apos;t load your account right now. Please try again in a few minutes.
        </p>
        <form action={signOut}>
          <button type="submit" className="text-sm font-medium text-calm-700 underline">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
