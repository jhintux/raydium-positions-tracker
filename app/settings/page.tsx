import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsForm } from "@/components/settings-form";
import { getSettings, listSyncYears } from "@/lib/db";
import { formatTimestamp } from "@/lib/time";

export const instant = false;

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading settings…</p>}>
      <SettingsBody />
    </Suspense>
  );
}

async function SettingsBody() {
  await connection();
  const settings = await getSettings();
  const years = await listSyncYears();
  return (
    <section>
      <h1 className="text-3xl tracking-tight">Settings</h1>
      <p className="mt-2 max-w-xl text-muted">
        One wallet. History is read through the Solana RPC proxy and stored in the database. The first sync loads the current calendar year. Opening an earlier year loads only that year.
      </p>
      <SettingsForm wallet={settings.wallet} />
      <div className="mt-8">
        <h2 className="text-lg">Saved years</h2>
        {years.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing is saved yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {years.map((year) => (
              <li key={year.year}>
                <span className="num">{year.year}</span>
                <span className="text-muted">
                  {" "}
                  · {year.txCount.toLocaleString("en-US")} transactions · updated {formatTimestamp(Math.floor(year.updatedAt / 1000))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
