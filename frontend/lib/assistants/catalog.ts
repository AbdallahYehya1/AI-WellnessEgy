/**
 * The ten assistants' visual identities and public copy (design system v2).
 *
 * Names, descriptions and the first starter mirror backend/app/assistants/registry.py,
 * so the public homepage can show them without a signed-in API call. Signed-in pages use
 * the live registry from /chat/config and take only the identity (hue, group) from here.
 */
import type { Locale } from "@/lib/i18n/config";

export type AssistantGroup = "people" | "work" | "mind" | "everyday";

export type CatalogEntry = {
  id: string;
  icon: string;
  /** oklch hue; with `chroma`, drives the `.tone` utilities. */
  hue: number;
  chroma?: number;
  group: AssistantGroup;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  uses: Record<Locale, [string, string, string]>;
  starter: Record<Locale, string>;
};

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: "relationships",
    icon: "heart",
    hue: 12,
    group: "people",
    name: { en: "Marriage & Healthy Relationships", ar: "الجواز والعلاقات الصحية" },
    description: {
      en: "Communication, disagreements, trust, boundaries and plans with a partner.",
      ar: "التواصل والخلافات والثقة والحدود وخطط المستقبل مع شريك حياتك.",
    },
    uses: { en: ["Communication", "Disagreements", "Trust"], ar: ["التواصل", "الخلافات", "الثقة"] },
    starter: { en: "How can I communicate better with my partner?", ar: "إزاي أتكلم مع شريكي بشكل أحسن؟" },
  },
  {
    id: "family",
    icon: "home",
    hue: 62,
    group: "people",
    name: { en: "Family & Parenting", ar: "العيلة وتربية الأولاد" },
    description: {
      en: "Talking with parents and children, family boundaries and shared responsibilities.",
      ar: "الكلام مع الأهل والأولاد، وحدود العيلة والمسؤوليات المشتركة.",
    },
    uses: { en: ["Parenting", "Teenagers", "In-laws"], ar: ["التربية", "المراهقين", "الأهل"] },
    starter: { en: "How do I communicate with my teenager?", ar: "أتعامل إزاي مع تدخل أهلي في قراراتي؟" },
  },
  {
    id: "career",
    icon: "briefcase",
    hue: 262,
    group: "work",
    name: { en: "Career & Work", ar: "الشغل والمسار المهني" },
    description: {
      en: "Career decisions, workplace pressure, feedback, colleagues and work-life balance.",
      ar: "قرارات الشغل، ضغط العمل، ملاحظات المدير، الزملاء، والتوازن بين الشغل والحياة.",
    },
    uses: { en: ["Pressure at work", "Feedback", "Next steps"], ar: ["ضغط الشغل", "ملاحظات المدير", "الخطوة الجاية"] },
    starter: { en: "I feel stuck in my career.", ar: "حاسس إني مش بتقدم في شغلي، أعمل إيه؟" },
  },
  {
    id: "growth",
    icon: "sprout",
    hue: 138,
    group: "mind",
    name: { en: "Personal Growth & Habits", ar: "تطوير الذات والعادات" },
    description: {
      en: "Habits, procrastination, confidence, motivation and personal values.",
      ar: "العادات، التأجيل، الثقة بالنفس، الحماس، والقيم الشخصية.",
    },
    uses: { en: ["Habits", "Procrastination", "Confidence"], ar: ["العادات", "التأجيل", "الثقة بالنفس"] },
    starter: { en: "How can I stop procrastinating?", ar: "إزاي ألتزم بعادة جديدة؟" },
  },
  {
    id: "fitness",
    icon: "activity",
    hue: 34,
    group: "mind",
    name: { en: "Fitness & Healthy Lifestyle", ar: "اللياقة ونمط الحياة الصحي" },
    description: {
      en: "Starting and keeping up physical activity, movement and recovery.",
      ar: "إزاي تبدأ وتكمل في النشاط البدني والحركة والراحة.",
    },
    uses: { en: ["Getting started", "Moving more", "Recovery"], ar: ["البداية", "حركة أكتر", "الراحة"] },
    starter: { en: "How can I begin exercising?", ar: "عايز أبدأ تمرين بس مش عارف ألتزم." },
  },
  {
    id: "emotional",
    icon: "leaf",
    hue: 178,
    group: "mind",
    name: { en: "Emotional Wellbeing & Resilience", ar: "الصحة النفسية والمرونة" },
    description: {
      en: "Everyday stress, difficult feelings, grounding, mindfulness and sleep.",
      ar: "التوتر اليومي، المشاعر الصعبة، الارتكاز، اليقظة الذهنية، والنوم.",
    },
    uses: { en: ["Everyday stress", "Grounding", "Sleep"], ar: ["التوتر اليومي", "الارتكاز", "النوم"] },
    starter: { en: "I'm stressed about exams.", ar: "أنا مضغوط ومش عارف أركز." },
  },
  {
    id: "social",
    icon: "users",
    hue: 305,
    chroma: 0.12,
    group: "people",
    name: { en: "Friendships & Social Life", ar: "الصداقة والحياة الاجتماعية" },
    description: {
      en: "Making and keeping friends, loneliness, boundaries and social confidence.",
      ar: "تكوين الصداقات والحفاظ عليها، الوحدة، الحدود، والثقة الاجتماعية.",
    },
    uses: { en: ["New friends", "Loneliness", "Boundaries"], ar: ["صحاب جداد", "الوحدة", "الحدود"] },
    starter: { en: "My friend keeps cancelling our plans.", ar: "صاحبي بقى بيتجنبني، أتصرف إزاي؟" },
  },
  {
    id: "planning",
    icon: "compass",
    hue: 225,
    group: "work",
    name: { en: "Life Planning & Decisions", ar: "تخطيط الحياة والقرارات" },
    description: {
      en: "Goals, priorities, time, decisions and life transitions.",
      ar: "الأهداف، الأولويات، الوقت، القرارات، والتحولات في الحياة.",
    },
    uses: { en: ["Big decisions", "Goals", "Transitions"], ar: ["القرارات الكبيرة", "الأهداف", "التحولات"] },
    starter: { en: "How do I decide between two opportunities?", ar: "إزاي أنظم حياتي وأحدد أولوياتي؟" },
  },
  {
    id: "finance",
    icon: "wallet",
    hue: 95,
    chroma: 0.12,
    group: "work",
    name: { en: "Financial Wellbeing", ar: "الصحة المالية" },
    description: {
      en: "Budgeting, saving, emergency funds and money conversations.",
      ar: "الميزانية، الادخار، فلوس الطوارئ، والكلام عن الفلوس.",
    },
    uses: { en: ["Budgeting", "Saving", "Money talks"], ar: ["الميزانية", "الادخار", "الكلام عن الفلوس"] },
    starter: { en: "How can I manage my monthly salary?", ar: "إزاي أظبط مصاريفي كل شهر؟" },
  },
  {
    id: "everyday",
    icon: "sparkles",
    hue: 250,
    chroma: 0.04,
    group: "everyday",
    name: { en: "Everyday Life Guidance", ar: "إرشاد للحياة اليومية" },
    description: {
      en: "Organising, everyday decisions and finding the right assistant.",
      ar: "التنظيم، القرارات اليومية، والوصول للمساعد المناسب.",
    },
    uses: { en: ["Organising", "Everyday decisions", "Where to start"], ar: ["التنظيم", "قرارات يومية", "أبدأ منين"] },
    starter: { en: "I'm overwhelmed by everything I need to organise.", ar: "حاسس إن عندي حاجات كتير ومش عارف أبدأ منين." },
  },
];

export const BY_ID: Record<string, CatalogEntry> = Object.fromEntries(CATALOG.map((a) => [a.id, a]));

/** Identity for any assistant id (unknown ids get a neutral tone). */
export function identity(id: string): { hue: number; chroma?: number; group: AssistantGroup } {
  const entry = BY_ID[id];
  return entry ? { hue: entry.hue, chroma: entry.chroma, group: entry.group } : { hue: 178, chroma: 0.05, group: "everyday" };
}
