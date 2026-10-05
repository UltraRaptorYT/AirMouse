import { DurableObject } from "cloudflare:workers";

import type {
  ClientRoomMessage,
  GameStatePayload,
  LeaderboardEntry,
  PlayerPresence,
  ServerRoomMessage,
} from "../lib/realtime/types";
import { colorForPlayer, PLAYER_COLORS } from "../lib/realtime/colors";
import { MAX_TEAM_PHOTO_LENGTH } from "../lib/realtime/leaderboard";

type SocketAttachment = {
  role: "host" | "player";
  clientId: string;
  player?: PlayerPresence;
};

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LEADERBOARD: DurableObjectNamespace<Leaderboard>;
  SHARED_PHOTOS: DurableObjectNamespace<SharedPhoto>;
  PHOTOS: R2Bucket;
  ALLOWED_ORIGINS?: string;
}

const MAX_MESSAGE_BYTES = 4_096;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
const LEADERBOARD_ID = "global";
const LEADERBOARD_PER_CHALLENGE = 10;
const LEADERBOARD_MIN_TIME_MS = 10_000;
const LEADERBOARD_MAX_TIME_MS = 6 * 60 * 60 * 1_000;
const PRODUCTION_APP_ORIGINS = new Set(["https://bwm-air-mouse.vercel.app"]);

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function photoDownloadFileName(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return `BWM MRD 2026 AirMouse - ${part("year")}-${part("month")}-${part("day")} ${part("hour")}-${part("minute")}-${part("second")} SGT.jpg`;
}

function parseJpegDataUrl(photo: unknown): Uint8Array | null {
  if (
    typeof photo !== "string" || photo.length > MAX_TEAM_PHOTO_LENGTH ||
    !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo)
  ) return null;
  try {
    const bytes = Uint8Array.from(
      atob(photo.slice("data:image/jpeg;base64,".length)),
      (character) => character.charCodeAt(0),
    );
    return bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
      ? bytes
      : null;
  } catch {
    return null;
  }
}

function isOriginAllowed(request: Request, configuredOrigins?: string) {
  if (!configuredOrigins?.trim()) return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  if (PRODUCTION_APP_ORIGINS.has(origin)) return true;

  return configuredOrigins
    .split(",")
    .map((allowedOrigin) => allowedOrigin.trim())
    .filter(Boolean)
    .includes(origin);
}

function isPlayerPresence(value: unknown): value is PlayerPresence {
  if (!value || typeof value !== "object") return false;
  const player = value as Partial<PlayerPresence>;
  return (
    player.kind === "player" &&
    typeof player.playerId === "string" &&
    typeof player.name === "string" &&
    typeof player.color === "string" &&
    typeof player.onlineAt === "string"
  );
}

function allocatePlayerColor(
  requestedColor: string,
  playerId: string,
  players: PlayerPresence[],
) {
  const usedColors = new Set(
    players
      .filter((player) => player.playerId !== playerId)
      .map((player) => player.color.toLowerCase()),
  );
  const requested = requestedColor.toLowerCase();
  if (
    PLAYER_COLORS.some((color) => color === requested) &&
    !usedColors.has(requested)
  ) {
    return requested;
  }

  const preferred = colorForPlayer(playerId);
  const preferredIndex = PLAYER_COLORS.indexOf(preferred);
  for (let offset = 0; offset < PLAYER_COLORS.length; offset += 1) {
    const candidate =
      PLAYER_COLORS[(preferredIndex + offset) % PLAYER_COLORS.length];
    if (!usedColors.has(candidate)) return candidate;
  }

  let hue = [...playerId].reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) % 360,
    0,
  );
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const candidate = `hsl(${hue} 72% 42%)`;
    if (!usedColors.has(candidate)) return candidate;
    hue = (hue + 47) % 360;
  }
  return preferred;
}

function sanitizeLeaderboardEntry(value: unknown): LeaderboardEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<LeaderboardEntry>;
  const timeMs = Number(entry.timeMs);
  const penaltyMs = Number(entry.penaltyMs) || 0;
  if (
    typeof entry.id !== "string" ||
    typeof entry.challengeId !== "string" ||
    typeof entry.challengeLabel !== "string" ||
    typeof entry.teamName !== "string" ||
    (entry.language !== "en" && entry.language !== "zh") ||
    !Number.isFinite(timeMs) ||
    timeMs < LEADERBOARD_MIN_TIME_MS ||
    timeMs > LEADERBOARD_MAX_TIME_MS
  ) {
    return null;
  }

  return {
    id: entry.id.slice(0, 64),
    challengeId: entry.challengeId.slice(0, 32),
    challengeLabel: entry.challengeLabel.slice(0, 48),
    language: entry.language,
    teamName: entry.teamName.trim().replace(/\s+/g, " ").slice(0, 120) || "Anonymous team",
    playerCount: Math.max(1, Math.min(50, Math.round(Number(entry.playerCount) || 1))),
    timeMs: Math.round(timeMs),
    penaltyMs: Math.max(0, Math.round(penaltyMs)),
    completedAt: Number.isFinite(Number(entry.completedAt)) ? Number(entry.completedAt) : Date.now(),
  };
}

/**
 * Single global Durable Object holding the all-time fastest completions.
 * Rooms call into it via RPC; it never talks to clients directly.
 */
export class Leaderboard extends DurableObject<Env> {
  async list(): Promise<LeaderboardEntry[]> {
    return (await this.ctx.storage.get<LeaderboardEntry[]>("entries")) ?? [];
  }

  async submit(entry: LeaderboardEntry, ownerId: string): Promise<LeaderboardEntry[]> {
    const entries = await this.list();
    if (entries.some((existing) => existing.id === entry.id)) return entries;

    const byChallenge = new Map<string, LeaderboardEntry[]>();
    for (const existing of [...entries, entry]) {
      const bucket = byChallenge.get(existing.challengeId) ?? [];
      bucket.push(existing);
      byChallenge.set(existing.challengeId, bucket);
    }

    const next = [...byChallenge.values()]
      .flatMap((bucket) =>
        bucket
          .sort((a, b) => a.timeMs - b.timeMs || a.completedAt - b.completedAt)
          .slice(0, LEADERBOARD_PER_CHALLENGE),
      )
      .sort((a, b) => a.timeMs - b.timeMs || a.completedAt - b.completedAt);

    await this.ctx.storage.transaction(async (txn) => {
      await txn.put({ entries: next, [`owner:${entry.id}`]: ownerId });
      for (const removed of [...entries, entry].filter(
        (item) => !next.some((kept) => kept.id === item.id),
      )) {
        // Photo objects are archived in R2 and retained after leaderboard eviction.
        await txn.delete(`owner:${removed.id}`);
      }
    });
    return next;
  }

  async savePhoto(runId: string, photo: string, ownerId: string): Promise<string | null> {
    const bytes = parseJpegDataUrl(photo);
    if (!bytes) return "Please take a new photo and try again.";
    const entries = await this.list();
    const entry = entries.find((item) => item.id === runId);
    if (!entry || await this.ctx.storage.get<string>(`owner:${runId}`) !== ownerId)
      return "This photo does not belong to this room's result.";
    const rank = entries.filter((item) => item.challengeId === entry.challengeId)
      .findIndex((item) => item.id === runId);
    if (rank < 0 || rank > 2) return "Your team is no longer in the top three.";
    if (entry.hasPhoto && await this.env.PHOTOS.head(`photos/leaderboard/${runId}.jpg`)) return null;

    const createdAt = Date.now();
    await this.env.PHOTOS.put(`photos/leaderboard/${runId}.jpg`, bytes, {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: {
        createdAt: String(createdAt),
        runId,
        kind: "leaderboard",
        challenge: entry.challengeLabel,
        teamName: entry.teamName,
        completedAt: String(entry.completedAt),
      },
    });
    await this.ctx.storage.transaction(async (txn) => {
      const latest = (await txn.get<LeaderboardEntry[]>("entries")) ?? [];
      const latestEntry = latest.find((item) => item.id === runId);
      if (!latestEntry || await txn.get<string>(`owner:${runId}`) !== ownerId) return;
      latestEntry.hasPhoto = true;
      await txn.put("entries", latest);
    });
    return null;
  }

  async legacyPhotoDetails(runId: string): Promise<{ photo: string; createdAt: number } | undefined> {
    const photo = await this.ctx.storage.get<string>(`photo:${runId}`);
    if (!photo) return undefined;
    return {
      photo,
      createdAt: (await this.ctx.storage.get<number>(`photo-created:${runId}`)) ?? Date.now(),
    };
  }
}

/** Temporary public photo link for captured photos that are not leaderboard entries. */
export class SharedPhoto extends DurableObject<Env> {
  async legacyPhotoDetails(): Promise<{ photo: string; createdAt: number } | undefined> {
    const photo = await this.ctx.storage.get<string>("photo");
    if (!photo) return undefined;
    return {
      photo,
      createdAt: (await this.ctx.storage.get<number>("createdAt")) ?? Date.now(),
    };
  }
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );
  }

  async fetch(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "Expected a WebSocket upgrade" }, 426);
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const clientId = url.searchParams.get("clientId")?.slice(0, 100);

    if ((role !== "host" && role !== "player") || !clientId) {
      return jsonResponse({ error: "Missing role or clientId" }, 400);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    for (const existing of this.ctx.getWebSockets(role)) {
      const attachment = existing.deserializeAttachment() as
        | SocketAttachment
        | null;
      if (role === "host" || attachment?.clientId === clientId) {
        existing.close(4001, "Connection replaced");
      }
    }

    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, clientId } satisfies SocketAttachment);

    this.send(server, {
      type: "connected",
      ...this.getPresence(),
    });
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer) {
    // Cursor packets arrive ~60x/sec per player; keep this hot path allocation-free.
    // A JS string's UTF-16 length is a lower bound on its UTF-8 byte length, so this is a safe cap.
    if (typeof rawMessage !== "string" || rawMessage.length > MAX_TEAM_PHOTO_LENGTH + MAX_MESSAGE_BYTES) {
      this.send(socket, { type: "error", message: "Invalid message" });
      return;
    }

    let message: ClientRoomMessage;
    try {
      message = JSON.parse(rawMessage) as ClientRoomMessage;
    } catch {
      this.send(socket, { type: "error", message: "Invalid JSON" });
      return;
    }

    const attachment = socket.deserializeAttachment() as SocketAttachment;
    if (rawMessage.length > MAX_MESSAGE_BYTES &&
      (attachment.role !== "host" || message.type !== "submit-team-photo")) {
      this.send(socket, { type: "error", message: "Invalid message" });
      return;
    }

    if (attachment.role === "player") {
      await this.handlePlayerMessage(socket, attachment, message);
      return;
    }

    await this.handleHostMessage(message);
  }

  webSocketClose() {
    this.broadcastPresence();
  }

  webSocketError() {
    this.broadcastPresence();
  }

  private async handlePlayerMessage(
    socket: WebSocket,
    attachment: SocketAttachment,
    message: ClientRoomMessage,
  ) {
    if (message.type === "join" || message.type === "player-update") {
      if (!isPlayerPresence(message.payload)) return;

      const player: PlayerPresence = {
        kind: "player",
        playerId: attachment.clientId,
        name: message.payload.name.trim().replace(/\s+/g, " ").slice(0, 18),
        color: allocatePlayerColor(
          message.payload.color.slice(0, 32),
          attachment.clientId,
          this.getPresence().players,
        ),
        onlineAt: new Date().toISOString(),
        motionEnabled: Boolean(message.payload.motionEnabled),
      };
      socket.serializeAttachment({ ...attachment, player });
      this.broadcastPresence();

      if (message.type === "join") {
        const gameState = await this.ctx.storage.get<GameStatePayload>("gameState");
        if (gameState) this.send(socket, { type: "game-state", payload: gameState });
      }
      return;
    }

    if (message.type === "request-game-state") {
      const gameState = await this.ctx.storage.get<GameStatePayload>("gameState");
      if (gameState) {
        this.send(socket, { type: "game-state", payload: gameState });
      } else {
        this.sendToHosts({
          type: "error",
          message: `Player ${attachment.clientId} requested game state`,
        });
      }
      return;
    }

    if (!attachment.player) return;

    const playerId = attachment.clientId;
    if (message.type === "cursor-aim") {
      const rawX = Number(message.payload.x);
      const rawY = Number(message.payload.y);
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;

      const x = Math.max(-1, Math.min(1, rawX));
      const y = Math.max(-1, Math.min(1, rawY));
      this.sendToHosts({ type: "cursor-aim", payload: { playerId, x, y } });
      return;
    }

    if (message.type === "cursor-move") {
      const dx = Math.max(-100, Math.min(100, Number(message.payload.dx) || 0));
      const dy = Math.max(-100, Math.min(100, Number(message.payload.dy) || 0));
      if (dx || dy) {
        this.sendToHosts({ type: "cursor-move", payload: { playerId, dx, dy } });
      }
      return;
    }

    if (
      message.type === "pointer-down" ||
      message.type === "pointer-up" ||
      message.type === "recenter"
    ) {
      this.sendToHosts({ type: message.type, payload: { playerId } });
    }
  }

  private async handleHostMessage(message: ClientRoomMessage) {
    if (message.type === "game-state") {
      await this.ctx.storage.put("gameState", message.payload);
      this.sendToPlayers({ type: "game-state", payload: message.payload });
      return;
    }

    if (message.type === "drop-result") {
      this.sendToPlayer(message.payload.playerId, {
        type: "drop-result",
        payload: message.payload,
      });
      return;
    }

    if (message.type === "round-complete") {
      this.sendToPlayers({ type: "round-complete", payload: message.payload });
      return;
    }

    if (message.type === "request-leaderboard") {
      const entries = await this.leaderboard().list();
      this.sendToHosts({ type: "leaderboard", payload: { entries } });
      return;
    }

    if (message.type === "submit-result") {
      const entry = sanitizeLeaderboardEntry(message.payload);
      if (!entry) {
        this.sendToHosts({ type: "error", message: "Invalid leaderboard entry" });
        return;
      }
      const entries = await this.leaderboard().submit(entry, this.ctx.id.toString());
      this.sendToHosts({ type: "leaderboard", payload: { entries } });
      return;
    }

    if (message.type === "submit-team-photo") {
      const { runId, photo } = message.payload ?? {};
      if (typeof runId !== "string" || runId.length > 64) return;
      try {
        const error = await this.leaderboard().savePhoto(runId, photo, this.ctx.id.toString());
        this.sendToHosts({ type: "team-photo-result", payload: { runId, error: error ?? undefined } });
        if (!error) {
          const entries = await this.leaderboard().list();
          this.sendToHosts({ type: "leaderboard", payload: { entries } });
        }
      } catch (error) {
        console.error("Team photo save failed", error);
        this.sendToHosts({ type: "team-photo-result", payload: { runId, error: "Could not save your photo. Please retry." } });
      }
    }
  }

  private leaderboard() {
    return this.env.LEADERBOARD.get(this.env.LEADERBOARD.idFromName(LEADERBOARD_ID));
  }

  private getPresence() {
    const players = this.ctx
      .getWebSockets("player")
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .map(
        (socket) =>
          (socket.deserializeAttachment() as SocketAttachment | null)?.player,
      )
      .filter((player): player is PlayerPresence => Boolean(player))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      hostOnline: this.ctx
        .getWebSockets("host")
        .some((socket) => socket.readyState === WebSocket.OPEN),
      players,
    };
  }

  private broadcastPresence() {
    const message: ServerRoomMessage = {
      type: "presence",
      ...this.getPresence(),
    };
    this.sendToAll(message);
  }

  private sendToHosts(message: ServerRoomMessage) {
    for (const socket of this.ctx.getWebSockets("host")) this.send(socket, message);
  }

  private sendToPlayers(message: ServerRoomMessage) {
    for (const socket of this.ctx.getWebSockets("player")) this.send(socket, message);
  }

  private sendToPlayer(playerId: string, message: ServerRoomMessage) {
    for (const socket of this.ctx.getWebSockets("player")) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.clientId === playerId) this.send(socket, message);
    }
  }

  private sendToAll(message: ServerRoomMessage) {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message);
  }

  private send(socket: WebSocket, message: ServerRoomMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The close/error callback will update presence for stale sockets.
    }
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      try {
        const leaderboard = env.LEADERBOARD.getByName(LEADERBOARD_ID);
        await leaderboard.list();
        return jsonResponse({
          ok: true,
          service: "airmouse-realtime",
          leaderboard: "connected",
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "Leaderboard health check failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return jsonResponse(
          { ok: false, service: "airmouse-realtime", leaderboard: "error" },
          503,
        );
      }
    }

    if (url.pathname === "/leaderboard" && request.method === "GET") {
      const leaderboard = env.LEADERBOARD.getByName(LEADERBOARD_ID);
      const response = jsonResponse({ entries: await leaderboard.list() });
      // The leaderboard is public; allow the home page to read it across origins.
      response.headers.set("access-control-allow-origin", "*");
      return response;
    }

    const sharePath = "/leaderboard/photos/share";
    if (url.pathname === sharePath && request.method === "OPTIONS") {
      if (!isOriginAllowed(request, env.ALLOWED_ORIGINS)) {
        return jsonResponse({ error: "Origin not allowed" }, 403);
      }
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": request.headers.get("origin") ?? "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        vary: "Origin",
      } });
    }
    if (url.pathname === sharePath && request.method === "POST") {
      if (!isOriginAllowed(request, env.ALLOWED_ORIGINS)) {
        return jsonResponse({ error: "Origin not allowed" }, 403);
      }
      const origin = request.headers.get("origin") ?? "*";
      const respond = (body: unknown, status = 200) => {
        const response = jsonResponse(body, status);
        response.headers.set("access-control-allow-origin", origin);
        response.headers.set("vary", "Origin");
        return response;
      };
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > MAX_TEAM_PHOTO_LENGTH + 256) {
        return respond({ error: "Photo is too large." }, 413);
      }
      let body: { photo?: unknown };
      try {
        body = await request.json() as { photo?: unknown };
      } catch {
        return respond({ error: "Invalid photo upload." }, 400);
      }
      const id = `s-${crypto.randomUUID()}`;
      const bytes = parseJpegDataUrl(body.photo);
      if (!bytes) return respond({ error: "Please take a new photo and try again." }, 400);
      const createdAt = Date.now();
      await env.PHOTOS.put(`photos/shared/${id}.jpg`, bytes, {
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { createdAt: String(createdAt), kind: "shared" },
      });
      return respond({ id }, 201);
    }

    const photoMatch = url.pathname.match(/^\/leaderboard\/photos\/([A-Za-z0-9-]{1,64})(\/download)?$/);
    if (photoMatch && request.method === "GET") {
      const id = photoMatch[1];
      const object = id.startsWith("s-")
        ? await env.PHOTOS.get(`photos/shared/${id}.jpg`)
        : await env.PHOTOS.get(`photos/leaderboard/${id}.jpg`);
      if (object) {
        const createdAt = Number(object.customMetadata?.createdAt) || object.uploaded.getTime();
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("cache-control", "public, max-age=3600");
        headers.set("x-content-type-options", "nosniff");
        if (photoMatch[2]) {
          headers.set("content-disposition", `attachment; filename="${photoDownloadFileName(createdAt)}"`);
        }
        return new Response(object.body, { headers });
      }
      // Existing share links created before the R2 archive remain usable until their old 24-hour expiry.
      {
        const legacy = id.startsWith("s-")
          ? await env.SHARED_PHOTOS.getByName(id).legacyPhotoDetails()
          : await env.LEADERBOARD.getByName(LEADERBOARD_ID).legacyPhotoDetails(id);
        if (legacy) {
          const bytes = Uint8Array.from(atob(legacy.photo.split(",")[1]), (character) => character.charCodeAt(0));
          return new Response(bytes, { headers: {
            "content-type": "image/jpeg",
            ...(photoMatch[2] ? { "content-disposition": `attachment; filename="${photoDownloadFileName(legacy.createdAt)}"` } : {}),
            "cache-control": "public, max-age=3600",
            "x-content-type-options": "nosniff",
          } });
        }
      }
      return jsonResponse({ error: "Photo not found" }, 404);
    }

    const match = url.pathname.match(/^\/rooms\/([^/]+)$/);
    const roomCode = match?.[1]?.toUpperCase();
    if (!roomCode || !ROOM_CODE_PATTERN.test(roomCode)) {
      return jsonResponse({ error: "Invalid room code" }, 404);
    }

    if (!isOriginAllowed(request, env.ALLOWED_ORIGINS)) {
      return jsonResponse({ error: "Origin not allowed" }, 403);
    }

    const roomId = env.ROOMS.idFromName(roomCode);
    return env.ROOMS.get(roomId).fetch(request);
  },
} satisfies ExportedHandler<Env>;
