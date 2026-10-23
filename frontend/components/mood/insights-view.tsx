import type { MoodInsights } from "@/lib/api/backend";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { EMOJI, EMOTIONS, FACTORS } from "@/lib/mood/score";

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
  const max = Math.max(1, ...insights.emotions.map((e) => e.count));
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
    <div className="space-y-6">
      <section aria-labelledby="feelings-title" className="space-y-3">
        <h3 id="feelings-title" className="font-semibold">
          {t.feelingsTitle}
        </h3>
        <ul className="space-y-2">
          {insights.emotions.map((e) => (
            <li key={e.label} className="grid grid-cols-[minmax(7rem,auto)_1fr_auto] items-center gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <span aria-hidden>{isEmotion(e.label) ? EMOJI[e.label] : ""}</span>
                {emotionLabel(e.label)}
              </span>
              <span aria-hidden className="h-2.5 rounded-full bg-surface-muted">
                <span className="block h-2.5 rounded-full bg-primary" style={{ width: `${(e.count / max) * 100}%` }} />
              </span>
              <span className="text-ink-muted">{t.days.replace("{n}", String(e.count))}</span>
            </li>
          ))}
        </ul>
      </section>

      {insights.factors.length > 0 ? (
        <section aria-labelledby="factors-title" className="space-y-2">
          <h3 id="factors-title" className="font-semibold">
            {t.factorsTitle}
          </h3>
          <ul className="flex flex-wrap gap-2 text-sm">
            {insights.factors.map((f) => (
              <li key={f.label} className="rounded-full bg-surface-muted px-3 py-1">
                {factorLabel(f.label)} · {t.days.replace("{n}", String(f.count))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {insights.links.length > 0 ? (
        <section aria-labelledby="links-title" className="space-y-2">
          <h3 id="links-title" className="font-semibold">
            {t.linksTitle}
          </h3>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {insights.links.map((l) => (
              <li key={`${l.emotion}-${l.factor}`}>
                {t.link
                  .replace("{emotion}", emotionLabel(l.emotion))
                  .replace("{days}", String(l.days))
                  .replace("{factor}", factorLabel(l.factor))}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">{t.caveat}</p>
        </section>
      ) : null}

      <section aria-labelledby="calendar-title" className="space-y-2">
        <h3 id="calendar-title" className="font-semibold">
          {t.calendarTitle}
        </h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {insights.calendar.map((d) => (
            <li key={d.day} className="rounded-2xl border border-line bg-surface px-3 py-2 text-sm">
              <span className="block text-xs text-ink-muted">{dayFormat.format(new Date(`${d.day}T00:00:00Z`))}</span>
              <span className="mt-1 flex flex-wrap gap-1" aria-label={d.emotions.map(emotionLabel).join(", ")}>
                {d.emotions.map((e) => (
                  <span key={e} aria-hidden title={emotionLabel(e)}>
                    {isEmotion(e) ? EMOJI[e] : e}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
