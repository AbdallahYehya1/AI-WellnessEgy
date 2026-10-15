"use client";

import { useActionState } from "react";

import { FormAlert, inputClasses, SubmitButton } from "@/components/auth/form-parts";
import { Notice } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/onboarding/validation";
import type { DisplayNameState } from "@/lib/settings/actions";

type Props = {
  action: (state: DisplayNameState, formData: FormData) => Promise<DisplayNameState>;
  initialDisplayName: string | null;
  locale?: Locale;
};

export function DisplayNameForm({ action, initialDisplayName, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale].settings;
  const value = state.displayName ?? initialDisplayName ?? "";
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormAlert message={state.formError} locale={locale} />
      {state.saved ? <Notice tone="success">{t.saved}</Notice> : null}
      <div className="space-y-1.5">
        <label htmlFor="displayName" className="block text-sm font-semibold">
          {t.displayNameLabel}
        </label>
        <input
          key={value}
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
            {t.displayNameHint}
          </p>
        )}
      </div>
      <div className="sm:w-48">
        <SubmitButton pendingText={messages[locale].forms.saving}>{t.save}</SubmitButton>
      </div>
    </form>
  );
}
