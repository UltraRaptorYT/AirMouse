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
