import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Shared UI primitives (server-safe: no client hooks). All colours come from
// the semantic tokens in app/globals.css.

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  secondary: "border border-line-strong bg-surface text-primary-strong hover:bg-surface-muted",
  ghost: "text-primary-strong underline-offset-4 hover:underline",
};

/** Buttons and button-like links: >= 44px tall, so they are comfortable touch targets. */
export function buttonStyles(variant: Variant = "primary", full = false): string {
  return [
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-base font-semibold transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    full ? "w-full" : "",
  ].join(" ");
}

export function ButtonLink({
  variant = "primary",
  full = false,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; full?: boolean }) {
  return <Link {...props} className={`${buttonStyles(variant, full)} ${className}`} />;
}

/** A text link with a comfortable (>= 24px) hit area. */
export function TextLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`inline-flex min-h-6 items-center font-semibold text-primary-strong underline underline-offset-4 ${className}`}
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
    <Tag {...rest} className={`rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6 ${className}`}>
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
      className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${TONES[tone]} ${className}`}
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

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-5 text-sm text-ink-muted">
      <p>{title}</p>
      {action}
    </div>
  );
}

export function PageHeader({ title, intro, eyebrow }: { title: string; intro?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="space-y-2">
      {eyebrow ? <div className="text-sm font-semibold text-primary-strong">{eyebrow}</div> : null}
      <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
      {intro ? <div className="text-base text-ink-muted">{intro}</div> : null}
    </header>
  );
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
