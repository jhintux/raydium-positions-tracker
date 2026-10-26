import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Money } from "@/components/money";
import { loadCosts, loadFacts } from "@/lib/db";
import { formatUsdc } from "@/lib/format";
import { openedLabel, presentPosition } from "@/lib/present";

export const instant = false;

export default function PositionPage({ params }: { params: Promise<{ nft: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading the position…</p>}>
      <PositionBody params={params} />
    </Suspense>
  );
}

async function PositionBody({ params }: { params: Promise<{ nft: string }> }) {
  await connection();
  const { nft } = await params;
  const facts = await loadFacts();
  const known = facts.positions.has(nft) || facts.events.some((event) => event.nftMint === nft);
  if (!known) notFound();
  const costs = await loadCosts();
  const position = presentPosition({ ...facts, costs }, nft, new Date());
  return (
    <article>
      <Link href="/" className="text-sm text-muted underline">
        Current month
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl tracking-tight">{position.pair}</h1>
          <p className="mt-1 text-muted">
            {openedLabel(position)} · {position.daysLabel}
          </p>
        </div>
        <p className="text-3xl">
          <Money micro={position.profitMicro} signed />
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <a className="underline" href={`https://solscan.io/token/${position.nftMint}`} target="_blank" rel="noreferrer">
          Position NFT on Solscan
        </a>
        {position.poolId ? (
          <a className="underline" href={`https://solscan.io/account/${position.poolId}`} target="_blank" rel="noreferrer">
            Pool on Solscan
          </a>
        ) : null}
      </div>
      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Deposited" value={position.deposited} note={position.costMicro == null ? "USDC cost unknown" : `Cost ${formatUsdc(position.costMicro)}`} />
        <Stat label={position.status === "open" ? "Current" : "Withdrawn"} value={position.status === "open" ? (position.current ?? "—") : (position.withdrawn ?? "—")} note={position.status === "open" && position.currentValueMicro != null ? formatUsdc(position.currentValueMicro) : position.status} />
        <Stat label="Fees collected" value={position.feesCollected} note={`Unsold ${position.feesUnsold}. Sold ${position.feesSold}${position.feeSaleMicro > 0n ? ` for ${formatUsdc(position.feeSaleMicro)}` : ""}`} />
      </dl>
      <h2 className="mt-8 text-lg">Activity</h2>
      {position.timeline.length === 0 ? (
        <p className="mt-2 text-muted">No events in the loaded history. The open may be in an earlier year.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {position.timeline.map((item) => (
            <li key={`${item.signature}-${item.title}-${item.time}`} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3>{item.title}</h3>
                <a className="text-sm underline" href={item.href} target="_blank" rel="noreferrer">
                  Solscan
                </a>
              </div>
              <p className="mt-1 text-sm text-muted">{item.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1">{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}
