"use client";

import type { LiveStream } from "@birq/shared";
import { useEffect, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import { API_BASE_URL } from "@/lib/config";
import { StreamCard } from "./StreamCard";
import styles from "./LiveChannelsGrid.module.css";

// The Live Channels grid (apps/web/app/browse/page.tsx) used to be a
// plain server-rendered list — fetched once, at request time, and never
// again. A stream that went live a minute after someone loaded the page
// just never appeared until they manually reloaded. This polls the same
// public endpoint the server render used, on an interval, and replaces
// the grid in place — same pattern as RecentGiftersStrip's 20s poll, not
// a new mechanism. A few seconds of staleness on a stream directory is a
// reasonable tradeoff against the complexity of a push-based rewrite
// (there's no "a stream started" Centrifugo event published anywhere in
// this codebase today — adding one would mean touching the webhook
// handlers that mark a stream live, a bigger and riskier change than
// this page actually needs).
const POLL_INTERVAL_MS = 15_000;

export function LiveChannelsGrid({
  initialStreams,
  category,
  language,
  tag,
  sort,
}: {
  initialStreams: LiveStream[];
  category: string;
  language: string;
  tag: string;
  sort: string;
}) {
  const [streams, setStreams] = useState(initialStreams);

  // Re-seeds from the server-rendered list on every navigation (filter
  // change, tab switch) rather than fighting it with stale poll state —
  // the params below are what re-triggers this on a real filter change.
  useEffect(() => {
    setStreams(initialStreams);
  }, [initialStreams]);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (language) params.set("language", language);
      if (tag) params.set("tag", tag);
      if (sort) params.set("sort", sort);
      const qs = params.toString();
      fetch(`${API_BASE_URL}/streams/live${qs ? `?${qs}` : ""}`)
        .then((res) => (res.ok ? unwrapClientData<LiveStream[]>(res) : null))
        .then((data) => {
          if (!cancelled && data) setStreams(data);
        })
        .catch(() => {
          // A missed poll just means the grid stays as it was until the
          // next one — no worse than the old fully-static behavior.
        });
    }
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [category, language, tag, sort]);

  if (streams.length === 0) {
    return <p className={styles.empty}>No live streams match these filters right now.</p>;
  }

  return (
    <div className={styles.grid}>
      {streams.map((stream) => (
        <StreamCard key={stream.id} stream={stream} />
      ))}
    </div>
  );
}
