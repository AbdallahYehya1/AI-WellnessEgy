"use client";

import { useActionState } from "react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";
import type { MoodFormState } from "@/lib/mood/actions";

type Props = {
  action: (state: MoodFormState, formData: FormData) => Promise<MoodFormState>;
  locale?: Locale;
};

const SCORES = [1, 2, 3, 4, 5] as const;

// Scale anchor wording is provisional copy pending review (OPEN_DECISIONS D-31).
export function MoodForm({ action, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale].checkIn;
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert message={state.formError} locale={locale} />
      <fieldset aria-describedby={state.fieldError ? "moodScore-error" : "moodScore-hint"} className="space-y-3">
        <legend className="text-base font-semibold">{t.question}</legend>
        {/* Numbers read left-to-right (low to high) in both languages. */}
        <div dir="ltr" className="grid grid-cols-5 gap-2 sm:gap-3">
          {SCORES.map((score) => (
            <label
              key={score}
              // Selected = filled lavender background + strong border. Keyboard
              // focus = a separate offset outline, so the two stay distinguishable.
              className="flex aspect-square min-h-12 cursor-pointer items-center justify-center rounded-2xl border-2 border-line-strong bg-surface text-xl font-bold text-ink transition-colors hover:bg-surface-muted has-checked:border-primary-strong has-checked:bg-surface-muted has-checked:text-primary-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input type="radio" name="moodScore" value={score} aria-label={String(score)} className="sr-only" />
              {score}
            </label>
          ))}
        </div>
        <p id="moodScore-hint" className="text-sm text-ink-muted">
          {t.scaleHint}
        </p>
        {state.fieldError ? (
          <p id="moodScore-error" role="alert" className="text-sm font-medium text-danger-ink">
            {translateMessage(locale, state.fieldError)}
          </p>
        ) : null}
      </fieldset>
      <SubmitButton pendingText={t.saving}>{t.save}</SubmitButton>
    </form>
  );
}
