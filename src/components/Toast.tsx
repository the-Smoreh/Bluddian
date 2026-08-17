'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Toasts double as the game's feedback channel: XP awards, level-ups and
 * achievements all surface here, which is what makes progress feel immediate
 * rather than something you discover later on a stats page.
 */

export type ToastKind = 'info' | 'success' | 'error' | 'xp' | 'level';

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
};

type ToastApi = {
  push: (t: Omit<Toast, 'id'>) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  xp: (amount: number, reason?: string) => void;
  levelUp: (level: number, title: string) => void;
};

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const STYLES: Record<ToastKind, { icon: IconName; ring: string; text: string }> = {
  info: { icon: 'spark', ring: 'border-line bg-raised', text: 'text-fg' },
  success: { icon: 'check', ring: 'border-good/40 bg-good/10', text: 'text-good' },
  error: { icon: 'x', ring: 'border-bad/40 bg-bad/10', text: 'text-bad' },
  xp: { icon: 'zap', ring: 'border-brand/40 bg-brand/10', text: 'text-brand' },
  level: { icon: 'crown', ring: 'border-gold/50 bg-gold/10', text: 'text-gold' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);

    // A short haptic tick on the Pixel makes rewards land physically.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(t.kind === 'level' ? [12, 40, 24] : t.kind === 'error' ? [40] : 10);
    }

    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, t.kind === 'level' ? 5000 : 3400);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, detail) => push({ kind: 'success', title, detail }),
      error: (title, detail) => push({ kind: 'error', title, detail }),
      xp: (amount, reason) =>
        push({
          kind: 'xp',
          title: `${amount > 0 ? '+' : ''}${amount} XP`,
          detail: reason,
        }),
      levelUp: (level, title) =>
        push({ kind: 'level', title: `Level ${level} — ${title}`, detail: 'Rank up.' }),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4"
        style={{ top: 'calc(var(--safe-top) + 0.75rem)' }}
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const s = STYLES[t.kind];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex w-full max-w-sm animate-pop-in items-center gap-3
                          rounded-2xl border ${s.ring} px-3.5 py-3 shadow-2xl backdrop-blur-xl`}
            >
              <span className={`shrink-0 ${s.text}`}>
                <Icon name={s.icon} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-bold ${s.text}`}>{t.title}</p>
                {t.detail ? <p className="truncate text-xs text-muted">{t.detail}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
