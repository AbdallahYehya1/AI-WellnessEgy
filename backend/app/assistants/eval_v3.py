"""Ten-assistant held-out retrieval set (v3, D-61) and its pre-registered thresholds.

Written 2026-10-24, after the knowledge expansion and BEFORE any lexicon or retrieval
tuning against it. 12 natural questions per assistant: 8 English, 2 Modern Standard
Arabic (ar), 2 Egyptian Arabic (arz). ``expected`` lists every source that genuinely
answers the question. Thresholds below were fixed before the first run and are not to be
lowered after seeing results.
"""

from __future__ import annotations

from app.assistants.evaluation import Case, _c

# Pre-registered acceptance thresholds (domain-filtered retrieval, this set).
THRESHOLDS = {
    "per_assistant_hit_at_4": 0.75,
    "per_assistant_leakage": 0.0,
    "arabic_hit_at_4": 0.60,  # ar + arz cases across all assistants
}

COMM = "cdc-healthy-communication-en"
ABUSE = "owh-signs-of-abuse-en"
LEAVE = "owh-leaving-an-abusive-relationship-en"
FRIEND_HELP = "owh-how-to-help-a-friend-en"
WARN = "odphp-relationship-violence-warning-signs-en"
IPV = "cdc-intimate-partner-violence-about-en"
DV = "medlineplus-domestic-violence-en"
KIDS_REL = "odphp-talk-kids-healthy-relationships-en"
WORKLIFE = "opm-work-life-en"
EMERGENCY = "cfpb-emergency-fund-en"
P_COMM = "cdc-parenting-connecting-communicating-en"
P_RULES = "cdc-parenting-routines-behavior-en"
P_EMO = "cdc-parenting-noticing-naming-emotions-en"
P_TIPS = "cdc-positive-parenting-tips-en"
KIDS_DRUGS = "odphp-talk-kids-tobacco-alcohol-drugs-en"
CARE_ODPHP = "odphp-caregiver-support-en"
CARE_CDC = "cdc-caregiving-caring-for-yourself-en"
CARE_ML = "medlineplus-caregivers-en"
PARENT_ML = "medlineplus-parenting-en"
SNACKS = "odphp-healthy-snacks-parents-en"
MONEY_KIDS = "cfpb-money-as-you-grow-en"
NIOSH_PDF = "niosh-stress-at-work-en"
NIOSH = "niosh-stress-at-work-page-en"
TWH = "niosh-total-worker-health-en"
IDP = "opm-individual-development-planning-en"
PERF = "opm-performance-management-cycle-en"
PLAYBOOK = "opm-performance-playbook-en"
CAREER = "opm-career-development-en"
OWH_STRESS = "owh-stress-and-your-health-en"
HABITS = "niddk-changing-habits-en"
ACTIVE = "niddk-tips-to-get-active-en"
LIVING = "medlineplus-healthy-living-en"
NIMH_CARE = "nimh-caring-for-your-mental-health-en"
ML_MH = "medlineplus-improve-mental-health-en"
CDC_MH = "cdc-caring-for-mental-health-en"
SAVINGS = "cfpb-savings-habit-en"
PA_ADULTS = "cdc-physical-activity-adults-en"
PA_BENEFITS = "cdc-physical-activity-benefits-en"
MYW = "odphp-move-your-way-en"
EXERCISE_ML = "medlineplus-exercise-en"
AGING = "odphp-stay-active-as-you-age-en"
EATING = "cdc-healthy-eating-tips-en"
NUTRITION = "medlineplus-nutrition-en"
WHO_PA = "who-physical-activity-guidelines-en"
WHO_PA_AR = "who-physical-activity-guidelines-ar"
SLEEP_CDC = "cdc-about-sleep-en"
SLEEP = "odphp-get-enough-sleep-en"
WHO_DWM = "who-doing-what-matters-en"
WHO_DWM_AR = "who-doing-what-matters-ar"
RELAX = "nccih-relaxation-techniques-en"
MINDFUL = "nccih-meditation-mindfulness-en"
CDC_STRESS = "cdc-managing-stress-en"
MANAGE_STRESS = "odphp-manage-stress-en"
ML_STRESS = "medlineplus-stress-en"
NIMH_STRESS = "nimh-so-stressed-out-en"
SOCIAL = "cdc-social-connectedness-en"
LOVED_ONE = "odphp-support-a-loved-one-en"
BUDGET = "cfpb-budgeting-en"
SPENDING = "cfpb-managing-spending-en"
MYMONEY = "mymoney-gov-five-principles-en"
MONEY_TIPS = "cfpb-money-smart-tips-en"
READY = "ready-gov-make-a-plan-en"

STRESS_ALL = (
    WHO_DWM,
    RELAX,
    MINDFUL,
    CDC_STRESS,
    MANAGE_STRESS,
    ML_STRESS,
    NIMH_STRESS,
    OWH_STRESS,
    NIMH_CARE,
    CDC_MH,
    ML_MH,
)
ABUSE_ALL = (ABUSE, LEAVE, FRIEND_HELP, WARN, IPV, DV)
PA_ALL = (PA_ADULTS, PA_BENEFITS, MYW, EXERCISE_ML, AGING, WHO_PA, WHO_PA_AR, ACTIVE)
MONEY_ALL = (EMERGENCY, BUDGET, SPENDING, MYMONEY, SAVINGS, MONEY_TIPS)

HELD_OUT_V3: tuple[Case, ...] = (
    # --- Marriage & Healthy Relationships ---
    _c(
        "v3-rel-1",
        "relationships",
        "en",
        "My husband shuts down whenever I try to talk about something that bothers me. How can we communicate better?",
        COMM,
    ),
    _c(
        "v3-rel-2",
        "relationships",
        "en",
        "We keep having the same argument over and over. How do couples resolve conflict without shouting?",
        COMM,
    ),
    _c(
        "v3-rel-3",
        "relationships",
        "en",
        "My partner checks my phone and gets angry when I see my friends. Is that normal in a relationship?",
        *ABUSE_ALL,
    ),
    _c(
        "v3-rel-4",
        "relationships",
        "en",
        "My wife says I work too much and we never have time together. How do I balance work and marriage?",
        WORKLIFE,
        COMM,
    ),
    _c(
        "v3-rel-5",
        "relationships",
        "en",
        "We disagree about how to spend money and save for emergencies as a couple.",
        EMERGENCY,
        BUDGET,
        SPENDING,
        MONEY_TIPS,
    ),
    _c(
        "v3-rel-6",
        "relationships",
        "en",
        "How do I tell my fiancé how I feel without starting a fight?",
        COMM,
    ),
    _c(
        "v3-rel-7",
        "relationships",
        "en",
        "He insults me and calls me stupid in front of others. What are the signs of emotional abuse?",
        *ABUSE_ALL,
    ),
    _c(
        "v3-rel-8",
        "relationships",
        "en",
        "What does a healthy relationship look like compared to an unhealthy one?",
        COMM,
        *ABUSE_ALL,
        KIDS_REL,
    ),
    _c("v3-rel-9", "relationships", "ar", "كيف نتواصل أنا وزوجتي بشكل أفضل عندما نختلف؟", COMM),
    _c(
        "v3-rel-10",
        "relationships",
        "ar",
        "زوجي يراقب هاتفي ويمنعني من رؤية صديقاتي، هل هذا طبيعي؟",
        *ABUSE_ALL,
    ),
    _c(
        "v3-rel-11",
        "relationships",
        "arz",
        "إحنا بنتخانق على الفلوس كل شهر، نعمل إيه؟",
        EMERGENCY,
        BUDGET,
        SPENDING,
        MONEY_TIPS,
    ),
    _c(
        "v3-rel-12",
        "relationships",
        "arz",
        "جوزي مش بيسمعني لما بتكلم معاه، أعمل إيه عشان نتفاهم؟",
        COMM,
    ),
    # --- Family & Parenting ---
    _c(
        "v3-fam-1",
        "family",
        "en",
        "My toddler has tantrums every evening. How should I respond calmly?",
        P_RULES,
        P_EMO,
        P_TIPS,
    ),
    _c(
        "v3-fam-2",
        "family",
        "en",
        "How can I get my preschooler to follow a bedtime routine?",
        P_RULES,
        P_TIPS,
    ),
    _c(
        "v3-fam-3",
        "family",
        "en",
        "How do I talk to my 13-year-old so he actually opens up to me?",
        P_COMM,
        P_TIPS,
        KIDS_DRUGS,
        KIDS_REL,
    ),
    _c(
        "v3-fam-4",
        "family",
        "en",
        "How do I start a conversation with my teenager about alcohol and drugs?",
        KIDS_DRUGS,
    ),
    _c(
        "v3-fam-5",
        "family",
        "en",
        "I'm caring for my elderly mother and I'm exhausted. How do I look after myself too?",
        CARE_ODPHP,
        CARE_CDC,
        CARE_ML,
    ),
    _c("v3-fam-6", "family", "en", "How can I help my child name and handle big feelings?", P_EMO),
    _c(
        "v3-fam-7", "family", "en", "What are healthy snack ideas for my kids after school?", SNACKS
    ),
    _c(
        "v3-fam-8",
        "family",
        "en",
        "How do I teach my children about saving and spending money?",
        MONEY_KIDS,
    ),
    _c("v3-fam-9", "family", "ar", "كيف أتعامل مع نوبات غضب طفلي الصغير؟", P_RULES, P_EMO, P_TIPS),
    _c(
        "v3-fam-10",
        "family",
        "ar",
        "أعتني بوالدي المريض وأشعر بالإرهاق، كيف أهتم بنفسي؟",
        CARE_ODPHP,
        CARE_CDC,
        CARE_ML,
    ),
    _c(
        "v3-fam-11",
        "family",
        "arz",
        "ابني المراهق مش بيكلمني خالص، أقرب منه إزاي؟",
        P_COMM,
        P_TIPS,
        KIDS_DRUGS,
        KIDS_REL,
    ),
    _c("v3-fam-12", "family", "arz", "عايز أعمل روتين للنوم لولادي الصغيرين", P_RULES, P_TIPS),
    # --- Career & Work ---
    _c(
        "v3-car-1",
        "career",
        "en",
        "My manager keeps changing my priorities and then complains I haven't finished my work.",
        PERF,
        PLAYBOOK,
        NIOSH,
        NIOSH_PDF,
    ),
    _c(
        "v3-car-2",
        "career",
        "en",
        "How do I ask my supervisor for regular feedback on my performance?",
        PERF,
        PLAYBOOK,
    ),
    _c(
        "v3-car-3",
        "career",
        "en",
        "I'm burning out from long hours at work. What can help?",
        NIOSH,
        NIOSH_PDF,
        OWH_STRESS,
        TWH,
        WORKLIFE,
    ),
    _c(
        "v3-car-4",
        "career",
        "en",
        "How do I make a plan to develop my skills for a promotion?",
        IDP,
        CAREER,
        PLAYBOOK,
    ),
    _c(
        "v3-car-5",
        "career",
        "en",
        "Should I look for a mentor at work, and how do I find one?",
        CAREER,
        PLAYBOOK,
    ),
    _c(
        "v3-car-6",
        "career",
        "en",
        "How can I set clear goals with my boss for this year?",
        PERF,
        PLAYBOOK,
    ),
    _c(
        "v3-car-7",
        "career",
        "en",
        "How do I balance a demanding job with my family life?",
        WORKLIFE,
        NIOSH,
        NIOSH_PDF,
    ),
    _c(
        "v3-car-8",
        "career",
        "en",
        "What makes a workplace stressful and what can employees do about it?",
        NIOSH,
        NIOSH_PDF,
        TWH,
        OWH_STRESS,
    ),
    _c("v3-car-9", "career", "ar", "كيف أطلب من مديري تقييماً واضحاً لأدائي؟", PERF, PLAYBOOK),
    _c(
        "v3-car-10",
        "career",
        "ar",
        "أشعر بضغط كبير في العمل بسبب ساعات العمل الطويلة",
        NIOSH,
        NIOSH_PDF,
        OWH_STRESS,
        TWH,
        WORKLIFE,
    ),
    _c(
        "v3-car-11",
        "career",
        "arz",
        "عايز أطور نفسي في الشغل عشان آخد ترقية، أبدأ منين؟",
        IDP,
        CAREER,
        PLAYBOOK,
    ),
    _c(
        "v3-car-12",
        "career",
        "arz",
        "مديري بيغير الأولويات كل يوم ومش عارف أخلص حاجة",
        PERF,
        PLAYBOOK,
        NIOSH,
        NIOSH_PDF,
    ),
    # --- Personal Growth & Habits ---
    _c(
        "v3-gro-1",
        "growth",
        "en",
        "I want to build a habit of exercising but I always quit after a week.",
        HABITS,
        ACTIVE,
        MYW,
    ),
    _c(
        "v3-gro-2",
        "growth",
        "en",
        "How do I stay motivated when I slip back into old habits?",
        HABITS,
    ),
    _c(
        "v3-gro-3",
        "growth",
        "en",
        "How can I set realistic goals and track my progress?",
        HABITS,
        PLAYBOOK,
        IDP,
        SAVINGS,
    ),
    _c(
        "v3-gro-4",
        "growth",
        "en",
        "What small daily habits help me feel better overall?",
        LIVING,
        NIMH_CARE,
        ML_MH,
        CDC_MH,
        HABITS,
    ),
    _c("v3-gro-5", "growth", "en", "How do I make a personal development plan?", IDP, CAREER),
    _c("v3-gro-6", "growth", "en", "How do I reward myself for sticking to a new routine?", HABITS),
    _c(
        "v3-gro-7",
        "growth",
        "en",
        "I keep thinking about changing but never start. How do I get from thinking to doing?",
        HABITS,
    ),
    _c(
        "v3-gro-8",
        "growth",
        "en",
        "How can I take better care of my mental health day to day?",
        NIMH_CARE,
        ML_MH,
        CDC_MH,
    ),
    _c("v3-gro-9", "growth", "ar", "كيف أبني عادة جديدة وأستمر عليها؟", HABITS),
    _c("v3-gro-10", "growth", "ar", "كيف أضع أهدافاً واقعية لنفسي؟", HABITS, PLAYBOOK, IDP, SAVINGS),
    _c("v3-gro-11", "growth", "arz", "كل ما أبدأ عادة جديدة أبطلها بعد أسبوع", HABITS, ACTIVE, MYW),
    _c(
        "v3-gro-12",
        "growth",
        "arz",
        "عايز أهتم بنفسي وبصحتي النفسية كل يوم",
        NIMH_CARE,
        ML_MH,
        CDC_MH,
        LIVING,
    ),
    # --- Fitness & Healthy Lifestyle ---
    _c("v3-fit-1", "fitness", "en", "How much exercise should an adult do each week?", *PA_ALL),
    _c(
        "v3-fit-2",
        "fitness",
        "en",
        "I'm a complete beginner. How do I start getting active?",
        PA_ADULTS,
        MYW,
        ACTIVE,
        WHO_PA,
        EXERCISE_ML,
    ),
    _c(
        "v3-fit-3",
        "fitness",
        "en",
        "How can I tell if my workout is moderate or vigorous intensity?",
        PA_ADULTS,
        WHO_PA,
        MYW,
    ),
    _c("v3-fit-4", "fitness", "en", "What are the benefits of strength training?", *PA_ALL),
    _c(
        "v3-fit-5",
        "fitness",
        "en",
        "I sit at a desk all day. How do I move more?",
        PA_ADULTS,
        WHO_PA,
        MYW,
        ACTIVE,
    ),
    _c(
        "v3-fit-6",
        "fitness",
        "en",
        "What are some tips for eating healthier during the week?",
        EATING,
        NUTRITION,
    ),
    _c(
        "v3-fit-7",
        "fitness",
        "en",
        "How can older adults stay active safely?",
        AGING,
        EXERCISE_ML,
        WHO_PA,
        PA_BENEFITS,
    ),
    _c(
        "v3-fit-8",
        "fitness",
        "en",
        "Does exercise help with sleep and mood?",
        PA_BENEFITS,
        WHO_PA,
        SLEEP_CDC,
        SLEEP,
        MYW,
    ),
    _c(
        "v3-fit-9",
        "fitness",
        "ar",
        "كم دقيقة من النشاط البدني يحتاجها البالغ في الأسبوع؟",
        WHO_PA_AR,
        *PA_ALL,
    ),
    _c("v3-fit-10", "fitness", "ar", "ما فوائد تمارين تقوية العضلات؟", WHO_PA_AR, *PA_ALL),
    _c(
        "v3-fit-11",
        "fitness",
        "arz",
        "أنا قاعد على المكتب طول اليوم، أتحرك أكتر إزاي؟",
        WHO_PA_AR,
        PA_ADULTS,
        WHO_PA,
        MYW,
        ACTIVE,
    ),
    _c("v3-fit-12", "fitness", "arz", "عايز آكل أكل صحي أكتر، أبدأ إزاي؟", EATING, NUTRITION),
    # --- Emotional Wellbeing & Resilience ---
    _c(
        "v3-emo-1",
        "emotional",
        "en",
        "I feel overwhelmed and tense most days. What can I do to calm down?",
        *STRESS_ALL,
    ),
    _c(
        "v3-emo-2",
        "emotional",
        "en",
        "What relaxation techniques can I try before bed?",
        RELAX,
        MINDFUL,
        SLEEP,
        SLEEP_CDC,
    ),
    _c(
        "v3-emo-3",
        "emotional",
        "en",
        "How do I notice the signs that stress is affecting me?",
        MANAGE_STRESS,
        ML_STRESS,
        OWH_STRESS,
        NIMH_STRESS,
        CDC_STRESS,
    ),
    _c(
        "v3-emo-4",
        "emotional",
        "en",
        "How can mindfulness help with racing thoughts?",
        MINDFUL,
        WHO_DWM,
        RELAX,
    ),
    _c(
        "v3-emo-5",
        "emotional",
        "en",
        "I've been feeling lonely since moving to a new city.",
        SOCIAL,
        WHO_DWM,
        NIMH_CARE,
        CDC_MH,
    ),
    _c(
        "v3-emo-6",
        "emotional",
        "en",
        "What are healthy ways to cope when things get hard?",
        *STRESS_ALL,
    ),
    _c(
        "v3-emo-7",
        "emotional",
        "en",
        "How much sleep do adults need to feel well?",
        SLEEP,
        SLEEP_CDC,
    ),
    _c(
        "v3-emo-8",
        "emotional",
        "en",
        "How do I deal with difficult emotions instead of pushing them away?",
        WHO_DWM,
        NIMH_CARE,
        ML_MH,
        CDC_MH,
    ),
    _c(
        "v3-emo-9", "emotional", "ar", "أشعر بالتوتر طوال الوقت، كيف أهدأ؟", WHO_DWM_AR, *STRESS_ALL
    ),
    _c(
        "v3-emo-10",
        "emotional",
        "ar",
        "ما هي تمارين الاسترخاء التي تساعدني على النوم؟",
        WHO_DWM_AR,
        RELAX,
        MINDFUL,
        SLEEP,
        SLEEP_CDC,
    ),
    _c("v3-emo-11", "emotional", "arz", "حاسس إني مخنوق ومتوتر على طول", WHO_DWM_AR, *STRESS_ALL),
    _c(
        "v3-emo-12",
        "emotional",
        "arz",
        "مش عارف أنام كويس من كتر التفكير",
        WHO_DWM_AR,
        SLEEP,
        SLEEP_CDC,
        RELAX,
        MINDFUL,
        WHO_DWM,
    ),
    # --- Friendships & Social Life ---
    _c("v3-soc-1", "social", "en", "How do I make new friends as an adult?", SOCIAL),
    _c(
        "v3-soc-2",
        "social",
        "en",
        "I feel disconnected from people. How can I build more social connection?",
        SOCIAL,
    ),
    _c(
        "v3-soc-3",
        "social",
        "en",
        "My friend seems to be in an abusive relationship. How can I help her?",
        FRIEND_HELP,
        ABUSE,
        WARN,
    ),
    _c(
        "v3-soc-4",
        "social",
        "en",
        "How do I support a friend who is going through a hard time?",
        LOVED_ONE,
        FRIEND_HELP,
        SOCIAL,
    ),
    _c("v3-soc-5", "social", "en", "Why does loneliness matter for health?", SOCIAL),
    _c(
        "v3-soc-6", "social", "en", "How do I tell a friend that something they said hurt me?", COMM
    ),
    _c(
        "v3-soc-7",
        "social",
        "en",
        "How can I stay in touch with friends when life gets busy?",
        SOCIAL,
    ),
    _c(
        "v3-soc-8",
        "social",
        "en",
        "What are warning signs that a friend's relationship is controlling?",
        WARN,
        ABUSE,
        FRIEND_HELP,
    ),
    _c("v3-soc-9", "social", "ar", "كيف أكوّن صداقات جديدة بعد الانتقال إلى مدينة أخرى؟", SOCIAL),
    _c(
        "v3-soc-10",
        "social",
        "ar",
        "صديقتي تتعرض لسوء معاملة من زوجها، كيف أساعدها؟",
        FRIEND_HELP,
        ABUSE,
        WARN,
    ),
    _c("v3-soc-11", "social", "arz", "حاسس إني لوحدي ومليش صحاب", SOCIAL),
    _c(
        "v3-soc-12",
        "social",
        "arz",
        "صاحبي بيمر بوقت صعب، أقف جنبه إزاي؟",
        LOVED_ONE,
        FRIEND_HELP,
        SOCIAL,
    ),
    # --- Life Planning & Decisions ---
    _c(
        "v3-pla-1",
        "planning",
        "en",
        "How do I set goals for the next year and actually follow through?",
        HABITS,
        PLAYBOOK,
        IDP,
        SAVINGS,
    ),
    _c(
        "v3-pla-2",
        "planning",
        "en",
        "How can I make a realistic plan for a big change in my life?",
        HABITS,
        PLAYBOOK,
        IDP,
        READY,
    ),
    _c(
        "v3-pla-3",
        "planning",
        "en",
        "How do I plan my career for the next five years?",
        IDP,
        CAREER,
        PLAYBOOK,
    ),
    _c("v3-pla-4", "planning", "en", "How should my family prepare a plan for emergencies?", READY),
    _c(
        "v3-pla-5",
        "planning",
        "en",
        "How do I plan my monthly spending around my goals?",
        BUDGET,
        SPENDING,
        SAVINGS,
    ),
    _c(
        "v3-pla-6",
        "planning",
        "en",
        "I want to save for a big goal in two years. How do I plan for it?",
        SAVINGS,
        BUDGET,
        SPENDING,
    ),
    _c(
        "v3-pla-7",
        "planning",
        "en",
        "How do I break a big goal into smaller steps?",
        HABITS,
        PLAYBOOK,
        IDP,
        SAVINGS,
    ),
    _c("v3-pla-8", "planning", "en", "How do I plan for setbacks so they don't derail me?", HABITS),
    _c(
        "v3-pla-9",
        "planning",
        "ar",
        "كيف أضع خطة واقعية لأهدافي هذا العام؟",
        HABITS,
        PLAYBOOK,
        IDP,
        SAVINGS,
    ),
    _c("v3-pla-10", "planning", "ar", "كيف أخطط لمستقبلي المهني؟", IDP, CAREER, PLAYBOOK),
    _c(
        "v3-pla-11",
        "planning",
        "arz",
        "عايز أعمل خطة أحوّش بيها لهدف كبير",
        SAVINGS,
        BUDGET,
        SPENDING,
    ),
    _c(
        "v3-pla-12",
        "planning",
        "arz",
        "إزاي أقسم هدف كبير لخطوات صغيرة؟",
        HABITS,
        PLAYBOOK,
        IDP,
        SAVINGS,
    ),
    # --- Financial Wellbeing ---
    _c(
        "v3-fin-1",
        "finance",
        "en",
        "How do I make a budget for the first time?",
        BUDGET,
        SPENDING,
        MYMONEY,
    ),
    _c(
        "v3-fin-2",
        "finance",
        "en",
        "How much should I keep in an emergency fund and how do I start?",
        EMERGENCY,
        SAVINGS,
    ),
    _c(
        "v3-fin-3",
        "finance",
        "en",
        "I never know where my money goes each month. How do I track spending?",
        SPENDING,
        BUDGET,
        MYMONEY,
    ),
    _c(
        "v3-fin-4",
        "finance",
        "en",
        "How can I start a saving habit on a small income?",
        SAVINGS,
        EMERGENCY,
        MONEY_TIPS,
    ),
    _c(
        "v3-fin-5",
        "finance",
        "en",
        "What should I think about before borrowing money?",
        MYMONEY,
        MONEY_TIPS,
    ),
    _c(
        "v3-fin-6", "finance", "en", "How do I avoid impulse buying?", MYMONEY, SPENDING, MONEY_TIPS
    ),
    _c("v3-fin-7", "finance", "en", "How do I teach my kids good money habits?", MONEY_KIDS),
    _c(
        "v3-fin-8",
        "finance",
        "en",
        "What are simple ways to save money every week?",
        SAVINGS,
        MONEY_TIPS,
        SPENDING,
    ),
    _c("v3-fin-9", "finance", "ar", "كيف أعمل ميزانية شهرية لأسرتي؟", BUDGET, SPENDING, MYMONEY),
    _c("v3-fin-10", "finance", "ar", "كيف أبدأ صندوق طوارئ؟", EMERGENCY, SAVINGS),
    _c(
        "v3-fin-11",
        "finance",
        "arz",
        "مرتبي بيخلص قبل آخر الشهر، أعمل إيه؟",
        BUDGET,
        SPENDING,
        MYMONEY,
        MONEY_TIPS,
    ),
    _c(
        "v3-fin-12",
        "finance",
        "arz",
        "عايز أبدأ أحوّش فلوس بس مش عارف أبدأ منين",
        SAVINGS,
        EMERGENCY,
        MONEY_TIPS,
    ),
    # --- Everyday Life Guidance ---
    _c(
        "v3-eve-1",
        "everyday",
        "en",
        "My flatmate never cleans up. How do I bring it up without a fight?",
        COMM,
    ),
    _c(
        "v3-eve-2",
        "everyday",
        "en",
        "I have too many things to do this week and feel stressed. Where do I start?",
        MANAGE_STRESS,
        CDC_STRESS,
    ),
    _c("v3-eve-3", "everyday", "en", "How can I get better sleep with a busy schedule?", SLEEP),
    _c(
        "v3-eve-4",
        "everyday",
        "en",
        "How do I keep my household spending under control?",
        BUDGET,
        MYMONEY,
        MONEY_TIPS,
    ),
    _c(
        "v3-eve-5",
        "everyday",
        "en",
        "What does a healthy daily routine look like?",
        LIVING,
        SLEEP,
        MANAGE_STRESS,
    ),
    _c("v3-eve-6", "everyday", "en", "How should we prepare our home for an emergency?", READY),
    _c(
        "v3-eve-7",
        "everyday",
        "en",
        "My neighbour's situation worries me; she might be in danger at home. What can I do?",
        FRIEND_HELP,
    ),
    _c(
        "v3-eve-8",
        "everyday",
        "en",
        "What everyday money tips actually make a difference?",
        MONEY_TIPS,
        MYMONEY,
        BUDGET,
    ),
    _c(
        "v3-eve-9",
        "everyday",
        "ar",
        "كيف أنظم يومي حتى لا أشعر بالضغط؟",
        MANAGE_STRESS,
        CDC_STRESS,
        LIVING,
    ),
    _c("v3-eve-10", "everyday", "ar", "كيف أنام بشكل أفضل رغم انشغالي؟", SLEEP),
    _c("v3-eve-11", "everyday", "arz", "زميلي في السكن مش بينضف وعايز أكلمه من غير خناق", COMM),
    _c(
        "v3-eve-12",
        "everyday",
        "arz",
        "مصاريف البيت زادت ومش عارف أظبطها",
        BUDGET,
        MYMONEY,
        MONEY_TIPS,
    ),
)
