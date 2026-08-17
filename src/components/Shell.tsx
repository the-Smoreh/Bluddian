'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Bottom navigation. On a 6.3" phone the top of the screen is out of thumb
 * reach, so primary navigation lives at the bottom, above the gesture bar.
 */

const TABS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/money', label: 'Money', icon: 'coin' },
  { href: '/build', label: 'Build', icon: 'package' },
  { href: '/goals', label: 'Goals', icon: 'target' },
  { href: '/claude', label: 'Claude', icon: 'spark' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      // Opaque, not translucent: at this blur radius, page content behind the
      // bar stayed legible through it and read as a rendering glitch. The
      // gradient scrim above fades content out before it reaches the edge.
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line/80 bg-ink
                 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full
                 before:h-8 before:bg-gradient-to-t before:from-ink before:to-transparent"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-[var(--nav-h)] flex-col items-center justify-center gap-1
                            transition-colors ${active ? 'text-brand' : 'text-faint hover:text-muted'}`}
              >
                {active ? (
                  <span className="absolute top-0 h-0.5 w-8 rounded-full bg-brand" aria-hidden="true" />
                ) : null}
                <Icon name={tab.icon} size={21} filled={false} />
                <span className="text-[10px] font-semibold tracking-wide">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Standard page frame: safe-area padding top and bottom-nav clearance below. */
export function Page({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={`mx-auto max-w-lg px-4 ${className}`}
      style={{
        paddingTop: 'calc(var(--safe-top) + 1rem)',
        paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom) + 2rem)',
      }}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 mt-6 flex items-center justify-between">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: IconName;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="rounded-2xl border border-line bg-raised/60 p-3 text-faint">
        <Icon name={icon} size={24} />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mx-auto mt-1 max-w-[34ch] text-sm text-muted">{detail}</p>
      </div>
      {action}
    </div>
  );
}
