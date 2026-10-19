// Map Supabase Auth errors to messages that are safe to show. Raw provider
// messages are never displayed: they can reveal internals or be confusing.

type AuthErrorLike = { code?: string | null; status?: number | null } | null | undefined;

export const MESSAGES = {
  invalidCredentials: "The email or password is incorrect.",
  emailNotConfirmed:
    "Please confirm your email address first. Check your inbox for the confirmation link.",
  rateLimited: "Too many attempts. Please wait a few minutes and try again.",
  weakPassword: "Please choose a stronger password: longer, and harder to guess.",
  invalidEmail: "Enter a valid email address, like name@example.com.",
  signUpUnavailable: "Creating new accounts is unavailable right now. Please try again later.",
  signInFailed: "We couldn't sign you in right now. Please try again.",
  signUpFailed: "We couldn't create your account right now. Please try again.",
  // Supabase's built-in email only reaches the project team's addresses until a
  // custom SMTP sender exists (OPEN_DECISIONS D-49). Says nothing about whether an
  // account exists, so it is safe to show.
  emailNotAuthorized:
    "During testing, this app can only send email to approved test addresses. Please use your test account's email address.",
  notConfigured: "Sign-in isn't available yet. Please try again later.",
  resetEmailFailed: "We couldn't send the reset email right now. Please try again in a few minutes.",
  samePassword: "Choose a different password from the one you use now.",
  passwordUpdateFailed: "We couldn't update your password right now. Please try again.",
  resetUnavailable: "Password reset isn't available right now. Please try again later.",
} as const;

function isRateLimited(error: NonNullable<AuthErrorLike>): boolean {
  return (
    error.status === 429 ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit"
  );
}

export function signInErrorMessage(error: AuthErrorLike): string {
  if (!error) return MESSAGES.signInFailed;
  if (isRateLimited(error)) return MESSAGES.rateLimited;
  switch (error.code) {
    case "invalid_credentials":
      return MESSAGES.invalidCredentials;
    case "email_not_confirmed":
      return MESSAGES.emailNotConfirmed;
    default:
      return MESSAGES.signInFailed;
  }
}

export type SignUpOutcome = { kind: "pending_confirmation" } | { kind: "error"; message: string };

export function signUpErrorOutcome(error: AuthErrorLike): SignUpOutcome {
  if (!error) return { kind: "error", message: MESSAGES.signUpFailed };
  // Never reveal whether an email is already registered: treat it exactly
  // like a successful sign-up.
  if (error.code === "user_already_exists" || error.code === "email_exists") {
    return { kind: "pending_confirmation" };
  }
  if (isRateLimited(error)) return { kind: "error", message: MESSAGES.rateLimited };
  switch (error.code) {
    case "weak_password":
      return { kind: "error", message: MESSAGES.weakPassword };
    case "email_address_invalid":
    case "validation_failed":
      return { kind: "error", message: MESSAGES.invalidEmail };
    case "signup_disabled":
    case "email_provider_disabled":
      return { kind: "error", message: MESSAGES.signUpUnavailable };
    case "email_address_not_authorized":
      return { kind: "error", message: MESSAGES.emailNotAuthorized };
    default:
      return { kind: "error", message: MESSAGES.signUpFailed };
  }
}

export type ResetRequestOutcome = { kind: "sent" } | { kind: "error"; message: string };

/**
 * Outcome of asking for a password-reset email. To avoid revealing whether an
 * account exists, every response that could depend on the account (unknown
 * user, unconfirmed email, and so on) is reported as "sent". Only failures that
 * say nothing about the account are shown: rate limits and service errors.
 */
export function resetRequestOutcome(error: AuthErrorLike): ResetRequestOutcome {
  if (!error) return { kind: "sent" };
  if (isRateLimited(error)) return { kind: "error", message: MESSAGES.rateLimited };
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return { kind: "error", message: MESSAGES.invalidEmail };
  }
  if (!error.status || error.status >= 500) {
    return { kind: "error", message: MESSAGES.resetEmailFailed };
  }
  return { kind: "sent" };
}

export type PasswordUpdateOutcome =
  | { kind: "field"; message: string }
  | { kind: "form"; message: string }
  | { kind: "expired" };

/** Map an `updateUser({ password })` error. A lost or invalid session means the link can't be used. */
export function passwordUpdateOutcome(error: NonNullable<AuthErrorLike>): PasswordUpdateOutcome {
  if (isRateLimited(error)) return { kind: "form", message: MESSAGES.rateLimited };
  switch (error.code) {
    case "same_password":
      return { kind: "field", message: MESSAGES.samePassword };
    case "weak_password":
      return { kind: "field", message: MESSAGES.weakPassword };
    case "session_not_found":
    case "session_expired":
    case "bad_jwt":
    case "user_not_found":
    case "reauthentication_needed":
      return { kind: "expired" };
    default:
      return error.status === 401 || error.status === 403
        ? { kind: "expired" }
        : { kind: "form", message: MESSAGES.passwordUpdateFailed };
  }
}
