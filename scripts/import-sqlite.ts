import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

type Row = Record<string, unknown>;
type Cell = string | number | boolean | null;
type Tx = postgres.TransactionSql;

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sqlitePath = process.argv[2] ?? path.join(process.cwd(), "data", "tracker.db");
const schemaPath = path.join(process.cwd(), "supabase", "migrations", "ledger.sql");

function statements(file: string) {
  return file
    .split(";")
    .map((part) => part.replace(/--.*$/gm, "").trim())
    .filter((part) => part.length > 0);
}

function text(value: unknown) {
  if (value == null) return null;
  return String(value);
}

function integer(value: unknown) {
  if (value == null || value === "") return null;
  return Number(value);
}

function requiredInteger(value: unknown) {
  return Number(value);
}

function flag(value: unknown) {
  if (value == null) return null;
  return Number(value) === 1;
}

async function insertChunks(tx: Tx, rows: Record<string, Cell>[], size: number, write: (slice: Record<string, Cell>[]) => Promise<unknown>) {
  for (let offset = 0; offset < rows.length; offset += size) {
    const slice = rows.slice(offset, offset + size);
    if (slice.length > 0) await write(slice);
  }
}

async function advanceIdentity(tx: Tx) {
  await tx`select setval(pg_get_serial_sequence('events', 'id'), coalesce((select max(id) from events), 1), (select max(id) from events) is not null)`;
  await tx`select setval(pg_get_serial_sequence('sale_matches', 'id'), coalesce((select max(id) from sale_matches), 1), (select max(id) from sale_matches) is not null)`;
  await tx`select setval(pg_get_serial_sequence('cash_flows', 'id'), coalesce((select max(id) from cash_flows), 1), (select max(id) from cash_flows) is not null)`;
}

async function main() {
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
    ssl: "require",
  });
  const sqlite = new DatabaseSync(sqlitePath);
  try {
    for (const statement of statements(fs.readFileSync(schemaPath, "utf8"))) {
      await sql.unsafe(statement);
    }

    const settings = sqlite.prepare("select wallet from settings where id = 1").get() as Row | undefined;
    const years = sqlite.prepare("select * from sync_years").all() as Row[];
    const transactions = sqlite.prepare("select * from transactions").all() as Row[];
    const pools = sqlite.prepare("select * from pools").all() as Row[];
    const positions = sqlite.prepare("select * from positions").all() as Row[];
    const events = sqlite.prepare("select * from events").all() as Row[];
    const lots = sqlite.prepare("select * from lots").all() as Row[];
    const sales = sqlite.prepare("select * from sales").all() as Row[];
    const matches = sqlite.prepare("select * from sale_matches").all() as Row[];
    const cashFlows = sqlite.prepare("select * from cash_flows").all() as Row[];
    const costs = sqlite.prepare("select * from position_costs").all() as Row[];

    await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '10min'`;
      await tx`truncate table sale_matches, sales, lots, cash_flows, events, positions, pools, transactions, sync_years, position_costs, settings restart identity`;
      await tx`insert into settings (id, wallet) values (1, ${text(settings?.wallet) ?? ""})`;

      await insertChunks(
        tx,
        years.map((row) => ({
          year: requiredInteger(row.year),
          newest_block_time: integer(row.newest_block_time),
          tx_count: requiredInteger(row.tx_count),
          updated_at: requiredInteger(row.updated_at),
        })),
        100,
        async (slice) => {
          await tx`insert into sync_years ${tx(slice, "year", "newest_block_time", "tx_count", "updated_at")}`;
        },
      );

      await insertChunks(
        tx,
        transactions.map((row) => ({
          signature: String(row.signature),
          slot: requiredInteger(row.slot),
          tx_index: requiredInteger(row.tx_index),
          block_time: requiredInteger(row.block_time),
          raw_json: String(row.raw_json),
        })),
        20,
        async (slice) => {
          await tx`insert into transactions ${tx(slice, "signature", "slot", "tx_index", "block_time", "raw_json")}`;
        },
      );

      await insertChunks(
        tx,
        pools.map((row) => ({
          id: String(row.id),
          mint0: text(row.mint0),
          mint1: text(row.mint1),
          decimals0: integer(row.decimals0),
          decimals1: integer(row.decimals1),
          symbol0: text(row.symbol0),
          symbol1: text(row.symbol1),
          sqrt_price_x64: text(row.sqrt_price_x64),
          tick_current: integer(row.tick_current),
          updated_at: requiredInteger(row.updated_at),
        })),
        100,
        async (slice) => {
          await tx`insert into pools ${tx(slice, "id", "mint0", "mint1", "decimals0", "decimals1", "symbol0", "symbol1", "sqrt_price_x64", "tick_current", "updated_at")}`;
        },
      );

      await insertChunks(
        tx,
        positions.map((row) => ({
          nft_mint: String(row.nft_mint),
          pool_id: text(row.pool_id),
          tick_lower: integer(row.tick_lower),
          tick_upper: integer(row.tick_upper),
          opened_at: integer(row.opened_at),
          closed_at: integer(row.closed_at),
          status: String(row.status),
          liquidity: String(row.liquidity ?? "0"),
          amount0: text(row.amount0),
          amount1: text(row.amount1),
          fee_owed0: String(row.fee_owed0 ?? "0"),
          fee_owed1: String(row.fee_owed1 ?? "0"),
          in_range: flag(row.in_range),
          updated_at: requiredInteger(row.updated_at),
        })),
        100,
        async (slice) => {
          await tx`insert into positions ${tx(slice, "nft_mint", "pool_id", "tick_lower", "tick_upper", "opened_at", "closed_at", "status", "liquidity", "amount0", "amount1", "fee_owed0", "fee_owed1", "in_range", "updated_at")}`;
        },
      );

      await insertChunks(
        tx,
        events.map((row) => ({
          id: requiredInteger(row.id),
          signature: String(row.signature),
          slot: requiredInteger(row.slot),
          tx_index: requiredInteger(row.tx_index),
          event_index: requiredInteger(row.event_index),
          block_time: requiredInteger(row.block_time),
          nft_mint: String(row.nft_mint),
          pool_id: text(row.pool_id),
          kind: String(row.kind),
          liquidity: String(row.liquidity),
          amount0: String(row.amount0),
          amount1: String(row.amount1),
          fee0: String(row.fee0),
          fee1: String(row.fee1),
          sqrt_price_x64: text(row.sqrt_price_x64),
          mint0: text(row.mint0),
          mint1: text(row.mint1),
          tick_lower: integer(row.tick_lower),
          tick_upper: integer(row.tick_upper),
        })),
        100,
        async (slice) => {
          await tx`insert into events ${tx(slice, "id", "signature", "slot", "tx_index", "event_index", "block_time", "nft_mint", "pool_id", "kind", "liquidity", "amount0", "amount1", "fee0", "fee1", "sqrt_price_x64", "mint0", "mint1", "tick_lower", "tick_upper")}`;
        },
      );

      await insertChunks(
        tx,
        lots.map((row) => ({
          id: requiredInteger(row.id),
          nft_mint: String(row.nft_mint),
          mint: String(row.mint),
          kind: String(row.kind),
          amount: String(row.amount),
          remaining: String(row.remaining),
          cost: text(row.cost),
          cost_remaining: text(row.cost_remaining),
          block_time: requiredInteger(row.block_time),
          slot: requiredInteger(row.slot),
          tx_index: requiredInteger(row.tx_index),
          event_index: requiredInteger(row.event_index),
          signature: String(row.signature),
        })),
        100,
        async (slice) => {
          await tx`insert into lots ${tx(slice, "id", "nft_mint", "mint", "kind", "amount", "remaining", "cost", "cost_remaining", "block_time", "slot", "tx_index", "event_index", "signature")}`;
        },
      );

      await insertChunks(
        tx,
        sales.map((row) => ({
          id: requiredInteger(row.id),
          signature: String(row.signature),
          block_time: requiredInteger(row.block_time),
          slot: requiredInteger(row.slot),
          tx_index: requiredInteger(row.tx_index),
          mint: String(row.mint),
          amount: String(row.amount),
          usdc: String(row.usdc),
          router: text(row.router),
        })),
        100,
        async (slice) => {
          await tx`insert into sales ${tx(slice, "id", "signature", "block_time", "slot", "tx_index", "mint", "amount", "usdc", "router")}`;
        },
      );

      await insertChunks(
        tx,
        matches.map((row) => ({
          id: requiredInteger(row.id),
          sale_id: requiredInteger(row.sale_id),
          lot_id: requiredInteger(row.lot_id),
          nft_mint: String(row.nft_mint),
          mint: String(row.mint),
          lot_kind: String(row.lot_kind),
          amount: String(row.amount),
          usdc: String(row.usdc),
          cost: text(row.cost),
          block_time: requiredInteger(row.block_time),
          signature: String(row.signature),
        })),
        100,
        async (slice) => {
          await tx`insert into sale_matches ${tx(slice, "id", "sale_id", "lot_id", "nft_mint", "mint", "lot_kind", "amount", "usdc", "cost", "block_time", "signature")}`;
        },
      );

      await insertChunks(
        tx,
        cashFlows.map((row) => ({
          id: requiredInteger(row.id),
          nft_mint: String(row.nft_mint),
          signature: String(row.signature),
          block_time: requiredInteger(row.block_time),
          slot: requiredInteger(row.slot),
          tx_index: requiredInteger(row.tx_index),
          kind: String(row.kind),
          amount: String(row.amount),
          cost: text(row.cost),
        })),
        100,
        async (slice) => {
          await tx`insert into cash_flows ${tx(slice, "id", "nft_mint", "signature", "block_time", "slot", "tx_index", "kind", "amount", "cost")}`;
        },
      );

      await insertChunks(
        tx,
        costs.map((row) => ({
          nft_mint: String(row.nft_mint),
          cost: text(row.cost),
        })),
        100,
        async (slice) => {
          await tx`insert into position_costs ${tx(slice, "nft_mint", "cost")}`;
        },
      );

      await advanceIdentity(tx);
    });

    console.log(
      `Imported ${transactions.length.toLocaleString("en-US")} transactions, ${positions.length.toLocaleString("en-US")} positions, and ${years.length.toLocaleString("en-US")} saved years.`,
    );
  } finally {
    sqlite.close();
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
