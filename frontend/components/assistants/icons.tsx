import type { ReactNode } from "react";

// Duotone line icons for the ten assistants (decorative: names are always shown as text).
// The soft fill layer uses currentColor at low opacity, so each icon takes its tone.
const PATHS: Record<string, { fill?: ReactNode; line: ReactNode }> = {
  heart: {
    fill: <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />,
    line: (
      <>
        <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
        <path d="M8.5 10.5c.4-1 1.1-1.6 2-1.8" />
      </>
    ),
  },
  home: {
    fill: <path d="M5 10.5 12 5l7 5.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />,
    line: (
      <>
        <path d="M3.5 10.5 12 4l8.5 6.5" />
        <path d="M5.5 9v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" />
        <circle cx="10" cy="14" r="1.6" />
        <circle cx="14.5" cy="15" r="1.2" />
        <path d="M8 20c0-1.6.9-2.7 2-2.7s2 1.1 2 2.7M13 20c0-1.2.7-2 1.5-2s1.5.8 1.5 2" />
      </>
    ),
  },
  briefcase: {
    fill: <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />,
    line: (
      <>
        <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
        <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17M11 12.5v1.5h2v-1.5" />
      </>
    ),
  },
  sprout: {
    fill: <path d="M12 12c0-4.4 3-7 7.5-7 0 4.4-3 7-7.5 7z" />,
    line: (
      <>
        <path d="M12 20.5V12" />
        <path d="M12 12c0-4.4 3-7 7.5-7 0 4.4-3 7-7.5 7zM12 14.5c0-3.3-2.3-5.5-6.5-5.5 0 3.3 2.3 5.5 6.5 5.5z" />
        <path d="M8 20.5h8" />
      </>
    ),
  },
  activity: {
    fill: <circle cx="12" cy="12" r="8.5" />,
    line: (
      <>
        <path d="M3.5 12.5h3.5l2.2-5 4 10 2.3-5h5" />
      </>
    ),
  },
  leaf: {
    fill: <path d="M5 19c8.5 0 14-5.5 14-14C10.5 5 5 10.5 5 19z" />,
    line: (
      <>
        <path d="M5 19c8.5 0 14-5.5 14-14C10.5 5 5 10.5 5 19z" />
        <path d="M5 19l8-8M10 14h3.5M13 11V7.5" />
      </>
    ),
  },
  users: {
    fill: <circle cx="9" cy="8.5" r="3.5" />,
    line: (
      <>
        <circle cx="9" cy="8.5" r="3.2" />
        <path d="M3.5 19.5c0-3.1 2.5-5.3 5.5-5.3s5.5 2.2 5.5 5.3" />
        <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.5c1.9.6 3 2.4 3 5" />
      </>
    ),
  },
  compass: {
    fill: <circle cx="12" cy="12" r="8.5" />,
    line: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.5 8.5-2.3 4.7-4.7 2.3 2.3-4.7z" />
        <path d="M12 3.5v1.5M12 19v1.5M3.5 12H5M19 12h1.5" />
      </>
    ),
  },
  wallet: {
    fill: <rect x="3.5" y="6.5" width="17" height="13" rx="2.5" />,
    line: (
      <>
        <path d="M17.5 6.5V5a1.5 1.5 0 0 0-1.8-1.5L5 6" />
        <rect x="3.5" y="6.5" width="17" height="13" rx="2.5" />
        <path d="M20.5 11h-4a2 2 0 0 0 0 4h4" />
        <circle cx="16.8" cy="13" r=".6" fill="currentColor" />
      </>
    ),
  },
  sparkles: {
    fill: <path d="M11 4c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7z" />,
    line: (
      <>
        <path d="M11 4c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7z" />
        <path d="M18.5 15.5c.3 1.6.9 2.2 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.3 2.2-.9 2.5-2.5z" />
      </>
    ),
  },
};

export function AssistantIcon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  const icon = PATHS[name] ?? PATHS.sparkles!;
  return (
    <svg
      aria-hidden
      focusable={false}
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon.fill ? (
        <g fill="currentColor" stroke="none" opacity={0.16}>
          {icon.fill}
        </g>
      ) : null}
      {icon.line}
    </svg>
  );
}
