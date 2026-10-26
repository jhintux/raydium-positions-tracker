# Raydium ledger

Ledger for one wallet’s Raydium concentrated-liquidity positions. History is fetched through a Solana RPC proxy and stored in Supabase.

```bash
npm install
```

Copy `.env.example` to `.env.local` and set:

- `SOLANA_RPC_URL` — server-only proxy URL. The Helius key stays on that worker.
- `DATABASE_URL` — Supabase transaction-pooler URI (port 6543).

Apply the schema and copy the local SQLite ledger (this does not re-download history):

```bash
npm run import:sqlite
npm run dev
```

Open the app, enter the wallet if it is not already saved, then open the current month. A later sync of the current year asks only for transactions newer than the saved block time. Opening an earlier year loads only that year.

`data/tracker.db` stays local and is not committed. The import copies the wallet and the ledger rows. It does not copy the Helius key stored in that file.
