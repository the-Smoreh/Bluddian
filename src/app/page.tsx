'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Page, SectionTitle } from '@/components/Shell';
import { StatTile } from '@/components/StatTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { StackedBar } from '@/components/charts/StackedBar';
import { Meter } from '@/components/charts/Meter';
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
      {/*
        Hierarchy rewrite. Previously the rank was an h1 and the money sat in a
        card below it, so the first thing you read every morning was a game
        label. The money is the point of the app, so the money is the headline
        and the game sits underneath it as a quiet strip.
      */}
      <header className="mb-5 flex items-center justify-between gap-3">
        <p className="truncate text-[0.9375rem] text-muted">
          {greeting()}, <span className="text-fg">{db.settings.displayName}</span>
        </p>
        <Link
          href="/settings"
          className="-mr-1.5 shrink-0 p-1.5 text-faint transition-colors hover:text-fg"
          aria-label="Settings"
        >
          <Icon name="settings" size={19} />
        </Link>
      </header>

      {/* The hero sits directly on the page, not in a card. Giving the most
          important number its own container would visually rank it equal to
          everything else that has one. */}
      <section>
        <p className="metric-label">Net revenue · this month</p>
        <p className="display mt-1.5 text-gold">{fmtMoney(rev.month)}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem]">
          {rev.monthDelta !== null ? (
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                rev.monthDelta >= 0 ? 'text-good' : 'text-bad'
              }`}
            >
              <Icon name={rev.monthDelta >= 0 ? 'trendUp' : 'trendDown'} size={13} />
              <span className="nums">
                {rev.monthDelta >= 0 ? '+' : ''}
                {rev.monthDelta.toFixed(0)}%
              </span>
            </span>
          ) : null}
          <span className="text-faint nums">
            {rev.salesMonth} {rev.salesMonth === 1 ? 'sale' : 'sales'}
          </span>
        </div>

        <div className="mt-5">
          <TrendChart data={days} tone="money" />
        </div>
      </section>

      {/* Level, XP and streak compressed into one quiet strip. Three separate
          blocks of chrome for the game layer was drowning the numbers. */}
      <div className="mt-6 flex items-center gap-3 border-y border-line py-3">
        <span
          className={db.player.streakDays > 0 ? 'shrink-0 text-gold' : 'shrink-0 text-faint'}
          title={`${db.player.streakDays}-day streak`}
        >
          <Icon name="flame" size={16} filled={db.player.streakDays > 0} />
        </span>
        <span className="shrink-0 text-[0.8125rem] text-muted nums">{db.player.streakDays}d</span>

        <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <Meter
            value={level.intoLevel}
            max={level.needed}
            tone="accent"
            height={4}
            label={`${level.intoLevel} of ${level.needed} XP to level ${level.level + 1}`}
          />
        </div>

        <span className="shrink-0 text-[0.8125rem] text-muted">
          Lv {level.level}
          <span className="ml-1 text-faint">{level.title}</span>
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <StatTile
          label="All time"
          value={fmtMoney(rev.allTime, 'USD', { compact: true })}
          sub={`${fmtNumber(rev.salesTotal)} sales`}
          icon="coin"
        />
        <StatTile
          label="Today"
          value={fmtMoney(rev.today)}
          sub={
            rev.week > 0
              ? `${fmtMoney(rev.week, 'USD', { compact: true })} this week`
              : 'Nothing yet'
          }
          icon="zap"
        />
        <StatTile
          label="Avg order"
          value={rev.aovCents > 0 ? fmtMoney(rev.aovCents) : '—'}
          sub={
            rev.mrrCents > 0
              ? `${fmtMoney(rev.mrrCents, 'USD', { compact: true })} recurring`
              : 'One-off sales'
          }
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
            action={
              <Link href="/goals" className="text-xs font-semibold text-fg">
                All goals
              </Link>
            }
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
            action={
              <Link href="/money" className="text-xs font-semibold text-fg">
                See all
              </Link>
            }
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
        action={
          <Link href="/build" className="text-xs font-semibold text-fg">
            Manage
          </Link>
        }
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
                  has
                    ? 'border-gold/50 bg-gold/10 text-gold'
                    : 'border-line bg-raised/40 text-faint'
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
        <div className="card mt-6 border-line-strong bg-raised/40 p-4">
          <div className="flex items-start gap-3">
            <span className="text-fg">
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
