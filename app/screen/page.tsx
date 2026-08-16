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
  MousePointer2,
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
  CursorMovePayload,
  DropResultPayload,
  GameStatePayload,
  PlayerPresence,
  PointerActionPayload,
} from "@/lib/realtime/types";

type ConnectionStatus = "connecting" | "ready" | "error";

type ScoreEntry = {
  name: string;
  score: number;
};

type CursorPosition = { x: number; y: number };

type SolvedAnswer = {
  targetId: string;
  playerId: string;
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
  const [cursors, setCursors] = useState<Record<string, CursorPosition>>({});
  const [dragging, setDragging] = useState<Record<string, string>>({});
  const [solvedAnswers, setSolvedAnswers] = useState<
    Record<string, SolvedAnswer>
  >({});
  const [lastActions, setLastActions] = useState<Record<string, string>>({});
  const [gameState, setGameState] = useState<GameStatePayload>({
    phase: "lobby",
    questionIndex: 0,
    questionCount: questionBank.length,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const gameStateRef = useRef(gameState);
  const scoresRef = useRef(scores);
  const playersRef = useRef(players);
  const cursorsRef = useRef(cursors);
  const draggingRef = useRef(dragging);
  const solvedAnswersRef = useRef(solvedAnswers);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    scoresRef.current = scores;
  }, [scores]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

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
        const nextPlayers = getPlayers(channel);
        const onlineIds = new Set(nextPlayers.map((player) => player.playerId));

        playersRef.current = nextPlayers;
        setPlayers(nextPlayers);
        const nextDragging = Object.fromEntries(
          Object.entries(draggingRef.current).filter(([playerId]) =>
            onlineIds.has(playerId),
          ),
        );
        draggingRef.current = nextDragging;
        setDragging(nextDragging);
        setCursors((current) => {
          const next = Object.fromEntries(
            Object.entries(current).filter(([playerId]) => onlineIds.has(playerId)),
          );

          nextPlayers.forEach((player, index) => {
            next[player.playerId] ??= {
              x: window.innerWidth / 2 + index * 28,
              y: window.innerHeight / 2 + index * 20,
            };
          });

          cursorsRef.current = next;
          return next;
        });
      })
      .on("broadcast", { event: "request-game-state" }, () => {
        void channel.send({
          type: "broadcast",
          event: "game-state",
          payload: gameStateRef.current,
        });
      })
      .on("broadcast", { event: "cursor-move" }, ({ payload }) => {
        const movement = payload as CursorMovePayload;
        const dx = Math.max(-70, Math.min(70, Number(movement.dx) || 0));
        const dy = Math.max(-70, Math.min(70, Number(movement.dy) || 0));

        if (!movement.playerId || (!dx && !dy)) return;

        setCursors((current) => {
          const previous = current[movement.playerId] ?? {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          };
          const next = {
            ...current,
            [movement.playerId]: {
              x: Math.max(10, Math.min(window.innerWidth - 10, previous.x + dx)),
              y: Math.max(10, Math.min(window.innerHeight - 10, previous.y + dy)),
            },
          };

          cursorsRef.current = next;
          return next;
        });
      })
      .on("broadcast", { event: "pointer-down" }, ({ payload }) => {
        const action = payload as PointerActionPayload;
        const cursor = cursorsRef.current[action.playerId];
        const activeState = gameStateRef.current;

        if (!cursor || activeState.phase !== "question") return;

        const card = document
          .elementFromPoint(cursor.x, cursor.y)
          ?.closest<HTMLElement>("[data-answer-card]");
        const answerId = card?.dataset.answerCard;
        const alreadyHeld = Object.values(draggingRef.current).includes(
          answerId ?? "",
        );

        if (!answerId || alreadyHeld || solvedAnswersRef.current[answerId]) {
          setLastActions((current) => ({
            ...current,
            [action.playerId]: "Move over an answer card",
          }));
          return;
        }

        const nextDragging = {
          ...draggingRef.current,
          [action.playerId]: answerId,
        };
        draggingRef.current = nextDragging;
        setDragging(nextDragging);
        setLastActions((current) => ({
          ...current,
          [action.playerId]: "Holding a card",
        }));
      })
      .on("broadcast", { event: "pointer-up" }, ({ payload }) => {
        const action = payload as PointerActionPayload;
        const answerId = draggingRef.current[action.playerId];
        const cursor = cursorsRef.current[action.playerId];
        const activeQuestion = questionBank.find(
          (question) => question.id === gameStateRef.current.question?.id,
        );

        if (!answerId || !cursor || !activeQuestion) return;

        const targetElement = document
          .elementFromPoint(cursor.x, cursor.y)
          ?.closest<HTMLElement>("[data-answer-target]");
        const targetId = targetElement?.dataset.answerTarget;
        const answer = activeQuestion.answers.find((item) => item.id === answerId);
        const correct = Boolean(targetId && answer?.targetId === targetId);
        const player = playersRef.current.find(
          (item) => item.playerId === action.playerId,
        );
        const previousScore = scoresRef.current[action.playerId]?.score ?? 0;
        const points = correct ? 250 : 0;
        const totalScore = previousScore + points;

        const nextDragging = { ...draggingRef.current };
        delete nextDragging[action.playerId];
        draggingRef.current = nextDragging;
        setDragging(nextDragging);

        if (correct && targetId) {
          const nextSolved = {
            ...solvedAnswersRef.current,
            [answerId]: { targetId, playerId: action.playerId },
          };
          const nextScores = {
            ...scoresRef.current,
            [action.playerId]: {
              name: player?.name ?? "Player",
              score: totalScore,
            },
          };

          solvedAnswersRef.current = nextSolved;
          scoresRef.current = nextScores;
          setSolvedAnswers(nextSolved);
          setScores(nextScores);

          if (Object.keys(nextSolved).length === activeQuestion.answers.length) {
            void channel.send({
              type: "broadcast",
              event: "round-complete",
              payload: { questionId: activeQuestion.id },
            });
          }
        }

        setLastActions((current) => ({
          ...current,
          [action.playerId]: correct ? `Correct! +${points}` : "Try another box",
        }));

        const result: DropResultPayload = {
          playerId: action.playerId,
          questionId: activeQuestion.id,
          answerId,
          correct,
          points,
          totalScore,
        };

        void channel.send({
          type: "broadcast",
          event: "drop-result",
          payload: result,
        });
      })
      .on("broadcast", { event: "recenter" }, ({ payload }) => {
        const action = payload as PointerActionPayload;

        setCursors((current) => {
          const next = {
            ...current,
            [action.playerId]: {
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            },
          };
          cursorsRef.current = next;
          return next;
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

  useEffect(() => {
    function keepCursorsOnScreen() {
      setCursors((current) => {
        const next = Object.fromEntries(
          Object.entries(current).map(([playerId, cursor]) => [
            playerId,
            {
              x: Math.max(10, Math.min(window.innerWidth - 10, cursor.x)),
              y: Math.max(10, Math.min(window.innerHeight - 10, cursor.y)),
            },
          ]),
        );
        cursorsRef.current = next;
        return next;
      });
    }

    window.addEventListener("resize", keepCursorsOnScreen);
    return () => window.removeEventListener("resize", keepCursorsOnScreen);
  }, []);

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

    solvedAnswersRef.current = {};
    draggingRef.current = {};
    setSolvedAnswers({});
    setDragging({});
    setLastActions({});

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
    solvedAnswersRef.current = {};
    draggingRef.current = {};
    setSolvedAnswers({});
    setDragging({});
    setLastActions({});
    broadcastState({
      phase: "lobby",
      questionIndex: 0,
      questionCount: questionBank.length,
    });
  }

  const rankedPlayers = useMemo(() => {
    return players
      .map((player) => ({
        playerId: player.playerId,
        name: scores[player.playerId]?.name ?? player.name,
        score: scores[player.playerId]?.score ?? 0,
        color: player.color,
      }))
      .sort((a, b) => b.score - a.score);
  }, [players, scores]);

  const solvedCount = Object.keys(solvedAnswers).length;
  const activeAnswerCount = gameState.question?.answers.length ?? 0;
  const roundComplete = activeAnswerCount > 0 && solvedCount === activeAnswerCount;

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
                      <span className={`text-xs font-bold ${player.motionEnabled ? "text-[#44d79b]" : "text-white/30"}`}>
                        {player.motionEnabled ? "Motion ready" : "Enable motion"}
                      </span>
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
          solvedAnswers={solvedAnswers}
          dragging={dragging}
          players={players}
        />

        <aside className="host-panel flex min-h-[320px] flex-col p-6">
          <div className="flex items-center justify-between border-b border-white/8 pb-5">
            <div>
              <p className="text-sm text-white/45">Cards sorted</p>
              <p className="mt-1 text-3xl font-black">
                {solvedCount}<span className="text-white/25">/{activeAnswerCount}</span>
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
                  <span className="text-right text-xs text-white/35">
                    {lastActions[player.playerId] ?? "Move your cursor"}
                  </span>
                  <strong className="min-w-12 text-right font-mono text-sm">
                    {entry?.score ?? 0}
                  </strong>
                </div>
              );
            })}
          </div>

          <Button
            className="h-13 w-full rounded-2xl bg-white font-bold text-[#151722] hover:bg-white/90"
            disabled={!roundComplete}
            onClick={goNext}
          >
            {gameState.questionIndex === questionBank.length - 1 ? "Show results" : "Next question"}
            <ArrowRight className="ml-1 size-4" />
          </Button>
        </aside>
      </div>
      <AirMouseCursors
        players={players}
        cursors={cursors}
        dragging={dragging}
        question={gameState.question}
      />
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
  solvedAnswers,
  dragging,
  players,
}: {
  question?: PublicQuestion;
  questionIndex: number;
  questionCount: number;
  solvedAnswers: Record<string, SolvedAnswer>;
  dragging: Record<string, string>;
  players: PlayerPresence[];
}) {
  if (!question) return null;

  const heldAnswerIds = new Set(Object.values(dragging));
  const playerLookup = new Map(players.map((player) => [player.playerId, player]));

  return (
    <section className="host-panel flex flex-col overflow-hidden p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Question {questionIndex + 1} of {questionCount}</span>
        <span className="flex items-center gap-2 text-sm text-white/35">
          <MousePointer2 className="size-4" /> AirMouse controls active
        </span>
      </div>
      <h1 className="mt-5 max-w-5xl text-balance text-3xl font-black leading-[1.02] tracking-[-.04em] sm:text-5xl">
        {question.prompt}
      </h1>
      <p className="mt-2 text-base text-white/45">
        Point with your phone. Hold Grab over a card, move it, then release over a box.
      </p>

      <div className={`mt-6 grid flex-1 content-center gap-4 ${question.targets.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {question.targets.map((target, index) => {
          const placedAnswers = question.answers.filter(
            (answer) => solvedAnswers[answer.id]?.targetId === target.id,
          );

          return (
            <div
              key={target.id}
              data-answer-target={target.id}
              className="relative flex min-h-44 flex-col justify-between overflow-hidden rounded-[1.6rem] border-2 border-dashed border-white/14 bg-white/[.045] p-5 transition-colors"
            >
              <span className="absolute -right-4 -top-7 text-[8rem] font-black leading-none text-white/[.025]">
                {index + 1}
              </span>
              <div className="relative pointer-events-none">
                <p className="text-2xl font-black">{target.label}</p>
                <p className="mt-1 text-sm text-white/35">{target.hint}</p>
              </div>
              <div className="relative mt-5 flex min-h-12 flex-wrap content-end gap-2 pointer-events-none">
                {placedAnswers.length === 0 ? (
                  <span className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-white/20">
                    Drop here
                  </span>
                ) : (
                  placedAnswers.map((answer) => {
                    const owner = playerLookup.get(solvedAnswers[answer.id].playerId);
                    return (
                      <span
                        key={answer.id}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#fffdf6] px-3 py-2.5 font-bold text-[#191b26] shadow-lg"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: owner?.color ?? FALLBACK_COLOR }}
                        />
                        {answer.label}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 min-h-14 rounded-2xl border border-white/8 bg-black/15 p-3">
        <div className="flex flex-wrap gap-2.5">
          {question.answers
            .filter(
              (answer) => !solvedAnswers[answer.id] && !heldAnswerIds.has(answer.id),
            )
            .map((answer) => (
              <span
                key={answer.id}
                data-answer-card={answer.id}
                className="cursor-none rounded-xl bg-[#fffdf6] px-4 py-3 font-bold text-[#191b26] shadow-lg ring-2 ring-transparent"
              >
                {answer.label}
              </span>
            ))}
          {question.answers.every(
            (answer) => solvedAnswers[answer.id] || heldAnswerIds.has(answer.id),
          ) && (
            <span className="px-2 py-2 text-sm font-semibold text-white/35">
              All cards are being sorted
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function AirMouseCursors({
  players,
  cursors,
  dragging,
  question,
}: {
  players: PlayerPresence[];
  cursors: Record<string, CursorPosition>;
  dragging: Record<string, string>;
  question?: PublicQuestion;
}) {
  return players.map((player) => {
    const cursor = cursors[player.playerId];
    const heldAnswerId = dragging[player.playerId];
    const heldAnswer = question?.answers.find((answer) => answer.id === heldAnswerId);

    if (!cursor) return null;

    return (
      <div
        key={player.playerId}
        className="pointer-events-none fixed z-[100]"
        style={{ left: cursor.x, top: cursor.y }}
      >
        {heldAnswer && (
          <div className="absolute bottom-5 left-5 whitespace-nowrap rounded-xl bg-[#fffdf6] px-4 py-3 font-bold text-[#191b26] shadow-2xl ring-2 ring-white/70">
            {heldAnswer.label}
          </div>
        )}
        <div
          className="absolute -left-1 -top-1 size-7 rounded-full border-[3px] border-white shadow-xl"
          style={{ backgroundColor: player.color }}
        >
          <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </div>
        <span
          className="absolute left-5 top-5 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-black text-white shadow-lg"
          style={{ backgroundColor: player.color }}
        >
          {player.name}
        </span>
      </div>
    );
  });
}
