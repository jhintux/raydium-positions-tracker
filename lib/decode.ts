import bs58 from "bs58";
import { CLMM_PROGRAM_ID } from "./constants";

const EVENT = {
  collect: [166, 174, 105, 192, 81, 161, 83, 105],
  create: [100, 30, 87, 249, 196, 223, 154, 206],
  decrease: [58, 222, 86, 58, 68, 50, 85, 56],
  increase: [49, 79, 105, 212, 32, 34, 30, 84],
  calculate: [237, 112, 148, 230, 57, 84, 180, 162],
  swap: [64, 198, 205, 232, 38, 8, 113, 226],
} as const;

const INSTRUCTIONS = [
  { disc: [135, 128, 47, 77, 15, 152, 240, 49], kind: "open", owner: 1, nft: 2, pool: 5, mint0: -1, mint1: -1 },
  { disc: [77, 184, 74, 214, 112, 86, 241, 199], kind: "open", owner: 1, nft: 2, pool: 5, mint0: 20, mint1: 21 },
  { disc: [77, 255, 174, 82, 125, 29, 201, 46], kind: "open", owner: 1, nft: 2, pool: 4, mint0: 18, mint1: 19 },
  { disc: [46, 156, 243, 118, 13, 205, 251, 178], kind: "increase", owner: 0, nft: -1, pool: 2, mint0: -1, mint1: -1 },
  { disc: [133, 29, 89, 223, 69, 238, 176, 10], kind: "increase", owner: 0, nft: -1, pool: 2, mint0: 13, mint1: 14 },
  { disc: [160, 38, 208, 111, 104, 91, 44, 1], kind: "decrease", owner: 0, nft: -1, pool: 3, mint0: -1, mint1: -1 },
  { disc: [58, 127, 188, 62, 79, 82, 196, 96], kind: "decrease", owner: 0, nft: -1, pool: 3, mint0: 14, mint1: 15 },
  { disc: [123, 134, 81, 0, 49, 68, 98, 98], kind: "close", owner: 0, nft: 1, pool: -1, mint0: -1, mint1: -1 },
] as const;

export type ClmmInstruction = {
  kind: "open" | "increase" | "decrease" | "close";
  owner: string | null;
  nft: string | null;
  pool: string | null;
  mint0: string | null;
  mint1: string | null;
};

export type CreateEvent = {
  type: "create";
  pool: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  transferFee0: bigint;
  transferFee1: bigint;
};

export type IncreaseEvent = {
  type: "increase";
  nft: string;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  transferFee0: bigint;
  transferFee1: bigint;
};

export type DecreaseEvent = {
  type: "decrease";
  nft: string;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  fee0: bigint;
  fee1: bigint;
  transferFee0: bigint;
  transferFee1: bigint;
};

export type CollectEvent = {
  type: "collect";
  nft: string;
  amount0: bigint;
  amount1: bigint;
};

export type CalculateEvent = { type: "calculate"; sqrtPriceX64: bigint };
export type SwapPriceEvent = { type: "swap"; pool: string; sqrtPriceX64: bigint };

export type DecodedLog =
  | CreateEvent
  | IncreaseEvent
  | DecreaseEvent
  | CollectEvent
  | CalculateEvent
  | SwapPriceEvent;

class Reader {
  constructor(
    private buf: Uint8Array,
    private offset = 0,
  ) {}

  remaining() {
    return this.buf.length - this.offset;
  }

  u64() {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 8);
    const value = view.getBigUint64(0, true);
    this.offset += 8;
    return value;
  }

  u128() {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << 64n) + lo;
  }

  i32() {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 4);
    const value = view.getInt32(0, true);
    this.offset += 4;
    return value;
  }

  pubkey() {
    const slice = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return bs58.encode(slice);
  }

  bool() {
    const value = this.buf[this.offset] !== 0;
    this.offset += 1;
    return value;
  }
}

function matches(buf: Uint8Array, disc: readonly number[]) {
  if (buf.length < disc.length) return false;
  return disc.every((byte, index) => buf[index] === byte);
}

function findInstruction(data: Uint8Array) {
  return INSTRUCTIONS.find((entry) => matches(data, entry.disc)) ?? null;
}

export function decodeEvent(buf: Uint8Array): DecodedLog | null {
  try {
    if (matches(buf, EVENT.create) && buf.length >= 8 + 136) {
      const reader = new Reader(buf, 8);
      const pool = reader.pubkey();
      reader.pubkey();
      const owner = reader.pubkey();
      const tickLower = reader.i32();
      const tickUpper = reader.i32();
      const liquidity = reader.u128();
      const amount0 = reader.u64();
      const amount1 = reader.u64();
      const transferFee0 = reader.remaining() >= 8 ? reader.u64() : 0n;
      const transferFee1 = reader.remaining() >= 8 ? reader.u64() : 0n;
      return { type: "create", pool, owner, tickLower, tickUpper, liquidity, amount0, amount1, transferFee0, transferFee1 };
    }
    if (matches(buf, EVENT.increase) && buf.length >= 8 + 64) {
      const reader = new Reader(buf, 8);
      const nft = reader.pubkey();
      const liquidity = reader.u128();
      const amount0 = reader.u64();
      const amount1 = reader.u64();
      const transferFee0 = reader.remaining() >= 8 ? reader.u64() : 0n;
      const transferFee1 = reader.remaining() >= 8 ? reader.u64() : 0n;
      return { type: "increase", nft, liquidity, amount0, amount1, transferFee0, transferFee1 };
    }
    if (matches(buf, EVENT.decrease) && buf.length >= 8 + 80) {
      const reader = new Reader(buf, 8);
      const nft = reader.pubkey();
      const liquidity = reader.u128();
      const amount0 = reader.u64();
      const amount1 = reader.u64();
      const fee0 = reader.u64();
      const fee1 = reader.u64();
      if (reader.remaining() >= 24) {
        reader.u64();
        reader.u64();
        reader.u64();
      }
      const transferFee0 = reader.remaining() >= 8 ? reader.u64() : 0n;
      const transferFee1 = reader.remaining() >= 8 ? reader.u64() : 0n;
      return { type: "decrease", nft, liquidity, amount0, amount1, fee0, fee1, transferFee0, transferFee1 };
    }
    if (matches(buf, EVENT.collect) && buf.length >= 8 + 112) {
      const reader = new Reader(buf, 8);
      const nft = reader.pubkey();
      reader.pubkey();
      reader.pubkey();
      return { type: "collect", nft, amount0: reader.u64(), amount1: reader.u64() };
    }
    if (matches(buf, EVENT.calculate) && buf.length >= 8 + 36) {
      const reader = new Reader(buf, 8);
      reader.u128();
      return { type: "calculate", sqrtPriceX64: reader.u128() };
    }
    if (matches(buf, EVENT.swap) && buf.length >= 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 16) {
      const reader = new Reader(buf, 8);
      const pool = reader.pubkey();
      reader.pubkey();
      reader.pubkey();
      reader.pubkey();
      reader.u64();
      reader.u64();
      reader.u64();
      reader.u64();
      reader.bool();
      return { type: "swap", pool, sqrtPriceX64: reader.u128() };
    }
  } catch {
    return null;
  }
  return null;
}

export function decodeLogs(lines: string[]) {
  const events: DecodedLog[] = [];
  for (const line of lines) {
    const marker = "Program data: ";
    const at = line.indexOf(marker);
    if (at === -1) continue;
    const raw = Buffer.from(line.slice(at + marker.length).trim(), "base64");
    const event = decodeEvent(raw);
    if (event) events.push(event);
  }
  return events;
}

function instructionData(data: unknown) {
  if (typeof data !== "string" || data.length === 0) return Buffer.alloc(0);
  try {
    return Buffer.from(bs58.decode(data));
  } catch {
    try {
      return Buffer.from(data, "base64");
    } catch {
      return Buffer.alloc(0);
    }
  }
}

export function decodeClmmInstruction(data: Uint8Array, accounts: string[]): ClmmInstruction | null {
  const found = findInstruction(data);
  if (!found) return null;
  const at = (index: number) => (index >= 0 && index < accounts.length ? accounts[index] : null);
  return {
    kind: found.kind,
    owner: at(found.owner),
    nft: at(found.nft),
    pool: at(found.pool),
    mint0: at(found.mint0),
    mint1: at(found.mint1),
  };
}

type InstructionLike = {
  programId?: string;
  programIdIndex?: number;
  accounts?: (string | number)[];
  data?: string;
};

export function accountKeysOf(tx: { transaction?: { message?: { accountKeys?: unknown[] } }; meta?: { loadedAddresses?: { writable?: string[]; readonly?: string[] } } }) {
  const raw = tx.transaction?.message?.accountKeys ?? [];
  const keys = raw.map((key) => (typeof key === "string" ? key : (key as { pubkey?: string }).pubkey ?? "")).filter(Boolean);
  const loaded = [...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  for (const key of loaded) {
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function clmmInstructionsOf(tx: {
  transaction?: { message?: { accountKeys?: unknown[]; instructions?: InstructionLike[] } };
  meta?: { loadedAddresses?: { writable?: string[]; readonly?: string[] }; innerInstructions?: { index: number; instructions: InstructionLike[] }[] };
}) {
  const keys = accountKeysOf(tx);
  const outer = tx.transaction?.message?.instructions ?? [];
  const innerByOuter = new Map<number, InstructionLike[]>();
  for (const group of tx.meta?.innerInstructions ?? []) {
    innerByOuter.set(group.index, group.instructions);
  }
  const found: ClmmInstruction[] = [];
  const visit = (ix: InstructionLike) => {
    const programId = ix.programId ?? (typeof ix.programIdIndex === "number" ? keys[ix.programIdIndex] : null);
    if (programId !== CLMM_PROGRAM_ID) return;
    const accounts = (ix.accounts ?? []).map((account) => (typeof account === "number" ? keys[account] ?? "" : account));
    const decoded = decodeClmmInstruction(instructionData(ix.data), accounts);
    if (decoded) found.push(decoded);
  };
  outer.forEach((ix, index) => {
    visit(ix);
    for (const inner of innerByOuter.get(index) ?? []) visit(inner);
  });
  return found;
}
