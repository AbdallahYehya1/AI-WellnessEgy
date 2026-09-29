import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/form-parts";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { signUp } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Create an account · AI Wellness Egypt" };

export default function SignUpPage() {
  return (
    <AuthShell titleAr="إنشاء حساب" title="Create an account">
      <p className="text-sm">
        AI Wellness Egypt is a wellness-support service for adults. It is not a medical service
        and not a replacement for professional care.
      </p>
      <SignUpForm action={signUp} />
    </AuthShell>
  );
}
