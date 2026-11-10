import { findCustomGame } from "@/lib/supabase-custom-games";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: "That game link is not valid." }, { status: 400 });
  }
  try {
    const game = await findCustomGame(id);
    if (!game) return Response.json({ error: "Could not find that game in Supabase." }, { status: 404 });
    return Response.json(game, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load that game." },
      { status: 502 },
    );
  }
}
