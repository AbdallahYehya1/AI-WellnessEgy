"use client";

import { useActionState } from "react";

import { Field, FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { TextLink } from "@/components/ui/primitives";
import type { ResetRequestState } from "@/lib/auth/recovery-actions";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";

type Props = {
  action: (state: ResetRequestState, formData: FormData) => Promise<ResetRequestState>;
  locale?: Locale;
};

export function ForgotPasswordForm({ action, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale].forms;
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert message={state.formError} locale={locale} />
      <Field
        id="email"
        label={t.email}
        type="email"
        autoComplete="email"
        defaultValue={state.email}
        error={state.fieldErrors?.email}
        hint={t.forgotHint}
        locale={locale}
      />
      <SubmitButton pendingText={t.sending}>{t.sendResetLink}</SubmitButton>
      <p className="text-sm">
        {t.remembered} <TextLink href="/sign-in">{t.backToSignIn}</TextLink>
      </p>
    </form>
  );
}
