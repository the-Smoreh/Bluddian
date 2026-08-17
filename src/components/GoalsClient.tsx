'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Fab, Sheet } from '@/components/Sheet';
import { EmptyState, SectionTitle } from '@/components/Shell';
import { Meter } from '@/components/charts/Meter';
import { useToast } from '@/components/Toast';
import { del, patch, post } from '@/lib/client';
import { fmtMoney, fmtNumber, parseMoneyToCents } from '@/lib/money';
import type { GoalProgress } from '@/lib/queries';

const PRESETS = [
  { title: 'First $1,000', kind: 'revenue', target: 100_000, period: 'all' },
  { title: '$10k month', kind: 'revenue', target: 1_000_000, period: 'month' },
  { title: '100 sales', kind: 'sales', target: 100, period: 'all' },
  { title: '$100k year', kind: 'revenue', target: 10_000_000, period: 'year' },
] as const;

export function GoalsClient({ initial }: { initial: GoalProgress[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const active = initial.filter((g) => g.status === 'active');
  const done = initial.filter((g) => g.status === 'done');

  async function bumpCustom(goal: GoalProgress, delta: number) {
    try {
      const res = await patch<{ completedGoals: { title: string }[] }>('/api/goals', {
        id: goal.id,
        manualDelta: delta,
      });
      for (const g of res.completedGoals ?? []) {
        toast.push({ kind: 'level', title: 'Goal complete', detail: g.title });
      }
      router.refresh();
    } catch (err) {
      toast.error('Could not update', err instanceof Error ? err.message : undefined);
    }
  }

  async function remove(id: string) {
    try {
      await del('/api/goals', { id });
      toast.success('Goal removed');
      router.refresh();
    } catch (err) {
      toast.error('Could not delete', err instanceof Error ? err.message : undefined);
    }
  }

  return (
    <>
      <SectionTitle>Active</SectionTitle>

      {active.length === 0 ? (
        <EmptyState
          icon="target"
          title="No active goals"
          detail="A goal you can see every morning is worth more than one you wrote down once. Set a number and a date."
          action={
            <button type="button" onClick={() => setOpen(true)} className="btn-primary">
              Set a goal
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {active.map((g) => (
            <li key={g.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 font-semibold">{g.title}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {g.daysLeft !== null ? (
                    <span
                      className={`chip ${
                        g.daysLeft < 0
                          ? 'border-bad/40 text-bad'
                          : g.onTrack
                            ? 'border-good/40 text-good'
                            : 'border-warn/40 text-warn'
                      }`}
                    >
                      <Icon name="clock" size={11} />
                      {g.daysLeft < 0 ? 'Overdue' : `${g.daysLeft}d`}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(g.id)}
                    className="rounded-lg p-1.5 text-faint transition hover:bg-bad/10 hover:text-bad"
                    aria-label={`Delete goal ${g.title}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <Meter value={g.current} max={g.target_value} tone="money" height={11} label={g.title} />
              </div>

              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-lg font-bold text-gold nums">{format(g, g.current)}</span>
                <span className="text-xs text-muted nums">
                  of {format(g, g.target_value)} · {g.pct.toFixed(0)}%
                </span>
              </div>

              {g.paceNeededPerDay && g.remaining > 0 ? (
                <p className="mt-2 text-xs text-faint">
                  <span className={g.onTrack ? 'text-good' : 'text-warn'}>
                    {g.onTrack ? 'On track' : 'Behind pace'}
                  </span>{' '}
                  · need {format(g, Math.ceil(g.paceNeededPerDay))}/day
                </p>
              ) : null}

              {/* Custom goals have no data source, so they get manual controls. */}
              {g.kind === 'custom' ? (
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => bumpCustom(g, -1)} className="btn-ghost h-9 min-h-0 flex-1 text-xs">
                    −1
                  </button>
                  <button type="button" onClick={() => bumpCustom(g, 1)} className="btn-ghost h-9 min-h-0 flex-1 text-xs">
                    +1
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 ? (
        <>
          <SectionTitle>Completed</SectionTitle>
          <ul className="card divide-y divide-line/60">
            {done.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-good">
                  <Icon name="check" size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{g.title}</span>
                <span className="shrink-0 text-sm font-semibold text-good nums">
                  {format(g, g.target_value)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Fab onClick={() => setOpen(true)} label="New goal" />
      <GoalSheet open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }} />
    </>
  );
}

function format(goal: { kind: string; unit: string }, value: number): string {
  return goal.kind === 'revenue' ? fmtMoney(value, goal.unit || 'USD', { compact: true }) : fmtNumber(value);
}

function GoalSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    kind: 'revenue',
    target: '',
    period: 'all',
    deadline: '',
  });

  function applyPreset(p: (typeof PRESETS)[number]) {
    setForm({
      title: p.title,
      kind: p.kind,
      target: p.kind === 'revenue' ? String(p.target / 100) : String(p.target),
      period: p.period,
      deadline: form.deadline,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const targetValue =
      form.kind === 'revenue' ? parseMoneyToCents(form.target) : Number(form.target.replace(/\D/g, ''));

    if (!targetValue || targetValue <= 0) {
      toast.error('Set a target above zero.');
      return;
    }

    setBusy(true);
    try {
      await post('/api/goals', {
        title: form.title,
        kind: form.kind,
        targetValue,
        period: form.period,
        deadline: form.deadline ? new Date(`${form.deadline}T23:59:59Z`).getTime() : null,
      });
      toast.success('Goal set', form.title);
      setForm({ title: '', kind: 'revenue', target: '', period: 'all', deadline: '' });
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New goal">
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div>
          <p className="label">Quick start</p>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.title}
                type="button"
                onClick={() => applyPreset(p)}
                className="btn-ghost h-10 min-h-0 text-xs"
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="g-title">Goal</label>
          <input
            id="g-title"
            className="input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="First $1,000"
            required
            maxLength={120}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="g-kind">Measure</label>
            <select
              id="g-kind"
              className="input"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="revenue">Revenue</option>
              <option value="sales">Sales count</option>
              <option value="students">Students</option>
              <option value="custom">Custom counter</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="g-target">Target</label>
            <input
              id="g-target"
              className="input nums"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder={form.kind === 'revenue' ? '$1,000' : '100'}
              inputMode="decimal"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="g-period">Window</label>
            <select
              id="g-period"
              className="input"
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
              disabled={form.kind === 'custom'}
            >
              <option value="all">All time</option>
              <option value="month">This month</option>
              <option value="quarter">This quarter</option>
              <option value="year">This year</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="g-deadline">Deadline</label>
            <input
              id="g-deadline"
              type="date"
              className="input nums"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2.5 text-xs text-muted">
          <Icon name="target" size={14} className="mt-0.5 shrink-0" />
          <span>
            Progress counts the whole window. A monthly goal includes what
            you&apos;ve <strong className="text-fg">already</strong> earned this month, so it can
            open part-way done.
          </span>
        </p>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Lock it in'}
        </button>
      </form>
    </Sheet>
  );
}
