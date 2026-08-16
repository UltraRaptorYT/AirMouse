import { redirect } from "next/navigation";

export default async function ControllerRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawRoom = Array.isArray(params.room) ? params.room[0] : params.room;
  const roomCode = rawRoom?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  redirect(roomCode ? `/room/${roomCode}` : "/");
}
