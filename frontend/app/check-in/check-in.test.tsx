import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MoodHistory } from "@/components/mood/mood-history";
import { ReflectionForm } from "@/components/mood/reflection-form";
import type { ReflectionFormState } from "@/lib/mood/actions";
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
vi.mock("@/lib/preferences/actions", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { default: CheckInPage } = await import("@/app/check-in/page");
const { submitReflection } = await import("@/lib/mood/actions");

function form(emotions: string[], factors: string[] = []): FormData {
  const data = new FormData();
  for (const e of emotions) data.append("emotions", e);
  for (const f of factors) data.append("factors", f);
  return data;
}

function reflection(emotions: string[], submittedAt: string) {
  return { checkin_id: `r-${submittedAt}`, kind: "reflection" as const, mood_score: null, emotions, factors: [], tags: [], note: null, submitted_at: submittedAt };
}

const READY = [
  { assistant_id: "career", status: "ready", icon: "briefcase", name_en: "Career & Work", name_ar: "الشغل", description_en: "", description_ar: "", starters_en: [], starters_ar: [] },
  { assistant_id: "fitness", status: "preview", icon: "activity", name_en: "Fitness", name_ar: "اللياقة", description_en: "", description_ar: "", starters_en: [], starters_ar: [] },
];

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
  backend.fetchMoodHistory.mockResolvedValue(ok({ checkins: [] }));
  backend.fetchChatConfig.mockResolvedValue(
    ok({ enabled: true, age_band: "adult", age_band_label: "Adult", test_only_policy: false, prototype: true, assistants: READY }),
  );
  backend.recordReflection.mockResolvedValue(
    ok({ checkin_id: "r1", submitted_at: "2026-10-23T09:00:00Z", suggested_assistants: ["career"] }, 201),
  );
});

describe("Daily Reflection page", () => {
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

  it("asks how you feel with labelled feelings, optional factors and no numeric scale", async () => {
    render(await CheckInPage());
    expect(screen.getByRole("heading", { name: "Daily Reflection" })).toBeTruthy();
    const feelings = screen.getByRole("group", { name: "How do you feel today?" });
    const boxes = within(feelings).getAllByRole("checkbox");
    expect(boxes).toHaveLength(9);
    for (const label of ["Happy", "Calm", "Good", "Okay", "Anxious", "Sad", "Frustrated", "Tired", "Excited"]) {
      expect(within(feelings).getByRole("checkbox", { name: new RegExp(label) })).toBeTruthy();
    }
    const factors = screen.getByRole("group", { name: "What's contributing to how you feel? (optional)" });
    expect(within(factors).getAllByRole("checkbox")).toHaveLength(11);
    expect(screen.queryByRole("radio")).toBeNull();
    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const word of ["depress", "disorder", "symptom", "risk score", "streak"]) {
      expect(text).not.toContain(word);
    }
  });

  it("shows recent reflections and old check-ins accurately", async () => {
    backend.fetchMoodHistory.mockResolvedValue(
      ok({ checkins: [reflection(["excited", "anxious"], "2026-10-22T08:00:00Z"), moodCheckin(3, "2026-10-02T08:00:00Z")] }),
    );
    render(await CheckInPage());
    const list = screen.getByRole("list", { name: "Recent check-ins" });
    expect(list.textContent).toContain("Excited");
    expect(list.textContent).toContain("Anxious");
    expect(list.textContent).toContain("Check-in: 3 / 5");
  });

  it("fails closed when consent can't be checked", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(0, "network_error"));
    render(await CheckInPage());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("still offers the form if only history fails to load", async () => {
    backend.fetchMoodHistory.mockResolvedValue(fail(503, "service_unavailable"));
    render(await CheckInPage());
    expect(screen.getAllByRole("checkbox").length).toBe(20);
    expect(screen.getByText(/can.t load your recent reflections/)).toBeTruthy();
  });
});

describe("submitReflection", () => {
  it("saves feelings and factors and offers ready assistants, sharing nothing", async () => {
    const state = await submitReflection({}, form(["anxious", "excited"], ["work"]));
    expect(backend.recordReflection).toHaveBeenCalledWith(SESSION.accessToken, ["anxious", "excited"], ["work"]);
    expect(state.saved).toEqual({ emotions: ["anxious", "excited"], factors: ["work"], suggestions: ["career"] });
  });

  it.each([[[]], [["hopeless"]]])("needs at least one known feeling (%j)", async (emotions) => {
    const state = await submitReflection({}, form(emotions));
    expect(state.fieldError).toBe("Choose at least one feeling.");
    expect(backend.recordReflection).not.toHaveBeenCalled();
  });

  it("drops unknown factors and duplicates before sending", async () => {
    await submitReflection({}, form(["calm", "calm"], ["work", "dating apps", "work"]));
    expect(backend.recordReflection).toHaveBeenCalledWith(SESSION.accessToken, ["calm"], ["work"]);
  });

  it("sends the user back to consent or sign-in when needed", async () => {
    backend.recordReflection.mockResolvedValue(fail(403, "consent_required"));
    expect(await expectRedirect(submitReflection({}, form(["calm"])))).toBe("/onboarding/consent");
    backend.recordReflection.mockResolvedValue(fail(401, "unauthorized"));
    expect(await expectRedirect(submitReflection({}, form(["calm"])))).toBe("/sign-in?next=/check-in");
  });

  it("shows a safe message when the API is unavailable", async () => {
    backend.recordReflection.mockResolvedValue(fail(0, "network_error"));
    const state = await submitReflection({}, form(["calm"]));
    expect(state.formError).toBe("We couldn't save your reflection right now. Please try again.");
  });
});

describe("ReflectionForm", () => {
  it("submits several feelings and optional factors", async () => {
    const action = vi.fn<(s: ReflectionFormState, d: FormData) => Promise<ReflectionFormState>>(async () => ({}));
    render(<ReflectionForm action={action} assistantNames={{}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Excited/ }));
    await user.click(screen.getByRole("checkbox", { name: /Anxious/ }));
    await user.click(screen.getByRole("checkbox", { name: "Work" }));
    await user.click(screen.getByRole("button", { name: "Save reflection" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const data = action.mock.calls[0]![1];
    expect(data.getAll("emotions")).toEqual(["anxious", "excited"]);
    expect(data.getAll("factors")).toEqual(["work"]);
  });

  it("after saving offers optional next steps that open an assistant without sharing the reflection", async () => {
    const action = vi.fn(async (): Promise<ReflectionFormState> => ({
      saved: { emotions: ["anxious"], factors: ["work"], suggestions: ["career", "fitness"] },
    }));
    render(<ReflectionForm action={action} assistantNames={{ career: "Career & Work" }} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Save reflection" }));
    expect(await screen.findByText("Reflection saved")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Talk it through with Career & Work" });
    expect(link.getAttribute("href")).toBe("/chat?assistant=career"); // no feelings in the URL
    expect(screen.queryByText(/fitness/i)).toBeNull(); // not ready, not offered
    expect(screen.getByRole("link", { name: "See your reflections" }).getAttribute("href")).toBe("/history");
  });

  it("needs no follow-up for good feelings", async () => {
    const action = vi.fn(async (): Promise<ReflectionFormState> => ({
      saved: { emotions: ["happy", "calm"], factors: [], suggestions: [] },
    }));
    render(<ReflectionForm action={action} assistantNames={{}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Save reflection" }));
    expect(await screen.findByText(/Good feelings are worth noticing too/)).toBeTruthy();
  });

  it("gives every choice a visible focus style distinct from the selected style", () => {
    render(<ReflectionForm action={vi.fn(async () => ({}))} assistantNames={{}} />);
    for (const box of screen.getAllByRole("checkbox")) {
      const label = box.closest("label");
      for (const cls of ["has-focus-visible:outline-2", "has-focus-visible:outline-offset-2", "has-focus-visible:outline-focus"]) {
        expect(label?.classList.contains(cls)).toBe(true);
      }
      // A selected choice has its own background, distinct from the focus outline.
      expect([...(label?.classList ?? [])].some((cls) => cls.startsWith("has-checked:bg-"))).toBe(true);
    }
  });

  it("is operable with the keyboard alone", async () => {
    const action = vi.fn<(s: ReflectionFormState, d: FormData) => Promise<ReflectionFormState>>(async () => ({}));
    render(<ReflectionForm action={action} assistantNames={{}} />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /Happy/ }));
    await user.keyboard(" ");
    expect((screen.getByRole("checkbox", { name: /Happy/ }) as HTMLInputElement).checked).toBe(true);
    screen.getByRole("button", { name: "Save reflection" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0]![1].getAll("emotions")).toEqual(["happy"]);
  });

  it("works in Arabic with the Egyptian Arabic question", () => {
    render(<ReflectionForm action={vi.fn(async () => ({}))} assistantNames={{}} locale="ar" />);
    expect(screen.getByRole("group", { name: "حاسس بإيه النهارده؟" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /مبسوط/ })).toBeTruthy();
  });
});

describe("MoodHistory", () => {
  it("lists date and what was recorded, never the note", () => {
    render(<MoodHistory checkins={[{ ...moodCheckin(2, "2026-10-02T09:30:00Z"), note: "private text" }]} />);
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("Check-in: 2 / 5");
    expect(item.textContent).toContain("2 Oct 2026, 12:30"); // Cairo time
    expect(document.body.textContent).not.toContain("private text");
  });

  it("formats dates in Arabic for Arabic visitors", () => {
    render(<MoodHistory checkins={[moodCheckin(4, "2026-10-02T09:30:00Z")]} locale="ar" />);
    expect(screen.getByRole("list", { name: "آخر التسجيلات" }).textContent).toContain("١٢:٣٠");
  });

  it("has an empty state", () => {
    render(<MoodHistory checkins={[]} />);
    expect(screen.getByText("No reflections yet.")).toBeTruthy();
  });
});
