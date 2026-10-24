# Knowledge audit per assistant (D-56)

Status on 2026-10-24. 19 sources, all **draft** (publisher guidance, not clinically or
professionally reviewed). Each source's `domains` field says which assistants may
retrieve it, and retrieval enforces that in SQL. Every file records its publisher, URL,
retrieval date, licence and permitted use. All excerpts are verbatim.

## Readiness rule

An assistant becomes **ready** only when all of these hold:

1. At least three relevant sources from at least two publishers.
2. Domain-filtered hit@4 of at least 0.9 on its evaluation questions, with zero leakage
   (`backend/tests/test_assistant_eval.py`).
3. A lexicon covering its main situations in English and Egyptian Arabic.
4. Its safety boundaries are covered in `safety_eval.py`.

## Coverage

| Assistant | Status | Sources (primary or secondary) | Arabic sources | Measured retrieval |
|---|---|---|---|---|
| Marriage & Healthy Relationships | ready | CDC healthy communication, NHS healthy relationships, NHS problem solving, CFPB emergency fund | none | domain hit@4 1.0, leakage 0 |
| Career & Work | ready | NIOSH Stress at Work, NHS work-related stress, NHS problem solving, NHS change and uncertainty, NHS to-do lists, OPM individual development planning | none | domain hit@4 1.0, leakage 0 (no domain filter: 0.33 on held-out) |
| Emotional Wellbeing & Resilience | ready | WHO Doing What Matters (EN and AR), NIMH ×4, NCCIH mindfulness, CDC stress, sleep and activity, NHS ×3 | WHO (official Arabic) | earlier general evaluation (D-50) |
| Family & Parenting | preview | CDC healthy communication, NHS healthy relationships | none | not evaluated |
| Personal Growth & Habits | preview | OPM IDP, NHS to-do lists, NHS problem solving, NIMH caring | none | not evaluated |
| Fitness & Healthy Lifestyle | preview | CDC physical activity, CDC sleep | none | not evaluated |
| Friendships & Social Life | preview | CDC healthy communication, NHS healthy relationships | none | not evaluated |
| Life Planning & Decisions | preview | NHS problem solving, NHS change and uncertainty, NHS to-do lists, OPM IDP | none | not evaluated |
| Financial Wellbeing | preview | CFPB emergency fund | none | not evaluated |
| Everyday Life Guidance | preview | CDC healthy communication, NHS problem solving, NHS to-do lists | none | not evaluated |

## Gaps

- **Arabic:** only the WHO guide exists in official Arabic. Arabic questions to every other
  assistant retrieve English passages through the Arabic lexicon. The model replies in
  Arabic, but the evidence it cites is in English. Official Arabic sources (WHO EMRO,
  Egyptian ministries, UNICEF Arabic) would need a licence check one by one.
- **Family & Parenting:** no parenting source. fatherhood.gov blocked automated
  retrieval (403). CDC parenting pages haven't been assessed yet.
- **Fitness:** no beginner programme source. The NIH and NHS exercise pages need a licence
  check, and NIH blocked automated access.
- **Financial Wellbeing:** one CFPB guide, U.S.-specific items removed. It needs
  Egypt-relevant budgeting guidance and must stay away from investment, tax and debt
  advice (regulated).
- **Friendships & Social Life:** no source on loneliness or making friends.
- **Career:** CareerOneStop was blocked (403). No Egypt-specific labour information, which
  is regulated and refused in any case.
- **NHS content (6 sources):** OGL v3.0 plus NHS website terms. See D-58 before any
  non-prototype use.
- **Clinical review:** none. No source is `approved`.

## Not ingested (and why)

| Source | Reason |
|---|---|
| NIH News in Health, NIH exercise pages | 403 to automated and headed-browser retrieval |
| fatherhood.gov | 403 |
| CareerOneStop | 403 |
| Unofficial Arabic translations | Not the publisher's own translation |
