"use client";

import { useActionState } from "react";

import { Field, FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { Checkbox, TextLink } from "@/components/ui/primitives";
import type { AuthFormState } from "@/lib/auth/actions";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";

type Props = {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  locale?: Locale;
};

export function SignUpForm({ action, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale];
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert message={state.formError} locale={locale} />
      <Field id="email" label={t.forms.email} type="email" autoComplete="email" defaultValue={state.email} error={state.fieldErrors?.email} locale={locale} />
      <Field
        id="password"
        label={t.forms.password}
        type="password"
        autoComplete="new-password"
        hint={t.forms.passwordHint}
        error={state.fieldErrors?.password}
        locale={locale}
      />
      <Field
        id="confirmPassword"
        label={t.forms.confirmPassword}
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
        locale={locale}
      />
      {/* The service is for adults only (D-12); the server checks this too. */}
      <Checkbox id="ageConfirmed" name="ageConfirmed" required label={t.forms.ageConfirm} error={translateMessage(locale, state.fieldErrors?.ageConfirmed)} />
      <SubmitButton pendingText={t.forms.creatingAccount}>{t.forms.createAccountSubmit}</SubmitButton>
      <div className="space-y-2 text-sm">
        <p>
          {t.forms.alreadyHaveAccount} <TextLink href="/sign-in">{t.forms.signInLink}</TextLink>
        </p>
        <p>
          <TextLink href="/forgot-password">{t.auth.forgotPasswordLink}</TextLink>
        </p>
      </div>
    </form>
  );
}
