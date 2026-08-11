"use client";

import { useEffect, useRef } from "react";

// Phase 3.5 — fires once per real mount of /following, marking
// following_last_seen_at so badges computed on the *next* visit reflect
// what's actually new since this one. Deliberately not a side effect of
// the page's own data fetch (see follows/service.ts's markFollowingSeen
// comment) — a plain client-mount beacon, same "the user is genuinely
// looking at this now" signal as VodPlayer.tsx/ClipPlayer.tsx's own
// view-recording beacons, just with no visible UI of its own.
export function FollowingSeenBeacon() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    fetch("/api/backend/follows/mine/seen", { method: "POST" }).catch(() => {
      // Best-effort — a failed beacon just means badges linger one visit
      // longer than ideal, not worth surfacing as an error.
    });
  }, []);

  return null;
}
