"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowRight,
  Check,
  Crown,
  Gamepad2,
  LoaderCircle,
  Play,
  RotateCcw,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  WifiOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  questionBank,
  toPublicQuestion,
  type PublicQuestion,
} from "@/lib/game/questions";
import { supabase } from "@/lib/supabase/client";
import { generateRoomCode, getRoomChannel } from "@/lib/realtime/room";
import type {
  AnswerResultPayload,
  AnswerSubmissionPayload,
  GameStatePayload,
  PlayerPresence,
} from "@/lib/realtime/types";

type ConnectionStatus = "connecting" | "ready" | "error";

type ScoreEntry = {
  name: string;
  score: number;
  answered: boolean;
  correctCount?: number;
  answerCount?: number;
};

const FALLBACK_COLOR = "#ff6b4a";

function getPlayers(channel: RealtimeChannel) {
  const presences = Object.values(channel.presenceState()).flat() as Array<
    Record<string, unknown>
  >;

  return presences
    .filter((presence) => presence.kind === "player")
    .map((presence) => presence as unknown as PlayerPresence)
    .filter((player) => player.playerId && player.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function ScreenPage() {
  const [roomCode, setRoomCode] = useState("");
  const [roomUrl, setRoomUrl] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [players, setPlayers] = useState<PlayerPresence[]>([]);
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
  const [gameState, setGameState] = useState<GameStatePayload>({
    phase: "lobby",
    questionIndex: 0,
    questionCount: questionBank.length,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const gameStateRef = useRef(gameState);
  const scoresRef = useRef(scores);
  const processedRef = useRef(new Map<string, Set<string>>());

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    scoresRef.current = scores;
  }, [scores]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const code = generateRoomCode();
      setRoomCode(code);
      setRoomUrl(`${window.location.origin}/room/${code}`);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!roomCode) return;

    const hostKey = `host-${roomCode}-${crypto.randomUUID()}`;
    const channel = getRoomChannel(roomCode, hostKey);
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        setPlayers(getPlayers(channel));
      })
      .on("broadcast", { event: "request-game-state" }, () => {
        void channel.send({
          type: "broadcast",
          event: "game-state",
          payload: gameStateRef.current,
        });
      })
      .on("broadcast", { event: "answer-submitted" }, ({ payload }) => {
        const submission = payload as AnswerSubmissionPayload;
        const activeState = gameStateRef.current;

        if (
          activeState.phase !== "question" ||
          activeState.question?.id !== submission.questionId
        ) {
          return;
        }

        const alreadyProcessed =
          processedRef.current.get(submission.questionId) ?? new Set<string>();

        if (alreadyProcessed.has(submission.playerId)) return;

        alreadyProcessed.add(submission.playerId);
        processedRef.current.set(submission.questionId, alreadyProcessed);

        const sourceQuestion = questionBank.find(
          (question) => question.id === submission.questionId,
        );

        if (!sourceQuestion) return;

        const correctCount = sourceQuestion.answers.filter(
          (answer) => submission.placements[answer.id] === answer.targetId,
        ).length;
        const isPerfect = correctCount === sourceQuestion.answers.length;
        const speedBonus = isPerfect
          ? Math.max(0, 400 - Math.floor(submission.elapsedMs / 100))
          : 0;
        const points = correctCount * 200 + speedBonus;
        const previousScore = scoresRef.current[submission.playerId]?.score ?? 0;
        const totalScore = previousScore + points;
        const nextScores = {
          ...scoresRef.current,
          [submission.playerId]: {
            name: submission.playerName,
            score: totalScore,
            answered: true,
            correctCount,
            answerCount: sourceQuestion.answers.length,
          },
        };

        scoresRef.current = nextScores;
        setScores(nextScores);

        const result: AnswerResultPayload = {
          playerId: submission.playerId,
          questionId: submission.questionId,
          correctCount,
          answerCount: sourceQuestion.answers.length,
          points,
          totalScore,
        };

        void channel.send({
          type: "broadcast",
          event: "answer-result",
          payload: result,
        });
      })
      .subscribe(async (subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          await channel.track({
            kind: "host",
            onlineAt: new Date().toISOString(),
          });
          setStatus("ready");
        }

        if (
          subscriptionStatus === "CHANNEL_ERROR" ||
          subscriptionStatus === "TIMED_OUT"
        ) {
          setStatus("error");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode]);

  function broadcastState(nextState: GameStatePayload) {
    gameStateRef.current = nextState;
    setGameState(nextState);

    void channelRef.current?.send({
      type: "broadcast",
      event: "game-state",
      payload: nextState,
    });
  }

  function startQuestion(index: number) {
    const question = questionBank[index];
    if (!question) return;

    processedRef.current.set(question.id, new Set());
    const resetAnswerStatus = Object.fromEntries(
      Object.entries(scoresRef.current).map(([playerId, entry]) => [
        playerId,
        {
          ...entry,
          answered: false,
          correctCount: undefined,
          answerCount: undefined,
        },
      ]),
    );
    scoresRef.current = resetAnswerStatus;
    setScores(resetAnswerStatus);

    broadcastState({
      phase: "question",
      question: toPublicQuestion(question),
      questionIndex: index,
      questionCount: questionBank.length,
      startedAt: Date.now(),
    });
  }

  function goNext() {
    const nextIndex = gameState.questionIndex + 1;

    if (nextIndex >= questionBank.length) {
      broadcastState({
        phase: "finished",
        questionIndex: questionBank.length - 1,
        questionCount: questionBank.length,
      });
      return;
    }

    startQuestion(nextIndex);
  }

  function playAgain() {
    scoresRef.current = {};
    setScores({});
    processedRef.current.clear();
    broadcastState({
      phase: "lobby",
      questionIndex: 0,
      questionCount: questionBank.length,
    });
  }

  const rankedPlayers = useMemo(() => {
    const playerLookup = new Map(players.map((player) => [player.playerId, player]));

    return Object.entries(scores)
      .map(([playerId, entry]) => ({
        playerId,
        ...entry,
        color: playerLookup.get(playerId)?.color ?? FALLBACK_COLOR,
      }))
      .sort((a, b) => b.score - a.score);
  }, [players, scores]);

  const answeredCount = players.filter(
    (player) => scores[player.playerId]?.answered,
  ).length;

  if (gameState.phase === "lobby") {
    return (
      <HostShell roomCode={roomCode} status={status}>
        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
          <section className="host-panel relative overflow-hidden p-6 sm:p-8">
            <div className="absolute -right-16 -top-20 size-64 rounded-full bg-[#ff6b4a]/15 blur-2xl" />
            <div className="relative flex h-full flex-col">
              <div className="mb-7 flex items-center gap-3">
                <span className="eyebrow">Join the game</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <div className="grid flex-1 items-center gap-8 md:grid-cols-[minmax(230px,.75fr)_1.15fr]">
                <div className="mx-auto w-full max-w-[270px] rounded-[2rem] bg-[#fffdf6] p-5 shadow-[0_24px_70px_rgba(0,0,0,.28)]">
                  {roomUrl ? (
                    <QRCodeSVG
                      value={roomUrl}
                      size={260}
                      level="M"
                      className="h-auto w-full"
                      bgColor="#fffdf6"
                      fgColor="#121521"
                    />
                  ) : (
                    <div className="aspect-square animate-pulse rounded-2xl bg-black/5" />
                  )}
                </div>

                <div className="space-y-7 text-center md:text-left">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold uppercase tracking-[.24em] text-[#ff8b70]">
                      Scan to jump straight in
                    </p>
                    <h1 className="text-balance text-4xl font-black leading-[.95] tracking-[-.04em] sm:text-6xl">
                      Ready to sort it out?
                    </h1>
                    <p className="max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
                      Scan the code, choose a nickname, and you&apos;re in this room.
                      No room code screen in between.
                    </p>
                  </div>

                  <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-5 py-4">
                    <span className="text-sm text-white/50">Room code</span>
                    <strong className="font-mono text-2xl tracking-[.22em] text-white">
                      {roomCode || "------"}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="host-panel flex min-h-[360px] flex-col p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm text-white/45">Lobby</p>
                <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold">
                  <Users className="size-5 text-[#ff6b4a]" />
                  {players.length} {players.length === 1 ? "player" : "players"}
                </h2>
              </div>
              <span className="status-pill">
                <span className="size-2 rounded-full bg-[#44d79b] shadow-[0_0_0_4px_rgba(68,215,155,.12)]" />
                Live
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {players.length === 0 ? (
                <div className="flex h-full min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[.025] text-center">
                  <Smartphone className="mb-3 size-8 text-white/25" />
                  <p className="font-semibold text-white/70">Waiting for players</p>
                  <p className="mt-1 text-sm text-white/35">Names will pop up here</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {players.map((player, index) => (
                    <div
                      key={player.playerId}
                      className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[.045] px-4 py-3.5"
                    >
                      <span
                        className="flex size-9 items-center justify-center rounded-xl text-sm font-black text-white"
                        style={{ backgroundColor: player.color }}
                      >
                        {player.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="flex-1 font-semibold">{player.name}</span>
                      {index === 0 && <Sparkles className="size-4 text-[#ffd166]" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button
              className="mt-5 h-14 w-full rounded-2xl bg-[#ff6b4a] text-base font-bold text-white shadow-[0_12px_30px_rgba(255,107,74,.24)] hover:bg-[#ff7a5d]"
              disabled={players.length === 0 || status !== "ready"}
              onClick={() => startQuestion(0)}
            >
              <Play className="mr-1 size-5 fill-current" />
              Start {questionBank.length}-round game
            </Button>
          </section>
        </div>
      </HostShell>
    );
  }

  if (gameState.phase === "finished") {
    return (
      <HostShell roomCode={roomCode} status={status}>
        <section className="host-panel flex flex-1 flex-col items-center justify-center overflow-hidden p-8 text-center">
          <div className="mb-5 flex size-20 items-center justify-center rounded-[1.6rem] bg-[#ffd166] text-[#171922] shadow-[0_18px_50px_rgba(255,209,102,.24)]">
            <Trophy className="size-10" />
          </div>
          <span className="eyebrow">Final results</span>
          <h1 className="mt-4 text-5xl font-black tracking-[-.04em] sm:text-7xl">
            That&apos;s the game!
          </h1>

          <div className="mt-10 w-full max-w-2xl space-y-3">
            {rankedPlayers.length === 0 ? (
              <p className="rounded-2xl bg-white/5 p-6 text-white/50">No scores yet.</p>
            ) : (
              rankedPlayers.map((player, index) => (
                <div
                  key={player.playerId}
                  className={`flex items-center gap-4 rounded-2xl border px-5 py-4 text-left ${
                    index === 0
                      ? "border-[#ffd166]/40 bg-[#ffd166]/10"
                      : "border-white/8 bg-white/[.035]"
                  }`}
                >
                  <span className="w-7 text-center text-xl font-black text-white/35">
                    {index + 1}
                  </span>
                  <span
                    className="flex size-11 items-center justify-center rounded-xl font-black"
                    style={{ backgroundColor: player.color }}
                  >
                    {player.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 text-lg font-bold">{player.name}</span>
                  {index === 0 && <Crown className="size-5 text-[#ffd166]" />}
                  <strong className="font-mono text-xl">{player.score.toLocaleString()}</strong>
                </div>
              ))
            )}
          </div>

          <Button
            className="mt-8 h-13 rounded-2xl bg-white px-7 font-bold text-[#151722] hover:bg-white/90"
            onClick={playAgain}
          >
            <RotateCcw className="mr-1 size-4" />
            Back to lobby
          </Button>
        </section>
      </HostShell>
    );
  }

  return (
    <HostShell roomCode={roomCode} status={status}>
      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <QuestionStage
          question={gameState.question}
          questionIndex={gameState.questionIndex}
          questionCount={gameState.questionCount}
        />

        <aside className="host-panel flex min-h-[320px] flex-col p-6">
          <div className="flex items-center justify-between border-b border-white/8 pb-5">
            <div>
              <p className="text-sm text-white/45">Answers in</p>
              <p className="mt-1 text-3xl font-black">
                {answeredCount}<span className="text-white/25">/{players.length}</span>
              </p>
            </div>
            <div className="flex size-12 items-center justify-center rounded-2xl bg-[#44d79b]/10 text-[#44d79b]">
              <Check className="size-6" />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-5">
            {players.map((player) => {
              const entry = scores[player.playerId];
              return (
                <div key={player.playerId} className="flex items-center gap-3 rounded-xl bg-white/[.035] px-3.5 py-3">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: player.color }} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{player.name}</span>
                  {entry?.answered ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-[#44d79b]">
                      <Check className="size-3.5" /> {entry.correctCount}/{entry.answerCount}
                    </span>
                  ) : (
                    <span className="text-xs text-white/30">sorting…</span>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            className="h-13 w-full rounded-2xl bg-white font-bold text-[#151722] hover:bg-white/90"
            onClick={goNext}
          >
            {gameState.questionIndex === questionBank.length - 1 ? "Show results" : "Next question"}
            <ArrowRight className="ml-1 size-4" />
          </Button>
        </aside>
      </div>
    </HostShell>
  );
}

function HostShell({
  roomCode,
  status,
  children,
}: {
  roomCode: string;
  status: ConnectionStatus;
  children: React.ReactNode;
}) {
  return (
    <main className="game-shell min-h-dvh bg-[#11131d] p-4 text-white sm:p-6">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[1500px] flex-col gap-5 sm:min-h-[calc(100dvh-3rem)]">
        <header className="flex items-center justify-between px-1">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#ff6b4a] shadow-[0_10px_30px_rgba(255,107,74,.25)]">
              <Gamepad2 className="size-5" />
            </span>
            <div>
              <p className="text-lg font-black leading-none tracking-[-.03em]">AirMouse</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[.22em] text-white/35">Host screen</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {status === "connecting" && <LoaderCircle className="size-4 animate-spin text-white/40" />}
            {status === "error" && <WifiOff className="size-4 text-red-400" />}
            <span className="hidden text-xs text-white/35 sm:inline">Room</span>
            <strong className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono tracking-[.18em]">
              {roomCode || "------"}
            </strong>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

function QuestionStage({
  question,
  questionIndex,
  questionCount,
}: {
  question?: PublicQuestion;
  questionIndex: number;
  questionCount: number;
}) {
  if (!question) return null;

  return (
    <section className="host-panel flex flex-col overflow-hidden p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Question {questionIndex + 1} of {questionCount}</span>
        <span className="text-sm text-white/35">Drag every card</span>
      </div>
      <h1 className="mt-6 max-w-5xl text-balance text-4xl font-black leading-[1.02] tracking-[-.04em] sm:text-6xl">
        {question.prompt}
      </h1>
      <p className="mt-3 text-lg text-white/45">{question.instruction}</p>

      <div className={`mt-8 grid flex-1 content-center gap-4 ${question.targets.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {question.targets.map((target, index) => (
          <div
            key={target.id}
            className="relative flex min-h-48 flex-col justify-between overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[.045] p-6"
          >
            <span className="absolute -right-5 -top-8 text-[9rem] font-black leading-none text-white/[.025]">
              {index + 1}
            </span>
            <div className="relative">
              <p className="text-2xl font-black">{target.label}</p>
              <p className="mt-1 text-sm text-white/35">{target.hint}</p>
            </div>
            <div className="relative mt-6 flex flex-wrap gap-2">
              {question.answers.slice(0, 2).map((answer) => (
                <span key={`${target.id}-${answer.id}`} className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-white/15">
                  answer
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-7 flex flex-wrap gap-2.5">
        {question.answers.map((answer) => (
          <span key={answer.id} className="rounded-xl bg-[#fffdf6] px-4 py-3 font-bold text-[#191b26] shadow-lg">
            {answer.label}
          </span>
        ))}
      </div>
    </section>
  );
}
