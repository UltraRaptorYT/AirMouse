export type GameLanguage = "en" | "zh";
export type ChallengeNumber = 1 | 2;

export type AnswerCard = { id: string; label: string; targetId: string };
export type AnswerTarget = { id: string; label: string; hint: string };

export type Question = {
  id: string;
  prompt: string;
  instruction: string;
  answers: AnswerCard[];
  targets: AnswerTarget[];
};

export type PublicQuestion = Omit<Question, "answers"> & {
  answers: Array<Omit<AnswerCard, "targetId">>;
};

export type Challenge = {
  id: string;
  language: GameLanguage;
  number: ChallengeNumber;
  label: string;
  source: string;
  memoriseText: string;
  questions: Question[];
};

function makeQuestion(
  id: string,
  prompt: string,
  parts: string[],
  instruction: string,
): Question {
  const answers = parts.map((label, index) => ({
    id: `${id}-part-${index + 1}`,
    label,
    targetId: `${id}-slot-${index + 1}`,
  }));

  return {
    id,
    prompt,
    instruction,
    answers: [...answers].sort((a, b) => b.label.localeCompare(a.label)),
    targets: parts.map((_, index) => ({
      id: `${id}-slot-${index + 1}`,
      label: `${index + 1}`,
      hint: `Part ${index + 1}`,
    })),
  };
}

const en1Text =
  "The Ten Teaching Sūtra says: Develop the following ideas with respect to your teachers. I have wandered for a long time through cyclic existence, and they search for me; I have been asleep, having been obscured by delusion for a long time, and they wake me; they pull me out of the depths of the ocean of existence; I have entered a bad path, and they reveal the good path to me; they release me from being bound in the prison of existence; I have been worn out by illness for a long time, and they are my doctors; they are the rain clouds that put out my blazing fire of attachment and the like.";
const en2Text =
  "Also the Array of Stalks Sūtra says: Youthful Sudhana, the teachers are those who protect me from all miserable realms; they cause me to know the sameness of phenomena; they show me the paths that lead to happiness and those that lead to unhappiness; they instruct me in deeds always auspicious; they reveal to me the path to the city of omniscience; they guide me to the state of omniscience; they cause me to enter the ocean of reality's sphere; they show me the sea of past, present, and future phenomena; and they reveal to me the circle of the noble beings' assembly. The teachers increase all my virtues. Remembering this, you will weep.";
const zh1Text =
  "《十法经》云：“于长夜中，驰骋生死寻觅我者，于长夜中为愚痴覆而重睡眠，醒觉我者，沉溺有海，拔济我者，我入恶道示善道者，系缚有狱解释我者，我于长夜，病所逼恼为作医王，我被贪等猛火烧燃，为作云雨而为息灭，应如是想。”";
const zh2Text =
  "《华严经》说：“善财童子，如是随念痛哭流涕。诸善知识，是于一切恶趣之中，救护我。令善通达法平等性，开示安稳不安稳道，以普贤行而为教授。指示能往一切智城，所有之道，护送往赴一切智处，正令趣入法界大海，开示三世所知法海，显示圣众妙曼陀罗。善知识者，长我一切白净善法。”";

export const challenges: Challenge[] = [
  {
    id: "en-1", language: "en", number: 1, label: "English Challenge 1",
    source: "The Ten Teaching Sūtra", memoriseText: en1Text,
    questions: [
      makeQuestion("en1-1", "The Ten Teaching Sūtra says: [1] [2] [3].", ["Develop the following ideas", "with respect to", "your teachers"], "Build the missing phrase in order."),
      makeQuestion("en1-2", "I have wandered for a long time [1], [2].", ["through cyclic existence", "and they search for me"], "Complete the quotation."),
      makeQuestion("en1-3", "I have been asleep, [1], [2].", ["having been obscured by delusion for a long time", "and they wake me"], "Complete the quotation."),
      makeQuestion("en1-4", "they pull me out of the [1].", ["depths of the ocean of existence"], "Complete the quotation."),
      makeQuestion("en1-5", "I have entered a bad path, [1].", ["and they reveal the good path to me"], "Complete the quotation."),
      makeQuestion("en1-6", "they release me from [1].", ["being bound in the prison of existence"], "Complete the quotation."),
      makeQuestion("en1-7", "I have been worn out by [1], [2].", ["illness for a long time", "and they are my doctors"], "Complete the quotation."),
      makeQuestion("en1-8", "they are the rain clouds that [1] [2].", ["put out my blazing fire", "of attachment and the like"], "Complete the quotation."),
    ],
  },
  {
    id: "en-2", language: "en", number: 2, label: "English Challenge 2",
    source: "The Array of Stalks Sūtra", memoriseText: en2Text,
    questions: [
      makeQuestion("en2-1", "Youthful Sudhana, the teachers are [1] [2].", ["those who protect me", "from all miserable realms"], "Complete the quotation."),
      makeQuestion("en2-2", "they cause me to [1].", ["know the sameness of phenomena"], "Complete the quotation."),
      makeQuestion("en2-3", "they show me the paths that [1] [2].", ["lead to happiness", "and those that lead to unhappiness"], "Complete the quotation."),
      makeQuestion("en2-4", "they instruct me [1].", ["in deeds always auspicious"], "Complete the quotation."),
      makeQuestion("en2-5", "they reveal to me [1] [2].", ["the path to the city", "of omniscience"], "Complete the quotation."),
      makeQuestion("en2-6", "they guide me to [1].", ["the state of omniscience"], "Complete the quotation."),
      makeQuestion("en2-7", "they cause me to enter [1].", ["the ocean of reality's sphere"], "Complete the quotation."),
      makeQuestion("en2-8", "they show me the [1], [2], [3].", ["sea of past", "present", "and future phenomena"], "Complete the quotation."),
      makeQuestion("en2-9", "and they reveal to me [1] [2].", ["the circle of", "the noble beings' assembly"], "Complete the quotation."),
      makeQuestion("en2-10", "The teachers [1]. [2], [3].", ["increase all my virtues", "Remembering this", "you will weep"], "Complete the quotation."),
    ],
  },
  {
    id: "zh-1", language: "zh", number: 1, label: "中文挑战一",
    source: "《十法经》", memoriseText: zh1Text,
    questions: [
      makeQuestion("zh1-1", "《十法经》云：“于长夜中，[1][2]，", ["驰骋生死", "寻觅我者"], "依次组成缺少的经文。"),
      makeQuestion("zh1-2", "于长夜中[1]，[2]，", ["为愚痴覆而重睡眠", "醒觉我者"], "补全经文。"),
      makeQuestion("zh1-3", "沉溺有海，[1]，", ["拔济我者"], "补全经文。"),
      makeQuestion("zh1-4", "我入恶道示善道者，[1][2]，", ["系缚有狱", "解释我者"], "依次组成缺少的经文。"),
      makeQuestion("zh1-5", "我于长夜，[1][2]，", ["病所逼恼", "为作医王"], "依次组成缺少的经文。"),
      makeQuestion("zh1-6", "我被贪等[1]，[2]，应如是想。”", ["猛火烧燃", "为作云雨而为息灭"], "补全经文。"),
    ],
  },
  {
    id: "zh-2", language: "zh", number: 2, label: "中文挑战二",
    source: "《华严经》", memoriseText: zh2Text,
    questions: [
      makeQuestion("zh2-1", "《华严经》说：“善财童子，[1][2]。", ["如是随念", "痛哭流涕"], "依次组成缺少的经文。"),
      makeQuestion("zh2-2", "诸善知识，[1]，[2]。", ["是于一切恶趣之中", "救护我"], "补全经文。"),
      makeQuestion("zh2-3", "令善通达法平等性，[1]，[2]。", ["开示安稳不安稳道", "以普贤行而为教授"], "补全经文。"),
      makeQuestion("zh2-4", "指示能往[1]，[2]，", ["一切智城", "所有之道"], "补全经文。"),
      makeQuestion("zh2-5", "护送往赴一切智处，[1]，", ["正令趣入法界大海"], "补全经文。"),
      makeQuestion("zh2-6", "开示三世所知法海，[1]，", ["显示圣众妙曼陀罗"], "补全经文。"),
      makeQuestion("zh2-7", "善知识者，[1]。”", ["长我一切白净善法"], "补全经文。"),
    ],
  },
];

export function getChallenge(language: GameLanguage, number: ChallengeNumber) {
  return challenges.find((item) => item.language === language && item.number === number);
}

export function getQuestion(questionId?: string) {
  if (!questionId) return undefined;
  return challenges.flatMap((item) => item.questions).find((item) => item.id === questionId);
}

export function toPublicQuestion(question: Question): PublicQuestion {
  return { ...question, answers: question.answers.map(({ id, label }) => ({ id, label })) };
}
