import type { MoodCheckin } from "@/lib/api/backend";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";

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

/** The user's own recent check-ins: date and score only (notes are not shown here). */
export function MoodHistory({ checkins, locale = "en" }: { checkins: MoodCheckin[]; locale?: Locale }) {
  const t = messages[locale].checkIn;
  if (checkins.length === 0) {
    return <p className="text-sm text-ink-muted">{t.empty}</p>;
  }
  return (
    <ul aria-label={t.listLabel} className="divide-y divide-line text-sm">
      {checkins.map((checkin) => (
        <li key={checkin.checkin_id} className="flex items-center justify-between gap-4 py-2.5">
          <time dateTime={checkin.submitted_at}>{formatCheckinTime(checkin.submitted_at, locale)}</time>
          <span className="rounded-full bg-surface-muted px-2.5 py-0.5 font-semibold text-primary-strong" dir="ltr">
            {checkin.mood_score} / 5
          </span>
        </li>
      ))}
    </ul>
  );
}
