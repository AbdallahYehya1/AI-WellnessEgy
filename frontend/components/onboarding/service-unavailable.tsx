import { buttonStyles } from "@/components/ui/primitives";
import { signOut } from "@/lib/auth/actions";
import { messages, type Messages } from "@/lib/i18n/messages";

// Shown when the account state can't be checked. The app fails closed: no
// consent-gated content is shown until the API confirms consent.
export function ServiceUnavailable({ t = messages.en }: { t?: Messages }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{t.errors.unavailableTitle}</h1>
        <p role="alert" className="text-ink-muted">
          {t.errors.unavailableBody}
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="" className={buttonStyles("primary")}>
            {t.common.tryAgain}
          </a>
          <form action={signOut}>
            <button type="submit" className={buttonStyles("secondary")}>
              {t.common.signOut}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
