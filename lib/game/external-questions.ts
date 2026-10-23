import {
  defineChallenge,
  makeQuestion,
  type Challenge,
} from "@/lib/game/questions";

/** Add externally sourced challenges in this file, separate from the built-in bank. */
export const externalChallenges: Challenge[] = [
  defineChallenge({
    id: "ext-zh-3",
    language: "zh",
    number: 3,
    label: "中文挑战三",
    source: "菩提道次第",
    memoriseText:
      "此中总摄一切佛语扼要，遍摄龙猛无着二大车之道轨，往趣一切种智地位胜士法范，三种士夫，一切行持，所有次第，无所缺少。依菩提道次第门中，导具善者趣佛地理，是谓此中所诠诸法。",
    segments: [
      makeQuestion(
        "ext-zh-3-s1",
        "此中总摄[1]，遍摄[2][3]二大车之道轨，往趣[4]胜士法范，[5]，[6]，[7]，无所缺少。依[8]门中，导[9]趣[10]理，是谓[11]。",
        [
          "一切佛语扼要",
          "龙猛",
          "无着",
          "一切种智地位",
          "三种士夫",
          "一切行持",
          "所有次第",
          "菩提道次第",
          "具善者",
          "佛地",
          "此中所诠诸法",
        ],
        "依次把词组拖入经文空格。",
      ),
    ],
  }),
  defineChallenge({
    id: "ext-en-3",
    language: "en",
    number: 3,
    label: "English Challenge 3",
    source: "Stages of the Path to Enlightenment",
    memoriseText: String.raw`Here the teaching that I will explain is how fortunate beings are led to buddhahood by way of the stages of the path to enlightenment that\br
(1) contain the key points of all of the Conqueror's scriptures,\br
(2) are the pathways forged by two great trailblazers, Nagarjuna and Asanga,\br
(3) are the system for supreme beings progressing to the state of omniscience, and\br
(4) fully comprise all the stages practiced by the three types of persons.`,
    segments: [
      makeQuestion(
        "ext-en-3-s1",
        "Here the teaching that I will explain is how [1] are led to [2] by way of the [3] that (1) contain the key points of [4], (2) are the [5] forged by two great trailblazers, [6], (3) are the [7] progressing to the [8], and (4) fully comprise [9] practiced by the [10].",
        [
          "fortunate beings",
          "buddhahood",
          "stages of the path to enlightenment",
          "all of the Conqueror's scriptures",
          "pathways",
          "Nagarjuna and Asanga",
          "system for supreme beings",
          "state of omniscience",
          "all the stages",
          "three types of persons",
        ],
        "Drag the phrases into the passage in order.",
      ),
    ],
  }),
];
