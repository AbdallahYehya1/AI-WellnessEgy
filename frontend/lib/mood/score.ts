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

/** A colour family per feeling (oklch hue), for selection feedback and charts only:
 * labels always carry the meaning. */
export const EMOTION_HUE: Record<(typeof EMOTIONS)[number], number> = {
  happy: 85,
  calm: 178,
  good: 140,
  okay: 240,
  anxious: 300,
  sad: 250,
  frustrated: 25,
  tired: 275,
  excited: 50,
};
