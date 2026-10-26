import { yearWindow } from "./time";

export type HeliusTransaction = {
  signature?: string;
  slot: number;
  transactionIndex?: number;
  blockTime: number | null;
  transaction?: { signatures?: string[] };
  meta?: { err?: unknown };
};

function redact(message: string) {
  return message.replace(/api-key=[^&\s"']+/gi, "api-key=***");
}

export function solanaRpcUrl() {
  const url = process.env.SOLANA_RPC_URL?.trim() ?? "";
  if (!url) throw new Error("SOLANA_RPC_URL is not set.");
  return url;
}

export async function fetchYear(wallet: string, year: number, newestStored: number | null) {
  const now = new Date();
  const window = yearWindow(year, now);
  const filters: { blockTime: { gte?: number; gt?: number; lt?: number; lte?: number }; status: string; tokenAccounts: string } = {
    blockTime: {},
    status: "succeeded",
    tokenAccounts: "balanceChanged",
  };
  if (year === now.getFullYear() && newestStored != null) {
    filters.blockTime.gt = Math.max(window.gte, newestStored - 120);
    if (window.lte != null) filters.blockTime.lte = window.lte;
  } else {
    filters.blockTime.gte = window.gte;
    if (window.lt != null) filters.blockTime.lt = window.lt;
    if (window.lte != null) filters.blockTime.lte = window.lte;
  }

  const rows: HeliusTransaction[] = [];
  let paginationToken: string | null = null;
  let pages = 0;
  let retries = 0;
  do {
    pages += 1;
    if (pages > 500) break;
    const body = {
      jsonrpc: "2.0",
      id: "ledger",
      method: "getTransactionsForAddress",
      params: [
        wallet,
        {
          transactionDetails: "full",
          encoding: "jsonParsed",
          sortOrder: "asc",
          limit: 1000,
          maxSupportedTransactionVersion: 1,
          commitment: "finalized",
          filters,
          ...(paginationToken ? { paginationToken } : {}),
        },
      ],
    };
    const response = await fetch(solanaRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 429 || response.status >= 500) {
      retries += 1;
      if (retries > 4) throw new Error("The Solana RPC proxy is rate limiting requests. Wait a moment and sync again.");
      await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
      pages -= 1;
      continue;
    }
    retries = 0;
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error("The Solana RPC proxy rejected the request.");
    }
    if (!response.ok) {
      throw new Error(redact(`RPC returned ${response.status}: ${text.slice(0, 280)}`));
    }
    const json = JSON.parse(text) as { error?: { message?: string }; result?: { data?: HeliusTransaction[]; paginationToken?: string | null } };
    if (json.error) throw new Error(redact(json.error.message ?? "RPC request failed"));
    const data = json.result?.data ?? [];
    rows.push(...data);
    const next = json.result?.paginationToken ?? null;
    if (!next || next === paginationToken) break;
    paginationToken = next;
  } while (paginationToken);

  return rows;
}
