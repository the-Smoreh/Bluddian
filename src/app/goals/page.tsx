'use client';

import { useState } from 'react';
import { Page, PageHeader, SectionTitle, EmptyState } from '@/components/Shell';
import { Fab, Sheet } from '@/components/Sheet';
import { Meter } from '@/components/charts/Meter';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useDb } from '@/lib/local/useStore';
import { ACHIEVEMENTS, addGoal, deleteGoal, levelInfo, nudgeGoal } from '@/lib/local/actions';
import { goalsWithProgress, type GoalProgress } from '@/lib/local/selectors';
import { fmtMoney, fmtNumber, parseMoneyToCents, relativeTime } from '@/lib/money';

const PRESETS = [
  { title: 'First $1,000', kind: 'revenue', target: 100_000, period: 'all' },
  { title: '$10k month', kind: 'revenue', target: 1_000_000, period: 'month' },
  { title: '100 sales', kind: 'sales', target: 100, period: 'all' },
  { title: '$100k year', kind: 'revenue', target: 10_000_000, period: 'year' },
] as const;

export default function GoalsPage() {
  const db = useDb();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const goals = goalsWithProgress(db, true);
  const level = levelInfo(db.player.xp);
  const active = goals.filter((g) => g.status === 'active');
  const done = goals.filter((g) => g.status === 'done');
  const earnedCount = Object.keys(db.achievements).length;

  function bump(goal: GoalProgress, delta: number) {
    const result = nudgeGoal(goal.id, delta);
    for (const title of result.completedGoals) {
      toast.push({ kind: 'level', title: 'Goal complete', detail: title });
    }
    if (result.levelUp) toast.levelUp(result.levelUp.level, result.levelUp.title);
  }

  return (
    <Page>
      <PageHeader title="Goals" subtitle="Call your shots, then go hit them." />

      <section className="card overflow-hidden">
        <div className="px-4 py-4">
          <div className="flex items-center gap-3.5">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl
                            bg-fg text-ink"
            >
              <span className="text-xl font-black nums">{level.level}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold tracking-tight">{level.title}</p>
              <p className="text-xs text-muted nums">{fmtNumber(level.xp)} total XP</p>
            </div>
          </div>

          <div className="mt-3.5">
            <Meter
              value={level.intoLevel}
              max={level.needed}
              tone="accent"
              height={9}
              label={`Progress to level ${level.level + 1}`}
            />
            <p className="mt-1.5 text-xs text-muted nums">
              {fmtNumber(level.needed - level.intoLevel)} XP to level {level.level + 1}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-line/60 border-t border-line/60">
          <div className="px-2 py-3 text-center">
            <p className="text-lg font-bold text-gold nums">{db.player.streakDays}</p>
            <p className="text-[11px] text-muted">Day streak</p>
          </div>
          <div className="px-2 py-3 text-center">
            <p className="text-lg font-bold nums">{db.player.longestStreak}</p>
            <p className="text-[11px] text-muted">Best streak</p>
          </div>
          <div className="px-2 py-3 text-center">
            <p className="text-lg font-bold nums">
              {earnedCount}
              <span className="text-sm font-normal text-faint">/{ACHIEVEMENTS.length}</span>
            </p>
            <p className="text-[11px] text-muted">Trophies</p>
          </div>
        </div>
      </section>

      <SectionTitle>Active</SectionTitle>

      {active.length === 0 ? (
        <EmptyState
          icon="target"
          title="No active goals"
          detail="A goal you see every morning is worth more than one you wrote down once. Set a number and a date."
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
                    onClick={() => {
                      deleteGoal(g.id);
                      toast.success('Goal removed');
                    }}
                    className="rounded-lg p-1.5 text-faint transition hover:bg-bad/10 hover:text-bad"
                    aria-label={`Delete goal ${g.title}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <Meter
                  value={g.current}
                  max={g.targetValue}
                  tone="money"
                  height={11}
                  label={g.title}
                />
              </div>

              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-lg font-bold text-gold nums">{format(g, g.current)}</span>
                <span className="text-xs text-muted nums">
                  of {format(g, g.targetValue)} · {g.pct.toFixed(0)}%
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

              {g.kind === 'custom' ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => bump(g, -1)}
                    className="btn-ghost h-9 min-h-0 flex-1 text-xs"
                  >
                    −1
                  </button>
                  <button
                    type="button"
                    onClick={() => bump(g, 1)}
                    className="btn-ghost h-9 min-h-0 flex-1 text-xs"
                  >
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
                  {format(g, g.targetValue)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionTitle>Trophy case</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {ACHIEVEMENTS.map((a) => {
          const at = db.achievements[a.code];
          const has = Boolean(at);
          return (
            <div
              key={a.code}
              className={`card p-3.5 ${has ? 'border-gold/40 bg-gold/5' : 'opacity-70'}`}
            >
              <span className={has ? 'text-gold' : 'text-faint'}>
                <Icon name={has ? 'trophy' : 'lock'} size={18} />
              </span>
              <p className={`mt-2 text-sm font-bold ${has ? 'text-gold' : 'text-muted'}`}>
                {a.name}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-faint">{a.detail}</p>
              {has ? <p className="mt-1.5 text-[11px] text-faint">{relativeTime(at)}</p> : null}
            </div>
          );
        })}
      </div>

      {db.xpEvents.length > 0 ? (
        <>
          <SectionTitle>Recent XP</SectionTitle>
          <ul className="card divide-y divide-line/60">
            {db.xpEvents.slice(0, 12).map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{e.reason}</span>
                  <span className="block text-xs text-faint">{relativeTime(e.createdAt)}</span>
                </span>
                <span
                  className={`shrink-0 text-sm font-bold nums ${e.amount >= 0 ? 'text-fg' : 'text-bad'}`}
                >
                  {e.amount >= 0 ? '+' : ''}
                  {e.amount}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Fab onClick={() => setOpen(true)} label="New goal" />
      <GoalSheet open={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

function format(goal: { kind: string; unit: string }, value: number): string {
  return goal.kind === 'revenue'
    ? fmtMoney(value, goal.unit || 'USD', { compact: true })
    : fmtNumber(value);
}

function GoalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    kind: 'revenue',
    target: '',
    period: 'all',
    deadline: '',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();

    const targetValue =
      form.kind === 'revenue'
        ? parseMoneyToCents(form.target)
        : Number(form.target.replace(/\D/g, ''));

    if (!targetValue || targetValue <= 0) {
      toast.error('Set a target above zero.');
      return;
    }

    const result = addGoal({
      title: form.title,
      kind: form.kind as 'revenue' | 'sales' | 'students' | 'custom',
      targetValue,
      period: form.period as 'all' | 'month' | 'quarter' | 'year',
      deadline: form.deadline ? new Date(`${form.deadline}T23:59:59Z`).getTime() : null,
    });

    // A goal can open already-met, since it measures the whole window.
    if (result.completedGoals.includes(form.title)) {
      toast.push({ kind: 'level', title: 'Already there', detail: `${form.title} is done` });
    } else {
      toast.success('Goal set', form.title);
    }

    setForm({ title: '', kind: 'revenue', target: '', period: 'all', deadline: '' });
    onClose();
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
                onClick={() =>
                  setForm({
                    title: p.title,
                    kind: p.kind,
                    target: p.kind === 'revenue' ? String(p.target / 100) : String(p.target),
                    period: p.period,
                    deadline: form.deadline,
                  })
                }
                className="btn-ghost h-10 min-h-0 text-xs"
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="g-title">
            Goal
          </label>
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
            <label className="label" htmlFor="g-kind">
              Measure
            </label>
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
            <label className="label" htmlFor="g-target">
              Target
            </label>
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
            <label className="label" htmlFor="g-period">
              Window
            </label>
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
            <label className="label" htmlFor="g-deadline">
              Deadline
            </label>
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
            Progress counts the whole window. A monthly goal includes what you&apos;ve{' '}
            <strong className="text-fg">already</strong> earned this month, so it can open part-way
            done.
          </span>
        </p>

        <button type="submit" className="btn-primary w-full">
          Lock it in
        </button>
      </form>
    </Sheet>
  );
}
