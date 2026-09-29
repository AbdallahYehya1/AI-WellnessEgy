"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText }: { children: ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-calm-700 px-4 py-2.5 font-medium text-white transition hover:bg-calm-900 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

type FieldProps = {
  id: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  error?: string;
  defaultValue?: string;
  hint?: string;
};

export function Field({ id, label, type, autoComplete, error, defaultValue, hint }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="w-full rounded-md border border-calm-100 bg-white px-3 py-2 outline-none focus:border-calm-700 focus:ring-2 focus:ring-calm-100 aria-invalid:border-red-400"
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-calm-700">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AuthShell({
  titleAr,
  title,
  children,
}: {
  titleAr: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-1">
        <p className="text-sm font-medium text-calm-700">AI Wellness Egypt</p>
        <h1 className="text-3xl font-bold">{titleAr}</h1>
        <p lang="en" dir="ltr" className="text-left text-lg text-calm-700">
          {title}
        </p>
      </header>
      <div lang="en" dir="ltr" className="space-y-5 text-left">
        {children}
      </div>
    </main>
  );
}
