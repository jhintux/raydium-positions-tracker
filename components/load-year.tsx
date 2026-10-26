"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const inflight = new Map<number, Promise<{ ok: true } | { ok: false; message: string }>>();

function requestYear(year: number) {
  const existing = inflight.get(year);
  if (existing) return existing;
  const slot: { current?: Promise<{ ok: true } | { ok: false; message: string }> } = {};
  const promise = (async () => {
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) return { ok: false as const, message: body.error ?? "Could not load that year" };
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : "Could not load that year" };
    } finally {
      if (inflight.get(year) === slot.current) inflight.delete(year);
    }
  })();
  slot.current = promise;
  inflight.set(year, promise);
  return promise;
}

export function LoadYear({ year }: { year: number }) {
  const router = useRouter();
  const generation = useRef(0);
  const [message, setMessage] = useState(`Fetching ${year}. Only that year is loaded.`);
  const [failed, setFailed] = useState(false);

  const apply = useCallback(
    (id: number, result: { ok: true } | { ok: false; message: string }) => {
      if (id !== generation.current) return;
      if (result.ok) {
        router.refresh();
        return;
      }
      setFailed(true);
      setMessage(result.message);
    },
    [router],
  );

  useEffect(() => {
    const id = ++generation.current;
    void requestYear(year).then((result) => apply(id, result));
  }, [apply, year]);

  function retry() {
    const id = ++generation.current;
    setFailed(false);
    setMessage(`Fetching ${year}. Only that year is loaded.`);
    inflight.delete(year);
    void requestYear(year).then((result) => apply(id, result));
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-6">
      <h1 className="text-2xl">{year}</h1>
      <p className={failed ? "mt-3 text-loss" : "mt-3 text-muted"}>{message}</p>
      {failed ? (
        <button type="button" className="mt-4 rounded-full bg-ink px-4 py-2 text-sm text-paper" onClick={retry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}
