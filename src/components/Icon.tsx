/**
 * Inline icon set. No icon library dependency: these ship as part of the JS
 * bundle already being sent, they inherit currentColor, and the CSP forbids
 * loading anything external anyway.
 *
 * All paths are drawn on a 24x24 grid with a 1.75 stroke to stay legible at
 * the 20-22px sizes this app actually uses.
 */

export type IconName =
  | 'home'
  | 'package'
  | 'book'
  | 'spark'
  | 'target'
  | 'settings'
  | 'plus'
  | 'flame'
  | 'zap'
  | 'coin'
  | 'crown'
  | 'grid'
  | 'trendUp'
  | 'trendDown'
  | 'check'
  | 'x'
  | 'refresh'
  | 'lock'
  | 'trash'
  | 'chevronRight'
  | 'chevronDown'
  | 'cart'
  | 'shield'
  | 'clock'
  | 'edit'
  | 'link'
  | 'logout'
  | 'wifiOff'
  | 'key'
  | 'trophy';

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />,
  package: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5v-15Z" />
      <path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H19v3H5.5A1.5 1.5 0 0 1 4 19.5Z" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2.5 13.9 9l6.6 1.9-6.6 1.9L12 19.4l-1.9-6.6L3.5 11 10.1 9 12 2.5Z" />
      <path d="M18.5 3v3M20 4.5h-3M6 17v2.5M7.25 18.25h-2.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14a1.5 1.5 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.5 1.5 0 0 0-2.5 1v.2a2 2 0 1 1-4 0V19a1.5 1.5 0 0 0-2.6-1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.5 1.5 0 0 0 4.6 14H4.4a2 2 0 1 1 0-4h.1A1.5 1.5 0 0 0 6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.5 1.5 0 0 0 2.5-1V3.6a2 2 0 1 1 4 0v.1a1.5 1.5 0 0 0 2.5 1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4 1h.2a2 2 0 1 1 0 4h-.2a1.5 1.5 0 0 0-1.3 1Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  flame: (
    <>
      <path d="M12 21c3.6 0 6.5-2.7 6.5-6 0-4.5-4.5-6.5-4-12-3 1.5-5 4.5-5 7 0 1-.5 2-1.5 2S6 11 6 10c-.9 1.4-.5 2.6-.5 5 0 3.3 2.9 6 6.5 6Z" />
    </>
  ),
  zap: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />,
  coin: (
    <>
      <ellipse cx="12" cy="6.5" rx="7.5" ry="3.5" />
      <path d="M4.5 6.5v11c0 1.9 3.4 3.5 7.5 3.5s7.5-1.6 7.5-3.5v-11" />
      <path d="M4.5 12c0 1.9 3.4 3.5 7.5 3.5s7.5-1.6 7.5-3.5" />
    </>
  ),
  crown: <path d="M3 18h18M4 8l4 3.5L12 5l4 6.5L20 8l-1.5 8h-13L4 8Z" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  trendUp: <path d="M3 17 9.5 10.5l4 4L21 7M21 7h-5.5M21 7v5.5" />,
  trendDown: <path d="M3 7 9.5 13.5l4-4L21 17M21 17h-5.5M21 17v-5.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4v5h-5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 1 1 8 0v3" />
    </>
  ),
  trash: (
    <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7M10.5 11v6M13.5 11v6" />
  ),
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  chevronDown: <path d="m5 9.5 7 7 7-7" />,
  cart: (
    <>
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
      <path d="M2.5 3.5h2.6l2.4 12.1a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.2l1.6-8.1H6" />
    </>
  ),
  shield: <path d="M12 21s7.5-3.4 7.5-9V5.8L12 3 4.5 5.8V12c0 5.6 7.5 9 7.5 9Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3" />,
  link: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11.4 6.4" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.6-1.6" />
    </>
  ),
  logout: (
    <path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2M11 12h10M18 9l3 3-3 3" />
  ),
  wifiOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0M5 12a10 10 0 0 1 3.6-2.3M19 12a10 10 0 0 0-6.7-2.9M1.5 8.5A15 15 0 0 1 6 5.7M22.5 8.5a15 15 0 0 0-8-3.4" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M17.5 12v3.5M20 12v2.5" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5.5H5.5V7a3 3 0 0 0 3 3M16 5.5h2.5V7a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4l.5 3h-5l.5-3Z" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className = '',
  filled = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
