"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { TbHandGrab, TbHandStop } from "react-icons/tb";
import {
  Check,
  Clock3,
  Crown,
  Gamepad2,
  Languages,
  Lightbulb,
  LoaderCircle,
  MousePointer2,
  RotateCcw,
  Smartphone,
  Timer,
  Trophy,
  Users,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  challenges,
  getChallenge,
  getQuestion,
  toPublicQuestion,
  type ChallengeNumber,
  type GameLanguage,
  type PublicQuestion,
} from "@/lib/game/questions";
import {
  createRoomSocket,
  generateRoomCode,
  type RoomConnectionStatus,
  type RoomSocket,
} from "@/lib/realtime/room";
import type {
  CursorAimPayload,
  CursorMovePayload,
  DropResultPayload,
  GameStatePayload,
  LeaderboardEntry,
  PlayerPresence,
  PointerActionPayload,
  ServerRoomMessage,
} from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

type ConnectionStatus = "connecting" | "ready" | "reconnecting" | "error";
type ScoreEntry = { name: string; score: number };
type CursorPosition = { x: number; y: number };
type SolvedAnswer = { targetId: string; playerId: string; correct: boolean };
type DwellState = { value: string; playerId: string; progress: number } | null;
type HintState = {
  answerId: string;
  answerLabel: string;
  targetLabel: string;
} | null;
type RegisterCursor = (
  playerId: string,
  element: HTMLDivElement | null,
) => void;

const FALLBACK_COLOR = "#ff6b4a";
const PLAYER_DISCONNECT_GRACE_MS = 15_000;
const ROOM_TTL_MS = 20 * 60 * 1_000;
const CHOICE_DWELL_MS = 5_000;
const START_DWELL_MS = 2_000;
const MEMORISE_MS = 45_000;
// Per-frame interpolation toward the latest aim. 1 = snap instantly, lower = smoother but laggier.
const CURSOR_LERP = 0.6;
const CURSOR_SNAP_PX = 0.5;
const ANSWER_HIT_SLOP_PX = 18;
const TARGET_HIT_SLOP_PX = 36;

function applyCursorTransform(element: HTMLElement, position: CursorPosition) {
  element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
}

function findCursorElement(
  selector: string,
  position: CursorPosition,
  hitSlop = 0,
) {
  for (const element of document.elementsFromPoint(position.x, position.y)) {
    const match = element.closest<HTMLElement>(selector);
    if (match) return match;
  }

  if (hitSlop <= 0) return null;
  let nearest: { element: HTMLElement; distance: number } | null = null;
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const box = element.getBoundingClientRect();
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      position.x < box.left - hitSlop ||
      position.x > box.right + hitSlop ||
      position.y < box.top - hitSlop ||
      position.y > box.bottom + hitSlop
    ) {
      continue;
    }
    // Compare the nearest edges, so a short card does not beat a closer long one.
    const x = Math.max(box.left + 0.5, Math.min(box.right - 0.5, position.x));
    const y = Math.max(box.top + 0.5, Math.min(box.bottom - 0.5, position.y));
    // A card clipped by a scrolling panel must not be grabbable through it.
    if (
      !document.elementsFromPoint(x, y).some((hit) => element.contains(hit))
    ) {
      continue;
    }
    const dx = position.x - x;
    const dy = position.y - y;
    const distance = dx * dx + dy * dy;
    if (!nearest || distance < nearest.distance) {
      nearest = { element, distance };
    }
  }
  return nearest?.element ?? null;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatTeamName(players: PlayerPresence[]) {
  const names = players.map((player) => player.name).filter(Boolean);
  if (names.length === 0) return "Anonymous team";
  if (names.length === 1) return names[0];
  if (names.length <= 3)
    return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} & ${names.length - 2} more`;
}

export default function ScreenPage() {
  const [roomCode, setRoomCode] = useState("");
  const [roomUrl, setRoomUrl] = useState("");
  const [roomExpiresAt, setRoomExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [players, setPlayers] = useState<PlayerPresence[]>([]);
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
  const [dragging, setDragging] = useState<Record<string, string>>({});
  const [solvedAnswers, setSolvedAnswers] = useState<
    Record<string, SolvedAnswer>
  >({});
  const [lastActions, setLastActions] = useState<Record<string, string>>({});
  const [dwell, setDwell] = useState<DwellState>(null);
  const [startReadyPlayerIds, setStartReadyPlayerIds] = useState<string[]>([]);
  const [startProgress, setStartProgress] = useState(0);
  const [hint, setHint] = useState<HintState>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  // The id of the run this host submitted for the current finish, so we can highlight it and never double-submit.
  const [submittedRunId, setSubmittedRunId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameStatePayload>({
    phase: "lobby",
    questionIndex: 0,
    questionCount: 0,
  });

  const socketRef = useRef<RoomSocket | null>(null);
  const playerRemovalTimersRef = useRef<Map<string, number>>(new Map());
  const gameStateRef = useRef(gameState);
  const scoresRef = useRef(scores);
  const playersRef = useRef(players);
  // Cursor positions live outside React state: they change up to 60x/sec per player and
  // re-rendering the whole page on every packet was the main source of cursor lag.
  const cursorsRef = useRef<Record<string, CursorPosition>>({});
  const renderedCursorsRef = useRef<Record<string, CursorPosition>>({});
  const cursorElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const cursorFrameRef = useRef<number | null>(null);
  const draggingRef = useRef(dragging);
  const solvedAnswersRef = useRef(solvedAnswers);
  const selectionRef = useRef<{
    value: string;
    playerId: string;
    startedAt: number;
  } | null>(null);
  const selectionLockedRef = useRef(false);
  const startReadyAtRef = useRef<number | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    scoresRef.current = scores;
  }, [scores]);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const scheduleCursorFrame = useCallback(() => {
    if (cursorFrameRef.current !== null) return;
    const renderFrame = () => {
      cursorFrameRef.current = null;
      let stillMoving = false;
      cursorElementsRef.current.forEach((element, playerId) => {
        const target = cursorsRef.current[playerId];
        if (!target) return;
        const current = renderedCursorsRef.current[playerId] ?? target;
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        let next = target;
        if (Math.abs(dx) > CURSOR_SNAP_PX || Math.abs(dy) > CURSOR_SNAP_PX) {
          next = {
            x: current.x + dx * CURSOR_LERP,
            y: current.y + dy * CURSOR_LERP,
          };
          stillMoving = true;
        }
        renderedCursorsRef.current[playerId] = next;
        applyCursorTransform(element, next);
      });
      if (stillMoving)
        cursorFrameRef.current = requestAnimationFrame(renderFrame);
    };
    cursorFrameRef.current = requestAnimationFrame(renderFrame);
  }, []);

  useEffect(
    () => () => {
      if (cursorFrameRef.current !== null)
        cancelAnimationFrame(cursorFrameRef.current);
    },
    [],
  );

  const registerCursor = useCallback<RegisterCursor>(
    (playerId, element) => {
      if (!element) {
        cursorElementsRef.current.delete(playerId);
        return;
      }
      cursorElementsRef.current.set(playerId, element);
      const position =
        renderedCursorsRef.current[playerId] ?? cursorsRef.current[playerId];
      if (position) applyCursorTransform(element, position);
      scheduleCursorFrame();
    },
    [scheduleCursorFrame],
  );

  const clearRound = useCallback(() => {
    solvedAnswersRef.current = {};
    draggingRef.current = {};
    setSolvedAnswers({});
    setDragging({});
    setLastActions({});
    setHint(null);
  }, []);

  const resetSession = useCallback(() => {
    scoresRef.current = {};
    setScores({});
    clearRound();
    selectionRef.current = null;
    selectionLockedRef.current = false;
    setDwell(null);
    setStartReadyPlayerIds([]);
    setStartProgress(0);
    startReadyAtRef.current = null;
    setSubmittedRunId(null);
    const lobby: GameStatePayload = {
      phase: "lobby",
      questionIndex: 0,
      questionCount: 0,
    };
    gameStateRef.current = lobby;
    setGameState(lobby);
  }, [clearRound]);

  const openFreshRoom = useCallback(() => {
    const code = generateRoomCode();
    resetSession();
    setPlayers([]);
    playersRef.current = [];
    cursorsRef.current = {};
    renderedCursorsRef.current = {};
    setRoomCode(code);
    setRoomUrl(`${window.location.origin}/room/${code}`);
    setRoomExpiresAt(Date.now() + ROOM_TTL_MS);
  }, [resetSession]);

  useEffect(() => {
    const timer = window.setTimeout(openFreshRoom, 0);
    return () => window.clearTimeout(timer);
  }, [openFreshRoom]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!roomExpiresAt || now < roomExpiresAt || gameState.phase !== "lobby")
      return;
    const timer = window.setTimeout(openFreshRoom, 0);
    return () => window.clearTimeout(timer);
  }, [gameState.phase, now, openFreshRoom, roomExpiresAt]);

  const broadcastState = useCallback((nextState: GameStatePayload) => {
    gameStateRef.current = nextState;
    setGameState(nextState);
    socketRef.current?.send({ type: "game-state", payload: nextState });
  }, []);

  const startQuestion = useCallback(
    (index: number, state = gameStateRef.current) => {
      if (!state.language || !state.challenge) return;
      const challenge = getChallenge(state.language, state.challenge);
      const question = challenge?.questions[index];
      if (!challenge || !question) return;
      clearRound();
      broadcastState({
        phase: "question",
        language: challenge.language,
        challenge: challenge.number,
        challengeLabel: challenge.label,
        question: toPublicQuestion(question),
        questionIndex: index,
        questionCount: challenge.questions.length,
        startedAt: state.startedAt ?? Date.now(),
        penaltyMs: state.penaltyMs ?? 0,
      });
    },
    [broadcastState, clearRound],
  );

  useEffect(() => {
    if (gameState.phase !== "memorise" || !gameState.phaseEndsAt) return;
    const timer = window.setTimeout(
      () =>
        startQuestion(0, { ...gameStateRef.current, startedAt: Date.now() }),
      Math.max(0, gameState.phaseEndsAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [gameState.phase, gameState.phaseEndsAt, startQuestion]);

  useEffect(() => {
    if (!roomCode) return;
    const hostKey = `host-${roomCode}-${crypto.randomUUID()}`;
    const removalTimers = playerRemovalTimersRef.current;

    function removePlayer(playerId: string) {
      playerRemovalTimersRef.current.delete(playerId);
      const nextPlayers = playersRef.current.filter(
        (player) => player.playerId !== playerId,
      );
      playersRef.current = nextPlayers;
      setPlayers(nextPlayers);
      const nextDragging = { ...draggingRef.current };
      delete nextDragging[playerId];
      draggingRef.current = nextDragging;
      setDragging(nextDragging);
      delete cursorsRef.current[playerId];
      delete renderedCursorsRef.current[playerId];
    }

    function syncPlayers(nextPlayers: PlayerPresence[]) {
      const onlineIds = new Set(nextPlayers.map((player) => player.playerId));
      const merged = new Map(
        playersRef.current.map((player) => [player.playerId, player]),
      );
      nextPlayers.forEach((player) => {
        const timer = playerRemovalTimersRef.current.get(player.playerId);
        if (timer !== undefined) window.clearTimeout(timer);
        playerRemovalTimersRef.current.delete(player.playerId);
        merged.set(player.playerId, player);
      });
      playersRef.current.forEach((player) => {
        if (
          onlineIds.has(player.playerId) ||
          playerRemovalTimersRef.current.has(player.playerId)
        )
          return;
        playerRemovalTimersRef.current.set(
          player.playerId,
          window.setTimeout(
            () => removePlayer(player.playerId),
            PLAYER_DISCONNECT_GRACE_MS,
          ),
        );
      });
      const list = [...merged.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      playersRef.current = list;
      setPlayers(list);
      nextPlayers.forEach((player, index) => {
        cursorsRef.current[player.playerId] ??= {
          x: window.innerWidth / 2 + index * 24,
          y: window.innerHeight / 2 + index * 18,
        };
      });
      scheduleCursorFrame();
    }

    function updateCursor(playerId: string, nextPosition: CursorPosition) {
      cursorsRef.current[playerId] = nextPosition;
      scheduleCursorFrame();
    }

    function placeAnswer(
      answerId: string,
      targetId: string,
      playerId: string,
      correct: boolean,
    ) {
      const nextSolved = {
        ...solvedAnswersRef.current,
        [answerId]: { targetId, playerId, correct },
      };
      solvedAnswersRef.current = nextSolved;
      setSolvedAnswers(nextSolved);
      return nextSolved;
    }

    function unplaceAnswer(answerId: string) {
      const nextSolved = { ...solvedAnswersRef.current };
      delete nextSolved[answerId];
      solvedAnswersRef.current = nextSolved;
      setSolvedAnswers(nextSolved);
    }

    function countCorrect(solved: Record<string, SolvedAnswer>) {
      return Object.values(solved).filter((entry) => entry.correct).length;
    }

    function applyHint(playerId: string) {
      const state = gameStateRef.current;
      const activeQuestion = getQuestion(state.question?.id);
      if (!activeQuestion) return;
      const answer = activeQuestion.answers.find(
        (item) => !solvedAnswersRef.current[item.id]?.correct,
      );
      if (!answer) return;
      const target = activeQuestion.targets.find(
        (item) => item.id === answer.targetId,
      );
      setHint({
        answerId: answer.id,
        answerLabel: answer.label,
        targetLabel: target?.label ?? "?",
      });
      broadcastState({ ...state, penaltyMs: (state.penaltyMs ?? 0) + 25_000 });
      setLastActions((current) => ({
        ...current,
        [playerId]: "Hint revealed: +25 seconds",
      }));
    }

    function handleMessage(message: ServerRoomMessage) {
      if (message.type === "connected" || message.type === "presence") {
        syncPlayers(message.players);
        return;
      }
      if (message.type === "leaderboard") {
        setLeaderboard(message.payload.entries);
        return;
      }
      if (message.type === "cursor-move") {
        const movement: CursorMovePayload = message.payload;
        const previous = cursorsRef.current[movement.playerId] ?? {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        };
        updateCursor(movement.playerId, {
          x: Math.max(
            10,
            Math.min(
              window.innerWidth - 10,
              previous.x +
                Math.max(-70, Math.min(70, Number(movement.dx) || 0)),
            ),
          ),
          y: Math.max(
            10,
            Math.min(
              window.innerHeight - 10,
              previous.y +
                Math.max(-70, Math.min(70, Number(movement.dy) || 0)),
            ),
          ),
        });
        return;
      }
      if (message.type === "cursor-aim") {
        const aim: CursorAimPayload = message.payload;
        const edge = 16;
        updateCursor(aim.playerId, {
          x:
            edge +
            ((Math.max(-1, Math.min(1, Number(aim.x) || 0)) + 1) / 2) *
              Math.max(0, window.innerWidth - edge * 2),
          y:
            edge +
            ((Math.max(-1, Math.min(1, Number(aim.y) || 0)) + 1) / 2) *
              Math.max(0, window.innerHeight - edge * 2),
        });
        return;
      }
      if (message.type === "pointer-down") {
        const action: PointerActionPayload = message.payload;
        const cursor =
          renderedCursorsRef.current[action.playerId] ??
          cursorsRef.current[action.playerId];
        if (!cursor || gameStateRef.current.phase !== "question") return;
        if (draggingRef.current[action.playerId]) return;
        // Resolve both together: a direct card hit takes priority over a nearby hint.
        const element = findCursorElement(
          "[data-answer-card], [data-hint-zone]",
          cursor,
          ANSWER_HIT_SLOP_PX,
        );
        if (element?.hasAttribute("data-hint-zone")) {
          applyHint(action.playerId);
          return;
        }
        const answerId = element?.dataset.answerCard;
        if (
          !answerId ||
          Object.values(draggingRef.current).includes(answerId)
        ) {
          setLastActions((current) => ({
            ...current,
            [action.playerId]: "Aim at a phrase card",
          }));
          return;
        }
        const placed = solvedAnswersRef.current[answerId];
        if (placed?.correct) {
          setLastActions((current) => ({
            ...current,
            [action.playerId]: "That one is already right",
          }));
          return;
        }
        // Picking a wrongly-placed card back up frees its slot.
        if (placed) unplaceAnswer(answerId);
        const next = { ...draggingRef.current, [action.playerId]: answerId };
        draggingRef.current = next;
        setDragging(next);
        setLastActions((current) => ({
          ...current,
          [action.playerId]: placed ? "Moving a phrase" : "Holding a phrase",
        }));
        return;
      }
      if (message.type === "pointer-up") {
        const action: PointerActionPayload = message.payload;
        const answerId = draggingRef.current[action.playerId];
        const cursor =
          renderedCursorsRef.current[action.playerId] ??
          cursorsRef.current[action.playerId];
        const activeQuestion = getQuestion(gameStateRef.current.question?.id);
        if (!answerId || !cursor || !activeQuestion) return;
        const targetId = findCursorElement(
          "[data-answer-target]",
          cursor,
          TARGET_HIT_SLOP_PX,
        )?.dataset.answerTarget;
        const answer = activeQuestion.answers.find(
          (item) => item.id === answerId,
        );
        const player = playersRef.current.find(
          (item) => item.playerId === action.playerId,
        );
        const previousScore = scoresRef.current[action.playerId]?.score ?? 0;
        const nextDragging = { ...draggingRef.current };
        delete nextDragging[action.playerId];
        draggingRef.current = nextDragging;
        setDragging(nextDragging);

        // Released outside any slot: card goes back to the pool, nothing else happens.
        if (!targetId || !answer) {
          setLastActions((current) => ({
            ...current,
            [action.playerId]: "Dropped back in the pool",
          }));
          return;
        }

        const occupantId = Object.keys(solvedAnswersRef.current).find(
          (id) => solvedAnswersRef.current[id].targetId === targetId,
        );
        if (occupantId && solvedAnswersRef.current[occupantId].correct) {
          setLastActions((current) => ({
            ...current,
            [action.playerId]: "That slot is already filled",
          }));
          socketRef.current?.send({
            type: "drop-result",
            payload: {
              playerId: action.playerId,
              questionId: activeQuestion.id,
              answerId,
              correct: false,
              points: 0,
              totalScore: previousScore,
            },
          });
          return;
        }
        // A wrong card already in this slot gets bumped back to the pool.
        if (occupantId) unplaceAnswer(occupantId);

        const correct = answer.targetId === targetId;
        const points = correct ? 100 : 0;
        const totalScore = previousScore + points;
        const nextSolved = placeAnswer(
          answerId,
          targetId,
          action.playerId,
          correct,
        );
        if (correct) {
          setHint((current) =>
            current?.answerId === answerId ? null : current,
          );
          const nextScores = {
            ...scoresRef.current,
            [action.playerId]: {
              name: player?.name ?? "Player",
              score: totalScore,
            },
          };
          scoresRef.current = nextScores;
          setScores(nextScores);
          if (countCorrect(nextSolved) === activeQuestion.answers.length)
            socketRef.current?.send({
              type: "round-complete",
              payload: { questionId: activeQuestion.id },
            });
        }
        setLastActions((current) => ({
          ...current,
          [action.playerId]: correct
            ? "Correct! +100"
            : "Placed - not the right spot",
        }));
        const result: DropResultPayload = {
          playerId: action.playerId,
          questionId: activeQuestion.id,
          answerId,
          correct,
          points,
          totalScore,
        };
        socketRef.current?.send({ type: "drop-result", payload: result });
        return;
      }
      if (message.type === "recenter")
        updateCursor(message.payload.playerId, {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
    }

    const socket = createRoomSocket({
      roomCode,
      role: "host",
      clientId: hostKey,
      onStatus: (nextStatus: RoomConnectionStatus) =>
        setStatus(nextStatus === "connected" ? "ready" : nextStatus),
      onMessage: handleMessage,
      onOpen: () => {
        socketRef.current?.send({
          type: "game-state",
          payload: gameStateRef.current,
        });
        socketRef.current?.send({ type: "request-leaderboard" });
      },
    });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
      removalTimers.forEach((timer) => window.clearTimeout(timer));
      removalTimers.clear();
    };
  }, [broadcastState, roomCode, scheduleCursorFrame]);

  useEffect(() => {
    if (gameState.phase !== "lobby") return;
    const timer = window.setInterval(() => {
      const zone = document.querySelector<HTMLElement>("[data-start-zone]");
      if (!zone || playersRef.current.length === 0) {
        startReadyAtRef.current = null;
        setStartReadyPlayerIds([]);
        setStartProgress(0);
        return;
      }
      const box = zone.getBoundingClientRect();
      const readyIds = playersRef.current
        .filter((player) => {
          const cursor = cursorsRef.current[player.playerId];
          return (
            cursor &&
            cursor.x >= box.left &&
            cursor.x <= box.right &&
            cursor.y >= box.top &&
            cursor.y <= box.bottom
          );
        })
        .map((player) => player.playerId);
      setStartReadyPlayerIds(readyIds);
      if (readyIds.length !== playersRef.current.length) {
        startReadyAtRef.current = null;
        setStartProgress(0);
        return;
      }
      startReadyAtRef.current ??= Date.now();
      const progress = Math.min(
        1,
        (Date.now() - startReadyAtRef.current) / START_DWELL_MS,
      );
      setStartProgress(progress);
      if (progress === 1 && gameStateRef.current.phase === "lobby") {
        broadcastState({
          phase: "language",
          questionIndex: 0,
          questionCount: 0,
        });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [broadcastState, gameState.phase]);

  useEffect(() => {
    selectionRef.current = null;
    selectionLockedRef.current = false;
    const clearDwellTimer = window.setTimeout(() => setDwell(null), 0);
    if (gameState.phase !== "language" && gameState.phase !== "challenge") {
      return () => window.clearTimeout(clearDwellTimer);
    }
    const timer = window.setInterval(() => {
      const zones = [
        ...document.querySelectorAll<HTMLElement>("[data-choice]"),
      ];
      const occupants = playersRef.current.flatMap((player) => {
        const cursor = cursorsRef.current[player.playerId];
        if (!cursor) return [];
        const zone = zones.find((item) => {
          const box = item.getBoundingClientRect();
          return (
            cursor.x >= box.left &&
            cursor.x <= box.right &&
            cursor.y >= box.top &&
            cursor.y <= box.bottom
          );
        });
        return zone?.dataset.choice
          ? [{ playerId: player.playerId, value: zone.dataset.choice }]
          : [];
      });
      const current = selectionRef.current;
      const occupant = current
        ? occupants.find(
            (item) =>
              item.playerId === current.playerId &&
              item.value === current.value,
          )
        : occupants[0];
      if (!occupant) {
        selectionRef.current = null;
        setDwell(null);
        return;
      }
      const startedAt =
        current?.playerId === occupant.playerId &&
        current.value === occupant.value
          ? current.startedAt
          : Date.now();
      selectionRef.current = { ...occupant, startedAt };
      const progress = Math.min(1, (Date.now() - startedAt) / CHOICE_DWELL_MS);
      setDwell({ ...occupant, progress });
      if (progress < 1 || selectionLockedRef.current) return;
      selectionLockedRef.current = true;
      if (gameStateRef.current.phase === "language") {
        broadcastState({
          phase: "challenge",
          language: occupant.value as GameLanguage,
          questionIndex: 0,
          questionCount: 0,
        });
      } else {
        const challenge = getChallenge(
          gameStateRef.current.language!,
          Number(occupant.value) as ChallengeNumber,
        );
        if (!challenge) return;
        broadcastState({
          phase: "memorise",
          language: challenge.language,
          challenge: challenge.number,
          challengeLabel: challenge.label,
          memoriseText: challenge.memoriseText,
          questionIndex: 0,
          questionCount: challenge.questions.length,
          phaseEndsAt: Date.now() + MEMORISE_MS,
          penaltyMs: 0,
        });
      }
    }, 100);
    return () => {
      window.clearTimeout(clearDwellTimer);
      window.clearInterval(timer);
    };
  }, [broadcastState, gameState.phase]);

  const activeAnswerCount = gameState.question?.answers.length ?? 0;
  const solvedCount = Object.values(solvedAnswers).filter(
    (entry) => entry.correct,
  ).length;
  const roundComplete =
    activeAnswerCount > 0 && solvedCount === activeAnswerCount;
  useEffect(() => {
    if (!roundComplete || gameState.phase !== "question") return;
    const timer = window.setTimeout(() => {
      const nextIndex = gameStateRef.current.questionIndex + 1;
      if (nextIndex < gameStateRef.current.questionCount)
        startQuestion(nextIndex);
      else
        broadcastState({
          ...gameStateRef.current,
          phase: "finished",
          question: undefined,
          completedAt: Date.now(),
        });
    }, 1_600);
    return () => window.clearTimeout(timer);
  }, [broadcastState, gameState.phase, roundComplete, startQuestion]);

  const rankedPlayers = useMemo(
    () =>
      players
        .map((player) => ({
          playerId: player.playerId,
          name: scores[player.playerId]?.name ?? player.name,
          score: scores[player.playerId]?.score ?? 0,
          color: player.color,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    [players, scores],
  );
  const roomRemaining = Math.max(0, roomExpiresAt - now);
  const elapsed = gameState.startedAt
    ? Math.max(
        0,
        (gameState.completedAt ?? now) -
          gameState.startedAt +
          (gameState.penaltyMs ?? 0),
      )
    : 0;

  // Push this team's time to the global leaderboard exactly once per finished run.
  useEffect(() => {
    if (
      gameState.phase !== "finished" ||
      submittedRunId ||
      !gameState.startedAt ||
      !gameState.completedAt ||
      !gameState.language ||
      !gameState.challenge
    )
      return;
    const challenge = getChallenge(gameState.language, gameState.challenge);
    if (!challenge) return;
    const entry: LeaderboardEntry = {
      id: crypto.randomUUID(),
      challengeId: challenge.id,
      challengeLabel: challenge.label,
      language: challenge.language,
      teamName: formatTeamName(playersRef.current),
      playerCount: Math.max(1, playersRef.current.length),
      timeMs: Math.max(
        0,
        gameState.completedAt -
          gameState.startedAt +
          (gameState.penaltyMs ?? 0),
      ),
      penaltyMs: gameState.penaltyMs ?? 0,
      completedAt: gameState.completedAt,
    };
    // If the socket is down right now, leave submittedRunId unset; the effect re-runs when status flips back to "ready".
    if (socketRef.current?.send({ type: "submit-result", payload: entry }))
      setSubmittedRunId(entry.id);
  }, [
    gameState.challenge,
    gameState.completedAt,
    gameState.language,
    gameState.penaltyMs,
    gameState.phase,
    gameState.startedAt,
    status,
    submittedRunId,
  ]);

  const currentChallengeId =
    gameState.language && gameState.challenge
      ? getChallenge(gameState.language, gameState.challenge)?.id
      : undefined;
  const challengeLeaderboard = useMemo(
    () =>
      leaderboard.filter((entry) => entry.challengeId === currentChallengeId),
    [currentChallengeId, leaderboard],
  );
  const submittedRank = submittedRunId
    ? challengeLeaderboard.findIndex((entry) => entry.id === submittedRunId) + 1
    : 0;

  if (gameState.phase === "lobby") {
    return (
      <HostShell
        roomCode={roomCode}
        status={status}
        roomRemaining={roomRemaining}
      >
        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_420px]">
          <section className="host-panel grid items-center gap-8 overflow-hidden p-7 md:grid-cols-[280px_1fr] md:p-9">
            <div className="mx-auto w-full max-w-[280px] rounded-[2rem] bg-white p-5 shadow-xl">
              {roomUrl ? (
                <QRCodeSVG
                  value={roomUrl}
                  size={260}
                  level="M"
                  className="h-auto w-full"
                  bgColor="#ffffff"
                  fgColor="#17211c"
                />
              ) : (
                <div className="aspect-square animate-pulse rounded-2xl bg-black/5" />
              )}
            </div>
            <div>
              <span className="eyebrow">Join the open room</span>
              <h1 className="mt-5 text-balance text-4xl font-black leading-[.95] tracking-[-.04em] sm:text-6xl">
                Scan. Aim. Complete the teaching.
              </h1>
              <p className="mt-5 max-w-xl text-xl leading-relaxed text-white/55">
                Everyone joins, then moves their hand cursor into the start zone
                together.
              </p>
              <div className="mt-7 inline-flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 px-5 py-4">
                <span className="text-base text-white/45">Room code</span>
                <strong className="font-mono text-2xl tracking-[.22em]">
                  {roomCode || "------"}
                </strong>
              </div>
            </div>
          </section>
          <section className="host-panel flex min-h-[380px] flex-col p-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-2xl font-bold">
                <Users className="size-6 text-[#e56b35]" />
                {players.length} {players.length === 1 ? "player" : "players"}
              </h2>
              <span className="status-pill">Open</span>
            </div>
            <div className="mt-5 space-y-2">
              {players.length === 0 ? (
                <div className="flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 text-center text-white/35">
                  <Smartphone className="mb-3 size-8" />
                  <p className="text-lg font-semibold">Waiting for players</p>
                </div>
              ) : (
                players.map((player) => {
                  const ready = startReadyPlayerIds.includes(player.playerId);
                  return (
                    <div
                      key={player.playerId}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${ready ? "bg-[#dff5e8]" : "bg-white/[.045]"}`}
                    >
                      <span
                        className="flex size-10 items-center justify-center rounded-xl font-black text-white"
                        style={{ backgroundColor: player.color }}
                      >
                        {player.name[0]?.toUpperCase()}
                      </span>
                      <span className="flex-1 text-lg font-semibold">
                        {player.name}
                      </span>
                      <span
                        className={`text-sm font-bold ${ready ? "text-[#087653]" : "text-white/35"}`}
                      >
                        {ready ? "In zone" : "Move to zone"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            <div
              data-start-zone
              className={`relative mt-5 flex min-h-40 flex-1 flex-col items-center justify-center overflow-hidden rounded-[1.75rem] border-2 border-dashed p-6 text-center transition ${players.length > 0 && startReadyPlayerIds.length === players.length ? "border-[#16865c] bg-[#dff5e8]" : "border-[#e56b35]/45 bg-[#fff1e7]"}`}
            >
              <TbHandStop className="size-12 text-[#e56b35]" />
              <strong className="mt-3 text-2xl">
                Everyone hover here to start
              </strong>
              <span className="mt-2 text-base text-white/45">
                {players.length
                  ? `${startReadyPlayerIds.length} of ${players.length} ready`
                  : "Waiting for the team"}
              </span>
              <div className="absolute inset-x-0 bottom-0 h-3 bg-black/5">
                <div
                  className="h-full bg-[#16865c] transition-[width] duration-100"
                  style={{ width: `${startProgress * 100}%` }}
                />
              </div>
            </div>
          </section>
        </div>
        <GlobalLeaderboard entries={leaderboard} />
        <CalibrationDot />
        <AirMouseCursors
          players={players}
          dragging={{}}
          registerCursor={registerCursor}
        />
      </HostShell>
    );
  }

  if (gameState.phase === "language" || gameState.phase === "challenge") {
    const languageStep = gameState.phase === "language";
    const choices = languageStep
      ? [
          { value: "en", title: "English", subtitle: "English questions" },
          { value: "zh", title: "中文", subtitle: "中文题目" },
        ]
      : [
          {
            value: "1",
            title: gameState.language === "zh" ? "挑战一" : "Challenge 1",
            subtitle:
              gameState.language === "zh"
                ? "《十法经》"
                : "The Ten Teaching Sūtra",
          },
          {
            value: "2",
            title: gameState.language === "zh" ? "挑战二" : "Challenge 2",
            subtitle:
              gameState.language === "zh"
                ? "《华严经》"
                : "The Array of Stalks Sūtra",
          },
        ];
    return (
      <HostShell
        roomCode={roomCode}
        status={status}
        roomRemaining={roomRemaining}
      >
        <section className="host-panel flex flex-1 flex-col p-7 sm:p-10">
          <div className="text-center">
            <span className="eyebrow">
              {languageStep ? "Step 1 of 2" : "Step 2 of 2"}
            </span>
            <h1 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-6xl">
              {languageStep ? "Choose a language" : "Choose a challenge"}
            </h1>
            <p className="mt-3 text-lg text-white/50">
              Move a cursor into a zone and keep it there for 5 seconds to
              confirm.
            </p>
          </div>
          <div className="mt-8 grid flex-1 gap-6 md:grid-cols-2">
            {choices.map((choice) => {
              const active = dwell?.value === choice.value;
              return (
                <div
                  key={choice.value}
                  data-choice={choice.value}
                  className={`relative flex min-h-64 flex-col items-center justify-center overflow-hidden rounded-[2rem] border-2 text-center transition ${active ? "border-[#44d79b] bg-[#44d79b]/14" : "border-dashed border-white/20 bg-white/[.04]"}`}
                >
                  <Languages
                    className={`size-10 ${active ? "text-[#44d79b]" : "text-[#ff8b70]"}`}
                  />
                  <strong className="mt-5 text-4xl font-black">
                    {choice.title}
                  </strong>
                  <span className="mt-2 text-base text-white/45">
                    {choice.subtitle}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 h-3 bg-white/8">
                    <div
                      className="h-full bg-[#44d79b] transition-[width] duration-100"
                      style={{
                        width: active ? `${dwell.progress * 100}%` : "0%",
                      }}
                    />
                  </div>
                  {active && (
                    <span className="mt-5 font-mono text-sm font-bold text-[#44d79b]">
                      Hold {Math.max(1, Math.ceil(5 - dwell.progress * 5))}s
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <AirMouseCursors
            players={players}
            dragging={{}}
            registerCursor={registerCursor}
          />
        </section>
      </HostShell>
    );
  }

  if (gameState.phase === "memorise") {
    const remaining = Math.max(0, (gameState.phaseEndsAt ?? now) - now);
    return (
      <HostShell
        roomCode={roomCode}
        status={status}
        roomRemaining={roomRemaining}
      >
        <section className="host-panel flex flex-1 flex-col items-center justify-center overflow-hidden p-7 text-center sm:p-10">
          <div className="flex items-center gap-3">
            <span className="eyebrow">{gameState.challengeLabel}</span>
            <span className="flex items-center gap-2 rounded-full bg-[#ffd166]/12 px-4 py-2 font-mono font-black text-[#ffd166]">
              <Clock3 className="size-4" />
              {formatTime(remaining)}
            </span>
          </div>
          <h1 className="mt-6 text-4xl font-black tracking-[-.04em] sm:text-6xl">
            Read, recite and memorise
          </h1>
          <p
            className={`mt-8 max-w-6xl text-balance font-semibold leading-[1.75] text-white/80 ${gameState.language === "zh" ? "text-5xl" : "text-xl sm:text-3xl"}`}
          >
            {gameState.memoriseText}
          </p>
          <p className="mt-8 text-sm font-bold uppercase tracking-[.18em] text-white/35">
            Questions begin automatically when time is up
          </p>
          <AirMouseCursors
            players={players}
            dragging={{}}
            registerCursor={registerCursor}
          />
        </section>
      </HostShell>
    );
  }

  if (gameState.phase === "finished") {
    return (
      <HostShell
        roomCode={roomCode}
        status={status}
        roomRemaining={roomRemaining}
      >
        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="host-panel flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex size-20 items-center justify-center rounded-[1.6rem] bg-[#ffd166] text-[#171922]">
              <Trophy className="size-10" />
            </div>
            <span className="eyebrow mt-6">
              {gameState.challengeLabel} complete
            </span>
            <h1 className="mt-4 font-mono text-5xl font-black tracking-[-.04em] sm:text-7xl">
              {formatTime(elapsed)}
            </h1>
            <p className="mt-2 text-white/45">
              Final time includes +
              {Math.round((gameState.penaltyMs ?? 0) / 1_000)}s from hints
            </p>
            {submittedRank > 0 ? (
              <p
                className={`mt-4 rounded-full px-5 py-2 text-sm font-black uppercase tracking-[.18em] ${submittedRank === 1 ? "bg-[#ffd166]/15 text-[#ffd166]" : "bg-[#44d79b]/12 text-[#44d79b]"}`}
              >
                {submittedRank === 1
                  ? "New fastest team of all time!"
                  : `#${submittedRank} fastest team of all time`}
              </p>
            ) : submittedRunId ? (
              <p className="mt-4 rounded-full bg-white/[.06] px-5 py-2 text-sm font-bold text-white/45">
                Great effort — not in the top{" "}
                {challengeLeaderboard.length || 10} this time
              </p>
            ) : (
              <p className="mt-4 flex items-center gap-2 text-sm text-white/40">
                <LoaderCircle className="size-4 animate-spin" />
                Saving your time…
              </p>
            )}
            <div className="mt-8 w-full max-w-2xl space-y-2">
              {rankedPlayers.map((player, index) => (
                <div
                  key={player.playerId}
                  className={`flex items-center gap-4 rounded-2xl border px-5 py-4 text-left ${index === 0 ? "border-[#ffd166]/40 bg-[#ffd166]/10" : "border-white/8 bg-white/[.035]"}`}
                >
                  <span className="w-7 text-xl font-black text-white/30">
                    {index + 1}
                  </span>
                  <span
                    className="flex size-10 items-center justify-center rounded-xl font-black"
                    style={{ backgroundColor: player.color }}
                  >
                    {player.name[0]?.toUpperCase()}
                  </span>
                  <span className="flex-1 text-lg font-bold">
                    {player.name}
                  </span>
                  {index === 0 && <Crown className="size-5 text-[#ffd166]" />}
                  <strong className="font-mono">{player.score} pts</strong>
                </div>
              ))}
            </div>
            <Button
              className="mt-8 h-13 rounded-2xl bg-white px-7 font-bold text-[#151722] hover:bg-white/90"
              onClick={openFreshRoom}
            >
              <RotateCcw className="mr-1 size-4" />
              New group &amp; new code
            </Button>
          </section>
          <aside className="host-panel flex min-h-0 flex-col p-6">
            <div className="flex items-center justify-between border-b border-white/8 pb-5">
              <h2 className="flex items-center gap-2 text-2xl font-bold">
                <Timer className="size-5 text-[#ffd166]" />
                Fastest teams
              </h2>
              <span className="status-pill">{gameState.challengeLabel}</span>
            </div>
            <LeaderboardList
              entries={challengeLeaderboard}
              highlightId={submittedRunId}
              className="mt-4 min-h-0 flex-1 overflow-auto"
            />
          </aside>
        </div>
      </HostShell>
    );
  }

  return (
    <HostShell
      roomCode={roomCode}
      status={status}
      roomRemaining={roomRemaining}
      lockViewport
    >
      <QuestionStage
        question={gameState.question}
        language={gameState.language}
        challengeLabel={gameState.challengeLabel}
        solvedAnswers={solvedAnswers}
        dragging={dragging}
        players={players}
        lastActions={lastActions}
        elapsed={elapsed}
        penaltyMs={gameState.penaltyMs ?? 0}
        hint={hint}
      />
      <AirMouseCursors
        players={players}
        dragging={dragging}
        question={gameState.question}
        registerCursor={registerCursor}
      />
    </HostShell>
  );
}

function HostShell({
  roomCode,
  status,
  roomRemaining,
  lockViewport = false,
  children,
}: {
  roomCode: string;
  status: ConnectionStatus;
  roomRemaining: number;
  lockViewport?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main
      className={`light-mode game-shell min-h-dvh bg-[#eef7f0] p-4 text-[#17211c] sm:p-6 ${lockViewport ? "lg:h-dvh lg:overflow-hidden" : ""}`}
    >
      <div
        className={`mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[1900px] flex-col gap-4 sm:min-h-[calc(100dvh-3rem)] ${lockViewport ? "lg:h-[calc(100dvh-3rem)]" : ""}`}
      >
        <header className="flex shrink-0 items-center justify-between px-1">
          <div className="flex items-center gap-3">
            <span className="keep-white flex size-11 items-center justify-center rounded-2xl bg-[#e56b35] text-white shadow-sm">
              <Gamepad2 className="size-6" />
            </span>
            <div>
              <p className="text-xl font-black leading-none">AirMouse</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-[.18em] text-white/35">
                Lamrim activity
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(status === "connecting" || status === "reconnecting") && (
              <LoaderCircle className="size-4 animate-spin text-white/40" />
            )}
            {status === "error" && <WifiOff className="size-4 text-red-500" />}
            <span className="hidden items-center gap-1.5 text-sm text-white/40 sm:flex">
              <Clock3 className="size-4" />
              code {formatTime(roomRemaining)}
            </span>
            <strong className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-lg tracking-[.18em]">
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
  language,
  challengeLabel,
  solvedAnswers,
  dragging,
  players,
  lastActions,
  elapsed,
  penaltyMs,
  hint,
}: {
  question?: PublicQuestion;
  language?: GameLanguage;
  challengeLabel?: string;
  solvedAnswers: Record<string, SolvedAnswer>;
  dragging: Record<string, string>;
  players: PlayerPresence[];
  lastActions: Record<string, string>;
  elapsed: number;
  penaltyMs: number;
  hint: HintState;
}) {
  if (!question) return null;
  const heldIds = new Set(Object.values(dragging));
  const playerLookup = new Map(
    players.map((player) => [player.playerId, player]),
  );
  const answerByTarget = new Map(
    Object.entries(solvedAnswers).map(([answerId, entry]) => [
      entry.targetId,
      { answerId, ...entry },
    ]),
  );
  const answerLookup = new Map(
    question.answers.map((answer) => [answer.id, answer]),
  );
  const isChinese = language === "zh";
  // Prompt is the whole passage; every `[n]` becomes an inline drop slot for targets[n - 1].
  const tokens = question.prompt.split(/(\[\d+\])/g).filter(Boolean);
  const poolAnswers = question.answers.filter(
    (answer) => !solvedAnswers[answer.id] && !heldIds.has(answer.id),
  );
  const correctCount = Object.values(solvedAnswers).filter(
    (entry) => entry.correct,
  ).length;
  const complete = correctCount === question.answers.length;

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(380px,36vw,620px)] lg:overflow-hidden">
      <section className="host-panel flex min-h-0 min-w-0 flex-col overflow-auto p-5 sm:p-6">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
          <div>
            <span className="eyebrow">
              {challengeLabel ?? "Fill the passage"}
            </span>
            <p className="mt-3 text-xl font-semibold text-[#c65324]">
              {question.instruction}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-[#edf4ef] px-4 py-3">
              <p className="text-sm text-white/40">Time</p>
              <p className="font-mono text-3xl font-black">
                {formatTime(elapsed)}
              </p>
            </div>
            <div className="rounded-2xl bg-[#fff1e7] px-4 py-3">
              <p className="text-sm text-[#a44a22]">Penalty</p>
              <p className="font-mono text-2xl font-black text-[#a44a22]">
                +{Math.round(penaltyMs / 1_000)}s
              </p>
            </div>
            <div className="rounded-2xl bg-[#edf4ef] px-4 py-3">
              <p className="text-sm text-white/40">Progress</p>
              <p className="text-2xl font-black">
                {correctCount}
                <span className="text-white/25">
                  /{question.answers.length}
                </span>
              </p>
            </div>
          </div>
        </div>
        {hint && (
          <div className="mt-5 flex shrink-0 items-center gap-3 rounded-2xl border border-[#e56b35]/30 bg-[#fff1e7] px-5 py-4 text-lg">
            <Lightbulb className="size-6 shrink-0 text-[#e56b35]" />
            <p>
              <strong>{hint.answerLabel}</strong> goes in position{" "}
              <strong>[{hint.targetLabel}]</strong>.
            </p>
            <span className="ml-auto rounded-lg bg-white px-3 py-1 text-sm font-black text-[#a44a22]">
              +25s
            </span>
          </div>
        )}
        <div
          className={`mt-4 shrink-0 grow text-balance font-semibold text-white/85 ${isChinese ? "text-[clamp(1.4rem,1.8vw,2.2rem)] leading-[2.1]" : "text-[clamp(1.05rem,1.35vw,1.6rem)] leading-[2.05]"}`}
        >
          {tokens.map((token, index) => {
            const match = token.match(/^\[(\d+)\]$/);
            if (!match) return <span key={index}>{token}</span>;
            const target = question.targets[Number(match[1]) - 1];
            if (!target) return null;
            const placed = answerByTarget.get(target.id);
            const answer = placed
              ? answerLookup.get(placed.answerId)
              : undefined;
            const owner = placed
              ? playerLookup.get(placed.playerId)
              : undefined;
            const hinted = hint?.targetLabel === target.label;
            return (
              <span
                key={target.id}
                data-answer-target={target.id}
                className={`mx-1 inline-flex min-h-[clamp(2.5rem,4.5vh,3.5rem)] min-w-28 max-w-[calc(100%-0.5rem)] items-center justify-center rounded-xl border-2 px-2 py-1 align-middle text-center ${answer ? "border-transparent" : hinted ? "border-[#e56b35] bg-[#fff1e7] ring-4 ring-[#e56b35]/15" : "border-dashed border-white/25 bg-white/[.05]"}`}
              >
                {answer ? (
                  <span
                    data-answer-card={answer.id}
                    className={`inline-flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-[length:inherit] font-black leading-snug shadow-sm ${placed?.correct ? "bg-[#dff5e8] text-[#087653]" : "bg-[#ffe0c2] text-[#9a3f17]"}`}
                  >
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: owner?.color ?? "#e56b35" }}
                    />
                    {answer.label}
                  </span>
                ) : (
                  <span className="font-mono text-base text-white/30">
                    [{target.label}]
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          {players.map((player) => (
            <span
              key={player.playerId}
              className="inline-flex items-center gap-2 rounded-full bg-[#edf4ef] px-3 py-2 text-sm font-bold"
            >
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: player.color }}
              />
              {player.name}
              <span className="font-mono">
                {lastActions[player.playerId] ?? "Aiming"}
              </span>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-2 text-sm text-white/35">
            <MousePointer2 className="size-4" />
            AirMouse live
          </span>
        </div>
      </section>
      <aside className="host-panel flex min-h-0 min-w-0 flex-col overflow-auto p-5">
        <div className="shrink-0">
          <span className="eyebrow">Phrase bank</span>
          <h2 className="mt-2 text-2xl font-black">Choose a phrase</h2>
          <p className="mt-1 text-sm text-white/45">
            Grab a phrase, then release it over the matching position.
          </p>
        </div>
        <div
          data-hint-zone
          className="mt-3 flex min-h-16 shrink-0 items-center gap-3 rounded-2xl border-2 border-dashed border-[#e56b35]/40 bg-[#fff1e7] px-4 py-3"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#e56b35] shadow-sm">
            <Lightbulb className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-lg">Show a position</strong>
            <span className="block text-sm text-white/45">
              Aim here and tap Grab
            </span>
          </span>
          <span className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-black text-[#a44a22]">
            +25s
          </span>
        </div>
        <div className="mt-3 grid shrink-0 grow grid-cols-2 content-start gap-2 xl:grid-cols-3">
          {poolAnswers.map((answer) => (
            <div
              key={answer.id}
              data-answer-card={answer.id}
              className="flex min-h-12 cursor-none items-center rounded-xl border border-black/8 bg-white px-3 py-2 text-[clamp(.8rem,1vw,1rem)] font-black leading-tight text-[#191b26] shadow-sm"
            >
              <TbHandGrab className="mr-2 size-6 shrink-0 text-[#e56b35]" />
              {answer.label}
            </div>
          ))}
          {complete && (
            <div className="col-span-full rounded-2xl bg-[#dff5e8] p-5 text-lg font-bold text-[#087653]">
              <Check className="mr-2 inline size-6" />
              Passage complete
            </div>
          )}
          {!complete && poolAnswers.length === 0 && (
            <p className="col-span-full rounded-2xl bg-[#fff1e7] p-4 text-base font-semibold text-[#9a3f17]">
              Every phrase is placed. Move the orange ones to a different
              position.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function LeaderboardList({
  entries,
  highlightId,
  limit = 10,
  compact = false,
  className = "",
}: {
  entries: LeaderboardEntry[];
  highlightId?: string | null;
  limit?: number;
  compact?: boolean;
  className?: string;
}) {
  const visible = entries.slice(0, limit);
  if (visible.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/12 py-8 text-center text-white/30 ${className}`}
      >
        <Timer className="mb-2 size-6" />
        <p className="text-sm font-semibold">
          No times yet — be the first team!
        </p>
      </div>
    );
  }
  return (
    <ol className={`space-y-1.5 ${className}`}>
      {visible.map((entry, index) => {
        const highlighted = entry.id === highlightId;
        const medal =
          index === 0
            ? "text-[#ffd166]"
            : index === 1
              ? "text-white/70"
              : index === 2
                ? "text-[#d89b22]"
                : "text-white/30";
        return (
          <li
            key={entry.id}
            className={`flex items-center gap-3 rounded-xl border px-3 ${compact ? "py-2" : "py-3"} ${highlighted ? "border-[#44d79b]/50 bg-[#44d79b]/12" : index === 0 ? "border-[#ffd166]/25 bg-[#ffd166]/8" : "border-white/6 bg-white/[.03]"}`}
          >
            <span
              className={`w-6 shrink-0 text-center font-mono font-black ${medal}`}
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate font-bold ${compact ? "text-sm" : ""}`}
              >
                {entry.teamName}
                {highlighted && (
                  <span className="ml-2 rounded-md bg-[#44d79b] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#0f2a20]">
                    You
                  </span>
                )}
              </span>
              <span className="block truncate text-[11px] text-white/35">
                {entry.playerCount}{" "}
                {entry.playerCount === 1 ? "player" : "players"} ·{" "}
                {formatDate(entry.completedAt)}
                {entry.penaltyMs > 0
                  ? ` · +${Math.round(entry.penaltyMs / 1_000)}s hints`
                  : ""}
              </span>
            </span>
            <strong
              className={`shrink-0 font-mono ${compact ? "text-sm" : "text-lg"}`}
            >
              {formatTime(entry.timeMs)}
            </strong>
          </li>
        );
      })}
    </ol>
  );
}

function GlobalLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section className="host-panel flex flex-col p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <Timer className="size-5 text-[#ffd166]" />
          Fastest teams of all time
        </h2>
        <span className="text-xs font-bold uppercase tracking-[.18em] text-white/35">
          Global · all rooms
        </span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {challenges.map((challenge) => (
          <div
            key={challenge.id}
            className="min-w-0 rounded-2xl bg-white/[.03] p-4"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate font-black">{challenge.label}</h3>
              <span className="shrink-0 text-[11px] text-white/35">
                {challenge.source}
              </span>
            </div>
            <LeaderboardList
              entries={entries.filter(
                (entry) => entry.challengeId === challenge.id,
              )}
              limit={5}
              compact
              className="mt-3"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function CalibrationDot() {
  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-[90] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4">
      <span className="relative flex size-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#e56b35]/25" />
        <span className="absolute inset-2 rounded-full border-2 border-dashed border-[#e56b35]/45" />
        <span className="relative size-6 rounded-full bg-[#e56b35] ring-4 ring-white shadow-[0_0_36px_rgba(229,107,53,.45)]" />
      </span>
    </div>
  );
}

function AirMouseCursors({
  players,
  dragging,
  question,
  registerCursor,
}: {
  players: PlayerPresence[];
  dragging: Record<string, string>;
  question?: PublicQuestion;
  registerCursor: RegisterCursor;
}) {
  return players.map((player) => {
    const held = question?.answers.find(
      (answer) => answer.id === dragging[player.playerId],
    );
    // Position is written directly to the DOM by the host's rAF loop (see registerCursor), not via React.
    return (
      <div
        key={player.playerId}
        ref={(element) => registerCursor(player.playerId, element)}
        className="pointer-events-none fixed left-0 top-0 z-[100]"
        style={{ willChange: "transform" }}
      >
        {held && (
          <div
            className="absolute -bottom-8 left-0 -translate-x-1/2 whitespace-nowrap rounded-xl border-2 bg-white px-4 py-3 text-lg font-bold text-[#191b26] shadow-2xl"
            style={{ borderColor: player.color }}
          >
            {held.label}
          </div>
        )}
        <span
          className={cn(
            "absolute -left-5 -top-5 flex size-10 items-center justify-center rounded-full bg-white shadow-lg",
            held ? "opacity-75" : "opacity-100",
          )}
          style={{ color: player.color }}
        >
          {held ? (
            <TbHandGrab className="size-9" aria-hidden="true" />
          ) : (
            <TbHandStop className="size-9" aria-hidden="true" />
          )}
        </span>
        <span
          className="keep-white absolute left-6 top-6 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-black text-white shadow-lg"
          style={{ backgroundColor: player.color || FALLBACK_COLOR }}
        >
          {player.name}
        </span>
      </div>
    );
  });
}
