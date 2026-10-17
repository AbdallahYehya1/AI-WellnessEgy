"use client";

import { useActionState } from "react";

import { Field, FormAlert, SubmitButton } from "@/components/auth/form-parts";
import type { NewPasswordState } from "@/lib/auth/recovery-actions";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";

type Props = {
  action: (state: NewPasswordState, formData: FormData) => Promise<NewPasswordState>;
  locale?: Locale;
};

export function ResetPasswordForm({ action, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale].forms;
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert message={state.formError} locale={locale} />
      <Field
        id="password"
        label={t.newPassword}
        type="password"
        autoComplete="new-password"
        hint={t.passwordHint}
        error={state.fieldErrors?.password}
        locale={locale}
      />
      <Field
        id="confirmPassword"
        label={t.confirmNewPassword}
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
        locale={locale}
      />
      <SubmitButton pendingText={t.saving}>{t.saveNewPassword}</SubmitButton>
    </form>
  );
}
