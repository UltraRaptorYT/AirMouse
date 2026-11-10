export type StoredCustomGame = {
  id: string;
  creator_name: string;
  created_at: string;
  label: string;
  language: "en" | "zh";
  prompt: string;
  answers: string[];
  instruction: string;
};

export type CustomGameCatalogEntry = Pick<StoredCustomGame, "id" | "creator_name" | "created_at" | "label" | "language" | "prompt" | "answers">;

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase server access is not configured. Set SUPABASE_SECRET_KEY in the server environment.");
  }
  return { url, key };
}

async function supabaseRequest<T>(path: string, init?: RequestInit) {
  const { url, key } = configuration();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as T | {
    message?: string;
    error?: string;
    hint?: string;
  } | null;
  if (!response.ok) {
    const details = result && typeof result === "object" && !Array.isArray(result)
      ? (result as { message?: string }).message
      : undefined;
    throw new Error(details || "Supabase could not complete the request.");
  }
  return result as T;
}

export async function createCustomGame(game: Omit<StoredCustomGame, "id" | "created_at">) {
  const result = await supabaseRequest<Array<Pick<StoredCustomGame, "id">>>(
    "airmouse_custom_games?select=id",
    {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(game),
    },
  );
  const id = result?.[0]?.id;
  if (!id) throw new Error("Supabase saved the question but did not return its UUID.");
  return id;
}

export async function findCustomGame(id: string) {
  const result = await supabaseRequest<StoredCustomGame[]>(
    `airmouse_custom_games?id=eq.${encodeURIComponent(id)}&select=id,creator_name,created_at,label,language,prompt,answers,instruction&limit=1`,
  );
  const game = result?.[0];
  if (!game || !Array.isArray(game.answers) || !game.answers.every((answer) => typeof answer === "string")) {
    return undefined;
  }
  return game;
}

export async function searchCustomGames(search: string) {
  const params = new URLSearchParams({
    select: "id,creator_name,created_at,label,language,prompt,answers",
    order: "created_at.desc",
    limit: "1000",
  });
  const result = await supabaseRequest<CustomGameCatalogEntry[]>(`airmouse_custom_games?${params.toString()}`);
  const games = Array.isArray(result) ? result : [];
  const term = search.trim().toLocaleLowerCase();
  const matches = term
    ? games.filter((game) => [game.label, game.creator_name, game.prompt, ...game.answers]
      .some((value) => value.toLocaleLowerCase().includes(term)))
    : games;
  return matches.slice(0, 100);
}
