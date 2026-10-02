"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { MoodFormState } from "@/lib/mood/actions";

type Props = {
  action: (state: MoodFormState, formData: FormData) => Promise<MoodFormState>;
};

const SCORES = [1, 2, 3, 4, 5] as const;

// Scale anchor wording is provisional copy pending review (OPEN_DECISIONS D-31).
export function MoodForm({ action }: Props) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormAlert message={state.formError} />
      <fieldset
        aria-describedby={state.fieldError ? "moodScore-error" : "moodScore-hint"}
        className="space-y-3"
      >
        <legend className="text-sm font-medium">How are you feeling right now?</legend>
        <div className="flex gap-2">
          {SCORES.map((score) => (
            <label
              key={score}
              className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-md border border-calm-100 bg-white text-lg font-semibold has-checked:border-calm-700 has-checked:bg-calm-100"
            >
              <input
                type="radio"
                name="moodScore"
                value={score}
                aria-label={String(score)}
                className="sr-only"
              />
              {score}
            </label>
          ))}
        </div>
        <p id="moodScore-hint" className="text-xs text-calm-700">
          1 = very low · 5 = very good
        </p>
        {state.fieldError ? (
          <p id="moodScore-error" role="alert" className="text-sm text-red-700">
            {state.fieldError}
          </p>
        ) : null}
      </fieldset>
      <SubmitButton pendingText="Saving…">Save check-in</SubmitButton>
    </form>
  );
}
