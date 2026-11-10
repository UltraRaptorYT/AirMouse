import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionOptions, createAdminSession, passwordsMatch } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return Response.json({ error: "Admin access is not configured on the server." }, { status: 503 });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (typeof body?.password !== "string" || !passwordsMatch(body.password, expected)) {
    return Response.json({ error: "The admin password is incorrect." }, { status: 401 });
  }
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, createAdminSession(), adminSessionOptions);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { ...adminSessionOptions, maxAge: 0 });
  return response;
}
