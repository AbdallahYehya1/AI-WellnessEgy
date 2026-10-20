"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { buttonStyles } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/config";
import { messages } from "@/lib/i18n/messages";
import { translateMessage } from "@/lib/i18n/translate";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  name,
  value,
}: {
  children: ReactNode;
  pendingText: string;
  variant?: "primary" | "secondary";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-disabled={pending} className={buttonStyles(variant, true)}>
      {pending ? pendingText : children}
    </button>
  );
}

/** A form-level error from a server action, shown in the visitor's language. */
export function FormAlert({ message, locale = "en" }: { message?: string; locale?: Locale }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-ink">
      {translateMessage(locale, message)}
    </p>
  );
}

type FieldProps = {
  id: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  error?: string;
  defaultValue?: string;
  hint?: string;
  locale?: Locale;
  required?: boolean;
  maxLength?: number;
};

export const inputClasses =
  "block min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted aria-invalid:border-danger-ink";

export function Field({
  id,
  label,
  type,
  autoComplete,
  error,
  defaultValue,
  hint,
  locale = "en",
  required = true,
  maxLength,
}: FieldProps) {
  const [visible, setVisible] = useState(false);
  const t = messages[locale];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  const isPassword = type === "password";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {isPassword ? (
        // Input and toggle sit side by side in one bordered row (follows the page direction),
        // so the toggle can never cover the text in Arabic or English, whatever its width.
        // The password itself stays left-to-right.
        <div
          className={`flex min-h-11 w-full items-stretch rounded-xl border bg-surface focus-within:ring-2 focus-within:ring-focus ${
            error ? "border-danger-ink" : "border-line-strong"
          }`}
        >
          <input
            id={id}
            name={id}
            type={visible ? "text" : "password"}
            autoComplete={autoComplete}
            defaultValue={defaultValue}
            required={required}
            maxLength={maxLength}
            dir="ltr"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            className="password-input min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            aria-controls={id}
            className="m-1 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-semibold text-primary-strong hover:bg-surface-muted"
          >
            {visible ? t.forms.hidePassword : t.forms.showPassword}
          </button>
        </div>
      ) : (
        <input
          id={id}
          name={id}
          type={type}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          required={required}
          maxLength={maxLength}
          dir={type === "email" ? "ltr" : "auto"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={inputClasses}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger-ink">
          {translateMessage(locale, error)}
        </p>
      ) : null}
    </div>
  );
}
