import type { PublicQuestion } from "@/lib/game/questions";

export type RoomPhase = "lobby" | "question" | "finished";

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
  startedAt?: number;
};

export type CursorMovePayload = {
  playerId: string;
  dx: number;
  dy: number;
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

export type ClientRoomMessage =
  | { type: "join"; payload: PlayerPresence }
  | { type: "player-update"; payload: PlayerPresence }
  | { type: "request-game-state" }
  | { type: "cursor-move"; payload: Omit<CursorMovePayload, "playerId"> }
  | { type: "pointer-down" }
  | { type: "pointer-up" }
  | { type: "recenter" }
  | { type: "game-state"; payload: GameStatePayload }
  | { type: "drop-result"; payload: DropResultPayload }
  | { type: "round-complete"; payload: { questionId: string } }
  | { type: "ping" };

export type ServerRoomMessage =
  | ({ type: "connected" } & RoomPresencePayload)
  | ({ type: "presence" } & RoomPresencePayload)
  | { type: "game-state"; payload: GameStatePayload }
  | { type: "cursor-move"; payload: CursorMovePayload }
  | { type: "pointer-down"; payload: PointerActionPayload }
  | { type: "pointer-up"; payload: PointerActionPayload }
  | { type: "recenter"; payload: PointerActionPayload }
  | { type: "drop-result"; payload: DropResultPayload }
  | { type: "round-complete"; payload: { questionId: string } }
  | { type: "pong" }
  | { type: "error"; message: string };
