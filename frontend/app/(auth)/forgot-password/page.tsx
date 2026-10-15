import type { Metadata } from "next";
import { headers } from "next/headers";

import { AuthShell } from "@/components/auth/form-parts";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { requestPasswordReset } from "@/lib/auth/recovery-actions";
import { siteUrl } from "@/lib/auth/site-url";

export const metadata: Metadata = { title: "Reset your password · AI Wellness Egypt" };

// Only these fixed notices can be shown; the query string can't inject text.
// "sent" is shown for every request, whether or not an account exists.
const NOTICES: Record<string, { tone: "info" | "error"; text: string }> = {
  sent: {
    tone: "info",
    text: "If an account exists for that email, we've sent it a link to reset your password. The link works once and expires soon. Open it in this browser.",
  },
  "link-invalid": {
    tone: "error",
    text: "That reset link is invalid, has expired or was already used. Request a new one below.",
  },
  unavailable: {
    tone: "error",
    text: "Password reset isn't available right now. Please try again later.",
  },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** In development only: warn when this page's host differs from SITE_URL, which breaks the link. */
async function hostMismatch(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  const host = (await headers()).get("host");
  const expected = new URL(siteUrl()).host;
  return host && host !== expected ? expected : null;
}

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : undefined;
  const notice = status ? NOTICES[status] : undefined;
  const expectedHost = await hostMismatch();

  return (
    // Arabic title is provisional copy pending native review (D-19).
    <AuthShell titleAr="نسيت كلمة السر؟" title="Reset your password">
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              : "rounded-md border border-calm-100 bg-white px-3 py-2 text-sm"
          }
        >
          {notice.text}
        </p>
      ) : null}
      {expectedHost ? (
        <p
          data-testid="host-mismatch"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Development note: reset links open at {expectedHost}. Request the reset from that same
          address, or the link can&apos;t be completed in this browser.
        </p>
      ) : null}
      <ForgotPasswordForm action={requestPasswordReset} />
    </AuthShell>
  );
}
