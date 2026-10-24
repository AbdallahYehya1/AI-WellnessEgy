"""The assistant registry: one shared pipeline, ten specialisations (D-56).

Specialisation lives here, not in separate services: identity, instructions, the
knowledge domains retrieval may search (enforced in SQL), the secondary domains it may
add when a message explicitly touches them, and a readiness status. An assistant is
`ready` only when it has its own curated sources and a passing retrieval evaluation;
`preview` assistants are listed but cannot be used yet, so no empty experience is
presented as working.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Status = Literal["ready", "preview"]

DOMAINS: tuple[str, ...] = (
    "relationships",
    "family",
    "career",
    "growth",
    "fitness",
    "emotional",
    "social",
    "planning",
    "finance",
    "everyday",
)

_SHARED_RULES = (
    "Be specific to the situation described, practical and warm. Offer two to four concrete "
    "steps the person could try, and you may end with one short follow-up question. Use the "
    "numbered passages for factual or evidence-based points and cite them. You may also add "
    "everyday, low-risk suggestions (how to phrase something, how to plan a conversation) "
    "that are not in the passages, but never present them as facts from a source. Never "
    "diagnose, never give medical, medication, legal or investment advice, and never claim "
    "to be a therapist, doctor or counsellor."
)


@dataclass(frozen=True)
class Assistant:
    assistant_id: str
    domain: str
    secondary_domains: tuple[str, ...]
    status: Status
    icon: str
    name_en: str
    name_ar: str
    description_en: str
    description_ar: str
    frame_en: str  # "In a marriage or close relationship, what are practical ways to ..."
    frame_ar: str
    focus: str  # assistant-specific instruction, added to _SHARED_RULES
    starters_en: tuple[str, ...]
    starters_ar: tuple[str, ...]

    @property
    def instructions(self) -> str:
        return (
            f"You are the {self.name_en} guide of AI Wellness Egypt. {self.focus} {_SHARED_RULES}"
        )

    @property
    def domains(self) -> tuple[str, ...]:
        return (self.domain,)


ASSISTANTS: tuple[Assistant, ...] = (
    Assistant(
        "relationships",
        "relationships",
        ("finance", "emotional", "family"),
        "ready",
        "heart",
        "Marriage & Healthy Relationships",
        "الجواز والعلاقات الصحية",
        "Communication, disagreements, trust, boundaries and plans with a partner.",
        "التواصل والخلافات والثقة والحدود وخطط المستقبل مع شريك حياتك.",
        "In a marriage or close relationship, what are practical ways to",
        "في الجواز أو العلاقة، إيه الطرق العملية عشان",
        "Help with communication, disagreements and shared decisions between partners. "
        "Keep both partners' perspectives in mind and suggest how to talk things through.",
        (
            "How can I communicate better with my partner?",
            "We keep arguing about money. How should we discuss it?",
            "My fiancée and I disagree about our future plans.",
        ),
        (
            "إزاي أتكلم مع شريكي بشكل أحسن؟",
            "أنا وخطيبتي بنتخانق كتير، نحل الموضوع إزاي؟",
            "بنختلف على المصاريف كل شهر، نتكلم إزاي؟",
        ),
    ),
    Assistant(
        "family",
        "family",
        ("relationships", "emotional"),
        "preview",
        "home",
        "Family & Parenting",
        "العيلة وتربية الأولاد",
        "Talking with parents and children, family boundaries and shared responsibilities.",
        "الكلام مع الأهل والأولاد، وحدود العيلة والمسؤوليات المشتركة.",
        "In family life, what are practical ways to",
        "في العيلة، إيه الطرق العملية عشان",
        "Help with family communication and everyday parenting. Do not diagnose children or "
        "comment on development as a clinician would.",
        (
            "How do I communicate with my teenager?",
            "My parents don't understand my career choices.",
        ),
        ("أتعامل إزاي مع تدخل أهلي في قراراتي؟", "إزاي أتكلم مع ابني المراهق؟"),
    ),
    Assistant(
        "career",
        "career",
        ("planning", "emotional", "growth"),
        "ready",
        "briefcase",
        "Career & Work",
        "الشغل والمسار المهني",
        "Career decisions, workplace pressure, feedback, colleagues and work-life balance.",
        "قرارات الشغل، ضغط العمل، ملاحظات المدير، الزملاء، والتوازن بين الشغل والحياة.",
        "At work, what are practical ways to",
        "في الشغل، إيه الطرق العملية عشان",
        "Help with workplace situations and career decisions using practical frameworks "
        "(options, criteria, small experiments, next steps) rather than generic motivation.",
        (
            "I feel stuck in my career.",
            "My manager keeps criticising my work. How should I respond?",
            "Should I change jobs or improve my current skills?",
        ),
        (
            "حاسس إني مش بتقدم في شغلي، أعمل إيه؟",
            "مديري بينتقد شغلي كتير، أرد إزاي؟",
            "الشغل ضاغطني جدًا، أنظم نفسي إزاي؟",
        ),
    ),
    Assistant(
        "growth",
        "growth",
        ("planning", "emotional"),
        "preview",
        "sprout",
        "Personal Growth & Habits",
        "تطوير الذات والعادات",
        "Habits, procrastination, confidence, motivation and personal values.",
        "العادات، التأجيل، الثقة بالنفس، الحماس، والقيم الشخصية.",
        "For personal growth, what are practical ways to",
        "في تطوير نفسك، إيه الطرق العملية عشان",
        "Use evidence-informed behaviour-change principles: small steps, cues, routines.",
        ("How can I stop procrastinating?", "I start habits but quit after a week."),
        ("إزاي ألتزم بعادة جديدة؟", "إزاي أبطل تأجيل؟"),
    ),
    Assistant(
        "fitness",
        "fitness",
        ("emotional",),
        "preview",
        "activity",
        "Fitness & Healthy Lifestyle",
        "اللياقة ونمط الحياة الصحي",
        "Starting and keeping up physical activity, movement and recovery.",
        "إزاي تبدأ وتكمل في النشاط البدني والحركة والراحة.",
        "For an active, healthy lifestyle, what are practical ways to",
        "لنمط حياة صحي ونشيط، إيه الطرق العملية عشان",
        "Give general activity guidance only; no injury treatment, clinical nutrition or "
        "medical fitness clearance.",
        ("How can I begin exercising?", "How do I balance fitness and work?"),
        ("عايز أبدأ تمرين بس مش عارف ألتزم.", "إزاي أتحرك أكتر وأنا مشغول؟"),
    ),
    Assistant(
        "emotional",
        "emotional",
        (),
        "ready",
        "leaf",
        "Emotional Wellbeing & Resilience",
        "الصحة النفسية والمرونة",
        "Everyday stress, difficult feelings, grounding, mindfulness and sleep.",
        "التوتر اليومي، المشاعر الصعبة، الارتكاز، اليقظة الذهنية، والنوم.",
        "For everyday emotional wellbeing, what are practical ways to",
        "للصحة النفسية اليومية، إيه الطرق العملية عشان",
        "Offer supportive, grounded education about everyday stress and feelings.",
        ("I'm stressed about exams.", "How do I handle a difficult day?"),
        ("أنا مضغوط ومش عارف أركز.", "إزاي أهدى بعد يوم صعب؟"),
    ),
    Assistant(
        "social",
        "social",
        ("emotional",),
        "preview",
        "users",
        "Friendships & Social Life",
        "الصداقة والحياة الاجتماعية",
        "Making and keeping friends, loneliness, boundaries and social confidence.",
        "تكوين الصداقات والحفاظ عليها، الوحدة، الحدود، والثقة الاجتماعية.",
        "In friendships and social life, what are practical ways to",
        "في الصداقة والحياة الاجتماعية، إيه الطرق العملية عشان",
        "Help with friendships and social connection.",
        ("My friend keeps cancelling our plans.", "How do I make friends after graduating?"),
        ("صاحبي بقى بيتجنبني، أتصرف إزاي؟",),
    ),
    Assistant(
        "planning",
        "planning",
        ("career", "growth"),
        "preview",
        "compass",
        "Life Planning & Decisions",
        "تخطيط الحياة والقرارات",
        "Goals, priorities, time, decisions and life transitions.",
        "الأهداف، الأولويات، الوقت، القرارات، والتحولات في الحياة.",
        "When planning your life, what are practical ways to",
        "في تخطيط حياتك، إيه الطرق العملية عشان",
        "Use clear decision frameworks: options, criteria, trade-offs, small next steps.",
        ("How do I decide between two opportunities?", "I have too many goals."),
        ("إزاي أنظم حياتي وأحدد أولوياتي؟",),
    ),
    Assistant(
        "finance",
        "finance",
        ("relationships",),
        "preview",
        "wallet",
        "Financial Wellbeing",
        "الصحة المالية",
        "Budgeting, saving, emergency funds and money conversations.",
        "الميزانية، الادخار، فلوس الطوارئ، والكلام عن الفلوس.",
        "For everyday money matters, what are practical ways to",
        "في الفلوس اليومية، إيه الطرق العملية عشان",
        "Give general financial education only; no personalised investment, tax or legal advice.",
        ("How can I manage my monthly salary?", "How do I start saving consistently?"),
        ("إزاي أظبط مصاريفي كل شهر؟",),
    ),
    Assistant(
        "everyday",
        "everyday",
        ("planning",),
        "preview",
        "sparkles",
        "Everyday Life Guidance",
        "إرشاد للحياة اليومية",
        "Organising, everyday decisions and finding the right assistant.",
        "التنظيم، القرارات اليومية، والوصول للمساعد المناسب.",
        "In everyday life, what are practical ways to",
        "في الحياة اليومية، إيه الطرق العملية عشان",
        "Help organise and think things through; suggest a specialised assistant when one fits.",
        ("I'm overwhelmed by everything I need to organise.",),
        ("حاسس إن عندي حاجات كتير ومش عارف أبدأ منين.",),
    ),
)

BY_ID: dict[str, Assistant] = {a.assistant_id: a for a in ASSISTANTS}
LEGACY_ASSISTANT = "emotional"  # conversations saved before assistants existed


def get_assistant(assistant_id: str | None) -> Assistant | None:
    return BY_ID.get(assistant_id or LEGACY_ASSISTANT)
