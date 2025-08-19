// app/api/game/[gameId]/join/route.ts
export const runtime = "edge";
import { NextResponse } from "next/server";
import { joinGame, getState } from "@/lib/game";

export async function POST(req: Request, { params }: { params: { gameId: string } }) {
  try {
    const body = await req.json();
    const { realName } = body;
    if (!realName) return NextResponse.json({ ok: false, error: "realName required" }, { status: 400 });

    const p = await joinGame(params.gameId, realName);
    const state = await getState(params.gameId, p.id);
    return NextResponse.json({ ok: true, player: p, state });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "join failed" }, { status: 400 });
  }
}
