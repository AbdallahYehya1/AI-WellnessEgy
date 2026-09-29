"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field, FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { AuthFormState } from "@/lib/auth/actions";

type Props = {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next: string;
};

export function SignInForm({ action, next }: Props) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormAlert message={state.formError} />
      <input type="hidden" name="next" value={next} />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={state.email}
        error={state.fieldErrors?.email}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        error={state.fieldErrors?.password}
      />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      <p className="text-sm">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-calm-700 underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
