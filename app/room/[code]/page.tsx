import RoomClient from "./room-client";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <RoomClient
      roomCode={code
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6)}
    />
  );
}
