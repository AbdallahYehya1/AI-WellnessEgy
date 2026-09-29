import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import type { AuthFormState } from "@/lib/auth/actions";
import { MESSAGES } from "@/lib/auth/errors";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("SignInForm", () => {
  it("shows a safe, understandable error when sign-in fails", async () => {
    const action = vi.fn(
      async (_state: AuthFormState, data: FormData): Promise<AuthFormState> => ({
        formError: MESSAGES.invalidCredentials,
        email: String(data.get("email")),
      }),
    );
    render(<SignInForm action={action} next="/dashboard" />);

    await userEvent.type(screen.getByLabelText("Email"), "person@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The email or password is incorrect.");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("person@example.com");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("wrong-password");
  });

  it("passes the safe `next` path to the action", async () => {
    const action = vi.fn<(state: AuthFormState, data: FormData) => Promise<AuthFormState>>(
      async () => ({}),
    );
    render(<SignInForm action={action} next="/dashboard/week" />);
    await userEvent.type(screen.getByLabelText("Email"), "person@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0]?.[1].get("next")).toBe("/dashboard/week");
  });

  it("marks invalid fields for assistive technology", async () => {
    const action = vi.fn(
      async (): Promise<AuthFormState> => ({ fieldErrors: { email: "Enter your email address." } }),
    );
    render(<SignInForm action={action} next="/dashboard" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Enter your email address.");
    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe("email-error");
  });
});

describe("SignUpForm", () => {
  it("collects email, password, confirmation and the 18+ checkbox", () => {
    render(<SignUpForm action={vi.fn(async () => ({}))} />);
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.getByLabelText("I confirm that I am 18 or older.")).toBeTruthy();
  });

  it("shows field errors returned by the action", async () => {
    const action = vi.fn(
      async (): Promise<AuthFormState> => ({
        fieldErrors: {
          confirmPassword: "The passwords don't match.",
          ageConfirmed: "You must be 18 or older to create an account.",
        },
      }),
    );
    render(<SignUpForm action={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("The passwords don't match.")).toBeTruthy();
    expect(screen.getByText("You must be 18 or older to create an account.")).toBeTruthy();
  });
});
