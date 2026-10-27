import { Money } from "@/components/money";

export function GlobalPnl({ profitMicro, unknownPositions }: { profitMicro: bigint | null; unknownPositions: number }) {
  return (
    <div className="mb-6 rounded-2xl border border-line bg-card p-4">
      <p className="text-sm text-muted">Global PnL</p>
      <p className="mt-1 text-3xl">
        <Money micro={profitMicro} signed />
      </p>
      <p className="mt-1 text-sm text-muted">
        All saved history for this wallet.
        {unknownPositions > 0 ? ` ${unknownPositions.toLocaleString("en-US")} positions still have an unknown profit.` : ""}
      </p>
    </div>
  );
}
