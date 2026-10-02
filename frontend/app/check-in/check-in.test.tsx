import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MoodForm } from "@/components/mood/mood-form";
import { MoodHistory } from "@/components/mood/mood-history";
import type { MoodFormState } from "@/lib/mood/actions";
import { parseMoodScore } from "@/lib/mood/score";
import {
  backend,
  fail,
  getVerifiedSession,
  moodCheckin,
  myConsent,
  ok,
  SESSION,
  VERSION,
} from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { default: CheckInPage } = await import("@/app/check-in/page");
const { submitMoodCheckin } = await import("@/lib/mood/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
  backend.fetchMoodHistory.mockResolvedValue(ok({ checkins: [] }));
  backend.recordMoodCheckin.mockResolvedValue(
    ok({ checkin_id: "c1", submitted_at: "2026-10-02T09:00:00Z" }, 201),
  );
});

describe("check-in page", () => {
  it("requires a signed-in user", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(CheckInPage())).toBe("/sign-in?next=/check-in");
  });

  it.each([
    ["missing", "/onboarding"],
    ["declined", "/onboarding/consent"],
    ["outdated", "/onboarding/consent"],
  ] as const)("is gated on consent (%s → %s)", async (status, step) => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent(status)));
    expect(await expectRedirect(CheckInPage())).toBe(step);
    expect(backend.fetchMoodHistory).not.toHaveBeenCalled();
  });

  it("explains the check-in without clinical language and offers the 1-5 scale", async () => {
    render(await CheckInPage());
    expect(screen.getByText(/not a medical assessment/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "How are you feeling right now?" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(screen.getByRole("link", { name: "Skip for now" }).getAttribute("href")).toBe(
      "/dashboard",
    );
    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const word of ["depress", "disorder", "symptom", "risk score"]) {
      expect(text).not.toContain(word);
    }
  });

  it("shows the user's recent check-ins", async () => {
    backend.fetchMoodHistory.mockResolvedValue(
      ok({ checkins: [moodCheckin(3, "2026-10-02T08:00:00Z")] }),
    );
    render(await CheckInPage());
    expect(screen.getByRole("list", { name: "Recent check-ins" }).textContent).toContain("3 / 5");
    expect(backend.fetchMoodHistory).toHaveBeenCalledWith(SESSION.accessToken, 7);
  });

  it("fails closed when consent can't be checked", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(0, "network_error"));
    render(await CheckInPage());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("still offers the form if only history fails to load", async () => {
    backend.fetchMoodHistory.mockResolvedValue(fail(503, "service_unavailable"));
    render(await CheckInPage());
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByText(/can.t be loaded right now/)).toBeTruthy();
  });
});

describe("submitMoodCheckin", () => {
  it("saves a valid check-in and continues to the dashboard", async () => {
    const url = await expectRedirect(submitMoodCheckin({}, form({ moodScore: "4" })));
    expect(url).toBe("/dashboard?status=checked-in");
    expect(backend.recordMoodCheckin).toHaveBeenCalledWith(SESSION.accessToken, 4);
  });

  it.each(["", "0", "6", "3.5", " 3", "three", "10"])(
    "rejects %j without calling the API",
    async (value) => {
      const state = await submitMoodCheckin({}, form({ moodScore: value }));
      expect(state.fieldError).toBe("Choose a number from 1 to 5.");
      expect(backend.recordMoodCheckin).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing score", async () => {
    expect((await submitMoodCheckin({}, form({}))).fieldError).toBeDefined();
  });

  it("sends the user back to consent if the API requires it", async () => {
    backend.recordMoodCheckin.mockResolvedValue(fail(403, "consent_required"));
    expect(await expectRedirect(submitMoodCheckin({}, form({ moodScore: "2" })))).toBe(
      "/onboarding/consent",
    );
  });

  it("sends the user to sign in if the session is rejected", async () => {
    backend.recordMoodCheckin.mockResolvedValue(fail(401, "unauthorized"));
    expect(await expectRedirect(submitMoodCheckin({}, form({ moodScore: "2" })))).toBe(
      "/sign-in?next=/check-in",
    );
  });

  it("maps a server validation error to the field message", async () => {
    backend.recordMoodCheckin.mockResolvedValue(fail(422, "validation_failed"));
    const state = await submitMoodCheckin({}, form({ moodScore: "2" }));
    expect(state.fieldError).toBe("Choose a number from 1 to 5.");
  });

  it("shows a safe message when the API is unavailable", async () => {
    backend.recordMoodCheckin.mockResolvedValue(fail(0, "network_error"));
    const state = await submitMoodCheckin({}, form({ moodScore: "2" }));
    expect(state.formError).toBe("We couldn't save your check-in right now. Please try again.");
  });

  it("requires a signed-in user", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(submitMoodCheckin({}, form({ moodScore: "2" })))).toBe(
      "/sign-in?next=/check-in",
    );
    expect(backend.recordMoodCheckin).not.toHaveBeenCalled();
  });
});

describe("parseMoodScore", () => {
  it("accepts only the documented 1-5 integers", () => {
    expect(["1", "2", "3", "4", "5"].map(parseMoodScore)).toEqual([1, 2, 3, 4, 5]);
    expect(parseMoodScore(null)).toBeNull();
    expect(parseMoodScore(new File([], "x"))).toBeNull();
  });
});

describe("MoodForm", () => {
  it("submits the selected score", async () => {
    const action = vi.fn<(s: MoodFormState, d: FormData) => Promise<MoodFormState>>(
      async () => ({}),
    );
    render(<MoodForm action={action} />);
    await userEvent.click(screen.getByRole("radio", { name: "4" }));
    await userEvent.click(screen.getByRole("button", { name: "Save check-in" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0]?.[1].get("moodScore")).toBe("4");
  });

  it("shows validation feedback", async () => {
    const action = vi.fn(
      async (): Promise<MoodFormState> => ({ fieldError: "Choose a number from 1 to 5." }),
    );
    render(<MoodForm action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Save check-in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a number from 1 to 5.");
  });

  it("shows a form-level error", async () => {
    const action = vi.fn(async (): Promise<MoodFormState> => ({ formError: "We couldn't save." }));
    render(<MoodForm action={action} />);
    await userEvent.click(screen.getByRole("radio", { name: "2" }));
    await userEvent.click(screen.getByRole("button", { name: "Save check-in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save.");
  });
});

describe("MoodHistory", () => {
  it("lists date and score only, never the note", () => {
    render(
      <MoodHistory
        checkins={[{ ...moodCheckin(2, "2026-10-02T09:30:00Z"), note: "private text" }]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("2 / 5");
    expect(item.textContent).toContain("UTC");
    expect(document.body.textContent).not.toContain("private text");
  });

  it("has an empty state", () => {
    render(<MoodHistory checkins={[]} />);
    expect(screen.getByText("No check-ins yet.")).toBeTruthy();
  });
});
