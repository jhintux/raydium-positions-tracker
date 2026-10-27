import { USDC_MINT } from "./constants";
import type { PositionRecord } from "./db";
import { formatRaw, formatUsdc, joinAmounts, shortAddress } from "./format";
import type { CashFlow, Lot, Match } from "./ledger";
import type { ParsedEvent } from "./parse";
import { usdcMicro, type PoolMeta } from "./price";
import { daysOpen, formatDay, formatTimestamp, inMonth, monthTitle } from "./time";

export type TimelineItem = {
  time: number;
  signature: string;
  title: string;
  detail: string;
  href: string;
};

export type PositionView = {
  nftMint: string;
  poolId: string | null;
  pair: string;
  status: "open" | "closed";
  inRange: boolean | null;
  openedAt: number | null;
  closedAt: number | null;
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
  realizedMicro: bigint | null;
  unrealizedMicro: bigint | null;
  timeline: TimelineItem[];
};

type Facts = {
  events: ParsedEvent[];
  lots: Lot[];
  matches: Match[];
  cashFlows: CashFlow[];
  sales: { id: number; signature: string; router: string | null; mint: string }[];
  positions: Map<string, PositionRecord>;
  pools: Map<string, PoolMeta>;
  costs: Map<string, bigint | null>;
};

export function presentMonth(facts: Facts, year: number, month: number, now = new Date()) {
  const feeMicro = sum(
    facts.cashFlows.filter((row) => row.kind === "usdc_fee" && inMonth(row.blockTime, year, month)).map((row) => row.amount),
  );
  const feeSaleMicro = sum(
    facts.matches.filter((row) => row.lotKind === "fee" && inMonth(row.blockTime, year, month)).map((row) => row.usdc),
  );
  let principalKnown = true;
  let principalMicro = 0n;
  for (const row of facts.cashFlows) {
    if (row.kind !== "usdc_principal" || !inMonth(row.blockTime, year, month)) continue;
    if (row.cost == null) principalKnown = false;
    else principalMicro += row.amount - row.cost;
  }
  for (const row of facts.matches) {
    if (row.lotKind !== "principal" || !inMonth(row.blockTime, year, month)) continue;
    if (row.cost == null) principalKnown = false;
    else principalMicro += row.usdc - row.cost;
  }
  const ids = new Set<string>();
  for (const event of facts.events) {
    if (inMonth(event.blockTime, year, month)) ids.add(event.nftMint);
  }
  for (const match of facts.matches) {
    if (inMonth(match.blockTime, year, month)) ids.add(match.nftMint);
  }
  if (now.getFullYear() === year && now.getMonth() + 1 === month) {
    for (const position of facts.positions.values()) {
      if (position.status === "open") ids.add(position.nftMint);
    }
  }
  const positions = [...ids].map((nft) => presentPosition(facts, nft, now)).sort(comparePositions);
  return {
    year,
    month,
    title: monthTitle(year, month),
    feeMicro,
    feeSaleMicro,
    principalMicro: principalKnown ? principalMicro : null,
    realizedMicro: principalKnown ? feeMicro + feeSaleMicro + principalMicro : null,
    positions,
  };
}

export function presentPosition(facts: Facts, nft: string, now = new Date()): PositionView {
  const events = facts.events.filter((event) => event.nftMint === nft);
  const position = facts.positions.get(nft);
  const poolId = position?.poolId ?? events.find((event) => event.poolId)?.poolId ?? null;
  const pool = poolId ? facts.pools.get(poolId) ?? null : null;
  const lots = facts.lots.filter((lot) => lot.nftMint === nft);
  const matches = facts.matches.filter((match) => match.nftMint === nft);
  const cash = facts.cashFlows.filter((row) => row.nftMint === nft);
  const pair = pairLabel(pool);
  const deposited0 = sum(events.filter((event) => event.kind === "open" || event.kind === "add").map((event) => event.amount0));
  const deposited1 = sum(events.filter((event) => event.kind === "open" || event.kind === "add").map((event) => event.amount1));
  const withdrawn0 = sum(events.filter((event) => event.kind === "remove").map((event) => event.amount0));
  const withdrawn1 = sum(events.filter((event) => event.kind === "remove").map((event) => event.amount1));
  const fee0 = sum(events.map((event) => event.fee0));
  const fee1 = sum(events.map((event) => event.fee1));
  const status = position?.status ?? (events.some((event) => event.kind === "close") ? "closed" : "open");
  const openedAt = position?.openedAt ?? events.find((event) => event.kind === "open")?.blockTime ?? null;
  const closedAt = position?.closedAt ?? events.find((event) => event.kind === "close")?.blockTime ?? null;
  const costMicro = facts.costs.get(nft) ?? null;
  const sqrt = pool?.sqrtPriceX64 ?? null;
  const currentValue = status === "open" ? valueOf(pool, position?.amount0 ?? null, position?.amount1 ?? null, sqrt) : 0n;
  const unsoldFee = valueLots(pool, lots.filter((lot) => lot.kind === "fee"), sqrt);
  const unsoldPrincipal = valueLots(pool, lots.filter((lot) => lot.kind === "principal"), sqrt);
  const uncollected = pool
    ? addNullable(
        usdcMicro(pool, pool.mint0 ?? "", position?.feeOwed0 ?? 0n, sqrt),
        usdcMicro(pool, pool.mint1 ?? "", position?.feeOwed1 ?? 0n, sqrt),
      )
    : 0n;
  const realized = realizedOf(cash, matches);
  const unrealized = addNullable(addNullable(currentValue, unsoldFee), addNullable(unsoldPrincipal, uncollected));
  const profit = costMicro == null || realized == null || unrealized == null ? null : realized + unrealized - costMicro;
  const feeSaleMicro = sum(matches.filter((match) => match.lotKind === "fee").map((match) => match.usdc));
  return {
    nftMint: nft,
    poolId,
    pair,
    status,
    inRange: status === "open" ? position?.inRange ?? null : null,
    openedAt,
    closedAt,
    daysLabel: openedAt == null ? "Open date is in a year that is not loaded" : daysOpen(openedAt, status === "closed" ? closedAt : null, now) === 0 ? "Opened today" : `${daysOpen(openedAt, status === "closed" ? closedAt : null, now)} days open`,
    deposited: amountPair(pool, deposited0, deposited1),
    costMicro,
    current: status === "open" ? amountPair(pool, position?.amount0 ?? null, position?.amount1 ?? null) : null,
    currentValueMicro: currentValue,
    withdrawn: withdrawn0 + withdrawn1 > 0n ? amountPair(pool, withdrawn0, withdrawn1) : null,
    feesCollected: amountPair(pool, fee0, fee1),
    feesUnsold: amountLots(pool, lots.filter((lot) => lot.kind === "fee" && lot.remaining > 0n)),
    feesSold: amountLots(pool, matches.filter((match) => match.lotKind === "fee").map((match) => ({ mint: match.mint, remaining: match.amount }))),
    feeSaleMicro,
    profitMicro: profit,
    realizedMicro: realized,
    unrealizedMicro: unrealized,
    timeline: timeline(facts, nft, pool),
  };
}

function realizedOf(cash: CashFlow[], matches: Match[]) {
  let total = 0n;
  for (const row of cash) total += row.amount;
  for (const row of matches) total += row.usdc;
  return total;
}

function valueOf(pool: PoolMeta | null, amount0: bigint | null, amount1: bigint | null, sqrt: bigint | null) {
  if (!pool?.mint0 || !pool.mint1 || amount0 == null || amount1 == null) return null;
  return addNullable(usdcMicro(pool, pool.mint0, amount0, sqrt), usdcMicro(pool, pool.mint1, amount1, sqrt));
}

function valueLots(pool: PoolMeta | null, lots: { mint: string; remaining: bigint }[], sqrt: bigint | null) {
  if (!pool) return lots.length === 0 ? 0n : null;
  let total = 0n;
  for (const lot of lots) {
    const value = usdcMicro(pool, lot.mint, lot.remaining, sqrt);
    if (value == null) return null;
    total += value;
  }
  return total;
}

function addNullable(left: bigint | null, right: bigint | null) {
  if (left == null || right == null) return null;
  return left + right;
}

function sum(values: bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}

export function pairLabel(pool: PoolMeta | null) {
  if (!pool?.mint0 || !pool.mint1) return "Unknown pair";
  const left = pool.mint1 === USDC_MINT ? symbol(pool, pool.mint0) : pool.mint0 === USDC_MINT ? symbol(pool, pool.mint1) : symbol(pool, pool.mint0);
  const right = pool.mint1 === USDC_MINT || pool.mint0 === USDC_MINT ? "USDC" : symbol(pool, pool.mint1);
  return `${left} / ${right}`;
}

function symbol(pool: PoolMeta, mint: string) {
  if (mint === USDC_MINT) return "USDC";
  if (mint === pool.mint0) return pool.symbol0 ?? shortAddress(mint);
  if (mint === pool.mint1) return pool.symbol1 ?? shortAddress(mint);
  return shortAddress(mint);
}

function amountPair(pool: PoolMeta | null, amount0: bigint | null, amount1: bigint | null) {
  if (!pool?.mint0 || !pool.mint1 || amount0 == null || amount1 == null) return "—";
  return joinAmounts([
    amount0 > 0n ? `${formatRaw(amount0, pool.decimals0 ?? 0)} ${symbol(pool, pool.mint0)}` : "",
    amount1 > 0n ? `${formatRaw(amount1, pool.decimals1 ?? 0)} ${symbol(pool, pool.mint1)}` : "",
  ]);
}

function amountLots(pool: PoolMeta | null, lots: { mint: string; remaining: bigint }[]) {
  if (!pool) return "—";
  const byMint = new Map<string, bigint>();
  for (const lot of lots) byMint.set(lot.mint, (byMint.get(lot.mint) ?? 0n) + lot.remaining);
  const parts = [...byMint.entries()].filter(([, amount]) => amount > 0n).map(([mint, amount]) => {
    const decimals = mint === pool.mint0 ? pool.decimals0 : mint === pool.mint1 ? pool.decimals1 : 0;
    return `${formatRaw(amount, decimals ?? 0)} ${symbol(pool, mint)}`;
  });
  return joinAmounts(parts);
}

function timeline(facts: Facts, nft: string, pool: PoolMeta | null): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const event of facts.events.filter((row) => row.nftMint === nft)) {
    const amounts = amountPair(pool, event.amount0 + event.fee0, event.amount1 + event.fee1);
    const title =
      event.kind === "open" ? "Opened" : event.kind === "add" ? "Added liquidity" : event.kind === "remove" ? "Removed liquidity" : event.kind === "collect" ? "Collected fees" : "Closed";
    const fee = amountPair(pool, event.fee0, event.fee1);
    items.push({
      time: event.blockTime,
      signature: event.signature,
      title,
      detail: event.kind === "remove" && fee !== "—" ? `${amounts}. Fees ${fee}` : event.kind === "close" ? "Position NFT burned" : amounts,
      href: `https://solscan.io/tx/${event.signature}`,
    });
  }
  const sales = new Map<string, { time: number; signature: string; router: string | null; parts: string[] }>();
  for (const match of facts.matches.filter((row) => row.nftMint === nft)) {
    const sale = facts.sales.find((row) => row.id === match.saleId);
    const key = `${match.signature}:${match.lotKind}`;
    const current = sales.get(key) ?? { time: match.blockTime, signature: match.signature, router: sale?.router ?? null, parts: [] };
    const decimals = pool && match.mint === pool.mint0 ? pool.decimals0 : pool && match.mint === pool.mint1 ? pool.decimals1 : 0;
    const label = pool ? symbol(pool, match.mint) : shortAddress(match.mint);
    current.parts.push(`${formatRaw(match.amount, decimals ?? 0)} ${label} for ${formatUsdc(match.usdc)}`);
    sales.set(key, current);
  }
  for (const sale of sales.values()) {
    items.push({
      time: sale.time,
      signature: sale.signature,
      title: sale.router ? `Sold via ${sale.router}` : "Sold",
      detail: sale.parts.join(" · "),
      href: `https://solscan.io/tx/${sale.signature}`,
    });
  }
  return items.sort((a, b) => a.time - b.time).map((item) => ({ ...item, detail: `${formatTimestamp(item.time)}. ${item.detail}` }));
}

export function comparePositions(
  a: { status: "open" | "closed"; openedAt: number | null },
  b: { status: "open" | "closed"; openedAt: number | null },
) {
  if (a.status !== b.status) return a.status === "open" ? -1 : 1;
  if (a.openedAt == null || b.openedAt == null) return a.openedAt == null ? (b.openedAt == null ? 0 : 1) : -1;
  return b.openedAt - a.openedAt;
}

export function openedLabel(position: PositionView) {
  if (position.openedAt == null) return "Opened before loaded history";
  const closed = position.closedAt != null ? `, closed ${formatDay(position.closedAt)}` : "";
  return `Opened ${formatDay(position.openedAt)}${closed}`;
}
