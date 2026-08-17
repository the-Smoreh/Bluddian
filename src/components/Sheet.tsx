'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';

/**
 * Bottom sheet — the Android-native pattern for a form you summon and dismiss.
 * Slides up from the thumb, not down from the top of an unreachable screen.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Lock the page behind the sheet so the wrong thing doesn't scroll.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the sheet for keyboard and screen-reader users.
    const timer = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] animate-slide-up overflow-y-auto
                   rounded-t-xl3 border-t border-line bg-surface shadow-2xl"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 1.25rem)' }}
      >
        {/* Grab handle: signals "draggable sheet" even though we close by tap. */}
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-xl">
          <div className="flex justify-center pt-2.5">
            <span className="h-1 w-9 rounded-full bg-line" aria-hidden="true" />
          </div>
          <div className="flex items-center justify-between px-5 pb-3 pt-3">
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-muted transition hover:bg-raised hover:text-fg"
              aria-label="Close"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="px-5 pt-1">{children}</div>
      </div>
    </div>
  );
}

/** Floating action button, bottom-right, clear of the nav bar. */
export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Dark glyph on the light surface. When the primary colour became white,
      // the inherited text-white left this button with an invisible icon.
      className="fixed right-4 z-40 flex h-13 w-13 items-center justify-center rounded-full
                 bg-fg text-ink shadow-lg shadow-black/50 transition active:scale-95"
      style={{
        bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 1rem)',
        height: '3.25rem',
        width: '3.25rem',
      }}
    >
      <Icon name="plus" size={22} />
    </button>
  );
}
