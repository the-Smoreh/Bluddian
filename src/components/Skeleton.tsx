'use client';

import { useInView } from '@/lib/useAnimated';

/**
 * Loading and entrance primitives.
 *
 * The skeletons here are honest: each one has the shape and size of the thing
 * it stands in for, so the layout does not jump when real content lands. A
 * skeleton that is the wrong size is worse than a spinner, because it promises
 * a layout it then breaks.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-raised ${className}`}
      aria-hidden="true"
    >
      {/* A sweep rather than a pulse: it reads as "working" instead of
          "blinking", and it does not draw the eye once several are on screen. */}
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.045] to-transparent" />
    </div>
  );
}

/** Stand-in for the whole dashboard while the vault decrypts. */
export function DashboardSkeleton() {
  return (
    <div
      className="mx-auto max-w-lg px-4"
      style={{ paddingTop: 'calc(var(--safe-top) + 1rem)' }}
      aria-busy="true"
      aria-label="Loading your dashboard"
    >
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-5 w-5 rounded-full" />
      </div>

      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-11 w-52" />
      <Skeleton className="mt-3 h-3 w-24" />
      <Skeleton className="mt-6 h-[132px] w-full rounded-xl" />

      <div className="mt-6 border-y border-line py-3">
        <Skeleton className="h-2 w-full rounded-full" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card px-3.5 py-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-3 h-6 w-24" />
            <Skeleton className="mt-2.5 h-2.5 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Fades and lifts its children in when they reach the viewport.
 *
 * `delay` staggers siblings so a screen assembles in sequence rather than
 * snapping in as one block — the difference between a page appearing and a
 * page arriving.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        inView ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      } ${className}`}
      style={{ transitionDelay: inView ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}
