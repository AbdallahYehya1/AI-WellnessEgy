import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { backend, CURRENT, fail, getVerifiedSession, ME, moodCheckin, myConsent, ok, PROFILE, SESSION, VERSION } from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/preferences/actions", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));
vi.mock("@/lib/settings/actions", () => ({ updateDisplayName: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: HistoryPage } = await import("@/app/history/page");
const { default: SettingsPage } = await import("@/app/settings/page");

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
  backend.fetchMoodHistory.mockResolvedValue(ok({ checkins: [] }));
  backend.fetchProfile.mockResolvedValue(ok(PROFILE));
  backend.fetchMe.mockResolvedValue({ status: "ok", me: ME });
  backend.fetchCurrentConsent.mockResolvedValue(ok(CURRENT));
});

describe("history page", () => {
  it("requires sign-in and consent", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(HistoryPage())).toBe("/sign-in?next=/history");
    getVerifiedSession.mockResolvedValue(SESSION);
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("missing")));
    expect(await expectRedirect(HistoryPage())).toBe("/onboarding");
    expect(backend.fetchMoodHistory).not.toHaveBeenCalled();
  });

  it("shows an empty state with a next action", async () => {
    render(await HistoryPage());
    expect(screen.getByText("No check-ins yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Do your first check-in" }).getAttribute("href")).toBe("/check-in");
  });

  it("shows an accessible chart and the same data as a table", async () => {
    backend.fetchMoodHistory.mockResolvedValue(
      ok({ checkins: [moodCheckin(4, "2026-10-03T09:00:00Z"), moodCheckin(2, "2026-10-02T09:00:00Z")] }),
    );
    render(await HistoryPage());
    const chart = screen.getByRole("img", { name: /Mood over your last check-ins/ });
    expect(chart.querySelectorAll("title")).toHaveLength(2);
    const table = screen.getByRole("table", { name: "Your check-ins" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual([expect.stringContaining("4 / 5"), expect.stringContaining("2 / 5")]);
    expect(backend.fetchMoodHistory).toHaveBeenCalledWith(SESSION.accessToken, 30);
  });

  it("explains when check-ins can't be loaded", async () => {
    backend.fetchMoodHistory.mockResolvedValue(fail(503, "service_unavailable"));
    render(await HistoryPage());
    expect(screen.getByRole("status").textContent).toMatch(/can't be loaded/);
  });
});

describe("settings page", () => {
  it("requires sign-in", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(SettingsPage())).toBe("/sign-in?next=/settings");
  });

  it("offers only supported settings, and explains unsupported account actions", async () => {
    render(await SettingsPage());
    expect(screen.getByLabelText("What should we call you?")).toBeTruthy();
    expect(screen.getByLabelText("Language")).toBeTruthy();
    expect(screen.getByLabelText("Theme")).toBeTruthy();
    expect(screen.getByText(`You agreed to version ${VERSION} on 2026-09-29.`)).toBeTruthy();
    expect(screen.getByText(/draft pending legal review/)).toBeTruthy();
    expect(screen.getByText(/Withdrawing consent from the app isn't available yet/)).toBeTruthy();
    expect(screen.getByText(/Exporting or deleting your data from the app isn't available yet/)).toBeTruthy();
    for (const name of [/delete/i, /export/i, /withdraw/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
  });

  it("fails closed when consent can't be checked", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(0, "network_error"));
    render(await SettingsPage());
    expect(screen.getByRole("alert").textContent).toContain("can't load your account");
    expect(screen.queryByLabelText("Language")).toBeNull();
  });
});
