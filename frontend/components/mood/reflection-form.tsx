"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { DRAFT_KEY } from "@/components/chat/workspace";
import { buttonStyles } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";
import type { ReflectionFormState } from "@/lib/mood/actions";
import { EMOJI, EMOTIONS, FACTORS } from "@/lib/mood/score";

type Props = {
  action: (state: ReflectionFormState, formData: FormData) => Promise<ReflectionFormState>;
  locale?: Locale;
  /** Display names of ready assistants, for the optional "talk it through" links. */
  assistantNames: Record<string, string>;
};

const POSITIVE = new Set(["happy", "calm", "good", "excited"]);

function joinList(items: string[], locale: Locale): string {
  if (items.length < 2) return items.join("");
  if (locale === "ar") return items.join(" و");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const CHIP =
  "flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl border-2 border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted has-checked:border-primary-strong has-checked:bg-surface-muted has-checked:text-primary-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";

/**
 * Daily Reflection: several feelings may apply at once (no good-to-bad scale), factors
 * are optional, and nothing is shared with an assistant unless the person opens one.
 */
export function ReflectionForm({ action, locale = "en", assistantNames }: Props) {
  const [state, formAction] = useActionState(action, {});
  const t = messages[locale].reflection;
  const a = messages[locale].assistants;

  if (state.saved) {
    const onlyPositive = state.saved.emotions.every((e) => POSITIVE.has(e));
    const suggestions = state.saved.suggestions.filter((id) => assistantNames[id]);
    const saved = state.saved;
    // A starting message the person can edit; written only when they choose it.
    const draft = () => {
      const feelings = saved.emotions.map((e) => {
        const label = t.emotions[e as keyof typeof t.emotions] ?? e;
        return locale === "ar" ? label : label.toLowerCase();
      });
      const factors = saved.factors.map((f) => {
        const label = t.factors[f as keyof typeof t.factors] ?? f;
        return locale === "ar" ? label : label.toLowerCase();
      });
      return (
        t.draftFeelings.replace("{feelings}", joinList(feelings, locale)) +
        (factors.length ? t.draftFactors.replace("{factors}", joinList(factors, locale)) : "") +
        t.draftAsk
      );
    };
    const startWithFeelings = (id: string) => {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ assistant: id, text: draft() }));
      } catch {
        // storage blocked: the chat simply opens empty
      }
    };
    return (
      <div role="status" className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">{t.savedTitle}</h2>
          <p className="text-ink-muted">{t.savedBody}</p>
        </div>
        {onlyPositive && suggestions.length === 0 ? <p className="text-sm text-ink-muted">{t.positiveNote}</p> : null}
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t.nextTitle}</p>
          <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {suggestions.map((id) => (
              <li key={id}>
                {/* Opens the assistant only; no reflection data is sent to it. */}
                <Link href={`/chat?assistant=${id}`} className={buttonStyles("secondary")}>
                  {t.explore.replace("{assistant}", assistantNames[id] ?? id)}
                </Link>
              </li>
            ))}
            {suggestions.slice(0, 1).map((id) => (
              <li key={`${id}-draft`}>
                {/* Fills an editable draft in that chat; nothing is sent until the person sends it. */}
                <Link
                  href={`/chat?assistant=${id}`}
                  onClick={() => startWithFeelings(id)}
                  className={buttonStyles("ghost")}
                >
                  {t.exploreWithFeelings.replace("{assistant}", assistantNames[id] ?? id)}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/history" className={buttonStyles("secondary")}>
                {t.review}
              </Link>
            </li>
            <li>
              <a href="/check-in" className={buttonStyles("ghost")}>
                {t.another}
              </a>
            </li>
          </ul>
        </div>
        <p className="text-xs text-ink-muted">{a.intro}</p>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-6">
      <FormAlert message={state.formError} locale={locale} />
      <fieldset aria-describedby={state.fieldError ? "emotions-error" : "emotions-hint"} className="space-y-3">
        <legend className="text-lg font-bold">{t.question}</legend>
        <p id="emotions-hint" className="text-sm text-ink-muted">
          {t.intro}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EMOTIONS.map((emotion) => (
            <label key={emotion} className={CHIP}>
              <input type="checkbox" name="emotions" value={emotion} className="sr-only" />
              <span aria-hidden className="text-2xl leading-none">
                {EMOJI[emotion]}
              </span>
              <span>{t.emotions[emotion]}</span>
            </label>
          ))}
        </div>
        {state.fieldError ? (
          <p id="emotions-error" role="alert" className="text-sm font-medium text-danger-ink">
            {translateMessage(locale, state.fieldError)}
          </p>
        ) : null}
      </fieldset>

      <fieldset aria-describedby="factors-hint" className="space-y-3">
        <legend className="text-base font-semibold">{t.factorsTitle}</legend>
        <p id="factors-hint" className="text-sm text-ink-muted">
          {t.factorsHint}
        </p>
        <div className="flex flex-wrap gap-2">
          {FACTORS.map((factor) => (
            <label key={factor} className={`${CHIP} min-h-11 rounded-full py-1.5`}>
              <input type="checkbox" name="factors" value={factor} className="sr-only" />
              {t.factors[factor]}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-ink-muted">{t.privacy}</p>
      <SubmitButton pendingText={t.saving}>{t.save}</SubmitButton>
    </form>
  );
}
