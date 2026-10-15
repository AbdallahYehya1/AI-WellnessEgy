import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/form-parts";
import { SignInForm } from "@/components/auth/sign-in-form";
import { signIn } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/validation";

export const metadata: Metadata = { title: "Sign in · AI Wellness Egypt" };

// Only these fixed notices can be shown; the query string can't inject text.
const NOTICES: Record<string, { tone: "info" | "error"; text: string }> = {
  "signed-out": { tone: "info", text: "You've been signed out." },
  "password-updated": {
    tone: "info",
    text: "Your password has been updated. We've also ended your other sessions, which can take a little while to apply on every device. Sign in with your new password.",
  },
  "sign-in-to-continue": {
    tone: "info",
    text: "If you just confirmed your email, sign in below to continue.",
  },
  "confirmation-failed": {
    tone: "error",
    text: "That confirmation link is invalid or has expired. Try signing in, or sign up again to get a new link.",
  },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : undefined;
  const notice = status ? NOTICES[status] : undefined;

  return (
    <AuthShell titleAr="تسجيل الدخول" title="Sign in">
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
      <SignInForm action={signIn} next={safeNextPath(params.next)} />
    </AuthShell>
  );
}
