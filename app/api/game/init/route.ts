// app/api/game/init/route.ts
export const runtime = "edge";
import { NextResponse } from "next/server";
import { createGame } from "@/lib/game";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { gameId, maxPlayers, finalNightAt } = body;
    if (!maxPlayers || maxPlayers < 2) {
      return NextResponse.json({ ok: false, error: "maxPlayers required" }, { status: 400 });
    }
    const meta = await createGame({
      id: gameId,
      maxPlayers: Number(maxPlayers),
      finalNightAt: finalNightAt || null,
      endsAt: finalNightAt || null,
    });
    return NextResponse.json({ ok: true, meta });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "init failed" }, { status: 500 });
  }
}
