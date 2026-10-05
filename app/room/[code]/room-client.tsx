"use client";

import { useEffect, useRef, useState } from "react";
import { TbHandGrab, TbHandStop } from "react-icons/tb";
import {
  ArrowRight,
  ArrowUp,
  Check,
  CircleAlert,
  Crosshair,
  Clock3,
  Gamepad2,
  Languages,
  LoaderCircle,
  Move3d,
  Sparkles,
  Trophy,
  UserRound,
  Wifi,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { colorForPlayer, PLAYER_COLORS } from "@/lib/realtime/colors";
import {
  createRoomSocket,
  type RoomConnectionStatus,
  type RoomSocket,
} from "@/lib/realtime/room";
import type {
  DropResultPayload,
  GameStatePayload,
  PlayerPresence,
  ServerRoomMessage,
} from "@/lib/realtime/types";

type ConnectionStatus = RoomConnectionStatus;
type SensorStatus = "idle" | "requesting" | "active" | "denied" | "unsupported";
type OrientationReading = { alpha: number; beta: number };
type PermissionCapableEvent = {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const HORIZONTAL_AIM_RANGE_DEGREES = 32;
const VERTICAL_AIM_RANGE_DEGREES = 24;
// Light sensor smoothing only; the host interpolates per frame, so heavy smoothing here just adds lag.
const AIM_SMOOTHING = 0.5;
// ~60 packets/sec (matches the sensor rate). Each packet is ~50 bytes.
const SEND_INTERVAL_MS = 16;
const AIM_CHANGE_THRESHOLD = 0.002;

function makePlayerId(roomCode: string) {
  const storageKey = `airmouse-player-${roomCode}`;
  const stored = sessionStorage.getItem(storageKey);
  if (stored) return stored;

  const created = crypto.randomUUID();
  sessionStorage.setItem(storageKey, created);
  return created;
}

function normalizeAngleDelta(current: number, previous: number) {
  let delta = current - previous;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function clampAim(value: number) {
  return Math.max(-1, Math.min(1, value));
}

export default function RoomClient({ roomCode }: { roomCode: string }) {
  const [status, setStatus] = useState<ConnectionStatus>(
    roomCode ? "connecting" : "error",
  );
  const [hostOnline, setHostOnline] = useState(false);
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [playerColor, setPlayerColor] = useState<string>(PLAYER_COLORS[0]);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("idle");
  const [calibrated, setCalibrated] = useState(false);
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

  const socketRef = useRef<RoomSocket | null>(null);
  const orientationOriginRef = useRef<OrientationReading | null>(null);
  // Aim packets are held back until the player has pointed at the on-screen dot and tapped Calibrate.
  const calibratedRef = useRef(false);
  const smoothedAimRef = useRef({ x: 0, y: 0 });
  const lastSentAimRef = useRef({ x: Number.NaN, y: Number.NaN });
  const lastSentAtRef = useRef(0);
  const holdingRef = useRef(false);
  const joinedRef = useRef(false);
  const nicknameRef = useRef("");
  const playerColorRef = useRef<string>(PLAYER_COLORS[0]);
  const sensorStatusRef = useRef<SensorStatus>("idle");
  const currentQuestionIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;

    let wakeLock: WakeLockSentinel | null = null;
    let requesting = false;
    let disposed = false;

    async function keepScreenAwake() {
      if (
        disposed ||
        requesting ||
        wakeLock ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      requesting = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") {
          await lock.release();
        } else {
          wakeLock = lock;
        }
      } catch {
        // Wake locks may be unavailable in unsupported browsers or low-power mode.
      } finally {
        requesting = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void keepScreenAwake();
      } else if (wakeLock) {
        void wakeLock.release();
        wakeLock = null;
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void keepScreenAwake();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLock) void wakeLock.release();
    };
  }, []);

  useEffect(() => {
    if (!roomCode) return;

    const id = makePlayerId(roomCode);
    const storedName = localStorage.getItem("airmouse-nickname") ?? "";
    const storedScore = Number(
      sessionStorage.getItem(`airmouse-score-${roomCode}`) ?? "0",
    );
    const color = colorForPlayer(id);

    joinedRef.current = false;
    nicknameRef.current = storedName;
    playerColorRef.current = color;

    const hydrationTimer = window.setTimeout(() => {
      setPlayerId(id);
      setNickname(storedName);
      setPlayerColor(color);
      setJoined(false);
      if (Number.isFinite(storedScore)) setTotalScore(storedScore);
    }, 0);

    function handleMessage(message: ServerRoomMessage) {
      if (message.type === "connected" || message.type === "presence") {
        setHostOnline(message.hostOnline);
        const self = message.players.find((player) => player.playerId === id);
        if (self?.color && self.color !== playerColorRef.current) {
          playerColorRef.current = self.color;
          setPlayerColor(self.color);
        }
        return;
      }

      if (message.type === "game-state") {
        const nextState = message.payload;
        const nextQuestionId = nextState.question?.id;

        if (nextQuestionId !== currentQuestionIdRef.current) {
          currentQuestionIdRef.current = nextQuestionId;
          holdingRef.current = false;
          setIsHolding(false);
          setFeedback(null);
          setRoundComplete(false);
        }

        setGameState(nextState);
        return;
      }

      if (message.type === "drop-result") {
        const result: DropResultPayload = message.payload;
        if (result.playerId !== id) return;

        setTotalScore(result.totalScore);
        sessionStorage.setItem(
          `airmouse-score-${roomCode}`,
          String(result.totalScore),
        );
        setFeedback({
          correct: result.correct,
          message: result.correct
            ? `Right spot! +${result.points} points`
            : "Not the right spot — look at the screen and move it",
        });
        return;
      }

      if (message.type === "round-complete") {
        setRoundComplete(true);
      }
    }

    const socket = createRoomSocket({
      roomCode,
      role: "player",
      clientId: id,
      onStatus: setStatus,
      onMessage: handleMessage,
      onOpen: () => {
        if (joinedRef.current) {
          const presence: PlayerPresence = {
            kind: "player",
            playerId: id,
            name: nicknameRef.current,
            color: playerColorRef.current,
            motionEnabled: sensorStatusRef.current === "active",
            onlineAt: new Date().toISOString(),
          };
          socketRef.current?.send({ type: "join", payload: presence });
        }
        socketRef.current?.send({ type: "request-game-state" });
      },
    });
    socketRef.current = socket;

    return () => {
      window.clearTimeout(hydrationTimer);
      socket.close();
      socketRef.current = null;
    };
  }, [roomCode]);

  useEffect(() => {
    if (sensorStatus !== "active" || !playerId) return;

    function sendAim(x: number, y: number) {
      const now = performance.now();
      if (now - lastSentAtRef.current < SEND_INTERVAL_MS) return;

      const previous = lastSentAimRef.current;
      if (
        Math.abs(x - previous.x) < AIM_CHANGE_THRESHOLD &&
        Math.abs(y - previous.y) < AIM_CHANGE_THRESHOLD
      ) {
        return;
      }

      lastSentAtRef.current = now;
      lastSentAimRef.current = { x, y };
      socketRef.current?.send({
        type: "cursor-aim",
        payload: { x, y },
      });
    }

    function handleOrientation(event: DeviceOrientationEvent) {
      if (typeof event.alpha !== "number" || typeof event.beta !== "number") {
        return;
      }
      if (!calibratedRef.current) return;

      const current = {
        alpha: event.alpha,
        beta: event.beta,
      };
      const origin = orientationOriginRef.current;
      if (!origin) {
        orientationOriginRef.current = current;
        smoothedAimRef.current = { x: 0, y: 0 };
        sendAim(0, 0);
        return;
      }

      const rawAim = {
        x: clampAim(
          -normalizeAngleDelta(current.alpha, origin.alpha) /
            HORIZONTAL_AIM_RANGE_DEGREES,
        ),
        y: clampAim(-(current.beta - origin.beta) / VERTICAL_AIM_RANGE_DEGREES),
      };
      const previousAim = smoothedAimRef.current;
      const nextAim = {
        x: previousAim.x + (rawAim.x - previousAim.x) * AIM_SMOOTHING,
        y: previousAim.y + (rawAim.y - previousAim.y) * AIM_SMOOTHING,
      };
      smoothedAimRef.current = nextAim;
      sendAim(nextAim.x, nextAim.y);
    }

    window.addEventListener("deviceorientation", handleOrientation);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      orientationOriginRef.current = null;
      smoothedAimRef.current = { x: 0, y: 0 };
      lastSentAimRef.current = { x: Number.NaN, y: Number.NaN };
    };
  }, [sensorStatus, playerId]);

  async function joinRoom() {
    const cleanName = nickname.trim().replace(/\s+/g, " ").slice(0, 18);
    const socket = socketRef.current;

    if (
      !cleanName ||
      !playerId ||
      !socket ||
      status !== "connected" ||
      !hostOnline
    ) {
      return;
    }

    const motionGranted = await requestMotionAccess();

    setNickname(cleanName);
    nicknameRef.current = cleanName;
    localStorage.setItem("airmouse-nickname", cleanName);

    const presence: PlayerPresence = {
      kind: "player",
      playerId,
      name: cleanName,
      color: playerColor,
      motionEnabled: motionGranted,
      onlineAt: new Date().toISOString(),
    };
    if (!socket.send({ type: "join", payload: presence })) return;

    joinedRef.current = true;
    setJoined(true);
    sessionStorage.setItem(`airmouse-joined-${roomCode}`, "true");
    socket.send({ type: "request-game-state" });
  }

  async function enableMotion() {
    const motionGranted = await requestMotionAccess();
    if (!motionGranted || !playerId || !joinedRef.current) return;

    socketRef.current?.send({
      type: "player-update",
      payload: {
        kind: "player",
        playerId,
        name: nicknameRef.current,
        color: playerColorRef.current,
        motionEnabled: true,
        onlineAt: new Date().toISOString(),
      },
    });
  }

  async function requestMotionAccess() {
    if (typeof DeviceOrientationEvent === "undefined") {
      sensorStatusRef.current = "unsupported";
      setSensorStatus("unsupported");
      return false;
    }

    sensorStatusRef.current = "requesting";
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
      const permissions = await Promise.all(permissionRequests);
      if (permissions.some((permission) => permission !== "granted")) {
        sensorStatusRef.current = "denied";
        setSensorStatus("denied");
        return false;
      }

      orientationOriginRef.current = null;
      smoothedAimRef.current = { x: 0, y: 0 };
      lastSentAimRef.current = { x: Number.NaN, y: Number.NaN };
      sensorStatusRef.current = "active";
      setSensorStatus("active");
      return true;
    } catch {
      sensorStatusRef.current = "denied";
      setSensorStatus("denied");
      return false;
    }
  }

  function recenter() {
    orientationOriginRef.current = null;
    smoothedAimRef.current = { x: 0, y: 0 };
    lastSentAimRef.current = { x: Number.NaN, y: Number.NaN };
    lastSentAtRef.current = 0;
    socketRef.current?.send({ type: "recenter" });
  }

  // Called while the phone is pointed at the dot in the middle of the host screen:
  // the next orientation reading becomes the origin, i.e. "screen centre".
  function calibrate() {
    calibratedRef.current = true;
    setCalibrated(true);
    recenter();
  }

  function syncAimBeforePointerAction() {
    const aim = smoothedAimRef.current;
    lastSentAtRef.current = performance.now();
    lastSentAimRef.current = aim;
    socketRef.current?.send({ type: "cursor-aim", payload: aim });
  }

  function startGrab() {
    if (holdingRef.current || sensorStatus !== "active") return;
    holdingRef.current = true;
    setIsHolding(true);
    setFeedback(null);
    syncAimBeforePointerAction();
    socketRef.current?.send({ type: "pointer-down" });
  }

  function releaseGrab() {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setIsHolding(false);
    syncAimBeforePointerAction();
    socketRef.current?.send({ type: "pointer-up" });
  }

  const isChinese = gameState.language === "zh";

  if (!joined) {
    return (
      <PhoneShell roomCode={roomCode} status={status}>
        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-8">
            <span className="player-eyebrow">Room found</span>
            <h1 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em]">
              Pick a name.
              <br />
              Then you&apos;re in.
            </h1>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-[#5f6370]">
              You came through the QR, so your room is already selected.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-black/8 bg-white p-5 shadow-[0_22px_70px_rgba(28,27,36,.09)]">
            <label
              htmlFor="nickname"
              className="text-sm font-bold text-[#30323c]"
            >
              Your Name
            </label>
            <div className="mt-2.5 flex items-center rounded-2xl border border-black/10 bg-[#f7f6f2] px-4 focus-within:border-[#ff6b4a]/60 focus-within:ring-4 focus-within:ring-[#ff6b4a]/10">
              <UserRound className="size-5 text-[#9698a0]" />
              <Input
                id="nickname"
                value={nickname}
                maxLength={18}
                placeholder="e.g. Alex, Jess"
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

            {(status === "reconnecting" || status === "error") && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                Unable to reach the room service. Check your connection and try
                again.
              </div>
            )}

            {(sensorStatus === "denied" || sensorStatus === "unsupported") && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {sensorStatus === "denied"
                  ? "Motion access is required to join. Allow Motion & Orientation in your browser settings, then try again."
                  : "This browser does not expose motion sensors. Try Safari or Chrome on your phone."}
              </div>
            )}

            <Button
              className="mt-4 h-14 w-full rounded-2xl bg-[#171922] text-base font-bold text-white hover:bg-[#252835]"
              disabled={
                !nickname.trim() ||
                !playerId ||
                !hostOnline ||
                status !== "connected" ||
                sensorStatus === "requesting"
              }
              onClick={() => void joinRoom()}
            >
              {sensorStatus === "requesting" ? (
                <LoaderCircle className="mr-1 size-5 animate-spin" />
              ) : (
                <Move3d className="mr-1 size-5" />
              )}
              {sensorStatus === "requesting"
                ? "Starting AirMouse…"
                : "Join room"}
              {sensorStatus !== "requesting" && (
                <ArrowRight className="ml-1 size-4" />
              )}
            </Button>
          </div>
        </div>
      </PhoneShell>
    );
  }

  if (gameState.phase === "finished" && gameState.timedOut) {
    return (
      <PhoneShell roomCode={roomCode} status={status} score={totalScore}>
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="flex size-20 items-center justify-center rounded-[1.7rem] bg-[#e56b35] text-white shadow-[0_18px_50px_rgba(216,155,34,.25)]">
            <Trophy className="size-9" />
          </div>
          <span className="player-eyebrow mt-7">
            {isChinese ? "挑战已结束" : "Challenge ended"}
          </span>
          <h1 className="mt-3 text-4xl font-black tracking-[-.05em] sm:text-5xl">
            {isChinese ? "挑战未完成" : "Challenge not completed"}
          </h1>
          <p className="mt-4 max-w-sm text-[#6b6e78]">
            {isChinese
              ? "配对时间已达 20 分钟上限。请查看大屏上的队伍合影。"
              : "The 20-minute matching limit was reached. See the host screen for your team photo."}
          </p>
          <div className="mt-8 rounded-2xl border border-black/8 bg-white px-8 py-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#9a9ca3]">
              {isChinese ? "本场得分" : "Score this game"}
            </p>
            <p className="mt-1 font-mono text-4xl font-black">
              {totalScore.toLocaleString()}
            </p>
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
          <span className="player-eyebrow mt-7">{isChinese ? "游戏完成" : "Game complete"}</span>
          <h1 className="mt-3 text-5xl font-black tracking-[-.05em]">
            {isChinese ? "表现出色！" : "Nice flying!"}
          </h1>
          <p className="mt-4 text-[#6b6e78]">
            {isChinese ? "请查看主持人屏幕上的最终排行榜。" : "Look at the host screen for the final leaderboard."}
          </p>
          <div className="mt-8 rounded-2xl border border-black/8 bg-white px-8 py-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#9a9ca3]">
              {isChinese ? "你的分数" : "Your score"}
            </p>
            <p className="mt-1 font-mono text-4xl font-black">
              {totalScore.toLocaleString()}
            </p>
          </div>
        </div>
      </PhoneShell>
    );
  }

  if (sensorStatus === "active" && !calibrated) {
    return (
      <PhoneShell roomCode={roomCode} status={status} score={totalScore}>
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="relative flex size-36 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#ff6b4a]/15" />
            <span className="absolute inset-4 rounded-full border-2 border-dashed border-[#ff6b4a]/40" />
            <div className="relative flex size-24 items-center justify-center rounded-full bg-[#171922] text-white shadow-[0_24px_60px_rgba(23,25,34,.25)]">
              <ArrowUp className="size-12 animate-bounce" strokeWidth={2.5} />
            </div>
          </div>
          <span className="player-eyebrow mt-8">{isChinese ? "校准" : "Calibrate"}</span>
          <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">
            {isChinese ? "对准圆点" : "Point at the dot"}
          </h1>
          <p className="mt-4 max-w-xs leading-relaxed text-[#696c76]">
            {isChinese
              ? <>像拿遥控器一样握住手机，将手机顶部对准大屏中央的<span className="font-bold text-[#ff6b4a]">橙色圆点</span>。保持稳定后点击“校准”。</>
              : <>Hold your phone like a remote and aim the top at the <span className="font-bold text-[#ff6b4a]">orange dot</span> in the centre of the big screen. Keep it steady, then tap Calibrate.</>}
          </p>

          <Button
            className="mt-8 h-14 w-full max-w-xs rounded-2xl bg-[#ff6b4a] text-base font-bold text-white hover:bg-[#ff7a5d]"
            onClick={calibrate}
          >
            <Crosshair className="mr-1 size-5" />
            {isChinese ? "校准" : "Calibrate"}
          </Button>
          <p className="mt-4 text-xs font-semibold text-[#9a9ca3]">
            {isChinese ? "之后可随时重新校准。" : "You can recenter at any time later."}
          </p>
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
          <span className="player-eyebrow mt-7">{isChinese ? "已加入" : "You’re in"}</span>
          <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">
            {isChinese ? `你好，${nickname}！` : `Hey, ${nickname}!`}
          </h1>
          <p className="mt-3 max-w-xs text-[#696c76]">
            {isChinese
              ? "将手机对准主持人屏幕，和大家一起把手势光标移到开始区域。"
              : "Keep your phone pointed at the host screen, then move your hand cursor into the shared start zone with everyone else."}
          </p>

          <div className="mt-5 flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">
            <LoaderCircle className="size-4 animate-spin text-[#ff6b4a]" />
            {isChinese ? "将光标移入开始区域以开始" : "Hover to the start zone to begin"}
          </div>

          {sensorStatus !== "active" && (
            <div className="mt-5 w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-amber-900">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-black">{isChinese ? "体感控制尚未开启" : "Motion is not active"}</p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-800">
                    {isChinese ? "你已加入房间。请开启体感控制以移动光标。" : "You joined the room, but motion access is needed to control your cursor."}
                  </p>
                </div>
              </div>
              {sensorStatus !== "unsupported" && (
                <Button
                  className="mt-3 h-11 w-full rounded-xl bg-amber-900 font-bold text-white hover:bg-amber-800"
                  disabled={sensorStatus === "requesting"}
                  onClick={() => void enableMotion()}
                >
                  {sensorStatus === "requesting" && (
                    <LoaderCircle className="mr-1 size-4 animate-spin" />
                  )}
                  {sensorStatus === "requesting"
                    ? isChinese ? "正在请求体感权限…" : "Requesting motion…"
                    : isChinese ? "开启体感控制" : "Enable motion"}
                </Button>
              )}
            </div>
          )}
        </div>
      </PhoneShell>
    );
  }

  if (
    gameState.phase === "language" ||
    gameState.phase === "challenge" ||
    gameState.phase === "memorise"
  ) {
    const isMemorising = gameState.phase === "memorise";
    const title = isMemorising
      ? isChinese ? "一起阅读与记忆" : "Memorise together"
      : gameState.phase === "language"
        ? "Choose the language / 选择语言"
        : isChinese ? "选择挑战" : "Choose the challenge";
    const description = isMemorising
      ? isChinese
        ? "请阅读或背诵共享屏幕上的经文。45 秒后将自动开始答题。"
        : "Read or recite the passage on the shared screen. The questions begin automatically after 45 seconds."
      : gameState.phase === "language"
        ? "A majority of players must stay in one option for 5 seconds. / 多数玩家需同时停留在同一选项 5 秒。"
        : isChinese
          ? "多数玩家需同时停留在共享屏幕上的同一选项 5 秒。"
          : "A majority of players must stay in the same option on the shared screen for 5 seconds.";

    return (
      <PhoneShell roomCode={roomCode} status={status} score={totalScore}>
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div
            className={`flex size-20 items-center justify-center rounded-[1.7rem] text-white shadow-[0_18px_50px_rgba(0,0,0,.12)] ${isMemorising ? "bg-[#d89b22]" : "bg-[#5c7cfa]"}`}
          >
            {isMemorising ? (
              <Clock3 className="size-9" />
            ) : (
              <Languages className="size-9" />
            )}
          </div>
          <span className="player-eyebrow mt-7">
            {gameState.challengeLabel ?? (isChinese ? "队伍选择" : "Team selection")}
          </span>
          <h1 className="mt-3 text-4xl font-black leading-tight tracking-[-.04em] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-sm text-xl leading-relaxed text-[#555963]">
            {description}
          </p>

          {!isMemorising && (
            <Button
              variant="outline"
              className="mt-7 h-auto min-h-14 rounded-2xl border-black/10 bg-white px-6 py-3 text-lg font-bold"
              onClick={recenter}
            >
              <Crosshair className="mr-1 size-5 text-[#15a97b]" />
              {isChinese ? "重新校准光标" : "Recenter cursor"}
            </Button>
          )}

          <div className="mt-7 flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2.5 text-base font-semibold shadow-sm">
            <span
              className={`size-2 rounded-full ${sensorStatus === "active" ? "bg-[#15a97b]" : "bg-amber-500"}`}
            />
            {isChinese
              ? sensorStatus === "active" ? "体感控制已开启" : "体感控制未开启"
              : sensorStatus === "active" ? "AirMouse is live" : "Motion is off"}
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
          <span>{gameState.challengeLabel ?? "Passage"}</span>
          <span className="flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full ${sensorStatus === "active" ? "bg-[#15a97b]" : "bg-amber-500"}`}
            />
            {sensorStatus === "active" ? "Motion live" : "Motion off"}
          </span>
        </div>

        <h1 className={`mt-6 text-balance font-black leading-tight tracking-[-.04em] ${isChinese ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"}`}>
          {isChinese ? "填空补全经文" : "Fill in the passage"}
        </h1>
        <p className={`mt-2 leading-relaxed text-[#555963] ${isChinese ? "text-xl" : "text-lg"}`}>
          {question.instruction}
        </p>
        <p className="mt-1 text-base leading-relaxed text-[#696c76]">
          {isChinese
            ? "放错的答案会留在屏幕上，请重新拿起并移动。"
            : "Wrong answers stay on screen. Pick them up to move them."}
        </p>

        <div className="my-6 flex flex-1 flex-col">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-black/8 bg-white/70 p-4">
              <Move3d className="size-5 text-[#5c7cfa]" />
              <p className={`mt-3 font-black ${isChinese ? "text-xl" : "text-lg"}`}>{isChinese ? "指向以移动" : "Point to aim"}</p>
              <p className="mt-1 text-base leading-relaxed text-[#696c76]">
                {isChinese ? "方向感应控制" : "Orientation tracking"}
              </p>
            </div>
            <button
              type="button"
              className="rounded-2xl border border-black/8 bg-white/70 p-4 text-left active:scale-[.98]"
              onClick={recenter}
            >
              <Crosshair className="size-5 text-[#15a97b]" />
              <p className={`mt-3 font-black ${isChinese ? "text-xl" : "text-lg"}`}>{isChinese ? "重新校准" : "Recenter"}</p>
              <p className="mt-1 text-base leading-relaxed text-[#696c76]">
                {isChinese ? "重置光标位置" : "Reset cursor position"}
              </p>
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center py-6">
            <button
              type="button"
              aria-label={isChinese ? "按住拿起答案卡片，松开放下" : "Hold to grab an answer card and release to drop it"}
              className={`flex aspect-square w-full max-w-[300px] touch-none select-none flex-col items-center justify-center rounded-full border-[10px] font-black shadow-[0_24px_60px_rgba(23,25,34,.18)] transition active:scale-[.97] ${
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
                if (
                  (event.key === " " || event.key === "Enter") &&
                  !event.repeat
                ) {
                  event.preventDefault();
                  startGrab();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") releaseGrab();
              }}
            >
              {isHolding ? (
                <TbHandGrab className="size-16" aria-hidden="true" />
              ) : (
                <TbHandStop className="size-16" aria-hidden="true" />
              )}
              <span className={`mt-3 ${isChinese ? "text-3xl" : "text-2xl"}`}>
                {isChinese
                  ? isHolding ? "松开放下" : "按住拿起"
                  : isHolding ? "Release to drop" : "Hold to grab"}
              </span>
              <span className="mt-2 px-5 text-center text-sm font-semibold opacity-70">
                {isChinese ? "请看屏幕上的光标" : "Watch the cursor on screen"}
              </span>
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`rounded-2xl p-4 ${feedback.correct ? "bg-[#dff5e8] text-[#087653]" : "bg-[#ffe0c2] text-[#9a3f17]"}`}
          >
            <div className="flex items-center gap-3">
              {feedback.correct ? (
                <Check className="size-5" />
              ) : (
                <X className="size-5" />
              )}
              <p className="font-black">{feedback.message}</p>
            </div>
          </div>
        )}

        {roundComplete && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-[#fff4cf] p-4 text-[#755509]">
            <Sparkles className="size-5" />
            <p className="font-black">
              {isChinese ? "经文填完了！请查看大屏上的最终用时。" : "Passage complete! Look at the screen for the final time."}
            </p>
          </div>
        )}
      </div>
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
    <main className="light-mode player-shell min-h-dvh bg-[#f4f8f5] px-4 text-[#171922]">
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
              {status === "connecting" || status === "reconnecting" ? (
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
