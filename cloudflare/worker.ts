import { DurableObject } from "cloudflare:workers";

import type {
  ClientRoomMessage,
  GameStatePayload,
  PlayerPresence,
  ServerRoomMessage,
} from "../lib/realtime/types";

type SocketAttachment = {
  role: "host" | "player";
  clientId: string;
  player?: PlayerPresence;
};

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS?: string;
}

const MAX_MESSAGE_BYTES = 4_096;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isOriginAllowed(request: Request, configuredOrigins?: string) {
  if (!configuredOrigins?.trim()) return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

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
    const byteLength =
      typeof rawMessage === "string"
        ? new TextEncoder().encode(rawMessage).byteLength
        : rawMessage.byteLength;

    if (byteLength > MAX_MESSAGE_BYTES || typeof rawMessage !== "string") {
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

    if (attachment.role === "player") {
      await this.handlePlayerMessage(socket, attachment, message);
      return;
    }

    await this.handleHostMessage(message);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
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
        color: message.payload.color.slice(0, 32),
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
    }
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
      return jsonResponse({ ok: true, service: "airmouse-realtime" });
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
