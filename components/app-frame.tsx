import { connection } from "next/server";
import Link from "next/link";
import { getSettings } from "@/lib/db";
import { shortAddress } from "@/lib/format";

export async function AppFrame({ children }: { children: React.ReactNode }) {
  await connection();
  const settings = await getSettings();
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <Link href="/" className="text-2xl tracking-tight">
            Raydium ledger
          </Link>
          <p className="mt-1 text-sm text-muted">Concentrated positions, fees, and the sales that followed them.</p>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          {settings.wallet ? <span className="num text-muted">{shortAddress(settings.wallet)}</span> : null}
          <Link href="/settings" className="underline decoration-line underline-offset-4">
            Settings
          </Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
