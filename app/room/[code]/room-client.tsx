"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Gamepad2,
  GripVertical,
  LoaderCircle,
  PartyPopper,
  RotateCcw,
  Sparkles,
  Trophy,
  UserRound,
  Wifi,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRoomChannel } from "@/lib/realtime/room";
import type {
  AnswerResultPayload,
  GameStatePayload,
} from "@/lib/realtime/types";
import { supabase } from "@/lib/supabase/client";

type ConnectionStatus = "connecting" | "connected" | "error";

type DragState = {
  answerId: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
};

const PLAYER_COLORS = ["#ff6b4a", "#5c7cfa", "#15a97b", "#b259e8", "#d89b22"];

function makePlayerId(roomCode: string) {
  const storageKey = `airmouse-player-${roomCode}`;
  const stored = sessionStorage.getItem(storageKey);
  if (stored) return stored;

  const created = crypto.randomUUID();
  sessionStorage.setItem(storageKey, created);
  return created;
}

function hasHost(channel: RealtimeChannel) {
  return (Object.values(channel.presenceState()).flat() as Array<Record<string, unknown>>)
    .some((presence) => presence.kind === "host");
}

export default function RoomClient({ roomCode }: { roomCode: string }) {
  const [status, setStatus] = useState<ConnectionStatus>(
    roomCode ? "connecting" : "error",
  );
  const [hostOnline, setHostOnline] = useState(false);
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [playerColor, setPlayerColor] = useState(PLAYER_COLORS[0]);
  const [gameState, setGameState] = useState<GameStatePayload>({
    phase: "lobby",
    questionIndex: 0,
    questionCount: 0,
  });
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<AnswerResultPayload | null>(null);
  const [totalScore, setTotalScore] = useState(0);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const currentQuestionIdRef = useRef<string | undefined>(undefined);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!roomCode) return;

    const id = makePlayerId(roomCode);
    const storedName = localStorage.getItem("airmouse-nickname") ?? "";
    const colorIndex = Math.abs(
      id.split("").reduce((total, character) => total + character.charCodeAt(0), 0),
    ) % PLAYER_COLORS.length;

    const hydrationTimer = window.setTimeout(() => {
      setPlayerId(id);
      setNickname(storedName);
      setPlayerColor(PLAYER_COLORS[colorIndex]);
    }, 0);

    const channel = getRoomChannel(roomCode, `player-${id}`);
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        setHostOnline(hasHost(channel));
      })
      .on("broadcast", { event: "game-state" }, ({ payload }) => {
        const nextState = payload as GameStatePayload;
        const nextQuestionId = nextState.question?.id;

        if (nextQuestionId !== currentQuestionIdRef.current) {
          currentQuestionIdRef.current = nextQuestionId;
          setPlacements({});
          setSelectedAnswerId(null);
          setSubmitted(false);
          setResult(null);
        }

        setGameState(nextState);
      })
      .on("broadcast", { event: "answer-result" }, ({ payload }) => {
        const answerResult = payload as AnswerResultPayload;

        if (answerResult.playerId !== id) return;

        setResult(answerResult);
        setTotalScore(answerResult.totalScore);
      })
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus("connected");
          void channel.send({
            type: "broadcast",
            event: "request-game-state",
            payload: { playerId: id },
          });
        }

        if (
          subscriptionStatus === "CHANNEL_ERROR" ||
          subscriptionStatus === "TIMED_OUT"
        ) {
          setStatus("error");
        }
      });

    return () => {
      window.clearTimeout(hydrationTimer);
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode]);

  async function joinRoom() {
    const cleanName = nickname.trim().replace(/\s+/g, " ").slice(0, 18);
    const channel = channelRef.current;

    if (!cleanName || !channel || status !== "connected" || !hostOnline) return;

    setNickname(cleanName);
    localStorage.setItem("airmouse-nickname", cleanName);

    await channel.track({
      kind: "player",
      playerId,
      name: cleanName,
      color: playerColor,
      onlineAt: new Date().toISOString(),
    });

    setJoined(true);

    await channel.send({
      type: "broadcast",
      event: "request-game-state",
      payload: { playerId },
    });
  }

  function placeAnswer(answerId: string, targetId: string) {
    if (submitted) return;
    setPlacements((current) => ({ ...current, [answerId]: targetId }));
    setSelectedAnswerId(null);
  }

  function returnAnswer(answerId: string) {
    if (submitted) return;
    setPlacements((current) => {
      const next = { ...current };
      delete next[answerId];
      return next;
    });
  }

  function startDrag(
    answerId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (submitted) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const nextDrag = {
      answerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    dragRef.current = nextDrag;
    setDragState(nextDrag);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;

    const moved =
      current.moved ||
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 6;
    const nextDrag = { ...current, x: event.clientX, y: event.clientY, moved };
    dragRef.current = nextDrag;
    setDragState(nextDrag);
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-answer-target]");

    if (current.moved && target?.dataset.answerTarget) {
      placeAnswer(current.answerId, target.dataset.answerTarget);
    } else if (!current.moved) {
      setSelectedAnswerId((selected) =>
        selected === current.answerId ? null : current.answerId,
      );
    }

    dragRef.current = null;
    setDragState(null);
  }

  async function submitAnswers() {
    const question = gameState.question;
    const channel = channelRef.current;

    if (!question || !channel || submitted) return;
    if (Object.keys(placements).length !== question.answers.length) return;

    setSubmitted(true);
    await channel.send({
      type: "broadcast",
      event: "answer-submitted",
      payload: {
        playerId,
        playerName: nickname,
        questionId: question.id,
        placements,
        elapsedMs: Math.max(0, Date.now() - (gameState.startedAt ?? Date.now())),
      },
    });
  }

  if (!joined) {
    return (
      <PhoneShell roomCode={roomCode} status={status}>
        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-8">
            <span className="player-eyebrow">Room found</span>
            <h1 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em]">
              Pick a name.<br />Then you&apos;re in.
            </h1>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-[#5f6370]">
              You came through the QR, so your room is already selected.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-black/8 bg-white p-5 shadow-[0_22px_70px_rgba(28,27,36,.09)]">
            <label htmlFor="nickname" className="text-sm font-bold text-[#30323c]">
              Your nickname
            </label>
            <div className="mt-2.5 flex items-center rounded-2xl border border-black/10 bg-[#f7f6f2] px-4 focus-within:border-[#ff6b4a]/60 focus-within:ring-4 focus-within:ring-[#ff6b4a]/10">
              <UserRound className="size-5 text-[#9698a0]" />
              <Input
                id="nickname"
                value={nickname}
                maxLength={18}
                placeholder="e.g. Mighty Mango"
                autoComplete="nickname"
                className="h-14 border-0 bg-transparent px-3 text-base font-semibold shadow-none focus-visible:ring-0"
                onChange={(event) => setNickname(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void joinRoom();
                }}
              />
            </div>

            {!hostOnline && status === "connected" && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
                <CircleAlert className="size-4 shrink-0" />
                Looking for the host screen…
              </div>
            )}

            <Button
              className="mt-4 h-14 w-full rounded-2xl bg-[#171922] text-base font-bold text-white hover:bg-[#252835]"
              disabled={!nickname.trim() || !hostOnline || status !== "connected"}
              onClick={() => void joinRoom()}
            >
              Join room
              <ArrowRight className="ml-1 size-4" />
            </Button>
          </div>
        </div>
      </PhoneShell>
    );
  }

  if (gameState.phase === "finished") {
    return (
      <PhoneShell roomCode={roomCode} status={status} score={totalScore}>
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="flex size-20 items-center justify-center rounded-[1.7rem] bg-[#ffd166] text-[#171922] shadow-[0_18px_50px_rgba(216,155,34,.25)]">
            <Trophy className="size-9" />
          </div>
          <span className="player-eyebrow mt-7">Game complete</span>
          <h1 className="mt-3 text-5xl font-black tracking-[-.05em]">Nice sorting!</h1>
          <p className="mt-4 text-[#6b6e78]">Look at the host screen for the final leaderboard.</p>
          <div className="mt-8 rounded-2xl border border-black/8 bg-white px-8 py-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#9a9ca3]">Your score</p>
            <p className="mt-1 font-mono text-4xl font-black">{totalScore.toLocaleString()}</p>
          </div>
        </div>
      </PhoneShell>
    );
  }

  if (gameState.phase === "lobby") {
    return (
      <PhoneShell roomCode={roomCode} status={status} score={totalScore}>
        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <div
            className="flex size-20 items-center justify-center rounded-[1.7rem] text-3xl font-black text-white shadow-[0_18px_50px_rgba(0,0,0,.12)]"
            style={{ backgroundColor: playerColor }}
          >
            {nickname.charAt(0).toUpperCase()}
          </div>
          <span className="player-eyebrow mt-7">You&apos;re in</span>
          <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">Hey, {nickname}!</h1>
          <p className="mt-3 max-w-xs text-[#696c76]">The host will start when everyone has joined.</p>
          <div className="mt-8 flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">
            <LoaderCircle className="size-4 animate-spin text-[#ff6b4a]" />
            Waiting in the lobby
          </div>
        </div>
      </PhoneShell>
    );
  }

  const question = gameState.question;
  if (!question) return null;

  return (
    <PhoneShell roomCode={roomCode} status={status} score={totalScore}>
      <div className="pb-8 pt-5">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[.15em] text-[#90929a]">
          <span>Question {gameState.questionIndex + 1}/{gameState.questionCount}</span>
          <span>{Object.keys(placements).length}/{question.answers.length} placed</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/8">
          <div
            className="h-full rounded-full bg-[#ff6b4a] transition-[width] duration-300"
            style={{ width: `${((gameState.questionIndex + 1) / gameState.questionCount) * 100}%` }}
          />
        </div>

        <h1 className="mt-7 text-balance text-3xl font-black leading-[1.04] tracking-[-.04em]">
          {question.prompt}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#6d707a]">
          Drag a card to a box, or tap a card then tap a box.
        </p>

        <div className={`mt-6 grid gap-3 ${question.targets.length === 3 ? "grid-cols-1" : "grid-cols-2"}`}>
          {question.targets.map((target, index) => {
            const placedAnswers = question.answers.filter(
              (answer) => placements[answer.id] === target.id,
            );

            return (
              <div
                key={target.id}
                data-answer-target={target.id}
                role="button"
                tabIndex={submitted ? -1 : 0}
                aria-disabled={submitted}
                className={`min-h-36 rounded-[1.4rem] border-2 p-3.5 text-left transition ${
                  selectedAnswerId
                    ? "border-[#ff6b4a]/55 bg-[#ff6b4a]/5"
                    : "border-dashed border-black/12 bg-white/55"
                }`}
                onClick={() => {
                  if (selectedAnswerId) placeAnswer(selectedAnswerId, target.id);
                }}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && selectedAnswerId) {
                    event.preventDefault();
                    placeAnswer(selectedAnswerId, target.id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-black">{target.label}</p>
                    <p className="mt-0.5 text-[11px] leading-tight text-[#92949b]">{target.hint}</p>
                  </div>
                  <span className="flex size-7 items-center justify-center rounded-lg bg-black/[.045] text-xs font-black text-black/30">
                    {index + 1}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {placedAnswers.map((answer) => (
                    <span
                      key={answer.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#171922] px-2.5 py-2 text-xs font-bold text-white"
                      onClick={(event) => {
                        event.stopPropagation();
                        returnAnswer(answer.id);
                      }}
                    >
                      {answer.label}
                      {!submitted && <RotateCcw className="size-3 text-white/45" />}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[#8a8c94]">Answer cards</p>
            {selectedAnswerId && <p className="text-xs font-semibold text-[#e55538]">Now tap a box ↑</p>}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {question.answers
              .filter((answer) => !placements[answer.id])
              .map((answer) => (
                <button
                  type="button"
                  key={answer.id}
                  disabled={submitted}
                  className={`flex min-h-14 touch-none select-none items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold shadow-sm transition active:scale-[.98] ${
                    selectedAnswerId === answer.id
                      ? "border-[#ff6b4a] bg-[#fff1ec] ring-4 ring-[#ff6b4a]/10"
                      : "border-black/8 bg-white"
                  }`}
                  onPointerDown={(event) => startDrag(answer.id, event)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={() => {
                    dragRef.current = null;
                    setDragState(null);
                  }}
                >
                  <GripVertical className="size-4 shrink-0 text-[#b0b1b6]" />
                  {answer.label}
                </button>
              ))}
          </div>
        </div>

        {result ? (
          <div className={`mt-5 rounded-[1.4rem] p-4 ${result.correctCount === result.answerCount ? "bg-[#e4f8ef] text-[#087653]" : "bg-[#fff1cf] text-[#805c08]"}`}>
            <div className="flex items-center gap-3">
              {result.correctCount === result.answerCount ? <PartyPopper className="size-6" /> : <Sparkles className="size-6" />}
              <div className="flex-1">
                <p className="font-black">
                  {result.correctCount === result.answerCount ? "Perfect sort!" : `${result.correctCount} of ${result.answerCount} correct`}
                </p>
                <p className="text-sm opacity-75">+{result.points.toLocaleString()} points</p>
              </div>
              <Check className="size-5" />
            </div>
          </div>
        ) : submitted ? (
          <div className="mt-5 flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#171922] font-bold text-white">
            <LoaderCircle className="size-4 animate-spin" />
            Checking your sort…
          </div>
        ) : (
          <Button
            className="mt-5 h-14 w-full rounded-2xl bg-[#ff6b4a] text-base font-black text-white shadow-[0_12px_28px_rgba(255,107,74,.22)] hover:bg-[#f45f40]"
            disabled={Object.keys(placements).length !== question.answers.length}
            onClick={() => void submitAnswers()}
          >
            Lock in answers
            <Check className="ml-1 size-5" />
          </Button>
        )}
      </div>

      {dragState?.moved && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-[#171922] px-4 py-3 text-sm font-bold text-white shadow-2xl"
          style={{ left: dragState.x, top: dragState.y }}
        >
          {question.answers.find((answer) => answer.id === dragState.answerId)?.label}
        </div>
      )}
    </PhoneShell>
  );
}

function PhoneShell({
  roomCode,
  status,
  score,
  children,
}: {
  roomCode: string;
  status: ConnectionStatus;
  score?: number;
  children: React.ReactNode;
}) {
  return (
    <main className="player-shell min-h-dvh bg-[#f4f2ec] px-4 text-[#171922]">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <header className="flex items-center justify-between border-b border-black/[.06] py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#ff6b4a] text-white">
              <Gamepad2 className="size-4.5" />
            </span>
            <strong className="tracking-[-.03em]">AirMouse</strong>
          </div>
          <div className="flex items-center gap-2.5">
            {typeof score === "number" && score > 0 && (
              <span className="rounded-lg bg-white px-2.5 py-1.5 font-mono text-xs font-bold shadow-sm">
                {score.toLocaleString()} pts
              </span>
            )}
            <span className="flex items-center gap-1.5 rounded-lg border border-black/8 bg-white/60 px-2.5 py-1.5 font-mono text-xs font-bold tracking-[.12em]">
              {status === "connecting" ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : status === "error" ? (
                <CircleAlert className="size-3 text-red-500" />
              ) : (
                <Wifi className="size-3 text-[#15a97b]" />
              )}
              {roomCode}
            </span>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
