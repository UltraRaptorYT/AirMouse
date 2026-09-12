"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Clock3, Crown, Gamepad2, Hand, Languages, Lightbulb, LoaderCircle, MousePointer2, Play, RotateCcw, Smartphone, Trophy, Users, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getChallenge, getQuestion, toPublicQuestion, type ChallengeNumber, type GameLanguage, type PublicQuestion } from "@/lib/game/questions";
import { createRoomSocket, generateRoomCode, type RoomConnectionStatus, type RoomSocket } from "@/lib/realtime/room";
import type { CursorAimPayload, CursorMovePayload, DropResultPayload, GameStatePayload, PlayerPresence, PointerActionPayload, ServerRoomMessage } from "@/lib/realtime/types";

type ConnectionStatus = "connecting" | "ready" | "reconnecting" | "error";
type ScoreEntry = { name: string; score: number };
type CursorPosition = { x: number; y: number };
type SolvedAnswer = { targetId: string; playerId: string };
type DwellState = { value: string; playerId: string; progress: number } | null;

const FALLBACK_COLOR = "#ff6b4a";
const PLAYER_DISCONNECT_GRACE_MS = 15_000;
const ROOM_TTL_MS = 20 * 60 * 1_000;
const CHOICE_DWELL_MS = 5_000;
const MEMORISE_MS = 30_000;

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export default function ScreenPage() {
  const [roomCode, setRoomCode] = useState("");
  const [roomUrl, setRoomUrl] = useState("");
  const [roomExpiresAt, setRoomExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [players, setPlayers] = useState<PlayerPresence[]>([]);
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
  const [cursors, setCursors] = useState<Record<string, CursorPosition>>({});
  const [dragging, setDragging] = useState<Record<string, string>>({});
  const [solvedAnswers, setSolvedAnswers] = useState<Record<string, SolvedAnswer>>({});
  const [lastActions, setLastActions] = useState<Record<string, string>>({});
  const [dwell, setDwell] = useState<DwellState>(null);
  const [gameState, setGameState] = useState<GameStatePayload>({ phase: "lobby", questionIndex: 0, questionCount: 0 });

  const socketRef = useRef<RoomSocket | null>(null);
  const playerRemovalTimersRef = useRef<Map<string, number>>(new Map());
  const gameStateRef = useRef(gameState);
  const scoresRef = useRef(scores);
  const playersRef = useRef(players);
  const cursorsRef = useRef(cursors);
  const draggingRef = useRef(dragging);
  const solvedAnswersRef = useRef(solvedAnswers);
  const selectionRef = useRef<{ value: string; playerId: string; startedAt: number } | null>(null);
  const selectionLockedRef = useRef(false);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { playersRef.current = players; }, [players]);

  const clearRound = useCallback(() => {
    solvedAnswersRef.current = {};
    draggingRef.current = {};
    setSolvedAnswers({});
    setDragging({});
    setLastActions({});
  }, []);

  const resetSession = useCallback(() => {
    scoresRef.current = {};
    setScores({});
    clearRound();
    selectionRef.current = null;
    selectionLockedRef.current = false;
    setDwell(null);
    const lobby: GameStatePayload = { phase: "lobby", questionIndex: 0, questionCount: 0 };
    gameStateRef.current = lobby;
    setGameState(lobby);
  }, [clearRound]);

  const openFreshRoom = useCallback(() => {
    const code = generateRoomCode();
    resetSession();
    setPlayers([]);
    playersRef.current = [];
    setCursors({});
    cursorsRef.current = {};
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
    if (!roomExpiresAt || now < roomExpiresAt || gameState.phase !== "lobby") return;
    const timer = window.setTimeout(openFreshRoom, 0);
    return () => window.clearTimeout(timer);
  }, [gameState.phase, now, openFreshRoom, roomExpiresAt]);

  const broadcastState = useCallback((nextState: GameStatePayload) => {
    gameStateRef.current = nextState;
    setGameState(nextState);
    socketRef.current?.send({ type: "game-state", payload: nextState });
  }, []);

  const startQuestion = useCallback((index: number, state = gameStateRef.current) => {
    if (!state.language || !state.challenge) return;
    const challenge = getChallenge(state.language, state.challenge);
    const question = challenge?.questions[index];
    if (!challenge || !question) return;
    clearRound();
    broadcastState({
      phase: "question", language: challenge.language, challenge: challenge.number,
      challengeLabel: challenge.label, question: toPublicQuestion(question), questionIndex: index,
      questionCount: challenge.questions.length, startedAt: state.startedAt ?? Date.now(), penaltyMs: state.penaltyMs ?? 0,
    });
  }, [broadcastState, clearRound]);

  useEffect(() => {
    if (gameState.phase !== "memorise" || !gameState.phaseEndsAt) return;
    const timer = window.setTimeout(() => startQuestion(0, { ...gameStateRef.current, startedAt: Date.now() }), Math.max(0, gameState.phaseEndsAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [gameState.phase, gameState.phaseEndsAt, startQuestion]);

  useEffect(() => {
    if (!roomCode) return;
    const hostKey = `host-${roomCode}-${crypto.randomUUID()}`;
    const removalTimers = playerRemovalTimersRef.current;

    function removePlayer(playerId: string) {
      playerRemovalTimersRef.current.delete(playerId);
      const nextPlayers = playersRef.current.filter((player) => player.playerId !== playerId);
      playersRef.current = nextPlayers;
      setPlayers(nextPlayers);
      const nextDragging = { ...draggingRef.current };
      delete nextDragging[playerId];
      draggingRef.current = nextDragging;
      setDragging(nextDragging);
      const nextCursors = { ...cursorsRef.current };
      delete nextCursors[playerId];
      cursorsRef.current = nextCursors;
      setCursors(nextCursors);
    }

    function syncPlayers(nextPlayers: PlayerPresence[]) {
      const onlineIds = new Set(nextPlayers.map((player) => player.playerId));
      const merged = new Map(playersRef.current.map((player) => [player.playerId, player]));
      nextPlayers.forEach((player) => {
        const timer = playerRemovalTimersRef.current.get(player.playerId);
        if (timer !== undefined) window.clearTimeout(timer);
        playerRemovalTimersRef.current.delete(player.playerId);
        merged.set(player.playerId, player);
      });
      playersRef.current.forEach((player) => {
        if (onlineIds.has(player.playerId) || playerRemovalTimersRef.current.has(player.playerId)) return;
        playerRemovalTimersRef.current.set(player.playerId, window.setTimeout(() => removePlayer(player.playerId), PLAYER_DISCONNECT_GRACE_MS));
      });
      const list = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
      playersRef.current = list;
      setPlayers(list);
      const nextCursors = { ...cursorsRef.current };
      nextPlayers.forEach((player, index) => {
        nextCursors[player.playerId] ??= { x: window.innerWidth / 2 + index * 24, y: window.innerHeight / 2 + index * 18 };
      });
      cursorsRef.current = nextCursors;
      setCursors(nextCursors);
    }

    function updateCursor(playerId: string, nextPosition: CursorPosition) {
      const next = { ...cursorsRef.current, [playerId]: nextPosition };
      cursorsRef.current = next;
      setCursors(next);
    }

    function applyHint(playerId: string) {
      const state = gameStateRef.current;
      const activeQuestion = getQuestion(state.question?.id);
      if (!activeQuestion) return;
      const answer = activeQuestion.answers.find((item) => !solvedAnswersRef.current[item.id]);
      if (!answer) return;
      const nextSolved = { ...solvedAnswersRef.current, [answer.id]: { targetId: answer.targetId, playerId: "hint" } };
      solvedAnswersRef.current = nextSolved;
      setSolvedAnswers(nextSolved);
      broadcastState({ ...state, penaltyMs: (state.penaltyMs ?? 0) + 5_000 });
      setLastActions((current) => ({ ...current, [playerId]: "Hint used: +5 seconds" }));
      if (Object.keys(nextSolved).length === activeQuestion.answers.length) socketRef.current?.send({ type: "round-complete", payload: { questionId: activeQuestion.id } });
    }

    function handleMessage(message: ServerRoomMessage) {
      if (message.type === "connected" || message.type === "presence") { syncPlayers(message.players); return; }
      if (message.type === "cursor-move") {
        const movement: CursorMovePayload = message.payload;
        const previous = cursorsRef.current[movement.playerId] ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        updateCursor(movement.playerId, {
          x: Math.max(10, Math.min(window.innerWidth - 10, previous.x + Math.max(-70, Math.min(70, Number(movement.dx) || 0)))),
          y: Math.max(10, Math.min(window.innerHeight - 10, previous.y + Math.max(-70, Math.min(70, Number(movement.dy) || 0)))),
        });
        return;
      }
      if (message.type === "cursor-aim") {
        const aim: CursorAimPayload = message.payload;
        const edge = 16;
        updateCursor(aim.playerId, {
          x: edge + ((Math.max(-1, Math.min(1, Number(aim.x) || 0)) + 1) / 2) * Math.max(0, window.innerWidth - edge * 2),
          y: edge + ((Math.max(-1, Math.min(1, Number(aim.y) || 0)) + 1) / 2) * Math.max(0, window.innerHeight - edge * 2),
        });
        return;
      }
      if (message.type === "pointer-down") {
        const action: PointerActionPayload = message.payload;
        const cursor = cursorsRef.current[action.playerId];
        if (!cursor || gameStateRef.current.phase !== "question") return;
        const element = document.elementFromPoint(cursor.x, cursor.y);
        if (element?.closest("[data-hint-zone]")) { applyHint(action.playerId); return; }
        const answerId = element?.closest<HTMLElement>("[data-answer-card]")?.dataset.answerCard;
        if (!answerId || Object.values(draggingRef.current).includes(answerId) || solvedAnswersRef.current[answerId]) {
          setLastActions((current) => ({ ...current, [action.playerId]: "Aim at a phrase card" }));
          return;
        }
        const next = { ...draggingRef.current, [action.playerId]: answerId };
        draggingRef.current = next;
        setDragging(next);
        setLastActions((current) => ({ ...current, [action.playerId]: "Holding a phrase" }));
        return;
      }
      if (message.type === "pointer-up") {
        const action: PointerActionPayload = message.payload;
        const answerId = draggingRef.current[action.playerId];
        const cursor = cursorsRef.current[action.playerId];
        const activeQuestion = getQuestion(gameStateRef.current.question?.id);
        if (!answerId || !cursor || !activeQuestion) return;
        const targetId = document.elementFromPoint(cursor.x, cursor.y)?.closest<HTMLElement>("[data-answer-target]")?.dataset.answerTarget;
        const answer = activeQuestion.answers.find((item) => item.id === answerId);
        const correct = Boolean(targetId && answer?.targetId === targetId);
        const player = playersRef.current.find((item) => item.playerId === action.playerId);
        const previousScore = scoresRef.current[action.playerId]?.score ?? 0;
        const points = correct ? 100 : 0;
        const totalScore = previousScore + points;
        const nextDragging = { ...draggingRef.current };
        delete nextDragging[action.playerId];
        draggingRef.current = nextDragging;
        setDragging(nextDragging);
        if (correct && targetId) {
          const nextSolved = { ...solvedAnswersRef.current, [answerId]: { targetId, playerId: action.playerId } };
          const nextScores = { ...scoresRef.current, [action.playerId]: { name: player?.name ?? "Player", score: totalScore } };
          solvedAnswersRef.current = nextSolved;
          scoresRef.current = nextScores;
          setSolvedAnswers(nextSolved);
          setScores(nextScores);
          if (Object.keys(nextSolved).length === activeQuestion.answers.length) socketRef.current?.send({ type: "round-complete", payload: { questionId: activeQuestion.id } });
        }
        setLastActions((current) => ({ ...current, [action.playerId]: correct ? "Correct! +100" : "Wrong position - try again" }));
        const result: DropResultPayload = { playerId: action.playerId, questionId: activeQuestion.id, answerId, correct, points, totalScore };
        socketRef.current?.send({ type: "drop-result", payload: result });
        return;
      }
      if (message.type === "recenter") updateCursor(message.payload.playerId, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }

    const socket = createRoomSocket({
      roomCode, role: "host", clientId: hostKey,
      onStatus: (nextStatus: RoomConnectionStatus) => setStatus(nextStatus === "connected" ? "ready" : nextStatus),
      onMessage: handleMessage,
      onOpen: () => socketRef.current?.send({ type: "game-state", payload: gameStateRef.current }),
    });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
      removalTimers.forEach((timer) => window.clearTimeout(timer));
      removalTimers.clear();
    };
  }, [broadcastState, roomCode]);

  useEffect(() => {
    selectionRef.current = null;
    selectionLockedRef.current = false;
    const clearDwellTimer = window.setTimeout(() => setDwell(null), 0);
    if (gameState.phase !== "language" && gameState.phase !== "challenge") {
      return () => window.clearTimeout(clearDwellTimer);
    }
    const timer = window.setInterval(() => {
      const zones = [...document.querySelectorAll<HTMLElement>("[data-choice]")];
      const occupants = playersRef.current.flatMap((player) => {
        const cursor = cursorsRef.current[player.playerId];
        if (!cursor) return [];
        const zone = zones.find((item) => {
          const box = item.getBoundingClientRect();
          return cursor.x >= box.left && cursor.x <= box.right && cursor.y >= box.top && cursor.y <= box.bottom;
        });
        return zone?.dataset.choice ? [{ playerId: player.playerId, value: zone.dataset.choice }] : [];
      });
      const current = selectionRef.current;
      const occupant = current ? occupants.find((item) => item.playerId === current.playerId && item.value === current.value) : occupants[0];
      if (!occupant) { selectionRef.current = null; setDwell(null); return; }
      const startedAt = current?.playerId === occupant.playerId && current.value === occupant.value ? current.startedAt : Date.now();
      selectionRef.current = { ...occupant, startedAt };
      const progress = Math.min(1, (Date.now() - startedAt) / CHOICE_DWELL_MS);
      setDwell({ ...occupant, progress });
      if (progress < 1 || selectionLockedRef.current) return;
      selectionLockedRef.current = true;
      if (gameStateRef.current.phase === "language") {
        broadcastState({ phase: "challenge", language: occupant.value as GameLanguage, questionIndex: 0, questionCount: 0 });
      } else {
        const challenge = getChallenge(gameStateRef.current.language!, Number(occupant.value) as ChallengeNumber);
        if (!challenge) return;
        broadcastState({ phase: "memorise", language: challenge.language, challenge: challenge.number, challengeLabel: challenge.label, memoriseText: challenge.memoriseText, questionIndex: 0, questionCount: challenge.questions.length, phaseEndsAt: Date.now() + MEMORISE_MS, penaltyMs: 0 });
      }
    }, 100);
    return () => {
      window.clearTimeout(clearDwellTimer);
      window.clearInterval(timer);
    };
  }, [broadcastState, gameState.phase]);

  const activeAnswerCount = gameState.question?.answers.length ?? 0;
  const solvedCount = Object.keys(solvedAnswers).length;
  const roundComplete = activeAnswerCount > 0 && solvedCount === activeAnswerCount;
  useEffect(() => {
    if (!roundComplete || gameState.phase !== "question") return;
    const timer = window.setTimeout(() => {
      const nextIndex = gameStateRef.current.questionIndex + 1;
      if (nextIndex < gameStateRef.current.questionCount) startQuestion(nextIndex);
      else broadcastState({ ...gameStateRef.current, phase: "finished", question: undefined, completedAt: Date.now() });
    }, 1_600);
    return () => window.clearTimeout(timer);
  }, [broadcastState, gameState.phase, roundComplete, startQuestion]);

  const rankedPlayers = useMemo(() => players.map((player) => ({ playerId: player.playerId, name: scores[player.playerId]?.name ?? player.name, score: scores[player.playerId]?.score ?? 0, color: player.color })).sort((a, b) => b.score - a.score).slice(0, 5), [players, scores]);
  const roomRemaining = Math.max(0, roomExpiresAt - now);
  const elapsed = gameState.startedAt ? Math.max(0, (gameState.completedAt ?? now) - gameState.startedAt + (gameState.penaltyMs ?? 0)) : 0;

  if (gameState.phase === "lobby") {
    return <HostShell roomCode={roomCode} status={status} roomRemaining={roomRemaining}><div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_360px]"><section className="host-panel grid items-center gap-8 overflow-hidden p-7 md:grid-cols-[280px_1fr] md:p-9"><div className="mx-auto w-full max-w-[280px] rounded-[2rem] bg-[#fffdf6] p-5 shadow-2xl">{roomUrl ? <QRCodeSVG value={roomUrl} size={260} level="M" className="h-auto w-full" bgColor="#fffdf6" fgColor="#121521" /> : <div className="aspect-square animate-pulse rounded-2xl bg-black/5" />}</div><div><span className="eyebrow">Join the open room</span><h1 className="mt-5 text-balance text-4xl font-black leading-[.95] tracking-[-.04em] sm:text-6xl">Scan. Aim. Complete the teaching.</h1><p className="mt-5 max-w-xl text-lg leading-relaxed text-white/55">Players can join together at any time. This room code refreshes automatically after 20 minutes while waiting.</p><div className="mt-7 inline-flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 px-5 py-4"><span className="text-sm text-white/45">Room code</span><strong className="font-mono text-2xl tracking-[.22em]">{roomCode || "------"}</strong></div></div></section><section className="host-panel flex min-h-[380px] flex-col p-6"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-2xl font-bold"><Users className="size-5 text-[#ff6b4a]" />{players.length} {players.length === 1 ? "player" : "players"}</h2><span className="status-pill">Open</span></div><div className="mt-5 min-h-0 flex-1 space-y-2 overflow-auto">{players.length === 0 ? <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 text-center text-white/35"><Smartphone className="mb-3 size-8" /><p className="font-semibold">Waiting for players</p></div> : players.map((player) => <div key={player.playerId} className="flex items-center gap-3 rounded-2xl bg-white/[.045] px-4 py-3"><span className="flex size-9 items-center justify-center rounded-xl font-black" style={{ backgroundColor: player.color }}>{player.name[0]?.toUpperCase()}</span><span className="flex-1 font-semibold">{player.name}</span><span className={player.motionEnabled ? "text-xs font-bold text-[#44d79b]" : "text-xs text-white/30"}>{player.motionEnabled ? "Ready" : "Motion off"}</span></div>)}</div><Button className="mt-5 h-14 rounded-2xl bg-[#ff6b4a] text-base font-bold text-white hover:bg-[#ff7a5d]" disabled={!players.length || status !== "ready"} onClick={() => broadcastState({ phase: "language", questionIndex: 0, questionCount: 0 })}><Play className="mr-1 size-5 fill-current" />Start activity</Button></section></div></HostShell>;
  }

  if (gameState.phase === "language" || gameState.phase === "challenge") {
    const languageStep = gameState.phase === "language";
    const choices = languageStep ? [{ value: "en", title: "English", subtitle: "English questions" }, { value: "zh", title: "中文", subtitle: "中文题目" }] : [{ value: "1", title: gameState.language === "zh" ? "挑战一" : "Challenge 1", subtitle: gameState.language === "zh" ? "《十法经》" : "The Ten Teaching Sūtra" }, { value: "2", title: gameState.language === "zh" ? "挑战二" : "Challenge 2", subtitle: gameState.language === "zh" ? "《华严经》" : "The Array of Stalks Sūtra" }];
    return <HostShell roomCode={roomCode} status={status} roomRemaining={roomRemaining}><section className="host-panel flex flex-1 flex-col p-7 sm:p-10"><div className="text-center"><span className="eyebrow">{languageStep ? "Step 1 of 2" : "Step 2 of 2"}</span><h1 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-6xl">{languageStep ? "Choose a language" : "Choose a challenge"}</h1><p className="mt-3 text-lg text-white/50">Move a cursor into a zone and keep it there for 5 seconds to confirm.</p></div><div className="mt-8 grid flex-1 gap-6 md:grid-cols-2">{choices.map((choice) => { const active = dwell?.value === choice.value; return <div key={choice.value} data-choice={choice.value} className={`relative flex min-h-64 flex-col items-center justify-center overflow-hidden rounded-[2rem] border-2 text-center transition ${active ? "border-[#44d79b] bg-[#44d79b]/14" : "border-dashed border-white/20 bg-white/[.04]"}`}><Languages className={`size-10 ${active ? "text-[#44d79b]" : "text-[#ff8b70]"}`} /><strong className="mt-5 text-4xl font-black">{choice.title}</strong><span className="mt-2 text-base text-white/45">{choice.subtitle}</span><div className="absolute inset-x-0 bottom-0 h-3 bg-white/8"><div className="h-full bg-[#44d79b] transition-[width] duration-100" style={{ width: active ? `${dwell.progress * 100}%` : "0%" }} /></div>{active && <span className="mt-5 font-mono text-sm font-bold text-[#44d79b]">Hold {Math.max(1, Math.ceil(5 - dwell.progress * 5))}s</span>}</div>; })}</div><AirMouseCursors players={players} cursors={cursors} dragging={{}} /></section></HostShell>;
  }

  if (gameState.phase === "memorise") {
    const remaining = Math.max(0, (gameState.phaseEndsAt ?? now) - now);
    return <HostShell roomCode={roomCode} status={status} roomRemaining={roomRemaining}><section className="host-panel flex flex-1 flex-col items-center justify-center overflow-hidden p-7 text-center sm:p-10"><div className="flex items-center gap-3"><span className="eyebrow">{gameState.challengeLabel}</span><span className="flex items-center gap-2 rounded-full bg-[#ffd166]/12 px-4 py-2 font-mono font-black text-[#ffd166]"><Clock3 className="size-4" />{formatTime(remaining)}</span></div><h1 className="mt-6 text-4xl font-black tracking-[-.04em] sm:text-6xl">Read, recite and memorise</h1><p className={`mt-8 max-w-6xl text-balance font-semibold leading-[1.75] text-white/80 ${gameState.language === "zh" ? "text-3xl" : "text-xl sm:text-2xl"}`}>{gameState.memoriseText}</p><p className="mt-8 text-sm font-bold uppercase tracking-[.18em] text-white/35">Questions begin automatically when time is up</p><AirMouseCursors players={players} cursors={cursors} dragging={{}} /></section></HostShell>;
  }

  if (gameState.phase === "finished") {
    return <HostShell roomCode={roomCode} status={status} roomRemaining={roomRemaining}><section className="host-panel flex flex-1 flex-col items-center justify-center p-8 text-center"><div className="flex size-20 items-center justify-center rounded-[1.6rem] bg-[#ffd166] text-[#171922]"><Trophy className="size-10" /></div><span className="eyebrow mt-6">{gameState.challengeLabel} complete</span><h1 className="mt-4 text-5xl font-black tracking-[-.04em] sm:text-7xl">{formatTime(elapsed)}</h1><p className="mt-2 text-white/45">Final time includes +{Math.round((gameState.penaltyMs ?? 0) / 1_000)}s from hints</p><div className="mt-8 w-full max-w-2xl space-y-2">{rankedPlayers.map((player, index) => <div key={player.playerId} className={`flex items-center gap-4 rounded-2xl border px-5 py-4 text-left ${index === 0 ? "border-[#ffd166]/40 bg-[#ffd166]/10" : "border-white/8 bg-white/[.035]"}`}><span className="w-7 text-xl font-black text-white/30">{index + 1}</span><span className="flex size-10 items-center justify-center rounded-xl font-black" style={{ backgroundColor: player.color }}>{player.name[0]?.toUpperCase()}</span><span className="flex-1 text-lg font-bold">{player.name}</span>{index === 0 && <Crown className="size-5 text-[#ffd166]" />}<strong className="font-mono">{player.score} pts</strong></div>)}</div><Button className="mt-8 h-13 rounded-2xl bg-white px-7 font-bold text-[#151722] hover:bg-white/90" onClick={openFreshRoom}><RotateCcw className="mr-1 size-4" />New group &amp; new code</Button></section></HostShell>;
  }

  return <HostShell roomCode={roomCode} status={status} roomRemaining={roomRemaining}><div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><QuestionStage question={gameState.question} questionIndex={gameState.questionIndex} questionCount={gameState.questionCount} solvedAnswers={solvedAnswers} dragging={dragging} players={players} /><aside className="host-panel flex flex-col p-6"><div className="flex items-center justify-between border-b border-white/8 pb-5"><div><p className="text-sm text-white/40">Challenge time</p><p className="mt-1 font-mono text-3xl font-black">{formatTime(elapsed)}</p></div><span className="rounded-xl bg-[#ffd166]/12 px-3 py-2 text-sm font-bold text-[#ffd166]">+{Math.round((gameState.penaltyMs ?? 0) / 1_000)}s</span></div><div className="mt-5 rounded-2xl bg-white/[.035] p-4"><p className="text-sm text-white/40">Phrase progress</p><p className="mt-1 text-3xl font-black">{solvedCount}<span className="text-white/25">/{activeAnswerCount}</span></p></div><div className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto">{players.map((player) => <div key={player.playerId} className="flex items-center gap-3 rounded-xl bg-white/[.035] px-3 py-3"><span className="size-2.5 rounded-full" style={{ backgroundColor: player.color }} /><span className="min-w-0 flex-1 truncate font-semibold">{player.name}</span><span className="max-w-32 truncate text-xs text-white/35">{lastActions[player.playerId] ?? "Aiming"}</span><strong className="font-mono text-sm">{scores[player.playerId]?.score ?? 0}</strong></div>)}</div><div data-hint-zone className="mt-4 flex min-h-28 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#ffd166]/35 bg-[#ffd166]/8 p-4 text-center"><Lightbulb className="size-6 text-[#ffd166]" /><strong className="mt-2">Need a hint?</strong><span className="mt-1 text-xs text-white/40">Aim here and tap Grab to fill one part (+5s)</span></div></aside></div><AirMouseCursors players={players} cursors={cursors} dragging={dragging} question={gameState.question} /></HostShell>;
}

function HostShell({ roomCode, status, roomRemaining, children }: { roomCode: string; status: ConnectionStatus; roomRemaining: number; children: React.ReactNode }) {
  return <main className="game-shell min-h-dvh bg-[#11131d] p-4 text-white sm:p-6"><div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[1500px] flex-col gap-5 sm:min-h-[calc(100dvh-3rem)]"><header className="flex items-center justify-between px-1"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-2xl bg-[#ff6b4a]"><Gamepad2 className="size-5" /></span><div><p className="text-lg font-black leading-none">AirMouse</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[.2em] text-white/35">Lamrim activity</p></div></div><div className="flex items-center gap-3">{(status === "connecting" || status === "reconnecting") && <LoaderCircle className="size-4 animate-spin text-white/40" />}{status === "error" && <WifiOff className="size-4 text-red-400" />}<span className="hidden items-center gap-1.5 text-xs text-white/40 sm:flex"><Clock3 className="size-3.5" />code {formatTime(roomRemaining)}</span><strong className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono tracking-[.18em]">{roomCode || "------"}</strong></div></header>{children}</div></main>;
}

function QuestionStage({ question, questionIndex, questionCount, solvedAnswers, dragging, players }: { question?: PublicQuestion; questionIndex: number; questionCount: number; solvedAnswers: Record<string, SolvedAnswer>; dragging: Record<string, string>; players: PlayerPresence[] }) {
  if (!question) return null;
  const heldIds = new Set(Object.values(dragging));
  const playerLookup = new Map(players.map((player) => [player.playerId, player]));
  return <section className="host-panel flex flex-col overflow-hidden p-6 sm:p-8"><div className="flex items-center justify-between"><span className="eyebrow">Question {questionIndex + 1} of {questionCount}</span><span className="flex items-center gap-2 text-sm text-white/35"><MousePointer2 className="size-4" />AirMouse live</span></div><h1 className="mt-5 text-balance text-3xl font-black leading-[1.15] tracking-[-.035em] sm:text-5xl">{question.prompt}</h1><p className="mt-3 text-lg font-semibold text-[#ffb09e]">{question.instruction}</p><div className="mt-7 grid flex-1 content-center gap-4" style={{ gridTemplateColumns: `repeat(${question.targets.length}, minmax(0, 1fr))` }}>{question.targets.map((target) => { const answer = question.answers.find((item) => solvedAnswers[item.id]?.targetId === target.id); const owner = answer ? playerLookup.get(solvedAnswers[answer.id].playerId) : undefined; return <div key={target.id} data-answer-target={target.id} className="flex min-h-40 flex-col items-center justify-center rounded-[1.6rem] border-2 border-dashed border-white/20 bg-white/[.05] p-4 text-center"><span className="font-mono text-sm text-white/30">[{target.label}]</span>{answer ? <span className="mt-3 rounded-xl bg-[#fffdf6] px-4 py-3 text-lg font-black text-[#191b26] shadow-xl"><span className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: owner?.color ?? "#ffd166" }} />{answer.label}</span> : <span className="mt-3 text-sm text-white/25">Drop part {target.label} here</span>}</div>; })}</div><div className="mt-5 min-h-28 rounded-[1.5rem] border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap justify-center gap-3">{question.answers.filter((answer) => !solvedAnswers[answer.id] && !heldIds.has(answer.id)).map((answer) => <span key={answer.id} data-answer-card={answer.id} className="inline-flex min-h-20 min-w-40 cursor-none items-center justify-center rounded-2xl bg-[#fffdf6] px-6 py-4 text-center text-lg font-black text-[#191b26] shadow-xl"><Hand className="mr-2 size-4 text-[#ff6b4a]" />{answer.label}</span>)}{question.answers.every((answer) => solvedAnswers[answer.id] || heldIds.has(answer.id)) && <span className="py-4 font-bold text-[#44d79b]"><Check className="mr-2 inline size-5" />Phrase complete</span>}</div></div></section>;
}

function AirMouseCursors({ players, cursors, dragging, question }: { players: PlayerPresence[]; cursors: Record<string, CursorPosition>; dragging: Record<string, string>; question?: PublicQuestion }) {
  return players.map((player) => {
    const cursor = cursors[player.playerId];
    const held = question?.answers.find((answer) => answer.id === dragging[player.playerId]);
    if (!cursor) return null;
    return <div key={player.playerId} className="pointer-events-none fixed left-0 top-0 z-[100]" style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`, transition: "transform 80ms linear", willChange: "transform" }}>{held && <div className="absolute bottom-5 left-5 whitespace-nowrap rounded-xl bg-[#fffdf6] px-4 py-3 font-bold text-[#191b26] shadow-2xl">{held.label}</div>}<div className="absolute -left-1 -top-1 size-7 rounded-full border-[3px] border-white shadow-xl" style={{ backgroundColor: player.color }}><span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" /></div><span className="absolute left-5 top-5 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-black text-white shadow-lg" style={{ backgroundColor: player.color || FALLBACK_COLOR }}>{player.name}</span></div>;
  });
}
