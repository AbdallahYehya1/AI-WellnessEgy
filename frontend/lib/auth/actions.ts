"use server";

import { redirect } from "next/navigation";

import { MESSAGES, signInErrorMessage, signUpErrorOutcome } from "@/lib/auth/errors";
import { siteUrl } from "@/lib/auth/site-url";
import {
  hasErrors,
  readSignIn,
  readSignUp,
  safeNextPath,
  validateSignIn,
  validateSignUp,
  type FieldErrors,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  fieldErrors?: FieldErrors;
  formError?: string;
  // Echoed back so the user doesn't retype it. Passwords are never echoed.
  email?: string;
};

export async function signUp(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = readSignUp(formData);
  const fieldErrors = validateSignUp(input);
  if (hasErrors(fieldErrors)) {
    return { fieldErrors, email: input.email };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { formError: MESSAGES.notConfigured, email: input.email };
  }

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm?next=/dashboard` },
  });

  if (error) {
    const outcome = signUpErrorOutcome(error);
    if (outcome.kind === "error") {
      return { formError: outcome.message, email: input.email };
    }
  } else if (data.session) {
    // Supabase returned a live session, which means email confirmation is
    // switched off in the project (it must be on: OPEN_DECISIONS D-3).
    console.warn("auth: sign-up returned a session; email confirmation appears to be disabled");
    redirect("/dashboard");
  }

  redirect("/auth/check-email");
}

export async function signIn(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = readSignIn(formData);
  const next = safeNextPath(formData.get("next"));
  const fieldErrors = validateSignIn(input);
  if (hasErrors(fieldErrors)) {
    return { fieldErrors, email: input.email };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { formError: MESSAGES.notConfigured, email: input.email };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error) {
    return { formError: signInErrorMessage(error), email: input.email };
  }

  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) {
    // Revokes this session's refresh token and clears the auth cookies.
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect("/sign-in?status=signed-out");
}
