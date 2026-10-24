import { formatCheckinTime } from "@/components/mood/mood-history";
import type { MoodCheckin } from "@/lib/api/backend";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 32 };
const SCORES = [1, 2, 3, 4, 5];

/**
 * The user's own check-ins as a single-series line (oldest on the left).
 * Server-rendered SVG, no JavaScript: each point has a native tooltip
 * (<title>) and a hit area larger than the visible marker. The chart reads
 * left-to-right in both languages; the data is also available as a table.
 */
export function MoodChart({ checkins, locale = "en" }: { checkins: MoodCheckin[]; locale?: Locale }) {
  const t = messages[locale].history;
  // Legacy 1-5 check-ins only: reflections have feelings, not a score.
  const points = [...checkins]
    .filter((c): c is MoodCheckin & { mood_score: number } => c.mood_score !== null)
    .reverse();
  if (points.length < 2) return null;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (score: number) => PAD.top + ((5 - score) / 4) * plotH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.mood_score).toFixed(1)}`).join(" ");

  return (
    <figure className="space-y-2">
      <figcaption>
        <h2 id="chart-title" className="text-lg font-bold">
          {t.chartTitle}
        </h2>
        <p id="chart-desc" className="text-sm text-ink-muted">
          {t.chartDescription}
        </p>
      </figcaption>
      <div dir="ltr">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby="chart-title chart-desc"
          className="h-auto w-full"
        >
          {/* Recessive grid and y-axis labels (1-5). */}
          {SCORES.map((score) => (
            <g key={score}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(score)} y2={y(score)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 10} y={y(score)} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="var(--ink-muted)">
                {score}
              </text>
            </g>
          ))}
          <path d={path} fill="none" stroke="var(--chart-series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <g key={p.checkin_id}>
              <title>{`${formatCheckinTime(p.submitted_at, locale)}: ${p.mood_score} / 5`}</title>
              {/* Hit area larger than the marker; 2px surface ring separates the marker from the line. */}
              <circle cx={x(i)} cy={y(p.mood_score)} r={12} fill="transparent" />
              <circle cx={x(i)} cy={y(p.mood_score)} r={5} fill="var(--chart-series)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
