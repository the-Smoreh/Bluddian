'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { patch } from '@/lib/client';
import type { Quest } from '@/lib/game';

/**
 * Daily and weekly quests. Optimistic: tapping flips the row immediately and
 * rolls back if the server disagrees, because a checkbox that waits on a
 * round-trip feels broken on a phone.
 */
export function QuestList({ initial }: { initial: Quest[] }) {
  const [quests, setQuests] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const toast = useToast();

  async function toggle(quest: Quest) {
    if (pending) return;
    setPending(quest.id);

    const done = quest.completed_at !== null;
    const delta = done ? -quest.target : quest.target;

    // Optimistic flip.
    setQuests((prev) =>
      prev.map((q) =>
        q.id === quest.id
          ? { ...q, completed_at: done ? null : Date.now(), progress: done ? 0 : q.target }
          : q,
      ),
    );

    try {
      const res = await patch<{
        quest: Quest;
        awarded: number;
        level: { level: number; title: string };
      }>('/api/quests', { id: quest.id, delta });

      setQuests((prev) => prev.map((q) => (q.id === quest.id ? res.quest : q)));

      if (res.awarded > 0) toast.xp(res.awarded, quest.title);
      else if (res.awarded < 0) toast.push({ kind: 'info', title: `${res.awarded} XP`, detail: 'Quest reopened' });
    } catch (err) {
      // Roll back to the server's last known truth.
      setQuests((prev) => prev.map((q) => (q.id === quest.id ? quest : q)));
      toast.error('Could not update', err instanceof Error ? err.message : undefined);
    } finally {
      setPending(null);
    }
  }

  const daily = quests.filter((q) => q.cadence === 'daily');
  const weekly = quests.filter((q) => q.cadence === 'weekly');
  const doneCount = daily.filter((q) => q.completed_at).length;

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Daily</span>
          <span className="text-xs text-faint nums">
            {doneCount}/{daily.length}
          </span>
        </div>
        <ul className="divide-y divide-line/60">
          {daily.map((q) => (
            <QuestRow key={q.id} quest={q} onToggle={toggle} busy={pending === q.id} />
          ))}
        </ul>
      </div>

      {weekly.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">This week</span>
            <span className="text-xs text-faint nums">
              {weekly.filter((q) => q.completed_at).length}/{weekly.length}
            </span>
          </div>
          <ul className="divide-y divide-line/60">
            {weekly.map((q) => (
              <QuestRow key={q.id} quest={q} onToggle={toggle} busy={pending === q.id} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function QuestRow({
  quest,
  onToggle,
  busy,
}: {
  quest: Quest;
  onToggle: (q: Quest) => void;
  busy: boolean;
}) {
  const done = quest.completed_at !== null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(quest)}
        disabled={busy}
        aria-pressed={done}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-raised/50 disabled:opacity-60"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
            done ? 'border-good bg-good text-ink' : 'border-line bg-raised/60 text-transparent'
          }`}
        >
          <Icon name="check" size={14} />
        </span>

        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium ${done ? 'text-faint line-through' : ''}`}>
            {quest.title}
          </span>
          <span className="block truncate text-xs text-faint">{quest.detail}</span>
        </span>

        <span
          className={`shrink-0 text-xs font-bold nums ${done ? 'text-faint' : 'text-brand'}`}
        >
          +{quest.xp}
        </span>
      </button>
    </li>
  );
}
