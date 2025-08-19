// app/api/game/[gameId]/action/route.ts
export const runtime = "edge";
import { NextResponse } from "next/server";
import { inbox, pushLog, getState } from "@/lib/game";

export async function POST(req: Request, { params }: { params: { gameId: string } }) {
  try {
    const body = await req.json();
    const { playerId, type, targetId, details } = body;
    if (!playerId || !type) {
      return NextResponse.json({ ok: false, error: "playerId and type required" }, { status: 400 });
    }

    const headline =
      type === "penalty"       ? `📝 Penalty on ${targetId || "—"} — ${details || ""}` :
      type === "task_complete" ? `✅ Task complete by ${playerId} — ${details || ""}` :
      type === "murderer_act"  ? `☠️ Murderer act report by ${playerId} — ${details || ""}` :
      type === "ability"       ? `⚡ Ability used on ${targetId || "—"} — ${details || ""}` :
                                 `📝 ${type} — ${details || ""}`;

    await pushLog(params.gameId, headline);
    if (targetId) await inbox(params.gameId, targetId, { from: playerId, type, text: details || "" });

    const state = await getState(params.gameId, playerId);
    return NextResponse.json({ ok: true, state });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "action failed" }, { status: 400 });
  }
}
