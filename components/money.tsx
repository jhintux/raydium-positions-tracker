import { formatUsdc } from "@/lib/format";

export function Money({ micro, signed = false }: { micro: bigint | string | null; signed?: boolean }) {
  const value = micro == null ? null : typeof micro === "bigint" ? micro : BigInt(micro);
  if (value == null) return <span className="text-muted">—</span>;
  const tone = value > 0n ? "text-gain" : value < 0n ? "text-loss" : "";
  return <span className={`num ${tone}`}>{formatUsdc(value, signed)}</span>;
}
