'use client';

import { useState } from 'react';
import { Page, PageHeader, SectionTitle, EmptyState } from '@/components/Shell';
import { StatTile } from '@/components/StatTile';
import { BarChart } from '@/components/charts/BarChart';
import { StackedBar } from '@/components/charts/StackedBar';
import { Fab, Sheet } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { ImportSheet } from '@/components/ImportSheet';
import { useDb } from '@/lib/local/useStore';
import { addSale, deleteSale } from '@/lib/local/actions';
import { productsWithStats, revenueByDay, revenueByPlatform, revenueSummary } from '@/lib/local/selectors';
import { fmtMoney, fmtNumber, parseMoneyToCents, relativeTime } from '@/lib/money';

export default function MoneyPage() {
  const db = useDb();
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [limit, setLimit] = useState(50);

  const rev = revenueSummary(db);
  const days = revenueByDay(db, 30);
  const platforms = revenueByPlatform(db);
  const products = productsWithStats(db);
  const sales = [...db.sales].sort((a, b) => b.occurredAt - a.occurredAt);

  const [form, setForm] = useState({
    productName: '',
    productId: '',
    amount: '',
    fees: '',
    platform: 'manual' as 'manual' | 'whop' | 'shopify',
    isRecurring: false,
    date: new Date().toISOString().slice(0, 10),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();

    const grossCents = parseMoneyToCents(form.amount);
    if (grossCents <= 0) {
      toast.error('Enter an amount above zero.');
      return;
    }

    const chosen = products.find((p) => p.id === form.productId);
    const result = addSale({
      productId: form.productId || null,
      productName: form.productName || chosen?.name || 'Sale',
      grossCents,
      feesCents: parseMoneyToCents(form.fees),
      platform: form.platform,
      isRecurring: form.isRecurring,
      // Noon UTC keeps the day bucket unambiguous regardless of timezone.
      occurredAt: new Date(`${form.date}T12:00:00Z`).getTime(),
    });

    toast.xp(result.awardedXp, 'Sale logged');
    if (result.levelUp) toast.levelUp(result.levelUp.level, result.levelUp.title);
    for (const title of result.completedGoals) {
      toast.push({ kind: 'level', title: 'Goal complete', detail: title });
    }

    setAddOpen(false);
    setForm({ ...form, productName: '', productId: '', amount: '', fees: '' });
  }

  return (
    <Page>
      <PageHeader
        title="Money"
        subtitle="Every dollar in, across every platform."
        action={
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="btn-ghost h-10 min-h-0 shrink-0 px-3 text-xs"
          >
            <Icon name="package" size={15} />
            Import
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="This month"
          value={fmtMoney(rev.month, 'USD', { compact: true })}
          delta={rev.monthDelta}
          icon="coin"
          tone="money"
        />
        <StatTile
          label="All time"
          value={fmtMoney(rev.allTime, 'USD', { compact: true })}
          sub={`${fmtNumber(rev.salesTotal)} sales`}
          icon="trendUp"
          tone="money"
        />
        <StatTile
          label="Fees paid"
          value={fmtMoney(rev.feesCents, 'USD', { compact: true })}
          sub="Platform cut"
          icon="cart"
        />
        <StatTile
          label="Refunded"
          value={fmtMoney(rev.refundedCents, 'USD', { compact: true })}
          sub={rev.refundedCents > 0 ? 'Deducted from net' : 'None'}
          icon="refresh"
        />
      </div>

      <SectionTitle>Daily net revenue · 30 days</SectionTitle>
      <div className="card-pad">
        <BarChart data={days} tone="money" />
      </div>

      {platforms.length > 0 ? (
        <>
          <SectionTitle>By platform</SectionTitle>
          <div className="card-pad">
            <StackedBar data={platforms} />
          </div>
        </>
      ) : null}

      <SectionTitle>All sales</SectionTitle>

      {sales.length === 0 ? (
        <EmptyState
          icon="coin"
          title="No sales yet"
          detail="Import a Whop or Shopify order export, or log your first sale by hand."
          action={
            <div className="flex w-full gap-2">
              <button type="button" onClick={() => setImportOpen(true)} className="btn-ghost flex-1">
                Import CSV
              </button>
              <button type="button" onClick={() => setAddOpen(true)} className="btn-primary flex-1">
                Log a sale
              </button>
            </div>
          }
        />
      ) : (
        <>
          <ul className="card divide-y divide-line/60">
            {sales.slice(0, limit).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.productName}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
                    <span className="capitalize">{s.platform}</span>
                    <span>·</span>
                    <span>{relativeTime(s.occurredAt)}</span>
                    {s.isRecurring ? (
                      <>
                        <span>·</span>
                        <span className="text-brand">recurring</span>
                      </>
                    ) : null}
                    {s.feesCents > 0 ? (
                      <>
                        <span>·</span>
                        <span>−{fmtMoney(s.feesCents, s.currency)} fees</span>
                      </>
                    ) : null}
                  </p>
                </div>

                <span
                  className={`shrink-0 text-sm font-bold nums ${
                    s.status === 'refunded' ? 'text-bad line-through' : 'text-gold'
                  }`}
                >
                  {fmtMoney(s.netCents, s.currency)}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    deleteSale(s.id);
                    toast.success('Sale deleted');
                  }}
                  className="shrink-0 rounded-lg p-1.5 text-faint transition hover:bg-bad/10 hover:text-bad"
                  aria-label={`Delete sale ${s.productName}`}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>

          {sales.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit((l) => l + 100)}
              className="btn-ghost mt-3 w-full"
            >
              Show more ({fmtNumber(sales.length - limit)} left)
            </button>
          ) : null}
        </>
      )}

      <Fab onClick={() => setAddOpen(true)} label="Log a sale" />

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Log a sale">
        <form onSubmit={submit} className="space-y-4 pb-2">
          <div>
            <label className="label" htmlFor="amount">Amount received</label>
            <input
              id="amount"
              className="input text-2xl font-bold nums"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="$0.00"
              inputMode="decimal"
              required
            />
          </div>

          {products.length > 0 ? (
            <div>
              <label className="label" htmlFor="product">Product</label>
              <select
                id="product"
                className="input"
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
              >
                <option value="">— Not linked —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="productName">
              Label {form.productId ? '(optional)' : ''}
            </label>
            <input
              id="productName"
              className="input"
              value={form.productName}
              onChange={(e) => setForm({ ...form, productName: e.target.value })}
              placeholder="What did they buy?"
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="fees">Fees</label>
              <input
                id="fees"
                className="input nums"
                value={form.fees}
                onChange={(e) => setForm({ ...form, fees: e.target.value })}
                placeholder="$0.00"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="label" htmlFor="date">Date</label>
              <input
                id="date"
                type="date"
                className="input nums"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="platform">Platform</label>
            <select
              id="platform"
              className="input"
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value as typeof form.platform })}
            >
              <option value="manual">Manual / other</option>
              <option value="whop">Whop</option>
              <option value="shopify">Shopify</option>
            </select>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-line bg-raised/50 px-3.5 py-3">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[rgb(var(--c-brand))]"
              checked={form.isRecurring}
              onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
            />
            <span className="text-sm">Recurring subscription payment</span>
          </label>

          <button type="submit" className="btn-primary w-full">
            Log it
          </button>
        </form>
      </Sheet>

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
    </Page>
  );
}
