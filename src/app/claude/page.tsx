'use client';

import { useState } from 'react';
import { Page, PageHeader, SectionTitle } from '@/components/Shell';
import { StatTile } from '@/components/StatTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { Meter } from '@/components/charts/Meter';
import { Sheet } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useDb } from '@/lib/local/useStore';
import { addUsage, deleteUsage } from '@/lib/local/actions';
import { claudeSummary, revenueSummary } from '@/lib/local/selectors';
import { fmtCompact, fmtMoney, parseMoneyToCents, fmtDayShort } from '@/lib/money';

export default function ClaudePage() {
  const db = useDb();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const claude = claudeSummary(db, 30);
  const rev = revenueSummary(db);

  // Cost as a share of revenue is one ratio, so it's a stat + meter, not a chart.
  const ratio = rev.month > 0 ? (claude.costMonthCents / rev.month) * 100 : null;
  const maxModelCost = Math.max(...claude.byModel.map((m) => m.cost), 1);

  const [form, setForm] = useState({
    day: new Date().toISOString().slice(0, 10),
    model: '',
    cost: '',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();

    const costCents = parseMoneyToCents(form.cost);
    if (costCents <= 0) {
      toast.error('Enter an amount above zero.');
      return;
    }

    addUsage({ day: form.day, model: form.model || 'Claude', costCents });
    toast.success('Logged', fmtMoney(costCents));
    setForm({ ...form, cost: '', model: '' });
    setOpen(false);
  }

  const recent = [...db.usage].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 10);

  return (
    <Page>
      <PageHeader title="Claude" subtitle="What the AI is costing you, and what it's building." />

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="This month"
          value={fmtMoney(claude.costMonthCents)}
          sub="API spend"
          icon="spark"
          tone="cost"
          spark={claude.byDay.slice(-14).map((d) => d.value)}
        />
        <StatTile
          label="Today"
          value={fmtMoney(claude.costTodayCents)}
          sub={claude.topModel ?? 'No usage yet'}
          icon="zap"
          tone="cost"
        />
        <StatTile
          label="Tokens"
          value={claude.tokensMonth > 0 ? fmtCompact(claude.tokensMonth) : '—'}
          sub="This month"
          icon="grid"
        />
        <StatTile
          label="All time"
          value={fmtMoney(claude.costAllCents, 'USD', { compact: true })}
          sub="Total spend"
          icon="coin"
          tone="cost"
        />
      </div>

      {ratio !== null ? (
        <div className="card-pad mt-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Claude cost vs revenue
            </p>
            <span
              className={`text-sm font-bold nums ${
                ratio < 20 ? 'text-good' : ratio < 50 ? 'text-warn' : 'text-bad'
              }`}
            >
              {ratio.toFixed(0)}%
            </span>
          </div>
          <div className="mt-2.5">
            <Meter
              value={Math.min(claude.costMonthCents, rev.month)}
              max={Math.max(rev.month, 1)}
              tone={ratio < 20 ? 'good' : 'cost'}
              height={10}
              label="Claude spend as a share of revenue"
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            {fmtMoney(claude.costMonthCents)} spent against {fmtMoney(rev.month)} earned this month.
          </p>
        </div>
      ) : null}

      <SectionTitle>Daily spend · 30 days</SectionTitle>
      <div className="card-pad">
        <TrendChart data={claude.byDay} tone="cost" />
      </div>

      {claude.cacheSavingsPct > 0 ? (
        <div className="card-pad mt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Prompt cache hit rate
            </p>
            <span className="text-sm font-bold text-good nums">
              {claude.cacheSavingsPct.toFixed(0)}%
            </span>
          </div>
          <div className="mt-2.5">
            <Meter
              value={claude.cacheSavingsPct}
              max={100}
              tone="good"
              height={8}
              label="Cache hit rate"
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            Cached input tokens bill at a fraction of the normal rate — a higher number here is
            money you didn&apos;t spend.
          </p>
        </div>
      ) : null}

      {claude.byModel.length > 0 ? (
        <>
          <SectionTitle>By model</SectionTitle>
          <ul className="card divide-y divide-line/60">
            {claude.byModel.map((m) => (
              <li key={m.model} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                    {m.model}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-fg nums">
                    {fmtMoney(m.cost)}
                  </span>
                </div>
                <div className="mt-2">
                  <Meter value={m.cost} max={maxModelCost} tone="cost" height={5} label={m.model} />
                </div>
                {m.tokens > 0 ? (
                  <p className="mt-1.5 text-xs text-faint nums">{fmtCompact(m.tokens)} tokens</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {recent.length > 0 ? (
        <>
          <SectionTitle>Recent entries</SectionTitle>
          <ul className="card divide-y divide-line/60">
            {recent.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{u.model}</span>
                  <span className="block text-xs text-faint">{fmtDayShort(u.day)}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-fg nums">
                  {fmtMoney(u.costCents)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    deleteUsage(u.id);
                    toast.success('Removed');
                  }}
                  className="shrink-0 rounded-lg p-1.5 text-faint transition hover:bg-bad/10 hover:text-bad"
                  aria-label={`Delete ${u.model} on ${u.day}`}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="card mt-4 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-faint">
            <Icon name="shield" size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Why this is entered by hand</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Anthropic&apos;s usage API needs an organisation admin key and can&apos;t be called
              from a phone browser. Checking your spend once a week and typing it in takes ten
              seconds, and keeps this app free of any credential worth stealing.
            </p>
          </div>
        </div>
      </div>

      <button type="button" onClick={() => setOpen(true)} className="btn-primary mt-3 w-full">
        <Icon name="plus" size={16} />
        Log spend
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Log Claude spend">
        <form onSubmit={submit} className="space-y-4 pb-2">
          <div>
            <label className="label" htmlFor="c-cost">
              Amount spent
            </label>
            <input
              id="c-cost"
              className="input text-2xl font-bold nums"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              placeholder="$0.00"
              inputMode="decimal"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="c-day">
                Date
              </label>
              <input
                id="c-day"
                type="date"
                className="input nums"
                value={form.day}
                onChange={(e) => setForm({ ...form, day: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="c-model">
                Label
              </label>
              <input
                id="c-model"
                className="input"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="Claude Code"
                maxLength={80}
              />
            </div>
          </div>

          <p className="text-xs text-faint">
            Logging the same date and label again replaces that entry rather than adding to it.
          </p>

          <button type="submit" className="btn-primary w-full">
            Log it
          </button>
        </form>
      </Sheet>
    </Page>
  );
}
