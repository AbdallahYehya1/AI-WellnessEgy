// Mirrors the backend rules for `display_name` (backend/app/users/schemas.py).
export const DISPLAY_NAME_MAX_LENGTH = 50;

// Control, format and line/paragraph separator characters.
const DISALLOWED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function validateDisplayName(raw: string): { value: string | null; error?: string } {
  const value = raw.normalize("NFC").trim();
  if (!value) return { value: null }; // empty means "no display name"
  if ([...value].length > DISPLAY_NAME_MAX_LENGTH) {
    return { value: null, error: `Use at most ${DISPLAY_NAME_MAX_LENGTH} characters.` };
  }
  if (DISALLOWED.test(value)) {
    return { value: null, error: "The name contains characters that aren't allowed." };
  }
  return { value };
}
