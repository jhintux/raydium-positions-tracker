import { formatUsdc } from "@/lib/format";

export function Money({ micro, signed = false }: { micro: bigint | null; signed?: boolean }) {
  if (micro == null) return <span className="text-muted">—</span>;
  const tone = micro > 0n ? "text-gain" : micro < 0n ? "text-loss" : "";
  return <span className={`num ${tone}`}>{formatUsdc(micro, signed)}</span>;
}
