import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bs58 from "bs58";
import { inferSales, netOfTransferFee } from "../lib/amounts";
import { USDC_MINT } from "../lib/constants";
import { decodeEvent } from "../lib/decode";
import { buildLedger } from "../lib/ledger";
import { parseTransaction, type ParsedEvent } from "../lib/parse";
import { presentMonth } from "../lib/present";
import { tokenPriceInUsdc, type PoolMeta } from "../lib/price";
import { inMonth } from "../lib/time";

const STOCK = "So11111111111111111111111111111111111111112";
const NFT = "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv";
const POOL = "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv";
const WALLET = "11111111111111111111111111111111";

const pool: PoolMeta = {
  id: POOL,
  mint0: STOCK,
  mint1: USDC_MINT,
  decimals0: 6,
  decimals1: 6,
  symbol0: "STOCK",
  symbol1: "USDC",
  sqrtPriceX64: 1n << 64n,
  tickCurrent: 0,
};

describe("amounts", () => {
  it("nets a transfer fee across principal and fees", () => {
    const net = netOfTransferFee(80n, 20n, 10n);
    assert.equal(net.principal + net.fee, 90n);
    assert.equal(net.fee, 18n);
  });

  it("treats a harvest-and-sell as a sale", () => {
    const sales = inferSales({
      stockMints: [STOCK],
      deltas: new Map([[STOCK, 0n], [USDC_MINT, 150_000n]]),
      clmmNet: new Map([[STOCK, 100_000n]]),
      usdcMint: USDC_MINT,
    });
    assert.deepEqual(sales, [{ mint: STOCK, amount: 100_000n, usdc: 150_000n }]);
  });

  it("does not treat a deposit as a sale", () => {
    const sales = inferSales({
      stockMints: [STOCK],
      deltas: new Map([[STOCK, -1_000_000n], [USDC_MINT, -2_000_000n]]),
      clmmNet: new Map([[STOCK, -1_000_000n], [USDC_MINT, -2_000_000n]]),
      usdcMint: USDC_MINT,
    });
    assert.equal(sales.length, 0);
  });
});

describe("price", () => {
  it("reads a 1:1 pool price from sqrt price", () => {
    const price = tokenPriceInUsdc(pool, 1n << 64n, STOCK);
    assert.ok(price);
    assert.equal(price.toFixed(6), "1.000000");
  });
});

describe("ledger", () => {
  it("matches a fee sale before principal and keeps USDC fees as profit", () => {
    const open = event({ kind: "open", amount0: 1_000_000n, amount1: 2_000_000n, liquidity: 100n, blockTime: 1_700_000_000 });
    const collect = event({
      kind: "collect",
      fee0: 100_000n,
      blockTime: 1_700_000_100,
      eventIndex: 1,
      signature: "collect",
    });
    const remove = event({
      kind: "remove",
      amount0: 1_000_000n,
      amount1: 2_000_000n,
      liquidity: 100n,
      blockTime: 1_700_000_200,
      eventIndex: 2,
      signature: "remove",
    });
    const ledger = buildLedger(
      [open, collect, remove],
      [{ signature: "sale", slot: 2, txIndex: 0, blockTime: 1_700_000_150, mint: STOCK, amount: 100_000n, usdc: 150_000n, router: "Jupiter" }],
      new Map([[POOL, pool]]),
    );
    assert.equal(ledger.positions[0]?.cost, 3_000_000n);
    assert.equal(ledger.lots.find((lot) => lot.kind === "fee")?.remaining, 0n);
    assert.equal(ledger.matches[0]?.lotKind, "fee");
    assert.equal(ledger.matches[0]?.usdc, 150_000n);
    assert.equal(ledger.cashFlows.find((row) => row.kind === "usdc_principal")?.cost, 2_000_000n);
    const when = inMonth(1_700_000_100, new Date(1_700_000_100 * 1000).getFullYear(), new Date(1_700_000_100 * 1000).getMonth() + 1);
    assert.equal(when, true);
    const facts = {
      events: [open, collect, remove],
      lots: ledger.lots,
      matches: ledger.matches,
      cashFlows: ledger.cashFlows,
      sales: ledger.sales,
      positions: new Map(),
      pools: new Map([[POOL, pool]]),
      costs: new Map([[NFT, ledger.positions[0]?.cost ?? null]]),
    };
    const parts = new Date(1_700_000_150 * 1000);
    const month = presentMonth(facts, parts.getFullYear(), parts.getMonth() + 1, parts);
    assert.equal(month.feeSaleMicro, 150_000n);
    assert.equal(month.positions.length, 1);
  });

  it("leaves a later principal sale labeled as principal", () => {
    const open = event({ kind: "open", amount0: 1_000_000n, amount1: 0n, liquidity: 50n, blockTime: 1_700_000_000 });
    const remove = event({
      kind: "remove",
      amount0: 1_000_000n,
      liquidity: 50n,
      blockTime: 1_700_000_050,
      signature: "remove",
    });
    const ledger = buildLedger(
      [open, remove],
      [{ signature: "sale", slot: 3, txIndex: 0, blockTime: 1_700_000_080, mint: STOCK, amount: 1_000_000n, usdc: 900_000n, router: null }],
      new Map([[POOL, pool]]),
    );
    assert.equal(ledger.matches.length, 1);
    assert.equal(ledger.matches[0]?.lotKind, "principal");
    assert.equal(ledger.lots[0]?.remaining, 0n);
  });
});

describe("parser", () => {
  it("reads an open-position event from logs", () => {
    const raw = encodeCreate({ amount0: 5n, amount1: 7n, liquidity: 9n });
    const logs = [`Program data: ${raw.toString("base64")}`];
    const tx = {
      slot: 10,
      transactionIndex: 1,
      blockTime: 1_700_000_000,
      transaction: {
        signatures: ["sig"],
        message: {
          accountKeys: Array.from({ length: 20 }, () => WALLET),
          instructions: [
            {
              programId: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
              accounts: accounts(),
              data: bs58.encode(Buffer.from([77, 255, 174, 82, 125, 29, 201, 46])),
            },
          ],
        },
      },
      meta: { err: null, logMessages: logs, preTokenBalances: [], postTokenBalances: [] },
    };
    tx.transaction.message.accountKeys[1] = WALLET;
    tx.transaction.message.accountKeys[2] = NFT;
    tx.transaction.message.instructions[0].accounts = accounts();
    const parsed = parseTransaction(tx, WALLET);
    assert.ok(parsed);
    assert.equal(parsed.events[0]?.kind, "open");
    assert.equal(parsed.events[0]?.nftMint, NFT);
    assert.equal(parsed.events[0]?.amount0, 5n);
    assert.equal(parsed.events[0]?.amount1, 7n);
    const decoded = decodeEvent(raw);
    assert.equal(decoded?.type, "create");
  });
});

function event(partial: Partial<ParsedEvent> & { kind: ParsedEvent["kind"]; blockTime: number }): ParsedEvent {
  return {
    signature: partial.signature ?? "open",
    slot: partial.slot ?? 1,
    txIndex: partial.txIndex ?? 0,
    eventIndex: partial.eventIndex ?? 0,
    blockTime: partial.blockTime,
    nftMint: NFT,
    poolId: POOL,
    kind: partial.kind,
    liquidity: partial.liquidity ?? 0n,
    amount0: partial.amount0 ?? 0n,
    amount1: partial.amount1 ?? 0n,
    fee0: partial.fee0 ?? 0n,
    fee1: partial.fee1 ?? 0n,
    sqrtPriceX64: 1n << 64n,
    mint0: STOCK,
    mint1: USDC_MINT,
    tickLower: -10,
    tickUpper: 10,
  };
}

function accounts() {
  const list = Array.from({ length: 20 }, () => WALLET);
  list[1] = WALLET;
  list[2] = NFT;
  list[4] = POOL;
  list[18] = STOCK;
  list[19] = USDC_MINT;
  return list;
}

function encodeCreate(input: { amount0: bigint; amount1: bigint; liquidity: bigint }) {
  const buf = Buffer.alloc(8 + 32 * 3 + 4 + 4 + 16 + 8 * 4);
  Buffer.from([100, 30, 87, 249, 196, 223, 154, 206]).copy(buf, 0);
  let offset = 8;
  const writePubkey = (value: string) => {
    Buffer.from(bs58.decode(value)).copy(buf, offset);
    offset += 32;
  };
  writePubkey(POOL);
  writePubkey(WALLET);
  writePubkey(WALLET);
  buf.writeInt32LE(-10, offset);
  offset += 4;
  buf.writeInt32LE(10, offset);
  offset += 4;
  writeU128(buf, offset, input.liquidity);
  offset += 16;
  writeU64(buf, offset, input.amount0);
  offset += 8;
  writeU64(buf, offset, input.amount1);
  return buf;
}

function writeU64(buf: Buffer, offset: number, value: bigint) {
  buf.writeBigUInt64LE(value, offset);
}

function writeU128(buf: Buffer, offset: number, value: bigint) {
  buf.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  buf.writeBigUInt64LE(value >> 64n, offset + 8);
}
