import Link from "next/link";
import { Money } from "@/components/money";
import { formatUsdc } from "@/lib/format";
import type { PositionView } from "@/lib/present";
import { openedLabel } from "@/lib/present";

export function PositionCard({ position }: { position: PositionView }) {
  return (
    <article className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/positions/${position.nftMint}`} className="text-xl tracking-tight">
            {position.pair}
          </Link>
          <p className="mt-1 text-sm text-muted">
            {openedLabel(position)} · {position.daysLabel}
          </p>
        </div>
        <div className="flex gap-2 text-xs uppercase tracking-wide">
          <span className="rounded-full bg-chip px-2 py-1">{position.status === "open" ? "Open" : "Closed"}</span>
          {position.inRange != null ? (
            <span className="rounded-full bg-chip px-2 py-1">{position.inRange ? "In range" : "Out of range"}</span>
          ) : null}
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Deposited</dt>
          <dd>{position.deposited}</dd>
          <dd className="text-muted">{position.costMicro == null ? "USDC cost unknown" : `Cost ${formatUsdc(position.costMicro)}`}</dd>
        </div>
        {position.status === "open" ? (
          <div>
            <dt className="text-muted">Current</dt>
            <dd>{position.current}</dd>
            <dd className="text-muted">
              {position.currentValueMicro == null ? "Value unknown" : formatUsdc(position.currentValueMicro)}
            </dd>
          </div>
        ) : null}
        {position.withdrawn ? (
          <div>
            <dt className="text-muted">Withdrawn principal</dt>
            <dd>{position.withdrawn}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted">Fees</dt>
          <dd>Collected {position.feesCollected}</dd>
          <dd>Unsold {position.feesUnsold}</dd>
          <dd>
            Sold {position.feesSold}
            {position.feeSaleMicro > 0n ? ` for ${formatUsdc(position.feeSaleMicro)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Profit</dt>
          <dd className="text-lg">
            <Money micro={position.profitMicro} signed />
          </dd>
        </div>
      </dl>
    </article>
  );
}
