export const PLAYER_COLORS = [
  "#e05b35",
  "#4263eb",
  "#0f9f73",
  "#9c36d6",
  "#c78912",
  "#d6336c",
  "#087f8c",
  "#7048e8",
  "#2b8a3e",
  "#e8590c",
  "#1971c2",
  "#a61e4d",
] as const;

export function colorForPlayer(playerId: string) {
  let hash = 2166136261;
  for (const character of playerId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return PLAYER_COLORS[(hash >>> 0) % PLAYER_COLORS.length];
}
