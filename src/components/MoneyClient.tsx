'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Fab, Sheet } from '@/components/Sheet';
import { SectionTitle, EmptyState } from '@/components/Shell';
import { useToast } from '@/components/Toast';
import { del, post } from '@/lib/client';
import { fmtMoney, parseMoneyToCents, relativeTime } from '@/lib/money';
import type { ProductWithStats, Sale } from '@/lib/queries';

/**
 * Sales list plus manual entry. Manual entry matters more than it looks: not
 * every sale comes through a connected platform (cash, Stripe links, invoices),
 * and a dashboard that can only see APIs would under-report your actual income.
 */
export function MoneyClient({
  initialSales,
  products,
}: {
  initialSales: Sale[];
  products: ProductWithStats[];
}) {
  const [sales, setSales] = useState(initialSales);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const [form, setForm] = useState({
    productName: '',
    productId: '',
    amount: '',
    fees: '',
    platform: 'manual' as 'manual' | 'whop' | 'shopify',
    isRecurring: false,
    date: new Date().toISOString().slice(0, 10),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const grossCents = parseMoneyToCents(form.amount);
    if (grossCents <= 0) {
      toast.error('Enter an amount above zero.');
      return;
    }

    setBusy(true);
    try {
      const chosen = products.find((p) => p.id === form.productId);
      const res = await post<{
        awarded: number;
        completedGoals: { title: string }[];
        unlocked: string[];
      }>('/api/sales', {
        productId: form.productId || null,
        productName: form.productName || chosen?.name || 'Sale',
        grossCents,
        feesCents: parseMoneyToCents(form.fees),
        platform: form.platform,
        isRecurring: form.isRecurring,
        // Log at noon UTC so the day bucket is unambiguous regardless of tz.
        occurredAt: new Date(`${form.date}T12:00:00Z`).getTime(),
      });

      toast.xp(res.awarded, 'Sale logged');
      for (const g of res.completedGoals ?? []) {
        toast.push({ kind: 'level', title: 'Goal complete', detail: g.title });
      }

      setOpen(false);
      setForm((f) => ({ ...f, productName: '', productId: '', amount: '', fees: '' }));
      router.refresh();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await del('/api/sales', { id });
      setSales((prev) => prev.filter((s) => s.id !== id));
      toast.success('Sale deleted');
      router.refresh();
    } catch (err) {
      toast.error('Could not delete', err instanceof Error ? err.message : undefined);
    }
  }

  return (
    <>
      <SectionTitle>All sales</SectionTitle>

      {sales.length === 0 ? (
        <EmptyState
          icon="coin"
          title="No sales yet"
          detail="Log your first sale by hand, or connect Whop and Shopify in settings to pull them automatically."
          action={
            <button type="button" onClick={() => setOpen(true)} className="btn-primary">
              Log a sale
            </button>
          }
        />
      ) : (
        <ul className="card divide-y divide-line/60">
          {sales.map((s) => (
            <li key={s.id} className="group flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.product_name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
                  <span className="capitalize">{s.platform}</span>
                  <span>·</span>
                  <span>{relativeTime(s.occurred_at)}</span>
                  {s.is_recurring ? (
                    <>
                      <span>·</span>
                      <span className="text-brand">recurring</span>
                    </>
                  ) : null}
                  {s.fees_cents > 0 ? (
                    <>
                      <span>·</span>
                      <span>−{fmtMoney(s.fees_cents, s.currency)} fees</span>
                    </>
                  ) : null}
                </p>
              </div>

              <span
                className={`shrink-0 text-sm font-bold nums ${
                  s.status === 'refunded' ? 'text-bad line-through' : 'text-gold'
                }`}
              >
                {fmtMoney(s.net_cents, s.currency)}
              </span>

              {/* Only manual rows are deletable — deleting a synced row would
                  just reappear on the next sync and confuse the count. */}
              {s.platform === 'manual' ? (
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="shrink-0 rounded-lg p-1.5 text-faint transition hover:bg-bad/10 hover:text-bad"
                  aria-label={`Delete sale ${s.product_name}`}
                >
                  <Icon name="trash" size={15} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Fab onClick={() => setOpen(true)} label="Log a sale" />

      <Sheet open={open} onClose={() => setOpen(false)} title="Log a sale">
        <form onSubmit={submit} className="space-y-4 pb-2">
          <div>
            <label className="label" htmlFor="amount">
              Amount received
            </label>
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
              <label className="label" htmlFor="product">
                Product
              </label>
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
              <label className="label" htmlFor="fees">
                Fees
              </label>
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
              <label className="label" htmlFor="date">
                Date
              </label>
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
            <label className="label" htmlFor="platform">
              Platform
            </label>
            <select
              id="platform"
              className="input"
              value={form.platform}
              onChange={(e) =>
                setForm({ ...form, platform: e.target.value as typeof form.platform })
              }
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

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Log it'}
          </button>
        </form>
      </Sheet>
    </>
  );
}
