import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backend,
  fail,
  getVerifiedSession,
  ME,
  moodCheckin,
  myConsent,
  ok,
  SESSION,
} from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/preferences/actions", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function props(values: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(values) };
}

const { default: DashboardPage } = await import("@/app/dashboard/page");

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", "2026-09-29.draft-1")));
  backend.fetchMe.mockResolvedValue({ status: "ok", me: ME });
  backend.fetchMoodHistory.mockResolvedValue(ok({ checkins: [] }));
  backend.fetchChatConfig.mockResolvedValue(fail(503, "service_unavailable"));
});

describe("DashboardPage", () => {
  it("redirects to sign-in without a verified session", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(DashboardPage(props()))).toBe("/sign-in?next=/dashboard");
    expect(backend.fetchMyConsent).not.toHaveBeenCalled();
  });

  it("sends a new user (no consent) to profile setup", async () => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("missing")));
    expect(await expectRedirect(DashboardPage(props()))).toBe("/onboarding");
    expect(backend.fetchMe).not.toHaveBeenCalled();
  });

  it.each(["declined", "outdated"] as const)("sends a %s user to the consent step", async (status) => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent(status, "old")));
    expect(await expectRedirect(DashboardPage(props()))).toBe("/onboarding/consent");
  });

  it("shows the dashboard only after consent, greeting the user by name", async () => {
    render(await DashboardPage(props()));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome, Salma");
    expect(backend.fetchMyConsent).toHaveBeenCalledWith(SESSION.accessToken);
  });

  it("shows no email address or internal API wording", async () => {
    render(await DashboardPage(props()));
    expect(document.body.textContent).not.toContain(ME.email as string);
    expect(document.body.textContent).not.toMatch(/API|session was verified|placeholder/i);
  });

  it("puts check-in, progress and settings first-class, with navigation", async () => {
    render(await DashboardPage(props()));
    expect(screen.getByRole("link", { name: "Check in now" }).getAttribute("href")).toBe("/check-in");
    expect(screen.getByRole("link", { name: "See your progress" }).getAttribute("href")).toBe("/history");
    expect(screen.getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getAllByRole("navigation", { name: "Main" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
  });

  it("fails closed when consent can't be checked", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(0, "network_error"));
    render(await DashboardPage(props()));
    expect(screen.getByRole("alert").textContent).toContain("can't load your account");
    expect(screen.queryByRole("heading", { name: /Welcome/ })).toBeNull();
  });

  it("sends the user to sign in when the API rejects the session", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(401, "unauthorized"));
    expect(await expectRedirect(DashboardPage(props()))).toBe("/sign-in?next=/dashboard");
  });

  it("shows the saved notice after a check-in, and the recent history", async () => {
    backend.fetchMoodHistory.mockResolvedValue(
      ok({ checkins: [moodCheckin(4, "2026-10-02T09:30:00Z"), moodCheckin(2, "2026-10-01T09:00:00Z")] }),
    );
    render(await DashboardPage(props({ status: "checked-in" })));
    expect(screen.getByText("✓ Your check-in was saved.")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Recent check-ins" });
    const items = [...list.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual([expect.stringContaining("4 / 5"), expect.stringContaining("2 / 5")]);
    expect(screen.getByRole("link", { name: "Check in now" }).getAttribute("href")).toBe("/check-in");
    expect(backend.fetchMoodHistory).toHaveBeenCalledWith(SESSION.accessToken, 7);
  });

  it("ignores unknown status values", async () => {
    render(await DashboardPage(props({ status: "<b>hacked</b>" })));
    expect(screen.queryByText(/check-in was saved/)).toBeNull();
    expect(document.body.textContent).not.toContain("hacked");
  });

  it("stays usable when mood history can't be loaded", async () => {
    backend.fetchMoodHistory.mockResolvedValue(fail(503, "service_unavailable"));
    render(await DashboardPage(props()));
    expect(screen.getByText(/recent check-ins can.t be loaded/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Check in now" })).toBeTruthy();
  });

  it("does not load mood history before consent", async () => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("missing")));
    await expectRedirect(DashboardPage(props()));
    expect(backend.fetchMoodHistory).not.toHaveBeenCalled();
  });

  it("links to the assistant only when the server reports it as enabled", async () => {
    render(await DashboardPage(props()));
    expect(screen.queryByRole("link", { name: "Open the assistant" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Assistants" })).toBeNull();
    expect(screen.getByText("The assistant isn't available yet. It's still being tested privately.")).toBeTruthy();

    backend.fetchChatConfig.mockResolvedValue(
      ok({ enabled: true, age_band: "adult", age_band_label: "Adult", test_only_policy: true, prototype: true }),
    );
    render(await DashboardPage(props()));
    expect(screen.getByRole("link", { name: "Open the assistant" }).getAttribute("href")).toBe("/assistants");
    expect(screen.getAllByRole("link", { name: "Assistants" })[0]?.getAttribute("href")).toBe("/assistants");
  });
});
