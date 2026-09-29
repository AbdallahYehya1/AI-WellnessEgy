// Input validation for the auth forms. Supabase enforces its own rules as
// well; these checks give fast, friendly feedback and bound input sizes.

export const PASSWORD_MIN_LENGTH = 8;
// Supabase hashes passwords with bcrypt, which only uses the first 72 bytes.
export const PASSWORD_MAX_BYTES = 72;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_AFTER_SIGN_IN = "/dashboard";

export type FieldErrors = Partial<Record<"email" | "password" | "confirmPassword" | "ageConfirmed", string>>;

export type SignInInput = { email: string; password: string };
export type SignUpInput = SignInInput & { confirmPassword: string; ageConfirmed: boolean };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function readSignIn(formData: FormData): SignInInput {
  return { email: text(formData, "email").trim(), password: text(formData, "password") };
}

export function readSignUp(formData: FormData): SignUpInput {
  return {
    ...readSignIn(formData),
    confirmPassword: text(formData, "confirmPassword"),
    ageConfirmed: formData.get("ageConfirmed") === "on",
  };
}

export function validateEmail(email: string): string | undefined {
  if (!email) return "Enter your email address.";
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address, like name@example.com.";
  }
  return undefined;
}

export function validateSignIn(input: SignInInput): FieldErrors {
  const errors: FieldErrors = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  if (!input.password) errors.password = "Enter your password.";
  else if (new TextEncoder().encode(input.password).length > PASSWORD_MAX_BYTES) {
    errors.password = "That password is too long.";
  }
  return errors;
}

export function validateSignUp(input: SignUpInput): FieldErrors {
  const errors: FieldErrors = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;

  const bytes = new TextEncoder().encode(input.password).length;
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (bytes > PASSWORD_MAX_BYTES) {
    errors.password = "That password is too long. Use a shorter one.";
  }
  if (input.confirmPassword !== input.password) {
    errors.confirmPassword = "The passwords don't match.";
  }
  // The service is for adults only (docs/OPEN_DECISIONS.md, D-12).
  if (!input.ageConfirmed) {
    errors.ageConfirmed = "You must be 18 or older to create an account.";
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Only allow redirects to paths on this site. Anything else (absolute URLs,
 * protocol-relative `//host`, backslash tricks) falls back to the default.
 */
export function safeNextPath(value: unknown, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (typeof value !== "string" || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
