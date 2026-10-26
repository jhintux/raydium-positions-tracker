import { Connection, PublicKey } from "@solana/web3.js";
import { PoolInfoLayout } from "@raydium-io/raydium-sdk-v2";
import { RAYDIUM_API } from "./constants";
import { solanaRpcUrl } from "./helius";
import type { PoolMeta } from "./price";

export function rpcConnection() {
  return new Connection(solanaRpcUrl(), "confirmed");
}

type ApiMint = { address?: string; symbol?: string; decimals?: number };
type ApiPool = { id?: string; mintA?: ApiMint; mintB?: ApiMint };

export async function fetchPoolAccounts(connection: Connection, ids: string[]) {
  const decoded = new Map<string, PoolMeta>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const slice = ids.slice(offset, offset + 100);
    const infos = await connection.getMultipleAccountsInfo(slice.map((id) => new PublicKey(id)));
    infos.forEach((info, index) => {
      if (!info) return;
      try {
        const pool = PoolInfoLayout.decode(info.data);
        decoded.set(slice[index], {
          id: slice[index],
          mint0: pool.mintA.toBase58(),
          mint1: pool.mintB.toBase58(),
          decimals0: pool.mintDecimalsA,
          decimals1: pool.mintDecimalsB,
          symbol0: null,
          symbol1: null,
          sqrtPriceX64: BigInt(pool.sqrtPriceX64.toString()),
          tickCurrent: pool.tickCurrent,
        });
      } catch {
        return;
      }
    });
  }
  return decoded;
}

export async function fetchPoolNames(ids: string[]) {
  const names = new Map<string, { symbol0: string | null; symbol1: string | null; mint0: string | null; mint1: string | null; decimals0: number | null; decimals1: number | null }>();
  for (let offset = 0; offset < ids.length; offset += 20) {
    const slice = ids.slice(offset, offset + 20);
    const response = await fetch(`${RAYDIUM_API}/pools/info/ids?ids=${slice.join(",")}`);
    if (!response.ok) continue;
    const json = (await response.json()) as { data?: ApiPool[] };
    for (const pool of json.data ?? []) {
      if (!pool.id) continue;
      names.set(pool.id, {
        symbol0: pool.mintA?.symbol ?? null,
        symbol1: pool.mintB?.symbol ?? null,
        mint0: pool.mintA?.address ?? null,
        mint1: pool.mintB?.address ?? null,
        decimals0: pool.mintA?.decimals ?? null,
        decimals1: pool.mintB?.decimals ?? null,
      });
    }
  }
  return names;
}

type PoolNames = {
  symbol0: string | null;
  symbol1: string | null;
  mint0: string | null;
  mint1: string | null;
  decimals0: number | null;
  decimals1: number | null;
};

export function mergePool(id: string, chain: PoolMeta | undefined, api: PoolNames | undefined, discovered?: Partial<PoolMeta>): PoolMeta {
  return {
    id,
    mint0: chain?.mint0 ?? api?.mint0 ?? discovered?.mint0 ?? null,
    mint1: chain?.mint1 ?? api?.mint1 ?? discovered?.mint1 ?? null,
    decimals0: chain?.decimals0 ?? api?.decimals0 ?? discovered?.decimals0 ?? null,
    decimals1: chain?.decimals1 ?? api?.decimals1 ?? discovered?.decimals1 ?? null,
    symbol0: api?.symbol0 ?? chain?.symbol0 ?? null,
    symbol1: api?.symbol1 ?? chain?.symbol1 ?? null,
    sqrtPriceX64: chain?.sqrtPriceX64 ?? discovered?.sqrtPriceX64 ?? null,
    tickCurrent: chain?.tickCurrent ?? discovered?.tickCurrent ?? null,
  };
}
