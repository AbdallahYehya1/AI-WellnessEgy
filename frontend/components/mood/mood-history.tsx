import type { MoodCheckin } from "@/lib/api/backend";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** The user's own recent check-ins: date and score only (notes are not shown here). */
export function MoodHistory({ checkins }: { checkins: MoodCheckin[] }) {
  if (checkins.length === 0) {
    return <p className="text-sm text-calm-700">No check-ins yet.</p>;
  }
  return (
    <ul aria-label="Recent check-ins" className="divide-y divide-calm-100 text-sm">
      {checkins.map((checkin) => (
        <li key={checkin.checkin_id} className="flex justify-between py-2">
          <time dateTime={checkin.submitted_at}>
            {DATE_FORMAT.format(new Date(checkin.submitted_at))} UTC
          </time>
          <span className="font-medium">{checkin.mood_score} / 5</span>
        </li>
      ))}
    </ul>
  );
}
