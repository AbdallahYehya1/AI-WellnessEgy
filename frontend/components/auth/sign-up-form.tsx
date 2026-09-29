"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field, FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";

type Props = {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
};

export function SignUpForm({ action }: Props) {
  const [state, formAction] = useActionState(action, {});
  const ageError = state.fieldErrors?.ageConfirmed;
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
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        error={state.fieldErrors?.password}
      />
      <Field
        id="confirmPassword"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
      />
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="ageConfirmed"
            required
            aria-invalid={ageError ? true : undefined}
            aria-describedby={ageError ? "ageConfirmed-error" : undefined}
            className="mt-1"
          />
          <span>I confirm that I am 18 or older.</span>
        </label>
        {ageError ? (
          <p id="ageConfirmed-error" className="text-sm text-red-700">
            {ageError}
          </p>
        ) : null}
      </div>
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-calm-700 underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
