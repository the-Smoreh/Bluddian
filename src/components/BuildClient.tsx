'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Fab, Sheet } from '@/components/Sheet';
import { EmptyState } from '@/components/Shell';
import { Meter } from '@/components/charts/Meter';
import { useToast } from '@/components/Toast';
import { patch, post } from '@/lib/client';
import { fmtMoney, fmtNumber, parseMoneyToCents } from '@/lib/money';
import type { ProductWithStats } from '@/lib/queries';

const STATUSES = ['idea', 'building', 'live', 'paused', 'archived'] as const;
type Status = (typeof STATUSES)[number];

const STATUS_STYLE: Record<Status, string> = {
  idea: 'border-line text-faint',
  building: 'border-brand/40 text-brand',
  live: 'border-good/40 text-good',
  paused: 'border-warn/40 text-warn',
  archived: 'border-line text-faint',
};

type Filter = 'all' | 'product' | 'course';

export function BuildClient({ initial }: { initial: ProductWithStats[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProductWithStats | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const router = useRouter();

  const visible = useMemo(() => {
    return initial.filter((p) => {
      if (!showArchived && p.status === 'archived') return false;
      if (filter === 'course') return p.kind === 'course';
      if (filter === 'product') return p.kind !== 'course';
      return true;
    });
  }, [initial, filter, showArchived]);

  const courses = initial.filter((p) => p.kind === 'course');

  return (
    <>
      {/* Filters sit in one row above the content, per the dashboard pattern. */}
      <div className="mb-4 flex items-center gap-2">
        {(
          [
            ['all', 'All'],
            ['product', 'Products'],
            ['course', 'Courses'],
          ] as Array<[Filter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`btn h-9 min-h-0 flex-1 rounded-xl border text-xs ${
              filter === value
                ? 'border-brand/50 bg-brand/15 text-brand'
                : 'border-line bg-raised/50 text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filter === 'course' && courses.length > 0 ? <CourseSummary courses={courses} /> : null}

      {visible.length === 0 ? (
        <EmptyState
          icon="package"
          title={filter === 'course' ? 'No courses yet' : 'Nothing here yet'}
          detail="Add the thing you're building — even if it's just an idea. Moving it to Live is worth 400 XP."
          action={
            <button type="button" onClick={() => setOpen(true)} className="btn-primary">
              Add {filter === 'course' ? 'a course' : 'a product'}
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setEditing(p)}
                className="card w-full p-4 text-left transition active:scale-[.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`chip ${STATUS_STYLE[p.status as Status]}`}>{p.status}</span>
                      <span className="chip capitalize">{p.kind}</span>
                      {p.platform !== 'manual' ? (
                        <span className="chip capitalize">{p.platform}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-bold text-gold nums">
                      {fmtMoney(p.revenue_cents, p.currency, { compact: true })}
                    </p>
                    <p className="text-xs text-faint nums">{p.sales_count} sold</p>
                  </div>
                </div>

                {p.kind === 'course' && (p.lessons_total ?? 0) > 0 ? (
                  <div className="mt-3">
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-muted">
                        {p.lessons_done ?? 0} of {p.lessons_total} lessons
                      </span>
                      <span className="text-faint nums">{fmtNumber(p.students ?? 0)} students</span>
                    </div>
                    <Meter
                      value={p.lessons_done ?? 0}
                      max={p.lessons_total ?? 1}
                      tone="brand"
                      height={6}
                      label={`${p.name} lesson progress`}
                    />
                  </div>
                ) : null}

                {p.price_cents > 0 ? (
                  <p className="mt-2.5 text-xs text-faint">
                    Listed at{' '}
                    <span className="font-semibold text-muted nums">
                      {fmtMoney(p.price_cents, p.currency)}
                    </span>
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowArchived((v) => !v)}
        className="mt-5 w-full text-center text-xs font-semibold text-faint"
      >
        {showArchived ? 'Hide archived' : 'Show archived'}
      </button>

      <Fab onClick={() => setOpen(true)} label="Add product" />

      <ProductSheet
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
        defaultKind={filter === 'course' ? 'course' : 'product'}
      />

      {editing ? (
        <EditSheet
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function CourseSummary({ courses }: { courses: ProductWithStats[] }) {
  const students = courses.reduce((sum, c) => sum + (c.students ?? 0), 0);
  const lessons = courses.reduce((sum, c) => sum + (c.lessons_done ?? 0), 0);
  const revenue = courses.reduce((sum, c) => sum + c.revenue_cents, 0);

  return (
    <div className="card-pad mb-4 grid grid-cols-3 gap-2 text-center">
      <div>
        <p className="text-xl font-bold nums">{fmtNumber(students)}</p>
        <p className="text-xs text-muted">Students</p>
      </div>
      <div>
        <p className="text-xl font-bold nums">{fmtNumber(lessons)}</p>
        <p className="text-xs text-muted">Lessons live</p>
      </div>
      <div>
        <p className="text-xl font-bold text-gold nums">
          {fmtMoney(revenue, 'USD', { compact: true })}
        </p>
        <p className="text-xs text-muted">Earned</p>
      </div>
    </div>
  );
}

function ProductSheet({
  open,
  onClose,
  onSaved,
  defaultKind,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultKind: 'product' | 'course';
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    kind: defaultKind as string,
    status: 'idea',
    price: '',
    url: '',
    notes: '',
    lessonsTotal: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      await post('/api/products', {
        name: form.name,
        kind: form.kind,
        status: form.status,
        priceCents: parseMoneyToCents(form.price),
        url: form.url || null,
        notes: form.notes,
        ...(form.kind === 'course' && form.lessonsTotal
          ? { lessonsTotal: Number(form.lessonsTotal) }
          : {}),
      });
      toast.success('Added', form.name);
      setForm({ name: '', kind: defaultKind, status: 'idea', price: '', url: '', notes: '', lessonsTotal: '' });
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New product">
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div>
          <label className="label" htmlFor="p-name">Name</label>
          <input
            id="p-name"
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="The Whop course"
            required
            maxLength={120}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-kind">Type</label>
            <select
              id="p-kind"
              className="input"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="product">Product</option>
              <option value="course">Course</option>
              <option value="membership">Membership</option>
              <option value="bundle">Bundle</option>
              <option value="service">Service</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-status">Status</label>
            <select
              id="p-status"
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUSES.filter((s) => s !== 'archived').map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-price">Price</label>
            <input
              id="p-price"
              className="input nums"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="$0.00"
              inputMode="decimal"
            />
          </div>
          {form.kind === 'course' ? (
            <div>
              <label className="label" htmlFor="p-lessons">Lessons planned</label>
              <input
                id="p-lessons"
                className="input nums"
                value={form.lessonsTotal}
                onChange={(e) => setForm({ ...form, lessonsTotal: e.target.value.replace(/\D/g, '') })}
                placeholder="12"
                inputMode="numeric"
              />
            </div>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="p-url">Link</label>
          <input
            id="p-url"
            type="url"
            className="input"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://whop.com/..."
          />
        </div>

        <div>
          <label className="label" htmlFor="p-notes">Notes</label>
          <textarea
            id="p-notes"
            className="input min-h-[80px] resize-y"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="What's the offer? Who's it for?"
            maxLength={2000}
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Add it'}
        </button>
      </form>
    </Sheet>
  );
}

function EditSheet({
  product,
  onClose,
  onSaved,
}: {
  product: ProductWithStats;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [status, setStatus] = useState<string>(product.status);
  const [lessonsDone, setLessonsDone] = useState(String(product.lessons_done ?? 0));
  const [lessonsTotal, setLessonsTotal] = useState(String(product.lessons_total ?? 0));
  const [students, setStudents] = useState(String(product.students ?? 0));
  const [notes, setNotes] = useState(product.notes);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await patch<{ awarded: number }>(`/api/products/${product.id}`, {
        status,
        notes,
        ...(product.kind === 'course'
          ? {
              lessonsDone: Number(lessonsDone) || 0,
              lessonsTotal: Number(lessonsTotal) || 0,
              students: Number(students) || 0,
            }
          : {}),
      });

      if (res.awarded > 0) toast.xp(res.awarded, product.name);
      else toast.success('Updated');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={product.name}>
      <div className="space-y-4 pb-2">
        <div>
          <label className="label" htmlFor="e-status">Status</label>
          <select
            id="e-status"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {status === 'live' && product.status !== 'live' ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-good">
              <Icon name="zap" size={13} /> Shipping this is worth +400 XP
            </p>
          ) : null}
        </div>

        {product.kind === 'course' ? (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="e-done">Done</label>
              <input
                id="e-done"
                className="input nums"
                value={lessonsDone}
                onChange={(e) => setLessonsDone(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="label" htmlFor="e-total">Total</label>
              <input
                id="e-total"
                className="input nums"
                value={lessonsTotal}
                onChange={(e) => setLessonsTotal(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="label" htmlFor="e-students">Students</label>
              <input
                id="e-students"
                className="input nums"
                value={students}
                onChange={(e) => setStudents(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />
            </div>
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="e-notes">Notes</label>
          <textarea
            id="e-notes"
            className="input min-h-[90px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </div>

        <div className="rounded-xl border border-line bg-raised/40 p-3.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Revenue</span>
            <span className="font-bold text-gold nums">
              {fmtMoney(product.revenue_cents, product.currency)}
            </span>
          </div>
          <div className="mt-1.5 flex justify-between text-sm">
            <span className="text-muted">Units sold</span>
            <span className="font-semibold nums">{product.sales_count}</span>
          </div>
        </div>

        {product.url ? (
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost w-full"
          >
            <Icon name="link" size={16} /> Open listing
          </a>
        ) : null}

        <button type="button" onClick={save} className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Sheet>
  );
}
