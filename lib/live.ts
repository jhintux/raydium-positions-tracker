import { PublicKey } from "@solana/web3.js";
import {
  CLMM_PROGRAM_ID,
  PersonalPositionLayout,
  getPdaPersonalPositionAddress,
} from "@raydium-io/raydium-sdk-v2";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants";
import { upsertLivePosition } from "./db";
import { amountsFromLiquidity } from "./price";
import { fetchPoolAccounts, rpcConnection } from "./pools";

export async function heldPositionMints(wallet: string) {
  const connection = rpcConnection();
  const owner = new PublicKey(wallet);
  const mints: string[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(programId) });
    for (const account of accounts.value) {
      const info = account.account.data.parsed.info as { mint?: string; tokenAmount?: { amount?: string; decimals?: number } };
      if (info.tokenAmount?.amount === "1" && info.tokenAmount.decimals === 0 && info.mint) mints.push(info.mint);
    }
  }
  return { connection, mints };
}

export async function refreshOpenPositions(wallet: string) {
  const { connection, mints } = await heldPositionMints(wallet);
  const programId = CLMM_PROGRAM_ID instanceof PublicKey ? CLMM_PROGRAM_ID : new PublicKey(String(CLMM_PROGRAM_ID));
  const pdas = mints.map((mint) => getPdaPersonalPositionAddress(programId, new PublicKey(mint)).publicKey);
  const positions: {
    nftMint: string;
    poolId: string;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    feeOwed0: bigint;
    feeOwed1: bigint;
  }[] = [];
  for (let offset = 0; offset < pdas.length; offset += 100) {
    const infos = await connection.getMultipleAccountsInfo(pdas.slice(offset, offset + 100));
    infos.forEach((info, index) => {
      if (!info) return;
      try {
        const decoded = PersonalPositionLayout.decode(info.data);
        positions.push({
          nftMint: mints[offset + index],
          poolId: decoded.poolId.toBase58(),
          tickLower: decoded.tickLower,
          tickUpper: decoded.tickUpper,
          liquidity: BigInt(decoded.liquidity.toString()),
          feeOwed0: BigInt(decoded.tokenFeesOwedA.toString()),
          feeOwed1: BigInt(decoded.tokenFeesOwedB.toString()),
        });
      } catch {
        return;
      }
    });
  }

  const pools = await fetchPoolAccounts(connection, [...new Set(positions.map((position) => position.poolId))]);
  for (const position of positions) {
    const pool = pools.get(position.poolId);
    let amount0 = 0n;
    let amount1 = 0n;
    let inRange = false;
    if (pool?.sqrtPriceX64 != null && pool.tickCurrent != null) {
      try {
        const amounts = amountsFromLiquidity(pool.sqrtPriceX64, position.tickLower, position.tickUpper, position.liquidity);
        amount0 = amounts.amount0;
        amount1 = amounts.amount1;
        inRange = position.tickLower <= pool.tickCurrent && pool.tickCurrent < position.tickUpper;
      } catch {
        amount0 = 0n;
        amount1 = 0n;
      }
    }
    await upsertLivePosition({
      nftMint: position.nftMint,
      poolId: position.poolId,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity,
      amount0,
      amount1,
      feeOwed0: position.feeOwed0,
      feeOwed1: position.feeOwed1,
      inRange,
    });
  }
  return { heldMints: mints, pools: [...pools.values()] };
}
