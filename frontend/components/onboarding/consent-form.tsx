"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { FormAlert } from "@/components/auth/form-parts";
import { buttonStyles, Checkbox, Notice } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";
import type { ConsentFormState } from "@/lib/onboarding/actions";

type Props = {
  action: (state: ConsentFormState, formData: FormData) => Promise<ConsentFormState>;
  version: string;
  locale?: Locale;
};

function Buttons({ agree, decline }: { agree: string; decline: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <button type="submit" name="intent" value="accept" disabled={pending} className={buttonStyles("primary")}>
        {agree}
      </button>
      <button type="submit" name="intent" value="decline" disabled={pending} className={buttonStyles("secondary")}>
        {decline}
      </button>
    </div>
  );
}

export function ConsentForm({ action, version, locale = "en" }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale].onboarding;
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert message={state.formError} locale={locale} />
      {state.declined ? <Notice tone="info">{t.declined}</Notice> : null}
      <input type="hidden" name="version" value={version} />
      {/* Never pre-ticked: agreement must be an explicit action. */}
      <Checkbox
        id="confirmRead"
        name="confirmRead"
        label={t.agreeLabel}
        error={translateMessage(locale, state.fieldError)}
      />
      <Buttons agree={t.agree} decline={t.decline} />
    </form>
  );
}
