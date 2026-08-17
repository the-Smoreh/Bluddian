import { requireAuth } from '@/lib/auth';
import { fmtMoney, fmtNumber } from '@/lib/money';
import {
  listProducts,
  listSales,
  revenueByDay,
  revenueByPlatform,
  revenueSummary,
} from '@/lib/queries';
import { BottomNav, Page, PageHeader, SectionTitle } from '@/components/Shell';
import { StatTile } from '@/components/StatTile';
import { BarChart } from '@/components/charts/BarChart';
import { StackedBar } from '@/components/charts/StackedBar';
import { MoneyClient } from '@/components/MoneyClient';

export const dynamic = 'force-dynamic';

export default async function MoneyPage() {
  await requireAuth();

  const rev = revenueSummary();
  const sales = listSales(60);
  const days = revenueByDay(30);
  const platforms = revenueByPlatform();
  const products = listProducts();

  return (
    <>
      <Page>
        <PageHeader title="Money" subtitle="Every dollar in, across every platform." />

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

        <MoneyClient initialSales={sales} products={products} />
      </Page>
      <BottomNav />
    </>
  );
}
