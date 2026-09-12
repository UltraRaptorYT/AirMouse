import type { ChallengeNumber, GameLanguage, PublicQuestion } from "@/lib/game/questions";

export type RoomPhase = "lobby" | "language" | "challenge" | "memorise" | "question" | "finished";

export type PlayerPresence = {
  kind: "player";
  playerId: string;
  name: string;
  color: string;
  onlineAt: string;
  motionEnabled?: boolean;
};

export type HostPresence = {
  kind: "host";
  onlineAt: string;
};

export type GameStatePayload = {
  phase: RoomPhase;
  question?: PublicQuestion;
  questionIndex: number;
  questionCount: number;
  language?: GameLanguage;
  challenge?: ChallengeNumber;
  challengeLabel?: string;
  memoriseText?: string;
  phaseEndsAt?: number;
  startedAt?: number;
  penaltyMs?: number;
  completedAt?: number;
};

export type CursorMovePayload = {
  playerId: string;
  dx: number;
  dy: number;
};

export type CursorAimPayload = {
  playerId: string;
  x: number;
  y: number;
};

export type PointerActionPayload = {
  playerId: string;
};

export type DropResultPayload = {
  playerId: string;
  questionId: string;
  answerId: string;
  correct: boolean;
  points: number;
  totalScore: number;
};

export type RoomPresencePayload = {
  hostOnline: boolean;
  players: PlayerPresence[];
};

/** One completed run by one team, persisted globally across rooms. */
export type LeaderboardEntry = {
  /** Client-generated UUID so re-sends after a reconnect are ignored. */
  id: string;
  challengeId: string;
  challengeLabel: string;
  language: GameLanguage;
  teamName: string;
  playerCount: number;
  /** Wall-clock time from first question to completion, including hint penalties. */
  timeMs: number;
  penaltyMs: number;
  completedAt: number;
};

export type LeaderboardPayload = {
  /** Sorted fastest-first; capped per challenge on the server. */
  entries: LeaderboardEntry[];
};

export type ClientRoomMessage =
  | { type: "join"; payload: PlayerPresence }
  | { type: "player-update"; payload: PlayerPresence }
  | { type: "request-game-state" }
  | { type: "cursor-aim"; payload: Omit<CursorAimPayload, "playerId"> }
  | { type: "cursor-move"; payload: Omit<CursorMovePayload, "playerId"> }
  | { type: "pointer-down" }
  | { type: "pointer-up" }
  | { type: "recenter" }
  | { type: "game-state"; payload: GameStatePayload }
  | { type: "drop-result"; payload: DropResultPayload }
  | { type: "round-complete"; payload: { questionId: string } }
  | { type: "submit-result"; payload: LeaderboardEntry }
  | { type: "request-leaderboard" }
  | { type: "ping" };

export type ServerRoomMessage =
  | ({ type: "connected" } & RoomPresencePayload)
  | ({ type: "presence" } & RoomPresencePayload)
  | { type: "game-state"; payload: GameStatePayload }
  | { type: "cursor-aim"; payload: CursorAimPayload }
  | { type: "cursor-move"; payload: CursorMovePayload }
  | { type: "pointer-down"; payload: PointerActionPayload }
  | { type: "pointer-up"; payload: PointerActionPayload }
  | { type: "recenter"; payload: PointerActionPayload }
  | { type: "drop-result"; payload: DropResultPayload }
  | { type: "round-complete"; payload: { questionId: string } }
  | { type: "leaderboard"; payload: LeaderboardPayload }
  | { type: "pong" }
  | { type: "error"; message: string };
