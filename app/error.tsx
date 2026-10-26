"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section>
      <h1 className="text-3xl tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-3xl break-words text-muted">{error.message}</p>
      <button type="button" onClick={reset} className="mt-4 rounded-full bg-ink px-4 py-2 text-sm text-paper">
        Try again
      </button>
    </section>
  );
}
