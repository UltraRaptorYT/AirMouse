import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/admin-session";
import { createCustomGame, searchCustomGames } from "@/lib/supabase-custom-games";

export const runtime = "nodejs";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Supabase request failed.";
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAdminSession(cookieStore.get(ADMIN_COOKIE)?.value)) {
    return Response.json({ error: "Admin access expired. Enter the password again." }, { status: 401 });
  }
  const search = new URL(request.url).searchParams.get("q")?.slice(0, 120) ?? "";
  try {
    const games = await searchCustomGames(search);
    return Response.json({ games }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const cookieStore = await cookies();
  if (!isValidAdminSession(cookieStore.get(ADMIN_COOKIE)?.value)) {
    return Response.json({ error: "Admin access expired. Enter the password again." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Enter valid form data." }, { status: 400 });
  }

  const creatorName = typeof body.creatorName === "string" ? body.creatorName.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const answers = Array.isArray(body.answers)
    ? body.answers.filter((answer): answer is string => typeof answer === "string").map((answer) => answer.trim())
    : [];
  const language = body.language === "zh" ? "zh" : body.language === "en" ? "en" : undefined;
  const blankNumbers = [...prompt.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  const uniqueNumbers = new Set(blankNumbers);

  if (!creatorName || creatorName.length > 80) {
    return Response.json({ error: "Enter your name (up to 80 characters)." }, { status: 400 });
  }
  if (!label || label.length > 80) {
    return Response.json({ error: "Enter a game name (up to 80 characters)." }, { status: 400 });
  }
  if (!language) return Response.json({ error: "Choose a language." }, { status: 400 });
  if (!prompt || prompt.length > 8_000) {
    return Response.json({ error: "Enter a prompt under 8,000 characters." }, { status: 400 });
  }
  if (answers.length < 1 || answers.length > 40 || answers.some((answer) => !answer || answer.length > 300)) {
    return Response.json({ error: "Enter between 1 and 40 non-empty answers, each under 300 characters." }, { status: 400 });
  }
  if (
    uniqueNumbers.size !== answers.length ||
    blankNumbers.length !== answers.length ||
    answers.some((_, index) => !uniqueNumbers.has(index + 1))
  ) {
    return Response.json({
      error: "Use each blank marker exactly once in order: [1], [2], [3], and so on, matching one answer per line.",
    }, { status: 400 });
  }

  let id: string;
  try {
    id = await createCustomGame({
      creator_name: creatorName,
      label,
      language,
      prompt,
      answers,
      instruction: instruction.slice(0, 240) || "Drag each phrase into its place.",
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }

  return Response.json({ id });
}
