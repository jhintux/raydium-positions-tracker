/** Split a wallet receipt into principal and fees after a Token-2022 transfer fee. */
export function netOfTransferFee(principal: bigint, fee: bigint, transferFee: bigint) {
  const gross = principal + fee;
  if (gross <= 0n) return { principal: 0n, fee: 0n };
  const net = transferFee >= gross ? 0n : gross - transferFee;
  if (net === gross) return { principal, fee };
  const feeNet = (fee * net) / gross;
  return { fee: feeNet, principal: net - feeNet };
}

export function depositPaid(amount: bigint, transferFee: bigint) {
  return amount + transferFee;
}

export type BalanceDelta = {
  mint: string;
  delta: bigint;
  decimals: number;
};

/**
 * Stock that left the wallet beyond CLMM deposits and withdrawals, paid for in USDC
 * that did not come from the CLMM program. This catches a harvest-and-sell in one
 * transaction, where the net stock balance can be flat.
 */
export function inferSales(input: {
  stockMints: string[];
  deltas: Map<string, bigint>;
  clmmNet: Map<string, bigint>;
  usdcMint: string;
}) {
  const usdcOutside = (input.deltas.get(input.usdcMint) ?? 0n) - (input.clmmNet.get(input.usdcMint) ?? 0n);
  if (usdcOutside <= 0n) return [];

  const sold: { mint: string; amount: bigint }[] = [];
  for (const mint of input.stockMints) {
    if (mint === input.usdcMint) continue;
    const extra = (input.clmmNet.get(mint) ?? 0n) - (input.deltas.get(mint) ?? 0n);
    if (extra > 0n) sold.push({ mint, amount: extra });
  }
  if (sold.length === 0) return [];
  if (sold.length === 1) return [{ mint: sold[0].mint, amount: sold[0].amount, usdc: usdcOutside }];

  const total = sold.reduce((sum, row) => sum + row.amount, 0n);
  let usdcLeft = usdcOutside;
  return sold.map((row, index) => {
    const usdc = index === sold.length - 1 ? usdcLeft : (usdcOutside * row.amount) / total;
    usdcLeft -= usdc;
    return { mint: row.mint, amount: row.amount, usdc };
  });
}
