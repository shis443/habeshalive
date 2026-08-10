"use client";

import { formatSantimAsBirr, type StreamAlert } from "@birq/shared";
import { Centrifuge } from "centrifuge";
import { useEffect, useState } from "react";
import { API_BASE_URL, CENTRIFUGO_WS_URL } from "@/lib/config";
import styles from "./GiftAlertOverlay.module.css";

// Same connection-token endpoint ChatPanel.tsx uses — a Centrifugo
// connection token grants a connection, not a specific namespace (chat,
// gift-alerts, notifications all share one "sub" — see apps/api/src/chat/
// token.ts's own comment), so there's no reason for a second token route
// just because this is a different channel.
async function fetchConnectionToken(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/chat/token`, { method: "POST" });
  const data = await res.json();
  return data.token as string;
}

const DISPLAY_MS = 6000;

// The Gursha Menu — the four gift_tiers rows (db/migrations/0025_gursha_
// gift_economy.sql). gift_types.animation_key always starts with its
// tier's key (mulmul_classic, mulmul_gold, buna_jebena, kurt_special,
// etc. — see that migration and 0019_gursha.sql), so the tier is derived
// from the prefix here rather than needing a new field on GiftAlert —
// zero API/schema change to add this.
type GurshaTier = "mulmul" | "buna" | "tej" | "kurt";

// The non-null assertions below are CSS Module classes defined in
// GiftAlertOverlay.module.css (tierMulmul/tierBuna/tierTej/tierKurt) —
// safe given noUncheckedIndexedAccess types every `styles.x` access as
// possibly-undefined regardless of whether the class actually exists.
const GURSHA_TIER_META: Record<GurshaTier, { icon: string; animationClass: string; soundSrc: string }> = {
  mulmul: { icon: "🍞", animationClass: styles.tierMulmul!, soundSrc: "/sounds/gursha/mulmul.mp3" },
  buna: { icon: "☕", animationClass: styles.tierBuna!, soundSrc: "/sounds/gursha/buna.mp3" },
  tej: { icon: "🍯", animationClass: styles.tierTej!, soundSrc: "/sounds/gursha/tej.mp3" },
  kurt: { icon: "🥩", animationClass: styles.tierKurt!, soundSrc: "/sounds/gursha/kurt.mp3" },
};

function gurshaTierFromAnimationKey(animationKey: string): GurshaTier | null {
  const tier = animationKey.split("_")[0];
  return tier === "mulmul" || tier === "buna" || tier === "tej" || tier === "kurt" ? tier : null;
}

interface QueuedAlert {
  key: string;
  headline: string;
  amountLabel: string;
  message: string | null;
  tier: GurshaTier | null;
}

function toQueuedAlert(alert: StreamAlert): QueuedAlert {
  if (alert.kind === "gift") {
    const name = alert.isAnonymous ? "Someone" : (alert.senderDisplayName ?? "Someone");
    return {
      key: alert.id,
      headline: `${name} sent ${alert.giftName} x${alert.quantity}`,
      amountLabel: formatSantimAsBirr(alert.totalSantim),
      message: alert.message,
      tier: gurshaTierFromAnimationKey(alert.animationKey),
    };
  }
  const name = alert.isAnonymous ? "Someone" : (alert.donorDisplayName ?? "Someone");
  return {
    key: alert.id,
    headline: `${name} donated`,
    amountLabel: formatSantimAsBirr(alert.amountSantim),
    message: alert.message,
    tier: null,
  };
}

// Placeholder treatments, not final art — same "art-blocked, not
// code-blocked" situation as the avatar system and the hero-panel
// character (see AuthModal.tsx's comment): real Lottie/illustrated
// assets and licensed sound effects aren't available yet. This wires the
// real per-tier branching and swaps in CSS-animated placeholders so a
// real asset drop-in later (e.g. GURSHA_TIER_META's soundSrc pointing at
// a real file) needs no code change. Sound is silent until those files
// exist — .play() rejections (missing file, browser autoplay policy) are
// swallowed on purpose, matching publishStreamAlert's own "the money
// already moved, a missing decoration shouldn't error" philosophy.
function playGurshaSound(tier: GurshaTier) {
  const audio = new Audio(GURSHA_TIER_META[tier].soundSrc);
  audio.play().catch(() => {});
}

// OBS browser-source overlay content — see app/overlay/[username]/page.tsx
// for the page this mounts inside (transparent background, no chrome).
// One alert on screen at a time, queued rather than stacked: a live
// on-stream alert is meant to be read, not scrolled past in a pile.
export function GiftAlertOverlay({ streamId }: { streamId: string }) {
  const [queue, setQueue] = useState<QueuedAlert[]>([]);
  const [current, setCurrent] = useState<QueuedAlert | null>(null);

  useEffect(() => {
    const centrifuge = new Centrifuge(CENTRIFUGO_WS_URL, { getToken: fetchConnectionToken });
    const sub = centrifuge.newSubscription(`gift-alerts:${streamId}`);
    sub.on("publication", (ctx) => {
      const alert = ctx.data as StreamAlert;
      setQueue((prev) => [...prev, toQueuedAlert(alert)]);
    });
    sub.subscribe();
    centrifuge.connect();

    return () => {
      sub.unsubscribe();
      centrifuge.disconnect();
    };
  }, [streamId]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setCurrent(next!);
    setQueue(rest);
  }, [queue, current]);

  useEffect(() => {
    if (!current) return;
    if (current.tier) playGurshaSound(current.tier);
    const timer = setTimeout(() => setCurrent(null), DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  const tierMeta = current.tier ? GURSHA_TIER_META[current.tier] : null;

  return (
    <div
      className={`${styles.alert} ${tierMeta?.animationClass ?? ""} ${current.tier === "kurt" ? styles.banner : ""}`}
      key={current.key}
    >
      {tierMeta && <span className={styles.tierIcon}>{tierMeta.icon}</span>}
      <p className={styles.headline}>{current.headline}</p>
      <p className={styles.amount}>{current.amountLabel}</p>
      {current.message && <p className={styles.message}>&ldquo;{current.message}&rdquo;</p>}
    </div>
  );
}
