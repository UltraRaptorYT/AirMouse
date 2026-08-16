import type { ClientRoomMessage, ServerRoomMessage } from "@/lib/realtime/types";

export type RoomConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

type RoomSocketOptions = {
  roomCode: string;
  role: "host" | "player";
  clientId: string;
  onMessage: (message: ServerRoomMessage) => void;
  onStatus: (status: RoomConnectionStatus) => void;
  onOpen?: () => void;
};

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

function getRealtimeUrl({ roomCode, role, clientId }: RoomSocketOptions) {
  const configuredUrl = process.env.NEXT_PUBLIC_AIRMOUSE_WS_URL?.trim();
  if (!configuredUrl) return null;

  const url = new URL(configuredUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;

  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath}/rooms/${encodeURIComponent(roomCode)}`;
  url.searchParams.set("role", role);
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

export type RoomSocket = ReturnType<typeof createRoomSocket>;

export function createRoomSocket(options: RoomSocketOptions) {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let connectTimeout: number | null = null;
  let reconnectAttempt = 0;
  let lastPongAt = Date.now();
  let closedByClient = false;

  function clearTimers() {
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    reconnectTimer = null;
    heartbeatTimer = null;
    connectTimeout = null;
  }

  function send(message: ClientRoomMessage) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function scheduleReconnect() {
    if (closedByClient || reconnectTimer !== null) return;

    options.onStatus("reconnecting");
    const exponentialDelay = Math.min(
      1_000 * 2 ** reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    const delay = exponentialDelay + Math.floor(Math.random() * 400);
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function startHeartbeat() {
    lastPongAt = Date.now();
    heartbeatTimer = window.setInterval(() => {
      if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        socket?.close(4000, "Heartbeat timed out");
        return;
      }
      send({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  function connect() {
    if (closedByClient || socket?.readyState === WebSocket.OPEN) return;

    const endpoint = getRealtimeUrl(options);
    if (!endpoint) {
      options.onStatus("error");
      return;
    }

    options.onStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");
    socket = new WebSocket(endpoint);
    connectTimeout = window.setTimeout(() => {
      socket?.close(4000, "Connection timed out");
    }, 10_000);

    socket.addEventListener("open", () => {
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      connectTimeout = null;
      reconnectAttempt = 0;
      options.onStatus("connected");
      startHeartbeat();
      options.onOpen?.();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as ServerRoomMessage;
        if (message.type === "pong") {
          lastPongAt = Date.now();
          return;
        }
        options.onMessage(message);
      } catch {
        // Ignore malformed frames instead of breaking the connection loop.
      }
    });

    socket.addEventListener("close", () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      heartbeatTimer = null;
      connectTimeout = null;
      socket = null;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  function reconnectNow() {
    if (closedByClient || socket?.readyState === WebSocket.OPEN) return;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    connect();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") reconnectNow();
  }

  window.addEventListener("online", reconnectNow);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  connect();

  return {
    send,
    close() {
      closedByClient = true;
      clearTimers();
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      socket?.close(1000, "Client closed");
      socket = null;
    },
  };
}

export function generateRoomCode(length = 6) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  return Array.from({ length }, () => {
    return chars[Math.floor(Math.random() * chars.length)];
  }).join("");
}
