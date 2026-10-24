import type { MoodCheckin } from "@/lib/api/backend";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { EMOJI, EMOTIONS } from "@/lib/mood/score";

// Dates are rendered on the server, so a fixed zone is used: Cairo time for
// the Egypt-first audience (rather than the server's UTC).
export const DISPLAY_TIME_ZONE = "Africa/Cairo";

export function formatCheckinTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(iso));
}

export function cairoDay(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE }).format(new Date(iso));
}

type Emotion = (typeof EMOTIONS)[number];

function isEmotion(value: string): value is Emotion {
  return (EMOTIONS as readonly string[]).includes(value);
}

/** One entry: a reflection's feelings (emoji with visible labels) or an old check-in's exact score. */
export function EntrySummary({ checkin, locale = "en" }: { checkin: MoodCheckin; locale?: Locale }) {
  const r = messages[locale].reflection;
  if (checkin.kind === "reflection" || (checkin.mood_score === null && checkin.emotions?.length)) {
    return (
      <span className="flex flex-wrap justify-end gap-1.5">
        {(checkin.emotions ?? []).filter(isEmotion).map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 font-semibold text-ink">
            <span aria-hidden>{EMOJI[e]}</span>
            {r.emotions[e]}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface-muted px-2.5 py-0.5 font-semibold text-primary-strong" dir="auto">
      {r.legacyScore.replace("{score}", String(checkin.mood_score))}
    </span>
  );
}

/** The user's own recent entries: date and what they recorded (notes are not shown here). */
export function MoodHistory({ checkins, locale = "en" }: { checkins: MoodCheckin[]; locale?: Locale }) {
  const t = messages[locale].checkIn;
  const r = messages[locale].reflection;
  if (checkins.length === 0) {
    return <p className="text-sm text-ink-muted">{r.empty}</p>;
  }
  return (
    <ul aria-label={t.listLabel} className="divide-y divide-line text-sm">
      {checkins.map((checkin) => (
        <li key={checkin.checkin_id} className="flex items-center justify-between gap-4 py-2.5">
          <time dateTime={checkin.submitted_at} className="shrink-0 text-ink-muted">
            {formatCheckinTime(checkin.submitted_at, locale)}
          </time>
          <EntrySummary checkin={checkin} locale={locale} />
        </li>
      ))}
    </ul>
  );
}
