"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { FormAlert } from "@/components/auth/form-parts";
import type { ConsentFormState } from "@/lib/onboarding/actions";

type Props = {
  action: (state: ConsentFormState, formData: FormData) => Promise<ConsentFormState>;
  version: string;
};

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <button
        type="submit"
        name="intent"
        value="accept"
        disabled={pending}
        className="rounded-md bg-calm-700 px-4 py-2.5 font-medium text-white transition hover:bg-calm-900 disabled:opacity-60"
      >
        Agree and continue
      </button>
      <button
        type="submit"
        name="intent"
        value="decline"
        disabled={pending}
        className="rounded-md border border-calm-700 px-4 py-2.5 font-medium text-calm-700 transition hover:bg-calm-100 disabled:opacity-60"
      >
        I don&apos;t agree
      </button>
    </div>
  );
}

export function ConsentForm({ action, version }: Props) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormAlert message={state.formError} />
      {state.declined ? (
        <p role="status" className="rounded-md border border-calm-100 bg-white px-3 py-2 text-sm">
          Your choice has been recorded. You can&apos;t use the app without agreeing to the
          terms. You can agree at any time from this page, or sign out.
        </p>
      ) : null}
      <input type="hidden" name="version" value={version} />
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="confirmRead"
            aria-invalid={state.fieldError ? true : undefined}
            aria-describedby={state.fieldError ? "confirmRead-error" : undefined}
            className="mt-1"
          />
          <span>I have read and agree to these terms.</span>
        </label>
        {state.fieldError ? (
          <p id="confirmRead-error" className="text-sm text-red-700">
            {state.fieldError}
          </p>
        ) : null}
      </div>
      <Buttons />
    </form>
  );
}
