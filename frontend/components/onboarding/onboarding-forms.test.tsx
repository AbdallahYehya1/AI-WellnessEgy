import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConsentForm } from "@/components/onboarding/consent-form";
import { ProfileForm } from "@/components/onboarding/profile-form";
import type { ConsentFormState, ProfileFormState } from "@/lib/onboarding/actions";

describe("ProfileForm", () => {
  it("submits the display name", async () => {
    const action = vi.fn<(s: ProfileFormState, d: FormData) => Promise<ProfileFormState>>(
      async () => ({}),
    );
    render(<ProfileForm action={action} initialDisplayName={null} />);
    await userEvent.type(screen.getByLabelText(/What should we call you/), "Salma");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0]?.[1].get("displayName")).toBe("Salma");
  });

  it("offers an explicit skip", async () => {
    const action = vi.fn<(s: ProfileFormState, d: FormData) => Promise<ProfileFormState>>(
      async () => ({}),
    );
    render(<ProfileForm action={action} initialDisplayName={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0]?.[1].get("intent")).toBe("skip");
  });

  it("shows validation errors accessibly and keeps the typed value", async () => {
    const action = vi.fn(
      async (): Promise<ProfileFormState> => ({
        fieldError: "Use at most 50 characters.",
        displayName: "way too long",
      }),
    );
    render(<ProfileForm action={action} initialDisplayName={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Use at most 50 characters.");
    const input = screen.getByLabelText(/What should we call you/) as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("way too long");
  });
});

describe("ConsentForm", () => {
  it("sends the version, the intent and the confirmation", async () => {
    const action = vi.fn<(s: ConsentFormState, d: FormData) => Promise<ConsentFormState>>(
      async () => ({}),
    );
    render(<ConsentForm action={action} version="2026-09-29.draft-1" />);
    await userEvent.click(screen.getByLabelText("I have read and agree to these terms."));
    await userEvent.click(screen.getByRole("button", { name: "Agree and continue" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const data = action.mock.calls[0]?.[1];
    expect(data?.get("version")).toBe("2026-09-29.draft-1");
    expect(data?.get("intent")).toBe("accept");
    expect(data?.get("confirmRead")).toBe("on");
  });

  it("explains the consequence of declining", async () => {
    const action = vi.fn(async (): Promise<ConsentFormState> => ({ declined: true }));
    render(<ConsentForm action={action} version="v" />);
    await userEvent.click(screen.getByRole("button", { name: "I don't agree" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "can't use the app without agreeing",
    );
  });

  it("shows the confirmation error", async () => {
    const action = vi.fn(
      async (): Promise<ConsentFormState> => ({
        fieldError: "Please confirm that you have read and agree to the terms.",
      }),
    );
    render(<ConsentForm action={action} version="v" />);
    await userEvent.click(screen.getByRole("button", { name: "Agree and continue" }));
    expect(await screen.findByText(/Please confirm that you have read/)).toBeTruthy();
  });
});
