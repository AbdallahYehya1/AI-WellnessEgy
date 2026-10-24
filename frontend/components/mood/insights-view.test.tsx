import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InsightsView } from "@/components/mood/insights-view";
import type { MoodInsights } from "@/lib/api/backend";

const WEEK: MoodInsights = {
  period: "week",
  start: "2026-10-19",
  end: "2026-10-26",
  reflections: 5,
  days_with_reflections: 4,
  enough_data: true,
  emotions: [
    { label: "anxious", count: 3 },
    { label: "calm", count: 2 },
    { label: "excited", count: 1 },
  ],
  factors: [{ label: "work", count: 11 }],
  links: [{ emotion: "anxious", factor: "work", days: 2 }],
  calendar: [
    { day: "2026-10-20", emotions: ["anxious", "tired"] },
    { day: "2026-10-22", emotions: ["calm"] },
  ],
};

describe("InsightsView", () => {
  it("counts days with correct plurals", () => {
    render(<InsightsView insights={WEEK} />);
    const feelings = screen.getByRole("heading", { name: "Feelings you chose most" }).parentElement!;
    expect(feelings.textContent).toContain("3 days");
    expect(feelings.textContent).toContain("1 day");
    expect(feelings.textContent).not.toContain("1 days");
  });

  it("uses Arabic dual and plural forms", () => {
    render(<InsightsView insights={WEEK} locale="ar" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("3 أيام");
    expect(text).toContain("يومين");
    expect(text).toContain("يوم واحد");
    expect(text).toContain("11 يوم");
  });

  it("describes co-occurrence without claiming a cause", () => {
    render(<InsightsView insights={WEEK} />);
    expect(screen.getByText("You chose Anxious on 2 days when Work was marked.")).toBeTruthy();
    expect(screen.getByText(/They don't show causes/)).toBeTruthy();
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const word of ["because", "caused", "diagnos", "score", "streak"]) expect(text).not.toContain(word);
  });

  it("gives each day's emoji a text alternative", () => {
    render(<InsightsView insights={WEEK} />);
    expect(screen.getByLabelText("Anxious, Tired")).toBeTruthy();
  });

  it("shows only a gentle note when there isn't enough yet", () => {
    render(<InsightsView insights={{ ...WEEK, enough_data: false }} />);
    expect(screen.getByRole("status").textContent).toContain("Skipping days is completely fine");
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
