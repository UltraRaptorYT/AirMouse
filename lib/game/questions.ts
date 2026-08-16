export type AnswerCard = {
  id: string;
  label: string;
  targetId: string;
};

export type AnswerTarget = {
  id: string;
  label: string;
  hint: string;
};

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

export const questionBank: Question[] = [
  {
    id: "energy-sources",
    prompt: "Which energy sources can be naturally replaced?",
    instruction: "Sort every source into the correct energy box.",
    targets: [
      {
        id: "renewable",
        label: "Renewable",
        hint: "Nature replaces it quickly",
      },
      {
        id: "non-renewable",
        label: "Non-renewable",
        hint: "Limited supply underground",
      },
    ],
    answers: [
      { id: "solar", label: "Solar", targetId: "renewable" },
      { id: "coal", label: "Coal", targetId: "non-renewable" },
      { id: "wind", label: "Wind", targetId: "renewable" },
      { id: "oil", label: "Oil", targetId: "non-renewable" },
    ],
  },
  {
    id: "states-of-matter",
    prompt: "What state of matter is each example?",
    instruction: "Drag each example to its matching state.",
    targets: [
      { id: "solid", label: "Solid", hint: "Keeps its own shape" },
      { id: "liquid", label: "Liquid", hint: "Flows to fit a container" },
      { id: "gas", label: "Gas", hint: "Spreads to fill a space" },
    ],
    answers: [
      { id: "ice", label: "Ice cube", targetId: "solid" },
      { id: "steam", label: "Steam", targetId: "gas" },
      { id: "juice", label: "Orange juice", targetId: "liquid" },
      { id: "book", label: "Book", targetId: "solid" },
      { id: "air", label: "Air", targetId: "gas" },
      { id: "rain", label: "Rain", targetId: "liquid" },
    ],
  },
  {
    id: "living-things",
    prompt: "Is it living or non-living?",
    instruction: "Sort all six cards into the correct box.",
    targets: [
      { id: "living", label: "Living", hint: "Grows and needs energy" },
      { id: "non-living", label: "Non-living", hint: "Does not grow" },
    ],
    answers: [
      { id: "tree", label: "Oak tree", targetId: "living" },
      { id: "robot", label: "Robot", targetId: "non-living" },
      { id: "mushroom", label: "Mushroom", targetId: "living" },
      { id: "stone", label: "Stone", targetId: "non-living" },
      { id: "butterfly", label: "Butterfly", targetId: "living" },
      { id: "cloud", label: "Cloud", targetId: "non-living" },
    ],
  },
];

export function toPublicQuestion(question: Question): PublicQuestion {
  return {
    ...question,
    answers: question.answers.map(({ id, label }) => ({ id, label })),
  };
}
