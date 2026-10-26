"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function Replace({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return <p className="text-muted">Opening the ledger…</p>;
}
