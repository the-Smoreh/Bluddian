'use client';

import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { toggleQuest } from '@/lib/local/actions';
import type { Quest } from '@/lib/local/types';

/**
 * Quests write straight to the local store, so there's no optimistic-update
 * dance and no rollback path — the mutation is synchronous and the re-render is
 * immediate. Removing the network removed a whole class of UI state.
 */
export function QuestList({ quests }: { quests: Quest[] }) {
  const toast = useToast();

  function toggle(quest: Quest) {
    const result = toggleQuest(quest.id);

    if (result.awardedXp > 0) toast.xp(result.awardedXp, quest.title);
    else if (result.awardedXp < 0) {
      toast.push({ kind: 'info', title: `${result.awardedXp} XP`, detail: 'Quest reopened' });
    }

    if (result.levelUp) toast.levelUp(result.levelUp.level, result.levelUp.title);
    for (const title of result.completedGoals) {
      toast.push({ kind: 'level', title: 'Goal complete', detail: title });
    }
  }

  const daily = quests.filter((q) => q.cadence === 'daily');
  const weekly = quests.filter((q) => q.cadence === 'weekly');

  return (
    <div className="space-y-3">
      <QuestGroup label="Daily" quests={daily} onToggle={toggle} />
      {weekly.length > 0 ? <QuestGroup label="This week" quests={weekly} onToggle={toggle} /> : null}
    </div>
  );
}

function QuestGroup({
  label,
  quests,
  onToggle,
}: {
  label: string;
  quests: Quest[];
  onToggle: (q: Quest) => void;
}) {
  const done = quests.filter((q) => q.completedAt).length;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
        <span className="text-xs text-faint nums">
          {done}/{quests.length}
        </span>
      </div>
      <ul className="divide-y divide-line/60">
        {quests.map((q) => {
          const isDone = q.completedAt !== null;
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => onToggle(q)}
                aria-pressed={isDone}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-raised/50"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                    isDone ? 'border-good bg-good text-ink' : 'border-line bg-raised/60 text-transparent'
                  }`}
                >
                  <Icon name="check" size={14} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${isDone ? 'text-faint line-through' : ''}`}>
                    {q.title}
                  </span>
                  <span className="block truncate text-xs text-faint">{q.detail}</span>
                </span>

                <span className={`shrink-0 text-xs font-bold nums ${isDone ? 'text-faint' : 'text-brand'}`}>
                  +{q.xp}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
