"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncButton({ year, label }: { year: number; label?: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function sync() {
    setWorking(true);
    setFailed(false);
    setMessage(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Sync failed");
      setMessage(body.message ?? "Saved.");
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={working}
        className="rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-60"
      >
        {working ? `Syncing ${year}…` : (label ?? `Sync ${year}`)}
      </button>
      {message ? <p className={failed ? "max-w-md text-sm text-loss" : "max-w-md text-sm text-muted"}>{message}</p> : null}
    </div>
  );
}
