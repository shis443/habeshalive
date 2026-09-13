"use client";

import type { PrerollBreak } from "@birq/shared";
import { useEffect, useState } from "react";
import { AdCreativePreview } from "./AdCreativePreview";
import styles from "./AdBreakPlayer.module.css";

// Orchestrates the two-slot break: slot1 (mandatory) always plays first,
// slot2 (skippable) immediately after if one was served, then hands off to
// onDone — the watch page swaps this out for the real player at that point.
// Only ever mounts one AdCreativePreview at a time, never both.
export function AdBreakPlayer({ prerollBreak, onDone }: { prerollBreak: PrerollBreak; onDone: () => void }) {
  const [stage, setStage] = useState<"slot1" | "slot2">("slot1");
  const current = stage === "slot1" ? prerollBreak.slot1 : prerollBreak.slot2;

  useEffect(() => {
    // Defensive only — the caller is only supposed to mount this when
    // slot1 is non-null, and handleSlot1Done below only advances to
    // "slot2" when one exists. Bails out of render (rather than calling
    // onDone directly during render) if that invariant is ever violated.
    if (!current) onDone();
  }, [current, onDone]);

  if (!current) return null;

  function handleSlot1Done() {
    if (prerollBreak.slot2) setStage("slot2");
    else onDone();
  }

  return (
    <div className={styles.wrap}>
      <AdCreativePreview
        key={current.impressionId}
        ad={current}
        interactive
        onDone={stage === "slot1" ? handleSlot1Done : onDone}
      />
    </div>
  );
}
