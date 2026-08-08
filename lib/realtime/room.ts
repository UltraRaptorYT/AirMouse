import { supabase } from "@/lib/supabase/client";

export function getRoomChannel(roomCode: string) {
  return supabase.channel(`airmouse:${roomCode}`, {
    config: {
      broadcast: {
        self: false,
      },
    },
  });
}

export function generateRoomCode(length = 6) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  return Array.from({ length }, () => {
    return chars[Math.floor(Math.random() * chars.length)];
  }).join("");
}
