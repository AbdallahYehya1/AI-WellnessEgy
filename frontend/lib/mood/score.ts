export const CHECK_IN_PATH = "/check-in";

// Daily Reflection vocabulary (mirrors backend/app/mood/schemas.py). Labels, not a scale.
export const EMOTIONS = ["happy", "calm", "good", "okay", "anxious", "sad", "frustrated", "tired", "excited"] as const;
export const FACTORS = [
  "work",
  "relationships",
  "family",
  "studies",
  "finances",
  "physical_health",
  "exercise",
  "sleep",
  "social",
  "goals",
  "other",
] as const;
export const EMOJI: Record<(typeof EMOTIONS)[number], string> = {
  happy: "😄",
  calm: "😌",
  good: "🙂",
  okay: "😐",
  anxious: "😟",
  sad: "😢",
  frustrated: "😠",
  tired: "😴",
  excited: "🤩",
};
