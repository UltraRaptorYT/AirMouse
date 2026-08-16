"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Crosshair,
  Gamepad2,
  Hand,
  LoaderCircle,
  Move3d,
  Pause,
  Smartphone,
  Sparkles,
  Trophy,
  UserRound,
  Wifi,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRoomChannel } from "@/lib/realtime/room";
import type {
  DropResultPayload,
  GameStatePayload,
} from "@/lib/realtime/types";
import { supabase } from "@/lib/supabase/client";

type ConnectionStatus = "connecting" | "connected" | "error";
type SensorStatus = "idle" | "requesting" | "active" | "denied" | "unsupported";
type OrientationReading = { alpha: number; beta: number };
type PermissionCapableEvent = {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const PLAYER_COLORS = ["#ff6b4a", "#5c7cfa", "#15a97b", "#b259e8", "#d89b22"];
const HORIZONTAL_ORIENTATION_SENSITIVITY = 8;
const VERTICAL_ORIENTATION_SENSITIVITY = 5;
const HORIZONTAL_ACCELERATION_SENSITIVITY = 0.7;
const VERTICAL_ACCELERATION_SENSITIVITY = 0.45;
const SEND_INTERVAL_MS = 32;
const DEAD_ZONE = 0.08;

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

function normalizeAngleDelta(current: number, previous: number) {
  let delta = current - previous;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
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
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("idle");
  const [isHolding, setIsHolding] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    message: string;
  } | null>(null);
  const [roundComplete, setRoundComplete] = useState(false);
  const [gameState, setGameState] = useState<GameStatePayload>({
    phase: "lobby",
    questionIndex: 0,
    questionCount: 0,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const previousOrientationRef = useRef<OrientationReading | null>(null);
  const lastOrientationAtRef = useRef(0);
  const movementBufferRef = useRef({ dx: 0, dy: 0 });
  const lastSentAtRef = useRef(0);
  const holdingRef = useRef(false);
  const currentQuestionIdRef = useRef<string | undefined>(undefined);

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
          holdingRef.current = false;
          setIsHolding(false);
          setFeedback(null);
          setRoundComplete(false);
        }

        setGameState(nextState);
      })
      .on("broadcast", { event: "drop-result" }, ({ payload }) => {
        const result = payload as DropResultPayload;
        if (result.playerId !== id) return;

        setTotalScore(result.totalScore);
        setFeedback({
          correct: result.correct,
          message: result.correct
            ? `Correct box! +${result.points} points`
            : "Not that box — try again",
        });
      })
      .on("broadcast", { event: "round-complete" }, () => {
        setRoundComplete(true);
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

  useEffect(() => {
    if (sensorStatus !== "active" || !playerId) return;

    function sendBufferedMovement() {
      const now = performance.now();
      if (now - lastSentAtRef.current < SEND_INTERVAL_MS) return;

      const { dx, dy } = movementBufferRef.current;
      movementBufferRef.current = { dx: 0, dy: 0 };
      lastSentAtRef.current = now;

      if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;

      void channelRef.current?.send({
        type: "broadcast",
        event: "cursor-move",
        payload: { playerId, dx, dy },
      });
    }

    function addMovement(dx: number, dy: number) {
      movementBufferRef.current.dx += dx;
      movementBufferRef.current.dy += dy;
      sendBufferedMovement();
    }

    function handleOrientation(event: DeviceOrientationEvent) {
      const current = {
        alpha: event.alpha ?? 0,
        beta: event.beta ?? 0,
      };
      const previous = previousOrientationRef.current;
      previousOrientationRef.current = current;
      lastOrientationAtRef.current = performance.now();

      if (!previous) return;

      addMovement(
        -normalizeAngleDelta(current.alpha, previous.alpha) *
          HORIZONTAL_ORIENTATION_SENSITIVITY,
        -(current.beta - previous.beta) * VERTICAL_ORIENTATION_SENSITIVITY,
      );
    }

    function handleMotion(event: DeviceMotionEvent) {
      const acceleration = event.acceleration;
      let dx =
        (acceleration?.x ?? 0) * HORIZONTAL_ACCELERATION_SENSITIVITY;
      let dy =
        -(acceleration?.y ?? 0) * VERTICAL_ACCELERATION_SENSITIVITY;

      if (performance.now() - lastOrientationAtRef.current > 250) {
        dx += -(event.rotationRate?.beta ?? 0) * 0.08;
        dy += -(event.rotationRate?.gamma ?? 0) * 0.08;
      }

      addMovement(dx, dy);
    }

    window.addEventListener("deviceorientation", handleOrientation);
    window.addEventListener("devicemotion", handleMotion);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("devicemotion", handleMotion);
      previousOrientationRef.current = null;
      movementBufferRef.current = { dx: 0, dy: 0 };
    };
  }, [sensorStatus, playerId]);

  async function joinRoom() {
    const cleanName = nickname.trim().replace(/\s+/g, " ").slice(0, 18);
    const channel = channelRef.current;

    if (
      !cleanName ||
      !playerId ||
      !channel ||
      status !== "connected" ||
      !hostOnline
    ) {
      return;
    }

    setNickname(cleanName);
    localStorage.setItem("airmouse-nickname", cleanName);

    await channel.track({
      kind: "player",
      playerId,
      name: cleanName,
      color: playerColor,
      motionEnabled: false,
      onlineAt: new Date().toISOString(),
    });

    setJoined(true);
    await channel.send({
      type: "broadcast",
      event: "request-game-state",
      payload: { playerId },
    });
  }

  async function enableMotion() {
    if (
      typeof DeviceOrientationEvent === "undefined" &&
      typeof DeviceMotionEvent === "undefined"
    ) {
      setSensorStatus("unsupported");
      return;
    }

    setSensorStatus("requesting");

    try {
      const permissionRequests: Array<Promise<"granted" | "denied">> = [];

      if (typeof DeviceOrientationEvent !== "undefined") {
        const orientationEvent =
          DeviceOrientationEvent as unknown as PermissionCapableEvent;
        if (typeof orientationEvent.requestPermission === "function") {
          permissionRequests.push(orientationEvent.requestPermission());
        }
      }
      if (typeof DeviceMotionEvent !== "undefined") {
        const motionEvent = DeviceMotionEvent as unknown as PermissionCapableEvent;
        if (typeof motionEvent.requestPermission === "function") {
          permissionRequests.push(motionEvent.requestPermission());
        }
      }

      const permissions = await Promise.all(permissionRequests);
      if (permissions.some((permission) => permission !== "granted")) {
        setSensorStatus("denied");
        return;
      }

      previousOrientationRef.current = null;
      setSensorStatus("active");

      await channelRef.current?.track({
        kind: "player",
        playerId,
        name: nickname,
        color: playerColor,
        motionEnabled: true,
        onlineAt: new Date().toISOString(),
      });
    } catch {
      setSensorStatus("denied");
    }
  }

  async function pauseMotion() {
    releaseGrab();
    setSensorStatus("idle");
    previousOrientationRef.current = null;

    await channelRef.current?.track({
      kind: "player",
      playerId,
      name: nickname,
      color: playerColor,
      motionEnabled: false,
      onlineAt: new Date().toISOString(),
    });
  }

  function recenter() {
    previousOrientationRef.current = null;
    void channelRef.current?.send({
      type: "broadcast",
      event: "recenter",
      payload: { playerId },
    });
  }

  function startGrab() {
    if (holdingRef.current || sensorStatus !== "active") return;
    holdingRef.current = true;
    setIsHolding(true);
    setFeedback(null);
    void channelRef.current?.send({
      type: "broadcast",
      event: "pointer-down",
      payload: { playerId },
    });
  }

  function releaseGrab() {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setIsHolding(false);
    void channelRef.current?.send({
      type: "broadcast",
      event: "pointer-up",
      payload: { playerId },
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
              disabled={!nickname.trim() || !playerId || !hostOnline || status !== "connected"}
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
          <h1 className="mt-3 text-5xl font-black tracking-[-.05em]">Nice flying!</h1>
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
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div
            className="flex size-20 items-center justify-center rounded-[1.7rem] text-3xl font-black text-white shadow-[0_18px_50px_rgba(0,0,0,.12)]"
            style={{ backgroundColor: playerColor }}
          >
            {nickname.charAt(0).toUpperCase()}
          </div>
          <span className="player-eyebrow mt-7">You&apos;re in</span>
          <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">Hey, {nickname}!</h1>
          <p className="mt-3 max-w-xs text-[#696c76]">
            Enable motion now, then keep this phone pointed at the host screen.
          </p>

          <MotionButton
            sensorStatus={sensorStatus}
            onEnable={() => void enableMotion()}
            onPause={() => void pauseMotion()}
          />

          <div className="mt-5 flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">
            <LoaderCircle className="size-4 animate-spin text-[#ff6b4a]" />
            Waiting for the host
          </div>
        </div>
      </PhoneShell>
    );
  }

  const question = gameState.question;
  if (!question) return null;

  return (
    <PhoneShell roomCode={roomCode} status={status} score={totalScore}>
      <div className="flex flex-1 flex-col pb-6 pt-5">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[.15em] text-[#90929a]">
          <span>Question {gameState.questionIndex + 1}/{gameState.questionCount}</span>
          <span className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${sensorStatus === "active" ? "bg-[#15a97b]" : "bg-amber-500"}`} />
            {sensorStatus === "active" ? "Motion live" : "Motion off"}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/8">
          <div
            className="h-full rounded-full bg-[#ff6b4a] transition-[width] duration-300"
            style={{ width: `${((gameState.questionIndex + 1) / gameState.questionCount) * 100}%` }}
          />
        </div>

        <h1 className="mt-6 text-balance text-2xl font-black leading-[1.04] tracking-[-.04em]">
          {question.prompt}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#6d707a]">
          Watch the shared screen. Tilt your phone to steer your colored cursor.
        </p>

        {sensorStatus !== "active" ? (
          <div className="my-7 rounded-[1.6rem] border border-black/8 bg-white p-5 text-center shadow-sm">
            <Smartphone className="mx-auto size-9 text-[#ff6b4a]" />
            <p className="mt-3 font-black">Motion control is paused</p>
            <p className="mt-1 text-sm text-[#777a83]">Your browser needs sensor access to move the AirMouse.</p>
            <MotionButton
              sensorStatus={sensorStatus}
              onEnable={() => void enableMotion()}
              onPause={() => void pauseMotion()}
            />
          </div>
        ) : (
          <div className="my-6 flex flex-1 flex-col">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-black/8 bg-white/70 p-4">
                <Move3d className="size-5 text-[#5c7cfa]" />
                <p className="mt-3 text-sm font-black">Tilt to move</p>
                <p className="mt-1 text-xs leading-relaxed text-[#858790]">Gyroscope + acceleration</p>
              </div>
              <button
                type="button"
                className="rounded-2xl border border-black/8 bg-white/70 p-4 text-left active:scale-[.98]"
                onClick={recenter}
              >
                <Crosshair className="size-5 text-[#15a97b]" />
                <p className="mt-3 text-sm font-black">Recenter</p>
                <p className="mt-1 text-xs leading-relaxed text-[#858790]">Reset cursor position</p>
              </button>
            </div>

            <div className="flex flex-1 items-center justify-center py-6">
              <button
                type="button"
                aria-label="Hold to grab an answer card and release to drop it"
                className={`flex aspect-square w-full max-w-[260px] touch-none select-none flex-col items-center justify-center rounded-full border-[10px] font-black shadow-[0_24px_60px_rgba(23,25,34,.18)] transition active:scale-[.97] ${
                  isHolding
                    ? "border-[#ffb29f] bg-[#ff6b4a] text-white"
                    : "border-white bg-[#171922] text-white"
                }`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  startGrab();
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  releaseGrab();
                }}
                onPointerCancel={releaseGrab}
                onKeyDown={(event) => {
                  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                    event.preventDefault();
                    startGrab();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === " " || event.key === "Enter") releaseGrab();
                }}
              >
                <Hand className={`size-14 ${isHolding ? "fill-white/20" : ""}`} />
                <span className="mt-3 text-xl">{isHolding ? "Release to drop" : "Hold to grab"}</span>
                <span className="mt-1 text-xs font-semibold opacity-50">Watch your cursor on screen</span>
              </button>
            </div>

            <Button
              variant="outline"
              className="h-11 rounded-xl border-black/10 bg-transparent text-[#686b75]"
              onClick={() => void pauseMotion()}
            >
              <Pause className="mr-1 size-4" /> Pause motion
            </Button>
          </div>
        )}

        {feedback && (
          <div className={`rounded-2xl p-4 ${feedback.correct ? "bg-[#e4f8ef] text-[#087653]" : "bg-[#fff0ec] text-[#b43c25]"}`}>
            <div className="flex items-center gap-3">
              {feedback.correct ? <Check className="size-5" /> : <X className="size-5" />}
              <p className="font-black">{feedback.message}</p>
            </div>
          </div>
        )}

        {roundComplete && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-[#fff4cf] p-4 text-[#755509]">
            <Sparkles className="size-5" />
            <p className="font-black">Round complete! Look at the host screen.</p>
          </div>
        )}
      </div>
    </PhoneShell>
  );
}

function MotionButton({
  sensorStatus,
  onEnable,
  onPause,
}: {
  sensorStatus: SensorStatus;
  onEnable: () => void;
  onPause: () => void;
}) {
  if (sensorStatus === "active") {
    return (
      <Button
        variant="outline"
        className="mt-7 h-14 rounded-2xl border-[#15a97b]/25 bg-[#e4f8ef] font-black text-[#087653] hover:bg-[#d9f3e9]"
        onClick={onPause}
      >
        <Check className="mr-1 size-5" /> Motion ready
      </Button>
    );
  }

  return (
    <div className="mt-7 w-full max-w-sm">
      <Button
        className="h-14 w-full rounded-2xl bg-[#171922] text-base font-black text-white hover:bg-[#252835]"
        disabled={sensorStatus === "requesting"}
        onClick={onEnable}
      >
        {sensorStatus === "requesting" ? (
          <LoaderCircle className="mr-1 size-5 animate-spin" />
        ) : (
          <Move3d className="mr-1 size-5" />
        )}
        {sensorStatus === "requesting" ? "Requesting access…" : "Enable AirMouse motion"}
      </Button>
      {(sensorStatus === "denied" || sensorStatus === "unsupported") && (
        <p className="mt-2 text-xs font-semibold text-red-600">
          {sensorStatus === "denied"
            ? "Motion access was denied. Allow Motion & Orientation in your browser settings."
            : "This browser does not expose motion sensors. Try Safari or Chrome on your phone."}
        </p>
      )}
    </div>
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
