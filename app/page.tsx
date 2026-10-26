import { connection } from "next/server";
import { Suspense } from "react";
import { Replace } from "@/components/replace";
import { getSettings } from "@/lib/db";

export const instant = false;

export default function Home() {
  return (
    <Suspense fallback={<p className="text-muted">Opening the current month…</p>}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await connection();
  const settings = await getSettings();
  if (!settings.wallet) return <Replace href="/settings" />;
  const now = new Date();
  return <Replace href={`/${now.getFullYear()}/${now.getMonth() + 1}`} />;
}
