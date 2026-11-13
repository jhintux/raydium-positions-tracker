import Link from "next/link";
import { Money } from "@/components/money";
import { formatUsdc } from "@/lib/format";

export type CardPosition = {
  nftMint: string;
  pair: string;
  poolId: string | null;
  mint0: string | null;
  mint1: string | null;
  status: "open" | "closed";
  inRange: boolean | null;
  opened: string;
  daysLabel: string;
  deposited: string;
  costMicro: bigint | null;
  current: string | null;
  currentValueMicro: bigint | null;
  withdrawn: string | null;
  feesCollected: string;
  feesUnsold: string;
  feesSold: string;
  feeSaleMicro: bigint;
  profitMicro: bigint | null;
};

export function PositionCard({ position }: { position: CardPosition }) {
  const sale = position.feeSaleMicro > 0n ? ` for ${formatUsdc(position.feeSaleMicro)}` : "";
  const value =
    position.status === "open"
      ? position.currentValueMicro == null
        ? "Value unknown"
        : formatUsdc(position.currentValueMicro)
      : null;
  return (
    <article className="rounded-2xl border border-line bg-card px-4 py-3">
      <div className="grid items-start gap-x-6 gap-y-3 md:grid-cols-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/positions/${position.nftMint}`} className="tracking-tight">
              {position.pair}
            </Link>
            <span className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide">
              {position.status === "open" ? "Open" : "Closed"}
            </span>
            {position.inRange != null ? (
              <span className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide">
                {position.inRange ? "In range" : "Out of range"}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {position.opened} · {position.daysLabel}
          </p>
          <p className="mt-1 text-lg leading-none">
            <Money micro={position.profitMicro} signed />
          </p>
        </div>
        <dl className="min-w-0 text-sm">
          <dt className="text-muted">Deposited</dt>
          <dd>{position.deposited}</dd>
          <dd className="text-muted">{position.costMicro == null ? "Cost unknown" : formatUsdc(position.costMicro)}</dd>
        </dl>
        <dl className="min-w-0 text-sm">
          {position.status === "open" ? (
            <>
              <dt className="text-muted">Current</dt>
              <dd>{position.current}</dd>
              <dd className="text-muted">
                {value}
                {position.withdrawn ? ` · Withdrawn ${position.withdrawn}` : ""}
              </dd>
            </>
          ) : (
            <>
              <dt className="text-muted">Withdrawn</dt>
              <dd>{position.withdrawn ?? "—"}</dd>
            </>
          )}
        </dl>
      </div>
      <p className="mt-2 text-sm text-muted">
        Fees {position.feesCollected} · unsold {position.feesUnsold} · sold {position.feesSold}
        {sale}
      </p>
    </article>
  );
}
