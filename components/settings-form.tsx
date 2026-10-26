"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SettingsForm({ wallet }: { wallet: string }) {
  const router = useRouter();
  const [address, setAddress] = useState(wallet);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFailed(false);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save settings");
      setMessage("Saved.");
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Wallet address
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          required
          autoComplete="off"
          spellCheck={false}
          className="rounded-xl border border-line bg-card px-3 py-2 text-base"
        />
      </label>
      <p className="text-sm text-muted">The wallet is stored in the database. Changing it clears the saved history.</p>
      <button type="submit" disabled={saving} className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-60">
        {saving ? "Saving…" : "Save"}
      </button>
      {message ? <p className={failed ? "text-sm text-loss" : "text-sm text-gain"}>{message}</p> : null}
    </form>
  );
}
