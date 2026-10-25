import Link from "next/link";

import { AssistantIcon } from "@/components/assistants/icons";
import { AssistantExplorer } from "@/components/landing/assistant-explorer";
import { AssistantPreview } from "@/components/landing/assistant-preview";
import {
  ArrowIcon,
  BookIcon,
  CalendarIcon,
  CheckIcon,
  LockIcon,
  LogoMark,
  RouteIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/shell/icons";
import { PublicShell } from "@/components/shell/public-shell";
import { ButtonLink, SectionHeading, toneStyle } from "@/components/ui/primitives";
import { CATALOG } from "@/lib/assistants/catalog";
import { getMessages } from "@/lib/i18n/server";
import { EMOJI } from "@/lib/mood/score";

// Public welcome page. Claims are limited to what exists today (D-11, D-19): no
// testimonials, no usage numbers, and the conversation preview is labelled illustrative.
export default async function HomePage() {
  const { locale, t } = await getMessages();
  const l = t.v2.landing;
  const r = t.reflection;
  const [first, ...rest] = l.title.split(/(?<=[.!؟?])\s+/);
  const stepIcons = [<SparkIcon key="a" />, <RouteIcon key="b" />, <BookIcon key="c" />, <ShieldIcon key="d" />];
  const privacyIcons = [<CheckIcon key="a" />, <LockIcon key="b" />, <ShieldIcon key="c" />, <SparkIcon key="d" />];

  return (
    <PublicShell locale={locale} t={t} bare>
      {/* --- Hero ----------------------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="aurora">
            <span />
            <span />
            <span />
          </div>
          <div className="dot-grid absolute inset-0" />
        </div>
        <div className="relative mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div className="space-y-7">
            <p className="enter inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-sm font-semibold text-primary-strong backdrop-blur">
              <span aria-hidden className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-accent motion-safe:animate-[breathe_2.4s_ease-in-out_infinite]" />
                <span className="relative h-2 w-2 rounded-full bg-accent" />
              </span>
              {l.badge}
            </p>
            <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.1rem] rtl:text-[2.3rem] rtl:sm:text-5xl rtl:lg:text-[3.4rem]">
              {first} {rest.length > 0 ? <span className="text-gradient">{rest.join(" ")}</span> : null}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-ink-muted">{l.lead}</p>
            <nav aria-label={t.common.signIn} className="enter enter-3 flex flex-wrap gap-3">
              <ButtonLink href="/sign-up" size="lg">
                {l.ctaPrimary}
                <ArrowIcon />
              </ButtonLink>
              <ButtonLink href="/sign-in" variant="secondary" size="lg">
                {l.ctaSecondary}
              </ButtonLink>
            </nav>
            <ul className="enter enter-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
              {l.trust.map((item) => (
                <li key={item} className="inline-flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/12 text-primary-strong">
                    <CheckIcon className="h-3 w-3" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="enter enter-2 mx-auto w-full max-w-md lg:max-w-none">
            <AssistantPreview
              assistants={CATALOG}
              locale={locale}
              copy={{
                label: l.previewLabel,
                ask: l.previewAsk,
                answer: l.previewAnswer,
                sources: l.previewSources,
                illustrative: t.v2.common.illustrative,
              }}
            />
          </div>
        </div>
      </section>

      {/* --- Assistants ----------------------------------------------------------------- */}
      <section aria-labelledby="explore" className="relative mx-auto max-w-6xl space-y-10 px-4 py-16 sm:px-6 sm:py-24">
        <div className="reveal">
          <SectionHeading id="explore" eyebrow={l.exploreEyebrow} title={l.exploreTitle} lead={l.exploreLead} />
        </div>
        <AssistantExplorer assistants={CATALOG} locale={locale} groups={l.groups} filterLabel={t.v2.directory.filterLabel} />
      </section>

      {/* --- How it works ---------------------------------------------------------------- */}
      <section aria-labelledby="how" className="relative border-y border-line bg-canvas-2/70">
        <div className="mx-auto max-w-6xl space-y-12 px-4 py-16 sm:px-6 sm:py-24">
          <div className="reveal">
            <SectionHeading id="how" eyebrow={l.howEyebrow} title={l.howTitle} center />
          </div>
          <ol className="relative grid gap-6 md:grid-cols-4">
            <span aria-hidden className="absolute inset-x-[12%] top-7 hidden h-px bg-gradient-to-r from-transparent via-line-strong/60 to-transparent md:block" />
            {l.howSteps.map((step, i) => (
              <li key={step.title} className="reveal relative space-y-3 text-center">
                <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface text-primary-strong shadow-soft [&>svg]:h-6 [&>svg]:w-6">
                  {stepIcons[i]}
                  <span className="absolute -end-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                    {i + 1}
                  </span>
                </span>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mx-auto max-w-xs text-sm leading-relaxed text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --- Knowledge ------------------------------------------------------------------ */}
      <section aria-labelledby="knowledge" className="relative mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
        <div className="reveal space-y-8">
          <SectionHeading id="knowledge" eyebrow={l.knowledgeEyebrow} title={l.knowledgeTitle} lead={l.knowledgeLead} />
          <dl className="grid grid-cols-3 gap-3">
            {l.knowledgeFacts.map((fact) => (
              <div key={fact.label} className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <dt className="sr-only">{fact.label}</dt>
                <dd>
                  <span className="font-display block text-3xl font-semibold text-gradient">{fact.value}</span>
                  <span className="mt-1 block text-xs leading-snug text-ink-muted">{fact.label}</span>
                </dd>
              </div>
            ))}
          </dl>
          <ul className="space-y-3">
            {l.knowledgePoints.map((point) => (
              <li key={point} className="flex items-start gap-3 text-ink-muted">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary-strong">
                  <CheckIcon className="h-3 w-3" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        {/* A small diagram of the routing idea: one question, ten focused knowledge bases. */}
        <div aria-hidden className="reveal relative mx-auto aspect-square w-full max-w-md overflow-hidden">
          <div className="absolute inset-[11%] rounded-full border border-dashed border-line-strong/40 motion-safe:animate-[orbit_60s_linear_infinite]">
            {CATALOG.map((a, i) => {
              const angle = (i / CATALOG.length) * Math.PI * 2 - Math.PI / 2;
              return (
                <span
                  key={a.id}
                  className="tone absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-[var(--tone-line)] bg-[var(--tone-bg)] text-[var(--tone-ink)] shadow-soft"
                  style={{ ...toneStyle(a.hue, a.chroma), left: `${50 + 50 * Math.cos(angle)}%`, top: `${50 + 50 * Math.sin(angle)}%` }}
                >
                  <span className="motion-safe:animate-[orbit-counter_60s_linear_infinite]">
                    <AssistantIcon name={a.icon} className="h-5 w-5" />
                  </span>
                </span>
              );
            })}
          </div>
          <div className="absolute inset-[30%] flex flex-col items-center justify-center gap-2 rounded-full bg-surface shadow-lifted">
            <LogoMark className="h-12 w-12" />
            <span className="h-1.5 w-16 rounded-full bg-gradient-to-r from-primary to-accent" />
          </div>
        </div>
      </section>

      {/* --- Daily Reflection ------------------------------------------------------------ */}
      <section aria-labelledby="reflection" className="relative overflow-hidden">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
          <div aria-hidden className="reveal order-last lg:order-first">
            <div className="glass mx-auto max-w-md space-y-5 rounded-[2rem] p-6 shadow-lifted">
              <p className="font-display text-lg font-semibold">{r.question}</p>
              <div className="grid grid-cols-3 gap-2">
                {(["happy", "calm", "tired", "anxious", "excited", "okay"] as const).map((e, i) => (
                  <span
                    key={e}
                    className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 text-xs font-semibold ${
                      i === 1 || i === 2 ? "border-primary bg-primary/10 text-primary-strong" : "border-line bg-surface text-ink-muted"
                    }`}
                  >
                    <span className={`text-2xl ${i === 1 ? "motion-safe:animate-[pop_2.8s_ease-in-out_infinite]" : ""}`}>{EMOJI[e]}</span>
                    {r.emotions[e]}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {(["work", "sleep", "family"] as const).map((f, i) => (
                  <span
                    key={f}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${i === 1 ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-muted"}`}
                  >
                    {r.factors[f]}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="reveal space-y-6">
            <SectionHeading id="reflection" eyebrow={l.reflectionEyebrow} title={l.reflectionTitle} lead={l.reflectionBody} />
            <ul className="space-y-3">
              {l.reflectionPoints.map((point) => (
                <li key={point} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                    <CalendarIcon className="h-4 w-4" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* --- Privacy --------------------------------------------------------------------- */}
      <section aria-labelledby="privacy" className="relative px-4 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-ink px-6 py-14 text-canvas sm:px-12 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40">
            <div className="aurora">
              <span />
              <span />
            </div>
          </div>
          <div className="relative grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.4fr]">
            <div className="reveal space-y-3">
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-accent">
                <span aria-hidden className="h-px w-6 bg-accent" />
                {l.privacyEyebrow}
              </p>
              <h2 id="privacy" className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                {l.privacyTitle}
              </h2>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {l.privacyPoints.map((point, i) => (
                <li key={point.title} className="reveal rounded-3xl border border-canvas/15 bg-canvas/5 p-5">
                  <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-canvas/10 text-canvas [&>svg]:h-5 [&>svg]:w-5">
                    {privacyIcons[i]}
                  </span>
                  <h3 className="font-semibold">{point.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-canvas/75">{point.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* --- Get started ----------------------------------------------------------------- */}
      <section aria-labelledby="start" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="reveal relative overflow-hidden rounded-[2.5rem] border border-line bg-surface p-8 shadow-lifted sm:p-12">
          <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -start-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              <SectionHeading id="start" eyebrow={l.startEyebrow} title={l.startTitle} />
              <ol className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {l.startSteps.map((step, i) => (
                  <li key={step} className="inline-flex items-center gap-3 rounded-full border border-line bg-canvas px-4 py-2 text-sm font-semibold">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-on-primary">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-stretch">
              <ButtonLink href="/sign-up" size="lg">
                {l.ctaPrimary}
                <ArrowIcon />
              </ButtonLink>
              <ButtonLink href="/sign-in" variant="secondary" size="lg">
                {l.ctaSecondary}
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {/* --- Limits and footer ----------------------------------------------------------- */}
      <footer className="border-t border-line bg-canvas-2/60">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-3">
            <Link href="/" className="inline-flex min-h-11 items-center gap-2.5">
              <LogoMark />
              <span lang="en" dir="ltr" className="font-display text-[1.02rem] font-semibold tracking-tight">
                {t.app.name}
              </span>
            </Link>
            <p className="text-sm text-ink-muted">{l.footerTagline}</p>
            <p className="text-xs text-ink-muted">{l.footerNote}</p>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 pt-2 text-sm font-semibold">
              <li>
                <Link href="/sign-in" className="inline-flex min-h-11 items-center text-ink-muted hover:text-ink">
                  {t.common.signIn}
                </Link>
              </li>
              <li>
                <Link href="/sign-up" className="inline-flex min-h-11 items-center text-ink-muted hover:text-ink">
                  {l.ctaPrimary}
                </Link>
              </li>
              <li>
                <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-ink-muted hover:text-ink">
                  {t.auth.forgotPasswordLink}
                </Link>
              </li>
            </ul>
          </div>
          <section aria-labelledby="limits" className="rounded-3xl border border-line bg-surface p-6">
            <h2 id="limits" className="text-lg font-semibold">
              {l.limitsTitle}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{l.limitsBody}</p>
          </section>
        </div>
      </footer>
    </PublicShell>
  );
}
