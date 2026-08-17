import { requireAuth } from '@/lib/auth';
import { earnedAchievements, getPlayer, levelInfo, ACHIEVEMENTS } from '@/lib/game';
import { db } from '@/lib/db';
import { fmtNumber, relativeTime } from '@/lib/money';
import { listGoals } from '@/lib/queries';
import { BottomNav, Page, PageHeader, SectionTitle } from '@/components/Shell';
import { Meter } from '@/components/charts/Meter';
import { Icon } from '@/components/Icon';
import { GoalsClient } from '@/components/GoalsClient';

export const dynamic = 'force-dynamic';

export default async function GoalsPage() {
  await requireAuth();

  const goals = listGoals(true);
  const player = getPlayer();
  const level = levelInfo(player.xp);
  const earned = earnedAchievements();

  const xpLog = db
    .prepare('SELECT id, amount, reason, created_at FROM xp_events ORDER BY created_at DESC LIMIT 12')
    .all() as { id: string; amount: number; reason: string; created_at: number }[];

  return (
    <>
      <Page>
        <PageHeader title="Goals" subtitle="Call your shots, then go hit them." />

        {/* Rank card — the game's scoreboard. */}
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand/20 to-transparent px-4 py-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl
                              bg-gradient-to-br from-brand to-brand2 text-white shadow-lg shadow-brand/25">
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
                tone="brand"
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
              <p className="text-lg font-bold text-gold nums">{player.streak_days}</p>
              <p className="text-[11px] text-muted">Day streak</p>
            </div>
            <div className="px-2 py-3 text-center">
              <p className="text-lg font-bold nums">{player.longest_streak}</p>
              <p className="text-[11px] text-muted">Best streak</p>
            </div>
            <div className="px-2 py-3 text-center">
              <p className="text-lg font-bold nums">
                {Object.keys(earned).length}
                <span className="text-sm font-normal text-faint">/{ACHIEVEMENTS.length}</span>
              </p>
              <p className="text-[11px] text-muted">Trophies</p>
            </div>
          </div>
        </section>

        <GoalsClient initial={goals} />

        {/* Achievements grid */}
        <SectionTitle>Trophy case</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {ACHIEVEMENTS.map((a) => {
            const at = earned[a.code];
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
                {has ? (
                  <p className="mt-1.5 text-[11px] text-faint">{relativeTime(at)}</p>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* XP ledger — makes the score auditable rather than mysterious. */}
        {xpLog.length > 0 ? (
          <>
            <SectionTitle>Recent XP</SectionTitle>
            <ul className="card divide-y divide-line/60">
              {xpLog.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{e.reason}</span>
                    <span className="block text-xs text-faint">{relativeTime(e.created_at)}</span>
                  </span>
                  <span
                    className={`shrink-0 text-sm font-bold nums ${
                      e.amount >= 0 ? 'text-brand' : 'text-bad'
                    }`}
                  >
                    {e.amount >= 0 ? '+' : ''}
                    {e.amount}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Page>
      <BottomNav />
    </>
  );
}
