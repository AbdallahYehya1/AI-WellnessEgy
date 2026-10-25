import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

// Shared UI primitives (server-safe: no client hooks). All colours come from the
// semantic tokens in app/globals.css.

type Variant = "primary" | "secondary" | "ghost" | "quiet";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary shadow-soft hover:bg-primary-strong hover:shadow-lifted active:translate-y-px",
  secondary:
    "border border-line-strong/60 bg-surface text-ink shadow-soft hover:border-primary hover:text-primary-strong active:translate-y-px",
  ghost: "text-primary-strong underline-offset-4 hover:underline",
  quiet: "text-ink-muted hover:bg-surface-muted hover:text-ink",
};

/** Buttons and button-like links: >= 44px tall, so they are comfortable touch targets. */
export function buttonStyles(variant: Variant = "primary", full = false, size: Size = "md"): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200",
    size === "lg" ? "min-h-12 px-6 text-base" : "min-h-11 px-5 py-2.5 text-[0.95rem]",
    "disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    full ? "w-full" : "",
  ].join(" ");
}

export function ButtonLink({
  variant = "primary",
  full = false,
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; full?: boolean; size?: Size }) {
  return <Link {...props} className={`${buttonStyles(variant, full, size)} ${className}`} />;
}

/** A text link with a comfortable (>= 24px) hit area. */
export function TextLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`inline-flex min-h-6 items-center font-semibold text-primary-strong underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary ${className}`}
    />
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & Record<string, unknown>) {
  return (
    <Tag {...rest} className={`rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-7 ${className}`}>
      {children}
    </Tag>
  );
}

type Tone = "info" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  info: "bg-info-bg text-info-ink",
  success: "bg-success-bg text-success-ink",
  warning: "bg-warning-bg text-warning-ink",
  danger: "bg-danger-bg text-danger-ink",
};

/**
 * A message block. `danger` notices are announced immediately (role=alert);
 * the others politely (role=status). Meaning never relies on colour alone:
 * callers always provide text.
 */
export function Notice({
  tone = "info",
  children,
  className = "",
  role,
  ...rest
}: { tone?: Tone; children: ReactNode; className?: string; role?: "alert" | "status" | "note" } & Record<
  string,
  unknown
>) {
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      {...rest}
      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl border border-dashed border-line-strong/50 bg-surface/60 p-6 text-sm text-ink-muted sm:p-8">
      {icon ? (
        <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          {icon}
        </span>
      ) : null}
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {body ? <div>{body}</div> : null}
      {action}
    </div>
  );
}

export function PageHeader({ title, intro, eyebrow }: { title: string; intro?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="enter space-y-3">
      {eyebrow ? (
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary-strong">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {eyebrow}
        </div>
      ) : null}
      <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
      {intro ? <div className="max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">{intro}</div> : null}
    </header>
  );
}

/** Eyebrow + heading + lead for marketing and page sections. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
  center = false,
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`space-y-3 ${center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}`}>
      {eyebrow ? (
        <p className={`inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-accent-ink ${center ? "justify-center" : ""}`}>
          <span aria-hidden className="h-px w-6 bg-accent" />
          {eyebrow}
        </p>
      ) : null}
      <h2 id={id} className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        {title}
      </h2>
      {lead ? <p className="text-base leading-relaxed text-ink-muted sm:text-lg">{lead}</p> : null}
    </div>
  );
}

/** Wrap content in an assistant's colour identity (see `.tone` in globals.css). */
export function toneStyle(hue: number, chroma?: number): CSSProperties {
  return { "--a": String(hue), ...(chroma !== undefined ? { "--c": String(chroma) } : {}) } as CSSProperties;
}

/** Checkbox with a 24px box and the whole label as the hit area. */
export function Checkbox({
  label,
  error,
  id,
  ...input
}: { label: ReactNode; error?: string; id: string } & Omit<ComponentProps<"input">, "type" | "id">) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input
          {...input}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer rounded accent-[var(--primary)]"
        />
        <span className="pt-0.5">{label}</span>
      </label>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
