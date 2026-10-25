"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { DRAFT_KEY } from "@/components/chat/workspace";
import { ArrowIcon, ChartIcon, CheckIcon, ChatIcon, PlusIcon } from "@/components/shell/icons";
import { toneStyle } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";
import type { ReflectionFormState } from "@/lib/mood/actions";
import { EMOJI, EMOTION_HUE, EMOTIONS, FACTORS } from "@/lib/mood/score";

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

const FEELING =
  "tone group relative flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-3xl border-2 border-line bg-surface px-2 py-3 text-sm font-semibold text-ink transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--tone-line)] has-checked:border-[var(--tone-solid)] has-checked:bg-[var(--tone-bg)] has-checked:text-[var(--tone-ink)] has-checked:shadow-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";
const FACTOR =
  "group inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line-strong/50 bg-surface px-4 py-1.5 text-sm font-semibold text-ink transition-all duration-200 hover:border-primary has-checked:border-primary has-checked:bg-primary has-checked:text-on-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";

/**
 * Daily Reflection: several feelings may apply at once (no good-to-bad scale), factors
 * are optional, and nothing is shared with an assistant unless the person opens one.
 */
export function ReflectionForm({ action, locale = "en", assistantNames }: Props) {
  const [state, formAction] = useActionState(action, {});
  const [count, setCount] = useState(0);
  const t = messages[locale].reflection;
  const v = messages[locale].v2.reflection;
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
    const nextCls =
      "lift group flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-start text-sm font-semibold text-ink shadow-soft hover:border-primary hover:shadow-lifted";
    return (
      <div role="status" className="space-y-6">
        <div className="flex items-start gap-4">
          <span aria-hidden className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-success-bg motion-safe:animate-[breathe_2.8s_ease-in-out_infinite]" />
            <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-success-ink text-surface motion-safe:animate-[pop_600ms_var(--ease-spring)_both]">
              <CheckIcon className="h-6 w-6" />
            </span>
          </span>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-success-ink">{v.savedEyebrow}</p>
            <h2 className="text-xl font-semibold">{t.savedTitle}</h2>
            <p className="text-ink-muted">{v.savedHeadline}</p>
          </div>
        </div>
        <div className="space-y-2 rounded-2xl bg-surface-muted/70 p-4">
          <p className="text-sm font-semibold text-ink-muted">{v.youFelt}</p>
          <ul className="flex flex-wrap gap-2">
            {saved.emotions.map((e) => (
              <li
                key={e}
                className="tone inline-flex items-center gap-1.5 rounded-full bg-[var(--tone-bg)] px-3 py-1 text-sm font-semibold text-[var(--tone-ink)]"
                style={toneStyle(EMOTION_HUE[e as keyof typeof EMOTION_HUE] ?? 178)}
              >
                <span aria-hidden>{EMOJI[e as keyof typeof EMOJI]}</span>
                {t.emotions[e as keyof typeof t.emotions] ?? e}
              </li>
            ))}
            {saved.factors.map((f) => (
              <li key={f} className="inline-flex items-center rounded-full border border-line px-3 py-1 text-sm text-ink-muted">
                {t.factors[f as keyof typeof t.factors] ?? f}
              </li>
            ))}
          </ul>
        </div>
        {onlyPositive && suggestions.length === 0 ? <p className="text-sm text-ink-muted">{t.positiveNote}</p> : null}
        <div className="space-y-3">
          <p className="text-sm font-semibold">{t.nextTitle}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((id) => (
              <li key={id}>
                {/* Opens the assistant only; no reflection data is sent to it. */}
                <Link href={`/chat?assistant=${id}`} className={nextCls}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary-strong">
                    <ChatIcon className="h-4 w-4" />
                  </span>
                  <span className="flex-1">{t.explore.replace("{assistant}", assistantNames[id] ?? id)}</span>
                  <ArrowIcon className="h-4 w-4 text-ink-muted" />
                </Link>
              </li>
            ))}
            {suggestions.slice(0, 1).map((id) => (
              <li key={`${id}-draft`}>
                {/* Fills an editable draft in that chat; nothing is sent until the person sends it. */}
                <Link href={`/chat?assistant=${id}`} onClick={() => startWithFeelings(id)} className={nextCls}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                    <ChatIcon className="h-4 w-4" />
                  </span>
                  <span className="flex-1">{t.exploreWithFeelings.replace("{assistant}", assistantNames[id] ?? id)}</span>
                  <ArrowIcon className="h-4 w-4 text-ink-muted" />
                </Link>
              </li>
            ))}
            <li>
              <Link href="/history" className={nextCls}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted">
                  <ChartIcon className="h-4 w-4" />
                </span>
                <span className="flex-1">{t.review}</span>
                <ArrowIcon className="h-4 w-4 text-ink-muted" />
              </Link>
            </li>
            <li>
              <a href="/check-in" className={nextCls}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted">
                  <PlusIcon className="h-4 w-4" />
                </span>
                <span className="flex-1">{t.another}</span>
              </a>
            </li>
          </ul>
        </div>
        <p className="text-xs text-ink-muted">{a.intro}</p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-8"
      onChange={(e) => setCount(e.currentTarget.querySelectorAll('input[name="emotions"]:checked').length)}
    >
      <FormAlert message={state.formError} locale={locale} />
      <fieldset aria-describedby={state.fieldError ? "emotions-error" : "emotions-hint"} className="relative space-y-4">
        <legend className="font-display float-start pe-24 text-xl font-semibold sm:text-2xl">{t.question}</legend>
        <p
          aria-live="polite"
          className={`absolute end-0 top-1 text-sm font-semibold text-primary-strong transition-opacity ${count ? "opacity-100" : "opacity-0"}`}
        >
          {count ? v.selected.replace("{n}", String(count)) : ""}
        </p>
        <p id="emotions-hint" className="clear-both text-sm text-ink-muted">
          {t.intro}
        </p>
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {EMOTIONS.map((emotion) => (
            <label key={emotion} className={FEELING} style={toneStyle(EMOTION_HUE[emotion])}>
              <input type="checkbox" name="emotions" value={emotion} className="sr-only" />
              <span
                aria-hidden
                className="text-[2rem] leading-none transition-transform duration-300 group-hover:scale-110 group-has-checked:animate-[pop_450ms_var(--ease-spring)_forwards]"
              >
                {EMOJI[emotion]}
              </span>
              <span>{t.emotions[emotion]}</span>
              <span
                aria-hidden
                className="absolute end-2 top-2 flex h-5 w-5 scale-0 items-center justify-center rounded-full bg-[var(--tone-solid)] text-white transition-transform duration-300 group-has-checked:scale-100"
              >
                <CheckIcon className="h-3 w-3" />
              </span>
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
            <label key={factor} className={FACTOR}>
              <input type="checkbox" name="factors" value={factor} className="sr-only" />
              <span aria-hidden className="-ms-1 hidden h-4 w-4 items-center justify-center group-has-checked:flex">
                <CheckIcon className="h-3.5 w-3.5" />
              </span>
              {t.factors[factor]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-3 border-t border-line pt-6">
        <p className="text-xs text-ink-muted">{t.privacy}</p>
        <SubmitButton pendingText={t.saving}>{t.save}</SubmitButton>
      </div>
    </form>
  );
}
