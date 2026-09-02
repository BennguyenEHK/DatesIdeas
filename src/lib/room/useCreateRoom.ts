"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom } from "./api";
import { saveRoom } from "@/lib/history/identity";

/**
 * Opening an evening: ask the server for a code, remember it, go there.
 *
 * Shared by the home page and the screen you land on when a room has closed,
 * so both do the same thing — including remembering the room, which is what
 * keeps "Past evenings" whole across a code that changes daily.
 */
export function useCreateRoom() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setPending(true);
    setError(null);
    const room = await createRoom();
    if (!room) {
      setPending(false);
      setError("Could not open a room just now. Try again.");
      return;
    }
    saveRoom(room.code);
    // Deliberately still pending: we are leaving, and a button that springs
    // back to life during the navigation invites a second room.
    router.push(`/room/${room.code}`);
  }, [router]);

  return { start, pending, error };
}
