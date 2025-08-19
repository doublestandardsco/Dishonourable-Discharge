// app/api/game/[gameId]/player/route.ts
export const runtime = "edge";
import { NextResponse } from "next/server";
import { patchPlayer, getState } from "@/lib/game";

export async function PATCH(req: Request, { params }: { params: { gameId: string } }) {
  try {
    const body = await req.json();
    const { playerId, patch } = body;
    if (!playerId || !patch) {
      return NextResponse.json({ ok: false, error: "playerId and patch required" }, { status: 400 });
    }
    const updated = await patchPlayer(params.gameId, playerId, patch);
    const state = await getState(params.gameId, playerId);
    return NextResponse.json({ ok: true, player: updated, state });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "patch failed" }, { status: 400 });
  }
}
