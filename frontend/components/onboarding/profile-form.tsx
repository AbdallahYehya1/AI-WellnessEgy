"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { FormAlert, inputClasses, SubmitButton } from "@/components/auth/form-parts";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";
import type { ProfileFormState } from "@/lib/onboarding/actions";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/onboarding/validation";

type Props = {
  action: (state: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
  initialDisplayName: string | null;
  locale?: Locale;
};

function SkipButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value="skip"
      formNoValidate
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-primary-strong underline underline-offset-4"
    >
      {label}
    </button>
  );
}

export function ProfileForm({ action, initialDisplayName, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale];
  const value = state.displayName ?? initialDisplayName ?? "";
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert message={state.formError} locale={locale} />
      <div className="space-y-1.5">
        <label htmlFor="displayName" className="block text-sm font-semibold">
          {t.onboarding.nameLabel} <span className="font-normal text-ink-muted">{t.onboarding.optional}</span>
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
          className={inputClasses}
        />
        {state.fieldError ? (
          <p id="displayName-error" className="text-sm font-medium text-danger-ink">
            {translateMessage(locale, state.fieldError)}
          </p>
        ) : (
          <p id="displayName-hint" className="text-sm text-ink-muted">
            {t.onboarding.nameHint}
          </p>
        )}
      </div>
      <SubmitButton pendingText={t.forms.saving}>{t.onboarding.continue}</SubmitButton>
      <SkipButton label={t.onboarding.skip} />
    </form>
  );
}
