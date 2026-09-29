# SME Council Decisions — Mental Health & Wellness Platform

> **Imported source document (2026-09-29).** Copied unchanged from the pre-repository planning pass, apart from this note. Redis and Celery as default Phase 1 infrastructure are superseded by the approved architecture (Redis only on real need; no workers yet). See `OPEN_DECISIONS.md` (D-1).

**Status:** Draft for founder review
**Scope:** MVP planning only — no clinical, legal, or regulatory sign-off implied.
**Note:** where this document's engineering-level specifics (module names, auth approach)
differ from `Architecture_V2_Phase_1_Build_Spec`, V2 governs — see
`docs/IMPLEMENTATION_STATUS.md` for the reconciliation. This document's risk analysis,
disagreements, and open clinical/legal questions (§3, §4, §6) remain the source of truth and
were not superseded by V2.

---

## 1. Purpose of This Document

This document records the council's analysis of the project, the risks identified, the
architecture and scope decisions made, the disagreements between perspectives, and the
open questions that require validation by people with authority the council does not have
(clinical, legal, regulatory, founder/business).

---

## 2. Per-Expert Perspective Summary

### 2.1 Senior Product Manager

**Framing question:** What is the smallest product that can validate whether users
repeatedly return because the platform provides meaningful value?

- The requirements document lists 18 Phase 1 deliverables and 11 frontend screens. That is
  **not a "smallest valuable MVP"** — it is a full v1 product. The PM's job here is to push
  back on this, not rubber-stamp it.
- Recommendation: Phase 1 as scoped is acceptable as *infrastructure* work (auth, consent,
  data model, safety skeleton) but the council should **not** treat "18 deliverables shipped"
  as "MVP validated." Validation happens after a narrower slice — mood check-in + AI
  companion + one guided exercise — is in front of real users.
- Primary retention risk: an AI wellness companion has weak inherent stickiness compared to,
  say, a habit-tracking app, because the product's value (feeling supported) is diffuse and
  hard to instrument. The PM flags this as the single biggest product risk, bigger than any
  technical risk.
- Success metrics proposed (P0):
  - D1/D7 retention on mood check-in.
  - % of chat sessions that end with a completed or scheduled next action (exercise, journal
    entry) — a proxy for "did this session feel useful," since raw session length is a poor
    (and potentially concerning) metric for a wellness product.
  - Safety escalation rate and false-positive/false-negative rate on the safety classifier
    (tracked, not optimized against user growth).
- Feature prioritization (P0/P1/P2) is in `PHASE_1_IMPLEMENTATION_PLAN.md`.

### 2.2 Senior Backend Architect

- Modular monolith is the right call at this stage. Microservices would add operational
  overhead (service discovery, distributed tracing, network failure handling) with zero
  benefit at pre-PMF scale, and would make the safety pipeline *harder* to reason about
  end-to-end, which is a specific reason to avoid it here beyond generic YAGNI.
- Domain boundaries proposed as Python packages under `app/`, one per bounded context
  (`auth`, `consent`, `users`, `mood`, `journal`, `wellness`, `conversations`, `ai`,
  `safety`, `knowledge`, `memory`, `analytics`, `audit`). Cross-module calls go through each
  module's public service layer, not directly through ORM models, so modules can be split
  into services later without a rewrite.
- FastAPI + SQLAlchemy + Alembic + PostgreSQL + Redis + Celery is a well-understood,
  boring stack for this problem — "boring" is a feature for a two-person-or-small team
  building something with safety implications.
- Disagreement flagged with AI Engineer (see §4).

### 2.3 Senior AI / LLM Engineer

- Agrees strongly with the "controlled pipeline, not a raw LLM call" requirement. This is
  the correct default for a wellness product and is non-negotiable for the MVP.
- The 10-stage pipeline in the brief is good as a conceptual model but is too granular to
  implement as 10 separate network hops in Phase 1 — recommends collapsing it into three
  physical stages for the MVP:
  1. **Pre-processing** (normalization, intent classification, risk assessment) — deterministic
     and/or small-model, runs before any generative call.
  2. **Context assembly** (memory retrieval + knowledge retrieval + prompt construction).
  3. **Generation + validation** (LLM call, then output safety validation before the response
     ever reaches the user).
  The conceptual 10 steps remain represented as distinct functions/modules internally; they
  are just not 10 separate services.
- No fine-tuning, no multi-agent framework for Phase 1 — agreed, matches the brief.
- Recommends a **prompt + policy versioning table** from day one (not added later), since
  safety and clinical review will require diffing exactly what prompt/policy version produced
  a given response.

### 2.4 AI Safety Engineer

- Confirms three-tier risk model (LOW / MEDIUM / HIGH) as workable, with one addition: an
  explicit **UNKNOWN/UNCLASSIFIED** state that is treated as MEDIUM by default (fail toward
  caution, never fail toward silence) rather than allowing an unclassified message to reach
  the LLM with no risk label at all.
- Strongly disagrees with any framing of Phase 1 that treats safety as a "module to build
  alongside the others." **Safety must gate generation, not run in parallel with it.** Every
  message flows through `assess_safety_risk()` before `generate_response()` is ever called,
  and the safety module owns the authority to short-circuit generation entirely.
- Explicitly refuses to invent clinical escalation procedures (what to say in a HIGH RISK
  event, what regional crisis resources to surface for Egypt specifically, what legal
  reporting obligations may or may not apply). These are flagged in Open Questions — they are
  not the engineering team's call to make.
- Recommends the escalation flow for HIGH RISK be intentionally simple and static for Phase
  1: stop generating wellness-companion content, show a clearly labeled crisis message with
  emergency guidance, and log a `safety_event`. No cleverness, no attempt at further AI-driven
  triage in a HIGH RISK state.

### 2.5 Senior Frontend Engineer

- Next.js + TypeScript + Tailwind + RHF + Zod is agreed as a good, common stack; no
  objections.
- Flags that Arabic-first + Egyptian Arabic conversational tone is a **content and product
  decision disguised as a frontend task** — RTL layout is a solved frontend problem, but
  "does the AI actually sound like it understands Egyptian Arabic idiom and register" is an
  AI/product/cultural-consultant problem, not something the frontend can deliver alone.
- Recommends Phase 1 frontend scope be trimmed to: landing, auth, consent/onboarding, mood
  check-in, and a minimal companion chat screen. Journal, full progress view, and program
  browsing are P1, not P0 — they don't need real content behind them to validate the core
  loop.

### 2.6 Security and Privacy Engineer

- The five-way data separation (session context / structured profile / behavioral events /
  user-approved memory / sensitive conversation data) is correct and should be enforced at
  the schema level (separate tables with separate retention/access policies), not just as a
  conceptual grouping.
- Flags a specific risk the brief does not mention: **raw chat transcripts are the most
  sensitive data this system will hold**, more sensitive than mood scores or journal entries,
  because free-text conversation is where users will disclose things (relationships, trauma,
  substance use, suicidal ideation) they did not explicitly decide to record. Default
  retention for raw transcripts should be short and user-controlled; long-term "memory" must
  require an explicit approval step (`approve_memory()`), matching the brief's own memory
  design.
- All authentication should go through a managed provider or a well-audited library rather
  than hand-rolled password storage, given the sensitivity of the data behind the login.
- Encryption at rest for the `conversations` and `journal` tables specifically (column- or
  table-level, not just disk-level) is recommended given the sensitivity, pending legal input
  on what's actually required in-market.

### 2.7 Clinical Product Advisor

- Confirms the allowed/prohibited behavior split as scoped in the brief is a reasonable
  starting boundary, but stresses that **no one on this engineering council is qualified to
  finalize it**. Every item in "allowed product behavior" (including "general psychoeducation
  from approved content") needs sign-off from a licensed mental health professional before
  any real user sees it, because even correct-sounding psychoeducation can be harmful if
  miscalibrated or poorly timed.
- Flags that "Egyptian-first" implies not just language localization but engagement with
  local clinical norms, stigma patterns, and available referral pathways (what "escalation to
  a human professional" even resolves to in Egypt specifically) — this is a business/clinical
  partnership question, not something to solve in code.
- Recommends the knowledge base start genuinely small (a handful of council-and-clinician-
  approved psychoeducation pieces) rather than broad, since every piece of content in
  `knowledge` is a clinical liability surface.

---

## 3. Key Risks Identified

| Risk | Owner perspective | Severity | Notes |
|---|---|---|---|
| Scope creep — 18 deliverables framed as "MVP" | PM | High | Recommend narrowing the user-facing validation slice; see §2.1. |
| Safety pipeline treated as parallel rather than gating | Safety | Critical | Architecture must make bypassing safety structurally difficult, not just discouraged by convention. |
| Unvalidated clinical content reaching users | Clinical | Critical | No knowledge base content ships without clinician review; enforced via `approve_document()` workflow, not honor system. |
| Sensitive conversation data over-retained | Security | High | Explicit retention policy per data category required before Phase 1 ships auth + real user data. |
| Cultural/linguistic authenticity of Egyptian Arabic support | Frontend + Clinical | Medium-High | Not solvable by engineering alone; needs native-speaker and clinical-cultural input. |
| Legal/regulatory status of a "wellness, not clinical" AI product in Egypt | All | Critical, unresolved | Outside council's authority. See Open Questions. |
| Over-building before validating retention/value | PM | Medium | Mitigate by shipping the narrow slice first even though Phase 1 infra is broader. |

---

## 4. Disagreements Between Experts

- **Backend Architect vs. AI Engineer** on pipeline granularity: Architect initially favored
  matching the 10-stage diagram as 10 discrete internal service calls for clarity; AI
  Engineer pushed back citing unnecessary latency and operational complexity for an MVP.
  **Resolved:** three physical stages, ten logical/functional steps preserved as named
  functions within those stages (see `ARCHITECTURE.md`).
- **PM vs. brief's own Phase 1 scope:** PM considers the full 18-item, 11-screen Phase 1 too
  large to call an "MVP" in the product sense, even while agreeing it's reasonable as
  foundational infrastructure. **Resolved:** Phase 1 ships as infrastructure; a distinct,
  narrower "user validation slice" is called out inside Phase 1 so the team knows what to
  point real users at first. See `PHASE_1_IMPLEMENTATION_PLAN.md`.
- **Frontend vs. Product** on Phase 1 screen count: Frontend argued for trimming to 5 screens;
  PM agreed for the *validation slice* but wants auth/consent/settings scaffolding present
  from the start since retrofitting consent flows later is a compliance risk. **Resolved:**
  all 11 screens get scaffolding in Phase 1, but only the validation-slice screens get real
  design/content investment.

---

## 5. Final Decisions (Engineering-Level, In Scope for This Council)

1. Modular monolith, Python/FastAPI backend, Next.js/TypeScript frontend, PostgreSQL,
   Redis, Celery — as specified in the brief.
2. AI pipeline implemented as three physical stages preserving ten logical steps.
3. Safety assessment is a **hard gate** before generation; architecturally enforced, not
   just conventionally followed.
4. Five-way data separation enforced at the schema level with distinct retention rules.
5. No microservices, no multi-agent AI system, no fine-tuning in Phase 1.
6. Knowledge base content requires an explicit approval workflow before use; empty/near-empty
   at Phase 1 launch is acceptable and expected.
7. A narrower "validation slice" (auth → consent → mood check-in → AI companion chat →
   one guided exercise) is the first thing put in front of real users, even though the rest
   of Phase 1 infrastructure ships alongside it.

---

## 6. Open Questions Requiring Human / Clinical / Legal Validation

These are explicitly **not** decided by this council and must not be treated as decided by
implementation:

1. What licensed mental health professional(s) will review and approve all psychoeducation
   content and the AI's allowed/prohibited behavior boundaries before real users interact
   with it?
2. What are the actual legal/regulatory requirements for operating a mental-wellness (not
   medical) digital product in Egypt, including any data residency, health-data, or consumer
   protection obligations?
3. What is the real-world escalation pathway for a HIGH RISK safety event — what resources,
   hotlines, or services should be surfaced to an Egyptian user in crisis, and does the
   business have any relationship with, or referral path to, qualified human professionals
   yet?
4. What are the company's data retention obligations/preferences for sensitive conversation
   content, and does any regulation require longer retention than the product would otherwise
   choose (e.g., for safety audit purposes) versus shorter retention for privacy?
5. Who is legally and clinically accountable if the safety classifier fails to detect a
   genuine crisis? This must be resolved before any real user traffic, not after.
6. Is there a native Egyptian Arabic speaker (ideally with mental-health-adjacent content
   experience) reviewing AI tone and knowledge base content, or is this being deferred?
7. What is the actual business/legal entity's stance on liability disclaimers, terms of
   service, and the "not a replacement for professional care" framing — has this been drafted
   by counsel, or is engineering currently placeholder-ing it?

**No Phase 1 code path should be exposed to real, non-team users until items 1, 2, 3, and 5
have at least an initial answer.**
