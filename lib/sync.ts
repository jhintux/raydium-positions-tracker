import { USDC_MINT } from "./constants";
import {
  countFreshOpenPositions,
  countOpenPositions,
  countTransactions,
  eachRawTransaction,
  getSettings,
  getSyncYear,
  loadPools,
  markMissingClosed,
  markYear,
  positionCosts,
  replaceDerived,
  savePools,
  upsertTransaction,
} from "./db";
import { fetchYear, solanaRpcUrl } from "./helius";
import { buildLedger, linkEvents, salesForTransactions, stockMintsOf } from "./ledger";
import { refreshOpenPositions } from "./live";
import { parseTransaction, type ParsedEvent } from "./parse";
import { fetchPoolAccounts, fetchPoolNames, mergePool, rpcConnection } from "./pools";
import type { PoolMeta } from "./price";
import { yearWindow } from "./time";

export async function syncYear(year: number) {
  const settings = await getSettings();
  if (!settings.wallet) throw new Error("Add a wallet in Settings first.");
  solanaRpcUrl();
  const now = new Date();
  if (year > now.getFullYear()) throw new Error("That year has not started.");
  const existing = await getSyncYear(year);
  if (existing && year < now.getFullYear()) {
    return { year, fetched: 0, stored: existing.txCount, message: `${year} is already saved.` };
  }

  console.info(`[sync] ${year} starting`, { newestStored: existing?.newestBlockTime ?? null });
  const rows = await fetchYear(settings.wallet, year, existing?.newestBlockTime ?? null);
  console.info(`[sync] ${year} fetched ${rows.length} transactions`);
  let newest = existing?.newestBlockTime ?? null;
  for (const row of rows) {
    const signature = row.signature ?? row.transaction?.signatures?.[0];
    if (!signature || row.blockTime == null || row.meta?.err) continue;
    if (row.slot == null) console.error("[sync] transaction is missing slot", signature);
    await upsertTransaction({
      signature,
      slot: row.slot ?? 0,
      txIndex: row.transactionIndex ?? 0,
      blockTime: row.blockTime,
      raw: JSON.stringify(row),
    });
    if (newest == null || row.blockTime > newest) newest = row.blockTime;
  }

  const window = yearWindow(year, now);
  const yearEnd = Math.floor(new Date(year + 1, 0, 1).getTime() / 1000);
  const stored = await countTransactions(window.gte, yearEnd);
  await markYear(year, newest, stored);
  const rebuilt = await rebuild(settings.wallet);
  const message = rows.length === 0
    ? `${year} is up to date. ${rebuilt}`
    : `Saved ${rows.length.toLocaleString("en-US")} transactions for ${year}. ${rebuilt}`;
  return { year, fetched: rows.length, stored, message };
}

async function rebuild(wallet: string) {
  const groups: {
    events: ParsedEvent[];
    deltas: { mint: string; delta: bigint; decimals: number }[];
    signature: string;
    slot: number;
    txIndex: number;
    blockTime: number;
    router: string | null;
  }[] = [];
  const decimals = new Map<string, number>([[USDC_MINT, 6]]);
  for (const row of await eachRawTransaction()) {
    const parsed = parseTransaction(JSON.parse(String(row.raw_json)), wallet);
    if (!parsed) continue;
    for (const delta of parsed.deltas) decimals.set(delta.mint, delta.decimals);
    groups.push(parsed);
  }

  const discovered = new Map<string, PoolMeta>();
  for (const group of groups) {
    for (const event of group.events) {
      if (!event.poolId) continue;
      const current = discovered.get(event.poolId) ?? emptyPool(event.poolId);
      current.mint0 = current.mint0 ?? event.mint0;
      current.mint1 = current.mint1 ?? event.mint1;
      if (current.mint0) current.decimals0 = current.decimals0 ?? decimals.get(current.mint0) ?? null;
      if (current.mint1) current.decimals1 = current.decimals1 ?? decimals.get(current.mint1) ?? null;
      discovered.set(event.poolId, current);
    }
  }

  const ids = [...discovered.keys()];
  let chain = new Map<string, PoolMeta>();
  let names = new Map<string, { symbol0: string | null; symbol1: string | null; mint0: string | null; mint1: string | null; decimals0: number | null; decimals1: number | null }>();
  try {
    chain = await fetchPoolAccounts(rpcConnection(), ids);
    names = await fetchPoolNames(ids);
  } catch {
    chain = new Map();
  }
  const pools = new Map<string, PoolMeta>();
  for (const id of ids) {
    pools.set(id, mergePool(id, chain.get(id), names.get(id), discovered.get(id)));
  }
  await savePools([...pools.values()]);

  const events = groups.flatMap((group) => group.events);
  linkEvents(events, pools);
  const sales = salesForTransactions(groups, pools, stockMintsOf(pools.values()));
  const ledger = buildLedger(events, sales, pools);
  await replaceDerived({ ...ledger, events });
  await positionCosts(ledger.positions);

  let liveNote = "Live positions were not refreshed.";
  try {
    const live = await refreshOpenPositions(wallet);
    await savePools(live.pools.map((pool) => mergePool(pool.id, pool, names.get(pool.id), pools.get(pool.id))));
    await markMissingClosed(live.heldMints);
    liveNote = `${live.pools.length.toLocaleString("en-US")} open pool prices refreshed.`;
  } catch (error) {
    console.error("[sync] live positions failed", error);
    liveNote = "History was saved, but live position accounts could not be read.";
  }
  return liveNote;
}

function emptyPool(id: string): PoolMeta {
  return {
    id,
    mint0: null,
    mint1: null,
    decimals0: null,
    decimals1: null,
    symbol0: null,
    symbol1: null,
    sqrtPriceX64: null,
    tickCurrent: null,
  };
}

export async function refreshPricesIfStale() {
  const settings = await getSettings();
  if (!settings.wallet || !process.env.SOLANA_RPC_URL?.trim()) return;
  const open = await countOpenPositions();
  if (open === 0) return;
  const fresh = await countFreshOpenPositions(Date.now() - 60_000);
  if (fresh === open) return;
  const stale = await loadPools();
  try {
    const live = await refreshOpenPositions(settings.wallet);
    const names = await fetchPoolNames(live.pools.map((pool) => pool.id));
    await savePools(live.pools.map((pool) => mergePool(pool.id, pool, names.get(pool.id), stale.get(pool.id))));
    await markMissingClosed(live.heldMints);
  } catch (error) {
    console.error("[sync] stale price refresh failed", error);
  }
}
