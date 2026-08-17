import { Icon } from '@/components/Icon';

export const metadata = { title: 'Offline · Bluddian' };

/**
 * Shown by the service worker when a navigation fails and nothing is cached.
 * Static by design — it must render with zero network and zero database.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-8 text-center">
      <span className="mb-5 rounded-2xl border border-line bg-raised/60 p-4 text-faint">
        <Icon name="wifiOff" size={28} />
      </span>
      <h1 className="text-xl font-bold tracking-tight">No connection</h1>
      <p className="mt-2 text-sm text-muted">
        Bluddian needs the network to show live numbers. Pages you&apos;ve already opened stay
        available; this one hasn&apos;t been cached yet.
      </p>
      <a href="/" className="btn-primary mt-6 w-full">
        Try again
      </a>
    </main>
  );
}
