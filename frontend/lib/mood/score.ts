export const CHECK_IN_PATH = "/check-in";

/** The documented scale is 1-5 (docs/DATA_MODEL.md). Anything else is rejected, not coerced. */
export function parseMoodScore(value: FormDataEntryValue | null): number | null {
  return typeof value === "string" && /^[1-5]$/.test(value) ? Number(value) : null;
}
