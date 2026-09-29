"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { ProfileFormState } from "@/lib/onboarding/actions";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/onboarding/validation";

type Props = {
  action: (state: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
  initialDisplayName: string | null;
};

export function ProfileForm({ action, initialDisplayName }: Props) {
  const [state, formAction] = useActionState(action, {});
  const value = state.displayName ?? initialDisplayName ?? "";
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormAlert message={state.formError} />
      <div className="space-y-1">
        <label htmlFor="displayName" className="block text-sm font-medium">
          What should we call you? <span className="font-normal text-calm-700">(optional)</span>
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="nickname"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          defaultValue={value}
          dir="auto"
          aria-invalid={state.fieldError ? true : undefined}
          aria-describedby={state.fieldError ? "displayName-error" : "displayName-hint"}
          className="w-full rounded-md border border-calm-100 bg-white px-3 py-2 outline-none focus:border-calm-700 focus:ring-2 focus:ring-calm-100 aria-invalid:border-red-400"
        />
        {state.fieldError ? (
          <p id="displayName-error" className="text-sm text-red-700">
            {state.fieldError}
          </p>
        ) : (
          <p id="displayName-hint" className="text-xs text-calm-700">
            A first name or nickname is enough. You can leave it empty.
          </p>
        )}
      </div>
      <SubmitButton pendingText="Saving…">Continue</SubmitButton>
      <button
        type="submit"
        name="intent"
        value="skip"
        formNoValidate
        className="w-full text-sm font-medium text-calm-700 underline"
      >
        Skip for now
      </button>
    </form>
  );
}
