import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backend,
  CURRENT,
  fail,
  getVerifiedSession,
  myConsent,
  ok,
  PROFILE,
  SESSION,
  VERSION,
} from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/onboarding/actions", () => ({ saveProfile: vi.fn(), submitConsent: vi.fn() }));

const { default: ProfilePage } = await import("@/app/onboarding/page");
const { default: ConsentPage } = await import("@/app/onboarding/consent/page");

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("missing")));
  backend.fetchProfile.mockResolvedValue(ok(PROFILE));
  backend.fetchCurrentConsent.mockResolvedValue(ok(CURRENT));
});

describe("onboarding: profile step", () => {
  it("requires a signed-in user", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(ProfilePage())).toBe("/sign-in?next=/onboarding");
  });

  it("shows the profile form to an authenticated user without consent", async () => {
    render(await ProfilePage());
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(screen.getByLabelText(/What should we call you/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
  });

  it("pre-fills an existing display name", async () => {
    backend.fetchProfile.mockResolvedValue(ok({ ...PROFILE, display_name: "Salma" }));
    render(await ProfilePage());
    expect((screen.getByLabelText(/What should we call you/) as HTMLInputElement).value).toBe("Salma");
  });

  it("sends users who already consented to the dashboard", async () => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
    expect(await expectRedirect(ProfilePage())).toBe("/dashboard");
  });

  it("fails closed when the API is unavailable", async () => {
    backend.fetchProfile.mockResolvedValue(fail(503, "service_unavailable"));
    render(await ProfilePage());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText(/What should we call you/)).toBeNull();
  });
});

describe("onboarding: consent step", () => {
  it("requires a signed-in user", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(ConsentPage())).toBe("/sign-in?next=/onboarding/consent");
  });

  it("shows the current version, the draft notice and an explicit agreement form", async () => {
    const { container } = render(await ConsentPage());
    expect(screen.getByTestId("draft-notice").textContent).toContain("pending legal review");
    expect(screen.getByText(new RegExp(`Version ${VERSION.replace(/\./g, "\\.")}`))).toBeTruthy();
    const confirm = screen.getByLabelText("I have read and agree to these terms.") as HTMLInputElement;
    expect(confirm.checked).toBe(false); // never pre-ticked
    expect(container.querySelector<HTMLInputElement>('input[name="version"]')?.value).toBe(VERSION);
    expect(screen.getByRole("button", { name: "Agree and continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I don't agree" })).toBeTruthy();
  });

  it("explains when the terms changed since the user last agreed", async () => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("outdated", "2025-01-01.old")));
    render(await ConsentPage());
    expect(screen.getByText(/terms have changed since you last agreed/)).toBeTruthy();
  });

  it("hides the draft notice once final terms are published", async () => {
    backend.fetchCurrentConsent.mockResolvedValue(ok({ ...CURRENT, pending_legal_review: false }));
    render(await ConsentPage());
    expect(screen.queryByTestId("draft-notice")).toBeNull();
  });

  it("sends users who already consented to the dashboard", async () => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
    expect(await expectRedirect(ConsentPage())).toBe("/dashboard");
  });

  it("fails closed when the current terms can't be loaded", async () => {
    backend.fetchCurrentConsent.mockResolvedValue(fail(0, "network_error"));
    render(await ConsentPage());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agree and continue" })).toBeNull();
  });
});
