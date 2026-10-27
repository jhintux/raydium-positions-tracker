import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GlobalPnl } from "@/components/global-pnl";
import { LoadYear } from "@/components/load-year";
import { MonthBoard, type PositionWire } from "@/components/month-board";
import { MonthNav } from "@/components/month-nav";
import { SyncButton } from "@/components/sync-button";
import type { PositionView } from "@/lib/present";
import { getSettings, getSyncYear, loadCosts, loadFacts, loadWalletPnl } from "@/lib/db";
import { openedLabel, presentMonth } from "@/lib/present";
import { refreshPricesInBackground } from "@/lib/sync";

export const instant = false;

export default function MonthPage({ params }: { params: Promise<{ year: string; month: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading the month…</p>}>
      <MonthBody params={params} />
    </Suspense>
  );
}

async function MonthBody({ params }: { params: Promise<{ year: string; month: string }> }) {
  await connection();
  const { year: yearText, month: monthText } = await params;
  const year = Number(yearText);
  const month = Number(monthText);
  const now = new Date();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2020 || year > 2100) {
    notFound();
  }
  const settings = await getSettings();
  if (!settings.wallet) {
    return (
      <p>
        Add a wallet in <Link href="/settings" className="underline">Settings</Link> before loading history.
      </p>
    );
  }
  const walletPnl = await loadWalletPnl();
  if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
    return (
      <>
        <GlobalPnl profitMicro={walletPnl.profitMicro} unknownPositions={walletPnl.unknownPositions} />
        <MonthNav year={year} month={month} now={now} />
        <p>That month has not started.</p>
      </>
    );
  }
  const saved = await getSyncYear(year);
  if (!saved) {
    return (
      <>
        <GlobalPnl profitMicro={walletPnl.profitMicro} unknownPositions={walletPnl.unknownPositions} />
        <MonthNav year={year} month={month} now={now} />
        {year === now.getFullYear() ? (
          <section className="rounded-2xl border border-line bg-card p-6">
            <h1 className="text-3xl tracking-tight">Sync {year}</h1>
            <p className="mt-2 max-w-xl text-muted">
              The first sync loads 1 January through today. Months in this year are then read from the saved ledger. A later sync asks only for newer transactions.
            </p>
            <div className="mt-4">
              <SyncButton year={year} />
            </div>
          </section>
        ) : (
          <LoadYear key={year} year={year} />
        )}
      </>
    );
  }

  const facts = await loadFacts();
  const costs = await loadCosts();
  refreshPricesInBackground();
  for (const [nft, cost] of costs) {
    const position = facts.positions.get(nft);
    if (position) position.cost = cost;
  }
  const view = presentMonth({ ...facts, costs }, year, month, now);

  return (
    <>
      <GlobalPnl profitMicro={walletPnl.profitMicro} unknownPositions={walletPnl.unknownPositions} />
      <MonthNav year={year} month={month} now={now} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight">{view.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {saved.txCount.toLocaleString("en-US")} transactions saved for {year}.
            {year === now.getFullYear() ? " Sync again to fetch only newer ones." : ""}
          </p>
        </div>
        {year === now.getFullYear() ? <SyncButton year={year} label="Sync new transactions" /> : null}
      </div>
      <MonthBoard
        title={view.title}
        positions={view.positions.map(wirePosition)}
        summary={{
          realizedMicro: wireMicro(view.realizedMicro),
          feeMicro: view.feeMicro.toString(),
          feeSaleMicro: view.feeSaleMicro.toString(),
          principalMicro: wireMicro(view.principalMicro),
        }}
      />
    </>
  );
}

function wireMicro(value: bigint | null) {
  return value == null ? null : value.toString();
}

function wirePosition(position: PositionView): PositionWire {
  return {
    nftMint: position.nftMint,
    pair: position.pair,
    status: position.status,
    inRange: position.inRange,
    opened: openedLabel(position),
    daysLabel: position.daysLabel,
    deposited: position.deposited,
    costMicro: wireMicro(position.costMicro),
    current: position.current,
    currentValueMicro: wireMicro(position.currentValueMicro),
    withdrawn: position.withdrawn,
    feesCollected: position.feesCollected,
    feesUnsold: position.feesUnsold,
    feesSold: position.feesSold,
    feeSaleMicro: position.feeSaleMicro.toString(),
    profitMicro: wireMicro(position.profitMicro),
  };
}
