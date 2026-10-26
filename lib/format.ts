export function formatUsdc(micro: bigint | null, signed = false) {
  if (micro == null) return "—";
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  const sign = negative ? "-" : signed && micro > 0n ? "+" : "";
  return `${sign}$${whole.toLocaleString("en-US")}.${frac}`;
}

export function formatRaw(raw: bigint, decimals: number) {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  let frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length > 6) frac = frac.slice(0, 6);
  const body = frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
  return negative ? `-${body}` : body;
}

export function shortAddress(value: string) {
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function joinAmounts(parts: string[]) {
  const present = parts.filter(Boolean);
  return present.length > 0 ? present.join(" · ") : "—";
}
