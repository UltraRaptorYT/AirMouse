import type { PublicQuestion } from "@/lib/game/questions";

export type RoomPhase = "lobby" | "question" | "finished";

export type PlayerPresence = {
  kind: "player";
  playerId: string;
  name: string;
  color: string;
  onlineAt: string;
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

export type AnswerSubmissionPayload = {
  playerId: string;
  playerName: string;
  questionId: string;
  placements: Record<string, string>;
  elapsedMs: number;
};

export type AnswerResultPayload = {
  playerId: string;
  questionId: string;
  correctCount: number;
  answerCount: number;
  points: number;
  totalScore: number;
};
