import { PublicKey } from "@solana/web3.js";
import { getSettings, saveSettings } from "@/lib/db";

export async function GET() {
  const settings = await getSettings();
  return Response.json({ wallet: settings.wallet });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { wallet?: string } | null;
  const wallet = body?.wallet?.trim() ?? "";
  try {
    const key = new PublicKey(wallet);
    if (key.toBytes().length !== 32) throw new Error("invalid");
  } catch {
    return Response.json({ error: "Enter a Solana wallet address." }, { status: 400 });
  }
  const current = await getSettings();
  const walletChanged = current.wallet.length > 0 && current.wallet !== wallet;
  await saveSettings(wallet, walletChanged);
  return Response.json({ ok: true, cleared: walletChanged });
}
