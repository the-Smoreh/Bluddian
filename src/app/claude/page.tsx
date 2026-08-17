import { requireAuth } from '@/lib/auth';
import { configuredProviders } from '@/lib/credentials';
import { fmtCompact, fmtMoney, relativeTime } from '@/lib/money';
import { claudeSummary, lastSyncFor, revenueSummary } from '@/lib/queries';
import { BottomNav, Page, PageHeader, SectionTitle } from '@/components/Shell';
import { StatTile } from '@/components/StatTile';
import { TrendChart } from '@/components/charts/TrendChart';
import { Meter } from '@/components/charts/Meter';
import { Icon } from '@/components/Icon';
import { ClaudeClient } from '@/components/ClaudeClient';

export const dynamic = 'force-dynamic';

export default async function ClaudePage() {
  await requireAuth();

  const claude = claudeSummary(30);
  const rev = revenueSummary();
  const configured = configuredProviders();
  const sync = lastSyncFor('anthropic');

  // Cost per dollar earned — the number that tells you whether the tooling is
  // paying for itself. Plotted nowhere: it's one ratio, so it's a stat tile.
  const ratio =
    rev.month > 0 ? (claude.costMonthCents / rev.month) * 100 : null;

  const maxModelCost = Math.max(...claude.byModel.map((m) => m.cost), 1);

  return (
    <>
      <Page>
        <PageHeader
          title="Claude"
          subtitle="What the AI is costing you, and what it's building."
        />

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
            value={fmtCompact(claude.tokensMonth)}
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

        {/* The honest framing: cost as a share of revenue. */}
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
              <Meter value={claude.cacheSavingsPct} max={100} tone="good" height={8} label="Cache hit rate" />
            </div>
            <p className="mt-2 text-xs text-faint">
              Cached input tokens bill at a fraction of the normal rate — a higher number here is
              money you didn&apos;t spend.
            </p>
          </div>
        ) : null}

        {/* Cost by model: bars in one hue, since it's magnitude, not identity. */}
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
                    <span className="shrink-0 text-sm font-bold text-brand nums">
                      {fmtMoney(m.cost)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Meter value={m.cost} max={maxModelCost} tone="cost" height={5} label={m.model} />
                  </div>
                  <p className="mt-1.5 text-xs text-faint nums">{fmtCompact(m.tokens)} tokens</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="card mt-4 flex items-center gap-3 p-3.5">
          <span className={configured.anthropic ? 'text-good' : 'text-faint'}>
            <Icon name={configured.anthropic ? 'check' : 'lock'} size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {configured.anthropic ? 'Anthropic connected' : 'Not connected'}
            </p>
            <p className="text-xs text-faint">
              {sync.at
                ? `Last sync ${relativeTime(sync.at)}${sync.status === 'error' ? ' — failed' : ''}`
                : 'Add an admin API key in settings, or log spend by hand.'}
            </p>
          </div>
        </div>

        <ClaudeClient connected={configured.anthropic} />
      </Page>
      <BottomNav />
    </>
  );
}
