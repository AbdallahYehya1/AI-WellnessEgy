"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field, FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { ResetRequestState } from "@/lib/auth/recovery-actions";

type Props = {
  action: (state: ResetRequestState, formData: FormData) => Promise<ResetRequestState>;
};

export function ForgotPasswordForm({ action }: Props) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormAlert message={state.formError} />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={state.email}
        error={state.fieldErrors?.email}
        hint="We'll email you a link to choose a new password."
      />
      <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
      <p className="text-sm">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-calm-700 underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
