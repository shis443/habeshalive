"use client";

import { formatSantimAsBirr, type StreamAlert } from "@birq/shared";
import { Centrifuge } from "centrifuge";
import { useEffect, useState } from "react";
import { API_BASE_URL, CENTRIFUGO_WS_URL } from "@/lib/config";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./GiftAlertOverlay.module.css";

// Same connection-token endpoint ChatPanel.tsx uses — a Centrifugo
// connection token grants a connection, not a specific namespace (chat,
// gift-alerts, notifications all share one "sub" — see apps/api/src/chat/
// token.ts's own comment), so there's no reason for a second token route
// just because this is a different channel.
async function fetchConnectionToken(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/chat/token`, { method: "POST" });
  const data = await unwrapClientData<{ token: string }>(res);
  return data.token;
}

// Real Birr amount → 0.0-1.0, logarithmic — same bounds and reasoning as
// flutter_consumer's birqGiftAlertIntensity: 500 santim is donateSchema's
// own 5 ETB floor, 250,000 is kurt's real ceiling (100x quantity cap at a
// 2,500 santim base price). Kept identical across platforms so a gift
// never reads as a different "size" depending which client is watching.
function gurshaIntensity(amountSantim: number): number {
  const floor = 500;
  const ceiling = 250000;
  const clamped = Math.min(ceiling, Math.max(floor, amountSantim));
  const t = (Math.log(clamped) - Math.log(floor)) / (Math.log(ceiling) - Math.log(floor));
  return Math.min(1, Math.max(0, t));
}

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
// Real interim art (Birq Gursha Kit asset pack, ~/Desktop/birq-gursha-assets)
// — one hero image per tier, not per gift type, same reasoning as
// flutter_consumer's BirqGiftVisual: the DB has far more gift_types per
// tier than commissioned art, but every real animation_key already
// starts with a valid tier prefix, so a tier-keyed fallback image covers
// every real gift with no chance of a miss. `icon` (emoji) kept as the
// alt-text/no-JS fallback, not removed.
const GURSHA_TIER_META: Record<
  GurshaTier,
  { icon: string; imageSrc: string; animationClass: string; soundSrc: string }
> = {
  mulmul: {
    icon: "🍞",
    imageSrc: "/gifts/_fallback_mulmul.webp",
    animationClass: styles.tierMulmul!,
    soundSrc: "/sounds/gursha/mulmul.mp3",
  },
  buna: {
    icon: "☕",
    imageSrc: "/gifts/_fallback_buna.webp",
    animationClass: styles.tierBuna!,
    soundSrc: "/sounds/gursha/buna.mp3",
  },
  tej: {
    icon: "🍯",
    imageSrc: "/gifts/_fallback_tej.webp",
    animationClass: styles.tierTej!,
    soundSrc: "/sounds/gursha/tej.mp3",
  },
  kurt: {
    icon: "🥩",
    imageSrc: "/gifts/_fallback_kurt.webp",
    animationClass: styles.tierKurt!,
    soundSrc: "/sounds/gursha/kurt.mp3",
  },
};

// Birq Gursha Kit §08: hold time is always a whole number of the tier's
// own performance cycle (enter + N loops + exit), so an alert never cuts
// off mid-cycle — same fix as flutter_consumer's
// birq_gift_alert_overlay.dart, applied here for platform parity. Was a
// flat 6000ms regardless of tier or amount.
const TIER_PERFORM_MS: Record<GurshaTier, number> = { mulmul: 1600, buna: 2400, tej: 3000, kurt: 4000 };
const ENTER_MS = 320;
const EXIT_MS = 300;
const MIN_HOLD_MS = 2600;
const MAX_HOLD_MS = 8000;
// Donations have no tier signature of their own — mulmul's cadence (the
// shortest) is the reasonable default rather than inventing a fifth one.
const DONATION_PERFORM_MS = TIER_PERFORM_MS.mulmul;

function loopCountFor(intensity: number): number {
  return 1 + Math.floor(intensity * 2); // 1..3
}

function holdMsFor(tier: GurshaTier | null, intensity: number): number {
  const n = loopCountFor(intensity);
  const performMs = tier ? TIER_PERFORM_MS[tier] : DONATION_PERFORM_MS;
  const ms = ENTER_MS + n * performMs + EXIT_MS;
  return Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, ms));
}

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
  intensity: number;
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
      intensity: gurshaIntensity(alert.totalSantim),
    };
  }
  const name = alert.isAnonymous ? "Someone" : (alert.donorDisplayName ?? "Someone");
  return {
    key: alert.id,
    headline: `${name} donated`,
    amountLabel: formatSantimAsBirr(alert.amountSantim),
    message: alert.message,
    tier: null,
    intensity: gurshaIntensity(alert.amountSantim),
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
    const timer = setTimeout(() => setCurrent(null), holdMsFor(current.tier, current.intensity));
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  const tierMeta = current.tier ? GURSHA_TIER_META[current.tier] : null;

  return (
    <div
      className={`${styles.alert} ${tierMeta?.animationClass ?? ""} ${current.tier === "kurt" ? styles.banner : ""}`}
      key={current.key}
    >
      {tierMeta && (
        // Decorative — the headline below already states sender, gift and
        // amount in full sentence form (§accessibility: "never let the
        // icon carry the meaning"), so this needs no alt text of its own.
        // Falls back to the emoji if the interim WebP ever fails to load.
        <img
          src={tierMeta.imageSrc}
          alt=""
          aria-hidden="true"
          className={styles.tierIcon}
          onError={(e) => {
            const img = e.currentTarget;
            img.style.display = "none";
            img.insertAdjacentHTML("afterend", `<span class="${styles.tierIcon}">${tierMeta.icon}</span>`);
          }}
        />
      )}
      <p className={styles.headline}>{current.headline}</p>
      <p className={styles.amount}>{current.amountLabel}</p>
      {current.message && <p className={styles.message}>&ldquo;{current.message}&rdquo;</p>}
    </div>
  );
}
