import { beforeEach, describe, expect, it, vi } from "vitest";

import { backend, fail, getVerifiedSession, ok, PROFILE, SESSION, VERSION } from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);

const { saveProfile, submitConsent } = await import("@/lib/onboarding/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.updateProfile.mockResolvedValue(ok(PROFILE));
  backend.recordConsent.mockResolvedValue(
    ok({ consent_id: "c1", version: VERSION, granted: true, recorded_at: "now" }, 201),
  );
});

describe("saveProfile", () => {
  it("saves the display name and moves on to consent", async () => {
    const url = await expectRedirect(saveProfile({}, form({ displayName: "  Salma " })));
    expect(url).toBe("/onboarding/consent");
    expect(backend.updateProfile).toHaveBeenCalledWith(SESSION.accessToken, { display_name: "Salma" });
  });

  it("treats an empty name as no display name", async () => {
    await expectRedirect(saveProfile({}, form({ displayName: "   " })));
    expect(backend.updateProfile).toHaveBeenCalledWith(SESSION.accessToken, { display_name: null });
  });

  it("can be skipped without saving anything", async () => {
    const url = await expectRedirect(saveProfile({}, form({ intent: "skip", displayName: "x" })));
    expect(url).toBe("/onboarding/consent");
    expect(backend.updateProfile).not.toHaveBeenCalled();
  });

  it.each([["x".repeat(51)], ["bad\u0000name"]])("rejects invalid input before calling the API", async (name) => {
    const state = await saveProfile({}, form({ displayName: name }));
    expect(state.fieldError).toBeDefined();
    expect(backend.updateProfile).not.toHaveBeenCalled();
  });

  it("shows a safe message when the API fails", async () => {
    backend.updateProfile.mockResolvedValue(fail(503, "service_unavailable"));
    const state = await saveProfile({}, form({ displayName: "Salma" }));
    expect(state.formError).toBe("We couldn't save this right now. Please try again.");
    expect(state.displayName).toBe("Salma");
  });

  it("requires a signed-in user", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(saveProfile({}, form({ displayName: "Salma" })))).toBe(
      "/sign-in?next=/onboarding",
    );
    expect(backend.updateProfile).not.toHaveBeenCalled();
  });
});

describe("submitConsent", () => {
  it("records explicit agreement to the shown version and opens the dashboard", async () => {
    const url = await expectRedirect(
      submitConsent({}, form({ intent: "accept", version: VERSION, confirmRead: "on" })),
    );
    expect(url).toBe("/dashboard");
    expect(backend.recordConsent).toHaveBeenCalledWith(SESSION.accessToken, VERSION, true);
  });

  it("does not record agreement unless the confirmation box is ticked", async () => {
    const state = await submitConsent({}, form({ intent: "accept", version: VERSION }));
    expect(state.fieldError).toBe("Please confirm that you have read and agree to the terms.");
    expect(backend.recordConsent).not.toHaveBeenCalled();
  });

  it("records a decline and stays on the page", async () => {
    backend.recordConsent.mockResolvedValue(
      ok({ consent_id: "c2", version: VERSION, granted: false, recorded_at: "now" }, 201),
    );
    const state = await submitConsent({}, form({ intent: "decline", version: VERSION }));
    expect(state).toEqual({ declined: true });
    expect(backend.recordConsent).toHaveBeenCalledWith(SESSION.accessToken, VERSION, false);
  });

  it.each(["consent_version_not_current", "unknown_version"])(
    "asks the user to review again when the version is %s",
    async (code) => {
      backend.recordConsent.mockResolvedValue(fail(422, code));
      const state = await submitConsent({}, form({ intent: "accept", version: "old", confirmRead: "on" }));
      expect(state.formError).toContain("terms were updated");
    },
  );

  it("shows a safe message when the API is unavailable", async () => {
    backend.recordConsent.mockResolvedValue(fail(0, "network_error"));
    const state = await submitConsent({}, form({ intent: "accept", version: VERSION, confirmRead: "on" }));
    expect(state.formError).toBe("We couldn't save this right now. Please try again.");
  });

  it("requires a signed-in user", async () => {
    getVerifiedSession.mockResolvedValue(null);
    const url = await expectRedirect(
      submitConsent({}, form({ intent: "accept", version: VERSION, confirmRead: "on" })),
    );
    expect(url).toBe("/sign-in?next=/onboarding/consent");
    expect(backend.recordConsent).not.toHaveBeenCalled();
  });
});
