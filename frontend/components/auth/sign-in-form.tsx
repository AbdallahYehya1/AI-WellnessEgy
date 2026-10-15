"use client";

import { useActionState } from "react";

import { Field, FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { TextLink } from "@/components/ui/primitives";
import type { AuthFormState } from "@/lib/auth/actions";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";

type Props = {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next: string;
  locale?: Locale;
};

export function SignInForm({ action, next, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale].forms;
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert message={state.formError} locale={locale} />
      <input type="hidden" name="next" value={next} />
      <Field id="email" label={t.email} type="email" autoComplete="email" defaultValue={state.email} error={state.fieldErrors?.email} locale={locale} />
      <Field id="password" label={t.password} type="password" autoComplete="current-password" error={state.fieldErrors?.password} locale={locale} />
      <TextLink href="/forgot-password">{messages[locale].auth.forgotPasswordLink}</TextLink>
      <SubmitButton pendingText={t.signingIn}>{t.signInSubmit}</SubmitButton>
      <p className="text-sm">
        {t.newHere} <TextLink href="/sign-up">{t.createAnAccount}</TextLink>
      </p>
    </form>
  );
}
