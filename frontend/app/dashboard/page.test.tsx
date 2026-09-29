import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { backend, fail, getVerifiedSession, ME, myConsent, ok, SESSION } from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));

const { default: DashboardPage } = await import("@/app/dashboard/page");

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", "2026-09-29.draft-1")));
  backend.fetchMe.mockResolvedValue({ status: "ok", me: ME });
});

describe("DashboardPage", () => {
  it("redirects to sign-in without a verified session", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(DashboardPage())).toBe("/sign-in?next=/dashboard");
    expect(backend.fetchMyConsent).not.toHaveBeenCalled();
  });

  it("sends a new user (no consent) to profile setup", async () => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("missing")));
    expect(await expectRedirect(DashboardPage())).toBe("/onboarding");
    expect(backend.fetchMe).not.toHaveBeenCalled();
  });

  it.each(["declined", "outdated"] as const)("sends a %s user to the consent step", async (status) => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent(status, "old")));
    expect(await expectRedirect(DashboardPage())).toBe("/onboarding/consent");
  });

  it("shows the dashboard only after consent, with the API-verified identity", async () => {
    render(await DashboardPage());
    expect(screen.getByText(ME.email as string)).toBeTruthy();
    expect(screen.getByText(/, Salma/)).toBeTruthy();
    expect(screen.getByText(/verified by the AI Wellness Egypt API/)).toBeTruthy();
    expect(backend.fetchMyConsent).toHaveBeenCalledWith(SESSION.accessToken);
  });

  it("fails closed when consent can't be checked", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(0, "network_error"));
    render(await DashboardPage());
    expect(screen.getByRole("alert").textContent).toContain("can't load your account");
    expect(screen.queryByText(/verified by the AI Wellness Egypt API/)).toBeNull();
  });

  it("sends the user to sign in when the API rejects the session", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(401, "unauthorized"));
    expect(await expectRedirect(DashboardPage())).toBe("/sign-in?next=/dashboard");
  });
});
