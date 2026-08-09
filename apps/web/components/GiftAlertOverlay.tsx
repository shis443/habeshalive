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

interface QueuedAlert {
  key: string;
  headline: string;
  amountLabel: string;
  message: string | null;
}

function toQueuedAlert(alert: StreamAlert): QueuedAlert {
  if (alert.kind === "gift") {
    const name = alert.isAnonymous ? "Someone" : (alert.senderDisplayName ?? "Someone");
    return {
      key: alert.id,
      headline: `${name} sent ${alert.giftName} x${alert.quantity}`,
      amountLabel: formatSantimAsBirr(alert.totalSantim),
      message: alert.message,
    };
  }
  const name = alert.isAnonymous ? "Someone" : (alert.donorDisplayName ?? "Someone");
  return {
    key: alert.id,
    headline: `${name} donated`,
    amountLabel: formatSantimAsBirr(alert.amountSantim),
    message: alert.message,
  };
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
    const timer = setTimeout(() => setCurrent(null), DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  return (
    <div className={styles.alert} key={current.key}>
      <p className={styles.headline}>{current.headline}</p>
      <p className={styles.amount}>{current.amountLabel}</p>
      {current.message && <p className={styles.message}>&ldquo;{current.message}&rdquo;</p>}
    </div>
  );
}
