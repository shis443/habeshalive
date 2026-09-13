"use client";

import type { PrerollBreak } from "@birq/shared";
import { useState, type ReactNode } from "react";
import { AdBreakPlayer } from "./AdBreakPlayer";

// Thin client boundary so the (server component) watch page can gate the
// real player behind a pre-roll break without becoming a client component
// itself — VideoPlayer/PpvPaywall/SquadGrid (passed as children) are
// untouched and only ever mount once the break is done or was never served.
export function WatchPlayerGate({
  prerollBreak,
  children,
}: {
  prerollBreak: PrerollBreak;
  children: ReactNode;
}) {
  const [adDone, setAdDone] = useState(!prerollBreak.slot1);

  if (!adDone) {
    return <AdBreakPlayer prerollBreak={prerollBreak} onDone={() => setAdDone(true)} />;
  }
  return <>{children}</>;
}
