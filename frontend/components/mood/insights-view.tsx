import { toneStyle } from "@/components/ui/primitives";
import type { MoodInsights } from "@/lib/api/backend";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { EMOJI, EMOTION_HUE, EMOTIONS, FACTORS } from "@/lib/mood/score";

type Emotion = (typeof EMOTIONS)[number];
type Factor = (typeof FACTORS)[number];
const isEmotion = (v: string): v is Emotion => (EMOTIONS as readonly string[]).includes(v);
const isFactor = (v: string): v is Factor => (FACTORS as readonly string[]).includes(v);

/**
 * Descriptive counts of the person's own reflections. Counts of days, never scores,
 * causes or diagnoses; missing days are not shown as anything.
 */
export function InsightsView({ insights, locale = "en" }: { insights: MoodInsights; locale?: Locale }) {
  const t = messages[locale].insights;
  const r = messages[locale].reflection;
  const emotionLabel = (e: string) => (isEmotion(e) ? r.emotions[e] : e);
  const factorLabel = (f: string) => (isFactor(f) ? r.factors[f] : f);
  const plural = new Intl.PluralRules(locale === "ar" ? "ar-EG" : "en-GB");
  const days = (n: number) => t.days[plural.select(n)].replace("{n}", String(n));
  const max = Math.max(1, ...insights.emotions.map((e) => e.count));
  const maxFactor = Math.max(1, ...insights.factors.map((f) => f.count));
  const dayFormat = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  if (!insights.enough_data) {
    return (
      <p role="status" className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink">
        {t.notEnough}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="feelings-title" className="space-y-4">
        <h3 id="feelings-title" className="text-lg font-semibold">
          {t.feelingsTitle}
        </h3>
        <ul className="space-y-3">
          {insights.emotions.map((e, i) => (
            <li
              key={e.label}
              className="tone grid grid-cols-[minmax(7.5rem,auto)_1fr_auto] items-center gap-3 text-sm"
              style={toneStyle(isEmotion(e.label) ? EMOTION_HUE[e.label] : 178)}
            >
              <span className="flex items-center gap-2 font-semibold">
                <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--tone-bg)] text-lg">
                  {isEmotion(e.label) ? EMOJI[e.label] : ""}
                </span>
                {emotionLabel(e.label)}
              </span>
              <span aria-hidden className="h-3 overflow-hidden rounded-full bg-surface-muted">
                <span
                  className="block h-3 origin-left rounded-full bg-[var(--tone-solid)] motion-safe:animate-[grow_900ms_var(--ease-out-soft)_both] rtl:origin-right"
                  style={{ width: `${(e.count / max) * 100}%`, animationDelay: `${i * 70}ms` }}
                />
              </span>
              <span className="tabular-nums text-ink-muted">{days(e.count)}</span>
            </li>
          ))}
        </ul>
      </section>

      {insights.factors.length > 0 ? (
        <section aria-labelledby="factors-title" className="space-y-3">
          <h3 id="factors-title" className="text-lg font-semibold">
            {t.factorsTitle}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {insights.factors.map((f) => (
              <li key={f.label} className="relative overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
                <span
                  aria-hidden
                  className="absolute inset-y-0 start-0 bg-primary/10"
                  style={{ width: `${(f.count / maxFactor) * 100}%` }}
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="font-semibold">{factorLabel(f.label)}</span>
                  <span className="tabular-nums text-ink-muted">{days(f.count)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {insights.links.length > 0 ? (
        <section aria-labelledby="links-title" className="space-y-3 rounded-3xl bg-surface-muted/60 p-5">
          <h3 id="links-title" className="text-lg font-semibold">
            {t.linksTitle}
          </h3>
          <ul className="space-y-2 text-sm">
            {insights.links.map((l) => (
              <li key={`${l.emotion}-${l.factor}`} className="flex items-start gap-2">
                <span aria-hidden className="mt-0.5">
                  {isEmotion(l.emotion) ? EMOJI[l.emotion] : "•"}
                </span>
                <span>
                  {t.link
                    .replace("{emotion}", emotionLabel(l.emotion))
                    .replace("{days}", String(l.days))
                    .replace("{factor}", factorLabel(l.factor))}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">{t.caveat}</p>
        </section>
      ) : null}

      <section aria-labelledby="calendar-title" className="space-y-3">
        <h3 id="calendar-title" className="text-lg font-semibold">
          {t.calendarTitle}
        </h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {insights.calendar.map((d) => {
            const first = d.emotions.find(isEmotion);
            return (
              <li
                key={d.day}
                className="tone rounded-2xl border border-line bg-surface px-3 py-2.5 text-sm"
                style={toneStyle(first ? EMOTION_HUE[first] : 178, first ? undefined : 0.02)}
              >
                <span className="block text-xs font-semibold text-ink-muted">{dayFormat.format(new Date(`${d.day}T00:00:00Z`))}</span>
                <span className="mt-1.5 flex flex-wrap gap-1" aria-label={d.emotions.map(emotionLabel).join(", ")}>
                  {d.emotions.map((e) => (
                    <span key={e} aria-hidden title={emotionLabel(e)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--tone-bg)] text-base">
                      {isEmotion(e) ? EMOJI[e] : e}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
