import { inferSales } from "./amounts";
import { USDC_MINT } from "./constants";
import type { ParsedEvent } from "./parse";
import { usdcMicro, type PoolMeta } from "./price";

export type SaleInput = {
  signature: string;
  slot: number;
  txIndex: number;
  blockTime: number;
  mint: string;
  amount: bigint;
  usdc: bigint;
  router: string | null;
};

export type Lot = {
  id: number;
  nftMint: string;
  mint: string;
  kind: "fee" | "principal";
  amount: bigint;
  remaining: bigint;
  cost: bigint | null;
  costRemaining: bigint | null;
  blockTime: number;
  slot: number;
  txIndex: number;
  eventIndex: number;
  signature: string;
};

export type Sale = SaleInput & { id: number };

export type Match = {
  saleId: number;
  lotId: number;
  nftMint: string;
  mint: string;
  lotKind: "fee" | "principal";
  amount: bigint;
  usdc: bigint;
  cost: bigint | null;
  blockTime: number;
  signature: string;
};

export type CashFlow = {
  nftMint: string;
  signature: string;
  blockTime: number;
  slot: number;
  txIndex: number;
  kind: "usdc_fee" | "usdc_principal";
  amount: bigint;
  cost: bigint | null;
};

export type BuiltPosition = {
  nftMint: string;
  poolId: string | null;
  tickLower: number | null;
  tickUpper: number | null;
  openedAt: number | null;
  closedAt: number | null;
  status: "open" | "closed";
  liquidity: bigint;
  cost: bigint | null;
};

type Working = {
  liquidity: bigint;
  cost: bigint | null;
  depositedCost: bigint | null;
  openedAt: number | null;
  closedAt: number | null;
  poolId: string | null;
  tickLower: number | null;
  tickUpper: number | null;
  status: "open" | "closed";
};

function stamp(row: { blockTime: number; slot: number; txIndex: number; eventIndex?: number }, phase: number) {
  return [row.blockTime, row.slot, row.txIndex, phase, row.eventIndex ?? 0] as const;
}

function before(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export function salesForTransactions(
  groups: {
    events: ParsedEvent[];
    deltas: { mint: string; delta: bigint }[];
    signature: string;
    slot: number;
    txIndex: number;
    blockTime: number;
    router: string | null;
  }[],
  pools: Map<string, PoolMeta>,
  stockMints: string[],
) {
  const sales: SaleInput[] = [];
  for (const group of groups) {
    const clmmNet = new Map<string, bigint>();
    const add = (mint: string | null, amount: bigint) => {
      if (!mint || amount === 0n) return;
      clmmNet.set(mint, (clmmNet.get(mint) ?? 0n) + amount);
    };
    for (const event of group.events) {
      const pool = event.poolId ? pools.get(event.poolId) : undefined;
      const mint0 = event.mint0 ?? pool?.mint0 ?? null;
      const mint1 = event.mint1 ?? pool?.mint1 ?? null;
      const sign = event.kind === "open" || event.kind === "add" ? -1n : 1n;
      add(mint0, sign * (event.amount0 + event.fee0));
      add(mint1, sign * (event.amount1 + event.fee1));
    }
    const deltas = new Map(group.deltas.map((row) => [row.mint, row.delta]));
    for (const sale of inferSales({ stockMints, deltas, clmmNet, usdcMint: USDC_MINT })) {
      sales.push({ ...sale, signature: group.signature, slot: group.slot, txIndex: group.txIndex, blockTime: group.blockTime, router: group.router });
    }
  }
  return sales;
}

export function linkEvents(events: ParsedEvent[], pools: Map<string, PoolMeta>) {
  const ordered = [...events].sort((a, b) => (before(stamp(a, 0), stamp(b, 0)) ? -1 : 1));
  const poolByNft = new Map<string, string>();
  const mintsByNft = new Map<string, { mint0: string | null; mint1: string | null }>();
  const ticksByNft = new Map<string, { lower: number; upper: number }>();
  for (const event of ordered) {
    if (event.poolId) poolByNft.set(event.nftMint, event.poolId);
    else event.poolId = poolByNft.get(event.nftMint) ?? null;
    if (event.mint0 || event.mint1) mintsByNft.set(event.nftMint, { mint0: event.mint0, mint1: event.mint1 });
    const remembered = mintsByNft.get(event.nftMint);
    const pool = event.poolId ? pools.get(event.poolId) : undefined;
    event.mint0 = event.mint0 ?? remembered?.mint0 ?? pool?.mint0 ?? null;
    event.mint1 = event.mint1 ?? remembered?.mint1 ?? pool?.mint1 ?? null;
    if (event.mint0 || event.mint1) mintsByNft.set(event.nftMint, { mint0: event.mint0, mint1: event.mint1 });
    if (event.tickLower != null && event.tickUpper != null) {
      ticksByNft.set(event.nftMint, { lower: event.tickLower, upper: event.tickUpper });
    } else {
      const ticks = ticksByNft.get(event.nftMint);
      event.tickLower = ticks?.lower ?? null;
      event.tickUpper = ticks?.upper ?? null;
    }
  }
  return ordered;
}

export function stockMintsOf(pools: Iterable<PoolMeta>) {
  const mints = new Set<string>();
  for (const pool of pools) {
    for (const mint of [pool.mint0, pool.mint1]) {
      if (mint && mint !== USDC_MINT) mints.add(mint);
    }
  }
  return [...mints];
}

export function buildLedger(events: ParsedEvent[], salesIn: SaleInput[], pools: Map<string, PoolMeta>) {
  const orderedEvents = linkEvents(events, pools);

  const lots: Lot[] = [];
  const sales: Sale[] = salesIn.map((sale, index) => ({ ...sale, id: index + 1 }));
  const matches: Match[] = [];
  const cashFlows: CashFlow[] = [];
  const working = new Map<string, Working>();
  let lotId = 1;

  const ensure = (nft: string): Working => {
    const current = working.get(nft);
    if (current) return current;
    const created: Working = {
      liquidity: 0n,
      cost: 0n,
      depositedCost: 0n,
      openedAt: null,
      closedAt: null,
      poolId: null,
      tickLower: null,
      tickUpper: null,
      status: "open",
    };
    working.set(nft, created);
    return created;
  };

  type Item =
    | { phase: 0; event: ParsedEvent }
    | { phase: 1; sale: Sale };

  const items: Item[] = [
    ...orderedEvents.map((event) => ({ phase: 0 as const, event })),
    ...sales.map((sale) => ({ phase: 1 as const, sale })),
  ].sort((a, b) => {
    const left = a.phase === 0 ? stamp(a.event, 0) : stamp(a.sale, 1);
    const right = b.phase === 0 ? stamp(b.event, 0) : stamp(b.sale, 1);
    return before(left, right) ? -1 : 1;
  });

  for (const item of items) {
    if (item.phase === 1) {
      consumeSale(item.sale, lots, matches);
      continue;
    }
    const event = item.event;
    const state = ensure(event.nftMint);
    if (event.poolId) state.poolId = event.poolId;
    if (event.tickLower != null) state.tickLower = event.tickLower;
    if (event.tickUpper != null) state.tickUpper = event.tickUpper;
    const pool = event.poolId ? pools.get(event.poolId) : undefined;

    if (event.kind === "open" || event.kind === "add") {
      if (event.kind === "open") state.openedAt = state.openedAt ?? event.blockTime;
      state.liquidity += event.liquidity;
      const paid = pool ? depositValue(pool, event) : null;
      if (paid == null) {
        state.cost = null;
        state.depositedCost = null;
      } else if (state.cost != null && state.depositedCost != null) {
        state.cost += paid;
        state.depositedCost += paid;
      }
      continue;
    }

    if (event.kind === "close") {
      state.status = "closed";
      state.closedAt = event.blockTime;
      state.liquidity = 0n;
      continue;
    }

    if (event.kind !== "remove" && event.kind !== "collect") continue;
    const released = event.kind === "remove" ? releaseCost(state, event.liquidity) : 0n;
    if (event.kind === "remove") {
      state.liquidity = event.liquidity >= state.liquidity ? 0n : state.liquidity - event.liquidity;
    }
    const mint0 = pool?.mint0 ?? event.mint0;
    const mint1 = pool?.mint1 ?? event.mint1;
    if (!mint0 || !mint1) continue;
    const shares = pool ? splitCost(pool, event, released) : { cost0: null, cost1: null };
    recordSide(event, mint0, event.amount0, event.fee0, shares.cost0, lots, cashFlows, () => lotId++);
    recordSide(event, mint1, event.amount1, event.fee1, shares.cost1, lots, cashFlows, () => lotId++);
  }

  const positions: BuiltPosition[] = [...working.entries()].map(([nftMint, state]) => ({
    nftMint,
    poolId: state.poolId,
    tickLower: state.tickLower,
    tickUpper: state.tickUpper,
    openedAt: state.openedAt,
    closedAt: state.closedAt,
    status: state.status,
    liquidity: state.liquidity,
    cost: state.depositedCost,
  }));

  return { lots, sales, matches, cashFlows, positions };
}

function depositValue(pool: PoolMeta, event: ParsedEvent) {
  if (!pool.mint0 || !pool.mint1) return null;
  const first = usdcMicro(pool, pool.mint0, event.amount0, event.sqrtPriceX64);
  const second = usdcMicro(pool, pool.mint1, event.amount1, event.sqrtPriceX64);
  if (first == null || second == null) return null;
  return first + second;
}

function releaseCost(state: Working, removed: bigint) {
  if (removed <= 0n) return 0n;
  if (state.cost == null) return null;
  if (state.liquidity <= 0n) {
    state.cost = null;
    return null;
  }
  const take = removed >= state.liquidity ? state.cost : (state.cost * removed) / state.liquidity;
  state.cost -= take;
  return take;
}

function splitCost(pool: PoolMeta, event: ParsedEvent, released: bigint | null) {
  if (released == null || !pool.mint0 || !pool.mint1) return { cost0: null, cost1: null };
  const v0 = usdcMicro(pool, pool.mint0, event.amount0, event.sqrtPriceX64);
  const v1 = usdcMicro(pool, pool.mint1, event.amount1, event.sqrtPriceX64);
  if (v0 == null || v1 == null) return { cost0: null, cost1: null };
  const sum = v0 + v1;
  if (sum === 0n) return { cost0: 0n, cost1: 0n };
  const cost0 = (released * v0) / sum;
  return { cost0, cost1: released - cost0 };
}

function recordSide(
  event: ParsedEvent,
  mint: string,
  principal: bigint,
  fee: bigint,
  principalCost: bigint | null,
  lots: Lot[],
  cashFlows: CashFlow[],
  nextId: () => number,
) {
  if (fee > 0n) {
    if (mint === USDC_MINT) {
      cashFlows.push({
        nftMint: event.nftMint,
        signature: event.signature,
        blockTime: event.blockTime,
        slot: event.slot,
        txIndex: event.txIndex,
        kind: "usdc_fee",
        amount: fee,
        cost: 0n,
      });
    } else {
      lots.push(makeLot(nextId(), event, mint, "fee", fee, 0n));
    }
  }
  if (principal > 0n) {
    if (mint === USDC_MINT) {
      cashFlows.push({
        nftMint: event.nftMint,
        signature: event.signature,
        blockTime: event.blockTime,
        slot: event.slot,
        txIndex: event.txIndex,
        kind: "usdc_principal",
        amount: principal,
        cost: principalCost,
      });
    } else {
      lots.push(makeLot(nextId(), event, mint, "principal", principal, principalCost));
    }
  }
}

function makeLot(id: number, event: ParsedEvent, mint: string, kind: "fee" | "principal", amount: bigint, cost: bigint | null): Lot {
  return {
    id,
    nftMint: event.nftMint,
    mint,
    kind,
    amount,
    remaining: amount,
    cost,
    costRemaining: cost,
    blockTime: event.blockTime,
    slot: event.slot,
    txIndex: event.txIndex,
    eventIndex: event.eventIndex,
    signature: event.signature,
  };
}

function consumeSale(sale: Sale, lots: Lot[], matches: Match[]) {
  const fees = lots.filter((lot) => lot.kind === "fee" && lot.mint === sale.mint && lot.remaining > 0n);
  const principal = lots.filter((lot) => lot.kind === "principal" && lot.mint === sale.mint && lot.remaining > 0n);
  let amountLeft = sale.amount;
  let usdcLeft = sale.usdc;
  for (const lot of [...fees, ...principal]) {
    if (amountLeft === 0n) break;
    const take = lot.remaining < amountLeft ? lot.remaining : amountLeft;
    const usdc = take === amountLeft ? usdcLeft : (usdcLeft * take) / amountLeft;
    const cost =
      lot.costRemaining == null
        ? null
        : take === lot.remaining
          ? lot.costRemaining
          : (lot.costRemaining * take) / lot.remaining;
    lot.remaining -= take;
    if (lot.costRemaining != null && cost != null) lot.costRemaining -= cost;
    amountLeft -= take;
    usdcLeft -= usdc;
    matches.push({
      saleId: sale.id,
      lotId: lot.id,
      nftMint: lot.nftMint,
      mint: lot.mint,
      lotKind: lot.kind,
      amount: take,
      usdc,
      cost,
      blockTime: sale.blockTime,
      signature: sale.signature,
    });
  }
}
