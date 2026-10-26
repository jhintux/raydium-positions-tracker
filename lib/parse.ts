import { depositPaid, netOfTransferFee, type BalanceDelta } from "./amounts";
import { ROUTERS, USDC_MINT } from "./constants";
import {
  accountKeysOf,
  clmmInstructionsOf,
  decodeLogs,
  type ClmmInstruction,
  type DecodedLog,
} from "./decode";

export type ParsedEvent = {
  signature: string;
  slot: number;
  txIndex: number;
  eventIndex: number;
  blockTime: number;
  nftMint: string;
  poolId: string | null;
  kind: "open" | "add" | "remove" | "collect" | "close";
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  fee0: bigint;
  fee1: bigint;
  sqrtPriceX64: bigint | null;
  mint0: string | null;
  mint1: string | null;
  tickLower: number | null;
  tickUpper: number | null;
};

export type ParsedTransaction = {
  signature: string;
  slot: number;
  txIndex: number;
  blockTime: number;
  events: ParsedEvent[];
  deltas: BalanceDelta[];
  router: string | null;
};

type RawTx = {
  signature?: string;
  slot?: number;
  transactionIndex?: number;
  blockTime?: number | null;
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: unknown[];
      instructions?: { programId?: string; programIdIndex?: number; accounts?: (string | number)[]; data?: string }[];
    };
  };
  meta?: {
    err?: unknown;
    logMessages?: string[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    loadedAddresses?: { writable?: string[]; readonly?: string[] };
    innerInstructions?: { index: number; instructions: { programId?: string; accounts?: (string | number)[]; data?: string }[] }[];
  };
};

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
};

function attachPrices(logs: DecodedLog[]) {
  let pending: bigint | null = null;
  const priced: { event: Exclude<DecodedLog, { type: "calculate" | "swap" }>; sqrt: bigint | null }[] = [];
  for (const item of logs) {
    if (item.type === "calculate") {
      const last = priced.at(-1);
      if (last && last.sqrt == null) last.sqrt = item.sqrtPriceX64;
      else pending = item.sqrtPriceX64;
      continue;
    }
    if (item.type === "swap") continue;
    priced.push({ event: item, sqrt: pending });
    pending = null;
  }
  const swaps = logs.filter((item): item is Extract<DecodedLog, { type: "swap" }> => item.type === "swap");
  return { priced, swaps };
}

function sameAmounts(a0: bigint, a1: bigint, b0: bigint, b1: bigint) {
  return a0 === b0 && a1 === b1;
}

export function parseTransaction(raw: unknown, wallet: string): ParsedTransaction | null {
  const tx = raw as RawTx;
  if (tx.meta?.err) return null;
  const blockTime = tx.blockTime;
  if (blockTime == null) return null;
  const signature = tx.signature ?? tx.transaction?.signatures?.[0];
  if (!signature) return null;

  const instructions = clmmInstructionsOf(tx).filter((ix) => ix.owner === wallet);
  const logs = decodeLogs(tx.meta?.logMessages ?? []);
  const { priced, swaps } = attachPrices(logs);
  const creates = priced.filter((item) => item.event.type === "create");
  const increases = priced.filter((item) => item.event.type === "increase");
  const decreases = priced.filter((item) => item.event.type === "decrease");
  const collects = priced.filter((item) => item.event.type === "collect");

  const opens = instructions.filter((ix) => ix.kind === "open");
  const adds = instructions.filter((ix) => ix.kind === "increase");
  const removes = instructions.filter((ix) => ix.kind === "decrease");
  const closes = instructions.filter((ix) => ix.kind === "close");

  const events: ParsedEvent[] = [];
  let eventIndex = 0;
  const base = {
    signature,
    slot: tx.slot ?? 0,
    txIndex: tx.transactionIndex ?? 0,
    blockTime,
  };

  const push = (event: Omit<ParsedEvent, keyof typeof base | "eventIndex">) => {
    events.push({ ...base, eventIndex, ...event });
    eventIndex += 1;
  };

  creates.forEach((item, index) => {
    if (item.event.type !== "create") return;
    const ix = opens[index];
    if (!ix?.nft || item.event.owner !== wallet) return;
    const sqrt = sqrtFor(item.sqrt, swaps, ix.pool);
    push({
      nftMint: ix.nft,
      poolId: item.event.pool,
      kind: "open",
      liquidity: item.event.liquidity,
      amount0: depositPaid(item.event.amount0, item.event.transferFee0),
      amount1: depositPaid(item.event.amount1, item.event.transferFee1),
      fee0: 0n,
      fee1: 0n,
      sqrtPriceX64: sqrt,
      mint0: ix.mint0,
      mint1: ix.mint1,
      tickLower: item.event.tickLower,
      tickUpper: item.event.tickUpper,
    });
  });

  increases.forEach((item, index) => {
    const increase = item.event;
    if (increase.type !== "increase") return;
    const ix = adds[index];
    const pairedOpen = events.find((event) => event.kind === "open" && event.nftMint === increase.nft);
    const createForNft = creates.find((row, createIndex) => opens[createIndex]?.nft === increase.nft);
    if (
      createForNft?.event.type === "create" &&
      sameAmounts(increase.amount0, increase.amount1, createForNft.event.amount0, createForNft.event.amount1)
    ) {
      return;
    }
    const sqrt = sqrtFor(item.sqrt, swaps, ix?.pool ?? pairedOpen?.poolId ?? null);
    push({
      nftMint: increase.nft,
      poolId: ix?.pool ?? pairedOpen?.poolId ?? null,
      kind: "add",
      liquidity: increase.liquidity,
      amount0: depositPaid(increase.amount0, increase.transferFee0),
      amount1: depositPaid(increase.amount1, increase.transferFee1),
      fee0: 0n,
      fee1: 0n,
      sqrtPriceX64: sqrt,
      mint0: ix?.mint0 ?? pairedOpen?.mint0 ?? null,
      mint1: ix?.mint1 ?? pairedOpen?.mint1 ?? null,
      tickLower: pairedOpen?.tickLower ?? null,
      tickUpper: pairedOpen?.tickUpper ?? null,
    });
  });

  decreases.forEach((item, index) => {
    const decrease = item.event;
    if (decrease.type !== "decrease") return;
    const ix = removes[index];
    const net0 = netOfTransferFee(decrease.amount0, decrease.fee0, decrease.transferFee0);
    const net1 = netOfTransferFee(decrease.amount1, decrease.fee1, decrease.transferFee1);
    const principal = net0.principal + net1.principal;
    const fees = net0.fee + net1.fee;
    if (principal === 0n && fees === 0n && decrease.liquidity === 0n) return;
    const previous = events.find((event) => event.nftMint === decrease.nft);
    const sqrt = sqrtFor(item.sqrt, swaps, ix?.pool ?? previous?.poolId ?? null);
    push({
      nftMint: decrease.nft,
      poolId: ix?.pool ?? previous?.poolId ?? null,
      kind: principal > 0n || decrease.liquidity > 0n ? "remove" : "collect",
      liquidity: decrease.liquidity,
      amount0: net0.principal,
      amount1: net1.principal,
      fee0: net0.fee,
      fee1: net1.fee,
      sqrtPriceX64: sqrt,
      mint0: ix?.mint0 ?? previous?.mint0 ?? null,
      mint1: ix?.mint1 ?? previous?.mint1 ?? null,
      tickLower: previous?.tickLower ?? null,
      tickUpper: previous?.tickUpper ?? null,
    });
  });

  for (const item of collects) {
    const collected = item.event;
    if (collected.type !== "collect") continue;
    const decrease = decreases.find((row) => row.event.type === "decrease" && row.event.nft === collected.nft);
    if (decrease?.event.type === "decrease" && (decrease.event.fee0 > 0n || decrease.event.fee1 > 0n)) continue;
    const previous = events.find((event) => event.nftMint === collected.nft);
    push({
      nftMint: collected.nft,
      poolId: previous?.poolId ?? null,
      kind: "collect",
      liquidity: 0n,
      amount0: 0n,
      amount1: 0n,
      fee0: item.event.amount0,
      fee1: item.event.amount1,
      sqrtPriceX64: item.sqrt,
      mint0: previous?.mint0 ?? null,
      mint1: previous?.mint1 ?? null,
      tickLower: previous?.tickLower ?? null,
      tickUpper: previous?.tickUpper ?? null,
    });
  }

  for (const ix of closes) {
    if (!ix.nft) continue;
    const previous = events.find((event) => event.nftMint === ix.nft);
    push({
      nftMint: ix.nft,
      poolId: previous?.poolId ?? null,
      kind: "close",
      liquidity: 0n,
      amount0: 0n,
      amount1: 0n,
      fee0: 0n,
      fee1: 0n,
      sqrtPriceX64: null,
      mint0: previous?.mint0 ?? null,
      mint1: previous?.mint1 ?? null,
      tickLower: previous?.tickLower ?? null,
      tickUpper: previous?.tickUpper ?? null,
    });
  }

  if (events.length === 0 && !hasStockDelta(tx, wallet)) return null;

  return {
    ...base,
    events,
    deltas: walletDeltas(tx, wallet),
    router: routerOf(tx),
  };
}

function sqrtFor(attached: bigint | null, swaps: Extract<DecodedLog, { type: "swap" }>[], poolId: string | null) {
  if (attached != null) return attached;
  if (!poolId) return null;
  return swaps.find((swap) => swap.pool === poolId)?.sqrtPriceX64 ?? null;
}

function hasStockDelta(tx: RawTx, wallet: string) {
  return walletDeltas(tx, wallet).some((row) => row.mint !== USDC_MINT && row.delta !== 0n);
}

function walletDeltas(tx: RawTx, wallet: string): BalanceDelta[] {
  const totals = new Map<string, { delta: bigint; decimals: number }>();
  const apply = (rows: TokenBalance[] | undefined, sign: 1 | -1) => {
    for (const row of rows ?? []) {
      if (row.owner !== wallet) continue;
      const amount = BigInt(row.uiTokenAmount?.amount ?? "0");
      const current = totals.get(row.mint) ?? { delta: 0n, decimals: row.uiTokenAmount?.decimals ?? 0 };
      current.delta += amount * BigInt(sign);
      if (row.uiTokenAmount?.decimals != null) current.decimals = row.uiTokenAmount.decimals;
      totals.set(row.mint, current);
    }
  };
  apply(tx.meta?.preTokenBalances, -1);
  apply(tx.meta?.postTokenBalances, 1);
  return [...totals.entries()].map(([mint, value]) => ({ mint, delta: value.delta, decimals: value.decimals }));
}

function routerOf(tx: RawTx) {
  const keys = new Set(accountKeysOf(tx));
  for (const ix of tx.transaction?.message?.instructions ?? []) {
    if (ix.programId) keys.add(ix.programId);
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      if (ix.programId) keys.add(ix.programId);
    }
  }
  return ROUTERS.find((router) => keys.has(router.id))?.label ?? null;
}

export function clmmNetByMint(events: ParsedEvent[], mint0: string | null, mint1: string | null) {
  const net = new Map<string, bigint>();
  const add = (mint: string | null, amount: bigint) => {
    if (!mint || amount === 0n) return;
    net.set(mint, (net.get(mint) ?? 0n) + amount);
  };
  for (const event of events) {
    const token0 = event.mint0 ?? mint0;
    const token1 = event.mint1 ?? mint1;
    const sign = event.kind === "open" || event.kind === "add" ? -1n : 1n;
    add(token0, sign * (event.amount0 + event.fee0));
    add(token1, sign * (event.amount1 + event.fee1));
  }
  return net;
}

export function knownMints(event: ParsedEvent, pools: Map<string, { mint0: string | null; mint1: string | null }>) {
  const pool = event.poolId ? pools.get(event.poolId) : undefined;
  return {
    mint0: event.mint0 ?? pool?.mint0 ?? null,
    mint1: event.mint1 ?? pool?.mint1 ?? null,
  };
}

export type { ClmmInstruction };
