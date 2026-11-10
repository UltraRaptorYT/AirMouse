import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "airmouse_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

function signature(payload: string, password: string) {
  return createHmac("sha256", password).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordsMatch(provided: string, expected: string) {
  return safeEqual(provided, expected);
}

export function createAdminSession() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("Admin password is not configured.");
  const payload = Buffer.from(String(Math.floor(Date.now() / 1000) + SESSION_SECONDS)).toString("base64url");
  return `${payload}.${signature(payload, password)}`;
}

export function isValidAdminSession(token?: string) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !token) return false;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return false;
  if (!safeEqual(supplied, signature(payload, password))) return false;
  const expiresAt = Number(Buffer.from(payload, "base64url").toString());
  return Number.isSafeInteger(expiresAt) && expiresAt > Math.floor(Date.now() / 1000);
}

export const adminSessionOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: SESSION_SECONDS,
};
