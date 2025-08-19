// app/api/game/[gameId]/state/route.ts
export const runtime = "edge";
import { NextResponse } from "next/server";
import { getState } from "@/lib/game";

export async function GET(_: Request, { params }: { params: { gameId: string } }) {
  const { searchParams } = new URL(_.url);
  const viewerId = searchParams.get("playerId") || undefined;

  const state = await getState(params.gameId, viewerId);
  if (!state) return NextResponse.json({ ok: false, error: "Game not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...state });
}
