import { format, type Messages } from "@/lib/i18n/messages";

/** "Step 1 of 2" as text plus a two-segment bar (the text carries the meaning). */
export function StepIndicator({ step, t }: { step: 1 | 2; t: Messages }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-primary-strong">{format(t.onboarding.stepOf, { step: String(step) })}</p>
      <div className="flex gap-2" aria-hidden>
        {[1, 2].map((n) => (
          <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-line"}`} />
        ))}
      </div>
    </div>
  );
}
