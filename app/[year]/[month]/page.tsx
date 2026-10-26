import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadYear } from "@/components/load-year";
import { Money } from "@/components/money";
import { MonthNav } from "@/components/month-nav";
import { PositionCard } from "@/components/position-card";
import { SyncButton } from "@/components/sync-button";
import { getSettings, getSyncYear, loadCosts, loadFacts } from "@/lib/db";
import { presentMonth } from "@/lib/present";
import { refreshPricesIfStale } from "@/lib/sync";

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
  if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
    return (
      <>
        <MonthNav year={year} month={month} now={now} />
        <p>That month has not started.</p>
      </>
    );
  }
  const saved = await getSyncYear(year);
  if (!saved) {
    return (
      <>
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

  await refreshPricesIfStale();
  const facts = await loadFacts();
  const costs = await loadCosts();
  for (const [nft, cost] of costs) {
    const position = facts.positions.get(nft);
    if (position) position.cost = cost;
  }
  const view = presentMonth({ ...facts, costs }, year, month, now);

  return (
    <>
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
      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <Summary label="Realized this month" value={<Money micro={view.realizedMicro} signed />} />
        <Summary label="USDC fees" value={<Money micro={view.feeMicro} />} />
        <Summary label="Fee sales" value={<Money micro={view.feeSaleMicro} />} />
        <Summary label="Principal result" value={<Money micro={view.principalMicro} signed />} />
      </section>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Realized profit is USDC fees collected, USDC received for fee tokens sold, and the result of principal withdrawn or sold, all dated in this month. Open positions still show their unrealized value on the row. When two positions pay the same stock, the oldest unsold fee is treated as sold first.
      </p>
      {view.positions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-muted">No Raydium CLMM activity in {view.title}.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {view.positions.map((position) => (
            <PositionCard key={position.nftMint} position={position} />
          ))}
        </div>
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl">{value}</p>
    </div>
  );
}
