'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Page, SectionTitle } from '@/components/Shell';
import { StatTile } from '@/components/StatTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { StackedBar } from '@/components/charts/StackedBar';
import { Meter, SegmentMeter } from '@/components/charts/Meter';
import { Icon } from '@/components/Icon';
import { QuestList } from '@/components/QuestList';
import { useDb } from '@/lib/local/useStore';
import { ACHIEVEMENTS, ensureQuests, levelInfo } from '@/lib/local/actions';
import { fmtMoney, fmtNumber, relativeTime } from '@/lib/money';
import {
  claudeSummary,
  goalsWithProgress,
  productStatusCounts,
  profitSummary,
  recentSales,
  revenueByDay,
  revenueByPlatform,
  revenueSummary,
} from '@/lib/local/selectors';

export default function Dashboard() {
  const db = useDb();

  // Quests roll over by date, so this has to happen on mount rather than at
  // build time — a statically exported page has no idea what day it is.
  const [questsReady, setQuestsReady] = useState(false);
  useEffect(() => {
    ensureQuests();
    setQuestsReady(true);
  }, []);

  const rev = revenueSummary(db);
  const profit = profitSummary(db);
  const claude = claudeSummary(db, 30);
  const days = revenueByDay(db, 30);
  const platforms = revenueByPlatform(db);
  const goals = goalsWithProgress(db);
  const level = levelInfo(db.player.xp);
  const counts = productStatusCounts(db);
  const sales = recentSales(db, 5);

  const primaryGoal = goals.find((g) => g.status === 'active') ?? null;
  const quests = questsReady ? db.quests : [];
  const hasData = rev.salesTotal > 0 || claude.costAllCents > 0;
  const earnedCount = Object.keys(db.achievements).length;

  return (
    <Page>
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">
              {greeting()}, {db.settings.displayName}
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight">
              Level {level.level} · {level.title}
            </h1>
          </div>
          <Link
            href="/settings"
            className="shrink-0 rounded-full border border-line bg-raised/60 p-2.5 text-muted transition active:scale-95"
            aria-label="Settings"
          >
            <Icon name="settings" size={19} />
          </Link>
        </div>

        <div className="mt-3.5">
          <Meter
            value={level.intoLevel}
            max={level.needed}
            tone="brand"
            height={8}
            label={`${level.intoLevel} of ${level.needed} XP to level ${level.level + 1}`}
          />
          <div className="mt-1.5 flex justify-between text-xs">
            <span className="text-muted nums">
              {fmtNumber(level.intoLevel)} / {fmtNumber(level.needed)} XP
            </span>
            <span className="text-faint">Level {level.level + 1} next</span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl2 border border-line/80 bg-surface/70 px-3.5 py-3">
          <span className={db.player.streakDays > 0 ? 'text-gold' : 'text-faint'}>
            <Icon name="flame" size={20} filled={db.player.streakDays > 0} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold">
                {db.player.streakDays > 0 ? `${db.player.streakDays}-day streak` : 'No streak yet'}
              </p>
              <p className="text-xs text-faint">Best {db.player.longestStreak}</p>
            </div>
            <div className="mt-2">
              <SegmentMeter
                filled={Math.min(db.player.streakDays % 7 || (db.player.streakDays ? 7 : 0), 7)}
                total={7}
              />
            </div>
          </div>
        </div>
      </header>

      <section className="card-pad">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          Net revenue · this month
        </p>
        <p className="mt-1 text-[2.75rem] font-bold leading-none tracking-tight text-gold nums">
          {fmtMoney(rev.month)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {rev.monthDelta !== null ? (
            <span
              className={`inline-flex items-center gap-1 font-semibold ${
                rev.monthDelta >= 0 ? 'text-good' : 'text-bad'
              }`}
            >
              <Icon name={rev.monthDelta >= 0 ? 'trendUp' : 'trendDown'} size={13} />
              <span className="nums">
                {rev.monthDelta >= 0 ? '+' : ''}
                {rev.monthDelta.toFixed(0)}%
              </span>
              <span className="font-normal text-faint">vs last month</span>
            </span>
          ) : (
            <span className="text-faint">No prior month to compare</span>
          )}
          <span className="text-faint nums">{rev.salesMonth} sales</span>
        </div>

        <div className="mt-4">
          <TrendChart data={days} tone="money" />
        </div>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatTile
          label="All time"
          value={fmtMoney(rev.allTime, 'USD', { compact: true })}
          sub={`${fmtNumber(rev.salesTotal)} sales`}
          icon="coin"
          tone="money"
        />
        <StatTile
          label="Today"
          value={fmtMoney(rev.today)}
          sub={rev.week > 0 ? `${fmtMoney(rev.week, 'USD', { compact: true })} this week` : 'Nothing yet'}
          icon="zap"
          tone="money"
        />
        <StatTile
          label="Avg order"
          value={rev.aovCents > 0 ? fmtMoney(rev.aovCents) : '—'}
          sub={rev.mrrCents > 0 ? `${fmtMoney(rev.mrrCents, 'USD', { compact: true })} recurring` : 'One-off sales'}
          icon="cart"
        />
        <StatTile
          label="Claude spend"
          value={fmtMoney(claude.costMonthCents, 'USD', { compact: true })}
          sub="This month"
          icon="spark"
          tone="cost"
        />
      </div>

      {claude.costMonthCents > 0 ? (
        <div className="card-pad mt-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Month after Claude costs
            </p>
            {profit.marginPct !== null ? (
              <span className="text-xs text-faint nums">{profit.marginPct.toFixed(0)}% margin</span>
            ) : null}
          </div>
          <p
            className={`mt-1 text-2xl font-bold tracking-tight nums ${
              profit.netMonth >= 0 ? 'text-good' : 'text-bad'
            }`}
          >
            {fmtMoney(profit.netMonth)}
          </p>
        </div>
      ) : null}

      {primaryGoal ? (
        <>
          <SectionTitle
            action={<Link href="/goals" className="text-xs font-semibold text-brand">All goals</Link>}
          >
            Active goal
          </SectionTitle>
          <Link href="/goals" className="card-pad block active:scale-[.99]">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">{primaryGoal.title}</p>
              {primaryGoal.daysLeft !== null ? (
                <span
                  className={`chip shrink-0 ${
                    primaryGoal.daysLeft < 0
                      ? 'border-bad/40 text-bad'
                      : primaryGoal.onTrack
                        ? 'border-good/40 text-good'
                        : 'border-warn/40 text-warn'
                  }`}
                >
                  <Icon name="clock" size={12} />
                  {primaryGoal.daysLeft < 0 ? 'Overdue' : `${primaryGoal.daysLeft}d left`}
                </span>
              ) : null}
            </div>

            <div className="mt-3">
              <Meter
                value={primaryGoal.current}
                max={primaryGoal.targetValue}
                tone="money"
                height={12}
                label={primaryGoal.title}
              />
            </div>

            <div className="mt-2 flex items-baseline justify-between text-sm">
              <span className="font-bold text-gold nums">
                {primaryGoal.kind === 'revenue'
                  ? fmtMoney(primaryGoal.current)
                  : fmtNumber(primaryGoal.current)}
              </span>
              <span className="text-xs text-muted nums">
                of{' '}
                {primaryGoal.kind === 'revenue'
                  ? fmtMoney(primaryGoal.targetValue)
                  : fmtNumber(primaryGoal.targetValue)}{' '}
                · {primaryGoal.pct.toFixed(0)}%
              </span>
            </div>

            {primaryGoal.paceNeededPerDay && primaryGoal.remaining > 0 ? (
              <p className="mt-2 text-xs text-faint">
                Need{' '}
                <span className="font-semibold text-muted nums">
                  {primaryGoal.kind === 'revenue'
                    ? fmtMoney(Math.ceil(primaryGoal.paceNeededPerDay))
                    : Math.ceil(primaryGoal.paceNeededPerDay)}
                </span>{' '}
                per day to hit it.
              </p>
            ) : null}
          </Link>
        </>
      ) : null}

      <SectionTitle>Today&apos;s quests</SectionTitle>
      {quests.length > 0 ? (
        <QuestList quests={quests} />
      ) : (
        <div className="card h-32 animate-pulse bg-surface/50" />
      )}

      {platforms.length > 0 ? (
        <>
          <SectionTitle>Revenue by platform</SectionTitle>
          <div className="card-pad">
            <StackedBar data={platforms} />
          </div>
        </>
      ) : null}

      {sales.length > 0 ? (
        <>
          <SectionTitle
            action={<Link href="/money" className="text-xs font-semibold text-brand">See all</Link>}
          >
            Latest sales
          </SectionTitle>
          <ul className="card divide-y divide-line/70">
            {sales.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.productName}</span>
                  <span className="block text-xs text-faint">
                    {s.platform} · {relativeTime(s.occurredAt)}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-sm font-bold nums ${
                    s.status === 'refunded' ? 'text-bad line-through' : 'text-gold'
                  }`}
                >
                  {fmtMoney(s.netCents, s.currency, { compact: true })}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionTitle
        action={<Link href="/build" className="text-xs font-semibold text-brand">Manage</Link>}
      >
        Pipeline
      </SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {(['idea', 'building', 'live'] as const).map((status) => (
          <Link key={status} href="/build" className="card-pad text-center active:scale-[.98]">
            <p className="text-2xl font-bold nums">{counts[status] ?? 0}</p>
            <p className="mt-0.5 text-xs capitalize text-muted">{status}</p>
          </Link>
        ))}
      </div>

      <SectionTitle>Achievements</SectionTitle>
      <div className="card-pad">
        <div className="flex flex-wrap gap-2">
          {ACHIEVEMENTS.slice(0, 10).map((a) => {
            const has = Boolean(db.achievements[a.code]);
            return (
              <span
                key={a.code}
                title={`${a.name} — ${a.detail}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium ${
                  has ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-raised/40 text-faint'
                }`}
              >
                <Icon name={has ? 'trophy' : 'lock'} size={12} />
                {a.name}
              </span>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-faint">
          {earnedCount} of {ACHIEVEMENTS.length} unlocked
        </p>
      </div>

      {!hasData ? (
        <div className="card mt-6 border-brand/30 bg-brand/5 p-4">
          <div className="flex items-start gap-3">
            <span className="text-brand">
              <Icon name="link" size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Get your numbers in</p>
              <p className="mt-1 text-sm text-muted">
                Import a Whop or Shopify order export, or just log sales by hand. Everything stays
                on this phone.
              </p>
              <Link href="/money" className="btn-primary mt-3 w-full">
                Add revenue
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}
