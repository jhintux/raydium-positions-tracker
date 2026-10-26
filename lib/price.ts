import BN from "bn.js";
import Decimal from "decimal.js";
import { LiquidityMathUtil, TickUtil } from "@raydium-io/raydium-sdk-v2";
import { USDC_MINT } from "./constants";

export type PoolMeta = {
  id: string;
  mint0: string | null;
  mint1: string | null;
  decimals0: number | null;
  decimals1: number | null;
  symbol0: string | null;
  symbol1: string | null;
  sqrtPriceX64: bigint | null;
  tickCurrent: number | null;
};

export function tokenPriceInUsdc(pool: PoolMeta, sqrtPriceX64: bigint, mint: string) {
  if (mint === USDC_MINT) return new Decimal(1);
  if (!pool.mint0 || !pool.mint1 || pool.decimals0 == null || pool.decimals1 == null) return null;
  if (mint !== pool.mint0 && mint !== pool.mint1) return null;
  if (pool.mint0 !== USDC_MINT && pool.mint1 !== USDC_MINT) return null;
  const price0 = TickUtil.sqrtPriceX64ToPrice(new BN(sqrtPriceX64.toString()), pool.decimals0, pool.decimals1);
  if (!price0.isFinite() || price0.lte(0)) return null;
  if (mint === pool.mint0 && pool.mint1 === USDC_MINT) return price0;
  if (mint === pool.mint1 && pool.mint0 === USDC_MINT) return new Decimal(1).div(price0);
  return null;
}

export function usdcMicro(pool: PoolMeta, mint: string, raw: bigint, sqrtPriceX64: bigint | null) {
  if (raw === 0n) return 0n;
  if (mint === USDC_MINT) return raw;
  if (sqrtPriceX64 == null) return null;
  const price = tokenPriceInUsdc(pool, sqrtPriceX64, mint);
  if (!price) return null;
  const decimals = mint === pool.mint0 ? pool.decimals0 : pool.decimals1;
  if (decimals == null) return null;
  const ui = new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));
  return BigInt(ui.mul(price).mul(1_000_000).toFixed(0));
}

export function amountsFromLiquidity(sqrtPriceX64: bigint, tickLower: number, tickUpper: number, liquidity: bigint) {
  const current = new BN(sqrtPriceX64.toString());
  const lower = TickUtil.getSqrtPriceAtTick(tickLower);
  const upper = TickUtil.getSqrtPriceAtTick(tickUpper);
  const amounts = LiquidityMathUtil.getAmountsForLiquidity(
    current,
    lower,
    upper,
    new BN(liquidity.toString()),
    false,
  );
  return {
    amount0: BigInt(amounts.amountA.toString()),
    amount1: BigInt(amounts.amountB.toString()),
  };
}
