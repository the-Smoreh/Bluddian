'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { post } from '@/lib/client';
import { parseMoneyToCents } from '@/lib/money';

/**
 * Sync + manual entry for Claude spend.
 *
 * Manual entry exists because the Anthropic usage/cost API needs an *Admin*
 * key, which only an organisation owner can create. Plenty of people paying for
 * Claude can't mint one, and they still deserve the number tracked.
 */
export function ClaudeClient({ connected }: { connected: boolean }) {
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const [form, setForm] = useState({
    day: new Date().toISOString().slice(0, 10),
    model: '',
    cost: '',
  });

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await post<{ ok: boolean; message: string }>('/api/sync/anthropic', {
        action: 'sync',
        days: 30,
      });
      toast.success('Synced', res.message);
      router.refresh();
    } catch (err) {
      toast.error('Sync failed', err instanceof Error ? err.message : undefined);
    } finally {
      setSyncing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const costCents = parseMoneyToCents(form.cost);
    if (costCents <= 0) {
      toast.error('Enter an amount above zero.');
      return;
    }

    setBusy(true);
    try {
      await post('/api/claude', {
        day: form.day,
        model: form.model || 'manual entry',
        costCents,
      });
      toast.success('Logged');
      setForm({ ...form, cost: '', model: '' });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={sync}
          disabled={!connected || syncing}
          className="btn-ghost"
          title={connected ? 'Pull the last 30 days' : 'Connect an admin API key first'}
        >
          <Icon name="refresh" size={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
          <Icon name="plus" size={16} />
          Log spend
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Log Claude spend">
        <form onSubmit={submit} className="space-y-4 pb-2">
          <div>
            <label className="label" htmlFor="c-cost">Amount spent</label>
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
              <label className="label" htmlFor="c-day">Date</label>
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
              <label className="label" htmlFor="c-model">Label</label>
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

          <p className="flex items-start gap-2 rounded-xl border border-line bg-raised/40 px-3 py-2.5 text-xs text-muted">
            <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
            <span>
              Manual entries are kept separate from synced data, so running a sync later
              won&apos;t overwrite what you typed.
            </span>
          </p>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Log it'}
          </button>
        </form>
      </Sheet>
    </>
  );
}
