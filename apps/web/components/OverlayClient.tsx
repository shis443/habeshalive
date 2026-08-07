"use client";

import { streamDetailSchema } from "@habeshalive/shared";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { GiftAlertOverlay } from "./GiftAlertOverlay";

const POLL_MS = 20_000;

// An OBS browser source is added once and left running for the life of a
// channel, long before and after any single stream — a one-shot server
// fetch (404 when offline) doesn't fit that. Polls client-side instead,
// picking up streamId whenever the creator actually goes live, same
// "degrade to nothing rather than crash" posture as the rest of this
// app's public data fetches.
export function OverlayClient({ username }: { username: string }) {
  const [streamId, setStreamId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE_URL}/streams/username/${encodeURIComponent(username)}`);
        if (!res.ok) {
          if (!cancelled) setStreamId(null);
          return;
        }
        const stream = streamDetailSchema.parse(await res.json());
        if (!cancelled) setStreamId(stream.id);
      } catch {
        if (!cancelled) setStreamId(null);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [username]);

  if (!streamId) return null;
  return <GiftAlertOverlay streamId={streamId} />;
}
