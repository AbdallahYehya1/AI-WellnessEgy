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
  notConfigured: "Sign-in isn't available yet. Please try again later.",
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
    default:
      return { kind: "error", message: MESSAGES.signUpFailed };
  }
}
