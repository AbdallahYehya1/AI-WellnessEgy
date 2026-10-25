# Knowledge audit per assistant (D-61)

Status on 2026-10-25: **64 sources and 610 passages**, 62 English and 2 official Arabic
(WHO). The WHO physical-activity guidelines (English and Arabic) gained six verbatim
sections each, from the same licensed publication: recommendations, good practice, safety
considerations and when to stop for pregnant and postpartum women, and recommendations
and good practice for adults with chronic conditions (D-63). All sources are **draft**: publisher guidance that hasn't been clinically or
professionally reviewed for this app. Each source's `domains` field decides which
assistants may retrieve it, and retrieval enforces this in SQL. Every file records its
publisher, URL, retrieval date, licence and permitted use. All text is verbatim, extracted
from the publisher's page or PDF.

## Coverage

Counts are per source tag, so one source can count for several assistants.

| Assistant | Sources | Passages | Publishers |
|---|---|---|---|
| Marriage & Healthy Relationships | 9 | 74 | CDC, OWH, ODPHP, MedlinePlus, OPM, CFPB |
| Family & Parenting | 19 | 183 | CDC, ODPHP, MedlinePlus, OWH, CFPB, OPM, Ready.gov |
| Career & Work | 9 | 100 | NIOSH, OPM, OWH |
| Personal Growth & Habits | 11 | 114 | NIDDK, MedlinePlus, NIMH, CDC, ODPHP, OPM, CFPB |
| Fitness & Healthy Lifestyle | 15 | 136 | CDC, ODPHP (Move Your Way, MyHealthfinder), MedlinePlus, NIDDK, WHO (EN + AR) |
| Emotional Wellbeing & Resilience | 26 | 204 | WHO (EN + AR), NIMH, NCCIH, CDC, ODPHP, MedlinePlus, OWH, NIOSH |
| Friendships & Social Life | 6 | 63 | CDC, OWH, ODPHP |
| Life Planning & Decisions | 8 | 82 | OPM, NIDDK, CFPB, Ready.gov |
| Financial Wellbeing | 7 | 65 | CFPB, MyMoney.gov |
| Everyday Life Guidance | 9 | 87 | CDC, ODPHP, MedlinePlus, OWH, CFPB, MyMoney.gov, Ready.gov |

## Licences (checked per publisher, 2026-10-24)

| Publisher | Basis |
|---|---|
| CDC, NIOSH | U.S. federal works; CDC states most website content is public domain |
| ODPHP (MyHealthfinder, Move Your Way) | ODPHP copyright policy: content is public domain; cite ODPHP |
| MedlinePlus (NLM) | Health topic summaries are public domain (A.D.A.M. and other licensed content excluded) |
| Office on Women's Health | "All material contained on these pages are free of copyright restrictions" |
| NIDDK | "Copyright free and can be freely downloaded and reproduced"; reproduced unchanged |
| NCCIH, NIMH | The pages state they are not copyrighted and are in the public domain |
| OPM, CFPB, MyMoney.gov, Ready.gov | U.S. federal works (17 U.S.C. 105) |
| WHO | CC BY-NC-SA 3.0 IGO (stated in each publication); non-commercial use |

US-only material was dropped during extraction: hotline numbers, insurance and Medicare
details, tax and credit-report items, and campaign templates.

## Retrieval quality

Measured on held-out questions with domain filtering in SQL; reports are in
`assistant-retrieval-v3.json`.

| Set | Questions | Hybrid hit@4 | Worst assistant | Arabic / Egyptian / mixed |
|---|---|---|---|---|
| v3 (used for tuning) | 120 | 0.98 | 0.92 | 0.98 |
| v4 (written before its first run) | 60 | 0.97 at first run; 0.98 final | 0.83 | 1.0 |

The thresholds were set before v3 was first run: at least 0.75 per assistant, zero
leakage, and at least 0.60 for Arabic.

## Gaps (honest)

- **Arabic sources:** only the two WHO publications are official Arabic. Arabic questions
  reach English passages through the bilingual lexicon, and the model replies in Arabic.
  No machine translation is presented as a source.
- **Relationships:** no public-domain source on marriage specifically (expectations, trust
  repair, in-laws). Answers use general communication guidance (CDC) plus general coaching,
  which is labelled as such. NHS pages were retired (D-58), and commercial and university
  guides aren't licensed for this use.
- **Career:** no interview, negotiation or leadership source. CareerOneStop, DOL and BLS
  block automated retrieval. OPM material is written for federal employees.
- **Planning and decisions:** no decision-making framework source. Answers use
  goal-setting and planning passages plus general coaching.
- **Social:** three publishers; nothing on social anxiety, which is clinical anyway.
- **Finance:** US federal sources. Egypt-specific budgeting, banking and saving products
  are not covered, and the assistant is told not to recommend foreign products.
- **Not used:** OpenStax textbooks (their terms forbid ingestion into AI offerings without
  permission); Military OneSource, NIH (main site, NIA, NIH News in Health), SAMHSA,
  consumer.gov, DOL, BLS, HHS and CFPB PDF files (they refuse automated retrieval);
  youth.gov (no reuse statement found); WHO/UNICEF parenting tips (licence not stated).
