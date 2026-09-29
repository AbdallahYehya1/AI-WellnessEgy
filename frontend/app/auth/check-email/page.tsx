import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/form-parts";

export const metadata: Metadata = { title: "Check your email · AI Wellness Egypt" };

export default function CheckEmailPage() {
  return (
    <AuthShell titleAr="راجع بريدك الإلكتروني" title="Check your email">
      <div role="status" className="space-y-3 rounded-lg border border-calm-100 bg-white p-5">
        <p className="font-medium">Confirm your email address to finish creating your account.</p>
        <p className="text-sm leading-relaxed">
          If this email address can be used for a new account, we&apos;ve sent it a confirmation
          link. Open the link on this device and in this browser, then sign in.
        </p>
        <p className="text-sm leading-relaxed">
          Can&apos;t find it? Check your spam folder, and allow a few minutes for it to arrive.
        </p>
      </div>
      <Link href="/sign-in" className="inline-block text-sm font-medium text-calm-700 underline">
        Back to sign in
      </Link>
    </AuthShell>
  );
}
