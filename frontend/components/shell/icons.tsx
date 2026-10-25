// Inline icons (decorative: always paired with visible text or an accessible name).
import type { ReactNode } from "react";

type IconProps = { className?: string };

function Icon({ className = "h-5 w-5", children, strokeWidth = 1.8 }: IconProps & { children: ReactNode; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      className={className}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z" />
  </Icon>
);
export const HeartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
  </Icon>
);
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 19.5h16M7 16v-4M12 16V8M17 16v-6" />
  </Icon>
);
export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12z" />
    <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth={2.6} />
  </Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);
export const MenuIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const ArrowIcon = ({ className = "h-4 w-4" }: IconProps) => (
  <Icon className={`${className} rtl:-scale-x-100`} strokeWidth={2.1}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const SendIcon = ({ className = "h-5 w-5" }: IconProps) => (
  <Icon className={`${className} rtl:-scale-x-100`} strokeWidth={2.1}>
    <path d="M4.5 12h14M13 5.5 19.5 12 13 18.5" />
  </Icon>
);
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 5 6.3v5.2c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6.3z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
);
export const BookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
  </Icon>
);
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5z" />
    <path d="M18.5 16.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2z" />
  </Icon>
);
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="5" width="16" height="15" rx="3" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Icon>
);
export const RouteIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
  </Icon>
);
export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2.2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const SidebarIcon = ({ className = "h-5 w-5", open = true }: IconProps & { open?: boolean }) => (
  <Icon className={`${className} rtl:-scale-x-100`}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9 4.5v15" />
    <path d={open ? "M15 10l-2 2 2 2" : "M13 10l2 2-2 2"} />
  </Icon>
);
export const DotsIcon = ({ className = "h-5 w-5" }: IconProps) => (
  <svg aria-hidden focusable={false} viewBox="0 0 24 24" className={className} fill="currentColor">
    <circle cx="5.5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="18.5" cy="12" r="1.7" />
  </svg>
);
export const SignOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" className="rtl:hidden" />
    <path d="M10 16l-4-4 4-4M6 12h9" className="rtl:hidden" />
    <path d="M10 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H10" className="hidden rtl:block" />
    <path d="M14 16l4-4-4-4M18 12H9" className="hidden rtl:block" />
  </Icon>
);

/** Brand mark: a sun rising over the Nile, in the teal → apricot brand gradient. */
export function LogoMark({ className = "h-8 w-8" }: IconProps) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[30%] shadow-soft ${className}`}
      style={{ background: "linear-gradient(135deg, var(--primary) 0%, #1f8f7d 45%, var(--accent) 100%)" }}
    >
      <svg viewBox="0 0 32 32" className="h-[78%] w-[78%]" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
        <circle cx="16" cy="14" r="4.6" fill="#fff" stroke="none" opacity={0.95} />
        <path d="M6 21.5c2.5-1.6 5-1.6 7.5 0s5 1.6 7.5 0 3.7-1.2 5-.6" />
        <path d="M8 25.5c2-1.1 4-1.1 6 0s4 1.1 6 0 3-.9 4-.4" opacity={0.7} />
      </svg>
    </span>
  );
}
