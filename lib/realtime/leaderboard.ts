import type { LeaderboardEntry } from "./types";

export const MAX_TEAM_PHOTO_LENGTH = 64_000;

export function rankTeams(entries: LeaderboardEntry[]) {
  return [...entries].sort(
    (a, b) => a.timeMs - b.timeMs || a.completedAt - b.completedAt,
  );
}

export function leaderboardUrl(path = "") {
  const configured = process.env.NEXT_PUBLIC_AIRMOUSE_WS_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol === "wss:") url.protocol = "https:";
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/leaderboard${path}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
