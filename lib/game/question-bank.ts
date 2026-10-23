import { externalChallenges } from "@/lib/game/external-questions";
import {
  internalChallenges,
  type Challenge,
  type ChallengeNumber,
  type GameLanguage,
  type Question,
} from "@/lib/game/questions";

export type QuestionBankMode = "internal" | "external";

/** NEXT_PUBLIC is required because the selected bank is imported by client pages. */
const configuredQuestionBank = process.env.NEXT_PUBLIC_QUESTION_BANK?.trim();
export const ACTIVE_QUESTION_BANK: QuestionBankMode =
  configuredQuestionBank === "internal" ? "internal" : "external";

const questionBanks: Record<QuestionBankMode, Challenge[]> = {
  internal: internalChallenges,
  external: externalChallenges,
};

export const challenges = questionBanks[ACTIVE_QUESTION_BANK];

export function getChallenges(language: GameLanguage) {
  return challenges.filter((challenge) => challenge.language === language);
}

export function getChallenge(language: GameLanguage, number: ChallengeNumber) {
  return challenges.find(
    (challenge) => challenge.language === language && challenge.number === number,
  );
}

export function getQuestion(questionId?: string): Question | undefined {
  if (!questionId) return undefined;
  return challenges
    .flatMap((challenge) => challenge.questions)
    .find((question) => question.id === questionId);
}
