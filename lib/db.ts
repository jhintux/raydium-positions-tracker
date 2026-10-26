import postgres from "postgres";
import type { CashFlow, Lot, Match, Sale } from "./ledger";
import type { BuiltPosition } from "./ledger";
import type { ParsedEvent } from "./parse";
import type { PoolMeta } from "./price";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;
type Cell = string | number | boolean | null;

const globalForSql = globalThis as unknown as { ledgerSql?: Sql };

export function getSql() {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!globalForSql.ledgerSql) {
    globalForSql.ledgerSql = postgres(url, {
      prepare: false,
      fetch_types: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: { rejectUnauthorized: false },
    });
  }
  return globalForSql.ledgerSql;
}

function integer(value: unknown) {
  if (value == null || value === "") return null;
  return Number(value);
}

function requiredInteger(value: unknown) {
  return Number(value);
}

function big(value: unknown) {
  if (value == null || value === "") return null;
  return BigInt(String(value));
}

function text(value: bigint | null) {
  return value == null ? null : value.toString();
}

async function insertChunks(rows: Record<string, Cell>[], columns: string[], write: (slice: Record<string, Cell>[]) => Promise<unknown>) {
  const size = 100;
  for (let offset = 0; offset < rows.length; offset += size) {
    const slice = rows.slice(offset, offset + size);
    if (slice.length === 0) continue;
    if (slice.some((row) => columns.some((column) => !(column in row)))) {
      throw new Error("Insert row is missing a column.");
    }
    await write(slice);
  }
}

export type Settings = { wallet: string };

export async function getSettings(): Promise<Settings> {
  const sql = getSql();
  const [row] = await sql<Row[]>`select wallet from settings where id = 1`;
  return { wallet: String(row?.wallet ?? "") };
}

export async function saveSettings(wallet: string, clearHistory: boolean) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    if (clearHistory) await clearHistoryTables(tx);
    await tx`update settings set wallet = ${wallet} where id = 1`;
  });
}

async function clearHistoryTables(tx: Tx) {
  await tx`delete from sale_matches`;
  await tx`delete from sales`;
  await tx`delete from lots`;
  await tx`delete from cash_flows`;
  await tx`delete from events`;
  await tx`delete from positions`;
  await tx`delete from pools`;
  await tx`delete from transactions`;
  await tx`delete from sync_years`;
  await tx`delete from position_costs`;
}

export async function clearHistory() {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await clearHistoryTables(tx);
  });
}

export type SyncYear = { year: number; newestBlockTime: number | null; txCount: number; updatedAt: number };

function syncYear(row: Row): SyncYear {
  return {
    year: requiredInteger(row.year),
    newestBlockTime: integer(row.newest_block_time),
    txCount: requiredInteger(row.tx_count),
    updatedAt: requiredInteger(row.updated_at),
  };
}

export async function listSyncYears(): Promise<SyncYear[]> {
  const sql = getSql();
  const rows = await sql<Row[]>`select year, newest_block_time, tx_count, updated_at from sync_years order by year desc`;
  return rows.map(syncYear);
}

export async function getSyncYear(year: number): Promise<SyncYear | null> {
  const sql = getSql();
  const [row] = await sql<Row[]>`select year, newest_block_time, tx_count, updated_at from sync_years where year = ${year}`;
  return row ? syncYear(row) : null;
}

export async function upsertTransaction(row: { signature: string; slot: number; txIndex: number; blockTime: number; raw: string }) {
  const sql = getSql();
  await sql`
    insert into transactions (signature, slot, tx_index, block_time, raw_json)
    values (${row.signature}, ${row.slot}, ${row.txIndex}, ${row.blockTime}, ${row.raw})
    on conflict (signature) do update set
      slot = excluded.slot,
      tx_index = excluded.tx_index,
      block_time = excluded.block_time,
      raw_json = excluded.raw_json
  `;
}

export async function countTransactions(gte: number, lt: number | null) {
  const sql = getSql();
  if (lt == null) {
    const [row] = await sql<Row[]>`select count(*)::int as n from transactions where block_time >= ${gte}`;
    return requiredInteger(row?.n ?? 0);
  }
  const [row] = await sql<Row[]>`select count(*)::int as n from transactions where block_time >= ${gte} and block_time < ${lt}`;
  return requiredInteger(row?.n ?? 0);
}

export async function markYear(year: number, newestBlockTime: number | null, txCount: number) {
  const sql = getSql();
  const updatedAt = Date.now();
  await sql`
    insert into sync_years (year, newest_block_time, tx_count, updated_at)
    values (${year}, ${newestBlockTime}, ${txCount}, ${updatedAt})
    on conflict (year) do update set
      newest_block_time = excluded.newest_block_time,
      tx_count = excluded.tx_count,
      updated_at = excluded.updated_at
  `;
}

export async function eachRawTransaction() {
  const sql = getSql();
  return sql<Row[]>`select raw_json from transactions order by block_time, slot, tx_index`;
}

export async function savePools(pools: PoolMeta[]) {
  const sql = getSql();
  const now = Date.now();
  for (const pool of pools) {
    await sql`
      insert into pools (id, mint0, mint1, decimals0, decimals1, symbol0, symbol1, sqrt_price_x64, tick_current, updated_at)
      values (
        ${pool.id}, ${pool.mint0}, ${pool.mint1}, ${pool.decimals0}, ${pool.decimals1},
        ${pool.symbol0}, ${pool.symbol1}, ${pool.sqrtPriceX64?.toString() ?? null}, ${pool.tickCurrent}, ${now}
      )
      on conflict (id) do update set
        mint0 = coalesce(excluded.mint0, pools.mint0),
        mint1 = coalesce(excluded.mint1, pools.mint1),
        decimals0 = coalesce(excluded.decimals0, pools.decimals0),
        decimals1 = coalesce(excluded.decimals1, pools.decimals1),
        symbol0 = coalesce(excluded.symbol0, pools.symbol0),
        symbol1 = coalesce(excluded.symbol1, pools.symbol1),
        sqrt_price_x64 = coalesce(excluded.sqrt_price_x64, pools.sqrt_price_x64),
        tick_current = coalesce(excluded.tick_current, pools.tick_current),
        updated_at = excluded.updated_at
    `;
  }
}

export async function loadPools() {
  const sql = getSql();
  const pools = new Map<string, PoolMeta>();
  for (const row of await sql<Row[]>`select * from pools`) {
    pools.set(String(row.id), {
      id: String(row.id),
      mint0: row.mint0 == null ? null : String(row.mint0),
      mint1: row.mint1 == null ? null : String(row.mint1),
      decimals0: integer(row.decimals0),
      decimals1: integer(row.decimals1),
      symbol0: row.symbol0 == null ? null : String(row.symbol0),
      symbol1: row.symbol1 == null ? null : String(row.symbol1),
      sqrtPriceX64: row.sqrt_price_x64 == null ? null : BigInt(String(row.sqrt_price_x64)),
      tickCurrent: integer(row.tick_current),
    });
  }
  return pools;
}

export async function replaceDerived(input: {
  events: ParsedEvent[];
  lots: Lot[];
  sales: Sale[];
  matches: Match[];
  cashFlows: CashFlow[];
  positions: BuiltPosition[];
}) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`delete from sale_matches`;
    await tx`delete from sales`;
    await tx`delete from lots`;
    await tx`delete from cash_flows`;
    await tx`delete from events`;
    const eventRows = input.events.map((event) => ({
      signature: event.signature,
      slot: event.slot,
      tx_index: event.txIndex,
      event_index: event.eventIndex,
      block_time: event.blockTime,
      nft_mint: event.nftMint,
      pool_id: event.poolId,
      kind: event.kind,
      liquidity: event.liquidity.toString(),
      amount0: event.amount0.toString(),
      amount1: event.amount1.toString(),
      fee0: event.fee0.toString(),
      fee1: event.fee1.toString(),
      sqrt_price_x64: text(event.sqrtPriceX64),
      mint0: event.mint0,
      mint1: event.mint1,
      tick_lower: event.tickLower,
      tick_upper: event.tickUpper,
    }));
    await insertChunks(eventRows, Object.keys(eventRows[0] ?? {}), async (slice) => {
      await tx`
        insert into events (
          signature, slot, tx_index, event_index, block_time, nft_mint, pool_id, kind, liquidity,
          amount0, amount1, fee0, fee1, sqrt_price_x64, mint0, mint1, tick_lower, tick_upper
        ) values ${tx(
          slice,
          "signature",
          "slot",
          "tx_index",
          "event_index",
          "block_time",
          "nft_mint",
          "pool_id",
          "kind",
          "liquidity",
          "amount0",
          "amount1",
          "fee0",
          "fee1",
          "sqrt_price_x64",
          "mint0",
          "mint1",
          "tick_lower",
          "tick_upper",
        )}
      `;
    });
    const lotRows = input.lots.map((lot) => ({
      id: lot.id,
      nft_mint: lot.nftMint,
      mint: lot.mint,
      kind: lot.kind,
      amount: lot.amount.toString(),
      remaining: lot.remaining.toString(),
      cost: text(lot.cost),
      cost_remaining: text(lot.costRemaining),
      block_time: lot.blockTime,
      slot: lot.slot,
      tx_index: lot.txIndex,
      event_index: lot.eventIndex,
      signature: lot.signature,
    }));
    await insertChunks(lotRows, Object.keys(lotRows[0] ?? {}), async (slice) => {
      await tx`
        insert into lots (
          id, nft_mint, mint, kind, amount, remaining, cost, cost_remaining, block_time, slot, tx_index, event_index, signature
        ) values ${tx(slice, "id", "nft_mint", "mint", "kind", "amount", "remaining", "cost", "cost_remaining", "block_time", "slot", "tx_index", "event_index", "signature")}
      `;
    });
    const saleRows = input.sales.map((sale) => ({
      id: sale.id,
      signature: sale.signature,
      block_time: sale.blockTime,
      slot: sale.slot,
      tx_index: sale.txIndex,
      mint: sale.mint,
      amount: sale.amount.toString(),
      usdc: sale.usdc.toString(),
      router: sale.router,
    }));
    await insertChunks(saleRows, Object.keys(saleRows[0] ?? {}), async (slice) => {
      await tx`
        insert into sales (id, signature, block_time, slot, tx_index, mint, amount, usdc, router)
        values ${tx(slice, "id", "signature", "block_time", "slot", "tx_index", "mint", "amount", "usdc", "router")}
      `;
    });
    const matchRows = input.matches.map((match) => ({
      sale_id: match.saleId,
      lot_id: match.lotId,
      nft_mint: match.nftMint,
      mint: match.mint,
      lot_kind: match.lotKind,
      amount: match.amount.toString(),
      usdc: match.usdc.toString(),
      cost: text(match.cost),
      block_time: match.blockTime,
      signature: match.signature,
    }));
    await insertChunks(matchRows, Object.keys(matchRows[0] ?? {}), async (slice) => {
      await tx`
        insert into sale_matches (sale_id, lot_id, nft_mint, mint, lot_kind, amount, usdc, cost, block_time, signature)
        values ${tx(slice, "sale_id", "lot_id", "nft_mint", "mint", "lot_kind", "amount", "usdc", "cost", "block_time", "signature")}
      `;
    });
    const cashRows = input.cashFlows.map((cash) => ({
      nft_mint: cash.nftMint,
      signature: cash.signature,
      block_time: cash.blockTime,
      slot: cash.slot,
      tx_index: cash.txIndex,
      kind: cash.kind,
      amount: cash.amount.toString(),
      cost: text(cash.cost),
    }));
    await insertChunks(cashRows, Object.keys(cashRows[0] ?? {}), async (slice) => {
      await tx`
        insert into cash_flows (nft_mint, signature, block_time, slot, tx_index, kind, amount, cost)
        values ${tx(slice, "nft_mint", "signature", "block_time", "slot", "tx_index", "kind", "amount", "cost")}
      `;
    });
    const now = Date.now();
    for (const position of input.positions) {
      await tx`
        insert into positions (nft_mint, pool_id, tick_lower, tick_upper, opened_at, closed_at, status, liquidity, updated_at)
        values (
          ${position.nftMint}, ${position.poolId}, ${position.tickLower}, ${position.tickUpper},
          ${position.openedAt}, ${position.closedAt}, ${position.status}, ${position.liquidity.toString()}, ${now}
        )
        on conflict (nft_mint) do update set
          pool_id = coalesce(excluded.pool_id, positions.pool_id),
          tick_lower = coalesce(excluded.tick_lower, positions.tick_lower),
          tick_upper = coalesce(excluded.tick_upper, positions.tick_upper),
          opened_at = excluded.opened_at,
          closed_at = excluded.closed_at,
          status = excluded.status,
          liquidity = excluded.liquidity,
          updated_at = excluded.updated_at
      `;
      await tx`update positions set liquidity = ${position.liquidity.toString()} where nft_mint = ${position.nftMint}`;
    }
  });
}

export type PositionRecord = {
  nftMint: string;
  poolId: string | null;
  tickLower: number | null;
  tickUpper: number | null;
  openedAt: number | null;
  closedAt: number | null;
  status: "open" | "closed";
  liquidity: bigint;
  amount0: bigint | null;
  amount1: bigint | null;
  feeOwed0: bigint;
  feeOwed1: bigint;
  inRange: boolean | null;
  cost: bigint | null;
};

export async function loadFacts() {
  const sql = getSql();
  const events: ParsedEvent[] = (await sql<Row[]>`select * from events order by block_time, slot, tx_index, event_index`).map((row) => ({
    signature: String(row.signature),
    slot: requiredInteger(row.slot),
    txIndex: requiredInteger(row.tx_index),
    eventIndex: requiredInteger(row.event_index),
    blockTime: requiredInteger(row.block_time),
    nftMint: String(row.nft_mint),
    poolId: row.pool_id == null ? null : String(row.pool_id),
    kind: String(row.kind) as ParsedEvent["kind"],
    liquidity: BigInt(String(row.liquidity)),
    amount0: BigInt(String(row.amount0)),
    amount1: BigInt(String(row.amount1)),
    fee0: BigInt(String(row.fee0)),
    fee1: BigInt(String(row.fee1)),
    sqrtPriceX64: big(row.sqrt_price_x64),
    mint0: row.mint0 == null ? null : String(row.mint0),
    mint1: row.mint1 == null ? null : String(row.mint1),
    tickLower: integer(row.tick_lower),
    tickUpper: integer(row.tick_upper),
  }));
  const lots: Lot[] = (await sql<Row[]>`select * from lots`).map((row) => ({
    id: requiredInteger(row.id),
    nftMint: String(row.nft_mint),
    mint: String(row.mint),
    kind: String(row.kind) as Lot["kind"],
    amount: BigInt(String(row.amount)),
    remaining: BigInt(String(row.remaining)),
    cost: big(row.cost),
    costRemaining: big(row.cost_remaining),
    blockTime: requiredInteger(row.block_time),
    slot: requiredInteger(row.slot),
    txIndex: requiredInteger(row.tx_index),
    eventIndex: requiredInteger(row.event_index),
    signature: String(row.signature),
  }));
  const matches: Match[] = (await sql<Row[]>`select * from sale_matches`).map((row) => ({
    saleId: requiredInteger(row.sale_id),
    lotId: requiredInteger(row.lot_id),
    nftMint: String(row.nft_mint),
    mint: String(row.mint),
    lotKind: String(row.lot_kind) as Match["lotKind"],
    amount: BigInt(String(row.amount)),
    usdc: BigInt(String(row.usdc)),
    cost: big(row.cost),
    blockTime: requiredInteger(row.block_time),
    signature: String(row.signature),
  }));
  const cashFlows: CashFlow[] = (await sql<Row[]>`select * from cash_flows`).map((row) => ({
    nftMint: String(row.nft_mint),
    signature: String(row.signature),
    blockTime: requiredInteger(row.block_time),
    slot: requiredInteger(row.slot),
    txIndex: requiredInteger(row.tx_index),
    kind: String(row.kind) as CashFlow["kind"],
    amount: BigInt(String(row.amount)),
    cost: big(row.cost),
  }));
  const sales = (await sql<Row[]>`select * from sales`).map((row) => ({
    id: requiredInteger(row.id),
    signature: String(row.signature),
    router: row.router == null ? null : String(row.router),
    mint: String(row.mint),
  }));
  const positions = new Map<string, PositionRecord>();
  for (const row of await sql<Row[]>`select * from positions`) {
    positions.set(String(row.nft_mint), {
      nftMint: String(row.nft_mint),
      poolId: row.pool_id == null ? null : String(row.pool_id),
      tickLower: integer(row.tick_lower),
      tickUpper: integer(row.tick_upper),
      openedAt: integer(row.opened_at),
      closedAt: integer(row.closed_at),
      status: String(row.status) === "closed" ? "closed" : "open",
      liquidity: BigInt(String(row.liquidity ?? "0")),
      amount0: big(row.amount0),
      amount1: big(row.amount1),
      feeOwed0: big(row.fee_owed0) ?? 0n,
      feeOwed1: big(row.fee_owed1) ?? 0n,
      inRange: row.in_range == null ? null : Boolean(row.in_range),
      cost: null,
    });
  }
  return { events, lots, matches, cashFlows, sales, positions, pools: await loadPools() };
}

export async function positionCosts(positions: BuiltPosition[]) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`delete from position_costs`;
    const rows = positions.map((position) => ({ nft_mint: position.nftMint, cost: text(position.cost) }));
    await insertChunks(rows, ["nft_mint", "cost"], async (slice) => {
      await tx`insert into position_costs (nft_mint, cost) values ${tx(slice, "nft_mint", "cost")}`;
    });
  });
}

export async function loadCosts() {
  const sql = getSql();
  const costs = new Map<string, bigint | null>();
  for (const row of await sql<Row[]>`select nft_mint, cost from position_costs`) {
    costs.set(String(row.nft_mint), big(row.cost));
  }
  return costs;
}

export async function upsertLivePosition(row: {
  nftMint: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  feeOwed0: bigint;
  feeOwed1: bigint;
  inRange: boolean;
}) {
  const sql = getSql();
  const updatedAt = Date.now();
  await sql`
    insert into positions (
      nft_mint, pool_id, tick_lower, tick_upper, opened_at, closed_at, status, liquidity,
      amount0, amount1, fee_owed0, fee_owed1, in_range, updated_at
    ) values (
      ${row.nftMint}, ${row.poolId}, ${row.tickLower}, ${row.tickUpper}, null, null, 'open', ${row.liquidity.toString()},
      ${row.amount0.toString()}, ${row.amount1.toString()}, ${row.feeOwed0.toString()}, ${row.feeOwed1.toString()},
      ${row.inRange}, ${updatedAt}
    )
    on conflict (nft_mint) do update set
      pool_id = excluded.pool_id,
      tick_lower = excluded.tick_lower,
      tick_upper = excluded.tick_upper,
      status = 'open',
      closed_at = null,
      liquidity = excluded.liquidity,
      amount0 = excluded.amount0,
      amount1 = excluded.amount1,
      fee_owed0 = excluded.fee_owed0,
      fee_owed1 = excluded.fee_owed1,
      in_range = excluded.in_range,
      updated_at = excluded.updated_at
  `;
}

export async function markMissingClosed(openNfts: string[]) {
  const sql = getSql();
  const rows = await sql<Row[]>`select nft_mint, closed_at from positions where status = 'open'`;
  const open = new Set(openNfts);
  const nowSec = Math.floor(Date.now() / 1000);
  const now = Date.now();
  for (const row of rows) {
    const nft = String(row.nft_mint);
    if (open.has(nft)) continue;
    const closedAt = integer(row.closed_at) ?? nowSec;
    await sql`
      update positions
      set status = 'closed', closed_at = ${closedAt}, amount0 = '0', amount1 = '0', liquidity = '0', in_range = false, updated_at = ${now}
      where nft_mint = ${nft}
    `;
  }
}

export async function countOpenPositions() {
  const sql = getSql();
  const [row] = await sql<Row[]>`select count(*)::int as n from positions where status = 'open'`;
  return requiredInteger(row?.n ?? 0);
}

export async function countFreshOpenPositions(updatedAfter: number) {
  const sql = getSql();
  const [row] = await sql<Row[]>`
    select count(*)::int as n from positions as p
    join pools as o on o.id = p.pool_id
    where p.status = 'open' and p.amount0 is not null and o.updated_at >= ${updatedAfter}
  `;
  return requiredInteger(row?.n ?? 0);
}

export async function poolsNeedingRefresh(maxAgeMs: number) {
  const sql = getSql();
  const cutoff = Date.now() - maxAgeMs;
  const rows = await sql<Row[]>`
    select distinct pool_id as id from positions
    where status = 'open' and pool_id is not null
    and pool_id not in (select id from pools where updated_at >= ${cutoff})
  `;
  return rows.map((row) => String(row.id));
}
