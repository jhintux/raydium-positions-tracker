import { syncYear } from "@/lib/sync";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { year?: number } | null;
  const year = Number(body?.year ?? new Date().getFullYear());
  if (!Number.isInteger(year)) return Response.json({ error: "Choose a calendar year." }, { status: 400 });
  try {
    const result = await syncYear(year);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
